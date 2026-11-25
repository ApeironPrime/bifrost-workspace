export type MeshQualityTier = 'hd' | 'sd' | 'eco' | 'low';

export interface MeshVideoProfile {
  tier: MeshQualityTier;
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
  widthIdeal: number;
  heightIdeal: number;
  degradationPreference: 'balanced' | 'maintain-framerate' | 'maintain-resolution';
}

export type NetworkQualityLevel = 'good' | 'fair' | 'poor' | 'unknown';

export interface PeerPacketCounterSnapshot {
  packetsLost: number;
  packetsReceived: number;
}

export interface PeerNetworkSummary {
  level: NetworkQualityLevel;
  rttMs: number | null;
  packetLossPct: number;
  jitterMs: number | null;
}

/**
 * Computes per-peer video bitrate, framerate, and resolution scale for P2P Full Mesh
 * so total upload bandwidth (`remotePeerCount * maxBitrate`) stays bounded as room size grows.
 */
export function computeMeshVideoProfile(
  remotePeerCount: number,
  isScreenShare: boolean,
): MeshVideoProfile {
  const peers = Math.max(0, Math.floor(remotePeerCount));

  if (isScreenShare) {
    if (peers <= 2) {
      return {
        tier: 'hd',
        maxBitrate: 2_000_000,
        maxFramerate: 24,
        scaleResolutionDownBy: 1,
        widthIdeal: 1920,
        heightIdeal: 1080,
        degradationPreference: 'maintain-resolution',
      };
    }
    if (peers <= 5) {
      return {
        tier: 'sd',
        maxBitrate: 1_100_000,
        maxFramerate: 15,
        scaleResolutionDownBy: 1.25,
        widthIdeal: 1280,
        heightIdeal: 720,
        degradationPreference: 'maintain-resolution',
      };
    }
    return {
      tier: 'eco',
      maxBitrate: 650_000,
      maxFramerate: 10,
      scaleResolutionDownBy: 1.5,
      widthIdeal: 1280,
      heightIdeal: 720,
      degradationPreference: 'maintain-resolution',
    };
  }

  if (peers <= 1) {
    return {
      tier: 'hd',
      maxBitrate: 1_500_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1,
      widthIdeal: 1280,
      heightIdeal: 720,
      degradationPreference: 'balanced',
    };
  }
  if (peers <= 3) {
    return {
      tier: 'sd',
      maxBitrate: 650_000,
      maxFramerate: 24,
      scaleResolutionDownBy: 1.5,
      widthIdeal: 960,
      heightIdeal: 540,
      degradationPreference: 'maintain-framerate',
    };
  }
  if (peers <= 5) {
    return {
      tier: 'eco',
      maxBitrate: 320_000,
      maxFramerate: 18,
      scaleResolutionDownBy: 2,
      widthIdeal: 640,
      heightIdeal: 360,
      degradationPreference: 'maintain-framerate',
    };
  }
  return {
    tier: 'low',
    maxBitrate: 180_000,
    maxFramerate: 15,
    scaleResolutionDownBy: 3,
    widthIdeal: 480,
    heightIdeal: 270,
    degradationPreference: 'maintain-framerate',
  };
}

/**
 * Scales per-peer audio bitrate in P2P Full Mesh rooms so voice stays crisp
 * without saturating uplink bandwidth in larger groups.
 */
export function computeMeshAudioBitrate(remotePeerCount: number): number {
  const peers = Math.max(0, Math.floor(remotePeerCount));
  if (peers <= 3) return 48_000;
  if (peers <= 6) return 32_000;
  return 24_000;
}

/**
 * Applies bitrate, framerate, resolution scaling, and degradation preference
 * safely to an active RTCRtpSender without throwing on pre-negotiation senders.
 */
export async function applySenderEncodingParameters(
  sender: Pick<RTCRtpSender, 'getParameters' | 'setParameters'>,
  params: {
    maxBitrate: number;
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
    degradationPreference?: 'balanced' | 'maintain-framerate' | 'maintain-resolution';
  },
): Promise<void> {
  if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') {
    return;
  }
  try {
    const parameters = sender.getParameters();
    const encodings =
      Array.isArray(parameters.encodings) && parameters.encodings.length > 0
        ? parameters.encodings
        : [{}];
    const primary = { ...encodings[0], maxBitrate: params.maxBitrate };
    if (params.maxFramerate !== undefined) {
      primary.maxFramerate = params.maxFramerate;
    }
    if (params.scaleResolutionDownBy !== undefined) {
      primary.scaleResolutionDownBy = params.scaleResolutionDownBy;
    }
    parameters.encodings = [primary, ...encodings.slice(1)];
    if (params.degradationPreference) {
      (parameters as RTCRtpSendParameters).degradationPreference = params.degradationPreference;
    }
    await sender.setParameters(parameters);
  } catch {
    /* Ignore unsupported encoding params before initial negotiation completes. */
  }
}

export function classifyNetworkQuality(
  rttMs: number | null,
  packetLossPct: number,
): NetworkQualityLevel {
  if (rttMs === null && packetLossPct <= 0) return 'unknown';
  if ((rttMs !== null && rttMs >= 300) || packetLossPct >= 5) return 'poor';
  if ((rttMs !== null && rttMs >= 150) || packetLossPct >= 1.5) return 'fair';
  return 'good';
}

