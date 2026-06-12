import { useRef } from 'react'
import { motion } from 'framer-motion'
import type { DomainInfo } from '../lib/types'
import { fromAtto, isSameAddr, shortAddr } from '../lib/format'

interface Props {
  domain: DomainInfo
  index: number
  walletAddress: string | null
  onNegotiate: (d: DomainInfo) => void
  onDelist: (name: string) => void
}

export function DomainCard({ domain, index, walletAddress, onNegotiate, onDelist }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const isOwner = isSameAddr(domain.owner, walletAddress)
  const hasCounter = domain.counter !== '0'
  const open = domain.status === 'OPEN'

  // 3D tilt + spotlight following the cursor
  function onMove(e: React.MouseEvent) {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.setProperty('--mx', `${px * 100}%`)
    el.style.setProperty('--my', `${py * 100}%`)
    el.style.transform = `perspective(900px) rotateY(${(px - 0.5) * 6}deg) rotateX(${(0.5 - py) * 6}deg)`
  }

  function onLeave() {
    const el = ref.current
    if (el) el.style.transform = ''
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.06, 0.5), duration: 0.55, ease: 'easeOut' }}
    >
      <div className="domain-card" ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}>
        <div className="shine" />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div className="domain-name">{domain.name}</div>
          <span className={`badge ${domain.status.toLowerCase()}`}>{domain.status}</span>
        </div>

        <p className="domain-desc">{domain.description}</p>

        <div className="domain-meta">
          <div className="price-tag">
            <div className="lbl">{domain.status === 'SOLD' ? 'Sold for' : 'Asking price'}</div>
            <div className="val">
              {fromAtto(domain.status === 'SOLD' ? domain.sold_price : domain.ask)}{' '}
              <small>GEN</small>
            </div>
          </div>
          {open && hasCounter && (
            <span className="badge counter" title="The broker published a counter-offer">
              COUNTER: {fromAtto(domain.counter)} GEN
            </span>
          )}
        </div>

        <div className="domain-foot">
          <span title={domain.owner}>
            {isOwner ? '◈ yours' : `◈ ${shortAddr(domain.owner)}`} · {domain.bids} bid
            {domain.bids === 1 ? '' : 's'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {open && isOwner && (
              <button className="btn danger sm" onClick={() => onDelist(domain.name)}>
                Delist
              </button>
            )}
            {open && !isOwner && (
              <button className="btn cyan sm" onClick={() => onNegotiate(domain)}>
                Negotiate ⇄
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
