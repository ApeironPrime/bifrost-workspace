import { useId } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'

type Props = {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: Props) {
  const id = useId()
  useDialogFocus(true, onCancel, '.confirm-dialog')
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <section
        className="modal-card confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={`${id}-title`}>{title}</h3>
        <p id={`${id}-description`}>{description}</p>
        <div className="confirm-actions">
          <button className="btn btn-secondary" type="button" autoFocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
