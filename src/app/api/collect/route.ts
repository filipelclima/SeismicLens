import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { RPC_HTTP, SHIELDED_TX_TYPE, SUSDC_CONTRACT, SRC20_TRANSFER_TOPIC, GET_LOGS_MAX_RANGE, seismicTimestampToSeconds } from '@/lib/chain'
import { dedupeSrc20Logs } from '@/lib/src20'

// CRITICAL: this route must never be cached — every invocation must run the
// full collection pipeline and insert a new snapshot. Without force-dynamic,
// Next.js 14 can cache GET handlers in production, causing the Vercel CDN to
// return a stale response (same block number, no new insert) for hours.
// force-dynamic alone only stops the *route* from being statically cached —
// it does NOT disable Next's separate fetch() data cache, which defaults to
// cache: 'force-cache' in Next 14. Every fetch() to the RPC below needs its
// own cache: 'no-store', or it'll keep returning the first cached response
// (same block_number, suspiciously low rpc_latency) on every subsequent hit.
// revalidate = 0 belt-and-suspenders against any route-level ISR caching.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// If anything longer than this has passed since the last snapshot, something
// went wrong upstream (cron didn't fire, Supabase was unreachable, etc.) — the
// daily cron schedule plus Vercel's Hobby 1-hour scheduling window means a
// healthy gap should never exceed ~25h.
const STALE_GAP_HOURS = 26

async function sendDiscordAlert(message: string) {
  const webhook = process.env.DISCORD_WEBHOOK_URL
  if (!webhook) return
  // Retry once — if the first attempt fails (e.g. transient network hiccup),
  // a second attempt 2s later usually succeeds since the webhook target
  // (Discord) is independent of the RPC/Supabase.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      })
      if (res.ok) return
    } catch { /* fall through to retry */ }
    if (attempt === 0) await new Promise(r => setTimeout(r, 2000))
  }
  // If both attempts fail, there's nothing more we can do — swallow silently
  // so a broken webhook never breaks /api/collect itself.
}

async function rpcCall(method: string, params: unknown[] = []) {
  const t0 = Date.now()
  const res = await fetch(RPC_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const latency = Date.now() - t0
  const data = await res.json()
  return { result: data.result, latency }
}

const hexToNum = (h: string) => parseInt(h, 16)

// Same thresholds Seismic's own sub-second block-time target implies: <=0.5s
// is the norm, not the exception, so it anchors the top of the scale.
function calcScore(blockTime: number, latency: number) {
  const blockScore = blockTime <= 0.5 ? 100 : blockTime <= 1 ? 85 : blockTime <= 2 ? 60 : 30
  const latencyScore = latency <= 200 ? 100 : latency <= 400 ? 80 : latency <= 700 ? 55 : 25
  return Math.round(blockScore * 0.4 + latencyScore * 0.35 + 100 * 0.25)
}

function getSeverity(score: number): string | null {
  if (score < 50) return 'critical'
  if (score < 70) return 'warning'
  return null
}

// Percentile helper — nearest-rank method. Sorts a copy; no interpolation needed
// for monitoring use cases (we want a real observed value, not an estimate).
function latencyPercentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

// Measure RPC latency N times in parallel and return all samples.
// Parallel (not sequential) so the total wall-clock overhead stays low —
// 10 parallel pings add ~1 RPC round-trip of latency, not 10x.
async function sampleRpcLatencies(n: number): Promise<number[]> {
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => {
      const t0 = Date.now()
      return fetch(RPC_HTTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        cache: 'no-store',
      }).then(r => r.json()).then(() => Date.now() - t0)
    })
  )
  return results
    .filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled')
    .map(r => r.value)
}

// SRC20 (SUSDC value-hidden transfer) delta scan — independent of the 0x4A
// block-by-block scan below, and much cheaper: eth_getLogs is indexed, so a
// wide range costs one call per GET_LOGS_MAX_RANGE-sized chunk instead of one
// call per block. To avoid double-counting the same transfer across runs, we
// scan the DELTA since the previous snapshot's block_number (reused directly
// — no separate cursor column needed, since the SRC20 scan's toBlock is the
// same `latest` value that gets written to block_number for this row too),
// not a fixed rolling window. Capped at SRC20_COLLECT_MAX_CHUNKS chunks so a
// long outage (missed cron runs, Supabase down) can't make a single
// invocation scan millions of blocks and blow past Vercel's function timeout
// — if the real delta is bigger than the cap, we only scan the most recent
// portion and alert about the gap, same pattern as STALE_GAP_HOURS below.
const SRC20_COLLECT_MAX_CHUNKS = 20 // 20 * 100_000 = 2,000,000 blocks per run, ceiling

