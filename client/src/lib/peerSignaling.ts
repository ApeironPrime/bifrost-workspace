export const DEFAULT_DISCONNECT_GRACE_MS = 5000;
export const MAX_PENDING_ICE_CANDIDATES = 200;

export interface SignalingPeerLike {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  remoteDescription: RTCSessionDescription | RTCSessionDescriptionInit | null;
  localDescription: RTCSessionDescription | RTCSessionDescriptionInit | null;
  createOffer: (options?: RTCOfferOptions) => Promise<RTCSessionDescriptionInit>;
  createAnswer: () => Promise<RTCSessionDescriptionInit>;
  setLocalDescription: (description: RTCLocalSessionDescriptionInit) => Promise<void>;
  setRemoteDescription: (description: RTCSessionDescriptionInit) => Promise<void>;
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  restartIce?: () => void;
}

export interface PeerSignalingRecord {
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingRestart: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  disconnectRecoveryAttempted: boolean;
  signalingChain: Promise<void>;
}

function enqueuePeerSignaling<T>(
  record: PeerSignalingRecord,
  task: () => Promise<T>,
): Promise<T> {
  const run = record.signalingChain.then(task, task);
  record.signalingChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isPeerClosed(peer: Pick<SignalingPeerLike, 'connectionState'>): boolean {
  return peer.connectionState === 'closed';
}

function getLiveConnectionState(peer: Pick<SignalingPeerLike, 'connectionState'>): RTCPeerConnectionState {
  return peer.connectionState;
}

function getLiveSignalingState(peer: Pick<SignalingPeerLike, 'signalingState'>): RTCSignalingState {
  return peer.signalingState;
}

export function createPeerSignalingRecord(): PeerSignalingRecord {
  return {
    makingOffer: false,
    ignoreOffer: false,
    isSettingRemoteAnswerPending: false,
    pendingRestart: false,
    pendingCandidates: [],
    disconnectTimer: null,
    disconnectRecoveryAttempted: false,
    signalingChain: Promise.resolve(),
  };
}

export function clearPeerSignalingRecord(record: PeerSignalingRecord | undefined): void {
  if (!record) return;
  if (record.disconnectTimer !== null) {
    clearTimeout(record.disconnectTimer);
    record.disconnectTimer = null;
  }
  record.pendingCandidates.length = 0;
  record.makingOffer = false;
  record.ignoreOffer = false;
  record.isSettingRemoteAnswerPending = false;
  record.pendingRestart = false;
  record.disconnectRecoveryAttempted = false;
}

/**
 * Deterministic Perfect Negotiation role tie-breaker based on Socket.IO-assigned peer IDs.
 * Because `localPeerId !== remotePeerId`, the two endpoints always take opposite roles.
 */
export function isPolitePeer(
  localPeerId: string | null | undefined,
  remotePeerId: string,
): boolean {
  if (!localPeerId || !remotePeerId) return false;
  return localPeerId < remotePeerId;
}

export function queuePendingIceCandidate(
  record: PeerSignalingRecord,
  candidate: RTCIceCandidateInit,
): boolean {
  if (record.pendingCandidates.length >= MAX_PENDING_ICE_CANDIDATES) {
    return false;
  }
  record.pendingCandidates.push(candidate);
  return true;
}

export async function flushPendingIceCandidates(
  peer: Pick<SignalingPeerLike, 'connectionState' | 'remoteDescription' | 'addIceCandidate'>,
  record: PeerSignalingRecord,
  isContextValid: () => boolean,
): Promise<number> {
  if (!peer.remoteDescription || isPeerClosed(peer)) return 0;
  let applied = 0;
  while (record.pendingCandidates.length > 0) {
    if (!isContextValid() || isPeerClosed(peer) || !peer.remoteDescription) {
      break;
    }
    const nextCandidate = record.pendingCandidates.shift()!;
    try {
      await peer.addIceCandidate(nextCandidate);
      applied += 1;
    } catch (err) {
      if (!record.ignoreOffer) {
        throw err;
      }
    }
  }
  return applied;
}

/**
 * Single shared offer/ICE-restart negotiator. Operations are serialized per peer so an
 * incoming offer cannot interleave with an in-flight `createOffer` -> `setLocalDescription`.
 */
export function negotiatePeerOffer(params: {
  peer: SignalingPeerLike;
  record: PeerSignalingRecord;
  iceRestart?: boolean;
  isContextValid: () => boolean;
  emitOffer: (description: RTCSessionDescriptionInit) => void;
}): Promise<boolean> {
  const { peer, record, isContextValid, emitOffer } = params;
  const iceRestart = Boolean(params.iceRestart);

  // Fast pre-check before queuing if already mid-negotiation.
  if (!isContextValid() || isPeerClosed(peer)) {
    return Promise.resolve(false);
  }
  if (record.makingOffer || getLiveSignalingState(peer) !== 'stable') {
    if (iceRestart) {
      record.pendingRestart = true;
    }
    return Promise.resolve(false);
  }

  return enqueuePeerSignaling(record, async () => {
    if (!isContextValid() || isPeerClosed(peer)) {
      return false;
    }

    if (record.makingOffer || getLiveSignalingState(peer) !== 'stable') {
      if (iceRestart) {
        record.pendingRestart = true;
      }
      return false;
    }

    record.pendingRestart = false;
    if (iceRestart) {
      peer.restartIce?.();
    }

    record.makingOffer = true;
    try {
      const offer = await peer.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (!isContextValid() || isPeerClosed(peer) || getLiveSignalingState(peer) !== 'stable') {
        if (iceRestart) {
          record.pendingRestart = true;
        }
        return false;
      }
      await peer.setLocalDescription(offer);
      if (!isContextValid() || isPeerClosed(peer)) {
        return false;
      }
      const outboundOffer = peer.localDescription ?? offer;
      emitOffer({ type: outboundOffer.type, sdp: outboundOffer.sdp });
      return true;
    } finally {
      record.makingOffer = false;
    }
  });
}

/**
 * Handles an incoming `webrtc:offer` with full Perfect Negotiation collision detection,
 * per-peer serialized execution, polite rollback, pending ICE candidate flushing, and
 * queued ICE restart continuation.
 */
export function handleIncomingOffer(params: {
  peer: SignalingPeerLike;
  record: PeerSignalingRecord;
  offer: RTCSessionDescriptionInit;
  localPeerId: string | null | undefined;
  remotePeerId: string;
  isContextValid: () => boolean;
  emitAnswer: (description: RTCSessionDescriptionInit) => void;
  onPendingRestartReady?: () => void;
}): Promise<'answered' | 'ignored' | 'aborted'> {
  const {
    peer,
    record,
    offer,
    localPeerId,
    remotePeerId,
    isContextValid,
    emitAnswer,
    onPendingRestartReady,
  } = params;

  return enqueuePeerSignaling(record, async () => {
    if (!isContextValid() || isPeerClosed(peer)) {
      return 'aborted';
    }

    const polite = isPolitePeer(localPeerId, remotePeerId);
    const readyForOffer =
      !record.makingOffer &&
      (getLiveSignalingState(peer) === 'stable' || record.isSettingRemoteAnswerPending);
    const offerCollision = !readyForOffer;

    record.ignoreOffer = !polite && offerCollision;
    if (record.ignoreOffer) {
      return 'ignored';
    }

    if (
      offerCollision &&
      polite &&
      getLiveSignalingState(peer) !== 'stable' &&
      !record.isSettingRemoteAnswerPending
    ) {
      try {
        await peer.setLocalDescription({ type: 'rollback' });
      } catch {
        // Modern engines perform implicit rollback when applying an offer in `have-local-offer`.
      }
    }

    await peer.setRemoteDescription(offer);
    if (!isContextValid() || isPeerClosed(peer)) {
      return 'aborted';
    }

    await flushPendingIceCandidates(peer, record, isContextValid);
    if (!isContextValid() || isPeerClosed(peer)) {
      return 'aborted';
    }

    const answer = await peer.createAnswer();
    if (!isContextValid() || isPeerClosed(peer)) {
      return 'aborted';
    }

    await peer.setLocalDescription(answer);
    if (!isContextValid() || isPeerClosed(peer)) {
      return 'aborted';
    }

    const outboundAnswer = peer.localDescription ?? answer;
    emitAnswer({ type: outboundAnswer.type, sdp: outboundAnswer.sdp });

    if (getLiveSignalingState(peer) === 'stable' && record.pendingRestart) {
      onPendingRestartReady?.();
    }
    return 'answered';
  });
}

/**
 * Handles an incoming `webrtc:answer` safely via the per-peer signaling queue, ignoring
 * stale/late answers when not in `have-local-offer` (e.g. after polite collision rollback).
 */
export function handleIncomingAnswer(params: {
  peer: SignalingPeerLike;
  record: PeerSignalingRecord;
  answer: RTCSessionDescriptionInit;
  isContextValid: () => boolean;
  onPendingRestartReady?: () => void;
}): Promise<'applied' | 'ignored' | 'aborted'> {
  const { peer, record, answer, isContextValid, onPendingRestartReady } = params;
  return enqueuePeerSignaling(record, async () => {
    if (!isContextValid() || isPeerClosed(peer)) {
      return 'aborted';
    }
    if (getLiveSignalingState(peer) !== 'have-local-offer') {
      return 'ignored';
    }

    record.isSettingRemoteAnswerPending = true;
    try {
      await peer.setRemoteDescription(answer);
    } finally {
      record.isSettingRemoteAnswerPending = false;
    }

    if (!isContextValid() || isPeerClosed(peer)) {
      return 'aborted';
    }

    await flushPendingIceCandidates(peer, record, isContextValid);

    if (getLiveSignalingState(peer) === 'stable' && record.pendingRestart) {
      onPendingRestartReady?.();
    }
    return 'applied';
  });
}

export async function handleIncomingIceCandidate(params: {
  peer: SignalingPeerLike | undefined;
  record: PeerSignalingRecord;
  candidate: RTCIceCandidateInit;
}): Promise<'applied' | 'queued' | 'ignored'> {
  const { peer, record, candidate } = params;
  if (!peer || !peer.remoteDescription) {
    queuePendingIceCandidate(record, candidate);
    return 'queued';
  }
  if (peer.connectionState === 'closed') {
    return 'ignored';
  }
  try {
    await peer.addIceCandidate(candidate);
    return 'applied';
  } catch (err) {
    if (record.ignoreOffer) {
      return 'ignored';
    }
    throw err;
  }
}

/**
 * Evaluates peer connection state transitions without tearing down peers immediately on
 * transient `disconnected` states; allows grace recovery before invoking ICE restart or close.
 */
export function handlePeerConnectionStateTransition(params: {
  peer: Pick<SignalingPeerLike, 'connectionState'>;
  record: PeerSignalingRecord;
  graceMs?: number;
  isPeerVerified: () => boolean;
  isSignalingConnected: () => boolean;
  attemptIceRecovery: () => Promise<void> | void;
  onClosePeer: () => void;
}): void {
  const {
    peer,
    record,
    graceMs = DEFAULT_DISCONNECT_GRACE_MS,
    isPeerVerified,
    isSignalingConnected,
    attemptIceRecovery,
    onClosePeer,
  } = params;

  const clearTimer = () => {
    if (record.disconnectTimer !== null) {
      clearTimeout(record.disconnectTimer);
      record.disconnectTimer = null;
    }
  };

  if (peer.connectionState === 'closed') {
    clearTimer();
    onClosePeer();
    return;
  }

  if (peer.connectionState === 'connected') {
    clearTimer();
    record.disconnectRecoveryAttempted = false;
    return;
  }

  if (peer.connectionState === 'disconnected') {
    if (record.disconnectTimer !== null) return;
    record.disconnectTimer = setTimeout(() => {
      record.disconnectTimer = null;
      const liveAfterGrace = getLiveConnectionState(peer);
      if (liveAfterGrace === 'connected' || liveAfterGrace === 'connecting') return;
      if (!isPeerVerified()) {
        onClosePeer();
        return;
      }
      if (!record.disconnectRecoveryAttempted && isSignalingConnected()) {
        record.disconnectRecoveryAttempted = true;
        void attemptIceRecovery();
        record.disconnectTimer = setTimeout(() => {
          record.disconnectTimer = null;
          const liveAfterRecovery = getLiveConnectionState(peer);
          if (liveAfterRecovery === 'disconnected' || liveAfterRecovery === 'failed') {
            onClosePeer();
          }
        }, graceMs);
        return;
      }
      if (liveAfterGrace === 'disconnected' || liveAfterGrace === 'failed') {
        onClosePeer();
      }
    }, graceMs);
    return;
  }

  if (peer.connectionState === 'failed') {
    clearTimer();
    if (!isPeerVerified()) {
      onClosePeer();
      return;
    }
    if (!record.disconnectRecoveryAttempted && isSignalingConnected()) {
      record.disconnectRecoveryAttempted = true;
      void attemptIceRecovery();
      record.disconnectTimer = setTimeout(() => {
        record.disconnectTimer = null;
        const liveAfterRecovery = getLiveConnectionState(peer);
        if (liveAfterRecovery === 'failed' || liveAfterRecovery === 'disconnected') {
          onClosePeer();
        }
      }, graceMs);
      return;
    }
    onClosePeer();
  }
}
