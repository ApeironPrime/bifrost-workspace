import { memo, useEffect, useRef } from 'react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Info,
  Users,
  Copy,
  Check,
  UserPlus,
} from 'lucide-react'
import type { I18nKey } from '../i18n'
import { UserAvatar } from './UserAvatar'

type PresencePeer = { peerId: string; userId: string; name: string; email: string }

interface MeetingTabProps {
  readOnly?: boolean
  currentUserId: string
  currentUserName: string
  currentUserAvatar?: string | null
  roomName: string
  onlinePeers: PresencePeer[]
  micEnabled: boolean
  camEnabled: boolean
  screenSharing: boolean
  mediaError?: string
  localVideoStream: MediaStream | null
  remoteStreams: Record<string, MediaStream>
  onToggleMic: () => void
  onToggleCam: () => void
  onToggleScreenShare: () => void
  onLeaveRoom: () => void
  onCopyRoomId: () => void
  copiedRoomId: boolean
  onInvite?: () => void
  t: (key: I18nKey, params?: Record<string, string | number>) => string
}

const AMBIENT_WAVE_HEIGHTS = [6, 12, 20, 10, 26, 17, 9, 22, 14, 8, 16, 10, 6] as const

function MediaStreamVideo({
  stream,
  muted,
  mirrored,
  screenShare,
}: {
  stream: MediaStream
  muted?: boolean
  mirrored?: boolean
  screenShare?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {
      /* Autoplay may wait for user interaction on unmuted elements. */
    })
    return () => {
      el.srcObject = null
    }
  }, [stream])

  return (
    <video
      ref={videoRef}
      className={`tile-video-element ${mirrored ? 'is-mirrored' : ''} ${screenShare ? 'is-screen' : ''}`}
      autoPlay
      playsInline
      muted={muted}
    />
  )
}

function RemotePeerAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {
      /* Autoplay policy fallback handled by user interaction in room. */
    })
    return () => {
      el.srcObject = null
    }
  }, [stream])

  return <audio ref={audioRef} autoPlay playsInline />
}

