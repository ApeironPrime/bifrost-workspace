import { createTranslator } from './engine.ts'
import type { Language } from './locale.ts'
import { errorsDomain } from './domains/errors.ts'

const { translate: tErr } = createTranslator(errorsDomain)

const HAS_VIETNAMESE_DIACRITIC = /[à-ỹ]/i

function normalizeVietnameseFieldText(message: string): string {
  return message
    .replace(/\bWorkspace\b/g, 'Không gian làm việc')
    .replace(/\bworkspace\b/g, 'không gian làm việc')
    .replace(/\bWorkspace Owner\b/g, 'chủ không gian làm việc')
}

export function formatInviteError(message: string, lang: Language): string {
  if (/đăng ký tài khoản/i.test(message)) {
    return tErr(lang, 'errors.invite.accountRequired')
  }
  if (/chỉ workspace owner/i.test(message) || /chỉ chủ không gian/i.test(message)) {
    return tErr(lang, 'errors.invite.ownerOnly')
  }
  if (/email không hợp lệ/i.test(message)) {
    return tErr(lang, 'errors.invite.invalidEmail')
  }
  if (/không thuộc workspace|không thuộc không gian/i.test(message)) {
    return tErr(lang, 'errors.invite.notWorkspaceMember')
  }
  if (/không tìm thấy workspace|không tìm thấy không gian/i.test(message)) {
    return tErr(lang, 'errors.invite.workspaceNotFound')
  }
  if (lang === 'vi') {
    return normalizeVietnameseFieldText(message)
  }
  return HAS_VIETNAMESE_DIACRITIC.test(message) ? tErr(lang, 'errors.invite.generic') : message
}

export function formatWorkspaceError(message: string, lang: Language): string {
  if (
    /name:\s*cần từ/i.test(message) ||
    /tên workspace cần/i.test(message) ||
    /tên không gian làm việc/i.test(message) ||
    /ít nhất 3 ký tự/i.test(message) ||
    /tối đa 120 ký tự/i.test(message)
  ) {
    return tErr(lang, 'errors.workspace.nameLength')
  }
  if (/(?:workspace|không gian).*đã tồn tại/i.test(message)) {
    return tErr(lang, 'errors.workspace.duplicate')
  }
  const prefixed = message.replace(/^name:\s*/i, tErr(lang, 'errors.workspace.namePrefix'))
  if (lang === 'vi') {
    return normalizeVietnameseFieldText(prefixed)
  }
  return HAS_VIETNAMESE_DIACRITIC.test(message) ? tErr(lang, 'errors.workspace.generic') : prefixed
}

export function formatRoomError(message: string, lang: Language): string {
  if (
    /name:\s*cần từ/i.test(message) ||
    /tên phòng/i.test(message) ||
    /ít nhất 2 ký tự/i.test(message) ||
    /tối đa 120 ký tự/i.test(message)
  ) {
    return tErr(lang, 'errors.room.nameLength')
  }
  const prefixed = message.replace(/^name:\s*/i, tErr(lang, 'errors.room.namePrefix'))
  if (lang === 'vi') {
    return normalizeVietnameseFieldText(prefixed)
  }
  return HAS_VIETNAMESE_DIACRITIC.test(message) ? tErr(lang, 'errors.room.generic') : prefixed
}
