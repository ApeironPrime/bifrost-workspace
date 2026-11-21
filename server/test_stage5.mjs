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

    // 16. Kiểm thử Validation UUID & Xử lý lỗi Thành viên (AUD-03)
    console.log("\n--- Kiểm thử Validation UUID & Xử lý lỗi Thành viên (AUD-03) ---");
    const aliceId = userA.data.user.id;
    const bobId = userB.data.user.id;
    const badUuid = "not-a-valid-uuid";

    const malformedWsGet = await request(`/workspaces/${badUuid}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Malformed workspaceId trên GET /workspaces/:id trả về 400", malformedWsGet.status === 400);

    const malformedMembersGet = await request(`/workspaces/${badUuid}/members`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Malformed workspaceId trên GET /workspaces/:id/members trả về 400", malformedMembersGet.status === 400);

    const malformedInvite = await request(`/workspaces/${badUuid}/members`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { email: outsiderEmail },
    });
    check("Malformed workspaceId trên POST /workspaces/:id/members trả về 400", malformedInvite.status === 400);

    const malformedDeleteWs = await request(`/workspaces/${badUuid}/members/${bobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Malformed workspaceId trên DELETE member trả về 400", malformedDeleteWs.status === 400);

    const malformedDeleteUser = await request(`/workspaces/${workspaceId}/members/${badUuid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Malformed userId trên DELETE member trả về 400", malformedDeleteUser.status === 400);

    const malformedRoomsList = await request(`/workspaces/${badUuid}/rooms`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Malformed workspaceId trên GET /workspaces/:id/rooms trả về 400", malformedRoomsList.status === 400);

    const malformedRoomCreate = await request(`/workspaces/${badUuid}/rooms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { name: "Invalid WS Room" },
    });
    check("Malformed workspaceId trên POST /workspaces/:id/rooms trả về 400", malformedRoomCreate.status === 400);

    const malformedRoomGet = await request(`/rooms/${badUuid}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Malformed roomId trên GET /rooms/:roomId trả về 400", malformedRoomGet.status === 400);

    // Valid workspace & members queries continue working as expected
    const ownerWsGet = await request(`/workspaces/${workspaceId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Owner xem chi tiết workspace hợp lệ trả về 200", ownerWsGet.status === 200);

    const ownerMembersGet = await request(`/workspaces/${workspaceId}/members`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check(
      "Owner xem danh sách thành viên hợp lệ trả về 200",
      ownerMembersGet.status === 200 && ownerMembersGet.data.members.length === 2,
    );

    // Authorization & self-removal checks
    const nonOwnerDelete = await request(`/workspaces/${workspaceId}/members/${aliceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    check("Member không thể xóa thành viên khác (403)", nonOwnerDelete.status === 403);

    const selfDelete = await request(`/workspaces/${workspaceId}/members/${aliceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Owner không thể tự xóa chính mình (400)", selfDelete.status === 400);

    const nonexistentMemberDelete = await request(
      `/workspaces/${workspaceId}/members/00000000-0000-0000-0000-000000000000`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenA}` },
      },
    );
    check(
      "Xóa thành viên UUID hợp lệ nhưng không tồn tại trả về 404 (P2025)",
      nonexistentMemberDelete.status === 404,
    );

    const validDeleteMember = await request(`/workspaces/${workspaceId}/members/${bobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Owner xóa thành viên tồn tại trả về 204", validDeleteMember.status === 204);

    const removedBobWsGet = await request(`/workspaces/${workspaceId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    check("Thành viên sau khi bị xóa không còn truy cập workspace (403)", removedBobWsGet.status === 403);

    const repeatDeleteMember = await request(`/workspaces/${workspaceId}/members/${bobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    check("Xóa lại thành viên đã bị xóa trả về 404 (P2025)", repeatDeleteMember.status === 404);

    // 17. Kiểm thử Thu hồi Phiên Socket.IO & WebRTC (AUD-05)
    console.log("\n--- Kiểm thử Thu hồi Phiên Socket.IO & WebRTC (AUD-05) ---");
    const reinviteBobRes = await request(`/workspaces/${workspaceId}/members`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { email: memberEmail },
    });
    check("Mời lại Bob vào Workspace A (201)", reinviteBobRes.status === 201);

    const room2Res = await request(`/workspaces/${workspaceId}/rooms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { name: "Phòng Họp Phụ Sprint" },
    });
    check("Owner tạo Room thứ 2 trong Workspace A (201)", room2Res.status === 201);
    const room2Id = room2Res.data.room.id;

    const wsBId = wsCharlie.data.workspace.id;
    const roomBId = roomCharlie.data.room.id;
    const inviteBobWsB = await request(`/workspaces/${wsBId}/members`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenC}` },
      body: { email: memberEmail },
    });
    check("Charlie mời Bob vào Workspace B (201)", inviteBobWsB.status === 201);

    async function connectAndJoin(token, targetRoomId) {
      const sock = ClientSocket(SOCKET_URL, {
        transports: ["websocket"],
        auth: { token },
      });
      await new Promise((resolve, reject) => {
        sock.once("connect", resolve);
        sock.once("connect_error", reject);
      });
      const joined = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout joining room ${targetRoomId}`)), 5000);
        sock.once("room:joined", (data) => {
          clearTimeout(timer);
          resolve(data);
        });
        sock.once("room:error", (err) => {
          clearTimeout(timer);
          reject(new Error(`Unexpected room:error: ${err?.message}`));
        });
        sock.emit("room:join", targetRoomId);
      });
      return { sock, joined };
    }

    const { sock: sAlice1 } = await connectAndJoin(tokenA, roomId);
    const { sock: sAlice2 } = await connectAndJoin(tokenA, room2Id);
    const { sock: sBobTab1 } = await connectAndJoin(tokenB, roomId);
    const { sock: sBobTab2 } = await connectAndJoin(tokenB, roomId);
    const { sock: sBobRoom2 } = await connectAndJoin(tokenB, room2Id);
    const { sock: sCharlieB } = await connectAndJoin(tokenC, roomBId);
    const { sock: sBobWsB } = await connectAndJoin(tokenB, roomBId);

    const aud5Sockets = [sAlice1, sAlice2, sBobTab1, sBobTab2, sBobRoom2, sCharlieB, sBobWsB];
    try {
      await new Promise((r) => setTimeout(r, 80));

      // Scenario 5: Failed/unauthorized deletes must NOT evict any socket
      let spuriousEvictions = 0;
      const countSpurious = () => { spuriousEvictions++; };
      sBobTab1.on("room:access-revoked", countSpurious);
      sBobWsB.on("room:access-revoked", countSpurious);

      const badAuthDel = await request(`/workspaces/${workspaceId}/members/${aliceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      check("Member không thể kích hoạt thu hồi qua DELETE (403)", badAuthDel.status === 403);

      const selfDelAud5 = await request(`/workspaces/${workspaceId}/members/${aliceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      check("Owner tự xóa không kích hoạt thu hồi (400)", selfDelAud5.status === 400);

      const missingDelAud5 = await request(
        `/workspaces/${workspaceId}/members/00000000-0000-0000-0000-000000000000`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tokenA}` },
        },
      );
      check("Xóa UUID không tồn tại không kích hoạt thu hồi (404)", missingDelAud5.status === 404);

      await new Promise((r) => setTimeout(r, 80));
      sBobTab1.off("room:access-revoked", countSpurious);
      sBobWsB.off("room:access-revoked", countSpurious);
      check("Không có eviction giả khi DELETE thất bại", spuriousEvictions === 0);

      // Prepare listeners for Scenarios 1, 2, 3, 4 before authorized DELETE
      const alice1PeerLeftIds = [];
      let alice1LastPresence = null;
      sAlice1.on("room:peer-left", ({ peerId }) => alice1PeerLeftIds.push(peerId));
      sAlice1.on("presence:changed", (p) => { alice1LastPresence = p; });

      const alice2PeerLeftIds = [];
      let alice2LastPresence = null;
      sAlice2.on("room:peer-left", ({ peerId }) => alice2PeerLeftIds.push(peerId));
      sAlice2.on("presence:changed", (p) => { alice2LastPresence = p; });

      let wsBUnexpectedRevoke = false;
      let wsBUnexpectedPeerLeft = false;
      sBobWsB.on("room:access-revoked", () => { wsBUnexpectedRevoke = true; });
      sCharlieB.on("room:peer-left", () => { wsBUnexpectedPeerLeft = true; });

      const waitRevoked = (sock) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timeout waiting room:access-revoked on ${sock.id}`)), 5000);
          sock.once("room:access-revoked", (payload) => {
            clearTimeout(timer);
            resolve(payload);
          });
        });

      const revokedP1 = waitRevoked(sBobTab1);
      const revokedP2 = waitRevoked(sBobTab2);
      const revokedP3 = waitRevoked(sBobRoom2);

      const revokeRes = await request(`/workspaces/${workspaceId}/members/${bobId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      check("Owner xóa Bob khỏi Workspace A trả về 204", revokeRes.status === 204);

      const [rev1, rev2, rev3] = await Promise.all([revokedP1, revokedP2, revokedP3]);
      await new Promise((r) => setTimeout(r, 120));

      // Scenarios 1, 2, 3 assertions
      check(
        "Cả 2 tab của Bob trong Room 1 đều nhận room:access-revoked đúng payload",
        rev1.workspaceId === workspaceId &&
          rev1.roomId === roomId &&
          rev1.reason === "workspace_membership_removed" &&
          rev2.workspaceId === workspaceId &&
          rev2.roomId === roomId &&
          rev2.reason === "workspace_membership_removed",
      );
      check(
        "Tab của Bob ở Room 2 cùng Workspace A cũng nhận room:access-revoked",
        rev3.workspaceId === workspaceId &&
          rev3.roomId === room2Id &&
          rev3.reason === "workspace_membership_removed",
      );
      check(
        "Alice ở Room 1 nhận đủ peer-left cho cả 2 tab và presence còn 1 người",
        alice1PeerLeftIds.includes(sBobTab1.id) &&
          alice1PeerLeftIds.includes(sBobTab2.id) &&
          alice1PeerLeftIds.length === 2 &&
          alice1LastPresence?.peers?.length === 1 &&
          alice1LastPresence.peers[0].peerId === sAlice1.id,
      );
      check(
        "Alice ở Room 2 nhận peer-left của Bob và presence còn 1 người",
        alice2PeerLeftIds.includes(sBobRoom2.id) &&
          alice2PeerLeftIds.length === 1 &&
          alice2LastPresence?.peers?.length === 1 &&
          alice2LastPresence.peers[0].peerId === sAlice2.id,
      );
      check("Socket bị thu hồi vẫn giữ kết nối tổng quát tới server", sBobTab1.connected && sBobTab2.connected);

      // Scenario 4 assertions: Workspace B unaffected
      check(
        "Phiên Workspace B của Bob không bị thu hồi và không rò peer-left",
        !wsBUnexpectedRevoke && !wsBUnexpectedPeerLeft && sBobWsB.connected,
      );
      const wsBOfferDelivered = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Workspace B signaling failed after WS A eviction")), 4000);
        sCharlieB.once("webrtc:offer", (msg) => {
          clearTimeout(timer);
          resolve(msg.peerId === sBobWsB.id);
        });
        sBobWsB.emit("webrtc:offer", { targetId: sCharlieB.id, payload: { type: "offer", sdp: "ws-b-ok" } });
      });
      check("Signalling WebRTC trong Workspace B vẫn hoạt động bình thường", wsBOfferDelivered);

      // Scenario 6 assertions: Revoked sockets cannot relay WebRTC signaling in Room 1
      let alice1ReceivedEvictedOffer = false;
      sAlice1.once("webrtc:offer", () => { alice1ReceivedEvictedOffer = true; });
      const evictedSignalErr = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Expected room:error on evicted signaling")), 4000);
        sBobTab1.once("room:error", (err) => {
          clearTimeout(timer);
          resolve(err?.message ?? "");
        });
        sBobTab1.emit("webrtc:offer", { targetId: sAlice1.id, payload: { type: "offer", sdp: "blocked" } });
      });
      await new Promise((r) => setTimeout(r, 80));
      check(
        "Socket bị thu hồi bị chặn relay WebRTC signalling tới room cũ",
        evictedSignalErr.includes("khác room") && !alice1ReceivedEvictedOffer,
      );

      let bobTab1ReceivedReverseOffer = false;
      sBobTab1.once("webrtc:offer", () => { bobTab1ReceivedReverseOffer = true; });
      const reverseSignalErr = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Expected room:error on signaling to evicted peer")), 4000);
        sAlice1.once("room:error", (err) => {
          clearTimeout(timer);
          resolve(err?.message ?? "");
        });
        sAlice1.emit("webrtc:offer", { targetId: sBobTab1.id, payload: { type: "offer", sdp: "blocked-reverse" } });
      });
      await new Promise((r) => setTimeout(r, 80));
      check(
        "Peer còn lại cũng bị chặn gửi signalling tới peer đã bị thu hồi",
        reverseSignalErr.includes("khác room") && !bobTab1ReceivedReverseOffer,
      );

      // Scenario 1 & 7 assertions: Rejoin rejected on both existing socket and fresh reconnected socket
      const existingSocketRejoinErr = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Expected room:error on rejoin from existing socket")), 4000);
        sBobTab1.once("room:error", (err) => {
          clearTimeout(timer);
          resolve(err?.message ?? "");
        });
        sBobTab1.emit("room:join", roomId);
      });
      check(
        "Socket cũ bị từ chối khi thử room:join lại vào phòng đã bị thu hồi",
        existingSocketRejoinErr.includes("không thuộc workspace"),
      );

      sBobTab1.disconnect();
      const sBobReconnect = ClientSocket(SOCKET_URL, {
        transports: ["websocket"],
        auth: { token: tokenB },
      });
      aud5Sockets.push(sBobReconnect);
      await new Promise((r) => sBobReconnect.on("connect", r));

      const reconnectRejoinErr = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Expected room:error on reconnect rejoin")), 4000);
        sBobReconnect.once("room:error", (err) => {
          clearTimeout(timer);
          resolve(err?.message ?? "");
        });
        sBobReconnect.once("room:joined", () => {
          clearTimeout(timer);
          reject(new Error("Removed member unexpectedly rejoined after reconnect"));
        });
        sBobReconnect.emit("room:join", roomId);
      });
      check(
        "Kết nối mới (reconnect) bị từ chối khi room:join vào Workspace A",
        reconnectRejoinErr.includes("không thuộc workspace"),
      );

      const reconnectWsBJoined = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Expected reconnect join to succeed in Workspace B")), 4000);
        sBobReconnect.once("room:joined", (data) => {
          clearTimeout(timer);
          resolve(data.roomId === roomBId);
        });
        sBobReconnect.emit("room:join", roomBId);
      });
      check("Kết nối mới vẫn vào được Workspace B hợp lệ", reconnectWsBJoined);
    } finally {
      for (const s of aud5Sockets) {
        if (s.connected) s.disconnect();
      }
    }

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
