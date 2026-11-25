import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySenderEncodingParameters,
  classifyNetworkQuality,
  computeMeshAudioBitrate,
  computeMeshVideoProfile,
  computeVoiceSpectrumFromBins,
  parsePeerStatsReport,
  resolveGridCountClass,
} from '../src/lib/mediaQuality.ts';

test('computeMeshVideoProfile scales down camera bitrate and resolution as peers grow', () => {
  const solo = computeMeshVideoProfile(1, false);
  const small = computeMeshVideoProfile(3, false);
  const medium = computeMeshVideoProfile(5, false);
  const large = computeMeshVideoProfile(8, false);

  assert.equal(solo.tier, 'hd');
  assert.equal(solo.maxBitrate, 1_500_000);
  assert.equal(solo.scaleResolutionDownBy, 1);

  assert.equal(small.tier, 'sd');
  assert.equal(small.maxBitrate, 650_000);
  assert.equal(small.scaleResolutionDownBy, 1.5);

  assert.equal(medium.tier, 'eco');
  assert.equal(medium.maxBitrate, 320_000);
  assert.equal(medium.scaleResolutionDownBy, 2);

  assert.equal(large.tier, 'low');
  assert.equal(large.maxBitrate, 180_000);
  assert.equal(large.scaleResolutionDownBy, 3);
});

test('computeMeshVideoProfile preserves sharpness preference for screen share', () => {
  const screenSmall = computeMeshVideoProfile(2, true);
  const screenMid = computeMeshVideoProfile(4, true);
  const screenLarge = computeMeshVideoProfile(7, true);

  assert.equal(screenSmall.tier, 'hd');
  assert.equal(screenSmall.degradationPreference, 'maintain-resolution');
  assert.equal(screenMid.tier, 'sd');
  assert.equal(screenMid.maxBitrate, 1_100_000);
  assert.equal(screenLarge.tier, 'eco');
  assert.equal(screenLarge.maxFramerate, 10);
});

test('computeMeshAudioBitrate scales audio bitrate safely for larger rooms', () => {
  assert.equal(computeMeshAudioBitrate(1), 48_000);
  assert.equal(computeMeshAudioBitrate(3), 48_000);
  assert.equal(computeMeshAudioBitrate(5), 32_000);
  assert.equal(computeMeshAudioBitrate(8), 24_000);
});

test('applySenderEncodingParameters updates encodings safely and tolerates rejections', async () => {
  let captured: RTCRtpSendParameters | null = null;
  await applySenderEncodingParameters(
    {
      getParameters: () => ({ encodings: [{}], codecs: [], headerExtensions: [], rtcp: {}, transactionId: 't1' }),
      setParameters: async (next) => {
        captured = next;
      },
    },
    {
      maxBitrate: 320_000,
      maxFramerate: 18,
      scaleResolutionDownBy: 2,
      degradationPreference: 'maintain-framerate',
    },
  );

  assert.ok(captured);
  assert.equal(captured!.encodings[0].maxBitrate, 320_000);
  assert.equal(captured!.encodings[0].maxFramerate, 18);
  assert.equal(captured!.encodings[0].scaleResolutionDownBy, 2);
  assert.equal(captured!.degradationPreference, 'maintain-framerate');

  await applySenderEncodingParameters(
    {
      getParameters: () => ({ encodings: [], codecs: [], headerExtensions: [], rtcp: {}, transactionId: 't2' }),
      setParameters: async () => {
        throw new Error('InvalidStateError');
      },
    },
    { maxBitrate: 180_000 },
  );
});

test('parsePeerStatsReport extracts RTT, jitter, windowed packet loss, and quality level', () => {
  const first = parsePeerStatsReport([
    { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.042 },
    { type: 'inbound-rtp', packetsLost: 1, packetsReceived: 99, jitter: 0.008 },
  ]);
  assert.equal(first.summary.rttMs, 42);
  assert.equal(first.summary.packetLossPct, 1);
  assert.equal(first.summary.jitterMs, 8);
  assert.equal(first.summary.level, 'good');

  const second = parsePeerStatsReport(
    [
      { type: 'candidate-pair', state: 'succeeded', selected: true, currentRoundTripTime: 0.21 },
      { type: 'inbound-rtp', packetsLost: 5, packetsReceived: 195, jitter: 0.025 },
    ],
    first.nextCounters,
  );
  assert.equal(second.summary.rttMs, 210);
  // Delta: 4 lost / (4 + 96) = 4.0%
  assert.equal(second.summary.packetLossPct, 4);
  assert.equal(second.summary.level, 'fair');

  assert.equal(classifyNetworkQuality(null, 0), 'unknown');
  assert.equal(classifyNetworkQuality(340, 0.2), 'poor');
  assert.equal(classifyNetworkQuality(50, 6.2), 'poor');
});

test('computeVoiceSpectrumFromBins distinguishes silence from active speech', () => {
  const silent = computeVoiceSpectrumFromBins(new Uint8Array(32));
  assert.equal(silent.speaking, false);
  assert.equal(silent.bars.length, 13);

  const loud = new Uint8Array(32).fill(180);
  const active = computeVoiceSpectrumFromBins(loud);
  assert.equal(active.speaking, true);
  assert.ok(active.bars.every((h) => h >= 4 && h <= 28));
  assert.ok(Math.max(...active.bars) > 20);
});

test('resolveGridCountClass supports 1..6 explicit layouts and count-many for 7+', () => {
  assert.equal(resolveGridCountClass(0), 'count-1');
  assert.equal(resolveGridCountClass(1), 'count-1');
  assert.equal(resolveGridCountClass(6), 'count-6');
  assert.equal(resolveGridCountClass(7), 'count-many');
  assert.equal(resolveGridCountClass(14), 'count-many');
});
