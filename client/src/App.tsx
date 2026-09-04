import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import "./App.css";

const API_URL = "http://localhost:3000/api";
const SIGNALING_URL = "http://localhost:3000";
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type User = { id: string; name: string; email: string; createdAt: string };
type Workspace = { id: string; name: string; slug: string; role: "OWNER" | "MEMBER" };
type ChatMessage = { id: string; author: string; body: string; mine: boolean };
type SharedNote = { author: string; body: string };
type DataEnvelope =
  | { type: "chat"; author: string; body: string }
  | { type: "note:shared" | "note:update"; author: string; body: string }
  | { type: "note:unshared"; author: string };

function createMemberName() { return `Member ${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }

function App() {
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const channelsRef = useRef(new Map<string, RTCDataChannel>());
  const memberNameRef = useRef(createMemberName());
  const noteTextRef = useRef("");
  const noteSharedRef = useRef(false);
  const [token, setToken] = useState(() => localStorage.getItem("bifrost_token") ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [roomId, setRoomId] = useState("bifrost-demo");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [status, setStatus] = useState("Chưa kết nối");
  const [peersCount, setPeersCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteShared, setNoteShared] = useState(false);
  const [sharedNotes, setSharedNotes] = useState<Record<string, SharedNote>>({});

  const authHeaders = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const addMessage = (message: Omit<ChatMessage, "id">) => setMessages((current) => [...current, { ...message, id: crypto.randomUUID() }]);
  const broadcast = (envelope: DataEnvelope) => channelsRef.current.forEach((channel) => { if (channel.readyState === "open") channel.send(JSON.stringify(envelope)); });

  useEffect(() => () => {
    channelsRef.current.forEach((channel) => channel.close());
    peersRef.current.forEach((peer) => peer.close());
    socketRef.current?.disconnect();
  }, []);

  useEffect(() => {
    if (!token) { setAuthReady(true); return; }
    fetch(`${API_URL}/auth/me`, { headers: authHeaders() })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!ok) throw new Error();
        setUser(body.user as User); memberNameRef.current = body.user.name;
      })
      .catch(() => { localStorage.removeItem("bifrost_token"); setToken(""); })
      .finally(() => setAuthReady(true));
  // The token is the only input; authHeaders is intentionally recreated per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!user) { setWorkspaces([]); return; }
    fetch(`${API_URL}/workspaces`, { headers: authHeaders() })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (!ok) throw new Error(); setWorkspaces(body.workspaces as Workspace[]); })
      .catch(() => setWorkspaceMessage("Không tải được workspace."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, token]);

  useEffect(() => { if (user) setProfileName(user.name); }, [user]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setAuthError(""); setAuthSubmitting(true);
    try {
      const payload = authMode === "register" ? { name: authName, email: authEmail, password: authPassword } : { email: authEmail, password: authPassword };
      const response = await fetch(`${API_URL}/auth/${authMode === "register" ? "register" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Không thể xác thực.");
      localStorage.setItem("bifrost_token", body.token); setToken(body.token); setUser(body.user); memberNameRef.current = body.user.name;
      setAuthPassword("");
    } catch (error) { setAuthError(error instanceof Error ? error.message : "Không thể xác thực."); }
    finally { setAuthSubmitting(false); }
  };

  const logout = () => {
    leaveRoom(); localStorage.removeItem("bifrost_token"); setToken(""); setUser(null); setAuthReady(true); setWorkspaces([]);
  };

  const updateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setProfileMessage("");
    try {
      const response = await fetch(`${API_URL}/auth/me`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ name: profileName }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message);
      setUser(body.user as User); memberNameRef.current = body.user.name; setProfileMessage("Đã cập nhật hồ sơ.");
    } catch (error) { setProfileMessage(error instanceof Error ? error.message : "Không thể cập nhật hồ sơ."); }
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setWorkspaceMessage("");
    try {
      const response = await fetch(`${API_URL}/workspaces`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ name: workspaceName }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message);
      setWorkspaces((current) => [body.workspace as Workspace, ...current]); setSelectedWorkspaceId(body.workspace.id); setWorkspaceName(""); setWorkspaceMessage("Đã tạo workspace.");
    } catch (error) { setWorkspaceMessage(error instanceof Error ? error.message : "Không thể tạo workspace."); }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedWorkspaceId) return;
    setWorkspaceMessage("");
    try {
      const response = await fetch(`${API_URL}/workspaces/${selectedWorkspaceId}/members`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ email: inviteEmail }) });
      const body = response.status === 204 ? {} : await response.json(); if (!response.ok) throw new Error(body.message);
      setInviteEmail(""); setWorkspaceMessage("Đã thêm thành viên vào workspace.");
    } catch (error) { setWorkspaceMessage(error instanceof Error ? error.message : "Không thể mời thành viên."); }
  };

  const closePeer = (peerId: string) => {
    channelsRef.current.get(peerId)?.close(); channelsRef.current.delete(peerId);
    peersRef.current.get(peerId)?.close(); peersRef.current.delete(peerId); setPeersCount(peersRef.current.size);
    setSharedNotes((current) => { const next = { ...current }; delete next[peerId]; return next; });
  };

  const useDataChannel = (peerId: string, channel: RTCDataChannel) => {
    channelsRef.current.set(peerId, channel);
    channel.onopen = () => {
      setStatus("Đã kết nối P2P"); setPeersCount(channelsRef.current.size);
      if (noteSharedRef.current) channel.send(JSON.stringify({ type: "note:shared", author: memberNameRef.current, body: noteTextRef.current } satisfies DataEnvelope));
    };
    channel.onclose = () => { channelsRef.current.delete(peerId); setPeersCount(channelsRef.current.size); };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as DataEnvelope;
        if (message.type === "chat") addMessage({ author: message.author, body: message.body, mine: false });
        else if (message.type === "note:shared" || message.type === "note:update") setSharedNotes((current) => ({ ...current, [peerId]: { author: message.author, body: message.body } }));
        else { setSharedNotes((current) => { const next = { ...current }; delete next[peerId]; return next; }); }
      } catch { /* Ignore malformed peer data. */ }
    };
  };

  const createPeer = async (peerId: string, shouldOffer: boolean) => {
    const socket = socketRef.current; if (!socket || peersRef.current.has(peerId)) return;
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS }); peersRef.current.set(peerId, peer); setPeersCount(peersRef.current.size);
    peer.onicecandidate = ({ candidate }) => { if (candidate) socket.emit("webrtc:ice-candidate", { targetId: peerId, payload: candidate.toJSON() }); };
    peer.ondatachannel = ({ channel }) => useDataChannel(peerId, channel);
    peer.onconnectionstatechange = () => { if (["failed", "closed", "disconnected"].includes(peer.connectionState)) closePeer(peerId); };
    if (shouldOffer) { const channel = peer.createDataChannel("bifrost-realtime"); useDataChannel(peerId, channel); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); socket.emit("webrtc:offer", { targetId: peerId, payload: offer }); }
  };

  const joinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const normalizedRoom = roomId.trim(); if (normalizedRoom.length < 3) { setStatus("Mã room cần ít nhất 3 ký tự."); return; }
    const socket = io(SIGNALING_URL, { transports: ["websocket"], auth: { token } }); socketRef.current = socket; setStatus("Đang kết nối signalling server…");
    socket.on("connect", () => { setJoinedRoom(normalizedRoom); setStatus("Đang tìm peer trong room…"); socket.emit("room:join", normalizedRoom); });
    socket.on("room:peers", ({ peers }: { peers: string[] }) => { peers.forEach((peerId) => void createPeer(peerId, false)); if (peers.length === 0) setStatus("Đang chờ thành viên khác vào room…"); });
    socket.on("room:peer-joined", ({ peerId }: { peerId: string }) => void createPeer(peerId, true)); socket.on("room:peer-left", ({ peerId }: { peerId: string }) => closePeer(peerId)); socket.on("room:error", ({ message }: { message: string }) => setStatus(message));
    socket.on("webrtc:offer", async ({ peerId, payload }: { peerId: string; payload: unknown }) => { await createPeer(peerId, false); const peer = peersRef.current.get(peerId); if (!peer) return; await peer.setRemoteDescription(payload as RTCSessionDescriptionInit); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); socket.emit("webrtc:answer", { targetId: peerId, payload: answer }); });
    socket.on("webrtc:answer", async ({ peerId, payload }: { peerId: string; payload: unknown }) => { await peersRef.current.get(peerId)?.setRemoteDescription(payload as RTCSessionDescriptionInit); });
    socket.on("webrtc:ice-candidate", async ({ peerId, payload }: { peerId: string; payload: unknown }) => { await peersRef.current.get(peerId)?.addIceCandidate(payload as RTCIceCandidateInit); });
    socket.on("connect_error", (error) => setStatus(error.message || "Không kết nối được signalling server."));
  };

  const leaveRoom = () => {
    if (joinedRoom) socketRef.current?.emit("room:leave", joinedRoom);
    channelsRef.current.forEach((channel) => channel.close()); peersRef.current.forEach((peer) => peer.close()); channelsRef.current.clear(); peersRef.current.clear(); socketRef.current?.disconnect(); socketRef.current = null;
    setPeersCount(0); setJoinedRoom(""); setStatus("Đã rời room"); setSharedNotes({});
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const body = draft.trim(); if (!body) return; broadcast({ type: "chat", author: memberNameRef.current, body }); addMessage({ author: "Bạn", body, mine: true }); setDraft(""); };
  const updateNote = (body: string) => { noteTextRef.current = body; setNoteText(body); if (noteSharedRef.current) broadcast({ type: "note:update", author: memberNameRef.current, body }); };
  const toggleNoteSharing = () => { const next = !noteSharedRef.current; noteSharedRef.current = next; setNoteShared(next); broadcast(next ? { type: "note:shared", author: memberNameRef.current, body: noteTextRef.current } : { type: "note:unshared", author: memberNameRef.current }); };
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);

  if (!authReady) return <main className="auth-page"><p>Đang kiểm tra phiên đăng nhập…</p></main>;
  if (!user) return <main className="auth-page"><section className="auth-card"><span className="brand-mark">⌁</span><p className="eyebrow">BIFROST</p><h1>Không gian cộng tác trực tiếp.</h1><p className="auth-copy">Đăng nhập để vào P2P room và workspace của bạn.</p><form onSubmit={submitAuth}>{authMode === "register" && <input required placeholder="Tên hiển thị" value={authName} onChange={(event) => setAuthName(event.target.value)} />}<input required type="email" placeholder="Email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /><input required minLength={8} type="password" placeholder="Mật khẩu (ít nhất 8 ký tự)" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />{authError && <p className="form-error">{authError}</p>}<button disabled={authSubmitting}>{authSubmitting ? "Đang xử lý…" : authMode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</button></form><button className="text-button" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}>{authMode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}</button></section></main>;

  return <main className="p2p-page">
    <header className="p2p-header"><div><span className="brand-mark">⌁</span><strong>BIFROST</strong></div><div className="account-menu"><span>{user.name}</span><button className="text-button" onClick={() => setShowProfile(!showProfile)}>Hồ sơ</button><button className="text-button" onClick={logout}>Đăng xuất</button></div></header>
    {showProfile && <section className="profile-bar"><form onSubmit={updateProfile}><label htmlFor="profile-name">Tên hiển thị</label><input id="profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} /><button>Lưu hồ sơ</button></form>{profileMessage && <p>{profileMessage}</p>}</section>}
    <section className="workspace-bar"><div><p className="eyebrow">WORKSPACE</p><form onSubmit={createWorkspace}><input placeholder="Tên workspace mới" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /><button>Tạo workspace</button></form></div><div><select value={selectedWorkspaceId} onChange={(event) => setSelectedWorkspaceId(event.target.value)}><option value="">Chọn workspace</option>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name} · {workspace.role}</option>)}</select>{selectedWorkspace?.role === "OWNER" && <form onSubmit={inviteMember} className="invite-form"><input required type="email" placeholder="Email thành viên" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /><button>Mời</button></form>}</div>{workspaceMessage && <p className="workspace-message">{workspaceMessage}</p>}</section>
    <section className="p2p-card"><div className="room-heading"><div><p className="eyebrow">P2P ROOM</p><h1>Trao đổi trực tiếp giữa các peer.</h1></div><span className={joinedRoom ? "status online" : "status"}>{status}</span></div>
      {!joinedRoom ? <form className="join-form" onSubmit={joinRoom}><label htmlFor="room">Mã room</label><div><input id="room" value={roomId} onChange={(event) => setRoomId(event.target.value)} /><button>Vào room</button></div></form> : <div className="room-meta"><span>Room: <b>{joinedRoom}</b></span><span>{peersCount} peer đang kết nối</span><button className="quiet-button" onClick={leaveRoom}>Rời room</button></div>}
      <div className="p2p-grid"><section className="chat-panel" aria-label="P2P chat"><div className="messages">{messages.length === 0 && <p className="empty">Mở thêm một tab, vào cùng room để tạo WebRTC DataChannel.</p>}{messages.map((message) => <article className={message.mine ? "message mine" : "message"} key={message.id}><small>{message.author}</small><p>{message.body}</p></article>)}</div><form className="message-form" onSubmit={sendMessage}><input disabled={!joinedRoom} placeholder="Gửi tin nhắn qua P2P…" value={draft} onChange={(event) => setDraft(event.target.value)} /><button disabled={!joinedRoom}>Gửi</button></form></section>
      <section className="note-panel"><div className="note-heading"><div><p className="eyebrow">PRIVATE NOTE</p><h2>Ghi chú của bạn</h2></div><button className={noteShared ? "share-button active" : "share-button"} disabled={!joinedRoom} onClick={toggleNoteSharing}>{noteShared ? "Dừng chia sẻ" : "Chia sẻ ghi chú"}</button></div><textarea disabled={!joinedRoom} value={noteText} onChange={(event) => updateNote(event.target.value)} placeholder="Viết ghi chú riêng… Khi bật chia sẻ, nội dung sẽ đi trực tiếp đến peer." /><p className="note-status">{noteShared ? "Đang chia sẻ qua WebRTC DataChannel" : "Ghi chú đang ở chế độ riêng tư"}</p><div className="received-notes"><p className="eyebrow">SHARED BY PEERS</p>{Object.entries(sharedNotes).length === 0 ? <p className="empty small">Chưa có ghi chú được chia sẻ.</p> : Object.entries(sharedNotes).map(([peerId, note]) => <article className="shared-note" key={peerId}><small>{note.author}</small><p>{note.body || "Ghi chú trống"}</p></article>)}</div></section></div>
    </section>
  </main>;
}

export default App;
