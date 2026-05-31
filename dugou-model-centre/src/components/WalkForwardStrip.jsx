import { useMemo, useState } from 'react'

/**
 * WalkForwardStrip — 「时序一致性」diverging bar chart for 模型收口验证.
 *
 * Replaces the old paginated text list of walk-forward windows with a single
 * glance-able picture: one bar per window, laid left→right in time order, each
 * rising (emerald) when calibration improved that window's Brier and dipping
 * (rose) when it degraded. The whole sequence — every window at once — is the
 * point: walk-forward is a story about CONSISTENCY OVER TIME, which a list of
 * "+19.5% / -25.26% / …" rows hides but a strip of bars tells instantly.
 *
 * Interaction (B 类 · zero interruption):
 *   - Bars grow up/down from the zero baseline on mount, gently staggered so
 *     the sequence "draws in" left→right. prefers-reduced-motion snaps them.
 *   - Hovering a bar spotlights it (the rest dim) and updates the readout line
 *     above with that window's facts + a plain-language verdict — no floating
 *     tooltip to clip at the edges, no popup.
 *
 * Honest data only: heights are scaled to the largest |gain| in the set, the
 * zero line is real break-even, and a near-zero gain still shows a faint nub
 * rather than nothing. Renders null when there are no windows.
 */

const verdictOf = (gain) => {
  if (gain >= 8) return { word: '显著改善', tone: 'up' }
  if (gain >= 2) return { word: '改善', tone: 'up' }
  if (gain > -2) return { word: '基本持平', tone: 'flat' }
  return { word: '退化', tone: 'down' }
}

const fmtPct = (n) => `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`

export default function WalkForwardStrip({ windows = [] }) {
  const [hovered, setHovered] = useState(null)

  const { maxAbs, positive, negative } = useMemo(() => {
    let max = 0
    let pos = 0
    let neg = 0
    windows.forEach((w) => {
      const g = Number(w?.gainPct) || 0
      if (Math.abs(g) > max) max = Math.abs(g)
      if (g > 0) pos += 1
      else if (g < 0) neg += 1
    })
    return { maxAbs: max || 1, positive: pos, negative: neg }
  }, [windows])

  if (!windows.length) return null

  const active = hovered != null ? windows[hovered] : null
  const activeVerdict = active ? verdictOf(Number(active.gainPct) || 0) : null

  return (
    <div className="wf-strip">
      <div className={`wf-strip-readout${active ? ' is-active' : ''}`}>
        {active ? (
          <>
            <span className="wf-strip-readout-label">
              <span className={`wf-strip-readout-dot wf-${activeVerdict.tone}`} aria-hidden="true" />
              {active.label} · Train {active.trainSamples} / Test {active.testSamples}
            </span>
            <span className={`wf-strip-readout-value wf-${activeVerdict.tone}`}>
              Brier 改善 {fmtPct(active.gainPct)}
              <span className="wf-strip-readout-verdict">{activeVerdict.word}</span>
            </span>
          </>
        ) : (
          <>
            <span className="wf-strip-readout-hint">悬停查看每个窗口明细</span>
            <span className="wf-strip-readout-counts">
              <span className="wf-up">正向 {positive}</span>
              <span className="wf-strip-readout-sep">·</span>
              <span className="wf-down">负向 {negative}</span>
            </span>
          </>
        )}
      </div>

      <div className={`wf-strip-plot${hovered != null ? ' is-hovering' : ''}`}>
        <span className="wf-strip-zero" aria-hidden="true" />
        {windows.map((w, i) => {
          const g = Number(w?.gainPct) || 0
          const up = g >= 0
          const h = Math.max((Math.abs(g) / maxAbs) * 46, 2.5) // % of plot height; baseline at 50%
          return (
            <span
              key={w?.label || i}
              className="wf-strip-col"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((cur) => (cur === i ? null : cur))}
            >
              <span
                className={`wf-strip-bar ${up ? 'is-up' : 'is-down'}${hovered === i ? ' is-active' : ''}`}
                style={{ height: `${h}%`, animationDelay: `${Math.min(i, 30) * 24}ms` }}
              />
            </span>
          )
        })}
      </div>

      <div className="wf-strip-axis" aria-hidden="true">
        <span>{windows[0]?.label}</span>
        <span className="wf-strip-axis-arrow">时间推进 →</span>
        <span>{windows[windows.length - 1]?.label}</span>
      </div>
    </div>
  )
}
