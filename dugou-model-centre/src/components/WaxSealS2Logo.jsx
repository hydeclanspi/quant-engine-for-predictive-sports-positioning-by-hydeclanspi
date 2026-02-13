const cx = (...tokens) => tokens.filter(Boolean).join(' ')

export default function WaxSealS2Logo({ size = 'sm', className = '', interactive = true }) {
  const small = size === 'sm'

  return (
    <span
      className={cx(
        'wax-s2-logo-shell',
        small ? 'wax-s2-logo-shell--sm' : 'wax-s2-logo-shell--md',
        interactive ? 'wax-s2-logo-shell--interactive' : '',
        className,
      )}
      aria-hidden="true"
    >
      <span className="wax-s2-logo">
        <span className="wax-s2-seal">
          <span className="wax-s2-ring-outer" />
          <span className="wax-s2-ring-inner" />
          <span className="wax-s2-hd">HD</span>
          <span className="wax-s2-divider" />
          <span className="wax-s2-cs">CS</span>
        </span>
        <span className="wax-s2-orbit-track-a">
          <span className="wax-s2-dot-a" />
          <span className="wax-s2-trail-a1" />
          <span className="wax-s2-trail-a2" />
        </span>
        <span className="wax-s2-orbit-track-b">
          <span className="wax-s2-dot-b" />
          <span className="wax-s2-trail-b1" />
        </span>
      </span>
    </span>
  )
}
