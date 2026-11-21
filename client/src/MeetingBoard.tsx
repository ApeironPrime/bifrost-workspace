import { CardMoveMenu, type BoardColumnOption, type CardMoveMenuLabels } from './components/CardMoveMenu'
import { ConfirmDialog } from './components/ConfirmDialog'
import { MotionPresence } from './components/MotionPresence'
import { SelectMenu } from './components/SelectMenu'
import { UserAvatar } from './components/UserAvatar'
import type { SelectItem } from './lib/selectOptions'
import { useBoardPointerDrag } from './lib/useBoardPointerDrag'
import { useDialogFocus } from './lib/useDialogFocus'
import {
  applyLocalBoardMessage,
  applyPeerBoardMessage,
  areBoardStatesEqual,
  buildBoardSyncStateMessage,
  createBoardItem,
  deleteBoardItem,
  getBrowserLocalStorage,
  getSortedColumnItems,
  moveBoardItem,
  moveBoardItemRelative,
  readRoomBoardDetailed,
  reconcileBoardSnapshots,
  roomBoardKey,
  toggleBoardItemComplete,
  updateBoardItem,
  writeRoomBoardDetailed,
  type BoardItemKind,
  type BoardMoveDirection,
  type BoardState,
  type BoardStorageReadStatus,
  type BoardStorageWriteStatus,
  type BoardTombstone,
  type MeetingBoardItem,
  type MeetingBoardMessage,
} from './lib/roomUiState'
import type { VerifiedPeerIdentity } from './lib/peerIdentity'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Calendar,
  CheckCircle2,
  ListTodo,
  Lightbulb,
  X,
  GripVertical,
  Columns3,
  CheckSquare,
  Square,
} from "lucide-react";
import { LOCALE_META, translate, type I18nKey, type Language } from "./i18n";
import type { ToastType } from "./components/Toast";

export type { BoardItemKind, MeetingBoardItem, MeetingBoardMessage } from './lib/roomUiState';

