import { useState, type CSSProperties } from 'react'
import { SERVER_ORIGIN } from '../../lib/appApi'
import { getAvatarTone } from '../../lib/controlPrimitives'
import { personInitials } from '../../lib/shellState'
import './UserAvatar.css'

type Props = {
  name: string
  src?: string | null
  seed?: string
  color?: string
  size?: number
  className?: string
  title?: string
  ariaLabel?: string
  decorative?: boolean
}

export function UserAvatar({
  name,
  src,
  seed,
  color,
  size,
  className = '',
  title,
  ariaLabel,
  decorative = false,
}: Props) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const resolvedSrc =
    src && src.startsWith('/api/') && SERVER_ORIGIN ? `${SERVER_ORIGIN}${src}` : src
  const showImage = Boolean(resolvedSrc && brokenSrc !== resolvedSrc)
  const monogram = personInitials(name)
  const bg = showImage ? '#e7e5d9' : color ?? getAvatarTone(seed ?? name)

  const style: CSSProperties = {
    backgroundColor: bg,
    ...(size
      ? {
          width: `${size}px`,
          height: `${size}px`,
          fontSize: `${Math.max(10, Math.round(size * 0.39))}px`,
        }
      : undefined),
  }

  return (
    <span
      className={`user-avatar ${showImage ? 'has-image' : 'is-monogram'} ${className}`.trim()}
      style={style}
      title={title}
      role={!decorative && ariaLabel ? 'img' : undefined}
      aria-label={!decorative ? ariaLabel : undefined}
      aria-hidden={decorative || undefined}
    >
      {showImage ? (
        <img
          src={resolvedSrc!}
          alt=""
          onError={() => setBrokenSrc(resolvedSrc ?? null)}
        />
      ) : (
        <span className="user-avatar-initials" aria-hidden="true">
          {monogram}
        </span>
      )}
    </span>
  )
}
