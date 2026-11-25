import {
  Crown,
  Eye,
  FolderPlus,
  LayoutDashboard,
  Lock,
  PanelLeftClose,
  RotateCcw,
  Settings2,
  Video,
  X,
} from 'lucide-react'
import type { Language } from '../../i18n'
import { roomInitials } from '../../lib/shellState'
import { AccountMenu } from '../../shared/components/AccountMenu'
import { BifrostMark } from '../homepage/components/UI'
import { WorkspaceSwitcher } from '../workspace/WorkspaceSwitcher'
import type { PresencePeer, Room, TranslatorFn, User, Workspace } from '../../types/workspace'

type Props = {
  user: User
  lang: Language
  theme: 'light' | 'dark'
  sidebarVisible: boolean
  isSidebarOpen: boolean
  sidebarExpanded: boolean
  isCompactRail: boolean
  closeSidebarLabel: string
  workspaces: Workspace[]
  selectedWorkspaceId: string
  selectedWorkspace: Workspace | undefined
  workspaceLoading: boolean
  workspaceLoadError: boolean
  workspaceSubmitting: boolean
  breadcrumbWsText: string
  rooms: Room[]
  currentRoom: Room | null
  sidebarRoomsPending: boolean
  showSidebarRoomsSkeleton: boolean
  roomLoadError: string
  roomSubmitting: boolean
  roomOnlineCounts: Record<string, number>
  onlinePeers: PresencePeer[]
  unassignedRoomLabel: string
  t: TranslatorFn
  toggleSidebar: () => void
  setIsSidebarOpen: (open: boolean) => void
  openEditWorkspaceModal: (ws: Workspace) => void
  openWorkspaceForm: () => void
  handleWorkspaceChange: (workspaceId: string) => void
  retryWorkspaces: () => void
  leaveRoom: () => void
  openRoomForm: () => void
  retryRooms: () => void
  joinRoom: (room: Room) => void
  showRailTip: (target: HTMLElement, text: string) => void
  hideRailTip: () => void
  toggleLang: (next: Language) => void
  toggleTheme: () => void
  logout: () => void
  openProfileModal: () => void
}

