import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Aperture,
  AudioLines,
  Check,
  Copy,
  Info,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  SlidersHorizontal,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Wifi,
  WifiLow,
  WifiZero,
} from 'lucide-react'
import type { I18nKey } from '../../../i18n'
import type { MeshVideoProfile, PeerNetworkSummary } from '../../../lib/mediaQuality'
import { resolveGridCountClass } from '../../../lib/mediaQuality'
import type { SelectItem } from '../../../lib/selectOptions'
import { SelectMenu } from '../../../shared/components/SelectMenu'
import { UserAvatar } from '../../../shared/components/UserAvatar'
import { useStreamVoiceActivity } from '../hooks/useAudioActivity'
import type { MediaDeviceOption } from '../hooks/useRoomMedia'

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
  noiseSuppression?: boolean
  backgroundBlur?: boolean
  mediaError?: string
  localAudioStream?: MediaStream | null
  localVideoStream: MediaStream | null
  remoteStreams: Record<string, MediaStream>
  peerStats?: Record<string, PeerNetworkSummary>
  meshProfile?: MeshVideoProfile
  audioInputs?: MediaDeviceOption[]
  videoInputs?: MediaDeviceOption[]
  audioOutputs?: MediaDeviceOption[]
  selectedMicId?: string
  selectedCamId?: string
  selectedSpeakerId?: string
  speakerSelectionSupported?: boolean
  onToggleMic: () => void
  onToggleCam: () => void
  onToggleScreenShare: () => void
  onToggleNoiseSuppression?: () => void
  onToggleBackgroundBlur?: () => void
  onSelectMicrophone?: (deviceId: string) => void
  onSelectCamera?: (deviceId: string) => void
  onSelectSpeaker?: (deviceId: string) => void
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

function RemotePeerAudio({ stream, sinkId }: { stream: MediaStream; sinkId?: string }) {
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

  useEffect(() => {
    const el = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!el || !sinkId || typeof el.setSinkId !== 'function') return
    void el.setSinkId(sinkId).catch(() => {
      /* Ignore browser sinkId permission errors. */
    })
  }, [sinkId])

  return <audio ref={audioRef} autoPlay playsInline />
}

function PeerNetworkBadge({
  stats,
  t,
}: {
  stats?: PeerNetworkSummary
  t: (key: I18nKey, params?: Record<string, string | number>) => string
}) {
  const level = stats?.level ?? 'unknown'
  const qualityLabel =
    level === 'good'
      ? t('meeting.netGood')
      : level === 'fair'
        ? t('meeting.netFair')
        : level === 'poor'
          ? t('meeting.netPoor')
          : t('meeting.netMeasuring')

  const rttValue = stats?.rttMs ?? 0
  const tooltip =
    stats && stats.rttMs !== null
      ? t('meeting.netTooltip', {
          quality: qualityLabel,
          rtt: stats.rttMs,
          loss: stats.packetLossPct,
        })
      : qualityLabel

  return (
    <span
      className={`tile-net-badge is-${level}`}
      title={tooltip}
      aria-label={tooltip}
    >
      {level === 'poor' ? (
        <WifiZero size={12} aria-hidden="true" />
      ) : level === 'fair' ? (
        <WifiLow size={12} aria-hidden="true" />
      ) : (
        <Wifi size={12} aria-hidden="true" />
      )}
      {stats?.rttMs !== null && stats?.rttMs !== undefined && (
        <span>{t('meeting.netRttBadge', { rtt: rttValue })}</span>
      )}
    </span>
  )
}

