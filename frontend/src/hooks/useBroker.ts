import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createReadClient,
  createWalletClient,
  fetchDomains,
  fetchNegotiations,
  fetchStats,
  sendBid,
  sendDelist,
  sendRegisterDomain,
  waitForTx,
  withRpcRetry,
  type TransactionHash,
} from '../lib/genlayer'
import type {
  DomainInfo,
  MarketStats,
  NegotiationEntry,
  NegotiationPhase,
} from '../lib/types'
import { isSameAddr } from '../lib/format'

// gen_call executes the contract in the GenVM and Bradbury rate-limits it
// aggressively — poll slowly and pause entirely while a tx is in flight.
const POLL_MS = 90_000

export interface NegotiationState {
  phase: NegotiationPhase
  txHash: TransactionHash | null
  verdict: NegotiationEntry | null
  error: string | null
}

const IDLE: NegotiationState = { phase: 'idle', txHash: null, verdict: null, error: null }

/**
 * Single source of truth for marketplace data + the negotiation state machine.
 */
export function useBroker(walletAddress: string | null) {
  const readClient = useMemo(() => createReadClient(), [])
  const [domains, setDomains] = useState<DomainInfo[]>([])
  const [stats, setStats] = useState<MarketStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [negotiation, setNegotiation] = useState<NegotiationState>(IDLE)
  const [listingState, setListingState] = useState<NegotiationState>(IDLE)
  const aliveRef = useRef(true)
  const negotiationRef = useRef<NegotiationState>(IDLE)
  negotiationRef.current = negotiation

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Domains list is the single periodic read; market stats are derived
  // client-side from it (saves a gen_call per poll). The negotiations
  // counter comes from get_stats, fetched only on load and after events.
  const refresh = useCallback(async () => {
    try {
      const d = await withRpcRetry(() => fetchDomains(readClient))
      if (!aliveRef.current) return
      setDomains(d.reverse()) // newest listings first
      setLoadError(null)
    } catch (e) {
      if (!aliveRef.current) return
      setLoadError(e instanceof Error ? e.message : 'Could not reach the network.')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [readClient])

  const refreshStats = useCallback(async () => {
    try {
      const s = await withRpcRetry(() => fetchStats(readClient))
      if (aliveRef.current) setStats(s)
    } catch {
      /* cosmetic — derived stats still render */
    }
  }, [readClient])

  // Initial load + slow poll (paused while a negotiation tx is in flight:
  // the receipt polling already consumes the RPC budget)
  useEffect(() => {
    void refresh()
    void refreshStats()
    const id = window.setInterval(() => {
      const phase = negotiationRef.current.phase
      if (phase === 'wallet' || phase === 'submitted' || phase === 'consensus') return
      void refresh()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh, refreshStats])

  // Derived stats: always consistent with the visible list
  const derivedStats: MarketStats | null = useMemo(() => {
    if (domains.length === 0) return stats
    let open = 0
    let sold = 0
    let volume = 0n
    for (const d of domains) {
      if (d.status === 'OPEN') open++
      if (d.status === 'SOLD') {
        sold++
        try {
          volume += BigInt(d.sold_price || '0')
        } catch {
          /* ignore */
        }
      }
    }
    return {
      domains: domains.length,
      open,
      sold,
      volume: volume.toString(),
      negotiations: stats?.negotiations ?? 0,
    }
  }, [domains, stats])

  // ----------------------------------------------------------------
  // Negotiation state machine (place_bid)
  // ----------------------------------------------------------------

  const placeBid = useCallback(
    async (domain: string, pitch: string, bidWei: bigint) => {
      if (!walletAddress) return
      setNegotiation({ phase: 'wallet', txHash: null, verdict: null, error: null })
      let hash: TransactionHash | null = null
      try {
        const client = createWalletClient(walletAddress)
        hash = await sendBid(client, domain, pitch, bidWei)
        setNegotiation({ phase: 'submitted', txHash: hash, verdict: null, error: null })

        // Give the leader a beat, then mark the consensus stage for the UI.
        window.setTimeout(() => {
          setNegotiation((s) =>
            s.phase === 'submitted' ? { ...s, phase: 'consensus' } : s,
          )
        }, 4000)

        // LLM + consensus + possible leader rotations: allow up to ~15 min.
        await waitForTx(client, hash, 'ACCEPTED', { interval: 9000, retries: 100 })

        // The verdict lives in the on-chain chronicle. Entries are
        // append-only, so the newest entry by this wallet is ours.
        let verdict: NegotiationEntry | null = null
        for (let attempt = 0; attempt < 8 && !verdict; attempt++) {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 5000))
          const after = await withRpcRetry(() => fetchNegotiations(readClient, domain), 2)
          verdict =
            [...after].reverse().find((e) => isSameAddr(e.bidder, walletAddress)) ?? null
        }

        if (!aliveRef.current) return
        if (!verdict) {
          setNegotiation({
            phase: 'error',
            txHash: hash,
            verdict: null,
            error:
              'The transaction was accepted but the verdict could not be read yet (RPC busy). Close this panel and reopen the negotiation in a minute — your verdict is on-chain.',
          })
          return
        }
        setNegotiation({ phase: 'verdict', txHash: hash, verdict, error: null })
        void refresh()
        void refreshStats()
      } catch (e) {
        if (!aliveRef.current) return
        const raw = e instanceof Error ? e.message : 'The negotiation failed.'
        const timedOut = /status is not ACCEPTED|not FINALIZED/i.test(raw)
        const rateLimited = /rate limit|429/i.test(raw)
        setNegotiation({
          phase: 'error',
          txHash: hash,
          verdict: null,
          error: timedOut
            ? 'The network is congested (leader timeout) and the verdict is still pending. Your escrowed GEN is safe: if the negotiation fails, nothing leaves your wallet. Reopen this negotiation later to see the result.'
            : rateLimited
              ? 'The RPC rate-limited us while waiting. Your bid is in flight and your GEN is safe — reopen this negotiation in a few minutes to see the verdict.'
              : raw,
        })
      }
    },
    [walletAddress, readClient, refresh, refreshStats],
  )

  const resetNegotiation = useCallback(() => setNegotiation(IDLE), [])

  // ----------------------------------------------------------------
  // Listing state machine (register_domain / delist)
  // ----------------------------------------------------------------

  const registerDomain = useCallback(
    async (name: string, askGen: string, floorGen: string, description: string) => {
      if (!walletAddress) return false
      setListingState({ phase: 'wallet', txHash: null, verdict: null, error: null })
      try {
        const client = createWalletClient(walletAddress)
        const hash = await sendRegisterDomain(client, name, askGen, floorGen, description)
        setListingState({ phase: 'consensus', txHash: hash, verdict: null, error: null })
        await waitForTx(client, hash, 'ACCEPTED', { interval: 9000, retries: 80 })
        if (!aliveRef.current) return false
        setListingState({ phase: 'verdict', txHash: hash, verdict: null, error: null })
        void refresh()
        void refreshStats()
        return true
      } catch (e) {
        if (!aliveRef.current) return false
        setListingState({
          phase: 'error',
          txHash: null,
          verdict: null,
          error: e instanceof Error ? e.message : 'The listing failed.',
        })
        return false
      }
    },
    [walletAddress, refresh, refreshStats],
  )

  const delistDomain = useCallback(
    async (name: string) => {
      if (!walletAddress) return
      const client = createWalletClient(walletAddress)
      const hash = await sendDelist(client, name)
      await waitForTx(client, hash, 'ACCEPTED')
      void refresh()
    },
    [walletAddress, refresh],
  )

  const resetListing = useCallback(() => setListingState(IDLE), [])

  const fetchDomainNegotiations = useCallback(
    (domain: string) => withRpcRetry(() => fetchNegotiations(readClient, domain), 2),
    [readClient],
  )

  return {
    domains,
    stats: derivedStats,
    loading,
    loadError,
    refresh,
    negotiation,
    placeBid,
    resetNegotiation,
    listingState,
    registerDomain,
    resetListing,
    delistDomain,
    fetchDomainNegotiations,
  }
}
