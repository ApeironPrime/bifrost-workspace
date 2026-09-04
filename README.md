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

## Docker Compose

Sau khi cài Docker Desktop, chạy tại thư mục gốc:

```powershell
docker compose up --build
```

Client dùng `http://localhost:5173`, server dùng `http://localhost:3000`, PostgreSQL Docker map ra cổng `5433` để không xung đột PostgreSQL cài trên máy.
