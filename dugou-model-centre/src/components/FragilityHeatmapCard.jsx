import { useMemo, useState } from 'react'
import { Activity, TrendingUp, X } from 'lucide-react'
import { assessComboFragility, getOddsBand } from '../lib/analytics'
import { getInvestments } from '../lib/localData'

const getMedian = (values = []) => {
  const nums = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  if (nums.length % 2 === 1) return nums[mid]
  return (nums[mid - 1] + nums[mid]) / 2
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const getPercentile = (sortedValues = [], p = 0.5) => {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return Number.NaN
  const pos = clamp(Number(p) * (sortedValues.length - 1), 0, sortedValues.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedValues[lo]
  const t = pos - lo
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * t
}

const formatSigned = (value, digits = 1, suffix = '') => {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${num > 0 ? '+' : ''}${num.toFixed(digits)}${suffix}`
}

const resolveDeltaSurvival = (premium = null) => {
  const pFailA = Number(premium?.pFailA)
  const pFailB = Number(premium?.pFailB)
  const pFailBothObserved = Number(premium?.pFailBothObserved)
  if (!(Number.isFinite(pFailA) && Number.isFinite(pFailB) && Number.isFinite(pFailBothObserved))) {
    return { aToB: Number.NaN, bToA: Number.NaN, pair: Number.NaN }
  }

  const condFailBGivenA = pFailA > 1e-6 ? clamp(pFailBothObserved / pFailA, 0, 1) : Number.NaN
  const condFailAGivenB = pFailB > 1e-6 ? clamp(pFailBothObserved / pFailB, 0, 1) : Number.NaN
  // MSI adopts survival-direction semantics:
  // positive => improves survival (reduces conditional fail risk),
  // negative => harms survival (raises conditional fail risk).
  const deltaAtoB = Number.isFinite(condFailBGivenA) ? pFailB - condFailBGivenA : Number.NaN
  const deltaBtoA = Number.isFinite(condFailAGivenB) ? pFailA - condFailAGivenB : Number.NaN

  const finite = [deltaAtoB, deltaBtoA].filter((v) => Number.isFinite(v))
  const pair = finite.length > 0 ? finite.reduce((sum, v) => sum + v, 0) / finite.length : Number.NaN
  return { aToB: deltaAtoB, bToA: deltaBtoA, pair }
}

const getRiskLevelByScore = (score) => {
  const s = Number(score)
  if (!Number.isFinite(s)) return 'low'
  if (s > 60) return 'critical'
  if (s > 40) return 'high'
  if (s > 25) return 'medium'
  return 'low'
}

/**
 * 依赖风险矩阵智能 — 冰裂共振评分热力图
 *
 * 全幅矩阵 · 品牌色系 · 模块化详情面板
 */
export function FragilityHeatmapCard({ matches = [], expandedPair = null, onSelectPair = null }) {
  const [mappedViewEnabled, setMappedViewEnabled] = useState(true)

  // 历史数据缓存
  const historicalData = useMemo(() => {
    const investments = getInvestments()
    const settledInvestments = investments
      .filter(inv => {
        const matches = Array.isArray(inv.matches) ? inv.matches : []
        if (matches.length < 2) return false
        const hasMatchResults = matches.some(m => typeof m.is_correct === 'boolean')
        const hasRevenues = inv.revenues !== undefined && inv.revenues !== null
        const isSettled = inv.status === 'win' || inv.status === 'lose' || inv.status === 'settled' || inv.status === 'settled_win' || inv.status === 'settled_loss'
        return hasMatchResults && (hasRevenues || isSettled)
      })
      .map(inv => {
        const matches = Array.isArray(inv.matches) ? inv.matches : []
        return {
          matches: matches.map(m => ({
            odds: Number(m.odds) || 1,
            result: typeof m.is_correct === 'boolean' ? m.is_correct : undefined,
          })),
          succeeded: Number(inv.revenues || 0) > 0 || inv.status === 'settled_win' || inv.status === 'win',
          createdAt: inv.created_at || inv.createdAt || new Date().toISOString(),
        }
      })
      .filter(d => d.matches.length >= 2 && d.matches.some(m => m.result !== undefined))
    return settledInvestments
  }, [])

  // 脆弱性矩阵计算 — 含完整 assessment 数据
  const fragilityMatrix = useMemo(() => {
    if (matches.length < 2) return []
    const result = []
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const assessment = assessComboFragility(
          [matches[i], matches[j]],
          historicalData
        )
        const pairAssessment = assessment.pairAnalysis?.[0]?.assessment || {}
        const score = assessment.overallFragility || 0
        const components = pairAssessment.components || null
        const delta = resolveDeltaSurvival(components?.premium)
        result.push({
          i,
          j,
          score: Number(score.toFixed(2)),
          riskLevel: pairAssessment.riskLevel || 'low',
          isSignificant: pairAssessment.isSignificant || false,
          confidence: pairAssessment.confidence || 0,
          // 完整数据用于详情面板
          components,
          deltaSurvival: Number.isFinite(delta.pair) ? Number(delta.pair.toFixed(4)) : Number.NaN,
          deltaSurvivalAToB: Number.isFinite(delta.aToB) ? Number(delta.aToB.toFixed(4)) : Number.NaN,
          deltaSurvivalBToA: Number.isFinite(delta.bToA) ? Number(delta.bToA.toFixed(4)) : Number.NaN,
        })
      }
    }

    // ─── Sigmoid 映射增强 ───
    // 输出范围 [0, 89]，可触及边界但不超过89
    // anchor = 中位数（数据驱动），k = 自适应斜率（基于 IQR）
    const rawScores = result
      .map((pair) => Number(pair.score))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
    if (rawScores.length <= 1) {
      return result.map((pair) => ({ ...pair, mappedScore: pair.score }))
    }

    const anchor = getPercentile(rawScores, 0.5) // 中位数作为锚点
    const q25 = getPercentile(rawScores, 0.25)
    const q75 = getPercentile(rawScores, 0.75)
    const iqr = Math.max(q75 - q25, 1e-6) // 四分位距
    // k 自适应：IQR 越大说明数据分散，k 越小（曲线越平缓）
    // 目标：IQR 内的分数大致映射到 sigmoid 的 25%~75% 区间
    // sigmoid(k*iqr/2) ≈ 0.73 → k*iqr/2 ≈ 1.0 → k ≈ 2.0/iqr
    const k = 2.0 / iqr
    const MAX_OUTPUT = 89

    return result.map((pair) => {
      const raw = Number(pair.score)
      if (!Number.isFinite(raw)) return { ...pair, mappedScore: pair.score }
      const sigmoid = 1 / (1 + Math.exp(-k * (raw - anchor)))
      const mapped = Math.min(Math.max(sigmoid * MAX_OUTPUT, 0), MAX_OUTPUT)
      return {
        ...pair,
        mappedScore: Number(mapped.toFixed(2)),
      }
    })
  }, [matches, historicalData])

  const displayFragilityMatrix = useMemo(
    () =>
      fragilityMatrix.map((pair) => ({
        ...pair,
        displayScore:
          mappedViewEnabled && Number.isFinite(pair.mappedScore)
            ? pair.mappedScore
            : pair.score,
      })),
    [fragilityMatrix, mappedViewEnabled],
  )

  const resolvedExpandedPair = useMemo(() => {
    if (!expandedPair) return null
    const found = displayFragilityMatrix.find(
      (pair) =>
        (pair.i === expandedPair.i && pair.j === expandedPair.j) ||
        (pair.i === expandedPair.j && pair.j === expandedPair.i),
    )
    return found || expandedPair
  }, [expandedPair, displayFragilityMatrix])

  const selectedAxisSet = useMemo(() => {
    if (!resolvedExpandedPair) return null
    const i = Number(resolvedExpandedPair.i)
    const j = Number(resolvedExpandedPair.j)
    if (!Number.isInteger(i) || !Number.isInteger(j)) return null
    return new Set([i, j])
  }, [resolvedExpandedPair])

  // 行标题高亮 pair.i, 列标题高亮 pair.j
  const selectedRowIdx = resolvedExpandedPair != null ? Number(resolvedExpandedPair.i) : null
  const selectedColIdx = resolvedExpandedPair != null ? Number(resolvedExpandedPair.j) : null

  // ─── 品牌色系 — 10段细分光谱 ───
  // 翡翠 → 薄荷 → 青绿 → 天蓝 → 钴蓝 → 靛蓝 → 紫罗兰 → 香槟金 → 银灰 → 深岩
  const getHeatStyle = (score) => {
    // 0-10: 翡翠 Emerald — 最安全，清新透亮
    if (score < 10) return {
      bg: 'bg-gradient-to-br from-emerald-50/90 to-green-50/70',
      border: 'border-emerald-200/50',
      text: 'text-emerald-700',
      glow: '',
      dot: 'from-emerald-200 to-emerald-300 border-emerald-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #d1fae5, #a7f3d0 35%, #6ee7b7 65%, #34d399)',
      orbShadow: '0 0 14px 2px rgba(52,211,153,0.28)',
    }
    // 10-20: 薄荷 Mint — 清凉微甜
    if (score < 20) return {
      bg: 'bg-gradient-to-br from-emerald-50/85 to-teal-50/70',
      border: 'border-teal-200/50',
      text: 'text-teal-700',
      glow: '',
      dot: 'from-teal-200 to-teal-300 border-teal-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #ccfbf1, #99f6e4 35%, #5eead4 65%, #2dd4bf)',
      orbShadow: '0 0 14px 2px rgba(45,212,191,0.28)',
    }
    // 20-30: 青绿 Teal → Cyan — 过渡到冷调
    if (score < 30) return {
      bg: 'bg-gradient-to-br from-teal-50/85 to-cyan-50/70',
      border: 'border-cyan-200/50',
      text: 'text-teal-700',
      glow: '',
      dot: 'from-cyan-200 to-cyan-300 border-cyan-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #cffafe, #a5f3fc 35%, #67e8f9 65%, #22d3ee)',
      orbShadow: '0 0 14px 2px rgba(34,211,238,0.28)',
    }
    // 30-38: 天蓝 Sky — 清澈开阔
    if (score < 38) return {
      bg: 'bg-gradient-to-br from-sky-50/90 to-cyan-50/70',
      border: 'border-sky-200/50',
      text: 'text-sky-700',
      glow: '',
      dot: 'from-sky-200 to-sky-300 border-sky-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #bae6fd, #7dd3fc 35%, #38bdf8 65%, #0ea5e9)',
      orbShadow: '0 0 14px 2px rgba(14,165,233,0.28)',
    }
    // 38-46: 钴蓝 Cobalt — 深邃沉稳
    if (score < 46) return {
      bg: 'bg-gradient-to-br from-sky-50/85 to-blue-50/65',
      border: 'border-blue-200/50',
      text: 'text-blue-700',
      glow: 'shadow-[0_0_10px_-4px_rgba(59,130,246,0.15)]',
      dot: 'from-blue-200 to-blue-300 border-blue-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #bfdbfe, #93c5fd 35%, #60a5fa 65%, #3b82f6)',
      orbShadow: '0 0 14px 2px rgba(59,130,246,0.28)',
    }
    // 46-54: 靛蓝 Indigo — 神秘张力
    if (score < 54) return {
      bg: 'bg-gradient-to-br from-indigo-50/85 to-violet-50/55',
      border: 'border-indigo-200/50',
      text: 'text-indigo-700',
      glow: 'shadow-[0_0_12px_-4px_rgba(99,102,241,0.18)]',
      dot: 'from-indigo-200 to-indigo-300 border-indigo-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #c7d2fe, #a5b4fc 35%, #818cf8 65%, #6366f1)',
      orbShadow: '0 0 14px 2px rgba(99,102,241,0.28)',
    }
    // 54-64: 紫罗兰 Violet — 优雅深沉
    if (score < 64) return {
      bg: 'bg-gradient-to-br from-violet-50/80 to-purple-50/55',
      border: 'border-violet-200/50',
      text: 'text-violet-700',
      glow: 'shadow-[0_0_12px_-4px_rgba(139,92,246,0.18)]',
      dot: 'from-violet-200 to-violet-300 border-violet-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #ddd6fe, #c4b5fd 35%, #a78bfa 65%, #8b5cf6)',
      orbShadow: '0 0 14px 2px rgba(139,92,246,0.28)',
    }
    // 64-76: 香槟金 Champagne — 精英叙事
    if (score < 76) return {
      bg: 'bg-gradient-to-br from-amber-50/70 to-yellow-50/50',
      border: 'border-amber-200/50',
      text: 'text-amber-700',
      glow: 'shadow-[0_0_12px_-4px_rgba(245,158,11,0.18)]',
      dot: 'from-amber-200 to-amber-300 border-amber-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #fef3c7, #fde68a 35%, #fbbf24 65%, #f59e0b)',
      orbShadow: '0 0 14px 2px rgba(245,158,11,0.28)',
    }
    // 76-88: 银灰 Silver — 冷静克制
    if (score < 88) return {
      bg: 'bg-gradient-to-br from-slate-50/90 to-stone-50/70',
      border: 'border-slate-200/60',
      text: 'text-slate-700',
      glow: 'shadow-[0_0_14px_-4px_rgba(100,116,139,0.2)]',
      dot: 'from-slate-200 to-slate-300 border-slate-300/60',
      orb: 'radial-gradient(circle at 36% 36%, #f1f5f9, #e2e8f0 35%, #cbd5e1 65%, #94a3b8)',
      orbShadow: '0 0 14px 2px rgba(148,163,184,0.28)',
    }
    // 88-100: 深岩 Obsidian — 极端区域
    return {
      bg: 'bg-gradient-to-br from-slate-100/90 to-zinc-100/70',
      border: 'border-slate-300/60',
      text: 'text-slate-800',
      glow: 'shadow-[0_0_16px_-4px_rgba(71,85,105,0.25)]',
      dot: 'from-slate-300 to-slate-400 border-slate-400/60',
      orb: 'radial-gradient(circle at 36% 36%, #e2e8f0, #cbd5e1 30%, #94a3b8 55%, #64748b 80%, #475569)',
      orbShadow: '0 0 16px 3px rgba(71,85,105,0.3)',
    }
  }

  // 风险级别文字映射
  const getLevelLabel = (level) => {
    const map = { low: 'Low', medium: 'Moderate', high: 'Elevated', critical: 'High' }
    return map[level] || level
  }

  // 球队名
  const formatTeamName = (match, idx) => {
    if (match?.teamName && match.teamName.length > 0) return match.teamName
    return `Match ${idx + 1}`
  }

  // 统计
  const avgScore = displayFragilityMatrix.length > 0
    ? (displayFragilityMatrix.reduce((s, m) => s + m.displayScore, 0) / displayFragilityMatrix.length).toFixed(1)
    : '\u2014'
  const highRiskCount = displayFragilityMatrix.filter(m => m.displayScore > 40).length

  // ─── 空状态 ───
  if (matches.length < 2) {
    return (
      <div className="glow-card relative overflow-hidden rounded-2xl border border-stone-100 bg-white p-6">
        <div className="pointer-events-none absolute -top-20 -right-20 h-52 w-52 rounded-full bg-sky-100/30 blur-3xl" />
        <div className="relative flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-50 to-sky-100/80 border border-sky-200/50">
              <TrendingUp size={14} strokeWidth={2} className="text-sky-500" />
            </div>
            <h3 className="font-medium text-stone-700 tracking-tight">依赖风险矩阵智能</h3>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border border-sky-200/80 bg-[linear-gradient(120deg,rgba(224,242,254,0.86),rgba(255,255,255,0.9)_52%,rgba(224,242,254,0.84))] text-[11px] font-medium text-sky-700 tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_10px_22px_-18px_rgba(14,165,233,0.5)] backdrop-blur-[1px]">
            <Activity size={12} strokeWidth={1.9} className="text-sky-500" />
            冰裂共振评分 0-100%
          </span>
        </div>
        <p className="relative text-sm text-stone-400 leading-relaxed">
          {matches.length === 0
            ? '在 dataset 的结算积累中学习和进化。点击「生成最优组合」后，此处将展示比赛对之间的依赖风险与相关性分析'
            : '只有 1 场比赛，需要至少 2 场来分析依赖关系'}
        </p>
      </div>
    )
  }

  // ─── 详情面板 — 模块化几何非对称设计 ───
  const renderDetailPanel = () => {
    if (!resolvedExpandedPair) return null

    const matchA = matches[resolvedExpandedPair.i]
    const matchB = matches[resolvedExpandedPair.j]
    const nameA = formatTeamName(matchA, resolvedExpandedPair.i)
    const nameB = formatTeamName(matchB, resolvedExpandedPair.j)
    const oddsA = matchA?.odds?.toFixed(2) || '—'
    const oddsB = matchB?.odds?.toFixed(2) || '—'
    const detailScore = Number(resolvedExpandedPair.displayScore ?? resolvedExpandedPair.score ?? 0)
    const style = getHeatStyle(detailScore)
    const detailRiskLevel = getRiskLevelByScore(detailScore)

    // 从 components 中提取详细数据
    const premium = resolvedExpandedPair.components?.premium || {}
    const bias = resolvedExpandedPair.components?.bias || {}
    const adjusted = resolvedExpandedPair.components?.adjusted || {}

    const pFailA = premium.pFailA
    const pFailB = premium.pFailB
    const pFailBothObserved = premium.pFailBothObserved
    const pFailBothIndependent = premium.pFailBothIndependent
    const sampleSize = premium.sampleSize || 0
    const weightedSampleSize = Number(premium.weightedCount)
    const normalizedSampleBase = Number.isFinite(weightedSampleSize) && weightedSampleSize > 0
      ? weightedSampleSize
      : sampleSize
    const sampleBaseText = Number.isFinite(normalizedSampleBase)
      ? (Math.abs(normalizedSampleBase - Math.round(normalizedSampleBase)) < 0.01
          ? String(Math.round(normalizedSampleBase))
          : normalizedSampleBase.toFixed(3))
      : '—'
    const premiumValue = premium.premium
    const deltaSurvivalPair = resolvedExpandedPair.deltaSurvival
    const observedFailedCount = premium.observedFailedCount || 0
    const observedPartialMiss = premium.observedPartialMiss || 0
    const observedFullHit = Math.max(normalizedSampleBase - observedPartialMiss - observedFailedCount, 0)
    const bustRatePct = normalizedSampleBase > 0 && Number.isFinite(observedFailedCount) ? (observedFailedCount / normalizedSampleBase) * 100 : null
    const fullHitRatePct = normalizedSampleBase > 0 && Number.isFinite(observedFullHit) ? (observedFullHit / normalizedSampleBase) * 100 : null
    const matrixBustMedianPct = getMedian(
      fragilityMatrix.map((pair) => {
        const pairPremium = pair.components?.premium || {}
        const pairSample = Number(pairPremium.sampleSize)
        const pairWeighted = Number(pairPremium.weightedCount)
        const pairBase = Number.isFinite(pairWeighted) && pairWeighted > 0 ? pairWeighted : pairSample
        const pairBust = Number(pairPremium.observedFailedCount)
        if (!Number.isFinite(pairBase) || pairBase <= 0 || !Number.isFinite(pairBust)) return null
        return (pairBust / pairBase) * 100
      }),
    )
    const matrixFullHitMedianPct = getMedian(
      fragilityMatrix.map((pair) => {
        const pairPremium = pair.components?.premium || {}
        const pairSample = Number(pairPremium.sampleSize)
        const pairWeighted = Number(pairPremium.weightedCount)
        const pairBase = Number.isFinite(pairWeighted) && pairWeighted > 0 ? pairWeighted : pairSample
        const pairPartialMiss = Number(pairPremium.observedPartialMiss)
        const pairBust = Number(pairPremium.observedFailedCount)
        if (!Number.isFinite(pairBase) || pairBase <= 0 || !Number.isFinite(pairPartialMiss) || !Number.isFinite(pairBust)) return null
        const pairFullHit = Math.max(pairBase - pairPartialMiss - pairBust, 0)
        return (pairFullHit / pairBase) * 100
      }),
    )
    const hasBias = bias.hasBias || false
    const biasStrength = bias.biasStrength || 0
    const matchedExact = bias.investedInTarget || 0
    const matchedNeighbor = bias.investedInSimilar || 0
    const exactHalfHit = bias.exactPartialMiss || 0
    const neighborHalfHit = bias.neighborPartialMiss || 0
    const exactHalfHitRatePct = matchedExact > 0 ? (exactHalfHit / matchedExact) * 100 : null
    const neighborHalfHitRatePct = matchedNeighbor > 0 ? (neighborHalfHit / matchedNeighbor) * 100 : null
    const globalFailureRate = adjusted.globalFailureRate
    // Odds bands
    const bandA = matchA?.odds ? getOddsBand(matchA.odds) : null
    const bandB = matchB?.odds ? getOddsBand(matchB.odds) : null

    return (
      <div className="mx-6 mb-6 mt-1">
        {/* 面板外框 — 玻璃质感 */}
        <div className="relative overflow-hidden rounded-2xl border border-stone-200/60 bg-gradient-to-br from-white via-stone-50/40 to-sky-50/30 backdrop-blur-sm">
          {/* 背景装饰 */}
          <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-sky-100/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-indigo-50/15 blur-2xl" />

          {/* 顶栏 — 标题 + 关闭 */}
          <div className="relative flex items-center justify-between px-5 pt-4 pb-3">
            <div className="flex items-center gap-3">
              {/* 渐变光球 — 纯视觉情绪，分数在下方 Resonance 模块 */}
              <div
                className="h-11 w-11 rounded-full shrink-0"
                style={{ background: style.orb, boxShadow: style.orbShadow }}
              />
              <div>
                <p className="text-[13px] font-semibold text-stone-700 tracking-tight leading-tight">
                  {nameA}
                  <span className="mx-1.5 text-stone-300 font-normal">/</span>
                  {nameB}
                </p>
                <p className="text-[11px] text-stone-400 mt-0.5 tabular-nums">
                  {oddsA} / {oddsB}
                </p>
              </div>
            </div>
            <button
              onClick={() => onSelectPair?.(null)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-300 hover:text-stone-500 hover:bg-stone-100/80 transition-all duration-150"
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          {/* 核心指标网格 — 非对称模块布局 */}
          <div className="relative px-5 pb-4">
            {/* 第一行：左大右小的非对称布局 — 4模块 */}
            <div className="grid grid-cols-5 gap-2.5">

              {/* 主模块：共振评分 — 渐变文字 + 左侧色带 + 微光底色 + 进度条 */}
              {(() => {
                const s = detailScore
                const rs = s < 10  ? { gradient: 'linear-gradient(135deg, #059669, #34d399, #6ee7b7)', bar: 'linear-gradient(180deg, #a7f3d0, #059669)', bg: 'from-emerald-50/60 to-white', border: 'border-emerald-100/80', track: 'bg-emerald-100/60' }
                     : s < 20  ? { gradient: 'linear-gradient(135deg, #0d9488, #2dd4bf, #5eead4)', bar: 'linear-gradient(180deg, #99f6e4, #0d9488)', bg: 'from-teal-50/55 to-white', border: 'border-teal-100/75', track: 'bg-teal-100/60' }
                     : s < 30  ? { gradient: 'linear-gradient(135deg, #0891b2, #22d3ee, #67e8f9)', bar: 'linear-gradient(180deg, #a5f3fc, #0891b2)', bg: 'from-cyan-50/55 to-white', border: 'border-cyan-100/75', track: 'bg-cyan-100/60' }
                     : s < 38  ? { gradient: 'linear-gradient(135deg, #0284c7, #0ea5e9, #38bdf8)', bar: 'linear-gradient(180deg, #7dd3fc, #0284c7)', bg: 'from-sky-50/60 to-white', border: 'border-sky-100/80', track: 'bg-sky-100/60' }
                     : s < 46  ? { gradient: 'linear-gradient(135deg, #1e40af, #3b82f6, #60a5fa)', bar: 'linear-gradient(180deg, #93c5fd, #1e40af)', bg: 'from-blue-50/50 to-white', border: 'border-blue-100/70', track: 'bg-blue-100/60' }
                     : s < 54  ? { gradient: 'linear-gradient(135deg, #3730a3, #6366f1, #818cf8)', bar: 'linear-gradient(180deg, #a5b4fc, #3730a3)', bg: 'from-indigo-50/50 to-white', border: 'border-indigo-100/70', track: 'bg-indigo-100/60' }
                     : s < 64  ? { gradient: 'linear-gradient(135deg, #6d28d9, #8b5cf6, #a78bfa)', bar: 'linear-gradient(180deg, #c4b5fd, #6d28d9)', bg: 'from-violet-50/50 to-white', border: 'border-violet-100/70', track: 'bg-violet-100/60' }
                     : s < 76  ? { gradient: 'linear-gradient(135deg, #b45309, #f59e0b, #fbbf24)', bar: 'linear-gradient(180deg, #fde68a, #b45309)', bg: 'from-amber-50/50 to-white', border: 'border-amber-100/70', track: 'bg-amber-100/60' }
                     : s < 88  ? { gradient: 'linear-gradient(135deg, #475569, #64748b, #94a3b8)', bar: 'linear-gradient(180deg, #cbd5e1, #475569)', bg: 'from-slate-50/60 to-white', border: 'border-slate-100/80', track: 'bg-slate-100/60' }
                     :           { gradient: 'linear-gradient(135deg, #334155, #475569, #64748b)', bar: 'linear-gradient(180deg, #94a3b8, #334155)', bg: 'from-slate-100/70 to-white', border: 'border-slate-200/80', track: 'bg-slate-200/60' }
                return (
                  <div className={`col-span-2 relative rounded-xl bg-gradient-to-br ${rs.bg} border ${rs.border} p-3.5 overflow-hidden`}>
                    {/* 左侧竖色带 */}
                    <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: rs.bar }} />
                    <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2 pl-2">Resonance</p>
                    <div className="flex items-baseline gap-1 pl-2">
                      <span className="text-2xl font-bold tabular-nums leading-none" style={{ backgroundImage: rs.gradient, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>{detailScore.toFixed(2)}</span>
                      <span className="text-xs font-medium" style={{ backgroundImage: rs.gradient, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent', opacity: 0.7 }}>%</span>
                    </div>
                    {/* 寻光轨迹 — 光点 + 拖尾 + 细轨道 */}
                    {(() => {
                      // 非线性视觉映射 — 让大部分数据占2/3左右轨道
                      // 低分快升、中段平缓、高分收敛
                      const raw = Math.min(detailScore, 100)
                      const visualPos = raw < 10  ? 15 + raw * 2.0        // 0→15%, 10→35%
                        : raw < 20  ? 35 + (raw - 10) * 1.1              // 10→35%, 20→46%
                        : raw < 30  ? 46 + (raw - 20) * 0.8              // 20→46%, 30→54%
                        : raw < 38  ? 54 + (raw - 30) * 0.65             // 30→54%, 38→59.2%
                        : raw < 46  ? 59.2 + (raw - 38) * 0.6            // 38→59.2%, 46→64%
                        : raw < 54  ? 64 + (raw - 46) * 0.55             // 46→64%, 54→68.4%
                        : raw < 64  ? 68.4 + (raw - 54) * 0.5            // 54→68.4%, 64→73.4%
                        : raw < 76  ? 73.4 + (raw - 64) * 0.4            // 64→73.4%, 76→78.2%
                        : raw < 88  ? 78.2 + (raw - 76) * 0.35           // 76→78.2%, 88→82.4%
                        :             82.4 + (raw - 88) * 0.3             // 88→82.4%, 100→86%
                      const pos = Math.min(visualPos, 97)
                      const midColor = rs.gradient.match(/#[0-9a-fA-F]{6}/g)?.[1] || '#3b82f6'
                      return (
                        <div className="mt-3 pl-2 relative h-[3px]">
                          <div className={`absolute inset-0 rounded-full ${rs.track}`} />
                          <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${pos}%`, minWidth: '4px', background: `linear-gradient(90deg, transparent 0%, ${midColor}18 30%, ${midColor}60 100%)` }} />
                          {/* 切割宝石 — 八边形 + conic折射 + 辉光 */}
                          <div className="absolute top-1/2" style={{ left: `${pos}%`, transform: 'translate(-50%, -50%)' }}>
                            <div style={{
                              width: '11px',
                              height: '11px',
                              clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
                              background: `conic-gradient(from 0deg, ${midColor}ee, ${midColor}44, ${midColor}cc, ${midColor}33, ${midColor}dd, ${midColor}55, ${midColor}ee)`,
                              boxShadow: `0 0 10px 3px ${midColor}40, 0 0 4px 1px ${midColor}60`,
                            }} />
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              {/* 模块：Level — 渐变文字 + 左侧色带 + 微光背景 */}
              {(() => {
                const levelStyles = {
                  low: {
                    gradient: 'linear-gradient(135deg, #0284c7, #0ea5e9, #38bdf8)',
                    bar: 'linear-gradient(180deg, #7dd3fc, #0ea5e9)',
                    bg: 'from-sky-50/60 to-white',
                    border: 'border-sky-100/80',
                  },
                  medium: {
                    gradient: 'linear-gradient(135deg, #1e40af, #3b82f6, #60a5fa)',
                    bar: 'linear-gradient(180deg, #93c5fd, #2563eb)',
                    bg: 'from-blue-50/50 to-white',
                    border: 'border-blue-100/70',
                  },
                  high: {
                    gradient: 'linear-gradient(135deg, #3730a3, #6366f1, #818cf8)',
                    bar: 'linear-gradient(180deg, #a5b4fc, #4f46e5)',
                    bg: 'from-indigo-50/50 to-white',
                    border: 'border-indigo-100/70',
                  },
                  critical: {
                    gradient: 'linear-gradient(135deg, #6b21a8, #9333ea, #a855f7)',
                    bar: 'linear-gradient(180deg, #c4b5fd, #7c3aed)',
                    bg: 'from-purple-50/50 to-white',
                    border: 'border-purple-100/70',
                  },
                }
                const ls = levelStyles[detailRiskLevel] || levelStyles.low
                return (
                  <div className={`relative rounded-xl bg-gradient-to-br ${ls.bg} border ${ls.border} p-3.5 flex flex-col justify-between overflow-hidden`}>
                    {/* 左侧竖色带 */}
                    <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: ls.bar }} />
                    <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2 pl-2">Level</p>
                    <p className="text-lg font-bold capitalize leading-tight tracking-tight pl-2" style={{ backgroundImage: ls.gradient, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>{getLevelLabel(detailRiskLevel)}</p>
                  </div>
                )
              })()}

              {/* 模块：BUST (Total Miss) */}
              <div className="relative rounded-xl bg-gradient-to-br from-stone-50/80 to-white border border-stone-100/80 p-3.5 pb-7">
                <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2">BUST (Total Miss)</p>
                <p className="text-sm font-semibold text-stone-700 tabular-nums leading-tight">
                  {Number.isFinite(observedFailedCount) ? Number(observedFailedCount).toFixed(3) : observedFailedCount}<span className="text-[10px] font-normal text-stone-400"> / {sampleBaseText}</span>
                </p>
                <p className="text-[9px] text-stone-400 mt-1">pairs failed</p>
                <p className="absolute left-3.5 bottom-2 text-[9px] font-medium text-amber-400/90 tabular-nums">
                  今日矩阵中位 {Number.isFinite(matrixBustMedianPct) ? `${matrixBustMedianPct.toFixed(1)}%` : '—'}
                </p>
                <span className="absolute right-3.5 bottom-2 text-[10px] font-semibold tabular-nums text-sky-500/80 bg-sky-50/70 px-1.5 py-0.5 rounded-full">
                  {Number.isFinite(bustRatePct) ? bustRatePct.toFixed(0) : '—'}%
                </span>
              </div>

              {/* 模块：Full Hit (Sweep) */}
              <div className="relative rounded-xl bg-gradient-to-br from-stone-50/80 to-white border border-stone-100/80 p-3.5 pb-7">
                <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2">Full Hit (Sweep)</p>
                <p className="text-sm font-semibold text-stone-700 tabular-nums leading-tight">
                  {Number.isFinite(observedFullHit) ? Number(observedFullHit).toFixed(3) : observedFullHit}<span className="text-[10px] font-normal text-stone-400"> / {sampleBaseText}</span>
                </p>
                <p className="text-[9px] text-stone-400 mt-1">pairs won</p>
                <p className="absolute left-3.5 bottom-2 text-[9px] font-medium text-amber-400/90 tabular-nums">
                  今日矩阵中位 {Number.isFinite(matrixFullHitMedianPct) ? `${matrixFullHitMedianPct.toFixed(1)}%` : '—'}
                </p>
                <span className="absolute right-3.5 bottom-2 text-[10px] font-semibold tabular-nums text-sky-500/80 bg-sky-50/70 px-1.5 py-0.5 rounded-full">
                  {Number.isFinite(fullHitRatePct) ? fullHitRatePct.toFixed(0) : '—'}%
                </span>
              </div>
            </div>

            {/* 第二行：概率分析模块 — 左=Market Implied (内部分割含 Partial Miss 明细) | 右=Co-failure Rate */}
            {(Number.isFinite(pFailA) || Number.isFinite(premiumValue)) && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                {/* 左半：Market Implied + Partial Miss 内部分割 */}
                {Number.isFinite(pFailA) && Number.isFinite(pFailB) && (
                  <div className="rounded-xl bg-gradient-to-br from-sky-50/50 via-white to-cyan-50/30 border border-sky-100/60 p-3.5">
                    <div className="grid grid-cols-2 gap-3 h-full">
                      {/* 左子：Partial Miss (Split) */}
                      <div>
                        <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2.5">Partial Miss (Split)</p>
                        {bandA && bandB ? (
                          <div className="relative space-y-2 pb-3">
                            {/* Exact band matches */}
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-baseline gap-1">
                                  <span className="text-[9px] text-stone-400 uppercase tracking-wide font-medium">Exact</span>
                                  <span className="text-[8px] text-stone-300/80 tabular-nums">({bandA}×{bandB})</span>
                                </div>
                                <span className="text-[10px] font-semibold tabular-nums text-sky-500/80 bg-sky-50/70 px-1.5 py-0.5 rounded-full">{Number.isFinite(exactHalfHitRatePct) ? exactHalfHitRatePct.toFixed(0) : '—'}%</span>
                              </div>
                              <div className="flex items-end gap-2.5">
                                <div className="flex flex-col items-center">
                                  <span className="text-lg font-bold text-stone-700 tabular-nums leading-none">{matchedExact}</span>
                                  <span className="text-[8px] text-stone-400 font-medium mt-1 uppercase tracking-wider">hit</span>
                                </div>
                                <span className="text-stone-200 text-xs font-light mb-0.5">/</span>
                                <div className="flex flex-col items-center">
                                  <span className="text-[15px] font-semibold text-amber-600 tabular-nums leading-none">{exactHalfHit}</span>
                                  <span className="text-[8px] text-amber-500/75 font-medium mt-1 uppercase tracking-wider">half-hit</span>
                                </div>
                              </div>
                            </div>
                            <div className="h-px bg-sky-100/60" />
                            {/* Neighbor band matches */}
                            <div>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[9px] text-stone-400 uppercase tracking-wide font-medium">Neighbor</span>
                                <span className="text-[10px] font-semibold tabular-nums text-sky-500/80 bg-sky-50/70 px-1.5 py-0.5 rounded-full">{Number.isFinite(neighborHalfHitRatePct) ? neighborHalfHitRatePct.toFixed(0) : '—'}%</span>
                              </div>
                              <div className="flex items-end gap-2.5">
                                <div className="flex flex-col items-center">
                                  <span className="text-lg font-bold text-stone-700 tabular-nums leading-none">{matchedNeighbor}</span>
                                  <span className="text-[8px] text-stone-400 font-medium mt-1 uppercase tracking-wider">hit</span>
                                </div>
                                <span className="text-stone-200 text-xs font-light mb-0.5">/</span>
                                <div className="flex flex-col items-center">
                                  <span className="text-[15px] font-semibold text-amber-600 tabular-nums leading-none">{neighborHalfHit}</span>
                                  <span className="text-[8px] text-amber-500/75 font-medium mt-1 uppercase tracking-wider">half-hit</span>
                                </div>
                              </div>
                            </div>
                            <p className="absolute right-0 -bottom-1 text-[9px] text-stone-400">half-hit pairs</p>
                          </div>
                        ) : (
                          <p className="text-[10px] text-stone-300 italic">No odds data</p>
                        )}
                      </div>
                      {/* 右子：Market Implied Failure — 纵向堆叠（互换到右侧） */}
                      <div className="relative border-l border-sky-100/60 pl-3 flex flex-col">
                        <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-1">Market Implied</p>
                        <div className="flex-1 flex flex-col">
                          <div className="flex-1 flex flex-col justify-center">
                            <p className="text-[9px] text-stone-400 mb-0.5 truncate">{nameA}</p>
                            <p className="text-sm font-semibold text-sky-700 tabular-nums">{(pFailA * 100).toFixed(1)}%</p>
                          </div>
                          <div className="h-px bg-sky-100/80" />
                          <div className="flex-1 flex flex-col justify-center pt-0.5">
                            <p className="text-[9px] text-stone-400 mb-0.5 truncate">{nameB}</p>
                            <p className="text-sm font-semibold text-sky-700 tabular-nums">{(pFailB * 100).toFixed(1)}%</p>
                          </div>
                        </div>
                        <p className="absolute right-0 -bottom-1 text-[9px] text-stone-400">odds profile</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 右半：Co-failure Rate + Premium — 完全保持原样 */}
                {Number.isFinite(premiumValue) && (
                  <div className="rounded-xl bg-gradient-to-br from-indigo-50/50 via-white to-violet-50/25 border border-indigo-100/60 p-3.5">
                    <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2.5">Co-failure Rate</p>
                    <div className="space-y-2">
                      {/* 迷你双柱对比 — 黄金比例等比放大 */}
                      {Number.isFinite(pFailBothObserved) && Number.isFinite(pFailBothIndependent) && (() => {
                        const maxRate = Math.max(pFailBothObserved, pFailBothIndependent, 0.001)
                        let targetMax
                        if (maxRate < 0.10) targetMax = 62
                        else if (maxRate < 0.25) targetMax = 68
                        else if (maxRate < 0.50) targetMax = 78
                        else targetMax = Math.min(maxRate * 100 * 1.15, 96)
                        const scale = targetMax / (maxRate * 100)
                        const obsWidth = Math.max(pFailBothObserved * 100 * scale, 4)
                        const expWidth = Math.max(pFailBothIndependent * 100 * scale, 4)
                        return (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2.5">
                              <span className="text-[10px] text-stone-400 w-[52px] shrink-0">Observed</span>
                              <div className="flex-1 h-2.5 rounded-[4px] overflow-hidden" style={{ background: 'rgba(241,245,249,0.6)' }}>
                                <div
                                  className="h-full rounded-[4px]"
                                  style={{ width: `${Math.max(obsWidth, 4)}%`, background: 'linear-gradient(90deg, #93c5fd, #a5b4fc)' }}
                                />
                              </div>
                              <span className="text-[11px] font-semibold text-sky-600 tabular-nums w-[40px] text-right">{(pFailBothObserved * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <span className="text-[10px] text-stone-400 w-[52px] shrink-0">Expected</span>
                              <div className="flex-1 h-2.5 rounded-[4px] overflow-hidden" style={{ background: 'rgba(241,245,249,0.6)' }}>
                                <div
                                  className="h-full rounded-[4px]"
                                  style={{ width: `${Math.max(expWidth, 4)}%`, background: 'linear-gradient(90deg, #c7d2fe, #c4b5fd)' }}
                                />
                              </div>
                              <span className="text-[11px] font-medium text-stone-400 tabular-nums w-[40px] text-right">{(pFailBothIndependent * 100).toFixed(1)}%</span>
                            </div>
                          </div>
                        )
                      })()}
                      {/* Premium + Marginal Survival — 统一行式，降低冲突色饱和度 */}
                      <div className="pt-3 mt-1 border-t border-stone-100/60 space-y-2">
                        <div className="flex items-center justify-between rounded-lg border border-indigo-100/60 bg-white/70 px-3.5 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold text-stone-500 tracking-wide">Premium (%)</span>
                          </div>
                          <span className={`min-w-[88px] text-right whitespace-nowrap text-[18px] leading-none font-semibold tabular-nums tracking-[0.012em] ${
                            premiumValue > 0 ? 'text-rose-500' : 'text-amber-500'
                          }`}>
                            {premiumValue > 0 ? '+' : ''}{(premiumValue * 100).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-sky-100/60 bg-sky-50/35 px-3.5 py-2.5">
                          <span className="text-xs font-semibold text-stone-500 tracking-wide">Marginal Survival Impact (pp)</span>
                          <span className={`min-w-[88px] text-right whitespace-nowrap text-[16px] leading-none font-semibold tabular-nums tracking-[0.012em] ${
                            Number(deltaSurvivalPair) >= 0 ? 'text-emerald-500' : 'text-amber-500'
                          }`}>
                            {formatSigned(Number(deltaSurvivalPair) * 100, 2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 底部信息条 */}
            <div className="mt-2.5 flex items-center justify-between rounded-lg bg-stone-50/60 border border-stone-100/50 px-3.5 py-2">
              <div className="flex items-center gap-3 text-[10px] text-stone-400">
                {sampleSize > 0 && (
                  <span>Matched <span className="font-medium text-stone-500 tabular-nums">{sampleSize}</span></span>
                )}
                {Number.isFinite(globalFailureRate) && (
                  <span>Global fail rate <span className="font-medium text-stone-500 tabular-nums">{(globalFailureRate * 100).toFixed(0)}%</span></span>
                )}
                {Number.isFinite(resolvedExpandedPair.confidence) && (
                  <span>Confidence <span className="font-medium text-stone-500 tabular-nums">{(resolvedExpandedPair.confidence * 100).toFixed(1)}%</span></span>
                )}
                {hasBias && (
                  <span className="text-indigo-400">
                    Bias adj. {(biasStrength * 100).toFixed(0)}%
                    <span className="text-stone-300 ml-1">({matchedExact}e+{matchedNeighbor}n)</span>
                  </span>
                )}
                {!hasBias && sampleSize > 0 && (
                  <span>No bias detected</span>
                )}
              </div>
              <span className="text-[10px] text-stone-300">Click another cell to compare</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── 主视图 ───
  return (
    <div className="glow-card relative overflow-hidden rounded-2xl border border-stone-100 bg-white">
      {/* 背景光晕 */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-sky-100/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-indigo-50/15 blur-3xl" />

      {/* 头部 */}
      <div className="relative px-6 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-sky-50 to-sky-100/80 border border-sky-200/50">
              <TrendingUp size={14} strokeWidth={2} className="text-sky-500" />
            </div>
            <h3 className="font-medium text-stone-700 tracking-tight">依赖风险矩阵智能</h3>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMappedViewEnabled((prev) => !prev)}
              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[10px] border border-sky-200/80 bg-[linear-gradient(120deg,rgba(224,242,254,0.86),rgba(255,255,255,0.92)_52%,rgba(224,242,254,0.84))] text-[11px] font-medium text-sky-700 tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_10px_22px_-18px_rgba(14,165,233,0.5)] backdrop-blur-[1px] transition-all duration-200 hover:border-sky-300/90"
              title={mappedViewEnabled ? '当前：映射增强视图（点击切换为源数据）' : '当前：源数据视图（点击切换为映射增强）'}
            >
              <span>{mappedViewEnabled ? '映射增强' : '源数据'}</span>
              <span className={`relative h-4 w-8 rounded-full border transition-colors duration-200 ${mappedViewEnabled ? 'bg-sky-200/85 border-sky-300/90' : 'bg-stone-200/75 border-stone-300/75'}`}>
                <span className={`absolute top-1/2 h-[12px] w-[12px] -translate-y-1/2 rounded-full bg-white shadow-sm transition-all duration-200 ${mappedViewEnabled ? 'right-[1px]' : 'left-[1px]'}`} />
              </span>
            </button>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border border-sky-200/80 bg-[linear-gradient(120deg,rgba(224,242,254,0.86),rgba(255,255,255,0.9)_52%,rgba(224,242,254,0.84))] text-[11px] font-medium text-sky-700 tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_10px_22px_-18px_rgba(14,165,233,0.5)] backdrop-blur-[1px]">
              <Activity size={12} strokeWidth={1.9} className="text-sky-500" />
              冰裂共振评分 0-100%
            </span>
          </div>
        </div>
      </div>

      {/* 全幅矩阵 */}
      <div className="relative px-6 pb-2">
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-0" />
                {matches.map((match, idx) => (
                  <th
                    key={`col-${idx}`}
                    className={`px-1.5 py-2.5 text-[11px] font-medium tracking-wide text-center whitespace-nowrap transition-colors duration-200 ${
                      idx === selectedColIdx ? 'text-amber-600/90' : 'text-stone-400'
                    }`}
                  >
                    {idx === selectedColIdx ? (
                      <span className="bg-orange-100/35 px-1.5 py-1 font-semibold text-amber-600">{formatTeamName(match, idx)}</span>
                    ) : formatTeamName(match, idx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.map((rowMatch, rowIdx) => (
                <tr key={`row-${rowIdx}`}>
                  {/* 行标题 */}
                  <td className={`pr-3 py-1.5 text-[11px] font-medium tracking-wide text-right whitespace-nowrap align-middle transition-colors duration-200 ${
                    rowIdx === selectedRowIdx ? 'text-amber-600/90' : 'text-stone-400'
                  }`}>
                    {rowIdx === selectedRowIdx ? (
                      <span className="bg-orange-100/35 px-1.5 py-1 font-semibold text-amber-600">{formatTeamName(rowMatch, rowIdx)}</span>
                    ) : formatTeamName(rowMatch, rowIdx)}
                  </td>

                  {/* 单元格 */}
                  {matches.map((_, colIdx) => {
                    // 对角线 — 空白
                    if (colIdx === rowIdx) {
                      return (
                        <td key={`cell-${rowIdx}-${colIdx}`} className="p-1">
                          <div className="h-14 rounded-lg bg-stone-50/30 border border-stone-100/40" />
                        </td>
                      )
                    }
                    // 下三角 — 显示 Premium（暖色系渐变质感，与上三角冷色系形成对比）
                    if (colIdx < rowIdx) {
                      const mirrorData = displayFragilityMatrix.find(m => m.i === colIdx && m.j === rowIdx)
                      if (!mirrorData) return <td key={`cell-${rowIdx}-${colIdx}`} className="p-1" />
                      const prem = mirrorData.components?.premium?.premium
                      const deltaSurvival = Number(mirrorData.deltaSurvival)
                      const isSelected = resolvedExpandedPair && (
                        (resolvedExpandedPair.i === colIdx && resolvedExpandedPair.j === rowIdx) ||
                        (resolvedExpandedPair.i === rowIdx && resolvedExpandedPair.j === colIdx)
                      )
                      // Premium 冷调统一色谱 — 负值(清透冷)→近零(中性灰蓝)→正值(深沉冷)
                      // 与上三角多彩光谱形成「彩色 vs 单色温」的高级对比
                      const getPremiumCell = (v) => {
                        if (!Number.isFinite(v)) return { bg: 'bg-gradient-to-br from-stone-50/60 to-stone-50/40', border: 'border-stone-200/40', text: 'text-stone-400' }
                        const p = v * 100
                        // 负值 — 清透明亮冷调，越负越鲜明
                        if (p <= -12) return { bg: 'bg-gradient-to-br from-emerald-50/80 to-teal-50/60', border: 'border-emerald-200/50', text: 'text-emerald-600' }
                        if (p <= -8)  return { bg: 'bg-gradient-to-br from-teal-50/75 to-cyan-50/55', border: 'border-teal-200/45', text: 'text-teal-600' }
                        if (p <= -5)  return { bg: 'bg-gradient-to-br from-cyan-50/70 to-sky-50/50', border: 'border-cyan-200/45', text: 'text-cyan-600' }
                        if (p <= -2)  return { bg: 'bg-gradient-to-br from-sky-50/65 to-blue-50/45', border: 'border-sky-200/40', text: 'text-sky-600' }
                        if (p < 0)    return { bg: 'bg-gradient-to-br from-sky-50/55 to-slate-50/40', border: 'border-sky-100/40', text: 'text-sky-500' }
                        // 近零 — 极淡中性
                        if (p < 2)    return { bg: 'bg-gradient-to-br from-slate-50/55 to-blue-50/35', border: 'border-slate-200/35', text: 'text-slate-500' }
                        // 正值 — 深沉冷调，越正越浓郁
                        if (p < 5)    return { bg: 'bg-gradient-to-br from-blue-50/60 to-indigo-50/40', border: 'border-blue-200/40', text: 'text-blue-600' }
                        if (p < 8)    return { bg: 'bg-gradient-to-br from-indigo-50/65 to-violet-50/45', border: 'border-indigo-200/45', text: 'text-indigo-600' }
                        if (p < 12)   return { bg: 'bg-gradient-to-br from-violet-50/70 to-purple-50/50', border: 'border-violet-200/50', text: 'text-violet-600' }
                        return               { bg: 'bg-gradient-to-br from-purple-50/75 to-fuchsia-50/55', border: 'border-purple-200/50', text: 'text-purple-700' }
                      }
                      const pc = getPremiumCell(prem)
                      return (
                        <td key={`cell-${rowIdx}-${colIdx}`} className="p-1">
                          <button
                            onClick={() => onSelectPair?.(mirrorData)}
                            className={`w-full h-14 rounded-lg border backdrop-blur-[2px] flex items-center justify-center transition-all duration-200 cursor-pointer
                              ${pc.bg} ${pc.border}
                              ${isSelected
                                ? 'ring-2 ring-sky-400/60 ring-offset-1 scale-[1.03]'
                                : 'hover:scale-[1.02] hover:shadow-md'
                              }`}
                          >
                            {Number.isFinite(prem) ? (
                              <div className="grid grid-cols-2 h-full w-full">
                                <div className={`flex flex-col items-center justify-center border-r border-white/55 px-1 ${pc.text}`}>
                                  <span className="text-[12px] font-semibold tabular-nums leading-none tracking-normal">
                                    {formatSigned(Number(prem) * 100, 1)}
                                  </span>
                                  <span className="text-[8px] font-medium opacity-55 mt-0.5">Prem</span>
                                </div>
                                <div className={`flex flex-col items-center justify-center px-1 ${Number(deltaSurvival) >= 0 ? 'text-sky-600' : 'text-rose-500'}`}>
                                  <span className="text-[12px] font-semibold tabular-nums leading-none tracking-normal">
                                    {formatSigned(Number(deltaSurvival) * 100, 1)}
                                  </span>
                                  <span className="text-[8px] font-medium opacity-55 mt-0.5">MSI</span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-[11px] text-stone-300">—</span>
                            )}
                          </button>
                        </td>
                      )
                    }

                    const pairData = displayFragilityMatrix.find(m => m.i === rowIdx && m.j === colIdx)
                    if (!pairData) return <td key={`cell-${rowIdx}-${colIdx}`} className="p-1" />

                    const cellStyle = getHeatStyle(pairData.displayScore)
                    const axisHighlighted = Boolean(
                      selectedAxisSet &&
                      colIdx > rowIdx &&
                      (selectedAxisSet.has(rowIdx) || selectedAxisSet.has(colIdx))
                    )
                    const isSelected = resolvedExpandedPair && (
                      (resolvedExpandedPair.i === rowIdx && resolvedExpandedPair.j === colIdx) ||
                      (resolvedExpandedPair.i === colIdx && resolvedExpandedPair.j === rowIdx)
                    )

                    return (
                      <td key={`cell-${rowIdx}-${colIdx}`} className="p-1">
                        <button
                          onClick={() => onSelectPair?.(pairData)}
                          className={`relative w-full h-14 rounded-lg border backdrop-blur-[2px] flex flex-col items-center justify-center transition-all duration-200 cursor-pointer overflow-hidden
                            ${cellStyle.bg} ${cellStyle.border} ${cellStyle.text} ${cellStyle.glow}
                            ${isSelected
                              ? 'ring-2 ring-sky-400/60 ring-offset-1 scale-[1.03]'
                              : 'hover:scale-[1.02] hover:shadow-md'
                            }`}
                        >
                          {axisHighlighted && !isSelected && (
                            <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-br from-amber-100/28 via-yellow-50/16 to-amber-50/10" />
                          )}
                          <span className="relative z-10 text-base font-semibold leading-none tabular-nums">{Number(pairData.displayScore).toFixed(2)}</span>
                          <span className="relative z-10 text-[9px] opacity-50 mt-0.5">%</span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 图例 + 统计 */}
      <div className="relative px-6 pb-5 pt-3">
        <div className="flex items-center justify-between border-t border-stone-100 pt-4">
          {/* 图例 — 连续色谱 */}
          <div className="flex items-center gap-1 text-[11px] text-stone-400">
            <span className="mr-1">0</span>
            <div className="flex h-[5px] rounded-full overflow-hidden" style={{ width: '140px' }}>
              <div className="flex-1" style={{ background: 'linear-gradient(90deg, #34d399, #2dd4bf, #22d3ee, #0ea5e9, #3b82f6, #6366f1, #8b5cf6, #f59e0b, #c0c7d0, #b4bec9)' }} />
            </div>
            <span className="ml-1">100</span>
          </div>

          {/* 统计数字 */}
          <div className="flex items-center gap-5 text-[11px]">
            <div className="text-right">
              <span className="text-stone-400">Avg</span>
              <span className="ml-1.5 font-semibold text-stone-600 tabular-nums">{avgScore}%</span>
            </div>
            <div className="text-right">
              <span className="text-stone-400">Elevated</span>
              <span className="ml-1.5 font-semibold text-stone-600 tabular-nums">{highRiskCount}/{fragilityMatrix.length}</span>
            </div>
            <div className="text-right">
              <span className="text-stone-400">Samples</span>
              <span className="ml-1.5 font-semibold text-stone-600 tabular-nums">{historicalData.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 详情面板 */}
      {renderDetailPanel()}
    </div>
  )
}
