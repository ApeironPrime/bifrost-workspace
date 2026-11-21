import { useRef, type RefObject } from 'react'
import { Search, X } from 'lucide-react'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
  clearLabel: string
  className?: string
  disabled?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
}

export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  clearLabel,
  className = '',
  disabled = false,
  inputRef,
}: Props) {
  const fallbackRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? fallbackRef

  return (
    <div className={`search-field ${value ? 'has-value' : ''} ${className}`.trim()}>
      <Search size={15} className="search-field-icon" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && !disabled && (
        <button
          type="button"
          className="search-field-clear"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => {
            onChange('')
            ref.current?.focus({ preventScroll: true })
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
