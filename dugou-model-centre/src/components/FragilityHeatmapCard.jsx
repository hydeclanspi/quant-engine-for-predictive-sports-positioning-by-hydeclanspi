import { useMemo } from 'react'
import { Activity, TrendingUp, X } from 'lucide-react'
import { assessComboFragility, getOddsBand } from '../lib/analytics'
import { getInvestments } from '../lib/localData'

/**
 * 依赖风险矩阵智能 — 冰裂共振评分热力图
 *
 * 全幅矩阵 · 品牌色系 · 模块化详情面板
 */
export function FragilityHeatmapCard({ matches = [], expandedPair = null, onSelectPair = null }) {
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
      .slice(0, 150)
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
        result.push({
          i,
          j,
          score: Number(score.toFixed(2)),
          riskLevel: pairAssessment.riskLevel || 'low',
          isSignificant: pairAssessment.isSignificant || false,
          confidence: pairAssessment.confidence || 0,
          // 完整数据用于详情面板
          components: pairAssessment.components || null,
        })
      }
    }
    return result
  }, [matches, historicalData])

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
  const avgScore = fragilityMatrix.length > 0
    ? (fragilityMatrix.reduce((s, m) => s + m.score, 0) / fragilityMatrix.length).toFixed(1)
    : '\u2014'
  const highRiskCount = fragilityMatrix.filter(m => m.score > 40).length

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
    if (!expandedPair) return null

    const matchA = matches[expandedPair.i]
    const matchB = matches[expandedPair.j]
    const nameA = formatTeamName(matchA, expandedPair.i)
    const nameB = formatTeamName(matchB, expandedPair.j)
    const oddsA = matchA?.odds?.toFixed(2) || '—'
    const oddsB = matchB?.odds?.toFixed(2) || '—'
    const style = getHeatStyle(expandedPair.score)

    // 从 components 中提取详细数据
    const premium = expandedPair.components?.premium || {}
    const bias = expandedPair.components?.bias || {}
    const adjusted = expandedPair.components?.adjusted || {}

    const pFailA = premium.pFailA
    const pFailB = premium.pFailB
    const pFailBothObserved = premium.pFailBothObserved
    const pFailBothIndependent = premium.pFailBothIndependent
    const sampleSize = premium.sampleSize || 0
    const premiumValue = premium.premium
    const observedFailedCount = premium.observedFailedCount || 0
    const hasBias = bias.hasBias || false
    const biasStrength = bias.biasStrength || 0
    const matchedExact = bias.investedInTarget || 0
    const matchedNeighbor = bias.investedInSimilar || 0
    const exactWon = bias.exactWon || 0
    const neighborWon = bias.neighborWon || 0
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
                const s = expandedPair.score
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
                      <span className="text-2xl font-bold tabular-nums leading-none" style={{ backgroundImage: rs.gradient, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>{expandedPair.score}</span>
                      <span className="text-xs font-medium" style={{ backgroundImage: rs.gradient, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent', opacity: 0.7 }}>%</span>
                    </div>
                    {/* 寻光轨迹 — 光点 + 拖尾 + 细轨道 */}
                    {(() => {
                      // 非线性视觉映射 — 让大部分数据占2/3左右轨道
                      // 低分快升、中段平缓、高分收敛
                      const raw = Math.min(expandedPair.score, 100)
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
                const ls = levelStyles[expandedPair.riskLevel] || levelStyles.low
                return (
                  <div className={`relative rounded-xl bg-gradient-to-br ${ls.bg} border ${ls.border} p-3.5 flex flex-col justify-between overflow-hidden`}>
                    {/* 左侧竖色带 */}
                    <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: ls.bar }} />
                    <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2 pl-2">Level</p>
                    <p className="text-lg font-bold capitalize leading-tight tracking-tight pl-2" style={{ backgroundImage: ls.gradient, backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent' }}>{getLevelLabel(expandedPair.riskLevel)}</p>
                  </div>
                )
              })()}

              {/* 模块：Confidence — 含样本量说明 */}
              <div className="rounded-xl bg-gradient-to-br from-stone-50/80 to-white border border-stone-100/80 p-3.5">
                <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2">Confidence</p>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm font-semibold text-stone-700 tabular-nums leading-tight">{(expandedPair.confidence * 100).toFixed(1)}</span>
                  <span className="text-[10px] text-stone-400">%</span>
                </div>
                {sampleSize > 0 && (
                  <p className="text-[9px] text-stone-400 mt-1 tabular-nums">{sampleSize} samples</p>
                )}
              </div>

              {/* 模块：Co-failure — 替代 Stat.Sig. */}
              <div className="rounded-xl bg-gradient-to-br from-stone-50/80 to-white border border-stone-100/80 p-3.5">
                <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2">Co-failure</p>
                <p className="text-sm font-semibold text-stone-700 tabular-nums leading-tight">
                  {observedFailedCount}<span className="text-[10px] font-normal text-stone-400"> / {sampleSize}</span>
                </p>
                <p className="text-[9px] text-stone-400 mt-1">pairs failed</p>
              </div>
            </div>

            {/* 第二行：概率分析模块 — 左=Market Implied (内部分割含Odds Profile) | 右=Co-failure Rate（保持原样） */}
            {(Number.isFinite(pFailA) || Number.isFinite(premiumValue)) && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                {/* 左半：Market Implied + Odds Profile 内部分割 */}
                {Number.isFinite(pFailA) && Number.isFinite(pFailB) && (
                  <div className="rounded-xl bg-gradient-to-br from-sky-50/50 via-white to-cyan-50/30 border border-sky-100/60 p-3.5">
                    <div className="grid grid-cols-2 gap-3 h-full">
                      {/* 左子：Odds Profile（互换到左侧） */}
                      <div>
                        <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2.5">Odds Profile</p>
                        {bandA && bandB ? (
                          <div className="space-y-2.5">
                            {/* Exact band matches */}
                            <div>
                              <div className="flex items-baseline gap-1">
                                <span className="text-[9px] text-stone-400 uppercase tracking-wide">Exact</span>
                                <span className="text-[8px] text-stone-300 tabular-nums">({bandA}×{bandB})</span>
                              </div>
                              <div className="flex items-baseline justify-between mt-1">
                                <div className="flex items-baseline gap-1">
                                  <span className="text-lg font-bold text-stone-700 tabular-nums leading-none">{matchedExact}</span>
                                  <span className="text-[10px] text-stone-300 font-medium">hit</span>
                                  <span className="text-[10px] text-stone-300">/</span>
                                  <span className="text-[15px] font-semibold text-emerald-600 tabular-nums leading-none">{exactWon}</span>
                                  <span className="text-[10px] text-emerald-500/70 font-medium">won</span>
                                </div>
                                <span className="text-[10px] font-semibold tabular-nums text-sky-500/80 bg-sky-50/70 px-1.5 py-0.5 rounded-full">{matchedExact > 0 ? ((exactWon / matchedExact) * 100).toFixed(0) : '—'}%</span>
                              </div>
                            </div>
                            <div className="h-px bg-sky-100/60" />
                            {/* Neighbor band matches */}
                            <div>
                              <span className="text-[9px] text-stone-400 uppercase tracking-wide">Neighbor</span>
                              <div className="flex items-baseline justify-between mt-1">
                                <div className="flex items-baseline gap-1">
                                  <span className="text-lg font-bold text-stone-700 tabular-nums leading-none">{matchedNeighbor}</span>
                                  <span className="text-[10px] text-stone-300 font-medium">hit</span>
                                  <span className="text-[10px] text-stone-300">/</span>
                                  <span className="text-[15px] font-semibold text-emerald-600 tabular-nums leading-none">{neighborWon}</span>
                                  <span className="text-[10px] text-emerald-500/70 font-medium">won</span>
                                </div>
                                <span className="text-[10px] font-semibold tabular-nums text-sky-500/80 bg-sky-50/70 px-1.5 py-0.5 rounded-full">{matchedNeighbor > 0 ? ((neighborWon / matchedNeighbor) * 100).toFixed(0) : '—'}%</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[10px] text-stone-300 italic">No odds data</p>
                        )}
                      </div>
                      {/* 右子：Market Implied Failure — 纵向堆叠（互换到右侧） */}
                      <div className="border-l border-sky-100/60 pl-3 flex flex-col">
                        <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-1">Market Implied</p>
                        <div className="flex-1 flex flex-col">
                          <div className="flex-1 flex flex-col justify-center">
                            <p className="text-[9px] text-stone-400 mb-0.5 truncate">{nameA}</p>
                            <p className="text-sm font-semibold text-sky-700 tabular-nums">{(pFailA * 100).toFixed(1)}%</p>
                          </div>
                          <div className="h-px bg-sky-100/80" />
                          <div className="flex-1 flex flex-col justify-center">
                            <p className="text-[9px] text-stone-400 mb-0.5 truncate">{nameB}</p>
                            <p className="text-sm font-semibold text-sky-700 tabular-nums">{(pFailB * 100).toFixed(1)}%</p>
                          </div>
                        </div>
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
                      {/* Premium — 突出显示 */}
                      <div className="flex items-center justify-between pt-3 mt-1 border-t border-stone-100/60">
                        <span className="text-sm font-semibold text-stone-500 tracking-wide">Premium</span>
                        <span className={`text-lg font-bold tabular-nums tracking-tight ${premiumValue > 0 ? 'text-indigo-600' : 'text-emerald-600'}`}>
                          {premiumValue > 0 ? '+' : ''}{(premiumValue * 100).toFixed(2)}%
                        </span>
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
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border border-sky-200/80 bg-[linear-gradient(120deg,rgba(224,242,254,0.86),rgba(255,255,255,0.9)_52%,rgba(224,242,254,0.84))] text-[11px] font-medium text-sky-700 tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_10px_22px_-18px_rgba(14,165,233,0.5)] backdrop-blur-[1px]">
            <Activity size={12} strokeWidth={1.9} className="text-sky-500" />
            冰裂共振评分 0-100%
          </span>
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
                    className="px-1.5 py-2.5 text-[11px] font-medium text-stone-400 tracking-wide text-center whitespace-nowrap"
                  >
                    {formatTeamName(match, idx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.map((rowMatch, rowIdx) => (
                <tr key={`row-${rowIdx}`}>
                  {/* 行标题 */}
                  <td className="pr-3 py-1.5 text-[11px] font-medium text-stone-400 tracking-wide text-right whitespace-nowrap align-middle">
                    {formatTeamName(rowMatch, rowIdx)}
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
                      const mirrorData = fragilityMatrix.find(m => m.i === colIdx && m.j === rowIdx)
                      if (!mirrorData) return <td key={`cell-${rowIdx}-${colIdx}`} className="p-1" />
                      const prem = mirrorData.components?.premium?.premium
                      const isSelected = expandedPair && (
                        (expandedPair.i === colIdx && expandedPair.j === rowIdx) ||
                        (expandedPair.i === rowIdx && expandedPair.j === colIdx)
                      )
                      // Premium 暖色10段色谱 — 蜜桃→樱粉→紫藤→薰衣草→丁香 | 杏黄→蜂蜜→橘橙→珊瑚→朱砂
                      const getPremiumCell = (v) => {
                        if (!Number.isFinite(v)) return { bg: 'bg-gradient-to-br from-stone-50/60 to-stone-50/40', border: 'border-stone-200/40', text: 'text-stone-400' }
                        const p = v * 100
                        if (p <= -12) return { bg: 'bg-gradient-to-br from-rose-50/90 to-pink-50/70', border: 'border-rose-200/50', text: 'text-rose-700' }
                        if (p <= -8)  return { bg: 'bg-gradient-to-br from-pink-50/85 to-fuchsia-50/70', border: 'border-pink-200/50', text: 'text-pink-700' }
                        if (p <= -5)  return { bg: 'bg-gradient-to-br from-fuchsia-50/85 to-purple-50/70', border: 'border-fuchsia-200/50', text: 'text-fuchsia-700' }
                        if (p <= -2)  return { bg: 'bg-gradient-to-br from-purple-50/85 to-violet-50/70', border: 'border-purple-200/50', text: 'text-purple-700' }
                        if (p < 0)    return { bg: 'bg-gradient-to-br from-violet-50/80 to-indigo-50/55', border: 'border-violet-200/50', text: 'text-violet-700' }
                        if (p < 2)    return { bg: 'bg-gradient-to-br from-amber-50/80 to-yellow-50/60', border: 'border-amber-200/50', text: 'text-amber-700' }
                        if (p < 5)    return { bg: 'bg-gradient-to-br from-yellow-50/85 to-amber-50/70', border: 'border-yellow-200/50', text: 'text-yellow-700' }
                        if (p < 8)    return { bg: 'bg-gradient-to-br from-orange-50/85 to-amber-50/65', border: 'border-orange-200/50', text: 'text-orange-700' }
                        if (p < 12)   return { bg: 'bg-gradient-to-br from-orange-50/90 to-red-50/70', border: 'border-orange-200/60', text: 'text-orange-700' }
                        return               { bg: 'bg-gradient-to-br from-red-50/90 to-rose-50/70', border: 'border-red-200/60', text: 'text-red-700' }
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
                              <div className="flex flex-col items-center justify-center">
                                <span className={`text-base font-bold tabular-nums leading-none italic ${pc.text}`}>
                                  <span className="text-[10px] font-semibold">{prem >= 0 ? '+' : '\u2212'}</span>{Math.abs(prem * 100).toFixed(1)}
                                </span>
                                <span className={`text-[9px] italic opacity-50 mt-0.5 ${pc.text}`}>%</span>
                              </div>
                            ) : (
                              <span className="text-[11px] text-stone-300">—</span>
                            )}
                          </button>
                        </td>
                      )
                    }

                    const pairData = fragilityMatrix.find(m => m.i === rowIdx && m.j === colIdx)
                    if (!pairData) return <td key={`cell-${rowIdx}-${colIdx}`} className="p-1" />

                    const cellStyle = getHeatStyle(pairData.score)
                    const isSelected = expandedPair && (
                      (expandedPair.i === rowIdx && expandedPair.j === colIdx) ||
                      (expandedPair.i === colIdx && expandedPair.j === rowIdx)
                    )

                    return (
                      <td key={`cell-${rowIdx}-${colIdx}`} className="p-1">
                        <button
                          onClick={() => onSelectPair?.(pairData)}
                          className={`w-full h-14 rounded-lg border backdrop-blur-[2px] flex flex-col items-center justify-center transition-all duration-200 cursor-pointer
                            ${cellStyle.bg} ${cellStyle.border} ${cellStyle.text} ${cellStyle.glow}
                            ${isSelected
                              ? 'ring-2 ring-sky-400/60 ring-offset-1 scale-[1.03]'
                              : 'hover:scale-[1.02] hover:shadow-md'
                            }`}
                        >
                          <span className="text-base font-semibold leading-none tabular-nums">{pairData.score}</span>
                          <span className="text-[9px] opacity-50 mt-0.5">%</span>
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
