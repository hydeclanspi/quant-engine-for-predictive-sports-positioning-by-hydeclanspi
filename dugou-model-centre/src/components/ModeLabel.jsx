import { useLabels } from '../lib/labels'

/**
 * ModeLabel — renders a strategy-mode name routed through the active
 * display-mode dictionary. In FULL_MODE the raw Chinese mode names
 * (常规 / 常规-稳 / …) pass through unchanged. In PREVIEW_MODE they
 * are swapped for quant-style strategy class names (Baseline-Drift /
 * Mean-Reverting / Momentum-Carry / Convex-Barbell / Defensive-Anchor
 * / Heavy-Tail Sprint).
 *
 * Use this anywhere you render a mode string in JSX. For non-JSX use
 * (chart axis labels, table cell strings) call useModeLabel() instead.
 */
export default function ModeLabel({ mode, fallback = '', as: Tag = 'span', className = '', ...rest }) {
  const labels = useLabels()
  const masked = labels.modes?.[mode] || fallback || mode || ''
  return (
    <Tag className={className} {...rest}>{masked}</Tag>
  )
}

/**
 * useModeLabel — returns the active display-mode label for a single
 * raw mode value. Useful inside computed strings (chart legends,
 * select option text, table cells).
 */
export function useModeLabel(mode) {
  const labels = useLabels()
  return labels.modes?.[mode] || mode || ''
}

/**
 * useModeLabelMap — returns a memoised function that maps any raw
 * mode value to its current-display-mode label. Stable across renders
 * within the same mode, so it's safe to use in lists.
 */
export function useModeLabelMap() {
  const labels = useLabels()
  return (mode) => labels.modes?.[mode] || mode || ''
}
