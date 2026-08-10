import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { RPC_HTTP, SHIELDED_TX_TYPE, seismicTimestampToSeconds } from '@/lib/chain'

// CRITICAL: this route must never be cached — every invocation must run the
// full collection pipeline and insert a new snapshot. Without force-dynamic,
// Next.js 14 can cache GET handlers in production, causing the Vercel CDN to
// return a stale response (same block number, no new insert) for hours.
export const dynamic = 'force-dynamic'

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
      }).then(r => r.json()).then(() => Date.now() - t0)
    })
  )
  return results
    .filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled')
    .map(r => r.value)
}

export async function GET() {
  try {
    let gapHours: number | null = null
    let wasAnomaly = false
    let prevSeverity: string | null = null
    try {
      const { data: lastRows } = await supabase
        .from('network_snapshots')
        .select('created_at, anomaly, anomaly_severity')
        .order('created_at', { ascending: false })
        .limit(1)
      const lastCreatedAt = lastRows?.[0]?.created_at
      wasAnomaly = lastRows?.[0]?.anomaly === true
      prevSeverity = lastRows?.[0]?.anomaly_severity ?? null
      if (lastCreatedAt) {
        gapHours = (Date.now() - new Date(lastCreatedAt).getTime()) / 3_600_000
      }
    } catch (readErr) {
      await sendDiscordAlert(
        `⚠️ **SeismicPulse — Supabase read failed**\nCould not query \`network_snapshots\` — Supabase may be unreachable or experiencing an incident.\nError: \`${String(readErr).slice(0, 300)}\`\nCheck https://status.supabase.com`
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
    const rawBlocks = await Promise.all(
      blockNums.map(n =>
        rpcCall('eth_getBlockByNumber', ['0x' + n.toString(16), true]).then(r => r.result)
      )
    )
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
          `🔴 **SeismicPulse — CRITICAL anomaly detected**\nHealth score collapsed to **${score}/100** (threshold: <50).\nAvg block time: ${avgBlockTime.toFixed(2)}s · RPC latency: ${latency}ms · Block #${latest}.\n> Immediate attention may be required.`
        )
      } else {
        await sendDiscordAlert(
          `🟡 **SeismicPulse — WARNING: network degraded**\nHealth score dropped to **${score}/100** (threshold: <70).\nAvg block time: ${avgBlockTime.toFixed(2)}s · RPC latency: ${latency}ms · Block #${latest}.\n> Monitoring closely — no action needed yet unless it worsens.`
        )
      }
    } else if (isAnomaly && wasAnomaly && severity === 'critical' && prevSeverity === 'warning') {
      await sendDiscordAlert(
        `🚨 **SeismicPulse — anomaly ESCALATED to CRITICAL**\nHealth score worsened from warning to **${score}/100** (threshold: <50).\nAvg block time: ${avgBlockTime.toFixed(2)}s · RPC latency: ${latency}ms · Block #${latest}.\n> Situation is deteriorating.`
      )
    } else if (!isAnomaly && wasAnomaly) {
      const recovered = prevSeverity === 'critical' ? '🔴 critical' : '🟡 warning'
      await sendDiscordAlert(
        `✅ **SeismicPulse — network recovered**\nHealth score back to **${score}/100** (was ${recovered}).\nBlock #${latest} — Seismic Testnet is healthy again.`
      )
    }

    if (gapHours !== null && gapHours > STALE_GAP_HOURS) {
      await sendDiscordAlert(
        `⚠️ **SeismicPulse — collection gap detected**\nNo snapshot was recorded for about **${gapHours.toFixed(1)}h** before this one. Likely cause: a missed cron invocation (no auto-retry on Hobby) or Supabase was unreachable/paused. Collection has now resumed — block #${latest}.`
      )
    }

    return NextResponse.json(
      { success: true, block: latest, score, anomaly: isAnomaly, severity, block_time_avg: parseFloat(avgBlockTime.toFixed(3)), rpc_latency_avg: latency, rpc_latency_p50: latencyP50, rpc_latency_p95: latencyP95, rpc_latency_p99: latencyP99, tx_count: totalTx, shielded_tx_count: shieldedTx },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    await sendDiscordAlert(`🔴 **SeismicPulse — /api/collect failed**\n\`\`\`${String(e).slice(0, 500)}\`\`\``)
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
