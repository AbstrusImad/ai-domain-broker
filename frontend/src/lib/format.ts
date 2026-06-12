const ATTO = 10n ** 18n

/** atto (string | bigint) -> human GEN string, trimmed to 4 decimals. */
export function fromAtto(value: string | bigint, decimals = 4): string {
  let v: bigint
  try {
    v = typeof value === 'bigint' ? value : BigInt(value || '0')
  } catch {
    return '0'
  }
  const negative = v < 0n
  if (negative) v = -v
  const whole = v / ATTO
  const scale = 10n ** BigInt(decimals)
  const frac = ((v % ATTO) * scale) / ATTO
  let out = whole.toLocaleString('en-US')
  if (frac > 0n) {
    out += '.' + frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  }
  return (negative ? '-' : '') + out
}

/** Decimal GEN string from an input field -> atto bigint. Pure integer math. */
export function toAtto(text: string): bigint {
  const cleaned = text.trim().replace(/,/g, '')
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return 0n
  const [whole = '0', frac = ''] = cleaned.split('.')
  const fracPadded = frac.slice(0, 18).padEnd(18, '0')
  return BigInt(whole || '0') * ATTO + BigInt(fracPadded || '0')
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function isSameAddr(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}
