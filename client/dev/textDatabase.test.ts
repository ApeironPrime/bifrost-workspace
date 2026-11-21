import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTextDatabase } from './textDatabase.ts'

test('TXT accounts are isolated, persist across store instances, enforce owner permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bifrost-txt-test-'))
  const db = createTextDatabase(directory)
  const register = (name: string, email: string) => db.request('/auth/register', 'POST', '', { name, email, password: 'TestOnly123!' })
  const a = await register('Owner A', 'a@example.test')
  const b = await register('Member B', 'b@example.test')
  assert.equal(a.status, 201); assert.equal(b.status, 201)
  const aBody = a.body as { token: string; user: { id: string; name: string; passwordHash?: string } }
  const bBody = b.body as { token: string }
  const authA = `Bearer ${aBody.token}`, authB = `Bearer ${bBody.token}`
  assert.equal(aBody.user.name, 'Owner A')
  assert.equal(aBody.user.passwordHash, undefined)
  assert.equal((await db.request('/workspaces', 'GET', authA)).status, 200)
  // Profile setup is optional; the first Settings save creates the profile.
  assert.equal((await db.request('/auth/me', 'PATCH', authB, { name: 'Member B', avatarDataUrl: '/avatars/notionist-02.svg' })).status, 200)
  assert.equal((await db.request('/auth/profile', 'PATCH', authA, { name: '' })).status, 400)
  for (const [authorization, name] of [[authA, 'Owner A'], [authB, 'Member B']]) {
    assert.equal((await db.request('/auth/profile', 'PATCH', authorization, { name })).status, 200)
  }
  assert.deepEqual((await db.request('/workspaces', 'GET', authA)).body, { workspaces: [] })
  assert.equal((await register('Duplicate', 'A@example.test')).status, 409)
  const workspace = await db.request('/workspaces', 'POST', authA, { name: 'My own project' })
  const workspaceId = (workspace.body as { workspace: { id: string } }).workspace.id
  assert.deepEqual((await db.request('/workspaces', 'GET', authB)).body, { workspaces: [] })
  assert.equal((await db.request(`/workspaces/${workspaceId}/rooms`, 'GET', authB)).status, 403)
  assert.equal((await db.request(`/workspaces/${workspaceId}/members`, 'GET', authB)).status, 403)
  assert.equal((await db.request(`/workspaces/${workspaceId}/members`, 'POST', authA, { email: 'b@example.test' })).status, 201)
  const roster = (await db.request(`/workspaces/${workspaceId}/members`, 'GET', authB)).body as { members: { role: string; user: { passwordHash?: string } }[] }
  assert.equal(roster.members.length, 2)
  assert.equal(roster.members.filter(member => member.role === 'OWNER').length, 1)
  assert.ok(roster.members.every(member => member.user.passwordHash === undefined))
  assert.equal((await db.request(`/workspaces/${workspaceId}/rooms`, 'POST', authB, { name: 'Not allowed' })).status, 403)
  assert.equal((await db.request(`/workspaces/${workspaceId}/rooms`, 'POST', authA, { name: 'Planning' })).status, 201)
  await Promise.all(Array.from({ length: 6 }, (_, index) => db.request(`/workspaces/${workspaceId}/rooms`, 'POST', authA, { name: `Room ${index}` })))
  const restarted = createTextDatabase(directory)
  const me = (await restarted.request('/auth/me', 'GET', authA)).body as { user: { profile: { completedAt: string; avatarDataUrl: string | null } } }
  assert.ok(me.user.profile.completedAt)
  assert.equal(me.user.profile.avatarDataUrl, null)
  assert.equal((await restarted.request('/auth/me', 'PATCH', authA, { name: 'Owner A', avatarDataUrl: '/avatars/notionist-03.svg' })).status, 200)
  const presetMe = (await createTextDatabase(directory).request('/auth/me', 'GET', authA)).body as { user: { profile: { avatarDataUrl: string } } }
  assert.equal(presetMe.user.profile.avatarDataUrl, '/avatars/notionist-03.svg')
  assert.equal((await restarted.request('/auth/me', 'PATCH', authA, { name: 'Owner A', avatarDataUrl: '/avatars/../../private.svg' })).status, 400)
  assert.equal((await restarted.request('/auth/me', 'PATCH', authA, { name: 'Owner A', avatarDataUrl: 'https://example.com/avatar.svg' })).status, 400)
  const testAvatar = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 217]).toString('base64')
  assert.equal((await restarted.request('/auth/me', 'PATCH', authA, { name: 'Owner A', avatarDataUrl: 'data:image/svg+xml,<svg/>' })).status, 400)
  assert.equal((await restarted.request('/auth/me', 'PATCH', authA, { name: 'Owner A', avatarDataUrl: testAvatar })).status, 200)
  const avatarMe = (await createTextDatabase(directory).request('/auth/me', 'GET', authA)).body as { user: { profile: { avatarDataUrl: string | null } } }
  assert.equal(avatarMe.user.profile.avatarDataUrl, testAvatar)
  assert.equal((await restarted.request('/auth/me', 'PATCH', authA, { name: 'Owner A', avatarDataUrl: null })).status, 200)
  const rooms = (await restarted.request(`/workspaces/${workspaceId}/rooms`, 'GET', authB)).body as { rooms: unknown[] }
  assert.equal(rooms.rooms.length, 7)
  const firstRoomId = (rooms.rooms[0] as { id: string }).id
  const memberId = ((b.body as { user: { id: string } }).user.id)
  const ownerRoster = (await restarted.request(`/workspaces/${workspaceId}/members`, 'GET', authA)).body as { members: { userId: string; roomIds: string[] }[] }
  assert.deepEqual(ownerRoster.members.find(row => row.userId === aBody.user.id)!.roomIds, [])
  const assignments = { roomId: firstRoomId, roomRole: 'MEMBER', status: 'online', currentRoomId: firstRoomId }
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${memberId}`, 'PATCH', authB, assignments)).status, 403)
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${memberId}`, 'PATCH', authA, assignments)).status, 200)
  const managed = (await createTextDatabase(directory).request(`/workspaces/${workspaceId}/members`, 'GET', authB)).body as { source: string; members: { userId: string; roomIds: string[]; presence: { status: string; currentRoomId: string | null } }[] }
  const managedB = managed.members.find(member => member.userId === memberId)!
  assert.equal(managed.source, 'mock'); assert.equal(managedB.presence.status, 'online')
  assert.deepEqual(managedB.roomIds, [firstRoomId]); assert.equal(managedB.presence.currentRoomId, firstRoomId)
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${memberId}`, 'PATCH', authA, { ...assignments, roomRole: null })).status, 400)
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${memberId}`, 'PATCH', authA, { ...assignments, status: 'offline' })).status, 400)
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${memberId}`, 'PATCH', authA, { roomId: firstRoomId, roomRole: null, status: 'offline', currentRoomId: null })).status, 200)
  // Owner assigns a host; host manages only that room, never global roles/status.
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${memberId}`, 'PATCH', authA, { roomId: firstRoomId, roomRole: 'HOST' })).status, 200)
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${aBody.user.id}`, 'PATCH', authB, { roomId: firstRoomId, roomRole: 'MEMBER' })).status, 200)
  const otherRoomId = (rooms.rooms[1] as { id: string }).id
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${aBody.user.id}`, 'PATCH', authB, { roomId: otherRoomId, roomRole: 'HOST' })).status, 403)
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${memberId}`, 'PATCH', authB, { ...assignments, roomRole: 'HOST' })).status, 403)
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${aBody.user.id}`, 'PATCH', authB, { roomId: firstRoomId, roomRole: 'HOST' })).status, 200)
  const transferred = (await restarted.request(`/workspaces/${workspaceId}/members`, 'GET', authA)).body as { members: { userId: string; role: string; roomAssignments: { roomId: string; role: string }[] }[] }
  assert.equal(transferred.members.find(row => row.userId === aBody.user.id)!.role, 'OWNER')
  assert.equal(transferred.members.find(row => row.userId === memberId)!.roomAssignments.find(row => row.roomId === firstRoomId)!.role, 'MEMBER')
  assert.equal((await restarted.request(`/workspaces/${workspaceId}/members/${aBody.user.id}`, 'PATCH', authB, { roomId: firstRoomId, roomRole: null })).status, 403)
  const login = await restarted.request('/auth/login', 'POST', '', { email: 'a@example.test', password: 'TestOnly123!' })
  assert.equal(login.status, 200)
  assert.equal((await restarted.request('/auth/login', 'POST', '', { email: 'a@example.test', password: 'WrongPassword' })).status, 401)
  const stored = await readFile(join(directory, 'users.txt'), 'utf8')
  assert.ok(!stored.includes('TestOnly123!')); assert.ok(stored.includes('scrypt$'))
  const sessions = await readFile(join(directory, 'sessions.txt'), 'utf8')
  assert.ok(!sessions.includes(aBody.token))
  // Test directories contain only synthetic, non-user data and are intentionally
  // left in OS temp for inspection; never delete broad paths from a test.
})

