import * as React from 'react'

interface IArborLogoProps {
  readonly className?: string
  /** Size in pixels (the logo is square). */
  readonly size?: number
}

/**
 * Arbor: the monochrome Arbor glyph (a tree whose branches are Git branches),
 * drawn in the current text colour like an octicon.
 */
export function ArborLogo(props: IArborLogoProps) {
  const size = props.size ?? 16
  return (
    <svg
      className={props.className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden={true}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13.4V8.75M8 9.4V3.9M8 10 5.15 7.35V5.6M8 8.75l2.9-2.5V4.7" />
      <g fill="currentColor" stroke="none">
        <circle cx="8" cy="3.9" r="1.45" />
        <circle cx="5.15" cy="5.6" r="1.45" />
        <circle cx="10.9" cy="4.7" r="1.45" />
        <circle cx="8" cy="13.1" r="1.45" />
      </g>
    </svg>
  )
}
