import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createReadClient,
  createWalletClient,
  fetchDomains,
  fetchNegotiations,
  fetchStats,
  pollTransactionUntilDecided,
  sendBid,
  sendDelist,
  sendRegisterDomain,
  waitForTx,
  withRpcRetry,
  type LeaderDraft,
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
  /** ARIA's draft verdict peeked from the leader receipt mid-consensus. */
  draft?: LeaderDraft | null
  /** Raw lifecycle status from the network (PROPOSING, LEADER_TIMEOUT…). */
  liveStatus?: string
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
      // Count this wallet's existing verdicts on this domain BEFORE bidding,
      // so the poll can detect the new one landing on-chain regardless of the
      // transaction receipt shape.
      let priorVerdictCount = 0
      try {
        const before = await fetchNegotiations(readClient, domain)
        priorVerdictCount = before.filter((e) => isSameAddr(e.bidder, walletAddress)).length
      } catch {
        /* best-effort baseline */
      }
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

        // Poll gen_getTransactionByHash (no GenVM execution → no gen_call
        // rate limit). The leader's draft verdict streams in mid-consensus.
        const { status, draft } = await pollTransactionUntilDecided(client, hash, {
          interval: 8000,
          maxTries: 150, // ~20 min — leader rotations restart the clock
          onUpdate: (st, d) => {
            if (!aliveRef.current) return
            setNegotiation((s) =>
              s.txHash === hash
                ? { ...s, phase: 'consensus', draft: d, liveStatus: st }
                : s,
            )
          },
          // Ground truth: resolve as soon as a new verdict by this wallet is
          // on-chain, even if the receipt status is unreadable.
          confirmVerdict: async () => {
            const now = await fetchNegotiations(readClient, domain)
            return (
              now.filter((e) => isSameAddr(e.bidder, walletAddress)).length >
              priorVerdictCount
            )
          },
        })
        if (!aliveRef.current) return

        if (status === 'ACCEPTED' || status === 'FINALIZED') {
          // Authoritative verdict from the on-chain chronicle (it includes
          // the deterministic backstops). Entries are append-only, so the
          // newest entry by this wallet is ours.
          let verdict: NegotiationEntry | null = null
          for (let attempt = 0; attempt < 5 && !verdict; attempt++) {
            await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 6000))
            try {
              const after = await withRpcRetry(
                () => fetchNegotiations(readClient, domain),
                2,
              )
              verdict =
                [...after].reverse().find((e) => isSameAddr(e.bidder, walletAddress)) ??
                null
            } catch {
              /* gen_call busy — the draft fallback below still resolves */
            }
          }

          // gen_call rate-limited? The leader draft is still a faithful
          // verdict (consensus agreed with it) — synthesize the entry.
          if (!verdict && draft) {
            verdict = {
              i: -1,
              domain,
              bidder: walletAddress,
              bid: bidWei.toString(),
              decision: draft.decision,
              counter: draft.counterAtto,
              pitch,
              note: draft.note || 'Verdict sealed on-chain.',
              auto: false,
            }
          }

          if (!aliveRef.current) return
          if (!verdict) {
            setNegotiation({
              phase: 'error',
              txHash: hash,
              verdict: null,
              error:
                'The transaction was accepted but the verdict could not be read yet (RPC busy). Reopen this negotiation in a minute — your verdict is on-chain.',
            })
            return
          }
          setNegotiation({ phase: 'verdict', txHash: hash, verdict, error: null })
          void refresh()
          void refreshStats()
          return
        }

        // Terminal but not accepted: nothing executed, escrow never left.
        const friendly: Record<string, string> = {
          UNDETERMINED:
            'The validators could not agree on a verdict. Your escrow was not taken — try again (a clearer pitch helps consensus).',
          CANCELED: 'The transaction was canceled. Your GEN is safe.',
        }
        setNegotiation({
          phase: 'error',
          txHash: hash,
          verdict: null,
          error:
            friendly[status] ??
            `The network is congested and the negotiation is still working (last status: ${status || 'pending'} — leader rotations retry automatically). Your GEN is safe. Reopen this negotiation in a few minutes: the verdict will appear in the chat history.`,
        })
      } catch (e) {
        if (!aliveRef.current) return
        const raw = e instanceof Error ? e.message : 'The negotiation failed.'
        const friendly = /LackOfFundForMaxFee|insufficient funds/i.test(raw)
          ? 'Not enough GEN in your wallet. Bradbury reserves up to ~90 GEN as the max fee for AI transactions (most of it is refunded after execution), so you need your bid amount + fee headroom. Top up at the faucet: testnet-faucet.genlayer.foundation'
          : /user rejected|denied/i.test(raw)
            ? 'You rejected the transaction in your wallet.'
            : raw
        setNegotiation({ phase: 'error', txHash: hash, verdict: null, error: friendly })
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
