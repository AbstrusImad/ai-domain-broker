import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DomainInfo, NegotiationEntry } from '../lib/types'
import type { NegotiationState } from '../hooks/useBroker'
import { fromAtto, shortAddr, toAtto } from '../lib/format'
import { ValidatorOrbit } from './ValidatorOrbit'
import { VerdictScreen } from './VerdictScreen'

interface Props {
  domain: DomainInfo
  walletAddress: string | null
  negotiation: NegotiationState
  fetchNegotiations: (domain: string) => Promise<NegotiationEntry[]>
  onBid: (domain: string, pitch: string, bidWei: bigint) => void
  onConnect: () => void
  onReset: () => void
  onClose: () => void
}

/**
 * The negotiation console: domain dossier on the left, chat-style negotiation
 * room on the right. Sending an offer hands the screen to the ValidatorOrbit
 * animation, and the resolved verdict lands as a VerdictScreen.
 */
export function NegotiationConsole({
  domain,
  walletAddress,
  negotiation,
  fetchNegotiations,
  onBid,
  onConnect,
  onReset,
  onClose,
}: Props) {
  const [amount, setAmount] = useState('')
  const [pitch, setPitch] = useState('')
  const [history, setHistory] = useState<NegotiationEntry[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const busy =
    negotiation.phase === 'wallet' ||
    negotiation.phase === 'submitted' ||
    negotiation.phase === 'consensus'

  // Load this domain's negotiation chronicle once per domain (gen_call is
  // rate-limited on Bradbury — never refetch on every phase change).
  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    fetchNegotiations(domain.name)
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [domain.name, fetchNegotiations])

  // One extra reload only when a verdict lands (to show the new entry).
  useEffect(() => {
    if (negotiation.phase !== 'verdict') return
    let cancelled = false
    fetchNegotiations(domain.name)
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [negotiation.phase, domain.name, fetchNegotiations])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' })
  }, [history.length])

  function send() {
    const wei = toAtto(amount)
    if (wei <= 0n || pitch.trim().length === 0) return
    onBid(domain.name, pitch.trim(), wei)
  }

  function rebidAtCounter(counterAtto: string) {
    onReset()
    setAmount(fromAtto(counterAtto, 18).replace(/,/g, ''))
    setPitch("I accept the broker's counter-offer. Closing at the quoted price.")
  }

  const showOrbit = busy
  const showVerdict = negotiation.phase === 'verdict' && negotiation.verdict

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <motion.div
        className="modal wide"
        style={{ padding: 0, overflow: 'hidden' }}
        initial={{ opacity: 0, scale: 0.94, y: 26 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <AnimatePresence mode="wait">
          {showOrbit ? (
            <motion.div key="orbit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ValidatorOrbit phase={negotiation.phase} txHash={negotiation.txHash} />
            </motion.div>
          ) : showVerdict ? (
            <motion.div key="verdict" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <VerdictScreen
                verdict={negotiation.verdict!}
                onRebid={rebidAtCounter}
                onClose={() => {
                  onReset()
                  onClose()
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="console" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="console">
                {/* ------------- dossier ------------- */}
                <div className="dossier">
                  <div>
                    <span className={`badge ${domain.status.toLowerCase()}`}>{domain.status}</span>
                    <div className="domain-name" style={{ marginTop: 12 }}>
                      {domain.name}
                    </div>
                  </div>
                  <p style={{ color: 'var(--txt-dim)', fontSize: 13.5 }}>{domain.description}</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
                    <div className="dossier-row">
                      <span>Asking price</span>
                      <b>{fromAtto(domain.ask)} GEN</b>
                    </div>
                    {domain.counter !== '0' && (
                      <div className="dossier-row" style={{ color: 'var(--amber)' }}>
                        <span>Live counter-offer</span>
                        <b style={{ color: 'var(--amber)' }}>{fromAtto(domain.counter)} GEN</b>
                      </div>
                    )}
                    <div className="dossier-row">
                      <span>Seller</span>
                      <b>{shortAddr(domain.owner)}</b>
                    </div>
                    <div className="dossier-row">
                      <span>Offers received</span>
                      <b>{domain.bids}</b>
                    </div>
                    <div className="dossier-row" style={{ border: 'none', paddingBottom: 0 }}>
                      <span>Broker</span>
                      <b style={{ color: 'var(--cyan)' }}>ARIA · autonomous</b>
                    </div>
                  </div>

                  <div
                    className="mono"
                    style={{ fontSize: 10.5, color: 'var(--txt-faint)', lineHeight: 1.7 }}
                  >
                    🔒 The seller's minimum is confidential. ARIA negotiates for the seller
                    and is bound on-chain: it can never close below that minimum, and any
                    published counter-offer is honored automatically.
                  </div>
                </div>

                {/* ------------- chat ------------- */}
                <div className="chat">
                  <div className="chat-scroll" ref={scrollRef}>
                    <div className="bubble broker">
                      <div className="who">ARIA · Broker AI</div>
                      Welcome. <b>{domain.name}</b> is on the market for{' '}
                      {fromAtto(domain.ask)} GEN. Escrow your offer and make your case —
                      strong market reasoning gets better terms than empty pressure.
                    </div>

                    {loadingHistory && (
                      <div className="mono" style={{ color: 'var(--txt-faint)', fontSize: 12, textAlign: 'center' }}>
                        loading negotiation history…
                      </div>
                    )}

                    {history.map((e) => (
                      <NegotiationBubblePair key={e.i} entry={e} />
                    ))}
                  </div>

                  {negotiation.phase === 'error' && (
                    <div className="form-err">
                      {negotiation.error}
                      <button className="btn ghost sm" style={{ marginLeft: 12 }} onClick={onReset}>
                        Try again
                      </button>
                    </div>
                  )}

                  {/* ------------- bid bar ------------- */}
                  {walletAddress ? (
                    <div className="bid-bar">
                      <div className="field">
                        <label>Your offer (GEN)</label>
                        <input
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder="80"
                          inputMode="decimal"
                        />
                      </div>
                      <div className="field">
                        <label>
                          Your pitch <span className="why">{pitch.length}/600</span>
                        </label>
                        <textarea
                          rows={2}
                          maxLength={600}
                          value={pitch}
                          onChange={(e) => setPitch(e.target.value)}
                          placeholder="I'm offering 80 GEN because comparable .gen sales this quarter closed between 70-90 GEN, and…"
                        />
                      </div>
                      <button
                        className="btn"
                        onClick={send}
                        disabled={toAtto(amount) <= 0n || pitch.trim().length === 0}
                        style={{ height: 47 }}
                      >
                        Send offer ⇄
                      </button>
                    </div>
                  ) : (
                    <div className="bid-bar" style={{ gridTemplateColumns: '1fr auto' }}>
                      <div className="mono" style={{ color: 'var(--txt-faint)', fontSize: 12.5, alignSelf: 'center' }}>
                        Connect a wallet to negotiate with ARIA.
                      </div>
                      <button className="btn" onClick={onConnect}>
                        Connect Wallet
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function NegotiationBubblePair({ entry }: { entry: NegotiationEntry }) {
  return (
    <>
      <motion.div
        className="bubble buyer"
        initial={{ opacity: 0, x: 22 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <div className="who">
          {shortAddr(entry.bidder)} · offered {fromAtto(entry.bid)} GEN
        </div>
        {entry.pitch}
      </motion.div>
      <motion.div
        className="bubble broker"
        initial={{ opacity: 0, x: -22 }}
        animate={{ opacity: 1, x: 0 }}
      >
        <div className="who">ARIA · Broker AI</div>
        <span className={`verdict-chip ${entry.decision}`}>
          {entry.decision === 'COUNTER_OFFER'
            ? `COUNTER · ${fromAtto(entry.counter)} GEN`
            : entry.decision}
        </span>
        <div>{entry.note}</div>
      </motion.div>
    </>
  )
}
