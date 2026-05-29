import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import UnlockModal from './UnlockModal'

/**
 * DemoBubble — a sea-foam glass nudge that floats up in the bottom-right
 * corner shortly after the homepage settles, gently announcing that the
 * site is in demo/preview mode. Clicking it hands off to the existing
 * frosted-glass password modal (UnlockModal) to enter FULL mode.
 *
 * Lifecycle (a tiny state machine):
 *   pre   → waiting out the appear delay (or skipped if shown this session)
 *   enter → playing the float-in animation
 *   idle  → settled; breathing dot + subtle float; auto-fades after 6s
 *   leave → playing the float-out animation
 *   done  → unmounted from view (modal may still be open)
 *
 * Product rules:
 *   - Preview/home-only mounting is decided by the parent (App).
 *   - Shows once per browser session (sessionStorage) so navigating in and
 *     out of the homepage doesn't re-nag.
 *   - Auto-fades 6s after settling; hovering pauses (and resets) the timer.
 *   - prefers-reduced-motion degrades to a plain cross-fade.
 */

const SESSION_SHOWN_KEY = 'dugou.demo_bubble_shown.v1'
const APPEAR_DELAY_MS = 2770
const AUTO_FADE_MS = 6000
const ENTER_MS = 660 // ~demoBubbleIn (640ms) + small buffer
const LEAVE_MS = 400 // ~demoBubbleOut (380ms) + small buffer

const alreadyShownThisSession = () => {
  try {
    return window.sessionStorage.getItem(SESSION_SHOWN_KEY) === '1'
  } catch {
    return false
  }
}

const markShownThisSession = () => {
  try {
    window.sessionStorage.setItem(SESSION_SHOWN_KEY, '1')
  } catch {
    /* sessionStorage unavailable — fail silent */
  }
}

export default function DemoBubble() {
  const [phase, setPhase] = useState('pre')
  const [hovered, setHovered] = useState(false)
  const [sweepKey, setSweepKey] = useState(0) // keyed remount replays the sheen
  const [modalOpen, setModalOpen] = useState(false)

  // Appear after a short beat — unless already nudged this session.
  useEffect(() => {
    if (alreadyShownThisSession()) {
      setPhase('done')
      return undefined
    }
    const timer = window.setTimeout(() => {
      markShownThisSession()
      setPhase('enter')
    }, APPEAR_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // Drive enter → idle → done by timers matched to the CSS durations.
  // (More robust than animationend, which can be dropped under HMR /
  // Fast Refresh / backgrounded tabs.)
  useEffect(() => {
    if (phase === 'enter') {
      const timer = window.setTimeout(() => {
        setPhase('idle')
        setSweepKey((key) => key + 1) // one-time settle sweep
      }, ENTER_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'leave') {
      const timer = window.setTimeout(() => setPhase('done'), LEAVE_MS)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [phase])

  // Auto-fade once settled; hovering pauses (a fresh 6s starts on leave).
  useEffect(() => {
    if (phase !== 'idle' || hovered) return undefined
    const timer = window.setTimeout(() => setPhase('leave'), AUTO_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [phase, hovered])

  const handleMouseEnter = () => {
    setHovered(true)
    if (phase === 'idle') setSweepKey((key) => key + 1) // replay sweep on hover
  }

  const handleMouseLeave = () => setHovered(false)

  const handleActivate = () => {
    if (phase === 'leave' || phase === 'done') return
    setPhase('leave') // graceful exit
    setModalOpen(true) // hand off to the password modal
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleActivate()
    }
  }

  const showBubble = phase === 'enter' || phase === 'idle' || phase === 'leave'
  const stateClass = phase === 'enter'
    ? ' is-entering'
    : phase === 'idle'
      ? ' is-idle'
      : phase === 'leave'
        ? ' is-leaving'
        : ''

  return (
    <>
      {showBubble && (
        <div
          className={`demo-bubble${stateClass}`}
          role="button"
          tabIndex={0}
          aria-label="当前为演示模式，点击切换为Full版本"
          onClick={handleActivate}
          onKeyDown={handleKeyDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {sweepKey > 0 && <span key={sweepKey} className="demo-bubble-sheen" aria-hidden="true" />}
          <div className="demo-bubble-inner">
            <div className="demo-bubble-head">
              <span className="demo-bubble-chip">
                <span className="demo-bubble-dot" aria-hidden="true" />
                DEMO
              </span>
              <span className="demo-bubble-title">演示模式 · Preview</span>
            </div>
            <p className="demo-bubble-sub">
              当前数据和模型参数均已切换为demo版本 (脱敏)，仅用于展示产品形态和算法能力。
            </p>
            <span className="demo-bubble-cta">
              切换为Full版本
              <ArrowRight className="demo-bubble-cta-arrow" size={13} strokeWidth={2} />
            </span>
          </div>
        </div>
      )}
      <UnlockModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}
