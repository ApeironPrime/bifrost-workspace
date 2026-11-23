import { ConfirmDialog } from './components/ConfirmDialog'
import { MotionPresence } from './components/MotionPresence'
import { useTabTransition } from './lib/useTabTransition'
import { tabDirection } from './lib/tabDirection'
import { useRoomTabIndicator } from './lib/useRoomTabIndicator'
import {
  getNextRoomTab,
  roomPanelElementId,
  roomTabElementId,
  roomTabTabIndex,
  syncEmptyTabPanelTabIndex,
  type RoomTabId,
} from './lib/roomTabs'
import { readWorkspaceRoute, workspaceHash, roomDraftKey, readRoomDraft, readRoomNoteUpdatedAt, type WorkspaceRoute } from './lib/roomUiState'
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
  buildNoteResyncEnvelope,
  buildNoteUnshareEnvelope,
  buildNoteUpdateEnvelope,
  createChatOutboundPayload,
  deriveNoteShareStatus,
  normalizeIncomingChatMessage,
  normalizeIncomingSharedNote,
  type ChatDataEnvelope,
  type ChatMessageItem,
  type NoteDataEnvelope,
  type SharedNoteItem,
} from './lib/chatNotes'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Video,
  Columns3,
  MessageSquare,
  FileText,
  FolderUp,
  LayoutDashboard,
  PanelRightClose,
  PanelLeftClose,
  PanelRightOpen,
  LogOut,
  Plus,
  FolderPlus,
  X,
  ArrowRight,
  Copy,
  Check,
  UserPlus,
  Users,
  Lock,
  RotateCcw,
  ChevronLeft,
  Eye,
  Crown,
  ShieldCheck,
  Settings2,
  Trash2,
} from "lucide-react";
import { MeetingBoard, type MeetingBoardMessage } from "./components/MeetingBoard";
import { FileShare, type FileShareMessage } from "./components/FileShare";
import { MeetingTab } from "./components/MeetingTab";
import { ToastContainer, type ToastItem, type ToastType } from "./components/Toast";
import {
  LOCALE_META,
  formatInviteError,
  formatRoomError,
  formatWorkspaceError,
  getInitialLanguage,
  saveLanguage,
  translate,
  type I18nKey,
  type Language,
} from "./i18n";
import { AuthScreen } from "./components/AuthScreen";
import { apiUrl, fetchAppApi, isDevMockSession, SIGNALING_URL } from "./lib/appApi";
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
import { BifrostMark } from "./homepage/components/UI";
import { AvatarPicker } from './components/AvatarPicker';
import { AccountMenu } from './components/AccountMenu';
import { ProfileOnboarding } from './components/ProfileOnboarding';
import { SearchField } from './components/SearchField';
import { UserAvatar } from './components/UserAvatar';
import { WorkspaceMembers } from './components/WorkspaceMembers';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { ChatPane } from './components/ChatPane';
import { NotesPane } from './components/NotesPane';
import { SidebarRailTooltip } from './components/SidebarRailTooltip';
import { createRailTipStore } from './lib/railTipStore';
import { getAvatarTone } from './lib/controlPrimitives';
import { resetWorkspaceTransition } from './lib/delayedLoading';
import { useDelayedLoading } from './lib/useDelayedLoading';
import { searchKey } from './lib/selectOptions';
import { WorkspaceLoadingScreen } from './components/WorkspaceLoadingScreen';
import { withCurrentUserHost } from './lib/roomHostProfile';
import { canSendToRoom, openConnectionCount } from './lib/roomControls';
import { useDialogFocus } from './lib/useDialogFocus';
import {
  getSessionStatusDisplay,
  roomInitials,
  type SessionStatus,
} from './lib/shellState';
import './styles/index.css';

const EMPTY_USER_IDS = new Set<string>();

