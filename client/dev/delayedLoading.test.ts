import test from 'node:test'
import assert from 'node:assert/strict'
import {
  beginWorkspaceTransition,
  createDelayedLoadingController,
  DEFAULT_LOADING_DELAY_MS,
  remainingWorkspaceTransitionDelay,
  resetWorkspaceTransition,
} from '../src/lib/delayedLoading.ts'

function createFakeScheduler() {
  let nextId = 1
  const scheduled = new Map<number, { cb: () => void; delayMs: number }>()
  return {
    scheduled,
    schedule: (cb: () => void, delayMs: number) => {
      const id = nextId++
      scheduled.set(id, { cb, delayMs })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    cancel: (handle: ReturnType<typeof setTimeout>) => {
      scheduled.delete(handle as unknown as number)
    },
    flushAll: () => {
      for (const [id, entry] of [...scheduled.entries()]) {
        scheduled.delete(id)
        entry.cb()
      }
    },
  }
}

test('1: fast completion before delay threshold never displays skeleton', () => {
  const scheduler = createFakeScheduler()
  const controller = createDelayedLoadingController({
    delayMs: DEFAULT_LOADING_DELAY_MS,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  })
  const emissions: boolean[] = []
  controller.subscribe(() => emissions.push(controller.getSnapshot()))

  controller.setActive(true)
  assert.equal(controller.getSnapshot(), false)
  assert.equal(scheduler.scheduled.size, 1)

  // Loading completes under 10ms / 100ms before threshold fires.
  controller.setActive(false)
  assert.equal(controller.getSnapshot(), false)
  assert.equal(scheduler.scheduled.size, 0)
  assert.deepEqual(emissions, [])

  scheduler.flushAll()
  assert.equal(controller.getSnapshot(), false)
})

test('2-3: slow loading displays skeleton at 150ms threshold and clears on completion', () => {
  const scheduler = createFakeScheduler()
  const controller = createDelayedLoadingController({
    delayMs: DEFAULT_LOADING_DELAY_MS,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  })
  const emissions: boolean[] = []
  controller.subscribe(() => emissions.push(controller.getSnapshot()))

  controller.setActive(true)
  assert.equal(controller.getSnapshot(), false)
  assert.equal([...scheduler.scheduled.values()][0]?.delayMs, 150)

  scheduler.flushAll()
  assert.equal(controller.getSnapshot(), true)
  assert.deepEqual(emissions, [true])

  // Repeated setActive(true) while already visible does not flicker or reschedule.
  controller.setActive(true)
  assert.equal(scheduler.scheduled.size, 0)
  assert.equal(controller.getSnapshot(), true)
  assert.deepEqual(emissions, [true])

  controller.setActive(false)
  assert.equal(controller.getSnapshot(), false)
  assert.deepEqual(emissions, [true, false])
})

test('4: unmount dispose clears pending timers without late notifications', () => {
  const scheduler = createFakeScheduler()
  const controller = createDelayedLoadingController({
    delayMs: 150,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  })
  let notified = 0
  controller.subscribe(() => {
    notified += 1
  })

  controller.setActive(true)
  assert.equal(scheduler.scheduled.size, 1)

  controller.dispose()
  assert.equal(scheduler.scheduled.size, 0)
  scheduler.flushAll()
  assert.equal(controller.getSnapshot(), false)
  assert.equal(notified, 0)
})

test('5-6: loading-to-empty and loading-to-error transitions never leave stale skeleton', () => {
  const scheduler = createFakeScheduler()
  const controller = createDelayedLoadingController({
    delayMs: 150,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  })

  // Case A: loading -> empty after delay
  controller.setActive(true)
  scheduler.flushAll()
  assert.equal(controller.getSnapshot(), true)
  const resolveToEmpty = () => controller.setActive(false)
  resolveToEmpty()
  assert.equal(controller.getSnapshot(), false)

  // Case B: loading -> error before delay
  controller.setActive(true)
  assert.equal(scheduler.scheduled.size, 1)
  const resolveToError = () => controller.setActive(false)
  resolveToError()
  assert.equal(scheduler.scheduled.size, 0)
  assert.equal(controller.getSnapshot(), false)
})

test('7: repeated loading cycles do not leave stale timers or skip threshold', () => {
  const scheduler = createFakeScheduler()
  const controller = createDelayedLoadingController({
    delayMs: 150,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  })

  // Cycle 1: fast
  controller.setActive(true)
  controller.setActive(false)
  assert.equal(scheduler.scheduled.size, 0)

  // Cycle 2: slow
  controller.setActive(true)
  scheduler.flushAll()
  assert.equal(controller.getSnapshot(), true)

  // Cycle 3: reset then restart must wait full delay again
  controller.setActive(false)
  assert.equal(controller.getSnapshot(), false)
  controller.setActive(true)
  assert.equal(controller.getSnapshot(), false)
  assert.equal(scheduler.scheduled.size, 1)

  scheduler.flushAll()
  assert.equal(controller.getSnapshot(), true)
})

test('shared workspace transition clock carries remaining delay across Suspense and authReady', () => {
  resetWorkspaceTransition()
  assert.equal(remainingWorkspaceTransitionDelay(150, 1000), 150)

  beginWorkspaceTransition(1000)
  assert.equal(remainingWorkspaceTransitionDelay(150, 1080), 70)
  assert.equal(remainingWorkspaceTransitionDelay(150, 1150), 0)
  assert.equal(remainingWorkspaceTransitionDelay(150, 1300), 0)

  // Second beginWorkspaceTransition does not reset an active transition window.
  beginWorkspaceTransition(1120)
  assert.equal(remainingWorkspaceTransitionDelay(150, 1130), 20)

  resetWorkspaceTransition()
  assert.equal(remainingWorkspaceTransitionDelay(150, 2000), 150)
})
