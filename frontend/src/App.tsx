import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NetworkCanvas } from './components/NetworkCanvas'
import { ConnectButton } from './components/ConnectButton'
import { DomainCard } from './components/DomainCard'
import { ListDomainModal } from './components/ListDomainModal'
import { NegotiationConsole } from './components/NegotiationConsole'
import { TxToasts, type Toast } from './components/TxToast'
import { useWallet } from './hooks/useWallet'
import { useBroker } from './hooks/useBroker'
import { fromAtto } from './lib/format'
import { CONTRACT_ADDRESS, NETWORK_NAME } from './lib/genlayer'
import type { DomainInfo } from './lib/types'

export default function App() {
  const wallet = useWallet()
  const broker = useBroker(wallet.address)
  const [showList, setShowList] = useState(false)
  const [negotiating, setNegotiating] = useState<DomainInfo | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500)
  }, [])

  // Surface wallet errors as toasts
  useEffect(() => {
    if (wallet.error) pushToast('err', wallet.error)
  }, [wallet.error, pushToast])

  // Keep the negotiated domain fresh after refreshes
  useEffect(() => {
    if (!negotiating) return
    const updated = broker.domains.find((d) => d.name === negotiating.name)
    if (updated && updated !== negotiating) setNegotiating(updated)
  }, [broker.domains, negotiating])

  async function handleDelist(name: string) {
    try {
      pushToast('info', `Delisting ${name}…`)
      await broker.delistDomain(name)
      pushToast('ok', `${name} delisted.`)
    } catch (e) {
      pushToast('err', e instanceof Error ? e.message : 'Delist failed.')
    }
  }

  const noContract = !CONTRACT_ADDRESS || /^0x0+$/.test(CONTRACT_ADDRESS)

  return (
    <>
      <NetworkCanvas />

      <div className="shell">
        {/* ---------------- nav ---------------- */}
        <nav className="nav">
          <div className="brand">
            <span className="brand-glyph">⌘</span>
            <span>
              <span className="ai">AI</span> Domain Broker
            </span>
          </div>
          <span className="net-badge">
            <span className="net-dot" /> {NETWORK_NAME}
          </span>
          <span className="nav-spacer" />
          {wallet.address && (
            <button className="btn ghost sm" onClick={() => setShowList(true)}>
              + List domain
            </button>
          )}
          <ConnectButton
            address={wallet.address}
            connecting={wallet.connecting}
            restoring={wallet.restoring}
            onConnect={() => void wallet.connect()}
            onDisconnect={wallet.disconnect}
          />
        </nav>

        {/* ---------------- hero ---------------- */}
        <header className="hero">
          <motion.div
            className="hero-kicker"
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="net-dot" /> autonomous brokerage · GenLayer Optimistic Democracy
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.7 }}
          >
            Sell domains while
            <br />
            <span className="grad">an AI cuts the deal</span>
          </motion.h1>

          <motion.p
            className="hero-sub"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            List your Web3 domain with a public price and a <b>confidential minimum</b>.
            Buyers pitch their offers in natural language and <b>ARIA</b> — a broker AI
            running under validator consensus — accepts, rejects or counter-offers.
            No middlemen. No waiting for the seller to come online.
          </motion.p>

          <motion.div
            className="hero-actions"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            {wallet.address ? (
              <button className="btn" onClick={() => setShowList(true)}>
                🜲 List your domain
              </button>
            ) : (
              <button className="btn" onClick={() => void wallet.connect()}>
                Connect & start
              </button>
            )}
            <a className="btn ghost" href="#market">
              Browse the market ↓
            </a>
          </motion.div>

          {/* ---------------- stats ---------------- */}
          <div className="stats-strip">
            <StatCell v={broker.stats?.domains ?? '—'} k="domains listed" delay={0} />
            <StatCell v={broker.stats?.open ?? '—'} k="open for offers" delay={0.08} />
            <StatCell v={broker.stats?.sold ?? '—'} k="sold by the AI" delay={0.16} />
            <StatCell
              v={broker.stats ? `${fromAtto(broker.stats.volume, 2)}` : '—'}
              k="GEN volume settled"
              delay={0.24}
            />
            <StatCell v={broker.stats?.negotiations ?? '—'} k="negotiations" delay={0.32} />
          </div>
        </header>

        {/* ---------------- how it works ---------------- */}
        <section>
          <div className="sec-head">
            <h2>How the broker works</h2>
            <span className="hint">// trustless by construction</span>
          </div>
          <div className="how-strip">
            <HowCard n="01" t="List with a secret floor" d="Your asking price is public; your minimum is confidential. Only the broker AI reads it — never buyers, never views." />
            <HowCard n="02" t="Buyers escrow & pitch" d="An offer is real GEN escrowed in the contract plus a natural-language case for why the price is fair." />
            <HowCard n="03" t="Validators deliberate" d="Every GenLayer validator re-runs the negotiation independently and the verdicts must agree — no single node decides." />
            <HowCard n="04" t="Instant settlement" d="ACCEPT pays the seller and flips ownership atomically. REJECT and COUNTER refund the escrow in full, on-chain." />
          </div>
        </section>

        {/* ---------------- market ---------------- */}
        <section id="market">
          <div className="sec-head">
            <h2>Domain market</h2>
            <span className="hint">
              {broker.loading ? '// syncing…' : `// ${broker.domains.length} listings on-chain`}
            </span>
          </div>

          {noContract ? (
            <div className="empty">
              <div className="big">⚙️</div>
              Set <code className="mono">VITE_CONTRACT_ADDRESS</code> in{' '}
              <code className="mono">frontend/.env</code> to point at your deployed
              DomainBroker contract.
            </div>
          ) : broker.loadError && broker.domains.length === 0 ? (
            <div className="empty">
              <div className="big">📡</div>
              {broker.loadError}
            </div>
          ) : broker.loading && broker.domains.length === 0 ? (
            <div className="empty">
              <div className="big">⏳</div>
              Reading the order book from GenLayer…
            </div>
          ) : broker.domains.length === 0 ? (
            <div className="empty">
              <div className="big">🜲</div>
              The market is empty. Be the first to list a domain — ARIA is ready to
              negotiate for you.
            </div>
          ) : (
            <div className="domain-grid">
              {broker.domains.map((d, i) => (
                <DomainCard
                  key={d.name}
                  domain={d}
                  index={i}
                  walletAddress={wallet.address}
                  onNegotiate={(dom) => {
                    broker.resetNegotiation()
                    setNegotiating(dom)
                  }}
                  onDelist={(name) => void handleDelist(name)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ---------------- footer ---------------- */}
        <footer className="footer">
          <span>AI DOMAIN BROKER · intelligent contracts on GenLayer</span>
          <div className="links">
            <a href="https://genlayer.com" target="_blank" rel="noopener">genlayer</a>
            <a href="https://docs.genlayer.com" target="_blank" rel="noopener">docs</a>
            <a href="https://sdk.genlayer.com" target="_blank" rel="noopener">sdk</a>
            <a href="https://skills.genlayer.com" target="_blank" rel="noopener">skills</a>
            <a href="https://portal.genlayer.foundation" target="_blank" rel="noopener">builders portal</a>
          </div>
        </footer>
      </div>

      {/* ---------------- overlays ---------------- */}
      <AnimatePresence>
        {showList && (
          <ListDomainModal
            key="list"
            state={broker.listingState}
            onSubmit={async (n, a, f, d) => {
              const ok = await broker.registerDomain(n, a, f, d)
              if (ok) pushToast('ok', `${n} listed — ARIA is on duty.`)
              return ok
            }}
            onClose={() => {
              broker.resetListing()
              setShowList(false)
            }}
          />
        )}

        {negotiating && (
          <NegotiationConsole
            key="console"
            domain={negotiating}
            walletAddress={wallet.address}
            negotiation={broker.negotiation}
            fetchNegotiations={broker.fetchDomainNegotiations}
            onBid={(domain, pitch, wei) => void broker.placeBid(domain, pitch, wei)}
            onConnect={() => void wallet.connect()}
            onReset={broker.resetNegotiation}
            onClose={() => {
              broker.resetNegotiation()
              setNegotiating(null)
            }}
          />
        )}
      </AnimatePresence>

      <TxToasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </>
  )
}

function StatCell({ v, k, delay }: { v: string | number; k: string; delay: number }) {
  return (
    <motion.div
      className="stat-cell"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.55 + delay }}
    >
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </motion.div>
  )
}

function HowCard({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <motion.div
      className="how-card"
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55 }}
    >
      <div className="n">{n}</div>
      <h4>{t}</h4>
      <p>{d}</p>
    </motion.div>
  )
}
