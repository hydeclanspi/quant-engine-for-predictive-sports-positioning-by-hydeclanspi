import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDashboardSnapshot } from '../lib/analytics'
import TimeRangePicker from '../components/TimeRangePicker'
import { getSystemConfig, saveSystemConfig, addCapitalInjection } from '../lib/localData'
import { downloadWorkbook } from '../lib/excel'
import * as XLSX from 'xlsx'
import { Wallet, TrendingUp, BarChart3 } from 'lucide-react'

const PERIOD_LABELS = {
  '1w': '近一周',
  '2w': '近两周',
  '1m': '本月',
  all: '全部',
}

const CHART_OPTIONS = [
  { key: 'fund', label: '资金走势' },
  { key: 'single_roi', label: '单次 ROI 走势' },
  { key: 'conf', label: 'Conf 相关性走势' },
  { key: 'rating', label: 'AJR 走势' },
  { key: 'ajr_delta', label: 'AJR-Conf 偏差走势' },
  { key: 'corr_rolling', label: 'Conf ↔ AJR 滚动相关' },
  { key: 'error_rolling', label: '滚动 Brier / LogLoss' },
]

const TREND_VIEWBOX_WIDTH = 480
const TREND_VIEWBOX_HEIGHT = 48
const TREND_X_MIN = 20
const TREND_X_MAX = 460
const TREND_PLOT_TOP = 11
const TREND_PLOT_BOTTOM = 38
const TREND_BASELINE_Y = 42
const TREND_MIDLINE_Y = 30

const HitRateIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <path d="M3.8 16.2L16.2 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M11.9 3.8H16.2V8.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 16H7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M9 16H12.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M13.7 16H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const toSigned = (value, digits = 1, suffix = '') => {
  const num = Number(value || 0)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(digits)}${suffix}`
}

const toPercent = (value, digits = 1) => `${Number(value || 0).toFixed(digits)}%`

const toRmb = (value) => `¥${Number(value || 0).toFixed(0)}`
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const formatChartNumeric = (chartKey, value, digits = 1) => {
  const safe = Number(value || 0)
  if (chartKey === 'fund') return `¥${safe.toFixed(0)}`
  if (chartKey === 'corr_rolling') return safe.toFixed(2)
  if (chartKey === 'error_rolling') return safe.toFixed(3)
  return `${safe.toFixed(digits)}%`
}

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

const buildSampleIndices = (length, maxPoints = 36) => {
  const safeLength = Math.max(0, Number(length) || 0)
  const safeMaxPoints = Math.max(2, Number(maxPoints) || 36)
  if (safeLength <= safeMaxPoints) {
    return Array.from({ length: safeLength }, (_, idx) => idx)
  }
  const step = (safeLength - 1) / (safeMaxPoints - 1)
  const indices = []
  let prev = -1
  for (let i = 0; i < safeMaxPoints; i += 1) {
    const idx = Math.min(safeLength - 1, Math.round(i * step))
    if (idx !== prev) {
      indices.push(idx)
      prev = idx
    }
  }
  if (indices[indices.length - 1] !== safeLength - 1) indices.push(safeLength - 1)
  return indices
}

const sampleSeriesByIndices = (series, indices) => indices.map((idx) => series[idx]).filter(Boolean)

const buildTrendGeometry = (series, options = {}) => {
  if (!Array.isArray(series) || series.length === 0) {
    return { points: [], line: '', labels: [], zeroY: TREND_BASELINE_Y, min: 0, max: 0, sampledSeries: [] }
  }

  const normalizedOptions =
    typeof options === 'number'
      ? { minSpan: options, maxPoints: 36 }
      : {
          minSpan: Number.isFinite(options.minSpan) ? options.minSpan : 1,
          maxPoints: Number.isFinite(options.maxPoints) ? options.maxPoints : 36,
          min: options.min,
          max: options.max,
          indices: Array.isArray(options.indices) ? options.indices : null,
        }

  const indices =
    normalizedOptions.indices && normalizedOptions.indices.length > 0
      ? normalizedOptions.indices
      : buildSampleIndices(series.length, normalizedOptions.maxPoints)
  const sampledSeries = sampleSeriesByIndices(series, indices)
  if (sampledSeries.length === 0) {
    return { points: [], line: '', labels: [], zeroY: TREND_BASELINE_Y, min: 0, max: 0, sampledSeries: [] }
  }

  const values = sampledSeries.map((item) => Number(item.value || 0))
  const minCandidate = Number.isFinite(normalizedOptions.min) ? Number(normalizedOptions.min) : Math.min(...values)
  const maxCandidate = Number.isFinite(normalizedOptions.max) ? Number(normalizedOptions.max) : Math.max(...values)
  const min = Math.min(minCandidate, maxCandidate)
  const max = Math.max(minCandidate, maxCandidate)
  const span = Math.max(max - min, normalizedOptions.minSpan)
  const step = sampledSeries.length > 1 ? (TREND_X_MAX - TREND_X_MIN) / (sampledSeries.length - 1) : 0
  const points = sampledSeries.map((item, idx) => {
    const value = Number(item.value || 0)
    const x = TREND_X_MIN + idx * step
    const y = TREND_PLOT_BOTTOM - ((value - min) / span) * (TREND_PLOT_BOTTOM - TREND_PLOT_TOP)
    return { x, y, value }
  })
  const line = points.map((p) => `${p.x},${p.y}`).join(' ')
  const rawZeroY = TREND_PLOT_BOTTOM - ((0 - min) / span) * (TREND_PLOT_BOTTOM - TREND_PLOT_TOP)
  const zeroY = Math.max(TREND_PLOT_TOP, Math.min(TREND_BASELINE_Y, rawZeroY))
  return {
    points,
    line,
    labels: sampledSeries.map((item) => item.label || '--'),
    zeroY,
    min,
    max,
    sampledSeries,
  }
}

const buildTrendAxisTicks = (labels, targetCount = 5) => {
  if (!Array.isArray(labels) || labels.length === 0) return []
  if (labels.length === 1) return [{ index: 0, ratio: 0, label: labels[0] || '--' }]
  const count = Math.max(2, Math.min(labels.length, Number(targetCount) || 5))
  const step = (labels.length - 1) / (count - 1)
  const tickSet = new Set([0, labels.length - 1])
  for (let i = 1; i < count - 1; i += 1) {
    tickSet.add(Math.round(i * step))
  }
  return [...tickSet]
    .sort((a, b) => a - b)
    .map((idx) => ({
      index: idx,
      ratio: labels.length > 1 ? idx / (labels.length - 1) : 0,
      label: labels[idx] || '--',
    }))
}

const calcPearson = (xs, ys) => {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return 0
  const n = xs.length
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n
  let numerator = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    numerator += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  const denominator = Math.sqrt(varX * varY)
  if (!Number.isFinite(denominator) || denominator <= 0) return 0
  return numerator / denominator
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
  const [chartKey, setChartKey] = useState('rating')
  const [showSmartReminder, setShowSmartReminder] = useState(false)
  const [showInjectModal, setShowInjectModal] = useState(false)
  const [injectAmount, setInjectAmount] = useState('')
  const [dataVersion, setDataVersion] = useState(0)
  const [hoveredPoint, setHoveredPoint] = useState(null)
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

  useEffect(() => {
    setHoveredPoint(null)
  }, [chartKey, timePeriod, snapshot.periodInvestments])

  const chartSeries = useMemo(() => {
    const dateLabelOnly = (rows) =>
      rows.map((row) => ({
        ...row,
        label: String(row.label || '--').split('·')[0],
      }))

    if (chartKey === 'conf') {
      const rows = [...(snapshot.ratingRows || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      const windowSize = Math.max(5, Math.min(16, Math.floor(rows.length * 0.45)))
      const rolling = rows.map((row, idx) => {
        const start = Math.max(0, idx - windowSize + 1)
        const slice = rows.slice(start, idx + 1)
        const avgAbsDiff =
          slice.reduce((sum, item) => sum + Math.abs(Number(item.actual_rating || 0) - Number(item.expected_rating || 0)), 0) /
          Math.max(slice.length, 1)
        const fit = Math.max(0, Math.min(1, 1 - avgAbsDiff))
        return {
          label: row.dateLabel || '--',
          value: Number((fit * 100).toFixed(2)),
          match: row.match || '-',
        }
      })
      return dateLabelOnly(rolling)
    }

    if (chartKey === 'rating') {
      const rolling = [...snapshot.ratingRows]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((row, idx, arr) => {
          const start = Math.max(0, idx - 3)
          const windowRows = arr.slice(start, idx + 1)
          const ajrAvg =
            windowRows.reduce((sum, item) => sum + Number(item.actual_rating || 0), 0) /
            Math.max(windowRows.length, 1)
          return {
            label: row.dateLabel,
            value: Number((Math.max(0, ajrAvg) * 100).toFixed(2)),
            match: row.match || '-',
          }
        })
      return dateLabelOnly(rolling)
    }

    if (chartKey === 'single_roi') {
      const rows = [...(snapshot.periodInvestmentRoiSeries || [])]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((row) => ({
          label: row.dateLabel || '--',
          value: Number(row.roi || 0),
          match: row.match || '-',
        }))
      return dateLabelOnly(rows)
    }

    if (chartKey === 'ajr_delta') {
      const rows = [...(snapshot.ratingRows || [])]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((row) => ({
          label: row.dateLabel || '--',
          value: Number(((Number(row.actual_rating || 0) - Number(row.expected_rating || 0)) * 100).toFixed(2)),
          match: row.match || '-',
        }))
      return dateLabelOnly(rows)
    }

    if (chartKey === 'corr_rolling') {
      const rows = [...(snapshot.ratingRows || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      const series = []
      const windowSize = Math.max(6, Math.min(20, Math.floor(rows.length * 0.6)))
      const minWindow = Math.max(4, Math.min(8, windowSize))
      rows.forEach((row, idx) => {
        const start = Math.max(0, idx - windowSize + 1)
        const slice = rows.slice(start, idx + 1)
        if (slice.length < minWindow) return
        const xs = slice.map((item) => Number(item.expected_rating || 0))
        const ys = slice.map((item) => Number(item.actual_rating || 0))
        series.push({
          label: row.dateLabel || '--',
          value: Number(calcPearson(xs, ys).toFixed(3)),
          match: row.match || '-',
        })
      })
      return dateLabelOnly(series)
    }

    if (chartKey === 'error_rolling') {
      const rows = [...(snapshot.periodMatchRows || [])]
        .filter((row) => Number.isFinite(Number(row.conf)) && (row.status === 'win' || row.status === 'lose'))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      const series = []
      const windowSize = Math.max(6, Math.min(20, Math.floor(rows.length * 0.6)))
      const minWindow = Math.max(4, Math.min(8, windowSize))
      rows.forEach((row, idx) => {
        const start = Math.max(0, idx - windowSize + 1)
        const slice = rows.slice(start, idx + 1)
        if (slice.length < minWindow) return
        const brierAvg =
          slice.reduce((sum, item) => {
            const p = Math.max(0.02, Math.min(0.98, Number(item.conf)))
            const y = item.status === 'win' ? 1 : 0
            return sum + (p - y) ** 2
          }, 0) / slice.length
        series.push({
          label: row.dateLabel || '--',
          value: Number(brierAvg.toFixed(4)),
          match: row.match || '-',
        })
      })
      return dateLabelOnly(series)
    }

    return snapshot.timeline.map((point) => ({
      label: point.label,
      value: point.balance,
      match: point.match || '-',
    }))
  }, [chartKey, snapshot.confCalibration, snapshot.periodInvestmentRoiSeries, snapshot.periodMatchRows, snapshot.ratingRows, snapshot.timeline])

  const chartSecondarySeries = useMemo(() => {
    if (chartKey === 'single_roi') {
      const alpha = 0.28
      let prev = null
      return chartSeries.map((point) => {
        const current = Number(point.value || 0)
        const next = prev == null ? current : prev * (1 - alpha) + current * alpha
        prev = next
        return {
          label: point.label,
          value: Number(next.toFixed(3)),
          match: point.match || '-',
        }
      })
    }

    if (chartKey === 'error_rolling') {
      const rows = [...(snapshot.periodMatchRows || [])]
        .filter((row) => Number.isFinite(Number(row.conf)) && (row.status === 'win' || row.status === 'lose'))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      const series = []
      const windowSize = Math.max(6, Math.min(20, Math.floor(rows.length * 0.6)))
      const minWindow = Math.max(4, Math.min(8, windowSize))
      rows.forEach((row, idx) => {
        const start = Math.max(0, idx - windowSize + 1)
        const slice = rows.slice(start, idx + 1)
        if (slice.length < minWindow) return
        const logLossAvg =
          slice.reduce((sum, item) => {
            const p = Math.max(0.02, Math.min(0.98, Number(item.conf)))
            const y = item.status === 'win' ? 1 : 0
            return sum - (y * Math.log(p) + (1 - y) * Math.log(1 - p))
          }, 0) / slice.length
        series.push({
          label: row.dateLabel || '--',
          value: Number(logLossAvg.toFixed(4)),
          match: row.match || '-',
        })
      })
      if (series.length !== chartSeries.length) return series
      return series.map((point, idx) => ({
        label: chartSeries[idx]?.label || point.label,
        value: point.value,
        match: chartSeries[idx]?.match || point.match || '-',
      }))
    }

    return []
  }, [chartKey, chartSeries, snapshot.periodMatchRows])

  const chartMaxPoints = timePeriod === 'all' ? 72 : 48
  const chartSampleIndices = useMemo(() => buildSampleIndices(chartSeries.length, chartMaxPoints), [chartMaxPoints, chartSeries.length])
  const chartRange = useMemo(() => {
    const values = [...chartSeries, ...chartSecondarySeries]
      .map((point) => Number(point.value))
      .filter((value) => Number.isFinite(value))
    if (values.length === 0) return { min: undefined, max: undefined, minSpan: chartKey === 'fund' ? 20 : 2 }

    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    const rawSpan = Math.max(rawMax - rawMin, 0)

    if (chartKey === 'corr_rolling') {
      const pad = Math.max(0.08, rawSpan * 0.35)
      return {
        min: Math.max(-1, rawMin - pad),
        max: Math.min(1, rawMax + pad),
        minSpan: 0.24,
      }
    }

    if (chartKey === 'single_roi') {
      const pad = Math.max(2, rawSpan * 0.18)
      return {
        min: rawMin - pad,
        max: rawMax + pad,
        minSpan: 8,
      }
    }

    if (chartKey === 'ajr_delta') {
      const pad = Math.max(1.5, rawSpan * 0.28)
      const min = Math.min(0, rawMin - pad)
      const max = Math.max(0, rawMax + pad)
      return { min, max, minSpan: 6 }
    }

    if (chartKey === 'error_rolling') {
      const pad = Math.max(0.02, rawSpan * 0.25)
      return {
        min: Math.max(0, rawMin - pad),
        max: rawMax + pad,
        minSpan: 0.08,
      }
    }

    return {
      min: undefined,
      max: undefined,
      minSpan: chartKey === 'fund' ? 20 : 2,
    }
  }, [chartKey, chartSecondarySeries, chartSeries])

  const sparkline = useMemo(
    () =>
      buildTrendGeometry(chartSeries, {
        minSpan: chartRange.minSpan,
        maxPoints: chartMaxPoints,
        indices: chartSampleIndices,
        min: chartRange.min,
        max: chartRange.max,
      }),
    [chartMaxPoints, chartRange.max, chartRange.min, chartRange.minSpan, chartSampleIndices, chartSeries],
  )
  const secondarySparkline = useMemo(() => {
    if (!Array.isArray(chartSecondarySeries) || chartSecondarySeries.length === 0) return null
    return buildTrendGeometry(chartSecondarySeries, {
      minSpan: chartRange.minSpan,
      maxPoints: chartMaxPoints,
      indices: chartSampleIndices,
      min: chartRange.min,
      max: chartRange.max,
    })
  }, [chartMaxPoints, chartRange.max, chartRange.min, chartRange.minSpan, chartSampleIndices, chartSecondarySeries])

  const chartAxisTicks = useMemo(() => buildTrendAxisTicks(sparkline.labels, 5), [sparkline.labels])
  const chartReferenceValue = useMemo(() => {
    if (chartKey === 'rating') return 50
    if (chartKey === 'single_roi' || chartKey === 'ajr_delta' || chartKey === 'corr_rolling') return 0
    return null
  }, [chartKey])
  const chartReferenceY = useMemo(() => {
    if (chartReferenceValue == null || sparkline.points.length === 0) return null
    const span = Math.max(sparkline.max - sparkline.min, chartRange.minSpan)
    const rawY = TREND_PLOT_BOTTOM - ((chartReferenceValue - sparkline.min) / span) * (TREND_PLOT_BOTTOM - TREND_PLOT_TOP)
    return Math.max(TREND_PLOT_TOP, Math.min(TREND_BASELINE_Y, rawY))
  }, [chartRange.minSpan, chartReferenceValue, sparkline.max, sparkline.min, sparkline.points.length])
  const chartYAxisTicks = useMemo(() => {
    const axisPoints = [TREND_PLOT_TOP, (TREND_PLOT_TOP + TREND_PLOT_BOTTOM) / 2, TREND_PLOT_BOTTOM]
    const span = Math.max(sparkline.max - sparkline.min, chartRange.minSpan)
    return axisPoints.map((y) => {
      const ratio = (TREND_PLOT_BOTTOM - y) / (TREND_PLOT_BOTTOM - TREND_PLOT_TOP)
      const value = sparkline.min + ratio * span
      return {
        y,
        value,
        label: formatChartNumeric(chartKey, value, chartKey === 'error_rolling' ? 3 : 1),
      }
    })
  }, [chartKey, chartRange.minSpan, sparkline.max, sparkline.min])

  const chartTheme = useMemo(() => {
    if (chartKey === 'single_roi') {
      return {
        panelClass: 'border-emerald-100/80 bg-gradient-to-b from-emerald-50/55 to-white',
        lineFrom: '#10b981',
        lineTo: '#059669',
        secondaryLineFrom: 'rgba(16,185,129,0.30)',
        secondaryLineTo: 'rgba(16,185,129,0.12)',
        secondaryLineWidth: '0.9',
        secondaryLineDash: '1.6 2.4',
        baseLine: '#d1fae5',
        midLine: '#a7f3d0',
        zeroLine: '#6ee7b7',
        point: () => '#059669',
        valueColor: '#047857',
      }
    }
    if (chartKey === 'rating' || chartKey === 'ajr_delta') {
      return {
        panelClass: 'border-sky-100 bg-gradient-to-b from-sky-50/60 to-white',
        lineFrom: '#38bdf8',
        lineTo: '#2563eb',
        baseLine: '#e0f2fe',
        midLine: '#bae6fd',
        zeroLine: '#7dd3fc',
        point: (value) => (value >= (chartKey === 'rating' ? 50 : 0) ? '#0284c7' : '#0ea5e9'),
        valueColor: '#0369a1',
      }
    }
    if (chartKey === 'corr_rolling') {
      return {
        panelClass: 'border-violet-100/80 bg-gradient-to-b from-violet-50/55 to-white',
        lineFrom: '#a78bfa',
        lineTo: '#6366f1',
        baseLine: '#ede9fe',
        midLine: '#ddd6fe',
        zeroLine: '#c4b5fd',
        point: () => '#7c3aed',
        valueColor: '#6d28d9',
      }
    }
    if (chartKey === 'error_rolling') {
      return {
        panelClass: 'border-amber-100/80 bg-gradient-to-b from-amber-50/55 to-white',
        lineFrom: '#fbbf24',
        lineTo: '#f97316',
        secondaryLineFrom: '#fb7185',
        secondaryLineTo: '#e11d48',
        secondaryLineWidth: '1.05',
        secondaryLineDash: undefined,
        baseLine: '#ffedd5',
        midLine: '#fed7aa',
        zeroLine: '#fdba74',
        point: () => '#f59e0b',
        valueColor: '#b45309',
      }
    }
    if (chartKey === 'conf') {
      return {
        panelClass: 'border-amber-100 bg-gradient-to-b from-amber-50/70 to-white',
        lineFrom: '#fbbf24',
        lineTo: '#f97316',
        baseLine: '#fde68a',
        midLine: '#fcd34d',
        zeroLine: '#fbbf24',
        point: () => '#f59e0b',
        valueColor: '#b45309',
      }
    }
    return {
      panelClass: 'border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-white',
      lineFrom: '#818cf8',
      lineTo: '#6366f1',
      baseLine: '#e0e7ff',
      midLine: '#c7d2fe',
      zeroLine: '#a5b4fc',
      point: () => '#6366f1',
      valueColor: '#4338ca',
    }
  }, [chartKey])

  const lineGradientId = `dashboardLineLg-${chartKey}`
  const secondaryLineGradientId = `dashboardLineSecondaryLg-${chartKey}`
  const chartNarrative = useMemo(() => {
    if (chartKey === 'fund') {
      return {
        title: '资金路径采用累计净值时间序列，斜率代表净值增长速度，局部拐点对应收益结构切换。',
        subtitle: 'Trend 上行意味着资金曲线处于扩张相位；若横盘或下行，通常需要回看仓位与噪音暴露。',
      }
    }
    if (chartKey === 'single_roi') {
      return {
        title: '单次 ROI 以每笔已结算投资作为样本点，EWMA 用于提取低频趋势并弱化偶发尖峰。',
        subtitle: '原始点负责反映真实波动，淡化辅线仅用于读趋势方向，二者同向上移通常代表策略状态改善。',
      }
    }
    if (chartKey === 'conf') {
      return {
        title: 'Conf 相关性走势展示的是置信度校准后的真实命中表现曲线（以 AJR 校准结果为观测目标）。',
        subtitle: 'Trend 趋近稳定高位，说明置信度分层有效；若下滑，表示当前参数对新样本解释力减弱。',
      }
    }
    if (chartKey === 'rating') {
      return {
        title: 'AJR 走势基于赛后评分序列的滑动平均，过滤短噪声后观察模型真实输出质量轨迹。',
        subtitle: 'Trend 持续上行说明近期执行质量改善；若出现下行拐点，建议同步检查 AJR-Conf 偏差与相关性衰减。',
      }
    }
    if (chartKey === 'ajr_delta') {
      return {
        title: 'AJR-Conf 偏差用于衡量校准偏向：正值偏保守，负值偏激进，0 附近代表较均衡。',
        subtitle: 'Trend 持续偏离 0 说明参数结构存在系统性偏差，建议联动校准阈值与仓位权重做重估。',
      }
    }
    if (chartKey === 'corr_rolling') {
      return {
        title: '滚动相关反映近期窗口内 Conf 与 AJR 的线性一致性，系数越高说明置信度解释力越强。',
        subtitle: 'Trend 若长期下行并逼近 0，意味着当前置信度分层在新样本上的区分能力减弱。',
      }
    }
    return {
      title: 'Brier 与 LogLoss 是概率预测误差的两种标准刻画，值越低代表校准质量越好。',
      subtitle: '两条误差线同步回落通常对应模型稳定阶段；若同步抬升，往往是分布漂移或参数失配信号。',
    }
  }, [chartKey])
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
  const repSummary = useMemo(() => {
    const rows = repCards.filter((row) => row.samples > 0)
    if (rows.length === 0) return null
    const best = [...rows].sort((a, b) => b.roi - a.roi || b.hitRate - a.hitRate)[0]
    const weakest = [...rows].sort((a, b) => a.roi - b.roi || a.hitRate - b.hitRate)[0]
    const low = repCards.find((row) => row.key === 'low')
    const high = repCards.find((row) => row.key === 'high')
    const riskGap = Number(((high?.roi || 0) - (low?.roi || 0)).toFixed(1))
    const action =
      riskGap <= -8
        ? '高随机样本拖累明显，当前建议优先低/中随机性赛事。'
        : riskGap >= 8
          ? '高随机样本回报领先，可保留小比例杠杆仓位。'
          : '三档随机性差异不大，维持均衡配置并继续观察。'
    return { best, weakest, riskGap, action }
  }, [repCards])
  const periodInsightLabel = useMemo(
    () => (timePeriod === 'all' ? '历史上' : PERIOD_LABELS[timePeriod] || '当前窗口'),
    [timePeriod],
  )
  const repInsightText = useMemo(() => {
    if (!repSummary) return `${periodInsightLabel}样本不足，等待更多已结算记录。`
    return `${periodInsightLabel}${repSummary.action}`
  }, [periodInsightLabel, repSummary])
  const confSummary = useMemo(() => {
    const rows = confDetailRows.filter((row) => row.samples > 0)
    if (rows.length === 0) return null
    const totalSamples = rows.reduce((sum, row) => sum + row.samples, 0)
    const weightedDiff =
      totalSamples > 0 ? rows.reduce((sum, row) => sum + row.diff * row.samples, 0) / totalSamples : 0
    const mae =
      totalSamples > 0 ? rows.reduce((sum, row) => sum + Math.abs(row.diff) * row.samples, 0) / totalSamples : 0
    const stable = [...rows].sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff) || b.samples - a.samples)[0]
    const drift = [...rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.samples - a.samples)[0]
    const bestEdge = [...rows].sort((a, b) => b.roi - a.roi || b.hitRate - a.hitRate)[0]
    const note =
      weightedDiff > 0.03
        ? '整体 AJR 高于 Conf，模型偏保守，可在高质量样本轻微上调。'
        : weightedDiff < -0.03
          ? '整体 AJR 低于 Conf，模型偏激进，建议下调高置信仓位。'
          : '整体校准接近中性，优先按具体区间做微调。'
    return { weightedDiff, mae, stable, drift, bestEdge, note }
  }, [confDetailRows])
  const repMixRows = useMemo(() => {
    const rows = repCards.filter((row) => row.samples > 0)
    const totalSamples = rows.reduce((sum, row) => sum + row.samples, 0)
    if (totalSamples <= 0) return []
    return rows
      .map((row) => ({
        ...row,
        share: row.samples / totalSamples,
        bandTone:
          row.key === 'low' ? 'bg-emerald-400' : row.key === 'mid' ? 'bg-amber-400' : 'bg-rose-400',
        tip: row.roi >= 8 ? '保持主仓' : row.roi >= 0 ? '维持观察' : '建议降权',
      }))
      .sort((a, b) => b.share - a.share)
  }, [repCards])
  const totalRepSamples = useMemo(
    () => repCards.reduce((sum, row) => sum + Number(row.samples || 0), 0),
    [repCards],
  )
  const confPriorityRows = useMemo(
    () =>
      confDetailRows
        .filter((row) => row.samples > 0)
        .map((row) => ({
          ...row,
          absDiff: Math.abs(row.diff),
          steer: row.diff >= 0 ? '偏低估' : '偏高估',
        }))
        .sort((a, b) => b.absDiff - a.absDiff || b.samples - a.samples),
    [confDetailRows],
  )
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
    <div className="page-shell page-content-wide pt-5 space-y-5 motion-v2-scope">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-stone-800 font-display">Dashboard</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <TimeRangePicker value={timePeriod} onChange={setTimePeriod} options={PERIOD_LABELS} align="left" />
            <span className="text-stone-400 text-sm">· 投资 {snapshot.periodInvestments} 笔</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div ref={exportPickerRef} className="relative">
            <button
              onClick={() => setShowExportPicker((prev) => !prev)}
              className="btn-secondary btn-hover motion-v2-ghost-btn"
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
                  className="motion-v2-row motion-v2-selectable block w-full px-4 py-2 text-left text-sm text-stone-600 hover:bg-stone-50"
                >
                  导出 CSV
                </button>
                <button
                  onClick={() => {
                    exportAsJson()
                    setShowExportPicker(false)
                  }}
                  className="motion-v2-row motion-v2-selectable block w-full px-4 py-2 text-left text-sm text-stone-600 hover:bg-stone-50"
                >
                  导出 JSON
                </button>
                <button
                  onClick={() => {
                    exportAsExcel()
                    setShowExportPicker(false)
                  }}
                  className="motion-v2-row motion-v2-selectable block w-full px-4 py-2 text-left text-sm text-stone-600 hover:bg-stone-50"
                >
                  导出 Excel
                </button>
              </div>
            )}
          </div>
          <button onClick={() => navigate('/new')} className="btn-primary btn-hover motion-v2-ghost-btn">
            + 新建投资
          </button>
        </div>
      </div>

      {snapshot.periodInvestments === 0 && (
        <div className="motion-v2-surface glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <h3 className="text-lg font-semibold text-stone-800 mb-2">当前时间窗口暂无投资数据</h3>
          <p className="text-sm text-stone-500 mb-4">先新建投资并完成至少一笔结算，Dashboard 指标会自动刷新。</p>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/new')} className="btn-primary btn-hover motion-v2-ghost-btn">
              去新建投资
            </button>
            <button onClick={() => navigate('/settle')} className="btn-secondary btn-hover motion-v2-ghost-btn">
              去待结算
            </button>
            {timePeriod !== 'all' && (
              <button
                onClick={() => setTimePeriod('all')}
                className="motion-v2-ghost-btn px-3 py-2 rounded-xl bg-stone-100 text-stone-600 text-sm hover:bg-stone-200 transition-colors"
              >
                查看全部时间
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        {/* 蓄水池余额 - 单独处理以添加注资按钮 */}
        <div className="motion-v2-surface glow-card bg-white rounded-2xl p-5 border border-stone-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-stone-400 text-xs uppercase tracking-wide">蓄水池余额</span>
            <Wallet size={18} strokeWidth={1.5} className="text-amber-500" />
          </div>
          <div className="text-2xl font-semibold text-amber-600 cursor-pointer motion-v2-ghost-btn inline-block" onClick={openBalanceModal}>{toRmb(snapshot.poolBalance)}</div>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-xs ${snapshot.roiDelta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {toSigned(snapshot.roiDelta, 1, '%')} vs 上周期
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowInjectModal(true)
              }}
              className="motion-v2-ghost-btn text-[10px] px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
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
            IconComp: TrendingUp,
            onClick: openRoiModal,
          },
          {
            label: '命中率',
            value: toPercent(snapshot.hitRatePeriod),
            change: `${toSigned(snapshot.hitRateDelta, 1, '%')} vs 上周期`,
            positive: snapshot.hitRateDelta >= 0,
            IconComp: HitRateIcon,
            onClick: openHitRateModal,
          },
          {
            label: 'Conf. vs AJR',
            value: snapshot.ratingFit.toFixed(2),
            change: `${toSigned(snapshot.ratingFitDelta, 2)} vs 上周期`,
            positive: snapshot.ratingFitDelta >= 0,
            IconComp: BarChart3,
            onClick: openRatingModal,
          },
        ].map((metric) => (
          <div
            key={metric.label}
            onClick={metric.onClick}
            className="motion-v2-surface glow-card bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-stone-400 text-xs uppercase tracking-wide">{metric.label}</span>
              <metric.IconComp size={18} strokeWidth={1.5} className="text-amber-500" />
            </div>
            <div className={`text-2xl font-semibold ${metric.positive ? 'text-stone-800' : 'text-rose-500'}`}>{metric.value}</div>
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
              className="motion-v2-ghost-btn text-[10px] text-stone-400 hover:text-stone-600 transition-colors rounded-md px-1.5 py-0.5"
            >
              关闭
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div
            onClick={openRepModal}
            className="motion-v2-surface glow-card group relative overflow-hidden rounded-2xl p-5 border border-sky-100/80 bg-gradient-to-br from-white via-sky-50/35 to-cyan-50/35 cursor-pointer h-full"
          >
            <div className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full bg-sky-200/30 blur-3xl" />
            <div className="pointer-events-none absolute top-16 -left-16 h-36 w-36 rounded-full bg-cyan-200/24 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 right-10 h-36 w-36 rounded-full bg-indigo-200/24 blur-3xl" />
            <div className="relative h-full flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-stone-800 tracking-[0.01em]">REP (噪音过滤)</h3>
                    <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50/85 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-sky-700">
                      Beta
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500 mt-1">Random Events Parameter · 时间近因机制</p>
                </div>
                <div className="text-right rounded-xl border border-white/85 bg-white/72 px-2.5 py-2 shadow-[0_6px_16px_rgba(14,165,233,0.1)] backdrop-blur-sm">
                  <p className="text-[10px] text-stone-400 uppercase tracking-[0.1em]">样本池</p>
                  <p className="text-lg font-semibold text-sky-700 tabular-nums">{totalRepSamples}</p>
                  <p className="text-[10px] text-stone-400">matches</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2.5">
                {repCards.map((bucket) => {
                  const tone =
                    bucket.key === 'low'
                      ? {
                          panel: 'border-emerald-100 bg-emerald-50/70',
                          value: 'text-emerald-600',
                          bar: 'bg-emerald-400',
                        }
                      : bucket.key === 'mid'
                        ? {
                            panel: 'border-amber-100 bg-amber-50/70',
                            value: 'text-amber-600',
                            bar: 'bg-amber-400',
                          }
                        : {
                            panel: 'border-rose-100 bg-rose-50/70',
                            value: 'text-rose-500',
                            bar: 'bg-rose-400',
                          }
                  const share = totalRepSamples > 0 ? Math.round((bucket.samples / totalRepSamples) * 100) : 0
                  return (
                    <div
                      key={bucket.key}
                      className={`motion-v2-row rounded-xl border px-2.5 py-2 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] ${tone.panel}`}
                    >
                      <p className="text-[10px] text-stone-500 truncate">{bucket.label}</p>
                      <p className={`text-[12px] font-semibold mt-0.5 ${tone.value}`}>{toSigned(bucket.roi, 1, '%')}</p>
                      <p className="text-[10px] text-stone-500 mt-0.5">
                        {bucket.samples} 场 · Hit {toPercent(bucket.hitRate, 0)}
                      </p>
                      <div className="mt-1.5 h-1 rounded-full bg-white/85 border border-white/70 overflow-hidden">
                        <div className={`h-full ${tone.bar}`} style={{ width: `${Math.max(8, share)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 rounded-xl border border-sky-100/80 bg-white/72 backdrop-blur-sm p-3 shadow-[0_8px_18px_rgba(14,165,233,0.08)]">
                {repSummary ? (
                  <>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-[10px] uppercase tracking-[0.12em] text-stone-400">结构洞察</p>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${repSummary.riskGap >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-600'}`}>
                        高随机-低随机 {toSigned(repSummary.riskGap, 1, '%')}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg border border-emerald-100/90 bg-emerald-50/70 px-2 py-1.5">
                        <p className="text-stone-500">优势层</p>
                        <p className="font-medium text-emerald-700">{repSummary.best.label}</p>
                      </div>
                      <div className="rounded-lg border border-rose-100/90 bg-rose-50/70 px-2 py-1.5">
                        <p className="text-stone-500">风险层</p>
                        <p className="font-medium text-rose-600">{repSummary.weakest.label}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-stone-600 whitespace-nowrap overflow-hidden text-ellipsis">{repInsightText}</p>
                  </>
                ) : (
                  <p className="text-[11px] text-stone-400">{periodInsightLabel}暂无 REP 细分样本。</p>
                )}
              </div>

              {repMixRows.length > 0 && (
                <div className="mt-3 rounded-xl border border-cyan-100/80 bg-white/68 px-3 py-2.5 backdrop-blur-sm">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-stone-400">
                    <span>样本结构 / 处理优先级</span>
                    <span>Desk View</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {repMixRows.map((row) => (
                      <div
                        key={row.key}
                        className="motion-v2-row rounded-lg border border-white/85 bg-white/82 px-2.5 py-2"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-stone-600">{row.label}</span>
                          <span className="font-medium text-stone-700">
                            {toPercent(row.share * 100, 0)} · {row.tip}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden border border-stone-200/70 bg-white">
                          <div
                            className={`h-full ${row.bandTone}`}
                            style={{ width: `${Math.max(8, Math.round(row.share * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 pt-2 border-t border-sky-100/80 flex items-center justify-between text-[10px] text-stone-400">
                <span>点击查看分层样本明细与分页回放</span>
                <span className="font-medium text-sky-600 group-hover:translate-x-0.5 transition-transform">OPEN →</span>
              </div>
            </div>
          </div>

          <div className="motion-v2-surface glow-card bg-white rounded-2xl p-5 border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-stone-700">近期投资</h3>
              <button onClick={() => navigate('/history')} className="motion-v2-ghost-btn text-xs text-amber-500 hover:text-amber-600 rounded-md px-2 py-1">
                查看全部 →
              </button>
            </div>
            <div className="space-y-2">
              {snapshot.recent.slice(0, 6).map((item) => (
                <div key={item.id} className="motion-v2-row motion-v2-selectable flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-50 transition-colors cursor-pointer">
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

          <div
            onClick={openConfModal}
            className="motion-v2-surface glow-card bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer h-full flex flex-col"
          >
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
            <div className="mt-3 pt-3 border-t border-stone-100 space-y-2 flex-1 flex flex-col">
              {confSummary ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-sky-100 bg-sky-50/45 p-2">
                      <p className="text-[10px] text-stone-400">最稳定区间</p>
                      <p className="text-xs font-medium text-sky-700">{confSummary.stable.label}</p>
                      <p className="text-[11px] text-sky-600">{toSigned(confSummary.stable.diff * 100, 1, 'pp')}</p>
                    </div>
                    <div className="rounded-lg border border-amber-100 bg-amber-50/45 p-2">
                      <p className="text-[10px] text-stone-400">偏差最大区间</p>
                      <p className="text-xs font-medium text-amber-700">{confSummary.drift.label}</p>
                      <p className="text-[11px] text-amber-600">{toSigned(confSummary.drift.diff * 100, 1, 'pp')}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-stone-500">
                    <span>整体偏差 (AJR-Conf)</span>
                    <span className={`font-medium ${confSummary.weightedDiff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {toSigned(confSummary.weightedDiff * 100, 1, 'pp')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-stone-500">
                    <span>平均绝对偏差</span>
                    <span className="font-medium text-stone-700">{(confSummary.mae * 100).toFixed(1)}pp</span>
                  </div>
                  <p className="text-[11px] text-stone-500 leading-5">
                    {confSummary.note} 最优收益区间：{confSummary.bestEdge.label}（ROI {toSigned(confSummary.bestEdge.roi, 1, '%')}）。
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-stone-400">当前窗口暂无 Conf 校准样本。</p>
              )}
              {confPriorityRows.length > 0 && (
                <div className="mt-1.5 rounded-xl border border-stone-100 bg-stone-50/70 p-2.5 space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-stone-400">校准优先级</p>
                  {confPriorityRows.slice(0, 3).map((row) => {
                    const emphasisClass = row.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'
                    const barClass = row.diff >= 0 ? 'bg-emerald-400' : 'bg-rose-400'
                    return (
                      <div key={row.label} className="motion-v2-row space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-stone-500">{row.label}</span>
                          <span className={`font-medium ${emphasisClass}`}>
                            {row.steer} {toSigned(row.diff * 100, 1, 'pp')}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white overflow-hidden">
                          <div
                            className={`h-full ${barClass}`}
                            style={{ width: `${Math.max(10, Math.min(100, Math.round(row.absDiff * 340)))}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-stone-400">
                          <span>{row.samples} 场</span>
                          <span>ROI {toSigned(row.roi, 1, '%')}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <p className="text-xs text-stone-400 mt-3 text-center">定义：比较赛前 Conf 与赛后 AJR 的长期偏差。</p>
          </div>
        </div>
      </div>

      <div className="motion-v2-surface glow-card bg-white rounded-2xl p-6 border border-stone-100">
        <div className="flex items-center justify-between mb-4">
          <div className="relative">
            <button
              onClick={() => setShowChartPicker((prev) => !prev)}
              className="motion-v2-ghost-btn font-medium text-stone-700 flex items-center gap-2 hover:text-amber-600 rounded-md px-2 py-1"
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
                    className={`motion-v2-row motion-v2-selectable block w-full px-4 py-2 text-left text-sm ${
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
        <div className={`relative h-44 rounded-xl border px-3 py-2 ${chartTheme.panelClass}`}>
          <svg viewBox={`0 0 ${TREND_VIEWBOX_WIDTH} ${TREND_VIEWBOX_HEIGHT}`} className="w-full h-[126px]" onMouseLeave={() => setHoveredPoint(null)}>
            <defs>
              <linearGradient id={lineGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={chartTheme.lineFrom} />
                <stop offset="100%" stopColor={chartTheme.lineTo} />
              </linearGradient>
              {secondarySparkline && (
                <linearGradient id={secondaryLineGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={chartTheme.secondaryLineFrom || chartTheme.lineFrom} />
                  <stop offset="100%" stopColor={chartTheme.secondaryLineTo || chartTheme.lineTo} />
                </linearGradient>
              )}
            </defs>
            <line x1={TREND_X_MIN} y1={TREND_PLOT_TOP} x2={TREND_X_MIN} y2={TREND_PLOT_BOTTOM} stroke="#d6d3d1" strokeWidth="0.45" />
            {chartYAxisTicks.map((tick, idx) => (
              <g key={`${chartKey}-y-${idx}`}>
                <line x1={TREND_X_MIN - 1.8} y1={tick.y} x2={TREND_X_MIN} y2={tick.y} stroke="#a8a29e" strokeWidth="0.45" />
                <text x={2} y={tick.y + 1.1} fontSize="2.75" fill="#78716c">{tick.label}</text>
              </g>
            ))}
            <line x1={TREND_X_MIN} y1={TREND_BASELINE_Y} x2={TREND_X_MAX} y2={TREND_BASELINE_Y} stroke={chartTheme.baseLine} strokeWidth="0.45" />
            <line x1={TREND_X_MIN} y1={TREND_MIDLINE_Y} x2={TREND_X_MAX} y2={TREND_MIDLINE_Y} stroke={chartTheme.midLine} strokeWidth="0.35" strokeDasharray="1.2 1.8" />
            {chartReferenceY != null && (
              <>
                <line x1={TREND_X_MIN} y1={chartReferenceY} x2={TREND_X_MAX} y2={chartReferenceY} stroke={chartTheme.zeroLine} strokeWidth="0.5" strokeDasharray="1.4 1.8" />
                {chartKey === 'rating' && <text x={TREND_X_MIN + 1} y={chartReferenceY - 1.8} fontSize="2.8" fill={chartTheme.valueColor}>50</text>}
              </>
            )}
            {secondarySparkline && (
              <polyline
                fill="none"
                stroke={`url(#${secondaryLineGradientId})`}
                strokeWidth={chartTheme.secondaryLineWidth || '1.05'}
                strokeDasharray={chartTheme.secondaryLineDash}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={secondarySparkline.line}
              />
            )}
            <polyline
              fill="none"
              stroke={`url(#${lineGradientId})`}
              strokeWidth={chartKey === 'rating' ? '1' : chartKey === 'single_roi' ? '1.22' : '1.15'}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={sparkline.line}
            />
            {sparkline.points.map((p, idx) => (
              <g key={`${chartKey}-${idx}`}>
                <circle cx={p.x} cy={p.y} r={idx === sparkline.points.length - 1 ? '1.15' : '0.95'} fill={chartTheme.point(p.value)} />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="3.2"
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => {
                    const meta = sparkline.sampledSeries[idx] || {}
                    const secondaryValue = secondarySparkline?.points?.[idx]?.value
                    setHoveredPoint({
                      chartKey,
                      leftPct: clamp((p.x / TREND_VIEWBOX_WIDTH) * 100, 8, 92),
                      topPct: clamp((p.y / TREND_VIEWBOX_HEIGHT) * 100, 14, 82),
                      label: String(meta.label || '--').split('·')[0],
                      match: meta.match || '聚合样本点',
                      primaryName: chartKey === 'error_rolling' ? 'Brier' : chartKey === 'single_roi' ? 'ROI' : '值',
                      primaryValue: formatChartNumeric(chartKey, p.value, chartKey === 'error_rolling' ? 3 : 2),
                      secondaryName:
                        secondaryValue == null ? null : chartKey === 'error_rolling' ? 'LogLoss' : 'EWMA',
                      secondaryValue:
                        secondaryValue == null
                          ? null
                          : formatChartNumeric(chartKey, secondaryValue, chartKey === 'error_rolling' ? 3 : 2),
                    })
                  }}
                />
              </g>
            ))}
            {sparkline.points.length > 0 && chartKey !== 'error_rolling' && (
              <text
                x={Math.max(TREND_X_MIN, sparkline.points[sparkline.points.length - 1].x - 34)}
                y={Math.max(8, sparkline.points[sparkline.points.length - 1].y - 3)}
                fontSize="3.1"
                fill={chartTheme.valueColor}
              >
                {chartKey === 'fund'
                  ? `¥${Math.round(sparkline.points[sparkline.points.length - 1].value)}`
                  : `${sparkline.points[sparkline.points.length - 1].value.toFixed(chartKey === 'corr_rolling' ? 2 : 1)}${chartKey === 'corr_rolling' ? '' : '%'}`}
              </text>
            )}
          </svg>
          {hoveredPoint && hoveredPoint.chartKey === chartKey && (
            <div
              className="pointer-events-none absolute z-20 w-[210px] rounded-lg border border-stone-200/90 bg-white/95 px-2.5 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.14)] backdrop-blur-sm"
              style={{
                left: `${hoveredPoint.leftPct}%`,
                top: `${hoveredPoint.topPct}%`,
                transform: 'translate(-50%, -110%)',
              }}
            >
              <p className="text-[10px] font-semibold text-stone-700">{hoveredPoint.label}</p>
              <p className="text-[10px] text-stone-600 mt-0.5">
                {hoveredPoint.primaryName}: <span className="font-semibold text-stone-800">{hoveredPoint.primaryValue}</span>
              </p>
              {hoveredPoint.secondaryValue != null && (
                <p className="text-[10px] text-stone-600 mt-0.5">
                  {hoveredPoint.secondaryName}: <span className="font-semibold text-stone-800">{hoveredPoint.secondaryValue}</span>
                </p>
              )}
              <p className="text-[10px] text-stone-500 mt-0.5 truncate">比赛: {hoveredPoint.match}</p>
            </div>
          )}
        </div>
        <div className="mt-2 px-2">
          <div className="relative h-6 border-t border-stone-200/80">
            {chartAxisTicks.map((tick) => (
              <div
                key={`${chartKey}-tick-${tick.index}`}
                className="absolute -top-px"
                style={{
                  left: `${tick.ratio * 100}%`,
                  transform: tick.ratio === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                <span className="block h-1.5 w-px bg-stone-300/90 mx-auto" />
                <span className="mt-1 block whitespace-nowrap text-[11px] text-stone-500">{tick.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 px-2">
          <p className="text-[11px] text-stone-600 leading-5">{chartNarrative.title}</p>
          <p className="text-[10px] text-stone-400 leading-5 mt-1">{chartNarrative.subtitle}</p>
          {chartSecondarySeries.length > 0 && (
            <div className="mt-2.5 flex items-center gap-3 text-[10px] text-stone-500">
              <span className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${chartKey === 'error_rolling' ? 'bg-amber-500' : 'bg-emerald-600'}`} />
                {chartKey === 'error_rolling' ? 'Brier' : 'Raw ROI'}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${chartKey === 'error_rolling' ? 'bg-rose-500' : 'bg-emerald-300'}`} />
                {chartKey === 'error_rolling' ? 'LogLoss' : 'EWMA'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div onClick={openAdvantageModal} className="motion-v2-surface glow-card bg-white rounded-2xl p-5 border border-stone-100 cursor-pointer">
        <h3 className="font-medium text-stone-700 mb-1">优势领域识别</h3>
        <p className="text-[10px] text-stone-400 mb-3">以球队为切片，自动识别 ROI 与命中率长期领先的组合</p>
        <div className="grid grid-cols-3 gap-3">
          {topAdvantageRows.slice(0, 3).map((item) => (
            <div key={item.team} className="motion-v2-row motion-v2-selectable flex items-center justify-between p-3 rounded-xl bg-stone-50 hover:bg-amber-50 transition-all">
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
                className="motion-v2-ghost-btn flex-1 py-2 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleInjectCapital}
                className="motion-v2-ghost-btn flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 transition-colors"
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
