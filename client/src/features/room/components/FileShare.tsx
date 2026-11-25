import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload, Download, FileText, RotateCcw, ShieldCheck, X } from "lucide-react";
import {
  MAX_FILE_SIZE,
  CHUNK_SIZE,
  MAX_ACTIVE_TRANSFERS,
  MAX_BUFFERED_AMOUNT,
  FILE_ACK_TIMEOUT_MS,
  RESUMABLE_TRANSFER_TTL_MS,
  fileSizeIssue,
  formatBytes,
  base64ToUint8Array,
  uint8ArrayToBase64,
  streamFileSlices,
  encodeBinaryFileChunk,
  decodeBinaryFileChunk,
  resolveResumeStartChunk,
  shouldFlushInboundProgress,
  createOutboundRecipientState,
  markOutboundEndSent,
  recordOutboundPeerReject,
  recordOutboundPeerAck,
  activePeerIds,
  evaluateOutboundTransferResolution,
  type InboundTransfer,
  type OutboundTransfer,
  type OutboundTransferRecipientState,
  type ReceivedFile,
} from "../../../lib/fileTransfer";
import { IncrementalSha256 } from "../../../lib/sha256";
import { hasMatchingVerifiedPeer, type VerifiedPeerIdentity } from "../../../lib/peerIdentity";
import type { I18nKey } from "../../../i18n";
import { createInboundChunkSink, saveBlobWithFilePicker, type InboundChunkSink } from "../hooks/fileChunkSink";

export type FileShareMessage =
  | {
      type: "file:start";
      transferId: string;
      name: string;
      mimeType: string;
      size: number;
      totalChunks: number;
      resuming?: boolean;
    }
  | {
      type: "file:chunk";
      transferId: string;
      index: number;
      data: string;
    }
  | {
      type: "file:end";
      transferId: string;
      sha256?: string;
    }
  | {
      type: "file:resume";
      transferId: string;
      nextChunkIndex: number;
    }
  | {
      type: "file:ack";
      transferId: string;
    }
  | {
      type: "file:reject";
      transferId: string;
      reason: string;
    };

interface FileShareProps {
  readOnly?: boolean;
  roomId: string;
  peersCount: number;
  onlinePeerIds: Set<string>;
  channelsRef: { current: Map<string, RTCDataChannel> };
  broadcast?: (envelope: FileShareMessage) => void;
  sendDirect: (peerId: string, envelope: FileShareMessage) => void;
  sendBinaryDirect?: (peerId: string, frame: ArrayBuffer) => void;
  registerMessageHandler: (
    handler: (message: FileShareMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void
  ) => () => void;
  registerBinaryHandler?: (
    handler: (frame: ArrayBuffer, peerId: string, verifiedSender: VerifiedPeerIdentity) => void
  ) => () => void;
  onSuccessToast: (message: string) => void;
  onErrorToast: (message: string) => void;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
}

interface InboundSession {
  transfer: InboundTransfer;
  sink: InboundChunkSink | null;
  sinkReady: Promise<InboundChunkSink>;
  receivedIndices: Set<number>;
  hasher: IncrementalSha256;
  nextHashIndex: number;
  pendingHashChunks: Map<number, Uint8Array>;
  writeChain: Promise<void>;
  finalized: boolean;
}

function fileFormatBadge(name: string): string {
  const parts = name.trim().split(".");
  if (parts.length < 2) return "FILE";
  const ext = parts[parts.length - 1].replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return ext ? ext.slice(0, 4) : "FILE";
}

function formatReceivedTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function waitForChannelDrain(channel: RTCDataChannel, timeoutMs = 45): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      channel.removeEventListener?.("bufferedamountlow", finish);
      clearTimeout(timerId);
      resolve();
    };
    const timerId = setTimeout(finish, timeoutMs);
    channel.addEventListener?.("bufferedamountlow", finish, { once: true });
  });
}

