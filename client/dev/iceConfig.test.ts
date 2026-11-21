import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STUN_ICE_SERVERS,
  computeIceConfigTiming,
  computeRefreshLeadSeconds,
  createRoomIceManager,
  fetchRoomIceConfig,
  inspectPeerSelectedCandidateType,
  isIceSnapshotUsable,
  shouldRestartPeerForIceRenewal,
  updatePeerIceServersSafely,
} from '../src/lib/iceConfig.ts';
import {
  createPeerSignalingRecord,
  handleIncomingAnswer,
  handleIncomingIceCandidate,
  handleIncomingOffer,
  handlePeerConnectionStateTransition,
  isPolitePeer,
  negotiatePeerOffer,
} from '../src/lib/peerSignaling.ts';

test('fetchRoomIceConfig skips network in Dev TXT mock mode and gracefully falls back on 5xx/429/network', async () => {
  let called = 0;
  const mockSession = await fetchRoomIceConfig({
    roomId: 'room-1',
    token: 'bifrost-txt-token',
    env: { DEV: true },
    fetchFn: async () => {
      called += 1;
      throw new Error('Should not hit network');
    },
  });
  assert.equal(called, 0);
  assert.equal(mockSession.snapshot.source, 'dev-mock');
  assert.deepEqual(mockSession.snapshot.iceServers, DEFAULT_STUN_ICE_SERVERS);

  // In production (`DEV: false`), a spoofed `bifrost-txt-` token is NOT treated as mock mode.
  let prodCalled = 0;
  const prodFakeTxtToken = await fetchRoomIceConfig({
    roomId: 'room-1',
    token: 'bifrost-txt-token',
    env: { DEV: false },
    fetchFn: async () => {
      prodCalled += 1;
      return new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 });
    },
  });
  assert.equal(prodCalled, 1);
  assert.equal(prodFakeTxtToken.unauthorized, true);

  const server500 = await fetchRoomIceConfig({
    roomId: 'room-1',
    token: 'jwt-real-token',
    fetchFn: async () => new Response(JSON.stringify({ message: 'err' }), { status: 500 }),
  });
  assert.equal(server500.unauthorized, false);
  assert.equal(server500.snapshot.source, 'fallback');
  assert.deepEqual(server500.snapshot.iceServers, DEFAULT_STUN_ICE_SERVERS);

  const rate429 = await fetchRoomIceConfig({
    roomId: 'room-1',
    token: 'jwt-real-token',
    fetchFn: async () => new Response(JSON.stringify({ message: 'rate limit' }), { status: 429 }),
  });
  assert.equal(rate429.unauthorized, false);
  assert.equal(rate429.snapshot.source, 'fallback');

  const unauth401 = await fetchRoomIceConfig({
    roomId: 'room-1',
    token: 'jwt-real-token',
    fetchFn: async () => new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401 }),
  });
  assert.equal(unauth401.unauthorized, true);
  assert.equal(unauth401.snapshot.source, 'fallback');
});

test('monotonic timing refreshes 180s before 900s expiry and detects sleep/background wake without local clock skew bug', () => {
  assert.equal(computeRefreshLeadSeconds(900), 180);
  assert.equal(computeRefreshLeadSeconds(60), 15);

  const snapshot = {
    roomId: 'room-1',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:127.0.0.1:3478?transport=udp', username: 'u', credential: 'c' },
    ],
    turnEnabled: true,
    ttlSeconds: 900,
    expiresAtUnixSec: 1_700_000_900,
    fetchedAtMonotonicMs: 10_000,
    fetchedAtWallMs: 1_700_000_000_000,
    source: 'api' as const,
  };

  // Even if local wall clock shifts backwards by 1 hour, monotonic timer still tracks remaining delay.
  const beforeRefresh = computeIceConfigTiming(snapshot, 10_000 + 700_000, 1_700_000_000_000 - 3_600_000);
  assert.equal(beforeRefresh.needsRefresh, false);
  assert.equal(beforeRefresh.isExpired, false);
  assert.equal(beforeRefresh.refreshDelayMs, 20_000);

  const atRefreshWindow = computeIceConfigTiming(snapshot, 10_000 + 720_000, 1_700_000_000_000);
  assert.equal(atRefreshWindow.needsRefresh, true);
  assert.equal(atRefreshWindow.isExpired, false);
  assert.equal(isIceSnapshotUsable(snapshot, 'room-1', 10_000 + 720_000, 1_700_000_000_000), true);

  // At 900s, cached credential must be rejected as expired.
  const atExpiry = computeIceConfigTiming(snapshot, 10_000 + 900_000, 1_700_000_000_000);
  assert.equal(atExpiry.isExpired, true);
  assert.equal(isIceSnapshotUsable(snapshot, 'room-1', 10_000 + 900_000, 1_700_000_000_000), false);

  // If monotonic clock froze during OS suspend while wall elapsed passed 750s, wake check still refreshes.
  const afterOsSleep = computeIceConfigTiming(snapshot, 10_000 + 5_000, 1_700_000_000_000 + 750_000);
  assert.equal(afterOsSleep.needsRefresh, true);
  assert.equal(afterOsSleep.refreshDelayMs, 0);
});