/**
 * Extracts RTT, jitter, and windowed packet loss percentage from an RTCStatsReport
 * (or any iterable of WebRTC stats dictionaries).
 */
export function parsePeerStatsReport(
  statsValues: Iterable<Record<string, unknown>>,
  prev?: PeerPacketCounterSnapshot,
): { summary: PeerNetworkSummary; nextCounters: PeerPacketCounterSnapshot } {
  let pairRttMs: number | null = null;
  let remoteInboundRttMs: number | null = null;
  let packetsLost = 0;
  let packetsReceived = 0;
  let jitterMs: number | null = null;

  for (const entry of statsValues) {
    if (!entry || typeof entry !== 'object') continue;
    const type = entry.type;

    if (
      type === 'candidate-pair' &&
      (entry.state === 'succeeded' || entry.selected === true) &&
      entry.nominated !== false
    ) {
      const rttSec = entry.currentRoundTripTime;
      if (typeof rttSec === 'number' && Number.isFinite(rttSec) && rttSec >= 0) {
        pairRttMs = Math.round(rttSec * 1000);
      }
    } else if (type === 'remote-inbound-rtp') {
      const rttSec = entry.roundTripTime;
      if (typeof rttSec === 'number' && Number.isFinite(rttSec) && rttSec >= 0) {
        remoteInboundRttMs = Math.round(rttSec * 1000);
      }
    } else if (type === 'inbound-rtp') {
      const lost = entry.packetsLost;
      const received = entry.packetsReceived;
      const jitterSec = entry.jitter;
      if (typeof lost === 'number' && Number.isFinite(lost) && lost > 0) {
        packetsLost += lost;
      }
      if (typeof received === 'number' && Number.isFinite(received) && received > 0) {
        packetsReceived += received;
      }
      if (typeof jitterSec === 'number' && Number.isFinite(jitterSec) && jitterSec >= 0) {
        const ms = Math.round(jitterSec * 1000);
        jitterMs = jitterMs === null ? ms : Math.max(jitterMs, ms);
      }
    }
  }

  const rttMs = pairRttMs ?? remoteInboundRttMs;
  const deltaLost =
    prev && packetsLost >= prev.packetsLost ? packetsLost - prev.packetsLost : packetsLost;
  const deltaReceived =
    prev && packetsReceived >= prev.packetsReceived
      ? packetsReceived - prev.packetsReceived
      : packetsReceived;
  const deltaTotal = deltaLost + deltaReceived;
  const packetLossPct = deltaTotal > 0 ? Math.round((deltaLost / deltaTotal) * 1000) / 10 : 0;

  return {
    summary: {
      level: classifyNetworkQuality(rttMs, packetLossPct),
      rttMs,
      packetLossPct,
      jitterMs,
    },
    nextCounters: {
      packetsLost,
      packetsReceived,
    },
  };
}

const IDLE_BAR_BASE = [4, 6, 8, 5, 7, 6, 4, 7, 6, 5, 8, 6, 4] as const;

/**
 * Converts AnalyserNode frequency bins into smooth waveform bar heights (4..28px)
 * and detects whether the stream currently contains active speech.
 */
export function computeVoiceSpectrumFromBins(
  bins: Uint8Array,
  barCount = 13,
): { bars: number[]; level: number; speaking: boolean } {
  const count = Math.max(1, Math.floor(barCount));
  if (!bins || bins.length === 0) {
    return {
      bars: Array.from({ length: count }, (_, idx) => IDLE_BAR_BASE[idx % IDLE_BAR_BASE.length]),
      level: 0,
      speaking: false,
    };
  }

  const usableLen = Math.max(1, Math.min(bins.length, Math.ceil(bins.length * 0.75)));
  let sumSquares = 0;
  for (let i = 0; i < usableLen; i++) {
    const norm = bins[i] / 255;
    sumSquares += norm * norm;
  }
  const level = Math.sqrt(sumSquares / usableLen);
  const speaking = level >= 0.075;

  const bars: number[] = [];
  const center = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const distFromCenter = Math.abs(i - center) / Math.max(1, center);
    const binIndex = Math.min(
      usableLen - 1,
      Math.floor((1 - distFromCenter * 0.75) * (usableLen - 1) * 0.6) + (i % 2),
    );
    const sample = bins[binIndex] / 255;
    const envelope = 1 - distFromCenter * 0.35;
    const idle = IDLE_BAR_BASE[i % IDLE_BAR_BASE.length];
    const height = Math.round(Math.max(4, Math.min(28, idle + sample * 22 * envelope)));
    bars.push(height);
  }

  return { bars, level, speaking };
}

/**
 * Returns the CSS grid count modifier class for the meeting stage,
 * switching cleanly to an auto-fit responsive grid for 7+ participants.
 */
export function resolveGridCountClass(totalParticipants: number): string {
  const count = Math.max(1, Math.floor(totalParticipants));
  if (count <= 6) return `count-${count}`;
  return 'count-many';
}
