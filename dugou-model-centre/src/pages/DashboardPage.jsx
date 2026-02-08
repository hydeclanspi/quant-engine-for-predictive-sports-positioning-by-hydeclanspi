import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDashboardSnapshot } from '../lib/analytics'
import TimeRangePicker from '../components/TimeRangePicker'
import { getSystemConfig, saveSystemConfig, addCapitalInjection } from '../lib/localData'
import { downloadWorkbook } from '../lib/excel'
import * as XLSX from 'xlsx'

const PERIOD_LABELS = {
  '1w': '近一周',
  '2w': '近两周',
  '1m': '本月',
  all: '全部',
}

const CHART_OPTIONS = [
  { key: 'fund', label: '资金走势' },
  { key: 'conf', label: 'Conf 相关性走势' },
  { key: 'rating', label: 'Judgmental Rating 准确度走势' },
]

const toSigned = (value, digits = 1, suffix = '') => {
  const num = Number(value || 0)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(digits)}${suffix}`
}

const toPercent = (value, digits = 1) => `${Number(value || 0).toFixed(digits)}%`

const toRmb = (value) => `¥${Number(value || 0).toFixed(0)}`

const getStatusLabel = (status) => {
  if (status === 'win') return '已中'
  if (status === 'lose') return '未中'
  if (status === 'draw') return '平局'
  return '待结算'
}

const getStatusTone = (status) => {
  if (status === 'win') return 'text-emerald-600'
  if (status === 'lose') return 'text-rose-500'
  if (status === 'draw') return 'text-sky-600'
  return 'text-amber-600'
}

const buildSmartReminder = (snapshot) => {
  const settled = Number(snapshot?.settledPeriod || 0)
  const streaks = snapshot?.streaks || {}
  const momentum = snapshot?.momentum || {}
  const roiDelta = Number(momentum.roiDelta || 0)
  const hitDelta = Number(momentum.hitRateDelta || 0)
  const roiDeltaText = `${roiDelta >= 0 ? '+' : ''}${roiDelta.toFixed(1)}%`
  const hitDeltaText = `${hitDelta >= 0 ? '+' : ''}${hitDelta.toFixed(1)}pp`

  if (settled === 0) {
    return {
      tag: '样本初始化',
      tagClass: 'border border-amber-100 bg-amber-50/80 text-amber-700',
      message: '当前窗口样本不足，待新增已结算样本后再输出稳定推断',
      meta: '',
    }
  }

  if ((streaks.currentType === 'lose' && streaks.currentLength >= 2) || momentum.direction === 'down') {
    return {
      tag: '回撤信号',
      tagClass: 'border border-rose-100 bg-rose-50/80 text-rose-600',
      message: '最近窗口出现回撤信号，建议暂时收敛风险敞口并继续采样',
      meta: `动量 ${roiDeltaText} / ${hitDeltaText}`,
    }
  }

  if ((streaks.currentType === 'win' && streaks.currentLength >= 2) || momentum.direction === 'up') {
    return {
      tag: '正向动量',
      tagClass: 'border border-emerald-100 bg-emerald-50/80 text-emerald-700',
      message: '最近窗口呈现正向动量，建议维持基线仓位并观察样本扩充',
      meta: `动量 ${roiDeltaText} / ${hitDeltaText}`,
    }
  }

  return {
    tag: '中性区间',
    tagClass: 'border border-stone-200 bg-stone-100/80 text-stone-600',
    message: '当前未检测到显著单边趋势，建议保持基线仓位并持续记录',
    meta: `动量 ${roiDeltaText} / ${hitDeltaText}`,
  }
}

const buildSparklinePoints = (series) => {
  if (!Array.isArray(series) || series.length === 0) return { line: '', area: '' }
  const safeSeries = series.slice(-24)
  const values = safeSeries.map((item) => Number(item.value || 0))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = safeSeries.map((item, index) => {
    const x = 10 + (index / Math.max(safeSeries.length - 1, 1)) * 380
    const y = 72 - ((Number(item.value || 0) - min) / range) * 52
    return `${x},${y}`
  })
  return {
    line: points.join(' '),
    area: `${points.join(' ')} 390,100 10,100`,
    labels: safeSeries.map((item) => item.label || '--'),
  }
}

const DASHBOARD_BRIEF_VIEW_KEY = 'dugou:dashboard-evidence-brief-view-count'

const shouldShowEvidenceBriefThisVisit = () => {
  try {
    const previous = Number(window.localStorage.getItem(DASHBOARD_BRIEF_VIEW_KEY) || 0)
    const next = previous + 1
    window.localStorage.setItem(DASHBOARD_BRIEF_VIEW_KEY, String(next))
    return next % 3 === 0
  } catch {
    return false
  }
}

export default function DashboardPage({ openModal }) {
  const navigate = useNavigate()
  const [timePeriod, setTimePeriod] = useState('2w')
  const [showChartPicker, setShowChartPicker] = useState(false)
  const [showExportPicker, setShowExportPicker] = useState(false)
  const [chartKey, setChartKey] = useState('fund')
  const [showSmartReminder, setShowSmartReminder] = useState(false)
  const [showInjectModal, setShowInjectModal] = useState(false)
  const [injectAmount, setInjectAmount] = useState('')
  const [dataVersion, setDataVersion] = useState(0)
  const exportPickerRef = useRef(null)

  const systemConfig = useMemo(() => getSystemConfig(), [dataVersion])
  const snapshot = useMemo(() => getDashboardSnapshot(timePeriod), [timePeriod, dataVersion])

  const handleInjectCapital = () => {
    const amount = Number(injectAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('请输入有效的注资金额')
      return
    }
    // 记录注资历史
    addCapitalInjection(amount)
    // 更新初始资金
    const newInitialCapital = Number(systemConfig.initialCapital || 0) + amount
    saveSystemConfig({ initialCapital: newInitialCapital })
    setDataVersion((prev) => prev + 1)
    setInjectAmount('')
    setShowInjectModal(false)
  }

  useEffect(() => {
    if (!showExportPicker) return undefined

    const onDocMouseDown = (event) => {
      if (!exportPickerRef.current) return
      if (!exportPickerRef.current.contains(event.target)) {
        setShowExportPicker(false)
      }
    }

    const onDocKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowExportPicker(false)
      }
    }

    window.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onDocKeyDown)
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onDocKeyDown)
    }
  }, [showExportPicker])

  useEffect(() => {
    setShowSmartReminder(shouldShowEvidenceBriefThisVisit())
  }, [])

  const chartSeries = useMemo(() => {
    if (chartKey === 'conf') {
      return snapshot.confCalibration.map((item) => ({
        label: item.label,
        value: Number((item.actual * 100).toFixed(2)),
      }))
    }
    if (chartKey === 'rating') {
      const rolling = [...snapshot.ratingRows]
        .reverse()
        .map((row, idx, arr) => {
          const start = Math.max(0, idx - 3)
          const windowRows = arr.slice(start, idx + 1)
          const fit =
            windowRows.reduce((sum, item) => sum + (1 - Math.abs(item.diff)), 0) /
            Math.max(windowRows.length, 1)
          return {
            label: row.dateLabel,
            value: Number((Math.max(0, fit) * 100).toFixed(2)),
          }
        })
      return rolling
    }
    return snapshot.timeline.map((point) => ({
      label: point.label,
      value: point.balance,
    }))
  }, [chartKey, snapshot.confCalibration, snapshot.ratingRows, snapshot.timeline])

  const sparkline = useMemo(() => buildSparklinePoints(chartSeries), [chartSeries])
  const smartReminder = useMemo(() => buildSmartReminder(snapshot), [snapshot])
  const smartReminderLine = useMemo(() => {
    if (!smartReminder.meta) return smartReminder.message
    return `${smartReminder.message}（${smartReminder.meta}）`
  }, [smartReminder.message, smartReminder.meta])

  const repCards = useMemo(
    () =>
      snapshot.repDetail.map((bucket, idx) => ({
        ...bucket,
        toneClass: idx === 0 ? 'text-emerald-600' : idx === 1 ? 'text-stone-600' : 'text-rose-500',
      })),
    [snapshot.repDetail],
  )

  const confDetailRows = useMemo(() => snapshot.confDetail, [snapshot.confDetail])
  const topAdvantageRows = useMemo(() => snapshot.advantage.top, [snapshot.advantage.top])

  const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(href)
  }

  const exportAsJson = () => {
    const systemConfig = getSystemConfig()
    const payload = {
      exported_at: new Date().toISOString(),
      period: timePeriod,
      period_label: PERIOD_LABELS[timePeriod],
      system_config: systemConfig,
      summary: {
        poolBalance: snapshot.poolBalance,
        roiPeriod: snapshot.roiPeriod,
        hitRatePeriod: snapshot.hitRatePeriod,
        ratingFit: snapshot.ratingFit,
        settledPeriod: snapshot.settledPeriod,
        pendingPeriod: snapshot.pendingPeriod,
      },
      repBuckets: snapshot.repBuckets,
      confCalibration: snapshot.confCalibration,
      recent: snapshot.recent,
      balanceLedger: snapshot.balanceLedger,
      timeline: snapshot.timeline,
    }
    const dateKey = new Date().toISOString().slice(0, 10)
    downloadFile(`dashboard-report-${dateKey}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
  }

  const quoteCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`

  const exportAsCsv = () => {
    const systemConfig = getSystemConfig()
    const rows = [
      ['section', 'field', 'value'],
      ['summary', 'period', PERIOD_LABELS[timePeriod]],
      ['summary', 'pool_balance', snapshot.poolBalance],
      ['summary', 'roi_percent', snapshot.roiPeriod],
      ['summary', 'hit_rate_percent', snapshot.hitRatePeriod],
      ['summary', 'rating_fit', snapshot.ratingFit],
      ['summary', 'settled_count', snapshot.settledPeriod],
      ['summary', 'pending_count', snapshot.pendingPeriod],
      [],
      ['section', 'field', 'value'],
      ['system_config', 'initial_capital', systemConfig.initialCapital],
      ['system_config', 'risk_cap_ratio', systemConfig.riskCapRatio],
      ['system_config', 'default_odds', systemConfig.defaultOdds],
      ['system_config', 'kelly_divisor', systemConfig.kellyDivisor],
      ['system_config', 'weight_conf', systemConfig.weightConf],
      ['system_config', 'weight_mode', systemConfig.weightMode],
      ['system_config', 'weight_tys', systemConfig.weightTys],
      ['system_config', 'weight_fid', systemConfig.weightFid],
      ['system_config', 'weight_odds', systemConfig.weightOdds],
      ['system_config', 'weight_fse', systemConfig.weightFse],
      [],
      ['section', 'date', 'match', 'before_balance', 'profit', 'after_balance'],
      ...snapshot.balanceLedger.map((row) => ['ledger', row.dateLabel, row.match, row.before, row.profit, row.after]),
      [],
      ['section', 'match', 'entry', 'status', 'amount'],
      ...snapshot.recent.map((row) => ['recent', row.match, row.entry, row.status, row.amount]),
    ]
    const csv = rows.map((row) => row.map((cell) => quoteCsv(cell)).join(',')).join('\n')
    const dateKey = new Date().toISOString().slice(0, 10)
    downloadFile(`dashboard-report-${dateKey}.csv`, csv, 'text/csv;charset=utf-8')
  }

  const exportAsExcel = () => {
    const systemConfig = getSystemConfig()
    const workbook = XLSX.utils.book_new()

    const summaryRows = [
      { field: 'exported_at', value: new Date().toISOString() },
      { field: 'period', value: PERIOD_LABELS[timePeriod] },
      { field: 'pool_balance', value: snapshot.poolBalance },
      { field: 'roi_percent', value: snapshot.roiPeriod },
      { field: 'hit_rate_percent', value: snapshot.hitRatePeriod },
      { field: 'rating_fit', value: snapshot.ratingFit },
      { field: 'settled_count', value: snapshot.settledPeriod },
      { field: 'pending_count', value: snapshot.pendingPeriod },
    ]
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary')

    const configRows = Object.entries(systemConfig).map(([key, value]) => ({ key, value }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(configRows), 'SystemConfig')

    const ledgerRows = snapshot.balanceLedger.map((row) => ({
      date: row.dateLabel,
      match: row.match,
      before_balance: row.before,
      profit: row.profit,
      after_balance: row.after,
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ledgerRows), 'BalanceLedger')

    const recentRows = snapshot.recent.map((row) => ({
      match: row.match,
      entry: row.entry,
      status: row.status,
      amount: row.amount,
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(recentRows), 'Recent')

    const repRows = snapshot.repBuckets.map((row) => ({
      bucket: row.label,
      count: row.count,
      inputs: row.inputs,
      profit: row.profit,
      roi_percent: row.roi,
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(repRows), 'RepBuckets')

    const confRows = snapshot.confCalibration.map((row) => ({
      range: row.label,
      expected: row.expected,
      actual: row.actual,
      samples: row.samples,
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(confRows), 'ConfCalibration')

    const timelineRows = snapshot.timeline.map((row) => ({
      date: row.label,
      balance: row.balance,
    }))
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(timelineRows), 'Timeline')

    downloadWorkbook(workbook, 'dashboard-report')
  }

  const openBalanceModal = () => {
    openModal({
      title: '蓄水池余额 · 历史明细',
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl">
            <div>
              <span className="text-xs text-amber-700">当前余额</span>
              <p className="text-2xl font-bold text-amber-600">{toRmb(snapshot.poolBalance)}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-stone-400">近期 ROI</span>
              <p className="text-lg font-semibold text-emerald-600">{toPercent(snapshot.roiPeriod)}</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">日期</th>
                <th className="py-2">比赛</th>
                <th className="py-2">操作前余额</th>
                <th className="py-2">盈亏</th>
                <th className="py-2">操作后余额</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.balanceLedger.slice(0, 80).map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-stone-100 ${row.isInjection ? 'bg-yellow-50/90' : ''}`}
                >
                  <td className="py-2">{row.dateLabel}</td>
                  <td className={`py-2 ${row.isInjection ? 'text-amber-900 font-medium' : 'text-stone-700'}`}>
                    {row.isInjection ? (
                      <span className="inline-block rounded-sm bg-yellow-300/85 px-2 py-0.5 text-amber-900 font-semibold">
                        {row.match}
                      </span>
                    ) : (
                      row.match
                    )}
                  </td>
                  <td className="py-2">{toRmb(row.before)}</td>
                  <td className={`py-2 font-medium ${row.isInjection ? 'text-amber-700' : row.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {row.isInjection ? `+${row.profit.toFixed(0)}` : toSigned(row.profit, 0)}
                  </td>
                  <td className="py-2 font-semibold">{toRmb(row.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    })
  }

  const openRoiModal = () => {
    openModal({
      title: `${PERIOD_LABELS[timePeriod]} ROI · 结构拆解`,
      content: (
        <div className="space-y-4">
          <div className="p-4 bg-stone-50 rounded-xl">
            <p className="text-sm text-stone-500">已结算 {snapshot.settledPeriod} 笔 · 待结算 {snapshot.pendingPeriod} 笔</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{toPercent(snapshot.roiPeriod)}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">Mode</th>
                <th className="py-2">样本</th>
                <th className="py-2">ROI</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.modeBreakdown.map((row) => (
                <tr key={row.mode} className="border-b border-stone-100">
                  <td className="py-2 font-medium">{row.mode}</td>
                  <td className="py-2">{row.samples}</td>
                  <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {toSigned(row.roi, 1, '%')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    })
  }

  const openHitRateModal = () => {
    openModal({
      title: `${PERIOD_LABELS[timePeriod]} 命中率 · 详情`,
      content: (
        <div className="space-y-4">
          <div className="p-4 bg-stone-50 rounded-xl">
            <p className="text-sm text-stone-500">整体命中率</p>
            <p className="text-2xl font-bold text-stone-800">{toPercent(snapshot.hitRatePeriod)}</p>
            <p className="text-xs text-stone-400 mt-1">
              Conf ≥ 0.4：{snapshot.conf04.correct}/{snapshot.conf04.total}
            </p>
          </div>
          <div className="space-y-2">
            {snapshot.recent.map((item) => (
              <div key={item.id} className="p-3 rounded-xl border border-stone-100 bg-white">
                <p className="text-sm font-medium text-stone-700">{item.match}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-stone-400">{item.entry}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      item.status === 'win'
                        ? 'bg-emerald-100 text-emerald-700'
                        : item.status === 'lose'
                          ? 'bg-rose-100 text-rose-600'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {item.status === 'win' ? '已中' : item.status === 'lose' ? '未中' : '待结算'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    })
  }

  const openRatingModal = () => {
    openModal({
      title: `${PERIOD_LABELS[timePeriod]} Conf vs AJR · 历史记录`,
      content: (
        <div className="space-y-4">
          <div className="p-4 bg-stone-50 rounded-xl">
            <p className="text-sm text-stone-500">拟合评分（1 - 平均绝对偏差）</p>
            <p className="text-2xl font-bold text-stone-800">{snapshot.ratingFit.toFixed(2)}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">日期</th>
                <th className="py-2">比赛</th>
                <th className="py-2">Conf</th>
                <th className="py-2">AJR</th>
                <th className="py-2">差值</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.ratingRows.slice(0, 120).map((row, idx) => (
                <tr key={`${row.investment_id}-${idx}`} className="border-b border-stone-100">
                  <td className="py-2">{row.dateLabel}</td>
                  <td className="py-2 text-stone-700">{row.match}</td>
                  <td className="py-2">{row.expected_rating.toFixed(2)}</td>
                  <td className="py-2">{row.actual_rating.toFixed(2)}</td>
                  <td className={`py-2 font-medium ${row.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {toSigned(row.diff, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    })
  }

  const RepDetailContent = () => {
    const [activeKey, setActiveKey] = useState(() => repCards[0]?.key || 'low')
    const [page, setPage] = useState(1)

    useEffect(() => {
      if (!repCards.some((bucket) => bucket.key === activeKey)) {
        setActiveKey(repCards[0]?.key || 'low')
      }
    }, [activeKey, repCards])

    useEffect(() => {
      setPage(1)
    }, [activeKey])

    if (repCards.length === 0) {
      return <p className="text-sm text-stone-500">当前窗口暂无 REP 样本。</p>
    }

    const activeBucket = repCards.find((bucket) => bucket.key === activeKey) || repCards[0]
    const pageSize = 6
    const totalPages = Math.max(1, Math.ceil(activeBucket.rows.length / pageSize))
    const currentPage = Math.min(page, totalPages)
    const pageRows = activeBucket.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {repCards.map((bucket) => (
            <button
              key={bucket.key}
              onClick={() => setActiveKey(bucket.key)}
              className={`p-3 rounded-xl border text-left transition-all ${
                bucket.key === activeKey ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-stone-50 hover:bg-stone-100'
              }`}
            >
              <p className="text-xs text-stone-500">{bucket.label}</p>
              <p className={`text-sm font-semibold mt-1 ${bucket.toneClass}`}>{toSigned(bucket.roi, 1, '%')}</p>
              <p className="text-[11px] text-stone-400 mt-1">{bucket.samples} 场 · 命中率 {toPercent(bucket.hitRate)}</p>
            </button>
          ))}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2">日期</th>
              <th className="py-2">比赛</th>
              <th className="py-2">entry</th>
              <th className="py-2">REP</th>
              <th className="py-2">AJR</th>
              <th className="py-2">状态</th>
              <th className="py-2">ROI</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id} className="border-b border-stone-100">
                <td className="py-2 text-stone-500">{row.dateLabel}</td>
                <td className="py-2 text-stone-700">{row.match}</td>
                <td className="py-2 text-stone-600">{row.entry}</td>
                <td className="py-2 font-medium text-stone-700">{Number.isFinite(row.rep) ? row.rep.toFixed(2) : '-'}</td>
                <td className={`py-2 font-medium ${row.ajr >= 0.6 ? 'text-emerald-600' : 'text-stone-500'}`}>
                  {Number.isFinite(row.ajr) ? row.ajr.toFixed(2) : '-'}
                </td>
                <td className={`py-2 text-xs font-medium ${getStatusTone(row.status)}`}>{getStatusLabel(row.status)}</td>
                <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{toSigned(row.roi, 1, '%')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pt-2 border-t border-stone-200">
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

  const ConfDetailContent = () => {
    const [activeRange, setActiveRange] = useState(() => confDetailRows[0]?.label || '')
    const [page, setPage] = useState(1)

    useEffect(() => {
      if (!confDetailRows.some((row) => row.label === activeRange)) {
        setActiveRange(confDetailRows[0]?.label || '')
      }
    }, [activeRange, confDetailRows])

    useEffect(() => {
      setPage(1)
    }, [activeRange])

    if (confDetailRows.length === 0) {
      return <p className="text-sm text-stone-500">当前窗口暂无可用的 Conf/AJR 样本。</p>
    }

    const selected = confDetailRows.find((row) => row.label === activeRange) || confDetailRows[0]
    const pageSize = 6
    const totalPages = Math.max(1, Math.ceil(selected.rows.length / pageSize))
    const currentPage = Math.min(page, totalPages)
    const pageRows = selected.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    return (
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2">Conf 区间</th>
              <th className="py-2">预期</th>
              <th className="py-2">实际</th>
              <th className="py-2">偏差</th>
              <th className="py-2">命中率</th>
              <th className="py-2">ROI</th>
              <th className="py-2">样本</th>
            </tr>
          </thead>
          <tbody>
            {confDetailRows.map((row) => (
              <tr
                key={row.label}
                onClick={() => setActiveRange(row.label)}
                className={`border-b border-stone-100 cursor-pointer ${row.label === selected.label ? 'bg-amber-50' : 'hover:bg-stone-50'}`}
              >
                <td className="py-2 font-medium">{row.label}</td>
                <td className="py-2">{row.expected.toFixed(2)}</td>
                <td className="py-2">{row.actual.toFixed(2)}</td>
                <td className={`py-2 font-medium ${row.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{toSigned(row.diff, 2)}</td>
                <td className="py-2">{toPercent(row.hitRate)}</td>
                <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{toSigned(row.roi, 1, '%')}</td>
                <td className="py-2 text-stone-500">{row.samples}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-stone-200 pt-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-stone-700">Conf {selected.label} · 样本历史</h4>
            <span className="text-xs text-stone-400">{selected.rows.length} 条</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">日期</th>
                <th className="py-2">比赛</th>
                <th className="py-2">Conf</th>
                <th className="py-2">AJR</th>
                <th className="py-2">状态</th>
                <th className="py-2">ROI</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id} className="border-b border-stone-100">
                  <td className="py-2 text-stone-500">{row.dateLabel}</td>
                  <td className="py-2 text-stone-700">{row.match}</td>
                  <td className="py-2 font-medium text-sky-600">{Number.isFinite(row.conf) ? row.conf.toFixed(2) : '-'}</td>
                  <td className="py-2 font-medium text-emerald-600">{Number.isFinite(row.ajr) ? row.ajr.toFixed(2) : '-'}</td>
                  <td className={`py-2 text-xs font-medium ${getStatusTone(row.status)}`}>{getStatusLabel(row.status)}</td>
                  <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{toSigned(row.roi, 1, '%')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pt-2">
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
      </div>
    )
  }

  const AdvantageDetailContent = () => {
    const [tab, setTab] = useState('top')
    const rows = tab === 'top' ? snapshot.advantage.top : snapshot.advantage.bottom

    if (snapshot.advantage.top.length === 0 && snapshot.advantage.bottom.length === 0) {
      return <p className="text-sm text-stone-500">当前窗口样本不足，暂无法识别稳定优势领域。</p>
    }

    return (
      <div className="space-y-4">
        <div className="inline-flex rounded-xl bg-stone-100 p-1">
          <button
            onClick={() => setTab('top')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${tab === 'top' ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
          >
            优势球队
          </button>
          <button
            onClick={() => setTab('bottom')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${tab === 'bottom' ? 'bg-white text-rose-600 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
          >
            弱势球队
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-2">球队</th>
              <th className="py-2">样本</th>
              <th className="py-2">命中率</th>
              <th className="py-2">ROI</th>
              <th className="py-2">投入</th>
              <th className="py-2">盈亏</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${tab}-${row.team}`} className="border-b border-stone-100">
                <td className="py-2 font-medium text-stone-700">{row.team}</td>
                <td className="py-2 text-stone-500">{row.samples}</td>
                <td className="py-2">{toPercent(row.hitRate)}</td>
                <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{toSigned(row.roi, 1, '%')}</td>
                <td className="py-2 text-stone-500">{toRmb(row.inputs)}</td>
                <td className={`py-2 font-medium ${row.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{toSigned(row.profit, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const openRepModal = () => {
    openModal({
      title: `${PERIOD_LABELS[timePeriod]} REP (噪音过滤) Beta · 详细分析`,
      content: <RepDetailContent />,
    })
  }

  const openConfModal = () => {
    openModal({
      title: `${PERIOD_LABELS[timePeriod]} Conf 校准曲线 · 详细数据`,
      content: <ConfDetailContent />,
    })
  }

  const openAdvantageModal = () => {
    openModal({
      title: `${PERIOD_LABELS[timePeriod]} 优势领域识别 · 详细数据`,
      content: <AdvantageDetailContent />,
    })
  }

  return (
    <div className="px-8 pt-5 pb-8 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-stone-800 font-display">Dashboard</h2>
          <div className="flex items-center gap-2 mt-1">
            <TimeRangePicker value={timePeriod} onChange={setTimePeriod} options={PERIOD_LABELS} align="left" />
            <span className="text-stone-400 text-sm">· 投资 {snapshot.periodInvestments} 笔</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div ref={exportPickerRef} className="relative">
            <button
              onClick={() => setShowExportPicker((prev) => !prev)}
              className="btn-secondary btn-hover"
            >
              导出报告
            </button>
            {showExportPicker && (
              <div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-xl border border-stone-200 py-1 min-w-28 z-30 animate-fade-in">
                <button
                  onClick={() => {
                    exportAsCsv()
                    setShowExportPicker(false)
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-stone-600 hover:bg-stone-50"
                >
                  导出 CSV
                </button>
                <button
                  onClick={() => {
                    exportAsJson()
                    setShowExportPicker(false)
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-stone-600 hover:bg-stone-50"
                >
                  导出 JSON
                </button>
                <button
                  onClick={() => {
                    exportAsExcel()
                    setShowExportPicker(false)
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-stone-600 hover:bg-stone-50"
                >
                  导出 Excel
                </button>
              </div>
            )}
          </div>
          <button onClick={() => navigate('/new')} className="btn-primary btn-hover">
            + 新建投资
          </button>
        </div>
      </div>

      {snapshot.periodInvestments === 0 && (
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <h3 className="text-lg font-semibold text-stone-800 mb-2">当前时间窗口暂无投资数据</h3>
          <p className="text-sm text-stone-500 mb-4">先新建投资并完成至少一笔结算，Dashboard 指标会自动刷新。</p>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/new')} className="btn-primary btn-hover">
              去新建投资
            </button>
            <button onClick={() => navigate('/settle')} className="btn-secondary btn-hover">
              去待结算
            </button>
            {timePeriod !== 'all' && (
              <button
                onClick={() => setTimePeriod('all')}
                className="px-3 py-2 rounded-xl bg-stone-100 text-stone-600 text-sm hover:bg-stone-200 transition-colors"
              >
                查看全部时间
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {/* 蓄水池余额 - 单独处理以添加注资按钮 */}
        <div className="glow-card bg-white rounded-2xl p-5 border border-stone-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-stone-400 text-xs uppercase tracking-wide">蓄水池余额</span>
            <span className="text-amber-400 text-lg">◐</span>
          </div>
          <div className="text-2xl font-semibold text-stone-800 cursor-pointer" onClick={openBalanceModal}>{toRmb(snapshot.poolBalance)}</div>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-xs ${snapshot.roiDelta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {toSigned(snapshot.roiDelta, 1, '%')} vs 上周期
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowInjectModal(true)
              }}
              className="text-[10px] px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
            >
              + 注资
            </button>
          </div>
        </div>

        {/* 其他指标卡片 */}
        {[
          {
            label: `${PERIOD_LABELS[timePeriod]} ROI`,
            value: toSigned(snapshot.roiPeriod, 1, '%'),
            change: `${toSigned(snapshot.roiDelta, 1, '%')} vs 上周期`,
            positive: snapshot.roiPeriod >= 0,
            icon: '◈',
            onClick: openRoiModal,
          },
          {
            label: '命中率',
            value: toPercent(snapshot.hitRatePeriod),
            change: `${toSigned(snapshot.hitRateDelta, 1, '%')} vs 上周期`,
            positive: snapshot.hitRateDelta >= 0,
            icon: '◉',
            onClick: openHitRateModal,
          },
          {
            label: 'Conf. vs AJR',
            value: snapshot.ratingFit.toFixed(2),
            change: `${toSigned(snapshot.ratingFitDelta, 2)} vs 上周期`,
            positive: snapshot.ratingFitDelta >= 0,
            icon: '❖',
            onClick: openRatingModal,
          },
        ].map((metric) => (
          <div
            key={metric.label}
            onClick={metric.onClick}
            className="glow-card bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-stone-400 text-xs uppercase tracking-wide">{metric.label}</span>
              <span className="text-amber-400 text-lg">{metric.icon}</span>
            </div>
            <div className="text-2xl font-semibold text-stone-800">{metric.value}</div>
            <div className={`text-xs mt-1 ${metric.positive ? 'text-emerald-500' : 'text-rose-500'}`}>{metric.change}</div>
          </div>
        ))}
      </div>

      <div className="-mt-[14px] space-y-2.5">
        {showSmartReminder && (
          <div className="rounded-lg border border-stone-200/80 bg-white/85 px-3 py-1.5 shadow-[0_1px_8px_rgba(28,25,23,0.06)] backdrop-blur-sm flex items-center gap-2.5">
            <span className="text-[10px] uppercase tracking-[0.14em] text-stone-400">Evidence Brief</span>
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${smartReminder.tagClass}`}>{smartReminder.tag}</span>
            <span className="flex-1 text-[11px] text-stone-600 leading-5">{smartReminderLine}</span>
            <button
              onClick={() => setShowSmartReminder(false)}
              className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
            >
              关闭
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div onClick={openRepModal} className="glow-card bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="font-medium text-stone-700">REP (噪音过滤)</h3>
                  <span className="ml-0.5 px-1 py-[1px] rounded border border-amber-200 bg-amber-50 text-[8px] font-medium uppercase tracking-[0.12em] text-amber-700">Beta</span>
                </div>
                <p className="text-xs text-stone-400">Random Events Parameter</p>
              </div>
            </div>
            <div className="space-y-2">
              {snapshot.repBuckets.map((bucket, index) => {
                const colorClass = index === 0 ? 'text-emerald-600' : index === 1 ? 'text-stone-600' : 'text-rose-500'
                return (
                  <div key={bucket.label} className="flex items-center justify-between p-2 bg-stone-50 rounded-lg">
                    <span className="text-xs text-stone-500">{bucket.label}场次</span>
                    <span className={`text-xs font-medium ${colorClass}`}>
                      {bucket.count} 场 · ROI {toSigned(bucket.roi, 1, '%')}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-stone-400 mt-3">通过 REP 加权过滤随机因素，帮助区分运气波动与判断质量。</p>
          </div>

          <div className="glow-card bg-white rounded-2xl p-5 border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-stone-700">近期投资</h3>
              <button onClick={() => navigate('/history')} className="text-xs text-amber-500 hover:text-amber-600">
                查看全部 →
              </button>
            </div>
            <div className="space-y-2">
              {snapshot.recent.slice(0, 6).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        item.status === 'pending' ? 'bg-amber-400' : item.status === 'win' ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <div>
                      <p className="text-sm text-stone-700">{item.match}</p>
                      <p className="text-xs text-stone-400">{item.entry}</p>
                    </div>
                  </div>
                  <span
                    className={`text-sm font-medium ${
                      item.status === 'win' ? 'text-emerald-600' : item.status === 'lose' ? 'text-rose-500' : 'text-stone-600'
                    }`}
                  >
                    {item.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div onClick={openConfModal} className="glow-card bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer">
            <h3 className="font-medium text-stone-700 mb-4">Conf 校准曲线</h3>
            <div className="space-y-2.5">
              {snapshot.confCalibration.map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="text-xs text-stone-500 w-14">{row.label}</span>
                  <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-300 to-orange-400 rounded-full"
                      style={{ width: `${Math.max(2, row.actual * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-stone-600 w-12">{row.actual.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-stone-400 mt-3 text-center">定义：比较赛前 Conf 与赛后 AJR 的长期偏差。</p>
          </div>
        </div>
      </div>

      <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
        <div className="flex items-center justify-between mb-4">
          <div className="relative">
            <button
              onClick={() => setShowChartPicker((prev) => !prev)}
              className="font-medium text-stone-700 flex items-center gap-2 hover:text-amber-600"
            >
              {CHART_OPTIONS.find((item) => item.key === chartKey)?.label}
              <span className="text-xs">▼</span>
            </button>
            {showChartPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-stone-200 py-1 min-w-44 z-20">
                {CHART_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => {
                      setChartKey(item.key)
                      setShowChartPicker(false)
                    }}
                    className={`block w-full px-4 py-2 text-left text-sm ${
                      chartKey === item.key ? 'bg-amber-50 text-amber-700' : 'text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-stone-400">{PERIOD_LABELS[timePeriod]} · {chartSeries.length} 个样本点</span>
        </div>
        <div className="h-44 relative">
          <svg viewBox="0 0 400 100" className="w-full h-full" preserveAspectRatio="none">
            {[0, 25, 50, 75, 100].map((y) => (
              <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#f5f5f4" strokeWidth="1" />
            ))}
            <polyline
              fill="none"
              stroke="url(#lineGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={sparkline.line}
            />
            <polygon fill="url(#areaGrad)" points={sparkline.area} />
            <defs>
              <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f97316" />
              </linearGradient>
              <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(251,191,36,0.2)" />
                <stop offset="100%" stopColor="rgba(251,191,36,0)" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="flex justify-between mt-2 px-2 text-xs text-stone-400">
          <span>{sparkline.labels[0] || '--'}</span>
          <span>{sparkline.labels[Math.floor(sparkline.labels.length / 2)] || '--'}</span>
          <span>{sparkline.labels[sparkline.labels.length - 1] || '--'}</span>
        </div>
      </div>

      <div onClick={openAdvantageModal} className="glow-card bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer">
        <h3 className="font-medium text-stone-700 mb-1">优势领域识别</h3>
        <p className="text-[10px] text-stone-400 mb-3">以球队为切片，自动识别 ROI 与命中率长期领先的组合</p>
        <div className="grid grid-cols-3 gap-3">
          {topAdvantageRows.slice(0, 3).map((item) => (
            <div key={item.team} className="flex items-center justify-between p-3 rounded-xl bg-stone-50 hover:bg-amber-50 transition-all">
              <div>
                <p className="text-sm text-stone-700">{item.team}</p>
                <p className="text-xs text-stone-400">{item.samples} samples · 命中率 {toPercent(item.hitRate)}</p>
              </div>
              <span className="text-sm font-medium text-emerald-600">{toSigned(item.roi, 1, '%')}</span>
            </div>
          ))}
          {topAdvantageRows.length === 0 && (
            <div className="col-span-3 p-4 rounded-xl bg-stone-50 text-sm text-stone-500">
              当前窗口样本不足，暂无法输出稳定优势领域。
            </div>
          )}
        </div>
      </div>

      {/* 注资弹窗 */}
      {showInjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowInjectModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium text-stone-700 mb-4">注资新增</h3>
            <div className="mb-4">
              <label className="text-xs text-stone-500 mb-1 block">注资金额 (RMB)</label>
              <input
                type="number"
                value={injectAmount}
                onChange={(e) => setInjectAmount(e.target.value)}
                placeholder="输入金额..."
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:border-amber-300 focus:outline-none"
                autoFocus
              />
            </div>
            <div className="text-xs text-stone-400 mb-4">
              当前初始资金: ¥{systemConfig.initialCapital} → 注资后: ¥{Number(systemConfig.initialCapital || 0) + (Number(injectAmount) || 0)}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowInjectModal(false)}
                className="flex-1 py-2 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleInjectCapital}
                className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 transition-colors"
              >
                确认注资
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