test('createRoomIceManager deduplicates concurrent fetches, cancels stale room responses, and handles renewal & unauthorized cleanup', async () => {
  let monoNow = 1000;
  const wallNow = 1_700_000_000_000;
  let fetchCount = 0;
  let refreshedCallbacks = 0;
  let unauthCount = 0;
  let clearedTimers = 0;
  let scheduledCallback: (() => void) | null = null;
  let resolveSlowRoom1: ((res: Response) => void) | null = null;

  const manager = createRoomIceManager({
    nowMonoMs: () => monoNow,
    nowWallMs: () => wallNow,
    setTimer: (fn) => {
      scheduledCallback = fn;
      return 123 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      clearedTimers += 1;
      scheduledCallback = null;
    },
    onCredentialsRefreshed: () => {
      refreshedCallbacks += 1;
    },
    onUnauthorized: () => {
      unauthCount += 1;
    },
    fetchFn: async (url) => {
      fetchCount += 1;
      if (String(url).includes('room-slow')) {
        return new Promise<Response>((resolve) => {
          resolveSlowRoom1 = resolve;
        });
      }
      return new Response(
        JSON.stringify({
          iceServers: [
            { urls: ['stun:stun.l.google.com:19302'] },
            { urls: ['turn:127.0.0.1:3478?transport=udp'], username: `u${fetchCount}`, credential: `c${fetchCount}` },
          ],
          expiresAt: 1_700_000_900,
          ttlSeconds: 900,
          turnEnabled: true,
        }),
        { status: 200 },
      );
    },
  });

  // Start slow room-1 fetch, then immediately switch to room-2: stale room-1 response must not overwrite cache.
  const slowPromise = manager.startRoomSession('room-slow', 'jwt-1');
  const room2Promise = manager.startRoomSession('room-2', 'jwt-1');
  const room2Snapshot = await room2Promise;
  assert.equal(room2Snapshot.roomId, 'room-2');
  assert.equal(room2Snapshot.turnEnabled, true);

  resolveSlowRoom1?.(
    new Response(
      JSON.stringify({
        iceServers: [{ urls: 'turn:old', username: 'stale', credential: 'stale' }],
        expiresAt: 1_700_000_900,
        ttlSeconds: 900,
        turnEnabled: true,
      }),
      { status: 200 },
    ),
  );
  await slowPromise;
  assert.equal(manager.getSnapshot()?.roomId, 'room-2');

  // Concurrent ensureUsableConfig calls reuse cache cleanly without extra fetches.
  const hits = await Promise.all([
    manager.ensureUsableConfig('room-2', 'jwt-1'),
    manager.ensureUsableConfig('room-2', 'jwt-1'),
    manager.ensureUsableConfig('room-2', 'jwt-1'),
  ]);
  assert.equal(fetchCount, 2);
  assert.equal(hits[0].iceServers[1]?.username, 'u2');

  // Fire scheduled renewal timer -> fetches fresh credential & invokes callback.
  monoNow += 720_000;
  assert.ok(scheduledCallback);
  scheduledCallback();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(refreshedCallbacks, 1);
  assert.equal(manager.getSnapshot()?.iceServers[1]?.username, 'u3');

  // Exceed TTL -> cached credential expired -> forces fresh fetch rather than returning expired credential.
  monoNow += 950_000;
  const renewedAfterExpiry = await manager.ensureUsableConfig('room-2', 'jwt-1');
  assert.equal(renewedAfterExpiry.iceServers[1]?.username, 'u4');

  // Invalidate cleans timer and cache.
  manager.invalidate();
  assert.equal(manager.getSnapshot(), null);
  assert.ok(clearedTimers >= 1);

  // HTTP 401 stops refresh retries cleanly and notifies handler once.
  const unauthManager = createRoomIceManager({
    onUnauthorized: () => {
      unauthCount += 1;
    },
    fetchFn: async () => new Response(JSON.stringify({ message: 'bad token' }), { status: 401 }),
  });
  await unauthManager.startRoomSession('room-unauth', 'expired-jwt');
  const second = await unauthManager.ensureUsableConfig('room-unauth', 'expired-jwt');
  assert.equal(unauthCount, 1);
  assert.equal(second.source, 'fallback');
});

