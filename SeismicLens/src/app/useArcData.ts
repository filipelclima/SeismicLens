'use client'
import { useState, useEffect, useCallback } from 'react'

const RPC = 'https://rpc.testnet.arc.network'

async function rpcCall(method: string, params: unknown[] = []) {
  const t0 = Date.now()
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const latency = Date.now() - t0
  const data = await res.json()
  return { result: data.result, latency }
}

const hexToNum = (h: string) => parseInt(h, 16)
const toGwei = (h: string) => (hexToNum(h) / 1e9).toFixed(2)

export interface Block {
  number: number
  timestamp: number
  txCount: number
  gasUsed: number
}

export interface NetworkData {
  latestBlock: number
  chainId: number
  gasPrice: string
  rpcLatency: number
  avgBlockTime: number
  blocks: Block[]
  status: 'loading' | 'live' | 'error'
  lastUpdated: Date | null
}

export function useArcData() {
  const [data, setData] = useState<NetworkData>({
    latestBlock: 0, chainId: 0, gasPrice: '0',
    rpcLatency: 0, avgBlockTime: 0, blocks: [],
    status: 'loading', lastUpdated: null,
  })

  const fetch = useCallback(async () => {
    try {
      const { result: blockHex, latency } = await rpcCall('eth_blockNumber')
      const latest = hexToNum(blockHex)
      const { result: chainHex } = await rpcCall('eth_chainId')
      const { result: gasHex } = await rpcCall('eth_gasPrice')

      const blockNums = Array.from({ length: 10 }, (_, i) => latest - 9 + i)
      const rawBlocks = await Promise.all(
        blockNums.map(n => rpcCall('eth_getBlockByNumber', ['0x' + n.toString(16), false]).then(r => r.result))
      )
      const valid = rawBlocks.filter(Boolean)

      const blocks: Block[] = valid.map(b => ({
        number: hexToNum(b.number),
        timestamp: hexToNum(b.timestamp),
        txCount: b.transactions?.length ?? 0,
        gasUsed: hexToNum(b.gasUsed ?? '0x0'),
      }))

      const times: number[] = []
      for (let i = 1; i < blocks.length; i++) {
        times.push(blocks[i].timestamp - blocks[i - 1].timestamp)
      }
      const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0

      setData({
        latestBlock: latest,
        chainId: hexToNum(chainHex),
        gasPrice: toGwei(gasHex),
        rpcLatency: latency,
        avgBlockTime: parseFloat(avg.toFixed(2)),
        blocks,
        status: 'live',
        lastUpdated: new Date(),
      })
    } catch {
      setData(d => ({ ...d, status: 'error' }))
    }
  }, [])

  useEffect(() => {
    fetch()
    const interval = setInterval(fetch, 30000)
    return () => clearInterval(interval)
  }, [fetch])

  return { data, refresh: fetch }
}
