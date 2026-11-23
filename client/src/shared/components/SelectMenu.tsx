import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { filterSelectItems, moveSelectIndex, searchKey, type SelectItem } from '../../lib/selectOptions'
import './SelectMenu.css'

type Props = {
  id?: string
  value: string
  items: SelectItem[]
  label: string
  placeholder: string
  emptyText: string
  noResultsText?: string
  searchPlaceholder?: string
  clearLabel?: string
  searchable?: boolean
  disabled?: boolean
  busy?: boolean
  invalid?: boolean
  align?: 'start' | 'end'
  size?: 'md' | 'sm'
  className?: string
  panelWidth?: number
  heading?: string
  triggerTitle?: string
  onChange: (value: string) => void
  renderValue?: (item: SelectItem | undefined) => ReactNode
  renderIcon?: (item: SelectItem) => ReactNode
  emptyAction?: ReactNode
  footer?: ReactNode
}

/** Select-only combobox with an app-owned native popover; no hidden OS select. */
export const SelectMenu = memo(function SelectMenu({
  id: externalId,
  value,
  items,
  label,
  placeholder,
  emptyText,
  noResultsText,
  searchPlaceholder,
  clearLabel,
  searchable = false,
  disabled = false,
  busy = false,
  invalid = false,
  align = 'start',
  size = 'md',
  className = '',
  panelWidth = 300,
  heading,
  triggerTitle,
  onChange,
  renderValue,
  renderIcon,
  emptyAction,
  footer,
}: Props) {
  const autoId = useId()
  const triggerId = externalId ?? `${autoId}-trigger`
  const listId = `${autoId}-list`
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())
  const frame = useRef(0)
  const typeahead = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(value)

  const selected = items.find((item) => item.value === value)
  const visible = filterSelectItems(items, query)
  const enabled = visible.filter((item) => !item.disabled)
  const activeIndex = Math.max(0, enabled.findIndex((item) => item.value === active))

  const close = (restore = true) => {
    cancelAnimationFrame(frame.current)
    panel.current?.hidePopover()
    setOpen(false)
    if (restore) trigger.current?.focus({ preventScroll: true })
  }

  const place = () => {
    const button = trigger.current
    const popup = panel.current
    if (!button || !popup) return
    const rect = button.getBoundingClientRect()
    const width = Math.min(Math.max(panelWidth, rect.width), innerWidth - 24)
    const below = Math.max(0, innerHeight - rect.bottom - 12)
    const above = Math.max(0, rect.top - 12)
    const natural = popup.scrollHeight || 220
    const down = below >= Math.min(240, natural) || below >= above
    const maxHeight = Math.max(60, Math.min(420, down ? below : above))
    popup.style.width = `${width}px`
    popup.style.maxHeight = `${maxHeight}px`

    const preferredLeft = align === 'end' ? rect.right - width : rect.left
    popup.style.left = `${Math.max(12, Math.min(preferredLeft, innerWidth - width - 12))}px`
    const height = Math.min(popup.scrollHeight || natural, maxHeight)
    popup.style.top = `${Math.max(
      12,
      Math.min(down ? rect.bottom + 6 : rect.top - height - 6, innerHeight - height - 12),
    )}px`
  }

  const focusItem = (item: SelectItem) => {
    const button = optionRefs.current.get(item.value)
    setActive(item.value)
    button?.focus({ preventScroll: true })
    // Only scroll the option list, never its sidebar/page ancestors.
    const list = button?.parentElement
    if (button && list) {
      const row = button.getBoundingClientRect()
      const bounds = list.getBoundingClientRect()
      if (row.top < bounds.top) list.scrollTop += row.top - bounds.top
      else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom
    }
  }

  const focusOption = (index: number) => {
    const item = enabled[index]
    if (item) focusItem(item)
  }

  const show = (fromKeyboard = false, last = false) => {
    if (disabled) return
    setQuery('')
    setActive(value)
    place()
    panel.current?.showPopover()
    setOpen(true)
    place()
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (!panel.current?.matches(':popover-open')) return
      place()
      if (searchable && !fromKeyboard) {
        search.current?.focus({ preventScroll: true })
      } else {
        const choices = items.filter((item) => !item.disabled)
        const item = last ? choices.at(-1) : choices.find((entry) => entry.value === value) || choices[0]
        if (item) focusItem(item)
        else if (search.current) search.current.focus({ preventScroll: true })
        else panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
      }
    })
  }

  const choose = (item: SelectItem) => {
    if (item.disabled) return
    close()
    if (item.value !== value) onChange(item.value)
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    const inSearch = event.target === search.current
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      focusOption(
        inSearch
          ? event.key === 'ArrowDown'
            ? 0
            : enabled.length - 1
          : moveSelectIndex(activeIndex, enabled.length, event.key === 'ArrowDown' ? 1 : -1),
      )
      return
    }
    if (!inSearch && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault()
      focusOption(event.key === 'Home' ? 0 : enabled.length - 1)
      return
    }
    const isOption =
      event.target instanceof HTMLElement && event.target.getAttribute('role') === 'option'
    if ((inSearch && event.key === 'Enter') || (isOption && (event.key === 'Enter' || event.key === ' '))) {
      event.preventDefault()
      event.stopPropagation()
      if (enabled[activeIndex]) choose(enabled[activeIndex])
      return
    }
    if (!inSearch && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
      const now = event.timeStamp
      typeahead.current = {
        text: (now - typeahead.current.at < 650 ? typeahead.current.text : '') + event.key,
        at: now,
      }
      const match = enabled.findIndex((item) =>
        searchKey(item.label).startsWith(searchKey(typeahead.current.text)),
      )
      if (match >= 0) {
        event.preventDefault()
        focusOption(match)
      }
    }
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return
      close(false)
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])

  return (
    <div className={`select-menu select-menu-${size} ${className}`.trim()} data-size={size}>
      <button
        id={triggerId}
        ref={trigger}
        type="button"
        className="select-menu-trigger"
        role="combobox"
        title={triggerTitle ?? selected?.label ?? placeholder}
        aria-label={`${label}: ${selected?.label || placeholder}`}
        aria-busy={busy || undefined}
        aria-invalid={invalid || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show(true, event.key === 'ArrowUp')
          }
        }}
      >
        <span className="select-menu-value">
          {renderValue ? renderValue(selected) : selected?.label || placeholder}
        </span>
        <ChevronDown size={15} className="select-menu-chevron" aria-hidden="true" />
      </button>

      <div
        ref={panel}
        className={`select-menu-panel select-menu-panel-${size}`}
        popover="auto"
        onToggle={(event) => {
          const isOpen = event.currentTarget.matches(':popover-open')
          setOpen(isOpen)
          if (isOpen) place()
        }}
        onKeyDown={onKey}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget) &&
            event.relatedTarget !== trigger.current
          ) {
            close(false)
          }
        }}
      >
        {heading && <div className="select-menu-heading">{heading}</div>}
        {searchable && (
          <div className="select-menu-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              aria-label={searchPlaceholder}
              aria-controls={listId}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive('')
              }}
            />
            {query && (
              <button
                type="button"
                className="select-menu-clear"
                aria-label={clearLabel}
                onClick={() => {
                  setQuery('')
                  setActive(value)
                  search.current?.focus({ preventScroll: true })
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div id={listId} className="select-menu-list" role="listbox" aria-label={label}>
          {visible.length === 0 ? (
            <div className="select-menu-empty-wrap" role="status">
              <p className="select-menu-empty">
                {query.trim() ? noResultsText || emptyText : emptyText}
              </p>
              {!query.trim() && emptyAction && (
                <div className="select-menu-empty-action" onClickCapture={() => close()}>
                  {emptyAction}
                </div>
              )}
            </div>
          ) : (
            visible.map((item) => (
              <button
                key={item.value}
                ref={(element) => {
                  if (element) optionRefs.current.set(item.value, element)
                  else optionRefs.current.delete(item.value)
                }}
                type="button"
                role="option"
                lang={item.lang}
                data-tone={item.tone}
                aria-selected={item.value === value}
                disabled={item.disabled}
                tabIndex={enabled[activeIndex]?.value === item.value ? 0 : -1}
                className="select-menu-option"
                onFocus={() => setActive(item.value)}
                onClick={() => choose(item)}
              >
                {renderIcon && (
                  <span className="select-menu-option-icon" aria-hidden="true">
                    {renderIcon(item)}
                  </span>
                )}
                <span className="select-menu-option-copy">
                  <span className="select-menu-option-name">{item.label}</span>
                  {item.description && (
                    <span className="select-menu-option-description">{item.description}</span>
                  )}
                </span>
                <span className="select-menu-check" aria-hidden="true">
                  {item.value === value && <Check size={16} />}
                </span>
              </button>
            ))
          )}
        </div>
        {footer && (
          <div className="select-menu-footer" onClickCapture={() => close()}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
})
