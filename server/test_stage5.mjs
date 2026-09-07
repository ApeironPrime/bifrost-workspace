import { spawn } from "node:child_process";
import "dotenv/config";
import pg from "pg";
import { io as ClientSocket } from "../client/node_modules/socket.io-client/build/esm/index.js";

const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}/api`;
const SOCKET_URL = `http://localhost:${PORT}`;
const testEmails = [];

function check(label, condition) {
  if (!condition) throw new Error(`Kiểm thử thất bại: ${label}`);
  console.log(`✓ ${label}`);
}

// Helper for HTTP requests
async function request(url, options = {}) {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ GIAI ĐOẠN 5 ===");

  // 1. Khởi động server test
  const env = { ...process.env, PORT: String(PORT) };
  const serverProcess = spawn("node", ["dist/index.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => {
    // console.log(`[Server] ${d.toString().trim()}`);
  });
  serverProcess.stderr.on("data", (d) => {
    console.error(`[Server Error] ${d.toString().trim()}`);
  });

  // Chờ server sẵn sàng
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!serverReady) {
    serverProcess.kill();
    throw new Error("Không thể khởi động test server trên port " + PORT);
  }
  console.log(`✓ Test server đã sẵn sàng trên port ${PORT}`);

  try {
    const timestamp = Date.now();
    const ownerEmail = `alice_${timestamp}@test.com`;
    const memberEmail = `bob_${timestamp}@test.com`;
    const outsiderEmail = `charlie_${timestamp}@test.com`;
    testEmails.push(ownerEmail, memberEmail, outsiderEmail);

    // 2. Tạo 3 người dùng
    console.log("\n--- Kiểm thử Auth & User ---");
    const userA = await request("/auth/register", {
      method: "POST",
      body: { name: "Owner Alice", email: ownerEmail, password: "password123" },
    });
    check("Đăng ký Owner Alice trả về 201", userA.status === 201);

    const userB = await request("/auth/register", {
      method: "POST",
      body: { name: "Member Bob", email: memberEmail, password: "password123" },
    });
    check("Đăng ký Member Bob trả về 201", userB.status === 201);

    const userC = await request("/auth/register", {
      method: "POST",
      body: { name: "Outsider Charlie", email: outsiderEmail, password: "password123" },
    });
    check("Đăng ký Outsider Charlie trả về 201", userC.status === 201);

    const tokenA = userA.data.token;
    const tokenB = userB.data.token;
    const tokenC = userC.data.token;

    // 3. Alice tạo Workspace W1
    console.log("\n--- Kiểm thử Workspace & Phân quyền ---");
    const wsRes = await request("/workspaces", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { name: `Workspace Alpha ${timestamp}` },
    });
    check("Owner tạo Workspace trả về 201", wsRes.status === 201);
    const workspaceId = wsRes.data.workspace.id;

    // 4. Alice mời Bob vào W1
    const inviteRes = await request(`/workspaces/${workspaceId}/members`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { email: memberEmail },
    });
    check("Owner mời Member trả về 201", inviteRes.status === 201);

    // 5. Alice (Owner) tạo Room R1
    console.log("\n--- Kiểm thử REST API Rooms ---");
    const roomRes = await request(`/workspaces/${workspaceId}/rooms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { name: "Phòng Họp Sprint", description: "Thảo luận sprint 5" },
    });
    check("Owner tạo Room trả về 201", roomRes.status === 201);
    const roomId = roomRes.data.room.id;
    console.log("  Room ID:", roomId, "Name:", roomRes.data.room.name);

    // 6. Bob (Member) thử tạo Room -> Phải bị 403
    const bobCreateRes = await request(`/workspaces/${workspaceId}/rooms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: { name: "Phòng Bob Tự Tạo" },
    });
    check("Member không thể tạo Room", bobCreateRes.status === 403);

    // 7. Bob (Member) lấy danh sách rooms trong W1 -> 200
    const bobRoomsRes = await request(`/workspaces/${workspaceId}/rooms`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    check("Member xem được danh sách Room", bobRoomsRes.status === 200 && bobRoomsRes.data.rooms.length === 1);

    // 8. Bob (Member) xem chi tiết Room R1 -> 200
    const bobGetRoomRes = await request(`/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    check("Member xem được chi tiết Room", bobGetRoomRes.status === 200);

    // 9. Charlie (Outsider) lấy danh sách rooms trong W1 -> Phải bị 403
    const charlieRoomsRes = await request(`/workspaces/${workspaceId}/rooms`, {
      headers: { Authorization: `Bearer ${tokenC}` },
    });
    check("Outsider không xem được danh sách Room", charlieRoomsRes.status === 403);

    // 10. Charlie (Outsider) xem chi tiết Room R1 -> Phải bị 403
    const charlieGetRoomRes = await request(`/rooms/${roomId}`, {
      headers: { Authorization: `Bearer ${tokenC}` },
    });
    check("Outsider không xem được chi tiết Room", charlieGetRoomRes.status === 403);

    // 11. Room không tồn tại -> 404
    const notFoundRoomRes = await request("/rooms/00000000-0000-0000-0000-000000000000", {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Room không tồn tại trả về 404", notFoundRoomRes.status === 404);

    // 12. Kiểm thử Socket.IO Realtime & Presence
    console.log("\n--- Kiểm thử Socket.IO Realtime & Presence ---");

    // a. Socket kết nối không có token
    const noAuthSocket = ClientSocket(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: false,
    });
    const noAuthPromise = new Promise((resolve) => {
      noAuthSocket.on("connect_error", (err) => {
        resolve(err.message);
        noAuthSocket.disconnect();
      });
      noAuthSocket.connect();
    });
    const noAuthErr = await noAuthPromise;
    check("Socket không có token bị từ chối", noAuthErr.includes("Bạn cần đăng nhập"));

    // b. Charlie (Outsider) kết nối và cố join R1
    const socketC = ClientSocket(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token: tokenC },
    });
    await new Promise((r) => socketC.on("connect", r));

    const charlieJoinPromise = new Promise((resolve) => {
      socketC.on("room:error", (data) => resolve(data.message));
      socketC.emit("room:join", roomId);
    });
    const charlieJoinErr = await charlieJoinPromise;
    check("Outsider bị chặn khi Socket join Room", typeof charlieJoinErr === "string" && charlieJoinErr.includes("không thuộc workspace"));
    socketC.disconnect();

    // c. Alice kết nối và join R1
    const socketA = ClientSocket(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token: tokenA },
    });
    await new Promise((r) => socketA.on("connect", r));

    let alicePresenceCount = 0;
    const aliceJoinedPromise = new Promise((resolve) => {
      socketA.on("room:joined", (data) => {
        resolve(data);
      });
    });
    socketA.on("presence:changed", (data) => {
      alicePresenceCount = data.peers.length;
    });

    socketA.emit("room:join", roomId);
    const aliceJoinedData = await aliceJoinedPromise;
    await new Promise((r) => setTimeout(r, 60));
    check("Owner nhận room:joined đúng Room", aliceJoinedData.roomName === "Phòng Họp Sprint");
    check("Presence ban đầu có đúng một người", alicePresenceCount === 1);

    // d. Bob kết nối và join R1
    const socketB = ClientSocket(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token: tokenB },
    });
    await new Promise((r) => socketB.on("connect", r));

    const bobJoinedPromise = new Promise((resolve) => {
      socketB.on("room:joined", (data) => resolve(data));
    });

    const alicePeerJoinedPromise = new Promise((resolve) => {
      socketA.on("room:peer-joined", (data) => resolve(data));
    });

    socketB.emit("room:join", roomId);
    const bobJoinedData = await bobJoinedPromise;
    const aliceSawBob = await alicePeerJoinedPromise;

    check("Member nhận room:joined với một peer có sẵn", bobJoinedData.peers.length === 1);
    check("Owner nhận room:peer-joined từ Member", aliceSawBob.peerId === socketB.id);

    // Chờ 1 chút để presence:changed đồng bộ
    await new Promise((r) => setTimeout(r, 100));
    check("Presence hiển thị đúng hai người", alicePresenceCount === 2);

    // Joining the same Room twice must not announce the same peer twice.
    let duplicatePeerJoined = false;
    const duplicatePeerHandler = () => { duplicatePeerJoined = true; };
    socketA.on("room:peer-joined", duplicatePeerHandler);
    const bobDuplicateJoin = new Promise((resolve) => socketB.once("room:joined", resolve));
    socketB.emit("room:join", roomId);
    await bobDuplicateJoin;
    await new Promise((r) => setTimeout(r, 100));
    socketA.off("room:peer-joined", duplicatePeerHandler);
    check("Join lặp không phát peer-joined lần hai", !duplicatePeerJoined && alicePresenceCount === 2);

    // 13. Kiểm thử WebRTC Signalling Isolation
    console.log("\n--- Kiểm thử WebRTC Signalling Isolation ---");

    // Tạo Room R2 cho Charlie trong Workspace mới W2 của Charlie
    const wsCharlie = await request("/workspaces", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenC}` },
      body: { name: `Charlie Workspace ${timestamp}` },
    });
    const roomCharlie = await request(`/workspaces/${wsCharlie.data.workspace.id}/rooms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenC}` },
      body: { name: "Charlie Room" },
    });
    const socketC2 = ClientSocket(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token: tokenC },
    });
    await new Promise((r) => socketC2.on("connect", r));
    await new Promise((r) => {
      socketC2.on("room:joined", r);
      socketC2.emit("room:join", roomCharlie.data.room.id);
    });

    // Alice cố gửi webrtc:offer tới socketC2 (khác room) -> Phải nhận room:error
    const crossRoomPromise = new Promise((resolve) => {
      socketA.on("room:error", (err) => resolve(err.message));
      socketA.emit("webrtc:offer", {
        targetId: socketC2.id,
        payload: { sdp: "dummy-sdp-offer", type: "offer" },
      });
    });
    const crossRoomErr = await crossRoomPromise;
    check("Signalling xuyên Room bị chặn", typeof crossRoomErr === "string" && crossRoomErr.includes("khác room"));
    socketC2.disconnect();

    // Alice gửi webrtc:offer tới Bob (cùng room) -> Bob nhận thành công
    const offerPayload = { sdp: "v=0\r\no=alice...", type: "offer" };
    const bobOfferPromise = new Promise((resolve) => {
      socketB.on("webrtc:offer", (msg) => resolve(msg));
      socketA.emit("webrtc:offer", {
        targetId: socketB.id,
        payload: offerPayload,
      });
    });
    const receivedOffer = await bobOfferPromise;
    check("Offer được relay trong cùng Room", receivedOffer.peerId === socketA.id);

    // Bob gửi webrtc:answer tới Alice -> Alice nhận thành công
    const answerPayload = { sdp: "v=0\r\no=bob...", type: "answer" };
    const aliceAnswerPromise = new Promise((resolve) => {
      socketA.on("webrtc:answer", (msg) => resolve(msg));
      socketB.emit("webrtc:answer", {
        targetId: socketA.id,
        payload: answerPayload,
      });
    });
    const receivedAnswer = await aliceAnswerPromise;
    check("Answer được relay trong cùng Room", receivedAnswer.peerId === socketB.id);

    // 14. Kiểm thử Disconnect & Presence cập nhật
    console.log("\n--- Kiểm thử Disconnect & Presence ---");
    const bobSocketId = socketB.id;
    const alicePeerLeftPromise = new Promise((resolve) => {
      socketA.on("room:peer-left", (msg) => resolve(msg));
    });

    socketB.disconnect();
    const peerLeftMsg = await alicePeerLeftPromise;
    check("Owner nhận peer-left khi Member disconnect", peerLeftMsg.peerId === bobSocketId);

    await new Promise((r) => setTimeout(r, 150));
    check("Presence giảm đúng còn một người", alicePresenceCount === 1);

    // 15. Kiểm thử Reconnect & Presence không trùng
    console.log("\n--- Kiểm thử Reconnect ---");
    const socketB2 = ClientSocket(SOCKET_URL, {
      transports: ["websocket"],
      auth: { token: tokenB },
    });
    await new Promise((r) => socketB2.on("connect", r));

    const bobRejoinPromise = new Promise((resolve) => {
      socketB2.on("room:joined", (data) => resolve(data));
    });

    socketB2.emit("room:join", roomId);
    await bobRejoinPromise;
    await new Promise((r) => setTimeout(r, 150));

    check("Member kết nối lại và join Room thành công", true);
    check("Presence sau reconnect không trùng lặp", alicePresenceCount === 2);

    socketA.disconnect();
    socketB2.disconnect();

    console.log("\n==========================================");
    console.log(" TẤT CẢ CÁC BÀI KIỂM THỬ ĐỀU THÀNH CÔNG! ");
    console.log("==========================================");
  } finally {
    if (testEmails.length > 0) {
      try {
        const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await database.connect();
        await database.query("DELETE FROM users WHERE email = ANY($1)", [testEmails]);
        await database.end();
        console.log("Đã xóa dữ liệu kiểm thử tạm thời.");
      } catch (cleanupError) {
        console.error("Không thể dọn dữ liệu kiểm thử:", cleanupError);
      }
    }
    serverProcess.kill();
  }
}

runTests().catch((err) => {
  console.error("KIỂM THỬ THẤT BẠI:", err);
  process.exit(1);
});
