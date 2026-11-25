import type { TranslationShape } from '../engine.ts'
import type { Language } from '../locale.ts'

const errorsVi = {
  errors: {
    invite: {
      accountRequired: 'Thành viên cần đăng ký tài khoản trước khi được thêm.',
      ownerOnly: 'Chỉ chủ không gian làm việc mới có thể mời thành viên.',
      invalidEmail: 'Email không hợp lệ.',
      notWorkspaceMember: 'Bạn không thuộc không gian làm việc này.',
      workspaceNotFound: 'Không tìm thấy không gian làm việc.',
      generic: 'Không thể mời thành viên. Vui lòng thử lại.',
    },
    workspace: {
      nameLength: 'Tên không gian làm việc cần từ 3 đến 120 ký tự.',
      duplicate: 'Không gian làm việc này đã tồn tại.',
      namePrefix: 'Tên không gian làm việc: ',
      generic: 'Không thể tạo không gian làm việc. Vui lòng kiểm tra tên và thử lại.',
    },
    room: {
      nameLength: 'Tên phòng cần từ 2 đến 120 ký tự.',
      namePrefix: 'Tên phòng: ',
      generic: 'Không thể tạo phòng. Vui lòng kiểm tra tên và thử lại.',
    },
    boundary: {
      title: 'Đã xảy ra sự cố giao diện',
      description: 'Ứng dụng gặp lỗi bất ngờ và đã tự động ghi nhận để khắc phục. Vui lòng tải lại trang.',
      reloadButton: 'Tải lại ứng dụng',
    },
  },
} as const

type ErrorsShape = TranslationShape<typeof errorsVi>

const errorsEn = {
  errors: {
    invite: {
      accountRequired: 'Members must create an account before being added.',
      ownerOnly: 'Only the workspace owner can invite members.',
      invalidEmail: 'Invalid email address.',
      notWorkspaceMember: 'You are not a member of this workspace.',
      workspaceNotFound: 'Workspace not found.',
      generic: 'Failed to invite member. Please try again.',
    },
    workspace: {
      nameLength: 'Workspace name must be between 3 and 120 characters.',
      duplicate: 'A workspace with this name already exists.',
      namePrefix: 'Workspace name: ',
      generic: 'Failed to create workspace. Please check the name and try again.',
    },
    room: {
      nameLength: 'Room name must be between 2 and 120 characters.',
      namePrefix: 'Room name: ',
      generic: 'Failed to create room. Please check the name and try again.',
    },
    boundary: {
      title: 'Something went wrong',
      description: 'An unexpected interface error occurred and has been reported. Please reload the page.',
      reloadButton: 'Reload application',
    },
  },
} as const satisfies ErrorsShape

const errorsJa = {
  errors: {
    invite: {
      accountRequired: 'メンバーは追加される前にアカウントを登録する必要があります。',
      ownerOnly: 'ワークスペースオーナーのみがメンバーを招待できます。',
      invalidEmail: '有効なメールアドレスを入力してください。',
      notWorkspaceMember: 'このワークスペースのメンバーではありません。',
      workspaceNotFound: 'ワークスペースが見つかりません。',
      generic: 'メンバーの招待に失敗しました。再試行してください。',
    },
    workspace: {
      nameLength: 'ワークスペース名は3〜120文字で入力してください。',
      duplicate: 'このワークスペース名は既に使用されています。',
      namePrefix: 'ワークスペース名: ',
      generic: 'ワークスペースを作成できませんでした。名前を確認して再試行してください。',
    },
    room: {
      nameLength: 'ルーム名は2〜120文字で入力してください。',
      namePrefix: 'ルーム名: ',
      generic: 'ルームを作成できませんでした。名前を確認して再試行してください。',
    },
    boundary: {
      title: '画面の表示中にエラーが発生しました',
      description: '予期しないエラーが発生し、自動的に記録されました。ページを再読み込みしてください。',
      reloadButton: '再読み込み',
    },
  },
} as const satisfies ErrorsShape

export const errorsDomain: Record<Language, ErrorsShape> = {
  vi: errorsVi,
  en: errorsEn,
  ja: errorsJa,
}
