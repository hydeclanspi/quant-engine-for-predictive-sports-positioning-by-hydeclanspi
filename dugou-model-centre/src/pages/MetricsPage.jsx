import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  FileText,
  Gauge,
  LineChart,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { getMetricsSnapshot } from '../lib/analytics'
import TimeRangePicker from '../components/TimeRangePicker'

const PERIOD_LABELS = {
  '1w': '近一周',
  '2w': '近两周',
  '1m': '近一月',
  all: '全部',
}

const MATRIX_TABS = [
  { id: 'mode', label: 'Mode 矩阵' },
  { id: 'conf', label: 'Conf 矩阵' },
  { id: 'odds', label: 'Odds 矩阵' },
  { id: 'entries', label: 'Entries 矩阵' },
]

const signed = (value, digits = 2, suffix = '') => {
  const num = Number(value || 0)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(digits)}${suffix}`
}

const HitRateGlyph = ({ size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <path d="M3.8 16.2L16.2 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M11.9 3.8H16.2V8.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 16H7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M9 16H12.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M13.7 16H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const ICON_TONE_CLASS = {
  indigo:
    'border-indigo-200 bg-gradient-to-b from-indigo-50 via-violet-50 to-white text-indigo-600 shadow-[0_1px_2px_rgba(99,102,241,0.16),inset_0_1px_0_rgba(255,255,255,0.88)]',
  sky: 'border-sky-200 bg-gradient-to-b from-sky-50 via-cyan-50 to-white text-sky-600 shadow-[0_1px_2px_rgba(14,165,233,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]',
  emerald:
    'border-emerald-200 bg-gradient-to-b from-emerald-50 via-teal-50 to-white text-emerald-600 shadow-[0_1px_2px_rgba(16,185,129,0.17),inset_0_1px_0_rgba(255,255,255,0.88)]',
  amber:
    'border-amber-200 bg-gradient-to-b from-amber-50 via-orange-50 to-white text-amber-600 shadow-[0_1px_2px_rgba(245,158,11,0.16),inset_0_1px_0_rgba(255,255,255,0.9)]',
  violet:
    'border-violet-200 bg-gradient-to-b from-violet-50 via-fuchsia-50 to-white text-violet-600 shadow-[0_1px_2px_rgba(139,92,246,0.16),inset_0_1px_0_rgba(255,255,255,0.9)]',
  rose: 'border-rose-200 bg-gradient-to-b from-rose-50 via-pink-50 to-white text-rose-600 shadow-[0_1px_2px_rgba(244,63,94,0.16),inset_0_1px_0_rgba(255,255,255,0.9)]',
  slate:
    'border-stone-200 bg-gradient-to-b from-stone-50 via-zinc-50 to-white text-stone-600 shadow-[0_1px_2px_rgba(41,37,36,0.12),inset_0_1px_0_rgba(255,255,255,0.9)]',
}

const GlassCardIcon = ({ IconComp, tone = 'indigo', iconSize = 14, className = '' }) => (
  <span
    className={`inline-flex h-7 w-7 items-center justify-center rounded-xl border ${ICON_TONE_CLASS[tone] || ICON_TONE_CLASS.indigo} ${className}`}
  >
    <IconComp size={iconSize} strokeWidth={1.7} />
  </span>
)

const toRmb = (value, digits = 0) => `¥${Number(value || 0).toFixed(digits)}`

const getConfColor = (value) => {
  const conf = Number(value)
  if (!Number.isFinite(conf)) return 'text-stone-400'
  if (conf >= 0.8) return 'text-blue-700'
  if (conf >= 0.7) return 'text-blue-600'
  if (conf >= 0.6) return 'text-sky-600'
  if (conf >= 0.5) return 'text-sky-500'
  return 'text-sky-400'
}

const getAJRColor = (value) => {
  const ajr = Number(value)
  if (!Number.isFinite(ajr)) return 'text-stone-400'
  if (ajr >= 0.8) return 'text-emerald-700'
  if (ajr >= 0.7) return 'text-emerald-600'
  if (ajr >= 0.6) return 'text-teal-500'
  if (ajr >= 0.4) return 'text-teal-400'
  if (ajr >= 0.2) return 'text-emerald-300'
  return 'text-emerald-200'
}

const getCorrelationTone = (value) => {
  const abs = Math.abs(value)
  if (abs >= 0.5) return '强'
  if (abs >= 0.3) return '中'
  if (abs >= 0.1) return '弱'
  return '极弱'
}

const getCorrelationColor = (value) => {
  if (value >= 0.3) return 'text-emerald-600'
  if (value <= -0.3) return 'text-rose-500'
  return 'text-stone-500'
}

const getToneClass = (tone) => {
  if (tone === 'positive') return 'text-emerald-600'
  if (tone === 'negative') return 'text-rose-500'
  return 'text-stone-700'
}

const PaginatedMatchTable = ({ rows }) => {
  const [page, setPage] = useState(1)
  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-stone-500">
            <th className="py-2">日期</th>
            <th className="py-2">比赛</th>
            <th className="py-2">Entries</th>
            <th className="py-2">Mode</th>
            <th className="py-2">Conf</th>
            <th className="py-2">AJR</th>
            <th className="py-2">赔率</th>
            <th className="py-2">REP</th>
            <th className="py-2">ROI</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr key={row.id} className="border-b border-stone-100">
              <td className="py-2 text-stone-500">{row.dateLabel}</td>
              <td className="py-2 text-stone-700">{row.match}</td>
              <td className="py-2 text-stone-500">{row.entryLabel || row.entry || '-'}</td>
              <td className="py-2 text-stone-600">{row.mode}</td>
              <td className={`py-2 font-medium ${getConfColor(row.conf)}`}>{Number.isFinite(row.conf) ? row.conf.toFixed(2) : '-'}</td>
              <td className={`py-2 font-medium ${getAJRColor(row.ajr)}`}>{Number.isFinite(row.ajr) ? row.ajr.toFixed(2) : '-'}</td>
              <td className="py-2 text-violet-600 italic font-semibold">{Number.isFinite(row.odds) ? row.odds.toFixed(2) : '-'}</td>
              <td className="py-2 text-stone-600">{Number.isFinite(row.rep) ? row.rep.toFixed(2) : '-'}</td>
              <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pt-3 border-t border-stone-200">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className={`px-3 py-1.5 rounded-lg text-xs ${currentPage === 1 ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'}`}
          >
            ← 上一页
          </button>
          <span className="text-xs text-stone-400">
            第 {currentPage} / {totalPages} 页
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className={`px-3 py-1.5 rounded-lg text-xs ${currentPage === totalPages ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'}`}
          >
            下一页 →
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MetricsPage({ openModal }) {
  const navigate = useNavigate()
  const [timePeriod, setTimePeriod] = useState('all')
  const [matrixTab, setMatrixTab] = useState('mode')
  const snapshot = useMemo(() => getMetricsSnapshot(timePeriod), [timePeriod])

  const noSettledData = snapshot.headline.totalInvestments === 0 || snapshot.headline.totalInputs === 0

  const metrics = [
    {
      id: 'totalInvestments',
      label: '总投资次数',
      value: String(snapshot.headline.totalInvestments),
      description: '累计投资笔数（已结算）',
      IconComp: FileText,
      tone: 'slate',
    },
    {
      id: 'totalInputs',
      label: '总投入金额',
      value: toRmb(snapshot.headline.totalInputs),
      description: '累计投入',
      IconComp: Wallet,
      tone: 'amber',
    },
    {
      id: 'totalProfit',
      label: '总收益',
      value: signed(snapshot.headline.totalProfit, 0),
      description: '累计盈亏',
      IconComp: TrendingUp,
      tone: 'emerald',
    },
    {
      id: 'roi',
      label: '累计 ROI',
      value: signed(snapshot.headline.roi, 2, '%'),
      description: '总收益/总投入',
      IconComp: BarChart3,
      tone: 'indigo',
    },
    {
      id: 'maxWin',
      label: '最大单笔盈利',
      value: signed(snapshot.headline.maxWin, 0),
      description: '历史最高单笔收益',
      IconComp: TrendingUp,
      tone: 'sky',
    },
    {
      id: 'maxLoss',
      label: '最大单笔亏损',
      value: signed(snapshot.headline.maxLoss, 0),
      description: '历史最大单笔亏损',
      IconComp: TrendingDown,
      tone: 'rose',
    },
    {
      id: 'maxWinStreak',
      label: '连胜最高',
      value: `${snapshot.headline.maxWinStreak} 场`,
      description: '历史最长连胜',
      IconComp: Activity,
      tone: 'emerald',
    },
    {
      id: 'maxLoseStreak',
      label: '连败最高',
      value: `${snapshot.headline.maxLoseStreak} 场`,
      description: '历史最长连败',
      IconComp: Clock3,
      tone: 'slate',
    },
    {
      id: 'avgConf',
      label: '平均 Conf',
      value: snapshot.headline.avgConf.toFixed(2),
      description: '平均主观置信度',
      IconComp: SlidersHorizontal,
      tone: 'indigo',
    },
    {
      id: 'avgOdds',
      label: '平均 Odds',
      value: snapshot.headline.avgOdds.toFixed(2),
      description: '平均赔率',
      IconComp: LineChart,
      tone: 'violet',
    },
    {
      id: 'sharpe',
      label: 'Sharpe Ratio',
      value: snapshot.headline.sharpe.toFixed(2),
      description: '风险调整后收益',
      IconComp: Gauge,
      tone: 'sky',
    },
    {
      id: 'hitRateEdge',
      label: '胜率/期望值',
      value: `${snapshot.headline.hitRate.toFixed(1)}% / ${signed(snapshot.headline.avgExpectedEdge * 100, 1, '%')}`,
      description: '命中率与平均期望边际',
      IconComp: HitRateGlyph,
      tone: 'indigo',
    },
  ]

  const getMetricDetailRows = (metricId) => {
    const avgInput = snapshot.headline.totalInvestments > 0 ? snapshot.headline.totalInputs / snapshot.headline.totalInvestments : 0
    switch (metricId) {
      case 'totalInvestments':
        return [
          { label: '已结算投资笔数', value: String(snapshot.headline.totalInvestments) },
          { label: '样本比赛总数', value: String(snapshot.matchRows.length) },
          { label: '命中率', value: `${snapshot.headline.hitRate.toFixed(1)}%`, tone: snapshot.headline.hitRate >= 50 ? 'positive' : 'negative' },
        ]
      case 'totalInputs':
        return [
          { label: '累计投入', value: toRmb(snapshot.headline.totalInputs) },
          { label: '平均每笔投入', value: toRmb(avgInput) },
          { label: '资金利用率', value: `${snapshot.efficiency.utilization.toFixed(2)}%` },
        ]
      case 'totalProfit':
        return [
          { label: '累计收益', value: signed(snapshot.headline.totalProfit, 0), tone: snapshot.headline.totalProfit >= 0 ? 'positive' : 'negative' },
          { label: '平均每笔收益', value: signed(snapshot.efficiency.avgProfitPerInvest, 2), tone: snapshot.efficiency.avgProfitPerInvest >= 0 ? 'positive' : 'negative' },
          { label: 'Profit Factor', value: snapshot.efficiency.profitFactor.toFixed(2), tone: snapshot.efficiency.profitFactor >= 1 ? 'positive' : 'negative' },
        ]
      case 'roi':
        return [
          { label: '累计 ROI', value: signed(snapshot.headline.roi, 2, '%'), tone: snapshot.headline.roi >= 0 ? 'positive' : 'negative' },
          { label: '近 7 天 ROI', value: signed(snapshot.trends.roi7, 2, '%'), tone: snapshot.trends.roi7 >= 0 ? 'positive' : 'negative' },
          { label: '近 30 天 ROI', value: signed(snapshot.trends.roi30, 2, '%'), tone: snapshot.trends.roi30 >= 0 ? 'positive' : 'negative' },
        ]
      case 'maxWin':
        return [
          { label: '最大单笔盈利', value: signed(snapshot.headline.maxWin, 0), tone: 'positive' },
          { label: '连胜最高', value: `${snapshot.headline.maxWinStreak} 场` },
          { label: '命中率', value: `${snapshot.headline.hitRate.toFixed(1)}%`, tone: snapshot.headline.hitRate >= 50 ? 'positive' : 'negative' },
        ]
      case 'maxLoss':
        return [
          { label: '最大单笔亏损', value: signed(snapshot.headline.maxLoss, 0), tone: 'negative' },
          { label: '连败最高', value: `${snapshot.headline.maxLoseStreak} 场` },
          { label: '最大回撤', value: `-${snapshot.risk.maxDrawdown.toFixed(2)}%`, tone: 'negative' },
        ]
      case 'maxWinStreak':
        return [
          { label: '历史最长连胜', value: `${snapshot.headline.maxWinStreak} 场` },
          { label: '累计 ROI', value: signed(snapshot.headline.roi, 2, '%'), tone: snapshot.headline.roi >= 0 ? 'positive' : 'negative' },
          { label: '近 14 天 ROI', value: signed(snapshot.trends.roi14, 2, '%'), tone: snapshot.trends.roi14 >= 0 ? 'positive' : 'negative' },
        ]
      case 'maxLoseStreak':
        return [
          { label: '历史最长连败', value: `${snapshot.headline.maxLoseStreak} 场` },
          { label: '最大回撤', value: `-${snapshot.risk.maxDrawdown.toFixed(2)}%`, tone: 'negative' },
          { label: 'Sortino Ratio', value: snapshot.risk.sortino.toFixed(2), tone: snapshot.risk.sortino >= 0 ? 'positive' : 'negative' },
        ]
      case 'avgConf':
        return [
          { label: '平均 Conf', value: snapshot.headline.avgConf.toFixed(2) },
          { label: 'Conf vs AJR 相关', value: signed(snapshot.correlations.conf_vs_ajr, 2), tone: snapshot.correlations.conf_vs_ajr >= 0 ? 'positive' : 'negative' },
          { label: '平均期望边际', value: signed(snapshot.headline.avgExpectedEdge * 100, 1, '%'), tone: snapshot.headline.avgExpectedEdge >= 0 ? 'positive' : 'negative' },
        ]
      case 'avgOdds':
        return [
          { label: '平均 Odds', value: snapshot.headline.avgOdds.toFixed(2) },
          { label: 'Odds vs Return 相关', value: signed(snapshot.correlations.odds_vs_return, 2), tone: snapshot.correlations.odds_vs_return >= 0 ? 'positive' : 'negative' },
          { label: '样本比赛总数', value: String(snapshot.matchRows.length) },
        ]
      case 'sharpe':
        return [
          { label: 'Sharpe', value: snapshot.headline.sharpe.toFixed(2), tone: snapshot.headline.sharpe >= 0 ? 'positive' : 'negative' },
          { label: 'Sortino', value: snapshot.risk.sortino.toFixed(2), tone: snapshot.risk.sortino >= 0 ? 'positive' : 'negative' },
          { label: '波动率', value: `${snapshot.risk.volatility.toFixed(2)}%` },
        ]
      case 'hitRateEdge':
      default:
        return [
          { label: '命中率', value: `${snapshot.headline.hitRate.toFixed(1)}%`, tone: snapshot.headline.hitRate >= 50 ? 'positive' : 'negative' },
          { label: '平均期望边际', value: signed(snapshot.headline.avgExpectedEdge * 100, 1, '%'), tone: snapshot.headline.avgExpectedEdge >= 0 ? 'positive' : 'negative' },
          { label: '累计 ROI', value: signed(snapshot.headline.roi, 2, '%'), tone: snapshot.headline.roi >= 0 ? 'positive' : 'negative' },
        ]
    }
  }

  const openMetricDetail = (metric) => {
    if (!openModal) return
    const rows = getMetricDetailRows(metric.id)
    openModal({
      title: `${metric.label} · 详细数据`,
      content: (
        <div className="space-y-4">
          <div className="p-4 bg-stone-50 rounded-xl">
            <div className="text-3xl font-bold text-stone-800 mb-2">{metric.value}</div>
            <p className="text-sm text-stone-500">{metric.description}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">指标项</th>
                <th className="py-2">数值</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${metric.id}-${row.label}`} className="border-b border-stone-100">
                  <td className="py-2 text-stone-600">{row.label}</td>
                  <td className={`py-2 font-medium ${getToneClass(row.tone)}`}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    })
  }

  const openMatrixDetail = (title, rows) => {
    if (!openModal) return
    openModal({
      title,
      content: <PaginatedMatchTable rows={rows} />,
    })
  }

  const openAllMatchesDetail = () => openMatrixDetail('全量样本明细', snapshot.matchRows)

  const openModeDetail = (mode) => openMatrixDetail(`${mode} · 样本明细`, snapshot.matchRows.filter((row) => row.mode === mode))
  const openConfDetail = (bucket) => openMatrixDetail(`Conf ${bucket} · 样本明细`, snapshot.matchRows.filter((row) => row.confBucket === bucket))
  const openOddsDetail = (bucket) => openMatrixDetail(`Odds ${bucket} · 样本明细`, snapshot.matchRows.filter((row) => row.oddsBucket === bucket))
  const openEntryDetail = (marketType, marketLabel) =>
    openMatrixDetail(`${marketLabel} · 样本明细`, snapshot.matchRows.filter((row) => row.entryType === marketType))

  const matrixSummary = useMemo(() => {
    let rows = []
    if (matrixTab === 'mode') rows = snapshot.matrix.mode
    else if (matrixTab === 'conf') rows = snapshot.matrix.conf
    else if (matrixTab === 'odds') rows = snapshot.matrix.odds
    else rows = snapshot.matrix.entries || []
    if (!Array.isArray(rows) || rows.length === 0) {
      return { top: null, bottom: null }
    }
    const sorted = [...rows].sort((a, b) => b.roi - a.roi || b.samples - a.samples)
    return {
      top: sorted[0] || null,
      bottom: sorted[sorted.length - 1] || null,
    }
  }, [matrixTab, snapshot.matrix.conf, snapshot.matrix.entries, snapshot.matrix.mode, snapshot.matrix.odds])

  const getMatrixRowLabel = (row) => {
    if (!row) return '-'
    if (matrixTab === 'mode') return row.mode
    if (matrixTab === 'entries') return row.marketLabel
    return row.bucket
  }

  const openMatrixRowDetail = (row) => {
    if (!row) return
    if (matrixTab === 'mode') {
      openModeDetail(row.mode)
      return
    }
    if (matrixTab === 'conf') {
      openConfDetail(row.bucket)
      return
    }
    if (matrixTab === 'odds') {
      openOddsDetail(row.bucket)
      return
    }
    openEntryDetail(row.marketType, row.marketLabel)
  }

  return (
    <div className="page-shell page-content-wide">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-stone-800 font-display">数据总览</h2>
          <p className="text-stone-400 text-sm mt-1">核心指标 + 参数矩阵 + 相关性系数</p>
        </div>
        <TimeRangePicker value={timePeriod} onChange={setTimePeriod} options={PERIOD_LABELS} />
      </div>

      {noSettledData && (
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-4">
          <h3 className="text-lg font-semibold text-stone-800 mb-2">当前时间窗口暂无指标数据</h3>
          <p className="text-sm text-stone-500 mb-4">先录入投资并完成结算后，风险、效率和矩阵指标会自动生成。</p>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/new')} className="btn-primary btn-hover">
              去新建投资
            </button>
            <button onClick={() => navigate('/settle')} className="btn-secondary btn-hover">
              去待结算
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            onClick={() => openMetricDetail(metric)}
            className="glow-card group bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-stone-400 text-xs uppercase tracking-wide">{metric.label}</span>
              <GlassCardIcon IconComp={metric.IconComp} tone={metric.tone} />
            </div>
            <span
              className={`text-xl font-semibold ${
                metric.value.includes('+') ? 'text-emerald-600' : metric.value.includes('-') && !metric.value.includes('场') ? 'text-rose-500' : 'text-stone-800'
              }`}
            >
              {metric.value}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-3 gap-6">
        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <h3 className="font-medium text-stone-700 mb-4 flex items-center gap-2">
            <GlassCardIcon IconComp={Activity} tone="sky" />
            近期趋势
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">近7天 ROI</span>
              <span className={`text-sm font-semibold ${snapshot.trends.roi7 >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(snapshot.trends.roi7, 2, '%')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">近14天 ROI</span>
              <span className={`text-sm font-semibold ${snapshot.trends.roi14 >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(snapshot.trends.roi14, 2, '%')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">近30天 ROI</span>
              <span className={`text-sm font-semibold ${snapshot.trends.roi30 >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(snapshot.trends.roi30, 2, '%')}</span>
            </div>
          </div>
        </div>

        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <h3 className="font-medium text-stone-700 mb-4 flex items-center gap-2">
            <GlassCardIcon IconComp={ShieldCheck} tone="rose" />
            风险指标
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">最大回撤</span>
              <span className="text-sm font-semibold text-rose-500">-{snapshot.risk.maxDrawdown.toFixed(2)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">波动率</span>
              <span className="text-sm font-semibold text-stone-700">{snapshot.risk.volatility.toFixed(2)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Sortino Ratio</span>
              <span className="text-sm font-semibold text-stone-700">{snapshot.risk.sortino.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <h3 className="font-medium text-stone-700 mb-4 flex items-center gap-2">
            <GlassCardIcon IconComp={Target} tone="emerald" />
            效率指标
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">平均每笔收益</span>
              <span className={`text-sm font-semibold ${snapshot.efficiency.avgProfitPerInvest >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {signed(snapshot.efficiency.avgProfitPerInvest, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Profit Factor</span>
              <span className="text-sm font-semibold text-stone-700">{snapshot.efficiency.profitFactor.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">资金利用率</span>
              <span className="text-sm font-semibold text-stone-700">{snapshot.efficiency.utilization.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-6">
        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100 col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700 flex items-center gap-2">
              <GlassCardIcon IconComp={SlidersHorizontal} tone="indigo" />
              参数表现矩阵
            </h3>
            <div className="flex gap-2">
              {MATRIX_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setMatrixTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                    matrixTab === tab.id ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => openMatrixRowDetail(matrixSummary.top)}
              disabled={!matrixSummary.top}
              className="text-left p-3 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <p className="text-[11px] text-emerald-700">Top 区域</p>
              <p className="text-sm font-semibold text-stone-700 mt-0.5">{getMatrixRowLabel(matrixSummary.top)}</p>
              <p className={`text-xs mt-1 ${(matrixSummary.top?.roi || 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                ROI {signed(matrixSummary.top?.roi || 0, 1, '%')} · 样本 {matrixSummary.top?.samples || 0}
              </p>
            </button>
            <button
              onClick={() => openMatrixRowDetail(matrixSummary.bottom)}
              disabled={!matrixSummary.bottom}
              className="text-left p-3 rounded-xl border border-rose-200 bg-rose-50/55 hover:bg-rose-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <p className="text-[11px] text-rose-600">Bottom 区域</p>
              <p className="text-sm font-semibold text-stone-700 mt-0.5">{getMatrixRowLabel(matrixSummary.bottom)}</p>
              <p className={`text-xs mt-1 ${(matrixSummary.bottom?.roi || 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                ROI {signed(matrixSummary.bottom?.roi || 0, 1, '%')} · 样本 {matrixSummary.bottom?.samples || 0}
              </p>
            </button>
          </div>

          {matrixTab === 'mode' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2">Mode</th>
                  <th className="py-2">样本</th>
                  <th className="py-2">ROI</th>
                  <th className="py-2">命中率</th>
                  <th className="py-2">Avg Odds</th>
                  <th className="py-2">Avg(Act-Conf)</th>
                  <th className="py-2">Kelly</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.matrix.mode.map((row) => (
                  <tr key={row.mode} className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => openModeDetail(row.mode)}>
                    <td className="py-2 font-medium text-stone-700">{row.mode}</td>
                    <td className="py-2 text-stone-600">{row.samples}</td>
                    <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
                    <td className="py-2 text-stone-600">{row.hitRate.toFixed(1)}%</td>
                    <td className="py-2 text-stone-600">{row.avgOdds.toFixed(2)}</td>
                    <td className={`py-2 font-medium ${row.avgActualMinusConf >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.avgActualMinusConf, 2)}</td>
                    <td className="py-2 text-amber-600 font-medium">{row.kelly.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {matrixTab === 'conf' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2">Conf 区间</th>
                  <th className="py-2">样本</th>
                  <th className="py-2">预期</th>
                  <th className="py-2">实际</th>
                  <th className="py-2">偏差</th>
                  <th className="py-2">命中率</th>
                  <th className="py-2">ROI</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.matrix.conf.map((row) => (
                  <tr key={row.bucket} className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => openConfDetail(row.bucket)}>
                    <td className="py-2 font-medium text-stone-700">{row.bucket}</td>
                    <td className="py-2 text-stone-600">{row.samples}</td>
                    <td className={`py-2 font-medium ${getConfColor(row.expected)}`}>{row.expected.toFixed(2)}</td>
                    <td className={`py-2 font-medium ${getAJRColor(row.actual)}`}>{row.actual.toFixed(2)}</td>
                    <td className={`py-2 font-medium ${row.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.diff, 2)}</td>
                    <td className="py-2 text-stone-600">{row.hitRate.toFixed(1)}%</td>
                    <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {matrixTab === 'odds' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2">Odds 区间</th>
                  <th className="py-2">样本</th>
                  <th className="py-2">命中率</th>
                  <th className="py-2">ROI</th>
                  <th className="py-2">Avg Conf</th>
                  <th className="py-2">Avg AJR</th>
                  <th className="py-2">偏差</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.matrix.odds.map((row) => (
                  <tr key={row.bucket} className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => openOddsDetail(row.bucket)}>
                    <td className="py-2 font-medium text-stone-700">{row.bucket}</td>
                    <td className="py-2 text-stone-600">{row.samples}</td>
                    <td className="py-2 text-stone-600">{row.hitRate.toFixed(1)}%</td>
                    <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
                    <td className={`py-2 font-medium ${getConfColor(row.avgConf)}`}>{row.avgConf.toFixed(2)}</td>
                    <td className={`py-2 font-medium ${getAJRColor(row.avgAjr)}`}>{row.avgAjr.toFixed(2)}</td>
                    <td className={`py-2 font-medium ${row.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.diff, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {matrixTab === 'entries' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2">Entries 类型</th>
                  <th className="py-2">样本</th>
                  <th className="py-2">命中率</th>
                  <th className="py-2">ROI</th>
                  <th className="py-2">Avg Odds</th>
                  <th className="py-2">Avg Conf</th>
                  <th className="py-2">偏差</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.matrix.entries || []).map((row) => (
                  <tr
                    key={row.marketType}
                    className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer"
                    onClick={() => openEntryDetail(row.marketType, row.marketLabel)}
                  >
                    <td className="py-2 font-medium text-stone-700">{row.marketLabel}</td>
                    <td className="py-2 text-stone-600">{row.samples}</td>
                    <td className="py-2 text-stone-600">{row.hitRate.toFixed(1)}%</td>
                    <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
                    <td className="py-2 text-stone-600">{row.avgOdds.toFixed(2)}</td>
                    <td className={`py-2 font-medium ${getConfColor(row.avgConf)}`}>{row.avgConf.toFixed(2)}</td>
                    <td className={`py-2 font-medium ${row.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.diff, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="text-xs text-stone-400 mt-3">提示：点击矩阵中的任意行可展开对应历史样本明细。</p>
        </div>

        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <h3 className="font-medium text-stone-700 mb-4 flex items-center gap-2">
            <GlassCardIcon IconComp={Database} tone="violet" />
            相关性系数
          </h3>
          <div className="space-y-3 text-sm">
            {[
              { label: 'Conf vs AJR', value: snapshot.correlations.conf_vs_ajr },
              { label: 'Odds vs Return', value: snapshot.correlations.odds_vs_return },
              { label: 'REP vs Return', value: snapshot.correlations.rep_vs_return },
              { label: 'FID vs Return', value: snapshot.correlations.fid_vs_return },
              { label: 'FSE vs Return', value: snapshot.correlations.fse_vs_return },
            ].map((item) => (
              <div key={item.label} className="p-3 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex items-center justify-between">
                  <span className="text-stone-600">{item.label}</span>
                  <span className={`font-semibold ${getCorrelationColor(item.value)}`}>{signed(item.value, 2)}</span>
                </div>
                <p className="text-[11px] text-stone-400 mt-1">
                  相关强度：{getCorrelationTone(item.value)} · {item.value >= 0 ? '正相关' : '负相关'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 glow-card bg-white rounded-2xl p-6 border border-stone-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <GlassCardIcon IconComp={FileText} tone="slate" />
            样本明细预览
          </h3>
          <button onClick={openAllMatchesDetail} className="text-xs text-amber-600 hover:text-amber-700">
            查看全部明细 →
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2">日期</th>
              <th className="py-2">比赛</th>
              <th className="py-2">Mode</th>
              <th className="py-2">Conf</th>
              <th className="py-2">AJR</th>
              <th className="py-2">赔率</th>
              <th className="py-2">ROI</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.matchRows.slice(0, 12).map((row) => (
              <tr key={row.id} className="border-b border-stone-100">
                <td className="py-2 text-stone-500">{row.dateLabel}</td>
                <td className="py-2 text-stone-700">{row.match}</td>
                <td className="py-2 text-stone-600">{row.mode}</td>
                <td className={`py-2 font-medium ${getConfColor(row.conf)}`}>{Number.isFinite(row.conf) ? row.conf.toFixed(2) : '-'}</td>
                <td className={`py-2 font-medium ${getAJRColor(row.ajr)}`}>{Number.isFinite(row.ajr) ? row.ajr.toFixed(2) : '-'}</td>
                <td className="py-2 text-violet-600 italic font-semibold">{Number.isFinite(row.odds) ? row.odds.toFixed(2) : '-'}</td>
                <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
