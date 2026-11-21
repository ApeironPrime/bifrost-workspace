import test from 'node:test'
import assert from 'node:assert/strict'
import { ROOM_TAB_ORDER, tabDirection } from '../src/lib/tabDirection.ts'

test('room slides follow the visible tab order, including skipped tabs', () => {
  for (let a = 0; a < ROOM_TAB_ORDER.length; a++) {
    for (let b = 0; b < ROOM_TAB_ORDER.length; b++) {
      if (a !== b) assert.equal(tabDirection(ROOM_TAB_ORDER[a], ROOM_TAB_ORDER[b]), b > a ? 'forward' : 'backward')
    }
  }
})
test('chat to notes slides left, returning to chat reverses the track', () => {
  assert.equal(tabDirection('chat', 'notes'), 'forward')
  assert.equal(tabDirection('notes', 'chat'), 'backward')
})
