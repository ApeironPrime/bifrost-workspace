import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { getInitialLanguage, saveLanguage, translate, type I18nKey, type Language } from './i18n';
import { getSessionStatusDisplay } from './lib/shellState';
import { resetWorkspaceTransition } from './lib/delayedLoading';
import { useDelayedLoading } from './shared/hooks/useDelayedLoading';
import { useDialogFocus } from './shared/hooks/useDialogFocus';
import { ToastContainer, type ToastItem, type ToastType } from './shared/components/Toast';
import { AuthScreen } from './features/auth/AuthScreen';
import { ProfileOnboarding } from './features/auth/ProfileOnboarding';
import { useAuthAndProfile } from './features/auth/hooks/useAuthAndProfile';
import { AuthenticatedWorkspaceShell } from './features/shell/AuthenticatedWorkspaceShell';
import { useShellLayout } from './features/shell/hooks/useShellLayout';
import { useBootDeepLinks, type PendingInviteInfo } from './features/shell/hooks/useBootDeepLinks';
import { useCallNotifications } from './features/shell/hooks/useCallNotifications';
import { WorkspaceLoadingScreen } from './features/workspace/WorkspaceLoadingScreen';
import { useWorkspaceDirectory } from './features/workspace/hooks/useWorkspaceDirectory';
import { useWebRtcRoomEngine } from './features/room/hooks/useWebRtcRoomEngine';
import type { DiscardFormKind, Room } from './types/workspace';
import './styles/index.css';