test('invalid JSON is reported, never silently reset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bifrost-txt-corrupt-'))
  await writeFile(join(directory, 'users.txt'), '{broken')
  await assert.rejects(createTextDatabase(directory).request('/auth/me'))
  assert.equal(await readFile(join(directory, 'users.txt'), 'utf8'), '{broken')
})

test('unfinished multi-table transaction is recovered before reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bifrost-txt-recover-'))
  const snapshot = { users: [], profiles: [], workspaces: [], workspace_members: [], rooms: [], sessions: [] }
  await writeFile(join(directory, 'transaction.txt'), JSON.stringify(snapshot))
  assert.equal((await createTextDatabase(directory).request('/auth/me')).status, 401)
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'rooms.txt'), 'utf8')), [])
})

test('TXT database supports GET /rooms/:roomId, PATCH/DELETE workspace rooms, and DELETE workspace members with cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bifrost-txt-crud-'))
  const db = createTextDatabase(directory)

  const regOwner = await db.request('/auth/register', 'POST', '', { name: 'Owner', email: 'owner@crud.test', password: 'Password@123' })
  const regHost = await db.request('/auth/register', 'POST', '', { name: 'Host', email: 'host@crud.test', password: 'Password@123' })
  const regMember = await db.request('/auth/register', 'POST', '', { name: 'Member', email: 'member@crud.test', password: 'Password@123' })
  const regOutsider = await db.request('/auth/register', 'POST', '', { name: 'Outsider', email: 'outsider@crud.test', password: 'Password@123' })

  const owner = regOwner.body as { token: string; user: { id: string } }
  const host = regHost.body as { token: string; user: { id: string } }
  const member = regMember.body as { token: string; user: { id: string } }
  const outsider = regOutsider.body as { token: string; user: { id: string } }

  const authOwner = `Bearer ${owner.token}`
  const authHost = `Bearer ${host.token}`
  const authMember = `Bearer ${member.token}`
  const authOutsider = `Bearer ${outsider.token}`

  const wsId = ((await db.request('/workspaces', 'POST', authOwner, { name: 'CRUD WS' })).body as { workspace: { id: string } }).workspace.id
  await db.request(`/workspaces/${wsId}/members`, 'POST', authOwner, { email: 'host@crud.test' })
  await db.request(`/workspaces/${wsId}/members`, 'POST', authOwner, { email: 'member@crud.test' })

  const roomA = ((await db.request(`/workspaces/${wsId}/rooms`, 'POST', authOwner, { name: 'Room Alpha', description: 'Initial' })).body as { room: { id: string } }).room.id
  const roomB = ((await db.request(`/workspaces/${wsId}/rooms`, 'POST', authOwner, { name: 'Room Beta' })).body as { room: { id: string } }).room.id

  await db.request(`/workspaces/${wsId}/members/${host.user.id}`, 'PATCH', authOwner, { roomId: roomA, roomRole: 'HOST', status: 'online', currentRoomId: roomA })
  await db.request(`/workspaces/${wsId}/members/${member.user.id}`, 'PATCH', authOwner, { roomId: roomB, roomRole: 'MEMBER', status: 'online', currentRoomId: roomB })
  await db.request(`/workspaces/${wsId}/rooms/${roomB}/roles`, 'POST', authOwner, { name: 'Reviewer', color: '#53664b', priority: 1 })

  // GET /rooms/:roomId returns enriched room + workspace metadata for authorized members and rejects outsiders.
  assert.equal((await db.request(`/rooms/${roomA}`, 'GET', authOutsider)).status, 403)
  assert.equal((await db.request(`/rooms/non-existent-id`, 'GET', authOwner)).status, 404)
  const roomDetails = await db.request(`/rooms/${roomA}`, 'GET', authHost)
  assert.equal(roomDetails.status, 200)
  assert.equal((roomDetails.body as { room: { name: string; workspace: { id: string }; hostId: string } }).room.workspace.id, wsId)
  assert.equal((roomDetails.body as { room: { hostId: string } }).room.hostId, host.user.id)

  // PATCH /workspaces/:wsId/rooms/:roomId allows OWNER or that room's HOST, blocks plain MEMBER.
  assert.equal((await db.request(`/workspaces/${wsId}/rooms/${roomA}`, 'PATCH', authMember, { name: 'Blocked' })).status, 403)
  assert.equal((await db.request(`/workspaces/${wsId}/rooms/${roomB}`, 'PATCH', authHost, { name: 'Wrong Room' })).status, 403)
  const patchedByHost = await db.request(`/workspaces/${wsId}/rooms/${roomA}`, 'PATCH', authHost, { name: 'Alpha Updated', description: null })
  assert.equal(patchedByHost.status, 200)
  assert.equal((patchedByHost.body as { room: { name: string; description: string | null } }).room.name, 'Alpha Updated')
  assert.equal((patchedByHost.body as { room: { description: string | null } }).room.description, null)

  // DELETE /workspaces/:wsId/rooms/:roomId is OWNER-only and cascades cleanly.
  assert.equal((await db.request(`/workspaces/${wsId}/rooms/${roomB}`, 'DELETE', authHost)).status, 403)
  assert.equal((await db.request(`/workspaces/${wsId}/rooms/${roomB}`, 'DELETE', authOwner)).status, 200)
  assert.equal((await db.request(`/rooms/${roomB}`, 'GET', authOwner)).status, 404)
  const afterRoomDeleteRoster = (await db.request(`/workspaces/${wsId}/members`, 'GET', authOwner)).body as {
    roomRoles: unknown[]
    members: { userId: string; roomIds: string[]; presence: { currentRoomId: string | null } }[]
  }
  assert.equal(afterRoomDeleteRoster.roomRoles.length, 0)
  assert.deepEqual(afterRoomDeleteRoster.members.find(m => m.userId === member.user.id)!.roomIds, [])
  assert.equal(afterRoomDeleteRoster.members.find(m => m.userId === member.user.id)!.presence.currentRoomId, null)

  // DELETE /workspaces/:wsId/members/:userId is OWNER-only, blocks self-delete, and cascades hostId/statuses.
  assert.equal((await db.request(`/workspaces/${wsId}/members/${owner.user.id}`, 'DELETE', authOwner)).status, 400)
  assert.equal((await db.request(`/workspaces/${wsId}/members/${member.user.id}`, 'DELETE', authHost)).status, 403)
  assert.equal((await db.request(`/workspaces/${wsId}/members/${host.user.id}`, 'DELETE', authOwner)).status, 200)
  assert.equal((await db.request(`/workspaces/${wsId}/members`, 'GET', authHost)).status, 403)

  const afterMemberDeleteRoom = (await db.request(`/rooms/${roomA}`, 'GET', authOwner)).body as { room: { hostId: string | null } }
  assert.equal(afterMemberDeleteRoom.room.hostId, null)

  const reopened = createTextDatabase(directory)
  const finalRoster = (await reopened.request(`/workspaces/${wsId}/members`, 'GET', authOwner)).body as { members: { userId: string }[] }
  assert.equal(finalRoster.members.some(m => m.userId === host.user.id), false)
})