test('inspectPeerSelectedCandidateType distinguishes relay vs host/srflx and preserves RTCConfiguration on update', async () => {
  const buildFakePeer = (candidateType: string, extraConfig: Partial<RTCConfiguration> = {}) => {
    let storedConfig: RTCConfiguration = { iceTransportPolicy: 'relay', ...extraConfig };
    const statsEntries = new Map<string, Record<string, unknown>>([
      ['t1', { type: 'transport', id: 't1', selectedCandidatePairId: 'cp1' }],
      ['cp1', { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, localCandidateId: 'lc1', remoteCandidateId: 'rc1' }],
      ['lc1', { type: 'local-candidate', id: 'lc1', candidateType }],
      ['rc1', { type: 'remote-candidate', id: 'rc1', candidateType: 'host' }],
    ]);
    return {
      connectionState: 'connected' as RTCPeerConnectionState,
      iceConnectionState: 'connected' as RTCIceConnectionState,
      getConfiguration: () => storedConfig,
      setConfiguration: (next: RTCConfiguration) => {
        storedConfig = next;
      },
      getStats: async () => statsEntries as unknown as RTCStatsReport,
    };
  };

  const relayPeer = buildFakePeer('relay');
  const hostPeer = buildFakePeer('host');

  assert.equal(await inspectPeerSelectedCandidateType(relayPeer), 'relay');
  assert.equal(await inspectPeerSelectedCandidateType(hostPeer), 'host');
  assert.equal(shouldRestartPeerForIceRenewal(relayPeer, 'relay'), true);
  assert.equal(shouldRestartPeerForIceRenewal(hostPeer, 'host'), false);

  const updated = updatePeerIceServersSafely(relayPeer, [{ urls: 'turn:127.0.0.1:3478', username: 'u', credential: 'c' }]);
  assert.equal(updated, true);
  assert.equal(relayPeer.getConfiguration().iceTransportPolicy, 'relay');
  assert.equal(relayPeer.getConfiguration().iceServers?.[0]?.username, 'u');
});

