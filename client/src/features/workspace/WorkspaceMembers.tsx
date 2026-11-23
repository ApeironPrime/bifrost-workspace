import { memo, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { MotionPresence } from '../../shared/components/MotionPresence'
import {
  Check,
  Crown,
  Eye,
  Info,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  UserMinus,
  Users,
  Video,
  X,
} from 'lucide-react'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { RoomLabelsEditor, type RoomLabel } from './RoomLabelsEditor'
import { SearchField } from '../../shared/components/SearchField'
import { SelectMenu } from '../../shared/components/SelectMenu'
import { UserAvatar } from '../../shared/components/UserAvatar'
import { createT, type Language } from '../../i18n'
import { apiUrl, fetchAppApi } from '../../lib/appApi'
import {
  getLabelColorName,
  getPresenceDisplay,
  getRoomRoleItems,
  getRoomRoleLabel,
  type RoomRoleOptionValue,
} from '../../lib/controlPrimitives'
import { orderMembers } from '../../lib/memberOrder'
import { searchKey } from '../../lib/selectOptions'
import { useDelayedLoading } from '../../shared/hooks/useDelayedLoading'
import { useDialogFocus } from '../../shared/hooks/useDialogFocus'
import './WorkspaceMembers.css'

type Room = { id: string; name: string; hostId: string | null }
type Member = {
  userId: string
  role: 'OWNER' | 'MEMBER'
  roomIds?: string[]
  roomAssignments?: {
    roomId: string
    role: 'HOST' | 'MODERATOR' | 'MEMBER' | 'VIEWER'
    labelIds?: string[]
  }[]
  presence?: { status: 'online' | 'offline'; currentRoomId: string | null }
  user: { name: string; email: string; avatarDataUrl?: string | null }
}
type Props = {
  workspaceId: string
  token: string
  userId: string
  currentUser?: { id: string; name: string; avatarDataUrl?: string | null }
  owner: boolean
  lang: Language
  refresh: number
  rooms: Room[]
  roomsLoading?: boolean
  roomLoadError?: string | null
  liveRoomId?: string | null
  liveRoomName?: string | null
  liveRoomUserIds?: ReadonlySet<string>
  compactHeader?: boolean
  onInvite: () => void
  onUpdated: () => void
  onToast?: (message: string, type?: 'info' | 'success' | 'error') => void
}

const assigned = (member: Member) => member.roomIds ?? []

function RoleOptionIcon({ role }: { role: string }) {
  switch (role) {
    case 'HOST':
      return <Crown size={15} />
    case 'MODERATOR':
      return <ShieldCheck size={15} />
    case 'VIEWER':
      return <Eye size={15} />
    case 'REMOVE':
      return <UserMinus size={15} />
    default:
      return <Users size={15} />
  }
}

function MemberEditor({
  member,
  rooms,
  initialRoom,
  mock,
  props,
  labels,
  hostIds,
  onClose,
  onSaved,
}: {
  member: Member
  rooms: Room[]
  initialRoom: string
  mock: boolean
  props: Props
  labels: RoomLabel[]
  hostIds: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const t = useMemo(() => createT(props.lang), [props.lang])
  const [roomId, setRoomId] = useState(rooms.some((room) => room.id === initialRoom) ? initialRoom : '')
  const [roomRole, setRoomRole] = useState<string>(
    member.roomAssignments?.find((item) => item.roomId === initialRoom)?.role ?? 'MEMBER',
  )
  const [selectedLabels, setSelectedLabels] = useState<string[]>(
    member.roomAssignments?.find((item) => item.roomId === initialRoom)?.labelIds ?? [],
  )
  const canSetManagers = props.owner || hostIds.includes(roomId)
  const canRemoveFromWorkspace =
    props.owner && member.userId !== props.userId && member.role !== 'OWNER'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<
    'TRANSFER' | 'REMOVE' | 'REMOVE_WORKSPACE' | null
  >(null)

  const formId = useId()
  const roomSelectId = `${formId}-room`
  const roleSelectId = `${formId}-role`

  const closeEditor = () => {
    if (saving) return
    const original = member.roomAssignments?.find((item) => item.roomId === roomId)
    const dirty =
      mock &&
      !!roomId &&
      (roomRole !== (original?.role ?? '') ||
        JSON.stringify([...selectedLabels].sort()) !==
          JSON.stringify([...(original?.labelIds ?? [])].sort()))
    if (dirty) setDiscard(true)
    else onClose()
  }

  useDialogFocus(!discard && !pendingConfirm, closeEditor, '.member-edit-modal')

  const executeRemoveFromWorkspace = async () => {
    if (saving || !canRemoveFromWorkspace) return
    setSaving(true)
    setError('')
    try {
      const response = await fetchAppApi(
        apiUrl(`/workspaces/${props.workspaceId}/members/${member.userId}`),
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${props.token}` },
        },
      )
      if (!response.ok) {
        const body = response.status === 204 ? {} : await response.json().catch(() => ({}))
        throw new Error((body as { message?: string }).message || t('members.saveError'))
      }
      props.onToast?.(t('members.removedFromWorkspaceToast', { name: member.user.name }), 'success')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('members.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const executeSave = async () => {
    if (saving || !roomId) return
    setSaving(true)
    setError('')
    try {
      const response = await fetchAppApi(
        apiUrl(`/workspaces/${props.workspaceId}/members/${member.userId}`),
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${props.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            roomRole: roomRole === 'REMOVE' ? null : roomRole,
            labelIds: selectedLabels.filter((id) =>
              labels.some((label) => label.roomId === roomId && label.id === id),
            ),
          }),
        },
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      onSaved()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('members.saveError'),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (saving || !roomId) return
    if (roomRole === 'REMOVE') {
      setPendingConfirm('REMOVE')
      return
    }
    if (
      roomRole === 'HOST' &&
      selectedRoomObj?.hostId &&
      selectedRoomObj.hostId !== member.userId
    ) {
      setPendingConfirm('TRANSFER')
      return
    }
    void executeSave()
  }

  const roomItems = rooms.map((room) => {
    const existing = member.roomAssignments?.find((item) => item.roomId === room.id)
    const statusDesc = existing
      ? t('members.currentAccess', {
          role: getRoomRoleLabel(existing.role as RoomRoleOptionValue, props.lang),
        })
      : t('members.notAssignedInRoom')
    return {
      value: room.id,
      label: room.name,
      description: statusDesc,
    }
  })

  const roleItems = getRoomRoleItems({
    lang: props.lang,
    canSetManagers,
    isAssigned: assigned(member).includes(roomId),
  })

  const roomWorkLabels = labels
    .filter((label) => label.roomId === roomId)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))

  const selectedRoomObj = rooms.find((room) => room.id === roomId)

  if (discard) {
    return (
      <ConfirmDialog
        title={t('members.discardTitle')}
        description={t('members.discardBody')}
        cancelLabel={t('common.keepEditing')}
        confirmLabel={t('common.discard')}
        tone="danger"
        onCancel={() => setDiscard(false)}
        onConfirm={onClose}
      />
    )
  }

  if (pendingConfirm === 'REMOVE') {
    return (
      <ConfirmDialog
        title={t('members.removeConfirmTitle')}
        description={t('members.removeConfirmBody', {
          name: member.user.name,
          room: selectedRoomObj?.name || t('members.thisRoomFallback'),
        })}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('members.removeConfirmAction')}
        tone="danger"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          setPendingConfirm(null)
          void executeSave()
        }}
      />
    )
  }

  if (pendingConfirm === 'TRANSFER') {
    return (
      <ConfirmDialog
        title={t('members.transferConfirmTitle')}
        description={t('members.transferConfirmBody', {
          room: selectedRoomObj?.name ?? '',
          name: member.user.name,
        })}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('members.transferConfirmAction')}
        tone="primary"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          setPendingConfirm(null)
          void executeSave()
        }}
      />
    )
  }

  if (pendingConfirm === 'REMOVE_WORKSPACE') {
    return (
      <ConfirmDialog
        title={t('members.removeWorkspaceConfirmTitle')}
        description={t('members.removeWorkspaceConfirmBody', {
          name: member.user.name,
        })}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('members.removeWorkspaceConfirmAction')}
        tone="danger"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          setPendingConfirm(null)
          void executeRemoveFromWorkspace()
        }}
      />
    )
  }

  return (
    <div className="modal-overlay" onClick={closeEditor}>
      <section
        className="modal-card member-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="member-edit-heading">
            <h3 id={`${formId}-title`}>{member.user.name}</h3>
            <small>{member.user.email}</small>
          </div>
          <button
            type="button"
            className="btn-icon"
            aria-label={t('members.closeSettingsAria')}
            title={t('members.closeSettingsAria')}
            disabled={saving}
            onClick={closeEditor}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form id={formId} onSubmit={handleSubmit}>
          {mock && (
            <>
              <div className="member-room-settings">
                <div className="form-field">
                  <label className="form-field-label" htmlFor={roomSelectId}>
                    <span>{t('members.chooseRoomLabel')}</span>
                    <span className="form-required-mark" aria-hidden="true">*</span>
                  </label>
                  <SelectMenu
                    id={roomSelectId}
                    value={roomId}
                    items={roomItems}
                    label={t('members.chooseRoomLabel')}
                    placeholder={t('members.chooseRoomPlaceholder')}
                    emptyText={t('members.noRoomsToAssign')}
                    noResultsText={t('members.noMatchingRooms')}
                    searchPlaceholder={t('members.searchRoomsPlaceholder')}
                    clearLabel={t('members.clearRoomSearchAria')}
                    searchable={rooms.length >= 6}
                    disabled={saving}
                    panelWidth={360}
                    onChange={(id) => {
                      const existingRole =
                        member.roomAssignments?.find((item) => item.roomId === id)?.role ?? 'MEMBER'
                      setRoomId(id)
                      setRoomRole(existingRole)
                      setSelectedLabels(
                        member.roomAssignments?.find((item) => item.roomId === id)?.labelIds ?? [],
                      )
                      setError('')
                    }}
                    renderIcon={() => <Video size={15} />}
                  />
                </div>

                {roomId && (
                  <div className="form-field">
                    <label className="form-field-label" htmlFor={roleSelectId}>
                      {t('members.roomAccessLabel')}
                    </label>
                    <SelectMenu
                      id={roleSelectId}
                      value={roomRole}
                      items={roleItems}
                      label={t('members.roomAccessLabel')}
                      placeholder={getRoomRoleLabel('MEMBER', props.lang)}
                      emptyText=""
                      disabled={saving}
                      panelWidth={360}
                      onChange={(role) => setRoomRole(role)}
                      renderIcon={(item) => <RoleOptionIcon role={item.value} />}
                    />
                  </div>
                )}

                <p className="member-permission-note">
                  {t('members.roomAccessNote')}
                </p>

                {roomRole === 'HOST' &&
                  roomId &&
                  selectedRoomObj?.hostId &&
                  selectedRoomObj.hostId !== member.userId && (
                    <p className="member-transfer-notice" role="status">
                      {t('members.transferHostNote')}
                    </p>
                  )}
              </div>

              {roomId && roomRole !== 'REMOVE' && (
                <section className="member-label-section">
                  <strong>{t('members.workLabelsHeading')}</strong>
                  {roomWorkLabels.length > 0 ? (
                    <div className="label-checkbox-list">
                      {roomWorkLabels.map((label) => {
                        const checked = selectedLabels.includes(label.id)
                        const colorName = getLabelColorName(label.color, props.lang)
                        return (
                          <label
                            key={label.id}
                            className={`label-checkbox-chip ${checked ? 'is-checked' : ''}`}
                            title={`${label.name} (${colorName})`}
                          >
                            <input
                              type="checkbox"
                              disabled={saving}
                              checked={checked}
                              onChange={(event) =>
                                setSelectedLabels((current) =>
                                  event.target.checked
                                    ? [...current, label.id]
                                    : current.filter((id) => id !== label.id),
                                )
                              }
                            />
                            <span className="label-checkbox-box" aria-hidden="true">
                              {checked && <Check size={12} strokeWidth={2.6} />}
                            </span>
                            <span
                              className="label-swatch-dot"
                              style={{ backgroundColor: label.color }}
                              aria-hidden="true"
                            />
                            <span>{label.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <p>{t('members.noLabelsInRoom')}</p>
                  )}
                </section>
              )}
            </>
          )}

          {canRemoveFromWorkspace && (
            <section className="member-workspace-danger-zone">
              <div className="member-danger-copy">
                <strong>{t('members.workspaceDangerHeading')}</strong>
                <p>{t('members.workspaceDangerDesc')}</p>
              </div>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={saving}
                onClick={() => setPendingConfirm('REMOVE_WORKSPACE')}
              >
                <UserMinus size={14} aria-hidden="true" />
                <span>{t('members.removeFromWorkspaceButton')}</span>
              </button>
            </section>
          )}

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>

        <div className="member-edit-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={closeEditor}
            disabled={saving}
          >
            {mock ? t('common.cancel') : t('common.close')}
          </button>
          {mock && (
            <button
              type="submit"
              form={formId}
              className={`btn ${roomRole === 'REMOVE' ? 'btn-danger' : 'btn-primary'}`}
              aria-busy={saving || undefined}
              disabled={saving || !roomId}
            >
              {saving && <span className="btn-spinner" aria-hidden="true" />}
              <span>
                {saving
                  ? t('common.saving')
                  : roomRole === 'REMOVE'
                    ? t('members.removeFromRoomButton')
                    : t('common.save')}
              </span>
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function RoomLabelsDialog({
  rooms,
  initialRoom,
  props,
  labels,
  onChange,
  onClose,
}: {
  rooms: Room[]
  initialRoom: string
  props: Props
  labels: RoomLabel[]
  onChange: (labels: RoomLabel[]) => void
  onClose: () => void
}) {
  const t = useMemo(() => createT(props.lang), [props.lang])
  const [roomId, setRoomId] = useState(initialRoom)
  const [busy, setBusy] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null)
  const roomSelectId = useId()

  const handleRequestClose = () => {
    if (busy) return
    if (isDirty) {
      setPendingRoomId(null)
      setShowDiscardConfirm(true)
      return
    }
    onClose()
  }

  const handleRoomChange = (next: string) => {
    if (next === roomId) return
    if (isDirty) {
      setPendingRoomId(next)
      setShowDiscardConfirm(true)
      return
    }
    setRoomId(next)
  }

  useDialogFocus(!showDiscardConfirm, handleRequestClose, '.room-label-dialog')

  const roomItems = rooms.map((room) => {
    const count = labels.filter((label) => label.roomId === room.id).length
    return {
      value: room.id,
      label: room.name,
      description:
        count > 0
          ? count === 1
            ? t('members.labelCountOne', { count })
            : t('members.labelCountOther', { count })
          : t('members.noLabelsYet'),
    }
  })

  return (
    <div
      className="modal-overlay"
      onClick={handleRequestClose}
    >
      <section
        className="modal-card room-label-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-label-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="room-label-dialog-title">{t('members.roomLabelsTitle')}</h3>
          <button
            type="button"
            className="btn-icon"
            disabled={busy}
            onClick={handleRequestClose}
            aria-label={t('members.closeRoomLabelsAria')}
            title={t('members.closeRoomLabelsAria')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="room-label-dialog-body">
          <div className="form-field label-room-select">
            <label className="form-field-label" htmlFor={roomSelectId}>
              {t('members.roomFieldLabel')}
            </label>
            <SelectMenu
              id={roomSelectId}
              value={roomId}
              items={roomItems}
              label={t('members.roomFieldLabel')}
              placeholder={rooms[0]?.name ?? ''}
              emptyText=""
              noResultsText={t('members.noMatchingRooms')}
              searchPlaceholder={t('members.searchRoomsPlaceholder')}
              clearLabel={t('members.clearRoomSearchAria')}
              searchable={rooms.length >= 6}
              disabled={busy}
              panelWidth={360}
              onChange={handleRoomChange}
              renderIcon={() => <Video size={15} />}
            />
          </div>
          <RoomLabelsEditor
            key={roomId}
            workspaceId={props.workspaceId}
            roomId={roomId}
            token={props.token}
            labels={labels}
            lang={props.lang}
            onChange={onChange}
            onBusy={setBusy}
            onDirtyChange={setIsDirty}
          />
        </div>
        <div className="member-edit-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={handleRequestClose}>
            {t('common.done')}
          </button>
        </div>
      </section>

      {showDiscardConfirm && (
        <ConfirmDialog
          title={t('members.discardLabelTitle')}
          description={t('members.discardLabelBody')}
          cancelLabel={t('common.keepEditing')}
          confirmLabel={t('common.discard')}
          tone="danger"
          onCancel={() => {
            setShowDiscardConfirm(false)
            setPendingRoomId(null)
          }}
          onConfirm={() => {
            setShowDiscardConfirm(false)
            if (pendingRoomId) {
              setRoomId(pendingRoomId)
              setPendingRoomId(null)
              setIsDirty(false)
            } else {
              onClose()
            }
          }}
        />
      )}
    </div>
  )
}

export const WorkspaceMembers = memo(function WorkspaceMembers(props: Props) {
  const t = useMemo(() => createT(props.lang), [props.lang])
  const [members, setMembers] = useState<Member[]>([])
  const [labels, setLabels] = useState<RoomLabel[]>([])
  const [mock, setMock] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState<{ member: Member; roomId: string } | null>(null)
  const [labelRoom, setLabelRoom] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<string>('__all')
  const capabilityNoteId = useId()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastManagedIdRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchAppApi(apiUrl(`/workspaces/${props.workspaceId}/members`), {
      headers: { Authorization: `Bearer ${props.token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.message)
        return body as { source?: string; members: Member[]; roomRoles?: RoomLabel[] }
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setMock(body.source === 'mock' || Array.isArray(body.roomRoles))
          setMembers(body.members)
          setLabels(body.roomRoles ?? [])
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error && err.message ? err.message : '__LOAD_FAILED__')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [props.workspaceId, props.token, props.refresh, retry])

  const reload = () => {
    setLoading(true)
    setError('')
    setRetry((value) => value + 1)
  }

  useEffect(() => {
    if (!loading && lastManagedIdRef.current) {
      const id = lastManagedIdRef.current
      lastManagedIdRef.current = null
      requestAnimationFrame(() => {
        const btn = document.querySelector<HTMLButtonElement>(`[data-member-manage="${id}"]`)
        if (btn && !btn.closest('[inert]')) {
          btn.focus({ preventScroll: true })
        }
      })
    }
  }, [loading])

  const effectiveMembers = useMemo(() => {
    if (!props.currentUser) return members
    return members.map((m) => {
      if (m.userId !== props.currentUser!.id) return m
      return {
        ...m,
        user: {
          ...m.user,
          name: props.currentUser!.name,
          avatarDataUrl:
            props.currentUser!.avatarDataUrl !== undefined
              ? props.currentUser!.avatarDataUrl
              : m.user.avatarDataUrl,
        },
      }
    })
  }, [members, props.currentUser])

  const hostIds =
    effectiveMembers
      .find((member) => member.userId === props.userId)
      ?.roomAssignments?.filter((item) => item.role === 'HOST')
      .map((item) => item.roomId) ?? []
  const managedIds =
    effectiveMembers
      .find((member) => member.userId === props.userId)
      ?.roomAssignments?.filter((item) => item.role === 'HOST' || item.role === 'MODERATOR')
      .map((item) => item.roomId) ?? []

  const normalizedQuery = searchKey(query)
  const matches = (member: Member) =>
    !normalizedQuery ||
    searchKey(`${member.user.name} ${member.user.email}`).includes(normalizedQuery)

  const knownRoomIds = new Set(props.rooms.map((room) => room.id))
  const unmappedAssignedMembers = effectiveMembers.filter(
    (member) =>
      matches(member) &&
      member.role !== 'OWNER' &&
      assigned(member).length > 0 &&
      !assigned(member).some((roomId) => knownRoomIds.has(roomId)),
  )

  const sortOwnersFirst = (list: Member[]) => [
    ...orderMembers(list.filter((member) => member.role === 'OWNER')),
    ...orderMembers(list.filter((member) => member.role !== 'OWNER')),
  ]

  const groups = mock
    ? [
        {
          id: '__owners',
          name: t('members.groupOwner'),
          members: orderMembers(effectiveMembers.filter((member) => matches(member) && member.role === 'OWNER')),
        },
        {
          id: '',
          name: t('members.groupUnassigned'),
          members: orderMembers(
            effectiveMembers.filter(
              (member) => matches(member) && member.role !== 'OWNER' && assigned(member).length === 0,
            ),
          ),
        },
        ...props.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          members: orderMembers(
            effectiveMembers.filter((member) => matches(member) && assigned(member).includes(room.id)),
            room.id,
            labels,
          ),
        })),
        ...(unmappedAssignedMembers.length > 0
          ? [
              {
                id: '__unloaded_rooms',
                name:
                  props.rooms.length === 0
                    ? props.roomLoadError
                      ? t('members.groupAssignedLoadFailed')
                      : props.roomsLoading
                        ? t('members.groupAssignedLoading')
                        : t('members.groupAssignedUnavailable')
                    : t('members.groupOtherRooms'),
                members: orderMembers(unmappedAssignedMembers),
              },
            ]
          : []),
      ]
    : props.liveRoomId && props.liveRoomName
      ? (() => {
          const connected = sortOwnersFirst(
            effectiveMembers.filter(
              (member) => matches(member) && Boolean(props.liveRoomUserIds?.has(member.userId)),
            ),
          )
          const others = sortOwnersFirst(
            effectiveMembers.filter(
              (member) => matches(member) && !props.liveRoomUserIds?.has(member.userId),
            ),
          )
          return [
            {
              id: '__live_room',
              name: t('members.presenceInThisRoom', { roomName: props.liveRoomName }),
              members: connected,
            },
            ...(others.length > 0
              ? [
                  {
                    id: '__other_members',
                    name: t('members.otherWorkspaceMembers'),
                    members: others,
                  },
                ]
              : []),
          ]
        })()
      : [
          {
            id: '__owners',
            name: t('members.groupOwner'),
            members: orderMembers(effectiveMembers.filter((member) => matches(member) && member.role === 'OWNER')),
          },
          {
            id: '__workspace_members',
            name: t('members.sectionTitle'),
            members: orderMembers(effectiveMembers.filter((member) => matches(member) && member.role !== 'OWNER')),
          },
        ]

  const visibleGroups = query.trim()
    ? groups.filter((group) => group.members.length > 0)
    : groups

  const showMembersSkeleton = useDelayedLoading(loading)

  const resolvedError =
    error === '__LOAD_FAILED__'
      ? t('members.loadError')
      : error

  return (
    <section
      className={`workspace-members ${props.compactHeader ? 'is-modal' : ''}`.trim()}
      aria-label={t('members.modalTitle')}
    >
      {!props.compactHeader && (
        <div className="workspace-members-heading">
          <div>
            <span className="workspace-section-index">{t('members.kicker')}</span>
            <h2>
              {t('members.heading')}
              {!loading && !resolvedError && <small>{effectiveMembers.length.toString().padStart(2, '0')}</small>}
            </h2>
          </div>
          {props.owner && (
            <button type="button" className="btn btn-secondary" onClick={props.onInvite}>
              <Plus size={15} aria-hidden="true" />
              <span>{t('members.addMemberButton')}</span>
            </button>
          )}
        </div>
      )}

      <div className="member-directory-tools">
        <SearchField
          inputRef={searchInputRef}
          className="member-search-field"
          value={query}
          onChange={setQuery}
          ariaLabel={t('members.searchLabel')}
          placeholder={t('members.searchPlaceholder')}
          clearLabel={t('members.clearRoomSearchAria')}
        />
        {mock ? (
          !props.compactHeader &&
          (props.owner || hostIds.length > 0) &&
          props.rooms.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setLabelRoom(props.owner ? props.rooms[0].id : hostIds[0])}
            >
              <Settings2 size={14} aria-hidden="true" />
              <span>{t('members.roomLabelsTitle')}</span>
            </button>
          )
        ) : (
          <span className="workspace-capability-tag" aria-describedby={capabilityNoteId}>
            <Info size={13} aria-hidden="true" />
            <span>
              {t('members.workspaceAccessHeading')}
            </span>
          </span>
        )}
      </div>

      {!mock && !loading && !resolvedError && effectiveMembers.length > 0 && (
        <p className="workspace-capability-note" id={capabilityNoteId} role="note">
          <Info size={15} aria-hidden="true" />
          <span>
            {props.liveRoomId
              ? t('members.workspaceAccessRoomNotice')
              : t('members.workspaceAccessGlobalNotice')}
          </span>
        </p>
      )}

      {loading ? (
        <div
          className="workspace-members-pending"
          aria-busy="true"
          data-skeleton-visible={showMembersSkeleton ? 'true' : 'false'}
        >
          {showMembersSkeleton && (
            <>
              <span className="sr-only" role="status">
                {t('members.loading')}
              </span>
              <div className="workspace-member-group is-skeleton" aria-hidden="true">
                <div className="workspace-member-group-skeleton-head">
                  <span className="workspace-skeleton-block skeleton-group-icon" />
                  <span className="workspace-skeleton-block skeleton-group-title" />
                </div>
                <div className="workspace-member-list">
                  {[0, 1].map((row) => (
                    <div key={row} className="workspace-member-row is-skeleton">
                      <span className="workspace-skeleton-block workspace-member-avatar-skeleton" />
                      <div className="workspace-member-identity is-skeleton">
                        <span className="workspace-skeleton-block skeleton-member-name" />
                        <span className="workspace-skeleton-block skeleton-member-email" />
                        <span className="workspace-skeleton-block skeleton-member-status" />
                      </div>
                      <div className="workspace-member-roles">
                        <span className="workspace-skeleton-block skeleton-member-role" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : resolvedError ? (
        <div className="workspace-members-state" role="alert">
          <p>{resolvedError}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
            <RotateCcw size={13} aria-hidden="true" />
            <span>{t('common.retry')}</span>
          </button>
        </div>
      ) : effectiveMembers.length === 0 ? (
        <div className="workspace-members-empty">
          <Users size={32} aria-hidden="true" />
          <h3>{t('members.emptyTitle')}</h3>
          <p>
            {t('members.emptySubtitle')}
          </p>
          {props.owner && (
            <button type="button" className="btn btn-secondary" onClick={props.onInvite}>
              <Plus size={15} aria-hidden="true" />
              <span>{t('members.addMemberButton')}</span>
            </button>
          )}
        </div>
      ) : query.trim() && !effectiveMembers.some(matches) ? (
        <div className="workspace-members-state workspace-members-no-results" role="status">
          <p>
            {t('members.noSearchMatch')}
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setQuery('')
              searchInputRef.current?.focus({ preventScroll: true })
            }}
          >
            {t('members.clearRoomSearchAria')}
          </button>
        </div>
      ) : (
        <>
        {visibleGroups.length > 1 && !query.trim() && (
          <div className="member-group-filter-bar" role="group" aria-label={t('members.sectionTitle')}>
            {(() => {
              const effectiveGroupId = visibleGroups.some((g) => g.id === activeGroupId) ? activeGroupId : '__all'
              return (
                <>
                  <button
                    type="button"
                    className={`member-group-pill ${effectiveGroupId === '__all' ? 'is-active' : ''}`}
                    aria-pressed={effectiveGroupId === '__all'}
                    onClick={() => setActiveGroupId('__all')}
                  >
                    <span>{t('members.filterAllGroups', { count: effectiveMembers.length })}</span>
                  </button>
                  {visibleGroups.map((group) => (
                    <button
                      key={`pill:${group.id}`}
                      type="button"
                      className={`member-group-pill ${effectiveGroupId === group.id ? 'is-active' : ''}`}
                      aria-pressed={effectiveGroupId === group.id}
                      onClick={() => setActiveGroupId(group.id)}
                    >
                      <span>{group.name}</span>
                      <small>{group.members.length}</small>
                    </button>
                  ))}
                </>
              )
            })()}
          </div>
        )}
        {(visibleGroups.some((g) => g.id === activeGroupId) && activeGroupId !== '__all' && !query.trim()
          ? visibleGroups.filter((g) => g.id === activeGroupId)
          : visibleGroups
        )
          .map((group) => {
            const emptyGroupCopy = !mock
              ? group.id === '__live_room'
                ? t('members.groupNoLiveRoomPeers')
                : group.id === '__owners'
                  ? t('members.groupNoOwner')
                  : t('members.groupNoOtherMembers')
              : group.id
                ? t('members.groupEmptyRoom')
                : t('members.groupEveryoneAssigned')

            const activeRoomHostId =
              !mock && props.liveRoomId
                ? props.rooms.find((room) => room.id === props.liveRoomId)?.hostId ?? null
                : null

            return (
              <div className="workspace-member-group" key={group.id}>
                <h3>
                  {group.id === '__owners' ? (
                    <Crown size={15} aria-hidden="true" />
                  ) : group.id === '__live_room' ? (
                    <Video size={15} aria-hidden="true" />
                  ) : group.id.startsWith('__') ? (
                    <Users size={15} aria-hidden="true" />
                  ) : group.id ? (
                    <Video size={15} aria-hidden="true" />
                  ) : (
                    <Users size={15} aria-hidden="true" />
                  )}
                  <span>{group.name}</span>
                  <small>{group.members.length}</small>
                </h3>
                {!group.members.length ? (
                  <p className="member-group-empty">{emptyGroupCopy}</p>
                ) : (
                  <div className="workspace-member-list">
                    {group.members.map((member) => {
                      const currentRoom = props.rooms.find(
                        (room) => room.id === member.presence?.currentRoomId,
                      )
                      const host = mock
                        ? member.roomAssignments?.some(
                            (item) => item.roomId === group.id && item.role === 'HOST',
                          )
                        : activeRoomHostId === member.userId
                      const assignment = mock
                        ? member.roomAssignments?.find((item) => item.roomId === group.id) ??
                          (group.id.startsWith('__') ? member.roomAssignments?.[0] : undefined)
                        : undefined
                      const workLabels = mock
                        ? labels
                            .filter(
                              (label) =>
                                (label.roomId === group.id || group.id.startsWith('__')) &&
                                assignment?.labelIds?.includes(label.id),
                            )
                            .sort((a, b) => a.priority - b.priority)
                        : []
                      const roomPermission =
                        assignment?.role === 'MODERATOR'
                          ? t('members.roleCoordinatorBadge')
                          : assignment?.role === 'VIEWER'
                            ? t('members.roleViewerBadge')
                            : ''
                      const canManage =
                        !props.compactHeader &&
                        ((props.owner && member.userId !== props.userId && member.role !== 'OWNER') ||
                          (mock &&
                            (props.owner ||
                              (group.id !== '__owners' &&
                                (group.id && !group.id.startsWith('__')
                                  ? managedIds.includes(group.id) &&
                                    (hostIds.includes(group.id) ||
                                      !['HOST', 'MODERATOR'].includes(assignment?.role ?? 'MEMBER'))
                                  : managedIds.length > 0)))))
                      const inCurrentRoom = Boolean(
                        props.liveRoomId && props.liveRoomUserIds?.has(member.userId),
                      )
                      const presence = getPresenceDisplay({
                        mock,
                        inCurrentRoom,
                        activeRoomName: props.liveRoomName,
                        status: member.presence?.status,
                        currentRoomName: currentRoom?.name ?? null,
                        lang: props.lang,
                      })
                      const manageLabel = t('members.manageNamedAria', { name: member.user.name })

                      return (
                        <article key={`${group.id}:${member.userId}`} className="workspace-member-row">
                          <UserAvatar
                            name={member.user.name}
                            src={member.user.avatarDataUrl}
                            seed={member.userId}
                            className="workspace-member-avatar"
                            decorative
                          />
                          <div className="workspace-member-identity">
                            <strong title={member.user.name}>
                              {member.user.name}
                              {member.userId === props.userId && (
                                <small>{t('members.youTag')}</small>
                              )}
                            </strong>
                            <span title={member.user.email}>{member.user.email}</span>
                            <div
                              className={`member-presence ${presence.tone}`}
                              title={presence.detail}
                            >
                              <span className="presence-marker" aria-hidden="true" />
                              <span>{presence.label}</span>
                              {presence.detail && presence.scope !== 'unverified' && (
                                <small>· {presence.detail}</small>
                              )}
                            </div>
                          </div>
                          <div className="workspace-member-roles">
                            <span className={`workspace-role ${member.role === 'OWNER' ? 'owner' : ''}`}>
                              {member.role === 'OWNER' ? (
                                <Crown size={12} aria-hidden="true" />
                              ) : host ? (
                                <Crown size={12} aria-hidden="true" />
                              ) : assignment?.role === 'MODERATOR' ? (
                                <ShieldCheck size={12} aria-hidden="true" />
                              ) : assignment?.role === 'VIEWER' ? (
                                <Eye size={12} aria-hidden="true" />
                              ) : (
                                <Users size={12} aria-hidden="true" />
                              )}
                              <span>
                                {member.role === 'OWNER'
                                  ? t('members.roleOwnerBadge')
                                  : mock && host
                                    ? t('members.roleHostBadge')
                                    : roomPermission || t('members.roleMemberBadge')}
                              </span>
                            </span>
                            {mock && member.role === 'OWNER' && host && (
                              <span className="workspace-host-duty">
                                {t('members.roleHostBadge')}
                              </span>
                            )}
                            {!mock && host && (
                              <span className="workspace-host-duty">
                                {t('members.roomCreatorNote')}
                              </span>
                            )}
                            {workLabels.length > 0 && (
                              <div className="member-work-labels">
                                {workLabels.map((label) => (
                                  <span
                                    key={label.id}
                                    title={`${label.name} (${getLabelColorName(label.color, props.lang)})`}
                                  >
                                    <i style={{ background: label.color }} aria-hidden="true" />
                                    {label.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        {canManage && (
                          <button
                            type="button"
                            className="btn-icon member-manage-button"
                            data-member-manage={member.userId}
                            aria-label={manageLabel}
                            title={manageLabel}
                            onClick={() => {
                              lastManagedIdRef.current = member.userId
                              setEditing({
                                member,
                                roomId: group.id.startsWith('__') ? (assignment?.roomId ?? '') : group.id,
                              })
                            }}
                          >
                            <Settings2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
            )
          })}
        </>
      )}

      <MotionPresence present={labelRoom !== null}>
      {labelRoom !== null && (
        <RoomLabelsDialog
          rooms={props.owner ? props.rooms : props.rooms.filter((room) => hostIds.includes(room.id))}
          initialRoom={labelRoom}
          props={props}
          labels={labels}
          onChange={setLabels}
          onClose={() => {
            setLabelRoom(null)
          }}
        />
      )}
      </MotionPresence>
      <MotionPresence present={!!editing}>
      {editing && (
        <MemberEditor
          key={`${editing.member.userId}:${editing.roomId}`}
          member={editing.member}
          rooms={
            props.owner ? props.rooms : props.rooms.filter((room) => managedIds.includes(room.id))
          }
          initialRoom={editing.roomId}
          mock={mock}
          props={props}
          labels={labels}
          hostIds={hostIds}
          onClose={() => {
            lastManagedIdRef.current = null
            setEditing(null)
          }}
          onSaved={() => {
            setEditing(null)
            reload()
            props.onUpdated()
          }}
        />
      )}
      </MotionPresence>
    </section>
  )
})
