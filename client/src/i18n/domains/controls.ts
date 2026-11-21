import type { TranslationShape } from '../engine.ts'
import type { Language } from '../locale.ts'

const controlsVi = {
  controls: {
    colors: {
      moss: 'Xanh rêu',
      umber: 'Nâu đồng',
      indigo: 'Chàm',
      plum: 'Tím trầm',
      jade: 'Xanh ngọc',
      terracotta: 'Đất nung',
      custom: 'Màu tùy chỉnh',
    },
    priorities: {
      high: { label: 'Cao', description: 'Xếp đầu danh sách thành viên trong phòng' },
      aboveNormal: { label: 'Trên trung bình', description: 'Xếp trước các nhãn tiêu chuẩn' },
      standard: { label: 'Tiêu chuẩn', description: 'Thứ tự hiển thị mặc định cho chuyên môn' },
      secondary: { label: 'Bổ trợ', description: 'Xếp sau các nhãn chính của phòng' },
      savedLabel: '{tier} (đã lưu)',
      savedDescription: 'Giữ nguyên thứ tự hiển thị hiện tại cho nhãn này',
    },
    roomRoles: {
      managerLockedReason: 'Chỉ chủ không gian làm việc hoặc chủ phòng mới cấp được quyền này.',
      HOST: {
        label: 'Chủ phòng',
        description: 'Quản lý thành viên, quyền truy cập và nhãn công việc của phòng.',
      },
      MODERATOR: {
        label: 'Điều phối viên',
        description: 'Hỗ trợ xếp thành viên và gắn nhãn; không cấp quyền quản lý.',
      },
      MEMBER: {
        label: 'Thành viên',
        description: 'Tham gia cuộc gọi, tin nhắn, ghi chú, bảng công việc và chia sẻ tệp.',
      },
      VIEWER: {
        label: 'Chỉ xem',
        description: 'Chỉ xem nội dung; không gửi tin nhắn, sửa bảng hoặc tải tệp lên.',
      },
      REMOVE: {
        label: 'Gỡ khỏi phòng này',
        description: 'Thu hồi quyền vào phòng này; thành viên vẫn ở trong không gian làm việc.',
      },
    },
    presence: {
      inRoomLabel: 'Đang trong phòng họp này',
      inRoomDetail: 'Đang kết nối tại: {roomName}',
      unverifiedLabel: 'Chưa xác minh trạng thái',
      unverifiedInRoomDetail: 'Trạng thái trực tiếp chỉ xác minh thành viên đang kết nối trong phòng họp đang mở.',
      unverifiedWorkspaceDetail:
        'Máy chủ chưa cung cấp trạng thái trực tuyến toàn không gian làm việc; trạng thái trực tiếp chỉ hiển thị khi mở phòng.',
      onlineLabel: 'Trực tuyến',
      onlineInRoomDetail: 'Đang ở: {roomName}',
      notInRoomDetail: 'Không ở trong phòng',
      offlineLabel: 'Ngoại tuyến',
    },
    sessionStatus: {
      idle: 'Chưa vào phòng',
      localPreview: 'Phiên giao diện cục bộ',
      connectingSignaling: 'Đang kết nối máy chủ tín hiệu…',
      joiningRoom: 'Đang vào phòng…',
      joinedRoom: 'Đã vào phòng "{name}"',
      waitingPeer: 'Đang chờ thành viên khác…',
      reconnected: 'Đã kết nối lại máy chủ tín hiệu…',
      connectedP2P: 'Đã kết nối P2P trực tiếp',
      connectError: 'Không kết nối được máy chủ tín hiệu.',
    },
  },
} as const

type ControlsShape = TranslationShape<typeof controlsVi>

