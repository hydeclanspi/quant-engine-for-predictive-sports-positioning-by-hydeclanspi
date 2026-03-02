import { useMemo } from 'react'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { assessComboFragility } from '../lib/analytics'
import { getInvestments } from '../lib/localData'

/**
 * 脆弱性热力图卡片
 *
 * 在矩阵中展示比赛对的脆弱性评分
 * - 实时计算：当 matches 变化时立即更新
 * - 颜色编码：绿→黄→橙→红，对应 0-100% 脆弱性
 * - 点击交互：显示比赛对的详细分析
 */
export function FragilityHeatmapCard({ matches = [], expandedPair = null, onSelectPair = null }) {
    // 历史数据缓存：从已完成的投资中提取
  const historicalData = useMemo(() => {
    const investments = getInvestments()
    
    // 尝试多种方式识别已结算的投资
    // 支持：revenues > 0（有收益=已结算）、is_settled标记、status标记等
    const settledInvestments = investments
      .filter(inv => {
        // 检查是否有 revenues 字段（表示已结算）
        const hasRevenues = inv.revenues !== undefined && inv.revenues !== null && Number(inv.revenues) !== 0
        // 或者检查是否标记为 settled
        const isSettled = inv.is_settled === true || inv.status === 'settled' || inv.status === 'settled_win' || inv.status === 'settled_loss'
        // 或者检查是否有比赛结果
        const hasResults = Array.isArray(inv.matches) && inv.matches.some(m => m.result !== undefined && m.result !== null)
        
        return hasRevenues || isSettled || hasResults
      })
      .slice(0, 150) // 限制前150个已结算投资以保持性能
      .map(inv => {
        const matches = Array.isArray(inv.matches) ? inv.matches : []
        
        return {
          matches: matches.map(m => {
            // 判断是否有明确的结果数据
            const hasResult = typeof m.is_correct === 'boolean'
              || typeof m.result === 'boolean'
              || m.result === 'won' || m.result === 'lost' || m.result === 'loss'
              || m.status === 'won' || m.status === 'lost'
            // 判断是否赢了
            const isWin = m.is_correct === true || m.result === true || m.result === 'won' || m.status === 'won' || m.won === true
            return {
              odds: Number(m.odds) || 1,
              // result: true=赢, false=输, undefined=无结果
              result: hasResult ? isWin : undefined,
            }
          }),
          // 投注结果：检查 revenues > 0 或 status 字段
          succeeded: Number(inv.revenues || 0) > 0 || inv.status === 'settled_win' || inv.status === 'won',
          createdAt: inv.created_at || inv.createdAt || new Date().toISOString(),
        }
      })
      .filter(d => d.matches.length > 0 && d.matches.some(m => m.result !== undefined))
    
    // 调试输出
    if (settledInvestments.length > 0) {
      const debugSample = settledInvestments[0]
      const totalMatches = settledInvestments.reduce((sum, inv) => sum + inv.matches.length, 0)
      const matchesWithResults = settledInvestments.reduce((sum, inv) => sum + inv.matches.filter(m => m.result !== undefined).length, 0)
      const failedMatches = settledInvestments.reduce((sum, inv) => sum + inv.matches.filter(m => m.result === false).length, 0)
      const wonMatches = settledInvestments.reduce((sum, inv) => sum + inv.matches.filter(m => m.result === true).length, 0)
      console.log('🔍 FragilityHeatmap Debug:', {
        totalSettled: settledInvestments.length,
        totalMatches,
        matchesWithResults,
        wonMatches,
        failedMatches,
        sampleResults: debugSample.matches.map(m => ({ odds: m.odds, result: m.result })),
      })
    }
    return settledInvestments
  }, [])

  // 脆弱性分析：计算所有比赛对的脆弱性评分
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

  // 颜色映射函数
  const getHeatColor = (score) => {
    // score: 0-100
    if (score < 25) return { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-900' }
    if (score < 40) return { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-900' }
    if (score < 60) return { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-900' }
    return { bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-900' }
  }

  const getRiskIcon = (riskLevel) => {
    switch (riskLevel) {
      case 'critical':
        return '🚨'
      case 'high':
        return '⛔'
      case 'medium':
        return '⚠️'
      default:
        return '✅'
    }
  }

  if (matches.length < 2) {
    return (
      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-purple-500" />
          <h3 className="font-medium text-stone-700">依赖风险矩阵</h3>
        </div>
        <p className="text-sm text-stone-400">
          {matches.length === 0
            ? '选择至少 2 场比赛以查看脆弱性热力图'
            : '只有 1 场比赛，需要至少 2 场来分析依赖关系'}
        </p>
      </div>
    )
  }

  return (
    <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-purple-500" />
          <h3 className="font-medium text-stone-700">依赖风险矩阵</h3>
          {fragilityMatrix.some(m => m.score > 40) && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 font-medium">
              ⚠️ 高风险对
            </span>
          )}
        </div>
        <p className="text-xs text-stone-400">脆弱性评分 0-100%</p>
      </div>

      {/* 矩阵热力图 */}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* 列标题 */}
          <div className="flex items-start">
            <div className="w-12 h-12" />
            {matches.map((match, idx) => (
              <div
                key={`col-${idx}`}
                className="w-12 h-12 flex items-center justify-center text-xs font-semibold text-stone-600 border-b border-stone-200"
              >
                {idx + 1}
              </div>
            ))}
          </div>

          {/* 行 */}
          {matches.map((rowMatch, rowIdx) => (
            <div key={`row-${rowIdx}`} className="flex items-stretch">
              {/* 行标题 */}
              <div className="w-12 h-12 flex items-center justify-center text-xs font-semibold text-stone-600 border-r border-stone-200 bg-stone-50">
                {rowIdx + 1}
              </div>

              {/* 单元格 */}
              {matches.map((_, colIdx) => {
                if (colIdx <= rowIdx) {
                  // 下三角：空白
                  return (
                    <div
                      key={`cell-${rowIdx}-${colIdx}`}
                      className="w-12 h-12 bg-stone-50 border border-stone-100"
                    />
                  )
                }

                // 上三角：脆弱性分数
                const pairData = fragilityMatrix.find(m => m.i === rowIdx && m.j === colIdx)
                if (!pairData) return null

                const colors = getHeatColor(pairData.score)
                const isSelected = expandedPair && expandedPair.i === rowIdx && expandedPair.j === colIdx
                const isHighRisk = pairData.score > 40

                return (
                  <button
                    key={`cell-${rowIdx}-${colIdx}`}
                    onClick={() => onSelectPair?.(pairData)}
                    className={`w-12 h-12 border-2 flex flex-col items-center justify-center text-[9px] font-semibold transition-all hover:shadow-md cursor-pointer ${
                      isSelected ? `${colors.bg} ${colors.border} ring-2 ring-purple-400` : `${colors.bg} ${colors.border}`
                    } ${colors.text}`}
                    title={`比赛 ${rowIdx + 1} × ${colIdx + 1}: ${pairData.score}% ${getRiskIcon(pairData.riskLevel)}`}
                  >
                    <div>{pairData.score}</div>
                    <div className="text-[7px] opacity-70">%</div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 图例与统计 */}
      <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
        {/* 颜色图例 */}
        <div className="flex items-center gap-4 flex-wrap text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-100 border border-emerald-300" />
            <span className="text-stone-600">0-25% (安全)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-100 border border-amber-300" />
            <span className="text-stone-600">25-40% (注意)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-orange-100 border border-orange-300" />
            <span className="text-stone-600">40-60% (风险)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-100 border border-red-300" />
            <span className="text-stone-600">60-100% (危险)</span>
          </div>
        </div>

        {/* 统计信息 */}
        {fragilityMatrix.length > 0 && (
          <div className="grid grid-cols-3 gap-3 pt-2">
            {/* 平均脆弱性 */}
            <div className="bg-stone-50 rounded-lg p-2">
              <p className="text-[10px] text-stone-500 uppercase tracking-wider">平均脆弱性</p>
              <p className="text-sm font-semibold text-stone-700">
                {(fragilityMatrix.reduce((sum, m) => sum + m.score, 0) / fragilityMatrix.length).toFixed(1)}%
              </p>
            </div>

            {/* 高风险对数 */}
            <div className="bg-orange-50 rounded-lg p-2">
              <p className="text-[10px] text-orange-600 uppercase tracking-wider">高风险对</p>
              <p className="text-sm font-semibold text-orange-700">
                {fragilityMatrix.filter(m => m.score > 40).length} / {fragilityMatrix.length}
              </p>
            </div>

            {/* 样本量 */}
            <div className="bg-purple-50 rounded-lg p-2">
              <p className="text-[10px] text-purple-600 uppercase tracking-wider">历史样本</p>
              <p className="text-sm font-semibold text-purple-700">{historicalData.length}</p>
            </div>
          </div>
        )}
      </div>

      {/* 详细信息面板 */}
      {expandedPair && (
        <div className="mt-4 pt-4 border-t border-stone-100 bg-gradient-to-br from-purple-50 to-violet-50 rounded-lg p-3 animate-fade-in">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-xs font-semibold text-purple-700 uppercase tracking-wider">
                比赛 {expandedPair.i + 1} × 比赛 {expandedPair.j + 1}
              </p>
              <p className="text-[11px] text-stone-600 mt-0.5">
                赔率: {matches[expandedPair.i]?.odds?.toFixed(2)} × {matches[expandedPair.j]?.odds?.toFixed(2)}
              </p>
            </div>
            <button
              onClick={() => onSelectPair?.(null)}
              className="text-xs text-purple-400 hover:text-purple-600"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="text-[11px]">
              <span className="text-stone-500">脆弱性分数</span>
              <p className="text-sm font-semibold text-stone-700">{expandedPair.score}%</p>
            </div>
            <div className="text-[11px]">
              <span className="text-stone-500">风险等级</span>
              <p className="text-sm font-semibold text-stone-700">
                {getRiskIcon(expandedPair.riskLevel)} {expandedPair.riskLevel}
              </p>
            </div>
            {expandedPair.confidence !== undefined && (
              <div className="text-[11px]">
                <span className="text-stone-500">置信度</span>
                <p className="text-sm font-semibold text-stone-700">{(expandedPair.confidence * 100).toFixed(0)}%</p>
              </div>
            )}
            {expandedPair.isSignificant !== undefined && (
              <div className="text-[11px]">
                <span className="text-stone-500">统计显著性</span>
                <p className="text-sm font-semibold text-stone-700">
                  {expandedPair.isSignificant ? '✓ 显著' : '○ 不显著'}
                </p>
              </div>
            )}
          </div>

          {expandedPair.score > 40 && (
            <div className="mt-2 pt-2 border-t border-purple-200/50 flex items-start gap-2">
              <AlertTriangle size={12} className="text-orange-500 mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-orange-700">
                这对比赛的失败风险高度相关。考虑避免同时投注或分割成独立组合。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
