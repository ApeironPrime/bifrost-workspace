import { ChevronLeft, LogOut, PanelRightClose, PanelRightOpen, UserPlus } from 'lucide-react'
import { UserAvatar } from '../../shared/components/UserAvatar'
import { BifrostMark } from '../homepage/components/UI'
import type { SessionStatusTone } from '../../lib/shellState'
import type { PresencePeer, Room, TranslatorFn, User, Workspace } from '../../types/workspace'

type Props = {
  user: User
  compactLayout: boolean
  sidebarVisible: boolean
  selectedWorkspace: Workspace | undefined
  currentRoom: Room | null
  breadcrumbWsText: string
  statusDisplay: { label: string; tone: SessionStatusTone }
  onlinePeers: PresencePeer[]
  onlineSummaryLabel: string
  isRightPanelOpen: boolean
  t: TranslatorFn
  toggleSidebar: () => void
  leaveRoom: () => void
  openInviteForm: () => void
  setIsRightPanelOpen: (updater: (value: boolean) => boolean) => void
}

export function AppHeader(props: Props) {
  const {
    user,
    compactLayout,
    sidebarVisible,
    selectedWorkspace,
    currentRoom,
    breadcrumbWsText,
    statusDisplay,
    onlinePeers,
    onlineSummaryLabel,
    isRightPanelOpen,
    t,
    toggleSidebar,
    leaveRoom,
    openInviteForm,
    setIsRightPanelOpen,
  } = props

  return (
    <header className="app-header">
      <div className="header-left">
        <span className={`sidebar-brand-slot ${compactLayout && !sidebarVisible ? 'is-visible' : ''}`}>
          <button
            type="button"
            className="sidebar-brand-toggle"
            onClick={toggleSidebar}
            aria-controls="app-sidebar"
            aria-label={t('sidebar.expand')}
            aria-expanded={sidebarVisible}
            title={t('sidebar.expand')}
            aria-hidden={!compactLayout || sidebarVisible}
            tabIndex={compactLayout && !sidebarVisible ? 0 : -1}
          >
            <BifrostMark size={28} />
          </button>
        </span>
        <nav className="header-breadcrumb" aria-label={t('dashboard.breadcrumbAria')}>
          {currentRoom ? (
            <button
              type="button"
              className="breadcrumb-ws breadcrumb-link"
              onClick={() => leaveRoom()}
              title={`${selectedWorkspace?.name || t('workspace.title')} — ${t('sidebar.dashboard')}`}
            >
              <ChevronLeft size={14} className="breadcrumb-back-icon" aria-hidden="true" />
              <span className="truncate">{selectedWorkspace?.name || t('workspace.title')}</span>
            </button>
          ) : (
            <span className="breadcrumb-ws" title={breadcrumbWsText}>
              {breadcrumbWsText}
            </span>
          )}
          <span className="breadcrumb-separator" aria-hidden="true">/</span>
          <span
            className="breadcrumb-room"
            aria-current="page"
            title={currentRoom ? currentRoom.name : t('sidebar.dashboard')}
          >
            {currentRoom ? currentRoom.name : t('sidebar.dashboard')}
          </span>
        </nav>
      </div>

      <div className="header-right">
        {selectedWorkspace?.role === 'OWNER' && !currentRoom && (
          <button
            type="button"
            className="btn btn-sm btn-outline-header"
            onClick={openInviteForm}
            title={t('workspace.inviteButton')}
          >
            <UserPlus size={14} aria-hidden="true" />
            <span>{t('workspace.inviteButton')}</span>
          </button>
        )}

        {currentRoom && (
          <>
            <div className="header-room-context">
              <div
                className={`p2p-status-pill tone-${statusDisplay.tone}`}
                role="status"
                title={statusDisplay.label}
              >
                <span className="status-dot" aria-hidden="true" />
                <span className="truncate">{statusDisplay.label}</span>
              </div>

              <div
                className="avatar-stack"
                role="group"
                aria-label={onlineSummaryLabel}
                title={onlineSummaryLabel}
              >
                {onlinePeers.slice(0, 3).map((p) => (
                  <UserAvatar
                    key={p.peerId}
                    name={p.userId === user.id ? user.name : p.name}
                    src={p.userId === user.id ? user.profile?.avatarDataUrl : null}
                    size={28}
                    seed={p.userId}
                    className="stacked-avatar"
                    title={`${p.userId === user.id ? user.name : p.name} (${p.email})`}
                  />
                ))}
                {onlinePeers.length > 3 && (
                  <div className="stacked-avatar stacked-avatar-more" title={onlineSummaryLabel}>
                    +{onlinePeers.length - 3}
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`btn-icon header-info-btn ${isRightPanelOpen ? 'active' : ''}`}
                onClick={() => setIsRightPanelOpen((value) => !value)}
                aria-controls="room-right-panel"
                aria-expanded={isRightPanelOpen}
                title={t('rightPanel.toggle')}
                aria-label={t('rightPanel.toggle')}
              >
                {isRightPanelOpen ? (
                  <PanelRightClose size={16} aria-hidden="true" />
                ) : (
                  <PanelRightOpen size={16} aria-hidden="true" />
                )}
              </button>
            </div>

            <span className="header-divider" aria-hidden="true" />

            <button
              type="button"
              className="btn header-leave-btn"
              onClick={() => leaveRoom()}
              title={t('room.leaveButton')}
            >
              <LogOut size={14} aria-hidden="true" />
              <span>{t('room.leaveButton')}</span>
            </button>
          </>
        )}
      </div>
    </header>
  )
}
