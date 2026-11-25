import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { I18nKey } from '../../../i18n';
import {
  applySenderEncodingParameters,
  computeMeshAudioBitrate,
  computeMeshVideoProfile,
  parsePeerStatsReport,
  type PeerNetworkSummary,
  type PeerPacketCounterSnapshot,
} from '../../../lib/mediaQuality';
import {
  createBackgroundBlurProcessor,
  createVoiceIsolationProcessor,
  type ProcessedMediaHandle,
} from './mediaProcessors';

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

interface UseRoomMediaOptions {
  peersRef: { current: Map<string, RTCPeerConnection> };
  activeRoomRef: { current: { id: string; access?: string | null } | null };
  remotePeerCount?: number;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  onErrorToast: (message: string) => void;
}

function mapDeviceList(devices: MediaDeviceInfo[], kind: MediaDeviceKind): MediaDeviceOption[] {
  return devices
    .filter((entry) => entry.kind === kind && entry.deviceId)
    .map((entry, idx) => ({
      deviceId: entry.deviceId,
      label: entry.label || `${kind === 'audioinput' ? 'Mic' : kind === 'videoinput' ? 'Cam' : 'Speaker'} ${idx + 1}`,
    }));
}

/**
 * Manages local microphone, camera, screen-share capture, device selection,
 * WebAudio voice isolation, camera background blur, adaptive P2P mesh bitrate/resolution
 * scaling, remote MediaStreams, and live WebRTC `getStats()` telemetry.
 */