export function AppSidebar(props: Props) {
  const {
    user,
    lang,
    theme,
    sidebarVisible,
    isSidebarOpen,
    sidebarExpanded,
    isCompactRail,
    closeSidebarLabel,
    workspaces,
    selectedWorkspaceId,
    selectedWorkspace,
    workspaceLoading,
    workspaceLoadError,
    workspaceSubmitting,
    breadcrumbWsText,
    rooms,
    currentRoom,
    sidebarRoomsPending,
    showSidebarRoomsSkeleton,
    roomLoadError,
    roomSubmitting,
    roomOnlineCounts,
    onlinePeers,
    unassignedRoomLabel,
    t,
    toggleSidebar,
    setIsSidebarOpen,
    openEditWorkspaceModal,
    openWorkspaceForm,
    handleWorkspaceChange,
    retryWorkspaces,
    leaveRoom,
    openRoomForm,
    retryRooms,
    joinRoom,
    showRailTip,
    hideRailTip,
    toggleLang,
    toggleTheme,
    logout,
    openProfileModal,
  } = props

  return (
    <aside
      id="app-sidebar"
      inert={!sidebarVisible}
      aria-label={t('sidebar.workspace')}
      className={`app-sidebar ${isSidebarOpen ? 'open' : ''}`}
    >
      <div className="sidebar-header">
        <button
          type="button"
          className="workspace-brand"
          aria-label={sidebarExpanded ? t('sidebar.collapse') : t('sidebar.expand')}
          title={sidebarExpanded ? t('sidebar.collapse') : t('sidebar.expand')}
          aria-expanded={sidebarExpanded}
          aria-controls="app-sidebar"
          onClick={toggleSidebar}
        >
          <BifrostMark size={28} />
          <span className="brand-title">Bifrost</span>
        </button>
        <button
          type="button"
          className="desktop-sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={t('sidebar.collapse')}
          title={t('sidebar.collapse')}
          aria-controls="app-sidebar"
          aria-expanded={sidebarExpanded}
          aria-hidden={isCompactRail}
          tabIndex={isCompactRail ? -1 : 0}
        >
          <PanelLeftClose size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn-icon mobile-menu-btn sidebar-close-btn"
          onClick={() => setIsSidebarOpen(false)}
          aria-label={closeSidebarLabel}
          title={closeSidebarLabel}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="sidebar-workspace">
        <div className="sidebar-workspace-head">
          <span className="sidebar-section-title">{t('workspace.shortLabel')}</span>
          <div className="sidebar-workspace-actions">
            {selectedWorkspace?.role === 'OWNER' && (
              <button
                type="button"
                className="workspace-manage-btn"
                data-workspace-manage
                disabled={workspaceLoading || workspaceSubmitting}
                onClick={() => openEditWorkspaceModal(selectedWorkspace)}
                title={t('workspace.manageWorkspaceAria', { name: selectedWorkspace.name })}
                aria-label={t('workspace.manageWorkspaceAria', { name: selectedWorkspace.name })}
              >
                <Settings2 size={14} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="sidebar-add-ws-btn"
              disabled={workspaceLoading || workspaceSubmitting}
              onClick={openWorkspaceForm}
              title={t('sidebar.newWorkspace')}
              aria-label={t('sidebar.newWorkspace')}
            >
              <FolderPlus size={16} aria-hidden="true" />
              <span>{t('workspace.newShortButton')}</span>
            </button>
          </div>
        </div>
        <div
          className="sidebar-workspace-picker-wrap"
          onMouseEnter={(event) =>
            showRailTip(
              event.currentTarget,
              selectedWorkspace
                ? `${selectedWorkspace.name} · ${selectedWorkspace.role === 'OWNER' ? t('workspace.ownerBadge') : t('workspace.memberBadge')}`
                : breadcrumbWsText,
            )
          }
          onMouseLeave={hideRailTip}
          onFocusCapture={(event) => {
            if ((event.target as HTMLElement).classList.contains('select-menu-trigger')) {
              showRailTip(
                event.currentTarget,
                selectedWorkspace
                  ? `${selectedWorkspace.name} · ${selectedWorkspace.role === 'OWNER' ? t('workspace.ownerBadge') : t('workspace.memberBadge')}`
                  : breadcrumbWsText,
              )
            } else {
              hideRailTip()
            }
          }}
          onBlurCapture={hideRailTip}
          onClickCapture={hideRailTip}
        >
          <WorkspaceSwitcher
            items={workspaces}
            value={selectedWorkspaceId}
            lang={lang}
            compact={false}
            loading={workspaceLoading}
            error={workspaceLoadError}
            creating={workspaceSubmitting}
            onChange={handleWorkspaceChange}
            onCreate={openWorkspaceForm}
            onRetry={retryWorkspaces}
          />
        </div>
      </div>

      <nav className="sidebar-nav" aria-label={t('workspace.navigationAria')}>
        <ul className="sidebar-menu-list sidebar-primary-list">
          <li>
            <button
              type="button"
              className={`sidebar-nav-item ${!currentRoom ? 'active' : ''}`}
              aria-current={!currentRoom ? 'page' : undefined}
              aria-label={t('sidebar.dashboard')}
              title={t('sidebar.dashboard')}
              onMouseEnter={(event) => showRailTip(event.currentTarget, t('sidebar.dashboard'))}
              onMouseLeave={hideRailTip}
              onFocus={(event) => showRailTip(event.currentTarget, t('sidebar.dashboard'))}
              onBlur={hideRailTip}
              onClick={() => {
                hideRailTip()
                if (currentRoom) leaveRoom()
                setIsSidebarOpen(false)
              }}
            >
              <LayoutDashboard size={15} aria-hidden="true" />
              <span>{t('sidebar.dashboard')}</span>
            </button>
          </li>
        </ul>

        <div className="sidebar-nav-divider" role="separator" />

        <div className="sidebar-section-header">
          <span className="sidebar-section-title">{t('sidebar.rooms')}</span>
          {selectedWorkspace?.role === 'OWNER' && (
            <button
              type="button"
              className="sidebar-action-btn"
              disabled={sidebarRoomsPending || roomSubmitting}
              onClick={openRoomForm}
              title={t('sidebar.newRoom')}
              aria-label={t('sidebar.newRoom')}
              onMouseEnter={(event) => showRailTip(event.currentTarget, t('sidebar.newRoom'))}
              onMouseLeave={hideRailTip}
              onFocus={(event) => showRailTip(event.currentTarget, t('sidebar.newRoom'))}
              onBlur={hideRailTip}
            >
              <Video size={16} aria-hidden="true" />
              <span className="sidebar-action-label">{t('sidebar.newRoomShortButton')}</span>
            </button>
          )}
        </div>

        <div className="sidebar-rooms-scroll" onScroll={hideRailTip}>
          <ul className="sidebar-menu-list sidebar-room-list">
            {sidebarRoomsPending ? (
              <li
                className="sidebar-empty-note sidebar-rooms-pending"
                aria-busy="true"
                data-skeleton-visible={showSidebarRoomsSkeleton ? 'true' : 'false'}
              >
                {showSidebarRoomsSkeleton && (
                  <>
                    <span className="sr-only" role="status">
                      {t('room.loading')}
                    </span>
                    <div className="sidebar-room-skeletons" aria-hidden="true">
                      <span className="sidebar-room-skel-row workspace-skeleton-block" />
                      <span className="sidebar-room-skel-row workspace-skeleton-block" />
                    </div>
                  </>
                )}
              </li>
            ) : workspaceLoadError && !selectedWorkspace ? (
              <li className="sidebar-empty-note">
                <span>{t('workspace.unavailableMessage')}</span>
              </li>
            ) : !selectedWorkspace ? (
              <li className="sidebar-empty-note">{t('workspace.createToAddRooms')}</li>
            ) : roomLoadError ? (
              <li className="sidebar-empty-note sidebar-error-note" role="alert">
                <span>{t('room.loadFailed')}</span>
                <button type="button" className="sidebar-inline-retry" onClick={retryRooms}>
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>{t('common.retry')}</span>
                </button>
              </li>
            ) : rooms.length === 0 ? (
              <li className="sidebar-empty-note">{t('dashboard.noRooms')}</li>
            ) : (
              rooms.map((room) => {
                const isActive = currentRoom?.id === room.id
                const isUnassigned = room.access === null
                const isHost =
                  room.access === 'HOST' || (room.hostId !== null && room.hostId === user.id)
                const isViewer = room.access === 'VIEWER'
                const liveCount = isActive
                  ? Math.max(roomOnlineCounts[room.id] ?? 0, onlinePeers.length)
                  : (roomOnlineCounts[room.id] ?? 0)
                const roomLabel = isUnassigned ? `${room.name} — ${unassignedRoomLabel}` : room.name
                return (
                  <li
                    key={room.id}
                    className="sidebar-room-item"
                    onMouseEnter={(event) => showRailTip(event.currentTarget, roomLabel)}
                    onMouseLeave={hideRailTip}
                  >
                    <button
                      type="button"
                      className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={roomLabel}
                      disabled={isUnassigned}
                      onClick={() => {
                        hideRailTip()
                        joinRoom(room)
                      }}
                      onFocus={(event) => showRailTip(event.currentTarget, roomLabel)}
                      onBlur={hideRailTip}
                      title={roomLabel}
                    >
                      <span className="room-nav-bullet" aria-hidden="true" />
                      <span className="room-mini-name" aria-hidden="true">
                        {roomInitials(room.name)}
                      </span>
                      <span className="sidebar-room-label truncate">{room.name}</span>
                      {isUnassigned ? (
                        <Lock size={12} className="room-locked-icon" aria-hidden="true" />
                      ) : liveCount > 0 ? (
                        <span className="sidebar-room-live-pill" aria-hidden="true">
                          <span className="sidebar-room-live-dot" />
                          <span>{liveCount}</span>
                        </span>
                      ) : isHost ? (
                        <Crown size={12} className="sidebar-room-role-icon" aria-hidden="true" />
                      ) : isViewer ? (
                        <Eye size={12} className="sidebar-room-role-icon" aria-hidden="true" />
                      ) : null}
                      {isActive && <span className="room-active-dot" aria-hidden="true" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      </nav>

      <div
        className="sidebar-footer"
        onMouseEnter={(event) =>
          showRailTip(event.currentTarget, `${user.name} · ${t('account.openMenuAria')}`)
        }
        onMouseLeave={hideRailTip}
        onFocusCapture={(event) => {
          if ((event.target as HTMLElement).classList.contains('account-trigger')) {
            showRailTip(event.currentTarget, `${user.name} · ${t('account.openMenuAria')}`)
          } else {
            hideRailTip()
          }
        }}
        onBlurCapture={hideRailTip}
        onClickCapture={hideRailTip}
      >
        <AccountMenu
          name={user.name}
          email={user.email}
          avatar={user.profile?.avatarDataUrl}
          lang={lang}
          theme={theme}
          onLanguage={toggleLang}
          onTheme={toggleTheme}
          onLogout={logout}
          onProfile={openProfileModal}
        />
      </div>
    </aside>
  )
}
