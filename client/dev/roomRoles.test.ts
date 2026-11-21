import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTextDatabase } from './textDatabase.ts'
test('custom labels never grant management; coordinator cannot escalate; role CRUD is scoped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bifrost-roles-test-'))
  const db = createTextDatabase(directory)
  const accounts = [] as { id: string; token: string }[]
  for (const name of ['Owner', 'Host', 'Coordinator', 'Viewer']) {
    const result = await db.request('/auth/register', 'POST', '', { name, email: `${name.toLowerCase()}@test.local`, password: 'TestRole@123' })
    const body = result.body as { user: { id: string }; token: string }; accounts.push({ id: body.user.id, token: `Bearer ${body.token}` })
  }
  const [owner, host, coordinator, viewer] = accounts
  const wsResult = await db.request('/workspaces', 'POST', owner.token, { name: 'Roles QA' })
  const ws = (wsResult.body as { workspace: { id: string } }).workspace.id
  for (const name of ['host', 'coordinator', 'viewer']) await db.request(`/workspaces/${ws}/members`, 'POST', owner.token, { email: `${name}@test.local` })
  const createRoom = async (name: string) => ((await db.request(`/workspaces/${ws}/rooms`, 'POST', owner.token, { name })).body as { room: { id: string } }).room.id
  const roomId = await createRoom('Room one'), other = await createRoom('Room two')
  const update = (userId: string, token: string, body: object) => db.request(`/workspaces/${ws}/members/${userId}`, 'PATCH', token, { roomId, ...body })
  assert.equal((await update(host.id, owner.token, { roomRole: 'HOST' })).status, 200)
  assert.equal((await update(coordinator.id, host.token, { roomRole: 'MODERATOR' })).status, 200)
  assert.equal((await update(viewer.id, coordinator.token, { roomRole: 'VIEWER' })).status, 200)
  assert.equal((await update(viewer.id, coordinator.token, { roomRole: 'MODERATOR' })).status, 403)
  assert.equal((await update(host.id, coordinator.token, { roomRole: 'MEMBER' })).status, 403)
  const url = `/workspaces/${ws}/rooms/${roomId}/roles`
  const data = { name: 'Admin', color: '#53664b', priority: 5 }
  assert.equal((await db.request(url, 'POST', coordinator.token, data)).status, 403)
  const created = await db.request(url, 'POST', host.token, data)
  assert.equal(created.status, 201)
  const label = (created.body as { label: { id: string } }).label
  assert.equal((await db.request(url, 'POST', host.token, data)).status, 409)
  assert.equal((await db.request(url, 'POST', host.token, { ...data, name: 'Test', color: 'javascript:bad' })).status, 400)
  assert.equal((await update(viewer.id, host.token, { roomRole: 'VIEWER', labelIds: [label.id] })).status, 200)
  assert.equal((await update(viewer.id, viewer.token, { roomRole: 'HOST' })).status, 403)
  assert.equal((await db.request(`/workspaces/${ws}/rooms/${other}/roles`, 'POST', host.token, data)).status, 403)
  assert.equal((await db.request(`/workspaces/${ws}/members/${viewer.id}`, 'PATCH', owner.token, { roomId: other, roomRole: 'MEMBER', labelIds: [label.id] })).status, 400)
  assert.equal((await db.request(`${url}/${label.id}`, 'PATCH', host.token, { ...data, name: 'Frontend', priority: 1 })).status, 200)
  const reopened = createTextDatabase(directory)
  const roster = (await reopened.request(`/workspaces/${ws}/members`, 'GET', viewer.token)).body as { roomRoles: { name: string }[]; members: { userId: string; roomAssignments: { role: string; labelIds: string[] }[] }[] }
  assert.equal(roster.roomRoles[0].name, 'Frontend')
  assert.equal(roster.members.find(row => row.userId === viewer.id)!.roomAssignments[0].role, 'VIEWER')
  assert.equal((await db.request(`${url}/${label.id}`, 'DELETE', host.token)).status, 200)
  const after = (await db.request(`/workspaces/${ws}/members`, 'GET', owner.token)).body as typeof roster
  assert.equal(after.roomRoles.length, 0)
  assert.deepEqual(after.members.find(row => row.userId === viewer.id)!.roomAssignments[0].labelIds, [])
})