export function App() {
  const [lang, setLang] = useState<Language>(() => getInitialLanguage());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('bifrost_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [discardForm, setDiscardForm] = useState<DiscardFormKind | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingInviteInfo | null>(null);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const activeRoomRef = useRef<Room | null>(null);
  const [peersCount, setPeersCount] = useState(0);

  const leaveRoomRef = useRef<(navigate?: boolean) => void>(() => {});
  const resetDirRef = useRef<() => void>(() => {});
  const setSelectedWsRef = useRef<(id: string) => void>(() => {});
  const setRoomOnlineCountsRef = useRef<React.Dispatch<React.SetStateAction<Record<string, number>>>>(() => {});
  const unauthorizedLogoutRef = useRef<() => void>(() => {});

  const t = useCallback(
    (key: I18nKey, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang],
  );

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID();
    const duration = type === 'error' ? 6000 : 4000;
    setToasts((prev) => [...prev.slice(-3), { id, message, type, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const handleSuccessToast = useCallback((message: string) => addToast(message, 'success'), [addToast]);
  const handleErrorToast = useCallback((message: string) => addToast(message, 'error'), [addToast]);

  const toggleLang = useCallback((next: Language) => {
    setLang(next);
    saveLanguage(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((cur) => (cur === 'light' ? 'dark' : 'light'));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bifrost_theme', theme);
  }, [theme]);

  const handleRouteWorkspaceId = useCallback((workspaceId: string) => {
    setSelectedWsRef.current(workspaceId);
  }, []);

  const handleRoomOnlineCounts = useCallback((counts: Record<string, number>) => {
    setRoomOnlineCountsRef.current(counts);
  }, []);

  const shell = useShellLayout({
    lang,
    t,
    currentRoomId: currentRoom?.id,
    currentRoomWorkspaceId: currentRoom?.workspaceId,
    roomReadOnly: currentRoom?.access === 'VIEWER',
    peersCount,
    onRouteWorkspaceId: handleRouteWorkspaceId,
  });

  const handleCleanupBeforeLogout = useCallback(() => {
    leaveRoomRef.current(false);
    resetDirRef.current();
    shell.setIsSidebarOpen(false);
    shell.setIsRightPanelOpen(false);
    shell.hideRailTip();
    setRoomOnlineCountsRef.current({});
    shell.changeRoute({ workspaceId: '', roomId: '', tab: 'meeting' }, true);
  }, [shell]);

  const handleLoggedOut = useCallback(() => {
    /* Handled in cleanup */
  }, []);

  const auth = useAuthAndProfile({
    t,
    addToast,
    setDiscardForm,
    setIsSidebarOpen: shell.setIsSidebarOpen,
    hideRailTip: shell.hideRailTip,
    onCleanupBeforeLogout: handleCleanupBeforeLogout,
    onLoggedOut: handleLoggedOut,
  });

  const dir = useWorkspaceDirectory({
    user: auth.user,
    userId: auth.userId,
    token: auth.token,
    authHeaders: auth.authHeaders,
    lang,
    t,
    addToast,
    requestedRoute: shell.requestedRoute,
    changeRoute: shell.changeRoute,
    activeTab: shell.activeTab,
    activeRoomRef,
    currentRoom,
    setCurrentRoom,
    leaveRoom: (navigate) => leaveRoomRef.current(navigate),
    setIsSidebarOpen: shell.setIsSidebarOpen,
    hideRailTip: shell.hideRailTip,
    setDiscardForm,
    onRoomOnlineCounts: handleRoomOnlineCounts,
  });

  const engine = useWebRtcRoomEngine({
    user: auth.user,
    userId: auth.userId,
    token: auth.token,
    tokenRef: auth.tokenRef,
    t,
    addToast,
    handleErrorToast,
    currentRoom,
    setCurrentRoom,
    sharedActiveRoomRef: activeRoomRef,
    peersCount,
    setPeersCount,
    selectedWorkspaceId: dir.selectedWorkspaceId,
    selectedWorkspaceIdRef: dir.selectedWorkspaceIdRef,
    setSelectedWorkspaceId: dir.setSelectedWorkspaceId,
    workspacesRef: dir.workspacesRef,
    setWorkspaces: dir.setWorkspaces,
    setWorkspaceRetry: dir.setWorkspaceRetry,
    workspaceMemberRosterRef: dir.workspaceMemberRosterRef,
    refreshWorkspaceMemberRoster: dir.refreshWorkspaceMemberRoster,
    activeTab: shell.activeTab,
    setActiveTab: shell.setActiveTab,
    changeRoute: shell.changeRoute,
    setIsSidebarOpen: shell.setIsSidebarOpen,
    setIsRightPanelOpen: shell.setIsRightPanelOpen,
    setShowRoomMembersModal: dir.setShowRoomMembersModal,
    hideRailTip: shell.hideRailTip,
    setRooms: dir.setRooms,
    setRoomsLoadedFor: dir.setRoomsLoadedFor,
    setRoomLoadError: dir.setRoomLoadError,
    onUnauthorizedSession: () => unauthorizedLogoutRef.current(),
  });

  useEffect(() => {
    leaveRoomRef.current = engine.leaveRoom;
    resetDirRef.current = dir.resetDirectoryState;
    setSelectedWsRef.current = dir.setSelectedWorkspaceId;
    setRoomOnlineCountsRef.current = engine.setRoomOnlineCounts;
    unauthorizedLogoutRef.current = auth.logout;
  }, [engine.leaveRoom, dir.resetDirectoryState, dir.setSelectedWorkspaceId, engine.setRoomOnlineCounts, auth.logout]);

  useBootDeepLinks({
    userId: auth.userId,
    token: auth.token,
    addToast,
    refreshAccessToken: auth.refreshAccessToken,
    setPendingInvite,
    setUser: auth.setUser,
    setWorkspaceRetry: dir.setWorkspaceRetry,
    setSelectedWorkspaceId: dir.setSelectedWorkspaceId,
    t,
  });

  useCallNotifications({
    token: auth.token,
    userId: auth.userId,
    activeRoomRef: engine.activeRoomRef,
    setSelectedWorkspaceId: dir.setSelectedWorkspaceId,
    addToast,
    t,
  });

  useEffect(() => {
    if (auth.authReady) resetWorkspaceTransition();
  }, [auth.authReady]);

  const activeDialog = discardForm
    ? ''
    : auth.showProfileModal
      ? 'profile'
      : dir.showCreateWsModal
        ? 'workspace'
        : dir.editingWorkspace && !dir.confirmDeleteWorkspace
          ? 'editWorkspace'
          : dir.showCreateRoomModal
            ? 'room'
            : dir.editingRoom && !dir.confirmDeleteRoom
              ? 'editRoom'
              : dir.showInviteModal
                ? 'invite'
                : dir.showRoomMembersModal
                  ? 'roomMembers'
                  : '';

  useDialogFocus(
    activeDialog,
    () => {
      if (activeDialog === 'profile') auth.closeProfileForm();
      if (activeDialog === 'workspace') dir.closeWorkspaceForm();
      if (activeDialog === 'editWorkspace') dir.closeEditWorkspaceForm();
      if (activeDialog === 'room') dir.closeRoomForm();
      if (activeDialog === 'editRoom') dir.closeEditRoomForm();
      if (activeDialog === 'invite') dir.closeInviteForm();
      if (activeDialog === 'roomMembers') dir.setShowRoomMembersModal(false);
    },
    '.app-shell .motion-presence:not([data-exiting]) > .modal-overlay .modal-card',
  );
  useDialogFocus(
    Boolean(auth.user) && shell.isSidebarOpen && shell.compactLayout,
    () => shell.setIsSidebarOpen(false),
    '.app-sidebar',
  );
  useDialogFocus(
    Boolean(auth.user) && shell.isRightPanelOpen && shell.compactLayout && Boolean(currentRoom),
    () => shell.setIsRightPanelOpen(false),
    '.right-panel',
  );

  const restoreRoomRoute = useEffectEvent(() => {
    if (
      !auth.user ||
      dir.workspaceLoading ||
      dir.roomsLoading ||
      shell.requestedRoute.workspaceId !== dir.selectedWorkspaceId
    ) {
      return;
    }
    if (!shell.requestedRoute.roomId) {
      if (engine.activeRoomRef.current) engine.leaveRoom(false);
      return;
    }
    if (dir.roomsLoadedFor !== dir.selectedWorkspaceId) return;
    const target = dir.rooms.find((room) => room.id === shell.requestedRoute.roomId);
    if (target && target.access !== null) {
      if (engine.activeRoomRef.current?.id !== target.id) engine.joinRoom(target, false);
      shell.setActiveTab(shell.requestedRoute.tab);
    } else if (engine.activeRoomRef.current) {
      engine.leaveRoom(false);
    }
  });

  // Room entry synchronizes the browser URL with the external WebRTC session after room loading.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    restoreRoomRoute();
  }, [
    shell.requestedRoute,
    dir.rooms,
    dir.roomsLoading,
    dir.roomsLoadedFor,
    dir.workspaceLoading,
    dir.selectedWorkspaceId,
    auth.user,
  ]);

  const routeUnavailable =
    !dir.workspaceLoading &&
    !!shell.requestedRoute.roomId &&
    dir.roomsLoadedFor === dir.selectedWorkspaceId &&
    !dir.roomsLoading &&
    !dir.rooms.some((room) => room.id === shell.requestedRoute.roomId && room.access !== null);

  const statusDisplay = getSessionStatusDisplay(engine.sessionStatus, lang);
  const roomsPending = Boolean(
    dir.selectedWorkspace &&
      (dir.roomsLoading || (dir.roomsLoadedFor !== dir.selectedWorkspace.id && !dir.roomLoadError)),
  );
  const sidebarRoomsPending = dir.workspaceLoading || roomsPending;
  const activeDashboard = Boolean(auth.authReady && auth.user && !engine.currentRoom);
  const showWorkspaceSkeleton = useDelayedLoading(
    activeDashboard && !routeUnavailable && dir.workspaceLoading,
  );
  const showRoomsSkeleton = useDelayedLoading(
    activeDashboard && !routeUnavailable && !dir.workspaceLoading && !dir.workspaceLoadError && roomsPending,
  );
  const showSidebarRoomsSkeleton = useDelayedLoading(Boolean(auth.authReady && auth.user && sidebarRoomsPending));

  if (!auth.authReady) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t('common.close')} />
        <WorkspaceLoadingScreen phase="session" lang={lang} theme={theme} />
      </>
    );
  }

  if (!auth.user) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t('common.close')} />
        <AuthScreen
          mode={auth.authMode}
          lang={lang}
          theme={theme}
          name={auth.authName}
          email={auth.authEmail}
          password={auth.authPassword}
          error={auth.authError}
          submitting={auth.authSubmitting}
          twoFactorChallenge={Boolean(auth.twoFactorChallengeToken)}
          twoFactorCode={auth.twoFactorLoginCode}
          pendingInvite={pendingInvite}
          onName={auth.setAuthName}
          onEmail={auth.setAuthEmail}
          onPassword={auth.setAuthPassword}
          onTwoFactorCode={auth.setTwoFactorLoginCode}
          onCancelTwoFactor={() => {
            auth.setTwoFactorChallengeToken('');
            auth.setTwoFactorLoginCode('');
            auth.setAuthError('');
          }}
          onLanguage={toggleLang}
          onTheme={toggleTheme}
          onMode={() => {
            auth.setAuthMode(auth.authMode === 'login' ? 'register' : 'login');
            auth.setAuthError('');
            auth.setAuthPassword('');
          }}
          onSubmit={auth.submitAuth}
        />
      </>
    );
  }

  if (
    !dir.workspaceLoading &&
    !dir.workspaceLoadError &&
    dir.workspaces.length === 0 &&
    !auth.user.profile?.completedAt
  ) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t('common.close')} />
        <ProfileOnboarding
          name={auth.user.name}
          email={auth.user.email}
          lang={lang}
          onLogout={auth.logout}
          onSave={auth.completeOnboarding}
        />
      </>
    );
  }

  return (
    <AuthenticatedWorkspaceShell
      lang={lang}
      theme={theme}
      t={t}
      toasts={toasts}
      dismissToast={dismissToast}
      addToast={addToast}
      handleSuccessToast={handleSuccessToast}
      handleErrorToast={handleErrorToast}
      toggleLang={toggleLang}
      toggleTheme={toggleTheme}
      discardForm={discardForm}
      setDiscardForm={setDiscardForm}
      shell={shell}
      auth={auth}
      dir={dir}
      engine={engine}
      statusDisplay={statusDisplay}
      routeUnavailable={routeUnavailable}
      roomsPending={roomsPending}
      sidebarRoomsPending={sidebarRoomsPending}
      showWorkspaceSkeleton={showWorkspaceSkeleton}
      showRoomsSkeleton={showRoomsSkeleton}
      showSidebarRoomsSkeleton={showSidebarRoomsSkeleton}
    />
  );
}

export default App;