function RemoteParticipantTile({
  peer,
  index,
  peerStream,
  selectedSpeakerId,
  stats,
  t,
}: {
  peer: PresencePeer
  index: number
  peerStream: MediaStream | null
  selectedSpeakerId?: string
  stats?: PeerNetworkSummary
  t: (key: I18nKey, params?: Record<string, string | number>) => string
}) {
  const remoteHasVideo = Boolean(
    peerStream && peerStream.getVideoTracks().some(track => track.readyState === 'live'),
  )
  const remoteHasAudio = Boolean(
    peerStream && peerStream.getAudioTracks().some(track => track.readyState === 'live'),
  )
  const { waveContainerRef, isSpeaking } = useStreamVoiceActivity(peerStream, remoteHasAudio)
  const previewBadge = t('meeting.previewBadge')
  const remoteBadge = isSpeaking
    ? t('meeting.speakingNow')
    : remoteHasVideo
      ? t('meeting.liveBadge')
      : remoteHasAudio
        ? t('meeting.audioLiveBadge')
        : previewBadge

  return (
    <div
      className={`video-tile remote-tile ${remoteHasVideo ? 'has-live-video' : ''} ${isSpeaking ? 'is-speaking' : ''}`}
    >
      {remoteHasAudio && peerStream && <RemotePeerAudio stream={peerStream} sinkId={selectedSpeakerId} />}
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
        <div className="tile-head-badges">
          <PeerNetworkBadge stats={stats} t={t} />
          <span className={`tile-device-state ${remoteHasVideo || remoteHasAudio ? 'is-live' : ''} ${isSpeaking ? 'is-speaking' : ''}`}>
            {remoteBadge}
          </span>
        </div>
      </div>
      {!remoteHasVideo && (
        <>
          <div className="tile-portrait-arch">
            <div className="tile-portrait-ring">
              <UserAvatar name={peer.name} size={80} seed={peer.userId} className="participant-avatar" />
            </div>
          </div>
          <div
            ref={waveContainerRef}
            className={`tile-ambient-wave ${remoteHasAudio ? 'is-live' : ''}`}
            aria-hidden="true"
          >
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
}

function formatMeshProfileLabel(
  profile: MeshVideoProfile | undefined,
  t: (key: I18nKey, params?: Record<string, string | number>) => string,
): string | null {
  if (!profile) return null
  const params = {
    kbps: Math.round(profile.maxBitrate / 1000),
    fps: profile.maxFramerate,
  }
  switch (profile.tier) {
    case 'hd':
      return t('meeting.meshTierHd', params)
    case 'sd':
      return t('meeting.meshTierSd', params)
    case 'eco':
      return t('meeting.meshTierEco', params)
    case 'low':
      return t('meeting.meshTierLow', params)
  }
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
  noiseSuppression = true,
  backgroundBlur = false,
  mediaError,
  localAudioStream = null,
  localVideoStream,
  remoteStreams,
  peerStats = {},
  meshProfile,
  audioInputs = [],
  videoInputs = [],
  audioOutputs = [],
  selectedMicId = '',
  selectedCamId = '',
  selectedSpeakerId = '',
  speakerSelectionSupported = false,
  onToggleMic,
  onToggleCam,
  onToggleScreenShare,
  onToggleNoiseSuppression,
  onToggleBackgroundBlur,
  onSelectMicrophone,
  onSelectCamera,
  onSelectSpeaker,
  onLeaveRoom,
  onCopyRoomId,
  copiedRoomId,
  onInvite,
  t,
}: MeetingTabProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsPopoverRef = useRef<HTMLDivElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const settingsHeadingId = useId()

  useEffect(() => {
    if (!settingsOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        settingsPopoverRef.current?.contains(target) ||
        settingsButtonRef.current?.contains(target)
      ) {
        return
      }
      setSettingsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
        settingsButtonRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [settingsOpen])

  const remotePeers = onlinePeers.filter(peer => peer.userId !== currentUserId)
  const localHasVideo = Boolean(localVideoStream && localVideoStream.getVideoTracks().some(track => track.readyState === 'live'))
  const anyRemoteLive = remotePeers.some(peer => {
    const stream = remoteStreams[peer.peerId]
    return Boolean(stream && stream.getTracks().some(track => track.readyState === 'live'))
  })

  const { waveContainerRef: localWaveRef, isSpeaking: localSpeaking } = useStreamVoiceActivity(
    localAudioStream,
    micEnabled,
  )

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
  const localDeviceBadge = localSpeaking && !camEnabled && !screenSharing
    ? t('meeting.speakingNow')
    : screenSharing
      ? t('meeting.screenBadge')
      : camEnabled
        ? t('meeting.liveBadge')
        : micEnabled
          ? t('meeting.audioLiveBadge')
          : previewBadge

  const meshLabel = formatMeshProfileLabel(meshProfile, t)

  const micSelectItems = useMemo<SelectItem[]>(
    () => [
      { value: '', label: t('meeting.defaultDevice') },
      ...audioInputs.map(device => ({ value: device.deviceId, label: device.label })),
    ],
    [audioInputs, t],
  )
  const camSelectItems = useMemo<SelectItem[]>(
    () => [
      { value: '', label: t('meeting.defaultDevice') },
      ...videoInputs.map(device => ({ value: device.deviceId, label: device.label })),
    ],
    [videoInputs, t],
  )
  const speakerSelectItems = useMemo<SelectItem[]>(
    () => [
      { value: '', label: t('meeting.defaultDevice') },
      ...audioOutputs.map(device => ({ value: device.deviceId, label: device.label })),
    ],
    [audioOutputs, t],
  )

  const gridCountClass = resolveGridCountClass(1 + remotePeers.length)

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
        {meshLabel && (remotePeers.length > 0 || camEnabled || screenSharing) ? (
          <span className="chamber-mesh-pill" title={t('meeting.adaptiveMeshHeading')}>
            {meshLabel}
          </span>
        ) : (
          <span className="chamber-masthead-motif" lang="ja" aria-hidden="true">静かな対話の場</span>
        )}
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
        <div className={`meeting-grid ${gridCountClass}`}>
          <div className={`video-tile local-tile ${localHasVideo ? 'has-live-video' : ''} ${localSpeaking ? 'is-speaking' : ''}`}>
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
              <span className={`tile-device-state ${camEnabled || screenSharing || micEnabled ? 'is-live' : ''} ${localSpeaking ? 'is-speaking' : ''}`}>
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
                <div ref={localWaveRef} className={`tile-ambient-wave ${micEnabled ? 'is-live' : ''}`} aria-hidden="true">
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
          {remotePeers.map((peer, index) => (
            <RemoteParticipantTile
              key={peer.peerId}
              peer={peer}
              index={index}
              peerStream={remoteStreams[peer.peerId] ?? null}
              selectedSpeakerId={selectedSpeakerId}
              stats={peerStats[peer.peerId]}
              t={t}
            />
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
      <div className="meeting-controls-anchor">
        {settingsOpen && (
          <div
            ref={settingsPopoverRef}
            className="meeting-settings-popover"
            role="dialog"
            aria-labelledby={settingsHeadingId}
          >
            <div className="meeting-settings-header">
              <h4 id={settingsHeadingId}>{t('meeting.deviceSettings')}</h4>
              {meshLabel && <span className="meeting-settings-mesh-badge">{meshLabel}</span>}
            </div>
            <div className="meeting-settings-fields">
              <div className="meeting-settings-field">
                <label className="meeting-settings-label">{t('meeting.microphoneLabel')}</label>
                <SelectMenu
                  value={selectedMicId}
                  items={micSelectItems}
                  label={t('meeting.microphoneLabel')}
                  placeholder={t('meeting.defaultDevice')}
                  emptyText={t('meeting.noDevicesFound')}
                  size="sm"
                  panelWidth={260}
                  onChange={(value) => onSelectMicrophone?.(value)}
                />
              </div>
              <div className="meeting-settings-field">
                <label className="meeting-settings-label">{t('meeting.cameraLabel')}</label>
                <SelectMenu
                  value={selectedCamId}
                  items={camSelectItems}
                  label={t('meeting.cameraLabel')}
                  placeholder={t('meeting.defaultDevice')}
                  emptyText={t('meeting.noDevicesFound')}
                  size="sm"
                  panelWidth={260}
                  onChange={(value) => onSelectCamera?.(value)}
                />
              </div>
              <div className="meeting-settings-field">
                <label className="meeting-settings-label">{t('meeting.speakerLabel')}</label>
                {speakerSelectionSupported ? (
                  <SelectMenu
                    value={selectedSpeakerId}
                    items={speakerSelectItems}
                    label={t('meeting.speakerLabel')}
                    placeholder={t('meeting.defaultDevice')}
                    emptyText={t('meeting.noDevicesFound')}
                    size="sm"
                    panelWidth={260}
                    onChange={(value) => onSelectSpeaker?.(value)}
                  />
                ) : (
                  <p className="meeting-settings-hint">{t('meeting.speakerUnsupportedHint')}</p>
                )}
              </div>
            </div>
          </div>
        )}
        <div
          className="meeting-controls-bar"
          role="toolbar"
          aria-label={t('meeting.title')}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
            buttons[next]?.focus()
          }}
        >
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
          {onToggleNoiseSuppression && (
            <button
              type="button"
              className={`control-btn ${noiseSuppression ? 'is-active' : ''}`}
              disabled={readOnly}
              aria-pressed={noiseSuppression}
              aria-label={noiseSuppression ? t('meeting.noiseSuppressionOff') : t('meeting.noiseSuppressionOn')}
              title={noiseSuppression ? t('meeting.noiseSuppressionOff') : t('meeting.noiseSuppressionOn')}
              onClick={onToggleNoiseSuppression}
            >
              <AudioLines size={18} aria-hidden="true" />
            </button>
          )}
          {onToggleBackgroundBlur && (
            <button
              type="button"
              className={`control-btn ${backgroundBlur ? 'is-active' : ''}`}
              disabled={readOnly}
              aria-pressed={backgroundBlur}
              aria-label={backgroundBlur ? t('meeting.blurOff') : t('meeting.blurOn')}
              title={backgroundBlur ? t('meeting.blurOff') : t('meeting.blurOn')}
              onClick={onToggleBackgroundBlur}
            >
              <Aperture size={18} aria-hidden="true" />
            </button>
          )}
          <button
            ref={settingsButtonRef}
            type="button"
            className={`control-btn ${settingsOpen ? 'is-active' : ''}`}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-label={t('meeting.deviceSettings')}
            title={t('meeting.deviceSettings')}
            onClick={() => setSettingsOpen(open => !open)}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
          </button>
          <span className="control-divider" aria-hidden="true" />
          <button type="button" className="control-btn end-call" onClick={onLeaveRoom} title={t('meeting.leaveCall')} aria-label={t('meeting.leaveCall')}><PhoneOff size={19} aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  )
})
