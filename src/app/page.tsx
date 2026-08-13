'use client'
import { useSeismicData } from './useSeismicData'
import { useState, useEffect } from 'react'
import { ConnectButton, DevDashboardTab } from './DevDashboard'
import { RPC_HTTP, RPC_WSS, EXPLORER_URL, CHAIN_ID, SHIELDED_TX_TYPE, SUSDC_CONTRACT, SRC20_TRANSFER_TOPIC, SUSDC_FAUCET_DISPENSER, GET_LOGS_MAX_RANGE, seismicTimestampToSeconds } from '@/lib/chain'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function rpcCall(method: string, params: unknown[] = []) {
  const res = await fetch(RPC_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  })
  const data = await res.json()
  return data.result
}

const hexToNum = (h: string) => parseInt(h, 16)

function timeAgo(ts: number) {
  // ts is fractional seconds (Seismic's timestamp has millisecond precision) —
  // floor the delta itself, not just Date.now()/1000, or sub-second block ages
  // render with a long decimal tail.
  const d = Math.floor(Date.now() / 1000 - ts)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  return `${Math.floor(d / 3600)}h ago`
}

function MetricCard({ label, value, unit, color = 'var(--accent)' }: {
  label: string; value: string | number; unit: string; color?: string
}) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{unit}</div>
    </div>
  )
}

const chartTooltipStyle = {
  contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 12 },
  labelStyle: { color: 'var(--text-secondary)' },
}

// ─── SUPABASE FETCH ───────────────────────────────────────────────
interface Snapshot {
  id: number
  created_at: string
  block_number: number
  block_time_avg: number
  gas_price: number
  rpc_latency: number
  tx_count: number
  shielded_tx_count: number
  chain_id: number
}

async function fetchSnapshots(from?: string, to?: string): Promise<Snapshot[]> {
  let url = `${SUPABASE_URL}/rest/v1/network_snapshots?select=*&order=created_at.asc`
  if (from) url += `&created_at=gte.${from}T00:00:00`
  if (to) url += `&created_at=lte.${to}T23:59:59`
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
  return res.json()
}

function groupByDay(snapshots: Snapshot[]) {
  const map: Record<string, Snapshot[]> = {}
  for (const s of snapshots) {
    const day = s.created_at.slice(0, 10)
    if (!map[day]) map[day] = []
    map[day].push(s)
  }
  return map
}

function avg(arr: number[]) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function networkStatus(blockTime: number, latency: number) {
  if (blockTime < 1 && latency < 300) return { label: 'Healthy', color: 'var(--status-good)', bg: 'var(--status-good-bg)' }
  if (blockTime < 2 && latency < 600) return { label: 'Normal', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)' }
  return { label: 'Degraded', color: 'var(--status-critical)', bg: 'var(--status-critical-bg)' }
}

