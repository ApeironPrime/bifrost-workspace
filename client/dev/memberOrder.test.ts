import test from 'node:test'
import assert from 'node:assert/strict'
import { orderMembers } from '../src/lib/memberOrder.ts'
const member = (userId: string, name: string, role = 'MEMBER') => ({ userId, user: { name }, roomAssignments: [{ roomId: 'room-a', role }] })
test('room host precedes members even if their name sorts last', () => {
  const original = [member('a', 'Nguyễn Văn An'), member('z', 'Trần Yuki', 'HOST'), member('b', 'Lê Bình')]
  assert.deepEqual(orderMembers(original, 'room-a').map(row => row.userId), ['z', 'a', 'b'])
  assert.deepEqual(original.map(row => row.userId), ['a', 'z', 'b'])
})
test('same role sorts by given name, then full name, without case/spacing noise', () => {
  const rows = [member('k', 'Văn Khánh'), member('b', 'Trần Bình'), member('a2', 'Nguyễn An'), member('a1', '  Lê   an  ')]
  assert.deepEqual(orderMembers(rows).map(row => row.userId), ['a1', 'a2', 'b', 'k'])
})
test('being a host of another room does not raise priority in this room', () => {
  assert.deepEqual(orderMembers([member('z', 'Yuki', 'HOST'), member('a', 'An')], 'room-b').map(row => row.userId), ['a', 'z'])
})
test('permission outranks label priority; labels outrank name only at same permission', () => {
  const rows = [
    { ...member('viewer', 'An', 'VIEWER'), roomAssignments: [{ roomId: 'room-a', role: 'VIEWER', labelIds: ['high'] }] },
    { ...member('member', 'Bình'), roomAssignments: [{ roomId: 'room-a', role: 'MEMBER', labelIds: ['high'] }] },
    { ...member('member2', 'An'), roomAssignments: [{ roomId: 'room-a', role: 'MEMBER', labelIds: ['low'] }] },
    member('mod', 'Yuki', 'MODERATOR'), member('host', 'Zoe', 'HOST'),
  ]
  assert.deepEqual(orderMembers(rows, 'room-a', [{ id: 'high', roomId: 'room-a', priority: 1 }, { id: 'low', roomId: 'room-a', priority: 10 }]).map(row => row.userId), ['host', 'mod', 'member', 'member2', 'viewer'])
})
