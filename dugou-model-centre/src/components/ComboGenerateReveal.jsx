import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'

/**
 * ComboGenerateReveal — a ~1s "algorithm at work" curtain that plays once
 * over the 智能组合包 hero card right after the user hits 生成最优组合.
 *
 * It narrates the three real stages of the pipeline that already ran
 * synchronously underneath, turning an instantaneous state-swap into a
 * legible moment that shows the system *earning* its recommendation:
 *   1. 扫描 21 组腿对相关性        (dependency / fragility engine)
 *   2. 运行 10 万次蒙特卡洛模拟    (runPortfolioMonteCarlo)
 *   3. 求解最优 Kelly 配额          (atomic Kelly optimizer)
 *
 * Each step walks pending → active (spinner) → done (✓ pop). A soft light
 * sweeps top→bottom underneath. At ~1.1s the curtain begins to dissolve
 * (opacity fade) and *simultaneously* fires onReveal() so the freshly
 * computed numbers start their count-up while the curtain lifts; onDone()
 * unmounts the overlay once the fade completes.
 *
 * Click anywhere to skip — fast/returning users aren't held hostage.
 * prefers-reduced-motion shows a single static "done" frame for a blink
 * then resolves immediately, so nothing janks.
 *
 * Zero-interruption (B类): only ever appears as the direct consequence of
 * a user click; it never auto-pops.
 */

const STEPS = ['扫描 21 组腿对相关性', '运行 10 万次蒙特卡洛模拟', '求解最优 Kelly 配额']

const STEP_INTERVAL_MS = 300 // stagger between each step starting
const STEP_ACTIVE_MS = 300 // spinner dwell before a step flips to ✓
const HOLD_AFTER_MS = 220 // beat after the last ✓ before the curtain lifts
const FADE_MS = 380 // curtain dissolve duration (matches CSS comboRevealOut)

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function ComboGenerateReveal({ onReveal, onDone }) {
  const [activeStep, setActiveStep] = useState(0)
  const [doneCount, setDoneCount] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const timersRef = useRef([])
  const settledRef = useRef(false)
  const settleRef = useRef(null) // exposes settle() to the click handler
  // Keep latest callbacks without re-running the choreography effect.
  const onRevealRef = useRef(onReveal)
  const onDoneRef = useRef(onDone)
  onRevealRef.current = onReveal
  onDoneRef.current = onDone

  useEffect(() => {
    const timers = timersRef.current

    // Resolve once: lift the curtain (onReveal) then unmount (onDone).
    const settle = () => {
      if (settledRef.current) return
      settledRef.current = true
      // Cancel pending step timers so a skip can't trip later steps.
      timers.forEach((t) => window.clearTimeout(t))
      timers.length = 0
      onRevealRef.current?.()
      setLeaving(true)
      timers.push(window.setTimeout(() => onDoneRef.current?.(), FADE_MS))
    }
    settleRef.current = settle

    if (prefersReducedMotion()) {
      // Show a static "all done" frame for a blink, then resolve.
      setActiveStep(STEPS.length)
      setDoneCount(STEPS.length)
      timers.push(window.setTimeout(settle, 180))
      return () => {
        timers.forEach((t) => window.clearTimeout(t))
        timers.length = 0
      }
    }

    // Choreograph: step i goes active at i*INTERVAL, ✓ at +ACTIVE.
    STEPS.forEach((_, i) => {
      const startAt = i * STEP_INTERVAL_MS
      timers.push(window.setTimeout(() => setActiveStep(i), startAt))
      timers.push(window.setTimeout(() => setDoneCount(i + 1), startAt + STEP_ACTIVE_MS))
    })
    const total = (STEPS.length - 1) * STEP_INTERVAL_MS + STEP_ACTIVE_MS + HOLD_AFTER_MS
    timers.push(window.setTimeout(settle, total))

    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      timers.length = 0
    }
  }, [])

  const handleSkip = () => settleRef.current?.()

  return (
    <div
      className={`combo-reveal${leaving ? ' is-leaving' : ''}`}
      onClick={handleSkip}
      role="presentation"
    >
      <span className="combo-reveal-sweep" aria-hidden="true" />
      <div className="combo-reveal-inner">
        <ul className="combo-reveal-steps">
          {STEPS.map((label, i) => {
            const isDone = i < doneCount
            const isActive = !isDone && i === activeStep
            const state = isDone ? 'done' : isActive ? 'active' : 'pending'
            return (
              <li key={label} className={`combo-reveal-step is-${state}`}>
                <span className="combo-reveal-mark" aria-hidden="true">
                  {isDone ? (
                    <Check size={12} strokeWidth={3} />
                  ) : isActive ? (
                    <span className="combo-reveal-spinner" />
                  ) : (
                    <span className="combo-reveal-dot" />
                  )}
                </span>
                <span className="combo-reveal-label">{label}</span>
              </li>
            )
          })}
        </ul>
        <p className="combo-reveal-skip">点击跳过</p>
      </div>
    </div>
  )
}
