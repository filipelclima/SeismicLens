import { NextResponse } from 'next/server'
import { NATIVE_CURRENCY } from '@/lib/chain'

// Each call must generate a fresh report for whatever snapshots/period were
// posted — never reuse a previous response for a different day.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { snapshots, period } = await req.json()

    if (!snapshots || snapshots.length === 0) {
      return NextResponse.json({ error: 'No snapshots provided' }, { status: 400 })
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a: number, b: number) => a + b, 0) / arr.length : 0

    const avgBlockTime = avg(snapshots.map((s: any) => s.block_time_avg))
    const avgGas = avg(snapshots.map((s: any) => s.gas_price))
    const avgLatency = avg(snapshots.map((s: any) => s.rpc_latency))
    const totalTx = snapshots.reduce((a: number, s: any) => a + s.tx_count, 0)
    const totalShieldedTx = snapshots.reduce((a: number, s: any) => a + (s.shielded_tx_count ?? 0), 0)
    const totalSrc20Transfers = snapshots.reduce((a: number, s: any) => a + (s.src20_transfer_count ?? 0), 0)
    const avgScore = avg(snapshots.map((s: any) => s.health_score ?? 75))
    const anomalies = snapshots.filter((s: any) => s.anomaly).length
    const uptime = ((snapshots.length - anomalies) / snapshots.length * 100).toFixed(1)

    const prompt = `You are SeismicLens, an AI analyst monitoring the Seismic testnet — an EVM L1 with native on-chain privacy (TEE-secured nodes, shielded storage, encrypted type-0x4A transactions). Generate a professional weekly network health report based on the following data.

Period: ${period}
Total snapshots collected: ${snapshots.length}
Average block time: ${avgBlockTime.toFixed(3)}s (Seismic's Summit consensus targets sub-second finality)
Average gas price: ${avgGas.toFixed(4)} gwei (paid in ${NATIVE_CURRENCY.symbol})
Average RPC latency: ${Math.round(avgLatency)}ms
Total transactions recorded: ${totalTx}

Seismic has TWO independent privacy mechanisms — report them separately, never combine into one figure:
- Shielded (type 0x4A, encrypted-calldata) transactions: ${totalShieldedTx}
- SRC20 value-hidden transfers (SUSDC, an ordinary tx.type 0x0 call whose event omits the transferred amount): ${totalSrc20Transfers}

Average health score: ${Math.round(avgScore)}/100
Anomalies detected: ${anomalies}
Network uptime: ${uptime}%

Write a structured weekly report with these sections:
1. Executive Summary (2-3 sentences)
2. Network Performance (block time analysis, sub-second finality target compliance)
3. Gas & Fees (stability, predictability for builders)
4. Privacy Adoption (cover BOTH mechanisms above separately — 0x4A encrypted-calldata activity and SRC20 value-hidden transfers are not interchangeable and must not be added together into a single number)
5. Network Health (score analysis, anomalies if any)
6. Builder Insights (what this means for developers building on Seismic)
7. Outlook (brief forward-looking statement)

Keep it factual, professional, and useful for the Seismic community. Format it ready to post on a forum. Use markdown formatting.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      cache: 'no-store',
    })

    const data = await response.json()
    const text = data.content?.[0]?.text ?? 'Failed to generate report.'

    return NextResponse.json({ report: text })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