interface MeetingBoardProps {
  readOnly?: boolean;
  broadcast: (envelope: MeetingBoardMessage) => void;
  sendDirectToPeer: (peerId: string, message: MeetingBoardMessage) => void;
  registerMessageHandler: (
    handler: (message: MeetingBoardMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void,
  ) => () => void;
  registerPeerConnectHandler: (handler: (peerId: string) => void) => () => void;
  currentUser: { id: string; name: string; email: string };
  workspaceId?: string;
  roomId?: string;
  lang: Language;
  addToast: (message: string, type: ToastType) => void;
}

interface ColumnConfig {
  kind: BoardItemKind;
  titleKey:
    | "meetingBoard.columnAgenda"
    | "meetingBoard.columnDecision"
    | "meetingBoard.columnAction"
    | "meetingBoard.columnParking";
  descKey:
    | "meetingBoard.columnAgendaDesc"
    | "meetingBoard.columnDecisionDesc"
    | "meetingBoard.columnActionDesc"
    | "meetingBoard.columnParkingDesc";
  icon: typeof Calendar;
}

const COLUMNS: ColumnConfig[] = [
  {
    kind: "agenda",
    titleKey: "meetingBoard.columnAgenda",
    descKey: "meetingBoard.columnAgendaDesc",
    icon: Calendar,
  },
  {
    kind: "decision",
    titleKey: "meetingBoard.columnDecision",
    descKey: "meetingBoard.columnDecisionDesc",
    icon: CheckCircle2,
  },
  {
    kind: "action",
    titleKey: "meetingBoard.columnAction",
    descKey: "meetingBoard.columnActionDesc",
    icon: ListTodo,
  },
  {
    kind: "parking",
    titleKey: "meetingBoard.columnParking",
    descKey: "meetingBoard.columnParkingDesc",
    icon: Lightbulb,
  },
];

type ScopedBoardState = {
  scopeKey: string | null;
  items: MeetingBoardItem[];
  tombstones: Record<string, BoardTombstone>;
  loadStatus: BoardStorageReadStatus;
};

function loadBoardForScope(
  userId: string,
  workspaceId: string | undefined,
  roomId: string | undefined
): ScopedBoardState {
  if (!userId || !workspaceId || !roomId) {
    return { scopeKey: null, items: [], tombstones: {}, loadStatus: 'empty' };
  }
  const key = roomBoardKey(userId, workspaceId, roomId);
  const result = readRoomBoardDetailed(getBrowserLocalStorage(), key, {
    userId,
    workspaceId,
    roomId,
  });
  return {
    scopeKey: key,
    items: result.snapshot.items,
    tombstones: result.snapshot.tombstones,
    loadStatus: result.status,
  };
}

function renderModalColumnIcon(option: SelectItem) {
  const col = COLUMNS.find((entry) => entry.kind === option.value);
  const ColIcon = col?.icon ?? Calendar;
  return <ColIcon size={14} aria-hidden="true" />;
}

function formatCardDate(isoString: string, lang: Language) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString(LOCALE_META[lang].intl, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

interface BoardCardProps {
  item: MeetingBoardItem;
  readOnly: boolean;
  isDragging: boolean;
  isFirst: boolean;
  isLast: boolean;
  lang: Language;
  dragDropHint: string;
  editCardLabel: string;
  deleteCardLabel: string;
  completeLabel: string;
  incompleteLabel: string;
  moveMenuLabels: CardMoveMenuLabels;
  columnMoveOptions: readonly BoardColumnOption[];
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, item: MeetingBoardItem) => void;
  onToggleComplete: (item: MeetingBoardItem) => void;
  onEdit: (item: MeetingBoardItem) => void;
  onDeleteRequest: (itemId: string) => void;
  onMoveStep: (itemId: string, direction: BoardMoveDirection) => void;
  onMoveToColumn: (itemId: string, targetKind: BoardItemKind) => void;
}

const BoardCard = memo(function BoardCard({
  item,
  readOnly,
  isDragging,
  isFirst,
  isLast,
  lang,
  dragDropHint,
  editCardLabel,
  deleteCardLabel,
  completeLabel,
  incompleteLabel,
  moveMenuLabels,
  columnMoveOptions,
  onPointerDown,
  onToggleComplete,
  onEdit,
  onDeleteRequest,
  onMoveStep,
  onMoveToColumn,
}: BoardCardProps) {
  return (
    <article
      data-board-card-id={item.id}
      className={`board-card ${isDragging ? "card-dragging" : ""} ${
        item.completed ? "card-completed" : ""
      }`}
      onPointerDown={readOnly ? undefined : (e) => onPointerDown(e, item)}
    >
      {/* Drag Handle, Checkbox, Move Menu & Card Action Header */}
      <div className="card-header-row">
        <button
          type="button"
          className="card-drag-handle"
          data-drag-handle="true"
          tabIndex={-1}
          aria-hidden="true"
          disabled={readOnly}
          title={dragDropHint}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="card-checkbox-btn"
          onClick={() => onToggleComplete(item)}
          disabled={readOnly}
          aria-pressed={!!item.completed}
          aria-label={`${item.completed ? incompleteLabel : completeLabel}: ${item.title}`}
        >
          {item.completed ? (
            <CheckSquare size={15} className="checkbox-checked" />
          ) : (
            <Square size={15} className="checkbox-unchecked" />
          )}
        </button>

        <h4 className="card-title truncate" title={item.title}>{item.title}</h4>

        <div className="card-action-btns">
          <CardMoveMenu
            itemId={item.id}
            itemTitle={item.title}
            currentKind={item.kind}
            isFirst={isFirst}
            isLast={isLast}
            disabled={readOnly}
            labels={moveMenuLabels}
            columnOptions={columnMoveOptions}
            onMoveStep={onMoveStep}
            onMoveToColumn={onMoveToColumn}
          />
          <button
            type="button"
            className="card-btn-icon"
            disabled={readOnly}
            onClick={() => onEdit(item)}
            title={editCardLabel}
            aria-label={`${editCardLabel}: ${item.title}`}
          >
            <Pencil size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="card-btn-icon card-btn-danger"
            disabled={readOnly}
            onClick={() => onDeleteRequest(item.id)}
            title={deleteCardLabel}
            aria-label={`${deleteCardLabel}: ${item.title}`}
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Description (if present) */}
      {item.description && (
        <p className="card-description">{item.description}</p>
      )}

      {/* Card Meta Footer */}
      <div className="card-meta-footer">
        <div className="card-author-badge">
          <UserAvatar
            name={item.author}
            size={20}
            seed={item.author}
            className="author-avatar-mini"
          />
          <span className="author-name truncate">{item.author}</span>
        </div>

        <span className="card-time-badge">
          {formatCardDate(item.updatedAt, lang)}
        </span>
      </div>
    </article>
  );
});

