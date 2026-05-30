import { useEffect, useRef, useState } from 'react'

/**
 * CountUp — requestAnimationFrame-driven number tween from 0 → value,
 * eased with easeOutCubic so it decelerates into the final figure.
 *
 * Re-runs whenever `runKey` changes (bump it to replay the roll-up even
 * when the target value is identical to last time). On first mount it
 * also plays once. prefers-reduced-motion snaps straight to the value.
 *
 * Props:
 *   value     target number (non-finite values render verbatim)
 *   decimals  fixed decimal places (default 0); ignored when `format` set
 *   duration  tween length in ms (default 900)
 *   delay     ms to hold at 0 before the tween starts — used to cascade a
 *             row of figures (stagger each one). Ignored under reduced motion.
 *   runKey    change this to replay the animation
 *   prefix    string before the number (e.g. '+')
 *   suffix    string after the number (e.g. '%')
 *   format    optional (n)=>string; use to mirror a variable-precision
 *             source so the resting value matches byte-for-byte
 *   className passthrough to the wrapping <span>
 */

const easeOutCubic = (t) => 1 - (1 - t) ** 3

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function CountUp({
  value,
  decimals = 0,
  duration = 900,
  delay = 0,
  runKey = 0,
  prefix = '',
  suffix = '',
  format = null,
  className = '',
}) {
  // Start at 0 so the first painted frame never flashes the final value
  // (reduced-motion users start already settled).
  const [display, setDisplay] = useState(() =>
    prefersReducedMotion() ? Number(value) || 0 : 0,
  )
  const frameRef = useRef(0)
  const timerRef = useRef(0)

  useEffect(() => {
    const target = Number(value)
    if (!Number.isFinite(target)) {
      setDisplay(value)
      return undefined
    }
    if (prefersReducedMotion() || duration <= 0) {
      setDisplay(target)
      return undefined
    }

    let startTs = null
    const tick = (now) => {
      if (startTs === null) startTs = now
      const t = Math.min(1, (now - startTs) / duration)
      setDisplay(target * easeOutCubic(t))
      if (t < 1) {
        frameRef.current = window.requestAnimationFrame(tick)
      } else {
        setDisplay(target)
      }
    }
    const begin = () => {
      frameRef.current = window.requestAnimationFrame(tick)
    }
    if (delay > 0) {
      // Hold at 0 through the stagger window, then tween in.
      setDisplay(0)
      timerRef.current = window.setTimeout(begin, delay)
    } else {
      begin()
    }
    return () => {
      window.clearTimeout(timerRef.current)
      window.cancelAnimationFrame(frameRef.current)
    }
    // Intentionally keyed only on runKey: `value`/`delay` are read fresh from
    // the closure each replay (they update in the same batch as runKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey])

  const num = Number.isFinite(Number(display)) ? Number(display) : 0
  const body = typeof format === 'function' ? format(num) : num.toFixed(decimals)
  return (
    <span className={className}>
      {prefix}
      {body}
      {suffix}
    </span>
  )
}
