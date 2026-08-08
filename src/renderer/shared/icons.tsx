import type { JSX, ReactNode } from 'react'

export interface IconProps {
  size?: number
}

/**
 * Brand stroke icons, inlined from assets/icons/*.svg (the source of truth —
 * keep the two in sync). Same pattern as HelmMark: currentColor so the
 * surrounding text color themes them.
 */
function Icon({ size = 20, children }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function DisplayIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2.5" y="3.5" width="15" height="10.5" rx="1.5" />
      <path d="M10 14v3M6.5 17h7" />
    </Icon>
  )
}

export function GoLiveIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8.2 6.8v6.4L13.6 10z" />
    </Icon>
  )
}

export function ImportIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M10 3v8.5M6.5 8 10 11.5 13.5 8M4 16.5h12" />
    </Icon>
  )
}

export function LogoIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="5.6" />
      <circle cx="10" cy="10" r="1.6" />
      <path d="M10 1.5v2.9M10 15.6v2.9M1.5 10h2.9M15.6 10h2.9M4 4l2 2M14 14l2 2M16 4l-2 2M6 14l-2 2" />
    </Icon>
  )
}

export function MessageIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
      <circle cx="7" cy="10" r="1.7" />
      <circle cx="13" cy="10" r="1.7" />
      <path d="M8.7 10h2.6" />
    </Icon>
  )
}

export function PreServiceIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M4 10a6 6 0 0 1 6-6h3.5" />
      <path d="M11.8 1.8 14 4l-2.2 2.2" />
      <path d="M16 10a6 6 0 0 1-6 6H6.5" />
      <path d="M8.7 13.8 6.5 16l2.2 2.2" />
    </Icon>
  )
}

export function ScheduleIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8" />
    </Icon>
  )
}

export function ScreenBlackIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M16.5 12.3A7.2 7.2 0 1 1 7.7 3.5a5.6 5.6 0 0 0 8.8 8.8z" />
    </Icon>
  )
}

export function SearchIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13l4.5 4.5" />
    </Icon>
  )
}

export function SermonIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M10 5.2C8.5 4 6.5 3.4 4 3.4V15c2.5 0 4.5.6 6 1.8 1.5-1.2 3.5-1.8 6-1.8V3.4c-2.5 0-4.5.6-6 1.8v11.6" />
    </Icon>
  )
}

export function SettingsIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M5 3v7.7M5 14.3V17M10 3v1.2M10 7.8V17M15 3v8.7M15 15.3V17" />
      <circle cx="5" cy="12.5" r="1.8" />
      <circle cx="10" cy="6" r="1.8" />
      <circle cx="15" cy="13.5" r="1.8" />
    </Icon>
  )
}

export function ShortcutsIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <rect x="2.5" y="5" width="15" height="10" rx="2" />
      <path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7" />
    </Icon>
  )
}

export function SongsIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M7.5 15.5V5l7-1.5V13" />
      <circle cx="5.5" cy="15.5" r="2" />
      <circle cx="12.5" cy="13" r="2" />
    </Icon>
  )
}

export function ThemesIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function SunIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <circle cx="10" cy="10" r="4" />
      <path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M15.8 4.2l-1.7 1.7M5.9 14.1l-1.7 1.7" />
    </Icon>
  )
}

export function MoonIcon(p: IconProps): JSX.Element {
  return (
    <Icon {...p}>
      <path d="M15.2 12.1A6.4 6.4 0 1 1 7.4 4.3a5 5 0 0 0 7.8 7.8z" />
      <path d="M15 2.6v2.8M13.6 4h2.8" />
    </Icon>
  )
}