export function useRoomMedia({
  peersRef,
  activeRoomRef,
  remotePeerCount = 0,
  t,
  onErrorToast,
}: UseRoomMediaOptions) {
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const rawCamStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);

  const voiceProcessorRef = useRef<ProcessedMediaHandle | null>(null);
  const blurProcessorRef = useRef<ProcessedMediaHandle | null>(null);

  const activeAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const activeAudioOwnerRef = useRef<MediaStream | null>(null);
  const activeCamTrackRef = useRef<MediaStreamTrack | null>(null);
  const activeCamOwnerRef = useRef<MediaStream | null>(null);

  const remoteStreamsMapRef = useRef(new Map<string, MediaStream>());
  const statsCountersRef = useRef(new Map<string, PeerPacketCounterSnapshot>());

  const [micEnabled, setMicEnabled] = useState(false);
  const [camEnabled, setCamEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [backgroundBlur, setBackgroundBlur] = useState(false);
  const [mediaError, setMediaError] = useState('');

  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerStats, setPeerStats] = useState<Record<string, PeerNetworkSummary>>({});

  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceOption[]>([]);
  const [selectedMicId, setSelectedMicId] = useState('');
  const [selectedCamId, setSelectedCamId] = useState('');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState('');

  const speakerSelectionSupported = useMemo(
    () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
    [],
  );

  const meshProfile = useMemo(
    () => computeMeshVideoProfile(remotePeerCount, screenSharing),
    [remotePeerCount, screenSharing],
  );
  const audioBitrate = useMemo(
    () => computeMeshAudioBitrate(remotePeerCount),
    [remotePeerCount],
  );

  const meshProfileRef = useRef(meshProfile);
  const audioBitrateRef = useRef(audioBitrate);
  useEffect(() => {
    meshProfileRef.current = meshProfile;
    audioBitrateRef.current = audioBitrate;
  }, [meshProfile, audioBitrate]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(mapDeviceList(devices, 'audioinput'));
      setVideoInputs(mapDeviceList(devices, 'videoinput'));
      setAudioOutputs(mapDeviceList(devices, 'audiooutput'));
    } catch {
      /* Ignore enumerateDevices errors in restricted contexts. */
    }
  }, []);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    let active = true;
    const syncDevices = () => {
      void mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!active) return;
          setAudioInputs(mapDeviceList(devices, 'audioinput'));
          setVideoInputs(mapDeviceList(devices, 'videoinput'));
          setAudioOutputs(mapDeviceList(devices, 'audiooutput'));
        })
        .catch(() => {
          /* Ignore enumerateDevices errors in restricted contexts. */
        });
    };
    syncDevices();
    mediaDevices.addEventListener?.('devicechange', syncDevices);
    return () => {
      active = false;
      mediaDevices.removeEventListener?.('devicechange', syncDevices);
    };
  }, []);

  const applyAdaptiveEncodingsToAllPeers = useCallback(async () => {
    const profile = meshProfileRef.current;
    const maxAudioBitrate = audioBitrateRef.current;
    const updates: Promise<void>[] = [];

    peersRef.current.forEach((peer) => {
      if (peer.connectionState === 'closed') return;
      for (const sender of peer.getSenders()) {
        if (sender.track?.kind === 'video') {
          updates.push(
            applySenderEncodingParameters(sender, {
              maxBitrate: profile.maxBitrate,
              maxFramerate: profile.maxFramerate,
              scaleResolutionDownBy: profile.scaleResolutionDownBy,
              degradationPreference: profile.degradationPreference,
            }),
          );
        } else if (sender.track?.kind === 'audio') {
          updates.push(
            applySenderEncodingParameters(sender, {
              maxBitrate: maxAudioBitrate,
            }),
          );
        }
      }
    });

    const rawCamTrack = rawCamStreamRef.current?.getVideoTracks()[0] ?? null;
    if (rawCamTrack && !localScreenStreamRef.current && typeof rawCamTrack.applyConstraints === 'function') {
      const camProfile = computeMeshVideoProfile(remotePeerCount, false);
      updates.push(
        rawCamTrack
          .applyConstraints({
            width: { ideal: camProfile.widthIdeal },
            height: { ideal: camProfile.heightIdeal },
            frameRate: { ideal: camProfile.maxFramerate },
          })
          .catch(() => {}),
      );
    }

    await Promise.all(updates);
  }, [peersRef, remotePeerCount]);

  useEffect(() => {
    void applyAdaptiveEncodingsToAllPeers();
  }, [meshProfile, audioBitrate, applyAdaptiveEncodingsToAllPeers]);

  // Poll live WebRTC stats (RTT, jitter, packet loss) for each connected peer.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!activeRoomRef.current || peersRef.current.size === 0) return;

      const entries = Array.from(peersRef.current.entries());
      void Promise.all(
        entries.map(async ([peerId, peer]) => {
          if (peer.connectionState === 'closed' || typeof peer.getStats !== 'function') {
            return null;
          }
          try {
            const report = await peer.getStats();
            const values: Record<string, unknown>[] = [];
            report.forEach((item) => {
              values.push(item as Record<string, unknown>);
            });
            const prev = statsCountersRef.current.get(peerId);
            const { summary, nextCounters } = parsePeerStatsReport(values, prev);
            statsCountersRef.current.set(peerId, nextCounters);
            return [peerId, summary] as const;
          } catch {
            return null;
          }
        }),
      ).then((results) => {
        if (!activeRoomRef.current) return;
        const updates: Record<string, PeerNetworkSummary> = {};
        let hasUpdates = false;
        for (const item of results) {
          if (item) {
            updates[item[0]] = item[1];
            hasUpdates = true;
          }
        }
        if (hasUpdates) {
          setPeerStats((prev) => ({ ...prev, ...updates }));
        }
      });
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeRoomRef, peersRef]);

  const syncTrackToAllPeers = useCallback(
    async (kind: 'audio' | 'video', track: MediaStreamTrack | null, ownerStream: MediaStream | null) => {
      const updates: Promise<void>[] = [];
      peersRef.current.forEach((peer) => {
        if (peer.connectionState === 'closed') return;
        const sender = peer.getSenders().find((entry) => entry.track?.kind === kind);
        if (sender) {
          updates.push(
            sender
              .replaceTrack(track)
              .then(async () => {
                if (!track) return;
                if (kind === 'video') {
                  const profile = meshProfileRef.current;
                  await applySenderEncodingParameters(sender, {
                    maxBitrate: profile.maxBitrate,
                    maxFramerate: profile.maxFramerate,
                    scaleResolutionDownBy: profile.scaleResolutionDownBy,
                    degradationPreference: profile.degradationPreference,
                  });
                } else {
                  await applySenderEncodingParameters(sender, {
                    maxBitrate: audioBitrateRef.current,
                  });
                }
              })
              .catch(() => {}),
          );
        } else if (track && ownerStream) {
          const added = peer.addTrack(track, ownerStream);
          if (kind === 'video') {
            const profile = meshProfileRef.current;
            updates.push(
              applySenderEncodingParameters(added, {
                maxBitrate: profile.maxBitrate,
                maxFramerate: profile.maxFramerate,
                scaleResolutionDownBy: profile.scaleResolutionDownBy,
                degradationPreference: profile.degradationPreference,
              }),
            );
          } else {
            updates.push(
              applySenderEncodingParameters(added, {
                maxBitrate: audioBitrateRef.current,
              }),
            );
          }
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

      const activeAudio = activeAudioTrackRef.current;
      const activeAudioOwner = activeAudioOwnerRef.current;
      if (activeAudio && activeAudioOwner) {
        const audioSender = peer.addTrack(activeAudio, activeAudioOwner);
        void applySenderEncodingParameters(audioSender, { maxBitrate: audioBitrateRef.current });
      }

      const activeScreenVideo = localScreenStreamRef.current?.getVideoTracks()[0] ?? null;
      const activeCamVideo = activeCamTrackRef.current;
      const activeVideo = activeScreenVideo ?? activeCamVideo;
      const videoOwner = activeScreenVideo ? localScreenStreamRef.current : activeCamOwnerRef.current;
      if (activeVideo && videoOwner) {
        const videoSender = peer.addTrack(activeVideo, videoOwner);
        const profile = meshProfileRef.current;
        void applySenderEncodingParameters(videoSender, {
          maxBitrate: profile.maxBitrate,
          maxFramerate: profile.maxFramerate,
          scaleResolutionDownBy: profile.scaleResolutionDownBy,
          degradationPreference: profile.degradationPreference,
        });
      }
    },
    [peersRef, activeRoomRef],
  );

  const removePeerMedia = useCallback((peerId: string) => {
    statsCountersRef.current.delete(peerId);
    setPeerStats((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
    if (remoteStreamsMapRef.current.delete(peerId)) {
      setRemoteStreams((current) => {
        if (!(peerId in current)) return current;
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    }
  }, []);

  const disposeMicPipeline = useCallback(() => {
    voiceProcessorRef.current?.dispose();
    voiceProcessorRef.current = null;
    rawMicStreamRef.current?.getTracks().forEach((track) => track.stop());
    rawMicStreamRef.current = null;
    activeAudioTrackRef.current = null;
    activeAudioOwnerRef.current = null;
    setLocalAudioStream(null);
  }, []);

  const disposeCamPipeline = useCallback(() => {
    blurProcessorRef.current?.dispose();
    blurProcessorRef.current = null;
    rawCamStreamRef.current?.getTracks().forEach((track) => track.stop());
    rawCamStreamRef.current = null;
    activeCamTrackRef.current = null;
    activeCamOwnerRef.current = null;
  }, []);

  const stopAllRoomMedia = useCallback(() => {
    disposeMicPipeline();
    disposeCamPipeline();
    localScreenStreamRef.current?.getTracks().forEach((track) => track.stop());
    localScreenStreamRef.current = null;
    remoteStreamsMapRef.current.clear();
    statsCountersRef.current.clear();
    setMicEnabled(false);
    setCamEnabled(false);
    setScreenSharing(false);
    setMediaError('');
    setLocalVideoStream(null);
    setRemoteStreams({});
    setPeerStats({});
  }, [disposeMicPipeline, disposeCamPipeline]);

  const buildAndBindMicPipeline = useCallback(
    async (rawStream: MediaStream, useNoiseSuppression: boolean) => {
      voiceProcessorRef.current?.dispose();
      voiceProcessorRef.current = null;

      let outStream = rawStream;
      if (useNoiseSuppression) {
        const proc = createVoiceIsolationProcessor(rawStream);
        voiceProcessorRef.current = proc;
        outStream = proc.stream;
      }

      const outTrack = outStream.getAudioTracks()[0] ?? rawStream.getAudioTracks()[0] ?? null;
      if (!outTrack) return;

      activeAudioTrackRef.current = outTrack;
      activeAudioOwnerRef.current = outStream;
      setLocalAudioStream(outStream);
      await syncTrackToAllPeers('audio', outTrack, outStream);
    },
    [syncTrackToAllPeers],
  );

  const captureAndStartMic = useCallback(
    async (deviceId: string, useNoiseSuppression: boolean) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        const msg = t('meeting.mediaUnsupported');
        setMediaError(msg);
        onErrorToast(msg);
        return false;
      }
      try {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: useNoiseSuppression,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        };
        const captured = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        const rawTrack = captured.getAudioTracks()[0] ?? null;
        if (!rawTrack) return false;

        disposeMicPipeline();
        rawMicStreamRef.current = captured;
        const resolvedId = rawTrack.getSettings().deviceId;
        if (resolvedId && !deviceId) setSelectedMicId(resolvedId);
        await buildAndBindMicPipeline(captured, useNoiseSuppression);
        setMicEnabled(true);
        void refreshDevices();
        return true;
      } catch {
        const msg = t('meeting.mediaPermissionDenied');
        setMediaError(msg);
        onErrorToast(msg);
        return false;
      }
    },
    [buildAndBindMicPipeline, disposeMicPipeline, onErrorToast, refreshDevices, t],
  );

  const toggleMic = useCallback(async () => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    setMediaError('');
    if (micEnabled) {
      disposeMicPipeline();
      setMicEnabled(false);
      await syncTrackToAllPeers('audio', null, null);
      return;
    }
    await captureAndStartMic(selectedMicId, noiseSuppression);
  }, [activeRoomRef, captureAndStartMic, disposeMicPipeline, micEnabled, noiseSuppression, selectedMicId, syncTrackToAllPeers]);

  const buildAndBindCamPipeline = useCallback(
    async (rawStream: MediaStream, useBlur: boolean) => {
      blurProcessorRef.current?.dispose();
      blurProcessorRef.current = null;

      const rawTrack = rawStream.getVideoTracks()[0] ?? null;
      if (!rawTrack) return;

      let outStream = rawStream;
      if (useBlur) {
        const proc = await createBackgroundBlurProcessor(rawTrack, 20);
        blurProcessorRef.current = proc;
        outStream = proc.stream;
      }

      const outTrack = outStream.getVideoTracks()[0] ?? rawTrack;
      activeCamTrackRef.current = outTrack;
      activeCamOwnerRef.current = outStream;

      if (!localScreenStreamRef.current) {
        setLocalVideoStream(new MediaStream([outTrack]));
        await syncTrackToAllPeers('video', outTrack, outStream);
      }
    },
    [syncTrackToAllPeers],
  );

  const captureAndStartCam = useCallback(
    async (deviceId: string, useBlur: boolean) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        const msg = t('meeting.mediaUnsupported');
        setMediaError(msg);
        onErrorToast(msg);
        return false;
      }
      try {
        const profile = computeMeshVideoProfile(remotePeerCount, false);
        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: profile.widthIdeal },
          height: { ideal: profile.heightIdeal },
          frameRate: { ideal: profile.maxFramerate },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        };
        const captured = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
        const rawTrack = captured.getVideoTracks()[0] ?? null;
        if (!rawTrack) return false;

        disposeCamPipeline();
        rawCamStreamRef.current = captured;
        const resolvedId = rawTrack.getSettings().deviceId;
        if (resolvedId && !deviceId) setSelectedCamId(resolvedId);
        await buildAndBindCamPipeline(captured, useBlur);
        setCamEnabled(true);
        void refreshDevices();
        return true;
      } catch {
        const msg = t('meeting.mediaPermissionDenied');
        setMediaError(msg);
        onErrorToast(msg);
        return false;
      }
    },
    [buildAndBindCamPipeline, disposeCamPipeline, onErrorToast, refreshDevices, remotePeerCount, t],
  );

  const toggleCam = useCallback(async () => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    setMediaError('');
    if (camEnabled) {
      disposeCamPipeline();
      setCamEnabled(false);
      if (!localScreenStreamRef.current) {
        setLocalVideoStream(null);
        await syncTrackToAllPeers('video', null, null);
      }
      return;
    }
    await captureAndStartCam(selectedCamId, backgroundBlur);
  }, [activeRoomRef, backgroundBlur, camEnabled, captureAndStartCam, disposeCamPipeline, selectedCamId, syncTrackToAllPeers]);

  const stopScreenShareInternal = useCallback(async () => {
    const screenStream = localScreenStreamRef.current;
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      localScreenStreamRef.current = null;
    }
    setScreenSharing(false);
    const camTrack = activeCamTrackRef.current;
    const camOwner = activeCamOwnerRef.current;
    if (camTrack && camOwner) {
      setLocalVideoStream(new MediaStream([camTrack]));
      await syncTrackToAllPeers('video', camTrack, camOwner);
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

  const selectMicrophone = useCallback(
    async (deviceId: string) => {
      setSelectedMicId(deviceId);
      if (micEnabled) {
        await captureAndStartMic(deviceId, noiseSuppression);
      }
    },
    [captureAndStartMic, micEnabled, noiseSuppression],
  );

  const selectCamera = useCallback(
    async (deviceId: string) => {
      setSelectedCamId(deviceId);
      if (camEnabled) {
        await captureAndStartCam(deviceId, backgroundBlur);
      }
    },
    [backgroundBlur, camEnabled, captureAndStartCam],
  );

  const selectSpeaker = useCallback((deviceId: string) => {
    setSelectedSpeakerId(deviceId);
  }, []);

  const toggleNoiseSuppression = useCallback(async () => {
    const next = !noiseSuppression;
    setNoiseSuppression(next);
    const rawStream = rawMicStreamRef.current;
    if (micEnabled && rawStream) {
      const rawTrack = rawStream.getAudioTracks()[0];
      if (rawTrack && typeof rawTrack.applyConstraints === 'function') {
        await rawTrack.applyConstraints({ noiseSuppression: next, echoCancellation: true, autoGainControl: true }).catch(() => {});
      }
      await buildAndBindMicPipeline(rawStream, next);
    }
  }, [buildAndBindMicPipeline, micEnabled, noiseSuppression]);

  const toggleBackgroundBlur = useCallback(async () => {
    if (activeRoomRef.current?.access === 'VIEWER') return;
    const next = !backgroundBlur;
    setBackgroundBlur(next);
    const rawStream = rawCamStreamRef.current;
    if (camEnabled && rawStream) {
      await buildAndBindCamPipeline(rawStream, next);
    }
  }, [activeRoomRef, backgroundBlur, buildAndBindCamPipeline, camEnabled]);

  return {
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
  };
}
