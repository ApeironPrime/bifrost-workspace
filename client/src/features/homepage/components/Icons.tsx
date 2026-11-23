import React from 'react'

type IconProps = {
  size?: number
  color?: string
  strokeWidth?: number
  className?: string
  style?: React.CSSProperties
}

function Icon({
  d,
  size = 16,
  color = 'currentColor',
  strokeWidth = 1.4,
  className,
  style,
  viewBox = '0 0 16 16',
  fill = 'none',
  extraPaths,
}: IconProps & {
  d: string
  viewBox?: string
  fill?: string
  extraPaths?: string[]
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      <path d={d} />
      {extraPaths?.map((ep, i) => <path key={i} d={ep} />)}
    </svg>
  )
}

export const IcoHome = (p: IconProps) =>
  <Icon d="M2.5 6.5L8 2L13.5 6.5V14H10V10H6V14H2.5V6.5Z" {...p} />

export const IcoHash = (p: IconProps) =>
  <Icon d="M3 6H13M3 10H13M6 2L5 14M11 2L10 14" {...p} />

export const IcoUsers = (p: IconProps) =>
  <Icon d="M6 7a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2 15c0-2.761 1.791-5 4-5m4-5.5a2 2 0 100-4 2 2 0 000 4zm4 9c0-2.209-1.343-4-3-4" {...p} />

export const IcoSettings = (p: IconProps) =>
  <Icon
    d="M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
    extraPaths={['M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1']}
    {...p}
  />

export const IcoPlus = (p: IconProps) =>
  <Icon d="M8 3v10M3 8h10" {...p} />

export const IcoSearch = (p: IconProps) =>
  <Icon d="M7 12A5 5 0 107 2a5 5 0 000 10zM14 14l-2.9-2.9" {...p} />

export const IcoX = (p: IconProps) =>
  <Icon d="M12 4L4 12M4 4l8 8" {...p} />

export const IcoCheck = (p: IconProps) =>
  <Icon d="M2.5 8L6 11.5L13.5 4.5" {...p} />

export const IcoChevDown = (p: IconProps) =>
  <Icon d="M4 6l4 4 4-4" {...p} />

export const IcoChevRight = (p: IconProps) =>
  <Icon d="M6 4l4 4-4 4" {...p} />

export const IcoChevLeft = (p: IconProps) =>
  <Icon d="M10 4L6 8l4 4" {...p} />

export const IcoPanelRight = (p: IconProps) =>
  <Icon d="M3 3h10a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1zM10 3v10" {...p} />

export const IcoSend = (p: IconProps) =>
  <Icon d="M14 2L8.5 8M14 2L9.5 14L8.5 8L2 5.5L14 2Z" {...p} />

export const IcoPen = (p: IconProps) =>
  <Icon d="M2.5 13.5L5 11 11 5l2-2 .5.5-2 2-6 6-2.5 2.5H2.5zM9 4l3 3" {...p} />

export const IcoEraser = (p: IconProps) =>
  <Icon d="M5.5 13.5H14M3 10.5L8.5 5l4 4L7 14.5l-4-4zM7.5 5.5L11.5 9.5" {...p} />

export const IcoTrash = (p: IconProps) =>
  <Icon d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M4 4l1 9a1 1 0 001 1h4a1 1 0 001-1l1-9" {...p} />

export const IcoUpload = (p: IconProps) =>
  <Icon d="M8 11V3M5 6L8 3l3 3M13 11v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2" {...p} />

export const IcoDownload = (p: IconProps) =>
  <Icon d="M8 3v8M5 8l3 3 3-3M13 11v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2" {...p} />

export const IcoFile = (p: IconProps) =>
  <Icon d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1zM9 2v5h5" {...p} />

export const IcoLink = (p: IconProps) =>
  <Icon d="M6.5 9.5l3-3M8 4.5L9.5 3A3.18 3.18 0 0113 6.5l-1.5 1.5M8 11.5L6.5 13A3.18 3.18 0 013 9.5L4.5 8" {...p} />

export const IcoZap = (p: IconProps) =>
  <Icon d="M9.5 2L4 9h5l-2.5 6L13.5 8h-5L9.5 2z" {...p} />

export const IcoWifi = (p: IconProps) =>
  <Icon d="M2 7.5A8.5 8.5 0 0114 7.5M4.5 10A5 5 0 0111.5 10M7 12.5a1 1 0 102 0 1 1 0 00-2 0" {...p} />

export const IcoWifiOff = (p: IconProps) =>
  <Icon d="M2 2l12 12M2 7.5c1.26-1.26 2.94-2.19 4.79-2.63M14 7.5A8.5 8.5 0 009 5.38M4.5 10A5 5 0 018 9.3M11.5 10a5 5 0 00-1.44-1.1M8 12.5a1 1 0 100 2 1 1 0 000-2z" {...p} />

export const IcoRefresh = (p: IconProps) =>
  <Icon d="M4 8A4 4 0 0112 5.5L13 4M12 8A4 4 0 014 10.5L3 12M13 4v3h-3M3 12v-3h3" {...p} />

export const IcoAlertCircle = (p: IconProps) =>
  <Icon d="M8 14A6 6 0 108 2a6 6 0 000 12zM8 6v3M8 10.5v.5" {...p} />