export const MeetingTab = memo(function MeetingTab({
  readOnly = false,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  roomName,
  onlinePeers,
  micEnabled,
  camEnabled,
  screenSharing,
  mediaError,
  localVideoStream,
  remoteStreams,
  onToggleMic,
  onToggleCam,
  onToggleScreenShare,
  onLeaveRoom,
  onCopyRoomId,
  copiedRoomId,
  onInvite,
  t,
}: MeetingTabProps) {
  const remotePeers = onlinePeers.filter(peer => peer.userId !== currentUserId)
  const localHasVideo = Boolean(localVideoStream && localVideoStream.getVideoTracks().some(track => track.readyState === 'live'))
  const anyRemoteLive = remotePeers.some(peer => {
    const stream = remoteStreams[peer.peerId]
    return Boolean(stream && stream.getTracks().some(track => track.readyState === 'live'))
  })

  const mediaNotice = mediaError
    ? mediaError
    : readOnly
      ? t('meeting.viewerMediaNotice')
      : micEnabled || camEnabled || screenSharing || anyRemoteLive
        ? t('meeting.mediaLiveNotice')
        : remotePeers.length > 0
          ? t('meeting.mediaReadyNotice')
          : t('meeting.mediaNotice')

  const previewBadge = t('meeting.previewBadge')
  const localDeviceBadge = screenSharing
    ? t('meeting.screenBadge')
    : camEnabled
      ? t('meeting.liveBadge')
      : micEnabled
        ? t('meeting.audioLiveBadge')
        : previewBadge

  return (
    <section className={`meeting-container ${remotePeers.length === 0 ? 'meeting-solo' : ''}`} aria-label={t('meeting.title')}>
      <div className="meeting-chamber-masthead">
        <span className="chamber-masthead-coord" aria-hidden="true">
          <span>01 /</span>
          <span>WebRTC · P2P</span>
        </span>
        <p className={`meeting-notice-banner ${mediaError ? 'is-error' : ''}`} id="meeting-device-notice">
          <Info size={14} aria-hidden="true" /><span>{mediaNotice}</span>
        </p>
        <span className="chamber-masthead-motif" lang="ja" aria-hidden="true">静かな対話の場</span>
      </div>
      <div className="meeting-stage-layout">
        <svg className="meeting-stage-thread" viewBox="0 0 800 540" fill="none" aria-hidden="true">
          <path d="M90 150 C90 40 690 25 695 230 S710 470 490 475 S65 520 105 380" />
          <path className="meeting-thread-signal" d="M90 150 C90 40 690 25 695 230 S710 470 490 475 S65 520 105 380" />
        </svg>
        <div className="meeting-chamber-coordinate" aria-hidden="true">
          <span>B / 001</span>
          <span lang="ja">折り目の向こう</span>
        </div>
        <div className={`meeting-grid count-${Math.min(1 + remotePeers.length, 6)}`}>
          <div className={`video-tile local-tile ${localHasVideo ? 'has-live-video' : ''}`}>
            {localHasVideo && localVideoStream ? (
              <MediaStreamVideo
                stream={localVideoStream}
                muted
                mirrored={!screenSharing}
                screenShare={screenSharing}
              />
            ) : (
              <svg className="tile-bridge-art" viewBox="0 0 300 180" fill="none" aria-hidden="true">
                <path d="M-20 175C70 175 50 20 150 20s80 155 170 155" />
                <path d="M-20 185C70 185 50 30 150 30s80 155 170 155" />
              </svg>
            )}
            <div className="tile-atelier-head">
              <span className="tile-index-code" aria-hidden="true">
                <span>01 /</span>
                <span>B / 001</span>
              </span>
              <span className={`tile-device-state ${camEnabled || screenSharing || micEnabled ? 'is-live' : ''}`}>
                {camEnabled || screenSharing ? (
                  <Video size={12} aria-hidden="true" />
                ) : micEnabled ? (
                  <Mic size={12} aria-hidden="true" />
                ) : (
                  <VideoOff size={12} aria-hidden="true" />
                )}
                {localDeviceBadge}
              </span>
            </div>
            {!localHasVideo && (
              <>
                <div className="tile-portrait-arch">
                  <div className="tile-portrait-ring">
                    <UserAvatar name={currentUserName} src={currentUserAvatar} size={80} seed={currentUserId} className="participant-avatar" />
                  </div>
                </div>
                <div className={`tile-ambient-wave ${micEnabled ? 'is-live' : ''}`} aria-hidden="true">
                  {AMBIENT_WAVE_HEIGHTS.map((height, index) => (
                    <i key={index} style={{ height }} />
                  ))}
                </div>
              </>
            )}
            <div className="participant-tag">
              <span className="participant-tag-identity">
                {micEnabled ? <Mic size={13} aria-hidden="true" /> : <MicOff size={13} aria-hidden="true" />}
                <span className="tag-name">{currentUserName} ({t('meeting.you')})</span>
              </span>
              <span className="tag-protocol" aria-hidden="true">WebRTC · P2P</span>
            </div>
          </div>
          {remotePeers.map((peer, index) => {
            const peerStream = remoteStreams[peer.peerId] ?? null
            const remoteHasVideo = Boolean(
              peerStream && peerStream.getVideoTracks().some(track => track.readyState === 'live'),
            )
            const remoteHasAudio = Boolean(
              peerStream && peerStream.getAudioTracks().some(track => track.readyState === 'live'),
            )
            const remoteBadge = remoteHasVideo
              ? t('meeting.liveBadge')
              : remoteHasAudio
                ? t('meeting.audioLiveBadge')
                : previewBadge

            return (
              <div className={`video-tile remote-tile ${remoteHasVideo ? 'has-live-video' : ''}`} key={peer.peerId}>
                {remoteHasAudio && peerStream && <RemotePeerAudio stream={peerStream} />}
                {remoteHasVideo && peerStream ? (
                  <MediaStreamVideo stream={peerStream} />
                ) : (
                  <svg className="tile-bridge-art" viewBox="0 0 300 180" fill="none" aria-hidden="true">
                    <path d="M-20 175C70 175 50 20 150 20s80 155 170 155" />
                    <path d="M-20 185C70 185 50 30 150 30s80 155 170 155" />
                  </svg>
                )}
                <div className="tile-atelier-head">
                  <span className="tile-index-code" aria-hidden="true">
                    <span>{`${String(index + 2).padStart(2, '0')} /`}</span>
                    <span>WebRTC · P2P</span>
                  </span>
                  <span className={`tile-device-state ${remoteHasVideo || remoteHasAudio ? 'is-live' : ''}`}>
                    {remoteBadge}
                  </span>
                </div>
                {!remoteHasVideo && (
                  <>
                    <div className="tile-portrait-arch">
                      <div className="tile-portrait-ring">
                        <UserAvatar name={peer.name} size={80} seed={peer.userId} className="participant-avatar" />
                      </div>
                    </div>
                    <div className={`tile-ambient-wave ${remoteHasAudio ? 'is-live' : ''}`} aria-hidden="true">
                      {AMBIENT_WAVE_HEIGHTS.map((height, barIndex) => (
                        <i key={barIndex} style={{ height }} />
                      ))}
                    </div>
                  </>
                )}
                <div className="participant-tag">
                  <span className="participant-tag-identity">
                    {remoteHasAudio ? <Mic size={13} aria-hidden="true" /> : <MicOff size={13} aria-hidden="true" />}
                    <span className="tag-name">{peer.name}</span>
                  </span>
                  <span className="tag-protocol" aria-hidden="true">WebRTC · P2P</span>
                </div>
              </div>
            )
          })}
        </div>
        {remotePeers.length === 0 && (
          <div className="meeting-waiting-card">
            <svg className="waiting-card-bridge" viewBox="0 0 300 180" fill="none" aria-hidden="true">
              <path d="M-20 175C70 175 50 20 150 20s80 155 170 155" />
              <path d="M-20 185C70 185 50 30 150 30s80 155 170 155" />
            </svg>
            <div className="waiting-card-head">
              <span className="waiting-card-head-code">
                <span>02 /</span>
                <span>WebRTC · P2P</span>
              </span>
              <Users size={16} aria-hidden="true" />
            </div>
            <div className="waiting-card-body">
              <small className="waiting-card-kicker" lang="ja" aria-hidden="true">対話の準備 · B / 001</small>
              <h3>{t('meeting.waitingTitle')}</h3>
              <p>{t('meeting.waitingSubtitle')}</p>
              <div className="meeting-waiting-actions">
                {onInvite && <button type="button" className="btn btn-primary" onClick={onInvite}>
                  <UserPlus size={16} aria-hidden="true" />{t('meeting.inviteTeammates')}
                </button>}
                <button type="button" className="btn btn-secondary" title={roomName} onClick={onCopyRoomId}>
                  {copiedRoomId ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copiedRoomId ? t('rightPanel.copied') : t('rightPanel.copyRoomId')}
                </button>
              </div>
            </div>
            <div className="waiting-card-colophon" aria-hidden="true">
              <span>WebRTC · P2P</span>
              <span className="waiting-card-colophon-coord">
                <span>B / 001</span>
                <span>↗</span>
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="meeting-controls-bar" role="toolbar" aria-label={t('meeting.title')}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }}>
        <button
          type="button"
          className={`control-btn ${micEnabled ? 'is-active' : 'muted'}`}
          disabled={readOnly}
          aria-pressed={micEnabled}
          aria-describedby="meeting-device-notice"
          aria-label={micEnabled ? t('meeting.micOff') : t('meeting.micOn')}
          title={micEnabled ? t('meeting.micOff') : t('meeting.micOn')}
          onClick={onToggleMic}
        >
          {micEnabled ? <Mic size={19} aria-hidden="true" /> : <MicOff size={19} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={`control-btn ${camEnabled ? 'is-active' : 'muted'}`}
          disabled={readOnly}
          aria-pressed={camEnabled}
          aria-describedby="meeting-device-notice"
          aria-label={camEnabled ? t('meeting.camOff') : t('meeting.camOn')}
          title={camEnabled ? t('meeting.camOff') : t('meeting.camOn')}
          onClick={onToggleCam}
        >
          {camEnabled ? <Video size={19} aria-hidden="true" /> : <VideoOff size={19} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={`control-btn ${screenSharing ? 'is-active' : ''}`}
          disabled={readOnly}
          aria-pressed={screenSharing}
          aria-describedby="meeting-device-notice"
          aria-label={screenSharing ? t('meeting.stopShareScreen') : t('meeting.shareScreen')}
          title={screenSharing ? t('meeting.stopShareScreen') : t('meeting.shareScreen')}
          onClick={onToggleScreenShare}
        >
          {screenSharing ? <MonitorOff size={19} aria-hidden="true" /> : <Monitor size={19} aria-hidden="true" />}
        </button>
        <span className="control-divider" aria-hidden="true" />
        <button type="button" className="control-btn end-call" onClick={onLeaveRoom} title={t('meeting.leaveCall')} aria-label={t('meeting.leaveCall')}><PhoneOff size={19} aria-hidden="true" /></button>
      </div>
    </section>
  )
})
