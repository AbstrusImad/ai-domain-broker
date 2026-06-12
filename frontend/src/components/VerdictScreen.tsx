import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { NegotiationEntry } from '../lib/types'
import { fromAtto } from '../lib/format'

const STAMP_TEXT: Record<string, string> = {
  ACCEPT: 'Deal Closed',
  REJECT: 'Offer Rejected',
  COUNTER_OFFER: 'Counter-Offer',
}

const CONFETTI_COLORS = ['#3dffa8', '#4dd9ff', '#8b7cff', '#ff5ce1', '#ffc14d']

interface Props {
  verdict: NegotiationEntry
  onRebid: (counterAtto: string) => void
  onClose: () => void
}

export function VerdictScreen({ verdict, onRebid, onClose }: Props) {
  const [typedNote, setTypedNote] = useState('')
  const accepted = verdict.decision === 'ACCEPT'
  const countered = verdict.decision === 'COUNTER_OFFER'

  // Typewriter for the broker's note
  useEffect(() => {
    let i = 0
    const id = window.setInterval(() => {
      i += 2
      setTypedNote(verdict.note.slice(0, i))
      if (i >= verdict.note.length) window.clearInterval(id)
    }, 18)
    return () => window.clearInterval(id)
  }, [verdict.note])

  const confetti = useMemo(
    () =>
      accepted
        ? Array.from({ length: 60 }, (_, i) => ({
            left: Math.random() * 100,
            delay: Math.random() * 0.8,
            duration: 2 + Math.random() * 2.2,
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          }))
        : [],
    [accepted],
  )

  return (
    <div className="verdict-stage">
      {confetti.map((c, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${c.left}%`,
            background: c.color,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
          }}
        />
      ))}

      <motion.div
        className={`stamp ${verdict.decision}`}
        initial={{ scale: 2.4, opacity: 0, rotate: -14 }}
        animate={{ scale: 1, opacity: 1, rotate: accepted ? -4 : countered ? 2 : -2 }}
        transition={{ type: 'spring', stiffness: 320, damping: 16, delay: 0.15 }}
      >
        {STAMP_TEXT[verdict.decision] ?? verdict.decision}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mono"
        style={{ fontSize: 13, color: 'var(--txt-faint)' }}
      >
        your escrowed offer: {fromAtto(verdict.bid)} GEN ·{' '}
        {accepted
          ? 'transferred to the seller — the domain is yours'
          : 'refunded to your wallet in full'}
      </motion.div>

      {countered && (
        <motion.div
          className="counter-quote"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7, type: 'spring', stiffness: 260, damping: 15 }}
        >
          {fromAtto(verdict.counter)} GEN <small>broker's closing price</small>
        </motion.div>
      )}

      <div className="verdict-note">
        <span className="mono" style={{ color: 'var(--cyan)', fontSize: 11, letterSpacing: 2 }}>
          ARIA · BROKER VERDICT{verdict.auto ? ' (DETERMINISTIC)' : ' (VALIDATOR CONSENSUS)'}
        </span>
        <p style={{ marginTop: 10 }}>
          “{typedNote}
          {typedNote.length < verdict.note.length && <span>▌</span>}”
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {countered && (
          <motion.button
            className="btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            onClick={() => onRebid(verdict.counter)}
          >
            Accept counter — rebid {fromAtto(verdict.counter)} GEN
          </motion.button>
        )}
        <motion.button
          className={countered ? 'btn ghost' : 'btn'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          onClick={onClose}
        >
          {accepted ? 'Claim your market 🏆' : 'Back to the market'}
        </motion.button>
      </div>
    </div>
  )
}
