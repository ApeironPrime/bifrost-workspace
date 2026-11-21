import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  resolveVisualDropSlotToTargetIndex,
  type BoardItemKind,
  type MeetingBoardItem,
} from './roomUiState'

export interface ActiveBoardDrag {
  itemId: string
  title: string
  sourceKind: BoardItemKind
  width: number
  height: number
  initialX: number
  initialY: number
  pointerType: string
}

interface PendingDrag {
  itemId: string
  title: string
  sourceKind: BoardItemKind
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  thresholdPx: number
  width: number
  height: number
  cardLeft: number
  cardTop: number
  grabOffsetX: number
  grabOffsetY: number
  handleEl: HTMLElement | null
}

interface ComputedDropTarget {
  kind: BoardItemKind
  targetIndex: number
  isNoOp: boolean
  hintText: string
  colEl: HTMLElement
  listEl: HTMLElement | null
  edgeCardEl: HTMLElement | null
  edge: 'before' | 'after' | null
  isEmptyTarget: boolean
}

interface UseBoardPointerDragOptions {
  boardGridRef: RefObject<HTMLDivElement | null>
  previewRef: RefObject<HTMLDivElement | null>
  previewHintRef: RefObject<HTMLDivElement | null>
  itemsByColumn: Record<BoardItemKind, MeetingBoardItem[]>
  readOnly: boolean
  formatDropHint: (params: {
    targetKind: BoardItemKind
    targetCardTitle?: string
    edge?: 'before' | 'after' | null
  }) => string
  onCommitDrop: (itemId: string, targetKind: BoardItemKind, targetIndex: number) => void
}

const INTERACTIVE_DESCENDANT_SELECTOR =
  'button:not([data-drag-handle]), a, input, textarea, select, label, [role="menu"], [role="menuitem"], [popover], .select-menu'

/**
 * Isolated pointer-events drag coordinator for Kanban cards.
 * Keeps pointer coordinates in refs + rAF CSS transforms so hovering never triggers App/Board re-renders.
 */
