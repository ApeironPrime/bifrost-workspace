import type { FormEvent } from 'react'
import { Copy, Trash2, UserPlus, X } from 'lucide-react'
import type { Language } from '../../i18n'
import { isDevMockSession } from '../../lib/appApi'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { MotionPresence } from '../../shared/components/MotionPresence'
import type { ToastType } from '../../shared/components/Toast'
import type { DiscardFormKind, Room, TranslatorFn, User, Workspace } from '../../types/workspace'
import { WorkspaceMembers } from './WorkspaceMembers'

type Props = {
  user: User
  token: string
  lang: Language
  discardForm: DiscardFormKind
  selectedWorkspace: Workspace | undefined
  currentRoom: Room | null
  rooms: Room[]
  roomsLoading: boolean
  roomLoadError: string
  membersVersion: number
  memberCurrentUser: { id: string; name: string; email?: string; avatarDataUrl?: string | null } | undefined
  liveRoomUserIds: Set<string>
  showRoomMembersModal: boolean
  showCreateWsModal: boolean
  workspaceName: string
  workspaceError: string
  workspaceSubmitting: boolean
  editingWorkspace: Workspace | null
  confirmDeleteWorkspace: boolean
  editWorkspaceName: string
  editWorkspaceError: string
  editWorkspaceSubmitting: boolean
  showCreateRoomModal: boolean
  newRoomName: string
  newRoomDesc: string
  roomMessage: string
  roomSubmitting: boolean
  editingRoom: Room | null
  confirmDeleteRoom: boolean
  editRoomName: string
  editRoomDesc: string
  editRoomError: string
  editRoomSubmitting: boolean
  showInviteModal: boolean
  inviteEmail: string
  inviteError: string
  inviteSubmitting: boolean
  generatedInviteUrl: string
  generatingInviteLink: boolean
  t: TranslatorFn
  setDiscardForm: (value: DiscardFormKind) => void
  setShowProfileModal: (open: boolean) => void
  setShowCreateWsModal: (open: boolean) => void
  setWorkspaceName: (value: string) => void
  setWorkspaceError: (value: string) => void
  setEditingWorkspace: (ws: Workspace | null) => void
  setEditWorkspaceName: (value: string) => void
  setEditWorkspaceError: (value: string) => void
  setConfirmDeleteWorkspace: (open: boolean) => void
  restoreWorkspaceManageFocus: () => void
  setShowCreateRoomModal: (open: boolean) => void
  setNewRoomName: (value: string) => void
  setNewRoomDesc: (value: string) => void
  setRoomMessage: (value: string) => void
  setEditingRoom: (room: Room | null) => void
  setEditRoomName: (value: string) => void
  setEditRoomDesc: (value: string) => void
  setEditRoomError: (value: string) => void
  setConfirmDeleteRoom: (open: boolean) => void
  restoreManagedRoomFocus: () => void
  setShowInviteModal: (open: boolean) => void
  setInviteEmail: (value: string) => void
  setInviteError: (value: string) => void
  setShowRoomMembersModal: (open: boolean) => void
  executeDeleteWorkspace: () => Promise<void>
  executeDeleteRoom: () => Promise<void>
  retryRooms: () => void
  openInviteForm: () => void
  closeWorkspaceForm: () => void
  createWorkspace: (event: FormEvent<HTMLFormElement>) => void
  closeEditWorkspaceForm: () => void
  submitEditWorkspace: (event: FormEvent<HTMLFormElement>) => void
  closeRoomForm: () => void
  createRoom: (event: FormEvent<HTMLFormElement>) => void
  closeEditRoomForm: () => void
  submitEditRoom: (event: FormEvent<HTMLFormElement>) => void
  closeInviteForm: () => void
  inviteMember: (event: FormEvent<HTMLFormElement>) => void
  createOneClickInviteLink: () => Promise<void>
  addToast: (message: string, type?: ToastType) => void
}

