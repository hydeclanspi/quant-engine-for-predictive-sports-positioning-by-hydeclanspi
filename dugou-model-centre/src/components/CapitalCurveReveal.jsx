import { useEffect, useMemo, useRef, useState } from 'react'
import CountUp from './CountUp'
import { isPreviewMode } from '../lib/displayMode'

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
const PAD_X = 8 // left inset — the curve starts a hair off the edge
const PAD_R = 3 // right inset — kept tight so the line reaches close to the edge
const PAD_Y = 16

// Visible hero figure: signed amount only (no currency glyph) — the unit
// "rmb" is rendered separately as a smaller, muted suffix so the number itself
// stays the headline. e.g. +960 / −1,240 / 0
const toSignedNumber = (n) => {
  const v = Math.round(Number(n) || 0)
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return `${sign}${Math.abs(v).toLocaleString('en-US')}`
}

// Full spoken string for the SVG aria-label (keeps the unit inline). e.g. +960 rmb
const toRmb = (n) => `${toSignedNumber(n)} rmb`

// ── Preview-only synthetic equity path ──────────────────────────────────
// A deterministic (seeded → no flicker between renders) equity curve used
// ONLY in demo/preview mode. The real seeded sample happens to climb almost
// monotonically, which reads as an unrealistically smooth line — so for the
// demo we MODEL an honest betting journey instead.
//
// The shape is generated, not drawn: a seeded bet-by-bet Monte-Carlo
// (decimal odds, occasional conviction stakes, win prob = 1/odds with
// regime-switching luck) yields a genuinely jagged P&L walk, which we then lay
// over a "climb → plateau → breakout" drift envelope. The result spirals
// upward, suffers one deep mid-run drawdown that retraces past the prior leg,
// and finally breaks out to a fresh high. The whole path is affine-pinned to
// start at 0 and END EXACTLY on `peak` (the REAL cumulative figure) — only the
// in-between shape is dramatised; the headline number stays truthful.
const makeRng = (seed) => {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// Smoothstep ramp 0→1 across [a, b] (Hermite; zero slope at both ends).
const smoothstep = (u, a, b) => {
  if (u <= a) return 0
  if (u >= b) return 1
  const t = (u - a) / (b - a)
  return t * t * (3 - 2 * t)
}

// Deterministic drift envelope: a confident first climb, a flat consolidation
// plateau (where the deep drawdown lives, un-masked by any rising trend), then
// a decisive breakout leg to the final high. Spans 0 → 1.
//
// The plateau sits at 0.46 (not 0.40): because the walk is range-normalised, its
// deepest point IS the mid-run trough, so the plateau height alone positions that
// trough relative to break-even. The curve starts exactly on the zero line and
// the tiny first-bet dip pins that line near the plot floor, so the trough has to
// be lifted a clear ~5px clear of it to read as "doesn't touch" — 0.46 puts the
// trough ≈ +50 (a comfortable, visible gap) while the drawdown keeps its full
// peak-to-trough depth (~56% of final; the whole band rises together, the dip is
// just as deep). The breakout leg is 0.54 so the envelope still lands on 1.
const driftBase = (u) => 0.46 * smoothstep(u, 0, 0.26) + 0.54 * smoothstep(u, 0.54, 1)

const buildDemoCapitalSeries = (count, peak) => {
  const P = peak
  const N = Math.max(48, count) // plenty of points → an honestly jagged staircase
  const rng = makeRng(0x77beef)

  // Regime-switching "luck": a small edge added to / subtracted from the
  // break-even win prob over windows in u. Negative windows are cold streaks
  // that carve drawdowns; the late positive window powers the closing breakout.
  const regimes = [
    [0.1, 0.16, -0.14], // early stumble
    [0.3, 0.5, -0.22], // the deep mid-run drawdown
    [0.58, 0.66, 0.1], // recovery bounce
    [0.8, 0.96, 0.16], // closing breakout
  ]
  const edgeAt = (u) => {
    let e = 0
    for (const [a, b, s] of regimes) if (u >= a && u <= b) e += s
    return e
  }

  // 1) Bet-by-bet Monte-Carlo → a jagged cumulative P&L walk `w` (length N+1).
  const w = [0]
  let cum = 0
  for (let k = 0; k < N; k += 1) {
    const u = k / (N - 1)
    const odds = 1.55 + rng() ** 1.7 * 1.9 // decimal odds, skewed toward favourites
    const stake = rng() < 0.15 ? 1 + rng() * 1.7 : 0.7 + rng() * 0.6 // occasional conviction
    const p = Math.min(0.94, Math.max(0.04, 1 / odds + edgeAt(u)))
    cum += rng() < p ? stake * (odds - 1) : -stake
    w.push(cum)
  }

  // 2) Normalise the walk to unit range so its amplitude is seed-independent.
  const wMin = Math.min(...w)
  const wMax = Math.max(...w)
  const wRange = wMax - wMin || 1

  // 3) Lay the jagged walk (amplitude AMP) over the drift envelope, then affine-
  //    pin so the path starts at 0 and ends exactly on `peak`. The +1 the
  //    envelope contributes at u=1 keeps the denominator robust (no blow-ups),
  //    and the breakout leg makes the final point the global high (dot at top).
  const AMP = 0.5
  const shaped = w.map((v, i) => driftBase(i / N) + AMP * (v / wRange))
  const span = shaped[N] - shaped[0] || 1
  const points = shaped.map((v) => ({ cum: Math.round(((v - shaped[0]) / span) * P) }))
  points[0] = { cum: 0 } // anchor at break-even
  points[points.length - 1] = { cum: Math.round(P) } // land exactly on the honest figure
  return points
}

export default function CapitalCurveReveal({ investments, compact = false }) {
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

    // Demo/preview only: replace the (near-monotonic) sample path with a
    // realistic spiral-upward equity curve that still ENDS on the exact same
    // honest cumulative figure. Live data is never reshaped; the headline
    // 净盈亏 and 已结算 count are identical either way.
    if (isPreviewMode() && cum > 0) {
      return { points: buildDemoCapitalSeries(settled.length, cum), settledCount: settled.length }
    }

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
  const innerW = W - PAD_X - PAD_R
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
      className={`capital-curve glow-card bg-white rounded-2xl border border-stone-100 ${
        compact ? 'is-compact p-4' : 'p-4 md:p-5 mb-4'
      }${revealed ? ' is-revealed' : ''}`}
    >
      <div className={`flex items-start justify-between gap-3 ${compact ? 'mb-1' : 'mb-1.5'}`}>
        <div className="min-w-0">
          <div className={`font-medium text-stone-700 ${compact ? 'text-[13px]' : 'text-sm'}`}>
            资金累计曲线
          </div>
          <div className={`text-stone-400 ${compact ? 'text-[11px]' : 'text-xs mt-0.5'}`}>
            共 {settledCount} 笔已结算 · 累计净盈亏
          </div>
        </div>
        <div className="text-right leading-none">
          <div
            className={`capital-curve-figure ${
              compact ? 'text-[18px]' : 'text-[22px]'
            }${positive ? '' : ' is-down'}`}
          >
            {/* Playfair's numerals are proportional (no tabular feature), so the
                width would dance as CountUp ticks. A hidden "ghost" of the final
                value reserves the box width; the live number is absolutely
                right-aligned inside it, pinning the right edge + the rmb unit so
                only the digits redistribute internally — no layout jitter. */}
            <span className="capital-curve-num">
              <span className="capital-curve-num-ghost" aria-hidden="true">{toSignedNumber(final)}</span>
              <span className="capital-curve-num-live">
                {revealed ? (
                  <CountUp value={final} format={toSignedNumber} duration={compact ? 1100 : 1400} />
                ) : (
                  toSignedNumber(0)
                )}
              </span>
            </span>
            <span className="capital-curve-unit">rmb</span>
          </div>
          {!compact && <div className="text-[11px] text-stone-400 mt-1.5">净盈亏 · 累计</div>}
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
              x2={W - PAD_R}
              y2={zeroY}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path className="capital-curve-area" d={areaPath} fill={`url(#${gradId})`} />
          <path
            className="capital-curve-line"
            d={linePath}
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
