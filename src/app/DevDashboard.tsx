'use client'
import { useState, useEffect, useCallback } from 'react'
import { RPC_HTTP, EXPLORER_URL, SHIELDED_TX_TYPE, NATIVE_CURRENCY, seismicTimestampToSeconds } from '@/lib/chain'

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
  // ts is fractional seconds (Seismic's timestamp has millisecond precision).
  const d = Math.floor(Date.now() / 1000 - ts)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

interface DevTx {
  hash: string
  block: number
  timestamp: number
  gasUsed: number | null // null when the receipt was unavailable — never
  gasCost: number | null // silently fall back to the tx's gas limit for this
  type: string
  shielded: boolean
  to: string
}

interface DevStats {
  txCount: number
  totalGasNative: number
  unknownGasCount: number
  contractsDeployed: number
  shieldedTxCount: number
  balance: string
  txs: DevTx[]
}

type WalletType = 'metamask' | 'rabby' | 'injected' | null

function detectWallet(): WalletType {
  if (typeof window === 'undefined' || !(window as any).ethereum) return null
  const eth = (window as any).ethereum
  if (eth.isRabby) return 'rabby'
  if (eth.isMetaMask) return 'metamask'
  return 'injected'
}

function WalletIcon({ type }: { type: WalletType }) {
  if (type === 'metamask') return <span>🦊</span>
  if (type === 'rabby') return <span>🐰</span>
  return <span>👛</span>
}

export function ConnectButton() {
  const [address, setAddress] = useState<string | null>(null)
  const [walletType, setWalletType] = useState<WalletType>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const eth = (window as any).ethereum
    if (!eth) return
    eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts.length > 0) {
        setAddress(accounts[0])
        setWalletType(detectWallet())
      }
    })
    eth.on('accountsChanged', (accounts: string[]) => {
      setAddress(accounts.length > 0 ? accounts[0] : null)
    })
  }, [])

  async function connect() {
    const eth = (window as any).ethereum
    if (!eth) {
      setError('No wallet detected. Install MetaMask or Rabby.')
      return
    }
    setConnecting(true)
    setError('')
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' })
      setAddress(accounts[0])
      setWalletType(detectWallet())
    } catch {
      setError('Connection rejected.')
    }
    setConnecting(false)
  }

  function disconnect() {
    setAddress(null)
    setWalletType(null)
  }

  if (address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)', borderRadius: 2, padding: '6px 12px', fontSize: 12, color: 'var(--series-shielded)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <WalletIcon type={walletType} />
          <span style={{ fontFamily: 'monospace' }}>{address.slice(0, 6)}...{address.slice(-4)}</span>
        </div>
        <button onClick={disconnect}
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button onClick={connect} disabled={connecting}
        style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 2, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: connecting ? 'not-allowed' : 'pointer', opacity: connecting ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
        {connecting ? '⏳ Connecting...' : '🔗 Connect Wallet'}
      </button>
      {/* Error renders alongside the button, not instead of it — a failed
          eth_requestAccounts (user rejected the popup, wallet locked, etc.)
          must never leave the header permanently stuck with no way to retry. */}
      {error && <div style={{ fontSize: 11, color: 'var(--status-critical)' }}>{error}</div>}
    </div>
  )
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null)

  useEffect(() => {
    const eth = (window as any).ethereum
    if (!eth) return
    eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts.length > 0) setAddress(accounts[0])
    })
    eth.on('accountsChanged', (accounts: string[]) => {
      setAddress(accounts.length > 0 ? accounts[0] : null)
    })
  }, [])

  return { address, isConnected: !!address }
}

