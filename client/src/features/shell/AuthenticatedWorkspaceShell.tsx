import { roomDraftKey } from '../../lib/roomUiState';
import type { I18nKey, Language } from '../../i18n';
import { getSessionStatusDisplay } from '../../lib/shellState';
import type { DiscardFormKind } from '../../types/workspace';
import { ToastContainer, type ToastItem, type ToastType } from '../../shared/components/Toast';
import { SidebarRailTooltip } from '../../shared/components/SidebarRailTooltip';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import type { useShellLayout } from './hooks/useShellLayout';
import type { useAuthAndProfile } from '../auth/hooks/useAuthAndProfile';
import { ProfileSecurityModal } from '../auth/ProfileSecurityModal';
import { DashboardView } from '../workspace/DashboardView';
import { WorkspaceModals } from '../workspace/WorkspaceModals';
import type { useWorkspaceDirectory } from '../workspace/hooks/useWorkspaceDirectory';
import { RoomWorkspaceView } from '../room/components/RoomWorkspaceView';
import type { useWebRtcRoomEngine } from '../room/hooks/useWebRtcRoomEngine';

export interface AuthenticatedWorkspaceShellProps {
  lang: Language;
  theme: 'dark' | 'light';
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  toasts: ToastItem[];
  dismissToast: (id: string) => void;
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  handleSuccessToast: (message: string) => void;
  handleErrorToast: (message: string) => void;
  toggleLang: (next: Language) => void;
  toggleTheme: () => void;
  discardForm: DiscardFormKind | null;
  setDiscardForm: (kind: DiscardFormKind | null) => void;
  shell: ReturnType<typeof useShellLayout>;
  auth: ReturnType<typeof useAuthAndProfile>;
  dir: ReturnType<typeof useWorkspaceDirectory>;
  engine: ReturnType<typeof useWebRtcRoomEngine>;
  statusDisplay: ReturnType<typeof getSessionStatusDisplay>;
  routeUnavailable: boolean;
  roomsPending: boolean;
  sidebarRoomsPending: boolean;
  showWorkspaceSkeleton: boolean;
  showRoomsSkeleton: boolean;
  showSidebarRoomsSkeleton: boolean;
}

