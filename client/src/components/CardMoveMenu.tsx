import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpDown,
  ArrowUpToLine,
} from 'lucide-react'
import type { BoardItemKind, BoardMoveDirection } from '../lib/roomUiState'
import './CardMoveMenu.css'

export interface CardMoveMenuLabels {
  moveCard: string
  movePositionGroup: string
  moveColumnGroup: string
  moveUp: string
  moveDown: string
  moveToTop: string
  moveToBottom: string
}

export interface BoardColumnOption {
  kind: BoardItemKind
  label: string
  moveToLabel: string
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>
}

interface CardMoveMenuProps {
  itemId: string
  itemTitle: string
  currentKind: BoardItemKind
  isFirst: boolean
  isLast: boolean
  disabled?: boolean
  labels: CardMoveMenuLabels
  columnOptions: readonly BoardColumnOption[]
  onMoveStep: (itemId: string, direction: BoardMoveDirection) => void
  onMoveToColumn: (itemId: string, targetKind: BoardItemKind) => void
}

/**
 * Progressive-disclosure Kanban move menu rendered in a native top-layer popover
 * so options remain keyboard-accessible and never clip inside scrollable columns.
 */
export const CardMoveMenu = memo(function CardMoveMenu({
  itemId,
  itemTitle,
  currentKind,
  isFirst,
  isLast,
  disabled = false,
  labels,
  columnOptions,
  onMoveStep,
  onMoveToColumn,
}: CardMoveMenuProps) {
  const autoId = useId()
  const menuId = `${autoId}-move-menu`
  const positionGroupId = `${autoId}-pos-group`
  const columnGroupId = `${autoId}-col-group`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const focusLastOnOpenRef = useRef(false)
  const [open, setOpen] = useState(false)

  const place = useCallback(() => {
    const button = triggerRef.current
    const popup = panelRef.current
    if (!button || !popup) return
    const rect = button.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const width = Math.min(244, viewportW - 24)
    const below = Math.max(0, viewportH - rect.bottom - 12)
    const above = Math.max(0, rect.top - 12)
    const natural = popup.scrollHeight || 280
    const down = below >= Math.min(240, natural) || below >= above
    const maxHeight = Math.max(120, Math.min(420, down ? below : above))

    popup.style.width = `${width}px`
    popup.style.maxHeight = `${maxHeight}px`

    const preferredLeft = rect.right - width
    popup.style.left = `${Math.max(12, Math.min(preferredLeft, viewportW - width - 12))}px`
    const renderedHeight = Math.min(popup.scrollHeight || natural, maxHeight)
    const rawTop = down ? rect.bottom + 6 : rect.top - renderedHeight - 6
    popup.style.top = `${Math.max(12, Math.min(rawTop, viewportH - renderedHeight - 12))}px`
  }, [])

  const closeMenu = useCallback((restoreFocus = true) => {
    focusLastOnOpenRef.current = false
    panelRef.current?.hidePopover()
    setOpen(false)
    if (restoreFocus) {
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [])

  const getEnabledMenuItems = useCallback((): HTMLButtonElement[] => {
    const panel = panelRef.current
    if (!panel) return []
    return Array.from(
      panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    )
  }, [])

  const openMenu = useCallback(
    (focusLast = false) => {
      if (disabled) return
      focusLastOnOpenRef.current = focusLast
      setOpen(true)
      const panel = panelRef.current
      if (!panel) return
      if (!panel.matches(':popover-open')) {
        panel.showPopover()
      }
    },
    [disabled]
  )

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel || !panel.matches(':popover-open')) return
    place()
    const enabledItems = getEnabledMenuItems()
    const initialTarget = focusLastOnOpenRef.current ? enabledItems.at(-1) : enabledItems[0]
    initialTarget?.focus({ preventScroll: true })
  }, [getEnabledMenuItems, open, place])

  useEffect(() => {
    if (!open) return
    const handleReposition = () => {
      if (panelRef.current?.matches(':popover-open')) {
        place()
      }
    }
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open, place])

  const handlePanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = getEnabledMenuItems()
    const currentIndex = enabled.findIndex((el) => el === document.activeElement)

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeMenu(true)
      return
    }
    if (e.key === 'Tab') {
      closeMenu(false)
      return
    }
    if (enabled.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (currentIndex + 1) % enabled.length
      enabled[next]?.focus({ preventScroll: true })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = currentIndex <= 0 ? enabled.length - 1 : currentIndex - 1
      enabled[prev]?.focus({ preventScroll: true })
    } else if (e.key === 'Home') {
      e.preventDefault()
      enabled[0]?.focus({ preventScroll: true })
    } else if (e.key === 'End') {
      e.preventDefault()
      enabled.at(-1)?.focus({ preventScroll: true })
    }
  }

  const handleStep = (direction: BoardMoveDirection) => {
    closeMenu(false)
    onMoveStep(itemId, direction)
  }

  const handleColumn = (targetKind: BoardItemKind) => {
    closeMenu(false)
    onMoveToColumn(itemId, targetKind)
  }

  const accessibleTriggerLabel = `${labels.moveCard}: ${itemTitle}`
  const destinationColumns = columnOptions.filter((col) => col.kind !== currentKind)

  return (
    <div className="card-move-menu">
      <button
        ref={triggerRef}
        type="button"
        className="card-btn-icon card-move-trigger"
        data-card-move-trigger={itemId}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={accessibleTriggerLabel}
        title={labels.moveCard}
        onClick={(e) => {
          e.stopPropagation()
          if (open) closeMenu(true)
          else openMenu(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openMenu(false)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            openMenu(true)
          }
        }}
      >
        <ArrowUpDown size={13} aria-hidden="true" />
      </button>

      <div
        ref={panelRef}
        id={menuId}
        role="menu"
        aria-label={accessibleTriggerLabel}
        popover="auto"
        className="card-move-menu-panel"
        onToggle={(e) => {
          const isOpen = e.currentTarget.matches(':popover-open')
          setOpen(isOpen)
          if (isOpen) place()
        }}
        onKeyDown={handlePanelKeyDown}
        onBlur={(e) => {
          if (
            e.relatedTarget instanceof Node &&
            !e.currentTarget.contains(e.relatedTarget) &&
            e.relatedTarget !== triggerRef.current
          ) {
            closeMenu(false)
          }
        }}
      >
        {open && (
          <div className="card-move-menu-scroll">
            <div className="card-move-menu-group" role="group" aria-labelledby={positionGroupId}>
              <div id={positionGroupId} className="card-move-menu-heading">
                {labels.movePositionGroup}
              </div>
              <button
                type="button"
                role="menuitem"
                className="card-move-menu-item"
                disabled={isFirst}
                onClick={() => handleStep('up')}
              >
                <ArrowUp size={14} aria-hidden="true" />
                <span>{labels.moveUp}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-move-menu-item"
                disabled={isLast}
                onClick={() => handleStep('down')}
              >
                <ArrowDown size={14} aria-hidden="true" />
                <span>{labels.moveDown}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-move-menu-item"
                disabled={isFirst}
                onClick={() => handleStep('top')}
              >
                <ArrowUpToLine size={14} aria-hidden="true" />
                <span>{labels.moveToTop}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="card-move-menu-item"
                disabled={isLast}
                onClick={() => handleStep('bottom')}
              >
                <ArrowDownToLine size={14} aria-hidden="true" />
                <span>{labels.moveToBottom}</span>
              </button>
            </div>

            <div className="card-move-menu-divider" role="separator" />

            <div className="card-move-menu-group" role="group" aria-labelledby={columnGroupId}>
              <div id={columnGroupId} className="card-move-menu-heading">
                {labels.moveColumnGroup}
              </div>
              {destinationColumns.map((col) => {
                const ColIcon = col.icon
                return (
                  <button
                    key={col.kind}
                    type="button"
                    role="menuitem"
                    className="card-move-menu-item"
                    onClick={() => handleColumn(col.kind)}
                  >
                    <ColIcon size={14} aria-hidden="true" />
                    <span>{col.moveToLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
