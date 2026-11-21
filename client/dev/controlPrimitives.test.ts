import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LABEL_COLOR_PALETTE,
  LANGUAGE_OPTIONS,
  getAvatarTone,
  getLabelColorName,
  getLabelPriorityItems,
  getLanguageLabel,
  getPresenceDisplay,
  getPriorityTierLabel,
  getRoomRoleItems,
} from '../src/lib/controlPrimitives.ts'
import { formatInviteError, formatRoomError, formatWorkspaceError } from '../src/i18n/index.ts'

test('language options expose native autonyms and ISO language tags without technical noise', () => {
  assert.deepEqual(
    LANGUAGE_OPTIONS.map((item) => [item.value, item.code, item.label, item.lang]),
    [
      ['vi', 'VI', 'Tiếng Việt', 'vi'],
      ['en', 'EN', 'English', 'en'],
      ['ja', 'JA', '日本語', 'ja'],
    ],
  )
  assert.equal(getLanguageLabel('vi'), 'Ngôn ngữ')
  assert.equal(getLanguageLabel('en'), 'Language')
  assert.equal(getLanguageLabel('ja'), '言語')
})

test('label colors and priority presets never leak raw hex codes or raw sort integers in labels', () => {
  for (const entry of LABEL_COLOR_PALETTE) {
    for (const lang of ['vi', 'en', 'ja'] as const) {
      const name = getLabelColorName(entry.value, lang)
      assert.equal(name.includes('#'), false)
      assert.ok(name.length > 0)
    }
  }

  const standardItems = getLabelPriorityItems(100, 'vi')
  assert.equal(standardItems.length, 4)
  for (const item of standardItems) {
    assert.equal(/\d/.test(item.label), false, `Expected human tier label without numbers, got: ${item.label}`)
  }

  // Legacy/custom integer from existing DB record is preserved safely without silent overwrite
  const customItems = getLabelPriorityItems(5, 'en')
  assert.equal(customItems[0]?.value, '5')
  assert.match(customItems[0]?.label ?? '', /High/)
  assert.equal(getPriorityTierLabel(10, 'ja'), '高')
  assert.equal(getPriorityTierLabel(200, 'vi'), 'Bổ trợ')
})

test('room role options gate manager roles for coordinators and surface destructive remove only when assigned', () => {
  const coordinatorUnassigned = getRoomRoleItems({
    lang: 'vi',
    canSetManagers: false,
    isAssigned: false,
  })
  assert.equal(coordinatorUnassigned.find((item) => item.value === 'HOST')?.disabled, true)
  assert.equal(coordinatorUnassigned.find((item) => item.value === 'MODERATOR')?.disabled, true)
  assert.equal(coordinatorUnassigned.find((item) => item.value === 'MEMBER')?.disabled, undefined)
  assert.equal(coordinatorUnassigned.some((item) => item.value === 'REMOVE'), false)

  const ownerAssigned = getRoomRoleItems({
    lang: 'en',
    canSetManagers: true,
    isAssigned: true,
  })
  assert.equal(ownerAssigned.find((item) => item.value === 'HOST')?.disabled, false)
  const remove = ownerAssigned.find((item) => item.value === 'REMOVE')
  assert.equal(remove?.tone, 'danger')
  assert.equal(remove?.label, 'Remove from this room')
})

