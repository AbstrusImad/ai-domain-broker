/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GENLAYER_NETWORK?: string
  readonly VITE_CONTRACT_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

interface Window {
  ethereum?: EthereumProvider
}