export const IcoCheckCircle = (p: IconProps) =>
  <Icon d="M8 14A6 6 0 108 2a6 6 0 000 12zM5.5 8L7 9.5L10.5 6" {...p} />

export const IcoInfo = (p: IconProps) =>
  <Icon d="M8 14A6 6 0 108 2a6 6 0 000 12zM8 8v3.5M8 5.5v.5" {...p} />

export const IcoLogOut = (p: IconProps) =>
  <Icon d="M10 4h3a1 1 0 011 1v6a1 1 0 01-1 1h-3M7 5l-3 3 3 3M11 8H4" {...p} />

export const IcoMoon = (p: IconProps) =>
  <Icon d="M12.5 10A5.5 5.5 0 016 3.5a6 6 0 100 9 5.5 5.5 0 006.5-2.5z" {...p} />

export const IcoSun = (p: IconProps) =>
  <Icon d="M8 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM8 2v1M8 13v1M2 8H1M15 8h-1M4.2 4.2L3.5 3.5M12.5 12.5l-.7-.7M3.5 12.5l.7-.7M11.8 4.2l.7-.7" {...p} />

export const IcoGlobe = (p: IconProps) =>
  <Icon d="M8 14A6 6 0 108 2a6 6 0 000 12zM2 8h12M8 2c-1.5 2-2.5 3.8-2.5 6S6.5 12 8 14M8 2c1.5 2 2.5 3.8 2.5 6S9.5 12 8 14" {...p} />

export const IcoClock = (p: IconProps) =>
  <Icon d="M8 14A6 6 0 108 2a6 6 0 000 12zM8 5v3l2.5 2" {...p} />

export const IcoEye = (p: IconProps) =>
  <Icon d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5zM8 10a2 2 0 100-4 2 2 0 000 4z" {...p} />

export const IcoLock = (p: IconProps) =>
  <Icon d="M5 7V5a3 3 0 016 0v2M3 7h10a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" {...p} />

export const IcoShare = (p: IconProps) =>
  <Icon d="M11 3l2 2-2 2M5 8h8M11 11l2 2-2 2M5 8a3 3 0 010-6h1M5 8a3 3 0 000 6h1" {...p} />

export const IcoLayout = (p: IconProps) =>
  <Icon d="M2 3h12a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1zM1 7h14M6 7v7" {...p} />

export const IcoMoreH = (p: IconProps) =>
  <Icon d="M4 8a1 1 0 102 0 1 1 0 00-2 0zM7.5 8a1 1 0 102 0 1 1 0 00-2 0zM11 8a1 1 0 102 0 1 1 0 00-2 0z" {...p} />

// ─── Meeting icons ────────────────────────────────────────────────────────────

export function IcoMic({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
      <path d="M3 8a5 5 0 0010 0" />
      <line x1="8" y1="13" x2="8" y2="15" />
      <line x1="5.5" y1="15" x2="10.5" y2="15" />
    </svg>
  )
}

export function IcoMicOff({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.5 5.5V5a2.5 2.5 0 00-5 0v3.5" />
      <path d="M5.5 9.5A2.5 2.5 0 0010.5 9" />
      <path d="M3 8a5 5 0 008.5 3.6M13 8a5 5 0 00-.5-2.1" />
      <line x1="8" y1="13" x2="8" y2="15" />
      <line x1="5.5" y1="15" x2="10.5" y2="15" />
      <line x1="3" y1="3" x2="13" y2="13" />
    </svg>
  )
}

export function IcoCam({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="5" width="10" height="8" rx="1.5" />
      <path d="M11 8.5l4-2.5v6l-4-2.5" />
    </svg>
  )
}

export function IcoCamOff({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5H2a1 1 0 00-1 1v6a1 1 0 001 1h7a1 1 0 001-1v-1" />
      <path d="M7 5h3a1 1 0 011 1v1M11 8.5l4-2.5v6l-2.5-1.6" />
      <line x1="2" y1="2" x2="14" y2="14" />
    </svg>
  )
}

export function IcoScreen({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2.5" width="14" height="9" rx="1" />
      <path d="M5.5 14.5h5M8 11.5v3" />
      <path d="M6 7l2-2 2 2M8 5v4" />
    </svg>
  )
}

export function IcoHand({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5V9M10.5 3.5V9M6 4V9M3.5 7.5a1 1 0 012 0V10" />
      <path d="M3.5 10v0a4.5 4.5 0 004.5 4.5 4.5 4.5 0 004.5-4.5V7.5a1 1 0 00-2 0V9" />
    </svg>
  )
}

export function IcoVideo({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="10" height="9" rx="1.5" />
      <path d="M11 7l4-2v6l-4-2" />
      <circle cx="6" cy="8.5" r="0" />
    </svg>
  )
}

export function IcoMonitorOff({ size = 16, color = 'currentColor', strokeWidth = 1.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3H2a1 1 0 00-1 1v7a1 1 0 001 1h12a1 1 0 001-1V6" />
      <path d="M5.5 14.5h5M8 12v2.5" />
      <line x1="2" y1="2" x2="14" y2="14" />
    </svg>
  )
}
