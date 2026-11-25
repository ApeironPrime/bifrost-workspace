import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { io, type Socket } from 'socket.io-client';
import type * as Y from 'yjs';
import { apiUrl, fetchAppApi, isDevMockSession, SIGNALING_URL } from '../../../lib/appApi';
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
} from '../../../lib/chatNotes';
import {
  CrdtRoomController,
  decodeRelativeCursor,
  encodeRelativeCursor,
  type CrdtDataEnvelope,
  type RemoteCrdtCursor,
} from '../../../lib/crdtCollabDoc';
import { BUFFERED_LOW_THRESHOLD } from '../../../lib/fileTransfer';
import { HybridLogicalClock, isIncomingNewer } from '../../../lib/hlc';
import {
  createRoomIceManager,
  inspectPeerSelectedCandidateType,
  shouldRestartPeerForIceRenewal,
  updatePeerIceServersSafely,
  type IceConfigSnapshot,
  type RoomIceManager,
} from '../../../lib/iceConfig';
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
} from '../../../lib/peerIdentity';
import {
  clearPeerSignalingRecord,
  createPeerSignalingRecord,
  handleIncomingAnswer,
  handleIncomingIceCandidate,
  handleIncomingOffer,
  handlePeerConnectionStateTransition,
  negotiatePeerOffer,
  type PeerSignalingRecord,
} from '../../../lib/peerSignaling';
import { canComposeRoomMessage, openConnectionCount } from '../../../lib/roomControls';
import type { RoomTabId } from '../../../lib/roomTabs';
import {
  readRoomDraft,
  readRoomNoteUpdatedAt,
  roomDraftKey,
  type BoardState,
  type WorkspaceRoute,
} from '../../../lib/roomUiState';
import type { SessionStatus } from '../../../lib/shellState';
import type { I18nKey } from '../../../i18n';
import type { ToastType } from '../../../shared/components/Toast';
import type { PresencePeer, Room, User, Workspace } from '../../../types/workspace';
import { type FileShareMessage } from '../components/FileShare';
import { type MeetingBoardMessage } from '../components/MeetingBoard';
import { useRoomMedia } from './useRoomMedia';

type ChatMessage = ChatMessageItem;
type SharedNote = SharedNoteItem;

const EMPTY_USER_IDS = new Set<string>();

export interface UseWebRtcRoomEngineOptions {
  user: User | null;
  userId: string;
  token: string;
  tokenRef: MutableRefObject<string>;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  handleErrorToast: (message: string) => void;
  currentRoom: Room | null;
  setCurrentRoom: React.Dispatch<React.SetStateAction<Room | null>>;
  sharedActiveRoomRef: MutableRefObject<Room | null>;
  peersCount: number;
  setPeersCount: React.Dispatch<React.SetStateAction<number>>;
  selectedWorkspaceId: string;
  selectedWorkspaceIdRef: MutableRefObject<string>;
  setSelectedWorkspaceId: (id: string) => void;
  workspacesRef: MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setWorkspaceRetry: React.Dispatch<React.SetStateAction<number>>;
  workspaceMemberRosterRef: MutableRefObject<{
    workspaceId: string;
    source?: string;
    members: WorkspaceMemberAccessRecord[];
  } | null>;
  refreshWorkspaceMemberRoster: (workspaceId: string, signal?: AbortSignal) => Promise<void>;
  activeTab: RoomTabId;
  setActiveTab: (tab: RoomTabId) => void;
  changeRoute: (route: WorkspaceRoute, replace?: boolean) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setIsRightPanelOpen: (open: boolean) => void;
  setShowRoomMembersModal: (open: boolean) => void;
  hideRailTip: () => void;
  setRooms: React.Dispatch<React.SetStateAction<Room[]>>;
  setRoomsLoadedFor: React.Dispatch<React.SetStateAction<string>>;
  setRoomLoadError: React.Dispatch<React.SetStateAction<string>>;
  onUnauthorizedSession: () => void;
}

