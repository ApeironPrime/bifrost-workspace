import { memo, useCallback, useMemo } from 'react'
import { Plus, RotateCcw } from 'lucide-react'
import { createT, type Language } from '../../i18n'
import { type SelectItem } from '../../lib/selectOptions'
import { workspaceInitials } from '../../lib/shellState'
import { SelectMenu } from '../../shared/components/SelectMenu'
import './WorkspaceSwitcher.css'

const renderWorkspaceIcon = (item: SelectItem) => workspaceInitials(item.label)

type Workspace = { id: string; name: string; role: 'OWNER' | 'MEMBER' }
type Props = {
  items: Workspace[]
  value: string
  lang: Language
  compact?: boolean
  loading?: boolean
  error?: boolean
  creating?: boolean
  onChange: (id: string) => void
  onCreate: () => void
  onRetry?: () => void
}

export const WorkspaceSwitcher = memo(function WorkspaceSwitcher({
  items,
  value,
  lang,
  compact = false,
  loading = false,
  error = false,
  creating = false,
  onChange,
  onCreate,
  onRetry,
}: Props) {
  const t = useMemo(() => createT(lang), [lang])
  const hasError = Boolean(error && !loading && items.length === 0)
  const isEmpty = !loading && !hasError && items.length === 0

  const placeholder = loading
    ? t('workspace.loadingPlaceholder')
    : hasError
      ? t('workspace.loadErrorTitle')
      : isEmpty
        ? t('workspace.emptyTitle')
        : t('workspace.selectPlaceholder')

  const fallbackSubtitle = loading
    ? t('workspace.switcherChecking')
    : hasError
      ? t('workspace.switcherRetryHint')
      : isEmpty
        ? t('workspace.switcherCreateFirst')
        : t('workspace.switcherTeamSpace')

  const mappedItems = useMemo(
    () =>
      items.map((item) => ({
        value: item.id,
        label: item.name,
        description:
          item.role === 'OWNER'
            ? t('workspace.ownerBadge')
            : t('workspace.memberBadge'),
      })),
    [items, t],
  )
  const current = mappedItems.find((item) => item.value === value)
  const triggerTitle = current ? `${current.label} — ${current.description}` : `${placeholder} · ${fallbackSubtitle}`
  const badgeText = current
    ? workspaceInitials(current.label)
    : loading
      ? '…'
      : hasError
        ? '!'
        : '+'

  const renderValue = useCallback(
    (item?: SelectItem) => (
      <span className="workspace-picker-current">
        <span className="workspace-picker-avatar" aria-hidden="true">
          {item ? workspaceInitials(item.label) : badgeText}
        </span>
        <span className="workspace-picker-copy">
          <span className="workspace-picker-name">{item?.label || placeholder}</span>
          <span className="workspace-picker-role">{item?.description || fallbackSubtitle}</span>
        </span>
      </span>
    ),
    [badgeText, placeholder, fallbackSubtitle],
  )

  const emptyAction = useMemo(
    () =>
      hasError && onRetry ? (
        <button type="button" onClick={onRetry}>
          <RotateCcw size={14} aria-hidden="true" />
          <span>{t('workspace.switcherTryAgain')}</span>
        </button>
      ) : undefined,
    [hasError, onRetry, t],
  )

  const footer = useMemo(
    () => (
      <button type="button" disabled={creating || loading} onClick={onCreate}>
        <Plus size={16} aria-hidden="true" />
        <span>{t('workspace.switcherCreateNew')}</span>
      </button>
    ),
    [creating, loading, onCreate, t],
  )

  return (
    <SelectMenu
      className={`workspace-picker ${compact ? 'is-compact' : ''} ${hasError ? 'is-error' : ''}`}
      value={value}
      items={mappedItems}
      label={t('workspace.switcherSwitchLabel')}
      placeholder={placeholder}
      triggerTitle={triggerTitle}
      heading={t('workspace.switcherHeading')}
      emptyText={hasError ? t('workspace.switcherEmptyError') : t('workspace.switcherEmptyNoItems')}
      emptyAction={emptyAction}
      searchable={items.length > 5}
      noResultsText={t('workspace.switcherNoResults')}
      searchPlaceholder={t('workspace.switcherSearchPlaceholder')}
      clearLabel={t('members.clearRoomSearchAria')}
      disabled={loading}
      busy={loading}
      onChange={onChange}
      renderIcon={renderWorkspaceIcon}
      renderValue={renderValue}
      footer={footer}
    />
  )
})
