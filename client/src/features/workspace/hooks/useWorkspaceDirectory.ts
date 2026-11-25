import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { apiUrl, fetchAppApi, isDevMockSession } from '../../../lib/appApi';
import { withCurrentUserHost } from '../../../lib/roomHostProfile';
import type { WorkspaceMemberAccessRecord } from '../../../lib/peerIdentity';
import type { WorkspaceRoute } from '../../../lib/roomUiState';
import type { RoomTabId } from '../../../lib/roomTabs';
import { formatInviteError, formatRoomError, formatWorkspaceError, type I18nKey, type Language } from '../../../i18n';
import type { ToastType } from '../../../shared/components/Toast';
import type { DiscardFormKind, Room, User, Workspace } from '../../../types/workspace';

export interface UseWorkspaceDirectoryOptions {
  user: User | null;
  userId: string;
  token: string;
  authHeaders: () => Record<string, string>;
  lang: Language;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  requestedRoute: WorkspaceRoute;
  changeRoute: (route: WorkspaceRoute, replace?: boolean) => void;
  activeTab: RoomTabId;
  activeRoomRef: MutableRefObject<Room | null>;
  currentRoom: Room | null;
  setCurrentRoom: React.Dispatch<React.SetStateAction<Room | null>>;
  leaveRoom: (navigate?: boolean) => void;
  setIsSidebarOpen: (open: boolean) => void;
  hideRailTip: () => void;
  setDiscardForm: (kind: DiscardFormKind | null) => void;
  onRoomOnlineCounts?: (counts: Record<string, number>) => void;
}

