import { AnimatePresence, motion } from 'framer-motion'

export interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

export function TxToasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast ${t.kind === 'info' ? '' : t.kind}`}
            initial={{ opacity: 0, x: 60, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            onClick={() => onDismiss(t.id)}
            style={{ cursor: 'pointer' }}
          >
            <span>{t.kind === 'ok' ? '✅' : t.kind === 'err' ? '⚠️' : 'ℹ️'}</span>
            <span>{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
