import { createT, type Language } from '../../i18n'
import { useEffect, useId, useRef, useState } from 'react'
import { Camera, Trash2, Check, Plus, X, Info } from 'lucide-react'
import { personInitials } from '../../lib/shellState'
import './AvatarPicker.css'
import './AvatarPopover.css'

type Props = {
  value: string | null
  name: string
  color?: string
  lang: Language
  disabled?: boolean
  unsupported?: boolean
  unsupportedReason?: string
  onChange: (image: string | null) => void
  onBusy: (busy: boolean) => void
}

export function AvatarPicker({
  value,
  name,
  color = '#53664b',
  lang,
  disabled,
  unsupported,
  unsupportedReason,
  onChange,
  onBusy,
}: Props) {
  const t = createT(lang)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const popupId = useId()
  const noteId = useId()
  const [open, setOpen] = useState(false)
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: 16, top: 16 })
  const close = () => {
    popup.current?.hidePopover()
    trigger.current?.focus()
  }
  const place = () => {
    const rect = trigger.current?.getBoundingClientRect()
    const height = popup.current?.offsetHeight || 330
    if (rect) {
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 276)),
        top: Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - height - 12)),
      })
    }
  }
  const revision = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { revision.current++ }, [])
  useEffect(() => { if (open) place() }, [open, error])
  useEffect(() => {
    if (!open) return
    const dismiss = () => popup.current?.hidePopover()
    window.addEventListener('resize', dismiss)
    return () => window.removeEventListener('resize', dismiss)
  }, [open])

  const choose = async (file?: File) => {
    if (!file) return
    const current = ++revision.current
    setError('')
    setBusy(true)
    onBusy(true)
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        throw new Error(t('avatar.invalidTypeOrSize'))
      }
      const bitmap = await createImageBitmap(file)
      try {
        if (bitmap.width > 8192 || bitmap.height > 8192 || !bitmap.width || !bitmap.height) {
          throw new Error(t('avatar.dimensionsTooLarge'))
        }
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 256
        const context = canvas.getContext('2d')
        if (!context) throw new Error(t('avatar.processFailed'))
        context.fillStyle = '#eeece1'
        context.fillRect(0, 0, 256, 256)
        const size = Math.min(bitmap.width, bitmap.height)
        context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256)
        const image = canvas.toDataURL('image/jpeg', 0.86)
        if (current === revision.current) {
          setBrokenSrc(null)
          onChange(image)
          close()
        }
      } finally {
        bitmap.close()
      }
    } catch (err) {
      if (current === revision.current) {
        setError(err instanceof Error ? err.message : t('avatar.readFailed'))
      }
    } finally {
      if (current === revision.current) {
        setBusy(false)
        onBusy(false)
      }
      if (input.current) input.current.value = ''
    }
  }

  const showImage = Boolean(value && value !== brokenSrc)
  const fallbackName = name.trim() || t('avatar.memberFallback')

  if (unsupported) {
    const explanation = unsupportedReason || t('avatar.unsupportedNote')

    return (
      <div className="avatar-picker is-unsupported">
        <div className="avatar-trigger-row is-unsupported">
          <div
            className="avatar-picker-readonly"
            style={{ background: color }}
            role="img"
            aria-label={t('avatar.initialsAria', { initials: personInitials(fallbackName) })}
            aria-describedby={noteId}
          >
            <span>{personInitials(fallbackName)}</span>
          </div>
          <div className="avatar-readonly-copy">
            <div className="avatar-heading-row">
              <strong>{t('avatar.heading')}</strong>
              <span className="avatar-mode-badge">
                <Info size={11} aria-hidden="true" />
                {t('avatar.unsupportedBadge')}
              </span>
            </div>
            <p className="avatar-unsupported-note" id={noteId}>
              {explanation}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="avatar-picker">
      <div className="avatar-trigger-row">
        <button
          ref={trigger}
          type="button"
          className="avatar-picker-trigger"
          style={{ background: showImage ? '#e7e5d9' : color }}
          popoverTarget={popupId}
          aria-expanded={open}
          aria-label={t('avatar.changeAria')}
          title={t('avatar.changeAria')}
          onClick={place}
          disabled={disabled || busy}
        >
          {showImage && value ? (
            <img
              src={value}
              alt=""
              onError={() => {
                setBrokenSrc(value)
              }}
            />
          ) : (
            <span>{personInitials(fallbackName)}</span>
          )}
          <span className="avatar-camera-badge" aria-hidden="true">
            <Camera size={12} aria-hidden="true" />
          </span>
        </button>
        <div>
          <strong>{t('avatar.heading')}</strong>
          <small>
            {busy ? t('avatar.processing') : t('avatar.changePrompt')}
          </small>
        </div>
      </div>
      <div
        ref={popup}
        id={popupId}
        popover="auto"
        role="dialog"
        aria-label={t('avatar.pickerTitle')}
        className="avatar-popover"
        style={position}
        onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
      >
        <div className="avatar-popover-heading">
          <strong>{t('avatar.pickerTitle')}</strong>
          <button
            type="button"
            onClick={close}
            aria-label={t('avatar.closePickerAria')}
            title={t('avatar.closePickerAria')}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="avatar-popover-grid" role="group" aria-label={t('avatar.libraryAria')}>
          {Array.from({ length: 8 }, (_, index) => {
            const source = `/avatars/notionist-${String(index + 1).padStart(2, '0')}.svg`
            return (
              <button
                key={source}
                type="button"
                aria-label={t('avatar.selectPreset', { index: index + 1 })}
                aria-pressed={value === source}
                disabled={disabled || busy}
                onClick={() => {
                  setError('')
                  setBrokenSrc(null)
                  onChange(source)
                  close()
                }}
              >
                <img src={source} alt="" />
                {value === source && (
                  <span aria-hidden="true">
                    <Check size={11} aria-hidden="true" />
                  </span>
                )}
              </button>
            )
          })}
          <button
            type="button"
            className="avatar-upload-slot"
            disabled={disabled || busy}
            aria-label={t('avatar.uploadFromDevice')}
            title={t('avatar.uploadFromDevice')}
            onClick={() => input.current?.click()}
          >
            <Plus size={23} aria-hidden="true" />
          </button>
        </div>
        <div className="avatar-popover-footer">
          {value && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                setError('')
                setBrokenSrc(null)
                onChange(null)
                close()
              }}
            >
              <Trash2 size={12} aria-hidden="true" />
              {t('avatar.removeImage')}
            </button>
          )}
          <small>{t('avatar.fileRequirements')}</small>
        </div>
        {error && (
          <p className="avatar-picker-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label={t('avatar.fileInputAria')}
        onChange={event => void choose(event.target.files?.[0])}
        disabled={disabled || busy}
      />
      {error && (
        <p className="avatar-picker-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
