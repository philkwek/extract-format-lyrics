import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'
import { classes } from '../../lib/classes'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  loading?: boolean
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'ui-button--primary',
  secondary: 'ui-button--secondary',
  ghost: 'ui-button--ghost',
  danger: 'ui-button--danger',
  success: 'ui-button--success',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'ui-button--sm',
  md: 'ui-button--md',
  icon: 'ui-button--icon',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes('ui-button', buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends Omit<ButtonProps, 'size' | 'children'> {
  label: string
  children: ReactNode
}

export function IconButton({ label, children, ...props }: IconButtonProps) {
  return (
    <Button size="icon" aria-label={label} title={props.title || label} {...props}>
      {children}
    </Button>
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: Array<SegmentedOption<T>>
  onChange: (value: T) => void
  label: string
  className?: string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={classes('ui-segmented', className)} role="tablist" aria-label={label}>
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={classes('ui-segmented__item', isActive && 'ui-segmented__item--active')}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'div' | 'article'
  elevated?: boolean
}

export function Surface({ as: Component = 'section', elevated = false, className, ...props }: SurfaceProps) {
  return <Component className={classes('ui-surface', elevated && 'ui-surface--elevated', className)} {...props} />
}

export type StatusTone = 'info' | 'success' | 'warning' | 'error'

interface StatusBannerProps extends HTMLAttributes<HTMLDivElement> {
  tone?: StatusTone
  icon?: ReactNode
}

export function StatusBanner({ tone = 'info', icon, className, children, ...props }: StatusBannerProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={classes('ui-status', `ui-status--${tone}`, className)}
      {...props}
    >
      {icon && <span className="ui-status__icon" aria-hidden="true">{icon}</span>}
      <div>{children}</div>
    </div>
  )
}

