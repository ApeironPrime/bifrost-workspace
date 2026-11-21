import { memo } from 'react'
import { MicOff, VideoOff, Monitor, PhoneOff, Info, Users, Copy, Check, UserPlus } from 'lucide-react'
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
  onLeaveRoom: () => void
  onCopyRoomId: () => void
  copiedRoomId: boolean
  onInvite?: () => void
  t: (key: I18nKey, params?: Record<string, string | number>) => string
}

const AMBIENT_WAVE_HEIGHTS = [6, 12, 20, 10, 26, 17, 9, 22, 14, 8, 16, 10, 6] as const

/** Presence is real; media is not connected yet. Never render avatar tiles as live video. */
export const MeetingTab = memo(function MeetingTab({ currentUserId, currentUserName, currentUserAvatar, roomName,
  onlinePeers, onLeaveRoom, onCopyRoomId, copiedRoomId, onInvite, t }: MeetingTabProps) {
  const mediaNotice = t('meeting.mediaNotice')
  const previewBadge = t('meeting.previewBadge')
  const remotePeers = onlinePeers.filter(peer => peer.userId !== currentUserId)
  return (
    <section className={`meeting-container ${remotePeers.length === 0 ? 'meeting-solo' : ''}`} aria-label={t('meeting.title')}>
      <div className="meeting-chamber-masthead">
        <span className="chamber-masthead-coord" aria-hidden="true">
          <span>01 /</span>
          <span>WebRTC · P2P</span>
        </span>
        <p className="meeting-notice-banner" id="meeting-device-notice">
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
          <div className="video-tile local-tile">
            <svg className="tile-bridge-art" viewBox="0 0 300 180" fill="none" aria-hidden="true">
              <path d="M-20 175C70 175 50 20 150 20s80 155 170 155" />
              <path d="M-20 185C70 185 50 30 150 30s80 155 170 155" />
            </svg>
            <div className="tile-atelier-head">
              <span className="tile-index-code" aria-hidden="true">
                <span>01 /</span>
                <span>B / 001</span>
              </span>
              <span className="tile-device-state"><VideoOff size={12} aria-hidden="true" />{previewBadge}</span>
            </div>
            <div className="tile-portrait-arch">
              <div className="tile-portrait-ring">
                <UserAvatar name={currentUserName} src={currentUserAvatar} size={80} seed={currentUserId} className="participant-avatar" />
              </div>
            </div>
            <div className="tile-ambient-wave" aria-hidden="true">
              {AMBIENT_WAVE_HEIGHTS.map((height, index) => (
                <i key={index} style={{ height }} />
              ))}
            </div>
            <div className="participant-tag">
              <span className="participant-tag-identity">
                <MicOff size={13} aria-hidden="true" />
                <span className="tag-name">{currentUserName} ({t('meeting.you')})</span>
              </span>
              <span className="tag-protocol" aria-hidden="true">WebRTC · P2P</span>
            </div>
          </div>
          {remotePeers.map((peer, index) => (
            <div className="video-tile remote-tile" key={peer.peerId}>
              <svg className="tile-bridge-art" viewBox="0 0 300 180" fill="none" aria-hidden="true">
                <path d="M-20 175C70 175 50 20 150 20s80 155 170 155" />
                <path d="M-20 185C70 185 50 30 150 30s80 155 170 155" />
              </svg>
              <div className="tile-atelier-head">
                <span className="tile-index-code" aria-hidden="true">
                  <span>{`${String(index + 2).padStart(2, '0')} /`}</span>
                  <span>WebRTC · P2P</span>
                </span>
                <span className="tile-device-state">{previewBadge}</span>
              </div>
              <div className="tile-portrait-arch">
                <div className="tile-portrait-ring">
                  <UserAvatar name={peer.name} size={80} seed={peer.userId} className="participant-avatar" />
                </div>
              </div>
              <div className="tile-ambient-wave" aria-hidden="true">
                {AMBIENT_WAVE_HEIGHTS.map((height, barIndex) => (
                  <i key={barIndex} style={{ height }} />
                ))}
              </div>
              <div className="participant-tag">
                <span className="participant-tag-identity">
                  <span className="tag-name">{peer.name}</span>
                </span>
                <span className="tag-protocol" aria-hidden="true">WebRTC · P2P</span>
              </div>
            </div>
          ))}
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
        <button type="button" className="control-btn muted" disabled aria-pressed="false" aria-describedby="meeting-device-notice" aria-label={t('meeting.micOn')} title={mediaNotice}><MicOff size={19} aria-hidden="true" /></button>
        <button type="button" className="control-btn muted" disabled aria-pressed="false" aria-describedby="meeting-device-notice" aria-label={t('meeting.camOn')} title={mediaNotice}><VideoOff size={19} aria-hidden="true" /></button>
        <button type="button" className="control-btn" disabled aria-pressed="false" aria-describedby="meeting-device-notice" aria-label={t('meeting.shareScreen')} title={mediaNotice}><Monitor size={19} aria-hidden="true" /></button>
        <span className="control-divider" aria-hidden="true" />
        <button type="button" className="control-btn end-call" onClick={onLeaveRoom} title={t('meeting.leaveCall')} aria-label={t('meeting.leaveCall')}><PhoneOff size={19} aria-hidden="true" /></button>
      </div>
    </section>
  )
})
