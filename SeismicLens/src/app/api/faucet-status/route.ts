import { NextResponse } from 'next/server'

// Always re-check live — this route must never be statically cached/prerendered,
// since the whole point is a fresh reachability probe on every request.
export const dynamic = 'force-dynamic'

// Public faucet UI — no auth required. There's no public unauthenticated
// "status" endpoint for Circle's faucet; the programmatic drip API
// (api.circle.com/v1/faucet/drips) requires a private API key we don't have
// and shouldn't request just for a status check. So instead we probe
// reachability/latency of the public faucet page itself — the same signal a
// builder cares about: "is the page builders actually use right now up?"
//
// Important caveat (confirmed by testing): Circle's domains return HTTP 403
// to requests from at least some datacenter/cloud IPs, almost certainly bot
// protection (e.g. Cloudflare) rather than the faucet actually being down —
// and serverless functions (including Vercel's) run from datacenter IPs too,
// so this can legitimately happen here in production as a false alarm if we
// treated "non-2xx" as "offline". To avoid that, we only report "offline"
// for genuine network-level failures (timeout, DNS failure, connection
// refused) — any HTTP response at all, even a 403, proves the origin server
// is up and answering, which is what we actually want to know.
const FAUCET_URL = 'https://faucet.circle.com/'
const TIMEOUT_MS = 8000

export async function GET() {
  const t0 = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(FAUCET_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    })
    clearTimeout(timeout)
    const latency = Date.now() - t0
    return NextResponse.json({
      // Any response at all = the server is up. res.ok (2xx-only) would
      // misreport bot-protection blocks as real outages — see caveat above.
      online: true,
      statusCode: res.status,
      blocked: !res.ok,
      latency,
      checkedAt: new Date().toISOString(),
    })
  } catch (e) {
    clearTimeout(timeout)
    const latency = Date.now() - t0
    const timedOut = (e as Error)?.name === 'AbortError'
    return NextResponse.json({
      online: false,
      statusCode: null,
      blocked: false,
      latency: timedOut ? TIMEOUT_MS : latency,
      checkedAt: new Date().toISOString(),
      error: timedOut ? 'timeout' : 'unreachable',
    })
  }
}
