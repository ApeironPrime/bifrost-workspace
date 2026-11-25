import type { ReactNode, RefObject } from 'react'
import { ArrowRight, Crown, Eye, Plus, RotateCcw, Settings2, ShieldCheck, Video } from 'lucide-react'
import type { Language } from '../../i18n'
import { searchKey } from '../../lib/selectOptions'
import { SearchField } from '../../shared/components/SearchField'
import type { ToastType } from '../../shared/components/Toast'
import { UserAvatar } from '../../shared/components/UserAvatar'
import { WorkspaceMembers } from '../workspace/WorkspaceMembers'
import type { Room, TranslatorFn, User, Workspace } from '../../types/workspace'

const EMPTY_USER_IDS = new Set<string>()

type Props = {
  user: User
  token: string
  lang: Language
  selectedWorkspace: Workspace | undefined
  selectedWorkspaceId: string
  rooms: Room[]
  quickRoom: Room | undefined
  roomsPending: boolean
  showRoomsSkeleton: boolean
  roomLoadError: string
  roomSearch: string
  roomSearchRef: RefObject<HTMLInputElement | null>
  lastManagedRoomIdRef: RefObject<string | null>
  routeUnavailable: boolean
  workspaceLoadError: boolean
  workspaceLoading: boolean
  showWorkspaceSkeleton: boolean
  roomListSkeleton: ReactNode
  membersVersion: number
  memberCurrentUser: { id: string; name: string; email?: string; avatarDataUrl?: string | null } | undefined
  t: TranslatorFn
  handleWorkspaceChange: (id: string) => void
  retryWorkspaces: () => void
  retryRooms: () => void
  joinRoom: (room: Room) => void
  openRoomForm: () => void
  openWorkspaceForm: () => void
  openEditRoomModal: (room: Room) => void
  setRoomSearch: (value: string) => void
  openInviteForm: () => void
  addToast: (message: string, type?: ToastType) => void
}

