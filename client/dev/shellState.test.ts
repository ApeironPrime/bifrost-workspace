import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getSessionStatusDisplay,
  personInitials,
  roomInitials,
  workspaceInitials,
} from '../src/lib/shellState.ts'

test('session status updates dynamically across VI/EN/JA and reserves connected tone strictly for real P2P', () => {
  const preview = { kind: 'localPreview' } as const
  assert.equal(getSessionStatusDisplay(preview, 'vi').tone, 'neutral')
  assert.equal(getSessionStatusDisplay(preview, 'en').label, 'Local preview')
  assert.equal(getSessionStatusDisplay(preview, 'ja').label, 'ローカルUIセッション')

  const waiting = { kind: 'waitingPeer' } as const
  assert.equal(getSessionStatusDisplay(waiting, 'vi').tone, 'pending')
  assert.equal(getSessionStatusDisplay(waiting, 'en').tone, 'pending')

  const connected = { kind: 'connectedP2P' } as const
  assert.equal(getSessionStatusDisplay(connected, 'vi').tone, 'connected')
  assert.equal(getSessionStatusDisplay(connected, 'en').tone, 'connected')
  assert.equal(getSessionStatusDisplay(connected, 'ja').tone, 'connected')

  const p2pError = { kind: 'error', message: 'Không thể kết nối P2P' } as const
  assert.equal(getSessionStatusDisplay(p2pError, 'vi').tone, 'error')
})

test('monogram helpers handle Vietnamese, Japanese, numbered rooms, punctuation, and surrogate pairs safely', () => {
  assert.equal(workspaceInitials('Nhóm cộng tác'), 'NC')
  assert.equal(workspaceInitials('Đội thiết kế'), 'ĐT')
  assert.equal(workspaceInitials('開発チーム'), '開発')
  assert.equal(workspaceInitials('Bifrost — Studio'), 'BS')

  assert.equal(roomInitials('Phòng họp 01'), 'P1')
  assert.equal(roomInitials('Phòng họp 02'), 'P2')
  assert.equal(roomInitials('Sprint 12'), '12')
  assert.equal(roomInitials('Phòng họp đồng bộ kiến trúc 2026'), 'PH')
  assert.equal(roomInitials('Phòng thiết kế'), 'PK')
  assert.equal(roomInitials('開発ミーティング'), '開発')
  assert.equal(roomInitials('🚀 Launch'), 'LA')

  assert.equal(personInitials('Nguyễn Minh Anh'), 'MA')
  assert.equal(personInitials('田中太郎'), '田中')
  assert.equal(personInitials('   '), 'U')
})
