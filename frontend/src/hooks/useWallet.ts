import { useCallback, useEffect, useState } from 'react'
import { CHAIN } from '../lib/genlayer'

// Remember a deliberate disconnect: MetaMask still authorizes the site after
// our disconnect, so without this flag we would silently reconnect.
const DISCONNECT_KEY = 'broker:disconnected'

/**
 * Browser wallet connection (MetaMask) with automatic switch to the
 * configured GenLayer network (Bradbury Testnet by default).
 *
 * The session SURVIVES a refresh: on mount we query `eth_accounts`
 * (silent, no popup) and restore the account if the site is authorized.
 */
export function useWallet() {
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(true)

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError('You need MetaMask to talk to the broker.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[]
      await ensureGenLayerChain()
      window.localStorage.removeItem(DISCONNECT_KEY)
      setAddress(accounts[0] ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect the wallet.')
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    window.localStorage.setItem(DISCONNECT_KEY, '1')
    setAddress(null)
  }, [])

  // Rehydrate session on page load (no popup)
  useEffect(() => {
    const eth = window.ethereum
    if (!eth) {
      setRestoring(false)
      return
    }
    if (window.localStorage.getItem(DISCONNECT_KEY) === '1') {
      setRestoring(false)
      return
    }
    let cancelled = false
    eth
      .request({ method: 'eth_accounts' })
      .then((res) => {
        if (cancelled) return
        const accounts = (res as string[]) ?? []
        if (accounts[0]) setAddress(accounts[0])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // React to account / chain changes in MetaMask
  useEffect(() => {
    const eth = window.ethereum
    if (!eth?.on) return
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[]
      if (accounts[0]) {
        window.localStorage.removeItem(DISCONNECT_KEY)
        setAddress(accounts[0])
      } else {
        setAddress(null)
      }
    }
    const onChain = () => window.location.reload()
    eth.on('accountsChanged', onAccounts)
    eth.on('chainChanged', onChain)
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged', onChain)
    }
  }, [])

  return { address, connecting, restoring, error, connect, disconnect }
}

/** Switch (or register) the GenLayer network in the wallet. */
async function ensureGenLayerChain(): Promise<void> {
  const eth = window.ethereum
  if (!eth) return
  const chainIdHex = `0x${CHAIN.id.toString(16)}`
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
  } catch (err) {
    const code = (err as { code?: number })?.code
    // 4902: the chain is unknown to the wallet -> add it from SDK data
    if (code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.nativeCurrency,
            rpcUrls: CHAIN.rpcUrls?.default?.http ?? [],
            blockExplorerUrls: CHAIN.blockExplorers?.default?.url
              ? [CHAIN.blockExplorers.default.url]
              : [],
          },
        ],
      })
    } else {
      throw err
    }
  }
}
