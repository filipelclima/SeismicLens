// Seismic public testnet — https://docs.seismic.systems/clients/typescript/react/chains/seismic-testnet
export const RPC_HTTP = 'https://testnet-1.seismictest.net/rpc'
export const RPC_WSS = 'wss://testnet-1.seismictest.net/ws'
export const CHAIN_ID = 5124
export const EXPLORER_URL = 'https://seismic-testnet.socialscan.io'
export const NATIVE_CURRENCY = { name: 'Ether', symbol: 'ETH', decimals: 18 }

// Seismic's shielded transaction type — encrypted calldata (type 0x4A), decrypted
// only inside the TEE. See https://docs.seismic.systems/overview/how-seismic-works
export const SHIELDED_TX_TYPE = '0x4a'

// IMPORTANT: unlike standard Ethereum JSON-RPC (integer seconds), Seismic's
// eth_getBlockByNumber returns `timestamp` in MILLISECONDS since epoch — makes
// sense for a sub-second-block chain, where second-granularity would be
// useless, but it silently breaks any code written against the Ethereum
// convention (confirmed by comparing a live block's timestamp against
// Date.now(); treating it as seconds put the block ~58,000 years in the
// future). Every place in this app that reads a Seismic block's timestamp
// must go through this helper — do not call parseInt(block.timestamp, 16)
// directly. Other chains queried for comparison (Ethereum, Polygon, etc. in
// the Networks tab) still use standard integer seconds and must NOT use this.
export const seismicTimestampToSeconds = (hex: string) => parseInt(hex, 16) / 1000