type User = { id: string; name: string; email: string; createdAt: string; profile?: { avatarDataUrl?: string | null; completedAt: string } | null };
type Workspace = { id: string; name: string; slug: string; role: "OWNER" | "MEMBER" };
type Room = {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  hostId: string | null;
  access?: 'OWNER' | 'HOST' | 'MODERATOR' | 'MEMBER' | 'VIEWER' | null;
  createdAt: string;
  updatedAt: string;
  host?: { id: string; name: string; email: string } | null;
};
type PresencePeer = {
  peerId: string;
  userId: string;
  name: string;
  email: string;
};
type ChatMessage = ChatMessageItem;
type SharedNote = SharedNoteItem;
type DataEnvelope =
  | ChatDataEnvelope
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
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsMapRef = useRef(new Map<string, MediaStream>());
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

  // Auth states
  const [token, setToken] = useState(() => {
    const stored = localStorage.getItem("bifrost_token") ?? "";
    if (import.meta.env.VITE_DATA_MODE === "api" && isDevMockSession(stored)) {
      localStorage.removeItem("bifrost_token");
      return "";
    }
    return stored;
  });

  useEffect(() => {
    if (isDevMockSession(token)) {
      (window as unknown as { __bifrost_addToast?: typeof addToast }).__bifrost_addToast = addToast;
    }
  }, [token, addToast]);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(() => !localStorage.getItem("bifrost_token"));
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [discardForm,setDiscardForm] = useState<'profile'|'workspace'|'editWorkspace'|'room'|'editRoom'|'invite'|null>(null);
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
  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

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

  const [workspaceLoading, setWorkspaceLoading] = useState(() => Boolean(localStorage.getItem("bifrost_token")));
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
  const [peersCount, setPeersCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
    (message: Omit<ChatMessage, "id">) =>
      setMessages((current) => [...current, { ...message, id: crypto.randomUUID() }]),
    [],
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
    const currentStored = localStorage.getItem("bifrost_token") ?? "";
    if (isDevMockSession(currentStored)) return null;
    const storedRefresh = localStorage.getItem("bifrost_refresh_token");
    if (!storedRefresh) return null;
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const run = (async () => {
      try {
        const res = await fetchAppApi(apiUrl("/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: storedRefresh }),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { token?: string; refreshToken?: string; user?: User };
        if (!body.token) return null;
        localStorage.setItem("bifrost_token", body.token);
        if (body.refreshToken) {
          localStorage.setItem("bifrost_refresh_token", body.refreshToken);
        }
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
      const payload =
        authMode === "register"
          ? { name: authName, email: authEmail, password: authPassword }
          : { email: authEmail, password: authPassword };
      const response = await fetchAppApi(
        apiUrl(`/auth/${authMode === "register" ? "register" : "login"}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? t("auth.authFailed"));
      localStorage.setItem("bifrost_token", body.token);
      if (typeof body.refreshToken === "string" && body.refreshToken) {
        localStorage.setItem("bifrost_refresh_token", body.refreshToken);
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

  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

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
    if (remoteStreamsMapRef.current.delete(peerId)) {
      setRemoteStreams((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    }
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
  }, [token, clearNoteResyncTimer]);

  const setupDataChannel = useCallback((peerId: string, channel: RTCDataChannel, targetRoomId: string) => {
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
            const normalized = normalizeIncomingChatMessage(payload, verifiedSender);
            if (normalized) addMessage(normalized);
          },
          onNoteUpdate: (verifiedPeerId, payload, verifiedSender) => {
            const normalizedNote = normalizeIncomingSharedNote(payload, verifiedSender);
            if (normalizedNote) {
              setSharedNotes((current) => ({
                ...current,
                [verifiedPeerId]: normalizedNote,
              }));
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
      peer.ontrack = (event) => {
        if (peersRef.current.get(peerId) !== peer || activeRoomRef.current?.id !== targetRoomId) return;
        let peerStream = remoteStreamsMapRef.current.get(peerId);
        if (!peerStream) {
          peerStream = new MediaStream();
          remoteStreamsMapRef.current.set(peerId, peerStream);
        }
        const incomingTrack = event.track;
        const existingSameKind = peerStream
          .getTracks()
          .filter((track) => track.kind === incomingTrack.kind && track.id !== incomingTrack.id);
        for (const oldTrack of existingSameKind) {
          peerStream.removeTrack(oldTrack);
        }
        if (!peerStream.getTracks().some((track) => track.id === incomingTrack.id)) {
          peerStream.addTrack(incomingTrack);
        }
        const snapshotStream = new MediaStream(peerStream.getTracks());
        remoteStreamsMapRef.current.set(peerId, snapshotStream);
        setRemoteStreams((current) => ({ ...current, [peerId]: snapshotStream }));

        incomingTrack.onended = () => {
          const cur = remoteStreamsMapRef.current.get(peerId);
          if (!cur) return;
          cur.removeTrack(incomingTrack);
          const nextStream = new MediaStream(cur.getTracks());
          remoteStreamsMapRef.current.set(peerId, nextStream);
          setRemoteStreams((prev) => ({ ...prev, [peerId]: nextStream }));
        };
      };

      const activeAudio = localMediaStreamRef.current?.getAudioTracks()[0] ?? null;
      const activeScreenVideo = localScreenStreamRef.current?.getVideoTracks()[0] ?? null;
      const activeCamVideo = localMediaStreamRef.current?.getVideoTracks()[0] ?? null;
      const activeVideo = activeScreenVideo ?? activeCamVideo;
      if (activeAudio && localMediaStreamRef.current) {
        peer.addTrack(activeAudio, localMediaStreamRef.current);
      }
      if (activeVideo) {
        const videoOwner = activeScreenVideo ? localScreenStreamRef.current : localMediaStreamRef.current;
        if (videoOwner) peer.addTrack(activeVideo, videoOwner);
      }
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
  }, [closePeer, setupDataChannel, getIceManager, getPeerSignalingRecord, negotiateForPeer]);

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

    localMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    localMediaStreamRef.current = null;
    localScreenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localScreenStreamRef.current = null;
    remoteStreamsMapRef.current.clear();
    setMicEnabled(false);
    setCamEnabled(false);
    setScreenSharing(false);
    setMediaError("");
    setLocalVideoStream(null);
    setRemoteStreams({});

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
  }, [changeRoute, selectedWorkspaceId, railTipStore, clearNoteResyncTimer, applyNoteError, getIceManager]);

  const logout = useCallback(() => {
    const refreshTokenToRevoke = localStorage.getItem("bifrost_refresh_token");
    if (refreshTokenToRevoke && !isDevMockSession(tokenRef.current)) {
      void fetchAppApi(apiUrl("/auth/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshTokenToRevoke }),
      }).catch(() => {
        /* Best-effort server revocation; local state still clears. */
      });
    }
    leaveRoom();
    workspaceMemberRosterRef.current = null;
    setIsSidebarOpen(false);setIsRightPanelOpen(false);railTipStore.set(null);
    localStorage.removeItem("bifrost_token");
    localStorage.removeItem("bifrost_refresh_token");
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

  const syncTrackToAllPeers = useCallback(
    async (kind: "audio" | "video", track: MediaStreamTrack | null, ownerStream: MediaStream | null) => {
      const updates: Promise<void>[] = [];
      peersRef.current.forEach((peer) => {
        if (peer.connectionState === "closed") return;
        const sender = peer.getSenders().find((entry) => entry.track?.kind === kind);
        if (sender) {
          updates.push(sender.replaceTrack(track).catch(() => {}));
        } else if (track && ownerStream) {
          peer.addTrack(track, ownerStream);
        }
      });
      await Promise.all(updates);
    },
    [],
  );

  const toggleMic = useCallback(async () => {
    if (activeRoomRef.current?.access === "VIEWER") return;
    setMediaError("");
    const existingStream = localMediaStreamRef.current;
    const existingAudio = existingStream?.getAudioTracks()[0] ?? null;

    if (micEnabled && existingAudio) {
      existingAudio.stop();
      existingStream?.removeTrack(existingAudio);
      setMicEnabled(false);
      await syncTrackToAllPeers("audio", null, null);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = t("meeting.mediaUnsupported");
      setMediaError(msg);
      addToast(msg, "error");
      return;
    }

    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = captured.getAudioTracks()[0] ?? null;
      if (!audioTrack) return;
      const targetStream = existingStream ?? new MediaStream();
      targetStream.addTrack(audioTrack);
      localMediaStreamRef.current = targetStream;
      setMicEnabled(true);
      await syncTrackToAllPeers("audio", audioTrack, targetStream);
    } catch {
      const msg = t("meeting.mediaPermissionDenied");
      setMediaError(msg);
      addToast(msg, "error");
    }
  }, [micEnabled, syncTrackToAllPeers, t, addToast]);

  const toggleCam = useCallback(async () => {
    if (activeRoomRef.current?.access === "VIEWER") return;
    setMediaError("");
    const existingStream = localMediaStreamRef.current;
    const existingVideo = existingStream?.getVideoTracks()[0] ?? null;

    if (camEnabled && existingVideo) {
      existingVideo.stop();
      existingStream?.removeTrack(existingVideo);
      setCamEnabled(false);
      if (!localScreenStreamRef.current) {
        setLocalVideoStream(null);
        await syncTrackToAllPeers("video", null, null);
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = t("meeting.mediaUnsupported");
      setMediaError(msg);
      addToast(msg, "error");
      return;
    }

    try {
      const captured = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = captured.getVideoTracks()[0] ?? null;
      if (!videoTrack) return;
      const targetStream = existingStream ?? new MediaStream();
      targetStream.addTrack(videoTrack);
      localMediaStreamRef.current = targetStream;
      setCamEnabled(true);
      if (!localScreenStreamRef.current) {
        setLocalVideoStream(new MediaStream([videoTrack]));
        await syncTrackToAllPeers("video", videoTrack, targetStream);
      }
    } catch {
      const msg = t("meeting.mediaPermissionDenied");
      setMediaError(msg);
      addToast(msg, "error");
    }
  }, [camEnabled, syncTrackToAllPeers, t, addToast]);

  const stopScreenShareInternal = useCallback(async () => {
    const screenStream = localScreenStreamRef.current;
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      localScreenStreamRef.current = null;
    }
    setScreenSharing(false);
    const camTrack = localMediaStreamRef.current?.getVideoTracks()[0] ?? null;
    if (camTrack && localMediaStreamRef.current) {
      setLocalVideoStream(new MediaStream([camTrack]));
      await syncTrackToAllPeers("video", camTrack, localMediaStreamRef.current);
    } else {
      setLocalVideoStream(null);
      await syncTrackToAllPeers("video", null, null);
    }
  }, [syncTrackToAllPeers]);

  const toggleScreenShare = useCallback(async () => {
    if (activeRoomRef.current?.access === "VIEWER") return;
    setMediaError("");
    if (screenSharing || localScreenStreamRef.current) {
      await stopScreenShareInternal();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const msg = t("meeting.mediaUnsupported");
      setMediaError(msg);
      addToast(msg, "error");
      return;
    }
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0] ?? null;
      if (!screenTrack) return;
      localScreenStreamRef.current = screenStream;
      screenTrack.onended = () => {
        void stopScreenShareInternal();
      };
      setScreenSharing(true);
      setLocalVideoStream(screenStream);
      await syncTrackToAllPeers("video", screenTrack, screenStream);
    } catch {
      const msg = t("meeting.mediaPermissionDenied");
      setMediaError(msg);
      addToast(msg, "error");
    }
  }, [screenSharing, stopScreenShareInternal, syncTrackToAllPeers, t, addToast]);

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
        headers: authHeaders(),
        body: JSON.stringify({
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t("profile.passwordUpdateFailed"));
      if (body.token) {
        localStorage.setItem("bifrost_token", body.token);
        setToken(body.token);
      }
      if (body.refreshToken) {
        localStorage.setItem("bifrost_refresh_token", body.refreshToken);
      }
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
    if(navigate) changeRoute({workspaceId:targetRoom.workspaceId,roomId:targetRoom.id,tab:'meeting'});
    activeRoomRef.current = targetRoom;
    setCurrentRoom(targetRoom);
    setRoomError("");
    setSessionStatus({ kind: "connectingSignaling" });
    setMessages([]);
    setSharedNotes({});
    setOnlinePeers([]);
    setPeersCount(0);
    setActiveTab("meeting");
    setIsSidebarOpen(false);

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

  const sendMessage = useCallback((draftText: string): boolean => {
    if (activeRoomRef.current?.access === 'VIEWER') return false;
    const payload = createChatOutboundPayload(memberNameRef.current, t("chat.you"), draftText, Date.now(), userId);
    if (!payload) return false;
    const openConnections = openConnectionCount(channelsRef.current.values());
    if (!canSendToRoom(false, payload.envelope.body, openConnections)) {
      setChatError(t('chat.noRecipients'));
      return false;
    }
    try {
      broadcast(payload.envelope);
    } catch {
      setChatError(t('chat.sendFailed'));
      return false;
    }
    setChatError('');
    chatAtBottomRef.current = true;
    addMessage(payload.localMessage);
    return true;
  }, [broadcast, addMessage, t, userId]);

  const handleNoteContentChange = useCallback((body: string, updatedAt: number) => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    noteTextRef.current = body;
    noteUpdatedAtRef.current = updatedAt;
    const openConnections = openConnectionCount(channelsRef.current.values());
    const envelope = buildNoteUpdateEnvelope({
      noteShared: noteSharedRef.current,
      roomReadOnly: false,
      openConnections,
      author: memberNameRef.current,
      body,
      updatedAt,
    });
    if (!envelope) return;
    try {
      broadcast(envelope);
      if (noteErrorRef.current) applyNoteError('');
    } catch {
      applyNoteError(t('note.syncFailed'));
    }
  }, [broadcast, applyNoteError, t]);

  const toggleNoteSharing = useCallback(() => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    const openConnections = openConnectionCount(channelsRef.current.values());
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
      return;
    }
    if (openConnections === 0) return;
    const syncTs = noteUpdatedAtRef.current ?? Date.now();
    try {
      broadcast({
        type: "note:shared",
        author: memberNameRef.current,
        body: noteTextRef.current,
        updatedAt: syncTs,
      });
    } catch {
      applyNoteError(t('note.syncFailed'));
      return;
    }
    noteUpdatedAtRef.current = syncTs;
    applyNoteError('');
    noteSharedRef.current = true;
    setNoteShared(true);
  }, [broadcast, applyNoteError, clearNoteResyncTimer, t]);

  const retryNoteSync = useCallback(() => {
    if (activeRoomRef.current?.access === 'VIEWER' || !noteSharedRef.current) return;
    const openConnections = openConnectionCount(channelsRef.current.values());
    if (openConnections === 0) return;
    const syncTs = noteUpdatedAtRef.current ?? Date.now();
    setNoteResyncing(true);
    clearNoteResyncTimer();
    try {
      broadcast({
        type: "note:shared",
        author: memberNameRef.current,
        body: noteTextRef.current,
        updatedAt: syncTs,
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
        onName={setAuthName} onEmail={setAuthEmail} onPassword={setAuthPassword}
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

      {/* ===================================================================
          1. LEFT SIDEBAR
          =================================================================== */}
      <aside id="app-sidebar" inert={!sidebarVisible} aria-label={t("sidebar.workspace")} className={`app-sidebar ${isSidebarOpen ? "open" : ""}`}>
        {/* Brand Header */}
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

        {/* Workspace Switcher Card */}
        <div className="sidebar-workspace">
          <div className="sidebar-workspace-head">
            <span className="sidebar-section-title">{t("workspace.shortLabel")}</span>
            <div className="sidebar-workspace-actions">
              {selectedWorkspace?.role === "OWNER" && (
                <button
                  type="button"
                  className="workspace-manage-btn"
                  data-workspace-manage
                  disabled={workspaceLoading || workspaceSubmitting}
                  onClick={() => openEditWorkspaceModal(selectedWorkspace)}
                  title={t("workspace.manageWorkspaceAria", { name: selectedWorkspace.name })}
                  aria-label={t("workspace.manageWorkspaceAria", { name: selectedWorkspace.name })}
                >
                  <Settings2 size={14} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="sidebar-add-ws-btn"
                disabled={workspaceLoading || workspaceSubmitting}
                onClick={openWorkspaceForm}
                title={t("sidebar.newWorkspace")}
                aria-label={t("sidebar.newWorkspace")}
              >
                <FolderPlus size={16} aria-hidden="true" />
                <span>{t("workspace.newShortButton")}</span>
              </button>
            </div>
          </div>
          <div
            className="sidebar-workspace-picker-wrap"
            onMouseEnter={(event) =>
              showRailTip(
                event.currentTarget,
                selectedWorkspace
                  ? `${selectedWorkspace.name} · ${selectedWorkspace.role === "OWNER" ? t("workspace.ownerBadge") : t("workspace.memberBadge")}`
                  : breadcrumbWsText
              )
            }
            onMouseLeave={hideRailTip}
            onFocusCapture={(event) => {
              if ((event.target as HTMLElement).classList.contains("select-menu-trigger")) {
                showRailTip(
                  event.currentTarget,
                  selectedWorkspace
                    ? `${selectedWorkspace.name} · ${selectedWorkspace.role === "OWNER" ? t("workspace.ownerBadge") : t("workspace.memberBadge")}`
                    : breadcrumbWsText
                );
              } else {
                hideRailTip();
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

        {/* Navigation & Rooms list */}
        <nav
          className="sidebar-nav"
          aria-label={t("workspace.navigationAria")}
        >
          <ul className="sidebar-menu-list sidebar-primary-list">
            {/* Dashboard Link */}
            <li>
              <button
                type="button"
                className={`sidebar-nav-item ${!currentRoom ? "active" : ""}`}
                aria-current={!currentRoom ? "page" : undefined}
                aria-label={t("sidebar.dashboard")}
                title={t("sidebar.dashboard")}
                onMouseEnter={(event) => showRailTip(event.currentTarget, t("sidebar.dashboard"))}
                onMouseLeave={hideRailTip}
                onFocus={(event) => showRailTip(event.currentTarget, t("sidebar.dashboard"))}
                onBlur={hideRailTip}
                onClick={() => {
                  hideRailTip();
                  if (currentRoom) leaveRoom();
                  setIsSidebarOpen(false);
                }}
              >
                <LayoutDashboard size={15} aria-hidden="true" />
                <span>{t("sidebar.dashboard")}</span>
              </button>
            </li>

          </ul>

          <div className="sidebar-nav-divider" role="separator" />

          <div className="sidebar-section-header">
            <span className="sidebar-section-title">{t("sidebar.rooms")}</span>
            {selectedWorkspace?.role === "OWNER" && (
              <button
                type="button"
                className="sidebar-action-btn"
                disabled={sidebarRoomsPending || roomSubmitting}
                onClick={openRoomForm}
                title={t("sidebar.newRoom")}
                aria-label={t("sidebar.newRoom")}
                onMouseEnter={(event) => showRailTip(event.currentTarget, t("sidebar.newRoom"))}
                onMouseLeave={hideRailTip}
                onFocus={(event) => showRailTip(event.currentTarget, t("sidebar.newRoom"))}
                onBlur={hideRailTip}
              >
                <Video size={16} aria-hidden="true" />
                <span className="sidebar-action-label">{t("sidebar.newRoomShortButton")}</span>
              </button>
            )}
          </div>

          <div className="sidebar-rooms-scroll" onScroll={hideRailTip}>
            <ul className="sidebar-menu-list sidebar-room-list">
              {sidebarRoomsPending ? (
                <li
                  className="sidebar-empty-note sidebar-rooms-pending"
                  aria-busy="true"
                  data-skeleton-visible={showSidebarRoomsSkeleton ? "true" : "false"}
                >
                  {showSidebarRoomsSkeleton && (
                    <>
                      <span className="sr-only" role="status">{t("room.loading")}</span>
                      <div className="sidebar-room-skeletons" aria-hidden="true">
                        <span className="sidebar-room-skel-row workspace-skeleton-block" />
                        <span className="sidebar-room-skel-row workspace-skeleton-block" />
                      </div>
                    </>
                  )}
                </li>
              ) : workspaceLoadError && !selectedWorkspace ? (
                <li className="sidebar-empty-note">
                  <span>{t("workspace.unavailableMessage")}</span>
                </li>
              ) : !selectedWorkspace ? (
                <li className="sidebar-empty-note">
                  {t("workspace.createToAddRooms")}
                </li>
              ) : roomLoadError ? (
                <li className="sidebar-empty-note sidebar-error-note" role="alert">
                  <span>{t("room.loadFailed")}</span>
                  <button type="button" className="sidebar-inline-retry" onClick={retryRooms}>
                    <RotateCcw size={12} aria-hidden="true" />
                    <span>{t("common.retry")}</span>
                  </button>
                </li>
              ) : rooms.length === 0 ? (
                <li className="sidebar-empty-note">{t("dashboard.noRooms")}</li>
              ) : (
                rooms.map((room) => {
                  const isActive = currentRoom?.id === room.id;
                  const isUnassigned = room.access === null;
                  const isHost = room.access === 'HOST' || (room.hostId !== null && room.hostId === user.id);
                  const isViewer = room.access === 'VIEWER';
                  const liveCount = isActive
                    ? Math.max(roomOnlineCounts[room.id] ?? 0, onlinePeers.length)
                    : (roomOnlineCounts[room.id] ?? 0);
                  const roomLabel = isUnassigned ? `${room.name} — ${unassignedRoomLabel}` : room.name;
                  return (
                    <li
                      key={room.id}
                      className="sidebar-room-item"
                      onMouseEnter={(event) => showRailTip(event.currentTarget, roomLabel)}
                      onMouseLeave={hideRailTip}
                    >
                      <button
                        type="button"
                        className={`sidebar-nav-item ${isActive ? "active" : ""}`}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={roomLabel}
                        disabled={isUnassigned}
                        onClick={() => {
                          hideRailTip();
                          joinRoom(room);
                        }}
                        onFocus={(event) => showRailTip(event.currentTarget, roomLabel)}
                        onBlur={hideRailTip}
                        title={roomLabel}
                      >
                        <span className="room-nav-bullet" aria-hidden="true" />
                        <span className="room-mini-name" aria-hidden="true">{roomInitials(room.name)}</span>
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
                  );
                })
              )}
            </ul>
          </div>
        </nav>

        {/* Sidebar Footer: Clean profile row */}
        <div
          className="sidebar-footer"
          onMouseEnter={(event) =>
            showRailTip(
              event.currentTarget,
              `${user.name} · ${t("account.openMenuAria")}`
            )
          }
          onMouseLeave={hideRailTip}
          onFocusCapture={(event) => {
            if ((event.target as HTMLElement).classList.contains("account-trigger")) {
              showRailTip(
                event.currentTarget,
                `${user.name} · ${t("account.openMenuAria")}`
              );
            } else {
              hideRailTip();
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

      {/* ===================================================================
          2. MAIN CONTENT AREA
          =================================================================== */}
      <div className="app-main" inert={compactLayout && isSidebarOpen}>
        {/* Global App Header */}
        <header className="app-header">
          <div className="header-left">
            <span className={`sidebar-brand-slot ${compactLayout && !sidebarVisible ? 'is-visible' : ''}`}>
            <button
              type="button"
              className="sidebar-brand-toggle"
              onClick={toggleSidebar}
              aria-controls="app-sidebar"
              aria-label={t("sidebar.expand")}
              aria-expanded={sidebarVisible}
              title={t("sidebar.expand")}
              aria-hidden={!compactLayout || sidebarVisible}
              tabIndex={compactLayout && !sidebarVisible ? 0 : -1}
            >
              <BifrostMark size={28} />
            </button>
            </span>
            <nav
              className="header-breadcrumb"
              aria-label={t("dashboard.breadcrumbAria")}
            >
              {currentRoom ? (
                <button
                  type="button"
                  className="breadcrumb-ws breadcrumb-link"
                  onClick={() => leaveRoom()}
                  title={`${selectedWorkspace?.name || t("workspace.title")} — ${t("sidebar.dashboard")}`}
                >
                  <ChevronLeft size={14} className="breadcrumb-back-icon" aria-hidden="true" />
                  <span className="truncate">{selectedWorkspace?.name || t("workspace.title")}</span>
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
                title={currentRoom ? currentRoom.name : t("sidebar.dashboard")}
              >
                {currentRoom ? currentRoom.name : t("sidebar.dashboard")}
              </span>
            </nav>
          </div>

          <div className="header-right">
            {/* Invite Member button (Owner only, in Dashboard) */}
            {selectedWorkspace?.role === "OWNER" && !currentRoom && (
              <button
                type="button"
                className="btn btn-sm btn-outline-header"
                onClick={openInviteForm}
                title={t("workspace.inviteButton")}
              >
                <UserPlus size={14} aria-hidden="true" />
                <span>{t("workspace.inviteButton")}</span>
              </button>
            )}

            {/* When in Active Room */}
            {currentRoom && (
              <>
                <div className="header-room-context">
                  {/* Realtime Session Status Pill */}
                  <div
                    className={`p2p-status-pill tone-${statusDisplay.tone}`}
                    role="status"
                    title={statusDisplay.label}
                  >
                    <span className="status-dot" aria-hidden="true" />
                    <span className="truncate">{statusDisplay.label}</span>
                  </div>

                  {/* Avatar Stack */}
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
                      <div
                        className="stacked-avatar stacked-avatar-more"
                        title={onlineSummaryLabel}
                      >
                        +{onlinePeers.length - 3}
                      </div>
                    )}
                  </div>

                  {/* Right Contextual Panel Toggle */}
                  <button
                    type="button"
                    className={`btn-icon header-info-btn ${isRightPanelOpen ? "active" : ""}`}
                    onClick={() => setIsRightPanelOpen((value) => !value)}
                    aria-controls="room-right-panel"
                    aria-expanded={isRightPanelOpen}
                    title={t("rightPanel.toggle")}
                    aria-label={t("rightPanel.toggle")}
                  >
                    {isRightPanelOpen ? (
                      <PanelRightClose size={16} aria-hidden="true" />
                    ) : (
                      <PanelRightOpen size={16} aria-hidden="true" />
                    )}
                  </button>
                </div>

                <span className="header-divider" aria-hidden="true" />

                {/* Leave Room Button */}
                <button
                  type="button"
                  className="btn header-leave-btn"
                  onClick={() => leaveRoom()}
                  title={t("room.leaveButton")}
                >
                  <LogOut size={14} aria-hidden="true" />
                  <span>{t("room.leaveButton")}</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Body Container */}
        <div className="app-content-body">
          {/* -------------------------------------------------------------
              VIEW A: DASHBOARD VIEW (WHEN NO ACTIVE ROOM)
              ------------------------------------------------------------- */}
          {!currentRoom ? (
            <main className="dashboard-view">
              <div className="dashboard-container">
                {routeUnavailable ? <section className="workspace-async-state" role="alert"><h1>{t('room.openErrorTitle')}</h1><p>{t('room.openErrorDesc')}</p><button type="button" className="btn btn-secondary" onClick={()=>handleWorkspaceChange(selectedWorkspaceId)}>{t('room.backToRooms')}</button></section> : workspaceLoadError ? <section className="workspace-async-state" role="alert"><h1>{t('workspace.loadFailed')}</h1><button type="button" className="btn btn-secondary" onClick={retryWorkspaces}>{t('workspace.switcherTryAgain')}</button></section> : workspaceLoading ? (
                  <section
                    className="workspace-loading-stage"
                    aria-busy="true"
                    data-skeleton-visible={showWorkspaceSkeleton ? "true" : "false"}
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
                ) : <>
                <div className="workspace-page-meta"><span>{t('dashboard.eyebrowWorkspace')}</span><span>{t('dashboard.eyebrowOverview')}</span></div>
                <div className="workspace-overview">
                  <div className="dashboard-hero">
                    <p className="workspace-greeting">{t('dashboard.greeting', { name: user.name })}</p>
                    <h1 className="hero-greeting">{selectedWorkspace?.name || t('dashboard.heroWorkspaceFallbackTitle')}</h1>
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
                        <span>{selectedWorkspace.role === 'OWNER' ? t('workspace.ownerBadge') : t('workspace.memberBadge')}</span>
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
                        {roomLoadError
                          ? t('dashboard.roomLoadErrorEyebrow')
                          : t('dashboard.eyebrowGetStarted')}
                      </span>
                      {roomLoadError ? (
                        <>
                          <h2>{t('dashboard.roomLoadErrorMessage')}</h2>
                          <p>{roomLoadError}</p>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={retryRooms}
                          >
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
                          <h2>{selectedWorkspace ? t('dashboard.createFirstRoomHeading') : t('dashboard.startSharedSpaceHeading')}</h2>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => selectedWorkspace ? openRoomForm() : openWorkspaceForm()}
                            disabled={!!selectedWorkspace && selectedWorkspace.role !== 'OWNER'}
                          >
                            <Plus size={16} aria-hidden="true" />
                            <span>{selectedWorkspace ? t('room.createButton') : t('workspace.createButton')}</span>
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
                    <div><span>01</span><h2>{t('workspace.createButton')}</h2><p>{t('dashboard.setupCardDesc')}</p></div>
                    <div><span>02</span><h2>{t('dashboard.createRoomCardTitle')}</h2><p>{t('dashboard.createRoomCardDesc')}</p></div>
                    <div><span>03</span><h2>{t('dashboard.inviteCardTitle')}</h2><p>{t('dashboard.inviteCardDesc')}</p></div>
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
                        data-skeleton-visible={showRoomsSkeleton ? "true" : "false"}
                      >
                        {showRoomsSkeleton && (
                          <>
                            <span className="sr-only" role="status">{t('room.loading')}</span>
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
                    ) : (() => {
                      const normalizedRoomQuery = searchKey(roomSearch);
                      const filteredRooms = normalizedRoomQuery
                        ? rooms.filter((room) =>
                            searchKey(`${room.name} ${room.description ?? ''} ${room.host?.name ?? ''}`).includes(normalizedRoomQuery)
                          )
                        : rooms;
                      return (
                        <div className="workspace-room-list">
                          <div className="workspace-room-list-head" aria-hidden="true">
                            <span>{t('dashboard.roomsSummaryHeading')}</span>
                            <span>{t('dashboard.hostColumnHeading')}</span>
                            <span>↗</span>
                          </div>
                          {filteredRooms.map((room, index) => {
                            const isHost = room.access === 'HOST' || (room.hostId !== null && room.hostId === user.id);
                            const isModerator = room.access === 'MODERATOR';
                            const isViewer = room.access === 'VIEWER';
                            const isUnassigned = room.access === null;
                            return (
                            <article key={room.id} className="workspace-room-row">
                              <span className="workspace-room-number">{(index + 1).toString().padStart(2, '0')}</span>
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
                                  <span className="workspace-room-host-empty" aria-hidden="true">—</span>
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
                                      lastManagedRoomIdRef.current = room.id;
                                      openEditRoomModal(room);
                                    }}
                                  >
                                    <Settings2 size={15} aria-hidden="true" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="room-enter-btn"
                                  disabled={room.access === null}
                                  title={room.access === null ? t("sidebar.notAssignedBadge") : undefined}
                                  onClick={() => joinRoom(room)}
                                  aria-label={t('dashboard.enterNamedRoomAria', { name: room.name })}
                                >
                                  <span>{t('dashboard.enterRoom')}</span>
                                  <ArrowRight size={20} aria-hidden="true" />
                                </button>
                              </div>
                            </article>
                          )})}
                          {normalizedRoomQuery && filteredRooms.length === 0 && (
                            <div className="workspace-search-empty" role="status">
                              <p>{t('dashboard.noMatchingRooms')}</p>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  setRoomSearch('');
                                  requestAnimationFrame(() => roomSearchRef.current?.focus());
                                }}
                              >
                                {t('dashboard.clearFilter')}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
                </>}
              </div>
            </main>
          ) : (
            /* -------------------------------------------------------------
               VIEW B: ACTIVE ROOM SCREEN (TAB NAVIGATION & SPLIT LAYOUT)
               ------------------------------------------------------------- */
            <div className="room-screen">
              {roomReadOnly && <p className="room-readonly-notice" role="status">{t('room.readOnlyModeBanner')}</p>}
              <div className="room-session-heading">
                <div className="room-session-title-group">
                  <div className="room-editorial-kicker">
                    <span className="workspace-section-index">{t('room.eyebrow')}</span>
                    <span className="room-kicker-divider" aria-hidden="true">·</span>
                    <span className="room-kicker-coord" aria-hidden="true">B / 001</span>
                    <span className="room-kicker-motif" lang="ja" aria-hidden="true">折り目の向こうで、出会う。</span>
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
              {roomError && <div className="form-error" style={{ margin: "12px 16px 0" }}>{roomError}</div>}
              {/* Room Navigation Tabs */}
              <div
                ref={roomTabsRef}
                className="room-tabs-nav"
                role="tablist"
                aria-orientation="horizontal"
                aria-label={t('room.sectionsNavAria')}
              >
                {[
                  { id: "meeting" as const, icon: <Video size={16} />, label: t("tabs.meeting") },
                  { id: "board" as const, icon: <Columns3 size={15} />, label: t("tabs.meetingBoard") },
                  {
                    id: "chat" as const,
                    icon: <MessageSquare size={16} />,
                    label: t("tabs.chat"),
                    badge: messages.length > 0 ? <span className="tag-status">({messages.length})</span> : null,
                  },
                  { id: "notes" as const, icon: <FileText size={16} />, label: t("tabs.notes") },
                  { id: "files" as const, icon: <FolderUp size={16} />, label: t("tabs.files") },
                ].map((tabItem) => {
                  const selected = activeTab === tabItem.id;
                  return (
                    <button
                      key={tabItem.id}
                      ref={(el) => { roomTabButtonRefs.current[tabItem.id] = el; }}
                      type="button"
                      role="tab"
                      id={roomTabElementId(tabItem.id)}
                      aria-selected={selected}
                      aria-controls={roomPanelElementId(tabItem.id)}
                      tabIndex={roomTabTabIndex(tabItem.id, activeTab)}
                      className={`room-tab-btn ${selected ? "active" : ""}`}
                      onClick={() => selectTab(tabItem.id)}
                      onKeyDown={(event) => handleRoomTabKeyDown(tabItem.id, event)}
                    >
                      {tabItem.icon}
                      <span>{tabItem.label}</span>
                      {tabItem.badge}
                    </button>
                  );
                })}
                <span className="room-tab-indicator" aria-hidden="true" />
              </div>

              {/* Room Split Body: Tabs Viewport + Right Contextual Panel */}
              <div className="room-content-split">
                {/* Tabs Viewport (All 5 panes permanently mounted for zero state loss) */}
                <div className="room-tabs-viewport" inert={compactLayout && isRightPanelOpen}>
                  {/* PANE 1: MEETING */}
                  <div {...roomTabPanelProps("meeting")}>
                    <MeetingTab
                      readOnly={roomReadOnly}
                      currentUserId={user.id}
                      currentUserName={user.name}
                      currentUserAvatar={user.profile?.avatarDataUrl}
                      roomName={currentRoom.name}
                      onlinePeers={onlinePeers}
                      micEnabled={micEnabled}
                      camEnabled={camEnabled}
                      screenSharing={screenSharing}
                      mediaError={mediaError}
                      localVideoStream={localVideoStream}
                      remoteStreams={remoteStreams}
                      onToggleMic={() => void toggleMic()}
                      onToggleCam={() => void toggleCam()}
                      onToggleScreenShare={() => void toggleScreenShare()}
                      onLeaveRoom={leaveRoom}
                      onCopyRoomId={handleCopyCurrentRoomId}
                      copiedRoomId={copiedRoomId}
                      onInvite={selectedWorkspace?.role === 'OWNER' ? openInviteForm : undefined}
                      t={t}
                    />
                  </div>

                    {/* PANE 2: MEETING BOARD */}
                    <div {...roomTabPanelProps("board")}>
                      <MeetingBoard readOnly={roomReadOnly}
                        key={`${user.id}:${currentRoom.workspaceId}:${currentRoom.id}`}
                        currentUser={memoCurrentUser ?? { id: user.id, name: user.name, email: user.email }}
                        workspaceId={currentRoom.workspaceId}
                        roomId={currentRoom.id}
                        broadcast={broadcast}
                        sendDirectToPeer={sendDirectToBoardPeer}
                        registerMessageHandler={registerMeetingBoardMessageHandler}
                        registerPeerConnectHandler={registerMeetingBoardPeerConnectHandler}
                        lang={lang}
                        addToast={addToast}
                      />
                    </div>

                    {/* PANE 3: CHAT */}
                    <div {...roomTabPanelProps("chat")} tabIndex={roomReadOnly ? 0 : undefined}>
                      <ChatPane
                        scopeKey={roomDraftKey(user.id, currentRoom.workspaceId, currentRoom.id)}
                        roomName={currentRoom.name}
                        roomReadOnly={roomReadOnly}
                        peersCount={peersCount}
                        messages={messages}
                        chatError={chatError}
                        messagesHeading={t('chat.messagesHeading')}
                        noRecipientsLabel={t('chat.noRecipients')}
                        chatLogRef={chatLogRef}
                        onChatScroll={handleChatScroll}
                        lang={lang}
                        t={t}
                        onSendMessage={sendMessage}
                      />
                    </div>

                    {/* PANE 4: NOTES */}
                    <div {...roomTabPanelProps("notes")}>
                      <NotesPane
                        scopeKey={roomDraftKey(user.id, currentRoom.workspaceId, currentRoom.id)}
                        roomName={currentRoom.name}
                        roomReadOnly={roomReadOnly}
                        noteShared={noteShared}
                        noteShareStatus={noteShareStatus}
                        peersCount={peersCount}
                        noteError={noteError}
                        sharedNotes={sharedNotes}
                        lang={lang}
                        t={t}
                        onToggleNoteSharing={toggleNoteSharing}
                        onRetryNoteSync={retryNoteSync}
                        onNoteContentChange={handleNoteContentChange}
                        onSuccessToast={handleSuccessToast}
                        onErrorToast={handleErrorToast}
                      />
                    </div>

                    {/* PANE 5: FILES */}
                    <div {...roomTabPanelProps("files")} ref={filesPanelRef}>
                      <FileShare readOnly={roomReadOnly}
                        key={currentRoom.id}
                        roomId={currentRoom.id}
                        peersCount={peersCount}
                        onlinePeerIds={onlinePeerIds}
                        channelsRef={channelsRef}
                        broadcast={broadcast}
                        sendDirect={sendDirectToFilePeer}
                        registerMessageHandler={registerFileMessageHandler}
                        onSuccessToast={handleSuccessToast}
                        onErrorToast={handleErrorToast}
                        t={t}
                      />
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

                {/* Right Contextual Panel (Collapsible) */}
                  <aside
                    id="room-right-panel"
                    className="right-panel open"
                    aria-label={t("rightPanel.title")}
                  >
                    <div className="right-panel-header">
                      <div className="right-panel-title-group">
                        <span className="right-panel-coord" aria-hidden="true">B / 001</span>
                        <h3>{t("rightPanel.title")}</h3>
                      </div>
                      <button
                        type="button"
                        className="btn-icon right-panel-close-btn"
                        onClick={() => setIsRightPanelOpen(false)}
                        aria-label={t("common.close")}
                        title={t("common.close")}
                      >
                        <PanelRightClose size={16} aria-hidden="true" />
                      </button>
                    </div>

                    <div className="right-panel-body">
                      {/* Room info section */}
                      <div className="right-panel-section">
                        <p className="eyebrow"><span className="eyebrow-num" aria-hidden="true">01 /</span>{t("rightPanel.roomDetails")}</p>
                        <div className="right-panel-info-row">
                          <span>{t("rightPanel.host")}:</span>
                          <strong>{withCurrentUserHost(currentRoom, user).host?.name || t('dashboard.unassignedLabel')}</strong>
                        </div>
                        <div className="right-panel-info-row">
                          <span>{t("rightPanel.created")}:</span>
                          <span>{new Date(currentRoom.createdAt).toLocaleDateString(LOCALE_META[lang].intl)}</span>
                        </div>
                        {currentRoom.description && (
                          <p className="room-card-desc">{currentRoom.description}</p>
                        )}
                        <button
                          type="button"
                          className="copy-id-button"
                          onClick={handleCopyCurrentRoomId}
                        >
                          {copiedRoomId ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                          <span>{copiedRoomId ? t("rightPanel.copied") : t("rightPanel.copyRoomId")}</span>
                        </button>
                        {(selectedWorkspace?.role === "OWNER" ||
                            currentRoom.access === "HOST" ||
                            (currentRoom.hostId !== null && currentRoom.hostId === user.id)) && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm edit-room-panel-btn"
                              onClick={() => openEditRoomModal(currentRoom)}
                            >
                              <Settings2 size={14} aria-hidden="true" />
                              <span>{t("room.editRoomButton")}</span>
                            </button>
                          )}
                      </div>

                      {/* Online Members section */}
                      <div className="right-panel-section">
                        <p className="eyebrow"><span className="eyebrow-num" aria-hidden="true">02 /</span>{t("rightPanel.onlineMembers", { count: onlinePeers.length })}</p>
                        <p className="right-panel-presence-scope">
                          {isDevMockSession(token)
                            ? t("rightPanel.localPreviewBadge")
                            : t("rightPanel.verifiedPeersHint")}
                        </p>
                        {onlinePeers.length === 0 ? (
                          <p className="peer-empty-note" role="status">
                            {t("rightPanel.waitingPeersHint")}
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
                                    {peer.userId === user.id ? user.name : peer.name} {peer.userId === user.id ? `(${t("meeting.you")})` : ""}
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
                              setIsRightPanelOpen(false);
                              setShowRoomMembersModal(true);
                            }}
                          >
                            <Users size={14} aria-hidden="true" />
                            <span>{t("members.viewWorkspaceMembers")}</span>
                          </button>
                        </div>
                      )}

                      {/* Connection Diagnostics */}
                      <div className="right-panel-section">
                        <p className="eyebrow"><span className="eyebrow-num" aria-hidden="true">03 /</span>{t("rightPanel.connection")}</p>
                        <div
                          className={`p2p-status-pill tone-${
                            peersCount > 0
                              ? "connected"
                              : sessionStatus.kind === "error"
                                ? "error"
                                : sessionStatus.kind === "localPreview"
                                  ? "neutral"
                                  : "pending"
                          }`}
                        >
                          <span className="status-dot" aria-hidden="true" />
                          <span>
                            {peersCount > 0
                              ? t("rightPanel.p2pActive")
                              : sessionStatus.kind === "error"
                                ? statusDisplay.label
                                : sessionStatus.kind === "localPreview"
                                  ? t("rightPanel.localPreviewSignalingHint")
                                  : t("rightPanel.noPeerConnection")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </aside>
                </MotionPresence>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================
          MODALS: PROFILE, CREATE WORKSPACE, CREATE ROOM
          =================================================================== */}

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
            if (discardForm === 'profile') setShowProfileModal(false);
            if (discardForm === 'workspace') { setShowCreateWsModal(false); setWorkspaceName(''); }
            if (discardForm === 'editWorkspace') { setEditingWorkspace(null); setEditWorkspaceError(''); restoreWorkspaceManageFocus(); }
            if (discardForm === 'room') { setShowCreateRoomModal(false); setNewRoomName(''); setNewRoomDesc(''); }
            if (discardForm === 'editRoom') { setEditingRoom(null); setEditRoomError(''); restoreManagedRoomFocus(); }
            if (discardForm === 'invite') { setShowInviteModal(false); setInviteEmail(''); }
            setDiscardForm(null);
          }}
        />
      </MotionPresence>
      <MotionPresence present={!!editingWorkspace && confirmDeleteWorkspace}>
        {editingWorkspace && (
          <ConfirmDialog
            title={t("workspace.deleteConfirmTitle")}
            description={t("workspace.deleteConfirmBody", { name: editingWorkspace.name })}
            cancelLabel={t("common.cancel")}
            confirmLabel={t("workspace.deleteConfirmAction")}
            tone="danger"
            onCancel={() => setConfirmDeleteWorkspace(false)}
            onConfirm={() => void executeDeleteWorkspace()}
          />
        )}
      </MotionPresence>
      <MotionPresence present={!!editingRoom && confirmDeleteRoom}>
        {editingRoom && (
          <ConfirmDialog
            title={t("room.deleteConfirmTitle")}
            description={t("room.deleteConfirmBody", { name: editingRoom.name })}
            cancelLabel={t("common.cancel")}
            confirmLabel={t("room.deleteConfirmAction")}
            tone="danger"
            onCancel={() => setConfirmDeleteRoom(false)}
            onConfirm={() => void executeDeleteRoom()}
          />
        )}
      </MotionPresence>
      {/* Profile Modal */}
      <MotionPresence present={showProfileModal && !discardForm}>
        <div className="modal-overlay" onClick={closeProfileForm}>
          <section
            className="modal-card profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-profile-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="modal-profile-title">{t("profile.modalTitle")}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeProfileForm}
                disabled={profileSaving || profileImageBusy}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={updateProfile} className="form-stack" aria-busy={profileSaving || undefined}>
              <AvatarPicker
                key={`${user.id}:${showProfileModal}:${isDevMockSession(token)}`}
                value={profileAvatar}
                name={profileName}
                color={getAvatarTone(user.id)}
                lang={lang}
                disabled={profileSaving}
                onChange={setProfileAvatar}
                onBusy={setProfileImageBusy}
              />
              <div className="form-field">
                <label htmlFor="modal-profile-name" className="form-field-label">
                  <span>{t("profile.displayName")}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="modal-profile-name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={profileSaving}
                  className="input-text"
                  value={profileName}
                  onChange={(event) => {
                    setProfileName(event.target.value);
                    if (profileMessage) setProfileMessage("");
                  }}
                  aria-invalid={Boolean(profileMessage) || undefined}
                  aria-describedby={profileMessage ? "modal-profile-error" : "modal-profile-hint"}
                />
                <p id="modal-profile-hint" className="form-field-hint">
                  {t("profile.displayNameHint")}
                </p>
              </div>
              {profileMessage && (
                <p id="modal-profile-error" className="form-error" role="alert">
                  {profileMessage}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeProfileForm}
                  disabled={profileSaving || profileImageBusy}
                >
                  {t("common.close")}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={profileSaving || profileImageBusy}
                  aria-busy={profileSaving || undefined}
                >
                  {profileSaving && <span className="btn-spinner" aria-hidden="true" />}
                  <span>
                    {profileSaving ? t("common.saving") : t("profile.saveButton")}
                  </span>
                </button>
              </div>
            </form>
            {!isDevMockSession(token) && (
              <form onSubmit={submitChangePassword} className="form-stack profile-security-form" aria-busy={passwordSaving || undefined}>
                <hr className="modal-section-divider" />
                <p className="eyebrow">{t("profile.securityHeading")}</p>
                <div className="form-field">
                  <label htmlFor="modal-current-password" className="form-field-label">
                    <span>{t("profile.currentPasswordLabel")}</span>
                  </label>
                  <input
                    id="modal-current-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    minLength={8}
                    maxLength={100}
                    disabled={passwordSaving}
                    className="input-text"
                    value={currentPasswordInput}
                    onChange={(event) => setCurrentPasswordInput(event.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="modal-new-password" className="form-field-label">
                    <span>{t("profile.newPasswordLabel")}</span>
                  </label>
                  <input
                    id="modal-new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={100}
                    disabled={passwordSaving}
                    className="input-text"
                    value={newPasswordInput}
                    onChange={(event) => setNewPasswordInput(event.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="modal-confirm-new-password" className="form-field-label">
                    <span>{t("profile.confirmNewPasswordLabel")}</span>
                  </label>
                  <input
                    id="modal-confirm-new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={100}
                    disabled={passwordSaving}
                    className="input-text"
                    value={confirmNewPasswordInput}
                    onChange={(event) => setConfirmNewPasswordInput(event.target.value)}
                  />
                </div>
                {passwordError && (
                  <p className="form-error" role="alert">
                    {passwordError}
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    type="submit"
                    className="btn btn-secondary"
                    disabled={passwordSaving}
                    aria-busy={passwordSaving || undefined}
                  >
                    {passwordSaving && <span className="btn-spinner" aria-hidden="true" />}
                    <span>
                      {passwordSaving ? t("profile.changingPassword") : t("profile.changePasswordButton")}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </MotionPresence>

      {/* Room Workspace Members Modal */}
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
                <h3 id="modal-room-members-title">
                  {t("members.modalTitle")}
                </h3>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setShowRoomMembersModal(false)}
                  aria-label={t("common.close")}
                  title={t("common.close")}
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
                  owner={selectedWorkspace.role === "OWNER"}
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
                    setShowRoomMembersModal(false);
                    openInviteForm();
                  }}
                />
              </div>
              <div className="modal-actions">
                {selectedWorkspace.role === "OWNER" && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowRoomMembersModal(false);
                      openInviteForm();
                    }}
                  >
                    <UserPlus size={14} aria-hidden="true" />
                    <span>{t("members.addMemberButton")}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowRoomMembersModal(false)}
                >
                  {t("common.close")}
                </button>
              </div>
            </section>
          </div>
        )}
      </MotionPresence>

      {/* Create Workspace Modal */}
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
              <h3 id="modal-workspace-title">{t("sidebar.newWorkspace")}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeWorkspaceForm}
                disabled={workspaceSubmitting}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={createWorkspace} className="form-stack" aria-busy={workspaceSubmitting || undefined}>
              <div className="form-field">
                <label htmlFor="modal-workspace-name" className="form-field-label">
                  <span>{t("workspace.nameLabel")}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="modal-workspace-name"
                  autoComplete="organization"
                  required
                  className="input-text"
                  placeholder={t("workspace.newNamePlaceholder")}
                  minLength={3}
                  maxLength={120}
                  disabled={workspaceSubmitting}
                  value={workspaceName}
                  onChange={(event) => {
                    setWorkspaceName(event.target.value);
                    setWorkspaceError("");
                  }}
                  aria-invalid={Boolean(workspaceError) || undefined}
                  aria-describedby={workspaceError ? "modal-workspace-error" : "modal-workspace-hint"}
                />
                <p id="modal-workspace-hint" className="form-field-hint">
                  {t("workspace.nameHint")}
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
                  {t("common.close")}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={workspaceSubmitting}
                  aria-busy={workspaceSubmitting || undefined}
                >
                  {workspaceSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                  <span>
                    {workspaceSubmitting ? t("workspace.creating") : t("workspace.createButton")}
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </MotionPresence>

      {/* Edit / Delete Workspace Modal */}
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
                <h3 id="modal-edit-workspace-title">{t("workspace.editBoxTitle")}</h3>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={closeEditWorkspaceForm}
                  disabled={editWorkspaceSubmitting}
                  aria-label={t("common.close")}
                  title={t("common.close")}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <form onSubmit={submitEditWorkspace} className="form-stack" aria-busy={editWorkspaceSubmitting || undefined}>
                <div className="form-field">
                  <label htmlFor="modal-edit-workspace-name" className="form-field-label">
                    <span>{t("workspace.nameLabel")}</span>
                    <span className="form-required-mark" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="modal-edit-workspace-name"
                    autoComplete="organization"
                    required
                    className="input-text"
                    placeholder={t("workspace.newNamePlaceholder")}
                    minLength={3}
                    maxLength={120}
                    disabled={editWorkspaceSubmitting}
                    value={editWorkspaceName}
                    onChange={(event) => {
                      setEditWorkspaceName(event.target.value);
                      setEditWorkspaceError("");
                    }}
                    aria-invalid={Boolean(editWorkspaceError) || undefined}
                    aria-describedby={editWorkspaceError ? "modal-edit-workspace-error" : "modal-edit-workspace-hint"}
                  />
                  <p id="modal-edit-workspace-hint" className="form-field-hint">
                    {t("workspace.nameHint")}
                  </p>
                </div>
                {editWorkspaceError && (
                  <p id="modal-edit-workspace-error" className="form-error" role="alert">
                    {editWorkspaceError}
                  </p>
                )}
                <div className="room-danger-zone">
                  <div className="room-danger-copy">
                    <strong>{t("workspace.dangerZoneHeading")}</strong>
                    <p>{t("workspace.dangerZoneDesc")}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={editWorkspaceSubmitting}
                    onClick={() => setConfirmDeleteWorkspace(true)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span>{t("workspace.deleteWorkspaceButton")}</span>
                  </button>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeEditWorkspaceForm}
                    disabled={editWorkspaceSubmitting}
                  >
                    {t("common.close")}
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={editWorkspaceSubmitting}
                    aria-busy={editWorkspaceSubmitting || undefined}
                  >
                    {editWorkspaceSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                    <span>{editWorkspaceSubmitting ? t("common.saving") : t("workspace.saveChangesButton")}</span>
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </MotionPresence>

      {/* Create Room Modal */}
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
              <h3 id="modal-room-title">{t("room.createBoxTitle")}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeRoomForm}
                disabled={roomSubmitting}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={createRoom} className="form-stack" aria-busy={roomSubmitting || undefined}>
              <div className="form-field">
                <label htmlFor="modal-room-name" className="form-field-label">
                  <span>{t("room.nameLabel")}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="modal-room-name"
                  autoComplete="off"
                  required
                  className="input-text"
                  placeholder={t("room.namePlaceholder")}
                  minLength={2}
                  maxLength={120}
                  disabled={roomSubmitting}
                  value={newRoomName}
                  onChange={(event) => {
                    setNewRoomName(event.target.value);
                    setRoomMessage("");
                  }}
                  aria-invalid={Boolean(roomMessage) || undefined}
                  aria-describedby={roomMessage ? "modal-room-error" : "modal-room-name-hint"}
                />
                <p id="modal-room-name-hint" className="form-field-hint">
                  {t("room.nameHint")}
                </p>
              </div>
              <div className="form-field">
                <label htmlFor="modal-room-desc" className="form-field-label">
                  <span>{t("room.descLabel")}</span>
                  <span className="form-optional-tag">({t("room.descOptionalTag")})</span>
                </label>
                <input
                  id="modal-room-desc"
                  autoComplete="off"
                  className="input-text"
                  placeholder={t("room.descPlaceholder")}
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
                  {t("common.close")}
                </button>
                <button
                  type="submit"
                  disabled={roomSubmitting}
                  className="btn btn-primary"
                  aria-busy={roomSubmitting || undefined}
                >
                  {roomSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                  <span>{roomSubmitting ? t("workspace.creating") : t("room.createButton")}</span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </MotionPresence>

      {/* Edit / Delete Room Modal */}
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
                <h3 id="modal-edit-room-title">{t("room.editBoxTitle")}</h3>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={closeEditRoomForm}
                  disabled={editRoomSubmitting}
                  aria-label={t("common.close")}
                  title={t("common.close")}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <form onSubmit={submitEditRoom} className="form-stack" aria-busy={editRoomSubmitting || undefined}>
                <div className="form-field">
                  <label htmlFor="modal-edit-room-name" className="form-field-label">
                    <span>{t("room.nameLabel")}</span>
                    <span className="form-required-mark" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="modal-edit-room-name"
                    autoComplete="off"
                    required
                    className="input-text"
                    placeholder={t("room.namePlaceholder")}
                    minLength={2}
                    maxLength={120}
                    disabled={editRoomSubmitting}
                    value={editRoomName}
                    onChange={(event) => {
                      setEditRoomName(event.target.value);
                      setEditRoomError("");
                    }}
                    aria-invalid={Boolean(editRoomError) || undefined}
                    aria-describedby={editRoomError ? "modal-edit-room-error" : "modal-edit-room-name-hint"}
                  />
                  <p id="modal-edit-room-name-hint" className="form-field-hint">
                    {t("room.nameHint")}
                  </p>
                </div>
                <div className="form-field">
                  <label htmlFor="modal-edit-room-desc" className="form-field-label">
                    <span>{t("room.descLabel")}</span>
                    <span className="form-optional-tag">({t("room.descOptionalTag")})</span>
                  </label>
                  <input
                    id="modal-edit-room-desc"
                    autoComplete="off"
                    className="input-text"
                    placeholder={t("room.descPlaceholder")}
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
                {selectedWorkspace?.role === "OWNER" && (
                  <div className="room-danger-zone">
                    <div className="room-danger-copy">
                      <strong>{t("room.dangerZoneHeading")}</strong>
                      <p>{t("room.dangerZoneDesc")}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={editRoomSubmitting}
                      onClick={() => setConfirmDeleteRoom(true)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>{t("room.deleteRoomButton")}</span>
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
                    {t("common.close")}
                  </button>
                  <button
                    type="submit"
                    disabled={editRoomSubmitting}
                    className="btn btn-primary"
                    aria-busy={editRoomSubmitting || undefined}
                  >
                    {editRoomSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                    <span>{editRoomSubmitting ? t("common.saving") : t("room.saveChangesButton")}</span>
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </MotionPresence>

      {/* Invite Member Modal */}
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
              <h3 id="modal-invite-title">{t("workspace.inviteButton")}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeInviteForm}
                disabled={inviteSubmitting}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={inviteMember} className="form-stack" aria-busy={inviteSubmitting || undefined}>
              <div className="form-field">
                <label htmlFor="modal-invite-email" className="form-field-label">
                  <span>{t("workspace.inviteEmailLabel")}</span>
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
                  placeholder={t("workspace.invitePlaceholder")}
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setInviteError("");
                  }}
                  disabled={inviteSubmitting}
                  aria-invalid={Boolean(inviteError) || undefined}
                  aria-describedby={inviteError ? "modal-invite-error" : "modal-invite-hint"}
                />
                <p id="modal-invite-hint" className="form-field-hint">
                  {t("workspace.inviteEmailHint")}
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
                  {t("common.close")}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={inviteSubmitting}
                  aria-busy={inviteSubmitting || undefined}
                >
                  {inviteSubmitting && <span className="btn-spinner" aria-hidden="true" />}
                  <span>
                    {inviteSubmitting ? t("workspace.inviting") : t("workspace.inviteButton")}
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      </MotionPresence>
    </div>
  );
}

export default App;
