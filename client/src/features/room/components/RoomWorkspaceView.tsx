import type { ComponentProps, HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import {
  Check,
  Columns3,
  Copy,
  FileText,
  FolderUp,
  MessageSquare,
  PanelRightClose,
  Settings2,
  Users,
  Video,
} from 'lucide-react'
import { LOCALE_META, type Language } from '../../../i18n'
import { isDevMockSession } from '../../../lib/appApi'
import { withCurrentUserHost } from '../../../lib/roomHostProfile'
import { roomPanelElementId, roomTabElementId, roomTabTabIndex, type RoomTabId } from '../../../lib/roomTabs'
import type { SessionStatus, SessionStatusTone } from '../../../lib/shellState'
import { MotionPresence } from '../../../shared/components/MotionPresence'
import { UserAvatar } from '../../../shared/components/UserAvatar'
import type { PresencePeer, Room, TranslatorFn, User, Workspace } from '../../../types/workspace'
import { ChatPane } from './ChatPane'
import { FileShare } from './FileShare'
import { MeetingBoard } from './MeetingBoard'
import { MeetingTab } from './MeetingTab'
import { NotesPane } from './NotesPane'

type Props = {
  user: User
  token: string
  lang: Language
  currentRoom: Room
  selectedWorkspace: Workspace | undefined
  roomReadOnly: boolean
  roomError: string
  statusDisplay: { label: string; tone: SessionStatusTone }
  sessionStatus: SessionStatus
  onlinePeers: PresencePeer[]
  peersCount: number
  activeTab: RoomTabId
  roomTabsRef: RefObject<HTMLDivElement | null>
  roomTabButtonRefs: RefObject<Partial<Record<RoomTabId, HTMLButtonElement | null>>>
  filesPanelRef: RefObject<HTMLDivElement | null>
  compactLayout: boolean
  isRightPanelOpen: boolean
  copiedRoomId: boolean
  messagesCount: number
  meetingProps: ComponentProps<typeof MeetingTab>
  boardProps: ComponentProps<typeof MeetingBoard>
  chatProps: ComponentProps<typeof ChatPane>
  notesProps: ComponentProps<typeof NotesPane>
  fileShareProps: ComponentProps<typeof FileShare>
  t: TranslatorFn
  selectTab: (tab: RoomTabId) => void
  handleRoomTabKeyDown: (tab: RoomTabId, event: ReactKeyboardEvent<HTMLButtonElement>) => void
  roomTabPanelProps: (tab: RoomTabId) => HTMLAttributes<HTMLDivElement>
  setIsRightPanelOpen: (open: boolean) => void
  handleCopyCurrentRoomId: () => void
  openEditRoomModal: (room: Room) => void
  setShowRoomMembersModal: (open: boolean) => void
}

export function RoomWorkspaceView(props: Props) {
  const {
    user,
    token,
    lang,
    currentRoom,
    selectedWorkspace,
    roomReadOnly,
    roomError,
    statusDisplay,
    sessionStatus,
    onlinePeers,
    peersCount,
    activeTab,
    roomTabsRef,
    roomTabButtonRefs,
    filesPanelRef,
    compactLayout,
    isRightPanelOpen,
    copiedRoomId,
    messagesCount,
    meetingProps,
    boardProps,
    chatProps,
    notesProps,
    fileShareProps,
    t,
    selectTab,
    handleRoomTabKeyDown,
    roomTabPanelProps,
    setIsRightPanelOpen,
    handleCopyCurrentRoomId,
    openEditRoomModal,
    setShowRoomMembersModal,
  } = props

  return (
    <div className="room-screen">
      {roomReadOnly && (
        <p className="room-readonly-notice" role="status">
          {t('room.readOnlyModeBanner')}
        </p>
      )}
      <div className="room-session-heading">
        <div className="room-session-title-group">
          <div className="room-editorial-kicker">
            <span className="workspace-section-index">{t('room.eyebrow')}</span>
            <span className="room-kicker-divider" aria-hidden="true">·</span>
            <span className="room-kicker-coord" aria-hidden="true">B / 001</span>
            <span className="room-kicker-motif" lang="ja" aria-hidden="true">
              折り目の向こうで、出会う。
            </span>
          </div>
          <h1>{currentRoom.name}</h1>
          {currentRoom.description && (
            <p className="room-session-subtitle">{currentRoom.description}</p>
          )}
        </div>
        <div className="room-session-meta">
          <span className={`p2p-status-pill room-mobile-status tone-${statusDisplay.tone}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{statusDisplay.label}</span>
          </span>
          <span className="room-presence-count">
            <Users size={14} aria-hidden="true" />
            <span>{t('room.peersInRoomCount', { count: onlinePeers.length })}</span>
          </span>
        </div>
      </div>
      {roomError && (
        <div className="form-error" style={{ margin: '12px 16px 0' }}>
          {roomError}
        </div>
      )}
      <div
        ref={roomTabsRef}
        className="room-tabs-nav"
        role="tablist"
        aria-orientation="horizontal"
        aria-label={t('room.sectionsNavAria')}
      >
        {[
          { id: 'meeting' as const, icon: <Video size={16} />, label: t('tabs.meeting') },
          { id: 'board' as const, icon: <Columns3 size={15} />, label: t('tabs.meetingBoard') },
          {
            id: 'chat' as const,
            icon: <MessageSquare size={16} />,
            label: t('tabs.chat'),
            badge: messagesCount > 0 ? <span className="tag-status">({messagesCount})</span> : null,
          },
          { id: 'notes' as const, icon: <FileText size={16} />, label: t('tabs.notes') },
          { id: 'files' as const, icon: <FolderUp size={16} />, label: t('tabs.files') },
        ].map((tabItem) => {
          const selected = activeTab === tabItem.id
          return (
            <button
              key={tabItem.id}
              ref={(el) => {
                roomTabButtonRefs.current[tabItem.id] = el
              }}
              type="button"
              role="tab"
              id={roomTabElementId(tabItem.id)}
              aria-selected={selected}
              aria-controls={roomPanelElementId(tabItem.id)}
              tabIndex={roomTabTabIndex(tabItem.id, activeTab)}
              className={`room-tab-btn ${selected ? 'active' : ''}`}
              onClick={() => selectTab(tabItem.id)}
              onKeyDown={(event) => handleRoomTabKeyDown(tabItem.id, event)}
            >
              {tabItem.icon}
              <span>{tabItem.label}</span>
              {tabItem.badge}
            </button>
          )
        })}
        <span className="room-tab-indicator" aria-hidden="true" />
      </div>

      <div className="room-content-split">
        <div className="room-tabs-viewport" inert={compactLayout && isRightPanelOpen}>
          <div {...roomTabPanelProps('meeting')}>
            <MeetingTab {...meetingProps} />
          </div>

          <div {...roomTabPanelProps('board')}>
            <MeetingBoard
              key={`${user.id}:${currentRoom.workspaceId}:${currentRoom.id}`}
              {...boardProps}
            />
          </div>

          <div {...roomTabPanelProps('chat')} tabIndex={roomReadOnly ? 0 : undefined}>
            <ChatPane {...chatProps} />
          </div>

          <div {...roomTabPanelProps('notes')}>
            <NotesPane {...notesProps} />
          </div>

          <div {...roomTabPanelProps('files')} ref={filesPanelRef}>
            <FileShare key={currentRoom.id} {...fileShareProps} />
          </div>
        </div>

        <MotionPresence present={isRightPanelOpen}>
          {compactLayout && (
            <div
              className="panel-backdrop"
              aria-hidden="true"
              onClick={() => setIsRightPanelOpen(false)}
            />
          )}

          <aside id="room-right-panel" className="right-panel open" aria-label={t('rightPanel.title')}>
            <div className="right-panel-header">
              <div className="right-panel-title-group">
                <span className="right-panel-coord" aria-hidden="true">
                  B / 001
                </span>
                <h3>{t('rightPanel.title')}</h3>
              </div>
              <button
                type="button"
                className="btn-icon right-panel-close-btn"
                onClick={() => setIsRightPanelOpen(false)}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <PanelRightClose size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="right-panel-body">
              <div className="right-panel-section">
                <p className="eyebrow">
                  <span className="eyebrow-num" aria-hidden="true">
                    01 /
                  </span>
                  {t('rightPanel.roomDetails')}
                </p>
                <div className="right-panel-info-row">
                  <span>{t('rightPanel.host')}:</span>
                  <strong>
                    {withCurrentUserHost(currentRoom, user).host?.name || t('dashboard.unassignedLabel')}
                  </strong>
                </div>
                <div className="right-panel-info-row">
                  <span>{t('rightPanel.created')}:</span>
                  <span>{new Date(currentRoom.createdAt).toLocaleDateString(LOCALE_META[lang].intl)}</span>
                </div>
                {currentRoom.description && <p className="room-card-desc">{currentRoom.description}</p>}
                <button type="button" className="copy-id-button" onClick={handleCopyCurrentRoomId}>
                  {copiedRoomId ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  <span>{copiedRoomId ? t('rightPanel.copied') : t('rightPanel.copyRoomId')}</span>
                </button>
                {(selectedWorkspace?.role === 'OWNER' ||
                  currentRoom.access === 'HOST' ||
                  (currentRoom.hostId !== null && currentRoom.hostId === user.id)) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm edit-room-panel-btn"
                    onClick={() => openEditRoomModal(currentRoom)}
                  >
                    <Settings2 size={14} aria-hidden="true" />
                    <span>{t('room.editRoomButton')}</span>
                  </button>
                )}
              </div>

              <div className="right-panel-section">
                <p className="eyebrow">
                  <span className="eyebrow-num" aria-hidden="true">
                    02 /
                  </span>
                  {t('rightPanel.onlineMembers', { count: onlinePeers.length })}
                </p>
                <p className="right-panel-presence-scope">
                  {isDevMockSession(token)
                    ? t('rightPanel.localPreviewBadge')
                    : t('rightPanel.verifiedPeersHint')}
                </p>
                {onlinePeers.length === 0 ? (
                  <p className="peer-empty-note" role="status">
                    {t('rightPanel.waitingPeersHint')}
                  </p>
                ) : (
                  <div className="peer-list">
                    {onlinePeers.map((peer) => (
                      <div className="peer-row" key={peer.peerId}>
                        <UserAvatar
                          name={peer.userId === user.id ? user.name : peer.name}
                          src={peer.userId === user.id ? user.profile?.avatarDataUrl : null}
                          size={32}
                          seed={peer.userId}
                          className="peer-avatar"
                        />
                        <div className="peer-info">
                          <span className="peer-name">
                            {peer.userId === user.id ? user.name : peer.name}{' '}
                            {peer.userId === user.id ? `(${t('meeting.you')})` : ''}
                          </span>
                          <span className="peer-email">{peer.email}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedWorkspace && (
                <div className="right-panel-section">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm right-panel-directory-btn"
                    onClick={() => {
                      setIsRightPanelOpen(false)
                      setShowRoomMembersModal(true)
                    }}
                  >
                    <Users size={14} aria-hidden="true" />
                    <span>{t('members.viewWorkspaceMembers')}</span>
                  </button>
                </div>
              )}

              <div className="right-panel-section">
                <p className="eyebrow">
                  <span className="eyebrow-num" aria-hidden="true">
                    03 /
                  </span>
                  {t('rightPanel.connection')}
                </p>
                <div
                  className={`p2p-status-pill tone-${
                    peersCount > 0
                      ? 'connected'
                      : sessionStatus.kind === 'error'
                        ? 'error'
                        : sessionStatus.kind === 'localPreview'
                          ? 'neutral'
                          : 'pending'
                  }`}
                >
                  <span className="status-dot" aria-hidden="true" />
                  <span>
                    {peersCount > 0
                      ? t('rightPanel.p2pActive')
                      : sessionStatus.kind === 'error'
                        ? statusDisplay.label
                        : sessionStatus.kind === 'localPreview'
                          ? t('rightPanel.localPreviewSignalingHint')
                          : t('rightPanel.noPeerConnection')}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </MotionPresence>
      </div>
    </div>
  )
}
