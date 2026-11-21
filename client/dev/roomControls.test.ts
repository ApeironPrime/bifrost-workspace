import test from 'node:test'
import assert from 'node:assert/strict'
import { translate } from '../src/i18n/index.ts'
import { canSendToRoom, openConnectionCount } from '../src/lib/roomControls.ts'

test('chat sending requires content, writable access and a connected recipient', () => {
  assert.equal(canSendToRoom(false, ' hello ', 1), true)
  assert.equal(canSendToRoom(false, 'hello', 0), false)
  assert.equal(canSendToRoom(true, 'hello', 3), false)
  assert.equal(canSendToRoom(false, ' \n ', 3), false)
})

test('room interaction feedback has complete nonempty VI/EN/JA copy via canonical translate', () => {
  const keys = [
    'meeting.mediaNotice',
    'meeting.previewBadge',
    'chat.noRecipients',
    'chat.sendFailed',
    'note.syncFailed',
    'note.sharedScope',
    'note.privateScope',
    'note.noSharedNotes',
    'rightPanel.copyFailed',
    'fileShare.retryButton',
    'fileShare.fileEmpty',
    'fileShare.fileHelp',
    'fileShare.retryHint',
    'fileShare.transferFailed',
    'fileShare.fileEmpty',
    'fileShare.localSent',
    'room.readonlyActionBlocked',
    'meetingBoard.boardHint',
    'meetingBoard.sessionOnly',
    'chat.messagesHeading',
    'note.notesHint',
  ] as const

  for (const key of keys) {
    for (const lang of ['vi', 'en', 'ja'] as const) {
      const value = translate(lang, key)
      assert.ok(value.trim().length > 0, `Empty translation for ${lang}:${key}`)
      assert.equal(value.startsWith('[missing:'), false, `Missing translation for ${lang}:${key}`)
    }
  }
  assert.notEqual(translate('en', 'chat.noRecipients'), translate('vi', 'chat.noRecipients'))
})

test('presence and connecting peers never count as open data recipients', () => {
  assert.equal(openConnectionCount([]), 0)
  assert.equal(openConnectionCount([{ readyState: 'connecting' }, { readyState: 'closed' }]), 0)
  assert.equal(openConnectionCount([{ readyState: 'open' }, { readyState: 'closing' }]), 1)
})
