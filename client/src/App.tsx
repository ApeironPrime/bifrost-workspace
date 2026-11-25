import { useTabTransition } from './features/room/hooks/useTabTransition'
import { tabDirection } from './lib/tabDirection'
import { useRoomTabIndicator } from './features/room/hooks/useRoomTabIndicator'
import { useRoomMedia } from './features/room/hooks/useRoomMedia'
import {
  getNextRoomTab,
  roomPanelElementId,
  roomTabElementId,
  syncEmptyTabPanelTabIndex,
  type RoomTabId,
} from './lib/roomTabs'
import { readWorkspaceRoute, workspaceHash, roomDraftKey, readRoomDraft, readRoomNoteUpdatedAt, type BoardState, type WorkspaceRoute } from './lib/roomUiState'
import { HybridLogicalClock, isIncomingNewer } from './lib/hlc'
import {
  authorizeSignalingPeer,
  clearPeerRegistry,
  dispatchVerifiedDataChannelPayload,
  removeVerifiedPeer,
  replacePeerRegistryFromPresence,
  resolvePeerRoomAccessRole,
  resolveVerifiedPeer,
  upsertVerifiedPeerFromJoin,
  type VerifiedPeerIdentity,
  type WorkspaceMemberAccessRecord,
} from './lib/peerIdentity'
import {
  applyChatPin,
  applyChatReaction,
  buildNoteResyncEnvelope,
  buildNoteUnshareEnvelope,
  buildNoteUpdateEnvelope,
  createChatOutboundPayload,
  deriveNoteShareStatus,
  normalizeIncomingChatMessage,
  normalizeIncomingSharedNote,
  readRoomChatCache,
  reconcileChatMessages,
  roomChatCacheKey,
  writeRoomChatCache,
  type ChatActionDataEnvelope,
  type ChatDataEnvelope,
  type ChatMessageItem,
  type ChatReplySummary,
  type ChatSyncDataEnvelope,
  type NoteDataEnvelope,
  type SharedNoteItem,
} from './lib/chatNotes'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { type MeetingBoardMessage } from "./features/room/components/MeetingBoard";
import { type FileShareMessage } from "./features/room/components/FileShare";
import { ToastContainer, type ToastItem, type ToastType } from "./shared/components/Toast";
import {
  formatInviteError,
  formatRoomError,
  formatWorkspaceError,
  getInitialLanguage,
  saveLanguage,
  translate,
  type I18nKey,
  type Language,
} from "./i18n";
import { AuthScreen } from "./features/auth/AuthScreen";
import { apiUrl, fetchAppApi, isDevMockSession, SIGNALING_URL } from "./lib/appApi";
import { getNotificationPermissionState } from "./lib/callNotification";
import {
  createRoomIceManager,
  inspectPeerSelectedCandidateType,
  shouldRestartPeerForIceRenewal,
  updatePeerIceServersSafely,
  type IceConfigSnapshot,
  type RoomIceManager,
} from "./lib/iceConfig";
import {
  clearPeerSignalingRecord,
  createPeerSignalingRecord,
  handleIncomingAnswer,
  handleIncomingIceCandidate,
  handleIncomingOffer,
  handlePeerConnectionStateTransition,
  negotiatePeerOffer,
  type PeerSignalingRecord,
} from "./lib/peerSignaling";
import { ProfileOnboarding } from './features/auth/ProfileOnboarding';
import { ProfileSecurityModal } from './features/auth/ProfileSecurityModal';
import { AppHeader } from './features/shell/AppHeader';
import { AppSidebar } from './features/shell/AppSidebar';
import { useBootDeepLinks, type PendingInviteInfo } from './features/shell/hooks/useBootDeepLinks';
import { useCallNotifications } from './features/shell/hooks/useCallNotifications';
import { DashboardView } from './features/workspace/DashboardView';
import { WorkspaceModals } from './features/workspace/WorkspaceModals';
import { RoomWorkspaceView } from './features/room/components/RoomWorkspaceView';
import { SidebarRailTooltip } from './shared/components/SidebarRailTooltip';
import { createRailTipStore } from './lib/railTipStore';
import { resetWorkspaceTransition } from './lib/delayedLoading';
import { useDelayedLoading } from './shared/hooks/useDelayedLoading';
import { WorkspaceLoadingScreen } from './features/workspace/WorkspaceLoadingScreen';
import { withCurrentUserHost } from './lib/roomHostProfile';
import { BUFFERED_LOW_THRESHOLD } from './lib/fileTransfer';
import { canComposeRoomMessage, openConnectionCount } from './lib/roomControls';
import { useDialogFocus } from './shared/hooks/useDialogFocus';
import {
  getSessionStatusDisplay,
  type SessionStatus,
} from './lib/shellState';
import type {
  DiscardFormKind,
  PresencePeer,
  Room,
  User,
  Workspace,
} from './types/workspace';
import './styles/index.css';

const EMPTY_USER_IDS = new Set<string>();

type ChatMessage = ChatMessageItem;
type SharedNote = SharedNoteItem;
type DataEnvelope =
  | ChatDataEnvelope
  | ChatActionDataEnvelope
  | ChatSyncDataEnvelope
  | NoteDataEnvelope
  | MeetingBoardMessage
  | FileShareMessage;

type RoomTab = RoomTabId;

