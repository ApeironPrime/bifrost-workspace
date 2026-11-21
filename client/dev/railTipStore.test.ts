import test from 'node:test'
import assert from 'node:assert/strict'
import { createRailTipStore } from '../src/lib/railTipStore.ts'

test('railTipStore deduplicates equal updates and supports subscribe/unsubscribe', () => {
  const store = createRailTipStore()
  assert.equal(store.getSnapshot(), null)

  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })

  // Clearing while already null does not emit
  store.set(null)
  assert.equal(notifications, 0)

  // Distinct tooltip notifies subscribers
  store.set({ label: 'Overview', top: 140 })
  assert.deepEqual(store.getSnapshot(), { label: 'Overview', top: 140 })
  assert.equal(notifications, 1)

  // Same label and top does not re-notify
  store.set({ label: 'Overview', top: 140 })
  assert.equal(notifications, 1)

  // Moving to another rail item notifies again
  store.set({ label: 'Design Room', top: 204 })
  assert.deepEqual(store.getSnapshot(), { label: 'Design Room', top: 204 })
  assert.equal(notifications, 2)

  // Unsubscribing prevents further notifications
  unsubscribe()
  store.set(null)
  assert.equal(store.getSnapshot(), null)
  assert.equal(notifications, 2)
})
