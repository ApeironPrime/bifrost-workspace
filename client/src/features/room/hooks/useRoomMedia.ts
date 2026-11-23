import { useCallback, useRef, useState } from 'react';
import type { I18nKey } from '../../../i18n';

interface UseRoomMediaOptions {
  peersRef: { current: Map<string, RTCPeerConnection> };
  activeRoomRef: { current: { id: string; access?: string | null } | null };
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onErrorToast: (message: string) => void;
}

/**
 * Manages local microphone, camera, screen-share capture, remote peer MediaStreams,
 * and dynamic WebRTC sender track synchronization across active peer connections.
 */
export function useRoomMedia({ peersRef, activeRoomRef, t, onErrorToast }: UseRoomMediaOptions) {
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsMapRef = useRef(new Map<string, MediaStream>());

  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const syncTrackToAllPeers = useCallback(
    async (kind: 'audio' | 'video', track: MediaStreamTrack | null, ownerStream: MediaStream | null) => {
      const updates: Promise<void>[] = [];
      peersRef.current.forEach((peer) => {
        if (peer.connectionState === 'closed') return;
        const sender = peer.getSenders().find((entry) => entry.track?.kind === kind);
        if (sender) {
          updates.push(sender.replaceTrack(track).catch(() => {}));
        } else if (track && ownerStream) {
          peer.addTrack(track, ownerStream);
        }
      });
      await Promise.all(updates);
    },
    [peersRef],
  );

  const attachPeerMediaHandlers = useCallback(
    (peer: RTCPeerConnection, peerId: string, targetRoomId: string) => {
      peer.ontrack = (event) => {
        if (peersRef.current.get(peerId) !== peer || activeRoomRef.current?.id !== targetRoomId) {
          return;
        }
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
    },
    [peersRef, activeRoomRef],
  );

  const removePeerMedia = useCallback((peerId: string) => {
    if (remoteStreamsMapRef.current.delete(peerId)) {
      setRemoteStreams((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    }
  }, []);

  const stopAllRoomMedia = useCallback(() => {
    localMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    localMediaStreamRef.current = null;
    localScreenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localScreenStreamRef.current = null;
    remoteStreamsMapRef.current.clear();
    setMicEnabled(false);
    setCamEnabled(false);
    setScreenSharing(false);
    setMediaError('');
    setLocalVideoStream(null);
    setRemoteStreams({});
  }, []);

  const toggleMic = useCallback(async () => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    setMediaError('');
    const existingStream = localMediaStreamRef.current;
    const existingAudio = existingStream?.getAudioTracks()[0] ?? null;

    if (micEnabled && existingAudio) {
      existingAudio.stop();
      existingStream?.removeTrack(existingAudio);
      setMicEnabled(false);
      await syncTrackToAllPeers('audio', null, null);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = t('meeting.mediaUnsupported');
      setMediaError(msg);
      onErrorToast(msg);
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
      await syncTrackToAllPeers('audio', audioTrack, targetStream);
    } catch {
      const msg = t('meeting.mediaPermissionDenied');
      setMediaError(msg);
      onErrorToast(msg);
    }
  }, [activeRoomRef, micEnabled, syncTrackToAllPeers, t, onErrorToast]);

  const toggleCam = useCallback(async () => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    setMediaError('');
    const existingStream = localMediaStreamRef.current;
    const existingVideo = existingStream?.getVideoTracks()[0] ?? null;

    if (camEnabled && existingVideo) {
      existingVideo.stop();
      existingStream?.removeTrack(existingVideo);
      setCamEnabled(false);
      if (!localScreenStreamRef.current) {
        setLocalVideoStream(null);
        await syncTrackToAllPeers('video', null, null);
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = t('meeting.mediaUnsupported');
      setMediaError(msg);
      onErrorToast(msg);
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
        await syncTrackToAllPeers('video', videoTrack, targetStream);
      }
    } catch {
      const msg = t('meeting.mediaPermissionDenied');
      setMediaError(msg);
      onErrorToast(msg);
    }
  }, [activeRoomRef, camEnabled, syncTrackToAllPeers, t, onErrorToast]);

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
      await syncTrackToAllPeers('video', camTrack, localMediaStreamRef.current);
    } else {
      setLocalVideoStream(null);
      await syncTrackToAllPeers('video', null, null);
    }
  }, [syncTrackToAllPeers]);

  const toggleScreenShare = useCallback(async () => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    setMediaError('');
    if (screenSharing || localScreenStreamRef.current) {
      await stopScreenShareInternal();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const msg = t('meeting.mediaUnsupported');
      setMediaError(msg);
      onErrorToast(msg);
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
      await syncTrackToAllPeers('video', screenTrack, screenStream);
    } catch {
      const msg = t('meeting.mediaPermissionDenied');
      setMediaError(msg);
      onErrorToast(msg);
    }
  }, [activeRoomRef, screenSharing, stopScreenShareInternal, syncTrackToAllPeers, t, onErrorToast]);

  return {
    micEnabled,
    camEnabled,
    screenSharing,
    mediaError,
    localVideoStream,
    remoteStreams,
    attachPeerMediaHandlers,
    removePeerMedia,
    stopAllRoomMedia,
    toggleMic,
    toggleCam,
    toggleScreenShare,
  };
}
