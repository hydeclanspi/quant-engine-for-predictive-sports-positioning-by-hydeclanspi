import { useMemo } from 'react'
import { Activity, TrendingUp, X } from 'lucide-react'
import { assessComboFragility } from '../lib/analytics'
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

  // ─── 品牌色系 — emerald / sky / indigo / teal ───
  // 和 ComboPage 投资层级色系一致：emerald → sky → indigo → slate
  const getHeatStyle = (score) => {
    if (score < 25) return {
      bg: 'bg-gradient-to-br from-emerald-50/90 to-teal-50/70',
      border: 'border-emerald-200/50',
      text: 'text-emerald-700',
      glow: '',
      dot: 'from-emerald-200 to-emerald-300 border-emerald-300/60',
    }
    if (score < 40) return {
      bg: 'bg-gradient-to-br from-sky-50/90 to-cyan-50/70',
      border: 'border-sky-200/50',
      text: 'text-sky-700',
      glow: '',
      dot: 'from-sky-200 to-sky-300 border-sky-300/60',
    }
    if (score < 60) return {
      bg: 'bg-gradient-to-br from-indigo-50/85 to-violet-50/60',
      border: 'border-indigo-200/50',
      text: 'text-indigo-700',
      glow: 'shadow-[0_0_12px_-4px_rgba(99,102,241,0.2)]',
      dot: 'from-indigo-200 to-indigo-300 border-indigo-300/60',
    }
    return {
      bg: 'bg-gradient-to-br from-slate-100/90 to-slate-50/70',
      border: 'border-slate-300/50',
      text: 'text-slate-700',
      glow: 'shadow-[0_0_14px_-4px_rgba(100,116,139,0.25)]',
      dot: 'from-slate-300 to-slate-400 border-slate-400/60',
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
    const globalFailureRate = adjusted.globalFailureRate

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
              {/* 分数指示器 */}
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl border backdrop-blur-[2px] ${style.bg} ${style.border}`}>
                <span className={`text-base font-bold tabular-nums leading-none ${style.text}`}>{expandedPair.score}</span>
              </div>
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

              {/* 主模块：共振评分 — 占2列 */}
              <div className="col-span-2 rounded-xl bg-gradient-to-br from-stone-50/80 to-white border border-stone-100/80 p-3.5">
                <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2">Resonance</p>
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl font-bold tabular-nums leading-none ${style.text}`}>{expandedPair.score}</span>
                  <span className="text-xs text-stone-400">%</span>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <div className={`h-1.5 rounded-full bg-gradient-to-r ${style.dot}`} style={{ width: `${Math.min(expandedPair.score, 100)}%`, minWidth: '8px' }} />
                  <div className="flex-1 h-1.5 rounded-full bg-stone-100" />
                </div>
              </div>

              {/* 模块：Level */}
              <div className="rounded-xl bg-gradient-to-br from-stone-50/80 to-white border border-stone-100/80 p-3.5">
                <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2">Level</p>
                <p className="text-sm font-semibold text-stone-700 capitalize leading-tight">{getLevelLabel(expandedPair.riskLevel)}</p>
              </div>

              {/* 模块：Confidence — 含样本量说明 */}
              <div className="rounded-xl bg-gradient-to-br from-stone-50/80 to-white border border-stone-100/80 p-3.5">
                <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2">Confidence</p>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-sm font-semibold text-stone-700 tabular-nums leading-tight">{(expandedPair.confidence * 100).toFixed(0)}</span>
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

            {/* 第二行：概率分析模块 — 宽幅条形 */}
            {(Number.isFinite(pFailA) || Number.isFinite(premiumValue)) && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                {/* 失败概率对比模块 */}
                {Number.isFinite(pFailA) && Number.isFinite(pFailB) && (
                  <div className="rounded-xl bg-gradient-to-br from-sky-50/50 via-white to-cyan-50/30 border border-sky-100/60 p-3.5">
                    <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2.5">Market Implied Failure</p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-stone-400 mb-0.5 truncate max-w-[120px]">{nameA}</p>
                        <p className="text-sm font-semibold text-sky-700 tabular-nums">{(pFailA * 100).toFixed(1)}%</p>
                      </div>
                      <div className="mx-3 h-8 w-px bg-sky-100" />
                      <div>
                        <p className="text-[10px] text-stone-400 mb-0.5 truncate max-w-[120px]">{nameB}</p>
                        <p className="text-sm font-semibold text-sky-700 tabular-nums">{(pFailB * 100).toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 依赖性溢价模块 — 去掉p-value，加 Observed vs Independent 可视化 */}
                {Number.isFinite(premiumValue) && (
                  <div className="rounded-xl bg-gradient-to-br from-indigo-50/50 via-white to-violet-50/25 border border-indigo-100/60 p-3.5">
                    <p className="text-[10px] font-medium text-stone-400 tracking-wider uppercase mb-2.5">Co-failure Rate</p>
                    <div className="space-y-2">
                      {/* 迷你双柱对比 — 黄金比例等比放大 */}
                      {Number.isFinite(pFailBothObserved) && Number.isFinite(pFailBothIndependent) && (() => {
                        // 等比放大规则：两条保持真实比例，较大条占 ~φ/(1+φ) ≈ 62% 空间
                        // 阈值分档：max<10% → 较大条占62%, <25% → 68%, <50% → 78%, ≥50% → 直接映射
                        const maxRate = Math.max(pFailBothObserved, pFailBothIndependent, 0.001)
                        let targetMax // 较大条应该显示的百分比宽度
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
                              <div className="flex-1 h-2.5 rounded bg-stone-200/60 overflow-hidden">
                                <div
                                  className="h-full rounded bg-gradient-to-r from-indigo-500 to-sky-400"
                                  style={{ width: `${Math.max(obsWidth, 4)}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-semibold text-indigo-600 tabular-nums w-[40px] text-right">{(pFailBothObserved * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <span className="text-[10px] text-stone-400 w-[52px] shrink-0">Expected</span>
                              <div className="flex-1 h-2.5 rounded bg-stone-200/60 overflow-hidden">
                                <div
                                  className="h-full rounded bg-gradient-to-r from-stone-400 to-stone-300"
                                  style={{ width: `${Math.max(expWidth, 4)}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-medium text-stone-500 tabular-nums w-[40px] text-right">{(pFailBothIndependent * 100).toFixed(1)}%</span>
                            </div>
                          </div>
                        )
                      })()}
                      {/* Premium */}
                      <div className="flex items-center justify-between pt-1 border-t border-stone-100/60">
                        <span className="text-[10px] text-stone-400">Premium</span>
                        <span className={`text-xs font-semibold tabular-nums ${premiumValue > 0 ? 'text-indigo-600' : 'text-emerald-600'}`}>
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
                    if (colIdx <= rowIdx) {
                      return (
                        <td key={`cell-${rowIdx}-${colIdx}`} className="p-1">
                          <div className="h-14 rounded-lg bg-stone-50/50 border border-stone-100/60" />
                        </td>
                      )
                    }

                    const pairData = fragilityMatrix.find(m => m.i === rowIdx && m.j === colIdx)
                    if (!pairData) return <td key={`cell-${rowIdx}-${colIdx}`} className="p-1" />

                    const cellStyle = getHeatStyle(pairData.score)
                    const isSelected = expandedPair && expandedPair.i === rowIdx && expandedPair.j === colIdx

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
          {/* 图例 — 品牌色系 */}
          <div className="flex items-center gap-4 text-[11px] text-stone-400">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-emerald-100 to-emerald-200 border border-emerald-300/50" />
              <span>0-25</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-sky-100 to-sky-200 border border-sky-300/50" />
              <span>25-40</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-indigo-100 to-indigo-200 border border-indigo-300/50" />
              <span>40-60</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-slate-200 to-slate-300 border border-slate-400/50" />
              <span>60-100</span>
            </div>
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
