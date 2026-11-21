import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { useMotionPresent } from './useMotionPresent'

/** Shared keyboard behavior for app-owned modal dialogs; native popovers get Escape first. */
export function useDialogFocus(active: string | boolean, onClose: () => void, selector: string) {
  const present = useMotionPresent()
  const enabled = present && active
  const close = useRef(onClose)
  const titleId = useId()
  useLayoutEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    if (!enabled) return
    const dialog = Array.from(document.querySelectorAll<HTMLElement>(selector)).at(-1)
    if (!dialog) return
    const activeEl = document.activeElement
    const previous =
      activeEl instanceof HTMLElement &&
      activeEl !== document.body &&
      activeEl !== document.documentElement
        ? activeEl
        : null
    const attributes = ['role','aria-modal','aria-labelledby'].map(name => [name,dialog.getAttribute(name)] as const)
    if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const heading = dialog.querySelector<HTMLElement>('h2,h3')
    if (!dialog.hasAttribute('aria-label') && heading) { heading.id ||= titleId; dialog.setAttribute('aria-labelledby', heading.id) }
    const focusables = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ),
      ).filter((item) => item.getClientRects().length > 0 && !item.closest('[inert], [aria-hidden="true"]'))
    const preferred =
      focusables().find((item) => item.matches('[autofocus], [data-autofocus]')) ??
      focusables().find((item) =>
        item.matches(
          '.select-menu-trigger, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select, [role="combobox"]',
        ),
      ) ??
      focusables().find((item) => !item.closest('.modal-header')) ??
      focusables()[0]
    preferred?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (dialog.closest('[inert]')) return
      if (event.defaultPrevented) return
      if (event.key === 'Escape' && document.querySelector(':popover-open')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current() }
      if (event.key === 'Tab') {
        const items = focusables(), first = items[0], last = items.at(-1)
        if (!first) { event.preventDefault(); return }
        if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      for (const [name, value] of attributes) {
        if (value === null) dialog.removeAttribute(name)
        else dialog.setAttribute(name, value)
      }
      if (
        previous &&
        previous.isConnected &&
        !previous.closest('[inert], [aria-hidden="true"]') &&
        previous.getClientRects().length > 0
      ) {
        previous.focus({ preventScroll: true })
        if (document.activeElement === previous) return
      }
      const fallback = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.app-header .sidebar-brand-toggle, .app-header .mobile-menu-btn, .app-header .room-nav-toggle, .workspace-picker .select-menu-trigger',
        ),
      ).find((el) => !el.closest('[inert], [aria-hidden="true"]') && el.getClientRects().length > 0)
      fallback?.focus({ preventScroll: true })
    }
  }, [enabled, selector, titleId])
}
