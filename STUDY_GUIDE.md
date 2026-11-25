# Hướng Dẫn Học & Đọc Hiểu Mã Nguồn Bifrost (`STUDY_GUIDE.md`)

Tài liệu này giúp bạn học toàn bộ code của dự án **Bifrost** theo thứ tự từ gốc đến ngọn (Database → Back-end → Realtime Signaling → WebRTC P2P → Giao diện React), tránh bị ngợp khi mở cả repo.

---

## 1. Lộ trình đọc code theo 5 chặng

### Chặng 1: Cơ sở dữ liệu & Xác thực (Khoảng 1–2 giờ)
Đọc phần này để hiểu hệ thống lưu những bảng nào và bảo vệ tài khoản ra sao:
1. [`server/prisma/schema.prisma`](server/prisma/schema.prisma) — 6 bảng cốt lõi:
   - `users` & `user_profiles`: thông tin đăng nhập và ảnh đại diện.
   - `refresh_tokens`: lưu **SHA-256 hash** của Refresh Token để xoay vòng token và thu hồi phiên khi đăng xuất / đổi mật khẩu.
   - `workspaces` & `workspace_members`: không gian làm việc và vai trò `OWNER` / `MEMBER`.
   - `rooms`, `room_members`, `room_roles`: phòng họp, phân quyền chi tiết cấp phòng (`HOST`, `MODERATOR`, `MEMBER`, `VIEWER`) và nhãn tùy chỉnh.
2. [`server/src/lib/auth.ts`](server/src/lib/auth.ts) — Tạo/kiểm tra Access JWT (ngắn hạn, mặc định `15m`) và sinh Refresh Token ngẫu nhiên 48-byte.
3. **Luồng MVC Xác thực**:
   - Route [`server/src/routes/auth.ts`](server/src/routes/auth.ts) → Controller [`server/src/controllers/auth.controller.ts`](server/src/controllers/auth.controller.ts) → Service [`server/src/services/auth.service.ts`](server/src/services/auth.service.ts) xử lý `/register`, `/login`, `/refresh` (có **replay detection**: dùng lại token cũ sẽ thu hồi toàn bộ phiên của user), `/logout`, `/change-password`, `/me`, `/profile`.
4. [`server/src/lib/rateLimit.ts`](server/src/lib/rateLimit.ts) — Chống brute-force đăng nhập, chống spoofing `X-Forwarded-For`.

### Chặng 2: REST API Nghiệp vụ Workspace & Phòng họp (Khoảng 1–2 giờ)
1. **Luồng MVC Workspace**:
   - [`server/src/routes/workspaces.ts`](server/src/routes/workspaces.ts) → [`server/src/controllers/workspace.controller.ts`](server/src/controllers/workspace.controller.ts) → [`server/src/services/workspace.service.ts`](server/src/services/workspace.service.ts): Toàn bộ CRUD Workspace, mời/xóa thành viên, tạo/sửa/xóa phòng, gán vai trò phòng (`PATCH /:workspaceId/members/:userId`), và quản lý nhãn (`roles`). Chú ý cách kiểm tra quyền để **Moderator không thể nâng quyền lên Host/Moderator**.
2. **Luồng MVC Phòng họp**:
   - [`server/src/routes/rooms.ts`](server/src/routes/rooms.ts) → [`server/src/controllers/room.controller.ts`](server/src/controllers/room.controller.ts) → [`server/src/services/room.service.ts`](server/src/services/room.service.ts): Lấy chi tiết phòng kèm `access` thực tế của người gọi.
3. [`server/src/lib/validation.ts`](server/src/lib/validation.ts) — Middleware chặn UUID sai định dạng trước khi chạm vào PostgreSQL.

### Chặng 3: Tầng Signaling Realtime & Bảo mật WebRTC (Khoảng 2 giờ)
1. [`server/src/sockets/room.socket.ts`](server/src/sockets/room.socket.ts) (khởi tạo từ [`server/src/index.ts`](server/src/index.ts)) — Trọng tâm của Socket.IO:
   - Handshake xác thực JWT trước khi cho socket kết nối.
   - Sự kiện `room:join`: kiểm tra quyền Workspace **và** quyền cấp Room (`room_members`), xử lý idempotent khi reconnect để không phát trùng `peer-joined`.
   - Chuyển tiếp `webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate` **chỉ khi 2 socket đang ở chung phòng** (`findSharedRoom`).
2. [`server/src/lib/revocation.ts`](server/src/lib/revocation.ts) — Thu hồi phiên Socket.IO ngay lập tức (`room:access-revoked`) khi thành viên bị xóa khỏi workspace/phòng hoặc phòng bị xóa.
3. [`server/src/lib/turn.ts`](server/src/lib/turn.ts) & [`server/src/routes/turn.ts`](server/src/routes/turn.ts) — Cấp credential TURN tạm thời ký bằng HMAC-SHA1 cho `coturn` (không lộ secret ra client).

