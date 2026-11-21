import test from 'node:test'
import assert from 'node:assert/strict'
import { withCurrentUserHost } from '../src/lib/roomHostProfile.ts'
import { searchKey } from '../src/lib/selectOptions.ts'

test('saved host profile updates all matching room names and search without mutating room snapshots', () => {
  const oldHost = { id: 'owner', name: 'QA Tên Cũ', email: 'old@example.test' }
  const snapshots = [
    { id: 'design', hostId: 'owner', host: oldHost, access: 'HOST', name: 'Thiết kế' },
    { id: 'planning', hostId: 'owner', host: oldHost, access: 'OWNER', name: 'Kế hoạch' },
  ]
  const user = { id: 'owner', name: 'QA Tên Mới', email: 'new@example.test' }
  const rooms = snapshots.map(room => withCurrentUserHost(room, user))
  for (const [index, room] of rooms.entries()) {
    assert.deepEqual(room.host, user)
    assert.equal(room.access, snapshots[index].access)
    assert.equal(room.hostId, snapshots[index].hostId)
    assert.equal(room.id, snapshots[index].id)
  }
  const matches = (name: string) => rooms.filter(room =>
    searchKey(`${room.name} ${room.host.name}`).includes(searchKey(name)),
  )
  assert.equal(matches('QA Ten Moi').length, 2)
  assert.equal(matches('QA Tên Cũ').length, 0)
  assert.equal(oldHost.name, 'QA Tên Cũ')
  assert.equal(snapshots[0].host, oldHost)
  // A late API snapshot with the old name must not overwrite the current identity.
  assert.equal(withCurrentUserHost(snapshots[0], user).host.name, 'QA Tên Mới')
})

test('host overlay matches IDs, preserves other hosts and handles missing/unchanged profiles', () => {
  const user = { id: 'owner', name: 'Same name', email: 'me@example.test' }
  const other = { id: 'room', host: { ...user, id: 'other' }, access: null }
  assert.equal(withCurrentUserHost(other, user), other)
  const empty = { id: 'unassigned', host: null }
  assert.equal(withCurrentUserHost(empty, user), empty)
  const absent = { id: 'missing' }
  assert.equal(withCurrentUserHost(absent, user), absent)
  const unchanged = { host: { ...user } }
  assert.equal(withCurrentUserHost(unchanged, user), unchanged)
  assert.equal(withCurrentUserHost(unchanged, null), unchanged)
  assert.equal(withCurrentUserHost(unchanged, undefined), unchanged)
})