async function scanSrc20Delta(fromBlock: number, toBlock: number): Promise<{ count: number; truncated: boolean }> {
  const fullRangeChunks = Math.ceil((toBlock - fromBlock + 1) / GET_LOGS_MAX_RANGE)
  const truncated = fullRangeChunks > SRC20_COLLECT_MAX_CHUNKS
  const scanFrom = truncated ? toBlock - SRC20_COLLECT_MAX_CHUNKS * GET_LOGS_MAX_RANGE + 1 : fromBlock

  const chunkStarts: number[] = []
  for (let start = scanFrom; start <= toBlock; start += GET_LOGS_MAX_RANGE) chunkStarts.push(start)

  const logs: any[] = []
  const CONCURRENCY = 5
  for (let i = 0; i < chunkStarts.length; i += CONCURRENCY) {
    const batch = chunkStarts.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(start => {
        const end = Math.min(start + GET_LOGS_MAX_RANGE - 1, toBlock)
        return rpcCall('eth_getLogs', [{
          fromBlock: '0x' + start.toString(16),
          toBlock: '0x' + end.toString(16),
          address: SUSDC_CONTRACT,
          topics: [SRC20_TRANSFER_TOPIC],
        }]).then(r => r.result).catch(() => [])
      })
    )
    for (const r of results) if (Array.isArray(r)) logs.push(...r)
  }

  return { count: dedupeSrc20Logs(logs).length, truncated }
}

