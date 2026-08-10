import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ─── ArcPulse Public API ──────────────────────────────────────────────────────
// Open, unauthenticated, read-only access to the data ArcPulse collects from
// the Arc Testnet RPC. No API key required — built to help the Arc builder
// community consume and build on top of ArcPulse's historical snapshot data.
//
// Endpoints (query param: ?endpoint=<name>):
//
//   GET /api/public-stats                  → aggregated summary (7d + 30d)
//   GET /api/public-stats?endpoint=latest  → most recent snapshot
//   GET /api/public-stats?endpoint=snapshots[&limit=N][&days=N]
//                                          → raw snapshots (max 100, default last 7d)
//
// All responses include CORS headers so browser-based tools can fetch directly.
// Rate limiting is not enforced here — Supabase's own limits apply on the DB side.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! // read-only anon key is fine for public data
)

function avg(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300', // 5-min cache — fresh enough, saves DB calls
  }
}

function summarise(rs: { block_time_avg: number; gas_price: number; rpc_latency: number; health_score: number; tx_count: number; anomaly: boolean }[]) {
  if (!rs.length) return null
  return {
    snapshots: rs.length,
    avg_block_time_s: parseFloat(avg(rs.map(r => r.block_time_avg)).toFixed(3)),
    avg_gas_price_gwei: parseFloat(avg(rs.map(r => r.gas_price)).toFixed(4)),
    avg_rpc_latency_ms: Math.round(avg(rs.map(r => r.rpc_latency))),
    avg_health_score: Math.round(avg(rs.map(r => r.health_score))),
    total_tx_count: rs.reduce((s, r) => s + (r.tx_count ?? 0), 0),
    anomaly_count: rs.filter(r => r.anomaly).length,
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const endpoint = searchParams.get('endpoint') ?? 'summary'

  try {
    if (endpoint === 'latest') {
      const { data, error } = await supabase
        .from('network_snapshots')
        .select('id, created_at, block_number, block_time_avg, gas_price, rpc_latency, tx_count, chain_id, health_score, anomaly, anomaly_severity')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (error) throw error

      return NextResponse.json({
        ok: true,
        endpoint: 'latest',
        data,
        meta: {
          description: 'Most recent ArcPulse snapshot from Arc Testnet',
          source: 'https://arcpulse-self.vercel.app',
          rpc: 'https://rpc.testnet.arc.network',
        },
      }, { headers: corsHeaders() })
    }

    if (endpoint === 'snapshots') {
      const limitParam = parseInt(searchParams.get('limit') ?? '50', 10)
      const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 100)
      const daysParam = parseInt(searchParams.get('days') ?? '7', 10)
      const days = Math.min(Math.max(1, isNaN(daysParam) ? 7 : daysParam), 30)
      const since = new Date(Date.now() - days * 86_400_000).toISOString()

      const { data, error } = await supabase
        .from('network_snapshots')
        .select('id, created_at, block_number, block_time_avg, gas_price, rpc_latency, tx_count, chain_id, health_score, anomaly, anomaly_severity')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error

      return NextResponse.json({
        ok: true,
        endpoint: 'snapshots',
        count: data?.length ?? 0,
        params: { limit, days },
        data,
        meta: {
          description: `Last ${days} days of ArcPulse snapshots (max ${limit} rows, newest first)`,
          source: 'https://arcpulse-self.vercel.app',
          rpc: 'https://rpc.testnet.arc.network',
        },
      }, { headers: corsHeaders() })
    }

    // Default: summary (7d + 30d aggregates)
    const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { data: rows, error } = await supabase
      .from('network_snapshots')
      .select('created_at, block_time_avg, gas_price, rpc_latency, tx_count, health_score, anomaly')
      .gte('created_at', since30d)
      .order('created_at', { ascending: false })

    if (error) throw error

    const now = Date.now()
    const rows7d = (rows ?? []).filter(r => new Date(r.created_at).getTime() > now - 7 * 86_400_000)
    const rows30d = rows ?? []

    return NextResponse.json({
      ok: true,
      endpoint: 'summary',
      last_7d: summarise(rows7d),
      last_30d: summarise(rows30d),
      meta: {
        description: 'Aggregated Arc Testnet health metrics collected by ArcPulse',
        source: 'https://arcpulse-self.vercel.app',
        rpc: 'https://rpc.testnet.arc.network',
        chain_id: 5042002,
        endpoints: {
          summary: '/api/public-stats',
          latest: '/api/public-stats?endpoint=latest',
          snapshots: '/api/public-stats?endpoint=snapshots&limit=50&days=7',
        },
      },
    }, { headers: corsHeaders() })

  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500, headers: corsHeaders() }
    )
  }
}
