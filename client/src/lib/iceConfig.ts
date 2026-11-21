import { apiUrl, fetchAppApi, isDevMockSession, type AppUrlEnv } from './appApi.ts';

export const DEFAULT_STUN_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];
export const DEFAULT_TURN_REFRESH_LEAD_SECONDS = 180;
export const DEFAULT_ICE_FETCH_TIMEOUT_MS = 5000;

export type IceConfigSource = 'api' | 'stun-only' | 'fallback' | 'dev-mock';
export type IceCandidateKind = 'relay' | 'host' | 'srflx' | 'prflx' | 'unknown';

export interface IceConfigSnapshot {
  roomId: string;
  iceServers: RTCIceServer[];
  turnEnabled: boolean;
  ttlSeconds: number;
  expiresAtUnixSec: number | null;
  fetchedAtMonotonicMs: number;
  fetchedAtWallMs: number;
  source: IceConfigSource;
}

export interface IceTimingEvaluation {
  isExpired: boolean;
  needsRefresh: boolean;
  refreshDelayMs: number | null;
  effectiveElapsedMs: number;
}

export interface FetchRoomIceConfigResult {
  snapshot: IceConfigSnapshot;
  unauthorized: boolean;
}

function cloneIceServers(servers: readonly RTCIceServer[]): RTCIceServer[] {
  return servers.map((entry) => ({
    ...entry,
    urls: Array.isArray(entry.urls) ? [...entry.urls] : entry.urls,
  }));
}

export function createStunFallbackSnapshot(
  roomId: string,
  source: Exclude<IceConfigSource, 'api'>,
  nowMonoMs: number,
  nowWallMs: number,
  stunServers: readonly RTCIceServer[] = DEFAULT_STUN_ICE_SERVERS,
): IceConfigSnapshot {
  return {
    roomId,
    iceServers: cloneIceServers(stunServers.length > 0 ? stunServers : DEFAULT_STUN_ICE_SERVERS),
    turnEnabled: false,
    ttlSeconds: 0,
    expiresAtUnixSec: null,
    fetchedAtMonotonicMs: nowMonoMs,
    fetchedAtWallMs: nowWallMs,
    source,
  };
}

/**
 * Computes refresh lead before expiry: 180s by default when TTL >= 200s (so 900s refreshes at 720s),
 * or proportionally bounded for shorter custom test TTLs (60s..199s) so the timer remains positive.
 */
export function computeRefreshLeadSeconds(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return 0;
  if (ttlSeconds >= 200) return DEFAULT_TURN_REFRESH_LEAD_SECONDS;
  return Math.max(10, Math.floor(ttlSeconds * 0.25));
}

/**
 * Evaluates credential validity and refresh timing primarily via monotonic elapsed time
 * (`performance.now()` delta) while taking `max(monoElapsed, wallElapsed)` so background tab
 * timer throttling or OS suspend/sleep triggers immediate renewal on resume without trusting
 * absolute local wall clock against server UTC.
 */
export function computeIceConfigTiming(
  snapshot: IceConfigSnapshot,
  nowMonoMs: number,
  nowWallMs: number,
): IceTimingEvaluation {
  if (!snapshot.turnEnabled || snapshot.ttlSeconds <= 0) {
    return {
      isExpired: false,
      needsRefresh: false,
      refreshDelayMs: null,
      effectiveElapsedMs: 0,
    };
  }

  const monoElapsedMs = Math.max(0, nowMonoMs - snapshot.fetchedAtMonotonicMs);
  const wallElapsedMs = Math.max(0, nowWallMs - snapshot.fetchedAtWallMs);
  const effectiveElapsedMs = Math.max(monoElapsedMs, wallElapsedMs);

  const ttlMs = snapshot.ttlSeconds * 1000;
  const leadMs = computeRefreshLeadSeconds(snapshot.ttlSeconds) * 1000;
  const refreshAtMs = Math.max(0, ttlMs - leadMs);

  return {
    isExpired: effectiveElapsedMs >= ttlMs,
    needsRefresh: effectiveElapsedMs >= refreshAtMs,
    refreshDelayMs: Math.max(0, refreshAtMs - effectiveElapsedMs),
    effectiveElapsedMs,
  };
}

export function isIceSnapshotUsable(
  snapshot: IceConfigSnapshot | null | undefined,
  roomId: string,
  nowMonoMs: number,
  nowWallMs: number,
): snapshot is IceConfigSnapshot {
  if (!snapshot || snapshot.roomId !== roomId) return false;
  if (!snapshot.turnEnabled) return true;
  return !computeIceConfigTiming(snapshot, nowMonoMs, nowWallMs).isExpired;
}

