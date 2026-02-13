import { useEffect } from 'react'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const getViewportFallback = () => ({
  x: typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.5) : 0,
  y: typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.32) : 0,
})

export const getWaxSealStampPoint = (target) => {
  if (typeof window === 'undefined' || !target || typeof target.getBoundingClientRect !== 'function') {
    return getViewportFallback()
  }
  const rect = target.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2 - 14
  return {
    x: clamp(Math.round(x), 88, window.innerWidth - 88),
    y: clamp(Math.round(y), 104, window.innerHeight - 112),
  }
}

export default function WaxSealStampOverlay({ burst, onDone }) {
  useEffect(() => {
    if (!burst?.active) return undefined
    const timer = window.setTimeout(() => {
      onDone?.()
    }, 1180)
    return () => window.clearTimeout(timer)
  }, [burst?.active, burst?.token, onDone])

  if (!burst?.active) return null

  const style = {
    left: `${burst.x}px`,
    top: `${burst.y}px`,
  }

  return (
    <div className="wax-seal-burst-layer" aria-hidden="true">
      <div key={burst.token} className="wax-seal-burst-anchor" style={style}>
        <div className="wax-seal-burst-ripple wax-seal-burst-ripple-1" />
        <div className="wax-seal-burst-ripple wax-seal-burst-ripple-2" />
        <div className="wax-seal-burst-impact-glow" />
        <div className="wax-seal-burst-shadow" />
        <div className="wax-seal-burst-seal">
          <div className="wax-seal-burst-ring-outer" />
          <div className="wax-seal-burst-ring-inner" />
          <span className="wax-seal-burst-hd">HD</span>
          <div className="wax-seal-burst-divider" />
          <span className="wax-seal-burst-cs">CS</span>
        </div>
      </div>
    </div>
  )
}
