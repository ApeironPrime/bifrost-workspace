import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FILE_ACK_TIMEOUT_MS,
  activePeerIds,
  createOutboundRecipientState,
  evaluateOutboundTransferResolution,
  markOutboundEndSent,
  reassembleChunks,
  recordOutboundPeerAck,
  recordOutboundPeerReject,
  shouldFlushInboundProgress,
} from '../src/lib/fileTransfer.ts'

test('AUD-06: shouldFlushInboundProgress throttles 640-chunk (10 MB) burst updates while flushing first, periodic >=1%/80ms, and final chunks', () => {
  const totalChunks = 640
  let lastCount = 0
  let lastAt = 0
  let flushes = 0

  for (let i = 1; i <= totalChunks; i++) {
    // Simulate chunks arriving 1ms apart across a 640ms burst transfer.
    const nowMs = i
    if (
      shouldFlushInboundProgress({
        receivedCount: i,
        totalChunks,
        lastFlushedCount: lastCount,
        lastFlushedAtMs: lastAt,
        nowMs,
      })
    ) {
      flushes++
      lastCount = i
      lastAt = nowMs
    }
  }

  assert.ok(flushes >= 3 && flushes <= 50, `Expected 3..50 throttled UI flushes for 640 chunks, got ${flushes}`)
  assert.equal(lastCount, totalChunks)

  // Slower chunk stream still avoids redundant updates until progress changes by >= 1%.
  assert.equal(
    shouldFlushInboundProgress({
      receivedCount: 2,
      totalChunks: 640,
      lastFlushedCount: 1,
      lastFlushedAtMs: 0,
      nowMs: 200,
    }),
    false,
  )
  assert.equal(
    shouldFlushInboundProgress({
      receivedCount: 8,
      totalChunks: 640,
      lastFlushedCount: 1,
      lastFlushedAtMs: 0,
      nowMs: 200,
    }),
    true,
  )
})

test('AUD-06: reassembleChunks clears receivedChunks Map immediately when clearChunks is true', async () => {
  const chunks = new Map<number, Uint8Array>([
    [0, new TextEncoder().encode('hello ')],
    [1, new TextEncoder().encode('bifrost')],
  ])
  const blob = reassembleChunks(chunks, 2, 'text/plain', { clearChunks: true })
  assert.equal(chunks.size, 0)
  assert.equal(await blob.text(), 'hello bifrost')
})

test('AUD-07: multi-peer file:reject is isolated to rejecting peer while remaining peers complete with file:ack', () => {
  const openPeers = new Set(['peer-a', 'peer-b', 'peer-c'])
  let state = createOutboundRecipientState(['peer-a', 'peer-b'])

  // Untargeted peer-c cannot interfere with this transfer.
  state = recordOutboundPeerReject(state, 'peer-c')
  assert.deepEqual(activePeerIds(state, openPeers), ['peer-a', 'peer-b'])

  // peer-b rejects mid-transfer -> peer-a continues cleanly without failing whole transfer.
  state = recordOutboundPeerReject(state, 'peer-b')
  assert.deepEqual(activePeerIds(state, openPeers), ['peer-a'])
  assert.equal(evaluateOutboundTransferResolution(state, openPeers), 'pending')

  // Even after streaming completes and endSent = true, sender waits for receiver file:ack.
  state = markOutboundEndSent(state)
  assert.equal(evaluateOutboundTransferResolution(state, openPeers), 'pending')
  assert.ok(FILE_ACK_TIMEOUT_MS >= 5000)

  // Once peer-a sends file:ack, transfer resolves completed.
  state = recordOutboundPeerAck(state, 'peer-a')
  assert.equal(evaluateOutboundTransferResolution(state, openPeers), 'completed')
})

test('AUD-07: transfer fails only when all target peers reject or disappear without ack', () => {
  const openPeers = new Set(['peer-a', 'peer-b'])
  let state = createOutboundRecipientState(openPeers)

  state = recordOutboundPeerReject(state, 'peer-a')
  assert.equal(evaluateOutboundTransferResolution(state, openPeers), 'pending')

  state = recordOutboundPeerReject(state, 'peer-b')
  assert.equal(evaluateOutboundTransferResolution(state, openPeers), 'failed')

  // Partial success persists: if peer-a acked and peer-b disconnects after endSent, transfer still completes.
  let multiEnd = markOutboundEndSent(createOutboundRecipientState(['peer-a', 'peer-b']))
  multiEnd = recordOutboundPeerAck(multiEnd, 'peer-a')
  assert.equal(evaluateOutboundTransferResolution(multiEnd, openPeers), 'pending')
  assert.equal(evaluateOutboundTransferResolution(multiEnd, new Set(['peer-a'])), 'completed')
})