export function useWorkspaceDirectory({
  user,
  userId,
  token,
  authHeaders,
  lang,
  t,
  addToast,
  requestedRoute,
  changeRoute,
  activeTab,
  activeRoomRef,
  currentRoom,
  setCurrentRoom,
  leaveRoom,
  setIsSidebarOpen,
  hideRailTip,
  setDiscardForm,
  onRoomOnlineCounts,
}: UseWorkspaceDirectoryOptions) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceLoadError, setWorkspaceLoadError] = useState(false);
  const [workspaceRetry, setWorkspaceRetry] = useState(0);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceSubmitting, setWorkspaceSubmitting] = useState(false);
  const [showCreateWsModal, setShowCreateWsModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editWorkspaceName, setEditWorkspaceName] = useState('');
  const [editWorkspaceError, setEditWorkspaceError] = useState('');
  const [editWorkspaceSubmitting, setEditWorkspaceSubmitting] = useState(false);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState(false);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoomMembersModal, setShowRoomMembersModal] = useState(false);
  const [membersVersion, setMembersVersion] = useState(0);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState('');
  const [generatingInviteLink, setGeneratingInviteLink] = useState(false);

  const [roomSnapshots, setRooms] = useState<Room[]>([]);
  const rooms = useMemo(() => roomSnapshots.map((room) => withCurrentUserHost(room, user)), [roomSnapshots, user]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsLoadedFor, setRoomsLoadedFor] = useState('');
  const [roomsVersion, setRoomsVersion] = useState(0);
  const [roomSearch, setRoomSearch] = useState('');
  const roomSearchRef = useRef<HTMLInputElement>(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [roomMessage, setRoomMessage] = useState('');
  const [roomLoadError, setRoomLoadError] = useState('');
  const [roomSubmitting, setRoomSubmitting] = useState(false);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editRoomName, setEditRoomName] = useState('');
  const [editRoomDesc, setEditRoomDesc] = useState('');
  const [editRoomError, setEditRoomError] = useState('');
  const [editRoomSubmitting, setEditRoomSubmitting] = useState(false);
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState(false);
  const lastManagedRoomIdRef = useRef<string | null>(null);

  const workspacesRef = useRef(workspaces);
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId);
  const workspaceMemberRosterRef = useRef<{
    workspaceId: string;
    source?: string;
    members: WorkspaceMemberAccessRecord[];
  } | null>(null);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId);

  const refreshWorkspaceMemberRoster = useCallback(
    async (workspaceId: string, signal?: AbortSignal): Promise<void> => {
      if (!workspaceId || !token) return;
      if (isDevMockSession(token)) {
        const ws = workspacesRef.current.find((item) => item.id === workspaceId);
        if (!ws || !user) return;
        workspaceMemberRosterRef.current = {
          workspaceId,
          source: 'mock',
          members: [
            {
              userId: user.id,
              role: ws.role,
            },
          ],
        };
        return;
      }
      try {
        const response = await fetchAppApi(apiUrl(`/workspaces/${workspaceId}/members`), {
          headers: authHeaders(),
          signal,
        });
        if (!response.ok || signal?.aborted) return;
        const body = (await response.json()) as {
          source?: string;
          members?: Array<
            WorkspaceMemberAccessRecord & {
              presence?: { status?: string; currentRoomId?: string | null };
            }
          >;
        };
        if (signal?.aborted || !Array.isArray(body.members)) return;
        if (selectedWorkspaceIdRef.current !== workspaceId && activeRoomRef.current?.workspaceId !== workspaceId) {
          return;
        }
        workspaceMemberRosterRef.current = {
          workspaceId,
          source: body.source,
          members: body.members,
        };
        const counts: Record<string, number> = {};
        for (const member of body.members) {
          if (member.presence?.status === 'online' && member.presence.currentRoomId) {
            counts[member.presence.currentRoomId] = (counts[member.presence.currentRoomId] ?? 0) + 1;
          }
        }
        onRoomOnlineCounts?.(counts);
      } catch {
        // Transient roster refresh failures keep the latest valid snapshot.
      }
    },
    [activeRoomRef, authHeaders, onRoomOnlineCounts, token, user],
  );

  useEffect(() => {
    if (!userId || workspaceLoading || !selectedWorkspaceId || !token) {
      workspaceMemberRosterRef.current = null;
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void refreshWorkspaceMemberRoster(selectedWorkspaceId, controller.signal);
      }
    });
    return () => controller.abort();
  }, [userId, workspaceLoading, selectedWorkspaceId, token, membersVersion, roomsVersion, refreshWorkspaceMemberRoster]);

  // Load workspaces
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    fetchAppApi(apiUrl('/workspaces'), { headers: authHeaders(), signal: controller.signal })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (controller.signal.aborted) return;
        setWorkspaceLoading(false);
        if (!ok || !Array.isArray(body.workspaces)) {
          setWorkspaceLoadError(true);
          addToast(t('workspace.loadErrorTitle'), 'error');
          return;
        }
        setWorkspaceLoadError(false);
        const list = body.workspaces as Workspace[];
        setWorkspaces(list);
        const preferred =
          list.find((ws) => ws.id === requestedRoute.workspaceId)?.id ??
          list.find((ws) => ws.id === selectedWorkspaceIdRef.current)?.id ??
          list[0]?.id ??
          '';
        setSelectedWorkspaceId(preferred);
        if (preferred) {
          changeRoute(
            {
              workspaceId: preferred,
              roomId: preferred === requestedRoute.workspaceId ? requestedRoute.roomId : '',
              tab: preferred === requestedRoute.workspaceId ? requestedRoute.tab : 'meeting',
            },
            true,
          );
        } else {
          changeRoute({ workspaceId: '', roomId: '', tab: 'meeting' }, true);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setWorkspaceLoading(false);
        setWorkspaceLoadError(true);
        addToast(t('workspace.loadErrorTitle'), 'error');
      });
    return () => controller.abort();
  }, [userId, authHeaders, workspaceRetry, changeRoute, addToast, t, requestedRoute.workspaceId, requestedRoute.roomId, requestedRoute.tab]);

  // Load rooms for selected workspace
  useEffect(() => {
    if (!selectedWorkspaceId) {
      queueMicrotask(() => {
        setRooms([]);
        setRoomsLoading(false);
        setRoomsLoadedFor('');
        setRoomLoadError('');
      });
      return;
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setRoomsLoading(true);
        setRoomLoadError('');
      }
    });

    fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/rooms`), {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          throw new Error(formatRoomError(body.message, lang));
        }
        if (body.rooms) {
          setRooms(body.rooms);
          setRoomsLoadedFor(selectedWorkspaceId);
          setCurrentRoom((prev) => {
            if (!prev) return null;
            const refreshed = body.rooms.find((r: Room) => r.id === prev.id);
            return refreshed ? { ...prev, ...refreshed } : null;
          });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setRoomLoadError(error instanceof Error ? error.message : t('room.loadFailed'));
        addToast(t('room.loadFailed'), 'error');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setRoomsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [selectedWorkspaceId, authHeaders, roomsVersion, lang, addToast, t, setCurrentRoom]);

  const restoreManagedRoomFocus = useCallback(
    () =>
      requestAnimationFrame(() => {
        const id = lastManagedRoomIdRef.current;
        if (!id) return;
        document.querySelector<HTMLButtonElement>(`[data-manage-room-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      }),
    [],
  );

  const restoreWorkspaceManageFocus = useCallback(
    () =>
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>('[data-manage-workspace]')?.focus({ preventScroll: true }),
      ),
    [],
  );

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (workspaceSubmitting) return;
    setWorkspaceError('');
    if (!workspaceName.trim()) {
      setWorkspaceError(t('workspace.nameLengthError'));
      return;
    }

    setWorkspaceSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl('/workspaces'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: workspaceName.trim() }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(formatWorkspaceError(body.message, lang));

      setWorkspaces((prev) => [body.workspace, ...prev]);
      setSelectedWorkspaceId(body.workspace.id);
      changeRoute({ workspaceId: body.workspace.id, roomId: '', tab: 'meeting' }, true);
      setWorkspaceName('');
      setShowCreateWsModal(false);
      addToast(t('workspace.created'), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('workspace.createFailed');
      setWorkspaceError(msg);
      addToast(msg, 'error');
    } finally {
      setWorkspaceSubmitting(false);
    }
  };

  const openEditWorkspaceModal = (ws: Workspace) => {
    setEditingWorkspace(ws);
    setEditWorkspaceName(ws.name);
    setEditWorkspaceError('');
    setConfirmDeleteWorkspace(false);
  };

  const submitEditWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingWorkspace || editWorkspaceSubmitting) return;
    setEditWorkspaceError('');
    if (!editWorkspaceName.trim()) {
      setEditWorkspaceError(t('workspace.nameLengthError'));
      return;
    }

    setEditWorkspaceSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${editingWorkspace.id}`), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ name: editWorkspaceName.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(formatWorkspaceError(body.message, lang));

      setWorkspaces((prev) => prev.map((w) => (w.id === body.workspace.id ? { ...w, ...body.workspace } : w)));
      setEditingWorkspace(null);
      restoreWorkspaceManageFocus();
      addToast(t('workspace.updatedToast', { name: body.workspace.name }), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('workspace.updateFailed');
      setEditWorkspaceError(msg);
      addToast(msg, 'error');
    } finally {
      setEditWorkspaceSubmitting(false);
    }
  };

  const executeDeleteWorkspace = async () => {
    if (!editingWorkspace || editWorkspaceSubmitting) return;
    setEditWorkspaceSubmitting(true);
    setEditWorkspaceError('');
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${editingWorkspace.id}`), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(formatWorkspaceError(body.message, lang));

      const deletedId = editingWorkspace.id;
      const deletedName = editingWorkspace.name;
      const remaining = workspaces.filter((w) => w.id !== deletedId);
      setWorkspaces(remaining);
      if (selectedWorkspaceId === deletedId) {
        leaveRoom(false);
        const nextId = remaining[0]?.id ?? '';
        setSelectedWorkspaceId(nextId);
        changeRoute({ workspaceId: nextId, roomId: '', tab: 'meeting' }, true);
      }
      setEditingWorkspace(null);
      setConfirmDeleteWorkspace(false);
      addToast(t('workspace.deletedToast', { name: deletedName }), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('workspace.deleteFailed');
      setEditWorkspaceError(msg);
      addToast(msg, 'error');
    } finally {
      setEditWorkspaceSubmitting(false);
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId || inviteSubmitting) return;
    setInviteError('');
    if (!inviteEmail.trim()) {
      setInviteError(t('workspace.inviteFailed'));
      return;
    }

    setInviteSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/invites`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email: inviteEmail.trim(), role: 'MEMBER' }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(formatInviteError(body.message, lang));

      setInviteEmail('');
      setMembersVersion((v) => v + 1);
      addToast(
        body.emailSent ? t('workspace.inviteEmailSentToast') : t('workspace.memberInvited'),
        'success',
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('workspace.inviteFailed');
      setInviteError(msg);
      addToast(msg, 'error');
    } finally {
      setInviteSubmitting(false);
    }
  };

  const createOneClickInviteLink = useCallback(async () => {
    if (!selectedWorkspaceId || generatingInviteLink || isDevMockSession(token)) return;
    setGeneratingInviteLink(true);
    setInviteError('');
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/invites`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('workspace.inviteFailed'));
      if (typeof body.inviteUrl === 'string') {
        setGeneratedInviteUrl(body.inviteUrl);
        try {
          await navigator.clipboard.writeText(body.inviteUrl);
          addToast(t('workspace.inviteLinkCopiedToast'), 'success');
        } catch {
          // Clipboard permission may be restricted; link stays visible to copy manually.
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('workspace.inviteFailed');
      setInviteError(msg);
      addToast(msg, 'error');
    } finally {
      setGeneratingInviteLink(false);
    }
  }, [selectedWorkspaceId, generatingInviteLink, token, authHeaders, addToast, t]);

  const createRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId || roomSubmitting) return;
    setRoomMessage('');
    if (!newRoomName.trim()) {
      setRoomMessage(t('room.nameLengthError'));
      return;
    }

    setRoomSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/rooms`), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: newRoomName.trim(),
          description: newRoomDesc.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(formatRoomError(body.message, lang));

      setRooms((prev) => [body.room, ...prev]);
      setNewRoomName('');
      setNewRoomDesc('');
      setShowCreateRoomModal(false);
      addToast(t('room.created', { name: body.room.name }), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('room.createFailed');
      setRoomMessage(msg);
      addToast(msg, 'error');
    } finally {
      setRoomSubmitting(false);
    }
  };

  const openEditRoomModal = (room: Room) => {
    lastManagedRoomIdRef.current = room.id;
    setEditingRoom(room);
    setEditRoomName(room.name);
    setEditRoomDesc(room.description || '');
    setEditRoomError('');
    setConfirmDeleteRoom(false);
  };

  const submitEditRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingRoom || editRoomSubmitting) return;
    setEditRoomError('');
    if (!editRoomName.trim()) {
      setEditRoomError(t('room.nameLengthError'));
      return;
    }

    setEditRoomSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${editingRoom.workspaceId}/rooms/${editingRoom.id}`), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          name: editRoomName.trim(),
          description: editRoomDesc.trim() || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(formatRoomError(body.message, lang));

      setRooms((prev) => prev.map((r) => (r.id === body.room.id ? { ...r, ...body.room } : r)));
      if (currentRoom?.id === body.room.id) {
        setCurrentRoom({ ...currentRoom, ...body.room });
        activeRoomRef.current = activeRoomRef.current ? { ...activeRoomRef.current, ...body.room } : null;
      }
      setEditingRoom(null);
      restoreManagedRoomFocus();
      addToast(t('room.updatedToast', { name: body.room.name }), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('room.updateFailed');
      setEditRoomError(msg);
      addToast(msg, 'error');
    } finally {
      setEditRoomSubmitting(false);
    }
  };

  const executeDeleteRoom = async () => {
    if (!editingRoom || editRoomSubmitting) return;
    setEditRoomSubmitting(true);
    setEditRoomError('');
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${editingRoom.workspaceId}/rooms/${editingRoom.id}`), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(formatRoomError(body.message, lang));

      const deletedId = editingRoom.id;
      const deletedName = editingRoom.name;
      setRooms((prev) => prev.filter((r) => r.id !== deletedId));
      if (currentRoom?.id === deletedId) {
        leaveRoom();
      }
      setEditingRoom(null);
      setConfirmDeleteRoom(false);
      addToast(t('room.deletedToast', { name: deletedName }), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('room.deleteFailed');
      setEditRoomError(msg);
      addToast(msg, 'error');
    } finally {
      setEditRoomSubmitting(false);
    }
  };

  const handleWorkspaceChange = useCallback(
    (nextWorkspaceId: string) => {
      setIsSidebarOpen(false);
      hideRailTip();
      if (activeRoomRef.current && nextWorkspaceId !== activeRoomRef.current.workspaceId) {
        leaveRoom(false);
      }
      setSelectedWorkspaceId(nextWorkspaceId);
      const keepRoom = activeRoomRef.current && activeRoomRef.current.workspaceId === nextWorkspaceId;
      changeRoute({
        workspaceId: nextWorkspaceId,
        roomId: keepRoom ? activeRoomRef.current!.id : '',
        tab: keepRoom ? activeTab : 'meeting',
      });
    },
    [activeRoomRef, activeTab, changeRoute, hideRailTip, leaveRoom, setIsSidebarOpen],
  );

  const retryWorkspaces = useCallback(() => {
    setWorkspaceLoading(true);
    setWorkspaceLoadError(false);
    setWorkspaceRetry((value) => value + 1);
  }, []);

  const retryRooms = useCallback(() => {
    setRoomsLoading(true);
    setRoomLoadError('');
    setRoomsVersion((value) => value + 1);
  }, []);

  const openWorkspaceForm = useCallback(() => {
    hideRailTip();
    setIsSidebarOpen(false);
    setWorkspaceError('');
    setWorkspaceName('');
    setShowCreateWsModal(true);
  }, [hideRailTip, setIsSidebarOpen]);

  const openRoomForm = useCallback(() => {
    hideRailTip();
    setIsSidebarOpen(false);
    setRoomMessage('');
    setNewRoomName('');
    setNewRoomDesc('');
    setShowCreateRoomModal(true);
  }, [hideRailTip, setIsSidebarOpen]);

  const openInviteForm = useCallback(() => {
    hideRailTip();
    setIsSidebarOpen(false);
    setInviteError('');
    setInviteEmail('');
    setShowInviteModal(true);
  }, [hideRailTip, setIsSidebarOpen]);

  const closeWorkspaceForm = useCallback(() => {
    if (workspaceSubmitting) return;
    if (workspaceName.trim()) setDiscardForm('workspace');
    else setShowCreateWsModal(false);
  }, [setDiscardForm, workspaceName, workspaceSubmitting]);

  const closeEditWorkspaceForm = useCallback(() => {
    if (editWorkspaceSubmitting || !editingWorkspace) return;
    if (editWorkspaceName.trim() !== editingWorkspace.name) setDiscardForm('editWorkspace');
    else {
      setEditingWorkspace(null);
      restoreWorkspaceManageFocus();
    }
  }, [editWorkspaceName, editWorkspaceSubmitting, editingWorkspace, restoreWorkspaceManageFocus, setDiscardForm]);

  const closeRoomForm = useCallback(() => {
    if (roomSubmitting) return;
    if (newRoomName.trim() || newRoomDesc.trim()) setDiscardForm('room');
    else setShowCreateRoomModal(false);
  }, [newRoomDesc, newRoomName, roomSubmitting, setDiscardForm]);

  const closeEditRoomForm = useCallback(() => {
    if (editRoomSubmitting || !editingRoom) return;
    const dirty =
      editRoomName.trim() !== editingRoom.name || editRoomDesc.trim() !== (editingRoom.description ?? '');
    if (dirty) setDiscardForm('editRoom');
    else {
      setEditingRoom(null);
      restoreManagedRoomFocus();
    }
  }, [editRoomDesc, editRoomName, editRoomSubmitting, editingRoom, restoreManagedRoomFocus, setDiscardForm]);

  const closeInviteForm = useCallback(() => {
    if (inviteSubmitting) return;
    if (inviteEmail.trim()) setDiscardForm('invite');
    else setShowInviteModal(false);
  }, [inviteEmail, inviteSubmitting, setDiscardForm]);

  const resetDirectoryState = useCallback(() => {
    workspaceMemberRosterRef.current = null;
    setWorkspaces([]);
    setWorkspaceLoading(false);
    setWorkspaceLoadError(false);
    setSelectedWorkspaceId('');
    setRooms([]);
    setRoomsLoading(false);
    setRoomsLoadedFor('');
    setShowCreateRoomModal(false);
    setShowCreateWsModal(false);
    setShowInviteModal(false);
    setShowRoomMembersModal(false);
    setEditingRoom(null);
    setConfirmDeleteRoom(false);
    setEditingWorkspace(null);
    setConfirmDeleteWorkspace(false);
    setRoomMessage('');
    setRoomLoadError('');
    setInviteError('');
    setWorkspaceError('');
  }, []);

  return {
    workspaces,
    setWorkspaces,
    workspacesRef,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedWorkspaceIdRef,
    selectedWorkspace,
    workspaceLoading,
    workspaceLoadError,
    setWorkspaceRetry,
    retryWorkspaces,
    workspaceName,
    setWorkspaceName,
    workspaceError,
    setWorkspaceError,
    workspaceSubmitting,
    showCreateWsModal,
    setShowCreateWsModal,
    editingWorkspace,
    setEditingWorkspace,
    editWorkspaceName,
    setEditWorkspaceName,
    editWorkspaceError,
    setEditWorkspaceError,
    editWorkspaceSubmitting,
    confirmDeleteWorkspace,
    setConfirmDeleteWorkspace,
    showInviteModal,
    setShowInviteModal,
    showRoomMembersModal,
    setShowRoomMembersModal,
    membersVersion,
    setMembersVersion,
    inviteEmail,
    setInviteEmail,
    inviteError,
    setInviteError,
    inviteSubmitting,
    generatedInviteUrl,
    generatingInviteLink,
    rooms,
    setRooms,
    roomsLoading,
    roomsLoadedFor,
    setRoomsLoadedFor,
    setRoomLoadError,
    setRoomsVersion,
    retryRooms,
    roomSearch,
    setRoomSearch,
    roomSearchRef,
    newRoomName,
    setNewRoomName,
    newRoomDesc,
    setNewRoomDesc,
    roomMessage,
    setRoomMessage,
    roomLoadError,
    roomSubmitting,
    showCreateRoomModal,
    setShowCreateRoomModal,
    editingRoom,
    setEditingRoom,
    editRoomName,
    setEditRoomName,
    editRoomDesc,
    setEditRoomDesc,
    editRoomError,
    setEditRoomError,
    editRoomSubmitting,
    confirmDeleteRoom,
    setConfirmDeleteRoom,
    lastManagedRoomIdRef,
    workspaceMemberRosterRef,
    refreshWorkspaceMemberRoster,
    restoreManagedRoomFocus,
    restoreWorkspaceManageFocus,
    createWorkspace,
    openEditWorkspaceModal,
    submitEditWorkspace,
    executeDeleteWorkspace,
    inviteMember,
    createOneClickInviteLink,
    createRoom,
    openEditRoomModal,
    submitEditRoom,
    executeDeleteRoom,
    handleWorkspaceChange,
    openWorkspaceForm,
    openRoomForm,
    openInviteForm,
    closeWorkspaceForm,
    closeEditWorkspaceForm,
    closeRoomForm,
    closeEditRoomForm,
    closeInviteForm,
    resetDirectoryState,
  };
}