export function useBoardPointerDrag({
  boardGridRef,
  previewRef,
  previewHintRef,
  itemsByColumn,
  readOnly,
  formatDropHint,
  onCommitDrop,
}: UseBoardPointerDragOptions) {
  const [activeDrag, setActiveDrag] = useState<ActiveBoardDrag | null>(null)

  const pendingRef = useRef<PendingDrag | null>(null)
  const activeDragRef = useRef<ActiveBoardDrag | null>(null)
  const grabOffsetRef = useRef({ x: 0, y: 0 })
  const latestPointerRef = useRef({ x: 0, y: 0 })
  const itemsByColumnRef = useRef(itemsByColumn)
  const readOnlyRef = useRef(readOnly)
  const formatDropHintRef = useRef(formatDropHint)
  const onCommitDropRef = useRef(onCommitDrop)

  const rafMoveRef = useRef(0)
  const rafAutoScrollRef = useRef(0)
  const lastTargetRef = useRef<ComputedDropTarget | null>(null)
  const markedColRef = useRef<HTMLElement | null>(null)
  const markedCardRef = useRef<HTMLElement | null>(null)
  const markedEmptyRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    itemsByColumnRef.current = itemsByColumn
  }, [itemsByColumn])

  useEffect(() => {
    readOnlyRef.current = readOnly
  }, [readOnly])

  useEffect(() => {
    formatDropHintRef.current = formatDropHint
  }, [formatDropHint])

  useEffect(() => {
    onCommitDropRef.current = onCommitDrop
  }, [onCommitDrop])

  const clearDomIndicators = useCallback(() => {
    if (markedColRef.current) {
      markedColRef.current.removeAttribute('data-drop-active')
      markedColRef.current.classList.remove('column-drop-active')
      markedColRef.current = null
    }
    if (markedCardRef.current) {
      markedCardRef.current.removeAttribute('data-drop-edge')
      markedCardRef.current = null
    }
    if (markedEmptyRef.current) {
      markedEmptyRef.current.removeAttribute('data-drop-empty')
      markedEmptyRef.current = null
    }
    if (previewHintRef.current) {
      previewHintRef.current.textContent = ''
    }
  }, [previewHintRef])

  const hitTestDropTarget = useCallback(
    (clientX: number, clientY: number, currentDrag: ActiveBoardDrag): ComputedDropTarget | null => {
      const gridEl = boardGridRef.current
      if (!gridEl) return null
      const gridRect = gridEl.getBoundingClientRect()
      if (
        clientX < gridRect.left - 16 ||
        clientX > gridRect.right + 16 ||
        clientY < gridRect.top - 16 ||
        clientY > gridRect.bottom + 16
      ) {
        return null
      }

      const columnEls = Array.from(gridEl.querySelectorAll<HTMLElement>('[data-board-column]'))
      let matchedColEl: HTMLElement | null = null
      let matchedKind: BoardItemKind | null = null
      let nearestGapDist = Number.POSITIVE_INFINITY

      for (const colEl of columnEls) {
        const rect = colEl.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        if (clientY < rect.top - 10 || clientY > rect.bottom + 10) continue

        const kind = colEl.dataset.boardColumn as BoardItemKind | undefined
        if (!kind) continue

        if (clientX >= rect.left && clientX <= rect.right) {
          matchedColEl = colEl
          matchedKind = kind
          break
        }

        const gapDist = clientX < rect.left ? rect.left - clientX : clientX - rect.right
        if (gapDist <= 22 && gapDist < nearestGapDist) {
          nearestGapDist = gapDist
          matchedColEl = colEl
          matchedKind = kind
        }
      }

      if (!matchedColEl || !matchedKind) return null

      const listEl = matchedColEl.querySelector<HTMLElement>('.column-cards-list')
      const colItems = itemsByColumnRef.current[matchedKind] ?? []
      const cardEls = listEl
        ? Array.from(listEl.querySelectorAll<HTMLElement>('[data-board-card-id]'))
        : []

      if (cardEls.length === 0) {
        const placeholderEl = matchedColEl.querySelector<HTMLElement>('.column-empty-placeholder')
        return {
          kind: matchedKind,
          targetIndex: 0,
          isNoOp: false,
          hintText: formatDropHintRef.current({ targetKind: matchedKind }),
          colEl: matchedColEl,
          listEl: placeholderEl ?? listEl,
          edgeCardEl: null,
          edge: null,
          isEmptyTarget: true,
        }
      }

      let rawSlotIndex = cardEls.length
      let edgeCardEl: HTMLElement | null = cardEls[cardEls.length - 1] ?? null
      let edge: 'before' | 'after' | null = 'after'

      for (let i = 0; i < cardEls.length; i++) {
        const cardEl = cardEls[i]
        const rect = cardEl.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        if (clientY < midY) {
          rawSlotIndex = i
          edgeCardEl = cardEl
          edge = 'before'
          break
        }
        if (clientY <= rect.bottom + 6) {
          rawSlotIndex = i + 1
          edgeCardEl = cardEl
          edge = 'after'
          break
        }
      }

      const targetIndex = resolveVisualDropSlotToTargetIndex({
        columnItems: colItems,
        draggedItemId: currentDrag.itemId,
        rawSlotIndex,
      })

      const sourceIndex =
        matchedKind === currentDrag.sourceKind
          ? colItems.findIndex((item) => item.id === currentDrag.itemId)
          : -1
      const isNoOp = sourceIndex >= 0 && targetIndex === sourceIndex

      const targetCardId = edgeCardEl?.dataset.boardCardId
      const targetCardTitle = targetCardId
        ? colItems.find((item) => item.id === targetCardId)?.title
        : undefined

      return {
        kind: matchedKind,
        targetIndex,
        isNoOp,
        hintText: isNoOp
          ? ''
          : formatDropHintRef.current({
              targetKind: matchedKind,
              targetCardTitle,
              edge,
            }),
        colEl: matchedColEl,
        listEl,
        edgeCardEl: isNoOp ? null : edgeCardEl,
        edge: isNoOp ? null : edge,
        isEmptyTarget: false,
      }
    },
    [boardGridRef]
  )

  const applyVisualDropTarget = useCallback(
    (target: ComputedDropTarget | null) => {
      if (!target) {
        clearDomIndicators()
        lastTargetRef.current = null
        return
      }

      if (markedColRef.current && markedColRef.current !== target.colEl) {
        markedColRef.current.removeAttribute('data-drop-active')
        markedColRef.current.classList.remove('column-drop-active')
      }
      target.colEl.setAttribute('data-drop-active', 'true')
      target.colEl.classList.add('column-drop-active')
      markedColRef.current = target.colEl

      if (markedCardRef.current && markedCardRef.current !== target.edgeCardEl) {
        markedCardRef.current.removeAttribute('data-drop-edge')
      }
      if (target.edgeCardEl && target.edge) {
        target.edgeCardEl.setAttribute('data-drop-edge', target.edge)
        markedCardRef.current = target.edgeCardEl
      } else {
        if (markedCardRef.current) {
          markedCardRef.current.removeAttribute('data-drop-edge')
          markedCardRef.current = null
        }
      }

      const emptyEl = target.isEmptyTarget ? target.listEl : null
      if (markedEmptyRef.current && markedEmptyRef.current !== emptyEl) {
        markedEmptyRef.current.removeAttribute('data-drop-empty')
      }
      if (emptyEl) {
        emptyEl.setAttribute('data-drop-empty', 'true')
        markedEmptyRef.current = emptyEl
      } else {
        markedEmptyRef.current = null
      }

      if (previewHintRef.current) {
        previewHintRef.current.textContent = target.hintText
      }

      lastTargetRef.current = target
    },
    [clearDomIndicators, previewHintRef]
  )

  const updatePointerVisuals = useCallback(
    (clientX: number, clientY: number) => {
      const drag = activeDragRef.current
      if (!drag) return

      const nextLeft = clientX - grabOffsetRef.current.x
      const nextTop = clientY - grabOffsetRef.current.y
      if (previewRef.current) {
        previewRef.current.style.transform = `translate3d(${nextLeft}px, ${nextTop}px, 0)`
      }

      const nextTarget = hitTestDropTarget(clientX, clientY, drag)
      applyVisualDropTarget(nextTarget)
    },
    [applyVisualDropTarget, hitTestDropTarget, previewRef]
  )

  const stopDrag = useCallback(
    (commit: boolean) => {
      cancelAnimationFrame(rafMoveRef.current)
      cancelAnimationFrame(rafAutoScrollRef.current)
      rafMoveRef.current = 0
      rafAutoScrollRef.current = 0

      const drag = activeDragRef.current
      const pending = pendingRef.current
      const finalTarget = lastTargetRef.current

      if (pending?.handleEl) {
        try {
          if (pending.handleEl.hasPointerCapture(pending.pointerId)) {
            pending.handleEl.releasePointerCapture(pending.pointerId)
          }
        } catch {
          /* Ignore unsupported synthetic capture state */
        }
      }

      pendingRef.current = null
      activeDragRef.current = null
      lastTargetRef.current = null
      clearDomIndicators()
      setActiveDrag(null)

      if (commit && drag && finalTarget && !finalTarget.isNoOp && !readOnlyRef.current) {
        onCommitDropRef.current(drag.itemId, finalTarget.kind, finalTarget.targetIndex)
      }
    },
    [clearDomIndicators]
  )

  useEffect(() => {
    const drag = activeDrag
    if (!drag) return

    // Cancel drag on next animation frame if the dragged card disappears (e.g., peer delete or room switch)
    const exists = itemsByColumn[drag.sourceKind]?.some((item) => item.id === drag.itemId)
    if (!exists || readOnly) {
      const id = requestAnimationFrame(() => stopDrag(false))
      return () => cancelAnimationFrame(id)
    }

    updatePointerVisuals(latestPointerRef.current.x, latestPointerRef.current.y)
  }, [activeDrag, itemsByColumn, readOnly, stopDrag, updatePointerVisuals])

  useEffect(() => {
    const runAutoScroll = () => {
      if (!activeDragRef.current) return
      const { x, y } = latestPointerRef.current
      const gridEl = boardGridRef.current
      if (gridEl && gridEl.scrollWidth > gridEl.clientWidth) {
        const gRect = gridEl.getBoundingClientRect()
        const edgeMargin = 42
        if (x >= gRect.left && x <= gRect.left + edgeMargin) {
          gridEl.scrollLeft -= 8
        } else if (x <= gRect.right && x >= gRect.right - edgeMargin) {
          gridEl.scrollLeft += 8
        }
      }

      const activeColEl = markedColRef.current
      const cardsList = activeColEl?.querySelector<HTMLElement>('.column-cards-list')
      if (cardsList && cardsList.scrollHeight > cardsList.clientHeight) {
        const lRect = cardsList.getBoundingClientRect()
        const edgeMargin = 38
        if (y >= lRect.top && y <= lRect.top + edgeMargin) {
          cardsList.scrollTop -= 7
        } else if (y <= lRect.bottom && y >= lRect.bottom - edgeMargin) {
          cardsList.scrollTop += 7
        }
      }

      const panelEl = gridEl?.closest<HTMLElement>('.meeting-board-panel')
      if (panelEl && panelEl.scrollHeight > panelEl.clientHeight) {
        const pRect = panelEl.getBoundingClientRect()
        const edgeMargin = 42
        if (y >= pRect.top && y <= pRect.top + edgeMargin) {
          panelEl.scrollTop -= 8
        } else if (y <= pRect.bottom && y >= pRect.bottom - edgeMargin) {
          panelEl.scrollTop += 8
        }
      }

      rafAutoScrollRef.current = requestAnimationFrame(runAutoScroll)
    }

    const handlePointerMove = (e: PointerEvent) => {
      const pending = pendingRef.current
      const currentDrag = activeDragRef.current
      if (!pending && !currentDrag) return
      if (pending && e.pointerId !== pending.pointerId) return

      latestPointerRef.current = { x: e.clientX, y: e.clientY }

      if (!currentDrag && pending) {
        const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY)
        if (dist < pending.thresholdPx) return

        if (readOnlyRef.current) {
          pendingRef.current = null
          return
        }

        window.getSelection()?.removeAllRanges()
        if (pending.handleEl) {
          try {
            pending.handleEl.setPointerCapture(pending.pointerId)
          } catch {
            /* Fallback window listeners stay active */
          }
        }

        const nextDrag: ActiveBoardDrag = {
          itemId: pending.itemId,
          title: pending.title,
          sourceKind: pending.sourceKind,
          width: pending.width,
          height: pending.height,
          initialX: e.clientX - pending.grabOffsetX,
          initialY: e.clientY - pending.grabOffsetY,
          pointerType: pending.pointerType,
        }
        grabOffsetRef.current = { x: pending.grabOffsetX, y: pending.grabOffsetY }
        activeDragRef.current = nextDrag
        setActiveDrag(nextDrag)
        rafAutoScrollRef.current = requestAnimationFrame(runAutoScroll)
        return
      }

      if (currentDrag) {
        cancelAnimationFrame(rafMoveRef.current)
        rafMoveRef.current = requestAnimationFrame(() => {
          updatePointerVisuals(latestPointerRef.current.x, latestPointerRef.current.y)
        })
      }
    }

    const handlePointerUp = (e: PointerEvent) => {
      const pending = pendingRef.current
      if (pending && e.pointerId !== pending.pointerId) return
      if (!pending && !activeDragRef.current) return

      if (activeDragRef.current) {
        updatePointerVisuals(e.clientX, e.clientY)
        stopDrag(true)
      } else {
        pendingRef.current = null
      }
    }

    const handleCancel = (e?: PointerEvent) => {
      const pending = pendingRef.current
      if (e && pending && e.pointerId !== pending.pointerId) return
      if (!pending && !activeDragRef.current) return
      stopDrag(false)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeDragRef.current) {
        e.preventDefault()
        e.stopPropagation()
        stopDrag(false)
      }
    }

    const handleWindowBlur = () => {
      if (pendingRef.current || activeDragRef.current) {
        stopDrag(false)
      }
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handleCancel)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handleCancel)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [boardGridRef, stopDrag, updatePointerVisuals])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafMoveRef.current)
      cancelAnimationFrame(rafAutoScrollRef.current)
      clearDomIndicators()
      pendingRef.current = null
      activeDragRef.current = null
      lastTargetRef.current = null
    }
  }, [clearDomIndicators])

  const startCardPointerDown = useCallback(
    (
      e: ReactPointerEvent<HTMLElement>,
      item: { id: string; title: string; kind: BoardItemKind }
    ) => {
      if (readOnlyRef.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const targetEl = e.target as HTMLElement | null
      const handleEl = targetEl?.closest<HTMLElement>('[data-drag-handle]') ?? null

      // Touch users must grab the dedicated handle (touch-action: none) so page/column vertical scroll stays smooth.
      if (e.pointerType === 'touch' && !handleEl) {
        return
      }

      if (!handleEl) {
        if (e.detail >= 2) return
        if (targetEl?.closest(INTERACTIVE_DESCENDANT_SELECTOR)) return
      } else {
        e.preventDefault()
      }

      const cardEl = e.currentTarget
      const rect = cardEl.getBoundingClientRect()

      latestPointerRef.current = { x: e.clientX, y: e.clientY }
      pendingRef.current = {
        itemId: item.id,
        title: item.title,
        sourceKind: item.kind,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        thresholdPx: e.pointerType === 'touch' || handleEl ? 4 : 6,
        width: rect.width,
        height: rect.height,
        cardLeft: rect.left,
        cardTop: rect.top,
        grabOffsetX: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
        grabOffsetY: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
        handleEl,
      }
    },
    []
  )

  return {
    activeDrag,
    startCardPointerDown,
    cancelDrag: useCallback(() => stopDrag(false), [stopDrag]),
  }
}
