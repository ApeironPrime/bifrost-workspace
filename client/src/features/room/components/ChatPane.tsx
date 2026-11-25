import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { CloudCheck, Pin, PinOff, Reply, Search, Send, SmilePlus, X } from 'lucide-react';
import type { I18nKey, Language } from '../../../i18n';
import {
  CHAT_REACTION_EMOJIS,
  classifyChatComposerKey,
  formatClockTime,
  MAX_CHAT_MESSAGE_LENGTH,
  shouldStartChatGroup,
  tokenizeChatMentions,
  type ChatMessageItem,
  type ChatReplySummary,
} from '../../../lib/chatNotes';
import { canComposeRoomMessage } from '../../../lib/roomControls';
import { readRoomDraft, writeRoomDraft } from '../../../lib/roomUiState';
import { searchKey } from '../../../lib/selectOptions';
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

interface MentionableMember {
  userId: string;
  name: string;
}

interface ChatMessageListProps {
  messages: ChatMessageItem[];
  allMessages: ChatMessageItem[];
  peersCount: number;
  currentUserId: string;
  roomReadOnly: boolean;
  messagesHeading: string;
  titleLabel: string;
  emptyPrompt: string;
  emptyReady: string;
  searchQuery: string;
  searchOpen: boolean;
  knownMentionNames: readonly string[];
  onToggleSearch: () => void;
  onSearchChange: (value: string) => void;
  onReplyRequest: (message: ChatMessageItem) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onTogglePin?: (messageId: string, pinned: boolean) => void;
  lang: Language;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  chatLogRef: RefObject<HTMLDivElement | null>;
  onChatScroll: () => void;
}

