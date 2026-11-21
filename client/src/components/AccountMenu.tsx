import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronsUpDown, LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { LanguageSelect } from './LanguageSelect'
import { createT, type Language } from '../i18n'
import { personInitials } from '../lib/shellState'
import './AccountMenu.css'

type Props = {
  name: string
  email: string
  avatar?: string | null
  lang: Language
  theme: 'light' | 'dark'
  onProfile: () => void
  onLanguage: (lang: Props['lang']) => void
  onTheme: () => void
  onLogout: () => void
}

export const AccountMenu = memo(function AccountMenu(props: Props) {
  const id = useId()
  const t = createT(props.lang)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const firstAction = useRef<HTMLButtonElement>(null)
  const frame = useRef(0)
  const [open, setOpen] = useState(false)
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null)

  const showImage = Boolean(props.avatar && brokenAvatar !== props.avatar)
  const monogram = personInitials(props.name)

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
    const width = Math.min(276, innerWidth - 24)
    const maxHeight = Math.max(140, innerHeight - 24)
    popup.style.width = `${width}px`
    popup.style.maxHeight = `${maxHeight}px`

    const naturalHeight = popup.scrollHeight || 296
    const height = Math.min(naturalHeight, maxHeight)
    const spaceAbove = rect.top - 12
    const canPlaceRight = rect.width <= 64 && innerWidth - rect.right - 20 >= width

    let left = Math.max(12, Math.min(rect.left, innerWidth - width - 12))
    let top = rect.top - height - 8

    if (spaceAbove < height && canPlaceRight) {
      left = Math.min(rect.right + 10, innerWidth - width - 12)
      top = Math.max(12, Math.min(rect.bottom - height, innerHeight - height - 12))
    } else {
      top = Math.max(12, Math.min(top, innerHeight - height - 12))
    }

    popup.style.left = `${left}px`
    popup.style.top = `${top}px`
  }

  const show = () => {
    place()
    panel.current?.showPopover()
    setOpen(true)
    place()
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (!panel.current?.matches(':popover-open')) return
      place()
      firstAction.current?.focus({ preventScroll: true })
    })
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
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
    <>
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        title={`${props.name} (${props.email})`}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
        aria-label={t('account.openMenuNamedAria', { name: props.name })}
        onClick={() => (open ? close(true) : show())}
      >
        <span className="account-trigger-avatar" aria-hidden="true">
          {showImage ? (
            <img
              src={props.avatar!}
              alt=""
              onError={() => setBrokenAvatar(props.avatar ?? null)}
            />
          ) : (
            monogram
          )}
        </span>
        <span className="account-trigger-text">
          <strong>{props.name}</strong>
          <small>{props.email}</small>
        </span>
        <ChevronsUpDown size={15} aria-hidden="true" />
      </button>

      <div
        id={id}
        ref={panel}
        popover="auto"
        className="account-popover"
        role="dialog"
        aria-label={t('account.dialogAria')}
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
        <div className="account-menu-identity">
          <span className="account-menu-avatar" aria-hidden="true">
            {showImage ? (
              <img
                src={props.avatar!}
                alt=""
                onError={() => setBrokenAvatar(props.avatar ?? null)}
              />
            ) : (
              monogram
            )}
          </span>
          <div className="account-menu-identity-copy">
            <strong>{props.name}</strong>
            <small>{props.email}</small>
          </div>
        </div>

        <button
          ref={firstAction}
          type="button"
          onClick={() => {
            close(false)
            props.onProfile()
          }}
        >
          <UserRound size={16} aria-hidden="true" />
          <span>{t('account.profileAction')}</span>
          <small aria-hidden="true">↗</small>
        </button>

        <p>{t('common.appearanceHeading')}</p>

        <button
          type="button"
          role="switch"
          aria-checked={props.theme === 'dark'}
          aria-label={t('common.darkThemeSwitch')}
          onClick={props.onTheme}
        >
          {props.theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          <span>{t('common.darkThemeSwitch')}</span>
          <span aria-hidden="true" className={`account-theme-switch ${props.theme === 'dark' ? 'on' : ''}`}>
            <i />
          </span>
        </button>

        <LanguageSelect value={props.lang} onChange={props.onLanguage} variant="menu-row" />

        <div className="account-menu-divider" />

        <button
          type="button"
          className="account-logout"
          onClick={() => {
            close(false)
            props.onLogout()
          }}
        >
          <LogOut size={16} aria-hidden="true" />
          <span>{t('account.signOut')}</span>
        </button>
      </div>
    </>
  )
})