export function DevDashboardTab() {
  const { address, isConnected } = useWallet()
  const [stats, setStats] = useState<DevStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [noWallet, setNoWallet] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as any).ethereum) {
      setNoWallet(true)
    }
  }, [])

  const loadDevData = useCallback(async (addr: string) => {
    setLoading(true)
    try {
      const balHex = await rpcCall('eth_getBalance', [addr, 'latest'])
      const balance = (hexToNum(balHex) / 1e18).toFixed(6)

      const latestHex = await rpcCall('eth_blockNumber')
      const latest = hexToNum(latestHex)
      const scanRange = 500
      const step = Math.floor(scanRange / 30)

      const blockNums = Array.from({ length: 30 }, (_, i) =>
        Math.max(0, latest - scanRange + i * step)
      )

      const blocks = await Promise.all(
        blockNums.map(n =>
          rpcCall('eth_getBlockByNumber', ['0x' + n.toString(16), true])
        )
      )

      const matched: { tx: any; block: any }[] = []
      for (const block of blocks) {
        if (!block?.transactions) continue
        for (const tx of block.transactions) {
          if (tx.from?.toLowerCase() !== addr.toLowerCase()) continue
          matched.push({ tx, block })
        }
      }

      const receipts = await Promise.all(
        matched.map(({ tx }) =>
          rpcCall('eth_getTransactionReceipt', [tx.hash]).catch(() => null)
        )
      )

      const txs: DevTx[] = []
      let contractsDeployed = 0
      let totalGas = 0
      let unknownGasCount = 0
      let shieldedTxCount = 0

      matched.forEach(({ tx, block }, i) => {
        const receipt = receipts[i]
        const gasUsedHex = receipt?.gasUsed
        const gasUsed = gasUsedHex !== undefined && gasUsedHex !== null ? hexToNum(gasUsedHex) : null
        const gasPrice = hexToNum(tx.gasPrice ?? '0x0') / 1e9
        const gasCost = gasUsed !== null ? (gasUsed * gasPrice) / 1e9 : null
        if (gasCost !== null) {
          totalGas += gasCost
        } else {
          unknownGasCount++
        }
        const isContract = !tx.to
        const shielded = tx.type?.toLowerCase() === SHIELDED_TX_TYPE
        if (isContract) contractsDeployed++
        if (shielded) shieldedTxCount++
        txs.push({
          hash: tx.hash,
          block: hexToNum(block.number),
          timestamp: seismicTimestampToSeconds(block.timestamp),
          gasUsed,
          gasCost,
          type: isContract ? '📄 Contract Deploy' : shielded ? '🔒 Shielded Tx' : '💸 Transfer',
          shielded,
          to: tx.to ?? 'Contract Creation',
        })
      })

      setStats({
        txCount: txs.length,
        totalGasNative: totalGas,
        unknownGasCount,
        contractsDeployed,
        shieldedTxCount,
        balance,
        txs: txs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 15),
      })
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isConnected && address) loadDevData(address)
  }, [address, isConnected, loadDevData])

  if (noWallet) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🦊</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>No wallet detected</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
          Install <a href="https://metamask.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--series-shielded)' }}>MetaMask</a> or <a href="https://rabby.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--series-shielded)' }}>Rabby Wallet</a> to use this feature.
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Connect your wallet</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
          Connect your wallet to see your personal developer dashboard — transactions, contracts deployed, gas spent and more on Seismic testnet.
        </div>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Developer Dashboard</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>{address}</div>
        </div>
        <button onClick={() => address && loadDevData(address)}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>
          Scanning Seismic testnet for your activity...
        </div>
      ) : stats ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{NATIVE_CURRENCY.symbol} Balance</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--accent)' }}>{stats.balance}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{NATIVE_CURRENCY.symbol}</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Transactions</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--series-tx)' }}>{stats.txCount}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>last 500 blocks</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Shielded Txs</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--status-warning)' }}>{stats.shieldedTxCount}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>type 0x4A</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Contracts Deployed</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--series-shielded)' }}>{stats.contractsDeployed}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>on Seismic testnet</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Gas Spent</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--series-gas)' }}>{stats.totalGasNative.toFixed(8)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                {NATIVE_CURRENCY.symbol} total{stats.unknownGasCount > 0 ? ` · ${stats.unknownGasCount} tx w/o receipt excluded` : ''}
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1.25rem' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>Recent transactions</div>
            {stats.txs.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
                No transactions found in the last 500 blocks.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Hash</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Type</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Age</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8, fontWeight: 500 }}>Gas ({NATIVE_CURRENCY.symbol})</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.txs.map(tx => (
                    <tr key={tx.hash} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0', color: 'var(--series-tx)', fontFamily: 'monospace' }}>
                        <a href={`${EXPLORER_URL}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--series-tx)', textDecoration: 'none' }}>
                          {tx.hash.slice(0, 8)}...{tx.hash.slice(-6)}
                        </a>
                      </td>
                      <td style={{ padding: '8px 0', color: tx.shielded ? 'var(--series-shielded)' : 'var(--text-secondary)' }}>{tx.type}</td>
                      <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>{timeAgo(tx.timestamp)}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', color: tx.gasCost !== null ? 'var(--series-gas)' : 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {tx.gasCost !== null ? tx.gasCost.toFixed(10) : 'no receipt'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--status-critical)', textAlign: 'center', padding: '2rem' }}>
          Failed to load data. Please try refreshing.
        </div>
      )}
    </div>
  )
}
