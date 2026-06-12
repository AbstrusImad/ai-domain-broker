import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { NegotiationPhase } from '../lib/types'
import type { LeaderDraft, TransactionHash } from '../lib/genlayer'
import { fromAtto } from '../lib/format'

const PHASE_LINES: Record<string, string[]> = {
  wallet: [
    'Waiting for your signature…',
    'Your GEN will be escrowed in the broker vault.',
  ],
  submitted: [
    'Escrowing your GEN in the broker vault…',
    'Broadcasting your pitch to the GenLayer network…',
  ],
  consensus: [
    'ARIA is reading your pitch…',
    'Leader node drafts a verdict…',
    'Validators re-run the negotiation independently…',
    'Comparing verdicts under Optimistic Democracy…',
    'Sealing the decision on-chain…',
  ],
}

const VALIDATORS = ['V1', 'V2', 'V3', 'V4', 'V5']

interface Props {
  phase: NegotiationPhase
  txHash: TransactionHash | null
  draft?: LeaderDraft | null
  liveStatus?: string
}

/**
 * Full negotiation theater: pulsing AI core, orbiting rings, validator nodes
 * scanning, and cycling status lines tied to the real transaction lifecycle.
 */
export function ValidatorOrbit({ phase, txHash, draft, liveStatus }: Props) {
  const [lineIdx, setLineIdx] = useState(0)
  const [typed, setTyped] = useState('')
  const rotating = liveStatus === 'LEADER_TIMEOUT' || liveStatus === 'VALIDATORS_TIMEOUT'
  // Once the leader's draft verdict is visible, the story changes: the
  // validators are now verifying a concrete proposal. Leader rotations get
  // their own honest storyline — the network retries automatically.
  const lines = rotating
    ? [
        'A node timed out — the network rotates to a new leader…',
        'Your negotiation is retried automatically. Nothing is lost.',
        'Re-running the broker under a fresh leader…',
      ]
    : draft
      ? [
          'Leader sealed a draft verdict…',
          'Validators re-run the negotiation to verify it…',
          'Cross-checking decisions under Optimistic Democracy…',
        ]
      : (PHASE_LINES[phase] ?? PHASE_LINES.consensus)

  // Cycle through status lines
  useEffect(() => {
    setLineIdx(0)
  }, [phase])

  useEffect(() => {
    const id = window.setInterval(() => {
      setLineIdx((i) => (i + 1) % lines.length)
    }, 3400)
    return () => window.clearInterval(id)
  }, [lines.length])

  // Typewriter for the current line
  useEffect(() => {
    const target = lines[lineIdx] ?? ''
    setTyped('')
    let i = 0
    const id = window.setInterval(() => {
      i++
      setTyped(target.slice(0, i))
      if (i >= target.length) window.clearInterval(id)
    }, 22)
    return () => window.clearInterval(id)
  }, [lineIdx, lines])

  const consensusStage = phase === 'consensus'

  return (
    <div className="orbit-stage">
      <div className="ai-core">
        <div className="ring" />
        <div className="ring r2" />
        <div className="ring r3" />
        <div className="nucleus" />
      </div>

      <div className="orbit-status">
        <div className="line">
          {typed}
          <span style={{ opacity: 0.7 }}>▌</span>
        </div>
        <div className="sub">
          {phase === 'wallet'
            ? 'check your wallet popup'
            : consensusStage
              ? 'an on-chain LLM + validator consensus can take a few minutes'
              : 'transaction in flight'}
        </div>
      </div>

      {draft && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          style={{ textAlign: 'center' }}
        >
          <span className={`verdict-chip ${draft.decision}`} style={{ fontSize: 12, padding: '6px 16px' }}>
            leader proposes: {draft.decision.replace('_', '-')}
            {draft.decision === 'COUNTER_OFFER' && ` · ${fromAtto(draft.counterAtto)} GEN`}
          </span>
          <div className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--txt-faint)' }}>
            awaiting validator agreement to make it final
          </div>
        </motion.div>
      )}

      <div className="validators-row">
        {VALIDATORS.map((v, i) => (
          <motion.div
            key={v}
            className="validator-node"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: consensusStage ? 1 : 0.35, y: 0 }}
            transition={{ delay: i * 0.12 }}
          >
            <div className="orb" style={{ ['--d' as string]: `${i * 0.35}s` }}>
              ⬢
            </div>
            {v}
          </motion.div>
        ))}
      </div>

      {txHash && (
        <div className="tx-chip">
          tx {txHash.slice(0, 18)}…{txHash.slice(-8)}
        </div>
      )}
    </div>
  )
}