export function AuthenticatedWorkspaceShell({
  lang,
  theme,
  t,
  toasts,
  dismissToast,
  addToast,
  handleSuccessToast,
  handleErrorToast,
  toggleLang,
  toggleTheme,
  discardForm,
  setDiscardForm,
  shell,
  auth,
  dir,
  engine,
  statusDisplay,
  routeUnavailable,
  roomsPending,
  sidebarRoomsPending,
  showWorkspaceSkeleton,
  showRoomsSkeleton,
  showSidebarRoomsSkeleton,
}: AuthenticatedWorkspaceShellProps) {
  const user = auth.user!;
  const quickRoom = dir.rooms.find((room) => room.access !== null);
  const closeSidebarLabel = t('sidebar.closeMobileAria');
  const unassignedRoomLabel = t('sidebar.notAssignedBadge');
  const breadcrumbWsText = dir.workspaceLoading
    ? t('workspace.loadingPlaceholder')
    : dir.workspaceLoadError && !dir.selectedWorkspace
      ? t('workspace.loadErrorTitle')
      : dir.selectedWorkspace
        ? dir.selectedWorkspace.name
        : t('workspace.emptyTitle');
  const onlineSummaryLabel = t('sidebar.peersInRoom', { count: engine.onlinePeers.length });

  const roomListSkeleton = (
    <div className="workspace-room-list is-skeleton" aria-hidden="true">
      <div className="workspace-room-list-head is-skeleton">
        <span className="workspace-skeleton-block room-head-skel-left" />
        <span className="workspace-skeleton-block room-head-skel-host" />
        <span className="workspace-skeleton-block room-head-skel-action" />
      </div>
      {[0, 1].map((row) => (
        <div key={row} className="workspace-room-row is-skeleton">
          <span className="workspace-skeleton-block room-skel-num" />
          <div className="workspace-room-info">
            <span className="workspace-skeleton-block room-skel-title" />
            <span className="workspace-skeleton-block room-skel-badge" />
            <span className="workspace-skeleton-block room-skel-desc" />
          </div>
          <div className="workspace-room-host">
            <span className="workspace-skeleton-block room-skel-avatar" />
            <span className="workspace-skeleton-block room-skel-host-name" />
          </div>
          <div className="room-skel-action-track">
            <span className="workspace-skeleton-block room-skel-action-label" />
            <span className="workspace-skeleton-block room-skel-action-icon" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      className={`app-shell workspace-edition ${engine.currentRoom ? 'room-focused' : ''} ${!shell.compactLayout && shell.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
    >
      <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t('common.close')} />

      {shell.compactLayout && (
        <div
          className={`drawer-backdrop ${shell.isSidebarOpen ? 'is-open' : ''}`}
          aria-hidden="true"
          onClick={() => shell.setIsSidebarOpen(false)}
        />
      )}

      <SidebarRailTooltip store={shell.railTipStore} active={shell.isCompactRail} />

      <AppSidebar
        user={user}
        lang={lang}
        theme={theme}
        sidebarVisible={shell.sidebarVisible}
        isSidebarOpen={shell.isSidebarOpen}
        sidebarExpanded={shell.sidebarExpanded}
        isCompactRail={shell.isCompactRail}
        closeSidebarLabel={closeSidebarLabel}
        workspaces={dir.workspaces}
        selectedWorkspaceId={dir.selectedWorkspaceId}
        selectedWorkspace={dir.selectedWorkspace}
        workspaceLoading={dir.workspaceLoading}
        workspaceLoadError={dir.workspaceLoadError}
        workspaceSubmitting={dir.workspaceSubmitting}
        breadcrumbWsText={breadcrumbWsText}
        rooms={dir.rooms}
        currentRoom={engine.currentRoom}
        sidebarRoomsPending={sidebarRoomsPending}
        showSidebarRoomsSkeleton={showSidebarRoomsSkeleton}
        roomLoadError={dir.roomLoadError}
        roomSubmitting={dir.roomSubmitting}
        roomOnlineCounts={engine.roomOnlineCounts}
        onlinePeers={engine.onlinePeers}
        unassignedRoomLabel={unassignedRoomLabel}
        t={t}
        toggleSidebar={shell.toggleSidebar}
        setIsSidebarOpen={shell.setIsSidebarOpen}
        openEditWorkspaceModal={dir.openEditWorkspaceModal}
        openWorkspaceForm={dir.openWorkspaceForm}
        handleWorkspaceChange={dir.handleWorkspaceChange}
        retryWorkspaces={dir.retryWorkspaces}
        leaveRoom={engine.leaveRoom}
        openRoomForm={dir.openRoomForm}
        retryRooms={dir.retryRooms}
        joinRoom={engine.joinRoom}
        showRailTip={shell.showRailTip}
        hideRailTip={shell.hideRailTip}
        toggleLang={toggleLang}
        toggleTheme={toggleTheme}
        logout={auth.logout}
        openProfileModal={auth.openProfileModal}
      />

      <div className="app-main" inert={shell.compactLayout && shell.isSidebarOpen}>
        <AppHeader
          user={user}
          compactLayout={shell.compactLayout}
          sidebarVisible={shell.sidebarVisible}
          selectedWorkspace={dir.selectedWorkspace}
          currentRoom={engine.currentRoom}
          breadcrumbWsText={breadcrumbWsText}
          statusDisplay={statusDisplay}
          onlinePeers={engine.onlinePeers}
          onlineSummaryLabel={onlineSummaryLabel}
          isRightPanelOpen={shell.isRightPanelOpen}
          t={t}
          toggleSidebar={shell.toggleSidebar}
          leaveRoom={engine.leaveRoom}
          openInviteForm={dir.openInviteForm}
          setIsRightPanelOpen={shell.setIsRightPanelOpen}
        />

        <div className="app-content-body">
          {!engine.currentRoom ? (
            <DashboardView
              user={user}
              token={auth.token}
              lang={lang}
              selectedWorkspace={dir.selectedWorkspace}
              selectedWorkspaceId={dir.selectedWorkspaceId}
              rooms={dir.rooms}
              quickRoom={quickRoom}
              roomsPending={roomsPending}
              showRoomsSkeleton={showRoomsSkeleton}
              roomLoadError={dir.roomLoadError}
              roomSearch={dir.roomSearch}
              roomSearchRef={dir.roomSearchRef}
              lastManagedRoomIdRef={dir.lastManagedRoomIdRef}
              routeUnavailable={routeUnavailable}
              workspaceLoadError={dir.workspaceLoadError}
              workspaceLoading={dir.workspaceLoading}
              showWorkspaceSkeleton={showWorkspaceSkeleton}
              roomListSkeleton={roomListSkeleton}
              membersVersion={dir.membersVersion}
              memberCurrentUser={auth.memberCurrentUser}
              t={t}
              handleWorkspaceChange={dir.handleWorkspaceChange}
              retryWorkspaces={dir.retryWorkspaces}
              retryRooms={dir.retryRooms}
              joinRoom={engine.joinRoom}
              openRoomForm={dir.openRoomForm}
              openWorkspaceForm={dir.openWorkspaceForm}
              openEditRoomModal={dir.openEditRoomModal}
              setRoomSearch={dir.setRoomSearch}
              openInviteForm={dir.openInviteForm}
              addToast={addToast}
            />
          ) : (
            <RoomWorkspaceView
              user={user}
              token={auth.token}
              lang={lang}
              currentRoom={engine.currentRoom}
              selectedWorkspace={dir.selectedWorkspace}
              roomReadOnly={engine.roomReadOnly}
              roomError={engine.roomError}
              statusDisplay={statusDisplay}
              sessionStatus={engine.sessionStatus}
              onlinePeers={engine.onlinePeers}
              peersCount={engine.peersCount}
              activeTab={shell.activeTab}
              roomTabsRef={shell.roomTabsRef}
              roomTabButtonRefs={shell.roomTabButtonRefs}
              filesPanelRef={shell.filesPanelRef}
              compactLayout={shell.compactLayout}
              isRightPanelOpen={shell.isRightPanelOpen}
              copiedRoomId={engine.copiedRoomId}
              messagesCount={engine.messages.length}
              meetingProps={{
                readOnly: engine.roomReadOnly,
                currentUserId: user.id,
                currentUserName: user.name,
                currentUserAvatar: user.profile?.avatarDataUrl,
                roomName: engine.currentRoom.name,
                onlinePeers: engine.onlinePeers,
                micEnabled: engine.micEnabled,
                camEnabled: engine.camEnabled,
                screenSharing: engine.screenSharing,
                noiseSuppression: engine.noiseSuppression,
                backgroundBlur: engine.backgroundBlur,
                mediaError: engine.mediaError,
                localAudioStream: engine.localAudioStream,
                localVideoStream: engine.localVideoStream,
                remoteStreams: engine.remoteStreams,
                peerStats: engine.peerStats,
                meshProfile: engine.meshProfile,
                audioInputs: engine.audioInputs,
                videoInputs: engine.videoInputs,
                audioOutputs: engine.audioOutputs,
                selectedMicId: engine.selectedMicId,
                selectedCamId: engine.selectedCamId,
                selectedSpeakerId: engine.selectedSpeakerId,
                speakerSelectionSupported: engine.speakerSelectionSupported,
                onToggleMic: () => void engine.toggleMic(),
                onToggleCam: () => void engine.toggleCam(),
                onToggleScreenShare: () => void engine.toggleScreenShare(),
                onToggleNoiseSuppression: () => void engine.toggleNoiseSuppression(),
                onToggleBackgroundBlur: () => void engine.toggleBackgroundBlur(),
                onSelectMicrophone: (deviceId) => void engine.selectMicrophone(deviceId),
                onSelectCamera: (deviceId) => void engine.selectCamera(deviceId),
                onSelectSpeaker: engine.selectSpeaker,
                onLeaveRoom: engine.leaveRoom,
                onCopyRoomId: engine.handleCopyCurrentRoomId,
                copiedRoomId: engine.copiedRoomId,
                onInvite: dir.selectedWorkspace?.role === 'OWNER' ? dir.openInviteForm : undefined,
                t,
              }}
              boardProps={{
                readOnly: engine.roomReadOnly,
                currentUser: auth.memoCurrentUser ?? {
                  id: user.id,
                  name: user.name,
                  email: user.email,
                },
                workspaceId: engine.currentRoom.workspaceId,
                roomId: engine.currentRoom.id,
                broadcast: engine.broadcast,
                sendDirectToPeer: engine.sendDirectToBoardPeer,
                registerMessageHandler: engine.registerMeetingBoardMessageHandler,
                registerPeerConnectHandler: engine.registerMeetingBoardPeerConnectHandler,
                cloudBoard: engine.cloudBoard,
                onBoardStateChange: engine.handleBoardStateChange,
                lang,
                addToast,
              }}
              chatProps={{
                scopeKey: roomDraftKey(user.id, engine.currentRoom.workspaceId, engine.currentRoom.id),
                roomName: engine.currentRoom.name,
                roomReadOnly: engine.roomReadOnly,
                peersCount: engine.peersCount,
                currentUserId: user.id,
                messages: engine.messages,
                mentionableMembers: engine.onlinePeers.map((peer) => ({ userId: peer.userId, name: peer.name })),
                chatError: engine.chatError,
                messagesHeading: t('chat.messagesHeading'),
                noRecipientsLabel: t('chat.noRecipients'),
                chatLogRef: engine.chatLogRef,
                onChatScroll: engine.handleChatScroll,
                lang,
                t,
                onSendMessage: engine.sendMessage,
                onToggleReaction: engine.toggleChatReaction,
                onTogglePin: engine.toggleChatPin,
              }}
              notesProps={{
                scopeKey: roomDraftKey(user.id, engine.currentRoom.workspaceId, engine.currentRoom.id),
                roomName: engine.currentRoom.name,
                roomReadOnly: engine.roomReadOnly,
                noteShared: engine.noteShared,
                noteShareStatus: engine.noteShareStatus,
                peersCount: engine.peersCount,
                noteError: engine.noteError,
                sharedNotes: engine.sharedNotes,
                hydratedNote: engine.hydratedNote,
                crdtText: engine.crdtText,
                crdtYText: engine.crdtYText,
                crdtCursors: engine.crdtCursors,
                onCrdtLocalChange: engine.handleCrdtLocalChange,
                onCrdtSelectionChange: engine.handleCrdtSelectionChange,
                lang,
                t,
                onToggleNoteSharing: engine.toggleNoteSharing,
                onRetryNoteSync: engine.retryNoteSync,
                onNoteContentChange: engine.handleNoteContentChange,
                onSuccessToast: handleSuccessToast,
                onErrorToast: handleErrorToast,
              }}
              fileShareProps={{
                readOnly: engine.roomReadOnly,
                roomId: engine.currentRoom.id,
                peersCount: engine.peersCount,
                onlinePeerIds: engine.onlinePeerIds,
                channelsRef: engine.channelsRef,
                broadcast: engine.broadcast,
                sendDirect: engine.sendDirectToFilePeer,
                sendBinaryDirect: engine.sendBinaryToFilePeer,
                registerMessageHandler: engine.registerFileMessageHandler,
                registerBinaryHandler: engine.registerFileBinaryHandler,
                onSuccessToast: handleSuccessToast,
                onErrorToast: handleErrorToast,
                t,
              }}
              t={t}
              selectTab={shell.selectTab}
              handleRoomTabKeyDown={shell.handleRoomTabKeyDown}
              roomTabPanelProps={shell.roomTabPanelProps}
              setIsRightPanelOpen={shell.setIsRightPanelOpen}
              handleCopyCurrentRoomId={engine.handleCopyCurrentRoomId}
              openEditRoomModal={dir.openEditRoomModal}
              setShowRoomMembersModal={dir.setShowRoomMembersModal}
            />
          )}
        </div>
      </div>

      <ProfileSecurityModal
        user={user}
        token={auth.token}
        lang={lang}
        showProfileModal={auth.showProfileModal}
        discardForm={discardForm}
        profileAvatar={auth.profileAvatar}
        profileName={auth.profileName}
        profileMessage={auth.profileMessage}
        profileSaving={auth.profileSaving}
        profileImageBusy={auth.profileImageBusy}
        currentPasswordInput={auth.currentPasswordInput}
        newPasswordInput={auth.newPasswordInput}
        confirmNewPasswordInput={auth.confirmNewPasswordInput}
        passwordSaving={auth.passwordSaving}
        passwordError={auth.passwordError}
        emailVerifyCode={auth.emailVerifyCode}
        emailVerifyDevCode={auth.emailVerifyDevCode}
        emailVerifyBusy={auth.emailVerifyBusy}
        twoFactorSetupSecret={auth.twoFactorSetupSecret}
        twoFactorSetupCode={auth.twoFactorSetupCode}
        twoFactorRecoveryCodes={auth.twoFactorRecoveryCodes}
        twoFactorBusy={auth.twoFactorBusy}
        twoFactorError={auth.twoFactorError}
        notificationPermission={auth.notificationPermission}
        t={t}
        closeProfileForm={auth.closeProfileForm}
        updateProfile={auth.updateProfile}
        setProfileAvatar={auth.setProfileAvatar}
        setProfileImageBusy={auth.setProfileImageBusy}
        setProfileName={auth.setProfileName}
        setProfileMessage={auth.setProfileMessage}
        submitChangePassword={auth.submitChangePassword}
        setCurrentPasswordInput={auth.setCurrentPasswordInput}
        setNewPasswordInput={auth.setNewPasswordInput}
        setConfirmNewPasswordInput={auth.setConfirmNewPasswordInput}
        handleSendEmailVerification={auth.handleSendEmailVerification}
        handleVerifyEmailCode={auth.handleVerifyEmailCode}
        setEmailVerifyCode={auth.setEmailVerifyCode}
        handleSetupTwoFactor={auth.handleSetupTwoFactor}
        handleEnableTwoFactor={auth.handleEnableTwoFactor}
        handleDisableTwoFactor={auth.handleDisableTwoFactor}
        setTwoFactorSetupCode={auth.setTwoFactorSetupCode}
        setNotificationPermission={auth.setNotificationPermission}
      />

      <WorkspaceModals
        user={user}
        token={auth.token}
        lang={lang}
        discardForm={discardForm}
        selectedWorkspace={dir.selectedWorkspace}
        currentRoom={engine.currentRoom}
        rooms={dir.rooms}
        roomsLoading={dir.roomsLoading}
        roomLoadError={dir.roomLoadError}
        membersVersion={dir.membersVersion}
        memberCurrentUser={auth.memberCurrentUser}
        liveRoomUserIds={engine.liveRoomUserIds}
        showRoomMembersModal={dir.showRoomMembersModal}
        showCreateWsModal={dir.showCreateWsModal}
        workspaceName={dir.workspaceName}
        workspaceError={dir.workspaceError}
        workspaceSubmitting={dir.workspaceSubmitting}
        editingWorkspace={dir.editingWorkspace}
        confirmDeleteWorkspace={dir.confirmDeleteWorkspace}
        editWorkspaceName={dir.editWorkspaceName}
        editWorkspaceError={dir.editWorkspaceError}
        editWorkspaceSubmitting={dir.editWorkspaceSubmitting}
        showCreateRoomModal={dir.showCreateRoomModal}
        newRoomName={dir.newRoomName}
        newRoomDesc={dir.newRoomDesc}
        roomMessage={dir.roomMessage}
        roomSubmitting={dir.roomSubmitting}
        editingRoom={dir.editingRoom}
        confirmDeleteRoom={dir.confirmDeleteRoom}
        editRoomName={dir.editRoomName}
        editRoomDesc={dir.editRoomDesc}
        editRoomError={dir.editRoomError}
        editRoomSubmitting={dir.editRoomSubmitting}
        showInviteModal={dir.showInviteModal}
        inviteEmail={dir.inviteEmail}
        inviteError={dir.inviteError}
        inviteSubmitting={dir.inviteSubmitting}
        generatedInviteUrl={dir.generatedInviteUrl}
        generatingInviteLink={dir.generatingInviteLink}
        t={t}
        setDiscardForm={setDiscardForm}
        setShowProfileModal={auth.setShowProfileModal}
        setShowCreateWsModal={dir.setShowCreateWsModal}
        setWorkspaceName={dir.setWorkspaceName}
        setWorkspaceError={dir.setWorkspaceError}
        setEditingWorkspace={dir.setEditingWorkspace}
        setEditWorkspaceName={dir.setEditWorkspaceName}
        setEditWorkspaceError={dir.setEditWorkspaceError}
        setConfirmDeleteWorkspace={dir.setConfirmDeleteWorkspace}
        restoreWorkspaceManageFocus={dir.restoreWorkspaceManageFocus}
        setShowCreateRoomModal={dir.setShowCreateRoomModal}
        setNewRoomName={dir.setNewRoomName}
        setNewRoomDesc={dir.setNewRoomDesc}
        setRoomMessage={dir.setRoomMessage}
        setEditingRoom={dir.setEditingRoom}
        setEditRoomName={dir.setEditRoomName}
        setEditRoomDesc={dir.setEditRoomDesc}
        setEditRoomError={dir.setEditRoomError}
        setConfirmDeleteRoom={dir.setConfirmDeleteRoom}
        restoreManagedRoomFocus={dir.restoreManagedRoomFocus}
        setShowInviteModal={dir.setShowInviteModal}
        setInviteEmail={dir.setInviteEmail}
        setInviteError={dir.setInviteError}
        setShowRoomMembersModal={dir.setShowRoomMembersModal}
        executeDeleteWorkspace={dir.executeDeleteWorkspace}
        executeDeleteRoom={dir.executeDeleteRoom}
        retryRooms={dir.retryRooms}
        openInviteForm={dir.openInviteForm}
        closeWorkspaceForm={dir.closeWorkspaceForm}
        createWorkspace={dir.createWorkspace}
        closeEditWorkspaceForm={dir.closeEditWorkspaceForm}
        submitEditWorkspace={dir.submitEditWorkspace}
        closeRoomForm={dir.closeRoomForm}
        createRoom={dir.createRoom}
        closeEditRoomForm={dir.closeEditRoomForm}
        submitEditRoom={dir.submitEditRoom}
        closeInviteForm={dir.closeInviteForm}
        inviteMember={dir.inviteMember}
        createOneClickInviteLink={dir.createOneClickInviteLink}
        addToast={addToast}
      />
    </div>
  );
}
