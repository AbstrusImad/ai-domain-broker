export type DomainStatus = 'OPEN' | 'SOLD' | 'DELISTED'

export interface DomainInfo {
  name: string
  owner: string
  ask: string // atto, as string
  description: string
  status: DomainStatus
  counter: string // atto; '0' when no live counter-offer
  sold_price: string // atto; '0' until sold
  bids: number
}

export type Decision = 'ACCEPT' | 'REJECT' | 'COUNTER_OFFER'

export interface NegotiationEntry {
  i: number
  domain: string
  bidder: string
  bid: string // atto
  decision: Decision
  counter: string // atto
  pitch: string
  note: string
  auto: boolean
}

export interface MarketStats {
  domains: number
  open: number
  sold: number
  volume: string // atto
  negotiations: number
}

export type NegotiationPhase =
  | 'idle'
  | 'wallet' // waiting for MetaMask signature
  | 'submitted' // tx broadcast, hash known
  | 'consensus' // validators deliberating
  | 'verdict' // resolved, verdict available
  | 'error'
