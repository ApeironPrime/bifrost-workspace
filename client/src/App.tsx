import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import "./App.css";

const SIGNALING_URL = "http://localhost:3000";
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type ChatMessage = { id: string; author: string; body: string; mine: boolean };
type DataEnvelope =
  | { type: "chat"; author: string; body: string }
  | { type: "note:shared" | "note:update"; author: string; body: string }
  | { type: "note:unshared"; author: string };

type SharedNote = { author: string; body: string };

function createMemberName() {
  return `Member ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function App() {
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const channelsRef = useRef(new Map<string, RTCDataChannel>());
  const memberNameRef = useRef(createMemberName());
  const noteTextRef = useRef("");
  const noteSharedRef = useRef(false);
  const [roomId, setRoomId] = useState("bifrost-demo");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [status, setStatus] = useState("Chưa kết nối");
  const [peersCount, setPeersCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteShared, setNoteShared] = useState(false);
  const [sharedNotes, setSharedNotes] = useState<Record<string, SharedNote>>({});

  useEffect(() => () => {
    channelsRef.current.forEach((channel) => channel.close());
    peersRef.current.forEach((peer) => peer.close());
    socketRef.current?.disconnect();
  }, []);

  const addMessage = (message: Omit<ChatMessage, "id">) => setMessages((current) => [
    ...current, { ...message, id: crypto.randomUUID() },
  ]);

  const broadcast = (envelope: DataEnvelope) => {
    channelsRef.current.forEach((channel) => {
      if (channel.readyState === "open") channel.send(JSON.stringify(envelope));
    });
  };

  const closePeer = (peerId: string) => {
    channelsRef.current.get(peerId)?.close();
    channelsRef.current.delete(peerId);
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    setPeersCount(peersRef.current.size);
  };

  const useDataChannel = (peerId: string, channel: RTCDataChannel) => {
    channelsRef.current.set(peerId, channel);
    channel.onopen = () => {
      setStatus("Đã kết nối P2P");
      setPeersCount(channelsRef.current.size);
      if (noteSharedRef.current) {
        channel.send(JSON.stringify({
          type: "note:shared",
          author: memberNameRef.current,
          body: noteTextRef.current,
        } satisfies DataEnvelope));
      }
    };
    channel.onclose = () => { channelsRef.current.delete(peerId); setPeersCount(channelsRef.current.size); };
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as DataEnvelope;
        if (message.type === "chat") {
          addMessage({ author: message.author, body: message.body, mine: false });
        } else if (message.type === "note:shared" || message.type === "note:update") {
          setSharedNotes((current) => ({ ...current, [peerId]: { author: message.author, body: message.body } }));
        } else if (message.type === "note:unshared") {
          setSharedNotes((current) => {
            const next = { ...current };
            delete next[peerId];
            return next;
          });
        }
      } catch { /* Ignore invalid payloads from peers. */ }
    };
  };

  const createPeer = async (peerId: string, shouldOffer: boolean) => {
    const socket = socketRef.current;
    if (!socket || peersRef.current.has(peerId)) return;
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, peer);
    setPeersCount(peersRef.current.size);
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit("webrtc:ice-candidate", { targetId: peerId, payload: candidate.toJSON() });
    };
    peer.ondatachannel = ({ channel }) => useDataChannel(peerId, channel);
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) closePeer(peerId);
    };
    if (shouldOffer) {
      const channel = peer.createDataChannel("bifrost-realtime");
      useDataChannel(peerId, channel);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("webrtc:offer", { targetId: peerId, payload: offer });
    }
  };

  const joinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedRoom = roomId.trim();
    if (normalizedRoom.length < 3) { setStatus("Mã room cần ít nhất 3 ký tự."); return; }
    const socket = io(SIGNALING_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    setStatus("Đang kết nối signalling server…");
    socket.on("connect", () => { setJoinedRoom(normalizedRoom); setStatus("Đang tìm peer trong room…"); socket.emit("room:join", normalizedRoom); });
    socket.on("room:peers", ({ peers }: { peers: string[] }) => { peers.forEach((peerId) => void createPeer(peerId, false)); if (peers.length === 0) setStatus("Đang chờ thành viên khác vào room…"); });
    socket.on("room:peer-joined", ({ peerId }: { peerId: string }) => void createPeer(peerId, true));
    socket.on("room:peer-left", ({ peerId }: { peerId: string }) => closePeer(peerId));
    socket.on("room:error", ({ message }: { message: string }) => setStatus(message));
    socket.on("webrtc:offer", async ({ peerId, payload }) => {
      await createPeer(peerId, false);
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      await peer.setRemoteDescription(payload as RTCSessionDescriptionInit);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("webrtc:answer", { targetId: peerId, payload: answer });
    });
    socket.on("webrtc:answer", async ({ peerId, payload }) => {
      await peersRef.current.get(peerId)?.setRemoteDescription(payload as RTCSessionDescriptionInit);
    });
    socket.on("webrtc:ice-candidate", async ({ peerId, payload }) => {
      await peersRef.current.get(peerId)?.addIceCandidate(payload as RTCIceCandidateInit);
    });
    socket.on("connect_error", () => setStatus("Không kết nối được signalling server."));
  };

  const leaveRoom = () => {
    if (joinedRoom) socketRef.current?.emit("room:leave", joinedRoom);
    channelsRef.current.forEach((channel) => channel.close()); peersRef.current.forEach((peer) => peer.close());
    channelsRef.current.clear(); peersRef.current.clear(); socketRef.current?.disconnect(); socketRef.current = null;
    setPeersCount(0); setJoinedRoom(""); setStatus("Đã rời room");
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim(); if (!body) return;
    const envelope: DataEnvelope = { type: "chat", author: memberNameRef.current, body };
    broadcast(envelope);
    addMessage({ author: "Bạn", body, mine: true }); setDraft("");
  };

  const updateNote = (body: string) => {
    noteTextRef.current = body;
    setNoteText(body);
    if (noteSharedRef.current) {
      broadcast({ type: "note:update", author: memberNameRef.current, body });
    }
  };

  const toggleNoteSharing = () => {
    const nextShared = !noteSharedRef.current;
    noteSharedRef.current = nextShared;
    setNoteShared(nextShared);
    broadcast(nextShared
      ? { type: "note:shared", author: memberNameRef.current, body: noteTextRef.current }
      : { type: "note:unshared", author: memberNameRef.current });
  };

  return <main className="p2p-page">
    <header className="p2p-header"><div><span className="brand-mark">⌁</span><strong>BIFROST</strong></div><p>WebRTC P2P Lab · {memberNameRef.current}</p></header>
    <section className="p2p-card">
      <div className="room-heading"><div><p className="eyebrow">P2P ROOM</p><h1>Trao đổi trực tiếp giữa các peer.</h1></div><span className={joinedRoom ? "status online" : "status"}>{status}</span></div>
      {!joinedRoom ? <form className="join-form" onSubmit={joinRoom}><label htmlFor="room">Mã room</label><div><input id="room" value={roomId} onChange={(event) => setRoomId(event.target.value)} /><button>Vào room</button></div></form> : <div className="room-meta"><span>Room: <b>{joinedRoom}</b></span><span>{peersCount} peer đang kết nối</span><button className="quiet-button" onClick={leaveRoom}>Rời room</button></div>}
      <div className="p2p-grid">
        <section className="chat-panel" aria-label="P2P chat"><div className="messages">{messages.length === 0 && <p className="empty">Mở thêm một tab, vào cùng room để tạo WebRTC DataChannel.</p>}{messages.map((message) => <article className={message.mine ? "message mine" : "message"} key={message.id}><small>{message.author}</small><p>{message.body}</p></article>)}</div><form className="message-form" onSubmit={sendMessage}><input disabled={!joinedRoom} placeholder="Gửi tin nhắn qua P2P…" value={draft} onChange={(event) => setDraft(event.target.value)} /><button disabled={!joinedRoom}>Gửi</button></form></section>
        <section className="note-panel">
          <div className="note-heading"><div><p className="eyebrow">PRIVATE NOTE</p><h2>Ghi chú của bạn</h2></div><button className={noteShared ? "share-button active" : "share-button"} disabled={!joinedRoom} onClick={toggleNoteSharing}>{noteShared ? "Dừng chia sẻ" : "Chia sẻ ghi chú"}</button></div>
          <textarea disabled={!joinedRoom} value={noteText} onChange={(event) => updateNote(event.target.value)} placeholder="Viết ghi chú riêng… Khi bật chia sẻ, nội dung sẽ đi trực tiếp đến peer." />
          <p className="note-status">{noteShared ? "Đang chia sẻ qua WebRTC DataChannel" : "Ghi chú đang ở chế độ riêng tư"}</p>
          <div className="received-notes"><p className="eyebrow">SHARED BY PEERS</p>{Object.entries(sharedNotes).length === 0 ? <p className="empty small">Chưa có ghi chú được chia sẻ.</p> : Object.entries(sharedNotes).map(([peerId, note]) => <article className="shared-note" key={peerId}><small>{note.author}</small><p>{note.body || "Ghi chú trống"}</p></article>)}</div>
        </section>
      </div>
    </section>
  </main>;
}

export default App;
