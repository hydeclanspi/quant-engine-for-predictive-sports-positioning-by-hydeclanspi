const cx = (...tokens) => tokens.filter(Boolean).join(' ')

export default function C15DiamondCutV1Logo({ size = 'sm', className = '', interactive = true }) {
  const small = size === 'sm'

  return (
    <span
      className={cx(
        'c15v1-logo-shell',
        small ? 'c15v1-logo-shell--sm' : 'c15v1-logo-shell--md',
        interactive ? 'c15v1-logo-shell--interactive' : '',
        className,
      )}
      aria-hidden="true"
    >
      <span className="c15v1-logo-frame">
        <span className="c15v1-icon">
          <span className="c15v1-edge-catch" />
          <span className="c15v1-shimmer" />

          <span className="c15v1-facet c15v1-tl">
            <span>H</span>
          </span>
          <span className="c15v1-facet c15v1-tr">
            <span>D</span>
          </span>
          <span className="c15v1-facet c15v1-bl">
            <span>C</span>
          </span>
          <span className="c15v1-facet c15v1-br">
            <span>S</span>
          </span>

          <span className="c15v1-cross-h" />
          <span className="c15v1-cross-v" />
          <span className="c15v1-flow-h-l" />
          <span className="c15v1-flow-h-r" />
          <span className="c15v1-flow-v-t" />
          <span className="c15v1-flow-v-b" />
          <span className="c15v1-gem" />
        </span>
      </span>
    </span>
  )
}
