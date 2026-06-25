import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
  children: ReactNode
}

export function Button({
  variant = 'ghost',
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
        'transition-all duration-200 cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'primary' && 'btn-primary text-white',
        variant === 'ghost' && 'btn-ghost text-purple-300 hover:text-white',
        variant === 'danger' && 'bg-red-900/40 border border-red-500/30 text-red-300',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