function createMemberName() {
  return `Member ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function App() {
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const channelsRef = useRef(new Map<string, RTCDataChannel>());
  const peerSignalingRef = useRef(new Map<string, PeerSignalingRecord>());
  const peerCreatePromisesRef = useRef(new Map<string, Promise<void>>());
  const iceManagerRef = useRef<RoomIceManager | null>(null);
  const onTurnCredentialsRefreshedRef = useRef<(snapshot: IceConfigSnapshot, generation: number) => Promise<void>>(async () => {});
  const onTurnUnauthorizedRef = useRef<() => void>(() => {});
  const memberNameRef = useRef(createMemberName());
  const activeRoomRef = useRef<Room | null>(null);
  const noteTextRef = useRef("");
  const noteUpdatedAtRef = useRef<number | undefined>(undefined);
  const noteSharedRef = useRef(false);
  const noteResyncTimerRef = useRef<number | null>(null);
  const onlinePeersRef = useRef<PresencePeer[]>([]);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  // Verified remote identities sourced synchronously from Socket.IO presence/join events
  // (decoupled from UI `onlinePeers` React state; trust state reflects latest server event
  // and cannot detect revocation while Socket.IO signaling is temporarily disconnected).
  const verifiedPeersRef = useRef<Map<string, VerifiedPeerIdentity>>(new Map());
  const workspaceMemberRosterRef = useRef<{
    workspaceId: string;
    source?: string;
    members: WorkspaceMemberAccessRecord[];
  } | null>(null);
  const localPeerIdRef = useRef<string | null>(null);

  const meetingBoardMessageListenersRef = useRef<
    Set<(msg: MeetingBoardMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void>
  >(new Set());
  const meetingBoardPeerConnectListenersRef = useRef<Set<(peerId: string) => void>>(new Set());
  const fileMessageListenersRef = useRef<
    Set<(msg: FileShareMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void>
  >(new Set());
  const fileBinaryListenersRef = useRef<
    Set<(frame: ArrayBuffer, peerId: string, verifiedSender: VerifiedPeerIdentity) => void>
  >(new Set());

  // Internationalization (i18n)
  const [lang, setLang] = useState<Language>(() => getInitialLanguage());
  const chatLogRef = useRef<HTMLDivElement>(null);
  const chatAtBottomRef = useRef(true);
  const [chatError, setChatError] = useState('');
  const [noteError, setNoteError] = useState('');
  const noteErrorRef = useRef('');

  const applyNoteError = useCallback((message: string) => {
    noteErrorRef.current = message;
    setNoteError((prev) => (prev === message ? prev : message));
  }, []);

  const clearNoteResyncTimer = useCallback(() => {
    if (noteResyncTimerRef.current !== null) {
      window.clearTimeout(noteResyncTimerRef.current);
      noteResyncTimerRef.current = null;
    }
  }, []);

  const toggleLang = useCallback((next: Language) => { setLang(next); saveLanguage(next); }, []);

  const t = useCallback(
    (key: I18nKey, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang]
  );
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Dark mode theme
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("bifrost_theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bifrost_theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((cur) => (cur === "light" ? "dark" : "light"));
  }, []);

  // Toast Notifications
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = crypto.randomUUID();
    const duration = type === "error" ? 6000 : 4000;
    setToasts((prev) => [...prev.slice(-3), { id, message, type, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const handleSuccessToast = useCallback((msg: string) => {
    addToast(msg, "success");
  }, [addToast]);

  const handleErrorToast = useCallback((msg: string) => {
    addToast(msg, "error");
  }, [addToast]);

  const handleChatScroll = useCallback(() => {
    const log = chatLogRef.current;
    if (log) chatAtBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
  }, []);

  // Auth states (real API access tokens stay in memory; refresh token lives in HttpOnly cookie)
  const [token, setToken] = useState(() => {
    const stored = localStorage.getItem("bifrost_token") ?? "";
    if (isDevMockSession(stored)) {
      if (import.meta.env.VITE_DATA_MODE === "api") {
        localStorage.removeItem("bifrost_token");
        return "";
      }
      return stored;
    }
    if (stored) {
      localStorage.removeItem("bifrost_token");
    }
    return "";
  });
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (isDevMockSession(token)) {
      (window as unknown as { __bifrost_addToast?: typeof addToast }).__bifrost_addToast = addToast;
    }
  }, [token, addToast]);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(() => {
    const stored = localStorage.getItem("bifrost_token") ?? "";
    if (isDevMockSession(stored) && import.meta.env.VITE_DATA_MODE !== "api") return false;
    return !localStorage.getItem("bifrost_has_session") && !localStorage.getItem("bifrost_refresh_token");
  });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [twoFactorChallengeToken, setTwoFactorChallengeToken] = useState("");
  const [twoFactorLoginCode, setTwoFactorLoginCode] = useState("");
  const [pendingInvite, setPendingInvite] = useState<PendingInviteInfo | null>(null);
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState("");
  const [generatingInviteLink, setGeneratingInviteLink] = useState(false);
  const [emailVerifyCode, setEmailVerifyCode] = useState("");
  const [emailVerifyDevCode, setEmailVerifyDevCode] = useState("");
  const [emailVerifyBusy, setEmailVerifyBusy] = useState(false);
  const [twoFactorSetupSecret, setTwoFactorSetupSecret] = useState("");
  const [twoFactorSetupCode, setTwoFactorSetupCode] = useState("");
  const [twoFactorRecoveryCodes, setTwoFactorRecoveryCodes] = useState<string[]>([]);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(() =>
    getNotificationPermissionState(),
  );

  const [discardForm, setDiscardForm] = useState<DiscardFormKind>(null);
  // Profile states
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [profileImageBusy, setProfileImageBusy] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // Workspace states
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceSubmitting, setWorkspaceSubmitting] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(() => readWorkspaceRoute(location.hash).workspaceId);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [membersVersion, setMembersVersion] = useState(0);
  const [showCreateWsModal, setShowCreateWsModal] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editWorkspaceName, setEditWorkspaceName] = useState("");
  const [editWorkspaceError, setEditWorkspaceError] = useState("");
  const [editWorkspaceSubmitting, setEditWorkspaceSubmitting] = useState(false);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState(false);
  const [roomOnlineCounts, setRoomOnlineCounts] = useState<Record<string, number>>({});
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoomMembersModal, setShowRoomMembersModal] = useState(false);

  const [workspaceLoading, setWorkspaceLoading] = useState(() =>
    Boolean(
      (isDevMockSession(localStorage.getItem("bifrost_token") ?? "") &&
        import.meta.env.VITE_DATA_MODE !== "api") ||
        localStorage.getItem("bifrost_has_session") ||
        localStorage.getItem("bifrost_refresh_token"),
    ),
  );
  const [workspaceLoadError, setWorkspaceLoadError] = useState(false);
  const [workspaceRetry, setWorkspaceRetry] = useState(0);
  const [requestedRoute, setRequestedRoute] = useState(() => readWorkspaceRoute(location.hash));
  const [compactLayout, setCompactLayout] = useState(() => matchMedia('(max-width: 1024px)').matches);
  const changeRoute = useCallback((route: WorkspaceRoute, replace = false) => {
    const hash = workspaceHash(route);
    if(location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null,'',hash);
    setRequestedRoute(route);
  }, []);
  useEffect(() => {
    const restore = () => { if(location.hash.startsWith('#workspace')) { const route=readWorkspaceRoute(location.hash); setRequestedRoute(route); if(route.workspaceId) setSelectedWorkspaceId(route.workspaceId); } };
    addEventListener('popstate',restore); addEventListener('hashchange',restore);
    return () => {removeEventListener('popstate',restore);removeEventListener('hashchange',restore)};
  }, []);


  // Room states
  const [roomSnapshots, setRooms] = useState<Room[]>([]);
  const rooms = useMemo(
    () => roomSnapshots.map(room => withCurrentUserHost(room, user)),
    [roomSnapshots, user],
  );
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsLoadedFor, setRoomsLoadedFor] = useState('');
  const [roomsVersion, setRoomsVersion] = useState(0);
  const [roomSearch, setRoomSearch] = useState("");
  const roomSearchRef = useRef<HTMLInputElement>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomDesc, setNewRoomDesc] = useState("");
  const [roomMessage, setRoomMessage] = useState("");
  const [roomLoadError, setRoomLoadError] = useState("");
  const [roomSubmitting, setRoomSubmitting] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomError, setRoomError] = useState("");
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editRoomName, setEditRoomName] = useState("");
  const [editRoomDesc, setEditRoomDesc] = useState("");
  const [editRoomError, setEditRoomError] = useState("");
  const [editRoomSubmitting, setEditRoomSubmitting] = useState(false);
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState(false);
  const lastManagedRoomIdRef = useRef<string | null>(null);

  // Realtime & P2P states
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>({ kind: "idle" });
  const [onlinePeers, setOnlinePeers] = useState<PresencePeer[]>([]);
  const remotePeerCount = useMemo(
    () => onlinePeers.filter((peer) => peer.userId !== user?.id).length,
    [onlinePeers, user?.id],
  );
  const {
    micEnabled,
    camEnabled,
    screenSharing,
    noiseSuppression,
    backgroundBlur,
    mediaError,
    localAudioStream,
    localVideoStream,
    remoteStreams,
    peerStats,
    meshProfile,
    audioInputs,
    videoInputs,
    audioOutputs,
    selectedMicId,
    selectedCamId,
    selectedSpeakerId,
    speakerSelectionSupported,
    attachPeerMediaHandlers,
    removePeerMedia,
    stopAllRoomMedia,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    toggleNoiseSuppression,
    toggleBackgroundBlur,
    selectMicrophone,
    selectCamera,
    selectSpeaker,
  } = useRoomMedia({
    peersRef,
    activeRoomRef,
    remotePeerCount,
    t,
    onErrorToast: handleErrorToast,
  });
  const [peersCount, setPeersCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [cloudBoard, setCloudBoard] = useState<{ data: BoardState; version: number } | null>(null);
  const [hydratedNote, setHydratedNote] = useState<{ body: string; updatedAt?: number; version: number } | null>(null);
  const userIdRef = useRef("");
  const hlcRef = useRef(new HybridLogicalClock('anon'));
  const noteHlcRef = useRef<string | undefined>(undefined);
  const boardBackupRef = useRef<BoardState | null>(null);
  const collabSaveTimerRef = useRef<number | null>(null);
  const noteSaveTimerRef = useRef<number | null>(null);
  const [noteShared, setNoteShared] = useState(false);
  const [noteResyncing, setNoteResyncing] = useState(false);
  const [sharedNotes, setSharedNotes] = useState<Record<string, SharedNote>>({});

  useEffect(() => clearNoteResyncTimer, [clearNoteResyncTimer]);

  // Layout UI states
  const [activeTab, setActiveTab] = useState<RoomTab>("meeting");
  const tabTransition = useTabTransition();
  const roomTabsRef = useRoomTabIndicator(activeTab, lang, currentRoom?.id);
  const roomTabButtonRefs = useRef<Partial<Record<RoomTab, HTMLButtonElement | null>>>({});
  const filesPanelRef = useRef<HTMLDivElement>(null);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('bifrost_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [copiedRoomId, setCopiedRoomId] = useState(false);
  const railTipStore = useMemo(() => createRailTipStore(), []);
  useEffect(() => {
    const query=matchMedia('(max-width: 1024px)');
    const resize=() => {setCompactLayout(query.matches);setIsSidebarOpen(false);setIsRightPanelOpen(false);railTipStore.set(null)};
    query.addEventListener('change',resize);return () => query.removeEventListener('change',resize);
  }, [railTipStore]);
  useEffect(()=>{
    document.documentElement.lang=lang;
    document.title=t('landing.documentTitle');
  },[lang, t]);
  useEffect(()=>{roomTabButtonRefs.current[activeTab]?.scrollIntoView({block:'nearest',inline:'nearest'})},[activeTab]);
  useEffect(() => {
    const log = chatLogRef.current;
    if (activeTab === 'chat' && log && chatAtBottomRef.current) log.scrollTop = log.scrollHeight;
  }, [messages.length, activeTab]);

  const workspacesRef = useRef(workspaces);
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId);
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);
  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  useEffect(() => {
    onlinePeersRef.current = onlinePeers;
  }, [onlinePeers]);

  const authHeaders = useCallback(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token]
  );

  const addMessage = useCallback(
    (message: Omit<ChatMessage, "id"> & { id?: string }) => {
      const nextMsg: ChatMessage = {
        ...message,
        id: message.id && message.id.trim() ? message.id : crypto.randomUUID(),
      };
      setMessages((current) => {
        const merged = reconcileChatMessages(
          current,
          [nextMsg],
          userIdRef.current,
          tRef.current("chat.you"),
        );
        messagesRef.current = merged;
        const room = activeRoomRef.current;
        if (room && userIdRef.current) {
          writeRoomChatCache(
            localStorage,
            roomChatCacheKey(userIdRef.current, room.workspaceId, room.id),
            merged,
          );
        }
        return merged;
      });
    },
    [],
  );

  const scheduleCollabBackup = useCallback((roomId: string) => {
    if (!roomId || !tokenRef.current || activeRoomRef.current?.access === "VIEWER") return;
    if (collabSaveTimerRef.current !== null) {
      window.clearTimeout(collabSaveTimerRef.current);
    }
    collabSaveTimerRef.current = window.setTimeout(() => {
      collabSaveTimerRef.current = null;
      if (!tokenRef.current || activeRoomRef.current?.id !== roomId || activeRoomRef.current?.access === "VIEWER") {
        return;
      }
      void fetchAppApi(apiUrl(`/rooms/${roomId}/collab`), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messagesRef.current,
          ...(boardBackupRef.current ? { board: boardBackupRef.current } : {}),
          hlc: hlcRef.current.now(),
        }),
      }).catch(() => {});
    }, 800);
  }, []);

  const scheduleNoteBackup = useCallback((roomId: string) => {
    if (!roomId || !tokenRef.current || activeRoomRef.current?.access === "VIEWER") return;
    if (noteSaveTimerRef.current !== null) {
      window.clearTimeout(noteSaveTimerRef.current);
    }
    noteSaveTimerRef.current = window.setTimeout(() => {
      noteSaveTimerRef.current = null;
      if (!tokenRef.current || activeRoomRef.current?.id !== roomId || activeRoomRef.current?.access === "VIEWER") {
        return;
      }
      void fetchAppApi(apiUrl(`/rooms/${roomId}/my-note`), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: noteTextRef.current,
          isShared: noteSharedRef.current,
          updatedAt: noteUpdatedAtRef.current,
          hlc: noteHlcRef.current,
        }),
      }).catch(() => {});
    }, 800);
  }, []);

  const handleBoardStateChange = useCallback(
    (nextBoard: BoardState) => {
      boardBackupRef.current = nextBoard;
      const roomId = activeRoomRef.current?.id;
      if (roomId) scheduleCollabBackup(roomId);
    },
    [scheduleCollabBackup],
  );

  const broadcast = useCallback((envelope: DataEnvelope) => {
    channelsRef.current.forEach((channel) => {
      if (channel.readyState === "open") channel.send(JSON.stringify(envelope));
    });
  }, []);

  const sendDirectToBoardPeer = useCallback((peerId: string, message: MeetingBoardMessage) => {
    const channel = channelsRef.current.get(peerId);
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(message));
    }
  }, []);

  const registerMeetingBoardMessageHandler = useCallback(
    (handler: (message: MeetingBoardMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void) => {
      meetingBoardMessageListenersRef.current.add(handler);
      return () => {
        meetingBoardMessageListenersRef.current.delete(handler);
      };
    },
    []
  );

  const registerMeetingBoardPeerConnectHandler = useCallback(
    (handler: (peerId: string) => void) => {
      meetingBoardPeerConnectListenersRef.current.add(handler);
      return () => {
        meetingBoardPeerConnectListenersRef.current.delete(handler);
      };
    },
    []
  );

  const registerFileMessageHandler = useCallback(
    (handler: (message: FileShareMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void) => {
      fileMessageListenersRef.current.add(handler);
      return () => {
        fileMessageListenersRef.current.delete(handler);
      };
    },
    []
  );

  const sendDirectToFilePeer = useCallback((peerId: string, message: FileShareMessage) => {
    const channel = channelsRef.current.get(peerId);
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(message));
    }
  }, []);

  const registerFileBinaryHandler = useCallback(
    (handler: (frame: ArrayBuffer, peerId: string, verifiedSender: VerifiedPeerIdentity) => void) => {
      fileBinaryListenersRef.current.add(handler);
      return () => {
        fileBinaryListenersRef.current.delete(handler);
      };
    },
    []
  );

  const sendBinaryToFilePeer = useCallback((peerId: string, frame: ArrayBuffer) => {
    const channel = channelsRef.current.get(peerId);
    if (channel && channel.readyState === "open") {
      channel.send(frame);
    }
  }, []);

  const onlinePeerIds = useMemo(
    () => new Set(onlinePeers.map((p) => p.peerId)),
    [onlinePeers]
  );
  const liveRoomUserKey = useMemo(
    () => [...new Set(onlinePeers.map((p) => p.userId))].sort().join("\0"),
    [onlinePeers]
  );
  const liveRoomUserIds = useMemo(
    () => (liveRoomUserKey ? new Set(liveRoomUserKey.split("\0")) : EMPTY_USER_IDS),
    [liveRoomUserKey]
  );

  useEffect(() => () => {
    iceManagerRef.current?.invalidate();
    peerSignalingRef.current.forEach((record) => clearPeerSignalingRecord(record));
    peerSignalingRef.current.clear();
    peerCreatePromisesRef.current.clear();
    channelsRef.current.forEach((channel) => channel.close());
    peersRef.current.forEach((peer) => peer.close());
    socketRef.current?.disconnect();
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && activeRoomRef.current) {
        void iceManagerRef.current?.handleVisibilityOrResume();
      }
    };
    const handleFocusOrOnline = () => {
      if (activeRoomRef.current) {
        void iceManagerRef.current?.handleVisibilityOrResume();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocusOrOnline);
    window.addEventListener("online", handleFocusOrOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocusOrOnline);
      window.removeEventListener("online", handleFocusOrOnline);
    };
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (isDevMockSession(tokenRef.current)) return null;
    const legacyRefresh = localStorage.getItem("bifrost_refresh_token");
    const hasHint = Boolean(localStorage.getItem("bifrost_has_session") || legacyRefresh);
    if (!hasHint && !tokenRef.current) return null;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const run = (async () => {
      try {
        const res = await fetchAppApi(apiUrl("/auth/refresh"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(legacyRefresh ? { refreshToken: legacyRefresh } : {}),
        });
        if (!res.ok) {
          localStorage.removeItem("bifrost_has_session");
          localStorage.removeItem("bifrost_refresh_token");
          return null;
        }
        const body = (await res.json()) as { token?: string; refreshToken?: string; user?: User };
        if (!body.token) return null;
        localStorage.setItem("bifrost_has_session", "1");
        localStorage.removeItem("bifrost_refresh_token");
        localStorage.removeItem("bifrost_token");
        setToken(body.token);
        if (body.user) {
          setUser(body.user);
          memberNameRef.current = body.user.name;
        }
        return body.token;
      } catch {
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (tokenRef.current) return;
    const hasHint = Boolean(
      localStorage.getItem("bifrost_has_session") || localStorage.getItem("bifrost_refresh_token"),
    );
    if (!hasHint) return;
    let cancelled = false;
    void refreshAccessToken().then((nextToken) => {
      if (cancelled) return;
      if (!nextToken) {
        setAuthReady(true);
        setWorkspaceLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshAccessToken]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetchAppApi(apiUrl("/auth/me"), { headers: authHeaders(), signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401 && !isDevMockSession(token)) {
          const nextToken = await refreshAccessToken();
          if (nextToken && !controller.signal.aborted) {
            const retryRes = await fetchAppApi(apiUrl("/auth/me"), {
              headers: {
                Authorization: `Bearer ${nextToken}`,
                "Content-Type": "application/json",
              },
              signal: controller.signal,
            });
            return { ok: retryRes.ok, body: await retryRes.json() };
          }
        }
        return { ok: response.ok, body: await response.json() };
      })
      .then(({ ok, body }) => {
        if (controller.signal.aborted) return;
        if (!ok) throw new Error();
        // Profile refresh can finish after the workspace request. Do not restart
        // its loading flag here: login/initial state already owns that flag.
        setWorkspaceLoadError(false);
        setUser(body.user as User);
        memberNameRef.current = body.user.name;
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        localStorage.removeItem("bifrost_token");
        localStorage.removeItem("bifrost_refresh_token");
        setToken("");
        setUser(null);
        setWorkspaces([]);
        setWorkspaceLoading(false);
        setWorkspaceLoadError(false);
        setSelectedWorkspaceId("");
        setRooms([]);
        setRoomsLoading(false);
        setRoomsLoadedFor("");
      })
      .finally(() => { if (!controller.signal.aborted) setAuthReady(true); });
    return () => controller.abort();
  }, [token, authHeaders, refreshAccessToken]);

  useEffect(() => {
    if (authReady) {
      resetWorkspaceTransition();
    }
  }, [authReady]);

  const userId = user?.id;
  useEffect(() => {
    userIdRef.current = userId ?? "";
    hlcRef.current.setNodeId(userId || "anon");
  }, [userId]);

  useBootDeepLinks({
    userId,
    token,
    addToast,
    refreshAccessToken,
    setPendingInvite,
    setUser,
    setWorkspaceRetry,
    setSelectedWorkspaceId,
    t,
  });

  useCallNotifications({
    token,
    userId,
    activeRoomRef,
    setSelectedWorkspaceId,
    addToast,
    t,
  });
  const userName = user?.name;
  const userEmail = user?.email;
  const memoCurrentUser = useMemo(
    () =>
      userId && userName !== undefined && userEmail !== undefined
        ? { id: userId, name: userName, email: userEmail }
        : null,
    [userId, userName, userEmail],
  );
  const memberCurrentUser = useMemo(
    () =>
      user
        ? {
            id: user.id,
            name: user.name,
            avatarDataUrl: user.profile?.avatarDataUrl ?? null,
          }
        : undefined,
    [user],
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    fetchAppApi(apiUrl("/workspaces"), { headers: authHeaders(), signal: controller.signal })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (controller.signal.aborted) return;
        if (!ok) throw new Error();
        const wsList = body.workspaces as Workspace[];
        setWorkspaces(wsList);
        setWorkspaceLoadError(false);
        setSelectedWorkspaceId((current) =>
          wsList.some((workspace) => workspace.id === current) ? current : wsList[0]?.id ?? ''
        );
        if (wsList.length === 0) {
          setRooms([]);
          setRoomsLoading(false);
          setRoomsLoadedFor('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWorkspaceLoadError(true);
          setRoomsLoading(false);
        }
      })
      .finally(() => { if(!controller.signal.aborted) setWorkspaceLoading(false); });
    return () => controller.abort();
  }, [userId, token, authHeaders, workspaceRetry]);

  // Fetch rooms whenever selectedWorkspaceId changes after workspaces have resolved
  useEffect(() => {
    if (!userId || workspaceLoading || !selectedWorkspaceId || !token) return;

    queueMicrotask(() => {
      setRoomsLoading(true);
      setRoomLoadError("");
    });
    const controller = new AbortController();
    fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/rooms`), { headers: authHeaders(), signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.message || t("room.loadFailed"));
        setRoomLoadError("");
        setRooms(body.rooms as Room[]);
        setRoomsLoadedFor(selectedWorkspaceId);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setRoomLoadError(err instanceof Error ? err.message : t("room.loadFailed"));
        setRoomsLoadedFor(selectedWorkspaceId);
        setRooms([]);
      })
      .finally(() => { if (!controller.signal.aborted) setRoomsLoading(false); });
    return () => controller.abort();
  }, [userId, workspaceLoading, selectedWorkspaceId, token, authHeaders, t, roomsVersion]);

  const refreshWorkspaceMemberRoster = useCallback(
    async (workspaceId: string, signal?: AbortSignal) => {
      if (!workspaceId || !token) return;
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
        setRoomOnlineCounts(counts);
      } catch {
        // Transient roster refresh failures keep the latest valid snapshot.
      }
    },
    [authHeaders, token],
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

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    try {
      if (twoFactorChallengeToken) {
        const response = await fetchAppApi(apiUrl("/auth/2fa/verify"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeToken: twoFactorChallengeToken,
            code: twoFactorLoginCode.trim(),
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? t("auth.authFailed"));
        localStorage.setItem("bifrost_has_session", "1");
        localStorage.removeItem("bifrost_token");
        localStorage.removeItem("bifrost_refresh_token");
        setTwoFactorChallengeToken("");
        setTwoFactorLoginCode("");
        setWorkspaceLoading(true);
        setWorkspaceLoadError(false);
        setToken(body.token);
        setUser(body.user);
        memberNameRef.current = body.user.name;
        setAuthPassword("");
        return;
      }

      const payload =
        authMode === "register"
          ? { name: authName, email: authEmail, password: authPassword }
          : { email: authEmail, password: authPassword };
      const response = await fetchAppApi(
        apiUrl(`/auth/${authMode === "register" ? "register" : "login"}`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? t("auth.authFailed"));
      if (body.requiresTwoFactor && body.challengeToken) {
        setTwoFactorChallengeToken(body.challengeToken);
        setTwoFactorLoginCode("");
        return;
      }
      if (body.devVerificationCode) {
        setEmailVerifyDevCode(String(body.devVerificationCode));
      }
      if (isDevMockSession(body.token)) {
        localStorage.setItem("bifrost_token", body.token);
      } else {
        localStorage.setItem("bifrost_has_session", "1");
        localStorage.removeItem("bifrost_token");
        localStorage.removeItem("bifrost_refresh_token");
      }
      setWorkspaceLoading(true);
      setWorkspaceLoadError(false);
      setToken(body.token);
      setUser(body.user);
      memberNameRef.current = body.user.name;
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t("auth.authFailed"));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const updateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profileSaving || profileImageBusy) return;
    setProfileSaving(true);
    setProfileMessage("");
    try {
      const response = await fetchAppApi(apiUrl("/auth/me"), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: profileName, avatarDataUrl: profileAvatar }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setUser(body.user as User);
      memberNameRef.current = body.user.name;
      setMembersVersion((value) => value + 1);
      setProfileMessage(t("profile.updatedToast"));
      addToast(t("profile.updatedToast"), "success");
      setShowProfileModal(false);
    } catch (error) {
      const errText = error instanceof Error ? error.message : t("profile.updateFailedToast");
      setProfileMessage(errText);
      addToast(errText, "error");
    } finally {
      setProfileSaving(false);
    }
  };

  const completeOnboarding = async ({
    name,
    avatarDataUrl,
  }: {
    name: string;
    avatarDataUrl: string | null;
  }) => {
    const response = await fetchAppApi(apiUrl("/auth/profile"), {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name, avatarDataUrl }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || t("profile.updateFailedToast"));
    setUser(body.user as User);
    memberNameRef.current = body.user.name;
    setProfileName(body.user.name);
    setProfileAvatar(body.user.profile?.avatarDataUrl ?? null);
    setMembersVersion((value) => value + 1);
    addToast(t("profile.updatedToast"), "success");
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (workspaceSubmitting) return;
    const trimmed = workspaceName.trim();
    if (trimmed.length < 3 || trimmed.length > 120) {
      const err = t("workspace.nameLengthError");
      setWorkspaceError(err);
      addToast(err, 'error');
      return;
    }
    setWorkspaceSubmitting(true);
    setWorkspaceError('');
    try {
      const response = await fetchAppApi(apiUrl("/workspaces"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("workspace.createFailed"));
      const nextWs = body.workspace as Workspace;
      setWorkspaces((current) => [nextWs, ...current]);
      setWorkspaceLoadError(false);
      handleWorkspaceChange(nextWs.id);
      setWorkspaceName("");
      addToast(t("workspace.created"), "success");
      setShowCreateWsModal(false);
    } catch (error) {
      const rawText = error instanceof Error ? error.message : t("workspace.createFailed");
      const errText = formatWorkspaceError(rawText, lang);
      setWorkspaceError(errText);
      addToast(errText, "error");
    } finally {
      setWorkspaceSubmitting(false);
    }
  };

  const restoreWorkspaceManageFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-workspace-manage]');
      if (btn && !btn.closest('[inert]')) {
        btn.focus({ preventScroll: true });
      }
    });
  }, []);

  const openEditWorkspaceModal = useCallback((workspace: Workspace) => {
    setEditingWorkspace(workspace);
    setEditWorkspaceName(workspace.name);
    setEditWorkspaceError("");
    setConfirmDeleteWorkspace(false);
  }, []);

  const submitEditWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingWorkspace || editWorkspaceSubmitting) return;
    const trimmed = editWorkspaceName.trim();
    if (trimmed.length < 3 || trimmed.length > 120) {
      const err = t("workspace.nameLengthError");
      setEditWorkspaceError(err);
      addToast(err, "error");
      return;
    }
    setEditWorkspaceError("");
    setEditWorkspaceSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${editingWorkspace.id}`), {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("workspace.updateFailed"));
      const updated = body.workspace as Workspace;
      setWorkspaces((current) =>
        current.map((ws) => (ws.id === updated.id ? { ...ws, ...updated } : ws)),
      );
      setEditingWorkspace(null);
      addToast(t("workspace.updatedToast", { name: updated.name }), "success");
      restoreWorkspaceManageFocus();
    } catch (error) {
      const rawText = error instanceof Error ? error.message : t("workspace.updateFailed");
      const errText = formatWorkspaceError(rawText, lang);
      setEditWorkspaceError(errText);
      addToast(errText, "error");
    } finally {
      setEditWorkspaceSubmitting(false);
    }
  };

  const executeDeleteWorkspace = async () => {
    if (!editingWorkspace || editWorkspaceSubmitting) return;
    const target = editingWorkspace;
    setEditWorkspaceError("");
    setEditWorkspaceSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${target.id}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { message?: string }).message || t("workspace.deleteFailed"));
      if (activeRoomRef.current?.workspaceId === target.id) {
        leaveRoom(false);
      }
      const nextWorkspaces = workspacesRef.current.filter((ws) => ws.id !== target.id);
      setWorkspaces(nextWorkspaces);
      workspaceMemberRosterRef.current = null;
      setRoomOnlineCounts({});
      const nextId = selectedWorkspaceIdRef.current === target.id ? (nextWorkspaces[0]?.id ?? "") : selectedWorkspaceIdRef.current;
      setSelectedWorkspaceId(nextId);
      setRooms([]);
      setRoomsLoadedFor("");
      setRoomLoadError("");
      changeRoute({ workspaceId: nextId, roomId: "", tab: "meeting" }, true);
      setConfirmDeleteWorkspace(false);
      setEditingWorkspace(null);
      addToast(t("workspace.deletedToast", { name: target.name }), "success");
    } catch (error) {
      const errText = error instanceof Error ? error.message : t("workspace.deleteFailed");
      setEditWorkspaceError(errText);
      setConfirmDeleteWorkspace(false);
      addToast(errText, "error");
    } finally {
      setEditWorkspaceSubmitting(false);
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId || inviteSubmitting) return;
    setInviteError("");
    setInviteSubmitting(true);
    try {
      if (!isDevMockSession(token)) {
        const response = await fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/invites`), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ email: inviteEmail }),
        });
        const body = response.status === 204 ? {} : await response.json();
        if (!response.ok) throw new Error(body.message);
        setInviteEmail("");
        if (typeof body.inviteUrl === "string") {
          setGeneratedInviteUrl(body.inviteUrl);
        }
        addToast(t("workspace.inviteEmailSentToast"), "success");
        return;
      }

      const response = await fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/members`), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: inviteEmail }),
      });
      const body = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(body.message);
      setInviteEmail("");
      setMembersVersion(value => value + 1);
      addToast(t("workspace.memberInvited"), "success");
      setShowInviteModal(false);
    } catch (error) {
      const rawText = error instanceof Error ? error.message : t("workspace.inviteFailed");
      const errText = formatInviteError(rawText, lang);
      setInviteError(errText);
      addToast(errText, "error");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const createOneClickInviteLink = async () => {
    if (!selectedWorkspaceId || generatingInviteLink || isDevMockSession(token)) return;
    setInviteError("");
    setGeneratingInviteLink(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/invites`), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("workspace.inviteFailed"));
      if (typeof body.inviteUrl === "string") {
        setGeneratedInviteUrl(body.inviteUrl);
        try {
          await navigator.clipboard.writeText(body.inviteUrl);
          addToast(t("workspace.inviteLinkCopiedToast"), "success");
        } catch {
          // Clipboard permission may be restricted; link stays visible to copy manually.
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("workspace.inviteFailed");
      setInviteError(msg);
    } finally {
      setGeneratingInviteLink(false);
    }
  };

  const handleSendEmailVerification = async () => {
    if (emailVerifyBusy || isDevMockSession(token)) return;
    setEmailVerifyBusy(true);
    try {
      const response = await fetchAppApi(apiUrl("/auth/resend-verification"), {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("profile.verificationFailed"));
      if (body.user) setUser(body.user);
      if (body.devVerificationCode) setEmailVerifyDevCode(String(body.devVerificationCode));
      addToast(t("profile.verificationSentToast"), "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : t("profile.verificationFailed"), "error");
    } finally {
      setEmailVerifyBusy(false);
    }
  };

  const handleVerifyEmailCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (emailVerifyBusy || isDevMockSession(token)) return;
    setEmailVerifyBusy(true);
    try {
      const response = await fetchAppApi(apiUrl("/auth/verify-email"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ code: emailVerifyCode.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("profile.verificationFailed"));
      if (body.user) setUser(body.user);
      setEmailVerifyCode("");
      setEmailVerifyDevCode("");
      addToast(t("profile.emailVerifiedToast"), "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : t("profile.verificationFailed"), "error");
    } finally {
      setEmailVerifyBusy(false);
    }
  };

  const handleSetupTwoFactor = async () => {
    if (twoFactorBusy || isDevMockSession(token)) return;
    setTwoFactorError("");
    setTwoFactorBusy(true);
    try {
      const response = await fetchAppApi(apiUrl("/auth/2fa/setup"), {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("profile.twoFactorActionFailed"));
      setTwoFactorSetupSecret(body.secret ?? "");
      setTwoFactorRecoveryCodes([]);
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : t("profile.twoFactorActionFailed"));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleEnableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (twoFactorBusy || isDevMockSession(token)) return;
    setTwoFactorError("");
    setTwoFactorBusy(true);
    try {
      const response = await fetchAppApi(apiUrl("/auth/2fa/enable"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ code: twoFactorSetupCode.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("profile.twoFactorActionFailed"));
      if (body.user) setUser(body.user);
      setTwoFactorRecoveryCodes(Array.isArray(body.recoveryCodes) ? body.recoveryCodes : []);
      setTwoFactorSetupSecret("");
      setTwoFactorSetupCode("");
      addToast(t("profile.twoFactorEnabledToast"), "success");
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : t("profile.twoFactorActionFailed"));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const handleDisableTwoFactor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (twoFactorBusy || isDevMockSession(token)) return;
    setTwoFactorError("");
    setTwoFactorBusy(true);
    try {
      const response = await fetchAppApi(apiUrl("/auth/2fa/disable"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ code: twoFactorSetupCode.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("profile.twoFactorActionFailed"));
      if (body.user) setUser(body.user);
      setTwoFactorSetupCode("");
      setTwoFactorRecoveryCodes([]);
      addToast(t("profile.twoFactorDisabledToast"), "success");
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : t("profile.twoFactorActionFailed"));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const createRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId || roomSubmitting) return;
    const trimmed = newRoomName.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      const err = t("room.nameLengthError");
      setRoomMessage(err);
      addToast(err, 'error');
      return;
    }
    setRoomMessage("");
    setRoomSubmitting(true);
    try {
      const response = await fetchAppApi(apiUrl(`/workspaces/${selectedWorkspaceId}/rooms`), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: trimmed,
          description: newRoomDesc.trim() ? newRoomDesc.trim() : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("room.createFailed"));
      setRooms((current) => [body.room as Room, ...current]);
      setNewRoomName("");
      setNewRoomDesc("");
      const successMsg = t("room.created", { name: body.room.name });
      setRoomMessage("");
      addToast(successMsg, "success");
      setShowCreateRoomModal(false);
    } catch (error) {
      const rawText = error instanceof Error ? error.message : t("room.createFailed");
      const errText = formatRoomError(rawText, lang);
      setRoomMessage(errText);
      addToast(errText, "error");
    } finally {
      setRoomSubmitting(false);
    }
  };

  const restoreManagedRoomFocus = useCallback(() => {
    const id = lastManagedRoomIdRef.current;
    lastManagedRoomIdRef.current = null;
    if (!id) return;
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLButtonElement>(`[data-room-manage="${id}"]`);
      if (btn && !btn.closest('[inert]')) {
        btn.focus({ preventScroll: true });
      }
    });
  }, []);

  const openEditRoomModal = useCallback((room: Room) => {
    setEditingRoom(room);
    setEditRoomName(room.name);
    setEditRoomDesc(room.description ?? "");
    setEditRoomError("");
    setConfirmDeleteRoom(false);
  }, []);

  const submitEditRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId || !editingRoom || editRoomSubmitting) return;
    const trimmed = editRoomName.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      const err = t("room.nameLengthError");
      setEditRoomError(err);
      addToast(err, "error");
      return;
    }
    setEditRoomError("");
    setEditRoomSubmitting(true);
    try {
      const response = await fetchAppApi(
        apiUrl(`/workspaces/${selectedWorkspaceId}/rooms/${editingRoom.id}`),
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({
            name: trimmed,
            description: editRoomDesc.trim() ? editRoomDesc.trim() : null,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("room.updateFailed"));
      const updated = body.room as Room;
      setRooms((current) => current.map((room) => (room.id === updated.id ? { ...room, ...updated } : room)));
      if (activeRoomRef.current?.id === updated.id) {
        activeRoomRef.current = { ...activeRoomRef.current, ...updated };
        setCurrentRoom((current) => (current ? { ...current, ...updated } : current));
      }
      setEditingRoom(null);
      addToast(t("room.updatedToast", { name: updated.name }), "success");
      restoreManagedRoomFocus();
    } catch (error) {
      const rawText = error instanceof Error ? error.message : t("room.updateFailed");
      const errText = formatRoomError(rawText, lang);
      setEditRoomError(errText);
      addToast(errText, "error");
    } finally {
      setEditRoomSubmitting(false);
    }
  };

  const executeDeleteRoom = async () => {
    if (!selectedWorkspaceId || !editingRoom || editRoomSubmitting) return;
    const target = editingRoom;
    setEditRoomError("");
    setEditRoomSubmitting(true);
    try {
      const response = await fetchAppApi(
        apiUrl(`/workspaces/${selectedWorkspaceId}/rooms/${target.id}`),
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { message?: string }).message || t("room.deleteFailed"));
      if (activeRoomRef.current?.id === target.id) {
        leaveRoom();
      }
      setRooms((current) => current.filter((room) => room.id !== target.id));
      setMembersVersion((value) => value + 1);
      setConfirmDeleteRoom(false);
      setEditingRoom(null);
      lastManagedRoomIdRef.current = null;
      addToast(t("room.deletedToast", { name: target.name }), "success");
    } catch (error) {
      const errText = error instanceof Error ? error.message : t("room.deleteFailed");
      setEditRoomError(errText);
      setConfirmDeleteRoom(false);
      addToast(errText, "error");
    } finally {
      setEditRoomSubmitting(false);
    }
  };

  const getIceManager = useCallback((): RoomIceManager => {
    if (!iceManagerRef.current) {
      iceManagerRef.current = createRoomIceManager({
        onCredentialsRefreshed: (snapshot, generation) =>
          onTurnCredentialsRefreshedRef.current(snapshot, generation),
        onUnauthorized: () => onTurnUnauthorizedRef.current(),
      });
    }
    return iceManagerRef.current;
  }, []);

  const getPeerSignalingRecord = useCallback((peerId: string): PeerSignalingRecord => {
    let existing = peerSignalingRef.current.get(peerId);
    if (!existing) {
      existing = createPeerSignalingRecord();
      peerSignalingRef.current.set(peerId, existing);
    }
    return existing;
  }, []);

  const closePeer = useCallback((peerId: string) => {
    clearPeerSignalingRecord(peerSignalingRef.current.get(peerId));
    peerSignalingRef.current.delete(peerId);
    peerCreatePromisesRef.current.delete(peerId);
    channelsRef.current.get(peerId)?.close();
    channelsRef.current.delete(peerId);
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    const remainingOpen = openConnectionCount(channelsRef.current.values());
    setPeersCount(remainingOpen);
    removePeerMedia(peerId);
    if (remainingOpen === 0) {
      clearNoteResyncTimer();
      setNoteResyncing(false);
      if (activeRoomRef.current && !isDevMockSession(token)) {
        setSessionStatus({ kind: "waitingPeer" });
      }
    }
    setSharedNotes((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, [token, clearNoteResyncTimer, removePeerMedia]);

  const setupDataChannel = useCallback((peerId: string, channel: RTCDataChannel, targetRoomId: string) => {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFERED_LOW_THRESHOLD;
    channelsRef.current.set(peerId, channel);
    channel.onopen = () => {
      if (
        channelsRef.current.get(peerId) !== channel ||
        activeRoomRef.current?.id !== targetRoomId ||
        !resolveVerifiedPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)
      ) {
        return;
      }
      setSessionStatus({ kind: "connectedP2P" });
      setPeersCount(openConnectionCount(channelsRef.current.values()));
      addToast(t("toasts.p2pConnected"), "success");
      const resyncEnvelope = buildNoteResyncEnvelope({
        noteShared: noteSharedRef.current,
        roomReadOnly: activeRoomRef.current?.access === "VIEWER",
        channelRoomId: targetRoomId,
        activeRoomId: activeRoomRef.current?.id,
        author: memberNameRef.current,
        body: noteTextRef.current,
        updatedAt: noteUpdatedAtRef.current,
      });
      if (resyncEnvelope) {
        setNoteResyncing(true);
        clearNoteResyncTimer();
        try {
          channel.send(JSON.stringify(resyncEnvelope));
          applyNoteError('');
          noteResyncTimerRef.current = window.setTimeout(() => {
            noteResyncTimerRef.current = null;
            setNoteResyncing(false);
          }, 450);
        } catch {
          setNoteResyncing(false);
          applyNoteError(tRef.current('note.syncFailed'));
        }
      }
      if (messagesRef.current.length > 0) {
        try {
          channel.send(
            JSON.stringify({
              type: "chat:sync-state",
              messages: messagesRef.current,
              hlc: hlcRef.current.now(),
            }),
          );
        } catch {
          /* Ignore transient send failures during channel open. */
        }
      }
      meetingBoardPeerConnectListenersRef.current.forEach((listener) => listener(peerId));
    };
    channel.onclose = () => {
      if (channelsRef.current.get(peerId) !== channel) return;
      channelsRef.current.delete(peerId);
      if (activeRoomRef.current?.id !== targetRoomId) return;
      const remainingOpen = openConnectionCount(channelsRef.current.values());
      setPeersCount(remainingOpen);
      if (remainingOpen === 0) {
        clearNoteResyncTimer();
        setNoteResyncing(false);
        if (activeRoomRef.current && !isDevMockSession(token)) {
          setSessionStatus({ kind: "waitingPeer" });
        }
      }
      setSharedNotes((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    };
    channel.onmessage = (event) => {
      dispatchVerifiedDataChannelPayload({
        rawData: event.data,
        peerId,
        registry: verifiedPeersRef.current,
        localPeerId: localPeerIdRef.current,
        registeredChannel: channelsRef.current.get(peerId),
        incomingChannel: channel,
        activeRoomId: activeRoomRef.current?.id,
        targetRoomId,
        resolveSenderRole: (sender, resolvedRoomId) => {
          const roomRoster =
            workspaceMemberRosterRef.current &&
            activeRoomRef.current &&
            workspaceMemberRosterRef.current.workspaceId === activeRoomRef.current.workspaceId
              ? workspaceMemberRosterRef.current
              : null;
          return resolvePeerRoomAccessRole(roomRoster, resolvedRoomId, sender.userId);
        },
        handlers: {
          onChat: (payload, verifiedSender) => {
            if (typeof payload.hlc === "string") {
              hlcRef.current.receive(payload.hlc);
            }
            const normalized = normalizeIncomingChatMessage(payload, verifiedSender);
            if (normalized) addMessage(normalized);
          },
          onChatAction: (payload, verifiedSender) => {
            if (typeof payload.hlc === "string") {
              hlcRef.current.receive(payload.hlc);
            }
            const room = activeRoomRef.current;
            if (payload.type === "chat:reaction" && typeof payload.messageId === "string" && typeof payload.emoji === "string") {
              setMessages((current) => {
                const next = applyChatReaction(
                  current,
                  payload.messageId as string,
                  payload.emoji as string,
                  verifiedSender.userId,
                  Boolean(payload.active),
                );
                messagesRef.current = next;
                if (room && userIdRef.current) {
                  writeRoomChatCache(
                    localStorage,
                    roomChatCacheKey(userIdRef.current, room.workspaceId, room.id),
                    next,
                  );
                }
                return next;
              });
            } else if (payload.type === "chat:pin" && typeof payload.messageId === "string") {
              setMessages((current) => {
                const next = applyChatPin(
                  current,
                  payload.messageId as string,
                  Boolean(payload.pinned),
                  verifiedSender.name,
                );
                messagesRef.current = next;
                if (room && userIdRef.current) {
                  writeRoomChatCache(
                    localStorage,
                    roomChatCacheKey(userIdRef.current, room.workspaceId, room.id),
                    next,
                  );
                }
                return next;
              });
            }
          },
          onChatSync: (payload) => {
            if (typeof payload.hlc === "string") {
              hlcRef.current.receive(payload.hlc);
            }
            if (!Array.isArray(payload.messages)) return;
            const room = activeRoomRef.current;
            setMessages((current) => {
              const merged = reconcileChatMessages(
                current,
                payload.messages as unknown[],
                userIdRef.current,
                tRef.current("chat.you"),
              );
              messagesRef.current = merged;
              if (room && userIdRef.current) {
                writeRoomChatCache(
                  localStorage,
                  roomChatCacheKey(userIdRef.current, room.workspaceId, room.id),
                  merged,
                );
              }
              return merged;
            });
          },
          onNoteUpdate: (verifiedPeerId, payload, verifiedSender) => {
            if (typeof payload.hlc === "string") {
              hlcRef.current.receive(payload.hlc);
            }
            const normalizedNote = normalizeIncomingSharedNote(payload, verifiedSender);
            if (normalizedNote) {
              setSharedNotes((current) => {
                const existing = current[verifiedPeerId];
                if (
                  existing &&
                  !isIncomingNewer(
                    existing.hlc,
                    existing.updatedAt,
                    normalizedNote.hlc,
                    normalizedNote.updatedAt,
                  )
                ) {
                  return current;
                }
                const next = { ...current };
                delete next[`cloud:${verifiedSender.userId}`];
                next[verifiedPeerId] = normalizedNote;
                return next;
              });
            }
          },
          onNoteUnshared: (verifiedPeerId) => {
            setSharedNotes((current) => {
              if (!(verifiedPeerId in current)) return current;
              const next = { ...current };
              delete next[verifiedPeerId];
              return next;
            });
          },
          onMeetingBoard: (message, verifiedPeerId, verifiedSender) => {
            meetingBoardMessageListenersRef.current.forEach((listener) =>
              listener(message as unknown as MeetingBoardMessage, verifiedPeerId, verifiedSender),
            );
          },
          onFileShare: (message, verifiedPeerId, verifiedSender) => {
            fileMessageListenersRef.current.forEach((listener) =>
              listener(message as unknown as FileShareMessage, verifiedPeerId, verifiedSender),
            );
          },
          onFileBinaryChunk: (frame, verifiedPeerId, verifiedSender) => {
            fileBinaryListenersRef.current.forEach((listener) =>
              listener(frame, verifiedPeerId, verifiedSender),
            );
          },
        },
      });
    };
  }, [t, addToast, token, addMessage, clearNoteResyncTimer, applyNoteError]);

  const negotiateForPeer = useCallback(
    async (peerId: string, targetRoomId: string, iceRestart = false) => {
      const socket = socketRef.current;
      const peer = peersRef.current.get(peerId);
      if (!socket || !peer) return false;
      const record = getPeerSignalingRecord(peerId);
      return negotiatePeerOffer({
        peer,
        record,
        iceRestart,
        isContextValid: () =>
          socketRef.current === socket &&
          activeRoomRef.current?.id === targetRoomId &&
          peersRef.current.get(peerId) === peer &&
          Boolean(authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)),
        emitOffer: (offer) => {
          socket.emit("webrtc:offer", { targetId: peerId, payload: offer });
        },
      });
    },
    [getPeerSignalingRecord],
  );

  useEffect(() => {
    onTurnCredentialsRefreshedRef.current = async (snapshot: IceConfigSnapshot, generation: number) => {
      const socket = socketRef.current;
      if (
        !socket ||
        !socket.connected ||
        getIceManager().getGeneration() !== generation ||
        activeRoomRef.current?.id !== snapshot.roomId
      ) {
        return;
      }

      const peerEntries = Array.from(peersRef.current.entries());
      for (const [peerId, peer] of peerEntries) {
        if (
          getIceManager().getGeneration() !== generation ||
          activeRoomRef.current?.id !== snapshot.roomId ||
          socketRef.current !== socket
        ) {
          return;
        }
        if (peer.connectionState === "closed") continue;
        if (!authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)) continue;

        updatePeerIceServersSafely(peer, snapshot.iceServers);
        const activeType = await inspectPeerSelectedCandidateType(peer);

        if (
          getIceManager().getGeneration() !== generation ||
          activeRoomRef.current?.id !== snapshot.roomId ||
          socketRef.current !== socket ||
          peersRef.current.get(peerId) !== peer
        ) {
          return;
        }

        if (socket.connected && shouldRestartPeerForIceRenewal(peer, activeType)) {
          void negotiateForPeer(peerId, snapshot.roomId, true);
        }
      }
    };
  });

  const createPeer = useCallback(async (peerId: string, shouldOffer: boolean, targetRoomId: string) => {
    const socket = socketRef.current;
    if (!socket || activeRoomRef.current?.id !== targetRoomId || peersRef.current.has(peerId)) return;
    if (!authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)) return;

    const existingCreation = peerCreatePromisesRef.current.get(peerId);
    if (existingCreation) {
      await existingCreation;
      return;
    }

    const iceManager = getIceManager();
    const sessionGeneration = iceManager.getGeneration();

    const createTask = (async () => {
      const iceConfig = await iceManager.ensureUsableConfig(targetRoomId, tokenRef.current);

      if (
        socketRef.current !== socket ||
        activeRoomRef.current?.id !== targetRoomId ||
        iceManager.getGeneration() !== sessionGeneration ||
        peersRef.current.has(peerId) ||
        !authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)
      ) {
        return;
      }

      const peer = new RTCPeerConnection({ iceServers: iceConfig.iceServers });
      peersRef.current.set(peerId, peer);
      const record = getPeerSignalingRecord(peerId);
      setPeersCount(openConnectionCount(channelsRef.current.values()));

      peer.onicecandidate = ({ candidate }) => {
        if (candidate && socketRef.current === socket && peersRef.current.get(peerId) === peer) {
          socket.emit("webrtc:ice-candidate", {
            targetId: peerId,
            payload: candidate.toJSON(),
          });
        }
      };

      peer.ondatachannel = ({ channel }) => setupDataChannel(peerId, channel, targetRoomId);
      attachPeerMediaHandlers(peer, peerId, targetRoomId);
      peer.onnegotiationneeded = () => {
        if (peersRef.current.get(peerId) === peer && peer.connectionState !== "closed") {
          void negotiateForPeer(peerId, targetRoomId, false);
        }
      };

      peer.onconnectionstatechange = () => {
        if (peersRef.current.get(peerId) !== peer) return;
        handlePeerConnectionStateTransition({
          peer,
          record,
          isPeerVerified: () =>
            activeRoomRef.current?.id === targetRoomId &&
            Boolean(resolveVerifiedPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)),
          isSignalingConnected: () =>
            socketRef.current === socket && Boolean(socket.connected),
          attemptIceRecovery: async () => {
            if (
              peersRef.current.get(peerId) !== peer ||
              activeRoomRef.current?.id !== targetRoomId ||
              iceManager.getGeneration() !== sessionGeneration
            ) {
              return;
            }
            const refreshed = await iceManager.ensureUsableConfig(targetRoomId, tokenRef.current);
            if (
              peersRef.current.get(peerId) !== peer ||
              activeRoomRef.current?.id !== targetRoomId ||
              iceManager.getGeneration() !== sessionGeneration ||
              socketRef.current !== socket ||
              !socket.connected
            ) {
              return;
            }
            updatePeerIceServersSafely(peer, refreshed.iceServers);
            await negotiateForPeer(peerId, targetRoomId, true);
          },
          onClosePeer: () => {
            if (peersRef.current.get(peerId) === peer) {
              closePeer(peerId);
            }
          },
        });
      };

      if (shouldOffer) {
        const channel = peer.createDataChannel("bifrost-realtime");
        setupDataChannel(peerId, channel, targetRoomId);
        await negotiateForPeer(peerId, targetRoomId, false);
      }
    })();

    peerCreatePromisesRef.current.set(peerId, createTask);
    try {
      await createTask;
    } finally {
      if (peerCreatePromisesRef.current.get(peerId) === createTask) {
        peerCreatePromisesRef.current.delete(peerId);
      }
    }
  }, [closePeer, setupDataChannel, getIceManager, getPeerSignalingRecord, negotiateForPeer, attachPeerMediaHandlers]);

  const leaveRoom = useCallback((navigate = true) => {
    // Clear verified identities and ICE credential/signaling state before tearing down channels.
    getIceManager().invalidate();
    clearPeerRegistry(verifiedPeersRef.current);
    localPeerIdRef.current = null;
    peerSignalingRef.current.forEach((record) => clearPeerSignalingRecord(record));
    peerSignalingRef.current.clear();
    peerCreatePromisesRef.current.clear();
    const activeSocket = socketRef.current;
    if (activeRoomRef.current && activeSocket) {
      activeSocket.emit("room:leave", activeRoomRef.current.id);
    }
    socketRef.current = null;
    channelsRef.current.forEach((channel) => channel.close());
    peersRef.current.forEach((peer) => peer.close());
    channelsRef.current.clear();
    peersRef.current.clear();
    activeSocket?.disconnect();

    stopAllRoomMedia();

    noteSharedRef.current = false;
    noteTextRef.current = "";
    noteUpdatedAtRef.current = undefined;
    clearNoteResyncTimer();
    setNoteResyncing(false);
    setChatError('');
    applyNoteError('');
    chatAtBottomRef.current = true;
    setNoteShared(false);
    setShowRoomMembersModal(false);
    if(navigate) changeRoute({workspaceId: activeRoomRef.current?.workspaceId ?? selectedWorkspaceId, roomId:"", tab:"meeting"});
    activeRoomRef.current = null;
    setCurrentRoom(null);
    setOnlinePeers([]);
    setPeersCount(0);
    setSessionStatus({ kind: "idle" });
    setSharedNotes({});
    setRoomError("");
    setActiveTab("meeting");
    railTipStore.set(null);
  }, [changeRoute, selectedWorkspaceId, railTipStore, clearNoteResyncTimer, applyNoteError, getIceManager, stopAllRoomMedia]);

  const logout = useCallback(() => {
    const legacyRefresh = localStorage.getItem("bifrost_refresh_token");
    if (!isDevMockSession(tokenRef.current)) {
      void fetchAppApi(apiUrl("/auth/logout"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyRefresh ? { refreshToken: legacyRefresh } : {}),
      }).catch(() => {
        /* Best-effort server revocation; local state still clears. */
      });
    }
    leaveRoom();
    workspaceMemberRosterRef.current = null;
    setIsSidebarOpen(false);setIsRightPanelOpen(false);railTipStore.set(null);
    localStorage.removeItem("bifrost_token");
    localStorage.removeItem("bifrost_refresh_token");
    localStorage.removeItem("bifrost_has_session");
    if(userId) for(const key of Object.keys(sessionStorage)) if(key.startsWith('bifrost-room-draft:'+encodeURIComponent(userId)+':')) sessionStorage.removeItem(key);
    changeRoute({workspaceId:'',roomId:'',tab:'meeting'},true);
    setToken("");
    setUser(null);
    setAuthReady(true);
    setWorkspaces([]);
    setWorkspaceLoading(false);
    setWorkspaceLoadError(false);
    setSelectedWorkspaceId("");
    setRooms([]);
    setRoomsLoading(false);
    setRoomsLoadedFor("");
    setShowProfileModal(false); setShowCreateRoomModal(false); setShowCreateWsModal(false); setShowInviteModal(false); setShowRoomMembersModal(false);
    setEditingRoom(null); setConfirmDeleteRoom(false);
    setEditingWorkspace(null); setConfirmDeleteWorkspace(false);
    setRoomOnlineCounts({});
    setProfileName(''); setProfileAvatar(null); setProfileMessage('');
    setRoomMessage(''); setRoomLoadError(''); setInviteError(''); setWorkspaceError('');
    setDiscardForm(null);setAuthEmail(''); setAuthName(''); setAuthPassword(''); setAuthError(''); setAuthMode('login');
  }, [leaveRoom, userId, changeRoute, railTipStore]);

  const submitChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordSaving || isDevMockSession(token)) return;
    setPasswordError("");
    if (newPasswordInput !== confirmNewPasswordInput) {
      setPasswordError(t("profile.passwordMismatch"));
      return;
    }
    setPasswordSaving(true);
    try {
      const response = await fetchAppApi(apiUrl("/auth/change-password"), {
        method: "POST",
        credentials: "include",
        headers: authHeaders(),
        body: JSON.stringify({
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("profile.passwordUpdateFailed"));
      if (body.token) {
        setToken(body.token);
      }
      localStorage.setItem("bifrost_has_session", "1");
      localStorage.removeItem("bifrost_token");
      localStorage.removeItem("bifrost_refresh_token");
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmNewPasswordInput("");
      addToast(t("profile.passwordUpdatedToast"), "success");
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("profile.passwordUpdateFailed");
      setPasswordError(msg);
      addToast(msg, "error");
    } finally {
      setPasswordSaving(false);
    }
  };

  useEffect(() => {
    onTurnUnauthorizedRef.current = () => {
      if (!tokenRef.current || isDevMockSession(tokenRef.current)) return;
      logout();
    };
  }, [logout]);

  const joinRoom = (targetRoom: Room, navigate = true) => {
    if (isDevMockSession(token) && targetRoom.access === null) { addToast(t('room.noRoomAccess'), 'error'); return; }
    if (activeRoomRef.current?.id === targetRoom.id && (isDevMockSession(token) || socketRef.current?.connected)) {
      return;
    }

    leaveRoom(false);
    setIsRightPanelOpen(false);setShowRoomMembersModal(false);railTipStore.set(null);
    const draftKey = roomDraftKey(user!.id,targetRoom.workspaceId,targetRoom.id);
    const saved = readRoomDraft(sessionStorage,draftKey);
    noteTextRef.current=saved.note;
    noteUpdatedAtRef.current=readRoomNoteUpdatedAt(sessionStorage,draftKey);
    noteHlcRef.current = undefined;
    boardBackupRef.current = null;
    if (collabSaveTimerRef.current !== null) {
      window.clearTimeout(collabSaveTimerRef.current);
      collabSaveTimerRef.current = null;
    }
    if (noteSaveTimerRef.current !== null) {
      window.clearTimeout(noteSaveTimerRef.current);
      noteSaveTimerRef.current = null;
    }
    const cachedChat = readRoomChatCache(
      localStorage,
      roomChatCacheKey(user!.id, targetRoom.workspaceId, targetRoom.id),
      user!.id,
      t("chat.you"),
    );
    messagesRef.current = cachedChat;
    if(navigate) changeRoute({workspaceId:targetRoom.workspaceId,roomId:targetRoom.id,tab:'meeting'});
    activeRoomRef.current = targetRoom;
    setCurrentRoom(targetRoom);
    setRoomError("");
    setSessionStatus({ kind: "connectingSignaling" });
    setMessages(cachedChat);
    setCloudBoard(null);
    setHydratedNote(null);
    setSharedNotes({});
    setOnlinePeers([]);
    setPeersCount(0);
    setActiveTab("meeting");
    setIsSidebarOpen(false);

    if (token) {
      void fetchAppApi(apiUrl(`/rooms/${targetRoom.id}/collab`), {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          if (!res.ok) return null;
          return res.json() as Promise<{
            messages?: unknown[];
            board?: BoardState;
            sharedNotes?: Record<string, SharedNoteItem>;
            myNote?: { body: string; isShared: boolean; updatedAt?: number; hlc?: string } | null;
          }>;
        })
        .then((collabData) => {
          if (!collabData || activeRoomRef.current?.id !== targetRoom.id) return;
          if (Array.isArray(collabData.messages) && collabData.messages.length > 0) {
            setMessages((current) => {
              const merged = reconcileChatMessages(
                current,
                collabData.messages!,
                user!.id,
                tRef.current("chat.you"),
              );
              messagesRef.current = merged;
              writeRoomChatCache(
                localStorage,
                roomChatCacheKey(user!.id, targetRoom.workspaceId, targetRoom.id),
                merged,
              );
              return merged;
            });
          }
          if (collabData.board && (Array.isArray(collabData.board.items) || collabData.board.tombstones)) {
            boardBackupRef.current = collabData.board;
            setCloudBoard((prev) => ({
              data: collabData.board!,
              version: (prev?.version ?? 0) + 1,
            }));
          }
          if (collabData.sharedNotes && typeof collabData.sharedNotes === "object") {
            setSharedNotes((current) => {
              const next = { ...current };
              const liveAuthorIds = new Set(
                Object.values(current).map((item) => item.authorId).filter(Boolean),
              );
              for (const [uid, note] of Object.entries(collabData.sharedNotes!)) {
                if (!note || uid === user!.id || liveAuthorIds.has(uid)) continue;
                next[`cloud:${uid}`] = { ...note, authorId: uid };
              }
              return next;
            });
          }
          if (collabData.myNote) {
            const cloudNote = collabData.myNote;
            const shouldHydrate =
              !noteTextRef.current.trim() ||
              isIncomingNewer(
                noteHlcRef.current,
                noteUpdatedAtRef.current,
                cloudNote.hlc,
                cloudNote.updatedAt,
              );
            if (shouldHydrate) {
              noteTextRef.current = cloudNote.body;
              noteUpdatedAtRef.current = cloudNote.updatedAt;
              noteHlcRef.current = cloudNote.hlc;
              noteSharedRef.current = Boolean(cloudNote.isShared);
              setNoteShared(Boolean(cloudNote.isShared));
              setHydratedNote((prev) => ({
                body: cloudNote.body,
                updatedAt: cloudNote.updatedAt,
                version: (prev?.version ?? 0) + 1,
              }));
            }
          }
        })
        .catch(() => {});
    }

    if (isDevMockSession(token)) {
      setOnlinePeers([{ peerId: 'mock-local-peer', userId: user!.id, name: user!.name, email: user!.email }]);
      setSessionStatus({ kind: "localPreview" });
      return;
    }

    // Warm room-scoped ICE/TURN configuration in parallel with Socket.IO connect so createPeer stays ready.
    const iceWarmupPromise = getIceManager().startRoomSession(targetRoom.id, token);

    const socket = io(SIGNALING_URL || undefined, {
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSessionStatus({ kind: "joiningRoom" });
      socket.emit("room:join", targetRoom.id);
    });

    socket.on(
      "room:joined",
      async ({
        roomId,
        roomName,
        peerId: joinedLocalPeerId,
        peers,
        presence,
      }: {
        roomId: string;
        roomName: string;
        peerId: string;
        peers: string[];
        presence?: PresencePeer[];
      }) => {
        if (socketRef.current !== socket || activeRoomRef.current?.id !== roomId) return;
        const nextLocalPeerId =
          typeof joinedLocalPeerId === "string" && joinedLocalPeerId.trim()
            ? joinedLocalPeerId.trim()
            : socket.id ?? null;
        localPeerIdRef.current = nextLocalPeerId;
        verifiedPeersRef.current = replacePeerRegistryFromPresence(presence ?? [], nextLocalPeerId);

        const knownMemberIds = new Set(
          workspaceMemberRosterRef.current?.workspaceId === targetRoom.workspaceId
            ? workspaceMemberRosterRef.current.members.map((m) => m.userId)
            : [],
        );
        if (
          workspaceMemberRosterRef.current?.workspaceId !== targetRoom.workspaceId ||
          Array.from(verifiedPeersRef.current.values()).some((p) => !knownMemberIds.has(p.userId))
        ) {
          void refreshWorkspaceMemberRoster(targetRoom.workspaceId);
        }

        setSessionStatus(peers.length === 0 ? { kind: "waitingPeer" } : { kind: "joinedRoom", roomName });
        if (presence) {
          setOnlinePeers(presence);
        }

        peersRef.current.forEach((p, existingPeerId) => {
          clearPeerSignalingRecord(peerSignalingRef.current.get(existingPeerId));
          peerSignalingRef.current.delete(existingPeerId);
          p.close();
        });
        channelsRef.current.forEach((ch) => ch.close());
        channelsRef.current.clear();
        peersRef.current.clear();
        peerCreatePromisesRef.current.clear();
        setPeersCount(0);
        setSharedNotes({});
        clearNoteResyncTimer();
        setNoteResyncing(false);

        await iceWarmupPromise;
        if (socketRef.current !== socket || activeRoomRef.current?.id !== roomId) return;
        peers.forEach((peerId) => void createPeer(peerId, false, roomId));
      }
    );

    socket.on("presence:changed", ({ roomId, peers }: { roomId: string; peers: PresencePeer[] }) => {
      if (socketRef.current !== socket || activeRoomRef.current?.id !== roomId) return;
      verifiedPeersRef.current = replacePeerRegistryFromPresence(peers, localPeerIdRef.current);
      const knownMemberIds = new Set(
        workspaceMemberRosterRef.current?.workspaceId === targetRoom.workspaceId
          ? workspaceMemberRosterRef.current.members.map((m) => m.userId)
          : [],
      );
      if (
        workspaceMemberRosterRef.current?.workspaceId !== targetRoom.workspaceId ||
        Array.from(verifiedPeersRef.current.values()).some((p) => !knownMemberIds.has(p.userId))
      ) {
        void refreshWorkspaceMemberRoster(targetRoom.workspaceId);
      }
      setOnlinePeers(peers);
    });

    socket.on(
      "room:peer-joined",
      ({
        peerId,
        user: joinedUser,
      }: {
        peerId: string;
        user?: { id?: string; name?: string; email?: string };
      }) => {
        if (socketRef.current !== socket || activeRoomRef.current?.id !== targetRoom.id) return;
        const joinedPeer = upsertVerifiedPeerFromJoin(
          verifiedPeersRef.current,
          { peerId, user: joinedUser },
          localPeerIdRef.current,
        );
        if (!joinedPeer) return;
        if (
          workspaceMemberRosterRef.current?.workspaceId !== targetRoom.workspaceId ||
          !workspaceMemberRosterRef.current.members.some((m) => m.userId === joinedPeer.userId)
        ) {
          void refreshWorkspaceMemberRoster(targetRoom.workspaceId);
        }
        void createPeer(joinedPeer.peerId, true, targetRoom.id);
        addToast(t("toasts.peerJoined", { name: joinedPeer.name }), "info");
      }
    );

    socket.on("room:peer-left", ({ peerId }: { peerId: string }) => {
      if (socketRef.current !== socket || activeRoomRef.current?.id !== targetRoom.id) return;
      const verifiedPeer = resolveVerifiedPeer(
        verifiedPeersRef.current,
        peerId,
        localPeerIdRef.current,
      );
      const leftPeer = onlinePeersRef.current.find((p) => p.peerId === peerId);
      const name = verifiedPeer?.name ?? leftPeer?.name ?? "Member";
      removeVerifiedPeer(verifiedPeersRef.current, peerId);
      closePeer(peerId);
      addToast(t("toasts.peerLeft", { name }), "info");
    });

    socket.on("room:error", ({ message }: { message: string }) => {
      if (socketRef.current !== socket) return;
      setRoomError(message);
      setSessionStatus({ kind: "error", message });
      addToast(message, "error");
    });

    socket.on(
      "room:access-revoked",
      ({
        workspaceId: revokedWsId,
        roomId: revokedRoomId,
      }: {
        workspaceId: string;
        roomId: string;
        reason?: string;
        message?: string;
      }) => {
        if (socketRef.current !== socket) return;
        const isCurrentRoom = activeRoomRef.current?.id === revokedRoomId;
        const wasViewingRevokedWs =
          selectedWorkspaceIdRef.current === revokedWsId ||
          activeRoomRef.current?.workspaceId === revokedWsId;
        const nextWorkspaces = workspacesRef.current.filter((ws) => ws.id !== revokedWsId);

        if (isCurrentRoom) {
          clearPeerRegistry(verifiedPeersRef.current);
          localPeerIdRef.current = null;
          leaveRoom(false);
        } else if (activeRoomRef.current?.workspaceId === revokedWsId) {
          getIceManager().invalidate();
          clearPeerRegistry(verifiedPeersRef.current);
          localPeerIdRef.current = null;
        }

        setWorkspaces(nextWorkspaces);
        setWorkspaceRetry((value) => value + 1);

        if (wasViewingRevokedWs) {
          workspaceMemberRosterRef.current = null;
          const nextWsId = nextWorkspaces[0]?.id ?? "";
          setSelectedWorkspaceId(nextWsId);
          setRooms([]);
          setRoomsLoadedFor("");
          setRoomLoadError("");
          changeRoute({ workspaceId: nextWsId, roomId: "", tab: "meeting" }, true);
        } else if (isCurrentRoom) {
          changeRoute(
            { workspaceId: selectedWorkspaceIdRef.current, roomId: "", tab: "meeting" },
            true,
          );
        }

        if (isCurrentRoom) {
          addToast(tRef.current("room.accessRevoked"), "error");
        }
      },
    );

    socket.on("webrtc:offer", async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
      if (socketRef.current !== socket || activeRoomRef.current?.id !== targetRoom.id) return;
      if (!authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)) return;
      await createPeer(peerId, false, targetRoom.id);
      const peer = peersRef.current.get(peerId);
      if (
        !peer ||
        socketRef.current !== socket ||
        activeRoomRef.current?.id !== targetRoom.id ||
        !authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)
      ) {
        return;
      }
      const record = getPeerSignalingRecord(peerId);
      await handleIncomingOffer({
        peer,
        record,
        offer: payload as RTCSessionDescriptionInit,
        localPeerId: localPeerIdRef.current,
        remotePeerId: peerId,
        isContextValid: () =>
          socketRef.current === socket &&
          activeRoomRef.current?.id === targetRoom.id &&
          peersRef.current.get(peerId) === peer &&
          Boolean(authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)),
        emitAnswer: (answer) => {
          socket.emit("webrtc:answer", { targetId: peerId, payload: answer });
        },
        onPendingRestartReady: () => {
          void negotiateForPeer(peerId, targetRoom.id, true);
        },
      });
    });

    socket.on("webrtc:answer", async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
      if (socketRef.current !== socket || activeRoomRef.current?.id !== targetRoom.id) return;
      if (!authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)) return;
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      const record = getPeerSignalingRecord(peerId);
      await handleIncomingAnswer({
        peer,
        record,
        answer: payload as RTCSessionDescriptionInit,
        isContextValid: () =>
          socketRef.current === socket &&
          activeRoomRef.current?.id === targetRoom.id &&
          peersRef.current.get(peerId) === peer &&
          Boolean(authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)),
        onPendingRestartReady: () => {
          void negotiateForPeer(peerId, targetRoom.id, true);
        },
      });
    });

    socket.on("webrtc:ice-candidate", async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
      if (socketRef.current !== socket || activeRoomRef.current?.id !== targetRoom.id) return;
      if (!authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)) return;
      const record = getPeerSignalingRecord(peerId);
      await handleIncomingIceCandidate({
        peer: peersRef.current.get(peerId),
        record,
        candidate: payload as RTCIceCandidateInit,
      });
    });

    socket.on("connect_error", (error) => {
      setSessionStatus({ kind: "error", message: error.message || undefined });
    });

    socket.on("disconnect", () => {
      if (socketRef.current !== socket || !activeRoomRef.current) return;
      setOnlinePeers([]);
      if (openConnectionCount(channelsRef.current.values()) === 0) {
        setSessionStatus({ kind: "connectingSignaling" });
      }
    });
  };

  const handleWorkspaceChange = useCallback((workspaceId: string) => {
    setRoomSearch("");
    // Reset the old workspace's rows in the same render as its name changes.
    if (workspaceId !== selectedWorkspaceId) {
      workspaceMemberRosterRef.current = null;
      setRoomOnlineCounts({});
      setRooms([]); setRoomsLoading(true); setRoomsLoadedFor(''); setRoomLoadError('');
    }
    if (activeRoomRef.current && activeRoomRef.current.workspaceId !== workspaceId) {
      leaveRoom(false);
    }
    setSelectedWorkspaceId(workspaceId);
    changeRoute({workspaceId,roomId:"",tab:"meeting"});
  }, [selectedWorkspaceId, leaveRoom, changeRoute]);

  const sendMessage = useCallback((draftText: string, replyTo?: ChatReplySummary): boolean => {
    if (activeRoomRef.current?.access === 'VIEWER') return false;
    const msgId = crypto.randomUUID();
    const hlc = hlcRef.current.now();
    const payload = createChatOutboundPayload(
      memberNameRef.current,
      t("chat.you"),
      draftText,
      Date.now(),
      userId,
      { id: msgId, hlc, replyTo },
    );
    if (!payload) return false;
    if (!canComposeRoomMessage(false, payload.envelope.body)) {
      return false;
    }
    const openConnections = openConnectionCount(channelsRef.current.values());
    if (openConnections > 0) {
      try {
        broadcast(payload.envelope);
      } catch {
        setChatError(t('chat.sendFailed'));
        return false;
      }
    }
    setChatError('');
    chatAtBottomRef.current = true;
    addMessage(payload.localMessage);
    if (activeRoomRef.current?.id) {
      scheduleCollabBackup(activeRoomRef.current.id);
    }
    return true;
  }, [broadcast, addMessage, t, userId, scheduleCollabBackup]);

  const toggleChatReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (activeRoomRef.current?.access === 'VIEWER' || !userId) return;
      const target = messagesRef.current.find((item) => item.id === messageId);
      const currentlyActive = Boolean(target?.reactions?.[emoji]?.includes(userId));
      const nextActive = !currentlyActive;
      const hlc = hlcRef.current.now();

      setMessages((current) => {
        const next = applyChatReaction(current, messageId, emoji, userId, nextActive);
        messagesRef.current = next;
        const room = activeRoomRef.current;
        if (room) {
          writeRoomChatCache(localStorage, roomChatCacheKey(userId, room.workspaceId, room.id), next);
        }
        return next;
      });

      if (openConnectionCount(channelsRef.current.values()) > 0) {
        try {
          broadcast({
            type: "chat:reaction",
            messageId,
            emoji,
            active: nextActive,
            hlc,
          });
        } catch {
          /* Best-effort P2P action broadcast; local + cloud backup still persists. */
        }
      }
      if (activeRoomRef.current?.id) {
        scheduleCollabBackup(activeRoomRef.current.id);
      }
    },
    [broadcast, scheduleCollabBackup, userId],
  );

  const toggleChatPin = useCallback(
    (messageId: string, pinned: boolean) => {
      if (activeRoomRef.current?.access === 'VIEWER' || !userId) return;
      const hlc = hlcRef.current.now();

      setMessages((current) => {
        const next = applyChatPin(current, messageId, pinned, memberNameRef.current);
        messagesRef.current = next;
        const room = activeRoomRef.current;
        if (room) {
          writeRoomChatCache(localStorage, roomChatCacheKey(userId, room.workspaceId, room.id), next);
        }
        return next;
      });

      if (openConnectionCount(channelsRef.current.values()) > 0) {
        try {
          broadcast({
            type: "chat:pin",
            messageId,
            pinned,
            hlc,
          });
        } catch {
          /* Best-effort P2P action broadcast; local + cloud backup still persists. */
        }
      }
      if (activeRoomRef.current?.id) {
        scheduleCollabBackup(activeRoomRef.current.id);
      }
    },
    [broadcast, scheduleCollabBackup, userId],
  );

  const handleNoteContentChange = useCallback((body: string, updatedAt: number) => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    const hlc = hlcRef.current.now();
    noteTextRef.current = body;
    noteUpdatedAtRef.current = updatedAt;
    noteHlcRef.current = hlc;
    const openConnections = openConnectionCount(channelsRef.current.values());
    const envelope = buildNoteUpdateEnvelope({
      noteShared: noteSharedRef.current,
      roomReadOnly: false,
      openConnections,
      author: memberNameRef.current,
      body,
      updatedAt,
      hlc,
    });
    if (envelope) {
      try {
        broadcast(envelope);
        if (noteErrorRef.current) applyNoteError('');
      } catch {
        applyNoteError(t('note.syncFailed'));
      }
    }
    if (activeRoomRef.current?.id) {
      scheduleNoteBackup(activeRoomRef.current.id);
    }
  }, [broadcast, applyNoteError, t, scheduleNoteBackup]);

  const toggleNoteSharing = useCallback(() => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    const openConnections = openConnectionCount(channelsRef.current.values());
    const hlc = hlcRef.current.now();
    noteHlcRef.current = hlc;

    if (noteSharedRef.current) {
      const unshareEnvelope = buildNoteUnshareEnvelope({
        roomReadOnly: false,
        openConnections,
        author: memberNameRef.current,
      });
      if (unshareEnvelope) {
        try {
          broadcast(unshareEnvelope);
        } catch {
          applyNoteError(t('note.syncFailed'));
          return;
        }
      }
      noteSharedRef.current = false;
      setNoteShared(false);
      setNoteResyncing(false);
      clearNoteResyncTimer();
      applyNoteError('');
      if (activeRoomRef.current?.id) {
        scheduleNoteBackup(activeRoomRef.current.id);
      }
      return;
    }

    const syncTs = noteUpdatedAtRef.current ?? Date.now();
    if (openConnections > 0) {
      try {
        broadcast({
          type: "note:shared",
          author: memberNameRef.current,
          body: noteTextRef.current,
          updatedAt: syncTs,
          hlc,
        });
      } catch {
        applyNoteError(t('note.syncFailed'));
        return;
      }
    }
    noteUpdatedAtRef.current = syncTs;
    applyNoteError('');
    noteSharedRef.current = true;
    setNoteShared(true);
    if (activeRoomRef.current?.id) {
      scheduleNoteBackup(activeRoomRef.current.id);
    }
  }, [broadcast, applyNoteError, clearNoteResyncTimer, t, scheduleNoteBackup]);

  const retryNoteSync = useCallback(() => {
    if (activeRoomRef.current?.access === 'VIEWER' || !noteSharedRef.current) return;
    const openConnections = openConnectionCount(channelsRef.current.values());
    if (openConnections === 0) return;
    const syncTs = noteUpdatedAtRef.current ?? Date.now();
    const hlc = hlcRef.current.now();
    noteHlcRef.current = hlc;
    setNoteResyncing(true);
    clearNoteResyncTimer();
    try {
      broadcast({
        type: "note:shared",
        author: memberNameRef.current,
        body: noteTextRef.current,
        updatedAt: syncTs,
        hlc,
      });
      noteUpdatedAtRef.current = syncTs;
      applyNoteError('');
      noteResyncTimerRef.current = window.setTimeout(() => {
        noteResyncTimerRef.current = null;
        setNoteResyncing(false);
      }, 450);
    } catch {
      setNoteResyncing(false);
      applyNoteError(t('note.syncFailed'));
    }
  }, [broadcast, applyNoteError, clearNoteResyncTimer, t]);

  const noteShareStatus = deriveNoteShareStatus({
    noteShared,
    peersCount,
    resyncing: noteResyncing,
    error: noteError,
  });

  const handleCopyCurrentRoomId = useCallback(async () => {
    const room = activeRoomRef.current;
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.id);
      setCopiedRoomId(true);
      addToast(t("rightPanel.copied"), "success");
      setTimeout(() => setCopiedRoomId(false), 2000);
    } catch {
      addToast(t("rightPanel.copyFailed"), "error");
    }
  }, [addToast, t]);

  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId);
  const sidebarExpanded = compactLayout ? isSidebarOpen : !sidebarCollapsed;
  const sidebarVisible = !compactLayout || isSidebarOpen;
  const isCompactRail = Boolean(sidebarCollapsed && !compactLayout);
  const isCompactRailRef = useRef(isCompactRail);
  useEffect(() => {
    isCompactRailRef.current = isCompactRail;
    if (!isCompactRail) railTipStore.set(null);
  }, [isCompactRail, railTipStore]);
  const toggleSidebar = () => {
    const nextVisible = !sidebarExpanded;
    railTipStore.set(null);
    if (compactLayout) setIsSidebarOpen(nextVisible);
    else {
      setSidebarCollapsed(!nextVisible);
      try { localStorage.setItem('bifrost_sidebar_collapsed', String(!nextVisible)); } catch { /* Preference is optional. */ }
    }
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(
      !compactLayout || nextVisible ? '.app-sidebar .workspace-brand' : '.app-header .sidebar-brand-toggle',
    )?.focus({ preventScroll: true }));
  };
  const retryWorkspaces = useCallback(() => {
    setWorkspaceLoading(true);
    setWorkspaceLoadError(false);
    setWorkspaceRetry((value) => value + 1);
  }, []);
  const retryRooms = useCallback(() => {
    setRoomsLoading(true);
    setRoomLoadError("");
    setRoomsVersion((value) => value + 1);
  }, []);
  const openProfileModal = useCallback(() => {
    if (!user) return;
    setProfileName(user.name);
    setProfileAvatar(user.profile?.avatarDataUrl ?? null);
    setProfileImageBusy(false);
    setProfileMessage("");
    railTipStore.set(null);
    setIsSidebarOpen(false);
    setShowProfileModal(true);
  }, [user, railTipStore]);
  const openWorkspaceForm = useCallback(() => {
    railTipStore.set(null);
    setIsSidebarOpen(false);
    setWorkspaceError("");
    setWorkspaceName("");
    setShowCreateWsModal(true);
  }, [railTipStore]);
  const openRoomForm = useCallback(() => {
    railTipStore.set(null);
    setIsSidebarOpen(false);
    setRoomMessage("");
    setNewRoomName("");
    setNewRoomDesc("");
    setShowCreateRoomModal(true);
  }, [railTipStore]);
  const openInviteForm = useCallback(() => {
    railTipStore.set(null);
    setIsSidebarOpen(false);
    setInviteError("");
    setInviteEmail("");
    setShowInviteModal(true);
  }, [railTipStore]);
  const showRailTip = useCallback((target: HTMLElement, label: string) => {
    if (!isCompactRailRef.current || document.querySelector(":popover-open")) {
      railTipStore.set(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    railTipStore.set({ label, top: Math.round(rect.top + rect.height / 2) });
  }, [railTipStore]);
  const hideRailTip = useCallback(() => railTipStore.set(null), [railTipStore]);
  const closeProfileForm = () => {
    if (profileSaving || profileImageBusy) return;
    const avatarDirty = profileAvatar !== (user?.profile?.avatarDataUrl ?? null);
    if (profileName !== user?.name || avatarDirty) setDiscardForm('profile');
    else setShowProfileModal(false);
  };
  const closeWorkspaceForm = () => { if(workspaceSubmitting) return;if(workspaceName.trim()) setDiscardForm('workspace');else setShowCreateWsModal(false); };
  const closeEditWorkspaceForm = () => {
    if (editWorkspaceSubmitting || !editingWorkspace) return;
    if (editWorkspaceName.trim() !== editingWorkspace.name) setDiscardForm('editWorkspace');
    else {
      setEditingWorkspace(null);
      restoreWorkspaceManageFocus();
    }
  };
  const closeRoomForm = () => { if(roomSubmitting) return;if(newRoomName.trim() || newRoomDesc.trim()) setDiscardForm('room');else setShowCreateRoomModal(false); };
  const closeEditRoomForm = () => {
    if (editRoomSubmitting || !editingRoom) return;
    const dirty =
      editRoomName.trim() !== editingRoom.name ||
      editRoomDesc.trim() !== (editingRoom.description ?? "");
    if (dirty) setDiscardForm('editRoom');
    else {
      setEditingRoom(null);
      restoreManagedRoomFocus();
    }
  };
  const closeInviteForm = () => { if(inviteSubmitting) return;if(inviteEmail.trim()) setDiscardForm('invite');else setShowInviteModal(false); };
  const activeDialog = discardForm ? '' : showProfileModal ? 'profile' : showCreateWsModal ? 'workspace' : (editingWorkspace && !confirmDeleteWorkspace) ? 'editWorkspace' : showCreateRoomModal ? 'room' : (editingRoom && !confirmDeleteRoom) ? 'editRoom' : showInviteModal ? 'invite' : showRoomMembersModal ? 'roomMembers' : '';
  useDialogFocus(activeDialog, () => {
    if (activeDialog === 'profile') closeProfileForm();
    if (activeDialog === 'workspace') closeWorkspaceForm();
    if (activeDialog === 'editWorkspace') closeEditWorkspaceForm();
    if (activeDialog === 'room') closeRoomForm();
    if (activeDialog === 'editRoom') closeEditRoomForm();
    if (activeDialog === 'invite') closeInviteForm();
    if (activeDialog === 'roomMembers') setShowRoomMembersModal(false);
  }, '.app-shell .motion-presence:not([data-exiting]) > .modal-overlay .modal-card');
  useDialogFocus(!!user && isSidebarOpen && compactLayout, () => setIsSidebarOpen(false), '.app-sidebar');
  useDialogFocus(!!user && isRightPanelOpen && compactLayout && !!currentRoom, () => setIsRightPanelOpen(false), '.right-panel');
  const restoreRoomRoute = useEffectEvent(() => {
    if(!user || workspaceLoading || roomsLoading || requestedRoute.workspaceId !== selectedWorkspaceId) return;
    if(!requestedRoute.roomId) {if(activeRoomRef.current) leaveRoom(false);return;}
    if(roomsLoadedFor !== selectedWorkspaceId) return;
    const target=rooms.find(room=>room.id===requestedRoute.roomId);
    if(target && target.access !== null) { if(activeRoomRef.current?.id !== target.id) joinRoom(target,false);setActiveTab(requestedRoute.tab); } else if(activeRoomRef.current) leaveRoom(false);
  });
  // Room entry synchronizes the browser URL with the external WebRTC session after room loading.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { restoreRoomRoute(); }, [requestedRoute, rooms, roomsLoading, roomsLoadedFor, workspaceLoading, selectedWorkspaceId, user]);
  const selectTab = (tab: RoomTab, fromTab: RoomTab = activeTab) => {
    if (tab === fromTab && !tabTransition.running.current) return;
    tabTransition.run(() => {
      setActiveTab(tab);
      if(currentRoom) changeRoute({workspaceId:currentRoom.workspaceId,roomId:currentRoom.id,tab});
    }, tabDirection(fromTab, tab));
  };
  const handleRoomTabKeyDown = (tab: RoomTab, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const nextTab = getNextRoomTab(tab, event.key, event);
    if (!nextTab) return;
    event.preventDefault();
    roomTabButtonRefs.current[nextTab]?.focus();
    selectTab(nextTab, tab);
  };
  const roomTabPanelProps = (tab: RoomTab) => ({
    id: roomPanelElementId(tab),
    role: "tabpanel" as const,
    "aria-labelledby": roomTabElementId(tab),
    inert: activeTab !== tab,
    className: `tab-pane ${activeTab === tab ? "active" : "hidden"}`,
  });
  const routeUnavailable = !workspaceLoading && !!requestedRoute.roomId && roomsLoadedFor === selectedWorkspaceId && !roomsLoading && !rooms.some(room=>room.id===requestedRoute.roomId && room.access!==null);
  const quickRoom = rooms.find(room=>room.access!==null);
  const roomReadOnly = currentRoom?.access === 'VIEWER';
  useLayoutEffect(() => {
    const panel = filesPanelRef.current;
    if (!panel) return;
    syncEmptyTabPanelTabIndex(panel);
    const observer = new MutationObserver(() => syncEmptyTabPanelTabIndex(panel));
    observer.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'href'],
    });
    return () => observer.disconnect();
  }, [currentRoom?.id, activeTab, roomReadOnly, peersCount]);
  const statusDisplay = getSessionStatusDisplay(sessionStatus, lang);
  const roomsPending = Boolean(
    selectedWorkspace && (roomsLoading || (roomsLoadedFor !== selectedWorkspace.id && !roomLoadError))
  );
  const sidebarRoomsPending = workspaceLoading || roomsPending;
  const activeDashboard = Boolean(authReady && user && !currentRoom);
  const showWorkspaceSkeleton = useDelayedLoading(
    activeDashboard && !routeUnavailable && workspaceLoading
  );
  const showRoomsSkeleton = useDelayedLoading(
    activeDashboard && !routeUnavailable && !workspaceLoading && !workspaceLoadError && roomsPending
  );
  const showSidebarRoomsSkeleton = useDelayedLoading(
    Boolean(authReady && user && sidebarRoomsPending)
  );

  // Auth Loading
  if (!authReady) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t("common.close")} />
        <WorkspaceLoadingScreen phase="session" lang={lang} theme={theme} />
      </>
    );
  }

  // Keep authentication requests/state here; the presentation is isolated from the workspace shell.
  if (!user) {
    return <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t("common.close")} />
      <AuthScreen
        mode={authMode} lang={lang} theme={theme}
        name={authName} email={authEmail} password={authPassword}
        error={authError} submitting={authSubmitting}
        twoFactorChallenge={Boolean(twoFactorChallengeToken)}
        twoFactorCode={twoFactorLoginCode}
        pendingInvite={pendingInvite}
        onName={setAuthName} onEmail={setAuthEmail} onPassword={setAuthPassword}
        onTwoFactorCode={setTwoFactorLoginCode}
        onCancelTwoFactor={() => {
          setTwoFactorChallengeToken("");
          setTwoFactorLoginCode("");
          setAuthError("");
        }}
        onLanguage={toggleLang} onTheme={toggleTheme}
        onMode={() => {
          setAuthMode(authMode === "login" ? "register" : "login");
          setAuthError("");
          setAuthPassword("");
        }}
        onSubmit={submitAuth}
      />
    </>
  }

  if (
    !workspaceLoading &&
    !workspaceLoadError &&
    workspaces.length === 0 &&
    !user.profile?.completedAt
  ) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t("common.close")} />
        <ProfileOnboarding
          name={user.name}
          email={user.email}
          lang={lang}
          onLogout={logout}
          onSave={completeOnboarding}
        />
      </>
    );
  }

  const closeSidebarLabel = t('sidebar.closeMobileAria');
  const unassignedRoomLabel = t('sidebar.notAssignedBadge');
  const breadcrumbWsText = workspaceLoading
    ? t('workspace.loadingPlaceholder')
    : workspaceLoadError && !selectedWorkspace
      ? t('workspace.loadErrorTitle')
      : selectedWorkspace
        ? selectedWorkspace.name
        : t('workspace.emptyTitle');
  const onlineSummaryLabel = t('sidebar.peersInRoom', { count: onlinePeers.length });

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

  // Logged In -> Desktop-First Application Shell
  return (
    <div className={`app-shell workspace-edition ${currentRoom ? 'room-focused' : ''} ${!compactLayout && sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} closeLabel={t("common.close")} />

      {compactLayout && (
        <div
          className={`drawer-backdrop ${isSidebarOpen ? 'is-open' : ''}`}
          aria-hidden="true"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <SidebarRailTooltip store={railTipStore} active={isCompactRail} />

      <AppSidebar
        user={user}
        lang={lang}
        theme={theme}
        sidebarVisible={sidebarVisible}
        isSidebarOpen={isSidebarOpen}
        sidebarExpanded={sidebarExpanded}
        isCompactRail={isCompactRail}
        closeSidebarLabel={closeSidebarLabel}
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        selectedWorkspace={selectedWorkspace}
        workspaceLoading={workspaceLoading}
        workspaceLoadError={workspaceLoadError}
        workspaceSubmitting={workspaceSubmitting}
        breadcrumbWsText={breadcrumbWsText}
        rooms={rooms}
        currentRoom={currentRoom}
        sidebarRoomsPending={sidebarRoomsPending}
        showSidebarRoomsSkeleton={showSidebarRoomsSkeleton}
        roomLoadError={roomLoadError}
        roomSubmitting={roomSubmitting}
        roomOnlineCounts={roomOnlineCounts}
        onlinePeers={onlinePeers}
        unassignedRoomLabel={unassignedRoomLabel}
        t={t}
        toggleSidebar={toggleSidebar}
        setIsSidebarOpen={setIsSidebarOpen}
        openEditWorkspaceModal={openEditWorkspaceModal}
        openWorkspaceForm={openWorkspaceForm}
        handleWorkspaceChange={handleWorkspaceChange}
        retryWorkspaces={retryWorkspaces}
        leaveRoom={leaveRoom}
        openRoomForm={openRoomForm}
        retryRooms={retryRooms}
        joinRoom={joinRoom}
        showRailTip={showRailTip}
        hideRailTip={hideRailTip}
        toggleLang={toggleLang}
        toggleTheme={toggleTheme}
        logout={logout}
        openProfileModal={openProfileModal}
      />

      <div className="app-main" inert={compactLayout && isSidebarOpen}>
        <AppHeader
          user={user}
          compactLayout={compactLayout}
          sidebarVisible={sidebarVisible}
          selectedWorkspace={selectedWorkspace}
          currentRoom={currentRoom}
          breadcrumbWsText={breadcrumbWsText}
          statusDisplay={statusDisplay}
          onlinePeers={onlinePeers}
          onlineSummaryLabel={onlineSummaryLabel}
          isRightPanelOpen={isRightPanelOpen}
          t={t}
          toggleSidebar={toggleSidebar}
          leaveRoom={leaveRoom}
          openInviteForm={openInviteForm}
          setIsRightPanelOpen={setIsRightPanelOpen}
        />

        <div className="app-content-body">
          {!currentRoom ? (
            <DashboardView
              user={user}
              token={token}
              lang={lang}
              selectedWorkspace={selectedWorkspace}
              selectedWorkspaceId={selectedWorkspaceId}
              rooms={rooms}
              quickRoom={quickRoom}
              roomsPending={roomsPending}
              showRoomsSkeleton={showRoomsSkeleton}
              roomLoadError={roomLoadError}
              roomSearch={roomSearch}
              roomSearchRef={roomSearchRef}
              lastManagedRoomIdRef={lastManagedRoomIdRef}
              routeUnavailable={routeUnavailable}
              workspaceLoadError={workspaceLoadError}
              workspaceLoading={workspaceLoading}
              showWorkspaceSkeleton={showWorkspaceSkeleton}
              roomListSkeleton={roomListSkeleton}
              membersVersion={membersVersion}
              memberCurrentUser={memberCurrentUser}
              t={t}
              handleWorkspaceChange={handleWorkspaceChange}
              retryWorkspaces={retryWorkspaces}
              retryRooms={retryRooms}
              joinRoom={joinRoom}
              openRoomForm={openRoomForm}
              openWorkspaceForm={openWorkspaceForm}
              openEditRoomModal={openEditRoomModal}
              setRoomSearch={setRoomSearch}
              openInviteForm={openInviteForm}
              addToast={addToast}
            />
          ) : (
            <RoomWorkspaceView
              user={user}
              token={token}
              lang={lang}
              currentRoom={currentRoom}
              selectedWorkspace={selectedWorkspace}
              roomReadOnly={roomReadOnly}
              roomError={roomError}
              statusDisplay={statusDisplay}
              sessionStatus={sessionStatus}
              onlinePeers={onlinePeers}
              peersCount={peersCount}
              activeTab={activeTab}
              roomTabsRef={roomTabsRef}
              roomTabButtonRefs={roomTabButtonRefs}
              filesPanelRef={filesPanelRef}
              compactLayout={compactLayout}
              isRightPanelOpen={isRightPanelOpen}
              copiedRoomId={copiedRoomId}
              messagesCount={messages.length}
              meetingProps={{
                readOnly: roomReadOnly,
                currentUserId: user.id,
                currentUserName: user.name,
                currentUserAvatar: user.profile?.avatarDataUrl,
                roomName: currentRoom.name,
                onlinePeers,
                micEnabled,
                camEnabled,
                screenSharing,
                noiseSuppression,
                backgroundBlur,
                mediaError,
                localAudioStream,
                localVideoStream,
                remoteStreams,
                peerStats,
                meshProfile,
                audioInputs,
                videoInputs,
                audioOutputs,
                selectedMicId,
                selectedCamId,
                selectedSpeakerId,
                speakerSelectionSupported,
                onToggleMic: () => void toggleMic(),
                onToggleCam: () => void toggleCam(),
                onToggleScreenShare: () => void toggleScreenShare(),
                onToggleNoiseSuppression: () => void toggleNoiseSuppression(),
                onToggleBackgroundBlur: () => void toggleBackgroundBlur(),
                onSelectMicrophone: (deviceId) => void selectMicrophone(deviceId),
                onSelectCamera: (deviceId) => void selectCamera(deviceId),
                onSelectSpeaker: selectSpeaker,
                onLeaveRoom: leaveRoom,
                onCopyRoomId: handleCopyCurrentRoomId,
                copiedRoomId,
                onInvite: selectedWorkspace?.role === 'OWNER' ? openInviteForm : undefined,
                t,
              }}
              boardProps={{
                readOnly: roomReadOnly,
                currentUser: memoCurrentUser ?? { id: user.id, name: user.name, email: user.email },
                workspaceId: currentRoom.workspaceId,
                roomId: currentRoom.id,
                broadcast,
                sendDirectToPeer: sendDirectToBoardPeer,
                registerMessageHandler: registerMeetingBoardMessageHandler,
                registerPeerConnectHandler: registerMeetingBoardPeerConnectHandler,
                cloudBoard,
                onBoardStateChange: handleBoardStateChange,
                lang,
                addToast,
              }}
              chatProps={{
                scopeKey: roomDraftKey(user.id, currentRoom.workspaceId, currentRoom.id),
                roomName: currentRoom.name,
                roomReadOnly,
                peersCount,
                currentUserId: user.id,
                messages,
                mentionableMembers: onlinePeers.map((peer) => ({ userId: peer.userId, name: peer.name })),
                chatError,
                messagesHeading: t('chat.messagesHeading'),
                noRecipientsLabel: t('chat.noRecipients'),
                chatLogRef,
                onChatScroll: handleChatScroll,
                lang,
                t,
                onSendMessage: sendMessage,
                onToggleReaction: toggleChatReaction,
                onTogglePin: toggleChatPin,
              }}
              notesProps={{
                scopeKey: roomDraftKey(user.id, currentRoom.workspaceId, currentRoom.id),
                roomName: currentRoom.name,
                roomReadOnly,
                noteShared,
                noteShareStatus,
                peersCount,
                noteError,
                sharedNotes,
                hydratedNote,
                lang,
                t,
                onToggleNoteSharing: toggleNoteSharing,
                onRetryNoteSync: retryNoteSync,
                onNoteContentChange: handleNoteContentChange,
                onSuccessToast: handleSuccessToast,
                onErrorToast: handleErrorToast,
              }}
              fileShareProps={{
                readOnly: roomReadOnly,
                roomId: currentRoom.id,
                peersCount,
                onlinePeerIds,
                channelsRef,
                broadcast,
                sendDirect: sendDirectToFilePeer,
                sendBinaryDirect: sendBinaryToFilePeer,
                registerMessageHandler: registerFileMessageHandler,
                registerBinaryHandler: registerFileBinaryHandler,
                onSuccessToast: handleSuccessToast,
                onErrorToast: handleErrorToast,
                t,
              }}
              t={t}
              selectTab={selectTab}
              handleRoomTabKeyDown={handleRoomTabKeyDown}
              roomTabPanelProps={roomTabPanelProps}
              setIsRightPanelOpen={setIsRightPanelOpen}
              handleCopyCurrentRoomId={handleCopyCurrentRoomId}
              openEditRoomModal={openEditRoomModal}
              setShowRoomMembersModal={setShowRoomMembersModal}
            />
          )}
        </div>
      </div>

      <ProfileSecurityModal
        user={user}
        token={token}
        lang={lang}
        showProfileModal={showProfileModal}
        discardForm={discardForm}
        profileAvatar={profileAvatar}
        profileName={profileName}
        profileMessage={profileMessage}
        profileSaving={profileSaving}
        profileImageBusy={profileImageBusy}
        currentPasswordInput={currentPasswordInput}
        newPasswordInput={newPasswordInput}
        confirmNewPasswordInput={confirmNewPasswordInput}
        passwordSaving={passwordSaving}
        passwordError={passwordError}
        emailVerifyCode={emailVerifyCode}
        emailVerifyDevCode={emailVerifyDevCode}
        emailVerifyBusy={emailVerifyBusy}
        twoFactorSetupSecret={twoFactorSetupSecret}
        twoFactorSetupCode={twoFactorSetupCode}
        twoFactorRecoveryCodes={twoFactorRecoveryCodes}
        twoFactorBusy={twoFactorBusy}
        twoFactorError={twoFactorError}
        notificationPermission={notificationPermission}
        t={t}
        closeProfileForm={closeProfileForm}
        updateProfile={updateProfile}
        setProfileAvatar={setProfileAvatar}
        setProfileImageBusy={setProfileImageBusy}
        setProfileName={setProfileName}
        setProfileMessage={setProfileMessage}
        submitChangePassword={submitChangePassword}
        setCurrentPasswordInput={setCurrentPasswordInput}
        setNewPasswordInput={setNewPasswordInput}
        setConfirmNewPasswordInput={setConfirmNewPasswordInput}
        handleSendEmailVerification={handleSendEmailVerification}
        handleVerifyEmailCode={handleVerifyEmailCode}
        setEmailVerifyCode={setEmailVerifyCode}
        handleSetupTwoFactor={handleSetupTwoFactor}
        handleEnableTwoFactor={handleEnableTwoFactor}
        handleDisableTwoFactor={handleDisableTwoFactor}
        setTwoFactorSetupCode={setTwoFactorSetupCode}
        setNotificationPermission={setNotificationPermission}
      />

      <WorkspaceModals
        user={user}
        token={token}
        lang={lang}
        discardForm={discardForm}
        selectedWorkspace={selectedWorkspace}
        currentRoom={currentRoom}
        rooms={rooms}
        roomsLoading={roomsLoading}
        roomLoadError={roomLoadError}
        membersVersion={membersVersion}
        memberCurrentUser={memberCurrentUser}
        liveRoomUserIds={liveRoomUserIds}
        showRoomMembersModal={showRoomMembersModal}
        showCreateWsModal={showCreateWsModal}
        workspaceName={workspaceName}
        workspaceError={workspaceError}
        workspaceSubmitting={workspaceSubmitting}
        editingWorkspace={editingWorkspace}
        confirmDeleteWorkspace={confirmDeleteWorkspace}
        editWorkspaceName={editWorkspaceName}
        editWorkspaceError={editWorkspaceError}
        editWorkspaceSubmitting={editWorkspaceSubmitting}
        showCreateRoomModal={showCreateRoomModal}
        newRoomName={newRoomName}
        newRoomDesc={newRoomDesc}
        roomMessage={roomMessage}
        roomSubmitting={roomSubmitting}
        editingRoom={editingRoom}
        confirmDeleteRoom={confirmDeleteRoom}
        editRoomName={editRoomName}
        editRoomDesc={editRoomDesc}
        editRoomError={editRoomError}
        editRoomSubmitting={editRoomSubmitting}
        showInviteModal={showInviteModal}
        inviteEmail={inviteEmail}
        inviteError={inviteError}
        inviteSubmitting={inviteSubmitting}
        generatedInviteUrl={generatedInviteUrl}
        generatingInviteLink={generatingInviteLink}
        t={t}
        setDiscardForm={setDiscardForm}
        setShowProfileModal={setShowProfileModal}
        setShowCreateWsModal={setShowCreateWsModal}
        setWorkspaceName={setWorkspaceName}
        setWorkspaceError={setWorkspaceError}
        setEditingWorkspace={setEditingWorkspace}
        setEditWorkspaceName={setEditWorkspaceName}
        setEditWorkspaceError={setEditWorkspaceError}
        setConfirmDeleteWorkspace={setConfirmDeleteWorkspace}
        restoreWorkspaceManageFocus={restoreWorkspaceManageFocus}
        setShowCreateRoomModal={setShowCreateRoomModal}
        setNewRoomName={setNewRoomName}
        setNewRoomDesc={setNewRoomDesc}
        setRoomMessage={setRoomMessage}
        setEditingRoom={setEditingRoom}
        setEditRoomName={setEditRoomName}
        setEditRoomDesc={setEditRoomDesc}
        setEditRoomError={setEditRoomError}
        setConfirmDeleteRoom={setConfirmDeleteRoom}
        restoreManagedRoomFocus={restoreManagedRoomFocus}
        setShowInviteModal={setShowInviteModal}
        setInviteEmail={setInviteEmail}
        setInviteError={setInviteError}
        setShowRoomMembersModal={setShowRoomMembersModal}
        executeDeleteWorkspace={executeDeleteWorkspace}
        executeDeleteRoom={executeDeleteRoom}
        retryRooms={retryRooms}
        openInviteForm={openInviteForm}
        closeWorkspaceForm={closeWorkspaceForm}
        createWorkspace={createWorkspace}
        closeEditWorkspaceForm={closeEditWorkspaceForm}
        submitEditWorkspace={submitEditWorkspace}
        closeRoomForm={closeRoomForm}
        createRoom={createRoom}
        closeEditRoomForm={closeEditRoomForm}
        submitEditRoom={submitEditRoom}
        closeInviteForm={closeInviteForm}
        inviteMember={inviteMember}
        createOneClickInviteLink={createOneClickInviteLink}
        addToast={addToast}
      />
    </div>
  );
}

export default App;
