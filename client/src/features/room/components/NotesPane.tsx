import { memo, useCallback, useRef, useState } from 'react';
import { Copy, RefreshCw, Share2 } from 'lucide-react';
import type { I18nKey, Language } from '../../../i18n';
import { formatClockTime, type NoteShareStatus, type SharedNoteItem } from '../../../lib/chatNotes';
import { readRoomDraft, readRoomNoteUpdatedAt, writeRoomDraft } from '../../../lib/roomUiState';
import { useKeepFocusedInView } from '../../../shared/hooks/useKeepFocusedInView';

export type { SharedNoteItem } from '../../../lib/chatNotes';

function useCopyNote(
  t: (key: I18nKey, params?: Record<string, string | number>) => string,
  onSuccessToast: (message: string) => void,
  onErrorToast: (message: string) => void,
) {
  return useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
          throw new Error('Clipboard API unavailable');
        }
        await navigator.clipboard.writeText(text);
        onSuccessToast(t('note.copied'));
      } catch {
        onErrorToast(t('note.copyFailed'));
      }
    },
    [t, onSuccessToast, onErrorToast],
  );
}

interface NotesEditorProps {
  scopeKey: string;
  roomName: string;
  roomReadOnly: boolean;
  noteShared: boolean;
  noteShareStatus: NoteShareStatus;
  peersCount: number;
  noteError: string;
  hydratedNote?: { body: string; updatedAt?: number; version: number } | null;
  lang: Language;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onToggleNoteSharing: () => void;
  onRetryNoteSync: () => void;
  onNoteContentChange: (body: string, updatedAt: number) => void;
  onCopyNote: (body: string) => void;
}

