'use client'
import { useState, useEffect, useCallback } from 'react'

const RPC = 'https://rpc.testnet.arc.network'
const ARC_CHAIN_ID = '0x4CE252' // 5042002 in hex

async function rpcCall(method: string, params: unknown[] = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await res.json()
  return data.result
}

const hexToNum = (h: string) => parseInt(h, 16)

function timeAgo(ts: number) {
  const d = Math.floor(Date.now() / 1000) - ts
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

interface DevTx {
  hash: string
  block: number
  timestamp: number
  gasUsed: number
  gasCost: number
  type: string
  to: string
}

interface DevStats {
  txCount: number
  totalGasUSDC: number
  contractsDeployed: number
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
    // Check if already connected
    const eth = (window as any).ethereum
    if (!eth) return
    eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts.length > 0) {
        setAddress(accounts[0])
        setWalletType(detectWallet())
      }
    })
    // Listen for account changes
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

  if (error) {
    return (
      <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>
    )
  }

  if (address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ background: '#0d2b1f', border: '1px solid #1D9E75', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 6 }}>
          <WalletIcon type={walletType} />
          <span style={{ fontFamily: 'monospace' }}>{address.slice(0, 6)}...{address.slice(-4)}</span>
        </div>
        <button onClick={disconnect}
          style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid #1e1e2e', background: 'transparent', color: '#64748b', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
    )
  }

  return (
    <button onClick={connect} disabled={connecting}
      style={{ background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 500, cursor: connecting ? 'not-allowed' : 'pointer', opacity: connecting ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
      {connecting ? '⏳ Connecting...' : '🔗 Connect Wallet'}
    </button>
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
      const balance = (hexToNum(balHex) / 1e6).toFixed(4)

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

      const txs: DevTx[] = []
      let contractsDeployed = 0
      let totalGas = 0

      for (const block of blocks) {
        if (!block?.transactions) continue
        for (const tx of block.transactions) {
          if (tx.from?.toLowerCase() !== addr.toLowerCase()) continue
          const gasUsed = hexToNum(tx.gas ?? '0x0')
          const gasPrice = hexToNum(tx.gasPrice ?? '0x0') / 1e9
          const gasCost = (gasUsed * gasPrice) / 1e9
          totalGas += gasCost
          const isContract = !tx.to
          if (isContract) contractsDeployed++
          txs.push({
            hash: tx.hash,
            block: hexToNum(block.number),
            timestamp: hexToNum(block.timestamp),
            gasUsed,
            gasCost,
            type: isContract ? '📄 Contract Deploy' : '💸 Transfer',
            to: tx.to ?? 'Contract Creation',
          })
        }
      }

      setStats({
        txCount: txs.length,
        totalGasUSDC: totalGas,
        contractsDeployed,
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
        <div style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', marginBottom: 8 }}>No wallet detected</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
          Install <a href="https://metamask.io" target="_blank" rel="noopener noreferrer" style={{ color: '#1D9E75' }}>MetaMask</a> or <a href="https://rabby.io" target="_blank" rel="noopener noreferrer" style={{ color: '#1D9E75' }}>Rabby Wallet</a> to use this feature.
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#f1f5f9', marginBottom: 8 }}>Connect your wallet</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
          Connect your wallet to see your personal developer dashboard — transactions, contracts deployed, gas spent and more on Arc testnet.
        </div>
        <ConnectButton />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#f1f5f9' }}>Developer Dashboard</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, fontFamily: 'monospace' }}>{address}</div>
        </div>
        <button onClick={() => address && loadDevData(address)}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid #1e1e2e', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: '#475569', textAlign: 'center', padding: '3rem' }}>
          Scanning Arc testnet for your activity...
        </div>
      ) : stats ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '1.5rem' }}>
            <div style={{ background: '#13131a', border: '1px solid #1e1e2e', borderRadius: 12, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>USDC Balance</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#1D9E75' }}>{stats.balance}</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>USDC</div>
            </div>
            <div style={{ background: '#13131a', border: '1px solid #1e1e2e', borderRadius: 12, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Transactions</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#378ADD' }}>{stats.txCount}</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>last 500 blocks</div>
            </div>
            <div style={{ background: '#13131a', border: '1px solid #1e1e2e', borderRadius: 12, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Contracts Deployed</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#A78BFA' }}>{stats.contractsDeployed}</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>on Arc testnet</div>
            </div>
            <div style={{ background: '#13131a', border: '1px solid #1e1e2e', borderRadius: 12, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Gas Spent</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#EF9F27' }}>{stats.totalGasUSDC.toFixed(6)}</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>USDC total</div>
            </div>
          </div>

          <div style={{ background: '#13131a', border: '1px solid #1e1e2e', borderRadius: 12, padding: '1.25rem' }}>
            <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>Recent transactions</div>
            {stats.txs.length === 0 ? (
              <div style={{ fontSize: 13, color: '#475569', textAlign: 'center', padding: '2rem' }}>
                No transactions found in the last 500 blocks.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#475569', fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Hash</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Type</th>
                    <th style={{ textAlign: 'left', paddingBottom: 8, fontWeight: 500 }}>Age</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8, fontWeight: 500 }}>Gas (USDC)</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.txs.map(tx => (
                    <tr key={tx.hash} style={{ borderTop: '1px solid #1e1e2e' }}>
                      <td style={{ padding: '8px 0', color: '#378ADD', fontFamily: 'monospace' }}>
                        <a href={`https://testnet.arcscan.app/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#378ADD', textDecoration: 'none' }}>
                          {tx.hash.slice(0, 8)}...{tx.hash.slice(-6)}
                        </a>
                      </td>
                      <td style={{ padding: '8px 0', color: '#94a3b8' }}>{tx.type}</td>
                      <td style={{ padding: '8px 0', color: '#64748b' }}>{timeAgo(tx.timestamp)}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', color: '#EF9F27', fontFamily: 'monospace' }}>
                        {tx.gasCost.toFixed(8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: '2rem' }}>
          Failed to load data. Please try refreshing.
        </div>
      )}
    </div>
  )
}
