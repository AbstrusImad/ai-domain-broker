import { shortAddr } from '../lib/format'

interface Props {
  address: string | null
  connecting: boolean
  restoring: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function ConnectButton({
  address,
  connecting,
  restoring,
  onConnect,
  onDisconnect,
}: Props) {
  if (restoring) {
    return (
      <button className="btn ghost sm" disabled>
        …
      </button>
    )
  }
  if (address) {
    return (
      <button className="btn ghost sm mono" onClick={onDisconnect} title="Disconnect">
        ⬡ {shortAddr(address)}
      </button>
    )
  }
  return (
    <button className="btn sm" onClick={onConnect} disabled={connecting}>
      {connecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  )
}
