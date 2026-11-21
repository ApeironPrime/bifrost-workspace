import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

type User = { id: string; name: string; email: string; passwordHash: string; createdAt: string; updatedAt: string }
type Workspace = { id: string; name: string; slug: string; ownerId: string; createdAt: string; updatedAt: string }
type Member = { workspaceId: string; userId: string; role: 'OWNER' | 'MEMBER'; joinedAt: string }
type Room = { id: string; workspaceId: string; hostId: string | null; createdById?: string; name: string; description: string | null; createdAt: string; updatedAt: string }
type Session = { id: string; userId: string; tokenHash: string; expiresAt: string }
type Profile = { userId: string; avatarDataUrl?: string | null; completedAt: string; updatedAt: string }
type RoomMember = { workspaceId: string; roomId: string; userId: string; role?: 'HOST' | 'MODERATOR' | 'MEMBER' | 'VIEWER'; labelIds?: string[]; assignedAt: string }
type RoomLabel = { id: string; workspaceId: string; roomId: string; name: string; color: string; priority: number; createdAt: string; updatedAt: string }
type MemberStatus = { workspaceId: string; userId: string; status: 'online' | 'offline'; currentRoomId: string | null; source: 'mock'; updatedAt: string }
type Tables = { users: User[]; profiles: Profile[]; workspaces: Workspace[]; workspace_members: Member[]; rooms: Room[]; sessions: Session[]; room_members: RoomMember[]; member_statuses: MemberStatus[]; room_roles: RoomLabel[] }
const names = ['users', 'profiles', 'workspaces', 'workspace_members', 'rooms', 'sessions', 'room_members', 'member_statuses', 'room_roles'] as const
const fresh = (): Tables => ({ users: [], profiles: [], workspaces: [], workspace_members: [], rooms: [], sessions: [], room_members: [], member_statuses: [], room_roles: [] })
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const publicUser = ({ passwordHash: _passwordHash, ...user }: User) => user
function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`
}
function checkPassword(password: string, hash: string) {
  const [algorithm, salt, expected] = hash.split('$')
  if (algorithm !== 'scrypt' || !salt || !expected) return false
  const bytes = Buffer.from(expected, 'hex')
  const actual = scryptSync(password, salt, 64)
  return actual.length === bytes.length && timingSafeEqual(actual, bytes)
}
class ApiError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status } }
function avatar(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string' && /^\/avatars\/notionist-0[1-8]\.svg$/.test(value)) return value
  if (typeof value !== 'string' || value.length > 180000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new ApiError('Avatar không hợp lệ hoặc quá lớn.')
  const bytes = Buffer.from(value.split(',')[1], 'base64')
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw new ApiError('Avatar cần là ảnh JPEG hợp lệ.')
  return value
}
function text(body: Record<string, unknown>, key: string, min: number, max: number) {
  const value = typeof body[key] === 'string' ? body[key].trim() : ''
  if (value.length < min || value.length > max) throw new ApiError(`${key}: cần từ ${min} đến ${max} ký tự.`)
  return value
}

/** One process owns this store. Journal recovery + atomic per-file replacement.
 * Records deliberately match Prisma field names/UUIDs; sessions are disposable. */
export function createTextDatabase(directory: string) {
  let queue: Promise<unknown> = Promise.resolve()
  async function atomic(file: string, value: unknown) {
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
  }
  async function load(): Promise<Tables> {
    await mkdir(directory, { recursive: true })
    // Replay an interrupted commit before exposing any table.
    try {
      const pending = JSON.parse(await readFile(join(directory, 'transaction.txt'), 'utf8')) as Tables
      // New tables may not exist in a journal written by the preceding schema.
      pending.room_members ??= []; pending.member_statuses ??= []
      pending.room_roles ??= []
      for (const name of names) {
        if (!Array.isArray(pending[name])) throw new Error('Invalid transaction journal')
        await atomic(join(directory, `${name}.txt`), pending[name])
      }
      await unlink(join(directory, 'transaction.txt'))
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const tables = fresh()
    for (const name of names) {
      try {
        const rows: unknown = JSON.parse(await readFile(join(directory, `${name}.txt`), 'utf8'))
        if (!Array.isArray(rows)) throw new Error(`Invalid table: ${name}`)
        Object.assign(tables, { [name]: rows })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await atomic(join(directory, `${name}.txt`), [])
      }
    }
    return tables
  }
  async function save(tables: Tables) {
    await atomic(join(directory, 'transaction.txt'), tables)
    for (const name of names) await atomic(join(directory, `${name}.txt`), tables[name])
    await unlink(join(directory, 'transaction.txt'))
  }
  async function handle(path: string, method: string, authorization: string, body: Record<string, unknown>) {
    const db = await load()
    const userView = (user: User) => ({ ...publicUser(user), profile: db.profiles.find(row => row.userId === user.id) ?? null })
    const now = new Date().toISOString()
    const reply = (value: unknown, status = 200) => ({ status, body: value })
    if ((path === '/auth/register' || path === '/auth/login') && method === 'POST') {
      const email = text(body, 'email', 3, 254).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Email không hợp lệ.')
      const password = typeof body.password === 'string' ? body.password : ''
      if (password.length < 8 || password.length > 100) throw new ApiError('Mật khẩu cần 8–100 ký tự.')
      let user = db.users.find(row => row.email === email)
      if (path === '/auth/register') {
        if (user) throw new ApiError('Email này đã được sử dụng.', 409)
        user = { id: randomUUID(), name: text(body, 'name', 2, 100), email, passwordHash: hashPassword(password), createdAt: now, updatedAt: now }
        db.users.push(user)
      } else {
        // Preserve the explicitly requested temporary UI admin, without sample projects.
        if (!user && email === 'admin@bifrost.local' && password === 'BifrostDemo@123') {
          user = { id: randomUUID(), name: 'Admin', email, passwordHash: hashPassword(password), createdAt: now, updatedAt: now }
          db.users.push(user)
        }
        if (!user || !checkPassword(password, user.passwordHash)) throw new ApiError('Email hoặc mật khẩu không đúng.', 401)
      }
      const token = `bifrost-txt-${randomBytes(32).toString('hex')}`
      db.sessions = db.sessions.filter(row => row.expiresAt > now)
      db.sessions.push({ id: randomUUID(), userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() })
      await save(db)
      return reply({ token, user: userView(user) }, path.endsWith('register') ? 201 : 200)
    }
    const session = db.sessions.find(row => row.tokenHash === digest(authorization.replace(/^Bearer /, '')) && row.expiresAt > now)
    const user = db.users.find(row => row.id === session?.userId)
    if (!user) throw new ApiError('Vui lòng đăng nhập lại.', 401)
    if (path === '/auth/me' && (method === 'GET' || method === 'PATCH')) {
      if (method === 'PATCH') {
        user.name = text(body, 'name', 2, 100); user.updatedAt = now
        if ('avatarDataUrl' in body) {
          const image = avatar(body.avatarDataUrl)
          const profile = db.profiles.find(row => row.userId === user.id)
          if (profile) { profile.avatarDataUrl = image; profile.updatedAt = now }
          else db.profiles.push({ userId: user.id, avatarDataUrl: image, completedAt: now, updatedAt: now })
        }
        await save(db)
      }
      return reply({ user: userView(user) })
    }
    if (path === '/auth/profile' && method === 'PATCH') {
      const name = text(body, 'name', 2, 100)
      const existing = db.profiles.find(row => row.userId === user.id)
      const avatarDataUrl = 'avatarDataUrl' in body ? avatar(body.avatarDataUrl) : existing?.avatarDataUrl ?? null
      const profile = { userId: user.id, avatarDataUrl, completedAt: existing?.completedAt ?? now, updatedAt: now }
      db.profiles = db.profiles.filter(row => row.userId !== user.id)
      db.profiles.push(profile)
      user.name = name; user.updatedAt = now
      await save(db)
      return reply({ user: userView(user) })
    }
    if (path === '/workspaces') {
      if (method === 'GET') return reply({ workspaces: db.workspace_members.filter(row => row.userId === user.id).map(row => ({ ...db.workspaces.find(ws => ws.id === row.workspaceId), role: row.role })) })
      if (method === 'POST') {
        const name = text(body, 'name', 3, 120)
        const workspace = { id: randomUUID(), name, slug: `workspace-${randomUUID()}`, ownerId: user.id, createdAt: now, updatedAt: now }
        db.workspaces.push(workspace)
        db.workspace_members.push({ workspaceId: workspace.id, userId: user.id, role: 'OWNER', joinedAt: now })
        await save(db)
        return reply({ workspace: { ...workspace, role: 'OWNER' } }, 201)
      }
    }
    const formatRoom = (room: Room, membership: Member) => {
      const hostId =
        db.room_members.find(item => item.roomId === room.id && item.workspaceId === room.workspaceId && item.role === 'HOST')?.userId ??
        null
      const roomRole = db.room_members.find(
        item => item.roomId === room.id && item.workspaceId === room.workspaceId && item.userId === user.id,
      )?.role
      const legacyMember = db.room_members.some(item => item.roomId === room.id && item.userId === user.id)
      const access = membership.role === 'OWNER' ? 'OWNER' : roomRole ?? (legacyMember ? 'MEMBER' : null)
      const hostUser = hostId ? db.users.find(host => host.id === hostId) : null
      return {
        ...room,
        access,
        createdById: room.createdById ?? room.hostId,
        hostId,
        host: hostUser ? publicUser(hostUser) : null,
      }
    }
    const singleRoomRoute = path.match(/^\/rooms\/([^/]+)$/)
    if (singleRoomRoute && method === 'GET') {
      const [, roomId] = singleRoomRoute
      const room = db.rooms.find(item => item.id === roomId)
      if (!room) throw new ApiError('Không tìm thấy phòng.', 404)
      const membership = db.workspace_members.find(row => row.workspaceId === room.workspaceId && row.userId === user.id)
      if (!membership) throw new ApiError('Bạn không thuộc Workspace chứa phòng này.', 403)
      const workspace = db.workspaces.find(ws => ws.id === room.workspaceId)
      return reply({
        room: {
          ...formatRoom(room, membership),
          workspace: workspace ? { id: workspace.id, name: workspace.name, slug: workspace.slug } : null,
        },
      })
    }
    const labelRoute = path.match(/^\/workspaces\/([^/]+)\/rooms\/([^/]+)\/roles(?:\/([^/]+))?$/)
    if (labelRoute) {
      const [, workspaceId, roomId, labelId] = labelRoute
      const manager = db.workspace_members.find(row => row.workspaceId === workspaceId && row.userId === user.id)
      if (!manager || (manager.role !== 'OWNER' && !db.room_members.some(row => row.workspaceId === workspaceId && row.roomId === roomId && row.userId === user.id && row.role === 'HOST'))) throw new ApiError('Chỉ chủ Workspace hoặc chủ phòng được quản lý nhãn.', 403)
      if (!db.rooms.some(room => room.id === roomId && room.workspaceId === workspaceId)) throw new ApiError('Không tìm thấy phòng.', 404)
      const existing = db.room_roles.find(row => row.id === labelId && row.roomId === roomId && row.workspaceId === workspaceId)
      if (labelId && !existing) throw new ApiError('Không tìm thấy nhãn.', 404)
      if (method === 'DELETE' && existing) {
        db.room_roles = db.room_roles.filter(row => row.id !== existing.id)
        db.room_members.forEach(row => { if (row.roomId === roomId && row.workspaceId === workspaceId) row.labelIds = row.labelIds?.filter(id => id !== existing.id) })
        await save(db); return reply({ deleted: true })
      }
      if ((method === 'POST' && !labelId) || (method === 'PATCH' && existing)) {
        const name = text(body, 'name', 2, 32)
        if (!['#53664b', '#8a684e', '#53617b', '#8b5876', '#477c7a', '#916149'].includes(String(body.color))) throw new ApiError('Màu nhãn không hợp lệ.')
        if (!Number.isInteger(body.priority) || Number(body.priority) < 0 || Number(body.priority) > 999) throw new ApiError('Ưu tiên cần là số 0–999 (nhỏ hơn xếp trước).')
        if (db.room_roles.some(row => row.roomId === roomId && row.id !== labelId && row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ApiError('Tên nhãn đã có trong phòng.', 409)
        const label = { id: existing?.id ?? randomUUID(), workspaceId, roomId, name, color: String(body.color), priority: Number(body.priority), createdAt: existing?.createdAt ?? now, updatedAt: now }
        db.room_roles = db.room_roles.filter(row => row.id !== label.id); db.room_roles.push(label)
        await save(db); return reply({ label }, existing ? 200 : 201)
      }
      throw new ApiError('Thao tác không hợp lệ.', 405)
    }
    const memberEdit = path.match(/^\/workspaces\/([^/]+)\/members\/([^/]+)$/)
    if (memberEdit && method === 'DELETE') {
      const [, workspaceId, memberId] = memberEdit
      const manager = db.workspace_members.find(row => row.workspaceId === workspaceId && row.userId === user.id)
      if (!manager || manager.role !== 'OWNER') throw new ApiError('Chỉ chủ Workspace mới có thể quản lý thành viên.', 403)
      if (memberId === user.id) throw new ApiError('Chủ Workspace không thể tự xóa chính mình khỏi Workspace.', 400)
      if (!db.workspace_members.some(row => row.workspaceId === workspaceId && row.userId === memberId)) throw new ApiError('Thành viên không thuộc Workspace.', 404)
      db.workspace_members = db.workspace_members.filter(row => !(row.workspaceId === workspaceId && row.userId === memberId))
      db.room_members = db.room_members.filter(row => !(row.workspaceId === workspaceId && row.userId === memberId))
      db.member_statuses = db.member_statuses.filter(row => !(row.workspaceId === workspaceId && row.userId === memberId))
      db.rooms.forEach(room => {
        if (room.workspaceId === workspaceId && room.hostId === memberId) {
          room.hostId = null
          room.updatedAt = now
        }
      })
      await save(db)
      return reply({ deleted: true })
    }
    if (memberEdit && method === 'PATCH') {
      const [, workspaceId, memberId] = memberEdit
      const manager = db.workspace_members.find(row => row.workspaceId === workspaceId && row.userId === user.id)
      const isOwner = manager?.role === 'OWNER'
      const roomId = typeof body.roomId === 'string' ? body.roomId : ''
      const managerRoomRole = db.room_members.find(row => row.workspaceId === workspaceId && row.roomId === roomId && row.userId === user.id)?.role
      if (!manager || (!isOwner && managerRoomRole !== 'HOST' && managerRoomRole !== 'MODERATOR')) throw new ApiError('Bạn không có quyền quản lý phòng này.', 403)
      if (!db.workspace_members.some(row => row.workspaceId === workspaceId && row.userId === memberId)) throw new ApiError('Thành viên không thuộc Workspace.', 404)
      if ('role' in body) throw new ApiError('Không thể thay đổi quyền Workspace bằng thao tác này.', 403)
      if (!db.rooms.some(room => room.id === roomId && room.workspaceId === workspaceId)) throw new ApiError('Phòng không thuộc Workspace này.')
      if (body.roomRole !== null && !['HOST', 'MODERATOR', 'MEMBER', 'VIEWER'].includes(String(body.roomRole))) throw new ApiError('Vai trò phòng không hợp lệ.')
      const previous = db.room_members.find(row => row.workspaceId === workspaceId && row.roomId === roomId && row.userId === memberId)
      if (!isOwner && managerRoomRole === 'MODERATOR' && (previous?.role === 'HOST' || previous?.role === 'MODERATOR' || body.roomRole === 'HOST' || body.roomRole === 'MODERATOR')) throw new ApiError('Điều phối viên chỉ quản lý Thành viên và Chỉ xem.', 403)
      const labelIds = body.labelIds === undefined ? previous?.labelIds ?? [] : body.labelIds
      if (!Array.isArray(labelIds) || labelIds.length > 12 || !labelIds.every(id => typeof id === 'string' && db.room_roles.some(label => label.id === id && label.roomId === roomId && label.workspaceId === workspaceId))) throw new ApiError('Nhãn không thuộc phòng này hoặc vượt quá 12 nhãn.')
      if (!isOwner && ('status' in body || 'currentRoomId' in body)) throw new ApiError('Chỉ chủ Workspace được chỉnh trạng thái mô phỏng toàn Workspace.', 403)
      // Change one room only; keep this person's other room assignments intact.
      db.room_members = db.room_members.filter(row => !(row.workspaceId === workspaceId && row.roomId === roomId && row.userId === memberId))
      if (body.roomRole === 'HOST') {
        // One host per room. The preceding host remains an ordinary member.
        db.room_members.forEach(row => { if (row.workspaceId === workspaceId && row.roomId === roomId && row.role === 'HOST') row.role = 'MEMBER' })
      }
      if (body.roomRole) db.room_members.push({ workspaceId, roomId, userId: memberId, role: body.roomRole as RoomMember['role'], labelIds: [...new Set(labelIds as string[])], assignedAt: now })
      const selectedRoom = db.rooms.find(room => room.id === roomId && room.workspaceId === workspaceId)!
      selectedRoom.createdById ??= selectedRoom.hostId ?? user.id
      selectedRoom.hostId = db.room_members.find(row => row.roomId === roomId && row.workspaceId === workspaceId && row.role === 'HOST')?.userId ?? null
      const roomIds = db.room_members.filter(row => row.workspaceId === workspaceId && row.userId === memberId).map(row => row.roomId)
      if ('status' in body || 'currentRoomId' in body) {
        if (body.status !== 'online' && body.status !== 'offline') throw new ApiError('Trạng thái không hợp lệ.')
        const currentRoomId = body.currentRoomId || null
        if (currentRoomId && (body.status !== 'online' || typeof currentRoomId !== 'string' || !roomIds.includes(currentRoomId))) throw new ApiError('Phòng hiện tại phải thuộc phòng được phân công và thành viên phải online.')
        db.member_statuses = db.member_statuses.filter(row => row.workspaceId !== workspaceId || row.userId !== memberId)
        db.member_statuses.push({ workspaceId, userId: memberId, status: body.status, currentRoomId: currentRoomId as string | null, source: 'mock', updatedAt: now })
      } else {
        const presence = db.member_statuses.find(row => row.workspaceId === workspaceId && row.userId === memberId)
        if (presence?.currentRoomId && !roomIds.includes(presence.currentRoomId)) { presence.currentRoomId = null; presence.updatedAt = now }
      }
      await save(db)
      return reply({ updated: true })
    }
    const roomEdit = path.match(/^\/workspaces\/([^/]+)\/rooms\/([^/]+)$/)
    if (roomEdit) {
      const [, workspaceId, roomId] = roomEdit
      const membership = db.workspace_members.find(row => row.workspaceId === workspaceId && row.userId === user.id)
      if (!membership) throw new ApiError('Bạn không thuộc Workspace này.', 403)
      const isOwner = membership.role === 'OWNER'
      const isHost = db.room_members.some(
        row => row.workspaceId === workspaceId && row.roomId === roomId && row.userId === user.id && row.role === 'HOST',
      )
      const room = db.rooms.find(item => item.id === roomId && item.workspaceId === workspaceId)
      if (method === 'PATCH') {
        if (!isOwner && !isHost) throw new ApiError('Chỉ chủ Workspace hoặc chủ phòng được chỉnh sửa phòng.', 403)
        if (!room) throw new ApiError('Không tìm thấy phòng.', 404)
        const hasName = 'name' in body && body.name !== undefined
        const hasDescription = 'description' in body && body.description !== undefined
        if (!hasName && !hasDescription) throw new ApiError('Cần cung cấp thông tin phòng cần cập nhật.')
        if (hasName) room.name = text(body, 'name', 2, 120)
        if (hasDescription) {
          if (body.description === null) room.description = null
          else if (typeof body.description === 'string') {
            const trimmedDesc = body.description.trim()
            if (trimmedDesc.length > 255) throw new ApiError('description: cần từ 0 đến 255 ký tự.')
            room.description = trimmedDesc || null
          } else {
            throw new ApiError('Mô tả phòng không hợp lệ.')
          }
        }
        room.updatedAt = now
        await save(db)
        return reply({ room: formatRoom(room, membership) })
      }
      if (method === 'DELETE') {
        if (!isOwner) throw new ApiError('Chỉ chủ Workspace được xóa phòng.', 403)
        if (!room) throw new ApiError('Không tìm thấy phòng.', 404)
        db.rooms = db.rooms.filter(item => !(item.id === roomId && item.workspaceId === workspaceId))
        db.room_members = db.room_members.filter(row => !(row.roomId === roomId && row.workspaceId === workspaceId))
        db.room_roles = db.room_roles.filter(row => !(row.roomId === roomId && row.workspaceId === workspaceId))
        db.member_statuses.forEach(row => {
          if (row.workspaceId === workspaceId && row.currentRoomId === roomId) {
            row.currentRoomId = null
            row.updatedAt = now
          }
        })
        await save(db)
        return reply({ deleted: true })
      }
      throw new ApiError('Thao tác không hợp lệ.', 405)
    }
    const match = path.match(/^\/workspaces\/([^/]+)(?:\/(rooms|members))?$/)
    if (match) {
      const [, workspaceId, resource] = match
      const membership = db.workspace_members.find(row => row.workspaceId === workspaceId && row.userId === user.id)
      if (!membership) throw new ApiError('Bạn không thuộc Workspace này.', 403)
      if (resource === 'members' && method === 'GET') return reply({ source: 'mock', roomRoles: db.room_roles.filter(label => label.workspaceId === workspaceId), members: db.workspace_members.filter(row => row.workspaceId === workspaceId).map(row => ({ ...row, roomIds: db.room_members.filter(item => item.workspaceId === workspaceId && item.userId === row.userId).map(item => item.roomId), roomAssignments: db.room_members.filter(item => item.workspaceId === workspaceId && item.userId === row.userId).map(item => ({ roomId: item.roomId, role: item.role ?? 'MEMBER', labelIds: item.labelIds ?? [] })), presence: db.member_statuses.find(item => item.workspaceId === workspaceId && item.userId === row.userId) ?? { status: 'offline', currentRoomId: null, source: 'mock' }, user: { ...publicUser(db.users.find(person => person.id === row.userId)!), avatarDataUrl: db.profiles.find(profile => profile.userId === row.userId)?.avatarDataUrl ?? null } })) })
      if (!resource && method === 'GET') return reply({ workspace: { ...db.workspaces.find(row => row.id === workspaceId), role: membership.role } })
      if (resource === 'rooms' && method === 'GET') return reply({ rooms: db.rooms.filter(row => row.workspaceId === workspaceId).map(row => formatRoom(row, membership)) })
      if (membership.role !== 'OWNER') throw new ApiError('Chỉ chủ Workspace được thực hiện thao tác này.', 403)
      if (resource === 'rooms' && method === 'POST') {
        const room = { id: randomUUID(), workspaceId, createdById: user.id, hostId: null, name: text(body, 'name', 2, 120), description: body.description ? text(body, 'description', 0, 255) : null, createdAt: now, updatedAt: now }
        db.rooms.push(room); await save(db)
        return reply({ room: formatRoom(room, membership) }, 201)
      }
      if (resource === 'members' && method === 'POST') {
        const email = text(body, 'email', 3, 254).toLowerCase()
        const invited = db.users.find(row => row.email === email)
        if (!invited) throw new ApiError('Thành viên cần đăng ký tài khoản trước khi được thêm.', 404)
        let member = db.workspace_members.find(row => row.workspaceId === workspaceId && row.userId === invited.id)
        if (!member) { member = { workspaceId, userId: invited.id, role: 'MEMBER', joinedAt: now }; db.workspace_members.push(member); await save(db) }
        return reply({ member: { ...member, user: publicUser(invited) } }, 201)
      }
    }
    throw new ApiError('Không tìm thấy thao tác trong kho dữ liệu TXT.', 404)
  }
  return {
    request(path: string, method = 'GET', authorization = '', body: Record<string, unknown> = {}) {
      const task = queue.then(async () => {
        try { return await handle(path, method, authorization, body) }
        catch (error) {
          if (error instanceof ApiError) return { status: error.status, body: { message: error.message } }
          // Corrupt files are never silently replaced with empty tables.
          throw error
        }
      })
      queue = task.catch(() => undefined)
      return task
    },
  }
}
