const cx = (...tokens) => tokens.filter(Boolean).join(' ')

export default function C15DiamondCutV1Logo({ size = 'sm', className = '', interactive = true }) {
  const small = size === 'sm'

  return (
    <span
      className={cx(
        'c15-v1-raw-shell',
        small ? 'c15-v1-raw-shell--sm' : 'c15-v1-raw-shell--md',
        interactive ? 'c15-v1-raw-shell--interactive' : '',
        className,
      )}
      aria-hidden="true"
    >
      <span className="c15-v1-raw-scale">
        <span className="v1-icon">
          <span className="v1-edge-catch" />
          <span className="v1-shimmer" />

          <span className="v1-facet v1-tl">
            <span>H</span>
          </span>
          <span className="v1-facet v1-tr">
            <span>D</span>
          </span>
          <span className="v1-facet v1-bl">
            <span>C</span>
          </span>
          <span className="v1-facet v1-br">
            <span>S</span>
          </span>

          <span className="v1-cross-h" />
          <span className="v1-cross-v" />
          <span className="v1-flow-h-l" />
          <span className="v1-flow-h-r" />
          <span className="v1-flow-v-t" />
          <span className="v1-flow-v-b" />
          <span className="v1-gem" />
        </span>
      </span>
    </span>
  )
}
