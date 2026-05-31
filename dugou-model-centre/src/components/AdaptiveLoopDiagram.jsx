import { Fragment, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ChevronRight,
  ClipboardCheck,
  RefreshCw,
  SlidersHorizontal,
  Target,
} from 'lucide-react'
import { isPreviewMode } from '../lib/displayMode'

/**
 * AdaptiveLoopDiagram — the 「闭环故事」 illustration for the adaptive-weight
 * card. It makes the self-improvement loop legible at a glance:
 *
 *   结算反馈 → 梯度学习 → 权重微调 → 预测进化 ↻ (回流到下一轮)
 *
 * Two real figures are woven into the nodes (sample count + cumulative
 * weight updates) so the picture stays honest rather than decorative.
 *
 * Restraint:
 *   - The flow "trace" (a single L→R sheen) plays ONCE, the first time the
 *     diagram scrolls into view — earned by the scroll, not gratuitous.
 *     After it resolves the diagram rests static.
 *   - The one-time coachmark is preview/demo only (so power users in FULL
 *     mode are never hand-held) and shows once per session (sessionStorage),
 *     spending the last of the demo's auto-popup budget.
 *   - prefers-reduced-motion: no sheen, no coach entrance animation — the
 *     diagram and (if applicable) the coach appear at their resting state.
 */

const SESSION_COACH_KEY = 'dugou.adaptive_loop_coach.v1'
const COACH_VISIBLE_MS = 5850
const TRACE_MS = 1500 // matches the sheen animation; drop the class after

const alreadyCoachedThisSession = () => {
  try {
    return window.sessionStorage.getItem(SESSION_COACH_KEY) === '1'
  } catch {
    return false
  }
}

const markCoachedThisSession = () => {
  try {
    window.sessionStorage.setItem(SESSION_COACH_KEY, '1')
  } catch {
    /* sessionStorage unavailable — fail silent */
  }
}

// Four stages of the loop. Each accent steps the hue forward so the eye
// reads a progression around the ring. `sub` may consume the live figures.
const NODES = [
  {
    icon: ClipboardCheck,
    title: '结算反馈',
    sub: (d) => `${d.sampleCount} 样本`,
    color: '#059669',
    bg: '#ecfdf5',
  },
  {
    icon: Activity,
    title: '梯度学习',
    sub: () => '在线 GD',
    color: '#4f46e5',
    bg: '#eef2ff',
  },
  {
    icon: SlidersHorizontal,
    title: '权重微调',
    sub: (d) => `${d.updateCount} 次`,
    color: '#d97706',
    bg: '#fffbeb',
  },
  {
    icon: Target,
    title: '预测进化',
    sub: () => '误差 ↓',
    color: '#7c3aed',
    bg: '#f5f3ff',
  },
]

export default function AdaptiveLoopDiagram({ sampleCount = 0, updateCount = 0 }) {
  const data = { sampleCount, updateCount }
  const containerRef = useRef(null)
  const firedRef = useRef(false)
  const [tracing, setTracing] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)

  // Fire once when the loop scrolls into view: trace the flow and — in
  // preview mode, once per session — float the coachmark.
  useEffect(() => {
    const el = containerRef.current
    if (!el || firedRef.current) return undefined

    const fire = () => {
      if (firedRef.current) return
      firedRef.current = true
      setTracing(true)
      if (isPreviewMode() && !alreadyCoachedThisSession()) {
        markCoachedThisSession()
        setCoachOpen(true)
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      fire()
      return undefined
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.35)) {
          fire()
          obs.disconnect()
        }
      },
      { threshold: [0, 0.35, 0.6] },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Retire the trace class once the sheen has swept through.
  useEffect(() => {
    if (!tracing) return undefined
    const t = window.setTimeout(() => setTracing(false), TRACE_MS)
    return () => window.clearTimeout(t)
  }, [tracing])

  // Auto-dismiss the coachmark.
  useEffect(() => {
    if (!coachOpen) return undefined
    const t = window.setTimeout(() => setCoachOpen(false), COACH_VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [coachOpen])

  return (
    <div className="adaptive-loop" ref={containerRef}>
      <div className="adaptive-loop-head">
        <span className="adaptive-loop-badge" aria-hidden="true">
          <RefreshCw size={11} />
        </span>
        <span className="adaptive-loop-title">自适应闭环</span>
        <span className="adaptive-loop-caption">
          每次结算都回流进模型，让权重持续自我校准
        </span>
      </div>

      <div className={`adaptive-loop-track${tracing ? ' is-tracing' : ''}`}>
        <span className="adaptive-loop-sweep" aria-hidden="true" />
        <div className="adaptive-loop-nodes">
          {NODES.map((node, i) => {
            const Icon = node.icon
            return (
              <Fragment key={node.title}>
                <div className="adaptive-loop-node">
                  <span
                    className="adaptive-loop-node-icon"
                    style={{ color: node.color, background: node.bg }}
                  >
                    <Icon size={14} />
                  </span>
                  <span className="adaptive-loop-node-title">{node.title}</span>
                  <span className="adaptive-loop-node-sub">{node.sub(data)}</span>
                </div>
                {i < NODES.length - 1 && (
                  <span className="adaptive-loop-arrow" aria-hidden="true">
                    <ChevronRight size={14} />
                  </span>
                )}
              </Fragment>
            )
          })}
        </div>
        <span className="adaptive-loop-return" aria-hidden="true">
          <span className="adaptive-loop-return-label">↻ 回流到下一轮</span>
        </span>
      </div>

      {coachOpen && (
        <div
          className="adaptive-loop-coach"
          role="status"
          onClick={() => setCoachOpen(false)}
        >
          <span className="adaptive-loop-coach-spark" aria-hidden="true">
            ✦
          </span>
          这是模型的自我进化闭环——你每记录一场结算，都会沿环回流，让预测一点点更懂你。
        </div>
      )}
    </div>
  )
}
