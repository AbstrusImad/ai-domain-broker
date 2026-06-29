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
import { toAtto } from './format'

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

// ----------------------------------------------------------------
// Live transaction polling (gen_getTransactionByHash)
//
// Unlike gen_call, this RPC does NOT execute the GenVM, so it escapes the
// aggressive gen_call rate limit. Bonus: while consensus is still running,
// the leader's nondet output is already visible at
// consensus_data.leader_receipt[0].eq_outputs["0"] (base64). Decoding it and
// walking back to the JSON object reveals ARIA's draft verdict BEFORE the
// transaction reaches ACCEPTED.
// ----------------------------------------------------------------

export interface LeaderDraft {
  decision: 'ACCEPT' | 'REJECT' | 'COUNTER_OFFER'
  counterAtto: string
  note: string
}

// LEADER_TIMEOUT / VALIDATORS_TIMEOUT are NOT terminal on Bradbury: the
// consensus engine rotates to a new leader and retries the transaction
// (observed live: a bid went LEADER_TIMEOUT → rotation → ACCEPTED with the
// verdict on-chain). Keep polling through them.
const TERMINAL_STATUSES = new Set(['ACCEPTED', 'FINALIZED', 'UNDETERMINED', 'CANCELED'])

const STATUS_BY_CODE: Record<number, string> = {
  0: 'UNINITIALIZED',
  1: 'PENDING',
  2: 'PROPOSING',
  3: 'COMMITTING',
  4: 'REVEALING',
  5: 'ACCEPTED',
  6: 'UNDETERMINED',
  7: 'FINALIZED',
  8: 'CANCELED',
  9: 'APPEAL_REVEALING',
  10: 'APPEAL_COMMITTING',
  11: 'READY_TO_FINALIZE',
  12: 'VALIDATORS_TIMEOUT',
  13: 'LEADER_TIMEOUT',
}

/** Tolerant property access: genlayer-js decodes some dicts as Map. */
function mGet(o: unknown, key: string): unknown {
  if (o instanceof Map) return o.get(key)
  if (o && typeof o === 'object') return (o as Record<string, unknown>)[key]
  return undefined
}

function statusName(raw: unknown): string {
  if (typeof raw === 'number') return STATUS_BY_CODE[raw] ?? String(raw)
  const s = String(raw ?? '').toUpperCase()
  if (/^\d+$/.test(s)) return STATUS_BY_CODE[Number(s)] ?? s
  return s
}

function b64ToString(b64: string): string {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
}

/** The decoded calldata wraps the JSON — walk back to the last '{' and parse. */
function scanJsonObject(text: string): Record<string, unknown> | null {
  for (let i = text.lastIndexOf('{'); i >= 0; i = text.lastIndexOf('{', i - 1)) {
    for (let j = text.indexOf('}', i); j !== -1; j = text.indexOf('}', j + 1)) {
      try {
        const obj = JSON.parse(text.slice(i, j + 1)) as Record<string, unknown>
        if (obj && typeof obj === 'object' && obj.decision != null) return obj
      } catch {
        /* keep scanning */
      }
    }
  }
  return null
}

/** Extract ARIA's draft verdict from the leader receipt of an in-flight tx. */
export function extractLeaderDraft(tx: unknown): LeaderDraft | null {
  try {
    const cd = mGet(tx, 'consensus_data')
    let lr = mGet(cd, 'leader_receipt')
    if (Array.isArray(lr)) lr = lr[0]
    const eq = mGet(lr, 'eq_outputs')
    let candidates: unknown[] = []
    if (eq instanceof Map) candidates = [...eq.values()]
    else if (eq && typeof eq === 'object') candidates = Object.values(eq)
    for (const c of candidates) {
      if (typeof c !== 'string' || !c) continue
      const obj = scanJsonObject(b64ToString(c))
      if (!obj) continue
      const decision = String(obj.decision ?? '')
        .toUpperCase()
        .replace(/\s+/g, '_')
      if (!['ACCEPT', 'REJECT', 'COUNTER_OFFER'].includes(decision)) continue
      let counterAtto = '0'
      if (obj.counter_atto != null) counterAtto = String(obj.counter_atto)
      else if (obj.counter_price_gen != null) {
        counterAtto = toAtto(String(obj.counter_price_gen)).toString()
      }
      const note = String(obj.note ?? obj.justification ?? '').trim()
      return { decision: decision as LeaderDraft['decision'], counterAtto, note }
    }
  } catch {
    /* tolerate any receipt shape */
  }
  return null
}

/**
 * Poll gen_getTransactionByHash until the tx reaches a terminal status.
 * Reports the live status and the leader's draft verdict as soon as it
 * appears, long before ACCEPTED.
 *
 * Hardened so the UI can never hang forever: a terminal status is detected
 * from the status name OR the raw numeric code, and if a `confirmVerdict`
 * probe reports the verdict is already written to the on-chain chronicle, the
 * poll resolves as ACCEPTED even when the receipt shape is unfamiliar (e.g.
 * after a genlayer-js version bump). Every RPC error is swallowed and retried,
 * never thrown, so a transient hiccup cannot break the loop.
 */
export async function pollTransactionUntilDecided(
  client: GenLayerClient,
  hash: TransactionHash,
  opts: {
    interval?: number
    maxTries?: number
    onUpdate?: (status: string, draft: LeaderDraft | null) => void
    confirmVerdict?: () => Promise<boolean>
  } = {},
): Promise<{ status: string; draft: LeaderDraft | null }> {
  const interval = opts.interval ?? 8000
  const maxTries = opts.maxTries ?? 110
  let draft: LeaderDraft | null = null
  let status = 'PENDING'
  for (let i = 0; i < maxTries; i++) {
    try {
      const tx = (await client.getTransaction({ hash })) as unknown
      if (tx) {
        const rawStatus = mGet(tx, 'status')
        status = statusName(rawStatus)
        if (!draft) draft = extractLeaderDraft(tx)
        opts.onUpdate?.(status, draft)
        // Terminal by name, or by raw numeric code (5/6/7/8) in case the
        // status name map ever drifts from the runtime enum.
        const code = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus)
        if (TERMINAL_STATUSES.has(status) || code === 5 || code === 6 || code === 7 || code === 8) {
          return { status, draft }
        }
      }
    } catch {
      /* transient RPC hiccup, keep polling */
    }
    // Independent ground truth: if the verdict is already on-chain (the
    // chronicle grew), the negotiation is decided regardless of receipt shape.
    if (opts.confirmVerdict && i >= 1) {
      try {
        if (await opts.confirmVerdict()) {
          return { status: status === 'PENDING' ? 'ACCEPTED' : status, draft }
        }
      } catch {
        /* probe failed (rate limit), keep polling the receipt */
      }
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  return { status, draft }
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
      // gen_call limits on Bradbury reset per-minute: back off generously.
      await new Promise((r) => setTimeout(r, 2500 * 2 ** i))
    }
  }
  throw lastErr
}