### Chặng 4: Lõi WebRTC P2P & Custom Hooks phía Client (Khoảng 2–3 giờ)
Đọc phần này để hiểu cách 2 trình duyệt nối thẳng P2P với nhau:
1. [`client/src/lib/peerSignaling.ts`](client/src/lib/peerSignaling.ts) — Thuật toán **Perfect Negotiation** (`polite` vs `impolite` peer) giúp 2 máy không bị đụng độ khi cùng gửi offer, cộng hàng đợi ICE candidate và tự phục hồi khi rớt mạng.
2. [`client/src/lib/peerIdentity.ts`](client/src/lib/peerIdentity.ts) — Xác minh danh tính người gửi trên DataChannel dựa vào `peerId` thật của kết nối, chặn giả mạo `author` và chặn `VIEWER` gửi tin nhắn/thẻ ghi chú.
3. [`client/src/lib/iceConfig.ts`](client/src/lib/iceConfig.ts) — Quản lý vòng đời ICE servers và tự làm mới credential TURN trước khi hết hạn.
4. [`client/src/lib/fileTransfer.ts`](client/src/lib/fileTransfer.ts), [`sha256.ts`](client/src/lib/sha256.ts) & [`fileChunkSink.ts`](client/src/features/room/hooks/fileChunkSink.ts) — Truyền file nhị phân `ArrayBuffer` (`BFC1`, tối đa **2 GB** theo từng slice 64 KB), ghi thẳng xuống đĩa qua OPFS / `FileSystemWritableFileStream`, điều tiết `bufferedamountlow`, Resume khi rớt mạng và kiểm tra toàn vẹn `SHA-256`.
5. [`client/src/lib/hlc.ts`](client/src/lib/hlc.ts) — Đồng hồ logic lai **Hybrid Logical Clock (HLC)** chống lệch giờ máy khách khi đồng bộ Note/Chat/Board.
6. [`client/src/lib/mediaQuality.ts`](client/src/lib/mediaQuality.ts) — Adaptive P2P Mesh scaling (tự co giãn bitrate/FPS/độ phân giải theo số người trong phòng), phân tích WebRTC `getStats()` (RTT, jitter, packet loss) và phổ sóng âm giọng nói.
7. [`client/src/features/room/hooks/useRoomMedia.ts`](client/src/features/room/hooks/useRoomMedia.ts), [`mediaProcessors.ts`](client/src/features/room/hooks/mediaProcessors.ts), [`useAudioActivity.ts`](client/src/features/room/hooks/useAudioActivity.ts) — Custom hook quản lý trọn vẹn MediaStream (Mic, Camera, Screen Share, chọn thiết bị, lọc ồn WebAudio, làm mờ nền Camera, Active Speaker và `getStats()`).
8. [`client/src/App.tsx`](client/src/App.tsx) — Nơi ghép nối Socket.IO + `RTCPeerConnection` + `RTCDataChannel` + `useRoomMedia` + Cloud Snapshot Backup (PostgreSQL `room_collab_states` & `user_room_notes`) + Refresh Token ngầm.

### Chặng 5: Giao diện React theo Feature, Đa ngôn ngữ & Triển khai (Khoảng 2 giờ)
1. **Giao diện chia theo tính năng** trong [`client/src/features/`](client/src/features/) và dùng chung trong [`client/src/shared/`](client/src/shared/):
   - [`features/room/components/MeetingTab.tsx`](client/src/features/room/components/MeetingTab.tsx): Sân khấu gọi Audio/Video/Chia sẻ màn hình + khung vòm *Botanical Atelier*.
   - [`features/room/components/MeetingBoard.tsx`](client/src/features/room/components/MeetingBoard.tsx) & [`features/room/hooks/useBoardPointerDrag.ts`](client/src/features/room/hooks/useBoardPointerDrag.ts): Bảng Kanban 4 cột đồng bộ P2P + kéo thả pointer.
   - [`features/room/components/ChatPane.tsx`](client/src/features/room/components/ChatPane.tsx), [`NotesPane.tsx`](client/src/features/room/components/NotesPane.tsx), [`FileShare.tsx`](client/src/features/room/components/FileShare.tsx): Giao tiếp P2P qua DataChannel.
   - [`features/workspace/WorkspaceMembers.tsx`](client/src/features/workspace/WorkspaceMembers.tsx), [`WorkspaceSwitcher.tsx`](client/src/features/workspace/WorkspaceSwitcher.tsx), [`RoomLabelsEditor.tsx`](client/src/features/workspace/RoomLabelsEditor.tsx): Danh bạ thành viên, lọc theo nhóm, phân quyền phòng và nhãn.
   - [`features/auth/`](client/src/features/auth/): Đăng nhập, đăng ký, onboarding hồ sơ.
   - [`shared/components/`](client/src/shared/components/) & [`shared/hooks/`](client/src/shared/hooks/): Các UI dùng chung (`UserAvatar`, `ConfirmDialog`, `Toast`, `SelectMenu`, `useDialogFocus`, `useDelayedLoading`).
2. **Đa ngôn ngữ (`i18n`)**: [`client/src/i18n/`](client/src/i18n/) kèm bài kiểm thử AST [`client/dev/i18n.test.mjs`](client/dev/i18n.test.mjs) tự động quét code để đảm bảo không có chữ cứng chưa dịch và không có key thừa.
3. **Hạ tầng triển khai**: [`docker-compose.prod.yml`](docker-compose.prod.yml), [`docker/Caddyfile`](docker/Caddyfile) (HTTPS tự động), [`client/nginx.conf`](client/nginx.conf).

---

## 2. Mẹo đọc nhanh khi học lại code
- **Muốn xem luồng 1 nút bấm chạy đi đâu**: Tìm tên hàm trong `client/src/App.tsx` hoặc hook trong `client/src/features/room/hooks/` (ví dụ `joinRoom`, `toggleMic`, `sendMessage`) rồi lần theo `client/src/lib/` và route → controller → service tương ứng ở `server/src/`.
- **Muốn xem kịch bản chuẩn của toàn hệ thống**: Đọc [`server/tests/test_stage5.mjs`](server/tests/test_stage5.mjs) — file này mô phỏng trọn vẹn từ lúc đăng ký, tạo workspace/room, nối Socket.IO, bắt tay WebRTC, đến lúc bị thu hồi quyền và xoay vòng Refresh Token.