function isValidIceServerEntry(raw: unknown): raw is RTCIceServer {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  const urlsValid =
    (typeof record.urls === 'string' && record.urls.trim().length > 0) ||
    (Array.isArray(record.urls) &&
      record.urls.length > 0 &&
      record.urls.every((u) => typeof u === 'string' && u.trim().length > 0));
  if (!urlsValid) return false;

  if (record.username !== undefined && typeof record.username !== 'string') return false;
  if (record.credential !== undefined && typeof record.credential !== 'string') return false;
  return true;
}

export function parseTurnCredentialsResponse(
  roomId: string,
  body: unknown,
  nowMonoMs: number,
  nowWallMs: number,
): IceConfigSnapshot | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;

  if (!Array.isArray(record.iceServers)) return null;
  const validServers = record.iceServers.filter(isValidIceServerEntry);
  if (validServers.length === 0) return null;

  const turnEnabled = Boolean(record.turnEnabled);
  if (!turnEnabled) {
    return createStunFallbackSnapshot(roomId, 'stun-only', nowMonoMs, nowWallMs, validServers);
  }

  const ttlSeconds = typeof record.ttlSeconds === 'number' && Number.isFinite(record.ttlSeconds)
    ? Math.floor(record.ttlSeconds)
    : 0;
  const expiresAtUnixSec =
    typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)
      ? Math.floor(record.expiresAt)
      : null;

  if (ttlSeconds <= 0) {
    return createStunFallbackSnapshot(roomId, 'fallback', nowMonoMs, nowWallMs);
  }

  return {
    roomId,
    iceServers: cloneIceServers(validServers),
    turnEnabled: true,
    ttlSeconds,
    expiresAtUnixSec,
    fetchedAtMonotonicMs: nowMonoMs,
    fetchedAtWallMs: nowWallMs,
    source: 'api',
  };
}

export interface FetchRoomIceConfigOptions {
  roomId: string;
  token: string;
  env?: AppUrlEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetchAppApi;
  nowMonoMs?: () => number;
  nowWallMs?: () => number;
}

/**
 * Fetches temporary ICE/TURN credentials from `GET /api/turn/credentials?roomId=<uuid>`,
 * degrading safely to STUN-only on 429/5xx/network/timeout while surfacing HTTP 401
 * explicitly for existing session expiry handling. Never runs in Dev TXT mock mode.
 */
