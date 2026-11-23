// Development-only UI fixture. No real peers or external network traffic.
import { useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FileShare, type FileShareMessage } from '../src/components/FileShare'
import type { VerifiedPeerIdentity } from '../src/lib/peerIdentity'
import { MeetingTab } from '../src/components/MeetingTab'
import { translate } from '../src/i18n'
import '../src/index.css'
import '../src/styles/index.css'

const QA_SENDER: VerifiedPeerIdentity = { peerId: 'peer-qa', userId: 'qa-user', name: 'QA Peer' }

export function Fixture() {
  const [failed, setFailed] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [meeting, setMeeting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [transport] = useState(() => ({ current: new Map([
    ['peer-qa', { readyState: 'open', bufferedAmount: 0 } as RTCDataChannel],
  ]) }))
  const handler = useRef<((message: FileShareMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void) | null>(null)
  const register = useCallback((next: (message: FileShareMessage, peerId: string, verifiedSender: VerifiedPeerIdentity) => void) => {
    handler.current = next
    return () => { handler.current = null }
  }, [])
  const send = useCallback((envelope?: FileShareMessage) => {
    if (failed) throw new Error('Controlled transport failure')
    if (envelope?.type === 'file:end') {
      const { transferId } = envelope
      queueMicrotask(() => {
        handler.current?.({ type: 'file:ack', transferId }, 'peer-qa', QA_SENDER)
      })
    }
  }, [failed])
  const sendDirect = useCallback((_peerId: string, envelope: FileShareMessage) => {
    send(envelope)
  }, [send])
  const beginIncoming = () => handler.current?.({ type: 'file:start', transferId: 'incoming-qa', name: 'room-qa.txt', size: 12, totalChunks: 1, mimeType: 'text/plain' }, 'peer-qa', QA_SENDER)
  const finishIncoming = () => {
    handler.current?.({ type: 'file:chunk', transferId: 'incoming-qa', index: 0, data: btoa('QA round 5!\n') }, 'peer-qa', QA_SENDER)
    handler.current?.({ type: 'file:end', transferId: 'incoming-qa' }, 'peer-qa', QA_SENDER)
  }
  return <div className="workspace-edition room-focused" style={{ height:'100dvh',display:'flex',flexDirection:'column',background:'var(--bg-page)',color:'var(--text-main)' }}>
    <header style={{ padding:12,display:'flex',flexWrap:'wrap',gap:8,borderBottom:'1px solid var(--border-subtle)' }}>
      <strong style={{ width:'100%' }}>Isolated QA fixture — synthetic transport, not a real P2P test</strong>
      <button type="button" onClick={() => setMeeting(value => !value)}>Switch component</button>
      <button type="button" onClick={() => setFailed(value => !value)}>{failed ? 'Restore transport' : 'Fail transport'}</button>
      <button type="button" onClick={() => setReadOnly(value => !value)}>{readOnly ? 'Allow editing' : 'View only'}</button>
      <button type="button" onClick={beginIncoming}>Begin inbound file</button>
      <button type="button" onClick={finishIncoming}>Complete inbound file</button>
      <span role="status">{feedback}</span>
    </header>
    <main style={{ flex:1,minHeight:0,overflow:'auto' }}>
      {meeting ? <MeetingTab currentUserId="me" currentUserName="Local QA" roomName="QA Room" onlinePeers={Array.from({length:5},(_,i)=>({peerId:`p${i}`,userId:`u${i}`,name:`Remote participant ${i+1} with a long name`,email:`p${i}@example.test`}))} micEnabled={false} camEnabled={false} screenSharing={false} localVideoStream={null} remoteStreams={{}} onToggleMic={() => {}} onToggleCam={() => {}} onToggleScreenShare={() => {}} onLeaveRoom={() => setMeeting(false)} onCopyRoomId={() => {}} copiedRoomId={false} t={(key,params)=>translate('en',key,params)} />
        : <FileShare readOnly={readOnly} roomId="qa-room" peersCount={1} onlinePeerIds={new Set(['peer-qa'])} channelsRef={transport} broadcast={send} sendDirect={sendDirect} registerMessageHandler={register} onSuccessToast={setFeedback} onErrorToast={setFeedback} t={(key,params)=>translate('en',key,params)} />}
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
