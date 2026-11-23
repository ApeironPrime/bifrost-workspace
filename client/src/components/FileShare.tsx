import { memo, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Upload, Download, FileText, X } from "lucide-react";
import {
  MAX_FILE_SIZE,
  CHUNK_SIZE,
  MAX_ACTIVE_TRANSFERS,
  FILE_ACK_TIMEOUT_MS,
  fileSizeIssue,
  formatBytes,
  base64ToUint8Array,
  splitFileIntoChunks,
  reassembleChunks,
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
} from "../lib/fileTransfer";
import { hasMatchingVerifiedPeer, type VerifiedPeerIdentity } from "../lib/peerIdentity";
import type { I18nKey } from "../i18n";

export type FileShareMessage =
  | {
      type: "file:start";
      transferId: string;
      name: string;
      mimeType: string;
      size: number;
      totalChunks: number;
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
  registerMessageHandler: (
    handler: (message: FileShareMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void
  ) => () => void;
  onSuccessToast: (message: string) => void;
  onErrorToast: (message: string) => void;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
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

export const FileShare = memo(function FileShare({
  readOnly = false,
  roomId,
  peersCount,
  onlinePeerIds,
  channelsRef,
  sendDirect,
  registerMessageHandler,
  onSuccessToast,
  onErrorToast,
  t,
}: FileShareProps) {
  const [fileError, setFileError] = useState('');
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

  const inboundRef = useRef<Map<string, InboundTransfer>>(new Map());
  const inboundFlushMetaRef = useRef<Map<string, { count: number; atMs: number }>>(new Map());
  const activeOutboundIdsRef = useRef<Set<string>>(new Set());
  const activeTransfersCancelRef = useRef<Set<string>>(new Set());
  const rejectedOutboundIdsRef = useRef<Set<string>>(new Set());
  const outboundRecipientStateRef = useRef<Map<string, OutboundTransferRecipientState>>(new Map());
  const outboundAckWaitersRef = useRef<
    Map<string, { resolve: (ok: boolean) => void; timerId: ReturnType<typeof setTimeout> }>
  >(new Map());
  const receivedFilesRef = useRef<ReceivedFile[]>([]);

  useEffect(() => {
    receivedFilesRef.current = receivedFiles;
  }, [receivedFiles]);

  const inboundKey = (peerId: string, transferId: string) => `${peerId}:${transferId}`;

  // Clean up object URLs and state on room change or unmount.
  // Mark pending send loops as cancelled before state is reset, otherwise a
  // file selected in an old room can continue into the next room.
  useEffect(() => {
    const cancelSet = activeTransfersCancelRef.current;
    const activeOutboundIds = activeOutboundIdsRef.current;
    const rejectedOutboundIds = rejectedOutboundIdsRef.current;
    const lifecycle = roomRevision;
    const retryFiles = retryFilesRef.current;
    const inboundFlushMeta = inboundFlushMetaRef.current;
    const outboundRecipientState = outboundRecipientStateRef.current;
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
      rejectedOutboundIds.clear();
      inboundRef.current.forEach((transfer) => transfer.receivedChunks.clear());
      inboundRef.current = new Map();
      inboundFlushMeta.clear();
      receivedFilesRef.current.forEach((file) => URL.revokeObjectURL(file.url));
      receivedFilesRef.current = [];
      setOutboundTransfers(new Map());
      setInboundTransfers(new Map());
      setReceivedFiles([]);
    };
  }, [roomId]);

  // Drop incomplete inbound files as soon as their sender leaves the room, and
  // re-evaluate pending outbound ack/cancel states when room peers disconnect.
  useEffect(() => {
    const activeRevision = roomRevision.current;
    let inboundChanged = false;
    const nextInbound = new Map<string, InboundTransfer>();
    for (const [key, transfer] of inboundRef.current.entries()) {
      if (onlinePeerIds.has(transfer.senderPeerId)) {
        nextInbound.set(key, transfer);
      } else {
        inboundChanged = true;
        transfer.receivedChunks.clear();
        inboundFlushMetaRef.current.delete(key);
      }
    }
    if (inboundChanged) {
      inboundRef.current = nextInbound;
      queueMicrotask(() => {
        if (roomRevision.current === activeRevision) {
          setInboundTransfers(new Map(inboundRef.current));
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
  }, [onlinePeerIds, channelsRef]);

  // Handle incoming DataChannel file messages
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
          const { transferId, name, mimeType, size, totalChunks } = message;

          // Security and sanity checks
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

          const key = inboundKey(peerId, transferId);
          if (inboundRef.current.size >= MAX_ACTIVE_TRANSFERS && !inboundRef.current.has(key)) {
            sendDirect(peerId, {
              type: "file:reject",
              transferId,
              reason: t("fileShare.rejectTooMany"),
            });
            break;
          }

          inboundRef.current.get(key)?.receivedChunks.clear();

          const startedAt = Date.now();
          const newInbound: InboundTransfer = {
            transferId,
            name: (typeof name === "string" ? name : "shared_file").slice(0, 150),
            mimeType: typeof mimeType === "string" ? mimeType : "application/octet-stream",
            size,
            totalChunks,
            senderPeerId: peerId,
            receivedChunks: new Map(),
            receivedBytes: 0,
            startedAt,
          };

          inboundFlushMetaRef.current.set(key, { count: 0, atMs: startedAt });
          const next = new Map(inboundRef.current).set(key, newInbound);
          // Update the ref synchronously. WebRTC messages can arrive before a
          // React effect has mirrored the setState call.
          inboundRef.current = next;
          setInboundTransfers(next);
          break;
        }

        case "file:chunk": {
          const { transferId, index, data } = message;
          const key = inboundKey(peerId, transferId);
          const transfer = inboundRef.current.get(key);
          if (!transfer || typeof index !== "number" || typeof data !== "string") {
            break;
          }

          if (index < 0 || index >= transfer.totalChunks) {
            break;
          }

          if (data.length > Math.ceil(CHUNK_SIZE * 4 / 3) + 8) break;

          try {
            const chunkBytes = base64ToUint8Array(data);
            const maxChunkBytes = index === transfer.totalChunks - 1
              ? transfer.size - CHUNK_SIZE * (transfer.totalChunks - 1)
              : CHUNK_SIZE;
            if (chunkBytes.byteLength > maxChunkBytes || transfer.receivedChunks.has(index)) break;
            if (transfer.receivedBytes + chunkBytes.byteLength > transfer.size) break;

            transfer.receivedChunks.set(index, chunkBytes);
            transfer.receivedBytes += chunkBytes.byteLength;

            const nowMs = Date.now();
            const meta = inboundFlushMetaRef.current.get(key) ?? {
              count: 0,
              atMs: transfer.startedAt,
            };
            if (
              shouldFlushInboundProgress({
                receivedCount: transfer.receivedChunks.size,
                totalChunks: transfer.totalChunks,
                lastFlushedCount: meta.count,
                lastFlushedAtMs: meta.atMs,
                nowMs,
              })
            ) {
              inboundFlushMetaRef.current.set(key, {
                count: transfer.receivedChunks.size,
                atMs: nowMs,
              });
              const next = new Map(inboundRef.current).set(key, { ...transfer });
              inboundRef.current = next;
              setInboundTransfers(next);
            }
          } catch {
            // Malformed base64 chunk, ignore
          }
          break;
        }

        case "file:end": {
          const { transferId } = message;
          const key = inboundKey(peerId, transferId);
          const transfer = inboundRef.current.get(key);
          if (!transfer) break;

          if (transfer.receivedChunks.size === transfer.totalChunks) {
            try {
              const blob = reassembleChunks(
                transfer.receivedChunks,
                transfer.totalChunks,
                transfer.mimeType,
                { clearChunks: true },
              );
              if (blob.size !== transfer.size) throw new Error("File size mismatch");
              const url = URL.createObjectURL(blob);
              const completedFile: ReceivedFile = {
                transferId,
                name: transfer.name,
                mimeType: transfer.mimeType,
                size: transfer.size,
                url,
                receivedAt: Date.now(),
              };

              setReceivedFiles((prev) => [completedFile, ...prev]);
              sendDirect(peerId, { type: "file:ack", transferId });
              onSuccessToast(
                t("fileShare.receiveSuccess", {
                  name: transfer.name,
                  size: formatBytes(transfer.size),
                })
              );
            } catch {
              transfer.receivedChunks.clear();
              sendDirect(peerId, {
                type: "file:reject",
                transferId,
                reason: t("fileShare.transferFailed", { name: transfer.name }),
              });
              onErrorToast(t("fileShare.transferFailed", { name: transfer.name }));
            }
          } else {
            transfer.receivedChunks.clear();
            sendDirect(peerId, {
              type: "file:reject",
              transferId,
              reason: t("fileShare.transferFailed", { name: transfer.name }),
            });
            onErrorToast(t("fileShare.transferFailed", { name: transfer.name }));
          }

          inboundFlushMetaRef.current.delete(key);
          const next = new Map(inboundRef.current);
          next.delete(key);
          inboundRef.current = next;
          setInboundTransfers(next);
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
  }, [registerMessageHandler, sendDirect, channelsRef, onSuccessToast, onErrorToast, t]);

  const handleSendFile = async (file: File) => {
    if(readOnly) return;
    const revision = roomRevision.current;
    const fail = (message: string) => { setFileError(message); onErrorToast(message); };
    setFileError('');
    const sizeIssue = fileSizeIssue(file.size);
    if (sizeIssue === 'empty') { fail(t("fileShare.fileEmpty")); return; }
    if (sizeIssue === 'too-large') {
      fail(
        t("fileShare.fileTooLarge", {
          size: formatBytes(file.size),
        })
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

    const transferId = crypto.randomUUID();
    if (retryFilesRef.current.size >= MAX_ACTIVE_TRANSFERS) {
      const releasable = Array.from(retryFilesRef.current.keys()).find(id => !activeOutboundIdsRef.current.has(id));
      if (releasable) retryFilesRef.current.delete(releasable);
    }
    retryFilesRef.current.set(transferId, file);
    setRetryableIds(Array.from(retryFilesRef.current.keys()));
    activeOutboundIdsRef.current.add(transferId);
    const initialRecipientState = createOutboundRecipientState(initialOpenPeers);
    outboundRecipientStateRef.current.set(transferId, initialRecipientState);
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

      // Announce file start per active recipient so peers can reject independently.
      for (const peerId of startTargets) {
        sendDirect(peerId, {
          type: "file:start",
          transferId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          totalChunks,
        });
      }

      await splitFileIntoChunks(file, async (index, total, base64Data) => {
        if (activeTransfersCancelRef.current.has(transferId) || getActiveTargets().length === 0) {
          throw new Error("Transfer cancelled");
        }

        // Backpressure monitoring scoped only to non-rejected active targets.
        const startedWaiting = Date.now();
        while (
          getActiveTargets().some((peerId) => {
            const channel = channelsRef.current.get(peerId);
            return channel && channel.readyState === "open" && channel.bufferedAmount > 65536;
          })
        ) {
          if (
            activeTransfersCancelRef.current.has(transferId) ||
            getActiveTargets().length === 0 ||
            Date.now() - startedWaiting > 15000
          ) {
            throw new Error("Transfer cancelled");
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        const chunkTargets = getActiveTargets();
        if (activeTransfersCancelRef.current.has(transferId) || chunkTargets.length === 0) {
          throw new Error("Transfer cancelled");
        }

        for (const peerId of chunkTargets) {
          sendDirect(peerId, {
            type: "file:chunk",
            transferId,
            index,
            data: base64Data,
          });
        }

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
      });

      const endTargets = getActiveTargets();
      if (
        activeTransfersCancelRef.current.has(transferId) ||
        endTargets.length === 0 ||
        revision !== roomRevision.current
      ) {
        throw new Error("Transfer interrupted");
      }

      const stateWithEndSent = markOutboundEndSent(
        outboundRecipientStateRef.current.get(transferId) ?? initialRecipientState,
      );
      outboundRecipientStateRef.current.set(transferId, stateWithEndSent);

      for (const peerId of endTargets) {
        sendDirect(peerId, {
          type: "file:end",
          transferId,
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
          progress: 100,
          status: "completed",
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
    // Reset input so same file can be selected again
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
            aria-label={t('fileShare.selectButton')}
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
                  {transfer.status === 'failed' && <div className="file-retry"><span>{t("fileShare.retryHint")}</span>{retryableIds.includes(transfer.transferId) && <button type="button" className="btn btn-secondary" disabled={readOnly || peersCount === 0} onClick={() => {
                    const file = retryFilesRef.current.get(transfer.transferId);
                    if (!file) return;
                    retryFilesRef.current.delete(transfer.transferId);
                    setOutboundTransfers(previous => { const next = new Map(previous); next.delete(transfer.transferId); return next; });
                    void handleSendFile(file);
                  }}>{t("fileShare.retryButton")}</button>}</div>}
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
              (transfer.receivedChunks.size / transfer.totalChunks) * 100
            );
            return (
            <article key={`${transfer.senderPeerId}:${transfer.transferId}`} className="transfer-card">
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
                  <small>{progress}%</small>
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
                  </div>
                </div>
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
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
})