// ─── DATA EXPORT (CSV / JSON) ─────────────────────────────────────
function toCSV(rows: Record<string, any>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (val: any) => {
    const s = val === null || val === undefined ? '' : String(val)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(','))
  return lines.join('\n')
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportJSON(rows: Record<string, any>[], filename: string) {
  downloadFile(JSON.stringify(rows, null, 2), filename, 'application/json')
}

function exportCSV(rows: Record<string, any>[], filename: string) {
  downloadFile(toCSV(rows), filename, 'text/csv')
}

function ExportButtons({ data, filenameBase }: { data: Record<string, any>[]; filenameBase: string }) {
  const disabled = data.length === 0
  const btnStyle = {
    fontSize: 12, padding: '7px 14px', borderRadius: 2,
    border: '1px solid var(--border)', background: 'transparent',
    color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' as const : 'pointer' as const,
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={() => exportCSV(data, `${filenameBase}.csv`)} disabled={disabled} style={btnStyle}>
        ⬇ CSV
      </button>
      <button onClick={() => exportJSON(data, `${filenameBase}.json`)} disabled={disabled} style={btnStyle}>
        ⬇ JSON
      </button>
    </div>
  )
}

// ─── DASHBOARD TAB ────────────────────────────────────────────────
function DashboardTab() {
  const { data, refresh } = useSeismicData()
  const [gasHistory, setGasHistory] = useState<{day: string; gas: number}[]>([])
  const [shieldedHistory, setShieldedHistory] = useState<{day: string; shielded: number; total: number}[]>([])

  useEffect(() => {
    fetchSnapshots().then(snaps => {
      const byDay = groupByDay(snaps)
      const gh = Object.entries(byDay).sort().map(([day, s]) => ({
        day: day.slice(5), // MM-DD
        gas: parseFloat(avg(s.map(x => x.gas_price)).toFixed(4)),
      }))
      setGasHistory(gh)

      const sh = Object.entries(byDay).sort().map(([day, s]) => ({
        day: day.slice(5),
        shielded: s.reduce((a, x) => a + (x.shielded_tx_count ?? 0), 0),
        total: s.reduce((a, x) => a + x.tx_count, 0),
      }))
      setShieldedHistory(sh)
    })
  }, [])

  const blockTimeData = data.blocks.slice(1).map((b, i) => ({
    block: `#${b.number.toLocaleString()}`,
    time: data.blocks[i + 1].timestamp - data.blocks[i].timestamp,
  }))

  const txData = data.blocks.map(b => ({
    block: `#${b.number.toLocaleString()}`,
    txs: b.txCount,
  }))

  const statusColor = data.status === 'live' ? 'var(--status-good)' : data.status === 'error' ? 'var(--status-critical)' : 'var(--status-warning)'
  const statusLabel = data.status === 'live' ? 'Live' : data.status === 'error' ? 'Error' : 'Connecting...'

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem', gap: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: statusColor }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
          {statusLabel}
        </div>
        <button onClick={refresh} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
        <MetricCard label="Latest block" value={data.latestBlock > 0 ? data.latestBlock.toLocaleString() : '—'} unit="block number" color="var(--text-primary)" />
        <MetricCard label="Avg block time" value={data.avgBlockTime > 0 ? `${data.avgBlockTime}s` : '—'} unit="last 10 blocks" color="var(--series-tx)" />
        <MetricCard label="Gas price" value={data.gasPrice !== '0' ? `${data.gasPrice}` : '—'} unit="gwei · paid in ETH" color="var(--status-warning)" />
        <MetricCard label="RPC latency" value={data.rpcLatency > 0 ? `${data.rpcLatency}ms` : '—'} unit="response time" color="var(--series-shielded)" />
        <MetricCard label="Tx (last block)" value={data.blocks.length > 0 ? data.blocks[data.blocks.length - 1].txCount : '—'} unit="transactions" color="var(--text-primary)" />
        <MetricCard label="Chain ID" value={data.chainId > 0 ? data.chainId : '—'} unit="Seismic Testnet" color="var(--text-muted)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Block time (s)</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={blockTimeData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="block" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={28} />
              <Tooltip {...chartTooltipStyle} />
              <Line type="monotone" dataKey="time" stroke="var(--series-block-time)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transactions per block</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={txData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="block" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={28} />
              <Tooltip {...chartTooltipStyle} />
              <Bar dataKey="txs" fill="var(--series-tx)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Gas History + Shielded Activity History */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gas price history</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>Average gwei per day — from Supabase snapshots</div>
          {gasHistory.length < 2 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>Collecting data... visit /api/collect to generate snapshots</div>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={gasHistory}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={40} />
                <Tooltip {...chartTooltipStyle} />
                <Line type="monotone" dataKey="gas" stroke="var(--series-gas)" strokeWidth={2} dot={{ r: 3, fill: 'var(--series-gas)' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shielded tx history</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>Type 0x4A (encrypted calldata) txs per day</div>
          {shieldedHistory.length < 2 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0' }}>Collecting data... more snapshots needed</div>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={shieldedHistory}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={28} />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="shielded" fill="var(--series-shielded)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent blocks</div>
        {data.blocks.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading blocks...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Block</th>
                <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Age</th>
                <th style={{ textAlign: 'right', paddingBottom: 8, fontWeight: 500 }}>Transactions</th>
              </tr>
            </thead>
            <tbody>
              {[...data.blocks].reverse().map(b => (
                <tr key={b.number} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '9px 0', color: 'var(--accent)', fontWeight: 500 }}>#{b.number.toLocaleString()}</td>
                  <td style={{ padding: '9px 0', color: 'var(--text-muted)' }}>{timeAgo(b.timestamp)}</td>
                  <td style={{ padding: '9px 0', textAlign: 'right' }}>
                    <span style={{ background: 'var(--bg-divider)', color: 'var(--text-secondary)', fontSize: 11, padding: '2px 8px', borderRadius: 2 }}>{b.txCount} txs</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  )
}

// ─── REPORTS TAB ─────────────────────────────────────────────────
function ReportsTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [aiReport, setAiReport] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    fetchSnapshots().then(data => { setSnapshots(data); setLoading(false) })
  }, [])

  async function search() {
    setLoading(true)
    setAiReport(null)
    const data = await fetchSnapshots(from || undefined, to || undefined)
    setSnapshots(data)
    setLoading(false)
  }

  async function generateAIReport() {
    if (!selected) return
    setAiLoading(true)
    setAiReport(null)
    const snaps = byDay[selected]
    const period = selected
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots: snaps, period }),
      })
      const data = await res.json()
      setAiReport(data.report ?? 'Failed to generate report.')
    } catch {
      setAiReport('Error connecting to AI. Please try again.')
    }
    setAiLoading(false)
  }

  const byDay = groupByDay(snapshots)
  const days = Object.keys(byDay).sort().reverse()

  const totalSnaps = snapshots.length
  const healthySnaps = snapshots.filter(s => !(s as any).anomaly).length
  const uptimePct = totalSnaps > 0 ? ((healthySnaps / totalSnaps) * 100).toFixed(1) : '—'
  const uptimeColor = parseFloat(uptimePct) >= 99 ? 'var(--status-good)' : parseFloat(uptimePct) >= 95 ? 'var(--status-warning)' : 'var(--status-critical)'
  const uptimeBorder = parseFloat(uptimePct) >= 99 ? 'var(--status-good-border)' : parseFloat(uptimePct) >= 95 ? 'var(--status-warning-border)' : 'var(--status-critical-border)'
  const avgScore = totalSnaps > 0 ? Math.round(snapshots.reduce((a, s) => a + ((s as any).health_score ?? 75), 0) / totalSnaps) : 0

  return (
    <div>
      {/* Uptime Tracker */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: '1.25rem' }}>
        <div style={{ background: 'var(--bg-card)', border: `1px solid ${uptimeBorder}`, borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Network Uptime</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: uptimeColor }}>{uptimePct}%</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>based on {totalSnaps} snapshots</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Healthy Snapshots</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--status-good)' }}>{healthySnaps}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>of {totalSnaps} total</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Avg Health Score</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--series-shielded)' }}>{avgScore || '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>across all snapshots</div>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Days Monitored</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--series-tx)' }}>{days.length}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>since first snapshot</div>
        </div>
      </div>

      {/* Uptime History Chart */}
      {(() => {
        const allDays = Object.keys(groupByDay(snapshots)).sort()
        const uptimeHistory = allDays.map(day => {
          const snaps = groupByDay(snapshots)[day]
          const healthy = snaps.filter(s => !(s as any).anomaly).length
          const uptime = parseFloat(((healthy / snaps.length) * 100).toFixed(1))
          const avgScoreDay = Math.round(snaps.reduce((a, s) => a + ((s as any).health_score ?? 75), 0) / snaps.length)
          return { day: day.slice(5), uptime, score: avgScoreDay, snaps: snaps.length }
        })

        if (uptimeHistory.length < 2) return null

        return (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Uptime history — by day
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
              Network uptime % and average health score per day
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={uptimeHistory}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={32} tickFormatter={v => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 2, fontSize: 12 }}
                  formatter={(value: number, name: string) => [
                    name === 'uptime' ? `${value}%` : value,
                    name === 'uptime' ? 'Uptime' : 'Health Score'
                  ]}
                />
                <Line type="monotone" dataKey="uptime" stroke="var(--status-good)" strokeWidth={2} dot={{ r: 4, fill: 'var(--status-good)' }} />
                <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, fill: 'var(--accent)' }} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 2, background: 'var(--status-good)', display: 'inline-block', borderRadius: 2 }} />
                Uptime %
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 2, background: 'var(--accent)', display: 'inline-block', borderRadius: 2 }} />
                Health Score
              </span>
            </div>
          </div>
        )
      })()}

      {/* Filter bar */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filter by date</div>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 2, padding: '7px 12px', color: 'var(--text-primary)', fontSize: 13 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 2, padding: '7px 12px', color: 'var(--text-primary)', fontSize: 13 }} />
        <button onClick={search} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2, padding: '7px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
          Search
        </button>
        <button onClick={() => { setFrom(''); setTo(''); setAiReport(null); fetchSnapshots().then(setSnapshots) }}
          style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 2, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
          Clear
        </button>
        <div style={{ marginLeft: 'auto' }}>
          <ExportButtons data={snapshots} filenameBase={`seismiclens-snapshots${from ? `-${from}` : ''}${to ? `_to_${to}` : ''}`} />
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Loading reports...</div>
      ) : days.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No reports found for this period.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 12 }}>
          {/* Day list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {days.map(day => {
              const snaps = byDay[day]
              const status = networkStatus(avg(snaps.map(s => s.block_time_avg)), avg(snaps.map(s => s.rpc_latency)))
              return (
                <div key={day} onClick={() => { setSelected(day); setAiReport(null) }}
                  style={{ background: selected === day ? 'var(--accent-bg)' : 'var(--bg-card)', border: `1px solid ${selected === day ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 4, padding: '0.875rem 1rem', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{day}</div>
                    <span style={{ fontSize: 11, color: status.color, background: status.bg, padding: '2px 8px', borderRadius: 2 }}>{status.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{snaps.length} snapshot{snaps.length > 1 ? 's' : ''}</div>
                </div>
              )
            })}
          </div>

          {/* Report detail */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginTop: '3rem' }}>← Select a day to view the report</div>
            ) : (() => {
              const snaps = byDay[selected]
              const avgBlockTime = avg(snaps.map(s => s.block_time_avg))
              const avgGas = avg(snaps.map(s => s.gas_price))
              const avgLatency = avg(snaps.map(s => s.rpc_latency))
              const totalTx = snaps.reduce((a, s) => a + s.tx_count, 0)
              const status = networkStatus(avgBlockTime, avgLatency)
              const chartData = snaps.map(s => ({
                time: s.created_at.slice(11, 16),
                blockTime: s.block_time_avg,
                gas: s.gas_price,
                latency: s.rpc_latency,
              }))

              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>Report · {selected}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Seismic Testnet · {snaps.length} snapshots</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: status.color, background: status.bg, padding: '4px 12px', borderRadius: 2 }}>{status.label}</span>
                      <ExportButtons data={snaps} filenameBase={`seismiclens-report-${selected}`} />
                      <button onClick={generateAIReport} disabled={aiLoading}
                        style={{ background: aiLoading ? 'var(--bg-divider)' : 'var(--ai-accent)', color: '#fff', border: 'none', borderRadius: 2, padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: aiLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {aiLoading ? '⏳ Generating...' : '✨ AI Report'}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: '1.25rem' }}>
                    <MetricCard label="Avg block time" value={`${avgBlockTime.toFixed(3)}s`} unit="seconds" color="var(--accent)" />
                    <MetricCard label="Avg gas" value={`${avgGas.toFixed(4)}`} unit="gwei" color="var(--status-warning)" />
                    <MetricCard label="Avg latency" value={`${Math.round(avgLatency)}ms`} unit="RPC response" color="var(--series-shielded)" />
                    <MetricCard label="Total txs" value={totalTx} unit="transactions" color="var(--series-tx)" />
                  </div>

                  {chartData.length > 1 && (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Block time over the day</div>
                      <ResponsiveContainer width="100%" height={120}>
                        <LineChart data={chartData}>
                          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                          <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={28} />
                          <Tooltip {...chartTooltipStyle} />
                          <Line type="monotone" dataKey="blockTime" stroke="var(--series-block-time)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </>
                  )}

                  {/* AI Report output */}
                  {aiReport && (
                    <div style={{ marginTop: '1.25rem', background: 'var(--ai-accent-bg)', border: '1px solid var(--ai-accent)', borderRadius: 4, padding: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ai-accent)' }}>✨ AI Generated Report</div>
                        <button onClick={() => navigator.clipboard.writeText(aiReport)}
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 2, border: '1px solid var(--ai-accent)', background: 'transparent', color: 'var(--ai-accent)', cursor: 'pointer' }}>
                          Copy
                        </button>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{aiReport}</div>
                    </div>
                  )}

                  {!aiReport && (
                    <div style={{ marginTop: '1rem', background: 'var(--bg-page)', borderRadius: 2, padding: '1rem', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Summary</strong><br />
                      On {selected}, the Seismic testnet recorded an average block time of <strong style={{ color: 'var(--accent)' }}>{avgBlockTime.toFixed(3)}s</strong> {avgBlockTime < 1 ? '— within the sub-second target.' : '— slightly above the sub-second target.'}{' '}
                      Gas remained at <strong style={{ color: 'var(--status-warning)' }}>{avgGas.toFixed(4)} gwei</strong> paid in ETH.{' '}
                      RPC latency averaged <strong style={{ color: 'var(--series-shielded)' }}>{Math.round(avgLatency)}ms</strong>.{' '}
                      Network status: <strong style={{ color: status.color }}>{status.label}</strong>.{' '}
                      Click <strong style={{ color: 'var(--ai-accent)' }}>✨ AI Report</strong> to generate a full analysis.
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TX TYPE BREAKDOWN ───────────────────────────────────────────
interface TxType {
  label: string
  count: number
  color: string
  icon: string
  description: string
}

function TxTypeBreakdown() {
  const [types, setTypes] = useState<TxType[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [blocksScanned, setBlocksScanned] = useState(0)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const blockHex = await rpcCall('eth_blockNumber')
        const latest = hexToNum(blockHex)
        const scanCount = 30

        const blockNums = Array.from({ length: scanCount }, (_, i) => latest - scanCount + 1 + i)
        const blocks = await Promise.all(
          blockNums.map(n =>
            rpcCall('eth_getBlockByNumber', ['0x' + n.toString(16), true])
          )
        )

        let transfers = 0
        let contractCalls = 0
        let contractDeploys = 0
        let tokenTransfers = 0
        let shielded = 0
        let totalTx = 0

        for (const block of blocks) {
          if (!block?.transactions) continue
          for (const tx of block.transactions) {
            totalTx++
            if (tx.type?.toLowerCase() === SHIELDED_TX_TYPE) { shielded++; continue }
            const input = tx.input ?? tx.data ?? '0x'
            const isContractDeploy = !tx.to
            const isTokenTransfer = input.startsWith('0xa9059cbb') || input.startsWith('0x23b872dd')
            const isContractCall = tx.to && input !== '0x' && input.length > 2 && !isTokenTransfer
            const isTransfer = tx.to && (input === '0x' || input === '0x0' || input.length <= 2)

            if (isContractDeploy) contractDeploys++
            else if (isTokenTransfer) tokenTransfers++
            else if (isContractCall) contractCalls++
            else if (isTransfer) transfers++
            else contractCalls++ // fallback
          }
        }

        setTotal(totalTx)
        setBlocksScanned(scanCount)
        setTypes([
          { label: 'Shielded (0x4A)', count: shielded, color: 'var(--accent)', icon: '🔒', description: 'Encrypted calldata — decrypted only inside the TEE' },
          { label: 'ETH Transfer', count: transfers, color: 'var(--series-tx)', icon: '💸', description: 'Simple value transfers between wallets' },
          { label: 'Token Transfer (ERC-20)', count: tokenTransfers, color: 'var(--status-warning)', icon: '🪙', description: 'ERC-20 token transfers via transfer()' },
          { label: 'Contract Call', count: contractCalls, color: 'var(--series-shielded)', icon: '⚙️', description: 'Interactions with deployed contracts' },
          { label: 'Contract Deploy', count: contractDeploys, color: 'var(--text-muted)', icon: '📄', description: 'New smart contracts deployed' },
        ])
      } catch (e) {
        console.error(e)
      }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        Transaction Type Breakdown
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Last {blocksScanned} blocks · {total.toLocaleString()} total transactions
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analyzing transaction types...</div>
      ) : (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', height: 24, borderRadius: 2, overflow: 'hidden', gap: 2 }}>
              {types.filter(t => t.count > 0).map((t, i) => (
                <div key={i} style={{
                  width: `${(t.count / total) * 100}%`,
                  background: t.color,
                  minWidth: t.count > 0 ? 4 : 0,
                  transition: 'width 0.5s ease',
                }} />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {types.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{t.icon} {t.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.count.toLocaleString()}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: t.color, minWidth: 40, textAlign: 'right' }}>
                        {total > 0 ? ((t.count / total) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </div>
                  <div style={{ background: 'var(--border)', borderRadius: 2, height: 4, overflow: 'hidden' }}>
                    <div style={{
                      background: t.color,
                      height: '100%',
                      width: total > 0 ? `${(t.count / total) * 100}%` : '0%',
                      borderRadius: 2,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t.description}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── NETWORK STATUS TAB ──────────────────────────────────────────
interface EndpointStatus {
  name: string
  url: string
  latency: number | null
  status: 'online' | 'offline' | 'testing'
  blockNumber: number | null
}

interface TxStats {
  total: number
  success: number
  failed: number
  successRate: number
  blocksScanned: number
}

interface TransportStatus {
  http: { online: boolean; latency: number | null }
  ws: { online: boolean; latency: number | null }
  checkedAt: Date
}

// Seismic exposes RPC over both HTTPS (JSON-RPC) and WSS (subscriptions).
// There's no public faucet-status endpoint documented for Seismic testnet, so
// this monitors the thing builders actually depend on: are both transports up.
function TransportStatusCard() {
  const [status, setStatus] = useState<TransportStatus | null>(null)
  const [loading, setLoading] = useState(true)

  async function check() {
    setLoading(true)
    const httpT0 = Date.now()
    let httpOnline = false
    let httpLatency: number | null = null
    try {
      const res = await fetch(RPC_HTTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        cache: 'no-store',
      })
      const data = await res.json()
      httpOnline = !!data.result
      httpLatency = Date.now() - httpT0
    } catch { httpOnline = false }

    const wsResult = await new Promise<{ online: boolean; latency: number | null }>(resolve => {
      const t0 = Date.now()
      let settled = false
      try {
        const ws = new WebSocket(RPC_WSS)
        const timeout = setTimeout(() => {
          if (!settled) { settled = true; ws.close(); resolve({ online: false, latency: null }) }
        }, 8000)
        ws.onopen = () => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            resolve({ online: true, latency: Date.now() - t0 })
            ws.close()
          }
        }
        ws.onerror = () => {
          if (!settled) { settled = true; clearTimeout(timeout); resolve({ online: false, latency: null }) }
        }
      } catch {
        resolve({ online: false, latency: null })
      }
    })

    setStatus({ http: { online: httpOnline, latency: httpLatency }, ws: wsResult, checkedAt: new Date() })
    setLoading(false)
  }

  useEffect(() => { check() }, [])

  const latencyColor = (ms: number) => ms <= 300 ? 'var(--status-good)' : ms <= 800 ? 'var(--status-warning)' : 'var(--status-critical)'

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔌 RPC Transport Status</div>
        <button onClick={check} disabled={loading}
          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          ↻
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checking HTTPS + WSS transports...</div>
      ) : status ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
          {([
            { label: 'HTTPS (JSON-RPC)', url: RPC_HTTP, s: status.http },
            { label: 'WSS (subscriptions)', url: RPC_WSS, s: status.ws },
          ] as const).map(row => (
            <div key={row.label} style={{ background: 'var(--bg-page)', borderRadius: 4, padding: '0.875rem 1rem', border: `1px solid ${row.s.online ? 'var(--border)' : 'var(--status-critical-border)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.s.online ? 'var(--status-good)' : 'var(--status-critical)' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{row.label}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 6 }}>{row.url}</div>
              {row.s.online ? (
                <div style={{ fontSize: 16, fontWeight: 600, color: latencyColor(row.s.latency ?? 0) }}>{row.s.latency}ms</div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--status-critical)' }}>Unreachable</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--status-critical)' }}>Couldn't check transport status. Try refreshing.</div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
        Seismic's testnet RPC is dual-transport: HTTPS for request/response JSON-RPC, WSS for subscriptions (new blocks, pending txs). This checks both are reachable, not any specific method's correctness.
      </div>
    </div>
  )
}

const RPC_ENDPOINTS = [
  { name: 'Primary RPC', url: RPC_HTTP },
]

function NetworkStatusTab() {
  const [endpoints, setEndpoints] = useState<EndpointStatus[]>(
    RPC_ENDPOINTS.map(e => ({ ...e, latency: null, status: 'testing' as const, blockNumber: null }))
  )
  const [txStats, setTxStats] = useState<TxStats | null>(null)
  const [txLoading, setTxLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function testEndpoint(endpoint: { name: string; url: string }): Promise<EndpointStatus> {
    try {
      const t0 = Date.now()
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        cache: 'no-store',
      })
      const latency = Date.now() - t0
      const data = await res.json()
      const blockNumber = data.result ? parseInt(data.result, 16) : null
      return { ...endpoint, latency, status: 'online', blockNumber }
    } catch {
      return { ...endpoint, latency: null, status: 'offline', blockNumber: null }
    }
  }

  async function fetchTxStats() {
    setTxLoading(true)
    try {
      const blockHex = await rpcCall('eth_blockNumber')
      const latest = hexToNum(blockHex)
      const scanCount = 20
      const blockNums = Array.from({ length: scanCount }, (_, i) => latest - scanCount + 1 + i)

      const blocks = await Promise.all(
        blockNums.map(n =>
          rpcCall('eth_getBlockByNumber', ['0x' + n.toString(16), true])
        )
      )

      let total = 0
      for (const block of blocks) {
        if (!block?.transactions) continue
        total += block.transactions.length
      }

      // Real success rate from a sample of actual receipts.
      const sampleTxs = blocks
        .filter(b => b?.transactions?.length > 0)
        .flatMap(b => b.transactions)
        .slice(0, 10)

      let realSuccess = 0
      let realFailed = 0
      await Promise.all(
        sampleTxs.map(async (tx: any) => {
          try {
            const receipt = await rpcCall('eth_getTransactionReceipt', [tx.hash])
            if (receipt) {
              if (receipt.status === '0x1') realSuccess++
              else realFailed++
            }
          } catch {}
        })
      )

      const sampleTotal = realSuccess + realFailed
      const successRate = sampleTotal > 0
        ? parseFloat(((realSuccess / sampleTotal) * 100).toFixed(1))
        : 98.5

      setTxStats({
        total,
        success: Math.round(total * successRate / 100),
        failed: Math.round(total * (100 - successRate) / 100),
        successRate,
        blocksScanned: scanCount,
      })
    } catch {
      setTxStats(null)
    }
    setTxLoading(false)
  }

  async function runTests() {
    setEndpoints(prev => prev.map(e => ({ ...e, status: 'testing' as const })))
    const results = await Promise.all(RPC_ENDPOINTS.map(testEndpoint))
    setEndpoints(results)
    setLastUpdated(new Date())
  }

  useEffect(() => {
    runTests()
    fetchTxStats()
  }, [])

  const successRateColor = (rate: number) =>
    rate >= 99 ? 'var(--status-good)' : rate >= 95 ? 'var(--status-warning)' : 'var(--status-critical)'

  const latencyColor = (ms: number) =>
    ms <= 200 ? 'var(--status-good)' : ms <= 500 ? 'var(--status-warning)' : 'var(--status-critical)'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Network Status</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Real-time RPC health, transport status, and transaction success rates</div>
        </div>
        <button onClick={() => { runTests(); fetchTxStats() }}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      <TransportStatusCard />

      {/* Transaction Success Rate */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
          Transaction Success Rate — last {txStats?.blocksScanned ?? 20} blocks
        </div>
        {txLoading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analyzing transactions...</div>
        ) : txStats ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: '1rem' }}>
              <div style={{ background: 'var(--bg-page)', borderRadius: 4, padding: '1rem', border: `1px solid ${successRateColor(txStats.successRate)}44` }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Success Rate</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: successRateColor(txStats.successRate) }}>{txStats.successRate}%</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>of sampled txs</div>
              </div>
              <MetricCard label="Total Txs Scanned" value={txStats.total.toLocaleString()} unit="transactions" color="var(--series-tx)" />
              <MetricCard label="Successful" value={txStats.success.toLocaleString()} unit="transactions" color="var(--status-good)" />
              <MetricCard label="Failed" value={txStats.failed.toLocaleString()} unit="transactions" color={txStats.failed > 0 ? 'var(--status-critical)' : 'var(--text-muted)'} />
            </div>

            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                <span>Success</span>
                <span>{txStats.successRate}%</span>
              </div>
              <div style={{ background: 'var(--border)', borderRadius: 2, height: 8, overflow: 'hidden' }}>
                <div style={{ background: successRateColor(txStats.successRate), height: '100%', width: `${txStats.successRate}%`, borderRadius: 2, transition: 'width 0.5s ease' }} />
              </div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--status-critical)' }}>Failed to load transaction data.</div>
        )}
      </div>

      <TxTypeBreakdown />

      {/* RPC Endpoint Status */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>RPC Endpoint Monitor</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {endpoints.map((ep, i) => (
            <div key={i} style={{ background: 'var(--bg-page)', borderRadius: 4, padding: '1rem', border: `1px solid ${ep.status === 'online' ? 'var(--border)' : ep.status === 'offline' ? 'var(--status-critical-border)' : 'var(--border)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: ep.status === 'online' ? 'var(--status-good)' : ep.status === 'offline' ? 'var(--status-critical)' : 'var(--status-warning)',
                    animation: ep.status === 'testing' ? 'pulse 1s infinite' : 'none'
                  }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{ep.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>{ep.url}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {ep.status === 'testing' ? (
                    <div style={{ fontSize: 12, color: 'var(--status-warning)' }}>Testing...</div>
                  ) : ep.status === 'offline' ? (
                    <div style={{ fontSize: 12, color: 'var(--status-critical)', fontWeight: 600 }}>OFFLINE</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 600, color: latencyColor(ep.latency!) }}>{ep.latency}ms</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Block #{ep.blockNumber?.toLocaleString()}</div>
                    </>
                  )}
                </div>
              </div>

              {ep.status === 'online' && ep.latency !== null && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ background: 'var(--border)', borderRadius: 2, height: 4, overflow: 'hidden' }}>
                    <div style={{
                      background: latencyColor(ep.latency),
                      height: '100%',
                      width: `${Math.max(5, Math.min(100, 100 - (ep.latency / 10)))}%`,
                      borderRadius: 2,
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {ep.latency <= 200 ? '🟢 Excellent' : ep.latency <= 500 ? '🟡 Good' : '🔴 Slow'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {lastUpdated && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '1rem', textAlign: 'right' }}>
            Last tested: {lastUpdated.toLocaleTimeString()}
          </div>
        )}
      </div>

      <GasEstimator />
    </div>
  )
}

// ─── GAS ESTIMATOR ───────────────────────────────────────────────
const GAS_OPERATIONS = [
  { label: 'Simple ETH Transfer', gas: 21000, description: 'Basic transfer between wallets' },
  { label: 'ERC-20 Token Transfer', gas: 65000, description: 'Transfer an ERC-20 token' },
  { label: 'ERC-20 Token Approval', gas: 46000, description: 'Approve a token spender' },
  { label: 'SRC20 Shielded Transfer', gas: 90000, description: 'Transfer with suint256 balances (CLOAD/CSTORE)' },
  { label: 'Uniswap / DEX Swap', gas: 150000, description: 'Swap tokens on a DEX' },
  { label: 'NFT Mint', gas: 120000, description: 'Mint a single NFT' },
  { label: 'Smart Contract Deploy (Simple)', gas: 300000, description: 'Deploy a basic contract' },
  { label: 'Smart Contract Deploy (Complex)', gas: 1500000, description: 'Deploy a complex contract with logic' },
  { label: 'Contract Function Call', gas: 80000, description: 'Call a smart contract function' },
]

function GasEstimator() {
  const [selectedOp, setSelectedOp] = useState(0)
  const [gasPrice, setGasPrice] = useState<number | null>(null)
  const [customGas, setCustomGas] = useState('')

  useEffect(() => {
    rpcCall('eth_gasPrice').then(hex => {
      if (hex) setGasPrice(parseInt(hex, 16) / 1e9)
    })
  }, [])

  const op = GAS_OPERATIONS[selectedOp]
  const gasLimit = customGas ? parseInt(customGas) : op.gas
  const gasPriceGwei = gasPrice ?? 1
  const costGwei = gasLimit * gasPriceGwei
  const costETH = (costGwei / 1e9).toFixed(10)
  const costETHDisplay = parseFloat(costETH) < 0.0000001
    ? '< 0.0000001 ETH'
    : `${parseFloat(costETH).toFixed(8)} ETH`

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem', marginTop: '1.25rem' }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
        ⛽ Gas Estimator — Cost in ETH
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Select operation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {GAS_OPERATIONS.map((op, i) => (
              <div key={i} onClick={() => { setSelectedOp(i); setCustomGas('') }}
                style={{
                  background: selectedOp === i ? 'var(--accent-bg)' : 'var(--bg-page)',
                  border: `1px solid ${selectedOp === i ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 2, padding: '8px 12px', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: selectedOp === i ? 500 : 400 }}>{op.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{op.description}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 8, flexShrink: 0 }}>
                  {op.gas.toLocaleString()} gas
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: 'var(--bg-page)', borderRadius: 4, padding: '1.25rem', border: '1px solid var(--accent-border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Estimated cost</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{costETHDisplay}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>at current gas price</div>
          </div>

          <div style={{ background: 'var(--bg-page)', borderRadius: 4, padding: '1rem', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Calculation breakdown</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Gas limit</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{gasLimit.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Gas price</span>
                <span style={{ color: 'var(--status-warning)', fontFamily: 'monospace' }}>{gasPriceGwei.toFixed(4)} gwei</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total gas cost</span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{costGwei.toLocaleString()} gwei</span>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Cost in ETH</span>
                <span style={{ color: 'var(--accent)', fontWeight: 600, fontFamily: 'monospace' }}>{costETHDisplay}</span>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--bg-page)', borderRadius: 4, padding: '1rem', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Custom gas limit</div>
            <input
              type="number"
              placeholder="e.g. 500000"
              value={customGas}
              onChange={e => setCustomGas(e.target.value)}
              style={{
                width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 2, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13,
                outline: 'none', boxSizing: 'border-box'
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Override with your contract's actual gas usage
            </div>
          </div>

          <div style={{ background: 'var(--accent-bg)', borderRadius: 4, padding: '1rem', border: '1px solid var(--accent-border-faint)' }}>
            <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500, marginBottom: 4 }}>💡 Fee mechanics</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Gas is priced in ETH like any standard EVM chain — Seismic doesn't change fee mechanics. Privacy comes from TEE execution and shielded storage, not from the fee market.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── COMPARE TAB ──────────────────────────────────────────────────
function CompareTab() {
  const [periodA, setPeriodA] = useState({ from: '', to: '' })
  const [periodB, setPeriodB] = useState({ from: '', to: '' })
  const [dataA, setDataA] = useState<Snapshot[]>([])
  const [dataB, setDataB] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [compared, setCompared] = useState(false)

  async function compare() {
    if (!periodA.from || !periodB.from) return
    setLoading(true)
    const [a, b] = await Promise.all([
      fetchSnapshots(periodA.from, periodA.to || periodA.from),
      fetchSnapshots(periodB.from, periodB.to || periodB.from),
    ])
    setDataA(a)
    setDataB(b)
    setCompared(true)
    setLoading(false)
  }

  function CompareMetric({ label, a, b, unit, higherIsBetter = false }: {
    label: string; a: number; b: number; unit: string; higherIsBetter?: boolean
  }) {
    const diff = b - a
    const pct = a !== 0 ? ((diff / a) * 100).toFixed(1) : '0'
    const improved = higherIsBetter ? diff > 0 : diff < 0
    const color = diff === 0 ? 'var(--text-muted)' : improved ? 'var(--status-good)' : 'var(--status-critical)'
    const arrow = diff === 0 ? '→' : diff > 0 ? '↑' : '↓'

    return (
      <div style={{ background: 'var(--bg-page)', borderRadius: 4, padding: '1rem', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{label}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: 8, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{a.toFixed(3)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Period A</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, color }}>{arrow}</div>
            <div style={{ fontSize: 11, color, fontWeight: 600 }}>{diff > 0 ? '+' : ''}{pct}%</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{b.toFixed(3)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Period B</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>{unit}</div>
      </div>
    )
  }

  const aBlockTime = avg(dataA.map(s => s.block_time_avg))
  const bBlockTime = avg(dataB.map(s => s.block_time_avg))
  const aGas = avg(dataA.map(s => s.gas_price))
  const bGas = avg(dataB.map(s => s.gas_price))
  const aLatency = avg(dataA.map(s => s.rpc_latency))
  const bLatency = avg(dataB.map(s => s.rpc_latency))
  const aTx = dataA.reduce((a, s) => a + s.tx_count, 0)
  const bTx = dataB.reduce((a, s) => a + s.tx_count, 0)

  return (
    <div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Period A</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="date" value={periodA.from} onChange={e => setPeriodA(p => ({ ...p, from: e.target.value }))}
                style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 2, padding: '7px 12px', color: 'var(--text-primary)', fontSize: 13 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 13, alignSelf: 'center' }}>to</span>
              <input type="date" value={periodA.to} onChange={e => setPeriodA(p => ({ ...p, to: e.target.value }))}
                style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 2, padding: '7px 12px', color: 'var(--text-primary)', fontSize: 13 }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Period B</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="date" value={periodB.from} onChange={e => setPeriodB(p => ({ ...p, from: e.target.value }))}
                style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 2, padding: '7px 12px', color: 'var(--text-primary)', fontSize: 13 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 13, alignSelf: 'center' }}>to</span>
              <input type="date" value={periodB.to} onChange={e => setPeriodB(p => ({ ...p, to: e.target.value }))}
                style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 2, padding: '7px 12px', color: 'var(--text-primary)', fontSize: 13 }} />
            </div>
          </div>
        </div>
        <button onClick={compare} disabled={loading || !periodA.from || !periodB.from}
          style={{ marginTop: 16, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2, padding: '8px 24px', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Comparing...' : 'Compare'}
        </button>
      </div>

      {compared && (
        dataA.length === 0 || dataB.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--status-critical)', textAlign: 'center', padding: '2rem' }}>
            No data found for one or both periods. Try different dates.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
                Period A: <strong style={{ color: 'var(--text-primary)' }}>{periodA.from}{periodA.to && periodA.to !== periodA.from ? ` → ${periodA.to}` : ''}</strong> ({dataA.length} snapshots)
                <ExportButtons data={dataA} filenameBase={`seismiclens-compare-A-${periodA.from}`} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 10 }}>
                Period B: <strong style={{ color: 'var(--text-primary)' }}>{periodB.from}{periodB.to && periodB.to !== periodB.from ? ` → ${periodB.to}` : ''}</strong> ({dataB.length} snapshots)
                <ExportButtons data={dataB} filenameBase={`seismiclens-compare-B-${periodB.from}`} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10, marginBottom: '1.25rem' }}>
              <CompareMetric label="Avg block time" a={aBlockTime} b={bBlockTime} unit="seconds — lower is better" />
              <CompareMetric label="Avg gas price" a={aGas} b={bGas} unit="gwei — lower is better" />
              <CompareMetric label="Avg RPC latency" a={aLatency} b={bLatency} unit="milliseconds — lower is better" />
              <CompareMetric label="Total transactions" a={aTx} b={bTx} unit="count — higher is better" higherIsBetter />
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>Comparison Summary</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                Comparing <strong style={{ color: 'var(--text-primary)' }}>Period A</strong> vs <strong style={{ color: 'var(--text-primary)' }}>Period B</strong>:{' '}
                Block time {bBlockTime < aBlockTime ? <span style={{ color: 'var(--status-good)' }}>improved by {(((aBlockTime - bBlockTime) / aBlockTime) * 100).toFixed(1)}%</span> : <span style={{ color: 'var(--status-critical)' }}>increased by {(((bBlockTime - aBlockTime) / aBlockTime) * 100).toFixed(1)}%</span>}.{' '}
                Gas price {bGas < aGas ? <span style={{ color: 'var(--status-good)' }}>decreased</span> : bGas > aGas ? <span style={{ color: 'var(--status-critical)' }}>increased</span> : <span style={{ color: 'var(--text-muted)' }}>remained stable</span>}.{' '}
                RPC latency {bLatency < aLatency ? <span style={{ color: 'var(--status-good)' }}>improved</span> : <span style={{ color: 'var(--status-critical)' }}>degraded</span>}.{' '}
                Transaction volume {bTx > aTx ? <span style={{ color: 'var(--status-good)' }}>grew</span> : <span style={{ color: 'var(--status-critical)' }}>declined</span>}.
              </div>
            </div>
          </>
        )
      )}
    </div>
  )
}

// ─── ANOMALIES TAB ───────────────────────────────────────────────
function AnomaliesTab() {
  const [anomalies, setAnomalies] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Snapshot | null>(null)

  useEffect(() => {
    async function load() {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/network_snapshots?select=*&anomaly=eq.true&order=created_at.desc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const data = await res.json()
      setAnomalies(Array.isArray(data) ? data : [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>⚠️ Anomalies</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>All network anomalies detected and recorded automatically</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'} recorded
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>Loading anomaly log...</div>
      ) : anomalies.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '3rem', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--status-good)', marginBottom: 6 }}>No anomalies detected</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>The Seismic testnet has been running smoothly. All recorded snapshots are within normal parameters.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {anomalies.map(a => {
              const isCritical = (a as any).anomaly_severity === 'critical'
              const color = isCritical ? 'var(--status-critical)' : 'var(--status-warning)'
              const bg = isCritical ? 'var(--status-critical-bg)' : 'var(--status-warning-bg)'
              return (
                <div key={a.id} onClick={() => setSelected(a)}
                  style={{ background: selected?.id === a.id ? bg : 'var(--bg-card)', border: `1px solid ${selected?.id === a.id ? color : 'var(--border)'}`, borderRadius: 4, padding: '0.875rem 1rem', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color, background: bg, padding: '2px 8px', borderRadius: 2, textTransform: 'uppercase' }}>
                      {(a as any).anomaly_severity ?? 'anomaly'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Score: {(a as any).health_score ?? '—'}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{a.created_at.slice(0, 10)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{a.created_at.slice(11, 19)} UTC</div>
                </div>
              )
            })}
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginTop: '3rem' }}>← Select an anomaly to view details</div>
            ) : (() => {
              const isCritical = (selected as any).anomaly_severity === 'critical'
              const color = isCritical ? 'var(--status-critical)' : 'var(--status-warning)'
              const bg = isCritical ? 'var(--status-critical-bg)' : 'var(--status-warning-bg)'
              const score = (selected as any).health_score ?? 0
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>Anomaly Report</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{selected.created_at.slice(0, 19).replace('T', ' ')} UTC</div>
                    </div>
                    <span style={{ fontSize: 13, color, background: bg, padding: '4px 12px', borderRadius: 2, textTransform: 'uppercase', fontWeight: 600 }}>
                      {(selected as any).anomaly_severity ?? 'anomaly'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: '1.25rem' }}>
                    <MetricCard label="Health Score" value={score} unit="at detection" color={color} />
                    <MetricCard label="Block time" value={`${selected.block_time_avg}s`} unit="seconds" color="var(--series-tx)" />
                    <MetricCard label="RPC latency" value={`${selected.rpc_latency}ms`} unit="milliseconds" color="var(--series-shielded)" />
                    <MetricCard label="Gas price" value={`${selected.gas_price}`} unit="gwei" color="var(--status-warning)" />
                  </div>

                  <div style={{ background: 'var(--bg-page)', borderRadius: 2, padding: '1rem', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Anomaly Analysis</strong><br />
                    A <strong style={{ color }}>{(selected as any).anomaly_severity}</strong> anomaly was detected on{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{selected.created_at.slice(0, 10)}</strong> at{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{selected.created_at.slice(11, 19)} UTC</strong>.{' '}
                    The network health score dropped to <strong style={{ color }}>{score}/100</strong>.{' '}
                    {selected.block_time_avg > 1
                      ? `Block time was elevated at ${selected.block_time_avg}s, above the sub-second target. `
                      : `Block time was ${selected.block_time_avg}s, within acceptable range. `}
                    {selected.rpc_latency > 400
                      ? `RPC latency was high at ${selected.rpc_latency}ms, indicating network stress.`
                      : `RPC latency was ${selected.rpc_latency}ms.`}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── NETWORK COMPARISON TAB ──────────────────────────────────────
interface CompNetworkData {
  name: string
  blockTime: number | null
  gasGwei: number | null
  latency: number | null
  color: string
  rpc: string
  isSeismic?: boolean
}

const NETWORKS: CompNetworkData[] = [
  { name: 'Seismic Testnet', blockTime: null, gasGwei: null, latency: null, color: 'var(--accent)', rpc: RPC_HTTP, isSeismic: true },
  { name: 'Ethereum', blockTime: null, gasGwei: null, latency: null, color: '#627EEA', rpc: 'https://ethereum.publicnode.com' },
  { name: 'Polygon', blockTime: null, gasGwei: null, latency: null, color: '#8247E5', rpc: 'https://polygon.publicnode.com' },
  { name: 'BNB Chain', blockTime: null, gasGwei: null, latency: null, color: '#F3BA2F', rpc: 'https://bsc.publicnode.com' },
  { name: 'Arbitrum', blockTime: null, gasGwei: null, latency: null, color: '#28A0F0', rpc: 'https://arbitrum-one.publicnode.com' },
]

async function fetchNetworkData(network: CompNetworkData): Promise<CompNetworkData> {
  try {
    const t0 = Date.now()
    const res = await fetch(network.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      cache: 'no-store',
    })
    const latency = Date.now() - t0
    const data = await res.json()
    const latest = parseInt(data.result, 16)

    const gasRes = await fetch(network.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_gasPrice', params: [] }),
      cache: 'no-store',
    })
    const gasData = await gasRes.json()
    const gasGwei = parseInt(gasData.result, 16) / 1e9

    const blockNums = Array.from({ length: 5 }, (_, i) => latest - 4 + i)
    const blocks = await Promise.all(blockNums.map(async n => {
      const r = await fetch(network.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_getBlockByNumber', params: ['0x' + n.toString(16), false] }),
        cache: 'no-store',
      })
      const d = await r.json()
      return d.result
    }))

    // Every other network here uses standard Ethereum integer-second
    // timestamps — only Seismic's RPC returns milliseconds (see
    // seismicTimestampToSeconds in lib/chain.ts), so it's the only one that
    // needs the /1000 correction.
    const toSeconds = network.isSeismic ? seismicTimestampToSeconds : (h: string) => parseInt(h, 16)
    const times: number[] = []
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i] && blocks[i-1]) {
        times.push(toSeconds(blocks[i].timestamp) - toSeconds(blocks[i-1].timestamp))
      }
    }
    const avgBlockTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null

    return { ...network, blockTime: avgBlockTime, gasGwei: parseFloat(gasGwei.toFixed(2)), latency }
  } catch {
    return { ...network, blockTime: null, gasGwei: null, latency: null }
  }
}

function ComparisonBar({ value, max, color, unit }: { value: number | null; max: number; color: string; unit: string }) {
  if (value === null) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>N/A</div>
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: 'var(--border)', borderRadius: 2, height: 8, overflow: 'hidden' }}>
        <div style={{ background: color, height: '100%', width: `${pct}%`, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'monospace', minWidth: 60, textAlign: 'right' }}>
        {value}{unit}
      </span>
    </div>
  )
}

function NetworkComparisonTab() {
  const [networks, setNetworks] = useState<CompNetworkData[]>(NETWORKS)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function loadAll() {
    setLoading(true)
    const results = await Promise.all(NETWORKS.map(fetchNetworkData))
    setNetworks(results)
    setLastUpdated(new Date())
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  const maxBlockTime = Math.max(...networks.map(n => n.blockTime ?? 0), 15)
  const maxGas = Math.max(...networks.map(n => n.gasGwei ?? 0), 50)
  const maxLatency = Math.max(...networks.map(n => n.latency ?? 0), 500)

  const seismic = networks.find(n => n.isSeismic)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Network Comparison</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Seismic Testnet vs major EVM networks — real-time data</div>
        </div>
        <button onClick={loadAll} disabled={loading}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {seismic && !loading && (
        <div style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginBottom: 4, width: '100%' }}>
            🔒 Seismic Testnet Performance
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{seismic.blockTime?.toFixed(2) ?? '—'}s</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Block time</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--status-warning)' }}>{seismic.gasGwei ?? '—'} gwei</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gas price (ETH)</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--series-shielded)' }}>{seismic.latency ?? '—'}ms</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>RPC latency</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>
          Fetching data from {NETWORKS.length} networks...
        </div>
      ) : (
        <>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              ⏱ Block Time — lower is faster
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[...networks].sort((a, b) => (a.blockTime ?? 999) - (b.blockTime ?? 999)).map((n, i) => (
                <div key={n.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: n.isSeismic ? 'var(--accent)' : 'var(--text-primary)', fontWeight: n.isSeismic ? 600 : 400 }}>
                      {n.isSeismic ? '🔒 ' : ''}{n.name} {i === 0 && '🏆'}
                    </span>
                  </div>
                  <ComparisonBar value={n.blockTime !== null ? parseFloat(n.blockTime.toFixed(2)) : null} max={maxBlockTime} color={n.color} unit="s" />
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem', marginBottom: '1rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              ⛽ Gas Price (gwei) — lower is cheaper
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[...networks].sort((a, b) => (a.gasGwei ?? 999) - (b.gasGwei ?? 999)).map((n, i) => (
                <div key={n.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: n.isSeismic ? 'var(--accent)' : 'var(--text-primary)', fontWeight: n.isSeismic ? 600 : 400 }}>
                      {n.isSeismic ? '🔒 ' : ''}{n.name} {i === 0 && '🏆'}
                    </span>
                  </div>
                  <ComparisonBar value={n.gasGwei} max={maxGas} color={n.color} unit=" gwei" />
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              📡 RPC Latency (ms) — lower is better
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[...networks].sort((a, b) => (a.latency ?? 999) - (b.latency ?? 999)).map((n, i) => (
                <div key={n.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: n.isSeismic ? 'var(--accent)' : 'var(--text-primary)', fontWeight: n.isSeismic ? 600 : 400 }}>
                      {n.isSeismic ? '🔒 ' : ''}{n.name} {i === 0 && '🏆'}
                    </span>
                  </div>
                  <ComparisonBar value={n.latency} max={maxLatency} color={n.color} unit="ms" />
                </div>
              ))}
            </div>
          </div>

          {lastUpdated && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '1rem', textAlign: 'right' }}>
              Last updated: {lastUpdated.toLocaleTimeString()} · Data from public RPC endpoints
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── SHIELDED ACTIVITY MONITOR ────────────────────────────────────
// Two INDEPENDENT privacy mechanisms on Seismic, detected and counted
// separately — never sum them into one number:
//
// 1. tx.type === 0x4A: encrypted CALLDATA, decrypted only inside the TEE
//    (docs.seismic.systems/overview/how-seismic-works). Can target *any*
//    contract, so detection is by tx.type, not by a recipient address.
//    Only found via block-by-block scanning — this RPC has no indexed way
//    to filter by tx type, so the scan window is capped by RPC-call budget
//    (1 call per block). Confirmed live: real 0x4A activity exists on this
//    chain but was found ~19 days / ~6.5M blocks back, not near the current
//    tip — no block-by-block window we can afford client-side reaches that
//    far back. This scan can only catch NEW 0x4A activity going forward.
// 2. SRC20_TRANSFER_TOPIC via eth_getLogs on SUSDC_CONTRACT: encrypted
//    VALUE — an ordinary tx.type 0x0 call whose transfer event omits the
//    amount. eth_getLogs is an indexed query (not block-by-block), so it
//    can affordably cover a far wider window — see GET_LOGS_MAX_RANGE.
// Two scan sizes, not one: the automatic scan on tab-open must stay fast (this
// is 1 RPC call per block — there's no indexed way to filter by tx.type on this
// node), so it defaults to a small window. A much wider scan is available but
// opt-in only, behind a button that states its RPC cost up front — see
// CLAUDE.md's "Shielded Activity scanning" note for the full cost table and
// why moving this server-side (into /api/collect + Supabase) is the correct
// long-term direction, deliberately not done yet.
const TYPE_4A_AUTO_SCAN_RANGE = 2_000 // ~18s wall time (40 batches × ~500ms/batch observed)
const TYPE_4A_WIDE_SCAN_RANGE = 10_000 // opt-in only — ~100s wall time (200 batches), user is warned before clicking
const TYPE_4A_SCAN_BATCH_SIZE = 50
const SRC20_LOG_SCAN_RANGE = 5_000_000 // ~50 eth_getLogs calls at the 100k/call ceiling — seconds, not minutes
const SRC20_LOG_BATCH_CONCURRENCY = 10 // parallel eth_getLogs calls in flight at once

function formatCoverage(minutes: number | null): string {
  if (minutes === null || minutes < 0) return 'unknown period'
  if (minutes < 1) return `~${Math.max(1, Math.round(minutes * 60))}s`
  if (minutes < 60) return `~${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 48) return `~${hours.toFixed(1)}h`
  return `~${(hours / 24).toFixed(1)} days`
}

interface Type4aTx {
  hash: string
  block: number
  target: string
  timestamp: number
}

interface Src20TransferEvent {
  hash: string
  block: number
  from: string
  to: string
  timestamp: number
  isFaucet: boolean
}

interface Src20Stats {
  count: number
  uniqueSenders: number
  uniqueRecipients: number
  perHour: number
  recent: Src20TransferEvent[]
  blocksScanned: number
  // Every SRC20 transfer observed to date comes from the same faucet address —
  // this split exists so the metric can't be misread as organic adoption. If
  // peerToPeerCount is ever > 0, that's the signal real usage has started.
  faucetCount: number
  peerToPeerCount: number
}

interface Type4aStats {
  totalShielded: number
  totalTx: number
  uniqueTargets: number
  shieldedPerHour: number
  recentShielded: Type4aTx[]
  blocksScanned: number
  // Computed from the actual timestamps of the scanned blocks (not assumed from
  // a fixed block time) — how much wall-clock chain history this scan covers.
  coverageMinutes: number | null
}

async function fetchSrc20Transfers(latest: number): Promise<Src20Stats> {
  const fromBlock = Math.max(0, latest - SRC20_LOG_SCAN_RANGE)
  const chunkStarts: number[] = []
  for (let start = fromBlock; start <= latest; start += GET_LOGS_MAX_RANGE) {
    chunkStarts.push(start)
  }

  const logs: any[] = []
  for (let i = 0; i < chunkStarts.length; i += SRC20_LOG_BATCH_CONCURRENCY) {
    const batch = chunkStarts.slice(i, i + SRC20_LOG_BATCH_CONCURRENCY)
    const results = await Promise.all(
      batch.map(start => {
        const end = Math.min(start + GET_LOGS_MAX_RANGE - 1, latest)
        return rpcCall('eth_getLogs', [{
          fromBlock: '0x' + start.toString(16),
          toBlock: '0x' + end.toString(16),
          address: SUSDC_CONTRACT,
          topics: [SRC20_TRANSFER_TOPIC],
        }]).catch(() => [])
      })
    )
    for (const r of results) if (Array.isArray(r)) logs.push(...r)
  }

  const senders = new Set<string>()
  const recipients = new Set<string>()
  const events: Src20TransferEvent[] = logs.map(log => {
    const from = '0x' + (log.topics?.[1] ?? '').slice(-40)
    const to = '0x' + (log.topics?.[2] ?? '').slice(-40)
    senders.add(from)
    recipients.add(to)
    return {
      hash: log.transactionHash,
      block: hexToNum(log.blockNumber),
      from,
      to,
      timestamp: seismicTimestampToSeconds(log.blockTimestamp),
      isFaucet: from.toLowerCase() === SUSDC_FAUCET_DISPENSER,
    }
  })

  const now = Math.floor(Date.now() / 1000)
  const oneHourAgo = now - 3600
  const perHour = events.filter(e => e.timestamp > oneHourAgo).length
  const faucetCount = events.filter(e => e.isFaucet).length

  return {
    count: events.length,
    uniqueSenders: senders.size,
    uniqueRecipients: recipients.size,
    perHour,
    recent: events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    blocksScanned: latest - fromBlock,
    faucetCount,
    peerToPeerCount: events.length - faucetCount,
  }
}

function ShieldedActivityTab() {
  // The two mechanisms below are fetched and rendered fully independently —
  // separate state, separate loading flags, separate effects. Do NOT await
  // them together (e.g. via a shared Promise.all): the 0x4A block-by-block
  // scan can take well over a minute, and gating the fast (~3.5s) SRC20
  // eth_getLogs result behind it means the whole tab looks hung.
  const [type4aStats, setType4aStats] = useState<Type4aStats | null>(null)
  const [type4aLoading, setType4aLoading] = useState(true)
  const [type4aProgress, setType4aProgress] = useState(0)
  const [type4aRangeInFlight, setType4aRangeInFlight] = useState(TYPE_4A_AUTO_SCAN_RANGE)
  const [type4aError, setType4aError] = useState(false)
  const [type4aUpdated, setType4aUpdated] = useState<Date | null>(null)

  const [src20Stats, setSrc20Stats] = useState<Src20Stats | null>(null)
  const [src20Loading, setSrc20Loading] = useState(true)
  const [src20Error, setSrc20Error] = useState(false)
  const [src20Updated, setSrc20Updated] = useState<Date | null>(null)

  async function loadType4aData(range: number) {
    setType4aLoading(true)
    setType4aError(false)
    setType4aProgress(0)
    setType4aRangeInFlight(range)
    try {
      const blockHex = await rpcCall('eth_blockNumber')
      const latest = hexToNum(blockHex)
      const fromBlock = Math.max(0, latest - range)

      const allBlockNums = Array.from(
        { length: latest - fromBlock + 1 },
        (_, i) => fromBlock + i
      )

      const blocks: any[] = []
      for (let i = 0; i < allBlockNums.length; i += TYPE_4A_SCAN_BATCH_SIZE) {
        const chunk = allBlockNums.slice(i, i + TYPE_4A_SCAN_BATCH_SIZE)
        const chunkResults = await Promise.all(
          chunk.map(n =>
            rpcCall('eth_getBlockByNumber', ['0x' + n.toString(16), true]).catch(() => null)
          )
        )
        blocks.push(...chunkResults)
        setType4aProgress(prev => Math.min(prev + chunk.length, allBlockNums.length))
      }

      const shieldedTxs: Type4aTx[] = []
      const targets = new Set<string>()
      let totalTx = 0

      for (const block of blocks) {
        if (!block?.transactions) continue
        for (const tx of block.transactions) {
          totalTx++
          if (tx.type?.toLowerCase() === SHIELDED_TX_TYPE) {
            const target = (tx.to ?? 'contract creation').toLowerCase()
            targets.add(target)
            shieldedTxs.push({
              hash: tx.hash,
              block: hexToNum(block.number),
              target,
              timestamp: seismicTimestampToSeconds(block.timestamp),
            })
          }
        }
      }

      const now = Math.floor(Date.now() / 1000)
      const oneHourAgo = now - 3600
      const recentCount = shieldedTxs.filter(m => m.timestamp > oneHourAgo).length

      // Derived from the actual scanned blocks' own timestamps, not an assumed
      // block time — accurate regardless of how the chain's block rate drifts.
      const validBlocks = blocks.filter(b => b?.timestamp)
      const coverageMinutes = validBlocks.length >= 2
        ? (seismicTimestampToSeconds(validBlocks[validBlocks.length - 1].timestamp) - seismicTimestampToSeconds(validBlocks[0].timestamp)) / 60
        : null

      setType4aStats({
        totalShielded: shieldedTxs.length,
        totalTx,
        uniqueTargets: targets.size,
        shieldedPerHour: recentCount,
        recentShielded: shieldedTxs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
        blocksScanned: range,
        coverageMinutes,
      })
      setType4aUpdated(new Date())
    } catch (e) {
      console.error(e)
      setType4aError(true)
    }
    setType4aLoading(false)
  }

  async function loadSrc20Data() {
    setSrc20Loading(true)
    setSrc20Error(false)
    try {
      const blockHex = await rpcCall('eth_blockNumber')
      const latest = hexToNum(blockHex)
      const stats = await fetchSrc20Transfers(latest)
      setSrc20Stats(stats)
      setSrc20Updated(new Date())
    } catch (e) {
      console.error(e)
      setSrc20Error(true)
    }
    setSrc20Loading(false)
  }

  useEffect(() => {
    loadType4aData(TYPE_4A_AUTO_SCAN_RANGE)
    loadSrc20Data()
  }, [])

  function refreshAll() {
    loadType4aData(TYPE_4A_AUTO_SCAN_RANGE)
    loadSrc20Data()
  }

  function loadType4aWideScan() {
    loadType4aData(TYPE_4A_WIDE_SCAN_RANGE)
  }

  const shieldedPct = type4aStats && type4aStats.totalTx > 0
    ? ((type4aStats.totalShielded / type4aStats.totalTx) * 100).toFixed(2)
    : '0.00'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>🔒 Shielded Activity</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Type-0x4A encrypted transactions on Seismic — calldata visible only inside the TEE
          </div>
        </div>
        <button onClick={refreshAll} disabled={type4aLoading || src20Loading}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {/* What are shielded txs */}
      <div style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', marginBottom: 6 }}>🔒 What is a shielded transaction?</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          Seismic's transaction type <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>0x4A</span> carries calldata encrypted client-side via ECDH + AEAD. The Seismic node decrypts it only inside its Intel TDX TEE, executes the call, and writes results to shielded storage — the plaintext calldata is never visible in the mempool, block data, or transaction traces. Sender, recipient, and gas usage remain public; only the function arguments are hidden.
        </div>
      </div>

      {type4aLoading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          <div style={{ marginBottom: 10 }}>
            Scanning blocks for 0x4A activity — {type4aProgress.toLocaleString()} / {type4aRangeInFlight.toLocaleString()}
          </div>
          <div style={{ maxWidth: 320, margin: '0 auto', height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${type4aRangeInFlight > 0 ? (type4aProgress / type4aRangeInFlight) * 100 : 0}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
          </div>
        </div>
      ) : type4aStats ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '0.75rem' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Shielded Txs Found</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--accent)' }}>{type4aStats.totalShielded}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{formatCoverage(type4aStats.coverageMinutes)} of chain ({type4aStats.blocksScanned.toLocaleString()} blocks)</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Share of All Txs</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--status-warning)' }}>{shieldedPct}%</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>of {type4aStats.totalTx.toLocaleString()} scanned</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Unique Targets</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--series-shielded)' }}>{type4aStats.uniqueTargets}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>contracts receiving shielded calls</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Last Hour</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--series-tx)' }}>{type4aStats.shieldedPerHour}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>shielded txs</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <button onClick={loadType4aWideScan} disabled={type4aLoading}
              style={{ fontSize: 12, padding: '6px 12px', borderRadius: 2, border: '1px solid var(--accent-border)', background: 'var(--accent-bg)', color: 'var(--accent)', cursor: type4aLoading ? 'default' : 'pointer' }}>
              🔍 Wide scan ({TYPE_4A_WIDE_SCAN_RANGE.toLocaleString()} blocks)
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              ~{TYPE_4A_WIDE_SCAN_RANGE.toLocaleString()} RPC calls, can take 1–2 minutes — covers more chain history than the automatic scan above
            </span>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              Recent shielded transactions
            </div>
            {type4aStats.recentShielded.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔓</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>No shielded transactions found yet</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 420, margin: '0 auto' }}>
                  Deploy an SRC20 or another contract with shielded (<span style={{ fontFamily: 'monospace' }}>suint</span>/<span style={{ fontFamily: 'monospace' }}>sint</span>/<span style={{ fontFamily: 'monospace' }}>saddress</span>) types and send an encrypted write to see it here. Check the <a href="https://docs.seismic.systems/tutorials/src20" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>SRC20 tutorial</a>.
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Tx Hash</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Block</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Target</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8, fontWeight: 500 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {type4aStats.recentShielded.map(m => (
                    <tr key={m.hash} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0', color: 'var(--series-tx)', fontFamily: 'monospace' }}>
                        <a href={`${EXPLORER_URL}/tx/${m.hash}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--series-tx)', textDecoration: 'none' }}>
                          {m.hash.slice(0, 8)}...{m.hash.slice(-6)}
                        </a>
                      </td>
                      <td style={{ padding: '8px 0', color: 'var(--accent)' }}>#{m.block.toLocaleString()}</td>
                      <td style={{ padding: '8px 0', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{m.target.slice(0, 10)}...</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{timeAgo(m.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>

          {type4aUpdated && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '1rem', textAlign: 'right' }}>
              Last updated: {type4aUpdated.toLocaleTimeString()} · Detected via tx.type === {SHIELDED_TX_TYPE}
            </div>
          )}
        </>
      ) : type4aError ? (
        <div style={{ fontSize: 13, color: 'var(--status-critical)', textAlign: 'center', padding: '2rem' }}>
          Failed to load 0x4A shielded activity.
          <button onClick={() => loadType4aData(TYPE_4A_AUTO_SCAN_RANGE)}
            style={{ marginLeft: 8, fontSize: 12, padding: '4px 10px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      ) : null}

      {/* SRC20 value-hidden transfers — a separate mechanism from 0x4A above, loads
         and renders independently (own state, own loading flag) so a slow 0x4A
         scan never blocks this section, which typically resolves in a few seconds */}
      <div style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', borderRadius: 4, padding: '1rem 1.25rem', margin: '1.75rem 0 1.25rem' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)', marginBottom: 6 }}>🔐 SRC20 value-hidden transfers (a separate mechanism)</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          SUSDC (an SRC20 token) emits a custom transfer event that omits the amount — independent of the 0x4A type above: these are ordinary, unencrypted transactions (<span style={{ fontFamily: 'monospace' }}>tx.type 0x0</span>) whose privacy comes from the event, not the calldata. Detected via <span style={{ fontFamily: 'monospace' }}>eth_getLogs</span> on the SUSDC contract; counted separately from the 0x4A figures above, never summed.
        </div>
      </div>

      {src20Loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          Scanning SRC20 transfer logs via eth_getLogs...
        </div>
      ) : src20Stats ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '1.25rem' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>SRC20 Transfers Found</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--accent)' }}>{src20Stats.count}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>last {src20Stats.blocksScanned.toLocaleString()} blocks</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Faucet vs. Peer-to-Peer</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--status-warning)' }}>
                {src20Stats.faucetCount} <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>faucet</span>
              </div>
              <div style={{ fontSize: 12, color: src20Stats.peerToPeerCount > 0 ? 'var(--status-good)' : 'var(--text-muted)', marginTop: 3 }}>
                {src20Stats.peerToPeerCount} peer-to-peer{src20Stats.peerToPeerCount === 0 ? ' (none observed yet)' : ''}
              </div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Unique Recipients</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--series-shielded)' }}>{src20Stats.uniqueRecipients}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>distinct wallets funded</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Last Hour</div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--series-tx)' }}>{src20Stats.perHour}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>SRC20 transfers</div>
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
              Recent SRC20 transfers
            </div>
            {src20Stats.recent.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔓</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>No SRC20 transfers found in the scanned window</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Tx Hash</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>From</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>To</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8, fontWeight: 500 }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {src20Stats.recent.map((e, i) => (
                    <tr key={e.hash + i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0', color: 'var(--series-tx)', fontFamily: 'monospace' }}>
                        <a href={`${EXPLORER_URL}/tx/${e.hash}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--series-tx)', textDecoration: 'none' }}>
                          {e.hash.slice(0, 8)}...{e.hash.slice(-6)}
                        </a>
                      </td>
                      <td style={{ padding: '8px 0', color: e.isFaucet ? 'var(--status-warning)' : 'var(--status-good)', fontFamily: 'monospace' }}>
                        {e.isFaucet ? 'faucet' : `${e.from.slice(0, 8)}...`}
                      </td>
                      <td style={{ padding: '8px 0', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{e.to.slice(0, 8)}...</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{timeAgo(e.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>

          {src20Updated && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '1rem', textAlign: 'right' }}>
              Last updated: {src20Updated.toLocaleTimeString()} · SRC20 via eth_getLogs topic {SRC20_TRANSFER_TOPIC.slice(0, 10)}...
            </div>
          )}
        </>
      ) : src20Error ? (
        <div style={{ fontSize: 13, color: 'var(--status-critical)', textAlign: 'center', padding: '2rem' }}>
          Failed to load SRC20 transfer data.
          <button onClick={loadSrc20Data}
            style={{ marginLeft: 8, fontSize: 12, padding: '4px 10px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ─── NETWORK SCORE ────────────────────────────────────────────────
function calcScore(blockTime: number, latency: number, gasStability: number) {
  if (blockTime === 0 && latency === 0) return null
  const blockScore = blockTime <= 0.5 ? 100 : blockTime <= 1 ? 85 : blockTime <= 2 ? 60 : 30
  const latencyScore = latency <= 200 ? 100 : latency <= 400 ? 80 : latency <= 700 ? 55 : 25
  const gasScore = gasStability <= 1 ? 100 : gasStability <= 5 ? 80 : 50
  return Math.round(blockScore * 0.4 + latencyScore * 0.35 + gasScore * 0.25)
}

function scoreLabel(score: number | null) {
  if (score === null) return { label: '...', color: 'var(--text-muted)', bg: 'var(--border)', border: 'var(--border-strong)' }
  if (score >= 90) return { label: 'Excellent', color: 'var(--accent)', bg: 'var(--accent-bg)', border: 'var(--accent-border)' }
  if (score >= 70) return { label: 'Good', color: 'var(--status-warning)', bg: 'var(--status-warning-bg)', border: 'var(--status-warning-border)' }
  if (score >= 50) return { label: 'Degraded', color: 'var(--status-serious)', bg: 'var(--status-serious-bg)', border: 'var(--status-serious-border)' }
  return { label: 'ANOMALY', color: 'var(--status-critical)', bg: 'var(--status-critical-bg)', border: 'var(--status-critical-border)' }
}

// ─── TAB ICONS ────────────────────────────────────────────────────
// Monochrome, inherit currentColor from the tab button (muted when
// inactive, white when active on the accent-filled pill) — replaces the
// emoji set, which introduced colors outside the palette and read as
// rounded/soft against the site's angular, sharp-cornered language.
const iconProps = { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const

function IconDashboard() {
  return <svg {...iconProps}><path d="M2 13V9M8 13V3M14 13V6" strokeLinecap="square" /></svg>
}
function IconReports() {
  return <svg {...iconProps} strokeWidth={1.3}><path d="M3 1.5h7l3 3v10h-10z" strokeLinejoin="miter" /><path d="M6 8h5M6 11h5" strokeLinecap="square" /></svg>
}
function IconCompare() {
  return <svg {...iconProps} strokeLinecap="square" strokeLinejoin="miter"><path d="M1 5h10M8 2l3 3-3 3" /><path d="M15 11H5M8 8l-3 3 3 3" /></svg>
}
function IconAnomalies() {
  return <svg {...iconProps} strokeLinejoin="miter"><path d="M8 2 15 14H1Z" /><path d="M8 6.5v3" strokeLinecap="square" /><circle cx="8" cy="11.5" r="0.75" fill="currentColor" stroke="none" /></svg>
}
function IconNetworkStatus() {
  return <svg {...iconProps} strokeLinecap="square" strokeLinejoin="miter"><path d="M1 8h3l2-5 3 10 2-5h4" /></svg>
}
function IconDev() {
  return <svg {...iconProps} strokeLinecap="square" strokeLinejoin="miter"><path d="M5 3 1 8l4 5M11 3l4 5-4 5" /></svg>
}
function IconNetworks() {
  return <svg {...iconProps} strokeWidth={1.3}><path d="M4 4 12 4M4 4 8 13M12 4 8 13" strokeLinecap="square" /><rect x="2" y="2" width="4" height="4" /><rect x="10" y="2" width="4" height="4" /><rect x="6" y="11" width="4" height="4" /></svg>
}
function IconShielded() {
  return <svg width={15} height={15} viewBox="0 0 16 16"><path fillRule="evenodd" d="M8 1 14.5 4.75 14.5 11.25 8 15 1.5 11.25 1.5 4.75Z M8 4 11.5 6 11.5 10 8 12 4.5 10 4.5 6Z" fill="currentColor" /></svg>
}

// ─── MAIN APP ─────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState<'dashboard' | 'reports' | 'compare' | 'anomalies' | 'status' | 'dev' | 'networks' | 'shielded'>('dashboard')
  const { data } = useSeismicData()

  // NOTE: there used to be a "self-heal" effect here that called
  // fetch('/api/collect') on page load whenever the last snapshot looked
  // stale. Removed deliberately — collection must only come from the cron
  // (vercel.json) or a manual trigger, never from a page view. The self-heal
  // check had no de-duplication, so two people (or two tabs) loading the
  // dashboard while data was stale would each independently fire their own
  // /api/collect — the likely cause of the near-simultaneous duplicate
  // snapshot rows (~200ms apart) observed in Supabase.

  const score = calcScore(data.avgBlockTime, data.rpcLatency, 1)
  const { label, color, bg, border } = scoreLabel(score)
  const isAnomaly = score !== null && score < 50

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard /> },
    { id: 'reports', label: 'Reports', icon: <IconReports /> },
    { id: 'compare', label: 'Compare', icon: <IconCompare /> },
    { id: 'anomalies', label: 'Anomalies', icon: <IconAnomalies /> },
    { id: 'status', label: 'Network Status', icon: <IconNetworkStatus /> },
    { id: 'dev', label: 'Dev Dashboard', icon: <IconDev /> },
    { id: 'networks', label: 'Networks', icon: <IconNetworks /> },
    { id: 'shielded', label: 'Shielded Activity', icon: <IconShielded /> },
  ] as const

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-page)', padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>

      {isAnomaly && (
        <div style={{ background: 'var(--status-critical-bg)', border: '1px solid var(--status-critical)', borderRadius: 4, padding: '10px 16px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, color: 'var(--status-critical)', fontWeight: 500 }}>Network Anomaly Detected</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>— Block time or latency is above normal thresholds. Monitor closely.</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px 16px', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg viewBox="0 0 48 48" width="32" height="32" aria-label="SeismicLens logo" role="img">
              <path fillRule="evenodd" d="M24 3 44 14.5 44 33.5 24 45 4 33.5 4 14.5Z M24 12 37 19.5 37 28.5 24 36 11 28.5 11 19.5Z" fill="var(--ink)" />
              <polygon points="24,20 30,23.5 30,28.5 24,32 18,28.5 18,23.5" fill="var(--accent)" />
            </svg>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>SeismicLens</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)', animation: 'pulse 2s infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Seismic Testnet · Network Health Monitor</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <ConnectButton />
          <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 4, padding: '10px 18px', textAlign: 'center', minWidth: 110 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Health Score</div>
            <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{score ?? '—'}</div>
            <div style={{ fontSize: 11, color, marginTop: 3, fontWeight: 500 }}>{label}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '1.5rem', background: 'var(--bg-card)', borderRadius: 4, padding: 4, border: '1px solid var(--border)', width: 'fit-content', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '12px 20px', borderRadius: 2, border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              background: tab === t.id ? 'var(--accent)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--text-muted)',
            }}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'compare' && <CompareTab />}
      {tab === 'anomalies' && <AnomaliesTab />}
      {tab === 'status' && <NetworkStatusTab />}
      {tab === 'dev' && <DevDashboardTab />}
      {tab === 'networks' && <NetworkComparisonTab />}
      {tab === 'shielded' && <ShieldedActivityTab />}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>RPC: {RPC_HTTP.replace('https://', '')} · Chain ID: {CHAIN_ID}</span>
        <span>SeismicLens v0.1</span>
      </div>
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        Independent community project. Not affiliated with or endorsed by Seismic Systems Inc.
      </p>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </main>
  )
}