export const MeetingBoard = memo(function MeetingBoard({
  readOnly = false,
  broadcast,
  sendDirectToPeer,
  registerMessageHandler,
  registerPeerConnectHandler,
  currentUser,
  workspaceId,
  roomId,
  lang,
  addToast,
}: MeetingBoardProps) {
  const scopeKey =
    currentUser.id && workspaceId && roomId
      ? roomBoardKey(currentUser.id, workspaceId, roomId)
      : null;
  const [board, setBoard] = useState<ScopedBoardState>(() =>
    loadBoardForScope(currentUser.id, workspaceId, roomId)
  );
  const [prevScopeKey, setPrevScopeKey] = useState<string | null>(scopeKey);
  const [mobileKind, setMobileKind] = useState<BoardItemKind>('agenda');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [addKind, setAddKind] = useState<BoardItemKind>("agenda");
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const boardGridRef = useRef<HTMLDivElement>(null);
  const dragPreviewRef = useRef<HTMLDivElement>(null);
  const dragPreviewHintRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [discard, setDiscard] = useState(false);
  const [editingItem, setEditingItem] = useState<MeetingBoardItem | null>(null);

  if (prevScopeKey !== scopeKey) {
    setPrevScopeKey(scopeKey);
    setBoard(loadBoardForScope(currentUser.id, workspaceId, roomId));
    setMobileKind('agenda');
    setShowAddModal(false);
    setEditingItem(null);
    setDeleteTarget(null);
    setDiscard(false);
  }

  const t = useCallback(
    (key: I18nKey, params?: Record<string, string | number>) =>
      translate(lang, key, params),
    [lang]
  );

  const items = board.items;
  const boardRef = useRef<ScopedBoardState>(board);
  const readOnlyRef = useRef(readOnly);
  const notifiedLoadScopeRef = useRef<string | null>(null);
  const lastBgWriteErrorRef = useRef<string | null>(null);
  const pendingFlushRef = useRef(false);

  const notifyLoadIssue = useCallback(
    (status: BoardStorageReadStatus) => {
      if (status !== 'corrupt' && status !== 'incompatible-version') return;
      addToast(t('meetingBoard.storageReadError'), 'error');
    },
    [t, addToast]
  );

  const notifySaveFailure = useCallback(
    (status: BoardStorageWriteStatus) => {
      const msg =
        status === 'incompatible-version'
          ? t('meetingBoard.storageVersionConflict')
          : t('meetingBoard.storageQuotaError');
      addToast(msg, 'error');
    },
    [t, addToast]
  );

  const persistBoardState = useCallback(
    (stateToSave: BoardState) => {
      if (!scopeKey || !workspaceId || !roomId) {
        return { ok: false as const, status: 'invalid-key' as BoardStorageWriteStatus };
      }
      return writeRoomBoardDetailed(getBrowserLocalStorage(), scopeKey, {
        userId: currentUser.id,
        workspaceId,
        roomId,
        items: stateToSave.items,
        tombstones: stateToSave.tombstones,
      });
    },
    [scopeKey, currentUser.id, workspaceId, roomId]
  );

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    if (!scopeKey) return;
    if (notifiedLoadScopeRef.current !== scopeKey) {
      notifiedLoadScopeRef.current = scopeKey;
      lastBgWriteErrorRef.current = null;
      pendingFlushRef.current = false;
      notifyLoadIssue(board.loadStatus);
    }
  }, [scopeKey, board.loadStatus, notifyLoadIssue]);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // Synchronize changes from other browser tabs and flush pending state before unload
  useEffect(() => {
    if (!scopeKey || !workspaceId || !roomId) return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== scopeKey) return;
      const detailed = readRoomBoardDetailed(getBrowserLocalStorage(), scopeKey, {
        userId: currentUser.id,
        workspaceId,
        roomId,
      });
      if (detailed.status !== 'ok') return;
      setBoard((current) => {
        const merged = reconcileBoardSnapshots(current, detailed.snapshot);
        if (areBoardStatesEqual(current, merged)) return current;
        return {
          ...current,
          items: merged.items,
          tombstones: merged.tombstones,
        };
      });
    };

    const handlePageFlush = () => {
      if (pendingFlushRef.current && boardRef.current.scopeKey === scopeKey) {
        if (persistBoardState(boardRef.current).ok) {
          pendingFlushRef.current = false;
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('beforeunload', handlePageFlush);
    window.addEventListener('pagehide', handlePageFlush);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('beforeunload', handlePageFlush);
      window.removeEventListener('pagehide', handlePageFlush);
    };
  }, [scopeKey, currentUser.id, workspaceId, roomId, persistBoardState]);

  const closeEditor = () => {
    const dirty = editingItem ? formTitle !== editingItem.title || formDesc !== (editingItem.description ?? '') : !!(formTitle.trim() || formDesc.trim());
    if(dirty) {setDiscard(true);return;}
    setShowAddModal(false);setEditingItem(null);
  };
  useDialogFocus((showAddModal || !!editingItem) && !discard, closeEditor, '.motion-presence:not([data-exiting]) .board-card-modal');

  // Handle incoming DataChannel messages
  useEffect(() => {
    const unregisterMsg = registerMessageHandler((message, peerId, verifiedSender) => {
      if (message.roomId && roomId && message.roomId !== roomId) return;
      const senderUserId = typeof verifiedSender?.userId === "string" ? verifiedSender.userId.trim() : "";
      const senderName = typeof verifiedSender?.name === "string" ? verifiedSender.name.trim() : "";
      if (!senderUserId || !senderName || verifiedSender?.peerId !== peerId) return;
      const verifiedActor = { userId: senderUserId, name: senderName };

      if (message.type === "meeting-board:sync-request") {
        const reply = buildBoardSyncStateMessage(boardRef.current, {
          readOnly: readOnlyRef.current,
          roomId,
        });
        if (reply) {
          sendDirectToPeer(peerId, reply);
        }
        return;
      }

      const optimisticNext = applyPeerBoardMessage(boardRef.current, message, {
        roomId,
        sender: verifiedActor,
      });
      let syncedState: BoardState = optimisticNext;
      if (!areBoardStatesEqual(boardRef.current, optimisticNext)) {
        if (scopeKey && workspaceId && roomId) {
          const writeRes = persistBoardState(optimisticNext);
          if (writeRes.ok && writeRes.snapshot) {
            pendingFlushRef.current = false;
            syncedState = {
              items: writeRes.snapshot.items,
              tombstones: writeRes.snapshot.tombstones,
            };
          } else {
            pendingFlushRef.current = true;
            const errKey = `${scopeKey}:${writeRes.status}`;
            if (lastBgWriteErrorRef.current !== errKey) {
              lastBgWriteErrorRef.current = errKey;
              notifySaveFailure(writeRes.status);
            }
          }
        }
        boardRef.current = {
          ...boardRef.current,
          items: syncedState.items,
          tombstones: syncedState.tombstones,
        };
      }

      setBoard((current) => {
        const next = applyPeerBoardMessage(current, message, {
          roomId,
          sender: verifiedActor,
        });
        const merged = reconcileBoardSnapshots(next, syncedState);
        if (areBoardStatesEqual(current, merged)) return current;
        return {
          ...current,
          items: merged.items,
          tombstones: merged.tombstones,
        };
      });
    });

    const unregisterPeer = registerPeerConnectHandler((peerId) => {
      sendDirectToPeer(peerId, {
        type: "meeting-board:sync-request",
        ...(roomId ? { roomId } : {}),
      });
    });

    return () => {
      unregisterMsg();
      unregisterPeer();
    };
  }, [registerMessageHandler, registerPeerConnectHandler, sendDirectToPeer, roomId, scopeKey, workspaceId, persistBoardState, notifySaveFailure]);

  // Request sync on initial mount / room scope activation
  useEffect(() => {
    broadcast({
      type: "meeting-board:sync-request",
      ...(roomId ? { roomId } : {}),
    });
  }, [broadcast, roomId]);

  const commitLocalMessage = useCallback((message: MeetingBoardMessage | null): { committed: boolean; persisted: boolean } => {
    if (!message) return { committed: false, persisted: false };
    const optimisticNext = applyLocalBoardMessage(boardRef.current, message, { roomId });
    if (areBoardStatesEqual(boardRef.current, optimisticNext)) {
      return { committed: false, persisted: false };
    }

    let finalState: BoardState = optimisticNext;
    let persisted = false;
    if (scopeKey && workspaceId && roomId) {
      const writeRes = persistBoardState(optimisticNext);
      if (writeRes.ok && writeRes.snapshot) {
        persisted = true;
        pendingFlushRef.current = false;
        finalState = {
          items: writeRes.snapshot.items,
          tombstones: writeRes.snapshot.tombstones,
        };
      } else {
        pendingFlushRef.current = true;
        notifySaveFailure(writeRes.status);
      }
    }

    boardRef.current = {
      ...boardRef.current,
      items: finalState.items,
      tombstones: finalState.tombstones,
    };

    setBoard((current) => {
      const next = applyLocalBoardMessage(reconcileBoardSnapshots(current, finalState), message, { roomId });
      if (areBoardStatesEqual(current, next)) return current;
      return {
        ...current,
        items: next.items,
        tombstones: next.tombstones,
      };
    });
    broadcast(message);
    return { committed: true, persisted };
  }, [scopeKey, workspaceId, roomId, persistBoardState, notifySaveFailure, broadcast]);

  // Create card
  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    const { message } = createBoardItem(boardRef.current, {
      kind: addKind,
      title: formTitle,
      description: formDesc,
      author: currentUser.name,
      actorId: currentUser.id,
      roomId,
      readOnly: readOnly || readOnlyRef.current,
    });
    const { committed, persisted } = commitLocalMessage(message);
    if (!committed) return;

    setMobileKind(addKind);
    setFormTitle("");
    setFormDesc("");
    setShowAddModal(false);
    if (persisted) {
      addToast(t("meetingBoard.cardAddedToast"), "success");
    }
  };

  // Edit card
  const handleEditSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    const { message } = updateBoardItem(boardRef.current, {
      itemId: editingItem.id,
      title: formTitle,
      description: formDesc,
      actorId: currentUser.id,
      roomId,
      readOnly: readOnly || readOnlyRef.current,
    });
    const { committed } = commitLocalMessage(message);
    if (!committed) return;

    setEditingItem(null);
    setFormTitle("");
    setFormDesc("");
  };

  // Toggle completed
  const handleToggleComplete = useCallback((item: MeetingBoardItem) => {
    const { message } = toggleBoardItemComplete(boardRef.current, {
      itemId: item.id,
      actorId: currentUser.id,
      roomId,
      readOnly: readOnly || readOnlyRef.current,
    });
    commitLocalMessage(message);
  }, [commitLocalMessage, currentUser.id, roomId, readOnly]);

  // Delete card
  const handleDeleteItem = useCallback((itemId: string) => {
    const { message } = deleteBoardItem(boardRef.current, {
      itemId,
      actorId: currentUser.id,
      roomId,
      readOnly: readOnly || readOnlyRef.current,
    });
    const { committed } = commitLocalMessage(message);
    if (!committed) return;
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }, [commitLocalMessage, currentUser.id, roomId, readOnly]);

  const columnTitleMap = useMemo<Record<BoardItemKind, string>>(
    () => ({
      agenda: t("meetingBoard.columnAgenda"),
      decision: t("meetingBoard.columnDecision"),
      action: t("meetingBoard.columnAction"),
      parking: t("meetingBoard.columnParking"),
    }),
    [t],
  );

  const announceCardMove = useCallback(
    (title: string, targetKind: BoardItemKind, targetIndex: number, columnCount: number) => {
      setAnnouncement(
        t("meetingBoard.movedAnnouncement", {
          title,
          column: columnTitleMap[targetKind],
          position: String(targetIndex + 1),
          total: String(Math.max(1, columnCount)),
        }),
      );
    },
    [columnTitleMap, t],
  );

  const focusCardControlAfterMove = useCallback((itemId: string, fallbackCardId?: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const gridEl = boardGridRef.current;
        if (!gridEl) return;

        const escapeId =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(itemId)
            : itemId.replace(/["\\]/g, "\\$&");
        const movedTrigger = gridEl.querySelector<HTMLElement>(
          `[data-card-move-trigger="${escapeId}"]`,
        );
        if (movedTrigger && movedTrigger.offsetParent !== null) {
          movedTrigger.focus({ preventScroll: true });
          movedTrigger.closest<HTMLElement>("[data-board-card-id]")?.scrollIntoView({
            block: "nearest",
            inline: "nearest",
          });
          return;
        }

        if (fallbackCardId) {
          const escapeFallback =
            typeof CSS !== "undefined" && typeof CSS.escape === "function"
              ? CSS.escape(fallbackCardId)
              : fallbackCardId.replace(/["\\]/g, "\\$&");
          const siblingTrigger = gridEl.querySelector<HTMLElement>(
            `[data-card-move-trigger="${escapeFallback}"]`,
          );
          if (siblingTrigger && siblingTrigger.offsetParent !== null) {
            siblingTrigger.focus({ preventScroll: true });
            return;
          }
        }

        const visibleEmptyBtn = gridEl.querySelector<HTMLElement>(
          '.board-column[data-mobile-selected="true"] .column-empty-placeholder button',
        );
        if (visibleEmptyBtn && visibleEmptyBtn.offsetParent !== null) {
          visibleEmptyBtn.focus({ preventScroll: true });
          return;
        }

        const pickerTrigger = document.querySelector<HTMLElement>(
          ".board-mobile-section-picker .select-menu-trigger",
        );
        if (pickerTrigger && pickerTrigger.offsetParent !== null) {
          pickerTrigger.focus({ preventScroll: true });
          return;
        }

        addButtonRef.current?.focus({ preventScroll: true });
      });
    });
  }, []);

  const handleCommitDrop = useCallback(
    (itemId: string, targetKind: BoardItemKind, targetIndex: number) => {
      if (readOnly || readOnlyRef.current) return;

      const { message, movedItem, targetIndex: resolvedIndex, columnCount } = moveBoardItem(
        boardRef.current,
        {
          itemId,
          targetKind,
          targetIndex,
          actorId: currentUser.id,
          roomId,
          readOnly: readOnly || readOnlyRef.current,
        },
      );

      if (movedItem && message) {
        const { committed } = commitLocalMessage(message);
        if (committed) {
          announceCardMove(movedItem.title, targetKind, resolvedIndex ?? 0, columnCount ?? 1);
        }
      }
    },
    [announceCardMove, commitLocalMessage, currentUser.id, roomId, readOnly],
  );

  const handleMoveStep = useCallback(
    (itemId: string, direction: BoardMoveDirection) => {
      if (readOnly || readOnlyRef.current) return;

      const { message, movedItem, targetIndex, columnCount } = moveBoardItemRelative(
        boardRef.current,
        {
          itemId,
          direction,
          actorId: currentUser.id,
          roomId,
          readOnly: readOnly || readOnlyRef.current,
        },
      );

      if (movedItem && message) {
        const { committed } = commitLocalMessage(message);
        if (committed) {
          announceCardMove(movedItem.title, movedItem.kind, targetIndex ?? 0, columnCount ?? 1);
          focusCardControlAfterMove(itemId);
        }
      }
    },
    [announceCardMove, commitLocalMessage, currentUser.id, focusCardControlAfterMove, roomId, readOnly],
  );

  const handleMoveToColumn = useCallback(
    (itemId: string, targetKind: BoardItemKind) => {
      if (readOnly || readOnlyRef.current) return;

      const currentItem = boardRef.current.items.find((entry) => entry.id === itemId);
      const sourceColItems = currentItem
        ? getSortedColumnItems(boardRef.current.items, currentItem.kind)
        : [];
      const sourcePos = sourceColItems.findIndex((entry) => entry.id === itemId);
      const fallbackCardId =
        sourcePos >= 0
          ? (sourceColItems[sourcePos + 1]?.id ?? sourceColItems[sourcePos - 1]?.id)
          : undefined;

      const { message, movedItem, targetIndex, columnCount } = moveBoardItem(
        boardRef.current,
        {
          itemId,
          targetKind,
          actorId: currentUser.id,
          roomId,
          readOnly: readOnly || readOnlyRef.current,
        },
      );

      if (movedItem && message) {
        const { committed } = commitLocalMessage(message);
        if (committed) {
          announceCardMove(movedItem.title, targetKind, targetIndex ?? 0, columnCount ?? 1);
          focusCardControlAfterMove(itemId, fallbackCardId);
        }
      }
    },
    [announceCardMove, commitLocalMessage, currentUser.id, focusCardControlAfterMove, roomId, readOnly],
  );

  const handleDeleteRequest = useCallback((itemId: string) => {
    setDeleteTarget(itemId);
  }, []);

  const openAddModal = (kind: BoardItemKind) => {
    if (readOnly) return;
    setAddKind(kind);
    setFormTitle("");
    setFormDesc("");
    setShowAddModal(true);
  };

  const openEditModal = useCallback((item: MeetingBoardItem) => {
    if (readOnlyRef.current) return;
    setEditingItem(item);
    setFormTitle(item.title);
    setFormDesc(item.description || "");
  }, []);

  const moveColumnItems = useMemo<SelectItem[]>(
    () =>
      COLUMNS.map((column) => ({
        value: column.kind,
        label: t(column.titleKey),
        description: t(column.descKey),
      })),
    [t],
  );

  const columnMoveOptions = useMemo<BoardColumnOption[]>(
    () =>
      COLUMNS.map((column) => {
        const columnTitle = columnTitleMap[column.kind];
        return {
          kind: column.kind,
          label: columnTitle,
          moveToLabel: t("meetingBoard.moveToColumn", { column: columnTitle }),
          icon: column.icon,
        };
      }),
    [columnTitleMap, t],
  );

  const moveMenuLabels = useMemo<CardMoveMenuLabels>(
    () => ({
      moveCard: t("meetingBoard.moveCard"),
      movePositionGroup: t("meetingBoard.movePositionGroup"),
      moveColumnGroup: t("meetingBoard.moveColumnGroup"),
      moveUp: t("meetingBoard.moveUp"),
      moveDown: t("meetingBoard.moveDown"),
      moveToTop: t("meetingBoard.moveToTop"),
      moveToBottom: t("meetingBoard.moveToBottom"),
    }),
    [t],
  );

  const mobileColumnItems = useMemo<SelectItem[]>(
    () =>
      COLUMNS.map((col) => ({
        value: col.kind,
        label: `${t(col.titleKey)} (${items.filter((item) => item.kind === col.kind).length})`,
      })),
    [items, t],
  );

  const itemsByColumn = useMemo<Record<BoardItemKind, MeetingBoardItem[]>>(
    () => ({
      agenda: getSortedColumnItems(items, "agenda"),
      decision: getSortedColumnItems(items, "decision"),
      action: getSortedColumnItems(items, "action"),
      parking: getSortedColumnItems(items, "parking"),
    }),
    [items],
  );

  const formatDropHint = useCallback(
    ({
      targetKind,
      targetCardTitle,
      edge,
    }: {
      targetKind: BoardItemKind;
      targetCardTitle?: string;
      edge?: "before" | "after" | null;
    }) => {
      if (targetCardTitle && edge === "before") {
        return t("meetingBoard.dragBeforeTarget", { title: targetCardTitle });
      }
      if (targetCardTitle && edge === "after") {
        return t("meetingBoard.dragAfterTarget", { title: targetCardTitle });
      }
      return t("meetingBoard.dragIntoColumn", { column: columnTitleMap[targetKind] });
    },
    [columnTitleMap, t],
  );

  const { activeDrag, startCardPointerDown } = useBoardPointerDrag({
    boardGridRef,
    previewRef: dragPreviewRef,
    previewHintRef: dragPreviewHintRef,
    itemsByColumn,
    readOnly,
    formatDropHint,
    onCommitDrop: handleCommitDrop,
  });

  const handleMobileKindChange = useCallback((value: string) => {
    setMobileKind(value as BoardItemKind);
  }, []);

  const handleAddKindChange = useCallback((next: string) => {
    setAddKind(next as BoardItemKind);
  }, []);

  const boardLabels = useMemo(
    () => ({
      dragDropHint: t("meetingBoard.dragDropHint"),
      editCard: t("meetingBoard.editCard"),
      deleteCard: t("meetingBoard.deleteCard"),
      complete: t("meetingBoard.completeAria"),
      incomplete: t("meetingBoard.incompleteAria"),
    }),
    [t],
  );

  return (
    <div className={`meeting-board-panel ${readOnly ? "board-readonly" : ""}`}>
      {/* Board Top Header */}
      <div className="board-top-bar">
        <div className="board-top-info">
          <div className="board-title-group">
            <Columns3 size={18} className="board-header-icon" />
            <h2 className="board-main-title">{t("meetingBoard.label")}</h2>
          </div>
          <span className="board-items-badge">
            {t("meetingBoard.totalCards", { count: items.length })}
          </span>
        </div>

        <div className="board-top-actions">
          <span className="board-hint-text">{t("meetingBoard.boardHint")}</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            ref={addButtonRef}
            disabled={readOnly}
            onClick={() => openAddModal(window.matchMedia('(max-width: 760px)').matches ? mobileKind : 'agenda')}
          >
            <Plus size={14} />
            <span>{t("meetingBoard.addCard")}</span>
          </button>
        </div>
      </div>

      <p className="room-context-caption">{t("meetingBoard.sessionOnly")}</p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div className="board-mobile-section-picker">
        <SelectMenu
          value={mobileKind}
          label={t("meetingBoard.sectionAria")}
          placeholder={t('meetingBoard.columnAgenda')}
          emptyText="—"
          items={mobileColumnItems}
          onChange={handleMobileKindChange}
        />
      </div>
      {/* Desktop shows all columns; mobile exposes one section without nested scrolling. */}
      <div
        ref={boardGridRef}
        className={`board-columns-grid ${activeDrag ? "board-is-dragging" : ""}`}
        role="region"
        aria-label={t('meetingBoard.label')}
        tabIndex={0}
      >
        {COLUMNS.map((col) => {
          const colItems = itemsByColumn[col.kind];
          const Icon = col.icon;

          return (
            <div
              key={col.kind}
              data-board-column={col.kind}
              data-mobile-selected={mobileKind === col.kind}
              className="board-column"
            >
              {/* Column Header */}
              <div className="column-header">
                <div className="column-title-group">
                  <div className={`column-icon-box col-icon-${col.kind}`}>
                    <Icon size={15} />
                  </div>
                  <div className="column-title-wrap">
                    <h3 className="column-title">{t(col.titleKey)}</h3>
                    <span className="column-subtitle">{t(col.descKey)}</span>
                  </div>
                </div>

                <div className="column-header-actions">
                  <span className="column-count-badge">{colItems.length}</span>
                  <button
                    type="button"
                    className="column-add-btn"
                    disabled={readOnly}
                    onClick={() => openAddModal(col.kind)}
                    title={`${t("meetingBoard.addCard")}: ${t(col.titleKey)}`}
                    aria-label={`${t("meetingBoard.addCard")}: ${t(col.titleKey)}`}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Cards Container */}
              <div className="column-cards-list">
                {colItems.length === 0 ? (
                  <div className="column-empty-placeholder">
                    <p>{t("meetingBoard.emptyColumn")}</p>
                    <button
                      type="button"
                      className="btn-ghost-sm"
                      disabled={readOnly}
                      onClick={() => openAddModal(col.kind)}
                    >
                      <Plus size={12} />
                      <span>{t("meetingBoard.addCard")}</span>
                    </button>
                  </div>
                ) : (
                  colItems.map((item, idx) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      readOnly={readOnly}
                      isDragging={activeDrag?.itemId === item.id}
                      isFirst={idx === 0}
                      isLast={idx === colItems.length - 1}
                      lang={lang}
                      dragDropHint={boardLabels.dragDropHint}
                      editCardLabel={boardLabels.editCard}
                      deleteCardLabel={boardLabels.deleteCard}
                      completeLabel={boardLabels.complete}
                      incompleteLabel={boardLabels.incomplete}
                      moveMenuLabels={moveMenuLabels}
                      columnMoveOptions={columnMoveOptions}
                      onPointerDown={startCardPointerDown}
                      onToggleComplete={handleToggleComplete}
                      onEdit={openEditModal}
                      onDeleteRequest={handleDeleteRequest}
                      onMoveStep={handleMoveStep}
                      onMoveToColumn={handleMoveToColumn}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {activeDrag && (
        <div
          ref={dragPreviewRef}
          className="board-drag-preview"
          aria-hidden="true"
          style={{
            width: `${activeDrag.width}px`,
            transform: `translate3d(${activeDrag.initialX}px, ${activeDrag.initialY}px, 0)`,
          }}
        >
          <div className="board-drag-preview-card">
            <GripVertical size={13} aria-hidden="true" />
            <span className="board-drag-preview-title">{activeDrag.title}</span>
          </div>
          <div ref={dragPreviewHintRef} className="board-drag-preview-hint" />
        </div>
      )}

      <MotionPresence present={!!deleteTarget}>
      {deleteTarget && (
        <ConfirmDialog
          title={t('meetingBoard.deleteConfirmTitle')}
          description={t('meetingBoard.deleteConfirmBody', {
            title: items.find((item) => item.id === deleteTarget)?.title || '',
          })}
          cancelLabel={t('meetingBoard.keepCardButton')}
          confirmLabel={t('meetingBoard.deleteCard')}
          tone="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            handleDeleteItem(deleteTarget)
            setDeleteTarget(null)
          }}
        />
      )}
      </MotionPresence>
      <MotionPresence present={discard}>
      {discard && <ConfirmDialog title={t('meetingBoard.discardModalTitle')} description={t('meetingBoard.discardModalBody')} cancelLabel={t('common.keepEditing')} confirmLabel={t('common.discard')} onCancel={()=>setDiscard(false)} onConfirm={()=>{setShowAddModal(false);setEditingItem(null);setFormTitle('');setFormDesc('');setDiscard(false)}}/>}
      </MotionPresence>
      {/* Add Card Modal */}
      <MotionPresence present={showAddModal && !discard}>
        <div className="modal-overlay" onClick={closeEditor}>
          <section className="modal-card board-card-modal" role="dialog" aria-modal="true" aria-labelledby="board-add-card-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="board-add-card-title">{t("meetingBoard.addCard")}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeEditor}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="form-stack">
              <div className="form-field">
                <label htmlFor="board-card-col-select" className="form-field-label">
                  <span>{t("meetingBoard.sectionField")}</span>
                </label>
                <SelectMenu
                  id="board-card-col-select"
                  value={addKind}
                  items={moveColumnItems}
                  label={t("meetingBoard.sectionField")}
                  placeholder={t("meetingBoard.columnAgenda")}
                  emptyText="—"
                  onChange={handleAddKindChange}
                  renderIcon={renderModalColumnIcon}
                />
              </div>

              <div className="form-field">
                <label htmlFor="board-card-title-input" className="form-field-label">
                  <span>{t("meetingBoard.titleField")}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="board-card-title-input"
                  required
                  maxLength={160}
                  pattern=".*[^ ].*"
                  autoComplete="off"
                  autoFocus
                  type="text"
                  className="input-text"
                  placeholder={t("meetingBoard.titlePlaceholder")}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="board-card-desc-input" className="form-field-label">
                  <span>{t("meetingBoard.detailsField")}</span>
                  <span className="form-optional-tag">({t("meetingBoard.optionalTag")})</span>
                </label>
                <textarea
                  id="board-card-desc-input"
                  className="input-text"
                  rows={3}
                  maxLength={4000}
                  placeholder={t("meetingBoard.descPlaceholder")}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeEditor}
                >
                  {t("meetingBoard.cancel")}
                </button>
                <button type="submit" className="btn btn-primary">
                  {t("meetingBoard.addCard")}
                </button>
              </div>
            </form>
          </section>
        </div>
      </MotionPresence>

      {/* Edit Card Modal */}
      <MotionPresence present={!!editingItem && !discard}>
      {editingItem && !discard && (
        <div className="modal-overlay" onClick={closeEditor}>
          <section className="modal-card board-card-modal" role="dialog" aria-modal="true" aria-labelledby="board-edit-card-title" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="board-edit-card-title">{t("meetingBoard.editCard")}</h3>
              <button
                type="button"
                className="btn-icon"
                onClick={closeEditor}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="form-stack">
              <div className="form-field">
                <label htmlFor="board-card-edit-title" className="form-field-label">
                  <span>{t("meetingBoard.titleField")}</span>
                  <span className="form-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="board-card-edit-title"
                  required
                  maxLength={160}
                  pattern=".*[^ ].*"
                  autoComplete="off"
                  autoFocus
                  type="text"
                  className="input-text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="board-card-edit-desc" className="form-field-label">
                  <span>{t("meetingBoard.detailsField")}</span>
                  <span className="form-optional-tag">({t("meetingBoard.optionalTag")})</span>
                </label>
                <textarea
                  id="board-card-edit-desc"
                  className="input-text"
                  rows={4}
                  maxLength={4000}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeEditor}
                >
                  {t("meetingBoard.cancel")}
                </button>
                <button type="submit" className="btn btn-primary">
                  {t("meetingBoard.save")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      </MotionPresence>
    </div>
  );
})
