import clsx from 'clsx'
import type { ReactNode } from 'react'

interface PanelProps {
  title?: string
  children: ReactNode
  className?: string
  compact?: boolean
}

export function Panel({ title, children, className, compact }: PanelProps) {
  return (
    <div
      className={clsx(
        'panel-glass rounded-xl',
        compact ? 'p-3' : 'p-4',
        className,
      )}
    >
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wider text-purple-400 mb-3">
          {title}
        </h3>
      )}
      {children}
    </div>
  )
}
