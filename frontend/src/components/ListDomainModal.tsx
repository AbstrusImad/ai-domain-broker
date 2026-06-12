import { useState } from 'react'
import { motion } from 'framer-motion'
import type { NegotiationState } from '../hooks/useBroker'

interface Props {
  state: NegotiationState
  onSubmit: (name: string, ask: string, floor: string, desc: string) => Promise<boolean>
  onClose: () => void
}

export function ListDomainModal({ state, onSubmit, onClose }: Props) {
  const [name, setName] = useState('')
  const [ask, setAsk] = useState('')
  const [floor, setFloor] = useState('')
  const [desc, setDesc] = useState('')
  const [localErr, setLocalErr] = useState<string | null>(null)

  const busy = state.phase === 'wallet' || state.phase === 'consensus'
  const done = state.phase === 'verdict'

  async function submit() {
    setLocalErr(null)
    const askNum = Number(ask)
    const floorNum = Number(floor)
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name.trim().toLowerCase())) {
      setLocalErr("Domain must look like 'defi-capital.gen' (lowercase, with a TLD).")
      return
    }
    if (!askNum || askNum <= 0) return setLocalErr('Asking price must be a positive GEN amount.')
    if (!floorNum || floorNum <= 0 || floorNum > askNum) {
      return setLocalErr('The confidential minimum must be positive and ≤ the asking price.')
    }
    if (desc.trim().length < 10) {
      return setLocalErr('Give the broker something to sell: describe the niche (10+ chars).')
    }
    await onSubmit(name.trim().toLowerCase(), ask.trim(), floor.trim(), desc.trim())
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <motion.div
        className="modal"
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        {done ? (
          <div style={{ textAlign: 'center', padding: '26px 0' }}>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14 }}
              style={{ fontSize: 56 }}
            >
              ✅
            </motion.div>
            <h3 style={{ justifyContent: 'center', marginTop: 14 }}>Listed on-chain</h3>
            <p className="sub" style={{ marginTop: 10 }}>
              Your domain is live. ARIA is now fielding offers on your behalf —
              it will never sell below your confidential minimum.
            </p>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={onClose}>
                Back to the market
              </button>
            </div>
          </div>
        ) : (
          <>
            <h3>🜲 List a domain</h3>
            <p className="sub">
              The asking price is public. The minimum is <b>confidential</b> — only the
              broker AI reads it during negotiations, and it never reveals it.
            </p>

            <div className="field">
              <label>
                Domain name <span className="why">e.g. defi-capital.gen</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="yourdomain.gen"
                disabled={busy}
                spellCheck={false}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="field">
                <label>Asking price (GEN)</label>
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder="120"
                  inputMode="decimal"
                  disabled={busy}
                />
              </div>
              <div className="field secret">
                <label>
                  Secret minimum <span className="why">🔒 broker-only</span>
                </label>
                <input
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                  placeholder="80"
                  inputMode="decimal"
                  disabled={busy}
                  style={{ borderColor: 'rgba(255,193,77,.3)' }}
                />
              </div>
            </div>

            <div className="field">
              <label>
                Niche & pitch for the broker <span className="why">{desc.length}/500</span>
              </label>
              <textarea
                rows={4}
                maxLength={500}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Premium DeFi + AI niche domain. Short, brandable, exact-match keyword…"
                disabled={busy}
              />
            </div>

            {(localErr || state.error) && <div className="form-err">{localErr ?? state.error}</div>}

            <div className="modal-actions">
              <button className="btn ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn" onClick={() => void submit()} disabled={busy}>
                {state.phase === 'wallet'
                  ? 'Confirm in wallet…'
                  : state.phase === 'consensus'
                    ? 'Reaching consensus…'
                    : 'List domain'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}
