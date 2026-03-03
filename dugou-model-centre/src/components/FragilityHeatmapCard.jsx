import { useMemo } from 'react'
import { Activity, AlertTriangle, TrendingUp } from 'lucide-react'
import { assessComboFragility } from '../lib/analytics'
import { getInvestments } from '../lib/localData'

/**
 * 依赖风险矩阵智能 — 冰裂共振评分热力图
 *
 * 全幅矩阵设计，球队完整名称，玻璃质感
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

  // 脆弱性矩阵计算
  const fragilityMatrix = useMemo(() => {
    if (matches.length < 2) return []
    const result = []
    for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const assessment = assessComboFragility(
          [matches[i], matches[j]],
          historicalData
        )
        const score = assessment.overallFragility || 0
        result.push({
          i,
          j,
          score: Number(score.toFixed(2)),
          riskLevel: assessment.pairAnalysis?.[0]?.assessment?.riskLevel || 'low',
          isSignificant: assessment.pairAnalysis?.[0]?.assessment?.isSignificant || false,
          confidence: assessment.pairAnalysis?.[0]?.assessment?.confidence || 0,
        })
      }
    }
    return result
  }, [matches, historicalData])

  // 颜色系统 — 玻璃质感渐变
  const getHeatStyle = (score) => {
    if (score < 25) return {
      bg: 'bg-gradient-to-br from-emerald-50/80 to-emerald-100/60',
      border: 'border-emerald-200/60',
      text: 'text-emerald-700',
      glow: '',
    }
    if (score < 40) return {
      bg: 'bg-gradient-to-br from-amber-50/80 to-amber-100/60',
      border: 'border-amber-200/60',
      text: 'text-amber-700',
      glow: '',
    }
    if (score < 60) return {
      bg: 'bg-gradient-to-br from-orange-50/80 to-orange-100/60',
      border: 'border-orange-200/70',
      text: 'text-orange-700',
      glow: 'shadow-[0_0_12px_-4px_rgba(251,146,60,0.3)]',
    }
    return {
      bg: 'bg-gradient-to-br from-rose-50/80 to-rose-100/60',
      border: 'border-rose-200/70',
      text: 'text-rose-700',
      glow: 'shadow-[0_0_16px_-4px_rgba(244,63,94,0.3)]',
    }
  }

  // 截断球队名
  const formatTeamName = (match, idx) => {
    if (match.teamName && match.teamName.length > 0) return match.teamName
    return `Match ${idx + 1}`
  }

  // 统计
  const avgScore = fragilityMatrix.length > 0
    ? (fragilityMatrix.reduce((s, m) => s + m.score, 0) / fragilityMatrix.length).toFixed(1)
    : '—'
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

  // ─── 主视图 ───
  return (
    <div className="glow-card relative overflow-hidden rounded-2xl border border-stone-100 bg-white">
      {/* 背景光晕 */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-sky-100/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-violet-100/15 blur-3xl" />

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

                    const style = getHeatStyle(pairData.score)
                    const isSelected = expandedPair && expandedPair.i === rowIdx && expandedPair.j === colIdx

                    return (
                      <td key={`cell-${rowIdx}-${colIdx}`} className="p-1">
                        <button
                          onClick={() => onSelectPair?.(pairData)}
                          className={`w-full h-14 rounded-lg border backdrop-blur-[2px] flex flex-col items-center justify-center transition-all duration-200 cursor-pointer
                            ${style.bg} ${style.border} ${style.text} ${style.glow}
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
          {/* 图例 */}
          <div className="flex items-center gap-4 text-[11px] text-stone-400">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-emerald-100 to-emerald-200 border border-emerald-300/50" />
              <span>0-25%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-amber-100 to-amber-200 border border-amber-300/50" />
              <span>25-40%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-orange-100 to-orange-200 border border-orange-300/50" />
              <span>40-60%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-br from-rose-100 to-rose-200 border border-rose-300/50" />
              <span>60-100%</span>
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

      {/* 展开详情面板 */}
      {expandedPair && (
        <div className="mx-6 mb-6 rounded-xl border border-sky-100/80 bg-gradient-to-br from-sky-50/50 via-white to-violet-50/30 p-4 backdrop-blur-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-sky-700 tracking-wide">
                {formatTeamName(matches[expandedPair.i], expandedPair.i)} &times; {formatTeamName(matches[expandedPair.j], expandedPair.j)}
              </p>
              <p className="text-[11px] text-stone-400 mt-0.5">
                Odds {matches[expandedPair.i]?.odds?.toFixed(2)} &times; {matches[expandedPair.j]?.odds?.toFixed(2)}
              </p>
            </div>
            <button
              onClick={() => onSelectPair?.(null)}
              className="flex h-5 w-5 items-center justify-center rounded-md text-stone-300 hover:text-stone-500 hover:bg-stone-100 transition-colors"
            >
              <span className="text-xs leading-none">&times;</span>
            </button>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] text-stone-400 mb-0.5">Resonance</p>
              <p className="text-sm font-semibold text-stone-700 tabular-nums">{expandedPair.score}%</p>
            </div>
            <div>
              <p className="text-[10px] text-stone-400 mb-0.5">Level</p>
              <p className="text-sm font-semibold text-stone-700 capitalize">{expandedPair.riskLevel}</p>
            </div>
            {expandedPair.confidence !== undefined && (
              <div>
                <p className="text-[10px] text-stone-400 mb-0.5">Confidence</p>
                <p className="text-sm font-semibold text-stone-700 tabular-nums">{(expandedPair.confidence * 100).toFixed(0)}%</p>
              </div>
            )}
            {expandedPair.isSignificant !== undefined && (
              <div>
                <p className="text-[10px] text-stone-400 mb-0.5">Significance</p>
                <p className="text-sm font-semibold text-stone-700">
                  {expandedPair.isSignificant ? 'Significant' : 'Not significant'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