// Vercel's own Cron Jobs (vercel.json) automatically send
// `Authorization: Bearer ${CRON_SECRET}` on every trigger — Vercel reads
// that header value from the project's own CRON_SECRET env var, so once
// it's set in the Vercel dashboard, the built-in cron keeps working with
// no code change here. Any other caller (the GitHub Actions workflow,
// manual curl) must send the same header explicitly.
// process.env.CRON_SECRET is checked for truthiness first — if it's ever
// unset, authHeader === 'Bearer undefined' would otherwise let an
// attacker in by literally sending that string.
function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false
  return req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    let gapHours: number | null = null
    let wasAnomaly = false
    let prevSeverity: string | null = null
    let prevBlockNumber: number | null = null
    try {
      const { data: lastRows } = await supabase
        .from('network_snapshots')
        .select('created_at, anomaly, anomaly_severity, block_number')
        .order('created_at', { ascending: false })
        .limit(1)
      const lastCreatedAt = lastRows?.[0]?.created_at
      wasAnomaly = lastRows?.[0]?.anomaly === true
      prevSeverity = lastRows?.[0]?.anomaly_severity ?? null
      prevBlockNumber = lastRows?.[0]?.block_number ?? null
      if (lastCreatedAt) {
        gapHours = (Date.now() - new Date(lastCreatedAt).getTime()) / 3_600_000
      }
    } catch (readErr) {
      await sendDiscordAlert(
        `⚠️ **SeismicLens — Supabase read failed**\nCould not query \`network_snapshots\` — Supabase may be unreachable or experiencing an incident.\nError: \`${String(readErr).slice(0, 300)}\`\nCheck https://status.supabase.com`
      )
    }

    const { result: blockHex, latency: firstLatency } = await rpcCall('eth_blockNumber')
    const latest = hexToNum(blockHex)
    const { result: chainHex } = await rpcCall('eth_chainId')
    const { result: gasHex } = await rpcCall('eth_gasPrice')

    const extraLatencies = await sampleRpcLatencies(9)
    const allLatencies = [firstLatency, ...extraLatencies]
    const latency = Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
    const latencyP50 = latencyPercentile(allLatencies, 50)
    const latencyP95 = latencyPercentile(allLatencies, 95)
    const latencyP99 = latencyPercentile(allLatencies, 99)

    // 50-block window, full transactions so shielded (type 0x4A) txs can be
    // counted alongside the regular tx total in the same pass.
    const blockNums = Array.from({ length: 50 }, (_, i) => latest - 49 + i)

    // SRC20 delta: from the previous snapshot's block_number (no separate
    // cursor column — see the comment on scanSrc20Delta above) up to `latest`.
    // First run ever (no previous row): just the most recent chunk, not deep
    // history — SRC20 history starts from whenever this ships, not backfilled.
    const src20FromBlock = prevBlockNumber !== null
      ? Math.min(prevBlockNumber + 1, latest)
      : Math.max(0, latest - GET_LOGS_MAX_RANGE + 1)

    const [rawBlocks, src20Result] = await Promise.all([
      Promise.all(
        blockNums.map(n =>
          rpcCall('eth_getBlockByNumber', ['0x' + n.toString(16), true]).then(r => r.result)
        )
      ),
      scanSrc20Delta(src20FromBlock, latest),
    ])
    const valid = rawBlocks.filter(Boolean)

    const times: number[] = []
    let totalTx = 0
    let shieldedTx = 0
    for (let i = 0; i < valid.length; i++) {
      if (i > 0) times.push(seismicTimestampToSeconds(valid[i].timestamp) - seismicTimestampToSeconds(valid[i - 1].timestamp))
      const txs = valid[i].transactions ?? []
      totalTx += txs.length
      shieldedTx += txs.filter((tx: { type?: string }) => tx.type?.toLowerCase() === SHIELDED_TX_TYPE).length
    }
    const avgBlockTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0

    const score = calcScore(avgBlockTime, latency)
    const severity = getSeverity(score)
    const isAnomaly = severity !== null

    const { error, status, statusText } = await supabase.from('network_snapshots').insert({
      created_at: new Date().toISOString(),
      block_number: latest,
      block_time_avg: parseFloat(avgBlockTime.toFixed(3)),
      gas_price: parseFloat((hexToNum(gasHex) / 1e9).toFixed(4)),
      rpc_latency: latency,
      rpc_latency_p50: latencyP50,
      rpc_latency_p95: latencyP95,
      rpc_latency_p99: latencyP99,
      tx_count: totalTx,
      shielded_tx_count: shieldedTx,
      src20_transfer_count: src20Result.count,
      chain_id: hexToNum(chainHex),
      health_score: score,
      anomaly: isAnomaly,
      anomaly_severity: severity,
    })

    if (error) {
      throw new Error(`Supabase insert error [${status} ${statusText}]: ${error.message} (code: ${error.code})`)
    }
    if (status && status >= 300) {
      throw new Error(`Supabase insert returned HTTP ${status} ${statusText} — row may not have been persisted`)
    }

    if (isAnomaly && !wasAnomaly) {
      if (severity === 'critical') {
        await sendDiscordAlert(
          `🔴 **SeismicLens — CRITICAL anomaly detected**\nHealth score collapsed to **${score}/100** (threshold: <50).\nAvg block time: ${avgBlockTime.toFixed(2)}s · RPC latency: ${latency}ms · Block #${latest}.\n> Immediate attention may be required.`
        )
      } else {
        await sendDiscordAlert(
          `🟡 **SeismicLens — WARNING: network degraded**\nHealth score dropped to **${score}/100** (threshold: <70).\nAvg block time: ${avgBlockTime.toFixed(2)}s · RPC latency: ${latency}ms · Block #${latest}.\n> Monitoring closely — no action needed yet unless it worsens.`
        )
      }
    } else if (isAnomaly && wasAnomaly && severity === 'critical' && prevSeverity === 'warning') {
      await sendDiscordAlert(
        `🚨 **SeismicLens — anomaly ESCALATED to CRITICAL**\nHealth score worsened from warning to **${score}/100** (threshold: <50).\nAvg block time: ${avgBlockTime.toFixed(2)}s · RPC latency: ${latency}ms · Block #${latest}.\n> Situation is deteriorating.`
      )
    } else if (!isAnomaly && wasAnomaly) {
      const recovered = prevSeverity === 'critical' ? '🔴 critical' : '🟡 warning'
      await sendDiscordAlert(
        `✅ **SeismicLens — network recovered**\nHealth score back to **${score}/100** (was ${recovered}).\nBlock #${latest} — Seismic Testnet is healthy again.`
      )
    }

    if (gapHours !== null && gapHours > STALE_GAP_HOURS) {
      await sendDiscordAlert(
        `⚠️ **SeismicLens — collection gap detected**\nNo snapshot was recorded for about **${gapHours.toFixed(1)}h** before this one. Likely cause: a missed cron invocation (no auto-retry on Hobby) or Supabase was unreachable/paused. Collection has now resumed — block #${latest}.`
      )
    }

    if (src20Result.truncated) {
      await sendDiscordAlert(
        `⚠️ **SeismicLens — SRC20 scan gap**\nThe delta since the last snapshot's block exceeded ${(SRC20_COLLECT_MAX_CHUNKS * GET_LOGS_MAX_RANGE).toLocaleString()} blocks (likely a collection gap) — only the most recent portion was scanned for SRC20 transfers this run. \`src20_transfer_count\` for this snapshot undercounts; some history in the gap was skipped, not backfilled.`
      )
    }

    return NextResponse.json(
      { success: true, block: latest, score, anomaly: isAnomaly, severity, block_time_avg: parseFloat(avgBlockTime.toFixed(3)), rpc_latency_avg: latency, rpc_latency_p50: latencyP50, rpc_latency_p95: latencyP95, rpc_latency_p99: latencyP99, tx_count: totalTx, shielded_tx_count: shieldedTx, src20_transfer_count: src20Result.count },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    await sendDiscordAlert(`🔴 **SeismicLens — /api/collect failed**\n\`\`\`${String(e).slice(0, 500)}\`\`\``)
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
