const cx = (...tokens) => tokens.filter(Boolean).join(' ')

export default function HdcsC19Logo({ size = 'sm', className = '', interactive = true }) {
  const small = size === 'sm'

  return (
    <span
      className={cx(
        'c19-logo-shell',
        small ? 'c19-logo-shell--sm' : 'c19-logo-shell--md',
        interactive ? 'c19-logo-shell--interactive' : '',
        className,
      )}
    >
      <span className={cx('c19-logo c19-a2a3a5', small ? 'c19-logo-sm' : '')} aria-hidden="true">
        <span className={cx('c19-logo-border', small ? 'c19-logo-border-sm' : '')} />
        <span className={cx('c19-logo-inner', small ? 'c19-logo-inner-sm' : '')} />
        <span className={cx('c19-logo-content', small ? 'c19-logo-content-sm' : '')}>
          <span className={small ? 'c19-t-sm' : 'c19-t'}>HD</span>
          <span className={cx('c19-dot', small ? 'c19-dot-sm' : '')}>
            <span className="c19-dot-ring" />
          </span>
          <span className={small ? 'c19-b-sm' : 'c19-b'}>CS</span>
        </span>
        <span className="c19-logo-shimmer" />
      </span>
    </span>
  )
}
