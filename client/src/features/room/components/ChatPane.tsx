import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Send } from 'lucide-react';
import type { I18nKey, Language } from '../../../i18n';
import {
  classifyChatComposerKey,
  formatClockTime,
  MAX_CHAT_MESSAGE_LENGTH,
  shouldStartChatGroup,
  type ChatMessageItem,
} from '../../../lib/chatNotes';
import { canSendToRoom } from '../../../lib/roomControls';
import { readRoomDraft, writeRoomDraft } from '../../../lib/roomUiState';
import { useKeepFocusedInView } from '../../../shared/hooks/useKeepFocusedInView';

export type { ChatMessageItem } from '../../../lib/chatNotes';

const MAX_COMPOSER_LINES = 5;

function adjustTextareaHeight(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  if (!textarea.value) {
    textarea.style.height = '';
    textarea.style.overflowY = 'hidden';
    return;
  }
  const computed = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 21;
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
  const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
  const borderY = borderTop + borderBottom;
  const maxHeight = Math.round(lineHeight * MAX_COMPOSER_LINES + paddingTop + paddingBottom + borderY);
  const cssMaxHeight = Number.parseFloat(computed.maxHeight);
  const effectiveMaxHeight = Number.isFinite(cssMaxHeight) && cssMaxHeight > 0
    ? Math.min(maxHeight, cssMaxHeight)
    : maxHeight;

  textarea.style.height = 'auto';
  const measuredHeight = textarea.scrollHeight + (computed.boxSizing === 'border-box' ? borderY : 0);
  const nextHeight = Math.min(measuredHeight, effectiveMaxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = measuredHeight > effectiveMaxHeight ? 'auto' : 'hidden';
}

interface ChatMessageListProps {
  messages: ChatMessageItem[];
  peersCount: number;
  messagesHeading: string;
  titleLabel: string;
  emptyPrompt: string;
  emptyReady: string;
  lang: Language;
  chatLogRef: RefObject<HTMLDivElement | null>;
  onChatScroll: () => void;
}

const ChatMessageList = memo(function ChatMessageList({
  messages,
  peersCount,
  messagesHeading,
  titleLabel,
  emptyPrompt,
  emptyReady,
  lang,
  chatLogRef,
  onChatScroll,
}: ChatMessageListProps) {
  return (
    <>
      <div className="chat-editorial-header">
        <div className="chat-editorial-title">
          <span className="eyebrow-num" aria-hidden="true">03 /</span>
          <h2 className="room-pane-title">{messagesHeading}</h2>
        </div>
        <span className="chat-editorial-proto" aria-hidden="true">WebRTC · P2P</span>
      </div>
      <div
        className="chat-messages-container"
        ref={chatLogRef}
        role="log"
        aria-label={titleLabel}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={onChatScroll}
      >
        {messages.length === 0 && (
          <div className="empty-state">
            <p>{peersCount === 0 ? emptyPrompt : emptyReady}</p>
          </div>
        )}
        {messages.map((message, index) => {
          const startsGroup = shouldStartChatGroup(messages, index);
          const timeText = formatClockTime(message.sentAt, lang);
          const isoTime =
            typeof message.sentAt === 'number' && Number.isFinite(message.sentAt) && message.sentAt > 0
              ? new Date(message.sentAt).toISOString()
              : undefined;

          return (
            <article
              className={`chat-bubble ${message.mine ? 'mine' : 'other'} ${startsGroup ? 'is-group-start' : 'is-continuation'}`}
              key={message.id}
            >
              {startsGroup ? (
                <div className="chat-bubble-meta">
                  <span className="chat-bubble-author">{message.author}</span>
                  {timeText && (
                    <time className="chat-bubble-time" dateTime={isoTime}>
                      {timeText}
                    </time>
                  )}
                </div>
              ) : (
                <span className="sr-only">
                  {message.author}
                  {timeText ? ` (${timeText})` : ''}
                </span>
              )}
              <div className="chat-bubble-surface">
                <p className="chat-bubble-body">{message.body}</p>
                {!startsGroup && timeText && (
                  <time className="chat-bubble-time is-inline" dateTime={isoTime}>
                    {timeText}
                  </time>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
});

interface ChatComposerProps {
  scopeKey: string;
  roomName: string;
  roomReadOnly: boolean;
  peersCount: number;
  chatError: string;
  sendToLabel: string;
  noRecipientsLabel: string;
  inputPlaceholder: string;
  composerHint: string;
  sendButtonLabel: string;
  onSendMessage: (draftText: string) => boolean;
}

const ChatComposer = memo(function ChatComposer({
  scopeKey,
  roomName,
  roomReadOnly,
  peersCount,
  chatError,
  sendToLabel,
  noRecipientsLabel,
  inputPlaceholder,
  composerHint,
  sendButtonLabel,
  onSendMessage,
}: ChatComposerProps) {
  // Isolate typing draft here so keystrokes do not re-render App, MeetingBoard, or sibling panes.
  const [draft, setDraft] = useState(() => readRoomDraft(sessionStorage, scopeKey).chat);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  useLayoutEffect(() => {
    adjustTextareaHeight(textareaRef.current);
  }, [draft]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const syncHeight = () => adjustTextareaHeight(textareaRef.current);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncHeight) : null;
    observer?.observe(el);
    window.addEventListener('resize', syncHeight);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', syncHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncHeight);
      visualViewport?.removeEventListener('resize', syncHeight);
    };
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      writeRoomDraft(sessionStorage, scopeKey, { chat: value });
    },
    [scopeKey],
  );

  const submitDraft = useCallback(() => {
    if (!draft.trim()) return;
    if (onSendMessage(draft)) {
      setDraft('');
      writeRoomDraft(sessionStorage, scopeKey, { chat: '' });
      if (textareaRef.current) {
        textareaRef.current.style.height = '';
        textareaRef.current.style.overflowY = 'hidden';
      }
    }
  }, [draft, onSendMessage, scopeKey]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      submitDraft();
    },
    [submitDraft],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const action = classifyChatComposerKey({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode || event.nativeEvent.keyCode,
        composing: composingRef.current,
      });
      if (action === 'send') {
        event.preventDefault();
        submitDraft();
      }
    },
    [submitDraft],
  );

  const handleFocus = useKeepFocusedInView(textareaRef);

  return (
    <div className="chat-composer-dock">
      <div id="room-chat-hint" className="chat-context-bar">
        <p className="room-context-caption">
          {sendToLabel}: <strong>{roomName}</strong>
          {peersCount === 0 && ` · ${noRecipientsLabel}`}
        </p>
        <p id="room-chat-shortcut" className="chat-composer-hint">
          {composerHint}
        </p>
      </div>
      {chatError && (
        <p className="form-error chat-send-error" role="alert">
          {chatError}
        </p>
      )}
      <form className="chat-composer-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          rows={1}
          className="input-text chat-composer-input"
          disabled={roomReadOnly}
          aria-label={inputPlaceholder}
          aria-describedby="room-chat-hint room-chat-shortcut"
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          placeholder={inputPlaceholder}
          value={draft}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
        />
        <button
          type="submit"
          className="btn btn-primary chat-send-btn"
          aria-label={sendButtonLabel}
          title={sendButtonLabel}
          disabled={!canSendToRoom(roomReadOnly, draft, peersCount)}
        >
          <Send size={15} aria-hidden="true" />
          <span>{sendButtonLabel}</span>
        </button>
      </form>
    </div>
  );
});

export interface ChatPaneProps {
  scopeKey: string;
  roomName: string;
  roomReadOnly: boolean;
  peersCount: number;
  messages: ChatMessageItem[];
  chatError: string;
  messagesHeading: string;
  noRecipientsLabel: string;
  chatLogRef: RefObject<HTMLDivElement | null>;
  onChatScroll: () => void;
  lang: Language;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onSendMessage: (draftText: string) => boolean;
}

export const ChatPane = memo(function ChatPane({
  scopeKey,
  roomName,
  roomReadOnly,
  peersCount,
  messages,
  chatError,
  messagesHeading,
  noRecipientsLabel,
  chatLogRef,
  onChatScroll,
  lang,
  t,
  onSendMessage,
}: ChatPaneProps) {
  const titleLabel = t('chat.title');
  return (
    <section className="chat-tab-panel" aria-label={titleLabel}>
      <ChatMessageList
        messages={messages}
        peersCount={peersCount}
        messagesHeading={messagesHeading}
        titleLabel={titleLabel}
        emptyPrompt={t('chat.emptyPrompt')}
        emptyReady={t('chat.emptyReady')}
        lang={lang}
        chatLogRef={chatLogRef}
        onChatScroll={onChatScroll}
      />
      <ChatComposer
        key={scopeKey}
        scopeKey={scopeKey}
        roomName={roomName}
        roomReadOnly={roomReadOnly}
        peersCount={peersCount}
        chatError={chatError}
        sendToLabel={t('chat.sendToLabel')}
        noRecipientsLabel={noRecipientsLabel}
        inputPlaceholder={t('chat.inputPlaceholder')}
        composerHint={t('chat.composerHint')}
        sendButtonLabel={t('chat.sendButton')}
        onSendMessage={onSendMessage}
      />
    </section>
  );
});
