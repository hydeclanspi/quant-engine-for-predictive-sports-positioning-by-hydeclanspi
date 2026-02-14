const MARK_VARIANTS = {
  v2: (
    <>
      <path d="M10 2.9L16.7 9.6L10 16.3L3.3 9.6L10 2.9Z" fill="none" />
      <path d="M10 5.2V14" />
      <path d="M5.9 9.6H14.1" />
    </>
  ),
  v3: (
    <>
      <path d="M4.1 5.1H8.6V9.4H4.1V5.1Z" />
      <path d="M11.2 5.1H15.9V9.4H11.2V5.1Z" />
      <path d="M4.1 10.2H8.6V14.7H4.1V10.2Z" />
      <path d="M11.2 10.2H15.9V14.7H11.2V10.2Z" />
    </>
  ),
  v4: (
    <>
      <path d="M10 3.2L15.5 5.6V10.5C15.5 12.9 13.6 15.1 10 16.5C6.4 15.1 4.5 12.9 4.5 10.5V5.6L10 3.2Z" fill="none" />
      <path d="M7 9.8H13" />
      <path d="M10 7V12.5" />
    </>
  ),
  v5: (
    <>
      <path d="M10 3.3L15.8 6.8V13.2L10 16.7L4.2 13.2V6.8L10 3.3Z" fill="none" />
      <path d="M10 3.3V16.7" />
      <path d="M4.2 13.2L10 9.8L15.8 13.2" />
    </>
  ),
  v6: (
    <>
      <circle cx="10" cy="10" r="5.1" fill="none" />
      <circle cx="10" cy="10" r="1.45" />
      <path d="M10 2.9A7.1 7.1 0 0 1 17.1 10" fill="none" />
    </>
  ),
  v6c: (
    <>
      <rect x="4.1" y="4.1" width="11.8" height="11.8" rx="2.3" fill="none" />
      <path d="M6.5 8H13.5" />
      <path d="M6.5 10.5H12" />
      <path d="M6.5 13H11.1" />
    </>
  ),
}

export default function ContextualPageMark({ variant = 'v2' }) {
  const glyph = MARK_VARIANTS[variant] || MARK_VARIANTS.v2

  return (
    <span className={`mn-page-mark-wrap mn-page-mark-wrap--${variant}`} aria-hidden="true">
      <svg className="mn-page-mark" viewBox="0 0 20 20" fill="none">
        <g className="mn-page-mark-glyph">{glyph}</g>
      </svg>
    </span>
  )
}

