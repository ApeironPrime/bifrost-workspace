import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import "./App.css";

const API_URL = "http://localhost:3000/api";
const SIGNALING_URL = "http://localhost:3000";
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type User = { id: string; name: string; email: string; createdAt: string };
type Workspace = { id: string; name: string; slug: string; role: "OWNER" | "MEMBER" };
type Room = {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  hostId: string;
  createdAt: string;
  updatedAt: string;
  host?: { id: string; name: string; email: string };
};
type PresencePeer = {
  peerId: string;
  userId: string;
  name: string;
  email: string;
};
type ChatMessage = { id: string; author: string; body: string; mine: boolean };
type SharedNote = { author: string; body: string };
type DataEnvelope =
  | { type: "chat"; author: string; body: string }
  | { type: "note:shared" | "note:update"; author: string; body: string }
  | { type: "note:unshared"; author: string };

function createMemberName() {
  return `Member ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function App() {
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const channelsRef = useRef(new Map<string, RTCDataChannel>());
  const memberNameRef = useRef(createMemberName());
  const activeRoomRef = useRef<Room | null>(null);
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

  // Room states
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomDesc, setNewRoomDesc] = useState("");
  const [roomMessage, setRoomMessage] = useState("");
  const [roomSubmitting, setRoomSubmitting] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomError, setRoomError] = useState("");

  // Realtime & P2P states
  const [status, setStatus] = useState("Chưa vào room");
  const [onlinePeers, setOnlinePeers] = useState<PresencePeer[]>([]);
  const [peersCount, setPeersCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteShared, setNoteShared] = useState(false);
  const [sharedNotes, setSharedNotes] = useState<Record<string, SharedNote>>({});

  const authHeaders = () => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  const addMessage = (message: Omit<ChatMessage, "id">) =>
    setMessages((current) => [...current, { ...message, id: crypto.randomUUID() }]);

  const broadcast = (envelope: DataEnvelope) =>
    channelsRef.current.forEach((channel) => {
      if (channel.readyState === "open") channel.send(JSON.stringify(envelope));
    });

  useEffect(() => () => {
    channelsRef.current.forEach((channel) => channel.close());
    peersRef.current.forEach((peer) => peer.close());
    socketRef.current?.disconnect();
  }, []);

  useEffect(() => {
    if (!token) {
      setAuthReady(true);
      return;
    }
    fetch(`${API_URL}/auth/me`, { headers: authHeaders() })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!ok) throw new Error();
        setUser(body.user as User);
        memberNameRef.current = body.user.name;
      })
      .catch(() => {
        localStorage.removeItem("bifrost_token");
        setToken("");
      })
      .finally(() => setAuthReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      return;
    }
    fetch(`${API_URL}/workspaces`, { headers: authHeaders() })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!ok) throw new Error();
        const wsList = body.workspaces as Workspace[];
        setWorkspaces(wsList);
        if (wsList.length > 0 && !selectedWorkspaceId) {
          setSelectedWorkspaceId(wsList[0].id);
        }
      })
      .catch(() => setWorkspaceMessage("Không tải được workspace."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, token]);

  useEffect(() => {
    if (user) setProfileName(user.name);
  }, [user]);

  // Fetch rooms whenever selectedWorkspaceId changes
  useEffect(() => {
    if (!selectedWorkspaceId || !token) {
      setRooms([]);
      return;
    }

    setRoomsLoading(true);
    setRoomMessage("");
    fetch(`${API_URL}/workspaces/${selectedWorkspaceId}/rooms`, { headers: authHeaders() })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "Không thể tải danh sách room.");
        setRooms(body.rooms as Room[]);
      })
      .catch((err) => {
        setRoomMessage(err instanceof Error ? err.message : "Không tải được danh sách room.");
        setRooms([]);
      })
      .finally(() => setRoomsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId, token]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    try {
      const payload =
        authMode === "register"
          ? { name: authName, email: authEmail, password: authPassword }
          : { email: authEmail, password: authPassword };
      const response = await fetch(
        `${API_URL}/auth/${authMode === "register" ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Không thể xác thực.");
      localStorage.setItem("bifrost_token", body.token);
      setToken(body.token);
      setUser(body.user);
      memberNameRef.current = body.user.name;
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Không thể xác thực.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const logout = () => {
    leaveRoom();
    localStorage.removeItem("bifrost_token");
    setToken("");
    setUser(null);
    setAuthReady(true);
    setWorkspaces([]);
    setSelectedWorkspaceId("");
    setRooms([]);
  };

  const updateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileMessage("");
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ name: profileName }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setUser(body.user as User);
      memberNameRef.current = body.user.name;
      setProfileMessage("Đã cập nhật hồ sơ.");
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Không thể cập nhật hồ sơ.");
    }
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorkspaceMessage("");
    try {
      const response = await fetch(`${API_URL}/workspaces`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: workspaceName }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setWorkspaces((current) => [body.workspace as Workspace, ...current]);
      setSelectedWorkspaceId(body.workspace.id);
      setWorkspaceName("");
      setWorkspaceMessage("Đã tạo workspace.");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Không thể tạo workspace.");
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId) return;
    setWorkspaceMessage("");
    try {
      const response = await fetch(`${API_URL}/workspaces/${selectedWorkspaceId}/members`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: inviteEmail }),
      });
      const body = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(body.message);
      setInviteEmail("");
      setWorkspaceMessage("Đã thêm thành viên vào workspace.");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Không thể mời thành viên.");
    }
  };

  const createRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId) return;
    setRoomMessage("");
    setRoomSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/workspaces/${selectedWorkspaceId}/rooms`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          name: newRoomName,
          description: newRoomDesc ? newRoomDesc : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Không thể tạo room.");
      setRooms((current) => [body.room as Room, ...current]);
      setNewRoomName("");
      setNewRoomDesc("");
      setRoomMessage(`Đã tạo room "${body.room.name}".`);
    } catch (error) {
      setRoomMessage(error instanceof Error ? error.message : "Không thể tạo room.");
    } finally {
      setRoomSubmitting(false);
    }
  };

  const closePeer = (peerId: string) => {
    channelsRef.current.get(peerId)?.close();
    channelsRef.current.delete(peerId);
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    setPeersCount(peersRef.current.size);
    setSharedNotes((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  };

  const useDataChannel = (peerId: string, channel: RTCDataChannel) => {
    channelsRef.current.set(peerId, channel);
    channel.onopen = () => {
      setStatus("Đã kết nối P2P");
      setPeersCount(channelsRef.current.size);
      if (noteSharedRef.current) {
        channel.send(
          JSON.stringify({
            type: "note:shared",
            author: memberNameRef.current,
            body: noteTextRef.current,
          } satisfies DataEnvelope)
        );
      }
    };
    channel.onclose = () => {
      channelsRef.current.delete(peerId);
      setPeersCount(channelsRef.current.size);
    };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as DataEnvelope;
        if (message.type === "chat") {
          addMessage({ author: message.author, body: message.body, mine: false });
        } else if (message.type === "note:shared" || message.type === "note:update") {
          setSharedNotes((current) => ({
            ...current,
            [peerId]: { author: message.author, body: message.body },
          }));
        } else {
          setSharedNotes((current) => {
            const next = { ...current };
            delete next[peerId];
            return next;
          });
        }
      } catch {
        /* Ignore malformed peer data */
      }
    };
  };

  const createPeer = async (peerId: string, shouldOffer: boolean) => {
    const socket = socketRef.current;
    if (!socket || peersRef.current.has(peerId)) return;
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, peer);
    setPeersCount(peersRef.current.size);

    peer.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socket.emit("webrtc:ice-candidate", {
          targetId: peerId,
          payload: candidate.toJSON(),
        });
      }
    };

    peer.ondatachannel = ({ channel }) => useDataChannel(peerId, channel);
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
        closePeer(peerId);
      }
    };

    if (shouldOffer) {
      const channel = peer.createDataChannel("bifrost-realtime");
      useDataChannel(peerId, channel);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("webrtc:offer", { targetId: peerId, payload: offer });
    }
  };

  const joinRoom = (targetRoom: Room) => {
    if (activeRoomRef.current?.id === targetRoom.id && socketRef.current?.connected) {
      return;
    }

    // Clean up previous room state
    leaveRoom();

    activeRoomRef.current = targetRoom;
    setCurrentRoom(targetRoom);
    setRoomError("");
    setStatus("Đang kết nối signalling server…");
    setMessages([]);
    setSharedNotes({});
    setOnlinePeers([]);
    setPeersCount(0);

    const socket = io(SIGNALING_URL, {
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Đang tham gia room…");
      socket.emit("room:join", targetRoom.id);
    });

    socket.on(
      "room:joined",
      ({
        roomName,
        peers,
        presence,
      }: {
        roomId: string;
        roomName: string;
        peerId: string;
        peers: string[];
        presence?: PresencePeer[];
      }) => {
        setStatus(`Đã vào room "${roomName}"`);
        if (presence) {
          setOnlinePeers(presence);
          setPeersCount(presence.filter((p) => p.peerId !== socket.id).length);
        }

        // Clean any existing peers before initializing new ones
        channelsRef.current.forEach((ch) => ch.close());
        peersRef.current.forEach((p) => p.close());
        channelsRef.current.clear();
        peersRef.current.clear();

        peers.forEach((peerId) => void createPeer(peerId, false));
        if (peers.length === 0) {
          setStatus("Đang chờ thành viên khác vào room…");
        }
      }
    );

    socket.on("presence:changed", ({ peers }: { roomId: string; peers: PresencePeer[] }) => {
      setOnlinePeers(peers);
      const otherPeers = peers.filter((p) => p.peerId !== socket.id);
      setPeersCount(otherPeers.length);
    });

    socket.on("room:peer-joined", ({ peerId }: { peerId: string }) => {
      void createPeer(peerId, true);
    });

    socket.on("room:peer-left", ({ peerId }: { peerId: string }) => {
      closePeer(peerId);
    });

    socket.on("room:error", ({ message }: { message: string }) => {
      setRoomError(message);
      setStatus(`Lỗi: ${message}`);
    });

    socket.on("webrtc:offer", async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
      await createPeer(peerId, false);
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      await peer.setRemoteDescription(payload as RTCSessionDescriptionInit);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("webrtc:answer", { targetId: peerId, payload: answer });
    });

    socket.on("webrtc:answer", async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
      await peersRef.current.get(peerId)?.setRemoteDescription(payload as RTCSessionDescriptionInit);
    });

    socket.on("webrtc:ice-candidate", async ({ peerId, payload }: { peerId: string; payload: unknown }) => {
      await peersRef.current.get(peerId)?.addIceCandidate(payload as RTCIceCandidateInit);
    });

    socket.on("connect_error", (error) => {
      setStatus(error.message || "Không kết nối được signalling server.");
    });

    // Socket.IO invokes `connect` after a successful reconnect, so that handler
    // already rejoins the active room. Emitting room:join again here would create
    // duplicate room:joined events and can tear down an established DataChannel.
  };

  const leaveRoom = () => {
    if (activeRoomRef.current && socketRef.current) {
      socketRef.current.emit("room:leave", activeRoomRef.current.id);
    }
    channelsRef.current.forEach((channel) => channel.close());
    peersRef.current.forEach((peer) => peer.close());
    channelsRef.current.clear();
    peersRef.current.clear();
    socketRef.current?.disconnect();
    socketRef.current = null;

    activeRoomRef.current = null;
    setCurrentRoom(null);
    setOnlinePeers([]);
    setPeersCount(0);
    setStatus("Chưa vào room");
    setSharedNotes({});
    setRoomError("");
  };

  const handleWorkspaceChange = (workspaceId: string) => {
    if (currentRoom && currentRoom.workspaceId !== workspaceId) {
      leaveRoom();
    }
    setSelectedWorkspaceId(workspaceId);
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    broadcast({ type: "chat", author: memberNameRef.current, body });
    addMessage({ author: "Bạn", body, mine: true });
    setDraft("");
  };

  const updateNote = (body: string) => {
    noteTextRef.current = body;
    setNoteText(body);
    if (noteSharedRef.current) {
      broadcast({ type: "note:update", author: memberNameRef.current, body });
    }
  };

  const toggleNoteSharing = () => {
    const next = !noteSharedRef.current;
    noteSharedRef.current = next;
    setNoteShared(next);
    broadcast(
      next
        ? { type: "note:shared", author: memberNameRef.current, body: noteTextRef.current }
        : { type: "note:unshared", author: memberNameRef.current }
    );
  };

  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId);

  if (!authReady) {
    return (
      <main className="auth-page">
        <p>Đang kiểm tra phiên đăng nhập…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <span className="brand-mark">⌁</span>
          <p className="eyebrow">BIFROST</p>
          <h1>Không gian cộng tác trực tiếp.</h1>
          <p className="auth-copy">Đăng nhập để vào P2P room và workspace của bạn.</p>
          <form onSubmit={submitAuth}>
            {authMode === "register" && (
              <input
                required
                placeholder="Tên hiển thị"
                value={authName}
                onChange={(event) => setAuthName(event.target.value)}
              />
            )}
            <input
              required
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
            />
            <input
              required
              minLength={8}
              type="password"
              placeholder="Mật khẩu (ít nhất 8 ký tự)"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
            />
            {authError && <p className="form-error">{authError}</p>}
            <button disabled={authSubmitting}>
              {authSubmitting ? "Đang xử lý…" : authMode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setAuthMode(authMode === "login" ? "register" : "login");
              setAuthError("");
            }}
          >
            {authMode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="p2p-page">
      <header className="p2p-header">
        <div>
          <span className="brand-mark">⌁</span>
          <strong>BIFROST</strong>
        </div>
        <div className="account-menu">
          <span>{user.name}</span>
          <button className="text-button" onClick={() => setShowProfile(!showProfile)}>
            Hồ sơ
          </button>
          <button className="text-button" onClick={logout}>
            Đăng xuất
          </button>
        </div>
      </header>

      {showProfile && (
        <section className="profile-bar">
          <form onSubmit={updateProfile}>
            <label htmlFor="profile-name">Tên hiển thị</label>
            <input
              id="profile-name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
            />
            <button>Lưu hồ sơ</button>
          </form>
          {profileMessage && <p>{profileMessage}</p>}
        </section>
      )}

      <section className="workspace-bar">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <form onSubmit={createWorkspace}>
            <input
              placeholder="Tên workspace mới"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
            />
            <button>Tạo workspace</button>
          </form>
        </div>
        <div>
          <select
            value={selectedWorkspaceId}
            onChange={(event) => handleWorkspaceChange(event.target.value)}
          >
            <option value="">Chọn workspace</option>
            {workspaces.map((workspace) => (
              <option value={workspace.id} key={workspace.id}>
                {workspace.name} · {workspace.role}
              </option>
            ))}
          </select>
          {selectedWorkspace?.role === "OWNER" && (
            <form onSubmit={inviteMember} className="invite-form">
              <input
                required
                type="email"
                placeholder="Email thành viên"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
              <button>Mời</button>
            </form>
          )}
        </div>
        {workspaceMessage && <p className="workspace-message">{workspaceMessage}</p>}
      </section>

      {/* Main Room & P2P Section */}
      <section className="p2p-card">
        {currentRoom ? (
          /* ACTIVE ROOM VIEW */
          <div>
            <div className="room-heading">
              <div>
                <p className="eyebrow">P2P ROOM · {selectedWorkspace?.name ?? "WORKSPACE"}</p>
                <h1>{currentRoom.name}</h1>
                {currentRoom.description && (
                  <p className="room-description-text">{currentRoom.description}</p>
                )}
              </div>
              <span className={status.includes("P2P") ? "status online" : "status"}>{status}</span>
            </div>

            {roomError && <div className="room-error-alert">{roomError}</div>}

            <div className="presence-bar">
              <span>
                <strong>{onlinePeers.length}</strong> người online trong room:
              </span>
              <div className="presence-members">
                {onlinePeers.map((peer) => (
                  <span
                    key={peer.peerId}
                    className={`presence-badge ${peer.userId === user.id ? "mine" : ""}`}
                    title={peer.email}
                  >
                    <span className="presence-dot" />
                    {peer.name} {peer.userId === user.id ? "(Bạn)" : ""}
                  </span>
                ))}
              </div>
              <button className="quiet-button" onClick={leaveRoom}>
                Rời room
              </button>
            </div>

            <div className="p2p-grid">
              <section className="chat-panel" aria-label="P2P chat">
                <div className="messages">
                  {messages.length === 0 && (
                    <p className="empty">
                      {peersCount === 0
                        ? "Mở thêm một tab cùng tài khoản khác vào room này để tạo kết nối WebRTC DataChannel."
                        : "Chưa có tin nhắn nào. Bắt đầu chat P2P ngay!"}
                    </p>
                  )}
                  {messages.map((message) => (
                    <article
                      className={message.mine ? "message mine" : "message"}
                      key={message.id}
                    >
                      <small>{message.author}</small>
                      <p>{message.body}</p>
                    </article>
                  ))}
                </div>
                <form className="message-form" onSubmit={sendMessage}>
                  <input
                    placeholder="Gửi tin nhắn trực tiếp qua P2P DataChannel…"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button>Gửi</button>
                </form>
              </section>

              <section className="note-panel">
                <div className="note-heading">
                  <div>
                    <p className="eyebrow">PRIVATE NOTE</p>
                    <h2>Ghi chú của bạn</h2>
                  </div>
                  <button
                    className={noteShared ? "share-button active" : "share-button"}
                    onClick={toggleNoteSharing}
                  >
                    {noteShared ? "Dừng chia sẻ" : "Chia sẻ ghi chú"}
                  </button>
                </div>
                <textarea
                  value={noteText}
                  onChange={(event) => updateNote(event.target.value)}
                  placeholder="Viết ghi chú riêng… Khi bật chia sẻ, nội dung truyền thẳng qua WebRTC DataChannel tới các peer trong room."
                />
                <p className="note-status">
                  {noteShared
                    ? "Đang chia sẻ qua WebRTC DataChannel"
                    : "Ghi chú đang ở chế độ riêng tư"}
                </p>
                <div className="received-notes">
                  <p className="eyebrow">SHARED BY PEERS</p>
                  {Object.entries(sharedNotes).length === 0 ? (
                    <p className="empty small">Chưa có ghi chú được chia sẻ.</p>
                  ) : (
                    Object.entries(sharedNotes).map(([peerId, note]) => (
                      <article className="shared-note" key={peerId}>
                        <small>{note.author}</small>
                        <p>{note.body || "Ghi chú trống"}</p>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : (
          /* ROOM LIST VIEW FOR SELECTED WORKSPACE */
          <div>
            <div className="room-heading">
              <div>
                <p className="eyebrow">DANH SÁCH ROOM · {selectedWorkspace?.name || "BIFROST"}</p>
                <h1>Chọn room để cộng tác trực tiếp.</h1>
              </div>
            </div>

            {roomError && <div className="room-error-alert">{roomError}</div>}

            {!selectedWorkspaceId ? (
              <p className="empty" style={{ margin: "40px auto" }}>
                Vui lòng chọn hoặc tạo workspace ở thanh trên để xem danh sách room.
              </p>
            ) : (
              <div className="rooms-section">
                {selectedWorkspace?.role === "OWNER" && (
                  <section className="create-room-box">
                    <p className="eyebrow">TẠO ROOM MỚI (WORKSPACE OWNER)</p>
                    <form onSubmit={createRoom} className="create-room-form">
                      <input
                        required
                        placeholder="Tên room (bắt buộc, ví dụ: Phòng Kỹ Thuật)"
                        value={newRoomName}
                        onChange={(event) => setNewRoomName(event.target.value)}
                      />
                      <input
                        placeholder="Mô tả room (tùy chọn)"
                        value={newRoomDesc}
                        onChange={(event) => setNewRoomDesc(event.target.value)}
                      />
                      <button disabled={roomSubmitting}>
                        {roomSubmitting ? "Đang tạo…" : "Tạo room"}
                      </button>
                    </form>
                    {roomMessage && <p className="room-message">{roomMessage}</p>}
                  </section>
                )}

                <div>
                  <p className="eyebrow">ROOMS TRONG WORKSPACE</p>
                  {roomsLoading ? (
                    <p className="empty">Đang tải danh sách room…</p>
                  ) : rooms.length === 0 ? (
                    <p className="empty">
                      Workspace này chưa có room nào.{" "}
                      {selectedWorkspace?.role === "OWNER"
                        ? "Hãy tạo room đầu tiên ở biểu mẫu trên."
                        : "Vui lòng chờ Workspace Owner tạo room."}
                    </p>
                  ) : (
                    <div className="rooms-grid">
                      {rooms.map((room) => (
                        <article key={room.id} className="room-card">
                          <div className="room-card-info">
                            <h3>{room.name}</h3>
                            {room.description && (
                              <p className="room-card-desc">{room.description}</p>
                            )}
                            <small className="room-card-meta">
                              Host: {room.host?.name ?? "Host"} ·{" "}
                              {new Date(room.createdAt).toLocaleDateString("vi-VN")}
                            </small>
                          </div>
                          <button
                            className="join-room-btn"
                            onClick={() => joinRoom(room)}
                          >
                            Vào room
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
