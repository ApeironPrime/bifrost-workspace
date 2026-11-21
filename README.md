# Bifrost

Nền tảng cộng tác theo room sử dụng kiến trúc hybrid P2P. Chat và shared note realtime đi trực tiếp qua WebRTC DataChannel; Node.js chỉ đảm nhiệm signalling, REST API, xác thực và dữ liệu bền vững.

## Cấu trúc project

- `client/`: React, Vite, TypeScript và WebRTC client.
- `server/`: Node.js, Express, Socket.IO signalling server và Prisma.
- `server/prisma/`: schema PostgreSQL và migration.
- `docker-compose.yml`: môi trường local gồm client, server và PostgreSQL.

## Chạy local

Yêu cầu: Node.js, PostgreSQL đang chạy và database `bifrost_db` đã được cấu hình trong `server/.env`.

```powershell
cd server
npm run dev
```

Mở terminal thứ hai:

```powershell
cd client
npm run dev
```

Truy cập `http://localhost:5173`. Mở hai tab cùng một mã room để kiểm thử P2P chat và shared note. Health endpoint của server là `http://localhost:3000/api/health`.

### TURN fallback cho WebRTC

Một số mạng, antivirus hoặc chính sách trình duyệt chặn đường kết nối WebRTC trực tiếp. Khi đó cần TURN; nó chỉ relay gói WebRTC đã mã hóa, không lưu nội dung chat/note/whiteboard/file và không thay thế P2P DataChannel.

Bifrost sử dụng **coturn TURN REST shared-secret authentication (AUD-01)**. Shared secret tuyệt đối không cấu hình qua biến `VITE_*` ở frontend; thay vào đó dùng secret file 64 ký tự hex chung giữa `server` và `coturn`:

```powershell
node server/scripts/generate-turn-secret.mjs
docker compose up -d turn
```

Nếu chạy backend trực tiếp ngoài Docker, bật `TURN_URLS` (ví dụ `turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp`) và `TURN_SHARED_SECRET_FILE=../secrets/turn_shared_secret` trong `server/.env`. Khi deploy sau NAT/Internet, cấu hình `TURN_URLS` theo domain/public IP truy cập được từ browser, đặt `TURN_NETWORK_PROFILE=production`, truyền `TURN_EXTERNAL_IP` đúng NAT mapping (và mở cổng `3478/udp,tcp` + `49160-49200/udp,tcp`; bổ sung TLS `5349` nếu cần `turns:`). Không commit thư mục `secrets/`.

## Tính năng theo giai đoạn

- **Giai đoạn 1–4**: Auth JWT, Workspace Owner/Member, REST API & PostgreSQL (Prisma 7).
- **Giai đoạn 5**: Realtime nền tảng — Socket.IO signalling (JWT handshake, presence, room coordination, WebRTC offer/answer/candidate) và WebRTC DataChannel P2P chat & shared note.
- **Meeting Board realtime P2P**: Thay thế hoàn toàn Whiteboard vẽ tự do bằng bảng điều hành cuộc họp cộng tác P2P qua WebRTC DataChannel (4 cột nghiệp vụ: Agenda, Decisions, Action items với checkbox hoàn thành, Parking lot; kéo-thả native HTML5, đồng bộ board khi peer mới vào).
- **Giai đoạn 7**: Hoàn thiện trải nghiệm & P2P File Sharing:
  - **Song ngữ Việt – Nhật (vi / ja)**: Hệ thống i18n gọn nhẹ không phụ thuộc thư viện nặng, nút chuyển đổi nhanh trên header, lưu cấu hình vào `localStorage`. Dịch 100% giao diện (auth, workspace, room, chat, shared note, meeting board, file share, thông báo).
  - **Dark mode (Sáng / Tối)**: Nút bật/tắt trên header, thiết kế tinh gọn theo bảng màu Bifrost Bắc Âu bằng CSS Variables (`--bg-page`, `--bg-card`, `--text-main`,...), hỗ trợ tự nhận diện system theme (`prefers-color-scheme`) và lưu vào `localStorage`.
  - **Thông báo Toast**: Hệ thống Toast nổi (success / error / info), tự biến mất sau 4 giây, có nút đóng thủ công, hỗ trợ accessibility với `role="status"` và `aria-live="polite"`.
  - **Chia sẻ tệp P2P (File Sharing)**:
    - Truyền trực tiếp qua WebRTC DataChannel — **không qua máy chủ Socket.IO hay lưu database**.
    - Giới hạn an toàn: tối đa **10 MB / tệp**, chia nhỏ thành các chunk **16 KB** với mã hóa Base64 an toàn cho DataChannel.
    - Điều tiết luồng (backpressure): tự động tạm dừng khi `bufferedAmount > 64 KB` để tránh nghẽn kênh truyền.
    - Hỗ trợ kéo-thả (drag-and-drop) hoặc chọn file, thanh tiến trình % realtime, người nhận tái cấu trúc thành Blob và tải về máy với 1 click.
