import type { JSX } from 'react'

/** The Helm brand mark — a ship's wheel (assets/helm-mark.svg, inlined). */
export function HelmMark({ size = 24, color }: { size?: number; color?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={6.5}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="48" cy="48" r="27" />
      <circle cx="48" cy="48" r="9.5" />
      <path d="M48 36V4M48 60v32M36 48H4M60 48h32M39.5 39.5 20.1 20.1M56.5 56.5 75.9 75.9M56.5 39.5 75.9 20.1M39.5 56.5 20.1 75.9" />
    </svg>
  )
}