export const FileShare = memo(function FileShare({
  readOnly = false,
  roomId,
  peersCount,
  onlinePeerIds,
  channelsRef,
  sendDirect,
  sendBinaryDirect,
  registerMessageHandler,
  registerBinaryHandler,
  onSuccessToast,
  onErrorToast,
  t,
}: FileShareProps) {
  const [fileError, setFileError] = useState("");
  const retryFilesRef = useRef(new Map<string, File>());
  const [retryableIds, setRetryableIds] = useState<string[]>([]);
  const roomRevision = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [outboundTransfers, setOutboundTransfers] = useState<Map<string, OutboundTransfer>>(
    new Map()
  );
  const [inboundTransfers, setInboundTransfers] = useState<Map<string, InboundTransfer>>(
    new Map()
  );
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const inboundSessionsRef = useRef<Map<string, InboundSession>>(new Map());
  const inboundFlushMetaRef = useRef<Map<string, { count: number; atMs: number }>>(new Map());
  const activeOutboundIdsRef = useRef<Set<string>>(new Set());
  const activeTransfersCancelRef = useRef<Set<string>>(new Set());
  const rejectedOutboundIdsRef = useRef<Set<string>>(new Set());
  const outboundRecipientStateRef = useRef<Map<string, OutboundTransferRecipientState>>(new Map());
  const outboundResumeOffsetsRef = useRef<Map<string, Map<string, number>>>(new Map());
  const outboundAckWaitersRef = useRef<
    Map<string, { resolve: (ok: boolean) => void; timerId: ReturnType<typeof setTimeout> }>
  >(new Map());
  const receivedFilesRef = useRef<ReceivedFile[]>([]);
  const completedSinksRef = useRef<InboundChunkSink[]>([]);

  const savePickerSupported =
    typeof window !== "undefined" &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";

  useEffect(() => {
    receivedFilesRef.current = receivedFiles;
  }, [receivedFiles]);

  const inboundKey = (userId: string, transferId: string) => `${userId}:${transferId}`;

  const syncInboundUiMap = useCallback(() => {
    const uiMap = new Map<string, InboundTransfer>();
    inboundSessionsRef.current.forEach((session, key) => {
      uiMap.set(key, { ...session.transfer });
    });
    setInboundTransfers(uiMap);
  }, []);

  // Clean up object URLs, OPFS temp files, and active transfers on room change or unmount.
  useEffect(() => {
    const cancelSet = activeTransfersCancelRef.current;
    const activeOutboundIds = activeOutboundIdsRef.current;
    const rejectedOutboundIds = rejectedOutboundIdsRef.current;
    const lifecycle = roomRevision;
    const retryFiles = retryFilesRef.current;
    const inboundFlushMeta = inboundFlushMetaRef.current;
    const outboundRecipientState = outboundRecipientStateRef.current;
    const outboundResumeOffsets = outboundResumeOffsetsRef.current;
    const outboundAckWaiters = outboundAckWaitersRef.current;

    return () => {
      lifecycle.current++;
      retryFiles.clear();
      activeOutboundIds.forEach((transferId) => cancelSet.add(transferId));
      outboundAckWaiters.forEach((waiter) => {
        clearTimeout(waiter.timerId);
        waiter.resolve(false);
      });
      outboundAckWaiters.clear();
      outboundRecipientState.clear();
      outboundResumeOffsets.clear();
      rejectedOutboundIds.clear();
      inboundSessionsRef.current.forEach((session) => {
        session.pendingHashChunks.clear();
        void session.sinkReady.then((sink) => sink.dispose()).catch(() => {});
      });
      inboundSessionsRef.current = new Map();
      inboundFlushMeta.clear();
      completedSinksRef.current.forEach((sink) => {
        void sink.dispose().catch(() => {});
      });
      completedSinksRef.current = [];
      receivedFilesRef.current.forEach((file) => URL.revokeObjectURL(file.url));
      receivedFilesRef.current = [];
      setOutboundTransfers(new Map());
      setInboundTransfers(new Map());
      setReceivedFiles([]);
    };
  }, [roomId]);

  // Pause resumable inbound transfers (instead of wiping them) when sender leaves briefly,
  // and re-evaluate pending outbound ack/cancel states when peers disconnect.
  useEffect(() => {
    const activeRevision = roomRevision.current;
    const now = Date.now();
    let changed = false;

    for (const [key, session] of inboundSessionsRef.current.entries()) {
      const peerOnline = onlinePeerIds.has(session.transfer.senderPeerId);
      if (!peerOnline && !session.transfer.paused) {
        if (
          session.transfer.contiguousChunks > 0 &&
          now - session.transfer.startedAt < RESUMABLE_TRANSFER_TTL_MS
        ) {
          session.transfer.paused = true;
          changed = true;
        } else {
          inboundSessionsRef.current.delete(key);
          inboundFlushMetaRef.current.delete(key);
          session.pendingHashChunks.clear();
          void session.sinkReady.then((sink) => sink.dispose()).catch(() => {});
          changed = true;
        }
      }
    }

    if (changed) {
      queueMicrotask(() => {
        if (roomRevision.current === activeRevision) {
          syncInboundUiMap();
        }
      });
    }

    const activeOpenIds = new Set<string>();
    channelsRef.current.forEach((channel, peerId) => {
      if (channel.readyState === "open" && onlinePeerIds.has(peerId)) {
        activeOpenIds.add(peerId);
      }
    });
    outboundAckWaitersRef.current.forEach((waiter, transferId) => {
      const state = outboundRecipientStateRef.current.get(transferId);
      if (!state) return;
      const resolution = evaluateOutboundTransferResolution(state, activeOpenIds);
      if (resolution === "completed" || resolution === "failed") {
        clearTimeout(waiter.timerId);
        outboundAckWaitersRef.current.delete(transferId);
        waiter.resolve(resolution === "completed");
      }
    });
  }, [onlinePeerIds, channelsRef, syncInboundUiMap]);

  const ingestInboundChunk = useCallback(
    (peerId: string, verifiedUserId: string, transferId: string, index: number, chunkBytes: Uint8Array) => {
      const key = inboundKey(verifiedUserId, transferId);
      const session = inboundSessionsRef.current.get(key);
      if (!session || session.finalized) return;

      const transfer = session.transfer;
      if (transfer.senderPeerId !== peerId) return;
      if (index < 0 || index >= transfer.totalChunks) return;

      const maxChunkBytes =
        index === transfer.totalChunks - 1
          ? transfer.size - CHUNK_SIZE * (transfer.totalChunks - 1)
          : CHUNK_SIZE;
      if (chunkBytes.byteLength > maxChunkBytes || session.receivedIndices.has(index)) return;
      if (transfer.receivedBytes + chunkBytes.byteLength > transfer.size) return;

      session.receivedIndices.add(index);
      transfer.receivedCount = session.receivedIndices.size;
      transfer.receivedBytes += chunkBytes.byteLength;
      transfer.paused = false;
      while (session.receivedIndices.has(transfer.contiguousChunks)) {
        transfer.contiguousChunks += 1;
      }

      // Copy slice before async write so WebRTC buffer reuse cannot mutate queued bytes.
      const copy = new Uint8Array(chunkBytes);
      if (index === session.nextHashIndex) {
        session.hasher.update(copy);
        session.nextHashIndex += 1;
        while (session.pendingHashChunks.has(session.nextHashIndex)) {
          const buffered = session.pendingHashChunks.get(session.nextHashIndex)!;
          session.pendingHashChunks.delete(session.nextHashIndex);
          session.hasher.update(buffered);
          session.nextHashIndex += 1;
        }
      } else if (index > session.nextHashIndex) {
        session.pendingHashChunks.set(index, copy);
      }

      const byteOffset = index * CHUNK_SIZE;
      session.writeChain = session.writeChain
        .then(async () => {
          const sink = session.sink ?? (await session.sinkReady);
          session.sink = sink;
          transfer.storageMode = sink.mode;
          await sink.writeChunk(index, byteOffset, copy);
        })
        .catch(() => {
          /* Handled at finalize verification. */
        });

      const nowMs = Date.now();
      const meta = inboundFlushMetaRef.current.get(key) ?? {
        count: 0,
        atMs: transfer.startedAt,
      };
      if (
        shouldFlushInboundProgress({
          receivedCount: transfer.receivedCount,
          totalChunks: transfer.totalChunks,
          lastFlushedCount: meta.count,
          lastFlushedAtMs: meta.atMs,
          nowMs,
        })
      ) {
        inboundFlushMetaRef.current.set(key, {
          count: transfer.receivedCount,
          atMs: nowMs,
        });
        syncInboundUiMap();
      }
    },
    [syncInboundUiMap],
  );

  // Handle incoming binary ArrayBuffer file chunk frames
  useEffect(() => {
    if (!registerBinaryHandler) return;
    return registerBinaryHandler((frame, peerId, verifiedSender) => {
      if (!hasMatchingVerifiedPeer(verifiedSender, peerId)) return;
      const decoded = decodeBinaryFileChunk(frame);
      if (!decoded) return;
      ingestInboundChunk(peerId, verifiedSender.userId, decoded.transferId, decoded.index, decoded.data);
    });
  }, [registerBinaryHandler, ingestInboundChunk]);

  // Handle incoming JSON DataChannel control messages
  useEffect(() => {
    const getOpenPeerIds = () => {
      const openIds = new Set<string>();
      channelsRef.current.forEach((channel, id) => {
        if (channel.readyState === "open") {
          openIds.add(id);
        }
      });
      return openIds;
    };

    const settleAckWaiter = (transferId: string, ok: boolean) => {
      const waiter = outboundAckWaitersRef.current.get(transferId);
      if (!waiter) return;
      clearTimeout(waiter.timerId);
      outboundAckWaitersRef.current.delete(transferId);
      waiter.resolve(ok);
    };

    const unregister = registerMessageHandler((message, peerId, verifiedSender) => {
      if (!hasMatchingVerifiedPeer(verifiedSender, peerId)) {
        return;
      }
      switch (message.type) {
        case "file:start": {
          const { transferId, name, mimeType, size, totalChunks, resuming } = message;

          if (
            typeof transferId !== "string" ||
            !transferId ||
            typeof size !== "number" ||
            size <= 0 ||
            size > MAX_FILE_SIZE ||
            typeof totalChunks !== "number" ||
            !Number.isInteger(totalChunks) ||
            totalChunks <= 0 ||
            totalChunks !== Math.ceil(size / CHUNK_SIZE) ||
            typeof name !== "string" ||
            name.length === 0 ||
            name.length > 150 ||
            typeof mimeType !== "string" ||
            mimeType.length > 120
          ) {
            sendDirect(peerId, {
              type: "file:reject",
              transferId: typeof transferId === "string" ? transferId : "",
              reason: t("fileShare.rejectInvalid"),
            });
            break;
          }

          const key = inboundKey(verifiedSender.userId, transferId);
          const existingSession = inboundSessionsRef.current.get(key);

          // Resume existing partial transfer from the same verified userId
          if (
            resuming &&
            existingSession &&
            !existingSession.finalized &&
            existingSession.transfer.size === size &&
            existingSession.transfer.totalChunks === totalChunks
          ) {
            existingSession.transfer.senderPeerId = peerId;
            existingSession.transfer.paused = false;
            syncInboundUiMap();
            sendDirect(peerId, {
              type: "file:resume",
              transferId,
              nextChunkIndex: existingSession.transfer.contiguousChunks,
            });
            break;
          }

          if (inboundSessionsRef.current.size >= MAX_ACTIVE_TRANSFERS && !existingSession) {
            sendDirect(peerId, {
              type: "file:reject",
              transferId,
              reason: t("fileShare.rejectTooMany"),
            });
            break;
          }

          if (existingSession) {
            existingSession.pendingHashChunks.clear();
            void existingSession.sinkReady.then((sink) => sink.dispose()).catch(() => {});
          }

          const startedAt = Date.now();
          const newInbound: InboundTransfer = {
            transferId,
            name: name.slice(0, 150),
            mimeType: mimeType || "application/octet-stream",
            size,
            totalChunks,
            senderPeerId: peerId,
            senderUserId: verifiedSender.userId,
            receivedCount: 0,
            contiguousChunks: 0,
            receivedBytes: 0,
            startedAt,
            paused: false,
          };

          const sinkReady = createInboundChunkSink(key, totalChunks).then((sink) => {
            newInbound.storageMode = sink.mode;
            return sink;
          });

          const session: InboundSession = {
            transfer: newInbound,
            sink: null,
            sinkReady,
            receivedIndices: new Set(),
            hasher: new IncrementalSha256(),
            nextHashIndex: 0,
            pendingHashChunks: new Map(),
            writeChain: Promise.resolve(),
            finalized: false,
          };

          inboundSessionsRef.current.set(key, session);
          inboundFlushMetaRef.current.set(key, { count: 0, atMs: startedAt });
          syncInboundUiMap();
          break;
        }

        case "file:chunk": {
          const { transferId, index, data } = message;
          if (typeof index !== "number" || typeof data !== "string") break;
          if (data.length > Math.ceil((CHUNK_SIZE * 4) / 3) + 16) break;
          try {
            const chunkBytes = base64ToUint8Array(data);
            ingestInboundChunk(peerId, verifiedSender.userId, transferId, index, chunkBytes);
          } catch {
            /* Ignore malformed base64 chunk. */
          }
          break;
        }

        case "file:end": {
          const { transferId, sha256: expectedSha256 } = message;
          const key = inboundKey(verifiedSender.userId, transferId);
          const session = inboundSessionsRef.current.get(key);
          if (!session || session.finalized) break;
          session.finalized = true;
          const transfer = session.transfer;
          const revisionAtEnd = roomRevision.current;

          void (async () => {
            try {
              await session.writeChain;
              const sink = session.sink ?? (await session.sinkReady);
              session.sink = sink;

              if (session.receivedIndices.size !== transfer.totalChunks) {
                throw new Error("Incomplete chunks");
              }

              const actualSha256 = session.hasher.digestHex();
              if (
                typeof expectedSha256 === "string" &&
                expectedSha256.trim() &&
                actualSha256 !== expectedSha256.trim().toLowerCase()
              ) {
                await sink.dispose();
                if (roomRevision.current !== revisionAtEnd) return;
                sendDirect(peerId, {
                  type: "file:reject",
                  transferId,
                  reason: t("fileShare.sha256Mismatch", { name: transfer.name }),
                });
                onErrorToast(t("fileShare.sha256Mismatch", { name: transfer.name }));
                return;
              }

              const blob = await sink.finalize(transfer.size, transfer.mimeType);
              if (roomRevision.current !== revisionAtEnd) {
                await sink.dispose();
                return;
              }

              completedSinksRef.current.push(sink);
              const url = URL.createObjectURL(blob);
              const completedFile: ReceivedFile = {
                transferId,
                name: transfer.name,
                mimeType: transfer.mimeType,
                size: transfer.size,
                url,
                receivedAt: Date.now(),
                sha256: actualSha256,
                blob,
                storageMode: sink.mode,
              };

              setReceivedFiles((prev) => [completedFile, ...prev]);
              sendDirect(peerId, { type: "file:ack", transferId });
              onSuccessToast(
                t("fileShare.receiveSuccess", {
                  name: transfer.name,
                  size: formatBytes(transfer.size),
                }),
              );
            } catch {
              if (session.sink) {
                await session.sink.dispose().catch(() => {});
              } else {
                await session.sinkReady.then((s) => s.dispose()).catch(() => {});
              }
              if (roomRevision.current !== revisionAtEnd) return;
              sendDirect(peerId, {
                type: "file:reject",
                transferId,
                reason: t("fileShare.transferFailed", { name: transfer.name }),
              });
              onErrorToast(t("fileShare.transferFailed", { name: transfer.name }));
            } finally {
              session.pendingHashChunks.clear();
              inboundFlushMetaRef.current.delete(key);
              inboundSessionsRef.current.delete(key);
              if (roomRevision.current === revisionAtEnd) {
                syncInboundUiMap();
              }
            }
          })();
          break;
        }

        case "file:resume": {
          const { transferId, nextChunkIndex } = message;
          if (typeof transferId !== "string" || typeof nextChunkIndex !== "number") break;
          const map = outboundResumeOffsetsRef.current.get(transferId);
          if (map) {
            map.set(peerId, Math.max(0, Math.floor(nextChunkIndex)));
          }
          break;
        }

        case "file:ack": {
          const { transferId } = message;
          if (typeof transferId !== "string" || !transferId) break;
          const currentState = outboundRecipientStateRef.current.get(transferId);
          if (!currentState) break;
          const nextState = recordOutboundPeerAck(currentState, peerId);
          outboundRecipientStateRef.current.set(transferId, nextState);

          if (evaluateOutboundTransferResolution(nextState, getOpenPeerIds()) === "completed") {
            settleAckWaiter(transferId, true);
          }
          break;
        }

        case "file:reject": {
          const { transferId } = message;
          if (typeof transferId !== "string" || !transferId) break;
          const currentState = outboundRecipientStateRef.current.get(transferId);
          if (!currentState) break;
          const nextState = recordOutboundPeerReject(currentState, peerId);
          if (nextState === currentState) break;
          outboundRecipientStateRef.current.set(transferId, nextState);

          const resolution = evaluateOutboundTransferResolution(nextState, getOpenPeerIds());
          if (resolution === "completed") {
            settleAckWaiter(transferId, true);
            break;
          }
          if (resolution === "failed") {
            rejectedOutboundIdsRef.current.add(transferId);
            activeTransfersCancelRef.current.add(transferId);
            settleAckWaiter(transferId, false);
            setOutboundTransfers((prev) => {
              const transfer = prev.get(transferId);
              if (!transfer) return prev;
              return new Map(prev).set(transferId, {
                ...transfer,
                status: "failed",
                resumable: transfer.sentChunks > 0 && transfer.sentChunks < transfer.totalChunks,
              });
            });
            setFileError(t("fileShare.peerRejected"));
            onErrorToast(t("fileShare.peerRejected"));
          }
          break;
        }
      }
    });

    return () => unregister();
  }, [registerMessageHandler, sendDirect, channelsRef, ingestInboundChunk, syncInboundUiMap, onSuccessToast, onErrorToast, t]);

  const handleSendFile = async (file: File, resumeTransferId?: string) => {
    if (readOnly) return;
    const revision = roomRevision.current;
    const fail = (message: string) => {
      setFileError(message);
      onErrorToast(message);
    };
    setFileError("");
    const sizeIssue = fileSizeIssue(file.size);
    if (sizeIssue === "empty") {
      fail(t("fileShare.fileEmpty"));
      return;
    }
    if (sizeIssue === "too-large") {
      fail(
        t("fileShare.fileTooLarge", {
          size: formatBytes(file.size),
        }),
      );
      return;
    }

    const getOpenPeerIds = () => {
      const openIds = new Set<string>();
      channelsRef.current.forEach((channel, id) => {
        if (channel.readyState === "open") {
          openIds.add(id);
        }
      });
      return openIds;
    };

    const initialOpenPeers = getOpenPeerIds();
    if (initialOpenPeers.size === 0) {
      fail(t("fileShare.noPeersWarning"));
      return;
    }

    if (activeOutboundIdsRef.current.size >= MAX_ACTIVE_TRANSFERS) {
      fail(t("fileShare.tooManyOutbound"));
      return;
    }

    const isResume = Boolean(resumeTransferId);
    const transferId = resumeTransferId ?? crypto.randomUUID();

    if (retryFilesRef.current.size >= MAX_ACTIVE_TRANSFERS && !retryFilesRef.current.has(transferId)) {
      const releasable = Array.from(retryFilesRef.current.keys()).find(
        (id) => !activeOutboundIdsRef.current.has(id),
      );
      if (releasable) retryFilesRef.current.delete(releasable);
    }
    retryFilesRef.current.set(transferId, file);
    setRetryableIds(Array.from(retryFilesRef.current.keys()));
    activeOutboundIdsRef.current.add(transferId);
    activeTransfersCancelRef.current.delete(transferId);
    rejectedOutboundIdsRef.current.delete(transferId);

    const initialRecipientState = createOutboundRecipientState(initialOpenPeers);
    outboundRecipientStateRef.current.set(transferId, initialRecipientState);
    const resumeMap = new Map<string, number>();
    outboundResumeOffsetsRef.current.set(transferId, resumeMap);

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
    const getActiveTargets = () => {
      const state = outboundRecipientStateRef.current.get(transferId);
      if (!state) return [];
      return activePeerIds(state, getOpenPeerIds());
    };

    const outbound: OutboundTransfer = {
      transferId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      totalChunks,
      sentChunks: 0,
      progress: 0,
      status: "sending",
    };

    setOutboundTransfers((prev) => new Map(prev).set(transferId, outbound));

    try {
      const startTargets = getActiveTargets();
      if (startTargets.length === 0) {
        throw new Error("Transfer cancelled");
      }

      for (const peerId of startTargets) {
        sendDirect(peerId, {
          type: "file:start",
          transferId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          totalChunks,
          ...(isResume ? { resuming: true } : {}),
        });
      }

      if (isResume) {
        // Give reconnected peers a short window to report their last contiguous chunk index.
        const waitStart = Date.now();
        while (Date.now() - waitStart < 180) {
          if (startTargets.every((id) => resumeMap.has(id))) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }

      const startChunk = isResume ? resolveResumeStartChunk(resumeMap, startTargets, 0) : 0;
      const hasher = new IncrementalSha256();

      // Hash skipped prefix bytes when resuming from > 0 so final SHA-256 matches full file.
      if (startChunk > 0) {
        const prefixEnd = Math.min(file.size, startChunk * CHUNK_SIZE);
        const hashWindow = 1024 * 1024;
        for (let offset = 0; offset < prefixEnd; offset += hashWindow) {
          if (activeTransfersCancelRef.current.has(transferId) || revision !== roomRevision.current) {
            throw new Error("Transfer cancelled");
          }
          const buf = await file.slice(offset, Math.min(prefixEnd, offset + hashWindow)).arrayBuffer();
          hasher.update(new Uint8Array(buf));
        }
      }

      let lastUiFlushAt = 0;
      await streamFileSlices(file, startChunk, async (index, total, bytes) => {
        if (activeTransfersCancelRef.current.has(transferId) || getActiveTargets().length === 0) {
          throw new Error("Transfer cancelled");
        }

        // Event-driven backpressure via bufferedamountlow
        const startedWaiting = Date.now();
        while (true) {
          const congestedPeer = getActiveTargets().find((peerId) => {
            const channel = channelsRef.current.get(peerId);
            return channel && channel.readyState === "open" && channel.bufferedAmount > MAX_BUFFERED_AMOUNT;
          });
          if (!congestedPeer) break;
          if (
            activeTransfersCancelRef.current.has(transferId) ||
            Date.now() - startedWaiting > 15_000
          ) {
            throw new Error("Transfer cancelled");
          }
          const ch = channelsRef.current.get(congestedPeer);
          if (ch) {
            await waitForChannelDrain(ch, 45);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
        }

        const chunkTargets = getActiveTargets();
        if (activeTransfersCancelRef.current.has(transferId) || chunkTargets.length === 0) {
          throw new Error("Transfer cancelled");
        }

        hasher.update(bytes);

        if (sendBinaryDirect) {
          const frame = encodeBinaryFileChunk(transferId, index, bytes);
          for (const peerId of chunkTargets) {
            sendBinaryDirect(peerId, frame);
          }
        } else {
          const base64Data = uint8ArrayToBase64(bytes);
          for (const peerId of chunkTargets) {
            sendDirect(peerId, {
              type: "file:chunk",
              transferId,
              index,
              data: base64Data,
            });
          }
        }

        const nowMs = Date.now();
        if (index === 0 || index + 1 === total || nowMs - lastUiFlushAt >= 80) {
          lastUiFlushAt = nowMs;
          const progress = Math.round(((index + 1) / total) * 100);
          setOutboundTransfers((prev) => {
            const current = prev.get(transferId);
            if (!current) return prev;
            return new Map(prev).set(transferId, {
              ...current,
              sentChunks: index + 1,
              progress,
            });
          });
        }
      });

      const endTargets = getActiveTargets();
      if (
        activeTransfersCancelRef.current.has(transferId) ||
        endTargets.length === 0 ||
        revision !== roomRevision.current
      ) {
        throw new Error("Transfer interrupted");
      }

      const fileSha256 = hasher.digestHex();
      const stateWithEndSent = markOutboundEndSent(
        outboundRecipientStateRef.current.get(transferId) ?? initialRecipientState,
      );
      outboundRecipientStateRef.current.set(transferId, stateWithEndSent);

      for (const peerId of endTargets) {
        sendDirect(peerId, {
          type: "file:end",
          transferId,
          sha256: fileSha256,
        });
      }

      const currentAfterEnd = outboundRecipientStateRef.current.get(transferId) ?? stateWithEndSent;
      const immediateResolution = evaluateOutboundTransferResolution(
        currentAfterEnd,
        getOpenPeerIds(),
      );

      let acknowledged = immediateResolution === "completed";
      if (immediateResolution === "pending") {
        acknowledged = await new Promise<boolean>((resolve) => {
          const timerId = setTimeout(() => {
            outboundAckWaitersRef.current.delete(transferId);
            const finalState = outboundRecipientStateRef.current.get(transferId);
            resolve(Boolean(finalState && finalState.ackedPeers.size > 0));
          }, FILE_ACK_TIMEOUT_MS);
          outboundAckWaitersRef.current.set(transferId, { resolve, timerId });
        });
      }

      if (!acknowledged || revision !== roomRevision.current) {
        throw new Error("Transfer not acknowledged");
      }

      setOutboundTransfers((prev) => {
        const current = prev.get(transferId);
        if (!current) return prev;
        return new Map(prev).set(transferId, {
          ...current,
          sentChunks: totalChunks,
          progress: 100,
          status: "completed",
          sha256: fileSha256,
        });
      });

      onSuccessToast(t("fileShare.sendSuccess", { name: file.name }));
    } catch {
      if (revision !== roomRevision.current) return;
      setOutboundTransfers((prev) => {
        const current = prev.get(transferId);
        if (!current) return prev;
        return new Map(prev).set(transferId, {
          ...current,
          status: "failed",
          resumable: current.sentChunks > 0 && current.sentChunks < current.totalChunks,
        });
      });
      if (!rejectedOutboundIdsRef.current.has(transferId)) {
        fail(t("fileShare.transferFailed", { name: file.name }));
      }
    } finally {
      const pendingWaiter = outboundAckWaitersRef.current.get(transferId);
      if (pendingWaiter) {
        clearTimeout(pendingWaiter.timerId);
        outboundAckWaitersRef.current.delete(transferId);
      }
      outboundRecipientStateRef.current.delete(transferId);
      outboundResumeOffsetsRef.current.delete(transferId);
      rejectedOutboundIdsRef.current.delete(transferId);
      activeOutboundIdsRef.current.delete(transferId);
      activeTransfersCancelRef.current.delete(transferId);
    }
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      void handleSendFile(files[0]);
    }
    event.target.value = "";
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (readOnly) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void handleSendFile(files[0]);
    }
  };

  return (
    <section className="file-share-panel" aria-label={t("fileShare.title")}>
      <div className="file-share-header">
        <div>
          <p className="eyebrow"><span className="eyebrow-num" aria-hidden="true">05 /</span>{t("fileShare.title")}</p>
          <h2>{readOnly ? t("tabs.files") : t("fileShare.dropOrSelect")}</h2>
          <p className="file-limit-hint">{readOnly ? t("room.readonlyActionBlocked") : t("fileShare.fileHelp")}</p>
        </div>
        <div className="file-action-buttons" hidden={readOnly}>
          <input
            ref={fileInputRef}
            type="file"
            className="file-hidden-input"
            aria-label={t("fileShare.selectButton")}
            disabled={readOnly || peersCount === 0}
            onChange={onFileInputChange}
          />
          <button
            type="button"
            className="file-select-btn"
            disabled={readOnly || peersCount === 0}
            aria-describedby="room-file-hint"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} />
            <span>{t("fileShare.selectButton")}</span>
          </button>
        </div>
      </div>

      {/* Drag & Drop Target Area */}
      <div
        hidden={readOnly}
        className={`file-drop-zone ${isDragging ? "active" : ""}`}
        data-disabled={peersCount === 0 ? "true" : undefined}
        onClick={() => {
          if (!readOnly && peersCount > 0) fileInputRef.current?.click();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="file-drop-art" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="drop-hint" id="room-file-hint">
          {isDragging
            ? t("fileShare.dropActive")
            : peersCount === 0
            ? t("fileShare.noPeersWarning")
            : t("fileShare.dropIdle")}
        </p>
      </div>
      {fileError && <p className="form-error" role="alert">{fileError}</p>}

      {/* Active Outbound Transfers */}
      {outboundTransfers.size > 0 && (
        <div className="transfers-list">
          <p className="eyebrow">{t("fileShare.sendingTitle")}</p>
          {Array.from(outboundTransfers.values()).map((transfer) => {
            const isVerifying =
              transfer.status === "sending" && transfer.sentChunks >= transfer.totalChunks;
            return (
              <article key={transfer.transferId} className="transfer-card">
                <div className="transfer-meta">
                  <span className="transfer-name">{transfer.name}</span>
                  <div className="transfer-meta-right">
                    <span className="transfer-size">{formatBytes(transfer.size)}</span>
                    {(transfer.status === "completed" || transfer.status === "failed") && (
                      <button
                        type="button"
                        className="btn-icon transfer-dismiss-btn"
                        aria-label={t("fileShare.dismissTransferAria", { name: transfer.name })}
                        title={t("fileShare.dismissTransferAria", { name: transfer.name })}
                        onClick={() => {
                          retryFilesRef.current.delete(transfer.transferId);
                          setRetryableIds(Array.from(retryFilesRef.current.keys()));
                          setOutboundTransfers((previous) => {
                            const next = new Map(previous);
                            next.delete(transfer.transferId);
                            return next;
                          });
                        }}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="progress-bar-track" role="progressbar" aria-label={transfer.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={transfer.progress}>
                  <div
                    className={`progress-bar-fill ${transfer.status}${isVerifying ? " verifying" : ""}`}
                    style={{ width: `${transfer.progress}%` }}
                  />
                </div>
                <div className="transfer-footer">
                  <small>
                    {transfer.status === "completed"
                      ? t("fileShare.localSent")
                      : transfer.status === "failed"
                      ? t("fileShare.sendingFailed")
                      : isVerifying
                      ? t("fileShare.verifyingDelivery")
                      : `${transfer.progress}%`}
                  </small>
                  {transfer.status === "failed" && (
                    <div className="file-retry">
                      <span>{t("fileShare.retryHint")}</span>
                      {retryableIds.includes(transfer.transferId) && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={readOnly || peersCount === 0}
                          onClick={() => {
                            const file = retryFilesRef.current.get(transfer.transferId);
                            if (!file) return;
                            void handleSendFile(file, transfer.resumable ? transfer.transferId : undefined);
                          }}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                          <span>{transfer.resumable ? t("fileShare.resumeButton") : t("fileShare.retryButton")}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Active Inbound Transfers */}
      {inboundTransfers.size > 0 && (
        <div className="transfers-list">
          <p className="eyebrow">{t("fileShare.receivingTitle")}</p>
          {Array.from(inboundTransfers.values()).map((transfer) => {
            const progress = Math.round(
              (transfer.receivedCount / transfer.totalChunks) * 100
            );
            return (
              <article key={`${transfer.senderUserId}:${transfer.transferId}`} className="transfer-card">
                <div className="transfer-meta">
                  <span className="transfer-name">{transfer.name}</span>
                  <span className="transfer-size">
                    {formatBytes(transfer.receivedBytes)} / {formatBytes(transfer.size)}
                  </span>
                </div>
                <div className="progress-bar-track" role="progressbar" aria-label={transfer.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                  <div
                    className="progress-bar-fill receiving"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="transfer-footer">
                  <small className={transfer.paused ? "transfer-paused-hint" : undefined}>
                    {transfer.paused ? t("fileShare.pausedWaitingResume", { pct: progress }) : `${progress}%`}
                  </small>
                  {transfer.storageMode === "disk-opfs" && (
                    <span className="received-file-disk-badge">{t("fileShare.diskStreamBadge")}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Completed Received Files */}
      <div className="received-files-section">
        <p className="eyebrow">
          {t("fileShare.receivedTitle", { count: receivedFiles.length })}
        </p>
        {receivedFiles.length === 0 ? (
          <p className="empty small">{t("fileShare.emptyReceived")}</p>
        ) : (
          <div className="received-files-grid">
            {receivedFiles.map((file) => (
              <article key={file.transferId} className="received-file-card">
                <div className="received-file-icon">
                  <FileText size={20} />
                </div>
                <div className="received-file-details">
                  <strong className="received-file-title" title={file.name}>
                    {file.name}
                  </strong>
                  <div className="received-file-meta">
                    <span className="received-file-badge">{fileFormatBadge(file.name)}</span>
                    <span className="received-file-size">{formatBytes(file.size)}</span>
                    <span className="received-file-time">{formatReceivedTime(file.receivedAt)}</span>
                    {file.storageMode === "disk-opfs" && (
                      <span className="received-file-disk-badge">{t("fileShare.diskStreamBadge")}</span>
                    )}
                    {file.sha256 && (
                      <span className="received-file-sha" title={file.sha256}>
                        <ShieldCheck size={12} aria-hidden="true" />
                        <span>{t("fileShare.sha256Badge", { shortHash: file.sha256.slice(0, 8) })}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="received-file-actions">
                  {savePickerSupported && file.blob && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void saveBlobWithFilePicker(file.blob!, file.name)}
                    >
                      <span>{t("fileShare.saveToDiskButton")}</span>
                    </button>
                  )}
                  <a
                    href={file.url}
                    download={file.name}
                    className="download-file-btn"
                    title={`${t("fileShare.downloadButton")} ${file.name}`}
                    aria-label={`${t("fileShare.downloadButton")}: ${file.name}`}
                  >
                    <Download size={13} />
                    <span>{t("fileShare.downloadButton")}</span>
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
})