export function WorkspaceModals(props: Props) {
  const {
    user,
    token,
    lang,
    discardForm,
    selectedWorkspace,
    currentRoom,
    rooms,
    roomsLoading,
    roomLoadError,
    membersVersion,
    memberCurrentUser,
    liveRoomUserIds,
    showRoomMembersModal,
    showCreateWsModal,
    workspaceName,
    workspaceError,
    workspaceSubmitting,
    editingWorkspace,
    confirmDeleteWorkspace,
    editWorkspaceName,
    editWorkspaceError,
    editWorkspaceSubmitting,
    showCreateRoomModal,
    newRoomName,
    newRoomDesc,
    roomMessage,
    roomSubmitting,
    editingRoom,
    confirmDeleteRoom,
    editRoomName,
    editRoomDesc,
    editRoomError,
    editRoomSubmitting,
    showInviteModal,
    inviteEmail,
    inviteError,
    inviteSubmitting,
    generatedInviteUrl,
    generatingInviteLink,
    t,
    setDiscardForm,
    setShowProfileModal,
    setShowCreateWsModal,
    setWorkspaceName,
    setWorkspaceError,
    setEditingWorkspace,
    setEditWorkspaceName,
    setEditWorkspaceError,
    setConfirmDeleteWorkspace,
    restoreWorkspaceManageFocus,
    setShowCreateRoomModal,
    setNewRoomName,
    setNewRoomDesc,
    setRoomMessage,
    setEditingRoom,
    setEditRoomName,
    setEditRoomDesc,
    setEditRoomError,
    setConfirmDeleteRoom,
    restoreManagedRoomFocus,
    setShowInviteModal,
    setInviteEmail,
    setInviteError,
    setShowRoomMembersModal,
    executeDeleteWorkspace,
    executeDeleteRoom,
    retryRooms,
    openInviteForm,
    closeWorkspaceForm,
    createWorkspace,
    closeEditWorkspaceForm,
    submitEditWorkspace,
    closeRoomForm,
    createRoom,
    closeEditRoomForm,
    submitEditRoom,
    closeInviteForm,
    inviteMember,
    createOneClickInviteLink,
    addToast,
  } = props

  return (
    <>
      <MotionPresence present={!!discardForm}>
        <ConfirmDialog
          title={
            discardForm === 'profile'
              ? t('dashboard.discardProfileTitle')
              : discardForm === 'workspace'
                ? t('dashboard.discardWorkspaceTitle')
                : discardForm === 'editWorkspace'
                  ? t('dashboard.discardEditWorkspaceTitle')
                  : discardForm === 'room'
                    ? t('dashboard.discardRoomTitle')
                    : discardForm === 'editRoom'
                      ? t('dashboard.discardEditRoomTitle')
                      : t('dashboard.discardInviteTitle')
          }
          description={
            discardForm === 'profile'
              ? isDevMockSession(token)
                ? t('dashboard.discardProfileAvatarBody')
                : t('dashboard.discardProfileNameBody')
              : discardForm === 'workspace'
                ? t('dashboard.discardWorkspaceBody')
                : discardForm === 'editWorkspace'
                  ? t('dashboard.discardEditWorkspaceBody')
                  : discardForm === 'room'
                    ? t('dashboard.discardRoomBody')
                    : discardForm === 'editRoom'
                      ? t('dashboard.discardEditRoomBody')
                      : t('dashboard.discardInviteBody')
          }
          cancelLabel={t('common.keepEditing')}
          confirmLabel={t('common.discard')}
          tone="danger"
          onCancel={() => setDiscardForm(null)}
          onConfirm={() => {
            if (discardForm === 'profile') setShowProfileModal(false)
            if (discardForm === 'workspace') {
              setShowCreateWsModal(false)
              setWorkspaceName('')
            }
            if (discardForm === 'editWorkspace') {
              setEditingWorkspace(null)
              setEditWorkspaceError('')
              restoreWorkspaceManageFocus()
            }
            if (discardForm === 'room') {
              setShowCreateRoomModal(false)
              setNewRoomName('')
              setNewRoomDesc('')
            }
            if (discardForm === 'editRoom') {
              setEditingRoom(null)
              setEditRoomError('')
              restoreManagedRoomFocus()
            }
            if (discardForm === 'invite') {
              setShowInviteModal(false)
              setInviteEmail('')
            }
            setDiscardForm(null)
          }}
        />
      </MotionPresence>

      <MotionPresence present={!!editingWorkspace && confirmDeleteWorkspace}>
        {editingWorkspace && (
          <ConfirmDialog
            title={t('workspace.deleteConfirmTitle')}
            description={t('workspace.deleteConfirmBody', { name: editingWorkspace.name })}
            cancelLabel={t('common.cancel')}
            confirmLabel={t('workspace.deleteConfirmAction')}
            tone="danger"
            onCancel={() => setConfirmDeleteWorkspace(false)}
            onConfirm={() => void executeDeleteWorkspace()}
          />
        )}
      </MotionPresence>

      <MotionPresence present={!!editingRoom && confirmDeleteRoom}>
        {editingRoom && (
          <ConfirmDialog
            title={t('room.deleteConfirmTitle')}
            description={t('room.deleteConfirmBody', { name: editingRoom.name })}
            cancelLabel={t('common.cancel')}
            confirmLabel={t('room.deleteConfirmAction')}
            tone="danger"
            onCancel={() => setConfirmDeleteRoom(false)}
            onConfirm={() => void executeDeleteRoom()}
          />
        )}
      </MotionPresence>

      <MotionPresence present={showRoomMembersModal && !discardForm && !!currentRoom && !!selectedWorkspace}>
        {currentRoom && selectedWorkspace && (
          <div className="modal-overlay" onClick={() => setShowRoomMembersModal(false)}>
            <section
              className="modal-card room-members-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-room-members-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3 id="modal-room-members-title">{t('members.modalTitle')}</h3>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setShowRoomMembersModal(false)}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="room-members-modal-body">
                <WorkspaceMembers
                  key={`${user.id}:${selectedWorkspace.id}:${currentRoom.id}:${membersVersion}`}
                  workspaceId={selectedWorkspace.id}
                  token={token}
                  userId={user.id}
                  currentUser={memberCurrentUser}
                  owner={selectedWorkspace.role === 'OWNER'}
                  lang={lang}
                  refresh={membersVersion}
                  rooms={rooms}
                  roomsLoading={roomsLoading}
                  roomLoadError={roomLoadError}
                  liveRoomId={currentRoom.id}
                  liveRoomName={currentRoom.name}
                  liveRoomUserIds={liveRoomUserIds}
                  compactHeader
                  onUpdated={retryRooms}
                  onInvite={() => {
                    setShowRoomMembersModal(false)
                    openInviteForm()
                  }}
                />
              </div>
              <div className="modal-actions">
                {selectedWorkspace.role === 'OWNER' && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowRoomMembersModal(false)
                      openInviteForm()
                    }}
                  >
                    <UserPlus size={14} aria-hidden="true" />
                    <span>{t('members.addMemberButton')}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowRoomMembersModal(false)}
                >
                  {t('common.close')}
                </button>
              </div>
            </section>
          </div>
        )}
      </MotionPresence>

      <MotionPresence present={showCreateWsModal && !discardForm}>
        <div className="modal-overlay" onClick={closeWorkspaceForm}>
          <section
            className="modal-card workspace-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-workspace-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="modal-workspace-title">{t('sidebar.newWorkspace')}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeWorkspaceForm}
                disabled={workspaceSubmitting}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={createWorkspace} className="form-stack" aria-busy={workspaceSubmitting || undefined}>
              <div className="form-field">
                <label htmlFor="modal-workspace-name" className="form-field-label">
                  <span>{t('workspace.nameLabel')}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="modal-workspace-name"
                  autoComplete="organization"
                  required
                  className="input-text"
                  placeholder={t('workspace.newNamePlaceholder')}
                  minLength={3}
                  maxLength={120}
                  disabled={workspaceSubmitting}
                  value={workspaceName}
                  onChange={(event) => {
                    setWorkspaceName(event.target.value)
                    setWorkspaceError('')
                  }}
                  aria-invalid={Boolean(workspaceError) || undefined}
                  aria-describedby={workspaceError ? 'modal-workspace-error' : 'modal-workspace-hint'}
                />
                <p id="modal-workspace-hint" className="form-field-hint">
                  {t('workspace.nameHint')}
                </p>
              </div>
              {workspaceError && (
                <p id="modal-workspace-error" className="form-error" role="alert">
                  {workspaceError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeWorkspaceForm}
                  disabled={workspaceSubmitting}
                >
                  {t('common.close')}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={workspaceSubmitting}
                  aria-busy={workspaceSubmitting || undefined}
                >
                  {workspaceSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                  <span>
                    {workspaceSubmitting ? t('workspace.creating') : t('workspace.createButton')}
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </MotionPresence>

      <MotionPresence present={!!editingWorkspace && !confirmDeleteWorkspace && !discardForm}>
        {editingWorkspace && (
          <div className="modal-overlay" onClick={closeEditWorkspaceForm}>
            <section
              className="modal-card workspace-edit-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-edit-workspace-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3 id="modal-edit-workspace-title">{t('workspace.editBoxTitle')}</h3>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={closeEditWorkspaceForm}
                  disabled={editWorkspaceSubmitting}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <form
                onSubmit={submitEditWorkspace}
                className="form-stack"
                aria-busy={editWorkspaceSubmitting || undefined}
              >
                <div className="form-field">
                  <label htmlFor="modal-edit-workspace-name" className="form-field-label">
                    <span>{t('workspace.nameLabel')}</span>
                    <span className="form-required-mark" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="modal-edit-workspace-name"
                    autoComplete="organization"
                    required
                    className="input-text"
                    placeholder={t('workspace.newNamePlaceholder')}
                    minLength={3}
                    maxLength={120}
                    disabled={editWorkspaceSubmitting}
                    value={editWorkspaceName}
                    onChange={(event) => {
                      setEditWorkspaceName(event.target.value)
                      setEditWorkspaceError('')
                    }}
                    aria-invalid={Boolean(editWorkspaceError) || undefined}
                    aria-describedby={
                      editWorkspaceError ? 'modal-edit-workspace-error' : 'modal-edit-workspace-hint'
                    }
                  />
                  <p id="modal-edit-workspace-hint" className="form-field-hint">
                    {t('workspace.nameHint')}
                  </p>
                </div>
                {editWorkspaceError && (
                  <p id="modal-edit-workspace-error" className="form-error" role="alert">
                    {editWorkspaceError}
                  </p>
                )}
                <div className="room-danger-zone">
                  <div className="room-danger-copy">
                    <strong>{t('workspace.dangerZoneHeading')}</strong>
                    <p>{t('workspace.dangerZoneDesc')}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={editWorkspaceSubmitting}
                    onClick={() => setConfirmDeleteWorkspace(true)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span>{t('workspace.deleteWorkspaceButton')}</span>
                  </button>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeEditWorkspaceForm}
                    disabled={editWorkspaceSubmitting}
                  >
                    {t('common.close')}
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={editWorkspaceSubmitting}
                    aria-busy={editWorkspaceSubmitting || undefined}
                  >
                    {editWorkspaceSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                    <span>
                      {editWorkspaceSubmitting ? t('common.saving') : t('workspace.saveChangesButton')}
                    </span>
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </MotionPresence>

      <MotionPresence present={showCreateRoomModal && !discardForm}>
        <div className="modal-overlay" onClick={closeRoomForm}>
          <section
            className="modal-card room-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-room-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="modal-room-title">{t('room.createBoxTitle')}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeRoomForm}
                disabled={roomSubmitting}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={createRoom} className="form-stack" aria-busy={roomSubmitting || undefined}>
              <div className="form-field">
                <label htmlFor="modal-room-name" className="form-field-label">
                  <span>{t('room.nameLabel')}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="modal-room-name"
                  autoComplete="off"
                  required
                  className="input-text"
                  placeholder={t('room.namePlaceholder')}
                  minLength={2}
                  maxLength={120}
                  disabled={roomSubmitting}
                  value={newRoomName}
                  onChange={(event) => {
                    setNewRoomName(event.target.value)
                    setRoomMessage('')
                  }}
                  aria-invalid={Boolean(roomMessage) || undefined}
                  aria-describedby={roomMessage ? 'modal-room-error' : 'modal-room-name-hint'}
                />
                <p id="modal-room-name-hint" className="form-field-hint">
                  {t('room.nameHint')}
                </p>
              </div>
              <div className="form-field">
                <label htmlFor="modal-room-desc" className="form-field-label">
                  <span>{t('room.descLabel')}</span>
                  <span className="form-optional-tag">({t('room.descOptionalTag')})</span>
                </label>
                <input
                  id="modal-room-desc"
                  autoComplete="off"
                  className="input-text"
                  placeholder={t('room.descPlaceholder')}
                  maxLength={255}
                  disabled={roomSubmitting}
                  value={newRoomDesc}
                  onChange={(event) => setNewRoomDesc(event.target.value)}
                />
              </div>
              {roomMessage && (
                <p id="modal-room-error" className="form-error" role="alert">
                  {roomMessage}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeRoomForm}
                  disabled={roomSubmitting}
                >
                  {t('common.close')}
                </button>
                <button
                  type="submit"
                  disabled={roomSubmitting}
                  className="btn btn-primary"
                  aria-busy={roomSubmitting || undefined}
                >
                  {roomSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                  <span>{roomSubmitting ? t('workspace.creating') : t('room.createButton')}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </MotionPresence>

      <MotionPresence present={!!editingRoom && !confirmDeleteRoom && !discardForm}>
        {editingRoom && (
          <div className="modal-overlay" onClick={closeEditRoomForm}>
            <section
              className="modal-card room-edit-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-edit-room-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h3 id="modal-edit-room-title">{t('room.editBoxTitle')}</h3>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={closeEditRoomForm}
                  disabled={editRoomSubmitting}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <form onSubmit={submitEditRoom} className="form-stack" aria-busy={editRoomSubmitting || undefined}>
                <div className="form-field">
                  <label htmlFor="modal-edit-room-name" className="form-field-label">
                    <span>{t('room.nameLabel')}</span>
                    <span className="form-required-mark" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="modal-edit-room-name"
                    autoComplete="off"
                    required
                    className="input-text"
                    placeholder={t('room.namePlaceholder')}
                    minLength={2}
                    maxLength={120}
                    disabled={editRoomSubmitting}
                    value={editRoomName}
                    onChange={(event) => {
                      setEditRoomName(event.target.value)
                      setEditRoomError('')
                    }}
                    aria-invalid={Boolean(editRoomError) || undefined}
                    aria-describedby={editRoomError ? 'modal-edit-room-error' : 'modal-edit-room-name-hint'}
                  />
                  <p id="modal-edit-room-name-hint" className="form-field-hint">
                    {t('room.nameHint')}
                  </p>
                </div>
                <div className="form-field">
                  <label htmlFor="modal-edit-room-desc" className="form-field-label">
                    <span>{t('room.descLabel')}</span>
                    <span className="form-optional-tag">({t('room.descOptionalTag')})</span>
                  </label>
                  <input
                    id="modal-edit-room-desc"
                    autoComplete="off"
                    className="input-text"
                    placeholder={t('room.descPlaceholder')}
                    maxLength={255}
                    disabled={editRoomSubmitting}
                    value={editRoomDesc}
                    onChange={(event) => setEditRoomDesc(event.target.value)}
                  />
                </div>
                {editRoomError && (
                  <p id="modal-edit-room-error" className="form-error" role="alert">
                    {editRoomError}
                  </p>
                )}
                {selectedWorkspace?.role === 'OWNER' && (
                  <div className="room-danger-zone">
                    <div className="room-danger-copy">
                      <strong>{t('room.dangerZoneHeading')}</strong>
                      <p>{t('room.dangerZoneDesc')}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={editRoomSubmitting}
                      onClick={() => setConfirmDeleteRoom(true)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>{t('room.deleteRoomButton')}</span>
                    </button>
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeEditRoomForm}
                    disabled={editRoomSubmitting}
                  >
                    {t('common.close')}
                  </button>
                  <button
                    type="submit"
                    disabled={editRoomSubmitting}
                    className="btn btn-primary"
                    aria-busy={editRoomSubmitting || undefined}
                  >
                    {editRoomSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                    <span>{editRoomSubmitting ? t('common.saving') : t('room.saveChangesButton')}</span>
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </MotionPresence>

      <MotionPresence present={showInviteModal && !discardForm}>
        <div className="modal-overlay" onClick={closeInviteForm}>
          <section
            className="modal-card invite-member-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-invite-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="modal-invite-title">{t('workspace.inviteButton')}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeInviteForm}
                disabled={inviteSubmitting}
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={inviteMember} className="form-stack" aria-busy={inviteSubmitting || undefined}>
              <div className="form-field">
                <label htmlFor="modal-invite-email" className="form-field-label">
                  <span>{t('workspace.inviteEmailLabel')}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="modal-invite-email"
                  required
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  maxLength={254}
                  className="input-text"
                  placeholder={t('workspace.invitePlaceholder')}
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value)
                    setInviteError('')
                  }}
                  disabled={inviteSubmitting}
                  aria-invalid={Boolean(inviteError) || undefined}
                  aria-describedby={inviteError ? 'modal-invite-error' : 'modal-invite-hint'}
                />
                <p id="modal-invite-hint" className="form-field-hint">
                  {t('workspace.inviteEmailHint')}
                </p>
              </div>
              {inviteError && (
                <p id="modal-invite-error" className="form-error" role="alert">
                  {inviteError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeInviteForm}
                  disabled={inviteSubmitting}
                >
                  {t('common.close')}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={inviteSubmitting}
                  aria-busy={inviteSubmitting || undefined}
                >
                  {inviteSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                  <span>
                    {inviteSubmitting ? t('workspace.inviting') : t('workspace.inviteButton')}
                  </span>
                </button>
              </div>
            </form>
            {!isDevMockSession(token) && (
              <div className="form-stack profile-security-form">
                <hr className="modal-section-divider" />
                <p className="eyebrow">{t('workspace.inviteLinkHeading')}</p>
                <p className="form-field-hint">{t('workspace.inviteLinkHint')}</p>
                {generatedInviteUrl && (
                  <div className="form-field">
                    <input
                      type="text"
                      readOnly
                      className="input-text"
                      value={generatedInviteUrl}
                      aria-label={t('workspace.inviteLinkHeading')}
                    />
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={generatingInviteLink}
                    onClick={() => void createOneClickInviteLink()}
                  >
                    {generatingInviteLink
                      ? t('workspace.creatingInviteLink')
                      : t('workspace.createInviteLinkButton')}
                  </button>
                  {generatedInviteUrl && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        void navigator.clipboard.writeText(generatedInviteUrl).then(() => {
                          addToast(t('workspace.inviteLinkCopiedToast'), 'success')
                        })
                      }}
                    >
                      <Copy size={14} aria-hidden="true" />
                      <span>{t('workspace.copyInviteLinkButton')}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </MotionPresence>
    </>
  )
}
