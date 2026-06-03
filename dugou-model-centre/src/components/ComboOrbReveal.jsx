import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * ComboOrbReveal —「聚光环揭幕」生成揭晓礼（仅演示态 + 允许动效时挂载）。
 *
 * 点击「生成」后，外层把 Hero 卡夹成一张居中、约「第一眼可视面积」的紧凑卡，
 * 本组件在其垂直中央播放一枚聚光进度环（蒙特卡洛意象）：环从 0→100 缓缓填满，
 * 中央百分比同步跳动，下方阶段文案交替淡入。环满后轻轻「绽放」一下，随即回调
 * onComplete；外层量取卡片自然高度、把卡片丝滑「拉长」揭晓结果，本层同时轻盈隐去。
 *
 * 设计要点：
 * - 焦点盒固定高度 = compactPx（由外层传入），把环钉在紧凑卡的垂直中央，
 *   故拉长揭晓时环不会随卡片增高而漂移。
 * - 任意点击 = 跳过：与自然完成共用一个一次性 finish 守卫，避免重复回调。
 * - 尊重 prefers-reduced-motion：直接定格 100% 后立即收尾。
 */

// 整体节奏较初版放慢 1.4×（原 980 / 340ms），让聚光环从容一些、不显仓促。
const ORB_COMPUTE_MS = 1372 // 环从 0 填到 100 的时长（980 × 1.4）
const ORB_BLOOM_MS = 476 // 环满后「绽放」并停顿、再回调 onComplete 的时长（340 × 1.4）
const ORB_RADIUS = 30
const ORB_C = 2 * Math.PI * ORB_RADIUS // 环周长 ≈ 188.4956
const ORB_STAGES = ['扫描相关性结构', '蒙特卡洛模拟', '求解最优配额']

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export default function ComboOrbReveal({ compactPx = 500, leaving = false, onComplete, onSkip }) {
  const [pct, setPct] = useState(0)
  const [bloom, setBloom] = useState(false)
  const [nudgeY, setNudgeY] = useState(0)
  const finishedRef = useRef(false)
  const coreRef = useRef(null)

  // 自然完成与「点击跳过」共用：一次性守卫，先到先得，另一路静默丢弃。
  const finish = (via) => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (via === 'skip') onSkip?.()
    else onComplete?.()
  }

  // 紧凑卡的 clamp 是瞬时的（computing 阶段不挂过渡），故组件一挂载，
  // 卡片已被夹成紧凑高度——此刻量取环心真实视口坐标，在首帧绘制「前」
  // 把焦点盒整体竖向轻推到视口正中。useLayoutEffect 同步执行、且不依赖
  // requestAnimationFrame/setTimeout，既不被预览端节流影响，也不会产生可见滑动；
  // 由此修正外层量算紧凑高度时所取卡片 top 与真实落定 top 间的系统性误差，
  // 让聚光环始终精确钉在「第一眼」屏幕中央，而非整张高卡的几何中心。
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return
    const core = coreRef.current
    if (!core) return
    const rect = core.getBoundingClientRect()
    const coreCenter = rect.top + rect.height / 2
    const viewportCenter = ((typeof window !== 'undefined' && window.innerHeight) || 900) / 2
    const delta = viewportCenter - coreCenter
    if (Math.abs(delta) > 1.5) setNudgeY(delta)
    // 仅挂载量一次：偏移按真实测量一次性补偿，发生在 paint 前故肉眼不可见。
  }, [])

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPct(100)
      const t = window.setTimeout(() => finish('complete'), 160)
      return () => window.clearTimeout(t)
    }
    let raf = 0
    let bloomTimer = 0
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ORB_COMPUTE_MS)
      const eased = 1 - Math.pow(1 - t, 2.2) // 先快后慢，收口从容
      setPct(Math.round(eased * 100))
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        setPct(100)
        setBloom(true)
        bloomTimer = window.setTimeout(() => finish('complete'), ORB_BLOOM_MS)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(bloomTimer)
    }
    // 仅挂载时跑一轮；外层用 key={revealRunId} 强制重挂以「重开一轮」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stageIdx = pct < 38 ? 0 : pct < 76 ? 1 : 2
  const dashoffset = ORB_C - (ORB_C * pct) / 100

  return (
    <div
      className={`combo-orb${leaving ? ' is-leaving' : ''}`}
      onClick={() => finish('skip')}
      role="presentation"
      aria-hidden="true"
    >
      <div
        className="combo-orb-focus"
        style={{ height: `${compactPx}px`, transform: nudgeY ? `translateY(${nudgeY}px)` : undefined }}
      >
        <div ref={coreRef} className={`combo-orb-core${bloom ? ' is-bloom' : ''}`}>
          <svg className="combo-orb-ring" viewBox="0 0 72 72" width="72" height="72">
            <defs>
              <linearGradient id="comboOrbGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
            <circle className="combo-orb-track" cx="36" cy="36" r={ORB_RADIUS} />
            <circle
              className="combo-orb-arc"
              cx="36"
              cy="36"
              r={ORB_RADIUS}
              transform="rotate(-90 36 36)"
              style={{ strokeDasharray: ORB_C, strokeDashoffset: dashoffset }}
            />
          </svg>
          <div className="combo-orb-pct">{pct}</div>
          <span className="combo-orb-unit">%</span>
        </div>
        <div className="combo-orb-stage" key={stageIdx}>
          {ORB_STAGES[stageIdx]}
        </div>
        <div className="combo-orb-skip">点击跳过</div>
      </div>
    </div>
  )
}