test('Perfect Negotiation: concurrent ICE restart collision, queued pendingRestart, late answer ignore, and candidate queue flush', async () => {
  function createMockPeer() {
    const appliedCandidates: RTCIceCandidateInit[] = [];
    let restartCalls = 0;
    const peer = {
      connectionState: 'connected' as RTCPeerConnectionState,
      iceConnectionState: 'connected' as RTCIceConnectionState,
      signalingState: 'stable' as RTCSignalingState,
      remoteDescription: null as RTCSessionDescriptionInit | null,
      localDescription: null as RTCSessionDescriptionInit | null,
      restartIce: () => {
        restartCalls += 1;
      },
      createOffer: async (opts?: RTCOfferOptions) => ({
        type: 'offer' as const,
        sdp: `offer-${opts?.iceRestart ? 'restart' : 'init'}-${restartCalls}`,
      }),
      createAnswer: async () => ({ type: 'answer' as const, sdp: 'answer-sdp' }),
      setLocalDescription: async (desc: RTCLocalSessionDescriptionInit) => {
        if (desc.type === 'rollback') {
          peer.signalingState = 'stable';
          peer.localDescription = null;
          return;
        }
        peer.localDescription = desc;
        peer.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
      },
      setRemoteDescription: async (desc: RTCSessionDescriptionInit) => {
        if (desc.type === 'offer' && peer.signalingState === 'have-local-offer') {
          peer.signalingState = 'have-remote-offer';
        } else if (desc.type === 'offer') {
          peer.signalingState = 'have-remote-offer';
        } else if (desc.type === 'answer') {
          peer.signalingState = 'stable';
        }
        peer.remoteDescription = desc;
      },
      addIceCandidate: async (candidate: RTCIceCandidateInit) => {
        appliedCandidates.push(candidate);
      },
      appliedCandidates,
      getRestartCalls: () => restartCalls,
    };
    return peer;
  }

  // Peer A ("aaa") is polite, Peer B ("zzz") is impolite.
  assert.equal(isPolitePeer('aaa', 'zzz'), true);
  assert.equal(isPolitePeer('zzz', 'aaa'), false);

  const peerA = createMockPeer();
  const recordA = createPeerSignalingRecord();
  const peerB = createMockPeer();
  const recordB = createPeerSignalingRecord();

  // Queue an early ICE candidate BEFORE peerA receives remote description.
  const earlyCandidate = { candidate: 'candidate:1 1 udp 2130706431 127.0.0.1 50000 typ host' };
  const candidateOutcome = await handleIncomingIceCandidate({
    peer: peerA,
    record: recordA,
    candidate: earlyCandidate,
  });
  assert.equal(candidateOutcome, 'queued');
  assert.equal(peerA.appliedCandidates.length, 0);

  // Simultaneous ICE restart collision: both send offers before receiving each other's offer.
  let offerFromA: RTCSessionDescriptionInit | null = null;
  let offerFromB: RTCSessionDescriptionInit | null = null;

  assert.equal(
    await negotiatePeerOffer({
      peer: peerA,
      record: recordA,
      iceRestart: true,
      isContextValid: () => true,
      emitOffer: (d) => {
        offerFromA = d;
      },
    }),
    true,
  );
  assert.equal(
    await negotiatePeerOffer({
      peer: peerB,
      record: recordB,
      iceRestart: true,
      isContextValid: () => true,
      emitOffer: (d) => {
        offerFromB = d;
      },
    }),
    true,
  );
  assert.equal(peerA.signalingState, 'have-local-offer');
  assert.equal(peerB.signalingState, 'have-local-offer');

  // If another ICE restart is requested while already negotiating, it queues cleanly.
  assert.equal(
    await negotiatePeerOffer({
      peer: peerB,
      record: recordB,
      iceRestart: true,
      isContextValid: () => true,
      emitOffer: () => {},
    }),
    false,
  );
  assert.equal(recordB.pendingRestart, true);

  // Impolite B ignores A's colliding offer.
  const bHandle = await handleIncomingOffer({
    peer: peerB,
    record: recordB,
    offer: offerFromA!,
    localPeerId: 'zzz',
    remotePeerId: 'aaa',
    isContextValid: () => true,
    emitAnswer: () => {
      throw new Error('Impolite peer should not answer colliding offer');
    },
  });
  assert.equal(bHandle, 'ignored');
  assert.equal(recordB.ignoreOffer, true);

  // Polite A rolls back local offer, accepts B's offer, flushes queued candidate, and emits answer.
  let answerFromA: RTCSessionDescriptionInit | null = null;
  const aHandle = await handleIncomingOffer({
    peer: peerA,
    record: recordA,
    offer: offerFromB!,
    localPeerId: 'aaa',
    remotePeerId: 'zzz',
    isContextValid: () => true,
    emitAnswer: (ans) => {
      answerFromA = ans;
    },
  });
  assert.equal(aHandle, 'answered');
  assert.equal(peerA.signalingState, 'stable');
  assert.equal(peerA.appliedCandidates.length, 1);

  // B receives A's answer, stabilizes, and fires pendingRestart callback.
  let pendingRestartTriggered = false;
  const bAnswerResult = await handleIncomingAnswer({
    peer: peerB,
    record: recordB,
    answer: answerFromA!,
    isContextValid: () => true,
    onPendingRestartReady: () => {
      pendingRestartTriggered = true;
    },
  });
  assert.equal(bAnswerResult, 'applied');
  assert.equal(peerB.signalingState, 'stable');
  assert.equal(pendingRestartTriggered, true);

  // Duplicate/late answer in stable state is ignored safely without InvalidStateError.
  assert.equal(
    await handleIncomingAnswer({
      peer: peerB,
      record: recordB,
      answer: answerFromA!,
      isContextValid: () => true,
    }),
    'ignored',
  );
});

