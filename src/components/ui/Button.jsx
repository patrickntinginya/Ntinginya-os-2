import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  danger: 'btn btn-danger',
  ghost: 'btn btn-ghost',
}

export default function Button({ variant = 'primary', loading = false, className = '', children, disabled, type = 'button', ...rest }) {
  return (
    <button type={type} className={`${VARIANTS[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}