const controlsEn = {
  controls: {
    colors: {
      moss: 'Moss',
      umber: 'Umber',
      indigo: 'Indigo',
      plum: 'Plum',
      jade: 'Jade',
      terracotta: 'Terracotta',
      custom: 'Custom tone',
    },
    priorities: {
      high: { label: 'High', description: 'Listed first among room members' },
      aboveNormal: { label: 'Above normal', description: 'Listed before standard labels' },
      standard: { label: 'Standard', description: 'Default display order for specialties' },
      secondary: { label: 'Secondary', description: 'Listed after primary room labels' },
      savedLabel: '{tier} (saved)',
      savedDescription: 'Keep existing display order for this label',
    },
    roomRoles: {
      managerLockedReason: 'Only the workspace owner or room host can grant this role.',
      HOST: {
        label: 'Host',
        description: 'Manages room members, access roles and work labels.',
      },
      MODERATOR: {
        label: 'Coordinator',
        description: 'Assigns members and labels; cannot grant host/coordinator roles.',
      },
      MEMBER: {
        label: 'Member',
        description: 'Joins calls, messages, shared notes, board and file sharing.',
      },
      VIEWER: {
        label: 'View only',
        description: 'Reads room content; cannot send messages, edit board or upload files.',
      },
      REMOVE: {
        label: 'Remove from this room',
        description: 'Revokes access to this room while keeping the member in the workspace.',
      },
    },
    presence: {
      inRoomLabel: 'In this room',
      inRoomDetail: 'Connected in: {roomName}',
      unverifiedLabel: 'Status unverified',
      unverifiedInRoomDetail: 'Live presence only tracks members currently connected to this open room.',
      unverifiedWorkspaceDetail:
        'Server does not publish workspace-wide online status; live presence appears inside an open room.',
      onlineLabel: 'Online',
      onlineInRoomDetail: 'In: {roomName}',
      notInRoomDetail: 'Not in a room',
      offlineLabel: 'Offline',
    },
    sessionStatus: {
      idle: 'Not in a room',
      localPreview: 'Local preview',
      connectingSignaling: 'Connecting to signaling server…',
      joiningRoom: 'Joining room…',
      joinedRoom: 'Joined "{name}"',
      waitingPeer: 'Waiting for teammates…',
      reconnected: 'Reconnected to signaling server…',
      connectedP2P: 'Connected peer-to-peer',
      connectError: 'Could not reach signaling server.',
    },
  },
} as const satisfies ControlsShape

const controlsJa = {
  controls: {
    colors: {
      moss: '苔緑',
      umber: '琥珀茶',
      indigo: '藍',
      plum: '紫苑',
      jade: '青磁',
      terracotta: '赤土',
      custom: 'カスタム色',
    },
    priorities: {
      high: { label: '高', description: 'ルームメンバー一覧の先頭に表示' },
      aboveNormal: { label: 'やや高', description: '標準ラベルより前に表示' },
      standard: { label: '標準', description: '通常の表示順' },
      secondary: { label: '補助', description: '主要ラベルの後に表示' },
      savedLabel: '{tier}（保存済み）',
      savedDescription: 'このラベルの現在の表示順を維持します',
    },
    roomRoles: {
      managerLockedReason: 'オーナーまたはルームホストのみ付与できます。',
      HOST: {
        label: 'ホスト',
        description: 'ルームのメンバー・権限・仕事ラベルを管理します。',
      },
      MODERATOR: {
        label: 'モデレーター',
        description: 'メンバーの割り当てとラベル付けが可能（管理権限の付与は不可）。',
      },
      MEMBER: {
        label: 'メンバー',
        description: '通話・チャット・共有ノート・ボード・ファイル共有に参加できます。',
      },
      VIEWER: {
        label: '閲覧のみ',
        description: '閲覧のみ可能。送信・ボード編集・ファイル送信はできません。',
      },
      REMOVE: {
        label: 'このルームから削除',
        description: 'ワークスペースに残したまま、このルームのアクセス権を解除します。',
      },
    },
    presence: {
      inRoomLabel: 'このルームに参加中',
      inRoomDetail: '接続中のルーム: {roomName}',
      unverifiedLabel: 'ステータス未確認',
      unverifiedInRoomDetail: 'ライブ参加状況はこのルームに接続中のメンバーのみ表示します。',
      unverifiedWorkspaceDetail:
        'サーバーはワークスペース全体のオンライン状態を提供していないため、ライブ参加状況はルーム内で表示されます。',
      onlineLabel: 'オンライン',
      onlineInRoomDetail: '現在：{roomName}',
      notInRoomDetail: 'ルーム外',
      offlineLabel: 'オフライン',
    },
    sessionStatus: {
      idle: 'ルーム未参加',
      localPreview: 'ローカルUIセッション',
      connectingSignaling: 'シグナリングサーバーに接続中…',
      joiningRoom: 'ルームに参加中…',
      joinedRoom: '「{name}」に参加しました',
      waitingPeer: '他のメンバーを待機中…',
      reconnected: 'シグナリングに再接続しました…',
      connectedP2P: 'P2P直接接続中',
      connectError: 'シグナリング接続エラー。',
    },
  },
} as const satisfies ControlsShape

export const controlsDomain: Record<Language, ControlsShape> = {
  vi: controlsVi,
  en: controlsEn,
  ja: controlsJa,
}