export function DashboardView(props: Props) {
  const {
    user,
    token,
    lang,
    selectedWorkspace,
    selectedWorkspaceId,
    rooms,
    quickRoom,
    roomsPending,
    showRoomsSkeleton,
    roomLoadError,
    roomSearch,
    roomSearchRef,
    lastManagedRoomIdRef,
    routeUnavailable,
    workspaceLoadError,
    workspaceLoading,
    showWorkspaceSkeleton,
    roomListSkeleton,
    membersVersion,
    memberCurrentUser,
    t,
    handleWorkspaceChange,
    retryWorkspaces,
    retryRooms,
    joinRoom,
    openRoomForm,
    openWorkspaceForm,
    openEditRoomModal,
    setRoomSearch,
    openInviteForm,
    addToast,
  } = props

  return (
    <main className="dashboard-view">
      <div className="dashboard-container">
        {routeUnavailable ? (
          <section className="workspace-async-state" role="alert">
            <h1>{t('room.openErrorTitle')}</h1>
            <p>{t('room.openErrorDesc')}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleWorkspaceChange(selectedWorkspaceId)}
            >
              {t('room.backToRooms')}
            </button>
          </section>
        ) : workspaceLoadError ? (
          <section className="workspace-async-state" role="alert">
            <h1>{t('workspace.loadFailed')}</h1>
            <button type="button" className="btn btn-secondary" onClick={retryWorkspaces}>
              {t('workspace.switcherTryAgain')}
            </button>
          </section>
        ) : workspaceLoading ? (
          <section
            className="workspace-loading-stage"
            aria-busy="true"
            data-skeleton-visible={showWorkspaceSkeleton ? 'true' : 'false'}
          >
            {showWorkspaceSkeleton && (
              <>
                <span className="sr-only" role="status">
                  {t('dashboard.loadingWorkspaces')}
                </span>
                <div className="workspace-overview workspace-overview-skeleton" aria-hidden="true">
                  <div className="dashboard-hero">
                    <span className="workspace-skeleton-block hero-skeleton-greeting" />
                    <span className="workspace-skeleton-block hero-skeleton-title" />
                    <span className="workspace-skeleton-block hero-skeleton-subtitle" />
                    <span className="workspace-skeleton-block hero-skeleton-facts" />
                  </div>
                  <div className="workspace-quick-room-slot">
                    <div className="workspace-quick-room-skeleton">
                      <span className="workspace-skeleton-block quick-room-skel-eyebrow" />
                      <span className="workspace-skeleton-block quick-room-skel-title" />
                      <span className="workspace-skeleton-block quick-room-skel-desc" />
                      <span className="workspace-skeleton-block quick-room-skel-foot" />
                    </div>
                  </div>
                </div>
                <div className="dashboard-rooms-section" aria-hidden="true">
                  <div className="workspace-rooms-pending" data-skeleton-visible="true">
                    {roomListSkeleton}
                  </div>
                </div>
              </>
            )}
          </section>
        ) : (
          <>
            <div className="workspace-page-meta">
              <span>{t('dashboard.eyebrowWorkspace')}</span>
              <span>{t('dashboard.eyebrowOverview')}</span>
            </div>
            <div className="workspace-overview">
              <div className="dashboard-hero">
                <p className="workspace-greeting">{t('dashboard.greeting', { name: user.name })}</p>
                <h1 className="hero-greeting">
                  {selectedWorkspace?.name || t('dashboard.heroWorkspaceFallbackTitle')}
                </h1>
                <p className="hero-subtext">{t('dashboard.heroSubtitle')}</p>
                {selectedWorkspace && (
                  <div className="workspace-facts">
                    <span>
                      {roomLoadError ? (
                        <>
                          <strong>—</strong>
                          {t('dashboard.metricRoomsUnavailable')}
                        </>
                      ) : roomsPending ? (
                        <>
                          <strong>…</strong>
                          {t('dashboard.metricRoomsLoading')}
                        </>
                      ) : (
                        <>
                          <strong>{rooms.length.toString().padStart(2, '0')}</strong>
                          {rooms.length === 1 ? t('dashboard.roomNounOne') : t('dashboard.roomNounOther')}
                        </>
                      )}
                    </span>
                    <span>
                      {selectedWorkspace.role === 'OWNER'
                        ? t('workspace.ownerBadge')
                        : t('workspace.memberBadge')}
                    </span>
                  </div>
                )}
              </div>
              {roomsPending ? (
                <div className="workspace-quick-room-slot" aria-hidden="true">
                  {showRoomsSkeleton && (
                    <div className="workspace-quick-room-skeleton">
                      <span className="workspace-skeleton-block quick-room-skel-eyebrow" />
                      <span className="workspace-skeleton-block quick-room-skel-title" />
                      <span className="workspace-skeleton-block quick-room-skel-desc" />
                      <span className="workspace-skeleton-block quick-room-skel-foot" />
                    </div>
                  )}
                </div>
              ) : quickRoom ? (
                <aside className="workspace-quick-room" aria-label={t('dashboard.quickAccessTitle')}>
                  <div className="quick-room-top">
                    <span>{t('dashboard.quickAccessEyebrow')}</span>
                    <Video size={18} aria-hidden="true" />
                  </div>
                  <h2>{quickRoom.name}</h2>
                  <p>{quickRoom.description || t('dashboard.quickAccessFallbackDesc')}</p>
                  <button
                    type="button"
                    disabled={quickRoom.access === null}
                    onClick={() => joinRoom(quickRoom)}
                    aria-label={t('dashboard.enterNamedRoomAria', { name: quickRoom.name })}
                  >
                    <span>{t('dashboard.enterRoom')}</span>
                    <ArrowRight size={20} aria-hidden="true" />
                  </button>
                  <svg className="quick-room-bridge" viewBox="0 0 300 180" fill="none" aria-hidden="true">
                    <path d="M-20 175C70 175 50 20 150 20s80 155 170 155" />
                    <path d="M-20 185C70 185 50 30 150 30s80 155 170 155" />
                  </svg>
                </aside>
              ) : (
                <aside className={`workspace-start-note ${roomLoadError ? 'is-error' : ''}`}>
                  <span>
                    {roomLoadError ? t('dashboard.roomLoadErrorEyebrow') : t('dashboard.eyebrowGetStarted')}
                  </span>
                  {roomLoadError ? (
                    <>
                      <h2>{t('dashboard.roomLoadErrorMessage')}</h2>
                      <p>{roomLoadError}</p>
                      <button type="button" className="btn btn-secondary" onClick={retryRooms}>
                        <RotateCcw size={16} aria-hidden="true" />
                        <span>{t('dashboard.retryLoadRooms')}</span>
                      </button>
                    </>
                  ) : rooms.length > 0 ? (
                    <>
                      <h2>{t('dashboard.unassignedTitle')}</h2>
                      <p>{t('dashboard.unassignedSubtitle')}</p>
                    </>
                  ) : (
                    <>
                      <h2>
                        {selectedWorkspace
                          ? t('dashboard.createFirstRoomHeading')
                          : t('dashboard.startSharedSpaceHeading')}
                      </h2>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => (selectedWorkspace ? openRoomForm() : openWorkspaceForm())}
                        disabled={!!selectedWorkspace && selectedWorkspace.role !== 'OWNER'}
                      >
                        <Plus size={16} aria-hidden="true" />
                        <span>
                          {selectedWorkspace ? t('room.createButton') : t('workspace.createButton')}
                        </span>
                      </button>
                      {selectedWorkspace?.role !== 'OWNER' && selectedWorkspace && (
                        <p>{t('dashboard.ownerWillCreateHint')}</p>
                      )}
                    </>
                  )}
                </aside>
              )}
            </div>

            {!selectedWorkspace ? (
              <section className="workspace-onboarding" aria-label={t('dashboard.setupCardTitle')}>
                <div>
                  <span>01</span>
                  <h2>{t('workspace.createButton')}</h2>
                  <p>{t('dashboard.setupCardDesc')}</p>
                </div>
                <div>
                  <span>02</span>
                  <h2>{t('dashboard.createRoomCardTitle')}</h2>
                  <p>{t('dashboard.createRoomCardDesc')}</p>
                </div>
                <div>
                  <span>03</span>
                  <h2>{t('dashboard.inviteCardTitle')}</h2>
                  <p>{t('dashboard.inviteCardDesc')}</p>
                </div>
              </section>
            ) : (
              <section className="dashboard-rooms-section">
                <div className="rooms-section-header">
                  <div>
                    <span className="workspace-section-index">{t('dashboard.directoryKicker')}</span>
                    <h2 className="rooms-section-title">{t('dashboard.directoryTitle')}</h2>
                  </div>
                  <div className="workspace-room-actions">
                    <SearchField
                      inputRef={roomSearchRef}
                      className="workspace-room-search"
                      value={roomSearch}
                      onChange={setRoomSearch}
                      placeholder={t('dashboard.searchRoomsPlaceholder')}
                      ariaLabel={t('dashboard.searchRoomsLabel')}
                      clearLabel={t('dashboard.clearRoomSearchAria')}
                    />
                    {selectedWorkspace?.role === 'OWNER' && (
                      <button type="button" className="btn btn-outline-room" onClick={openRoomForm}>
                        <Plus size={16} aria-hidden="true" />
                        <span>{t('room.createButton')}</span>
                      </button>
                    )}
                  </div>
                </div>
                {roomsPending ? (
                  <div
                    className="workspace-rooms-pending"
                    aria-busy="true"
                    data-skeleton-visible={showRoomsSkeleton ? 'true' : 'false'}
                  >
                    {showRoomsSkeleton && (
                      <>
                        <span className="sr-only" role="status">
                          {t('room.loading')}
                        </span>
                        {roomListSkeleton}
                      </>
                    )}
                  </div>
                ) : roomLoadError ? (
                  <div className="workspace-search-empty" role="alert">
                    <p>{roomLoadError}</p>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={retryRooms}>
                      <RotateCcw size={13} aria-hidden="true" />
                      <span>{t('dashboard.retryLoadRooms')}</span>
                    </button>
                  </div>
                ) : rooms.length === 0 ? (
                  <div className="workspace-rooms-empty">
                    <Video size={32} aria-hidden="true" />
                    <h3>{t('dashboard.noRoomsTitle')}</h3>
                    <p>
                      {selectedWorkspace?.role === 'OWNER'
                        ? t('dashboard.noRoomsOwnerDesc')
                        : t('dashboard.noRoomsMemberDesc')}
                    </p>
                    {selectedWorkspace?.role === 'OWNER' && (
                      <button type="button" className="btn btn-primary" onClick={openRoomForm}>
                        <Plus size={16} aria-hidden="true" />
                        <span>{t('room.createButton')}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  (() => {
                    const normalizedRoomQuery = searchKey(roomSearch)
                    const filteredRooms = normalizedRoomQuery
                      ? rooms.filter((room) =>
                          searchKey(
                            `${room.name} ${room.description ?? ''} ${room.host?.name ?? ''}`,
                          ).includes(normalizedRoomQuery),
                        )
                      : rooms
                    return (
                      <div className="workspace-room-list">
                        <div className="workspace-room-list-head" aria-hidden="true">
                          <span>{t('dashboard.roomsSummaryHeading')}</span>
                          <span>{t('dashboard.hostColumnHeading')}</span>
                          <span>↗</span>
                        </div>
                        {filteredRooms.map((room, index) => {
                          const isHost =
                            room.access === 'HOST' ||
                            (room.hostId !== null && room.hostId === user.id)
                          const isModerator = room.access === 'MODERATOR'
                          const isViewer = room.access === 'VIEWER'
                          const isUnassigned = room.access === null
                          return (
                            <article key={room.id} className="workspace-room-row">
                              <span className="workspace-room-number">
                                {(index + 1).toString().padStart(2, '0')}
                              </span>
                              <div className="workspace-room-info">
                                <h3>{room.name}</h3>
                                {isUnassigned ? (
                                  <span className="room-access-hint tone-unassigned">
                                    {t('sidebar.notAssignedBadge')}
                                  </span>
                                ) : isViewer ? (
                                  <span className="room-access-hint tone-viewer">
                                    <Eye size={12} aria-hidden="true" />
                                    <span>{t('members.roleViewerBadge')}</span>
                                  </span>
                                ) : isHost ? (
                                  <span className="room-access-hint tone-host">
                                    <Crown size={12} aria-hidden="true" />
                                    <span>{t('members.roleHostBadge')}</span>
                                  </span>
                                ) : isModerator ? (
                                  <span className="room-access-hint tone-moderator">
                                    <ShieldCheck size={12} aria-hidden="true" />
                                    <span>{t('members.roleCoordinatorBadge')}</span>
                                  </span>
                                ) : null}
                                <p>{room.description || t('dashboard.roomFallbackDesc')}</p>
                              </div>
                              <div className="workspace-room-host">
                                {room.host ? (
                                  <UserAvatar
                                    name={room.host.name}
                                    src={room.host.id === user.id ? user.profile?.avatarDataUrl : null}
                                    size={27}
                                    seed={room.host.id}
                                    className="workspace-room-host-avatar"
                                    decorative
                                  />
                                ) : (
                                  <span className="workspace-room-host-empty" aria-hidden="true">
                                    —
                                  </span>
                                )}
                                <small>{room.host?.name || t('dashboard.unassignedLabel')}</small>
                              </div>
                              <div className="workspace-room-row-actions">
                                {(selectedWorkspace?.role === 'OWNER' || isHost) && (
                                  <button
                                    type="button"
                                    className="btn-icon room-manage-btn"
                                    data-room-manage={room.id}
                                    aria-label={t('dashboard.manageNamedRoomAria', { name: room.name })}
                                    title={t('dashboard.manageNamedRoomAria', { name: room.name })}
                                    onClick={() => {
                                      lastManagedRoomIdRef.current = room.id
                                      openEditRoomModal(room)
                                    }}
                                  >
                                    <Settings2 size={15} aria-hidden="true" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="room-enter-btn"
                                  disabled={room.access === null}
                                  title={
                                    room.access === null ? t('sidebar.notAssignedBadge') : undefined
                                  }
                                  onClick={() => joinRoom(room)}
                                  aria-label={t('dashboard.enterNamedRoomAria', { name: room.name })}
                                >
                                  <span>{t('dashboard.enterRoom')}</span>
                                  <ArrowRight size={20} aria-hidden="true" />
                                </button>
                              </div>
                            </article>
                          )
                        })}
                        {normalizedRoomQuery && filteredRooms.length === 0 && (
                          <div className="workspace-search-empty" role="status">
                            <p>{t('dashboard.noMatchingRooms')}</p>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setRoomSearch('')
                                requestAnimationFrame(() => roomSearchRef.current?.focus())
                              }}
                            >
                              {t('dashboard.clearFilter')}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()
                )}
                <div className="workspace-bottom-note">
                  <span>WebRTC · P2P</span>
                  <span>{t('room.protocolTagline')}</span>
                </div>
              </section>
            )}
            {selectedWorkspace && (
              <WorkspaceMembers
                key={`${user.id}:${selectedWorkspace.id}:${membersVersion}`}
                workspaceId={selectedWorkspace.id}
                token={token}
                userId={user.id}
                currentUser={memberCurrentUser}
                owner={selectedWorkspace.role === 'OWNER'}
                lang={lang}
                refresh={membersVersion}
                rooms={rooms}
                roomsLoading={roomsPending}
                roomLoadError={roomLoadError}
                liveRoomUserIds={EMPTY_USER_IDS}
                onUpdated={retryRooms}
                onInvite={openInviteForm}
                onToast={addToast}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}