export function useWebRtcRoomEngine({
  user,
  userId,
  token,
  tokenRef,
  t,
  addToast,
  handleErrorToast,
  currentRoom,
  setCurrentRoom,
  sharedActiveRoomRef,
  peersCount,
  setPeersCount,
  selectedWorkspaceId,
  selectedWorkspaceIdRef,
  setSelectedWorkspaceId,
  workspacesRef,
  setWorkspaces,
  setWorkspaceRetry,
  workspaceMemberRosterRef,
  refreshWorkspaceMemberRoster,
  activeTab,
  setActiveTab,
  changeRoute,
  setIsSidebarOpen,
  setIsRightPanelOpen,
  setShowRoomMembersModal,
  hideRailTip,
  setRooms,
  setRoomsLoadedFor,
  setRoomLoadError,
  onUnauthorizedSession,
}: UseWebRtcRoomEngineOptions) {
  const [roomError, setRoomError] = useState('');
  const [roomOnlineCounts, setRoomOnlineCounts] = useState<Record<string, number>>({});
  const [copiedRoomId, setCopiedRoomId] = useState(false);

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>({ kind: 'idle' });
  const [onlinePeers, setOnlinePeers] = useState<PresencePeer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cloudBoard, setCloudBoard] = useState<{ data: BoardState; version: number } | null>(null);
  const [hydratedNote, setHydratedNote] = useState<{ body: string; updatedAt?: number; version: number } | null>(null);
  const [noteShared, setNoteShared] = useState(false);
  const [noteResyncing, setNoteResyncing] = useState(false);
  const [sharedNotes, setSharedNotes] = useState<Record<string, SharedNote>>({});

  // Yjs CRDT collaborative document & remote cursor states
  const crdtControllerRef = useRef<CrdtRoomController | null>(null);
  const [crdtText, setCrdtText] = useState('');
  const [crdtYText, setCrdtYText] = useState<Y.Text | null>(null);
  const [crdtCursors, setCrdtCursors] = useState<Record<string, RemoteCrdtCursor>>({});
  const crdtCursorsList = useMemo(() => Object.values(crdtCursors), [crdtCursors]);

  // Socket & WebRTC Refs (Map-based for O(1) lookup and compatibility with useRoomMedia & FileShare)
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const channelsRef = useRef(new Map<string, RTCDataChannel>());
  const peerSignalingRef = useRef(new Map<string, PeerSignalingRecord>());
  const peerCreatePromisesRef = useRef(new Map<string, Promise<void>>());
  const iceManagerRef = useRef<RoomIceManager | null>(null);
  const onTurnCredentialsRefreshedRef = useRef<(snapshot: IceConfigSnapshot, generation: number) => Promise<void>>(
    async () => {},
  );
  const onTurnUnauthorizedRef = useRef<() => void>(() => {});
  const memberNameRef = useRef(user?.name || '');
  const activeRoomRef = useRef<Room | null>(null);
  const noteTextRef = useRef('');
  const noteUpdatedAtRef = useRef<number | undefined>(undefined);
  const noteSharedRef = useRef(false);
  const noteResyncTimerRef = useRef<number | null>(null);
  const onlinePeersRef = useRef<PresencePeer[]>([]);
  const verifiedPeersRef = useRef<Map<string, VerifiedPeerIdentity>>(new Map());
  const localPeerIdRef = useRef<string | null>(null);

  const chatLogRef = useRef<HTMLDivElement>(null);
  const chatAtBottomRef = useRef(true);
  const [chatError, setChatError] = useState('');
  const [noteError, setNoteError] = useState('');
  const noteErrorRef = useRef('');
  const userIdRef = useRef(userId);
  const messagesRef = useRef<ChatMessage[]>([]);
  const hlcRef = useRef(new HybridLogicalClock('anon'));
  const noteHlcRef = useRef<string | undefined>(undefined);
  const boardBackupRef = useRef<BoardState | null>(null);
  const collabSaveTimerRef = useRef<number | null>(null);
  const noteSaveTimerRef = useRef<number | null>(null);
  const tRef = useRef(t);

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

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    userIdRef.current = userId;
    hlcRef.current.setNodeId(userId || 'anon');
  }, [userId]);

  useEffect(() => {
    memberNameRef.current = user?.name || '';
  }, [user?.name]);

  useEffect(() => {
    onlinePeersRef.current = onlinePeers;
  }, [onlinePeers]);

  useEffect(() => {
    onTurnUnauthorizedRef.current = () => {
      if (!tokenRef.current || isDevMockSession(tokenRef.current)) return;
      onUnauthorizedSession();
    };
  }, [onUnauthorizedSession, tokenRef]);

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

  useEffect(() => clearNoteResyncTimer, [clearNoteResyncTimer]);

  const handleChatScroll = useCallback(() => {
    const log = chatLogRef.current;
    if (log) chatAtBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
  }, []);

  useEffect(() => {
    const log = chatLogRef.current;
    if (activeTab === 'chat' && log && chatAtBottomRef.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages.length, activeTab]);

  const addMessage = useCallback((message: Omit<ChatMessage, 'id'> & { id?: string }) => {
    const nextMsg: ChatMessage = {
      ...message,
      id: message.id && message.id.trim() ? message.id : crypto.randomUUID(),
    };
    setMessages((current) => {
      const merged = reconcileChatMessages(current, [nextMsg], userIdRef.current, tRef.current('chat.you'));
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
  }, []);

  const scheduleCollabBackup = useCallback(
    (roomId: string) => {
      if (!roomId || !tokenRef.current || activeRoomRef.current?.access === 'VIEWER') return;
      if (collabSaveTimerRef.current !== null) {
        window.clearTimeout(collabSaveTimerRef.current);
      }
      collabSaveTimerRef.current = window.setTimeout(() => {
        collabSaveTimerRef.current = null;
        if (!tokenRef.current || activeRoomRef.current?.id !== roomId || activeRoomRef.current?.access === 'VIEWER') {
          return;
        }
        const crdtDocBase64 = crdtControllerRef.current
          ? crdtControllerRef.current.encodeStateAsUpdateBase64()
          : undefined;
        void fetchAppApi(apiUrl(`/rooms/${roomId}/collab`), {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: messagesRef.current,
            ...(boardBackupRef.current ? { board: boardBackupRef.current } : {}),
            ...(crdtDocBase64 ? { crdtDocBase64 } : {}),
            hlc: hlcRef.current.now(),
          }),
        }).catch(() => {});
      }, 800);
    },
    [tokenRef],
  );

  const scheduleNoteBackup = useCallback(
    (roomId: string) => {
      if (!roomId || !tokenRef.current || activeRoomRef.current?.access === 'VIEWER') return;
      if (noteSaveTimerRef.current !== null) {
        window.clearTimeout(noteSaveTimerRef.current);
      }
      noteSaveTimerRef.current = window.setTimeout(() => {
        noteSaveTimerRef.current = null;
        if (!tokenRef.current || activeRoomRef.current?.id !== roomId || activeRoomRef.current?.access === 'VIEWER') {
          return;
        }
        void fetchAppApi(apiUrl(`/rooms/${roomId}/my-note`), {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            body: noteTextRef.current,
            isShared: noteSharedRef.current,
            updatedAt: noteUpdatedAtRef.current,
            hlc: noteHlcRef.current,
          }),
        }).catch(() => {});
      }, 800);
    },
    [tokenRef],
  );

  const handleBoardStateChange = useCallback(
    (nextBoard: BoardState) => {
      boardBackupRef.current = nextBoard;
      const roomId = activeRoomRef.current?.id;
      if (roomId) scheduleCollabBackup(roomId);
    },
    [scheduleCollabBackup],
  );

  const broadcast = useCallback(
    (
      envelope:
        | ChatDataEnvelope
        | ChatActionDataEnvelope
        | ChatSyncDataEnvelope
        | NoteDataEnvelope
        | MeetingBoardMessage
        | FileShareMessage
        | CrdtDataEnvelope,
    ) => {
      channelsRef.current.forEach((channel) => {
        if (channel.readyState === 'open') channel.send(JSON.stringify(envelope));
      });
    },
    [],
  );

  const sendDirectToBoardPeer = useCallback((peerId: string, message: MeetingBoardMessage) => {
    const channel = channelsRef.current.get(peerId);
    if (channel && channel.readyState === 'open') {
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
    [],
  );

  const registerMeetingBoardPeerConnectHandler = useCallback((handler: (peerId: string) => void) => {
    meetingBoardPeerConnectListenersRef.current.add(handler);
    return () => {
      meetingBoardPeerConnectListenersRef.current.delete(handler);
    };
  }, []);

  const registerFileMessageHandler = useCallback(
    (handler: (message: FileShareMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void) => {
      fileMessageListenersRef.current.add(handler);
      return () => {
        fileMessageListenersRef.current.delete(handler);
      };
    },
    [],
  );

  const sendDirectToFilePeer = useCallback((peerId: string, message: FileShareMessage) => {
    const channel = channelsRef.current.get(peerId);
    if (channel && channel.readyState === 'open') {
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
    [],
  );

  const sendBinaryToFilePeer = useCallback((peerId: string, frame: ArrayBuffer) => {
    const channel = channelsRef.current.get(peerId);
    if (channel && channel.readyState === 'open') {
      channel.send(frame);
    }
  }, []);

  const onlinePeerIds = useMemo(() => new Set(onlinePeers.map((p) => p.peerId)), [onlinePeers]);
  const liveRoomUserKey = useMemo(
    () => [...new Set(onlinePeers.map((p) => p.userId))].sort().join('\0'),
    [onlinePeers],
  );
  const liveRoomUserIds = useMemo(
    () => (liveRoomUserKey ? new Set(liveRoomUserKey.split('\0')) : EMPTY_USER_IDS),
    [liveRoomUserKey],
  );

  useEffect(() => () => {
    iceManagerRef.current?.invalidate();
    peerSignalingRef.current.forEach((record) => clearPeerSignalingRecord(record));
    peerSignalingRef.current.clear();
    peerCreatePromisesRef.current.clear();
    channelsRef.current.forEach((channel) => channel.close());
    peersRef.current.forEach((peer) => peer.close());
    socketRef.current?.disconnect();
    crdtControllerRef.current?.destroy();
    crdtControllerRef.current = null;
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeRoomRef.current) {
        void iceManagerRef.current?.handleVisibilityOrResume();
      }
    };
    const handleFocusOrOnline = () => {
      if (activeRoomRef.current) {
        void iceManagerRef.current?.handleVisibilityOrResume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocusOrOnline);
    window.addEventListener('online', handleFocusOrOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocusOrOnline);
      window.removeEventListener('online', handleFocusOrOnline);
    };
  }, []);

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

  const closePeer = useCallback(
    (peerId: string) => {
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
          setSessionStatus({ kind: 'waitingPeer' });
        }
      }
      setSharedNotes((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });
      setCrdtCursors((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    },
    [token, clearNoteResyncTimer, removePeerMedia, setPeersCount],
  );

  const setupDataChannel = useCallback(
    (peerId: string, channel: RTCDataChannel, targetRoomId: string) => {
      channel.binaryType = 'arraybuffer';
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
        setSessionStatus({ kind: 'connectedP2P' });
        setPeersCount(openConnectionCount(channelsRef.current.values()));
        addToast(t('toasts.p2pConnected'), 'success');
        const resyncEnvelope = buildNoteResyncEnvelope({
          noteShared: noteSharedRef.current,
          roomReadOnly: activeRoomRef.current?.access === 'VIEWER',
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
                type: 'chat:sync-state',
                messages: messagesRef.current,
                hlc: hlcRef.current.now(),
              }),
            );
          } catch {
            /* Ignore transient send failures during channel open. */
          }
        }
        if (crdtControllerRef.current) {
          try {
            channel.send(
              JSON.stringify({
                type: 'crdt:sync-request',
                stateVector: crdtControllerRef.current.encodeStateVectorBase64(),
              } satisfies CrdtDataEnvelope),
            );
          } catch {
            /* Ignore transient CRDT sync failures during channel open. */
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
            setSessionStatus({ kind: 'waitingPeer' });
          }
        }
        setSharedNotes((current) => {
          if (!(peerId in current)) return current;
          const next = { ...current };
          delete next[peerId];
          return next;
        });
        setCrdtCursors((current) => {
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
              if (typeof payload.hlc === 'string') {
                hlcRef.current.receive(payload.hlc);
              }
              const normalized = normalizeIncomingChatMessage(payload, verifiedSender);
              if (normalized) addMessage(normalized);
            },
            onChatAction: (payload, verifiedSender) => {
              if (typeof payload.hlc === 'string') {
                hlcRef.current.receive(payload.hlc);
              }
              const room = activeRoomRef.current;
              if (
                payload.type === 'chat:reaction' &&
                typeof payload.messageId === 'string' &&
                typeof payload.emoji === 'string'
              ) {
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
              } else if (payload.type === 'chat:pin' && typeof payload.messageId === 'string') {
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
              if (typeof payload.hlc === 'string') {
                hlcRef.current.receive(payload.hlc);
              }
              if (!Array.isArray(payload.messages)) return;
              const room = activeRoomRef.current;
              setMessages((current) => {
                const merged = reconcileChatMessages(
                  current,
                  payload.messages as unknown[],
                  userIdRef.current,
                  tRef.current('chat.you'),
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
              if (typeof payload.hlc === 'string') {
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
            onCrdt: (payload, verifiedPeerId, verifiedSender) => {
              const ctrl = crdtControllerRef.current;
              if (!ctrl) return;
              if (payload.type === 'crdt:sync-request') {
                const ch = channelsRef.current.get(verifiedPeerId);
                if (ch?.readyState === 'open') {
                  try {
                    const update = ctrl.encodeStateAsUpdateBase64(
                      typeof payload.stateVector === 'string' ? payload.stateVector : undefined,
                    );
                    ch.send(
                      JSON.stringify({
                        type: 'crdt:update',
                        update,
                        full: !payload.stateVector,
                      } satisfies CrdtDataEnvelope),
                    );
                  } catch {
                    /* ignore transient CRDT sync error */
                  }
                }
                return;
              }
              if (payload.type === 'crdt:update' && typeof payload.update === 'string') {
                try {
                  const nextText = ctrl.applyRemoteUpdate(payload.update);
                  setCrdtText(nextText);
                  if (activeRoomRef.current?.id) {
                    scheduleCollabBackup(activeRoomRef.current.id);
                  }
                } catch {
                  /* ignore malformed CRDT update */
                }
                return;
              }
              if (payload.type === 'crdt:cursor') {
                const decoded = decodeRelativeCursor(
                  ctrl.doc,
                  ctrl.ytext,
                  typeof payload.anchor === 'string' ? payload.anchor : null,
                  typeof payload.head === 'string' ? payload.head : null,
                );
                setCrdtCursors((current) => {
                  if (!decoded) {
                    if (!(verifiedPeerId in current)) return current;
                    const next = { ...current };
                    delete next[verifiedPeerId];
                    return next;
                  }
                  return {
                    ...current,
                    [verifiedPeerId]: {
                      peerId: verifiedPeerId,
                      userId: verifiedSender.userId,
                      name: verifiedSender.name,
                      anchor: decoded.anchor,
                      head: decoded.head,
                      line: decoded.line,
                      column: decoded.column,
                      updatedAt: Date.now(),
                    },
                  };
                });
              }
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
    },
    [t, addToast, token, addMessage, clearNoteResyncTimer, applyNoteError, scheduleCollabBackup, workspaceMemberRosterRef, setPeersCount],
  );

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
          socket.emit('webrtc:offer', { targetId: peerId, payload: offer });
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
        if (peer.connectionState === 'closed') continue;
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

  const createPeer = useCallback(
    async (peerId: string, shouldOffer: boolean, targetRoomId: string) => {
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
            socket.emit('webrtc:ice-candidate', {
              targetId: peerId,
              payload: candidate.toJSON(),
            });
          }
        };

        peer.ondatachannel = ({ channel }) => setupDataChannel(peerId, channel, targetRoomId);
        attachPeerMediaHandlers(peer, peerId, targetRoomId);
        peer.onnegotiationneeded = () => {
          if (peersRef.current.get(peerId) === peer && peer.connectionState !== 'closed') {
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
            isSignalingConnected: () => socketRef.current === socket && Boolean(socket.connected),
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
          const channel = peer.createDataChannel('bifrost-realtime');
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
    },
    [closePeer, setupDataChannel, getIceManager, getPeerSignalingRecord, negotiateForPeer, attachPeerMediaHandlers, tokenRef, setPeersCount],
  );

  const leaveRoom = useCallback(
    (navigate = true) => {
      getIceManager().invalidate();
      clearPeerRegistry(verifiedPeersRef.current);
      localPeerIdRef.current = null;
      peerSignalingRef.current.forEach((record) => clearPeerSignalingRecord(record));
      peerSignalingRef.current.clear();
      peerCreatePromisesRef.current.clear();
      const activeSocket = socketRef.current;
      if (activeRoomRef.current && activeSocket) {
        activeSocket.emit('room:leave', activeRoomRef.current.id);
      }
      socketRef.current = null;
      channelsRef.current.forEach((channel) => channel.close());
      peersRef.current.forEach((peer) => peer.close());
      channelsRef.current.clear();
      peersRef.current.clear();
      activeSocket?.disconnect();

      stopAllRoomMedia();

      if (crdtControllerRef.current) {
        crdtControllerRef.current.destroy();
        crdtControllerRef.current = null;
      }
      setCrdtText('');
      setCrdtYText(null);
      setCrdtCursors({});

      noteSharedRef.current = false;
      noteTextRef.current = '';
      noteUpdatedAtRef.current = undefined;
      clearNoteResyncTimer();
      setNoteResyncing(false);
      setChatError('');
      applyNoteError('');
      chatAtBottomRef.current = true;
      setNoteShared(false);
      setShowRoomMembersModal(false);
      if (navigate) changeRoute({ workspaceId: activeRoomRef.current?.workspaceId ?? selectedWorkspaceId, roomId: '', tab: 'meeting' });
      activeRoomRef.current = null;
      sharedActiveRoomRef.current = null;
      setCurrentRoom(null);
      setOnlinePeers([]);
      setPeersCount(0);
      setSessionStatus({ kind: 'idle' });
      setSharedNotes({});
      setRoomError('');
      setActiveTab('meeting');
      hideRailTip();
    },
    [
      changeRoute,
      selectedWorkspaceId,
      hideRailTip,
      clearNoteResyncTimer,
      applyNoteError,
      getIceManager,
      stopAllRoomMedia,
      sharedActiveRoomRef,
      setCurrentRoom,
      setPeersCount,
      setShowRoomMembersModal,
      setActiveTab,
    ],
  );

  const joinRoom = useCallback(
    (targetRoom: Room, navigate = true) => {
      if (!user) return;
      if (isDevMockSession(token) && targetRoom.access === null) {
        addToast(t('room.noRoomAccess'), 'error');
        return;
      }
      if (activeRoomRef.current?.id === targetRoom.id && (isDevMockSession(token) || socketRef.current?.connected)) {
        return;
      }

      leaveRoom(false);
      setIsRightPanelOpen(false);
      setShowRoomMembersModal(false);
      hideRailTip();

      const draftKey = roomDraftKey(user.id, targetRoom.workspaceId, targetRoom.id);
      const saved = readRoomDraft(sessionStorage, draftKey);
      noteTextRef.current = saved.note;
      noteUpdatedAtRef.current = readRoomNoteUpdatedAt(sessionStorage, draftKey);
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
        roomChatCacheKey(user.id, targetRoom.workspaceId, targetRoom.id),
        user.id,
        t('chat.you'),
      );
      messagesRef.current = cachedChat;
      if (navigate) changeRoute({ workspaceId: targetRoom.workspaceId, roomId: targetRoom.id, tab: 'meeting' });
      activeRoomRef.current = targetRoom;
      sharedActiveRoomRef.current = targetRoom;
      setCurrentRoom(targetRoom);
      setRoomError('');
      setSessionStatus({ kind: 'connectingSignaling' });
      setMessages(cachedChat);
      setCloudBoard(null);
      setHydratedNote(null);
      setSharedNotes({});
      setOnlinePeers([]);
      setPeersCount(0);
      setActiveTab('meeting');
      setIsSidebarOpen(false);

      // Fresh CRDT document controller for this room
      const ctrl = new CrdtRoomController();
      crdtControllerRef.current = ctrl;
      setCrdtText('');
      setCrdtYText(ctrl.ytext);
      setCrdtCursors({});

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
              crdtDocBase64?: string | null;
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
                  user.id,
                  tRef.current('chat.you'),
                );
                messagesRef.current = merged;
                writeRoomChatCache(
                  localStorage,
                  roomChatCacheKey(user.id, targetRoom.workspaceId, targetRoom.id),
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
            if (collabData.sharedNotes && typeof collabData.sharedNotes === 'object') {
              setSharedNotes((current) => {
                const next = { ...current };
                const liveAuthorIds = new Set(
                  Object.values(current).map((item) => item.authorId).filter(Boolean),
                );
                for (const [uid, note] of Object.entries(collabData.sharedNotes!)) {
                  if (!note || uid === user.id || liveAuthorIds.has(uid)) continue;
                  next[`cloud:${uid}`] = { ...note, authorId: uid };
                }
                return next;
              });
            }
            if (typeof collabData.crdtDocBase64 === 'string' && collabData.crdtDocBase64 && crdtControllerRef.current) {
              try {
                const hydratedText = crdtControllerRef.current.applyRemoteUpdate(collabData.crdtDocBase64);
                setCrdtText(hydratedText);
              } catch {
                /* ignore malformed cloud CRDT snapshot */
              }
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
        setOnlinePeers([{ peerId: 'mock-local-peer', userId: user.id, name: user.name, email: user.email }]);
        setSessionStatus({ kind: 'localPreview' });
        return;
      }

      const iceWarmupPromise = getIceManager().startRoomSession(targetRoom.id, token);

      const socket = io(SIGNALING_URL || undefined, {
        transports: ['websocket'],
        auth: { token },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setSessionStatus({ kind: 'joiningRoom' });
        socket.emit('room:join', targetRoom.id);
      });

      socket.on(
        'room:joined',
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
            typeof joinedLocalPeerId === 'string' && joinedLocalPeerId.trim()
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

          setSessionStatus(peers.length === 0 ? { kind: 'waitingPeer' } : { kind: 'joinedRoom', roomName });
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
        },
      );

      socket.on('presence:changed', ({ roomId, peers }: { roomId: string; peers: PresencePeer[] }) => {
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
        'room:peer-joined',
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
          addToast(t('toasts.peerJoined', { name: joinedPeer.name }), 'info');
        },
      );

      socket.on('room:peer-left', ({ peerId }: { peerId: string }) => {
        if (socketRef.current !== socket || activeRoomRef.current?.id !== targetRoom.id) return;
        const verifiedPeer = resolveVerifiedPeer(
          verifiedPeersRef.current,
          peerId,
          localPeerIdRef.current,
        );
        const leftPeer = onlinePeersRef.current.find((p) => p.peerId === peerId);
        const name = verifiedPeer?.name ?? leftPeer?.name ?? 'Member';
        removeVerifiedPeer(verifiedPeersRef.current, peerId);
        closePeer(peerId);
        addToast(t('toasts.peerLeft', { name }), 'info');
      });

      socket.on('room:error', ({ message }: { message: string }) => {
        if (socketRef.current !== socket) return;
        setRoomError(message);
        setSessionStatus({ kind: 'error', message });
        addToast(message, 'error');
      });

      socket.on(
        'room:access-revoked',
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
            const nextWsId = nextWorkspaces[0]?.id ?? '';
            setSelectedWorkspaceId(nextWsId);
            setRooms([]);
            setRoomsLoadedFor('');
            setRoomLoadError('');
            changeRoute({ workspaceId: nextWsId, roomId: '', tab: 'meeting' }, true);
          } else if (isCurrentRoom) {
            changeRoute({ workspaceId: selectedWorkspaceIdRef.current, roomId: '', tab: 'meeting' }, true);
          }

          if (isCurrentRoom) {
            addToast(tRef.current('room.accessRevoked'), 'error');
          }
        },
      );

      socket.on('webrtc:offer', async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
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
            socket.emit('webrtc:answer', { targetId: peerId, payload: answer });
          },
          onPendingRestartReady: () => {
            void negotiateForPeer(peerId, targetRoom.id, true);
          },
        });
      });

      socket.on('webrtc:answer', async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
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

      socket.on('webrtc:ice-candidate', async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
        if (socketRef.current !== socket || activeRoomRef.current?.id !== targetRoom.id) return;
        if (!authorizeSignalingPeer(verifiedPeersRef.current, peerId, localPeerIdRef.current)) return;
        const record = getPeerSignalingRecord(peerId);
        await handleIncomingIceCandidate({
          peer: peersRef.current.get(peerId),
          record,
          candidate: payload as RTCIceCandidateInit,
        });
      });

      socket.on('connect_error', (error) => {
        setSessionStatus({ kind: 'error', message: error.message || undefined });
      });

      socket.on('disconnect', () => {
        if (socketRef.current !== socket || !activeRoomRef.current) return;
        setOnlinePeers([]);
        if (openConnectionCount(channelsRef.current.values()) === 0) {
          setSessionStatus({ kind: 'connectingSignaling' });
        }
      });
    },
    [
      addToast,
      changeRoute,
      clearNoteResyncTimer,
      closePeer,
      createPeer,
      getIceManager,
      getPeerSignalingRecord,
      hideRailTip,
      leaveRoom,
      negotiateForPeer,
      refreshWorkspaceMemberRoster,
      selectedWorkspaceIdRef,
      setActiveTab,
      setCurrentRoom,
      setIsRightPanelOpen,
      setIsSidebarOpen,
      setPeersCount,
      setRoomLoadError,
      setRooms,
      setRoomsLoadedFor,
      setSelectedWorkspaceId,
      sharedActiveRoomRef,
      setShowRoomMembersModal,
      setWorkspaceRetry,
      setWorkspaces,
      t,
      token,
      user,
      workspaceMemberRosterRef,
      workspacesRef,
    ],
  );

  // Send Chat Message (P2P WebRTC DataChannel)
  const sendMessage = useCallback(
    (draftText: string, replyTo?: ChatReplySummary): boolean => {
      if (activeRoomRef.current?.access === 'VIEWER') return false;
      const msgId = crypto.randomUUID();
      const hlc = hlcRef.current.now();
      const payload = createChatOutboundPayload(
        memberNameRef.current,
        t('chat.you'),
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
    },
    [broadcast, addMessage, t, userId, scheduleCollabBackup],
  );

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
            type: 'chat:reaction',
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
            type: 'chat:pin',
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

  const handleNoteContentChange = useCallback(
    (body: string, updatedAt: number) => {
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
    },
    [broadcast, applyNoteError, t, scheduleNoteBackup],
  );

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
          type: 'note:shared',
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
    const room = activeRoomRef.current;
    if (!room) return;
    const openConnections = openConnectionCount(channelsRef.current.values());

    if (crdtControllerRef.current && openConnections > 0) {
      try {
        broadcast({
          type: 'crdt:sync-request',
          stateVector: crdtControllerRef.current.encodeStateVectorBase64(),
        });
      } catch {
        /* ignore CRDT resync broadcast error */
      }
    }

    if (room.access === 'VIEWER' || !noteSharedRef.current) return;
    if (openConnections === 0) return;
    const syncTs = noteUpdatedAtRef.current ?? Date.now();
    const hlc = hlcRef.current.now();
    noteHlcRef.current = hlc;
    setNoteResyncing(true);
    clearNoteResyncTimer();
    try {
      broadcast({
        type: 'note:shared',
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

  const handleCrdtLocalChange = useCallback(
    (nextText: string) => {
      const room = activeRoomRef.current;
      const ctrl = crdtControllerRef.current;
      if (!room || !ctrl || room.access === 'VIEWER') return;
      const updateB64 = ctrl.applyLocalEdit(nextText);
      setCrdtText(ctrl.getText());
      if (updateB64) {
        if (openConnectionCount(channelsRef.current.values()) > 0) {
          try {
            broadcast({ type: 'crdt:update', update: updateB64 });
          } catch {
            /* keep local & cloud backup intact */
          }
        }
        scheduleCollabBackup(room.id);
      }
    },
    [broadcast, scheduleCollabBackup],
  );

  const handleCrdtSelectionChange = useCallback(
    (anchor: number, head: number) => {
      const room = activeRoomRef.current;
      const ctrl = crdtControllerRef.current;
      if (!room || !ctrl || room.access === 'VIEWER') return;
      if (openConnectionCount(channelsRef.current.values()) === 0) return;
      const encoded = encodeRelativeCursor(ctrl.ytext, anchor, head);
      try {
        broadcast({
          type: 'crdt:cursor',
          anchor: encoded.anchor,
          head: encoded.head,
        });
      } catch {
        /* ignore cursor broadcast error */
      }
    },
    [broadcast],
  );

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
      addToast(t('rightPanel.copied'), 'success');
      setTimeout(() => setCopiedRoomId(false), 2000);
    } catch {
      addToast(t('rightPanel.copyFailed'), 'error');
    }
  }, [addToast, t]);

  const roomReadOnly = currentRoom?.access === 'VIEWER';

  return {
    currentRoom,
    setCurrentRoom,
    activeRoomRef,
    roomError,
    roomReadOnly,
    roomOnlineCounts,
    setRoomOnlineCounts,
    copiedRoomId,
    sessionStatus,
    onlinePeers,
    peersCount,
    onlinePeerIds,
    liveRoomUserIds,
    messages,
    chatLogRef,
    handleChatScroll,
    chatError,
    noteError,
    cloudBoard,
    hydratedNote,
    noteShared,
    noteShareStatus,
    sharedNotes,
    crdtText,
    crdtYText,
    crdtCursors: crdtCursorsList,
    handleCrdtLocalChange,
    handleCrdtSelectionChange,
    channelsRef,
    joinRoom,
    leaveRoom,
    sendMessage,
    toggleChatReaction,
    toggleChatPin,
    handleNoteContentChange,
    toggleNoteSharing,
    retryNoteSync,
    handleBoardStateChange,
    handleCopyCurrentRoomId,
    broadcast,
    sendDirectToBoardPeer,
    sendDirectToFilePeer,
    sendBinaryToFilePeer,
    registerMeetingBoardMessageHandler,
    registerMeetingBoardPeerConnectHandler,
    registerFileMessageHandler,
    registerFileBinaryHandler,
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
    toggleMic,
    toggleCam,
    toggleScreenShare,
    toggleNoiseSuppression,
    toggleBackgroundBlur,
    selectMicrophone,
    selectCamera,
    selectSpeaker,
  };
}