export async function fetchRoomIceConfig(
  options: FetchRoomIceConfigOptions,
): Promise<FetchRoomIceConfigResult> {
  const nowMonoFn = options.nowMonoMs ?? (() => performance.now());
  const nowWallFn = options.nowWallMs ?? (() => Date.now());
  const requestStartMono = nowMonoFn();
  const requestStartWall = nowWallFn();

  const devMock = isDevMockSession(options.token, options.env);
  if (!options.roomId || !options.token.trim() || devMock) {
    return {
      snapshot: createStunFallbackSnapshot(
        options.roomId,
        devMock ? 'dev-mock' : 'fallback',
        requestStartMono,
        requestStartWall,
      ),
      unauthorized: false,
    };
  }

  const fetchImpl = options.fetchFn ?? fetchAppApi;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ICE_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      return {
        snapshot: createStunFallbackSnapshot(options.roomId, 'fallback', requestStartMono, requestStartWall),
        unauthorized: false,
      };
    }
    options.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const endpoint = apiUrl(`/turn/credentials?roomId=${encodeURIComponent(options.roomId)}`);
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${options.token}`,
      },
      signal: controller.signal,
    });

    const completedMono = nowMonoFn();
    const completedWall = nowWallFn();

    if (response.status === 401) {
      return {
        snapshot: createStunFallbackSnapshot(options.roomId, 'fallback', completedMono, completedWall),
        unauthorized: true,
      };
    }

    if (!response.ok) {
      return {
        snapshot: createStunFallbackSnapshot(options.roomId, 'fallback', completedMono, completedWall),
        unauthorized: false,
      };
    }

    const body: unknown = await response.json();
    const parsed = parseTurnCredentialsResponse(options.roomId, body, completedMono, completedWall);
    return {
      snapshot: parsed ?? createStunFallbackSnapshot(options.roomId, 'fallback', completedMono, completedWall),
      unauthorized: false,
    };
  } catch {
    void timedOut;
    return {
      snapshot: createStunFallbackSnapshot(options.roomId, 'fallback', nowMonoFn(), nowWallFn()),
      unauthorized: false,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Inspects `peer.getStats()` to identify whether the active nominated candidate pair uses `relay`.
 */
export async function inspectPeerSelectedCandidateType(
  peer: Pick<RTCPeerConnection, 'getStats'>,
): Promise<IceCandidateKind> {
  try {
    const stats = await peer.getStats();
    let selectedPairId: string | undefined;
    let nominatedPair: Record<string, unknown> | null = null;
    const candidates = new Map<string, Record<string, unknown>>();
    const pairs = new Map<string, Record<string, unknown>>();

    stats.forEach((rawEntry) => {
      const entry = rawEntry as Record<string, unknown>;
      if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
        selectedPairId = entry.selectedCandidatePairId;
      } else if (entry.type === 'candidate-pair' && typeof entry.id === 'string') {
        pairs.set(entry.id, entry);
        if (entry.nominated === true && (entry.state === 'succeeded' || entry.state === undefined)) {
          nominatedPair = entry;
        }
      } else if (
        (entry.type === 'local-candidate' || entry.type === 'remote-candidate') &&
        typeof entry.id === 'string'
      ) {
        candidates.set(entry.id, entry);
      }
    });

    const activePair = (selectedPairId ? pairs.get(selectedPairId) : undefined) ?? nominatedPair;
    if (!activePair) return 'unknown';

    const localCandidate =
      typeof activePair.localCandidateId === 'string'
        ? candidates.get(activePair.localCandidateId)
        : undefined;
    const remoteCandidate =
      typeof activePair.remoteCandidateId === 'string'
        ? candidates.get(activePair.remoteCandidateId)
        : undefined;

    const localType = typeof localCandidate?.candidateType === 'string' ? localCandidate.candidateType : '';
    const remoteType = typeof remoteCandidate?.candidateType === 'string' ? remoteCandidate.candidateType : '';

    if (localType === 'relay' || remoteType === 'relay') return 'relay';
    if (localType === 'srflx' || remoteType === 'srflx') return 'srflx';
    if (localType === 'prflx' || remoteType === 'prflx') return 'prflx';
    if (localType === 'host' || remoteType === 'host') return 'host';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function shouldRestartPeerForIceRenewal(
  peer: Pick<RTCPeerConnection, 'connectionState' | 'iceConnectionState'>,
  activeCandidateType: IceCandidateKind,
): boolean {
  if (peer.connectionState === 'closed') return false;
  if (activeCandidateType === 'relay') return true;
  return (
    peer.iceConnectionState === 'failed' ||
    peer.iceConnectionState === 'disconnected' ||
    peer.connectionState === 'failed' ||
    peer.connectionState === 'disconnected'
  );
}

/**
 * Preserves existing RTCConfiguration fields (e.g. `iceTransportPolicy`) while updating `iceServers`.
 */
export function updatePeerIceServersSafely(
  peer: Pick<RTCPeerConnection, 'connectionState' | 'getConfiguration' | 'setConfiguration'>,
  iceServers: RTCIceServer[],
): boolean {
  if (peer.connectionState === 'closed') return false;
  try {
    const currentConfig = typeof peer.getConfiguration === 'function' ? peer.getConfiguration() : {};
    peer.setConfiguration({
      ...currentConfig,
      iceServers: cloneIceServers(iceServers),
    });
    return true;
  } catch {
    return false;
  }
}

export interface RoomIceManagerOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetchAppApi;
  nowMonoMs?: () => number;
  nowWallMs?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  onCredentialsRefreshed?: (snapshot: IceConfigSnapshot, generation: number) => void | Promise<void>;
  onUnauthorized?: () => void;
}

export interface RoomIceManager {
  readonly getSnapshot: () => IceConfigSnapshot | null;
  readonly getGeneration: () => number;
  startRoomSession: (roomId: string, token: string) => Promise<IceConfigSnapshot>;
  ensureUsableConfig: (roomId: string, token: string) => Promise<IceConfigSnapshot>;
  handleVisibilityOrResume: () => Promise<void>;
  invalidate: () => void;
}

/**
 * Coordinates in-memory ICE/TURN credential caching, single-flight fetches, monotonic renewal timers,
 * resume/visibility expiry checks, and clean session cancellation across room transitions and revocation.
 */
export function createRoomIceManager(options: RoomIceManagerOptions = {}): RoomIceManager {
  const nowMonoFn = options.nowMonoMs ?? (() => performance.now());
  const nowWallFn = options.nowWallMs ?? (() => Date.now());
  const setTimerFn = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimerFn = options.clearTimer ?? ((handle) => clearTimeout(handle));

  let generation = 0;
  let activeRoomId: string | null = null;
  let activeToken = '';
  let snapshot: IceConfigSnapshot | null = null;
  let inFlight: { roomId: string; generation: number; promise: Promise<IceConfigSnapshot> } | null = null;
  let inFlightController: AbortController | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let unauthorizedStopped = false;

  const clearRefreshTimer = () => {
    if (refreshTimer !== null) {
      clearTimerFn(refreshTimer);
      refreshTimer = null;
    }
  };

  const abortInFlight = () => {
    if (inFlightController) {
      inFlightController.abort();
      inFlightController = null;
    }
    inFlight = null;
  };

  const scheduleNextRefresh = (entry: IceConfigSnapshot, sessionGen: number) => {
    clearRefreshTimer();
    if (unauthorizedStopped || !entry.turnEnabled || sessionGen !== generation || activeRoomId !== entry.roomId) {
      return;
    }
    const timing = computeIceConfigTiming(entry, nowMonoFn(), nowWallFn());
    if (timing.refreshDelayMs === null) return;

    refreshTimer = setTimerFn(() => {
      refreshTimer = null;
      if (sessionGen !== generation || activeRoomId !== entry.roomId || unauthorizedStopped) return;
      void performFetch(entry.roomId, activeToken, sessionGen, true);
    }, timing.refreshDelayMs);
  };

  const performFetch = (
    roomId: string,
    token: string,
    sessionGen: number,
    isRenewal: boolean,
  ): Promise<IceConfigSnapshot> => {
    if (inFlight && inFlight.roomId === roomId && inFlight.generation === sessionGen) {
      return inFlight.promise;
    }

    abortInFlight();
    const controller = new AbortController();
    inFlightController = controller;

    const promise = (async () => {
      const result = await fetchRoomIceConfig({
        roomId,
        token,
        timeoutMs: options.timeoutMs,
        signal: controller.signal,
        fetchFn: options.fetchFn,
        nowMonoMs: nowMonoFn,
        nowWallMs: nowWallFn,
      });

      if (inFlightController === controller) {
        inFlight = null;
        inFlightController = null;
      }

      if (sessionGen !== generation || activeRoomId !== roomId) {
        return createStunFallbackSnapshot(roomId, 'fallback', nowMonoFn(), nowWallFn());
      }

      if (result.unauthorized) {
        unauthorizedStopped = true;
        snapshot = null;
        clearRefreshTimer();
        options.onUnauthorized?.();
        return result.snapshot;
      }

      snapshot = result.snapshot;
      scheduleNextRefresh(result.snapshot, sessionGen);

      if (isRenewal) {
        await options.onCredentialsRefreshed?.(result.snapshot, sessionGen);
      }
      return result.snapshot;
    })();

    inFlight = { roomId, generation: sessionGen, promise };
    return promise;
  };

  return {
    getSnapshot: () => snapshot,
    getGeneration: () => generation,

    invalidate() {
      generation += 1;
      activeRoomId = null;
      activeToken = '';
      snapshot = null;
      unauthorizedStopped = false;
      clearRefreshTimer();
      abortInFlight();
    },

    async startRoomSession(roomId: string, token: string): Promise<IceConfigSnapshot> {
      generation += 1;
      const myGen = generation;
      activeRoomId = roomId;
      activeToken = token;
      snapshot = null;
      unauthorizedStopped = false;
      clearRefreshTimer();
      abortInFlight();
      return performFetch(roomId, token, myGen, false);
    },

    async ensureUsableConfig(roomId: string, token: string): Promise<IceConfigSnapshot> {
      if (unauthorizedStopped) {
        return createStunFallbackSnapshot(roomId, 'fallback', nowMonoFn(), nowWallFn());
      }
      if (activeRoomId !== roomId || activeToken !== token) {
        return this.startRoomSession(roomId, token);
      }

      const nowM = nowMonoFn();
      const nowW = nowWallFn();
      if (isIceSnapshotUsable(snapshot, roomId, nowM, nowW)) {
        const timing = computeIceConfigTiming(snapshot, nowM, nowW);
        if (timing.needsRefresh && !inFlight) {
          void performFetch(roomId, token, generation, true);
        }
        return snapshot;
      }

      // Expired or absent snapshot: never hand out expired TURN credentials.
      const hadExistingSnapshot = snapshot !== null;
      snapshot = null;
      return performFetch(roomId, token, generation, hadExistingSnapshot);
    },

    async handleVisibilityOrResume(): Promise<void> {
      const currentSnapshot = snapshot;
      if (!activeRoomId || !currentSnapshot || !currentSnapshot.turnEnabled || unauthorizedStopped) return;
      const myGen = generation;
      const roomId = activeRoomId;
      const timing = computeIceConfigTiming(currentSnapshot, nowMonoFn(), nowWallFn());
      if (timing.isExpired) {
        snapshot = null;
      }
      if (timing.needsRefresh || timing.isExpired) {
        await performFetch(roomId, activeToken, myGen, true);
      } else {
        scheduleNextRefresh(currentSnapshot, myGen);
      }
    },
  };
}