test('Perfect Negotiation serializes incoming offer arriving mid-createOffer without have-remote-offer race', async () => {
  let releaseOffer!: () => void;
  const offerGate = new Promise<void>((resolve) => {
    releaseOffer = resolve;
  });

  const peer = {
    connectionState: 'connected' as RTCPeerConnectionState,
    iceConnectionState: 'connected' as RTCIceConnectionState,
    signalingState: 'stable' as RTCSignalingState,
    remoteDescription: null as RTCSessionDescriptionInit | null,
    localDescription: null as RTCSessionDescriptionInit | null,
    createOffer: async () => {
      await offerGate;
      return { type: 'offer' as const, sdp: 'local-offer' };
    },
    createAnswer: async () => ({ type: 'answer' as const, sdp: 'local-answer' }),
    setLocalDescription: async (desc: RTCLocalSessionDescriptionInit) => {
      if (desc.type === 'rollback') {
        assert.equal(peer.signalingState, 'have-local-offer');
        peer.signalingState = 'stable';
        peer.localDescription = null;
        return;
      }
      assert.equal(
        desc.type === 'offer' ? peer.signalingState : peer.signalingState,
        desc.type === 'offer' ? 'stable' : 'have-remote-offer',
      );
      peer.localDescription = desc;
      peer.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    },
    setRemoteDescription: async (desc: RTCSessionDescriptionInit) => {
      if (desc.type === 'offer') {
        assert.equal(peer.signalingState, 'stable');
        peer.signalingState = 'have-remote-offer';
      }
      peer.remoteDescription = desc;
    },
    addIceCandidate: async () => {},
  };

  const record = createPeerSignalingRecord();
  let emittedAnswer = '';

  const offerPromise = negotiatePeerOffer({
    peer,
    record,
    iceRestart: true,
    isContextValid: () => true,
    emitOffer: () => {},
  });

  // Incoming offer arrives while createOffer() is still pending (as happens over Socket.IO in Chrome).
  const incomingPromise = handleIncomingOffer({
    peer,
    record,
    offer: { type: 'offer', sdp: 'remote-offer' },
    localPeerId: 'aaa', // polite
    remotePeerId: 'zzz',
    isContextValid: () => true,
    emitAnswer: (ans) => {
      emittedAnswer = ans.sdp ?? '';
    },
  });

  releaseOffer();
  const [didOffer, offerOutcome] = await Promise.all([offerPromise, incomingPromise]);
  assert.equal(didOffer, true);
  assert.equal(offerOutcome, 'answered');
  assert.equal(emittedAnswer, 'local-answer');
  assert.equal(peer.signalingState, 'stable');
});

test('Transient disconnected grace period recovers cleanly without premature close and clears on closed', async () => {
  const peer = { connectionState: 'disconnected' as RTCPeerConnectionState };
  const record = createPeerSignalingRecord();
  let closed = 0;
  let recovered = 0;

  handlePeerConnectionStateTransition({
    peer,
    record,
    graceMs: 30,
    isPeerVerified: () => true,
    isSignalingConnected: () => true,
    attemptIceRecovery: () => {
      recovered += 1;
    },
    onClosePeer: () => {
      closed += 1;
    },
  });

  // Must not close immediately on transient disconnect.
  assert.equal(closed, 0);
  assert.equal(recovered, 0);

  // Peer recovers before grace expires -> cancels timer, zero close, zero unnecessary restart.
  peer.connectionState = 'connected';
  handlePeerConnectionStateTransition({
    peer,
    record,
    graceMs: 30,
    isPeerVerified: () => true,
    isSignalingConnected: () => true,
    attemptIceRecovery: () => {
      recovered += 1;
    },
    onClosePeer: () => {
      closed += 1;
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(recovered, 0);
  assert.equal(closed, 0);

  // Prolonged disconnect triggers 1 recovery attempt, then closes only if still disconnected after confirmation window.
  peer.connectionState = 'disconnected';
  handlePeerConnectionStateTransition({
    peer,
    record,
    graceMs: 25,
    isPeerVerified: () => true,
    isSignalingConnected: () => true,
    attemptIceRecovery: () => {
      recovered += 1;
    },
    onClosePeer: () => {
      closed += 1;
    },
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(recovered, 1);
  assert.equal(closed, 1);
});
