import test from 'node:test'
import assert from 'node:assert/strict'
import { ROOM_TAB_ORDER } from '../src/lib/tabDirection.ts'
import {
  getNextRoomTab,
  roomPanelElementId,
  roomTabElementId,
  roomTabTabIndex,
} from '../src/lib/roomTabs.ts'

test('ArrowRight advances across tabs in visual order and wraps files to meeting', () => {
  assert.equal(getNextRoomTab('meeting', 'ArrowRight'), 'board')
  assert.equal(getNextRoomTab('board', 'ArrowRight'), 'chat')
  assert.equal(getNextRoomTab('chat', 'ArrowRight'), 'notes')
  assert.equal(getNextRoomTab('notes', 'ArrowRight'), 'files')
  assert.equal(getNextRoomTab('files', 'ArrowRight'), 'meeting')
})

test('ArrowLeft reverses across tabs and wraps meeting to files', () => {
  assert.equal(getNextRoomTab('files', 'ArrowLeft'), 'notes')
  assert.equal(getNextRoomTab('notes', 'ArrowLeft'), 'chat')
  assert.equal(getNextRoomTab('chat', 'ArrowLeft'), 'board')
  assert.equal(getNextRoomTab('board', 'ArrowLeft'), 'meeting')
  assert.equal(getNextRoomTab('meeting', 'ArrowLeft'), 'files')
})

test('Home and End jump to the first and last room tabs', () => {
  for (const tab of ROOM_TAB_ORDER) {
    assert.equal(getNextRoomTab(tab, 'Home'), ROOM_TAB_ORDER[0])
    assert.equal(getNextRoomTab(tab, 'End'), ROOM_TAB_ORDER[ROOM_TAB_ORDER.length - 1])
  }
})

test('non-navigation and modifier keys return null so native handling is preserved', () => {
  for (const key of ['Enter', ' ', 'Spacebar', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape', 'a']) {
    assert.equal(getNextRoomTab('chat', key), null)
  }
  for (const modifiers of [
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
  ]) {
    assert.equal(getNextRoomTab('chat', 'ArrowRight', modifiers), null)
    assert.equal(getNextRoomTab('chat', 'ArrowLeft', modifiers), null)
    assert.equal(getNextRoomTab('chat', 'Home', modifiers), null)
    assert.equal(getNextRoomTab('chat', 'End', modifiers), null)
  }
})

test('roomTabTabIndex implements roving tabindex with exactly one stop', () => {
  for (const activeTab of ROOM_TAB_ORDER) {
    const stops = ROOM_TAB_ORDER.map((tab) => roomTabTabIndex(tab, activeTab))
    assert.deepEqual(
      stops,
      ROOM_TAB_ORDER.map((tab) => (tab === activeTab ? 0 : -1)),
    )
    assert.equal(stops.filter((value) => value === 0).length, 1)
  }
})

test('roomTabElementId and roomPanelElementId produce unique ARIA linkage IDs', () => {
  const tabIds = ROOM_TAB_ORDER.map(roomTabElementId)
  const panelIds = ROOM_TAB_ORDER.map(roomPanelElementId)
  assert.equal(new Set(tabIds).size, ROOM_TAB_ORDER.length)
  assert.equal(new Set(panelIds).size, ROOM_TAB_ORDER.length)
  assert.deepEqual(tabIds, ['room-tab-meeting', 'room-tab-board', 'room-tab-chat', 'room-tab-notes', 'room-tab-files'])
  assert.deepEqual(panelIds, ['room-panel-meeting', 'room-panel-board', 'room-panel-chat', 'room-panel-notes', 'room-panel-files'])
})
