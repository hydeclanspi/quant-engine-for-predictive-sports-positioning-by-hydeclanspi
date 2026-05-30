import { useEffect, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'

/**
 * ComboExpandHint — the left-panel expand/collapse toggle for ComboPage,
 * with a one-time "there's more in here" attention nudge.
 *
 * In demo/preview mode the candidate panel lands collapsed, which hides a
 * lot of real functionality (per-match role overrides, confidence tiers,
 * add/clear, analysis-filter linkage…). To keep visitors from glossing
 * over the expand affordance, when the page first opens collapsed we:
 *   1. promote the button to an indigo "pill" so it reads as a primary
 *      action even at rest;
 *   2. play a short, finite attention choreography — first a sonar pulse
 *      (rings), then a directional chevron nudge ("open this way");
 *   3. float a one-time coachmark bubble naming what's inside.
 *
 * Shows once per browser session (sessionStorage). Only fires when the
 * panel is collapsed on mount (so a manual collapse in FULL mode, where
 * the panel starts expanded, never triggers it). prefers-reduced-motion
 * degrades to the static pill + coachmark, no rings/nudge.
 *
 * Lifecycle: idle → sonar → nudge → done.
 */

const SESSION_HINT_KEY = 'dugou.combo_expand_hint.v1'
const START_DELAY_MS = 650 // let the page settle before nudging
const SONAR_MS = 2500 // sonar phase (3 rings staggered)
const NUDGE_MS = 1300 // directional chevron nudge phase
const COACH_VISIBLE_MS = 4600 // coachmark on-screen lifetime

const alreadyHintedThisSession = () => {
  try {
    return window.sessionStorage.getItem(SESSION_HINT_KEY) === '1'
  } catch {
    return false
  }
}

const markHintedThisSession = () => {
  try {
    window.sessionStorage.setItem(SESSION_HINT_KEY, '1')
  } catch {
    /* sessionStorage unavailable — fail silent */
  }
}

export default function ComboExpandHint({ collapsed, onToggle }) {
  const [phase, setPhase] = useState('idle')
  const [coachOpen, setCoachOpen] = useState(false)

  // Fire once on mount, only if we arrive collapsed and haven't nudged
  // this session. Intentionally mount-only — a later manual collapse must
  // not re-trigger the attention sequence.
  useEffect(() => {
    if (!collapsed || alreadyHintedThisSession()) return undefined
    // Mark inside the timer (not synchronously here) so React StrictMode's
    // mount→cleanup→remount in dev doesn't set the flag on the throwaway
    // first pass and then skip the real run.
    const timer = window.setTimeout(() => {
      markHintedThisSession()
      setPhase('sonar')
      setCoachOpen(true)
    }, START_DELAY_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drive sonar → nudge → done with timers matched to the CSS durations.
  useEffect(() => {
    if (phase === 'sonar') {
      const timer = window.setTimeout(() => setPhase('nudge'), SONAR_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'nudge') {
      const timer = window.setTimeout(() => setPhase('done'), NUDGE_MS)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [phase])

  // Auto-dismiss the coachmark.
  useEffect(() => {
    if (!coachOpen) return undefined
    const timer = window.setTimeout(() => setCoachOpen(false), COACH_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [coachOpen])

  const handleClick = () => {
    setCoachOpen(false)
    setPhase('done')
    onToggle?.()
  }

  // Expanded state — plain, low-key ghost button (collapsing is a
  // secondary action that needs no promotion).
  if (!collapsed) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="p-1.5 rounded-lg text-stone-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
        title="收起面板"
        aria-label="收起面板"
      >
        <ChevronsLeft size={14} />
      </button>
    )
  }

  // Collapsed state — promoted indigo pill + (one-time) attention nudge.
  return (
    <div className="combo-expand-hint">
      {phase === 'sonar' && (
        <>
          <span className="combo-expand-ring" aria-hidden="true" />
          <span className="combo-expand-ring combo-expand-ring-2" aria-hidden="true" />
          <span className="combo-expand-ring combo-expand-ring-3" aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        onClick={handleClick}
        className={`combo-expand-btn${phase === 'nudge' ? ' is-nudging' : ''}`}
        title="展开面板"
        aria-label="展开面板，查看更多调参与每场角色设置"
      >
        <ChevronsRight size={14} />
      </button>
      {coachOpen && (
        <>
          {/* Ethereal anime-style hairline: button → coachmark. The path
              normalises to pathLength=1 so the draw-in animation is
              independent of the curve's true length. */}
          <svg
            className="combo-expand-connector"
            viewBox="0 0 64 34"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="comboConnectorStroke" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#a5b4fc" stopOpacity="0" />
                <stop offset="40%" stopColor="#a5b4fc" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.85" />
              </linearGradient>
            </defs>
            <path
              className="combo-expand-connector-line"
              pathLength={1}
              d="M4 28 C 20 26, 24 9, 46 7"
            />
            <circle className="combo-expand-connector-dot" cx="46" cy="7" r="1.9" />
          </svg>
          <div className="combo-expand-coach" role="status">
            <span className="combo-expand-coach-spark" aria-hidden="true">✦</span>
            点击可展开更多调参
          </div>
        </>
      )}
    </div>
  )
}
