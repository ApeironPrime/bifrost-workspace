import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { createT, type Language } from '../i18n'
import { apiUrl, fetchAppApi } from '../lib/appApi'
import {
  LABEL_COLOR_PALETTE,
  getLabelColorName,
  getLabelPriorityItems,
  getPriorityTierLabel,
} from '../lib/controlPrimitives'
import { SelectMenu } from './SelectMenu'

export type RoomLabel = {
  id: string
  roomId: string
  name: string
  color: string
  priority: number
}

export function RoomLabelsEditor({
  workspaceId,
  roomId,
  token,
  labels,
  lang,
  onChange,
  onBusy,
  onDirtyChange,
}: {
  workspaceId: string
  roomId: string
  token: string
  labels: RoomLabel[]
  lang: Language
  onChange: (labels: RoomLabel[]) => void
  onBusy?: (busy: boolean) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const t = createT(lang)
  const baseId = useId()
  const nameId = `${baseId}-name`
  const nameHintId = `${baseId}-name-hint`
  const priorityId = `${baseId}-priority`
  const colorGroupId = `${baseId}-color`

  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([])
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [editing, setEditing] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(LABEL_COLOR_PALETTE[0].value)
  const [priority, setPriority] = useState(100)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<RoomLabel | null>(null)

  const isDirty = Boolean(
    editing !== '' ||
      name.trim().length > 0 ||
      color.toLowerCase() !== LABEL_COLOR_PALETTE[0].value.toLowerCase() ||
      priority !== 100,
  )

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    return () => {
      onDirtyChange?.(false)
    }
  }, [onDirtyChange])

  useEffect(() => {
    if (!deleting) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDeleting(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [deleting])

  const roomLabels = labels
    .filter((label) => label.roomId === roomId)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))

  const priorityItems = getLabelPriorityItems(priority, lang)

  const reset = () => {
    setEditing('')
    setName('')
    setColor(LABEL_COLOR_PALETTE[0].value)
    setPriority(100)
    setError('')
  }

  const save = async () => {
    if (busy) return
    if (name.trim().length < 2) {
      setError(t('labels.nameTooShort'))
      nameInputRef.current?.focus()
      return
    }
    setBusy(true)
    onBusy?.(true)
    setError('')
    try {
      const response = await fetchAppApi(
        apiUrl(`/workspaces/${workspaceId}/rooms/${roomId}/roles${editing ? `/${editing}` : ''}`),
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), color, priority }),
        },
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      onChange([...labels.filter((label) => label.id !== body.label.id), body.label])
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('labels.saveError'))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  const remove = async (label: RoomLabel) => {
    if (busy) return
    setBusy(true)
    onBusy?.(true)
    setError('')
    try {
      const response = await fetchAppApi(
        apiUrl(`/workspaces/${workspaceId}/rooms/${roomId}/roles/${label.id}`),
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      onChange(labels.filter((item) => item.id !== label.id))
      setDeleting(null)
      if (editing === label.id) reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('labels.deleteError'))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  const onSwatchKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const total = LABEL_COLOR_PALETTE.length
    let nextIndex = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % total
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + total) % total
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = total - 1
    }
    if (nextIndex >= 0) {
      event.preventDefault()
      const target = LABEL_COLOR_PALETTE[nextIndex]
      setColor(target.value)
      swatchRefs.current[nextIndex]?.focus()
    }
  }

  const activeSwatchIndex = Math.max(
    0,
    LABEL_COLOR_PALETTE.findIndex((item) => item.value === color.toLowerCase()),
  )

  return (
    <section
      className="room-label-editor"
      aria-label={t('labels.sectionTitle')}
    >
      <p className="room-label-lead">
        {t('labels.sectionDesc')}
      </p>

      {roomLabels.length === 0 ? (
        <p className="room-label-empty">
          {t('labels.empty')}
        </p>
      ) : (
        <div className="room-label-management-list">
          {roomLabels.map((label) => {
            const colorName = getLabelColorName(label.color, lang)
            const tierName = getPriorityTierLabel(label.priority, lang)
            return (
              <div
                className={`room-label-management-row ${editing === label.id ? 'is-editing' : ''}`}
                key={label.id}
              >
                <div className="room-label-summary">
                  <span
                    className="label-swatch-dot"
                    style={{ backgroundColor: label.color }}
                    aria-hidden="true"
                  />
                  <strong className="room-label-title">{label.name}</strong>
                  <span className="room-label-meta">
                    {colorName} · {tierName}
                  </span>
                </div>
                <div className="room-label-row-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    aria-label={`${t('labels.editAria')}: ${label.name}`}
                    disabled={busy}
                    onClick={() => {
                      setEditing(label.id)
                      setName(label.name)
                      setColor(label.color)
                      setPriority(label.priority)
                      setError('')
                      setDeleting(null)
                      nameInputRef.current?.focus()
                    }}
                  >
                    <Pencil size={13} aria-hidden="true" />
                    <span>{t('common.edit')}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    aria-label={`${t('labels.deleteAria')}: ${label.name}`}
                    disabled={busy}
                    onClick={() => setDeleting(label)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    <span>{t('common.delete')}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {deleting && (
        <div
          className="label-delete-confirm"
          role="group"
          aria-label={t('labels.confirmDeleteHeading')}
        >
          <strong>
            {t('labels.confirmDeleteTitle', { name: deleting.name })}
          </strong>
          <p>
            {t('labels.confirmDeleteBody')}
          </p>
          <div className="label-delete-actions">
            <button
              type="button"
              autoFocus
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              {t('labels.keepLabel')}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              aria-busy={busy || undefined}
              disabled={busy}
              onClick={() => void remove(deleting)}
            >
              {busy && <span className="btn-spinner" aria-hidden="true" />}
              <span>{busy ? t('common.deleting') : t('labels.deleteAria')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="room-label-form">
        <div className="room-label-fields">
          <div className="form-field">
            <label className="form-field-label" htmlFor={nameId}>
              <span>{t('labels.nameLabel')}</span>
              <span className="form-required-mark" aria-hidden="true">*</span>
            </label>
            <input
              ref={nameInputRef}
              id={nameId}
              className="input-text"
              autoComplete="off"
              disabled={busy}
              maxLength={32}
              value={name}
              aria-describedby={nameHintId}
              aria-invalid={Boolean(error && name.trim().length < 2) || undefined}
              placeholder={t('labels.namePlaceholder')}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void save()
                }
              }}
            />
            <p id={nameHintId} className="form-field-hint">
              {t('labels.nameHint')}
            </p>
          </div>

          <div className="form-field">
            <label className="form-field-label" htmlFor={priorityId}>
              {t('labels.priorityLabel')}
            </label>
            <SelectMenu
              id={priorityId}
              value={String(priority)}
              items={priorityItems}
              label={t('labels.priorityLabel')}
              placeholder={priorityItems[0]?.label ?? ''}
              emptyText=""
              disabled={busy}
              panelWidth={280}
              onChange={(next) => setPriority(Number(next))}
              renderIcon={() => <Layers size={14} />}
            />
          </div>
        </div>

        <div className="form-field">
          <span id={colorGroupId} className="form-field-label">
            {t('labels.colorLabel')}
          </span>
          <div
            className="color-swatch-group"
            role="radiogroup"
            aria-labelledby={colorGroupId}
          >
            {LABEL_COLOR_PALETTE.map((option, index) => {
              const checked = color.toLowerCase() === option.value
              return (
                <button
                  key={option.value}
                  ref={(el) => {
                    swatchRefs.current[index] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={index === activeSwatchIndex ? 0 : -1}
                  disabled={busy}
                  className="color-swatch-option"
                  onClick={() => setColor(option.value)}
                  onKeyDown={(event) => onSwatchKeyDown(event, index)}
                >
                  <span
                    className="color-swatch-chip"
                    style={{ backgroundColor: option.value }}
                    aria-hidden="true"
                  />
                  <span className="color-swatch-name">{getLabelColorName(option.value, lang)}</span>
                  <span className="color-swatch-check" aria-hidden="true">
                    {checked && <Check size={13} strokeWidth={2.4} />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="room-label-edit-actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-busy={busy || undefined}
            disabled={busy || name.trim().length < 2}
            onClick={() => void save()}
          >
            {busy ? (
              <span className="btn-spinner" aria-hidden="true" />
            ) : editing ? (
              <Check size={15} aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            <span>
              {busy
                ? t('common.saving')
                : editing
                  ? t('labels.updateButton')
                  : t('labels.createButton')}
            </span>
          </button>
          {editing && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={reset}
            >
              {t('labels.cancelEdit')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
