import { NextResponse } from 'next/server'

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
    const avgScore = avg(snapshots.map((s: any) => s.health_score ?? 75))
    const anomalies = snapshots.filter((s: any) => s.anomaly).length
    const uptime = ((snapshots.length - anomalies) / snapshots.length * 100).toFixed(1)

    const prompt = `You are ArcPulse, an AI analyst monitoring the Arc blockchain testnet. Generate a professional weekly network health report based on the following data.

Period: ${period}
Total snapshots collected: ${snapshots.length}
Average block time: ${avgBlockTime.toFixed(3)}s (Arc promises sub-1s finality)
Average gas price: ${avgGas.toFixed(4)} gwei (paid in USDC)
Average RPC latency: ${Math.round(avgLatency)}ms
Total transactions recorded: ${totalTx}
Average health score: ${Math.round(avgScore)}/100
Anomalies detected: ${anomalies}
Network uptime: ${uptime}%

Write a structured weekly report with these sections:
1. Executive Summary (2-3 sentences)
2. Network Performance (block time analysis, finality promise compliance)
3. Gas & Fees (stability, predictability for builders)
4. Network Health (score analysis, anomalies if any)
5. Builder Insights (what this means for developers building on Arc)
6. Outlook (brief forward-looking statement)

Keep it factual, professional, and useful for the Arc community. Format it ready to post on a forum. Use markdown formatting.`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const text = data.content?.[0]?.text ?? 'Failed to generate report.'

    return NextResponse.json({ report: text })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