const NotesEditor = memo(function NotesEditor({
  scopeKey,
  roomName,
  roomReadOnly,
  noteShared,
  noteShareStatus,
  peersCount,
  noteError,
  hydratedNote,
  lang,
  t,
  onToggleNoteSharing,
  onRetryNoteSync,
  onNoteContentChange,
  onCopyNote,
}: NotesEditorProps) {
  // Isolate local editing state & updated timestamp so keystrokes (including live P2P updates via refs + broadcast)
  // never force App, MeetingBoard, or SharedNotesList to re-render.
  const [noteText, setNoteText] = useState(() => readRoomDraft(sessionStorage, scopeKey).note);
  const [noteUpdatedAt, setNoteUpdatedAt] = useState<number | undefined>(() =>
    readRoomNoteUpdatedAt(sessionStorage, scopeKey),
  );
  const [appliedHydrationVersion, setAppliedHydrationVersion] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (hydratedNote && hydratedNote.version !== appliedHydrationVersion) {
    setAppliedHydrationVersion(hydratedNote.version);
    setNoteText(hydratedNote.body);
    setNoteUpdatedAt(hydratedNote.updatedAt);
    writeRoomDraft(sessionStorage, scopeKey, {
      note: hydratedNote.body,
      noteUpdatedAt: hydratedNote.updatedAt,
    });
  }

  const handleChange = useCallback(
    (next: string) => {
      const updatedAt = Date.now();
      setNoteText(next);
      setNoteUpdatedAt(updatedAt);
      writeRoomDraft(sessionStorage, scopeKey, { note: next, noteUpdatedAt: updatedAt });
      onNoteContentChange(next, updatedAt);
    },
    [onNoteContentChange, scopeKey],
  );

  const handleFocus = useKeepFocusedInView(textareaRef);

  const badgeLabel =
    noteShareStatus === 'active'
      ? t('note.badgeActive')
      : noteShareStatus === 'waiting'
        ? t('note.badgeWaiting')
        : noteShareStatus === 'resyncing'
          ? t('note.badgeResyncing')
          : noteShareStatus === 'failed'
            ? t('note.badgeFailed')
            : t('note.badgePrivate');

  const statusDetail =
    noteShareStatus === 'active'
      ? t('note.recipientsCount', { count: peersCount })
      : noteShareStatus === 'waiting'
        ? t('note.statusWaiting')
        : noteShareStatus === 'resyncing'
          ? t('note.statusResyncing')
          : noteShareStatus === 'failed'
            ? noteError || t('note.statusFailed')
            : t('note.statusPrivate');

  const notesHint = t('note.notesHint');
  const scopeCaption =
    noteShareStatus === 'waiting'
      ? `${t('note.statusWaiting')} ${notesHint}`
      : noteShared
        ? `${t('note.sharedScope')} ${notesHint}`
        : `${t('note.privateScope')} ${notesHint}${peersCount === 0 ? ` ${t('chat.noRecipients')}` : ''}`;

  const updatedTimeText = formatClockTime(noteUpdatedAt, lang);
  const updatedIso =
    typeof noteUpdatedAt === 'number' && Number.isFinite(noteUpdatedAt) && noteUpdatedAt > 0
      ? new Date(noteUpdatedAt).toISOString()
      : undefined;

  return (
    <div className="notes-column">
      <div className="notes-column-header">
        <div>
          <p className="eyebrow"><span className="eyebrow-num" aria-hidden="true">01 /</span>{t('note.title')}</p>
          <h2>{t('note.heading')}</h2>
        </div>
        <div className="notes-column-actions">
          {noteText.trim().length > 0 && (
            <button
              type="button"
              className="btn-icon notes-copy-btn"
              onClick={() => onCopyNote(noteText)}
              aria-label={t('note.copyButton')}
              title={t('note.copyButton')}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={`btn ${noteShared ? 'btn-primary' : 'btn-secondary'}`}
            onClick={onToggleNoteSharing}
            disabled={roomReadOnly}
            aria-pressed={noteShared}
            aria-describedby="room-note-scope"
          >
            <Share2 size={14} aria-hidden="true" />
            <span>{noteShared ? t('note.stopShareButton') : t('note.shareButton')}</span>
          </button>
        </div>
      </div>
      <p id="room-note-scope" className="room-context-caption">
        {scopeCaption}
      </p>
      {noteError && (
        <div className="notes-error-banner" role="alert">
          <p className="form-error">{noteError}</p>
          {noteShareStatus === 'failed' && peersCount > 0 && !roomReadOnly && (
            <button
              type="button"
              className="btn btn-secondary btn-sm notes-retry-btn"
              onClick={onRetryNoteSync}
            >
              <RefreshCw size={13} aria-hidden="true" />
              <span>{t('note.retrySyncButton')}</span>
            </button>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="notes-textarea"
        readOnly={roomReadOnly}
        aria-label={t('note.heading')}
        aria-describedby="room-note-scope"
        value={noteText}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={handleFocus}
        placeholder={t('note.textareaPlaceholder')}
      />
      <div className="notes-status-bar">
        <div className="notes-sync-state" role="status" aria-live="polite" aria-atomic="true">
          <span className={`notes-sync-badge is-${noteShareStatus}`}>{badgeLabel}</span>
          <span className="notes-sync-detail">
            <strong>{roomName}</strong> · {statusDetail}
          </span>
        </div>
        {updatedTimeText && (
          <time className="notes-updated-time" dateTime={updatedIso}>
            {t('note.updatedAt', { time: updatedTimeText })}
          </time>
        )}
      </div>
    </div>
  );
});

interface SharedNotesListProps {
  sharedNotes: Record<string, SharedNoteItem>;
  noSharedNotesLabel: string;
  lang: Language;
  sharedTitle: string;
  noteEmptyLabel: string;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onCopyNote: (body: string) => void;
}

const SharedNotesList = memo(function SharedNotesList({
  sharedNotes,
  noSharedNotesLabel,
  lang,
  sharedTitle,
  noteEmptyLabel,
  t,
  onCopyNote,
}: SharedNotesListProps) {
  const entries = Object.entries(sharedNotes);
  return (
    <div className="notes-column">
      <div className="notes-column-header">
        <div>
          <p className="eyebrow"><span className="eyebrow-num" aria-hidden="true">02 /</span>{t('note.sharedEyebrow')}</p>
          <h2>{sharedTitle}</h2>
        </div>
      </div>
      <div className="received-notes-list">
        {entries.length === 0 ? (
          <div className="empty-state">
            <p>{noSharedNotesLabel}</p>
          </div>
        ) : (
          entries.map(([peerId, note]) => {
            const timeText = formatClockTime(note.updatedAt, lang);
            const isoTime =
              typeof note.updatedAt === 'number' && Number.isFinite(note.updatedAt) && note.updatedAt > 0
                ? new Date(note.updatedAt).toISOString()
                : undefined;

            return (
              <article className="shared-note-card" key={peerId}>
                <div className="shared-note-card-header">
                  <div className="shared-note-meta">
                    <small>{note.author}</small>
                    {timeText && (
                      <time className="shared-note-time" dateTime={isoTime}>
                        {t('note.updatedAt', { time: timeText })}
                      </time>
                    )}
                  </div>
                  {note.body.trim().length > 0 && (
                    <button
                      type="button"
                      className="btn-icon shared-note-copy-btn"
                      onClick={() => onCopyNote(note.body)}
                      aria-label={t('note.copySharedAria', { author: note.author })}
                      title={t('note.copyButton')}
                    >
                      <Copy size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p>{note.body || noteEmptyLabel}</p>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
});

export interface NotesPaneProps {
  scopeKey: string;
  roomName: string;
  roomReadOnly: boolean;
  noteShared: boolean;
  noteShareStatus: NoteShareStatus;
  peersCount: number;
  noteError: string;
  sharedNotes: Record<string, SharedNoteItem>;
  hydratedNote?: { body: string; updatedAt?: number; version: number } | null;
  lang: Language;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onToggleNoteSharing: () => void;
  onRetryNoteSync: () => void;
  onNoteContentChange: (body: string, updatedAt: number) => void;
  onSuccessToast: (message: string) => void;
  onErrorToast: (message: string) => void;
}

export const NotesPane = memo(function NotesPane({
  scopeKey,
  roomName,
  roomReadOnly,
  noteShared,
  noteShareStatus,
  peersCount,
  noteError,
  sharedNotes,
  hydratedNote,
  lang,
  t,
  onToggleNoteSharing,
  onRetryNoteSync,
  onNoteContentChange,
  onSuccessToast,
  onErrorToast,
}: NotesPaneProps) {
  const handleCopyNote = useCopyNote(t, onSuccessToast, onErrorToast);

  return (
    <section className="notes-tab-panel" aria-label={t('note.title')}>
      <NotesEditor
        key={scopeKey}
        scopeKey={scopeKey}
        roomName={roomName}
        roomReadOnly={roomReadOnly}
        noteShared={noteShared}
        noteShareStatus={noteShareStatus}
        peersCount={peersCount}
        noteError={noteError}
        hydratedNote={hydratedNote}
        lang={lang}
        t={t}
        onToggleNoteSharing={onToggleNoteSharing}
        onRetryNoteSync={onRetryNoteSync}
        onNoteContentChange={onNoteContentChange}
        onCopyNote={handleCopyNote}
      />
      <SharedNotesList
        sharedNotes={sharedNotes}
        noSharedNotesLabel={t('note.noSharedNotes')}
        lang={lang}
        sharedTitle={t('note.sharedTitle')}
        noteEmptyLabel={t('note.noteEmpty')}
        t={t}
        onCopyNote={handleCopyNote}
      />
    </section>
  );
});