test('presence display and deterministic avatar tones localize across VI/EN/JA without inferring offline', () => {
  assert.deepEqual(
    getPresenceDisplay({
      mock: false,
      inCurrentRoom: true,
      activeRoomName: 'Design Review',
      status: 'offline',
      lang: 'vi',
    }),
    {
      tone: 'room',
      scope: 'room',
      label: 'Đang trong phòng họp này',
      detail: 'Đang kết nối tại: Design Review',
    },
  )
  assert.deepEqual(
    getPresenceDisplay({
      mock: false,
      inCurrentRoom: true,
      activeRoomName: 'Design Review',
      lang: 'en',
    }),
    {
      tone: 'room',
      scope: 'room',
      label: 'In this room',
      detail: 'Connected in: Design Review',
    },
  )
  assert.deepEqual(
    getPresenceDisplay({
      mock: false,
      inCurrentRoom: true,
      activeRoomName: 'Design Review',
      lang: 'ja',
    }),
    {
      tone: 'room',
      scope: 'room',
      label: 'このルームに参加中',
      detail: '接続中のルーム: Design Review',
    },
  )

  const unverifiedInRoom = getPresenceDisplay({
    mock: false,
    inCurrentRoom: false,
    activeRoomName: 'Design Review',
    status: 'online',
    currentRoomName: 'Sprint 12',
    lang: 'vi',
  })
  assert.equal(unverifiedInRoom.tone, 'unknown')
  assert.equal(unverifiedInRoom.scope, 'unverified')
  assert.equal(unverifiedInRoom.label, 'Chưa xác minh trạng thái')
  assert.match(unverifiedInRoom.detail ?? '', /phòng họp đang mở/)

  const unverifiedDashboard = getPresenceDisplay({
    mock: false,
    inCurrentRoom: false,
    activeRoomName: null,
    status: 'online',
    currentRoomName: 'Sprint 12',
    lang: 'en',
  })
  assert.equal(unverifiedDashboard.tone, 'unknown')
  assert.equal(unverifiedDashboard.scope, 'unverified')
  assert.equal(unverifiedDashboard.label, 'Status unverified')
  assert.match(unverifiedDashboard.detail ?? '', /open room/i)

  const unverifiedJa = getPresenceDisplay({
    mock: false,
    inCurrentRoom: false,
    activeRoomName: null,
    lang: 'ja',
  })
  assert.equal(unverifiedJa.label, 'ステータス未確認')

  assert.deepEqual(
    getPresenceDisplay({ mock: true, status: 'online', currentRoomName: 'Sprint 12', lang: 'vi' }),
    { tone: 'online', scope: 'workspace', label: 'Trực tuyến', detail: 'Đang ở: Sprint 12' },
  )
  assert.deepEqual(
    getPresenceDisplay({ mock: true, status: 'offline', currentRoomName: null, lang: 'ja' }),
    { tone: 'offline', scope: 'workspace', label: 'オフライン' },
  )
  assert.equal(getAvatarTone('user-123'), getAvatarTone('user-123'))
  assert.match(getAvatarTone(''), /^#[0-9a-f]{6}$/)
})

test('formatInviteError translates server error messages across languages', () => {
  const serverMsg = 'Thành viên cần đăng ký tài khoản trước khi được thêm.'
  assert.equal(
    formatInviteError(serverMsg, 'en'),
    'Members must create an account before being added.',
  )
  assert.equal(
    formatInviteError(serverMsg, 'ja'),
    'メンバーは追加される前にアカウントを登録する必要があります。',
  )
  assert.equal(
    formatInviteError(serverMsg, 'vi'),
    'Thành viên cần đăng ký tài khoản trước khi được thêm.',
  )

  const serverMsgAlt = 'Người dùng cần đăng ký tài khoản trước khi được mời.'
  assert.equal(
    formatInviteError(serverMsgAlt, 'en'),
    'Members must create an account before being added.',
  )

  const ownerMsg = 'Chỉ Workspace Owner mới có thể mời thành viên.'
  assert.equal(
    formatInviteError(ownerMsg, 'en'),
    'Only the workspace owner can invite members.',
  )

  const invalidEmail = 'Email không hợp lệ.'
  assert.equal(
    formatInviteError(invalidEmail, 'en'),
    'Invalid email address.',
  )
})

test('formatWorkspaceError and formatRoomError localize validation errors and never leak technical field names', () => {
  const wsErrors = [
    'name: cần từ 3 đến 120 ký tự.',
    'Tên workspace cần ít nhất 3 ký tự.',
    'Tên không gian làm việc cần từ 3 đến 120 ký tự.',
  ]
  for (const err of wsErrors) {
    const en = formatWorkspaceError(err, 'en')
    assert.equal(en, 'Workspace name must be between 3 and 120 characters.')
    assert.equal(en.includes('name:'), false)
    assert.equal(/[à-ỹ]/i.test(en), false)

    const ja = formatWorkspaceError(err, 'ja')
    assert.equal(ja, 'ワークスペース名は3〜120文字で入力してください。')
    assert.equal(ja.includes('name:'), false)
    assert.equal(/[à-ỹ]/i.test(ja), false)

    const vi = formatWorkspaceError(err, 'vi')
    assert.equal(vi, 'Tên không gian làm việc cần từ 3 đến 120 ký tự.')
    assert.equal(vi.includes('name:'), false)
  }

  const roomErrors = [
    'name: cần từ 2 đến 120 ký tự.',
    'Tên phòng cần từ 2 đến 120 ký tự.',
  ]
  for (const err of roomErrors) {
    const en = formatRoomError(err, 'en')
    assert.equal(en, 'Room name must be between 2 and 120 characters.')
    assert.equal(en.includes('name:'), false)
    assert.equal(/[à-ỹ]/i.test(en), false)

    const ja = formatRoomError(err, 'ja')
    assert.equal(ja, 'ルーム名は2〜120文字で入力してください。')
    assert.equal(ja.includes('name:'), false)
    assert.equal(/[à-ỹ]/i.test(ja), false)

    const vi = formatRoomError(err, 'vi')
    assert.equal(vi, 'Tên phòng cần từ 2 đến 120 ký tự.')
    assert.equal(vi.includes('name:'), false)
  }
})
