/**
 * GenLayer integration layer (genlayer-js).
 *
 * - READ client (no account): free `view` calls over RPC.
 * - WRITE client: created with the connected wallet address; genlayer-js
 *   delegates signing to the injected provider (MetaMask).
 */
import { createClient } from 'genlayer-js'
import { localnet, studionet, testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus, type TransactionHash } from 'genlayer-js/types'
import type { DomainInfo, MarketStats, NegotiationEntry } from './types'

export type { TransactionHash }

const CHAINS = {
  localnet,
  studionet,
  bradbury: testnetBradbury,
} as const

export type NetworkName = keyof typeof CHAINS

const network = (import.meta.env.VITE_GENLAYER_NETWORK ?? 'bradbury') as NetworkName
export const NETWORK_NAME: string = network
export const CHAIN = CHAINS[network] ?? testnetBradbury
export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ??
  '') as `0x${string}`

export type GenLayerClient = ReturnType<typeof createClient>

export function createReadClient(): GenLayerClient {
  return createClient({ chain: CHAIN })
}

export function createWalletClient(address: string): GenLayerClient {
  return createClient({
    chain: CHAIN,
    account: address as `0x${string}`,
  })
}

/**
 * GenLayer calldata dicts may decode as `Map` and integers as `bigint`;
 * normalize them to plain objects / numbers / strings.
 */
function toPlain(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {}
    for (const [k, v] of value.entries()) obj[String(k)] = toPlain(v)
    return obj
  }
  if (Array.isArray(value)) return value.map(toPlain)
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
  }
  return value
}

// ----------------------------------------------------------------
// Reads (view): free, unsigned
// ----------------------------------------------------------------

export async function fetchDomains(client: GenLayerClient): Promise<DomainInfo[]> {
  const all: DomainInfo[] = []
  for (let start = 0; ; start += 50) {
    const raw = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_domains',
      args: [start],
    })
    const page = (toPlain(raw) as Record<string, unknown>[]).map(normalizeDomain)
    all.push(...page)
    if (page.length < 50) break
  }
  return all
}

export async function fetchStats(client: GenLayerClient): Promise<MarketStats> {
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_stats',
    args: [],
  })
  return toPlain(raw) as MarketStats
}

export async function fetchNegotiations(
  client: GenLayerClient,
  domain: string,
): Promise<NegotiationEntry[]> {
  const all: NegotiationEntry[] = []
  for (let start = 0; ; start += 50) {
    const raw = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: 'get_negotiations',
      args: [domain, start],
    })
    const page = toPlain(raw) as string[]
    all.push(...page.map((s) => JSON.parse(s) as NegotiationEntry))
    if (page.length < 50) break
  }
  return all
}

function normalizeDomain(raw: Record<string, unknown>): DomainInfo {
  return {
    name: String(raw.name ?? ''),
    owner: String(raw.owner ?? ''),
    ask: String(raw.ask ?? '0'),
    description: String(raw.description ?? ''),
    status: (raw.status as DomainInfo['status']) ?? 'OPEN',
    counter: String(raw.counter ?? '0'),
    sold_price: String(raw.sold_price ?? '0'),
    bids: Number(raw.bids ?? 0),
  }
}

// ----------------------------------------------------------------
// Writes: signed by the wallet, decided by validator consensus
// ----------------------------------------------------------------

export async function sendRegisterDomain(
  client: GenLayerClient,
  name: string,
  askingGen: string,
  secretFloorGen: string,
  description: string,
): Promise<TransactionHash> {
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'register_domain',
    args: [name, askingGen, secretFloorGen, description],
    value: 0n,
  })
  return hash as TransactionHash
}

export async function sendBid(
  client: GenLayerClient,
  name: string,
  pitch: string,
  bidWei: bigint,
): Promise<TransactionHash> {
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'place_bid',
    args: [name, pitch],
    value: bidWei,
  })
  return hash as TransactionHash
}

export async function sendDelist(
  client: GenLayerClient,
  name: string,
): Promise<TransactionHash> {
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: 'delist_domain',
    args: [name],
    value: 0n,
  })
  return hash as TransactionHash
}

/**
 * Wait for a transaction receipt at the requested lifecycle status.
 * ACCEPTED  -> optimistic consensus reached (UI can refresh).
 * FINALIZED -> appeal window closed, irreversible.
 *
 * genlayer-js defaults (3s x 10 = 30s) are far too short: an AI negotiation
 * runs an on-chain LLM + validator consensus and can take minutes.
 */
export async function waitForTx(
  client: GenLayerClient,
  hash: TransactionHash,
  status: 'ACCEPTED' | 'FINALIZED',
  opts: { interval?: number; retries?: number } = {},
): Promise<unknown> {
  const accepted = status === 'ACCEPTED'
  return client.waitForTransactionReceipt({
    hash,
    status: accepted ? TransactionStatus.ACCEPTED : TransactionStatus.FINALIZED,
    interval: opts.interval ?? (accepted ? 5000 : 8000),
    retries: opts.retries ?? (accepted ? 48 : 75),
  })
}

/**
 * Retry a read when the RPC rate-limits (429). Short exponential backoff.
 */
export async function withRpcRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      const rateLimited = /rate limit|429|exceeds defined limit|too many requests/i.test(msg)
      if (!rateLimited || i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 1200 * 2 ** i))
    }
  }
  throw lastErr
}
