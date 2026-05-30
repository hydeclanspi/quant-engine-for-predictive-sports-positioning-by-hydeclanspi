import { useEffect, useMemo, useRef, useState } from 'react'
import CountUp from './CountUp'

/**
 * CapitalCurveReveal — History 时间线揭示 (B 类，无弹窗).
 *
 * A quiet "资金累计" (cumulative net P&L) curve built ENTIRELY from real
 * settled investments, sorted by date. It draws on ONCE the first time it
 * scrolls into view (IntersectionObserver, observe → fire → disconnect),
 * then the final figure counts up alongside the line. This is the History
 * page's single signature moment: zero interruption, no popup, honest data.
 *
 * The series is all-time and deliberately independent of the list filters —
 * filtering to "已中" only and watching a monotonic line would be a lie.
 *
 * prefers-reduced-motion: the CSS snaps every element to its resting state
 * (no draw, no fade) and CountUp settles immediately.
 *
 * Renders nothing when fewer than two settled records exist — no fake chart.
 */

const W = 640
const H = 152
const PAD_X = 8
const PAD_Y = 16

const toRmb = (n) => {
  const v = Math.round(Number(n) || 0)
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return `${sign}¥${Math.abs(v).toLocaleString('en-US')}`
}

export default function CapitalCurveReveal({ investments }) {
  const series = useMemo(() => {
    const settled = (Array.isArray(investments) ? investments : [])
      .filter((inv) => {
        const status = inv?.status || 'pending'
        return status !== 'pending' && Number.isFinite(Number(inv?.profit))
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

    if (settled.length < 2) return null

    let cum = 0
    // Anchor the path at break-even (0) so the curve reads as a journey
    // from the first stake rather than starting mid-air.
    const points = [{ cum: 0 }]
    settled.forEach((inv) => {
      cum += Number(inv.profit)
      points.push({ cum })
    })
    return { points, settledCount: settled.length }
  }, [investments])

  const containerRef = useRef(null)
  const firedRef = useRef(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || firedRef.current) return undefined

    const fire = () => {
      if (firedRef.current) return
      firedRef.current = true
      setRevealed(true)
    }

    if (typeof IntersectionObserver === 'undefined') {
      fire()
      return undefined
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.3)) {
          fire()
          obs.disconnect()
        }
      },
      { threshold: [0, 0.3, 0.6] },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  if (!series) return null

  const { points, settledCount } = series
  const values = points.map((p) => p.cum)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const innerW = W - PAD_X * 2
  const innerH = H - PAD_Y * 2
  const xAt = (i) => PAD_X + (i / (points.length - 1)) * innerW
  const yAt = (v) => PAD_Y + (1 - (v - min) / range) * innerH

  const final = values[values.length - 1]
  const positive = final >= 0
  const accent = positive ? '#10b981' : '#f43f5e'
  const gradId = positive ? 'capitalGradUp' : 'capitalGradDown'

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(p.cum).toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L${xAt(points.length - 1).toFixed(2)},${(H - PAD_Y).toFixed(2)} L${xAt(0).toFixed(2)},${(H - PAD_Y).toFixed(2)} Z`

  const zeroInRange = min < 0 && max > 0
  const zeroY = yAt(0)
  const dotLeftPct = (xAt(points.length - 1) / W) * 100
  const dotTopPct = (yAt(final) / H) * 100
  const haloColor = positive ? 'rgba(16, 185, 129, 0.22)' : 'rgba(244, 63, 94, 0.22)'

  return (
    <div
      ref={containerRef}
      className={`capital-curve glow-card bg-white rounded-2xl border border-stone-100 p-4 md:p-5 mb-4${
        revealed ? ' is-revealed' : ''
      }`}
    >
      <div className="flex items-end justify-between gap-3 mb-1.5">
        <div>
          <div className="text-sm font-medium text-stone-700">资金累计曲线</div>
          <div className="text-xs text-stone-400 mt-0.5">共 {settledCount} 笔已结算 · 累计净盈亏</div>
        </div>
        <div className="text-right leading-tight">
          <div
            className={`text-2xl font-semibold tabular-nums capital-curve-figure ${
              positive ? 'text-emerald-600' : 'text-rose-500'
            }`}
          >
            {revealed ? <CountUp value={final} format={toRmb} duration={1400} /> : toRmb(0)}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">净盈亏 · 累计</div>
        </div>
      </div>

      <div className="capital-curve-plot">
        <svg
          className="capital-curve-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`资金累计净盈亏 ${toRmb(final)}`}
        >
          <defs>
            <linearGradient id="capitalGradUp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="capitalGradDown" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
            </linearGradient>
          </defs>
          {zeroInRange && (
            <line
              className="capital-curve-zero"
              x1={PAD_X}
              y1={zeroY}
              x2={W - PAD_X}
              y2={zeroY}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path className="capital-curve-area" d={areaPath} fill={`url(#${gradId})`} />
          <path
            className="capital-curve-line"
            d={linePath}
            pathLength="1"
            fill="none"
            stroke={accent}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="capital-curve-dot"
          style={{
            left: `${dotLeftPct}%`,
            top: `${dotTopPct}%`,
            background: accent,
            boxShadow: `0 0 0 4px ${haloColor}`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
