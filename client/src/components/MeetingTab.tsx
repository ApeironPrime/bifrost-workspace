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

/** Presence is real; media is not connected yet. Never render avatar tiles as live video. */
export const MeetingTab = memo(function MeetingTab({ currentUserId, currentUserName, currentUserAvatar, roomName,
  onlinePeers, onLeaveRoom, onCopyRoomId, copiedRoomId, onInvite, t }: MeetingTabProps) {
  const mediaNotice = t('meeting.mediaNotice')
  const previewBadge = t('meeting.previewBadge')
  const remotePeers = onlinePeers.filter(peer => peer.userId !== currentUserId)
  return (
    <section className={`meeting-container ${remotePeers.length === 0 ? 'meeting-solo' : ''}`} aria-label={t('meeting.title')}>
      <p className="meeting-notice-banner" id="meeting-device-notice">
        <Info size={16} aria-hidden="true" /><span>{mediaNotice}</span>
      </p>
      <div className={`meeting-grid count-${Math.min(1 + remotePeers.length, 6)}`}>
        <div className="video-tile local-tile">
          <span className="tile-device-state"><VideoOff size={12} aria-hidden="true" />{previewBadge}</span>
          <UserAvatar name={currentUserName} src={currentUserAvatar} size={80} seed={currentUserId} className="participant-avatar" />
          <div className="participant-tag">
            <MicOff size={14} aria-hidden="true" />
            <span className="tag-name">{currentUserName} ({t('meeting.you')})</span>
          </div>
        </div>
        {remotePeers.map(peer => (
          <div className="video-tile remote-tile" key={peer.peerId}>
            <span className="tile-device-state">{previewBadge}</span>
            <UserAvatar name={peer.name} size={80} seed={peer.userId} className="participant-avatar" />
            <div className="participant-tag"><span className="tag-name">{peer.name}</span></div>
          </div>
        ))}
      </div>
      {remotePeers.length === 0 && (
        <div className="meeting-waiting-card">
          <Users size={24} aria-hidden="true" />
          <div><h3>{t('meeting.waitingTitle')}</h3><p>{t('meeting.waitingSubtitle')}</p>
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
        </div>
      )}
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
