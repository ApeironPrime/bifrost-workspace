import { memo, useCallback, useId } from 'react'
import { Globe } from 'lucide-react'
import type { Language } from '../i18n/landing'
import { translateLanding } from '../i18n/landing'
import { LANGUAGE_OPTIONS } from '../lib/controlPrimitives'
import { SelectMenu } from './SelectMenu'
import './LanguageSelect.css'

const LANGUAGE_SELECT_ITEMS = LANGUAGE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
  lang: option.lang,
}))

type Props = {
  value: Language
  onChange: (value: Language) => void
  compact?: boolean
  variant?: 'inline' | 'menu-row'
}

export const LanguageSelect = memo(function LanguageSelect({
  value,
  onChange,
  compact = false,
  variant = 'inline',
}: Props) {
  const selectId = useId()
  const label = translateLanding(value, 'common.languageLabel')
  const activeOption = LANGUAGE_OPTIONS.find((item) => item.value === value) ?? LANGUAGE_OPTIONS[0]

  const handleChange = useCallback(
    (next: string) => {
      if (next === 'vi' || next === 'en' || next === 'ja') {
        onChange(next)
      }
    },
    [onChange],
  )

  const renderValue = useCallback(
    () => (
      <span className="language-trigger-content">
        {variant !== 'menu-row' && <Globe size={14} className="language-trigger-globe" aria-hidden="true" />}
        <span className="language-trigger-full" lang={activeOption.lang}>
          {activeOption.label}
        </span>
        <span className="language-trigger-code" aria-hidden="true">
          {activeOption.code}
        </span>
      </span>
    ),
    [variant, activeOption],
  )

  const menu = (
    <SelectMenu
      id={selectId}
      value={value}
      items={LANGUAGE_SELECT_ITEMS}
      label={label}
      placeholder={activeOption.label}
      emptyText={activeOption.label}
      align={variant === 'menu-row' ? 'end' : 'start'}
      size="sm"
      panelWidth={196}
      className="language-select-menu"
      triggerTitle={translateLanding(value, 'common.languageEntryTemplate', {
        label,
        current: activeOption.label,
      })}
      onChange={handleChange}
      renderValue={renderValue}
    />
  )

  if (variant === 'menu-row') {
    return (
      <div className="language-select language-select-row">
        <label className="language-row-label" htmlFor={selectId}>
          <Globe size={16} aria-hidden="true" />
          <span>{label}</span>
        </label>
        {menu}
      </div>
    )
  }

  return (
    <div className="language-select" data-compact={compact}>
      {menu}
    </div>
  )
})