const ChatMessageList = memo(function ChatMessageList({
  messages,
  allMessages,
  peersCount,
  currentUserId,
  roomReadOnly,
  messagesHeading,
  titleLabel,
  emptyPrompt,
  emptyReady,
  searchQuery,
  searchOpen,
  knownMentionNames,
  onToggleSearch,
  onSearchChange,
  onReplyRequest,
  onToggleReaction,
  onTogglePin,
  lang,
  t,
  chatLogRef,
  onChatScroll,
}: ChatMessageListProps) {
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);
  const pinnedMessages = useMemo(() => allMessages.filter((item) => item.pinned), [allMessages]);
  const latestPinned = pinnedMessages[pinnedMessages.length - 1] ?? null;

  const scrollToMessage = useCallback(
    (messageId: string) => {
      const container = chatLogRef.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(`[data-chat-message-id="${CSS.escape(messageId)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [chatLogRef],
  );

  return (
    <>
      <div className="chat-editorial-header">
        <div className="chat-editorial-title">
          <span className="eyebrow-num" aria-hidden="true">03 /</span>
          <h2 className="room-pane-title">{messagesHeading}</h2>
        </div>
        <div className="chat-header-tools">
          <span className="chat-cloud-badge" title={t('chat.asyncSyncHint')}>
            <CloudCheck size={13} aria-hidden="true" />
            <span>{t('chat.cloudSyncedLabel')}</span>
          </span>
          <button
            type="button"
            className={`btn-icon chat-search-toggle ${searchOpen ? 'is-active' : ''}`}
            onClick={onToggleSearch}
            aria-label={t('chat.searchToggle')}
            title={t('chat.searchToggle')}
            aria-pressed={searchOpen}
          >
            {searchOpen ? <X size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
          </button>
          <span className="chat-editorial-proto" aria-hidden="true">WebRTC · P2P</span>
        </div>
      </div>

      {searchOpen && (
        <div className="chat-search-bar">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            className="chat-search-input"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('chat.searchPlaceholder')}
            aria-label={t('chat.searchPlaceholder')}
          />
          {searchQuery && (
            <button
              type="button"
              className="btn-icon chat-search-clear"
              onClick={() => onSearchChange('')}
              aria-label={t('chat.searchClear')}
              title={t('chat.searchClear')}
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {latestPinned && (
        <button
          type="button"
          className="chat-pinned-banner"
          onClick={() => scrollToMessage(latestPinned.id)}
          title={t('chat.jumpToMessage')}
        >
          <Pin size={13} aria-hidden="true" />
          <span className="chat-pinned-count">{t('chat.pinnedBanner', { count: pinnedMessages.length })}:</span>
          <span className="chat-pinned-preview">{latestPinned.author}: {latestPinned.body}</span>
        </button>
      )}

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
            <p>{searchQuery.trim() ? t('chat.searchEmpty') : peersCount === 0 ? emptyPrompt : emptyReady}</p>
          </div>
        )}
        {messages.map((message, index) => {
          const startsGroup = shouldStartChatGroup(messages, index);
          const timeText = formatClockTime(message.sentAt, lang);
          const isoTime =
            typeof message.sentAt === 'number' && Number.isFinite(message.sentAt) && message.sentAt > 0
              ? new Date(message.sentAt).toISOString()
              : undefined;
          const reactionEntries = Object.entries(message.reactions ?? {}).filter(([, users]) => users.length > 0);
          const bodyTokens = tokenizeChatMentions(message.body, knownMentionNames);

          return (
            <article
              className={`chat-bubble ${message.mine ? 'mine' : 'other'} ${startsGroup ? 'is-group-start' : 'is-continuation'} ${message.pinned ? 'is-pinned' : ''}`}
              key={message.id}
              data-chat-message-id={message.id}
            >
              {startsGroup ? (
                <div className="chat-bubble-meta">
                  <span className="chat-bubble-author">{message.author}</span>
                  {timeText && (
                    <time className="chat-bubble-time" dateTime={isoTime}>
                      {timeText}
                    </time>
                  )}
                  {message.pinned && (
                    <span className="chat-pin-indicator" title={t('chat.pinnedBanner', { count: pinnedMessages.length })}>
                      <Pin size={11} aria-hidden="true" />
                    </span>
                  )}
                </div>
              ) : (
                <span className="sr-only">
                  {message.author}
                  {timeText ? ` (${timeText})` : ''}
                </span>
              )}

              <div className="chat-bubble-row">
                <div className="chat-bubble-surface">
                  {message.replyTo && (
                    <button
                      type="button"
                      className="chat-reply-quote"
                      onClick={() => scrollToMessage(message.replyTo!.id)}
                      title={t('chat.jumpToMessage')}
                    >
                      <span className="chat-reply-quote-author">{message.replyTo.author}</span>
                      <span className="chat-reply-quote-body">{message.replyTo.bodyPreview}</span>
                    </button>
                  )}
                  <p className="chat-bubble-body">
                    {bodyTokens.map((token, tokenIdx) =>
                      token.kind === 'mention' ? (
                        <span key={tokenIdx} className="chat-mention-token">{token.value}</span>
                      ) : (
                        token.value
                      ),
                    )}
                  </p>
                  {!startsGroup && timeText && (
                    <time className="chat-bubble-time is-inline" dateTime={isoTime}>
                      {timeText}
                    </time>
                  )}
                  {reactionEntries.length > 0 && (
                    <div className="chat-reactions-row">
                      {reactionEntries.map(([emoji, users]) => {
                        const reactedByMe = Boolean(currentUserId && users.includes(currentUserId));
                        return (
                          <button
                            key={emoji}
                            type="button"
                            className={`chat-reaction-pill ${reactedByMe ? 'is-mine' : ''}`}
                            disabled={roomReadOnly || !onToggleReaction}
                            onClick={() => onToggleReaction?.(message.id, emoji)}
                          >
                            <span>{emoji}</span>
                            <span>{users.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {!roomReadOnly && (
                  <div className="chat-bubble-actions">
                    {onToggleReaction && (
                      <div className="chat-react-anchor">
                        <button
                          type="button"
                          className="chat-action-btn"
                          aria-label={t('chat.reactAction')}
                          title={t('chat.reactAction')}
                          onClick={() => setOpenPickerId((cur) => (cur === message.id ? null : message.id))}
                        >
                          <SmilePlus size={13} aria-hidden="true" />
                        </button>
                        {openPickerId === message.id && (
                          <div className="chat-reaction-picker" role="group" aria-label={t('chat.reactAction')}>
                            {CHAT_REACTION_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="chat-reaction-choice"
                                onClick={() => {
                                  onToggleReaction(message.id, emoji);
                                  setOpenPickerId(null);
                                }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="chat-action-btn"
                      aria-label={t('chat.replyAction')}
                      title={t('chat.replyAction')}
                      onClick={() => onReplyRequest(message)}
                    >
                      <Reply size={13} aria-hidden="true" />
                    </button>
                    {onTogglePin && (
                      <button
                        type="button"
                        className={`chat-action-btn ${message.pinned ? 'is-pinned' : ''}`}
                        aria-label={message.pinned ? t('chat.unpinAction') : t('chat.pinAction')}
                        title={message.pinned ? t('chat.unpinAction') : t('chat.pinAction')}
                        onClick={() => onTogglePin(message.id, !message.pinned)}
                      >
                        {message.pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
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
  asyncSyncHint: string;
  inputPlaceholder: string;
  composerHint: string;
  sendButtonLabel: string;
  replyingTo: ChatReplySummary | null;
  onCancelReply: () => void;
  mentionableMembers: readonly MentionableMember[];
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onSendMessage: (draftText: string, replyTo?: ChatReplySummary) => boolean;
}

const ChatComposer = memo(function ChatComposer({
  scopeKey,
  roomName,
  roomReadOnly,
  peersCount,
  chatError,
  sendToLabel,
  noRecipientsLabel,
  asyncSyncHint,
  inputPlaceholder,
  composerHint,
  sendButtonLabel,
  replyingTo,
  onCancelReply,
  mentionableMembers,
  t,
  onSendMessage,
}: ChatComposerProps) {
  // Isolate typing draft here so keystrokes do not re-render App, MeetingBoard, or sibling panes.
  const [draft, setDraft] = useState(() => readRoomDraft(sessionStorage, scopeKey).chat);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; end: number; query: string } | null>(null);
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

  const mentionMatches = useMemo(() => {
    if (!mentionQuery || mentionableMembers.length === 0) return [];
    const q = searchKey(mentionQuery.query);
    return mentionableMembers
      .filter((member) => !q || searchKey(member.name).includes(q))
      .slice(0, 6);
  }, [mentionQuery, mentionableMembers]);

  const detectMentionAtCaret = useCallback((value: string, caret: number | null) => {
    if (caret === null || caret < 0) {
      setMentionQuery(null);
      return;
    }
    const before = value.slice(0, caret);
    const match = before.match(/(?:^|\s)@([^\s@]{0,24})$/);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    const atPos = before.lastIndexOf('@');
    setMentionQuery({ start: atPos, end: caret, query: match[1] });
  }, []);

  const insertMention = useCallback(
    (name: string) => {
      if (!mentionQuery) return;
      const before = draft.slice(0, mentionQuery.start);
      const after = draft.slice(mentionQuery.end);
      const next = `${before}@${name} ${after}`;
      setDraft(next);
      setMentionQuery(null);
      writeRoomDraft(sessionStorage, scopeKey, { chat: next });
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          const pos = before.length + name.length + 2;
          el.setSelectionRange(pos, pos);
        }
      });
    },
    [draft, mentionQuery, scopeKey],
  );

  const handleChange = useCallback(
    (value: string, caret: number | null) => {
      setDraft(value);
      writeRoomDraft(sessionStorage, scopeKey, { chat: value });
      detectMentionAtCaret(value, caret);
    },
    [detectMentionAtCaret, scopeKey],
  );

  const submitDraft = useCallback(() => {
    if (!draft.trim()) return;
    if (onSendMessage(draft, replyingTo ?? undefined)) {
      setDraft('');
      setMentionQuery(null);
      onCancelReply();
      writeRoomDraft(sessionStorage, scopeKey, { chat: '' });
      if (textareaRef.current) {
        textareaRef.current.style.height = '';
        textareaRef.current.style.overflowY = 'hidden';
      }
    }
  }, [draft, onCancelReply, onSendMessage, replyingTo, scopeKey]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      submitDraft();
    },
    [submitDraft],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionMatches.length > 0 && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
        event.preventDefault();
        insertMention(mentionMatches[0].name);
        return;
      }
      if (mentionQuery && event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }

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
    [insertMention, mentionMatches, mentionQuery, submitDraft],
  );

  const handleFocus = useKeepFocusedInView(textareaRef);

  return (
    <div className="chat-composer-dock">
      {replyingTo && (
        <div className="chat-replying-bar">
          <div className="chat-replying-info">
            <Reply size={13} aria-hidden="true" />
            <span>{t('chat.replyingTo', { author: replyingTo.author })}</span>
            <span className="chat-replying-snippet">{replyingTo.bodyPreview}</span>
          </div>
          <button
            type="button"
            className="btn-icon chat-replying-cancel"
            onClick={onCancelReply}
            aria-label={t('chat.cancelReply')}
            title={t('chat.cancelReply')}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      <div id="room-chat-hint" className="chat-context-bar">
        <p className="room-context-caption" title={peersCount === 0 ? noRecipientsLabel : undefined}>
          {sendToLabel}: <strong>{roomName}</strong>
          {peersCount === 0 && ` · ${asyncSyncHint}`}
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
      <div className="chat-composer-anchor">
        {mentionMatches.length > 0 && (
          <div className="chat-mention-popover" role="listbox" aria-label={t('chat.mentionListLabel')}>
            {mentionMatches.map((member) => (
              <button
                key={member.userId}
                type="button"
                className="chat-mention-option"
                onClick={() => insertMention(member.name)}
              >
                <span className="chat-mention-at">@</span>
                <span>{member.name}</span>
              </button>
            ))}
          </div>
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
            onChange={(event) => handleChange(event.target.value, event.target.selectionStart)}
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
            disabled={!canComposeRoomMessage(roomReadOnly, draft)}
          >
            <Send size={15} aria-hidden="true" />
            <span>{sendButtonLabel}</span>
          </button>
        </form>
      </div>
    </div>
  );
});

export interface ChatPaneProps {
  scopeKey: string;
  roomName: string;
  roomReadOnly: boolean;
  peersCount: number;
  currentUserId?: string;
  messages: ChatMessageItem[];
  mentionableMembers?: readonly MentionableMember[];
  chatError: string;
  messagesHeading: string;
  noRecipientsLabel: string;
  chatLogRef: RefObject<HTMLDivElement | null>;
  onChatScroll: () => void;
  lang: Language;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onSendMessage: (draftText: string, replyTo?: ChatReplySummary) => boolean;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onTogglePin?: (messageId: string, pinned: boolean) => void;
}

export const ChatPane = memo(function ChatPane({
  scopeKey,
  roomName,
  roomReadOnly,
  peersCount,
  currentUserId = '',
  messages,
  mentionableMembers = [],
  chatError,
  messagesHeading,
  noRecipientsLabel,
  chatLogRef,
  onChatScroll,
  lang,
  t,
  onSendMessage,
  onToggleReaction,
  onTogglePin,
}: ChatPaneProps) {
  const titleLabel = t('chat.title');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatReplySummary | null>(null);

  const visibleMessages = useMemo(() => {
    const q = searchKey(searchQuery);
    if (!q) return messages;
    return messages.filter(
      (item) => searchKey(item.body).includes(q) || searchKey(item.author).includes(q),
    );
  }, [messages, searchQuery]);

  const knownMentionNames = useMemo(
    () => mentionableMembers.map((member) => member.name),
    [mentionableMembers],
  );

  const handleToggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) setSearchQuery('');
      return !open;
    });
  }, []);

  const handleReplyRequest = useCallback((message: ChatMessageItem) => {
    setReplyingTo({
      id: message.id,
      author: message.author,
      bodyPreview: message.body.slice(0, 140),
    });
  }, []);

  return (
    <section className="chat-tab-panel" aria-label={titleLabel}>
      <ChatMessageList
        messages={visibleMessages}
        allMessages={messages}
        peersCount={peersCount}
        currentUserId={currentUserId}
        roomReadOnly={roomReadOnly}
        messagesHeading={messagesHeading}
        titleLabel={titleLabel}
        emptyPrompt={t('chat.emptyPrompt')}
        emptyReady={t('chat.emptyReady')}
        searchQuery={searchQuery}
        searchOpen={searchOpen}
        knownMentionNames={knownMentionNames}
        onToggleSearch={handleToggleSearch}
        onSearchChange={setSearchQuery}
        onReplyRequest={handleReplyRequest}
        onToggleReaction={onToggleReaction}
        onTogglePin={onTogglePin}
        lang={lang}
        t={t}
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
        asyncSyncHint={t('chat.asyncSyncHint')}
        inputPlaceholder={t('chat.inputPlaceholder')}
        composerHint={t('chat.composerHint')}
        sendButtonLabel={t('chat.sendButton')}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        mentionableMembers={mentionableMembers}
        t={t}
        onSendMessage={onSendMessage}
      />
    </section>
  );
});
