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

const POLL_MS = 30_000

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

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        withRpcRetry(() => fetchDomains(readClient)),
        withRpcRetry(() => fetchStats(readClient)),
      ])
      if (!aliveRef.current) return
      setDomains(d.reverse()) // newest listings first
      setStats(s)
      setLoadError(null)
    } catch (e) {
      if (!aliveRef.current) return
      setLoadError(e instanceof Error ? e.message : 'Could not reach the network.')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [readClient])

  // Initial load + slow poll
  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  // ----------------------------------------------------------------
  // Negotiation state machine (place_bid)
  // ----------------------------------------------------------------

  const placeBid = useCallback(
    async (domain: string, pitch: string, bidWei: bigint) => {
      if (!walletAddress) return
      setNegotiation({ phase: 'wallet', txHash: null, verdict: null, error: null })
      try {
        const client = createWalletClient(walletAddress)
        const before = await withRpcRetry(() => fetchNegotiations(readClient, domain))
        const hash = await sendBid(client, domain, pitch, bidWei)
        setNegotiation({ phase: 'submitted', txHash: hash, verdict: null, error: null })

        // Give the leader a beat, then mark the consensus stage for the UI.
        window.setTimeout(() => {
          setNegotiation((s) =>
            s.phase === 'submitted' ? { ...s, phase: 'consensus' } : s,
          )
        }, 4000)

        await waitForTx(client, hash, 'ACCEPTED')

        // The verdict lives in the on-chain chronicle: fetch the new entry.
        let verdict: NegotiationEntry | null = null
        for (let attempt = 0; attempt < 6 && !verdict; attempt++) {
          const after = await withRpcRetry(() => fetchNegotiations(readClient, domain))
          const fresh = after.slice(before.length)
          verdict =
            [...fresh].reverse().find((e) => isSameAddr(e.bidder, walletAddress)) ?? null
          if (!verdict) await new Promise((r) => setTimeout(r, 3000))
        }

        if (!aliveRef.current) return
        if (!verdict) {
          setNegotiation({
            phase: 'error',
            txHash: hash,
            verdict: null,
            error:
              'The transaction was accepted but the verdict could not be read yet. Refresh in a moment.',
          })
          return
        }
        setNegotiation({ phase: 'verdict', txHash: hash, verdict, error: null })
        void refresh()
      } catch (e) {
        if (!aliveRef.current) return
        setNegotiation({
          phase: 'error',
          txHash: null,
          verdict: null,
          error: e instanceof Error ? e.message : 'The negotiation failed.',
        })
      }
    },
    [walletAddress, readClient, refresh],
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
        await waitForTx(client, hash, 'ACCEPTED')
        if (!aliveRef.current) return false
        setListingState({ phase: 'verdict', txHash: hash, verdict: null, error: null })
        void refresh()
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
    [walletAddress, refresh],
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
    (domain: string) => withRpcRetry(() => fetchNegotiations(readClient, domain)),
    [readClient],
  )

  return {
    domains,
    stats,
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
