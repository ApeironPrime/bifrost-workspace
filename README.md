# Bifrost

Nền tảng cộng tác và họp nhóm theo phòng sử dụng mô hình **Hybrid (Client–Server Signaling + WebRTC P2P Full Mesh)**.

- **Tầng điều khiển (Client–Server)**: Node.js, Express, Socket.IO, Prisma 7 và PostgreSQL xử lý xác thực (JWT + Refresh Token xoay vòng), Workspace/Room/Phân quyền, Presence và chuyển tiếp bắt tay WebRTC (`offer`, `answer`, `ice-candidate`).
- **Tầng dữ liệu thời gian thực (WebRTC P2P)**: Âm thanh (Mic), Video (Camera), Chia sẻ màn hình (Screen Share), Chat, Tài liệu cộng tác CRDT thời gian thực (`yjs` + con trỏ đa người dùng `Y.RelativePosition`), Ghi chú cá nhân/chia sẻ, Bảng họp Kanban (`MeetingBoard`) và Truyền tệp P2P (`FileShare`) truyền trực tiếp giữa các trình duyệt, không đi qua app server.

## Cấu trúc thư mục

```text
bifrost-workspace/
├── client/                  # Front-end React + TypeScript + Vite (Feature-based + Hooks)
│   ├── dev/                 # Unit tests & AST i18n audit + TXT dev DB
│   └── src/
│       ├── features/        # Nhóm theo tính năng nghiệp vụ
│       │   ├── auth/        # AuthScreen, AuthActionDialog, ProfileOnboarding
│       │   ├── homepage/    # Trang chủ giới thiệu (SculptureHero, CollaborationAtelier, MeetingJourney)
│       │   ├── workspace/   # WorkspaceSwitcher, WorkspaceMembers, RoomLabelsEditor, WorkspaceLoadingScreen
│       │   └── room/        # Phòng họp P2P: components/ (MeetingTab, MeetingBoard, ChatPane, NotesPane, FileShare) & hooks/ (useRoomMedia, ...)
│       ├── shared/          # Dùng chung toàn app: components/ (UserAvatar, ConfirmDialog, Toast, ...) & hooks/ (useDelayedLoading, useDialogFocus, ...)
│       ├── i18n/            # Hệ thống đa ngôn ngữ VI / EN / JA
│       ├── lib/             # Core WebRTC signaling, ICE manager, file chunking, state helpers
│       └── styles/          # Design tokens & stylesheets (tokens, shell, workspace, room)
├── server/                  # Back-end Node.js + Express + Socket.IO + Prisma (MVC)
│   ├── prisma/              # schema.prisma & PostgreSQL migrations
│   ├── scripts/             # generate-turn-secret.mjs
│   ├── src/
│   │   ├── routes/          # Định tuyến REST API (auth, workspaces, rooms, turn)
│   │   ├── controllers/     # Nhận/trả HTTP request & validate (auth, workspace, room)
│   │   ├── services/        # Nghiệp vụ & truy vấn Prisma (auth, workspace, room)
│   │   ├── sockets/         # Xử lý Socket.IO & WebRTC signaling (room.socket.ts)
│   │   ├── middleware/      # requireAuth
│   │   └── lib/             # auth (JWT/Refresh), prisma, rateLimit, revocation, turn, validation
│   └── tests/               # Unit tests, integration tests & Stage 5 E2E
├── docker/                  # Caddyfile (HTTPS reverse proxy) & coturn-entrypoint.sh
├── docker-compose.yml       # Môi trường local
├── docker-compose.prod.yml  # Stack production (Postgres + Server + Client Nginx + Coturn + Caddy HTTPS)
└── STUDY_GUIDE.md           # Hướng dẫn đọc hiểu toàn bộ mã nguồn theo từng chặng
```

## Chạy môi trường phát triển (Local)

Yêu cầu: Node.js 22+, PostgreSQL đang chạy (`bifrost_db`) và cấu hình `server/.env`, `client/.env` (`VITE_DATA_MODE=api`).

```powershell
# Terminal 1: Back-end (http://localhost:3000)
cd server
npx prisma db push --config prisma7.config.ts
npm run dev

# Terminal 2: Front-end (http://127.0.0.1:5173)
cd client
npm run dev
```

## Chạy Production với Docker (HTTPS + Coturn + Redis Cluster)

```bash
node server/scripts/generate-turn-secret.mjs
# Điền BIFROST_DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, RATE_LIMIT_HMAC_SECRET vào môi trường
# Tuỳ chọn Object Storage (S3/R2): AVATAR_S3_ENDPOINT, AVATAR_S3_BUCKET, AVATAR_S3_ACCESS_KEY_ID, AVATAR_S3_SECRET_ACCESS_KEY
docker compose -f docker-compose.prod.yml up -d --build
```

- **Scale ngang & Bảo mật phiên**:
  - `REDIS_URL`: Bật `@socket.io/redis-adapter` + `RedisRateLimitStore` chia sẻ trạng thái signaling và rate-limit giữa nhiều replica backend (mặc định fallback single-node khi bỏ trống).
  - **Avatar Storage**: Lưu ảnh đại diện dạng content-addressed JPEG trên S3/R2 hoặc volume `/api/avatars/<sha256>.jpg` thay vì nhét Base64 vào PostgreSQL.
  - **Token Hardening**: Refresh token nằm trong cookie `HttpOnly; SameSite=Lax; Path=/api/auth` (`bifrost_rt`), Access token giữ hoàn toàn trong bộ nhớ RAM phía client.
  - **Tài khoản & Onboarding**: Hỗ trợ xác minh Email OTP 6 số, Quên/Đặt lại mật khẩu, OAuth2 (Google/GitHub), bảo mật 2 lớp (2FA TOTP + Recovery Codes), liên kết mời 1-click (`/#invite=...`) và thông báo đẩy + chuông báo khi mở phòng họp (`workspace:room-active`).
  - **Kiến trúc Modular & Vận hành (DevOps/QA)**: Tách `App.tsx` (< 400 dòng) thành các domain hooks (`useWebRtcRoomEngine`, `useAuthAndProfile`, `useWorkspaceDirectory`, `useShellLayout`) và feature views/modals (`AuthenticatedWorkspaceShell`, `AppSidebar`, `AppHeader`, `DashboardView`, `RoomWorkspaceView`, `ProfileSecurityModal`, `WorkspaceModals`), đồng bộ tài liệu CRDT (`Y.Doc` + `Y.mergeUpdates` lưu trữ PostgreSQL), tích hợp Prometheus `GET /api/metrics` + `POST /api/telemetry/errors` + `AppErrorBoundary`, pipeline `.github/workflows/ci.yml` và kiểm thử đa tab Chromium WebRTC P2P (`npm run test:e2e`).

## Kiểm thử tự động

```powershell
# Client (TypeScript + oxlint + 96 unit/i18n tests + Vite build)
cd client
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npm test
npm run build

# Server (Prisma generate + tsc + 27 unit/E2E tests + Stage 5 Socket/WebRTC/Auth E2E)
cd ../server
npm test
```
