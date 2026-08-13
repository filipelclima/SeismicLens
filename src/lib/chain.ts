// Seismic public testnet — https://docs.seismic.systems/clients/typescript/react/chains/seismic-testnet
export const RPC_HTTP = 'https://testnet-1.seismictest.net/rpc'
export const RPC_WSS = 'wss://testnet-1.seismictest.net/ws'
export const CHAIN_ID = 5124
export const EXPLORER_URL = 'https://seismic-testnet.socialscan.io'
export const NATIVE_CURRENCY = { name: 'Ether', symbol: 'ETH', decimals: 18 }

// Seismic's shielded transaction type — encrypted calldata (type 0x4A), decrypted
// only inside the TEE. See https://docs.seismic.systems/overview/how-seismic-works
export const SHIELDED_TX_TYPE = '0x4a'

// SUSDC (Shielded USD Coin) — an SRC20 token whose Transfer-equivalent event hides
// the transferred amount. This is a SEPARATE, independent privacy mechanism from
// SHIELDED_TX_TYPE above: 0x4A hides the CALL (encrypted calldata on an otherwise
// ordinary-looking tx envelope); this event hides the VALUE (a normal tx.type 0x0
// call whose emitted event omits the amount). A transaction can use either, both,
// or neither — do not sum counts from the two mechanisms into one number.
// Verified live: eth_getLogs across a 2,000,000-block window found this topic
// emitted exclusively by this contract (2,084/2,084 matching logs, single emitter).
export const SUSDC_CONTRACT = '0x790701048922e265105fd6a4467a2901c2201c43'
export const SRC20_TRANSFER_TOPIC = '0x80ffa007a69623ef13594f5e8178eee6c4ef2d0cba74c08329e879f695b7d3f6'

// The known SUSDC faucet dispenser — every SRC20 transfer observed so far (2,000+
// events, 400+ recipients) originates from this single address. Used to split
// "faucet disbursement" from "peer-to-peer transfer" in the UI so the metric can't
// be misread as adoption — see CLAUDE.md's SRC20 detection note for why.
export const SUSDC_FAUCET_DISPENSER = '0x6ea5ddb328efcf6f84a7753d52ca80d9aa29a97c'

// Hard RPC-enforced ceiling for a single eth_getLogs call on this node — confirmed
// by probing (100,001+ block ranges return "query exceeds max block range 100000").
export const GET_LOGS_MAX_RANGE = 100_000

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