- **Giai đoạn UI Desktop-First (Figma Make)**:
  - **Thẩm mỹ tối giản Nhật Bản (Wabi-Sabi & Ivory/Sage)**: Nền ngà ấm (`#f7f5f0`), xanh rêu đậm (`#4d6251`), viền siêu mảnh, không emoji trong nút bấm (sử dụng 100% `lucide-react` icons), không gradient chói, không glassmorphism.
  - **App Shell Desktop 3 cột**:
    - Sidebar trái cố định 248px: Logo Bifrost, bộ chọn workspace, danh sách phòng họp, nút tạo phòng (Owner), profile & quick settings ở đáy.
    - Header toàn cục: Breadcrumb định vị (`Workspace / Room`), chỉ báo P2P realtime (pulsing dot), avatar stack thành viên online, nút ẩn/hiện Right Panel.
    - Right Contextual Panel (280px, thu gọn được): Thông tin phòng, sao chép ID phòng nhanh, danh sách thành viên online, chẩn đoán kết nối P2P.
  - **Active Room với Tab Navigation (Không cuộn dọc)**:
    - 5 Tab chuyên biệt: **Meeting** | **Meeting Board** | **Chat** | **Notes** | **Files**.
    - **Bảo toàn trạng thái tuyệt đối (Zero State Loss)**: Áp dụng cơ chế giữ nguyên DOM node (`display: none` / `display: flex`), không unmount component khi đổi tab. Đang truyền file dở, đang sửa board hay đang gõ note/chat đều giữ nguyên 100% dữ liệu.
  - **Tab Meeting (Khung vỏ chuẩn bị cho WebRTC MediaStream)**:
    - Lưới video tiles linh hoạt (1–6 người) dựa trên danh sách presence thật (`onlinePeers`).
    - Thẻ chờ thành viên khi chỉ có 1 người trong phòng kèm tên phòng.
    - Thanh thông báo trạng thái rõ ràng: *"Tính năng gọi video/audio sẽ được kích hoạt ở giai đoạn tiếp theo"*, không báo kết nối camera giả.
    - Thanh điều khiển nổi ở đáy: Mic, Camera, Chia sẻ màn hình, Rời cuộc họp.

## Kiểm thử 2 trình duyệt (Demo P2P Room)

1. Khởi động server: `cd server && npm run dev`
2. Khởi động client: `cd client && npm run dev`
3. Mở Trình duyệt 1 (hoặc Tab ẩn danh 1):
   - Đăng ký tài khoản A, tạo Workspace, tạo Room và bấm **Vào room**.
4. Mở Trình duyệt 2 (hoặc Tab ẩn danh 2):
   - Đăng ký tài khoản B.
   - Ở Trình duyệt 1: Nhập email tài khoản B vào ô "Mời thành viên" của Workspace.
   - Ở Trình duyệt 2: Chọn Workspace vừa được mời, danh sách Room sẽ hiện ra, bấm **Vào room**.
5. Trải nghiệm:
   - **P2P Connected**: Khi DataChannel kết nối, thông báo Toast màu xanh hiện lên ở cả 2 bên.
   - **Bilingual & Dark mode**: Bấm nút `VI`/`JA` và biểu tượng Theme trên header để đổi ngôn ngữ và giao diện tức thì.
   - **Meeting Board P2P**: Tạo card ở Tab Meeting Board, kéo thả di chuyển hoặc đánh dấu hoàn thành; card đồng bộ tức thời sang Trình duyệt 2 qua DataChannel.
   - **P2P File Transfer**: Kéo một tệp ảnh/tài liệu (< 10 MB) vào vùng chia sẻ tệp ở Tab 1; Tab 2 sẽ hiển thị tiến trình nhận và nút "Tải xuống" khi hoàn tất.

## Kiểm thử tự động

- **File transfer helper unit test**:
  ```powershell
  npx tsx client/src/lib/fileTransfer.test.mjs
  ```
- **Server integration tests (Auth, Workspace, Room, Signalling)**:
  ```powershell
  cd server && npm test
  ```
- **Client lint & build**:
  ```powershell
  cd client && npm run lint && npm run build
  ```

## Docker Compose

Sau khi cài Docker Desktop, chạy tại thư mục gốc:

```powershell
docker compose up --build
```

Client dùng `http://localhost:5173`, server dùng `http://localhost:3000`, PostgreSQL Docker map ra cổng `5433` để không xung đột PostgreSQL cài trên máy.
