import { Fragment, memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Bold, CheckSquare, Code, Copy, Eye, Heading2, Italic } from 'lucide-react'
import type { I18nKey } from '../../../i18n'
import { getAvatarTone } from '../../../lib/controlPrimitives'
import {
  captureRelativeSelection,
  restoreRelativeSelection,
  type RemoteCrdtCursor,
} from '../../../lib/crdtCollabDoc'
import type * as Y from 'yjs'
import './CollabDocEditor.css'

type Props = {
  roomName: string
  roomReadOnly: boolean
  text: string
  ytext: Y.Text | null
  remoteCursors: RemoteCrdtCursor[]
  peersCount: number
  t: (key: I18nKey, params?: Record<string, string | number>) => string
  onLocalChange: (nextText: string) => void
  onSelectionChange: (anchor: number, head: number) => void
  onCopyNote: (body: string) => void
}

function renderInlineMarkdown(line: string): ReactNode[] {
  const tokens = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return tokens.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="collab-preview-code">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={idx}>{part}</Fragment>
  })
}

export const CollabDocEditor = memo(function CollabDocEditor({
  roomName,
  roomReadOnly,
  text,
  ytext,
  remoteCursors,
  peersCount,
  t,
  onLocalChange,
  onSelectionChange,
  onCopyNote,
}: Props) {
  const [previewMode, setPreviewMode] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const savedRelativeSelRef = useRef<ReturnType<typeof captureRelativeSelection> | null>(null)
  const prevTextRef = useRef(text)

  // Preserve local caret/selection across incoming remote CRDT edits using Y.RelativePosition
  useLayoutEffect(() => {
    const el = textareaRef.current
    const doc = ytext?.doc
    if (
      el &&
      doc &&
      document.activeElement === el &&
      prevTextRef.current !== text &&
      savedRelativeSelRef.current
    ) {
      const restored = restoreRelativeSelection(doc, savedRelativeSelRef.current)
      if (restored) {
        el.setSelectionRange(restored.start, restored.end)
      }
    }
    prevTextRef.current = text
  }, [text, ytext])

  const syncLocalSelection = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    if (ytext) {
      savedRelativeSelRef.current = captureRelativeSelection(ytext, start, end)
    }
    onSelectionChange(start, end)
  }, [onSelectionChange, ytext])

  const handleScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const wrapSelection = useCallback(
    (prefix: string, suffix = '') => {
      const el = textareaRef.current
      if (!el || roomReadOnly) return
      const start = el.selectionStart ?? text.length
      const end = el.selectionEnd ?? start
      const selected = text.slice(start, end)
      const next = `${text.slice(0, start)}${prefix}${selected}${suffix}${text.slice(end)}`
      onLocalChange(next)
      requestAnimationFrame(() => {
        el.focus()
        const cursorPos = start + prefix.length + selected.length
        el.setSelectionRange(cursorPos, cursorPos)
        syncLocalSelection()
      })
    },
    [onLocalChange, roomReadOnly, syncLocalSelection, text],
  )

  const toggleChecklistLine = useCallback(
    (lineIndex: number) => {
      if (roomReadOnly) return
      const lines = text.split('\n')
      const target = lines[lineIndex]
      if (target === undefined) return
      if (target.startsWith('- [ ] ')) {
        lines[lineIndex] = `- [x] ${target.slice(6)}`
      } else if (target.startsWith('- [x] ')) {
        lines[lineIndex] = `- [ ] ${target.slice(6)}`
      }
      onLocalChange(lines.join('\n'))
    },
    [onLocalChange, roomReadOnly, text],
  )

  const renderMirrorContent = () => {
    if (remoteCursors.length === 0) return text
    const boundaries = new Set<number>([0, text.length])
    for (const c of remoteCursors) {
      boundaries.add(Math.max(0, Math.min(c.anchor, text.length)))
      boundaries.add(Math.max(0, Math.min(c.head, text.length)))
    }
    const sorted = [...boundaries].sort((a, b) => a - b)
    const nodes: ReactNode[] = []

    for (let i = 0; i < sorted.length; i += 1) {
      const pos = sorted[i]
      const caretsHere = remoteCursors.filter((c) => Math.max(0, Math.min(c.head, text.length)) === pos)
      for (const c of caretsHere) {
        const color = getAvatarTone(c.userId)
        nodes.push(
          <span
            key={`caret-${c.peerId}-${pos}`}
            className="collab-remote-caret"
            style={{ backgroundColor: color }}
          >
            <span className="collab-remote-flag" style={{ backgroundColor: color }}>
              {c.name}
            </span>
          </span>,
        )
      }

      const nextPos = sorted[i + 1]
      if (nextPos === undefined || nextPos === pos) continue
      const slice = text.slice(pos, nextPos)
      const activeSel = remoteCursors.find((c) => {
        const low = Math.min(c.anchor, c.head)
        const high = Math.max(c.anchor, c.head)
        return low <= pos && nextPos <= high && low !== high
      })
      if (activeSel) {
        nodes.push(
          <span
            key={`sel-${pos}-${nextPos}`}
            className="collab-remote-selection"
            style={{ backgroundColor: `${getAvatarTone(activeSel.userId)}33` }}
          >
            {slice}
          </span>,
        )
      } else {
        nodes.push(<Fragment key={`txt-${pos}-${nextPos}`}>{slice}</Fragment>)
      }
    }

    return nodes
  }

  return (
    <div className="collab-doc-shell">
      <div className="notes-column-header">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-num" aria-hidden="true">
              01 /
            </span>
            {t('note.collabEyebrow')}
          </p>
          <h2>{t('note.collabHeading')}</h2>
        </div>
        <div className="notes-column-actions">
          {text.trim().length > 0 && (
            <button
              type="button"
              className="btn-icon notes-copy-btn"
              onClick={() => onCopyNote(text)}
              aria-label={t('note.copyButton')}
              title={t('note.copyButton')}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${previewMode ? 'is-active' : ''}`}
            aria-pressed={previewMode}
            onClick={() => setPreviewMode((prev) => !prev)}
          >
            <Eye size={14} aria-hidden="true" />
            <span>{t('note.toolbarPreview')}</span>
          </button>
        </div>
      </div>

      <p className="room-context-caption">
        {roomName} · {t('note.collabScopeHint')} · {t('note.collabActivePeers', { count: peersCount + 1 })}
      </p>

      {remoteCursors.length > 0 && (
        <div className="collab-cursors-bar" aria-live="polite">
          {remoteCursors.map((cursor) => (
            <span
              key={cursor.peerId}
              className="collab-cursor-pill"
              style={{ backgroundColor: getAvatarTone(cursor.userId) }}
            >
              {t('note.collabCursorLine', { name: cursor.name, line: cursor.line })}
            </span>
          ))}
        </div>
      )}

      <div className="collab-toolbar" role="toolbar" aria-label={t('note.collabHeading')}>
        <button
          type="button"
          className="collab-toolbar-btn"
          disabled={roomReadOnly || previewMode}
          onClick={() => wrapSelection('## ', '')}
          title={t('note.toolbarHeading')}
        >
          <Heading2 size={14} aria-hidden="true" />
          <span>{t('note.toolbarHeading')}</span>
        </button>
        <button
          type="button"
          className="collab-toolbar-btn"
          disabled={roomReadOnly || previewMode}
          onClick={() => wrapSelection('**', '**')}
          title={t('note.toolbarBold')}
        >
          <Bold size={14} aria-hidden="true" />
          <span>{t('note.toolbarBold')}</span>
        </button>
        <button
          type="button"
          className="collab-toolbar-btn"
          disabled={roomReadOnly || previewMode}
          onClick={() => wrapSelection('*', '*')}
          title={t('note.toolbarItalic')}
        >
          <Italic size={14} aria-hidden="true" />
          <span>{t('note.toolbarItalic')}</span>
        </button>
        <button
          type="button"
          className="collab-toolbar-btn"
          disabled={roomReadOnly || previewMode}
          onClick={() => wrapSelection('`', '`')}
          title={t('note.toolbarCode')}
        >
          <Code size={14} aria-hidden="true" />
          <span>{t('note.toolbarCode')}</span>
        </button>
        <button
          type="button"
          className="collab-toolbar-btn"
          disabled={roomReadOnly || previewMode}
          onClick={() => wrapSelection('- [ ] ', '')}
          title={t('note.toolbarChecklist')}
        >
          <CheckSquare size={14} aria-hidden="true" />
          <span>{t('note.toolbarChecklist')}</span>
        </button>
      </div>

      {previewMode ? (
        <div className="collab-preview-surface">
          {text.trim().length === 0 ? (
            <p className="collab-preview-line">{t('note.noteEmpty')}</p>
          ) : (
            text.split('\n').map((line, idx) => {
              if (line.startsWith('## ')) {
                return <h3 key={idx}>{renderInlineMarkdown(line.slice(3))}</h3>
              }
              if (line.startsWith('# ')) {
                return <h2 key={idx}>{renderInlineMarkdown(line.slice(2))}</h2>
              }
              if (line.startsWith('- [ ] ') || line.startsWith('- [x] ')) {
                const checked = line.startsWith('- [x] ')
                return (
                  <label key={idx} className="collab-preview-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={roomReadOnly}
                      onChange={() => toggleChecklistLine(idx)}
                    />
                    <span style={{ textDecoration: checked ? 'line-through' : undefined }}>
                      {renderInlineMarkdown(line.slice(6))}
                    </span>
                  </label>
                )
              }
              return (
                <p key={idx} className="collab-preview-line">
                  {line ? renderInlineMarkdown(line) : '\u00A0'}
                </p>
              )
            })
          )}
        </div>
      ) : (
        <div className="collab-editor-stage">
          <div ref={backdropRef} className="collab-mirror-backdrop" aria-hidden="true">
            {renderMirrorContent()}
          </div>
          <textarea
            ref={textareaRef}
            className="collab-textarea"
            readOnly={roomReadOnly}
            aria-label={t('note.collabHeading')}
            placeholder={t('note.collabPlaceholder')}
            value={text}
            onChange={(event) => {
              const el = event.currentTarget
              if (ytext) {
                savedRelativeSelRef.current = captureRelativeSelection(
                  ytext,
                  el.selectionStart ?? 0,
                  el.selectionEnd ?? 0,
                )
              }
              onLocalChange(el.value)
              onSelectionChange(el.selectionStart ?? 0, el.selectionEnd ?? 0)
            }}
            onSelect={syncLocalSelection}
            onKeyUp={syncLocalSelection}
            onClick={syncLocalSelection}
            onScroll={handleScroll}
          />
        </div>
      )}
    </div>
  )
})
