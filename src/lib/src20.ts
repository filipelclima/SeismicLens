// Shared logic for reading SUSDC's SRC20 transfer event — used by both the
// client-side Shielded Activity tab (src/app/page.tsx) and the server-side
// collector (src/app/api/collect/route.ts). Neither should reimplement this;
// see CLAUDE.md's SRC20 double-emission note for why.
import { SUSDC_FAUCET_DISPENSER, seismicTimestampToSeconds } from './chain'

export interface Src20LogEvent {
  hash: string
  block: number
  from: string
  to: string
  timestamp: number
  isFaucet: boolean
}

// SUSDC emits its transfer event TWICE per real transfer — confirmed across
// every transaction observed (2,146 logs / 1,073 txs, 100% in pairs): the two
// logs are byte-identical (same address, topics, data), differing only in
// logIndex. Not two real events — dedupe by transactionHash before counting,
// or every count is inflated 2x.
export function dedupeSrc20Logs<T extends { transactionHash: string }>(logs: T[]): T[] {
  return Array.from(new Map(logs.map(log => [log.transactionHash, log])).values())
}

export function parseSrc20Log(log: any): Src20LogEvent {
  const from = '0x' + (log.topics?.[1] ?? '').slice(-40)
  const to = '0x' + (log.topics?.[2] ?? '').slice(-40)
  return {
    hash: log.transactionHash,
    block: parseInt(log.blockNumber, 16),
    from,
    to,
    timestamp: seismicTimestampToSeconds(log.blockTimestamp),
    isFaucet: from.toLowerCase() === SUSDC_FAUCET_DISPENSER,
  }
}
