import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Clock3,
  Cloud,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  LineChart,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  computeAdaptiveWeightSuggestions,
  getExpectedVsActualRows,
  getKellyDivisorBacktest,
  getKellyDivisorMatrix,
  getModeKellyRecommendations,
  getModelValidationSnapshot,
  getPredictionCalibrationContext,
  normalizeAjrForModel,
} from '../lib/analytics'
import {
  PAGE_AMBIENT_THEME_DEFAULTS,
  exportDataBundle,
  getAccessLogs,
  getCloudSyncStatus,
  getInvestments,
  getSystemConfig,
  importDataBundle,
  pullCloudSnapshotNow,
  runCloudSyncNow,
  saveSystemConfig,
  setCloudSyncEnabled,
} from '../lib/localData'
import { getPrimaryEntryMarket, normalizeEntryRecord } from '../lib/entryParsing'
import {
  FUTURE_FEATURE_DETAIL_SOURCE,
  FUTURE_FEATURE_DETAIL_TEXT,
  FUTURE_FEATURE_OVERVIEW_TEXT,
  FUTURE_FEATURE_POINTS,
} from '../data/futureFeaturesRoadmap'
import { LogoGalleryExplorer, LogoGalleryPreview } from '../components/LogoGalleryExplorer'
import * as XLSX from 'xlsx'

const TYS_BASE_FACTORS = {
  S: 1.08,
  M: 1.02,
  L: 0.98,
  H: 0.92,
}

const FID_BASE_FACTORS = {
  0: 0.92,
  0.25: 0.99,
  0.4: 1.02,
  0.5: 1.05,
  0.6: 1.07,
  0.75: 1.1,
}

const MODE_ALIAS = {
  '常规-激进': '常规-杠杆',
}

const WEIGHT_FIELDS = [
  { key: 'weightConf', label: 'Conf 权重', hint: 'Weight Conf' },
  { key: 'weightMode', label: 'Mode 权重', hint: 'Weight Mode' },
  { key: 'weightTys', label: 'TYS 权重', hint: 'Weight TYS' },
  { key: 'weightFid', label: 'FID 权重', hint: 'Weight FID' },
  { key: 'weightOdds', label: 'Odds 权重', hint: 'Weight Odds' },
  { key: 'weightFse', label: 'FSE 权重', hint: 'Weight FSE' },
]

const FACTOR_RANGE_CONFIG = {
  '4w': { label: '近四周', days: 28, buckets: 8 },
  '1m': { label: '近一月', days: 30, buckets: 10 },
  '2m': { label: '近两月', days: 60, buckets: 12 },
  all: { label: '历史', days: null, buckets: 15 },
}

const BACKUP_CADENCE_OPTIONS = [
  { value: 'half_week', label: 'every half week' },
  { value: 'week', label: 'every week' },
  { value: 'two_weeks', label: 'every other week' },
  { value: 'month', label: 'every month' },
  { value: 'two_months', label: 'every other month' },
]

const BACKUP_CADENCE_HOURS = {
  half_week: 84,
  week: 168,
  two_weeks: 336,
  month: 24 * 30,
  two_months: 24 * 60,
}

const EMPTY_KELLY_BACKTEST = {
  divisors: [],
  globalRows: [],
  globalBest: null,
  modeRecommendations: [],
}

const EMPTY_CALIBRATION_CONTEXT = {
  sampleCount: 0,
  n: 0,
  multipliers: { conf: 1, fse: 1 },
  effectiveRecencyWeight: 1,
  bands: [],
  repBuckets: [],
  regression: { slope: 1, intercept: 0, r2: 0, rmse: 0 },
  regressionMultiplier: 1,
  regressionReliability: 0,
  scatterData: [],
}

const EMPTY_MODEL_VALIDATION = {
  ready: false,
  minimumSamples: 24,
  sampleCount: 0,
  trainSamples: 0,
  testSamples: 0,
  stability: 'insufficient',
  message: '模型验证计算中...',
  brier: { testRaw: 0, testCalibrated: 0, gainPct: 0, drift: 0 },
  logLoss: { testRaw: 0, testCalibrated: 0, gainPct: 0 },
  strategy: {
    raw: { roi: 0, maxDrawdown: 0, samples: 0, runs: 0 },
    calibrated: { roi: 0, maxDrawdown: 0, samples: 0, runs: 0 },
  },
  walkForward: [],
  positiveWalkForward: 0,
}

const ConsoleCardIcon = ({ IconComp }) => (
  <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-indigo-200 bg-gradient-to-b from-indigo-50 via-violet-50 to-white text-indigo-600 shadow-[0_1px_2px_rgba(99,102,241,0.16),inset_0_1px_0_rgba(255,255,255,0.88)]">
    <IconComp size={14} strokeWidth={1.7} />
  </span>
)

const ExplainHover = ({ card, align = 'left', children }) => {
  if (!card) return children
  const alignClass = align === 'right' ? 'right-0' : 'left-0'
  const lines = [
    { label: '是什么', value: card.what },
    { label: '描述', value: card.describes },
    { label: '当前值', value: card.current },
    { label: '基准值', value: card.baseline },
    { label: '当前状态', value: card.status },
    { label: '其它状态', value: card.others },
  ].filter((line) => line.value)

  return (
    <span className="group/explain relative inline-flex">
      {children}
      <span className={`pointer-events-none absolute ${alignClass} top-full z-[240] mt-2.5 w-[300px] translate-y-1 rounded-xl border border-sky-200/85 bg-[linear-gradient(145deg,rgba(240,249,255,0.95),rgba(255,255,255,0.95)_48%,rgba(238,242,255,0.9))] p-3 text-left opacity-0 shadow-[0_16px_34px_-26px_rgba(56,189,248,0.45),inset_0_1px_0_rgba(255,255,255,0.92)] transition-all duration-180 group-hover/explain:translate-y-0 group-hover/explain:opacity-100 group-hover/explain:shadow-[0_22px_44px_-24px_rgba(56,189,248,0.5),inset_0_1px_0_rgba(255,255,255,0.92)]`}>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-600">{card.title}</span>
        <span className="mt-1 block h-px w-full bg-gradient-to-r from-sky-200 via-indigo-200/80 to-transparent" />
        <span className="mt-1.5 block space-y-1.5">
          {lines.map((line) => (
            <span key={`${card.title}-${line.label}`} className="block text-[11px] leading-[1.45] text-stone-600">
              <span className="font-semibold text-stone-700">{line.label}：</span>
              {line.value}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

const PAGE_AMBIENT_ITEMS = [
  { key: 'new', label: 'New', hint: '新建投资' },
  { key: 'combo', label: 'Portfolio', hint: '智能组合建议' },
  { key: 'settle', label: 'Settle', hint: '待结算' },
  { key: 'dashboard_overview', label: 'Dashboard Overview', hint: '数据总览' },
  { key: 'dashboard_analysis', label: 'Dashboard Analysis', hint: '深度分析' },
  { key: 'dashboard_metrics', label: 'Dashboard Metrics', hint: '指标总览' },
  { key: 'history', label: 'History', hint: '历史记录' },
  { key: 'teams', label: 'Teams', hint: '球队档案馆' },
  { key: 'params', label: 'Console', hint: '参数后台' },
]

const PAGE_AMBIENT_TONE_OPTIONS = [
  { value: 'classic_white', label: '经典白' },
  { value: 'soft_blue', label: '淡蓝色' },
  { value: 'soft_orange', label: '浅橙色' },
]
const LAYOUT_MODE_OPTIONS = ['modern', 'topbar', 'sidebar']
const ACCESS_LOG_PAGE_SIZE = 6
const FIT_TRAJECTORY_WINDOW_OPTIONS = [24, 36, 48, 72, 96, 120, 150, 0]
const FIT_TRAJECTORY_MODE_OPTIONS = [
  { value: '1', label: '#1 Regime River · 态势河流' },
  { value: '2', label: '#2 Error Horizon · 误差地平线' },
  { value: '3', label: '#3 Pulse Timeline · 脉冲时间轴' },
  { value: '4', label: '#4 Ribbon + Median · 丝带中轴' },
  { value: '5', label: '#5 Regime Mosaic · 态势拼图' },
  { value: '6', label: '#6 Control Corridor · 控制廊道' },
  { value: '7', label: '#7 Fit Ladder · 拟合阶梯' },
  { value: '8', label: '#8 Scatter Cloud · 散点云图' },
  { value: '9', label: '#9 Deviation Waterfall · 偏差瀑布' },
  { value: '10', label: '#10 Stability Thermometer · 稳定温标' },
  { value: '11', label: '#11 Dual Track · 双轨对照' },
  { value: '12', label: '#12 Signal Ladder · 信号阶梯' },
]

const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value))

const buildSmoothPath = (inputPoints, tension = 0.16) => {
  if (!inputPoints.length) return ''
  if (inputPoints.length === 1) return `M ${inputPoints[0].x.toFixed(3)} ${inputPoints[0].y.toFixed(3)}`
  const t = clampNumber(tension, 0.08, 0.22)
  let path = `M ${inputPoints[0].x.toFixed(3)} ${inputPoints[0].y.toFixed(3)}`
  for (let idx = 0; idx < inputPoints.length - 1; idx += 1) {
    const p0 = inputPoints[idx - 1] || inputPoints[idx]
    const p1 = inputPoints[idx]
    const p2 = inputPoints[idx + 1]
    const p3 = inputPoints[idx + 2] || p2
    const segmentPad = Math.abs(p2.y - p1.y) * 0.35 + 0.6
    const minY = Math.min(p1.y, p2.y) - segmentPad
    const maxY = Math.max(p1.y, p2.y) + segmentPad
    const minX = Math.min(p1.x, p2.x)
    const maxX = Math.max(p1.x, p2.x)
    const cp1x = clampNumber(p1.x + (p2.x - p0.x) * t, minX, maxX)
    const cp1y = clampNumber(p1.y + (p2.y - p0.y) * t, minY, maxY)
    const cp2x = clampNumber(p2.x - (p3.x - p1.x) * t, minX, maxX)
    const cp2y = clampNumber(p2.y - (p3.y - p1.y) * t, minY, maxY)
    path += ` C ${cp1x.toFixed(3)} ${cp1y.toFixed(3)}, ${cp2x.toFixed(3)} ${cp2y.toFixed(3)}, ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`
  }
  return path
}

const buildLinePath = (inputPoints) =>
  inputPoints
    .map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`)
    .join(' ')

const buildStepPath = (inputPoints) => {
  if (!inputPoints.length) return ''
  if (inputPoints.length === 1) return `M ${inputPoints[0].x.toFixed(3)} ${inputPoints[0].y.toFixed(3)}`
  let path = `M ${inputPoints[0].x.toFixed(3)} ${inputPoints[0].y.toFixed(3)}`
  for (let idx = 1; idx < inputPoints.length; idx += 1) {
    const prev = inputPoints[idx - 1]
    const curr = inputPoints[idx]
    path += ` L ${curr.x.toFixed(3)} ${prev.y.toFixed(3)} L ${curr.x.toFixed(3)} ${curr.y.toFixed(3)}`
  }
  return path
}

const buildBandPath = (upperPoints, lowerPoints) => {
  if (!upperPoints.length || !lowerPoints.length) return ''
  const upper = buildSmoothPath(upperPoints, 0.16)
  const lower = buildSmoothPath([...lowerPoints].reverse(), 0.16)
  return `${upper} ${lower.replace(/^M/, 'L')} Z`
}

const buildMovingAverageValues = (values, radius) =>
  values.map((_, idx) => {
    const start = Math.max(0, idx - radius)
    const end = Math.min(values.length - 1, idx + radius)
    const window = values.slice(start, end + 1)
    return window.reduce((sum, value) => sum + value, 0) / Math.max(window.length, 1)
  })

const buildSeriesBand = ({ points, values, span, chartTop, chartBottom, radius = 3, multiplier = 0.9, minPx = 0.8, maxPx = 7 }) => {
  if (!points.length || !values.length) return { upper: [], lower: [] }
  const toBandPx = (std) =>
    clampNumber(((std / Math.max(span, 0.06)) * (chartBottom - chartTop) * multiplier) + minPx, minPx, maxPx)

  const upper = points.map((point, idx) => {
    const start = Math.max(0, idx - radius)
    const end = Math.min(values.length - 1, idx + radius)
    const local = values.slice(start, end + 1)
    const mean = local.reduce((sum, value) => sum + value, 0) / Math.max(local.length, 1)
    const variance = local.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(local.length, 1)
    const std = Math.sqrt(Math.max(variance, 0))
    const bandPx = toBandPx(std)
    return {
      x: point.x,
      y: clampNumber(point.y - bandPx, chartTop, chartBottom),
    }
  })

  const lower = points.map((point, idx) => {
    const start = Math.max(0, idx - radius)
    const end = Math.min(values.length - 1, idx + radius)
    const local = values.slice(start, end + 1)
    const mean = local.reduce((sum, value) => sum + value, 0) / Math.max(local.length, 1)
    const variance = local.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(local.length, 1)
    const std = Math.sqrt(Math.max(variance, 0))
    const bandPx = toBandPx(std)
    return {
      x: point.x,
      y: clampNumber(point.y + bandPx, chartTop, chartBottom),
    }
  })

  return { upper, lower }
}

const buildFitTrajectoryModel = (values) => {
  if (!Array.isArray(values) || values.length === 0) return null

  const series = values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  if (series.length === 0) return null

  const chartLeft = 6
  const chartRight = 334
  const chartTop = 8
  const chartBottom = 52

  const rawMin = Math.min(...series)
  const rawMax = Math.max(...series)
  const spread = Math.max(rawMax - rawMin, 0.03)
  const padding = Math.max(spread * 0.18, 0.016)
  const min = Math.min(rawMin - padding, -0.06)
  const max = Math.max(rawMax + padding, 0.06)
  const span = Math.max(max - min, 0.08)
  const step = series.length > 1 ? (chartRight - chartLeft) / (series.length - 1) : 0

  const projectValueToY = (value) => chartBottom - ((value - min) / span) * (chartBottom - chartTop)

  const points = series.map((value, idx) => {
    const x = chartLeft + idx * step
    const y = projectValueToY(value)
    return { x, y, value, idx }
  })

  const movingValues = buildMovingAverageValues(series, 2)
  const movingLongValues = buildMovingAverageValues(series, 4)
  const movingPoints = movingValues.map((value, idx) => ({
    x: points[idx].x,
    y: projectValueToY(value),
    value,
    idx,
  }))
  const movingLongPoints = movingLongValues.map((value, idx) => ({
    x: points[idx].x,
    y: projectValueToY(value),
    value,
    idx,
  }))

  const narrowBand = buildSeriesBand({
    points,
    values: series,
    span,
    chartTop,
    chartBottom,
    radius: Math.min(4, Math.max(2, Math.floor(series.length / 14))),
    multiplier: 0.85,
    minPx: 0.8,
    maxPx: 5.2,
  })
  const wideBand = buildSeriesBand({
    points,
    values: series,
    span,
    chartTop,
    chartBottom,
    radius: Math.min(5, Math.max(3, Math.floor(series.length / 11))),
    multiplier: 1.22,
    minPx: 1.1,
    maxPx: 8.2,
  })
  const trendBand = buildSeriesBand({
    points: movingLongPoints,
    values: movingLongValues,
    span,
    chartTop,
    chartBottom,
    radius: Math.min(5, Math.max(2, Math.floor(series.length / 16))),
    multiplier: 0.68,
    minPx: 0.65,
    maxPx: 4.8,
  })

  const zeroYRaw = chartBottom - ((0 - min) / span) * (chartBottom - chartTop)
  const zeroY = clampNumber(zeroYRaw, chartTop, chartBottom)
  const corridorHalf = ((chartBottom - chartTop) * 0.085)
  const corridorTop = clampNumber(zeroY - corridorHalf, chartTop, chartBottom)
  const corridorBottom = clampNumber(zeroY + corridorHalf, chartTop, chartBottom)

  const bars = points.map((point) => {
    const barWidth = Math.max(2.2, step * 0.65)
    const x = point.x - barWidth / 2
    const y = Math.min(point.y, zeroY)
    const height = Math.max(0.75, Math.abs(point.y - zeroY))
    return {
      x,
      y,
      width: barWidth,
      height,
      positive: point.value >= 0,
    }
  })

  const mosaicSegments = points.slice(0, -1).map((point, idx) => {
    const next = points[idx + 1]
    const avg = (point.value + next.value) / 2
    const x = point.x
    const width = Math.max(1.2, next.x - point.x)
    return {
      x,
      width,
      tone:
        avg >= 0.08
          ? 'rgba(56,189,248,0.11)'
          : avg >= -0.05
            ? 'rgba(99,102,241,0.085)'
            : 'rgba(139,92,246,0.11)',
    }
  })

  const lineBySign = points.slice(1).map((point, idx) => {
    const prev = points[idx]
    const avg = (prev.value + point.value) / 2
    return {
      x1: prev.x,
      y1: prev.y,
      x2: point.x,
      y2: point.y,
      stroke:
        avg >= 0.08 ? '#0ea5e9' : avg >= -0.05 ? '#6366f1' : '#8b5cf6',
    }
  })

  const slopeSegments = points.slice(1).map((point, idx) => {
    const prev = points[idx]
    const slope = point.value - prev.value
    return {
      x1: prev.x,
      y1: prev.y,
      x2: point.x,
      y2: point.y,
      stroke:
        slope >= 0.02 ? '#0ea5e9' : slope <= -0.02 ? '#8b5cf6' : '#6366f1',
    }
  })

  const cumulativeRaw = series.reduce((acc, value) => {
    const prev = acc.length > 0 ? acc[acc.length - 1] : 0
    acc.push(prev + value)
    return acc
  }, [])
  const cumMin = Math.min(...cumulativeRaw)
  const cumMax = Math.max(...cumulativeRaw)
  const cumSpan = Math.max(cumMax - cumMin, 0.08)
  const cumulativePoints = cumulativeRaw.map((value, idx) => ({
    x: points[idx].x,
    y: chartBottom - ((value - cumMin) / cumSpan) * (chartBottom - chartTop),
    value,
  }))

  const lineSmoothPath = buildSmoothPath(points, 0.16)
  const lineMovingPath = buildSmoothPath(movingPoints, 0.14)
  const lineLongMovingPath = buildSmoothPath(movingLongPoints, 0.12)
  const areaToZeroPath = `${lineSmoothPath} L ${chartRight.toFixed(3)} ${zeroY.toFixed(3)} L ${chartLeft.toFixed(3)} ${zeroY.toFixed(3)} Z`
  const areaToBottomPath = `${lineSmoothPath} L ${chartRight.toFixed(3)} ${chartBottom.toFixed(3)} L ${chartLeft.toFixed(3)} ${chartBottom.toFixed(3)} Z`
  const areaMovingToZeroPath = `${lineMovingPath} L ${chartRight.toFixed(3)} ${zeroY.toFixed(3)} L ${chartLeft.toFixed(3)} ${zeroY.toFixed(3)} Z`
  const areaLongToZeroPath = `${lineLongMovingPath} L ${chartRight.toFixed(3)} ${zeroY.toFixed(3)} L ${chartLeft.toFixed(3)} ${zeroY.toFixed(3)} Z`

  return {
    values: series,
    points,
    movingPoints,
    movingLongPoints,
    narrowBandPath: buildBandPath(narrowBand.upper, narrowBand.lower),
    wideBandPath: buildBandPath(wideBand.upper, wideBand.lower),
    trendBandPath: buildBandPath(trendBand.upper, trendBand.lower),
    lineRawPath: buildLinePath(points),
    lineSmoothPath,
    lineMovingPath,
    lineLongMovingPath,
    lineStepPath: buildStepPath(points),
    lineBySign,
    slopeSegments,
    mosaicSegments,
    bars,
    cumulativePath: buildSmoothPath(cumulativePoints, 0.14),
    areaToZeroPath,
    areaToBottomPath,
    areaMovingToZeroPath,
    areaLongToZeroPath,
    zeroY,
    corridorTop,
    corridorBottom,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
  }
}

const renderFitTrajectoryChart = ({ model, mode }) => {
  if (!model) {
    return (
      <text x="168" y="32" textAnchor="middle" fontSize="4" fill="#94a3b8">
        暂无拟合轨迹
      </text>
    )
  }

  const {
    points,
    movingPoints,
    movingLongPoints,
    narrowBandPath,
    wideBandPath,
    trendBandPath,
    lineRawPath,
    lineSmoothPath,
    lineMovingPath,
    lineLongMovingPath,
    lineStepPath,
    lineBySign,
    slopeSegments,
    mosaicSegments,
    bars,
    cumulativePath,
    areaToZeroPath,
    areaToBottomPath,
    areaMovingToZeroPath,
    areaLongToZeroPath,
    zeroY,
    corridorTop,
    corridorBottom,
    chartLeft,
    chartRight,
    chartTop,
    chartBottom,
  } = model

  const quarterX = chartLeft + (chartRight - chartLeft) * 0.25
  const halfX = chartLeft + (chartRight - chartLeft) * 0.5
  const thirdQuarterX = chartLeft + (chartRight - chartLeft) * 0.75
  const tickRows = [chartTop, chartTop + (chartBottom - chartTop) * 0.5, chartBottom]

  const baseGrid = (
    <>
      {tickRows.map((y) => (
        <line key={`grid-${y}`} x1={chartLeft} y1={y} x2={chartRight} y2={y} stroke="#ecf3ff" strokeWidth="0.72" />
      ))}
      {[quarterX, halfX, thirdQuarterX].map((x) => (
        <line key={`vgrid-${x}`} x1={x} y1={chartTop} x2={x} y2={chartBottom} stroke="#e2e8ff" strokeWidth="0.58" />
      ))}
      <line x1={chartLeft} y1={zeroY} x2={chartRight} y2={zeroY} stroke="#bfdbfe" strokeWidth="0.72" strokeDasharray="2 1.8" />
    </>
  )

  const keyDots = points.filter((_, idx) => idx % 4 === 0 || idx === points.length - 1)

  const modeLayers = (() => {
    switch (mode) {
      case '1':
        return (
          <>
            {mosaicSegments.map((segment, idx) => (
              <rect
                key={`mosaic-river-${idx}`}
                x={segment.x}
                y={chartTop}
                width={segment.width}
                height={chartBottom - chartTop}
                fill={segment.tone.replace(/0\.\d+\)/, '0.03)')}
              />
            ))}
            <path d={wideBandPath} fill="rgba(56,189,248,0.07)" />
            <path d={narrowBandPath} fill="rgba(99,102,241,0.09)" />
            <path d={trendBandPath} fill="rgba(14,165,233,0.06)" />
            <path d={lineMovingPath} fill="none" stroke="rgba(56,189,248,0.34)" strokeWidth="0.92" strokeDasharray="2 1.8" strokeLinecap="round" />
            <path d={lineLongMovingPath} fill="none" stroke="rgba(14,165,233,0.4)" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineSmoothPath} fill="none" stroke="url(#fitLineLg)" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )
      case '2':
        return (
          <>
            <path d={areaMovingToZeroPath} fill="rgba(99,102,241,0.08)" />
            {bars.map((bar, idx) => (
              <rect
                key={`horizon-bar-${idx}`}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={bar.positive ? 'rgba(56,189,248,0.14)' : 'rgba(129,140,248,0.14)'}
                rx={Math.min(1.8, bar.width / 2)}
              />
            ))}
            <path d={lineMovingPath} fill="none" stroke="url(#fitLineLg)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )
      case '3':
        return (
          <>
            <path d={lineRawPath} fill="none" stroke="rgba(148,163,184,0.38)" strokeWidth="0.95" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineSmoothPath} fill="none" stroke="url(#fitLineLg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            {keyDots.map((point, idx) => {
              const opacity = 0.25 + (idx / Math.max(keyDots.length - 1, 1)) * 0.5
              return (
                <g key={`pulse-${idx}`}>
                  <circle cx={point.x} cy={point.y} r={0.68} fill={`rgba(99,102,241,${opacity})`} />
                </g>
              )
            })}
          </>
        )
      case '4':
        return (
          <>
            <path d={wideBandPath} fill="rgba(129,140,248,0.08)" />
            <path d={narrowBandPath} fill="rgba(56,189,248,0.07)" />
            <path d={trendBandPath} fill="rgba(14,165,233,0.08)" />
            <path d={lineLongMovingPath} fill="none" stroke="url(#fitLineLg)" strokeWidth="1.74" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineMovingPath} fill="none" stroke="rgba(71,85,105,0.38)" strokeWidth="0.95" strokeDasharray="2.2 1.9" strokeLinecap="round" />
          </>
        )
      case '5':
        return (
          <>
            {mosaicSegments.map((segment, idx) => (
              <rect
                key={`mosaic-${idx}`}
                x={segment.x}
                y={chartTop}
                width={segment.width}
                height={chartBottom - chartTop}
                fill={segment.tone.replace(/0\.\d+\)/, '0.055)')}
              />
            ))}
            <path d={lineStepPath} fill="none" stroke="url(#fitLineLg)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((point, idx) => (
              <rect
                key={`mosaic-point-${idx}`}
                x={point.x - 0.5}
                y={point.y - 0.5}
                width={1}
                height={1}
                rx={0.2}
                fill="rgba(99,102,241,0.7)"
              />
            ))}
          </>
        )
      case '6':
        return (
          <>
            <rect
              x={chartLeft}
              y={corridorTop}
              width={chartRight - chartLeft}
              height={Math.max(0.8, corridorBottom - corridorTop)}
              fill="rgba(99,102,241,0.065)"
              rx={2.4}
            />
            <path d={trendBandPath} fill="rgba(99,102,241,0.075)" />
            <path d={lineLongMovingPath} fill="none" stroke="rgba(79,70,229,0.88)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineMovingPath} fill="none" stroke="rgba(56,189,248,0.52)" strokeWidth="0.92" strokeDasharray="2 1.8" strokeLinecap="round" />
          </>
        )
      case '7':
        return (
          <>
            {bars.map((bar, idx) => (
              <rect
                key={`ladder-bar-${idx}`}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={bar.positive ? 'rgba(56,189,248,0.14)' : 'rgba(129,140,248,0.14)'}
                rx={Math.min(2, bar.width / 2)}
              />
            ))}
            <path d={lineStepPath} fill="none" stroke="rgba(79,70,229,0.88)" strokeWidth="1.54" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineRawPath} fill="none" stroke="rgba(148,163,184,0.3)" strokeWidth="0.76" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )
      case '8':
        return (
          <>
            <path d={lineMovingPath} fill="none" stroke="rgba(99,102,241,0.55)" strokeWidth="1.05" strokeDasharray="2.1 1.9" strokeLinecap="round" />
            {points.map((point, idx) => {
              const alpha = 0.15 + (idx / Math.max(points.length - 1, 1)) * 0.4
              return (
                <circle
                  key={`scatter-${idx}`}
                  cx={point.x}
                  cy={point.y}
                  r={0.66 + Math.min(0.9, idx / 22)}
                  fill={`rgba(79,70,229,${alpha})`}
                />
              )
            })}
          </>
        )
      case '9':
        return (
          <>
            {bars.map((bar, idx) => (
              <rect
                key={`waterfall-bar-${idx}`}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={bar.positive ? 'rgba(34,197,94,0.16)' : 'rgba(99,102,241,0.15)'}
                rx={Math.min(1.6, bar.width / 2)}
              />
            ))}
            <path d={cumulativePath} fill="none" stroke="rgba(99,102,241,0.72)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )
      case '10':
        return (
          <>
            <path d={areaToBottomPath} fill="rgba(224,231,255,0.32)" />
            <path d={lineMovingPath} fill="none" stroke="url(#fitLineLg)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineLongMovingPath} fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="0.9" strokeDasharray="2.1 1.7" strokeLinecap="round" />
          </>
        )
      case '11':
        return (
          <>
            <path d={lineRawPath} fill="none" stroke="rgba(148,163,184,0.42)" strokeWidth="0.78" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineMovingPath} fill="none" stroke="rgba(14,165,233,0.78)" strokeWidth="1.18" strokeLinecap="round" strokeLinejoin="round" />
            <path d={lineLongMovingPath} fill="none" stroke="rgba(99,102,241,0.86)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )
      case '12':
        return (
          <>
            {slopeSegments.map((segment, idx) => (
              <line
                key={`signal-segment-${idx}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                stroke={segment.stroke}
                strokeWidth="1.78"
                strokeLinecap="round"
              />
            ))}
            <path d={areaToZeroPath} fill="rgba(99,102,241,0.08)" />
            <path d={lineLongMovingPath} fill="none" stroke="rgba(79,70,229,0.5)" strokeWidth="0.95" strokeDasharray="2 1.8" strokeLinecap="round" />
          </>
        )
      default:
        return (
          <>
            {lineBySign.map((segment, idx) => (
              <line
                key={`segment-default-${idx}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                stroke={segment.stroke}
                strokeWidth="1.76"
                strokeLinecap="round"
              />
            ))}
          </>
        )
    }
  })()

  return (
    <>
      <defs>
        <linearGradient id="fitLineLg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="52%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      {baseGrid}
      {modeLayers}
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="1.28" fill="rgba(99,102,241,0.84)" />
      <text x={chartLeft} y="61" fontSize="2.6" fill="#94a3b8">
        start
      </text>
      <text x={chartRight - 11} y="61" fontSize="2.6" fill="#94a3b8">
        now
      </text>
    </>
  )
}

const normalizeAmbientThemeMap = (value) => {
  const incoming = value && typeof value === 'object' ? value : {}
  const next = { ...PAGE_AMBIENT_THEME_DEFAULTS }
  PAGE_AMBIENT_ITEMS.forEach((item) => {
    const raw = String(incoming[item.key] || '').trim()
    if (PAGE_AMBIENT_TONE_OPTIONS.some((option) => option.value === raw)) {
      next[item.key] = raw
    }
  })
  return next
}

function ThemeSettingsExplorer({ value, onChange, onReset }) {
  const [themes, setThemes] = useState(() => normalizeAmbientThemeMap(value))

  useEffect(() => {
    setThemes(normalizeAmbientThemeMap(value))
  }, [value])

  const pickTone = (pageKey, tone) => {
    const next = {
      ...themes,
      [pageKey]: tone,
    }
    setThemes(next)
    onChange(next)
  }

  const resetDefaults = () => {
    const next = { ...PAGE_AMBIENT_THEME_DEFAULTS }
    setThemes(next)
    onReset(next)
  }

  return (
    <div className="rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50/85 via-white/94 to-cyan-50/75 p-4 sm:p-5 shadow-[0_20px_45px_rgba(56,189,248,0.15),inset_0_1px_0_rgba(255,255,255,0.82)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-sky-600 font-semibold">Themes Settings</p>
          <h4 className="text-[15px] font-semibold text-stone-800 mt-1">页面浮层主题</h4>
          <p className="text-xs text-stone-500 mt-1">每个页面可独立设置：经典白 / 淡蓝色 / 浅橙色，修改即时生效并随云同步保留。</p>
        </div>
        <button
          type="button"
          onClick={resetDefaults}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors"
        >
          一键恢复默认
        </button>
      </div>

      <div className="space-y-2.5">
        {PAGE_AMBIENT_ITEMS.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-sky-100/80 bg-white/78 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-700 leading-tight">{item.label}</p>
                <p className="text-[11px] text-stone-400 mt-0.5">{item.hint}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {PAGE_AMBIENT_TONE_OPTIONS.map((option) => {
                  const active = themes[item.key] === option.value
                  return (
                    <button
                      key={`${item.key}-${option.value}`}
                      type="button"
                      onClick={() => pickTone(item.key, option.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        active
                          ? 'border-sky-300 bg-sky-100/80 text-sky-700'
                          : 'border-stone-200 bg-white text-stone-500 hover:border-sky-200 hover:text-sky-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const parseInlineTokens = (text, keyPrefix) => {
  const source = String(text || '')
  if (!source) return null
  const parts = source.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts
    .filter((item) => item.length > 0)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={`${keyPrefix}-strong-${index}`} className="font-semibold text-stone-800">
            {part.slice(2, -2)}
          </strong>
        )
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={`${keyPrefix}-code-${index}`}
            className="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-100 text-[12px] font-medium"
          >
            {part.slice(1, -1)}
          </code>
        )
      }
      return <span key={`${keyPrefix}-txt-${index}`}>{part}</span>
    })
}

const renderReadableTextBlock = (rawBlock, keyPrefix) => {
  const block = String(rawBlock || '').trim()
  if (!block) return null
  if (/^-{3,}$/.test(block)) {
    return <hr key={`${keyPrefix}-divider`} className="border-stone-200/80 my-2" />
  }

  const lines = block.split('\n')
  const firstLine = lines[0].trim()
  const headingMatch = firstLine.match(/^(#{2,4})\s+(.+)$/)
  if (headingMatch && lines.length === 1) {
    const level = headingMatch[1].length
    const text = headingMatch[2].trim()
    if (level === 2) {
      return (
        <h3 key={`${keyPrefix}-h2`} className="text-[18px] font-semibold tracking-tight text-stone-800 mt-1">
          {parseInlineTokens(text, `${keyPrefix}-h2`)}
        </h3>
      )
    }
    if (level === 3) {
      return (
        <h4 key={`${keyPrefix}-h3`} className="text-[15px] font-semibold text-stone-700 mt-1">
          {parseInlineTokens(text, `${keyPrefix}-h3`)}
        </h4>
      )
    }
    return (
      <h5 key={`${keyPrefix}-h4`} className="text-[13px] font-semibold uppercase tracking-[0.08em] text-stone-500 mt-1">
        {parseInlineTokens(text, `${keyPrefix}-h4`)}
      </h5>
    )
  }

  if (lines.every((line) => line.trim().startsWith('- '))) {
    return (
      <ul key={`${keyPrefix}-ul`} className="space-y-1.5 pl-5 text-[13px] leading-6 text-stone-600 list-disc marker:text-sky-400">
        {lines.map((line, index) => (
          <li key={`${keyPrefix}-li-${index}`}>{parseInlineTokens(line.trim().slice(2), `${keyPrefix}-li-${index}`)}</li>
        ))}
      </ul>
    )
  }

  if (lines.every((line) => /^\d+\.\s+/.test(line.trim()))) {
    return (
      <ol key={`${keyPrefix}-ol`} className="space-y-1.5 pl-5 text-[13px] leading-6 text-stone-600 list-decimal marker:text-sky-500">
        {lines.map((line, index) => {
          const normalized = line.trim().replace(/^\d+\.\s+/, '')
          return <li key={`${keyPrefix}-ol-${index}`}>{parseInlineTokens(normalized, `${keyPrefix}-ol-${index}`)}</li>
        })}
      </ol>
    )
  }

  if (lines.length >= 2 && lines.some((line) => line.trim().startsWith('|'))) {
    return (
      <div key={`${keyPrefix}-table`} className="rounded-xl border border-sky-100 bg-white/70 overflow-hidden">
        {lines.map((line, index) => (
          <div
            key={`${keyPrefix}-tr-${index}`}
            className={`px-3 py-1.5 text-[11px] font-mono text-slate-600 ${index !== lines.length - 1 ? 'border-b border-sky-100/80' : ''}`}
          >
            {line}
          </div>
        ))}
      </div>
    )
  }

  if (lines.every((line) => line.trim().startsWith('>'))) {
    return (
      <blockquote key={`${keyPrefix}-quote`} className="rounded-xl border-l-4 border-sky-300 bg-sky-50/70 px-4 py-3 text-[13px] leading-6 text-slate-600">
        {lines.map((line, index) => (
          <p key={`${keyPrefix}-quote-p-${index}`}>{parseInlineTokens(line.trim().replace(/^>\s?/, ''), `${keyPrefix}-quote-${index}`)}</p>
        ))}
      </blockquote>
    )
  }

  return (
    <p key={`${keyPrefix}-p`} className="text-[13px] leading-7 text-stone-600 whitespace-pre-wrap">
      {parseInlineTokens(block, `${keyPrefix}-p`)}
    </p>
  )
}

const LongFormDocument = ({ text, keyPrefix }) => {
  const content = String(text || '').replace(/\r\n/g, '\n')
  if (!content) return null
  const segments = []
  const codeFenceRegex = /```([\s\S]*?)```/g
  let lastIndex = 0
  let match = codeFenceRegex.exec(content)
  while (match) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'code', content: match[1].trim() })
    lastIndex = codeFenceRegex.lastIndex
    match = codeFenceRegex.exec(content)
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) })
  }

  return (
    <div className="space-y-3">
      {segments.map((segment, segmentIndex) => {
        if (segment.type === 'code') {
          return (
            <pre
              key={`${keyPrefix}-code-${segmentIndex}`}
              className="rounded-xl border border-slate-700/20 bg-slate-950/95 text-slate-100 text-[11px] leading-6 px-4 py-3 overflow-x-auto"
            >
              {segment.content}
            </pre>
          )
        }
        const blocks = segment.content
          .split(/\n{2,}/)
          .map((block) => block.trim())
          .filter(Boolean)
        return blocks.map((block, blockIndex) => renderReadableTextBlock(block, `${keyPrefix}-seg-${segmentIndex}-block-${blockIndex}`))
      })}
    </div>
  )
}

const CopulaRemarks = () => (
  <section className="mt-5 rounded-xl border border-stone-200/70 bg-stone-50/65 px-4 py-3">
    <p className="text-[11px] uppercase tracking-[0.14em] text-stone-400 font-medium">Remarks</p>

    <div className="mt-2 space-y-3 text-[12px] leading-6 text-stone-500">
      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">
          3) 何时可以明确判断“相关性必须处理”？——同场串关（Same-Game Parlay / Bet Builder）
        </p>
        <p>
          真正的相关性高压区，通常发生在同一场比赛内多市场联动（例如主胜 + 大球 + 球员进球）。这类组合在行业语境里就是
          correlated parlays / same-game parlays，实务上不会直接用独立相乘，而是一定会做相关性定价或限制管理。
        </p>
        <p>
          公开资料里也常见以 Gaussian Copula 作为 SGP 定价思路的说明。虽然多数不是官方模型披露，但足够说明
          “copula 作为方法论”在圈内非常常见。
        </p>
        <p>更稳妥的结论是：</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-stone-400">
          <li>跨比赛：相关性通常较弱，是否建模取决于样本规模与收益增益。</li>
          <li>同场多腿：相关性通常较强，职业机构必然会处理（名称可不同，但机制一定存在）。</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">
          5) 一个可立刻验证“是否存在同天相关”的实用检验
        </p>
        <p>用你现有数据就可以做：</p>
        <p>
          对每场比赛 <span className="font-mono text-[11px]">i</span>（位于同一天{' '}
          <span className="font-mono text-[11px]">d</span>）定义“惊讶值/误差”
        </p>
        <p className="text-center font-serif italic text-[18px] text-stone-500">
          s<sub>i</sub> = result<sub>i</sub> − p<sup>market</sup>
          <sub>i</sub>
        </p>
        <p>（例如 result 取“主胜是否发生”的 0/1）</p>
        <p>
          然后在每个 <span className="font-mono text-[11px]">d</span> 内检验{' '}
          <span className="font-mono text-[11px]">s_i</span> 的相关/方差是否显著大于独立情形。
          若你观察到某些日期全部 <span className="font-mono text-[11px]">s_i</span> 倾向同号（整轮一起热门穿，或一起爆冷），
          往往意味着“同天共同因子/市场误差相关”正在主导，此时引入 copula 或 matchday 因子就有明确价值。
        </p>
      </div>
    </div>

    <p className="mt-3 text-right text-[12px] font-bold text-stone-500">Feb 15, 2026.</p>
  </section>
)

const BayesianRemarks = () => (
  <section className="mt-5 rounded-xl border border-stone-200/70 bg-stone-50/65 px-4 py-3">
    <p className="text-[11px] uppercase tracking-[0.14em] text-stone-400 font-medium">Remarks</p>

    <div className="mt-2 space-y-3 text-[12px] leading-6 text-stone-500">
      <div className="space-y-1.5">
        <ul className="list-disc pl-5 space-y-1 marker:text-stone-400">
          <li>有必要做贝叶斯更新，但不建议“全量替换”现有引擎。</li>
          <li>
            在当前场景下（更看重精度、且认为同天比赛独立），最优不是“纯贝叶斯”或“纯现有算法”，而是 Hybrid：保留现有复合校准主干
            （回归+保序+赔率锚定+团队校准），在稀疏分层（队伍/mode/conf 桶/FID/FSE 桶）上加分层贝叶斯后验与不确定性惩罚。
          </li>
          <li>
            如果二选一只选一个：按当前可见信息利用量，现有算法通常比“纯 Beta-Binomial 桶更新”更准；但在小样本稳定性上贝叶斯更好。
          </li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">我基于代码看到的当前真实算法</p>
        <p>
          现有系统并非“简单频率重算”，而是复合校准管线：Conf→AJR 加权回归、PAV 保序混合、Conf×Odds 分桶偏差修正、球队残差校准、
          与市场隐含概率融合（含 walk-forward 反馈）、以及 MODE/TYS/FID/FSE 的 shrinkage 因子学习。
        </p>
        <p>
          关键实现路径：<span className="font-mono text-[11px]">src/lib/analytics.js:1509</span>（回归校准）、
          <span className="font-mono text-[11px]">:3663</span>（保序回归）、
          <span className="font-mono text-[11px]">:1936</span>（Conf×Odds 校准）、
          <span className="font-mono text-[11px]">:1630</span>（Team 校准）、
          <span className="font-mono text-[11px]">:2187</span>（最终概率融合）。
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">做成贝叶斯后，产品里会产生区别的路径</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-stone-400">
          <li>New：推荐投资额、综合 odds、expected rating 会变化（因概率入口改变）。</li>
          <li>Portfolio：最优组合排名会变化，ev / p / sharpe / utility 全链路重排。</li>
          <li>Monte Carlo：分布会变化，因为采样直接使用 calibratedP。</li>
          <li>Console/Validation：Brier/LogLoss/ROI 回测窗口会变化。</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">在两个前提下的关键判断</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-stone-400">
          <li>不在意全量重算成本时，在线更新速度优势不再是主价值；主价值变为小样本稳健和不确定性可量化。</li>
          <li>
            若认为同天比赛独立，应弱化/关闭同天相关修正，不把 Copula 当优先；与“同场多腿”相关性问题分开处理更科学。
          </li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">哪种更精准：两条路线优劣</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-stone-400">
          <li>纯现有算法：信息利用更全（Conf、Odds、队伍残差、保序非线性、walk-forward）；缺点是低样本桶易抖。</li>
          <li>纯贝叶斯桶更新：小样本稳且自带可信区间；缺点是若只做桶级会丢结构信息，容易欠拟合。</li>
          <li>Hybrid：在“稳定性 + 解释性 + 可控风险”上通常是产品最优折中。</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">建议采用的贝叶斯形态（精度优先版）</p>
        <ul className="list-disc pl-5 space-y-1 marker:text-stone-400">
          <li>不做“只按 conf 三档”的简化版，改做分层贝叶斯：team × mode × conf 桶 × odds 桶（支持部分池化）。</li>
          <li>输出不仅有 p_hat，还要有 uncertainty（后验方差/置信区间）。</li>
          <li>组合优化与 Kelly 使用保守概率：p_used = p_hat - z * sigma_post（z 按风险偏好调节）。</li>
          <li>持续全量 walk-forward 对照 Brier/LogLoss/ROI/top-k 命中，连续无提升则自动回退。</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="font-medium text-stone-500">一句话决策</p>
        <p>
          对当前应用，贝叶斯更新值得做，但应作为增强层而不是替代层；优先引入分层后验与不确定性折扣，让 New 的投资建议和
          Portfolio 的最优组合排序在小样本阶段更稳健。
        </p>
      </div>
    </div>

    <p className="mt-3 text-right text-[12px] font-bold text-stone-500">Feb 16, 2026.</p>
  </section>
)

const FutureFeaturesExplorer = () => {
  const [activePointId, setActivePointId] = useState(null)
  const detailScrollRef = useRef(null)
  const pointRows = useMemo(
    () =>
      [...(Array.isArray(FUTURE_FEATURE_POINTS) ? FUTURE_FEATURE_POINTS : [])].sort(
        (a, b) => Number(a?.id || 0) - Number(b?.id || 0),
      ),
    [],
  )

  const activePoint = useMemo(
    () => pointRows.find((row) => String(row.id) === String(activePointId)) || null,
    [pointRows, activePointId],
  )

  useEffect(() => {
    if (detailScrollRef.current) {
      detailScrollRef.current.scrollTop = 0
    }
  }, [activePointId])

  return (
    <div className="relative h-[72vh] overflow-hidden rounded-2xl border border-sky-200/80 bg-gradient-to-br from-sky-50/90 via-white/90 to-cyan-50/80 shadow-[0_24px_56px_rgba(14,165,233,0.16),inset_0_1px_0_rgba(255,255,255,0.92)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_90%_at_15%_0%,rgba(125,211,252,0.35),rgba(255,255,255,0))]" />
      <div className="relative h-full overflow-hidden">
        <div
          className="flex h-full w-[200%] transition-transform duration-500 ease-out"
          style={{ transform: `translateX(${activePointId ? '-50%' : '0%'})` }}
        >
          <section className="w-1/2 h-full p-4 sm:p-5">
            <div className="h-full rounded-2xl border border-sky-200/70 bg-white/72 backdrop-blur-xl px-4 py-4 sm:px-5 sm:py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] overflow-y-auto custom-scrollbar">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-sky-600 font-medium">Concept Preview</p>
                  <h4 className="text-lg font-semibold text-stone-800 mt-1">高级 AI/ML 赋能方向总览</h4>
                </div>
                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-100/70 px-2.5 py-1 text-[11px] text-sky-700 font-medium">
                  BETA
                </span>
              </div>

              <p className="text-[12px] text-stone-500 mt-2">
                源文档：{FUTURE_FEATURE_DETAIL_SOURCE.overview}
              </p>

              <div className="mt-4 rounded-xl border border-sky-100 bg-gradient-to-br from-white/85 to-sky-50/55 px-4 py-3">
                <LongFormDocument text={FUTURE_FEATURE_OVERVIEW_TEXT} keyPrefix="future-overview" />
              </div>

              <div className="mt-4 pr-1 pb-2 space-y-2.5">
                {pointRows.map((point) => (
                  <button
                    key={point.id}
                    type="button"
                    onClick={() => setActivePointId(point.id)}
                    className="w-full rounded-xl border border-sky-100 bg-white/80 hover:bg-sky-50/80 hover:border-sky-200 transition-all px-3.5 py-3 text-left group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-md bg-sky-100 text-sky-700 text-[11px] px-1.5 py-0.5 font-medium">
                            {point.tier}
                          </span>
                          <span className="text-sm font-semibold text-stone-800">{point.title}</span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-6 text-stone-600">{point.shortIntro}</p>
                      </div>
                      <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-600 group-hover:translate-x-0.5 transition-transform">
                        <ChevronRight size={14} />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="w-1/2 h-full p-4 sm:p-5">
            <div
              ref={detailScrollRef}
              className="h-full rounded-2xl border border-sky-200/70 bg-white/80 backdrop-blur-xl px-4 py-4 sm:px-5 sm:py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] overflow-y-auto custom-scrollbar"
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setActivePointId(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50/80 text-sky-700 text-xs px-2.5 py-1.5 hover:bg-sky-100 transition-colors"
                >
                  <ArrowLeft size={13} />
                  返回总览
                </button>
                <span className="text-[11px] uppercase tracking-[0.12em] text-sky-500">
                  {activePoint?.tier || 'Detail'}
                </span>
              </div>

              <h4 className="mt-3 text-lg font-semibold text-stone-800">
                {activePoint?.title || '请选择一个方向查看详情'}
              </h4>
              <p className="mt-1.5 text-[12px] leading-6 text-stone-600">
                {activePoint?.shortIntro || '选择左侧任一方向后，这里会显示完整研究内容与赋能科普。'}
              </p>
              <p className="text-[11px] text-stone-400 mt-2">{FUTURE_FEATURE_DETAIL_SOURCE.details}</p>

              <div className="mt-4 pr-1 pb-2">
                {activePoint ? (
                  <>
                    <LongFormDocument
                      text={FUTURE_FEATURE_DETAIL_TEXT[String(activePoint.id)] || ''}
                      keyPrefix={`future-detail-${activePoint.id}`}
                    />
                    {String(activePoint.id) === '2' ? <BayesianRemarks /> : null}
                    {String(activePoint.id) === '4' ? <CopulaRemarks /> : null}
                  </>
                ) : (
                  <div className="min-h-[220px] rounded-xl border border-dashed border-sky-200 bg-sky-50/40 flex items-center justify-center text-sm text-sky-600">
                    请选择左侧任一进阶方向
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

const normalizeBackupCadence = (value) => {
  const key = String(value || '').trim()
  return Object.prototype.hasOwnProperty.call(BACKUP_CADENCE_HOURS, key) ? key : 'half_week'
}

const formatDateTime = (value) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString()
}

const toSigned = (value, digits = 2, suffix = '') => {
  const num = Number(value || 0)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(digits)}${suffix}`
}

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value
  const normalized = String(value || '').trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return null
}

const parseNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const formatAccessTime = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

const getAccessMonthKey = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const formatAccessMonthLabel = (monthKey) => {
  if (!monthKey) return '--'
  const [year, month] = String(monthKey).split('-')
  const monthNum = Number(month)
  if (!year || !Number.isFinite(monthNum)) return '--'
  return `${year}年${monthNum}月`
}

const parseAccessMonthKey = (monthKey) => {
  const [year, month] = String(monthKey || '').split('-')
  const parsedYear = Number(year)
  const parsedMonth = Number(month)
  if (!Number.isFinite(parsedYear) || !Number.isFinite(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) return null
  return new Date(parsedYear, parsedMonth - 1, 1)
}

const toSessionTail = (value) => {
  const text = String(value || '')
  if (!text) return '--'
  return text.length <= 10 ? text : text.slice(-10)
}

const getAccessRowDurationKey = (row) =>
  [String(row?.id || ''), String(row?.session_id || ''), String(row?.created_at || ''), String(row?.route || '')].join('|')

const formatSessionDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '00:00'
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const parseEntriesJson = (value, entryText = '', oddsValue) => {
  const fallbackOdds = parseNumber(oddsValue, Number.NaN)

  if (value) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => normalizeEntryRecord(entry, fallbackOdds))
      }
    } catch {
      // fall through
    }
  }

  try {
    const parsed = JSON.parse(entryText)
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => normalizeEntryRecord(entry, fallbackOdds))
    }
  } catch {
    // fall through
  }

  const rawText = String(entryText || '').trim()
  if (!rawText) return []
  return rawText
    .split(/[|,]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((name) => normalizeEntryRecord({ name, odds: fallbackOdds }, fallbackOdds))
}

const buildExcelWorkbook = (bundle) => {
  const investments = Array.isArray(bundle?.investments) ? bundle.investments : []
  const teamProfiles = Array.isArray(bundle?.team_profiles) ? bundle.team_profiles : []
  const systemConfig = bundle?.system_config || {}

  const investmentRows = investments.map((item) => ({
    id: item.id,
    created_at: item.created_at,
    parlay_size: item.parlay_size,
    combo_name: item.combo_name,
    inputs: item.inputs,
    suggested_amount: item.suggested_amount,
    expected_rating: item.expected_rating,
    combined_odds: item.combined_odds,
    status: item.status,
    revenues: item.revenues,
    profit: item.profit,
    actual_rating: item.actual_rating,
    rep: item.rep,
    remarks: item.remarks,
    is_archived: item.is_archived ? 'true' : 'false',
  }))

  const matchRows = investments.flatMap((item) =>
    (item.matches || []).map((match, idx) => ({
      investment_id: item.id,
      match_index: idx + 1,
      id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      entry_text: match.entry_text,
      entry_market_type: match.entry_market_type,
      entry_market_label: match.entry_market_label,
      entry_semantic_key: match.entry_semantic_key,
      entries_json: JSON.stringify(match.entries || []),
      odds: match.odds,
      conf: match.conf,
      mode: match.mode,
      tys_home: match.tys_home,
      tys_away: match.tys_away,
      fid: match.fid,
      fse_home: match.fse_home,
      fse_away: match.fse_away,
      fse_match: match.fse_match,
      results: match.results,
      is_correct: typeof match.is_correct === 'boolean' ? String(match.is_correct) : '',
      match_rating: match.match_rating,
      match_rep: match.match_rep,
      note: match.note,
      post_note: match.post_note,
    })),
  )

  const teamRows = teamProfiles.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    abbreviations: Array.isArray(team.abbreviations) ? team.abbreviations.join('|') : '',
    totalSamples: team.totalSamples,
    avgRep: team.avgRep,
  }))

  const configRows = Object.entries(systemConfig).map(([key, value]) => ({
    key,
    value,
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(investmentRows), 'Investments')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(matchRows), 'Matches')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(teamRows), 'TeamProfiles')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(configRows), 'SystemConfig')
  return workbook
}

const parseExcelFile = async (file) => {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const getSheet = (name) => workbook.Sheets[name]
  const sheetToJson = (sheet) => (sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [])

  const investmentRows = sheetToJson(getSheet('Investments'))
  const matchRows = sheetToJson(getSheet('Matches'))
  const teamRows = sheetToJson(getSheet('TeamProfiles'))
  const configRows = sheetToJson(getSheet('SystemConfig'))

  if (!investmentRows.length || !matchRows.length) {
    return { error: '未检测到 Investments 或 Matches 表，请确认 Excel 模板正确。' }
  }

  const teamProfiles = teamRows.map((row) => ({
    teamId: row.teamId || row.team_id || '',
    teamName: row.teamName || row.team_name || '',
    abbreviations: String(row.abbreviations || '')
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean),
    totalSamples: parseNumber(row.totalSamples ?? row.total_samples, 0),
    avgRep: parseNumber(row.avgRep ?? row.avg_rep, 0.5),
  }))

  const system_config = configRows.reduce((acc, row) => {
    const key = String(row.key || row.field || '').trim()
    if (!key) return acc
    acc[key] = parseNumber(row.value, row.value)
    return acc
  }, {})

  const matchMap = new Map()
  matchRows.forEach((row) => {
    const investmentId = String(row.investment_id || row.investmentId || row.investment || '').trim()
    if (!investmentId) return
    const entries = parseEntriesJson(row.entries_json, row.entry_text || row.entry || '', row.odds)
    const entryMarket = getPrimaryEntryMarket(entries, row.entry_text || row.entry || '')
    const match = {
      id: row.id || '',
      home_team: row.home_team || row.homeTeam || '',
      away_team: row.away_team || row.awayTeam || '',
      entry_text: row.entry_text || row.entry || '',
      entries,
      entry_market_type: row.entry_market_type || entryMarket.marketType,
      entry_market_label: row.entry_market_label || entryMarket.marketLabel,
      entry_semantic_key: row.entry_semantic_key || entryMarket.semanticKey,
      odds: parseNumber(row.odds, 0),
      conf: parseNumber(row.conf, 0),
      mode: row.mode || '常规',
      tys_home: row.tys_home || 'M',
      tys_away: row.tys_away || 'M',
      fid: parseNumber(row.fid, 0.4),
      fse_home: parseNumber(row.fse_home, 0.5),
      fse_away: parseNumber(row.fse_away, 0.5),
      fse_match: parseNumber(row.fse_match, 0),
      results: row.results || '',
      is_correct: parseBoolean(row.is_correct),
      match_rating: parseNumber(row.match_rating, NaN),
      match_rep: parseNumber(row.match_rep, NaN),
      note: row.note || '',
      post_note: row.post_note || '',
    }
    const list = matchMap.get(investmentId) || []
    list.push({
      match_index: parseNumber(row.match_index, list.length + 1),
      ...match,
    })
    matchMap.set(investmentId, list)
  })

  const investments = investmentRows.map((row) => {
    const id = String(row.id || '').trim()
    const matches = (matchMap.get(id) || []).sort((a, b) => a.match_index - b.match_index).map((item) => {
      const { match_index: _matchIndex, ...match } = item
      return match
    })
    return {
      id: id || `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: row.created_at || new Date().toISOString(),
      parlay_size: parseNumber(row.parlay_size, matches.length || 1),
      combo_name: row.combo_name || '',
      inputs: parseNumber(row.inputs, 0),
      suggested_amount: parseNumber(row.suggested_amount, 0),
      expected_rating: parseNumber(row.expected_rating, NaN),
      combined_odds: parseNumber(row.combined_odds, 0),
      status: row.status || 'pending',
      revenues: parseNumber(row.revenues, NaN),
      profit: parseNumber(row.profit, NaN),
      actual_rating: parseNumber(row.actual_rating, NaN),
      rep: parseNumber(row.rep, NaN),
      remarks: row.remarks || '',
      is_archived: parseBoolean(row.is_archived),
      matches,
    }
  })

  return {
    bundle: {
      version: 1,
      exported_at: new Date().toISOString(),
      system_config,
      team_profiles: teamProfiles,
      investments,
    },
    preview: {
      investmentCount: investments.length,
      matchCount: matchRows.length,
      teamCount: teamProfiles.length,
      sampleInvestments: investments.slice(0, 3),
      sampleMatches: matchRows.slice(0, 3),
    },
  }
}

const buildHistory = (values, size = 5) => {
  if (!values || values.length === 0) return Array.from({ length: size }, () => 1)
  if (values.length <= size) return values
  const windowSize = Math.ceil(values.length / size)
  const output = []
  for (let i = 0; i < values.length; i += windowSize) {
    const chunk = values.slice(i, i + windowSize)
    output.push(chunk.reduce((sum, value) => sum + value, 0) / chunk.length)
  }
  return output.slice(-size)
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const avg = (values) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 1)

const avgPointValues = (points) => avg((points || []).map((point) => Number(point?.value)).filter((value) => Number.isFinite(value)))

const normalizeAdjustment = (value) => {
  if (!Number.isFinite(value) || value <= 0) return null
  return clamp(value, 0.6, 1.4)
}

const normalizeWeight = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return clamp(parsed, 0.01, 1.5)
}

const getClosestFidBaseline = (fidValue) => {
  if (!Number.isFinite(fidValue)) return null
  const keys = Object.keys(FID_BASE_FACTORS).map((key) => Number(key))
  const closest = keys.reduce((best, current) =>
    Math.abs(current - fidValue) < Math.abs(best - fidValue) ? current : best,
  )
  return FID_BASE_FACTORS[String(closest)] || null
}

const normalizeModeValue = (value) => {
  const base = String(value || '').trim()
  if (!base) return '常规'
  return MODE_ALIAS[base] || base
}

const getOddsBucketByHalf = (odds) => {
  if (!Number.isFinite(odds) || odds <= 0) return 'unknown'
  if (odds >= 4) return '4.0+'
  const start = Math.floor((odds - 1) / 0.5) * 0.5 + 1
  const end = start + 0.5
  return `${start.toFixed(1)}-${end.toFixed(1)}`
}

const toDateLabel = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}/${day}`
}

const buildFactorRangeRows = (rawSeries, fallbackValue, rangeKey, nowMs = Date.now()) => {
  const config = FACTOR_RANGE_CONFIG[rangeKey] || FACTOR_RANGE_CONFIG['4w']
  const points = Array.isArray(rawSeries)
    ? rawSeries
        .map((item) => {
          const value = Number(item?.value)
          const ts = new Date(item?.createdAt || '').getTime()
          if (!Number.isFinite(value) || !Number.isFinite(ts)) return null
          return { value, ts }
        })
        .filter(Boolean)
        .sort((a, b) => a.ts - b.ts)
    : []

  if (points.length === 0) return []

  const rangePoints =
    Number.isFinite(config.days) && config.days > 0
      ? points.filter((point) => point.ts >= nowMs - config.days * 24 * 60 * 60 * 1000 && point.ts <= nowMs)
      : points

  if (rangePoints.length === 0) return []

  const bucketCount = Math.max(1, Math.min(config.buckets || rangePoints.length, rangePoints.length))
  const startTs = rangePoints[0].ts
  const endTs = rangePoints[rangePoints.length - 1].ts
  const span = Math.max(1, endTs - startTs + 1)
  const buckets = Array.from({ length: bucketCount }, () => [])

  rangePoints.forEach((point) => {
    const index = Math.min(bucketCount - 1, Math.floor(((point.ts - startTs) / span) * bucketCount))
    buckets[index].push(point)
  })

  const rows = buckets
    .filter((bucket) => bucket.length > 0)
    .map((bucket) => {
      const firstTs = bucket[0].ts
      const lastTs = bucket[bucket.length - 1].ts
      const startLabel = toDateLabel(firstTs)
      const endLabel = toDateLabel(lastTs)
      const value = bucket.reduce((sum, item) => sum + item.value, 0) / bucket.length
      return {
        period: startLabel === endLabel ? startLabel : `${startLabel}~${endLabel}`,
        value: Number(value.toFixed(2)),
        samples: bucket.length,
      }
    })

  if (rows.length === 0) {
    return [
      {
        period: '--',
        value: Number((fallbackValue || 1).toFixed(2)),
        samples: 0,
        delta: null,
      },
    ]
  }

  return rows.map((row, index) => ({
    ...row,
    delta: index === 0 ? null : Number((row.value - rows[index - 1].value).toFixed(2)),
  }))
}

const collectMatchAdjustments = (settledInvestments) => {
  const sorted = [...settledInvestments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const confPoints = []
  const tysPoints = []
  const fidPoints = []
  const fsePoints = []

  sorted.forEach((item) => {
    const createdAt = item.created_at
    ;(item.matches || []).forEach((match) => {
      const conf = Number(match.conf)
      const actual = normalizeAjrForModel(match.match_rating, Number.NaN)
      if (!Number.isFinite(conf) || !Number.isFinite(actual) || conf <= 0) return
      const confRatio = normalizeAdjustment(actual / conf)
      if (!confRatio) return
      confPoints.push({ value: confRatio, createdAt })

      const tysHome = String(match.tys_home || '').trim().toUpperCase()
      const tysAway = String(match.tys_away || '').trim().toUpperCase()
      const homeBase = TYS_BASE_FACTORS[tysHome]
      const awayBase = TYS_BASE_FACTORS[tysAway]
      if (homeBase && awayBase) {
        const tysBaseline = Math.sqrt(homeBase * awayBase)
        const tysRatio = normalizeAdjustment(confRatio / tysBaseline)
        if (tysRatio) tysPoints.push({ value: tysRatio, createdAt })
      }

      const fidBaseline = getClosestFidBaseline(Number(match.fid))
      if (fidBaseline) {
        const fidRatio = normalizeAdjustment(confRatio / fidBaseline)
        if (fidRatio) fidPoints.push({ value: fidRatio, createdAt })
      }

      const fseHome = clamp(Number(match.fse_home), 0.05, 1)
      const fseAway = clamp(Number(match.fse_away), 0.05, 1)
      if (Number.isFinite(fseHome) && Number.isFinite(fseAway)) {
        const fseMatch = Math.sqrt(fseHome * fseAway)
        const fseBaseline = 0.88 + fseMatch * 0.24
        const fseRatio = normalizeAdjustment(confRatio / fseBaseline)
        if (fseRatio) fsePoints.push({ value: fseRatio, createdAt })
      }
    })
  })

  return { confPoints, tysPoints, fidPoints, fsePoints }
}

const collectModeAndOddsPoints = (settledInvestments, modeKellyRows, kellyMatrix) => {
  const sorted = [...settledInvestments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const modePoints = []
  const oddsPoints = []

  const modeDivisorMap = new Map(
    (modeKellyRows || [])
      .filter((row) => Number.isFinite(row?.kellyDivisor) && row.kellyDivisor > 0)
      .map((row) => [normalizeModeValue(row.mode), row.kellyDivisor]),
  )

  const oddsAccumulator = new Map()
  ;(kellyMatrix || []).forEach((row) => {
    const bucket = String(row?.oddsBucket || '').trim()
    const divisor = Number(row?.kellyDivisor)
    const samples = Number(row?.samples)
    if (!bucket || !Number.isFinite(divisor) || divisor <= 0 || !Number.isFinite(samples) || samples <= 0) return
    const previous = oddsAccumulator.get(bucket) || { weightedDivisor: 0, samples: 0 }
    oddsAccumulator.set(bucket, {
      weightedDivisor: previous.weightedDivisor + divisor * samples,
      samples: previous.samples + samples,
    })
  })

  const oddsDivisorMap = new Map(
    [...oddsAccumulator.entries()]
      .filter(([, value]) => value.samples > 0)
      .map(([bucket, value]) => [bucket, value.weightedDivisor / value.samples]),
  )

  sorted.forEach((item) => {
    const createdAt = item.created_at
    ;(item.matches || []).forEach((match) => {
      const mode = normalizeModeValue(match.mode)
      const modeDivisor = Number(modeDivisorMap.get(mode))
      if (Number.isFinite(modeDivisor) && modeDivisor > 0) {
        modePoints.push({
          value: clamp(4 / modeDivisor, 0.6, 1.4),
          createdAt,
        })
      }

      const odds = Number(match.odds)
      const oddsBucket = getOddsBucketByHalf(odds)
      const oddsDivisor = Number(oddsDivisorMap.get(oddsBucket))
      if (Number.isFinite(oddsDivisor) && oddsDivisor > 0) {
        oddsPoints.push({
          value: clamp(4 / oddsDivisor, 0.6, 1.4),
          createdAt,
        })
      }
    })
  })

  return { modePoints, oddsPoints }
}

const PaginatedKellyMatrixTable = ({ rows }) => {
  const [modeFilter, setModeFilter] = useState('all')
  const [confFilter, setConfFilter] = useState('all')
  const [oddsFilter, setOddsFilter] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 24

  const modeOptions = useMemo(() => [...new Set((rows || []).map((row) => row.mode).filter(Boolean))], [rows])
  const confOptions = useMemo(() => [...new Set((rows || []).map((row) => row.confBucket).filter(Boolean))], [rows])
  const oddsOptions = useMemo(() => [...new Set((rows || []).map((row) => row.oddsBucket).filter(Boolean))], [rows])

  const filteredRows = useMemo(() => {
    const source = Array.isArray(rows) ? rows : []
    return source
      .filter((row) => (modeFilter === 'all' ? true : row.mode === modeFilter))
      .filter((row) => (confFilter === 'all' ? true : row.confBucket === confFilter))
      .filter((row) => (oddsFilter === 'all' ? true : row.oddsBucket === oddsFilter))
      .sort((a, b) => b.samples - a.samples || b.roi - a.roi)
  }, [confFilter, modeFilter, oddsFilter, rows])

  useEffect(() => {
    setPage(1)
  }, [modeFilter, confFilter, oddsFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={modeFilter}
            onChange={(event) => setModeFilter(event.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs border border-stone-200 bg-white text-stone-600"
          >
            <option value="all">全部 Mode</option>
            {modeOptions.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
          <select
            value={confFilter}
            onChange={(event) => setConfFilter(event.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs border border-stone-200 bg-white text-stone-600"
          >
            <option value="all">全部 Conf 区间</option>
            {confOptions.map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket}
              </option>
            ))}
          </select>
          <select
            value={oddsFilter}
            onChange={(event) => setOddsFilter(event.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs border border-stone-200 bg-white text-stone-600"
          >
            <option value="all">全部 Odds 区间</option>
            {oddsOptions.map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-stone-400">
          {filteredRows.length} 条组合 · 第 {currentPage}/{totalPages} 页
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left text-stone-500">
            <th className="py-2">Mode</th>
            <th className="py-2">Conf 区间</th>
            <th className="py-2">Odds 区间</th>
            <th className="py-2">样本</th>
            <th className="py-2">ROI</th>
            <th className="py-2">Kelly 分母</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr key={`${row.mode}-${row.confBucket}-${row.oddsBucket}`} className="border-b border-stone-100">
              <td className="py-2">{row.mode}</td>
              <td className="py-2">{row.confBucket}</td>
              <td className="py-2">{row.oddsBucket}</td>
              <td className="py-2">{row.samples}</td>
              <td className={`py-2 ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{toSigned(row.roi, 1, '%')}</td>
              <td className="py-2 font-semibold text-amber-600">{row.kellyDivisor.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {filteredRows.length === 0 && <p className="text-xs text-stone-400">当前筛选条件下暂无可展示组合。</p>}

      {filteredRows.length > pageSize && (
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className={`px-3 py-1.5 rounded-lg text-xs ${
              currentPage === 1 ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'
            }`}
          >
            ← 上一页
          </button>
          <button
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className={`px-3 py-1.5 rounded-lg text-xs ${
              currentPage === totalPages ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'
            }`}
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 自适应权重优化卡片组件
// ============================================================================

const WEIGHT_LABELS = {
  weightConf: { label: 'Conf', hint: '置信度权重' },
  weightMode: { label: 'Mode', hint: '模式权重' },
  weightTys: { label: 'TYS', hint: 'TYS权重' },
  weightFid: { label: 'FID', hint: 'FID权重' },
  weightOdds: { label: 'Odds', hint: '赔率权重' },
  weightFse: { label: 'FSE', hint: 'FSE权重' },
}

const DEFAULT_BOUNDS = {
  weightConf: [0.25, 0.65],
  weightMode: [0.08, 0.28],
  weightTys: [0.05, 0.22],
  weightFid: [0.06, 0.24],
  weightOdds: [0.02, 0.12],
  weightFse: [0.03, 0.15],
}

const DEFAULT_PRIORS = {
  weightConf: 0.45,
  weightMode: 0.16,
  weightTys: 0.12,
  weightFid: 0.14,
  weightOdds: 0.06,
  weightFse: 0.07,
}

function AdaptiveWeightCard({ config, setConfig, saveSystemConfig, dataVersion }) {
  const [showBoundsEditor, setShowBoundsEditor] = useState(false)
  const [editingWeight, setEditingWeight] = useState(null)
  const [tempWeightValue, setTempWeightValue] = useState('')
  const [tempBounds, setTempBounds] = useState({})
  const [applyStatus, setApplyStatus] = useState('')

  const suggestions = useMemo(() => computeAdaptiveWeightSuggestions(), [dataVersion, config])

  const adaptiveConfig = config.adaptiveWeights || {}
  const bounds = adaptiveConfig.bounds || DEFAULT_BOUNDS
  const immutablePriors = adaptiveConfig.initialPriors || DEFAULT_PRIORS

  // 初始化 tempBounds
  useEffect(() => {
    if (showBoundsEditor && Object.keys(tempBounds).length === 0) {
      setTempBounds(JSON.parse(JSON.stringify(bounds)))
    }
  }, [showBoundsEditor, bounds, tempBounds])

  // 兼容历史版本：如果初始先验不存在，则用默认创世值回填并锁定。
  useEffect(() => {
    const hasInitialPriors =
      adaptiveConfig.initialPriors &&
      Object.keys(DEFAULT_PRIORS).every((key) => {
        const value = Number(adaptiveConfig.initialPriors[key])
        return Number.isFinite(value)
      })
    if (hasInitialPriors) return

    const repairedAdaptiveConfig = {
      ...adaptiveConfig,
      initialPriors: { ...DEFAULT_PRIORS },
      priors: { ...DEFAULT_PRIORS },
    }
    const newConfig = { ...config, adaptiveWeights: repairedAdaptiveConfig }
    setConfig(newConfig)
    saveSystemConfig(newConfig)
  }, [adaptiveConfig, config, saveSystemConfig, setConfig])

  const handleApplySuggestion = (key, value) => {
    const newConfig = { ...config, [key]: value }
    const newAdaptive = {
      ...adaptiveConfig,
      initialPriors: { ...immutablePriors },
      priors: { ...immutablePriors },
      lastUpdateAt: new Date().toISOString(),
      updateCount: (adaptiveConfig.updateCount || 0) + 1,
    }
    newConfig.adaptiveWeights = newAdaptive
    setConfig(newConfig)
    saveSystemConfig(newConfig)
    setApplyStatus(`${WEIGHT_LABELS[key]?.label || key} 已更新`)
    setTimeout(() => setApplyStatus(''), 1500)
  }

  const handleApplyAllSuggestions = () => {
    const newConfig = { ...config }
    suggestions.suggestions.forEach((s) => {
      if (s.confidence >= 0.5 && Math.abs(s.change) > 0.001) {
        newConfig[s.key] = s.suggested
      }
    })
    newConfig.adaptiveWeights = {
      ...adaptiveConfig,
      initialPriors: { ...immutablePriors },
      priors: { ...immutablePriors },
      lastUpdateAt: new Date().toISOString(),
      updateCount: (adaptiveConfig.updateCount || 0) + 1,
    }
    setConfig(newConfig)
    saveSystemConfig(newConfig)
    setApplyStatus('全部建议已应用')
    setTimeout(() => setApplyStatus(''), 1500)
  }

  const handleManualWeightChange = (key) => {
    const value = parseFloat(tempWeightValue)
    if (!Number.isFinite(value)) return
    const [minB, maxB] = bounds[key] || DEFAULT_BOUNDS[key]
    const clamped = Math.max(minB, Math.min(maxB, value))
    handleApplySuggestion(key, Number(clamped.toFixed(4)))
    setEditingWeight(null)
    setTempWeightValue('')
  }

  const handleSaveBounds = () => {
    const newConfig = {
      ...config,
      adaptiveWeights: {
        ...adaptiveConfig,
        bounds: tempBounds,
      },
    }
    setConfig(newConfig)
    saveSystemConfig(newConfig)
    setShowBoundsEditor(false)
    setApplyStatus('边界已保存')
    setTimeout(() => setApplyStatus(''), 1500)
  }

  const handleResetToDefaults = () => {
    if (!window.confirm('确定要重置所有权重到初始默认值吗？')) return
    const newConfig = { ...config }
    Object.keys(DEFAULT_PRIORS).forEach((key) => {
      newConfig[key] = DEFAULT_PRIORS[key]
    })
    newConfig.adaptiveWeights = {
      ...adaptiveConfig,
      initialPriors: { ...DEFAULT_PRIORS },
      priors: { ...DEFAULT_PRIORS },
      bounds: { ...DEFAULT_BOUNDS },
      updateCount: 0,
      lastUpdateAt: '',
    }
    setConfig(newConfig)
    saveSystemConfig(newConfig)
    setApplyStatus('已重置为默认值')
    setTimeout(() => setApplyStatus(''), 1500)
  }

  return (
    <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            自适应权重优化
          </h3>
          <span className="px-2 py-0.5 text-[10px] font-medium bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-full">
            BETA
          </span>
        </div>
        <div className="flex items-center gap-2">
          {applyStatus && <span className="text-xs text-emerald-600">{applyStatus}</span>}
          <button
            onClick={() => setShowBoundsEditor(!showBoundsEditor)}
            className="text-xs text-stone-500 hover:text-amber-600 px-2 py-1 rounded hover:bg-amber-50 transition-colors"
          >
            {showBoundsEditor ? '收起设置' : '边界设置'}
          </button>
        </div>
      </div>

      <p className="text-xs text-stone-500 mb-4">
        基于在线梯度下降算法，根据历史表现自动计算权重调整建议。样本量: {suggestions.sampleCount} / {suggestions.minSamples} 最小
        {suggestions.lastUpdateAt && <span className="ml-2">· 上次更新: {new Date(suggestions.lastUpdateAt).toLocaleDateString()}</span>}
        {suggestions.updateCount > 0 && <span className="ml-2">· 累计调整: {suggestions.updateCount} 次</span>}
      </p>

      {!suggestions.ready ? (
        <div className="p-4 bg-stone-50 rounded-xl text-center">
          <p className="text-sm text-stone-500">样本量不足 ({suggestions.sampleCount}/{suggestions.minSamples})</p>
          <p className="text-xs text-stone-400 mt-1">完成更多结算后将自动生成建议</p>
        </div>
      ) : (
        <>
          {/* 权重表格 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2 px-2">参数</th>
                  <th className="py-2 px-2">初始值</th>
                  <th className="py-2 px-2">当前值 <span className="text-[10px] text-emerald-500 font-normal ml-1">可编辑</span></th>
                  <th className="py-2 px-2">建议值</th>
                  <th className="py-2 px-2">置信度</th>
                  <th className="py-2 px-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.suggestions.map((row) => {
                  const isEditing = editingWeight === row.key
                  const hasChange = Math.abs(row.change) > 0.001
                  const highConfidence = row.confidence >= 0.5

                  return (
                    <tr key={row.key} className="border-b border-stone-100 hover:bg-stone-50/50">
                      <td className="py-2 px-2">
                        <span className="font-medium">{WEIGHT_LABELS[row.key]?.label || row.label}</span>
                        <span className="text-[10px] text-stone-400 ml-1">({WEIGHT_LABELS[row.key]?.hint})</span>
                      </td>
                      <td className="py-2 px-2 text-stone-400">{row.prior.toFixed(2)}</td>
                      <td className="py-2 px-2">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              value={tempWeightValue}
                              onChange={(e) => setTempWeightValue(e.target.value)}
                              className="w-16 px-2 py-1 text-xs border border-amber-300 rounded"
                              autoFocus
                            />
                            <button
                              onClick={() => handleManualWeightChange(row.key)}
                              className="px-2 py-1 text-[10px] bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => {
                                setEditingWeight(null)
                                setTempWeightValue('')
                              }}
                              className="px-2 py-1 text-[10px] text-stone-500 hover:text-stone-700"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <span
                            className="cursor-pointer hover:text-amber-600"
                            onClick={() => {
                              setEditingWeight(row.key)
                              setTempWeightValue(row.current.toString())
                            }}
                          >
                            {row.current.toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <span className={hasChange ? (row.change > 0 ? 'text-emerald-600' : 'text-rose-500') : 'text-stone-400'}>
                          {row.suggested.toFixed(2)}
                        </span>
                        {hasChange && (
                          <span className={`ml-1 text-[10px] ${row.change > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            ({row.change > 0 ? '+' : ''}{row.change.toFixed(3)})
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1">
                          <div className="w-12 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${row.confidence >= 0.7 ? 'bg-emerald-500' : row.confidence >= 0.5 ? 'bg-amber-500' : 'bg-stone-400'}`}
                              style={{ width: `${row.confidence * 100}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-stone-400">{(row.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        {hasChange && highConfidence && (
                          <button
                            onClick={() => handleApplySuggestion(row.key, row.suggested)}
                            className="px-2 py-1 text-[10px] bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors"
                          >
                            应用
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 操作按钮 */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={handleApplyAllSuggestions}
                className="px-3 py-1.5 text-xs bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 transition-colors"
              >
                应用全部建议
              </button>
              <button
                onClick={handleResetToDefaults}
                className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
              >
                重置为默认值
              </button>
            </div>
            <p className="text-[10px] text-stone-400">置信度 ≥ 50% 的建议可被应用</p>
          </div>
        </>
      )}

      {/* 边界设置面板 */}
      {showBoundsEditor && (
        <div className="mt-4 p-4 bg-stone-50 rounded-xl border border-stone-200">
          <h4 className="text-sm font-medium text-stone-700 mb-3">参数边界设置</h4>
          <p className="text-xs text-stone-500 mb-3">设置每个参数的允许范围，防止自动优化时偏离太远</p>
          <div className="grid grid-cols-3 gap-3">
            {Object.keys(WEIGHT_LABELS).map((key) => {
              const [minB, maxB] = tempBounds[key] || bounds[key] || DEFAULT_BOUNDS[key]
              return (
                <div key={key} className="p-2 bg-white rounded-lg border border-stone-200">
                  <span className="text-xs font-medium text-stone-600">{WEIGHT_LABELS[key].label}</span>
                  <div className="flex items-center gap-1 mt-1">
                    <input
                      type="number"
                      step="0.01"
                      value={minB}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0
                        setTempBounds((prev) => ({ ...prev, [key]: [val, prev[key]?.[1] || maxB] }))
                      }}
                      className="w-14 px-1 py-0.5 text-xs border border-stone-200 rounded text-center"
                    />
                    <span className="text-stone-400">~</span>
                    <input
                      type="number"
                      step="0.01"
                      value={maxB}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 1
                        setTempBounds((prev) => ({ ...prev, [key]: [prev[key]?.[0] || minB, val] }))
                      }}
                      className="w-14 px-1 py-0.5 text-xs border border-stone-200 rounded text-center"
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setShowBoundsEditor(false)}
              className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700"
            >
              取消
            </button>
            <button
              onClick={handleSaveBounds}
              className="px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors"
            >
              保存边界
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ParamsPage({ openModal }) {
  const [expandedFactor, setExpandedFactor] = useState(null)
  const [factorRange, setFactorRange] = useState('4w')
  const [config, setConfig] = useState(() => getSystemConfig())
  const [saveStatus, setSaveStatus] = useState('')
  const [excelStatus, setExcelStatus] = useState('')
  const [excelPreview, setExcelPreview] = useState(null)
  const [excelError, setExcelError] = useState('')
  const [syncStatus, setSyncStatus] = useState(() => getCloudSyncStatus())
  const [syncingNow, setSyncingNow] = useState(false)
  const [pullingCloud, setPullingCloud] = useState(false)
  const [cloudPullStatus, setCloudPullStatus] = useState('')
  const [dataVersion, setDataVersion] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [pendingKellyAdjustment, setPendingKellyAdjustment] = useState(null)
  const [showAllKellyRows, setShowAllKellyRows] = useState(false)
  const [analyticsData, setAnalyticsData] = useState(() => ({
    ratingRows: [],
    modeKellyRows: [],
    kellyMatrix: [],
    kellyBacktest: EMPTY_KELLY_BACKTEST,
    calibrationContext: EMPTY_CALIBRATION_CONTEXT,
    modelValidation: EMPTY_MODEL_VALIDATION,
  }))
  const [analyticsProgress, setAnalyticsProgress] = useState(() => ({
    rating: false,
    kelly: false,
    calibration: false,
    validation: false,
    phase: '等待计算',
    error: '',
  }))
  const excelInputRef = useRef(null)
  const jsonInputRef = useRef(null)
  const [jsonStatus, setJsonStatus] = useState('')
  const [accessLogPage, setAccessLogPage] = useState(1)
  const [selectedAccessMonth, setSelectedAccessMonth] = useState(() => getAccessMonthKey(Date.now()))
  const [fitTrajectoryMode, setFitTrajectoryMode] = useState('9')
  const [fitTrajectoryWindow, setFitTrajectoryWindow] = useState(120)

  useEffect(() => {
    const refresh = () => {
      setSyncStatus(getCloudSyncStatus())
      setDataVersion((prev) => prev + 1)
    }
    window.addEventListener('dugou:data-changed', refresh)
    return () => window.removeEventListener('dugou:data-changed', refresh)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const tasks = []
    const scheduleTask = (task) => {
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        const idleId = window.requestIdleCallback(
          () => {
            if (!cancelled) task()
          },
          { timeout: 120 },
        )
        tasks.push({ type: 'idle', id: idleId })
        return
      }
      const timeoutId = window.setTimeout(() => {
        if (!cancelled) task()
      }, 0)
      tasks.push({ type: 'timeout', id: timeoutId })
    }
    const failPhase = (phase, error) => {
      console.error(`[ParamsPage] ${phase} 计算失败`, error)
      if (cancelled) return
      setAnalyticsProgress((prev) => ({ ...prev, phase: `${phase} 失败`, error: `${phase} 计算失败，请刷新重试` }))
    }

    setAnalyticsProgress({
      rating: false,
      kelly: false,
      calibration: false,
      validation: false,
      phase: '基础指标计算中...',
      error: '',
    })
    setAnalyticsData((prev) => ({
      ...prev,
      modelValidation: {
        ...EMPTY_MODEL_VALIDATION,
        message: '模型验证计算中...',
      },
    }))

    scheduleTask(() => {
      try {
        const ratingRows = getExpectedVsActualRows(240)
        const modeKellyRows = getModeKellyRecommendations()
        if (cancelled) return
        setAnalyticsData((prev) => ({ ...prev, ratingRows, modeKellyRows }))
        setAnalyticsProgress((prev) => ({ ...prev, rating: true, phase: 'Kelly 回测计算中...' }))
      } catch (error) {
        failPhase('基础指标', error)
        return
      }

      scheduleTask(() => {
        try {
          const kellyMatrix = getKellyDivisorMatrix()
          const kellyBacktest = getKellyDivisorBacktest()
          if (cancelled) return
          setAnalyticsData((prev) => ({ ...prev, kellyMatrix, kellyBacktest }))
          setAnalyticsProgress((prev) => ({ ...prev, kelly: true, phase: '时间近因与校准计算中...' }))
        } catch (error) {
          failPhase('Kelly 回测', error)
          return
        }

        scheduleTask(() => {
          try {
            const calibrationContext = getPredictionCalibrationContext()
            if (cancelled) return
            setAnalyticsData((prev) => ({ ...prev, calibrationContext }))
            setAnalyticsProgress((prev) => ({ ...prev, calibration: true, phase: '模型收口验证计算中...' }))
          } catch (error) {
            failPhase('时间近因机制', error)
            return
          }

          scheduleTask(() => {
            try {
              const modelValidation = getModelValidationSnapshot()
              if (cancelled) return
              setAnalyticsData((prev) => ({ ...prev, modelValidation }))
              setAnalyticsProgress((prev) => ({
                ...prev,
                validation: true,
                phase: '计算完成',
                error: '',
              }))
            } catch (error) {
              failPhase('模型收口验证', error)
            }
          })
        })
      })
    })

    return () => {
      cancelled = true
      tasks.forEach((task) => {
        if (task.type === 'idle' && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(task.id)
          return
        }
        window.clearTimeout(task.id)
      })
    }
  }, [dataVersion])

  const { ratingRows, modeKellyRows, kellyMatrix, kellyBacktest, calibrationContext, modelValidation } = analyticsData
  const isAnalyticsComputing =
    !analyticsProgress.error &&
    !(analyticsProgress.rating && analyticsProgress.kelly && analyticsProgress.calibration && analyticsProgress.validation)
  const hasKellyBacktest = useMemo(
    () => (kellyBacktest.globalRows || []).some((row) => row.samples > 0),
    [kellyBacktest.globalRows],
  )
  const kellyVisibleRows = useMemo(
    () => (showAllKellyRows ? kellyBacktest.globalRows || [] : (kellyBacktest.globalRows || []).slice(0, 6)),
    [showAllKellyRows, kellyBacktest.globalRows],
  )
  const hasMoreKellyRows = (kellyBacktest.globalRows || []).length > 6
  const recommendedKellyDivisor = useMemo(() => {
    if (!modeKellyRows || modeKellyRows.length === 0) return 4
    const totalSamples = modeKellyRows.reduce((sum, row) => sum + (row.samples || 0), 0)
    if (totalSamples === 0) return 4
    const weightedSum = modeKellyRows.reduce((sum, row) => sum + (row.kellyDivisor || 4) * (row.samples || 0), 0)
    return Number((weightedSum / totalSamples).toFixed(1))
  }, [modeKellyRows])
  const ratingFitScore = useMemo(() => {
    if (!analyticsProgress.rating || ratingRows.length === 0) return null
    const fit = ratingRows.reduce((sum, row) => sum + (1 - Math.abs(row.diff)), 0) / Math.max(ratingRows.length, 1)
    return Number(fit.toFixed(2))
  }, [analyticsProgress.rating, ratingRows])
  const ratingDiagnostics = useMemo(() => {
    if (!analyticsProgress.rating || ratingRows.length === 0) {
      return {
        closeHitPct: null,
        meanBias: null,
        meanAbsError: null,
      }
    }
    const total = Math.max(ratingRows.length, 1)
    const closeHit = ratingRows.reduce((sum, row) => sum + (Math.abs(row.diff) <= 0.1 ? 1 : 0), 0)
    const bias = ratingRows.reduce((sum, row) => sum + Number(row.diff || 0), 0) / total
    const mae = ratingRows.reduce((sum, row) => sum + Math.abs(Number(row.diff || 0)), 0) / total
    return {
      closeHitPct: Number(((closeHit / total) * 100).toFixed(1)),
      meanBias: Number(bias.toFixed(3)),
      meanAbsError: Number(mae.toFixed(3)),
    }
  }, [analyticsProgress.rating, ratingRows])
  const regressionSnapshot = useMemo(() => {
    if (!analyticsProgress.calibration) return { r2: null, rmse: null }
    const r2 = Number.isFinite(Number(calibrationContext.regression?.r2))
      ? Number(calibrationContext.regression.r2)
      : null
    const rmse = Number.isFinite(Number(calibrationContext.regression?.rmse))
      ? Number(calibrationContext.regression.rmse)
      : null
    return { r2, rmse }
  }, [analyticsProgress.calibration, calibrationContext.regression])
  const calibrationConfidenceBand = useMemo(() => {
    if (!analyticsProgress.rating || ratingRows.length < 2) return null
    const diffs = ratingRows
      .map((row) => Number(row.diff))
      .filter((value) => Number.isFinite(value))
    if (diffs.length < 2) return null
    const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length
    const variance = diffs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(diffs.length - 1, 1)
    const std = Math.sqrt(Math.max(variance, 0))
    return Number((1.645 * std).toFixed(3))
  }, [analyticsProgress.rating, ratingRows])
  const riskPosture = useMemo(() => {
    if (!analyticsProgress.rating || ratingDiagnostics.meanAbsError === null || ratingFitScore === null) {
      return {
        label: 'Standby',
        badge:
          'border-stone-200/90 bg-[linear-gradient(120deg,rgba(250,250,250,0.94),rgba(255,255,255,0.92)_56%,rgba(245,245,245,0.86))] text-stone-500',
      }
    }
    const mae = Math.abs(Number(ratingDiagnostics.meanAbsError || 0))
    const fitScore = Number(ratingFitScore || 0)
    if (fitScore >= 0.78 && mae <= 0.12) {
      return {
        label: 'Aligned',
        badge:
          'border-emerald-200/90 bg-[linear-gradient(120deg,rgba(236,253,245,0.92),rgba(255,255,255,0.92)_56%,rgba(220,252,231,0.84))] text-emerald-700',
      }
    }
    if (fitScore >= 0.65 && mae <= 0.2) {
      return {
        label: 'Monitor',
        badge:
          'border-sky-200/90 bg-[linear-gradient(120deg,rgba(240,249,255,0.92),rgba(255,255,255,0.92)_56%,rgba(224,242,254,0.84))] text-sky-700',
      }
    }
    return {
      label: 'Guarded',
      badge:
        'border-amber-200/90 bg-[linear-gradient(120deg,rgba(255,251,235,0.92),rgba(255,255,255,0.92)_56%,rgba(254,243,199,0.84))] text-amber-700',
    }
  }, [analyticsProgress.rating, ratingDiagnostics.meanAbsError, ratingFitScore])
  const fitRegimes = useMemo(() => {
    const fallback = {
      fitTrend: { state: '--', detail: '样本不足', tone: 'text-stone-500' },
      stability: { state: '--', detail: '样本不足', tone: 'text-stone-500' },
      persistence: { state: '--', detail: '样本不足', tone: 'text-stone-500' },
      shock: { state: '--', detail: '样本不足', tone: 'text-stone-500' },
    }
    if (!analyticsProgress.rating || !Array.isArray(ratingRows) || ratingRows.length < 8) return fallback
    const diffs = ratingRows
      .map((row) => Number(row.diff))
      .filter((value) => Number.isFinite(value))
    if (diffs.length < 8) return fallback

    const n = diffs.length
    const calcMae = (arr) => arr.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(arr.length, 1)
    const trendWindow = Math.min(12, Math.max(4, Math.floor(n / 2)))
    const recent = diffs.slice(-trendWindow)
    const previous = diffs.slice(-(trendWindow * 2), -trendWindow)
    const maeRecent = calcMae(recent)
    const maePrev = previous.length > 0 ? calcMae(previous) : maeRecent
    const trendDelta = maeRecent - maePrev
    const fitTrendState = trendDelta <= -0.012 ? 'Improving' : trendDelta >= 0.012 ? 'Softening' : 'Flat'
    const fitTrendTone =
      fitTrendState === 'Improving'
        ? 'text-emerald-700'
        : fitTrendState === 'Softening'
          ? 'text-amber-700'
          : 'text-sky-700'
    const fitTrendDetail = `ΔMAE ${trendDelta >= 0 ? '+' : ''}${trendDelta.toFixed(3)}`

    const mean = diffs.reduce((sum, value) => sum + value, 0) / n
    const variance = diffs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n
    const std = Math.sqrt(Math.max(variance, 0))
    let jumpCount = 0
    for (let i = 1; i < n; i += 1) {
      if (Math.abs(diffs[i] - diffs[i - 1]) >= 0.12) jumpCount += 1
    }
    const jumpRate = jumpCount / Math.max(n - 1, 1)
    const stabilityScore = std + jumpRate * 0.08
    const stabilityState = stabilityScore <= 0.11 ? 'Stable' : stabilityScore <= 0.18 ? 'Choppy' : 'Volatile'
    const stabilityTone =
      stabilityState === 'Stable'
        ? 'text-emerald-700'
        : stabilityState === 'Choppy'
          ? 'text-indigo-700'
          : 'text-amber-700'
    const stabilityDetail = `σ ${std.toFixed(3)} · jump ${Math.round(jumpRate * 100)}%`

    const signEps = 0.02
    const signs = diffs.map((value) => (value > signEps ? 1 : value < -signEps ? -1 : 0))
    let switches = 0
    let longestRun = 1
    let currentRun = 1
    for (let i = 1; i < signs.length; i += 1) {
      if (signs[i] === signs[i - 1]) {
        currentRun += 1
      } else {
        switches += 1
        currentRun = 1
      }
      if (currentRun > longestRun) longestRun = currentRun
    }
    const switchRate = switches / Math.max(signs.length - 1, 1)
    const longestRunRatio = longestRun / signs.length
    const persistenceState =
      longestRunRatio >= 0.42 && switchRate <= 0.33
        ? 'Persistent'
        : switchRate <= 0.58
          ? 'Rotating'
          : 'Unstable'
    const persistenceTone =
      persistenceState === 'Persistent'
        ? 'text-emerald-700'
        : persistenceState === 'Rotating'
          ? 'text-cyan-700'
          : 'text-amber-700'
    const persistenceDetail = `run ${Math.round(longestRunRatio * 100)}% · switch ${Math.round(switchRate * 100)}%`

    const shockThreshold = Math.max(0.16, std * 1.45)
    const shockCount = diffs.filter((value) => Math.abs(value) >= shockThreshold).length
    const shockRatio = shockCount / n
    const shockState = shockRatio <= 0.12 ? 'Calm' : shockRatio <= 0.26 ? 'Elevated' : 'Fragile'
    const shockTone = shockState === 'Calm' ? 'text-emerald-700' : shockState === 'Elevated' ? 'text-violet-700' : 'text-amber-700'
    const shockDetail = `tail ${Math.round(shockRatio * 100)}%`

    return {
      fitTrend: { state: fitTrendState, detail: fitTrendDetail, tone: fitTrendTone },
      stability: { state: stabilityState, detail: stabilityDetail, tone: stabilityTone },
      persistence: { state: persistenceState, detail: persistenceDetail, tone: persistenceTone },
      shock: { state: shockState, detail: shockDetail, tone: shockTone },
    }
  }, [analyticsProgress.rating, ratingRows])
  const fitTrajectoryValues = useMemo(() => {
    if (!analyticsProgress.rating || !Array.isArray(ratingRows) || ratingRows.length === 0) return []
    const windowSize =
      fitTrajectoryWindow === 0
        ? ratingRows.length
        : Math.max(12, Number.isFinite(Number(fitTrajectoryWindow)) ? Number(fitTrajectoryWindow) : 120)
    return ratingRows
      .slice(-Math.max(1, windowSize))
      .map((row) => Number(row.diff))
      .filter((value) => Number.isFinite(value))
  }, [analyticsProgress.rating, ratingRows, fitTrajectoryWindow])
  const fitTrajectoryModel = useMemo(
    () => buildFitTrajectoryModel(fitTrajectoryValues),
    [fitTrajectoryValues],
  )
  const fitTrajectoryModeLabel = useMemo(() => {
    const found = FIT_TRAJECTORY_MODE_OPTIONS.find((option) => option.value === fitTrajectoryMode)
    if (found) return found.label
    const defaultMode = FIT_TRAJECTORY_MODE_OPTIONS.find((option) => option.value === '9')
    return defaultMode ? defaultMode.label : FIT_TRAJECTORY_MODE_OPTIONS[0].label
  }, [fitTrajectoryMode])
  const ratingScorePct = useMemo(() => {
    if (ratingFitScore === null || !Number.isFinite(Number(ratingFitScore))) return 0
    return Math.max(0, Math.min(100, Number((Number(ratingFitScore) * 100).toFixed(1))))
  }, [ratingFitScore])
  const ratingScoreDelta = useMemo(() => {
    if (ratingFitScore === null || !Number.isFinite(Number(ratingFitScore))) return null
    return Number((Number(ratingFitScore) - 0.75).toFixed(2))
  }, [ratingFitScore])
  const coreMetricGlossary = useMemo(() => {
    const fitTrendMeaningMap = {
      Improving: '近期误差在收敛，模型判断与结果贴合度在变好。',
      Flat: '近期误差变化不大，当前表现基本维持原位。',
      Softening: '近期误差有抬升迹象，说明预测稳定性在走弱。',
      '--': '当前样本不足，暂时无法判断趋势。',
    }
    const stabilityMeaningMap = {
      Stable: '波动与跳变都低，拟合质量处于平稳区间。',
      Choppy: '存在一定抖动但仍可控，建议观察而非立刻大改。',
      Volatile: '误差波动偏大且跳变频繁，校准结果不稳定。',
      '--': '当前样本不足，暂时无法判断稳定性。',
    }
    const persistenceMeaningMap = {
      Persistent: '同向持续段较长，结构特征相对连续。',
      Rotating: '状态在几个区间轮换，具备可跟踪节奏但不固定。',
      Unstable: '切换过于频繁，当前 regime 不易延续。',
      '--': '当前样本不足，暂时无法判断持续性。',
    }
    const shockMeaningMap = {
      Calm: '尾部偏差占比低，极端波动暴露较轻。',
      Elevated: '已有一定尾部风险，建议保留风险缓冲。',
      Fragile: '极端偏差占比偏高，需优先收敛模型风险。',
      '--': '当前样本不足，暂时无法判断尾部暴露。',
    }

    const closeHit = ratingDiagnostics.closeHitPct
    const mae = ratingDiagnostics.meanAbsError
    const bias = ratingDiagnostics.meanBias
    const r2 = regressionSnapshot.r2
    const rmse = regressionSnapshot.rmse
    const fitScore = ratingFitScore
    const ci = calibrationConfidenceBand

    const closeHitStatus =
      closeHit === null
        ? '等待样本刷新。'
        : closeHit >= 55
          ? '近窗贴合度较高，短期有效性较强。'
          : closeHit >= 35
            ? '近窗贴合度中性，建议保持观察。'
            : '近窗贴合度偏弱，建议优先查误差来源。'

    const maeStatus =
      mae === null
        ? '等待样本刷新。'
        : mae <= 0.12
          ? '误差处于紧致区间，校准质量较稳。'
          : mae <= 0.2
            ? '误差处于可控带，建议继续监控。'
            : '误差偏大，建议降风险并做再校准。'

    const biasStatus =
      bias === null
        ? '等待样本刷新。'
        : Math.abs(bias) <= 0.03
          ? '总体偏差接近中性，没有明显系统性偏向。'
          : bias > 0
            ? '存在正向偏置（模型略偏乐观）。'
            : '存在负向偏置（模型略偏保守）。'

    const r2Status =
      r2 === null
        ? '等待回归结果。'
        : r2 >= 0.3
          ? '解释度较好，线性校准关系较清晰。'
          : r2 >= 0.15
            ? '解释度中等，可用但仍有提升空间。'
            : '解释度较弱，建议结合更多特征与样本。'

    const postureStatusMap = {
      Aligned: '拟合与误差都在健康带内，可保持当前策略。',
      Monitor: '整体可用但需盯盘观察，建议小步迭代调参。',
      Guarded: '偏差超出舒适区，应优先控风险与再校准。',
      Standby: '样本不足，暂不建议据此做强判断。',
    }

    const ciStatus =
      ci === null
        ? '等待样本刷新。'
        : ci <= 0.22
          ? '置信区间较窄，不确定性较低。'
          : ci <= 0.35
            ? '置信区间中等，建议结合风险位控制使用。'
            : '置信区间偏宽，预测不确定性较高。'

    return {
      fitTrend: {
        title: 'Fit Trend',
        what: '跟踪拟合误差（MAE）在近期窗口的变化方向。',
        describes: '反映模型“最近是在变准还是变钝”。',
        current: `${fitRegimes.fitTrend.state}（${fitRegimes.fitTrend.detail}）`,
        baseline: 'ΔMAE ≤ -0.012 视为 Improving；|ΔMAE| < 0.012 视为 Flat；ΔMAE ≥ 0.012 视为 Softening。',
        status: fitTrendMeaningMap[fitRegimes.fitTrend.state] || fitTrendMeaningMap['--'],
        others: 'Improving / Flat / Softening',
      },
      stabilityRegime: {
        title: 'Stability Regime',
        what: '用误差标准差 σ + 跳变率评估拟合波动强度。',
        describes: '衡量模型输出是否“平稳可控”。',
        current: `${fitRegimes.stability.state}（${fitRegimes.stability.detail}）`,
        baseline: 'stabilityScore ≤ 0.11 Stable；≤ 0.18 Choppy；> 0.18 Volatile。',
        status: stabilityMeaningMap[fitRegimes.stability.state] || stabilityMeaningMap['--'],
        others: 'Stable / Choppy / Volatile',
      },
      regimePersistence: {
        title: 'Regime Persistence',
        what: '看误差符号是否持续，还是频繁切换。',
        describes: '用于识别当前状态的可延续性。',
        current: `${fitRegimes.persistence.state}（${fitRegimes.persistence.detail}）`,
        baseline: 'longestRunRatio ≥ 42% 且 switchRate ≤ 33% 为 Persistent；switchRate ≤ 58% 为 Rotating；否则 Unstable。',
        status: persistenceMeaningMap[fitRegimes.persistence.state] || persistenceMeaningMap['--'],
        others: 'Persistent / Rotating / Unstable',
      },
      shockExposure: {
        title: 'Shock Exposure',
        what: '统计尾部大偏差（shock）在样本中的占比。',
        describes: '表示模型面对极端样本时的脆弱度。',
        current: `${fitRegimes.shock.state}（${fitRegimes.shock.detail}）`,
        baseline: 'tailRatio ≤ 12% Calm；≤ 26% Elevated；> 26% Fragile。',
        status: shockMeaningMap[fitRegimes.shock.state] || shockMeaningMap['--'],
        others: 'Calm / Elevated / Fragile',
      },
      closeHit: {
        title: '近窗命中',
        what: '近窗内 |diff| ≤ 0.10 的样本占比。',
        describes: '衡量短期预测是否贴近真实结果。',
        current: closeHit === null ? '--' : `${closeHit}%`,
        baseline: '≥55% 通常较稳；35%~55% 中性；<35% 偏弱。',
        status: closeHitStatus,
        others: '高命中 / 中性 / 低命中',
      },
      meanAbsErr: {
        title: 'Mean Abs Err',
        what: '平均绝对误差（MAE），越小越好。',
        describes: '衡量预测值与结果值的平均偏离幅度。',
        current: mae === null ? '--' : mae.toFixed(3),
        baseline: '≤0.12 健康；0.12~0.20 监控带；>0.20 偏高。',
        status: maeStatus,
        others: 'Low Error / Moderate / High Error',
      },
      bias: {
        title: 'Bias',
        what: '误差均值，反映系统性偏乐观或偏保守。',
        describes: '用于判断模型方向性偏差，而非随机噪音。',
        current: bias === null ? '--' : toSigned(bias, 3),
        baseline: '|Bias| ≤ 0.03 通常视为中性区间。',
        status: biasStatus,
        others: 'Neutral / Positive Bias / Negative Bias',
      },
      r2: {
        title: 'R²',
        what: '回归解释度，表示拟合关系可解释程度。',
        describes: '用于评估线性校准是否“讲得通”。',
        current: r2 === null ? '--' : `${(r2 * 100).toFixed(1)}%`,
        baseline: '≥30% 较好；15%~30% 中等；<15% 偏弱。',
        status: `${r2Status}${rmse !== null ? `（RMSE ${rmse.toFixed(3)}）` : ''}`,
        others: 'High Explainability / Mid / Low',
      },
      riskPosture: {
        title: 'Risk Posture',
        what: '由拟合评分与 MAE 联合给出的风控姿态分层。',
        describes: '告诉你当前更适合“延续、监控还是防守”。',
        current: `${riskPosture.label}${fitScore !== null ? `（score ${fitScore.toFixed(2)}）` : ''}`,
        baseline: 'score ≥ 0.78 且 MAE ≤ 0.12 为 Aligned；score ≥ 0.65 且 MAE ≤ 0.20 为 Monitor；其余为 Guarded。',
        status: postureStatusMap[riskPosture.label] || postureStatusMap.Standby,
        others: 'Aligned / Monitor / Guarded / Standby',
      },
      ci: {
        title: 'CI',
        what: '用 ±1.645σ 估算误差区间宽度（约 90% 置信）。',
        describes: '区间越窄，短期不确定性通常越低。',
        current: ci === null ? '--' : `±${ci.toFixed(3)}`,
        baseline: '≤0.22 紧致；0.22~0.35 中等；>0.35 偏宽。',
        status: ciStatus,
        others: 'Tight / Normal / Wide',
      },
    }
  }, [
    fitRegimes.fitTrend.detail,
    fitRegimes.fitTrend.state,
    fitRegimes.persistence.detail,
    fitRegimes.persistence.state,
    fitRegimes.shock.detail,
    fitRegimes.shock.state,
    fitRegimes.stability.detail,
    fitRegimes.stability.state,
    regressionSnapshot.r2,
    regressionSnapshot.rmse,
    riskPosture.label,
    calibrationConfidenceBand,
    ratingDiagnostics.closeHitPct,
    ratingDiagnostics.meanAbsError,
    ratingDiagnostics.meanBias,
    ratingFitScore,
  ])
  const settledInvestments = useMemo(
    () =>
      getInvestments().filter(
        (item) =>
          !item.is_archived &&
          (item.status === 'win' || item.status === 'lose' || Number.isFinite(Number.parseFloat(item.profit))),
      ),
    [dataVersion],
  )

  const factorData = useMemo(() => {
    const { confPoints, tysPoints, fidPoints, fsePoints } = collectMatchAdjustments(settledInvestments)
    const { modePoints, oddsPoints } = collectModeAndOddsPoints(settledInvestments, modeKellyRows, kellyMatrix)

    const rows = [
      { label: 'Conf', value: avgPointValues(confPoints), history: buildHistory(confPoints.map((point) => point.value)), rawSeries: confPoints },
      { label: 'Mode', value: avgPointValues(modePoints), history: buildHistory(modePoints.map((point) => point.value)), rawSeries: modePoints },
      { label: 'TYS', value: avgPointValues(tysPoints), history: buildHistory(tysPoints.map((point) => point.value)), rawSeries: tysPoints },
      { label: 'FID', value: avgPointValues(fidPoints), history: buildHistory(fidPoints.map((point) => point.value)), rawSeries: fidPoints },
      { label: 'Odds', value: avgPointValues(oddsPoints), history: buildHistory(oddsPoints.map((point) => point.value)), rawSeries: oddsPoints },
      { label: 'FSE', value: avgPointValues(fsePoints), history: buildHistory(fsePoints.map((point) => point.value)), rawSeries: fsePoints },
    ]

    return rows.map((row) => ({
      ...row,
      trend: row.value > 1.02 ? '↑' : row.value < 0.98 ? '↓' : '→',
      sampleCount: Array.isArray(row.rawSeries) ? row.rawSeries.length : 0,
    }))
  }, [kellyMatrix, modeKellyRows, settledInvestments])

  const activeFactorDetail = useMemo(() => {
    if (!expandedFactor) return null
    const factor = factorData.find((item) => item.label === expandedFactor)
    if (!factor) return null

    const rows = buildFactorRangeRows(factor.rawSeries, factor.value, factorRange, nowTick)
    const values = rows.length > 0 ? rows.map((row) => row.value) : [factor.value]
    const min = Math.min(...values) - 0.05
    const max = Math.max(...values) + 0.05
    const range = max - min || 1
    const points = rows
      .map((row, index) => `${20 + (index / Math.max(rows.length - 1, 1)) * 160},${70 - ((row.value - min) / range) * 60}`)
      .join(' ')
    const gradientId = `factor-grad-${String(expandedFactor).replace(/\s+/g, '-').toLowerCase()}-${factorRange}`
    const labelLeft = rows[0]?.period || '--'
    const labelMid = rows[Math.floor((rows.length - 1) / 2)]?.period || '--'
    const labelRight = rows[rows.length - 1]?.period || '--'

    return {
      factor,
      rows,
      points,
      gradientId,
      labels: [labelLeft, labelMid, labelRight],
      min,
      max,
      range,
    }
  }, [expandedFactor, factorData, factorRange, nowTick])

  const backupSchedule = useMemo(() => {
    const cadence = normalizeBackupCadence(config.backupCadence)
    const cadenceHours = BACKUP_CADENCE_HOURS[cadence]
    const cadenceLabel = BACKUP_CADENCE_OPTIONS.find((option) => option.value === cadence)?.label || 'every half week'
    const lastDate = config.lastBackupAt ? new Date(config.lastBackupAt) : null
    const hasLastBackup = Boolean(lastDate && !Number.isNaN(lastDate.getTime()))

    if (!hasLastBackup) {
      return {
        cadence,
        cadenceLabel,
        hasLastBackup: false,
        isDue: true,
        overdueHours: 0,
        remainingHours: 0,
        lastBackupLabel: '--',
        nextDueLabel: '首次导出后开始计时',
      }
    }

    const nextDue = new Date(lastDate.getTime() + cadenceHours * 60 * 60 * 1000)
    const diffMs = nextDue.getTime() - nowTick
    const isDue = diffMs <= 0
    const overdueHours = isDue ? Math.abs(diffMs) / (60 * 60 * 1000) : 0
    const remainingHours = !isDue ? diffMs / (60 * 60 * 1000) : 0

    return {
      cadence,
      cadenceLabel,
      hasLastBackup: true,
      isDue,
      overdueHours,
      remainingHours,
      lastBackupLabel: formatDateTime(lastDate.toISOString()),
      nextDueLabel: formatDateTime(nextDue.toISOString()),
    }
  }, [config.backupCadence, config.lastBackupAt, nowTick])

  const accessLogs = useMemo(() => getAccessLogs(), [dataVersion])
  const accessMonthOptions = useMemo(() => {
    const currentMonth = getAccessMonthKey(Date.now())
    const earliestMonth = accessLogs[accessLogs.length - 1]?.created_at
      ? getAccessMonthKey(accessLogs[accessLogs.length - 1].created_at)
      : currentMonth
    const currentDate = parseAccessMonthKey(currentMonth)
    const earliestDate = parseAccessMonthKey(earliestMonth)
    if (!currentDate || !earliestDate) return []

    const months = []
    const cursor = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const floor = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1)
    while (cursor >= floor) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
      months.push({
        value: key,
        label: formatAccessMonthLabel(key),
      })
      cursor.setMonth(cursor.getMonth() - 1)
    }
    return months
  }, [accessLogs])

  useEffect(() => {
    if (accessMonthOptions.length === 0) return
    if (!accessMonthOptions.some((option) => option.value === selectedAccessMonth)) {
      setSelectedAccessMonth(accessMonthOptions[0].value)
    }
  }, [accessMonthOptions, selectedAccessMonth])

  const accessLogsByMonth = useMemo(() => {
    if (!selectedAccessMonth) return accessLogs
    return accessLogs.filter((row) => getAccessMonthKey(row.created_at) === selectedAccessMonth)
  }, [accessLogs, selectedAccessMonth])

  const accessLogTotalPages = useMemo(
    () => Math.max(1, Math.ceil(accessLogsByMonth.length / ACCESS_LOG_PAGE_SIZE)),
    [accessLogsByMonth.length],
  )

  useEffect(() => {
    setAccessLogPage((prev) => Math.max(1, Math.min(prev, accessLogTotalPages)))
  }, [accessLogTotalPages])

  useEffect(() => {
    setAccessLogPage(1)
  }, [selectedAccessMonth])

  const accessLogPageRows = useMemo(() => {
    if (accessLogsByMonth.length === 0) return []
    const start = (accessLogPage - 1) * ACCESS_LOG_PAGE_SIZE
    return accessLogsByMonth.slice(start, start + ACCESS_LOG_PAGE_SIZE)
  }, [accessLogsByMonth, accessLogPage])

  const accessLogPageWindow = useMemo(() => {
    const radius = 2
    const start = Math.max(1, accessLogPage - radius)
    const end = Math.min(accessLogTotalPages, accessLogPage + radius)
    const pages = []
    for (let p = start; p <= end; p += 1) {
      pages.push(p)
    }
    return pages
  }, [accessLogPage, accessLogTotalPages])

  const { accessSessionDurationMap, accessSessionDeltaMap } = useMemo(() => {
    const sessionBounds = new Map()
    const sessionRowsMap = new Map()
    accessLogs.forEach((row) => {
      const sessionId = String(row.session_id || '').trim()
      if (!sessionId) return
      const ts = new Date(row.created_at || '').getTime()
      if (!Number.isFinite(ts)) return
      if (!sessionRowsMap.has(sessionId)) sessionRowsMap.set(sessionId, [])
      sessionRowsMap.get(sessionId).push({ row, ts })
      const current = sessionBounds.get(sessionId)
      if (!current) {
        sessionBounds.set(sessionId, { min: ts, max: ts })
        return
      }
      if (ts < current.min) current.min = ts
      if (ts > current.max) current.max = ts
    })
    const durationMap = new Map()
    sessionBounds.forEach((bounds, sessionId) => {
      durationMap.set(sessionId, formatSessionDuration(bounds.max - bounds.min))
    })
    const deltaMap = new Map()
    sessionRowsMap.forEach((items) => {
      const ordered = [...items].sort((a, b) => a.ts - b.ts)
      let prevTs = null
      ordered.forEach(({ row, ts }) => {
        const deltaMs = prevTs === null ? 0 : Math.max(0, ts - prevTs)
        deltaMap.set(getAccessRowDurationKey(row), formatSessionDuration(deltaMs))
        prevTs = ts
      })
    })
    return {
      accessSessionDurationMap: durationMap,
      accessSessionDeltaMap: deltaMap,
    }
  }, [accessLogs])

  const accessLogSummary = useMemo(() => {
    let mobileCount = 0
    let desktopCount = 0

    accessLogsByMonth.forEach((row) => {
      if (row.device_type === 'mobile' || row.device_type === 'tablet') {
        mobileCount += 1
      } else {
        desktopCount += 1
      }
    })

    return {
      total: accessLogsByMonth.length,
      totalAll: accessLogs.length,
      latest: accessLogsByMonth[0] || null,
      mobileCount,
      desktopCount,
    }
  }, [accessLogs, accessLogsByMonth])

  const modelValidationMeta =
    modelValidation.stability === 'stable'
      ? {
          label: '稳定',
          tone: 'text-emerald-700',
          badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
        }
      : modelValidation.stability === 'watch'
        ? {
            label: '观察',
            tone: 'text-amber-700',
            badge: 'bg-amber-50 border-amber-200 text-amber-700',
          }
        : modelValidation.stability === 'risk'
          ? {
              label: 'At Risk',
              tone: 'text-rose-700',
              badge: 'bg-rose-50/70 border-rose-100 text-rose-500',
            }
          : {
              label: '样本不足',
              tone: 'text-stone-600',
          badge: 'bg-stone-100 border-stone-200 text-stone-600',
        }

  const modelValidationGlossary = useMemo(() => {
    const sampleCount = Number(modelValidation.sampleCount || 0)
    const minimumSamples = Number(modelValidation.minimumSamples || 24)
    const brierGain = Number(modelValidation.brier?.gainPct || 0)
    const logLossGain = Number(modelValidation.logLoss?.gainPct || 0)
    const drift = Number(modelValidation.brier?.drift || 0)
    const rawRoi = Number(modelValidation.strategy?.raw?.roi || 0)
    const rawMaxDrawdown = Number(modelValidation.strategy?.raw?.maxDrawdown || 0)
    const calibratedRoi = Number(modelValidation.strategy?.calibrated?.roi || 0)
    const calibratedMaxDrawdown = Number(modelValidation.strategy?.calibrated?.maxDrawdown || 0)
    const rawSamples = Number(modelValidation.strategy?.raw?.samples || 0)
    const calibratedSamples = Number(modelValidation.strategy?.calibrated?.samples || 0)
    const rawRuns = Number(modelValidation.strategy?.raw?.runs || 0)
    const calibratedRuns = Number(modelValidation.strategy?.calibrated?.runs || 0)
    const walkForwardTotal = Number(modelValidation.walkForward?.length || 0)
    const walkForwardPositive = Number(modelValidation.positiveWalkForward || 0)
    const walkForwardRatio = walkForwardTotal > 0 ? walkForwardPositive / walkForwardTotal : null

    const describeGain = (gain) => {
      if (gain >= 8) return '校准后显著改善，说明模型收口有效。'
      if (gain >= 2) return '校准后有改善，方向正确。'
      if (gain > -2) return '与未校准基本持平，建议继续观察。'
      return '校准后出现退化，需排查参数或样本结构。'
    }

    const sampleStatus =
      sampleCount < minimumSamples
        ? '尚未达到最小样本门槛，当前结果仅供参考。'
        : sampleCount < minimumSamples * 2
          ? '刚越过最小门槛，建议继续累积样本后再做大改。'
          : sampleCount < minimumSamples * 4
            ? '样本量处于可用区间，可做阶段性判断。'
            : '样本量充足，验证结果的稳定性更高。'

    const driftStatus = (() => {
      const absDrift = Math.abs(drift)
      if (absDrift <= 0.015) return '训练与测试表现贴合，泛化稳定。'
      if (absDrift <= 0.035) return '存在可控漂移，建议持续监控。'
      return '漂移偏大，可能有过拟合或分布变化风险。'
    })()

    const rawKellyStatus =
      rawSamples <= 0
        ? '样本不足，暂无法评价该策略稳健性。'
        : rawRoi >= 0 && rawMaxDrawdown <= 25
          ? '收益为正且回撤可控，策略表现较平衡。'
          : rawRoi >= 0
            ? '收益为正但回撤偏高，需关注资金曲线波动。'
            : rawMaxDrawdown <= 20
              ? '收益转负但回撤尚可，可能是赔率结构阶段性不利。'
              : '收益与回撤同时偏弱，建议限制风险敞口。'

    const calibratedKellyStatus = (() => {
      if (calibratedSamples <= 0) return '样本不足，暂无法评价校准后策略。'
      const roiDelta = calibratedRoi - rawRoi
      const drawdownDelta = calibratedMaxDrawdown - rawMaxDrawdown
      if (roiDelta >= 2 && drawdownDelta <= 0) return '校准后收益提升且回撤未恶化，收口有效。'
      if (roiDelta >= 0 && drawdownDelta <= 2) return '校准后总体改善，建议继续沿当前参数迭代。'
      if (roiDelta >= 0) return '收益有改善但回撤增大，建议配合风控上限使用。'
      return '校准后净效果偏弱，需回看校准区间与样本结构。'
    })()

    const walkForwardStatus =
      walkForwardRatio === null
        ? '样本不足，尚未形成正向窗口统计。'
        : walkForwardRatio >= 0.67
          ? '大部分窗口方向一致，时序泛化能力较强。'
          : walkForwardRatio >= 0.45
            ? '正负窗口接近，时序稳定性中性。'
            : '正向窗口偏少，建议降低激进配置并复核参数。'

    const positiveWindowStatus =
      walkForwardRatio === null
        ? '无可评估窗口。'
        : walkForwardRatio >= 0.67
          ? '正向窗口占比高，可维持当前策略主线。'
          : walkForwardRatio >= 0.45
            ? '窗口表现分化，建议以稳健仓位为主。'
            : '窗口胜率偏低，建议优先修正模型与仓位。'

    const bootstrapStatus = (() => {
      const runsTarget = 100000
      const runsNow = Math.max(rawRuns, calibratedRuns)
      if (runsNow <= 0) return '尚未完成 Monte Carlo 采样。'
      const ratio = runsNow / runsTarget
      if (ratio >= 1) return '已达目标采样，统计噪音相对可控。'
      if (ratio >= 0.6) return '采样次数较充足，可用于阶段性判断。'
      return '采样偏少，结果方差较高，建议补足后再下结论。'
    })()

    const walkForwardGainCard = (row) => {
      const gain = Number(row?.gainPct || 0)
      return {
        title: `${row?.label || '窗口'} · Brier 改善`,
        what: '该窗口内，校准前后 Brier score 的相对改善幅度。',
        describes: '用于判断模型在该时间切片上是否“越校准越准”。',
        current: toSigned(gain, 2, '%'),
        baseline: '≥8% 显著改善；2%~8% 有改善；-2%~2% 基本持平；< -2% 退化。',
        status: describeGain(gain),
        others: 'Improve / Flat / Degrade',
      }
    }

    return {
      sampleCount: {
        title: '样本总量',
        what: '参与模型收口验证的总样本量（训练 + 测试）。',
        describes: '决定验证统计结果的可靠性与可解释性。',
        current: `${sampleCount}（Train ${modelValidation.trainSamples} · Test ${modelValidation.testSamples}）`,
        baseline: `最小门槛 ${minimumSamples}；建议 ≥ ${minimumSamples * 2}。`,
        status: sampleStatus,
        others: '不足 / 可用 / 充足',
      },
      testBrier: {
        title: 'Test Brier',
        what: 'Brier score 衡量概率预测误差，值越低越好。',
        describes: '对比校准前后在测试集上的误差变化。',
        current: `${modelValidation.brier.testRaw.toFixed(4)} → ${modelValidation.brier.testCalibrated.toFixed(4)}（${toSigned(brierGain, 2, '%')}）`,
        baseline: 'gain > 0 代表校准改善；gain < 0 代表校准退化。',
        status: describeGain(brierGain),
        others: 'Significant Improve / Mild Improve / Flat / Degrade',
      },
      testLogLoss: {
        title: 'Test LogLoss',
        what: 'LogLoss 关注概率预测的对数损失，值越低越好。',
        describes: '对极端错误更敏感，用于补充 Brier 的风险视角。',
        current: `${modelValidation.logLoss.testRaw.toFixed(4)} → ${modelValidation.logLoss.testCalibrated.toFixed(4)}（${toSigned(logLossGain, 2, '%')}）`,
        baseline: 'gain > 0 为改善；gain < 0 为退化。',
        status: describeGain(logLossGain),
        others: 'Significant Improve / Mild Improve / Flat / Degrade',
      },
      drift: {
        title: '稳健性漂移',
        what: '测试集校准误差相对训练集校准误差的偏移量。',
        describes: '用于观测过拟合或样本分布偏移风险。',
        current: toSigned(drift, 4),
        baseline: '|drift| ≤ 0.015 稳定；≤ 0.035 观察；> 0.035 风险。',
        status: driftStatus,
        others: 'Stable / Watch / At Risk',
      },
      kellyRaw: {
        title: 'Kelly 策略回测（Raw Conf）',
        what: '用原始置信度（未校准）驱动 Kelly 下注的历史回测表现。',
        describes: '作为校准策略前的对照基线。',
        current: `ROI ${toSigned(rawRoi, 2, '%')} · 回撤 -${rawMaxDrawdown.toFixed(2)}% · 样本 ${rawSamples} · MC ${rawRuns || 0}`,
        baseline: '常见基线：ROI > 0 且最大回撤 < 25%。',
        status: rawKellyStatus,
        others: 'Balanced / Positive but Risky / Defensive / Weak',
      },
      kellyCalibrated: {
        title: 'Kelly 策略回测（Calibrated Conf）',
        what: '用校准后置信度驱动 Kelly 下注的历史回测表现。',
        describes: '用于验证“校准是否真正转化为收益质量”。',
        current: `ROI ${toSigned(calibratedRoi, 2, '%')} · 回撤 -${calibratedMaxDrawdown.toFixed(2)}% · 样本 ${calibratedSamples} · MC ${calibratedRuns || 0}`,
        baseline: '优先观察相对 Raw 的 ROI 增减与回撤变化。',
        status: calibratedKellyStatus,
        others: 'ROI Up + DD Down / ROI Up + DD Up / Flat / Weaker',
      },
      walkForward: {
        title: 'Walk-forward 结果',
        what: '按时间滚动窗口进行训练-测试的序列验证结果。',
        describes: '衡量模型在时间推进下是否仍具泛化能力。',
        current: walkForwardTotal > 0 ? `${walkForwardTotal} 个窗口` : '--',
        baseline: '建议至少 3 个窗口，且正向窗口占比尽量 > 50%。',
        status: walkForwardStatus,
        others: 'Robust / Mixed / Weak',
      },
      positiveWindow: {
        title: '正向窗口',
        what: 'Walk-forward 中，校准后优于校准前的窗口数量。',
        describes: '反映校准增益在时间轴上的稳定覆盖度。',
        current: walkForwardTotal > 0 ? `${walkForwardPositive}/${walkForwardTotal}` : '--',
        baseline: '≥67% 通常较稳；45%~67% 中性；<45% 需谨慎。',
        status: positiveWindowStatus,
        others: 'High Coverage / Neutral / Low Coverage',
      },
      bootstrap: {
        title: 'Bootstrap Monte Carlo',
        what: '对回测样本做重复重采样，估计策略收益分布稳定性。',
        describes: '用于降低小样本偶然性，给 ROI/回撤更稳的统计支撑。',
        current: `Raw ${rawRuns || 0} · Calibrated ${calibratedRuns || 0}`,
        baseline: '目标采样 100000 次；样本少时会自动降采样预算。',
        status: bootstrapStatus,
        others: 'Target Reached / Usable / Under-sampled',
      },
      walkForwardGainCard,
    }
  }, [modelValidation])

  const openRatingModal = () => {
    openModal({
      title: 'Expected vs Actual Judgmental Rating · 历史记录',
      content: (
        <div>
          <p className="text-sm text-stone-500 mb-4">系统预期模型拟合度（Expected vs Actual）</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">日期</th>
                <th className="py-2">比赛</th>
                <th className="py-2">Expected</th>
                <th className="py-2">Actual</th>
                <th className="py-2">偏差</th>
              </tr>
            </thead>
            <tbody>
              {ratingRows.slice(0, 120).map((row, index) => (
                <tr key={`${row.investment_id}-${index}`} className="border-b border-stone-100">
                  <td className="py-2">{row.dateLabel}</td>
                  <td className="py-2">{row.match}</td>
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

  const openKellyModal = () => {
    const adjustment = config.kellyAdjustment ?? 0
    const showAdjustment = adjustment !== 0 && !config.kellyOverrideEnabled
    openModal({
      title: 'Kelly 分母 Classification · 历史校准',
      content: (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-stone-500 mb-3">Mode 级别建议（按历史回测评分自动选优，策略回测采用 Bootstrap Monte Carlo）</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2">Mode</th>
                  <th className="py-2">样本</th>
                  <th className="py-2">ROI</th>
                  <th className="py-2">建议 Kelly 分母</th>
                </tr>
              </thead>
              <tbody>
                {modeKellyRows.map((row) => (
                  <tr key={row.mode} className="border-b border-stone-100">
                    <td className="py-2 font-medium">{row.mode}</td>
                    <td className="py-2">{row.samples}</td>
                    <td className={`py-2 ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {toSigned(row.roi, 1, '%')}
                    </td>
                    <td className="py-2">
                      <span className="font-semibold text-amber-600">{row.kellyDivisor.toFixed(1)}</span>
                      {showAdjustment && (
                        <span className={`ml-1.5 text-xs font-medium ${adjustment >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {adjustment >= 0 ? '+' : ''}{adjustment}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-sm text-stone-500 mb-3">Mode × Conf × Odds 组合分层</p>
            <PaginatedKellyMatrixTable rows={kellyMatrix} />
          </div>
        </div>
      ),
    })
  }

  const openFutureFeaturesModal = () => {
    openModal({
      title: '未来迭代 · 概念版features前瞻',
      content: <FutureFeaturesExplorer />,
    })
  }

  const getCurrentLayoutMode = () => {
    if (typeof window === 'undefined') return config.layoutMode || 'modern'
    const cached = window.localStorage.getItem('dugou:layout-mode')
    if (LAYOUT_MODE_OPTIONS.includes(cached)) return cached
    if (LAYOUT_MODE_OPTIONS.includes(config.layoutMode)) return config.layoutMode
    return 'modern'
  }

  const applyPageAmbientThemes = (nextThemes, options = {}) => {
    const normalized = normalizeAmbientThemeMap(nextThemes)
    const layoutMode = LAYOUT_MODE_OPTIONS.includes(options.layoutMode) ? options.layoutMode : getCurrentLayoutMode()
    saveSystemConfig({ pageAmbientThemes: normalized, layoutMode })
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dugou:layout-mode', layoutMode)
      window.dispatchEvent(new CustomEvent('dugou:layout-changed', { detail: { mode: layoutMode } }))
    }
    setConfig((prev) => ({ ...prev, pageAmbientThemes: normalized, layoutMode }))
    setSaveStatus('Theme 已保存')
    setTimeout(() => setSaveStatus(''), 1200)
  }

  const resetPageAmbientThemes = (defaultThemes = PAGE_AMBIENT_THEME_DEFAULTS) => {
    applyPageAmbientThemes(defaultThemes, { layoutMode: 'modern' })
  }

  const openThemeSettingsModal = () => {
    openModal({
      title: 'themes settings',
      content: (
        <ThemeSettingsExplorer
          value={config.pageAmbientThemes}
          onChange={applyPageAmbientThemes}
          onReset={resetPageAmbientThemes}
        />
      ),
    })
  }

  const openLogoGalleryModal = () => {
    openModal({
      title: '个性化Logo自定义 · Motion Gallery',
      content: <LogoGalleryExplorer />,
    })
  }

  const handleConfigChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  const handleSaveConfig = () => {
    const normalizedCadence = normalizeBackupCadence(config.backupCadence)
    const normalized = {
      initialCapital: Math.max(0, Number(config.initialCapital || 0)),
      riskCapRatio: Math.max(0, Number(config.riskCapRatio || 0)),
      defaultOdds: Math.max(1.01, Number(config.defaultOdds || 1.01)),
      kellyDivisor: Math.max(1, Number(config.kellyDivisor || 1)),
      maxWorstDrawdownAlertPct: clamp(Number(config.maxWorstDrawdownAlertPct || 0), 5, 95),
      backupCadence: normalizedCadence,
      lastBackupAt: typeof config.lastBackupAt === 'string' ? config.lastBackupAt : '',
      weightConf: normalizeWeight(config.weightConf, 0.45),
      weightMode: normalizeWeight(config.weightMode, 0.16),
      weightTys: normalizeWeight(config.weightTys, 0.12),
      weightFid: normalizeWeight(config.weightFid, 0.14),
      weightOdds: normalizeWeight(config.weightOdds, 0.06),
      weightFse: normalizeWeight(config.weightFse, 0.07),
    }
    saveSystemConfig(normalized)
    setConfig(normalized)
    setSaveStatus('已保存')
    setTimeout(() => setSaveStatus(''), 1200)
  }

  const applyKellyDivisor = (value) => {
    const divisor = Math.max(1, Number.parseFloat(value || 1))
    if (!Number.isFinite(divisor)) return
    saveSystemConfig({ kellyDivisor: divisor })
    setConfig((prev) => ({ ...prev, kellyDivisor: divisor }))
    setSaveStatus('已应用')
    setTimeout(() => setSaveStatus(''), 1200)
  }

  const handleBackupCadenceChange = (value) => {
    const cadence = normalizeBackupCadence(value)
    saveSystemConfig({ backupCadence: cadence })
    setConfig((prev) => ({ ...prev, backupCadence: cadence }))
    setExcelStatus(`固定导出已设置为 ${BACKUP_CADENCE_OPTIONS.find((item) => item.value === cadence)?.label || cadence}`)
    setTimeout(() => setExcelStatus(''), 1600)
  }

  const markBackupExported = () => {
    const nowIso = new Date().toISOString()
    const cadence = normalizeBackupCadence(config.backupCadence)
    saveSystemConfig({
      backupCadence: cadence,
      lastBackupAt: nowIso,
    })
    setConfig((prev) => ({
      ...prev,
      backupCadence: cadence,
      lastBackupAt: nowIso,
    }))
  }

  const handleExportExcel = () => {
    const bundle = exportDataBundle()
    const workbook = buildExcelWorkbook(bundle)
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const dateKey = new Date().toISOString().slice(0, 10)
    anchor.href = href
    anchor.download = `dugou-data-${dateKey}.xlsx`
    anchor.click()
    URL.revokeObjectURL(href)
    markBackupExported()
    setExcelStatus('已导出并记录备份时间')
    setTimeout(() => setExcelStatus(''), 1600)
  }

  const handleImportExcel = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setExcelError('')
    try {
      const parsed = await parseExcelFile(file)
      if (parsed?.error) {
        setExcelError(parsed.error)
        return
      }
      setExcelPreview({
        fileName: file.name,
        ...parsed,
      })
    } catch {
      setExcelError('导入失败：无法解析 Excel 文件，请确认格式正确。')
    } finally {
      event.target.value = ''
    }
  }

  const handleApplyExcelImport = (mode) => {
    if (!excelPreview?.bundle) return
    const ok = importDataBundle(excelPreview.bundle, mode)
    if (!ok) {
      setExcelError('导入失败：文件结构不符合 DUGOU 模板。')
      return
    }
    setExcelPreview(null)
    setExcelStatus(mode === 'merge' ? '已合并导入' : '已覆盖导入')
    setTimeout(() => setExcelStatus(''), 1600)
    setDataVersion((prev) => prev + 1)
  }

  /* ── JSON Data Import/Export ── */
  const handleJsonExport = () => {
    const bundle = exportDataBundle()
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `dugou-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(href)
    setJsonStatus('已导出 JSON')
    setTimeout(() => setJsonStatus(''), 1600)
  }

  const handleJsonImportFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const shouldMerge = window.confirm('导入模式：点击「确定」= 合并；点击「取消」= 覆盖当前数据。')
      const ok = importDataBundle(parsed, shouldMerge ? 'merge' : 'replace')
      if (!ok) { setJsonStatus('导入失败：文件结构不正确'); return }
      setJsonStatus(shouldMerge ? '已合并导入 JSON' : '已覆盖导入 JSON')
      setTimeout(() => setJsonStatus(''), 1600)
      setDataVersion((prev) => prev + 1)
    } catch {
      setJsonStatus('导入失败')
    } finally {
      event.target.value = ''
    }
  }

  const handleToggleCloudSync = () => {
    const next = setCloudSyncEnabled(!syncStatus.enabled)
    setSyncStatus(next)
  }

  const handleCloudSyncNow = async () => {
    setSyncingNow(true)
    try {
      await runCloudSyncNow()
      setSyncStatus(getCloudSyncStatus())
    } finally {
      setSyncingNow(false)
    }
  }

  const handleCloudPull = async (mode) => {
    if (mode === 'replace') {
      const confirmed = window.confirm('覆盖拉取会用云端快照替换本地数据，确认继续吗？')
      if (!confirmed) return
    }

    setPullingCloud(true)
    setCloudPullStatus('')
    try {
      const result = await pullCloudSnapshotNow(mode)
      setSyncStatus(getCloudSyncStatus())
      if (result?.ok && result?.applied) {
        setCloudPullStatus(mode === 'merge' ? '已从云端合并拉取' : '已从云端覆盖拉取')
        setDataVersion((prev) => prev + 1)
      } else if (result?.reason === 'empty_remote') {
        setCloudPullStatus('云端暂无可拉取的快照')
      } else {
        setCloudPullStatus('云端拉取失败，请检查配置与网络')
      }
    } finally {
      setPullingCloud(false)
      window.setTimeout(() => setCloudPullStatus(''), 2200)
    }
  }

  const totalPreMatchWeight = useMemo(
    () => WEIGHT_FIELDS.reduce((sum, field) => sum + Number(config[field.key] || 0), 0),
    [config],
  )
  const currentLayoutMode = config.layoutMode || 'modern'

  return (
    <div className="page-shell page-content-wide console-motion-scope">
      <div className="mb-6">
        <div className="mb-2.5">
          <span className="inline-flex max-w-[460px] rounded-r-xl rounded-l-none border border-sky-200/90 bg-gradient-to-r from-sky-100/75 via-cyan-50/85 to-blue-100/75 px-3 py-1.5 text-[10.5px] font-semibold leading-4 tracking-[0.03em] text-sky-700/90 backdrop-blur-md">
            (calibration and tracking) quant engine for predictive sports positioning
          </span>
        </div>
        <div className="mt-0.5 ml-[3px] flex flex-wrap items-end gap-x-3 gap-y-1">
          <h2 className="text-2xl font-semibold text-stone-800 font-display">参数后台</h2>
          <p className="text-[11px] font-semibold text-stone-400/95 tracking-[0.01em] sm:mb-0.5">
            系统参数、动态校准系数与 Kelly 分母历史校准
          </p>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {isAnalyticsComputing && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px]">
              {analyticsProgress.phase || '指标计算中...'}
            </span>
          )}
          {analyticsProgress.error && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200 text-[11px]">
              {analyticsProgress.error}
            </span>
          )}
        </div>
      </div>

      <div
        onClick={openRatingModal}
        className="console-interactive-surface glow-card relative z-30 hover:z-40 overflow-visible rounded-2xl border border-indigo-200/75 bg-[linear-gradient(145deg,rgba(244,247,255,0.96),rgba(255,255,255,0.95)_48%,rgba(238,247,255,0.92))] p-6 mb-6 cursor-pointer shadow-[0_24px_44px_-34px_rgba(79,70,229,0.42)]"
      >
        <div className="pointer-events-none absolute -top-16 -left-16 h-44 w-44 rounded-full bg-sky-200/22 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-16 h-48 w-48 rounded-full bg-violet-200/16 blur-3xl" />
        <div className="relative">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_268px]">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2.5">
                <ConsoleCardIcon IconComp={BarChart3} />
                <span className="text-xs text-indigo-600 font-medium uppercase tracking-[0.08em]">Core Metric</span>
                <span className="inline-flex items-center rounded-[8px] border border-indigo-200/85 bg-white/82 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.08em] text-indigo-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                  fit engine
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-[23px] leading-tight font-semibold text-stone-800">Expected vs Actual Judgmental Rating</h3>
                <span className="text-[11px] font-medium text-stone-400">点击查看完整历史记录</span>
              </div>
              <p className="mt-1.5 text-sm text-stone-500">系统预期拟合度：持续跟踪模型判断与真实结果的贴合程度。</p>

              <div className="mt-3 rounded-xl border border-indigo-100/85 bg-white/78 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-stone-400">
                  <span>Fit Trajectory</span>
                  {analyticsProgress.rating ? (
                    <div className="flex items-center gap-1.5">
                      <label className="relative inline-flex items-center">
                        <span className="sr-only">切换拟合轨迹模式</span>
                        <select
                          value={fitTrajectoryMode}
                          onChange={(event) => setFitTrajectoryMode(event.target.value)}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          className="h-6 appearance-none rounded-[8px] border border-indigo-100/85 bg-white/72 px-2.5 pr-6 text-[9.5px] font-medium normal-case tracking-[0.02em] text-indigo-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition-colors hover:border-indigo-200/80 hover:text-indigo-600 focus:border-indigo-300/90"
                          title={`当前模式：${fitTrajectoryModeLabel}`}
                        >
                          {FIT_TRAJECTORY_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-[13.2px] flex items-center">
                          <span className="h-1.5 w-1.5 -translate-y-[0.9px] rotate-45 border-r border-b border-indigo-300/90" />
                        </span>
                        <span className="pointer-events-none absolute inset-y-0 right-[10px] flex items-center">
                          <span className="h-1.5 w-1.5 -translate-y-[0.9px] rotate-45 border-r border-b border-indigo-500/90" />
                        </span>
                      </label>
                      <label className="relative inline-flex items-center">
                        <span className="sr-only">切换样本窗口</span>
                        <select
                          value={fitTrajectoryWindow}
                          onChange={(event) => setFitTrajectoryWindow(Number(event.target.value))}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          className="h-6 appearance-none rounded-[8px] border border-indigo-100/85 bg-white/72 px-2.5 pr-6 text-[9.5px] font-medium normal-case tracking-[0.02em] text-stone-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition-colors hover:border-indigo-200/80 hover:text-indigo-600 focus:border-indigo-300/90"
                          title="切换样本窗口"
                        >
                          {FIT_TRAJECTORY_WINDOW_OPTIONS.map((windowSize) => (
                            <option key={windowSize} value={windowSize}>
                              {windowSize === 0 ? `历史（全部 ${ratingRows.length} 场）` : `最近 ${Math.min(ratingRows.length, windowSize)} 场`}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute inset-y-0 right-[13.2px] flex items-center">
                          <span className="h-1.5 w-1.5 -translate-y-[0.9px] rotate-45 border-r border-b border-indigo-300/90" />
                        </span>
                        <span className="pointer-events-none absolute inset-y-0 right-[10px] flex items-center">
                          <span className="h-1.5 w-1.5 -translate-y-[0.9px] rotate-45 border-r border-b border-indigo-500/90" />
                        </span>
                      </label>
                    </div>
                  ) : (
                    <span>样本计算中...</span>
                  )}
                </div>
                <div className="mt-2 h-[128px] rounded-xl border border-sky-100/85 bg-[linear-gradient(140deg,rgba(239,246,255,0.68),rgba(255,255,255,0.94)_48%,rgba(245,243,255,0.62))] px-2.5 py-2">
                  <svg viewBox="0 0 340 64" preserveAspectRatio="none" className="h-full w-full">
                    {renderFitTrajectoryChart({ model: fitTrajectoryModel, mode: fitTrajectoryMode })}
                  </svg>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  {
                    key: 'fit-trend',
                    title: 'Fit Trend',
                    value: fitRegimes.fitTrend,
                    glossary: coreMetricGlossary.fitTrend,
                    labelTone: 'text-sky-600/80 decoration-sky-300/80',
                    detailTone: 'text-sky-900/45',
                    cardTone:
                      'border-sky-100/85 bg-[linear-gradient(145deg,rgba(240,249,255,0.82),rgba(255,255,255,0.94)_58%,rgba(224,242,254,0.6))]',
                  },
                  {
                    key: 'stability-regime',
                    title: 'Stability Regime',
                    value: fitRegimes.stability,
                    glossary: coreMetricGlossary.stabilityRegime,
                    labelTone: 'text-indigo-500/80 decoration-indigo-300/80',
                    detailTone: 'text-indigo-900/42',
                    cardTone:
                      'border-indigo-100/85 bg-[linear-gradient(145deg,rgba(238,242,255,0.8),rgba(255,255,255,0.94)_58%,rgba(224,231,255,0.58))]',
                  },
                  {
                    key: 'regime-persistence',
                    title: 'Regime Persistence',
                    value: fitRegimes.persistence,
                    glossary: coreMetricGlossary.regimePersistence,
                    labelTone: 'text-teal-600/80 decoration-teal-300/80',
                    detailTone: 'text-teal-900/45',
                    cardTone:
                      'border-teal-100/85 bg-[linear-gradient(145deg,rgba(240,253,250,0.8),rgba(255,255,255,0.94)_58%,rgba(204,251,241,0.56))]',
                  },
                  {
                    key: 'shock-exposure',
                    title: 'Shock Exposure',
                    value: fitRegimes.shock,
                    glossary: coreMetricGlossary.shockExposure,
                    labelTone: 'text-violet-600/80 decoration-violet-300/80',
                    detailTone: 'text-violet-900/42',
                    cardTone:
                      'border-violet-100/85 bg-[linear-gradient(145deg,rgba(245,243,255,0.8),rgba(255,255,255,0.94)_58%,rgba(233,213,255,0.56))]',
                  },
                ].map((item, index) => (
                  <div
                    key={item.key}
                    className={`rounded-xl border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] ${item.cardTone}`}
                  >
                    <ExplainHover card={item.glossary} align={index === 3 ? 'right' : 'left'}>
                      <span className={`cursor-help text-[10px] uppercase tracking-[0.07em] decoration-dotted underline underline-offset-[3px] ${item.labelTone}`}>
                        {item.title}
                      </span>
                    </ExplainHover>
                    <p className={`mt-0.5 text-base font-semibold ${item.value.tone}`}>
                      {item.value.state}
                    </p>
                    <p className={`mt-0.5 text-[10px] ${item.detailTone}`}>{item.value.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="shrink-0 rounded-2xl border border-indigo-200/85 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(239,246,255,0.72)_55%,rgba(238,242,255,0.64))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_30px_-28px_rgba(79,70,229,0.5)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400">Calibration Score</p>
              <div className="mt-1 text-4xl font-bold text-amber-600">
                {ratingFitScore !== null ? ratingFitScore.toFixed(2) : '--'}
              </div>
              <p className="mt-1 text-xs text-emerald-600">
                {analyticsProgress.rating ? `样本 ${ratingRows.length}` : '样本计算中...'}
              </p>

              <div className="mt-2.5 flex items-center justify-between gap-1.5">
                <ExplainHover card={coreMetricGlossary.riskPosture}>
                  <span className={`inline-flex cursor-help items-center rounded-[10px] border px-2 py-0.5 text-[10px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ${riskPosture.badge}`}>
                    <span className="uppercase tracking-[0.06em]">{`Risk Posture · ${riskPosture.label}`}</span>
                  </span>
                </ExplainHover>
                <ExplainHover card={coreMetricGlossary.ci} align="right">
                  <span className="inline-flex cursor-help items-center gap-1 rounded-[10px] border border-emerald-200/90 bg-[linear-gradient(120deg,rgba(236,253,245,0.9),rgba(255,255,255,0.9)_56%,rgba(220,252,231,0.82))] px-2 py-0.5 text-[10px] font-semibold text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <span className="uppercase tracking-[0.06em] text-emerald-500/90">CI</span>
                    <span>{calibrationConfidenceBand !== null ? `±${calibrationConfidenceBand.toFixed(3)}` : '--'}</span>
                  </span>
                </ExplainHover>
              </div>

              <div className="mt-2.5 rounded-xl border border-indigo-100/85 bg-white/78 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                <div className="flex items-center justify-between text-[9.5px] font-semibold uppercase tracking-[0.07em] text-stone-400">
                  <span>Score Band</span>
                  <span>{ratingFitScore !== null ? `${ratingScorePct.toFixed(1)}%` : '--'}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-indigo-100/80">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,rgba(14,165,233,0.92),rgba(99,102,241,0.9)_58%,rgba(139,92,246,0.92))] shadow-[0_3px_10px_-6px_rgba(79,70,229,0.8)]"
                    style={{ width: `${ratingScorePct}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[9px] text-stone-400">
                  <span>0.00</span>
                  <span>target 0.75</span>
                  <span>1.00</span>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                <div className="rounded-lg border border-sky-100/85 bg-sky-50/65 px-2 py-1.5">
                  <ExplainHover card={coreMetricGlossary.closeHit}>
                    <span className="cursor-help text-[9px] uppercase tracking-[0.06em] text-sky-500 decoration-dotted underline decoration-sky-300/80 underline-offset-[2px]">
                      近窗命中
                    </span>
                  </ExplainHover>
                  <p className="mt-0.5 text-xs font-semibold text-sky-700">
                    {ratingDiagnostics.closeHitPct !== null ? `${ratingDiagnostics.closeHitPct}%` : '--'}
                  </p>
                </div>
                <div className="rounded-lg border border-indigo-100/85 bg-indigo-50/70 px-2 py-1.5">
                  <ExplainHover card={coreMetricGlossary.meanAbsErr}>
                    <span className="cursor-help text-[9px] uppercase tracking-[0.06em] text-indigo-500 decoration-dotted underline decoration-indigo-300/80 underline-offset-[2px]">
                      Mean Abs Err
                    </span>
                  </ExplainHover>
                  <p className="mt-0.5 text-xs font-semibold text-indigo-700">
                    {ratingDiagnostics.meanAbsError !== null ? ratingDiagnostics.meanAbsError.toFixed(3) : '--'}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-100/85 bg-emerald-50/70 px-2 py-1.5">
                  <ExplainHover card={coreMetricGlossary.bias}>
                    <span className="cursor-help text-[9px] uppercase tracking-[0.06em] text-emerald-500 decoration-dotted underline decoration-emerald-300/80 underline-offset-[2px]">
                      Bias
                    </span>
                  </ExplainHover>
                  <p className={`mt-0.5 text-xs font-semibold ${ratingDiagnostics.meanBias !== null && ratingDiagnostics.meanBias >= 0 ? 'text-emerald-700' : 'text-rose-500'}`}>
                    {ratingDiagnostics.meanBias !== null ? toSigned(ratingDiagnostics.meanBias, 3) : '--'}
                  </p>
                </div>
                <div className="rounded-lg border border-violet-100/85 bg-violet-50/70 px-2 py-1.5">
                  <ExplainHover card={coreMetricGlossary.r2} align="right">
                    <span className="cursor-help text-[9px] uppercase tracking-[0.06em] text-violet-500 decoration-dotted underline decoration-violet-300/80 underline-offset-[2px]">
                      R²
                    </span>
                  </ExplainHover>
                  <p className="mt-0.5 text-xs font-semibold text-violet-700">
                    {regressionSnapshot.r2 !== null ? `${(regressionSnapshot.r2 * 100).toFixed(1)}%` : '--'}
                  </p>
                </div>
              </div>

              <p className="mt-2.5 text-[10px] leading-4 text-stone-400">
                {ratingScoreDelta === null
                  ? '拟合得分等待样本刷新后自动更新。'
                  : `相对目标 0.75 ${ratingScoreDelta >= 0 ? '领先' : '落后'} ${Math.abs(ratingScoreDelta).toFixed(2)}。`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="glow-card relative overflow-hidden rounded-2xl border border-emerald-100/85 bg-[linear-gradient(145deg,rgba(246,253,250,0.97),rgba(255,255,255,0.95)_48%,rgba(241,246,255,0.9))] p-6 shadow-[0_18px_34px_-30px_rgba(16,185,129,0.42)]">
          <div className="pointer-events-none absolute -top-16 -left-16 h-40 w-40 rounded-full bg-emerald-200/18 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 right-12 h-44 w-44 rounded-full bg-violet-200/14 blur-3xl" />
          <div className="relative">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ConsoleCardIcon IconComp={Wallet} />
                <div>
                  <h3 className="font-semibold text-stone-700 leading-tight">资金与风控</h3>
                  <p className="mt-1 text-[11px] font-medium tracking-[0.03em] text-stone-400">Capital & Risk Controls</p>
                </div>
              </div>
              <span className="inline-flex items-center rounded-[10px] border border-emerald-200/85 bg-[linear-gradient(120deg,rgba(236,253,245,0.9),rgba(255,255,255,0.88)_58%,rgba(224,242,254,0.75))] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
                4 Params
              </span>
            </div>
            <div className="mb-4 h-px bg-gradient-to-r from-emerald-200/80 via-sky-200/70 to-transparent" />

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <div className="relative sm:col-span-3 rounded-2xl border border-emerald-100/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(236,253,245,0.62)_58%,rgba(224,242,254,0.5))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_14px_26px_-24px_rgba(16,185,129,0.42)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-emerald-200/85 bg-white/88 text-emerald-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <Wallet size={14} strokeWidth={1.8} />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-stone-700">初始本金</p>
                    <p className="text-[11px] text-stone-400">Initial Capital</p>
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <span className="text-stone-400 text-sm">¥</span>
                    <input
                      type="number"
                      value={config.initialCapital}
                      onChange={(event) => handleConfigChange('initialCapital', event.target.value)}
                      onBlur={() => {
                        const value = Math.max(0, Number(config.initialCapital || 0))
                        saveSystemConfig({ initialCapital: value })
                      }}
                      className="input-glow w-24 rounded-lg border border-stone-200/85 bg-white/90 px-2.5 py-1.5 text-right text-sm font-semibold text-stone-700"
                    />
                  </div>
                </div>
              </div>

              <div className="relative sm:col-span-2 rounded-2xl border border-sky-100/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(239,246,255,0.66)_58%,rgba(238,242,255,0.56))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_14px_26px_-24px_rgba(59,130,246,0.42)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-sky-200/85 bg-white/88 text-sky-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <ShieldCheck size={14} strokeWidth={1.8} />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-stone-700">风控比例上限</p>
                    <p className="text-[11px] text-stone-400">Risk Cap Ratio</p>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={config.riskCapRatio}
                    onChange={(event) => handleConfigChange('riskCapRatio', event.target.value)}
                    className="input-glow w-24 rounded-lg border border-stone-200/85 bg-white/90 px-2.5 py-1.5 text-right text-sm font-semibold text-stone-700"
                  />
                </div>
              </div>

              <div className="relative sm:col-span-2 rounded-2xl border border-violet-100/85 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(245,243,255,0.7)_58%,rgba(238,242,255,0.58))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_14px_26px_-24px_rgba(139,92,246,0.36)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-violet-200/85 bg-white/88 text-violet-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <LineChart size={14} strokeWidth={1.8} />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-stone-700">默认 Odds</p>
                    <p className="text-[11px] text-stone-400">Default Odds</p>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={config.defaultOdds}
                    onChange={(event) => handleConfigChange('defaultOdds', event.target.value)}
                    className="input-glow w-24 rounded-lg border border-stone-200/85 bg-white/90 px-2.5 py-1.5 text-right text-sm font-semibold text-stone-700"
                  />
                </div>
              </div>

              <div className="relative sm:col-span-3 rounded-2xl border border-amber-100/85 bg-[linear-gradient(145deg,rgba(255,255,255,0.9),rgba(255,251,235,0.72)_58%,rgba(254,242,242,0.5))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_14px_26px_-24px_rgba(245,158,11,0.36)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-amber-200/85 bg-white/88 text-amber-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <AlertTriangle size={14} strokeWidth={1.8} />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-stone-700">最坏回撤二次确认阈值</p>
                    <p className="text-[11px] text-stone-400">Worst Drawdown Confirm (%)</p>
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <input
                      type="number"
                      min="5"
                      max="95"
                      step="1"
                      value={config.maxWorstDrawdownAlertPct}
                      onChange={(event) => handleConfigChange('maxWorstDrawdownAlertPct', event.target.value)}
                      className="input-glow w-24 rounded-lg border border-stone-200/85 bg-white/90 px-2.5 py-1.5 text-right text-sm font-semibold text-stone-700"
                    />
                    <span className="text-stone-400 text-sm">%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <h3 className="font-medium text-stone-700 mb-4 flex items-center gap-2">
            <ConsoleCardIcon IconComp={TrendingUp} /> Kelly 参数
          </h3>
          <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
            <div className="flex items-center justify-between mb-2">
              <div className="cursor-pointer" onClick={openKellyModal}>
                <span className="text-sm text-stone-700">平均 Kelly 分母</span>
                <span className="text-2xl font-bold text-amber-600 ml-3">{recommendedKellyDivisor}</span>
                {(config.kellyAdjustment ?? 0) !== 0 && !config.kellyOverrideEnabled && (
                  <span className={`ml-2 text-sm font-medium ${(config.kellyAdjustment ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {(config.kellyAdjustment ?? 0) >= 0 ? '+' : ''}{config.kellyAdjustment}
                  </span>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const newConfig = { ...config, kellyOverrideEnabled: false, kellyDivisor: recommendedKellyDivisor + (config.kellyAdjustment ?? 0) }
                  setConfig(newConfig)
                  saveSystemConfig(newConfig)
                  setPendingKellyAdjustment(null)
                  setSaveStatus('已保存')
                  setTimeout(() => setSaveStatus(''), 1200)
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  !config.kellyOverrideEnabled
                    ? 'bg-amber-100 text-amber-700 border border-amber-200'
                    : 'bg-stone-100 text-stone-500 border border-stone-200 hover:bg-stone-200'
                }`}
              >
                {!config.kellyOverrideEnabled ? '已选中' : '选择'}
              </button>
            </div>
            <p className="text-xs text-stone-500">基于各 Mode 历史表现加权计算</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-stone-500">微调偏移</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  value={pendingKellyAdjustment ?? config.kellyAdjustment ?? 0}
                  onChange={(e) => {
                    setPendingKellyAdjustment(Number(e.target.value) || 0)
                  }}
                  disabled={config.kellyOverrideEnabled}
                  className={`input-glow w-16 px-2 py-1 text-right text-xs rounded-lg border transition-all ${
                    config.kellyOverrideEnabled ? 'border-stone-200 bg-stone-100 text-stone-400' : 'border-amber-200 bg-white'
                  }`}
                />
                <div className="flex flex-col">
                  <button
                    onClick={() => {
                      if (config.kellyOverrideEnabled) return
                      const currentAdj = pendingKellyAdjustment ?? config.kellyAdjustment ?? 0
                      setPendingKellyAdjustment(Number((currentAdj + 0.5).toFixed(1)))
                    }}
                    disabled={config.kellyOverrideEnabled}
                    className="px-1.5 py-0.5 text-[10px] text-stone-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => {
                      if (config.kellyOverrideEnabled) return
                      const currentAdj = pendingKellyAdjustment ?? config.kellyAdjustment ?? 0
                      setPendingKellyAdjustment(Number((currentAdj - 0.5).toFixed(1)))
                    }}
                    disabled={config.kellyOverrideEnabled}
                    className="px-1.5 py-0.5 text-[10px] text-stone-500 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ▼
                  </button>
                </div>
                {pendingKellyAdjustment !== null && pendingKellyAdjustment !== (config.kellyAdjustment ?? 0) && (
                  <button
                    onClick={() => {
                      const adj = pendingKellyAdjustment
                      const newDivisor = Math.max(1, Number((recommendedKellyDivisor + adj).toFixed(1)))
                      const newConfig = { ...config, kellyAdjustment: adj, kellyDivisor: newDivisor, kellyOverrideEnabled: false }
                      setConfig(newConfig)
                      saveSystemConfig(newConfig)
                      setPendingKellyAdjustment(null)
                      setSaveStatus('已保存')
                      setTimeout(() => setSaveStatus(''), 1200)
                    }}
                    className="ml-2 px-2 py-1 text-[10px] font-medium text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-lg hover:bg-emerald-200 transition-colors"
                  >
                    确认
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-amber-600 mt-2 cursor-pointer hover:text-amber-700" onClick={openKellyModal}>点击查看各 Mode 建议 →</p>
          </div>
          <div className="mt-4 p-3 bg-stone-50 rounded-xl">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-stone-700">手动覆盖</span>
                <p className="text-xs text-stone-400">强制使用固定分母</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleConfigChange('kellyOverrideEnabled', !config.kellyOverrideEnabled)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    config.kellyOverrideEnabled
                      ? 'bg-amber-100 text-amber-700 border border-amber-200'
                      : 'bg-stone-100 text-stone-500 border border-stone-200 hover:bg-stone-200'
                  }`}
                >
                  {config.kellyOverrideEnabled ? '已选中' : '选择'}
                </button>
                <input
                  type="number"
                  step="0.5"
                  value={config.kellyOverrideValue ?? 4}
                  onChange={(event) => handleConfigChange('kellyOverrideValue', event.target.value)}
                  disabled={!config.kellyOverrideEnabled}
                  className={`input-glow w-16 px-2 py-1.5 text-right text-sm rounded-lg border transition-all ${
                    config.kellyOverrideEnabled
                      ? 'border-amber-300 bg-white'
                      : 'border-stone-200 bg-stone-100 text-stone-400'
                  }`}
                />
              </div>
            </div>
            {config.kellyOverrideEnabled && (
              <div className="mt-3 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                <span className="text-xs text-emerald-700">Apply 手动覆盖参数</span>
                <button
                  onClick={() => {
                    const newConfig = { ...config, kellyDivisor: config.kellyOverrideValue }
                    setConfig(newConfig)
                    saveSystemConfig(newConfig)
                    setSaveStatus('已保存')
                    setTimeout(() => setSaveStatus(''), 1200)
                  }}
                  className="px-3 py-1 text-xs font-medium text-emerald-700 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-all"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          {saveStatus && <p className="mt-3 text-xs text-emerald-600 text-center">{saveStatus}</p>}
        </div>
      </div>

      <div className="console-interactive-surface glow-card mt-6 rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50/90 via-white/92 to-cyan-50/82 p-6 backdrop-blur-sm shadow-[0_18px_42px_rgba(56,189,248,0.16),inset_0_1px_0_rgba(255,255,255,0.88)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-sky-200 bg-white/80 text-sky-600">
                <Palette size={14} strokeWidth={1.8} />
              </span>
              <span className="text-xs text-sky-700 font-medium uppercase tracking-[0.1em]">logo customization</span>
              <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-100/70 px-2 py-0.5 text-[10px] text-sky-700 font-semibold">
                GALLERY
              </span>
            </div>
            <h3 className="text-lg font-semibold text-stone-800">个性化Logo · 设计自定义</h3>
            <p className="text-sm text-stone-500 mt-2 max-w-3xl">
              设计精美的个性化logo可供选择；当前以展览馆形式陈列设计稿。默认展示 3 组，点击进入完整 12 组细节。
            </p>
          </div>
          <button
            type="button"
            onClick={openLogoGalleryModal}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white/85 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors"
          >
            展开画廊 <ChevronRight size={14} />
          </button>
        </div>

        <LogoGalleryPreview onOpen={openLogoGalleryModal} />
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mt-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-medium text-stone-700 flex items-center gap-2">
              <span className="text-amber-500">▣</span> Kelly 分母回测台
            </h3>
            <p className="text-xs text-stone-400 mt-1">基于历史已结算样本的分母表现对比（ROI / 回撤 / 胜率，Bootstrap Monte Carlo）</p>
          </div>
          <button
            onClick={() => applyKellyDivisor(kellyBacktest.globalBest?.divisor)}
            disabled={!kellyBacktest.globalBest}
            className="px-3 py-2 rounded-xl text-sm bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            一键应用全局建议
          </button>
        </div>

        {!analyticsProgress.kelly ? (
          <p className="text-sm text-stone-500">Kelly 回测计算中，请稍候...</p>
        ) : !hasKellyBacktest ? (
          <p className="text-sm text-stone-500">暂无可回测样本，请先完成至少 1 笔结算。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2">Kelly 分母</th>
                  <th className="py-2">样本</th>
                  <th className="py-2">模拟次数</th>
                  <th className="py-2">ROI</th>
                  <th className="py-2">胜率</th>
                  <th className="py-2">最大回撤</th>
                  <th className="py-2">综合评分</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {kellyVisibleRows.map((row) => {
                  const isBest = kellyBacktest.globalBest?.divisor === row.divisor
                  return (
                    <tr key={`kelly-${row.divisor}`} className={`border-b border-stone-100 ${isBest ? 'bg-amber-50/50' : ''}`}>
                      <td className="py-2 font-medium text-stone-700">{row.divisor}</td>
                      <td className="py-2 text-stone-600">{row.samples}</td>
                      <td className="py-2 text-stone-500">{row.runs || 0}</td>
                      <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {toSigned(row.roi, 1, '%')}
                      </td>
                      <td className="py-2 text-stone-600">{row.hitRate.toFixed(1)}%</td>
                      <td className="py-2 text-rose-500">-{row.maxDrawdown.toFixed(1)}%</td>
                      <td className={`py-2 font-medium ${row.score >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {toSigned(row.score, 1)}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => applyKellyDivisor(row.divisor)}
                          className="px-2 py-1 rounded-lg text-xs border border-stone-200 text-stone-600 hover:text-amber-700 hover:border-amber-300"
                        >
                          应用
                        </button>
                        {isBest && <span className="ml-2 text-[10px] text-amber-600">推荐</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {hasMoreKellyRows && (
              <div className="mt-2 flex justify-center">
                <button
                  onClick={() => setShowAllKellyRows((prev) => !prev)}
                  className="h-7 px-3 rounded-full text-[11px] border border-amber-200 bg-amber-50/80 text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  {showAllKellyRows ? '收起回测行' : `展开更多（+${kellyBacktest.globalRows.length - 6}）`}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-3">
          {kellyBacktest.modeRecommendations.map((row) => (
            <div key={`mode-kelly-${row.mode}`} className="p-3 rounded-xl bg-stone-50 border border-stone-100">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-stone-700">{row.mode}</span>
                <button
                  onClick={() => applyKellyDivisor(row.best?.divisor)}
                  disabled={!row.best}
                  className="text-[10px] px-2 py-1 rounded-md bg-white border border-stone-200 text-stone-500 hover:text-amber-600 disabled:opacity-40"
                >
                  应用
                </button>
              </div>
              <p className="text-xs text-stone-400 mt-1">建议分母 {row.best?.divisor || '--'}</p>
              <p className={`text-xs mt-1 ${row.best?.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                ROI {row.best ? toSigned(row.best.roi, 1, '%') : '--'} · 回撤 {row.best ? `-${row.best.maxDrawdown.toFixed(1)}%` : '--'} · MC {row.best?.runs || 0}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-stone-400 mt-3">Mode 建议用于参考，可点击“应用”将该分母设为全局。</p>
      </div>

      <div className="flex flex-col">
      <div className="order-5 glow-card relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/30 to-cyan-50/30 p-6 mb-6">
        <div className="pointer-events-none absolute -top-14 -right-8 h-36 w-36 rounded-full bg-indigo-200/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -left-10 h-36 w-36 rounded-full bg-cyan-200/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-medium text-stone-700 flex items-center gap-2">
                <ConsoleCardIcon IconComp={SlidersHorizontal} /> 赛前评分权重
              </h3>
              <p className="text-[11px] text-stone-400 mt-1">用于新建投资与智能组合的评分计算链路</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-stone-400">总权重</p>
              <p className="text-sm font-semibold text-indigo-700">{totalPreMatchWeight.toFixed(2)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            {WEIGHT_FIELDS.map((field, index) => {
              const toneSet = [
                'from-indigo-50/85 to-white border-indigo-100',
                'from-cyan-50/85 to-white border-cyan-100',
                'from-sky-50/85 to-white border-sky-100',
                'from-violet-50/85 to-white border-violet-100',
                'from-emerald-50/85 to-white border-emerald-100',
                'from-amber-50/85 to-white border-amber-100',
              ]
              const tone = toneSet[index % toneSet.length]
              return (
                <div key={field.key} className={`p-3 rounded-xl border bg-gradient-to-br ${tone}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-stone-500 block">{field.label}</label>
                    <span className="text-[10px] text-stone-400">{field.hint}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1.5"
                      value={config[field.key]}
                      onChange={(event) => handleConfigChange(field.key, event.target.value)}
                      className="input-glow w-full px-3 py-2 rounded-lg text-sm text-right border border-white/90 bg-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="order-6 glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={Clock3} /> 时间近因机制
          </h3>
          <span className="text-xs text-stone-400">
            {analyticsProgress.calibration ? `样本 ${calibrationContext.sampleCount} · n=${calibrationContext.n}` : '计算中...'}
          </span>
        </div>
        {!analyticsProgress.calibration ? (
          <p className="text-sm text-stone-500">时间近因与球队校准计算中，请稍候...</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {calibrationContext.bands.map((band) => (
                <div key={band.key} className="p-3 bg-stone-50 rounded-xl border border-stone-200/70">
                  <p className="text-xs text-stone-400">{band.label}</p>
                  <p className="mt-1 text-sm font-semibold text-stone-700">
                    权重 ×{band.weight.toFixed(2)} <span className="text-xs font-normal text-stone-400">· {band.samples} 场</span>
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-xs text-amber-700">Conf 近因校准</p>
                <p className="mt-1 text-lg font-semibold text-amber-700">×{calibrationContext.multipliers.conf.toFixed(2)}</p>
              </div>
              <div className="p-3 bg-sky-50 rounded-xl border border-sky-200">
                <p className="text-xs text-sky-700">FSE 近因校准</p>
                <p className="mt-1 text-lg font-semibold text-sky-700">×{calibrationContext.multipliers.fse.toFixed(2)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
              {calibrationContext.repBuckets.map((bucket) => (
                <div key={bucket.key} className="p-2.5 rounded-lg border border-stone-200 text-xs text-stone-500 bg-white">
                  <p>{bucket.label}</p>
                  <p className="mt-1 text-stone-700">
                    ×{bucket.weight.toFixed(2)} · {bucket.samples} 场
                  </p>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-stone-400 mt-3">
              已启用 REP 方向性降噪：低随机性样本上调权重，高随机性样本降权，避免“运气样本”放大误导。
            </p>
          </>
        )}
      </div>

      <div className="order-1 glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={LineChart} /> 回归分析校准
          </h3>
          <span className="text-xs text-stone-400 px-2 py-1 bg-amber-50 border border-amber-200 rounded">
            加权线性回归 · 应用于实际计算
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-4 bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl border border-violet-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-violet-600 font-medium">回归校准乘数</span>
              <span className="text-xs text-violet-400">Calibration Multiplier</span>
            </div>
            <div className="text-3xl font-bold text-violet-700">
              ×{calibrationContext.regressionMultiplier?.toFixed(3) || '1.000'}
            </div>
            <p className="text-xs text-violet-500 mt-2">
              {calibrationContext.regressionMultiplier > 1.02
                ? '你的 Conf 系统性低估实际表现'
                : calibrationContext.regressionMultiplier < 0.98
                  ? '你的 Conf 系统性高估实际表现'
                  : '你的 Conf 校准良好'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-stone-50 rounded-xl">
              <span className="text-xs text-stone-400 block">斜率 β</span>
              <span className="text-lg font-semibold text-stone-700">
                {calibrationContext.regression?.slope?.toFixed(3) || '1.000'}
              </span>
              <p className="text-[10px] text-stone-400 mt-1">β{'<'}1: 高估 · β{'>'}1: 低估</p>
            </div>
            <div className="p-3 bg-stone-50 rounded-xl">
              <span className="text-xs text-stone-400 block">截距 α</span>
              <span className="text-lg font-semibold text-stone-700">
                {calibrationContext.regression?.intercept?.toFixed(3) || '0.000'}
              </span>
              <p className="text-[10px] text-stone-400 mt-1">理想值接近 0</p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span className="text-xs text-emerald-600 block">R² 拟合度</span>
              <span className="text-lg font-semibold text-emerald-700">
                {((calibrationContext.regression?.r2 || 0) * 100).toFixed(1)}%
              </span>
              <p className="text-[10px] text-emerald-500 mt-1">越高越好</p>
            </div>
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
              <span className="text-xs text-rose-600 block">RMSE</span>
              <span className="text-lg font-semibold text-rose-700">
                {calibrationContext.regression?.rmse?.toFixed(3) || '0.000'}
              </span>
              <p className="text-[10px] text-rose-500 mt-1">越低越好</p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-stone-50 rounded-xl border border-stone-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-stone-700">Conf vs Actual Rating 散点图</span>
            <span className="text-xs text-stone-400">{calibrationContext.scatterData?.length || 0} 个数据点</span>
          </div>
          <div className="h-64 relative">
            <svg viewBox="0 0 400 200" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
              {(() => {
                const data = calibrationContext.scatterData || []
                if (data.length === 0) {
                  return <text x="200" y="100" textAnchor="middle" fill="#a8a29e" fontSize="14">暂无数据</text>
                }

                const padding = { left: 45, right: 20, top: 20, bottom: 35 }
                const width = 400 - padding.left - padding.right
                const height = 200 - padding.top - padding.bottom

                const xMin = 0.1
                const xMax = 0.9
                const yMin = 0.1
                const yMax = 0.9

                const scaleX = (x) => padding.left + ((x - xMin) / (xMax - xMin)) * width
                const scaleY = (y) => padding.top + height - ((y - yMin) / (yMax - yMin)) * height

                const regression = calibrationContext.regression || { slope: 1, intercept: 0 }
                const regLineY1 = regression.intercept + regression.slope * xMin
                const regLineY2 = regression.intercept + regression.slope * xMax

                const getPointColor = (point) => {
                  if (point.recencyBand === 'recent') return '#8b5cf6'
                  if (point.recencyBand === 'mid') return '#a78bfa'
                  return '#c4b5fd'
                }

                return (
                  <>
                    <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + height} stroke="#e7e5e4" strokeWidth="1" />
                    <line x1={padding.left} y1={padding.top + height} x2={padding.left + width} y2={padding.top + height} stroke="#e7e5e4" strokeWidth="1" />

                    {[0.2, 0.4, 0.6, 0.8].map((v) => (
                      <g key={`grid-${v}`}>
                        <line x1={scaleX(v)} y1={padding.top} x2={scaleX(v)} y2={padding.top + height} stroke="#f5f5f4" strokeWidth="1" />
                        <line x1={padding.left} y1={scaleY(v)} x2={padding.left + width} y2={scaleY(v)} stroke="#f5f5f4" strokeWidth="1" />
                        <text x={scaleX(v)} y={padding.top + height + 15} textAnchor="middle" fill="#a8a29e" fontSize="10">{v}</text>
                        <text x={padding.left - 8} y={scaleY(v) + 3} textAnchor="end" fill="#a8a29e" fontSize="10">{v}</text>
                      </g>
                    ))}

                    <line
                      x1={scaleX(xMin)}
                      y1={scaleY(xMin)}
                      x2={scaleX(xMax)}
                      y2={scaleY(xMax)}
                      stroke="#d6d3d1"
                      strokeWidth="1"
                      strokeDasharray="4,4"
                    />

                    <line
                      x1={scaleX(xMin)}
                      y1={scaleY(clamp(regLineY1, yMin, yMax))}
                      x2={scaleX(xMax)}
                      y2={scaleY(clamp(regLineY2, yMin, yMax))}
                      stroke="#8b5cf6"
                      strokeWidth="2"
                    />

                    {data.slice(0, 150).map((point, idx) => (
                      <circle
                        key={idx}
                        cx={scaleX(clamp(point.x, xMin, xMax))}
                        cy={scaleY(clamp(point.y, yMin, yMax))}
                        r={(3 + point.weight * 1.5) * 0.83}
                        fill={getPointColor(point)}
                        fillOpacity={0.6}
                      />
                    ))}

                    <text x={padding.left + width / 2} y={padding.top + height + 28} textAnchor="middle" fill="#78716c" fontSize="11">
                      Expected (Conf)
                    </text>
                    <text x={12} y={padding.top + height / 2} textAnchor="middle" fill="#78716c" fontSize="11" transform={`rotate(-90, 12, ${padding.top + height / 2})`}>
                      Actual Rating
                    </text>
                  </>
                )
              })()}
            </svg>
          </div>
          <div className="flex items-center justify-center gap-6 mt-2 text-xs text-stone-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-violet-500" /> 近 6n 场
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-violet-400" /> 7-11n 场
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-violet-300" /> 12n+ 场
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 border-t-2 border-violet-500" /> 回归线
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 border-t border-dashed border-stone-400" /> y=x
            </span>
          </div>
        </div>

        <p className="text-xs text-stone-400 mt-4 text-center">
          回归校准乘数已自动应用于新建投资的建议金额计算。散点在 y=x 线上方表示实际表现优于预期。
        </p>
      </div>

      <div className="order-3 glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={ShieldCheck} /> 模型收口验证
          </h3>
          <span className={`text-xs px-2 py-1 rounded border ${modelValidationMeta.badge}`}>{modelValidationMeta.label}</span>
        </div>

        {!analyticsProgress.validation ? (
          <p className="text-sm text-stone-500">模型收口验证计算中，请稍候...</p>
        ) : !modelValidation.ready ? (
          <p className="text-sm text-stone-500">{modelValidation.message || '暂无验证结果。'}</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="p-3 bg-stone-50 rounded-xl">
                <ExplainHover card={modelValidationGlossary.sampleCount}>
                  <p className="cursor-help text-xs text-stone-400 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                    样本总量
                  </p>
                </ExplainHover>
                <p className="text-sm font-semibold text-stone-700 mt-1">{modelValidation.sampleCount}</p>
                <p className="text-[11px] text-stone-400 mt-1">
                  Train {modelValidation.trainSamples} · Test {modelValidation.testSamples}
                </p>
              </div>
              <div className="p-3 bg-stone-50 rounded-xl">
                <ExplainHover card={modelValidationGlossary.testBrier}>
                  <p className="cursor-help text-xs text-stone-400 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                    Test Brier
                  </p>
                </ExplainHover>
                <p className="text-sm font-semibold text-stone-700 mt-1">
                  {modelValidation.brier.testRaw.toFixed(4)} → {modelValidation.brier.testCalibrated.toFixed(4)}
                </p>
                <p className={`text-[11px] mt-1 ${modelValidation.brier.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  改善 {toSigned(modelValidation.brier.gainPct, 2, '%')}
                </p>
              </div>
              <div className="p-3 bg-stone-50 rounded-xl">
                <ExplainHover card={modelValidationGlossary.testLogLoss}>
                  <p className="cursor-help text-xs text-stone-400 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                    Test LogLoss
                  </p>
                </ExplainHover>
                <p className="text-sm font-semibold text-stone-700 mt-1">
                  {modelValidation.logLoss.testRaw.toFixed(4)} → {modelValidation.logLoss.testCalibrated.toFixed(4)}
                </p>
                <p className={`text-[11px] mt-1 ${modelValidation.logLoss.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  改善 {toSigned(modelValidation.logLoss.gainPct, 2, '%')}
                </p>
              </div>
              <div className="p-3 bg-stone-50 rounded-xl">
                <ExplainHover card={modelValidationGlossary.drift} align="right">
                  <p className="cursor-help text-xs text-stone-400 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                    稳健性漂移
                  </p>
                </ExplainHover>
                <p className={`text-sm font-semibold mt-1 ${modelValidationMeta.tone}`}>
                  {toSigned(modelValidation.brier.drift, 4)}
                </p>
                <p className="text-[11px] text-stone-400 mt-1">Test-Calibrated Brier - Train-Calibrated Brier</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-xl border border-stone-200 bg-white">
                <ExplainHover card={modelValidationGlossary.kellyRaw}>
                  <p className="cursor-help text-xs text-stone-400 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                    Kelly 策略回测（Raw Conf）
                  </p>
                </ExplainHover>
                <p className={`text-sm font-semibold mt-1 ${modelValidation.strategy.raw.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  ROI {toSigned(modelValidation.strategy.raw.roi, 2, '%')}
                </p>
                <p className="text-[11px] text-stone-400 mt-1">
                  回撤 -{modelValidation.strategy.raw.maxDrawdown.toFixed(2)}% · 样本 {modelValidation.strategy.raw.samples} · MC {modelValidation.strategy.raw.runs || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/40">
                <ExplainHover card={modelValidationGlossary.kellyCalibrated} align="right">
                  <p className="cursor-help text-xs text-amber-700 decoration-dotted underline decoration-amber-300/80 underline-offset-[2px]">
                    Kelly 策略回测（Calibrated Conf）
                  </p>
                </ExplainHover>
                <p className={`text-sm font-semibold mt-1 ${modelValidation.strategy.calibrated.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  ROI {toSigned(modelValidation.strategy.calibrated.roi, 2, '%')}
                </p>
                <p className="text-[11px] text-stone-500 mt-1">
                  回撤 -{modelValidation.strategy.calibrated.maxDrawdown.toFixed(2)}% · 样本 {modelValidation.strategy.calibrated.samples} · MC {modelValidation.strategy.calibrated.runs || 0}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-center justify-between">
                <ExplainHover card={modelValidationGlossary.walkForward}>
                  <p className="cursor-help text-xs text-stone-500 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                    Walk-forward 结果
                  </p>
                </ExplainHover>
                <ExplainHover card={modelValidationGlossary.positiveWindow} align="right">
                  <p className="cursor-help text-xs text-stone-400 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                    正向窗口 {modelValidation.positiveWalkForward}/{modelValidation.walkForward.length}
                  </p>
                </ExplainHover>
              </div>
              {modelValidation.walkForward.length === 0 ? (
                <p className="text-xs text-stone-400 mt-2">样本不足，暂无法构建 walk-forward 窗口。</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {modelValidation.walkForward.map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-xs">
                      <span className="text-stone-500">
                        {row.label} · Train {row.trainSamples} / Test {row.testSamples}
                      </span>
                      <ExplainHover card={modelValidationGlossary.walkForwardGainCard(row)} align="right">
                        <span className={`cursor-help decoration-dotted underline decoration-stone-300/80 underline-offset-[2px] ${row.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          Brier 改善 {toSigned(row.gainPct, 2, '%')}
                        </span>
                      </ExplainHover>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <ExplainHover card={modelValidationGlossary.bootstrap} align="right">
              <p className="mt-2 cursor-help text-[11px] text-stone-400 decoration-dotted underline decoration-stone-300/80 underline-offset-[2px]">
                注：策略回测使用 Bootstrap Monte Carlo（目标 100000 次，按样本量自动做计算预算缩放）。
              </p>
            </ExplainHover>
          </>
        )}
      </div>

      {/* 自适应权重优化 Beta */}
      <div className="order-2">
        <AdaptiveWeightCard config={config} setConfig={setConfig} saveSystemConfig={saveSystemConfig} dataVersion={dataVersion} />
      </div>

      <div className="order-4 glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={SlidersHorizontal} /> 动态校准系数
          </h3>
          <span className="text-xs text-stone-400 px-2 py-1 bg-stone-100 rounded">只读 · 随历史样本自动更新</span>
        </div>

        <div className="grid grid-cols-6 gap-3">
          {factorData.map((item) => (
            <div
              key={item.label}
              onClick={() => setExpandedFactor((prev) => (prev === item.label ? null : item.label))}
              className={`console-interactive-chip p-3 rounded-xl text-center cursor-pointer transition-all ${
                expandedFactor === item.label ? 'bg-amber-100 border-2 border-amber-300' : 'bg-stone-50 hover:bg-amber-50/50'
              }`}
            >
              <span className="text-xs text-stone-400 block">{item.label}</span>
              <div className="flex items-center justify-center gap-1">
                <span className="text-lg font-semibold text-stone-700">{item.value.toFixed(2)}</span>
                <span
                  className={`text-xs ${
                    item.trend === '↑' ? 'text-emerald-500' : item.trend === '↓' ? 'text-rose-500' : 'text-stone-400'
                  }`}
                >
                  {item.trend}
                </span>
              </div>
            </div>
          ))}
        </div>

        {expandedFactor && (
          <div className="mt-6 p-6 bg-stone-50 rounded-xl border border-stone-200 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-medium text-stone-700">{expandedFactor} Factor · 历史走势</h4>
              <div className="flex items-center gap-2">
                {Object.entries(FACTOR_RANGE_CONFIG).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setFactorRange(key)}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                      factorRange === key
                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                        : 'bg-white text-stone-500 border border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left text-stone-500">
                      <th className="py-2">周期</th>
                      <th className="py-2">系数值</th>
                      <th className="py-2">样本数</th>
                      <th className="py-2">变化</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeFactorDetail?.rows || []).length > 0 ? (
                      (activeFactorDetail?.rows || []).map((row) => (
                        <tr key={`${expandedFactor}-${row.period}`} className="border-b border-stone-100">
                          <td className="py-2 text-stone-600">{row.period}</td>
                          <td className="py-2 font-medium text-stone-700">{row.value.toFixed(2)}</td>
                          <td className="py-2 text-stone-400">{row.samples}</td>
                          <td className={`py-2 ${row.delta === null ? 'text-stone-400' : row.delta > 0 ? 'text-emerald-600' : row.delta < 0 ? 'text-rose-500' : 'text-stone-400'}`}>
                            {row.delta === null ? '-' : toSigned(row.delta, 2)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-3 text-xs text-stone-400" colSpan={4}>
                          当前时间范围无有效样本
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <div className="h-40 relative">
                  <svg viewBox="0 0 200 80" className="w-full h-full" preserveAspectRatio="none">
                    {[10, 30, 50, 70].map((y) => (
                      <line key={`${expandedFactor}-${factorRange}-grid-${y}`} x1="20" y1={y} x2="180" y2={y} stroke="#f5f5f4" strokeWidth="1" />
                    ))}
                    <line x1="20" y1="10" x2="20" y2="70" stroke="#e7e5e4" strokeWidth="1" />
                    <line x1="20" y1="70" x2="180" y2="70" stroke="#e7e5e4" strokeWidth="1" />
                    <polyline
                      fill="none"
                      stroke={`url(#${activeFactorDetail?.gradientId || 'factor-fallback-grad'})`}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={activeFactorDetail?.points || ''}
                    />
                    {(activeFactorDetail?.rows || []).map((row, index) => (
                      <circle
                        key={`${expandedFactor}-${factorRange}-${index}`}
                        cx={20 + (index / Math.max((activeFactorDetail?.rows?.length || 1) - 1, 1)) * 160}
                        cy={70 - ((row.value - (activeFactorDetail?.min || 0)) / (activeFactorDetail?.range || 1)) * 60}
                        r="2.8"
                        fill="#f59e0b"
                      />
                    ))}
                    <defs>
                      <linearGradient id={activeFactorDetail?.gradientId || 'factor-fallback-grad'} x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#fbbf24" />
                        <stop offset="100%" stopColor="#f97316" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <div className="flex justify-between text-xs text-stone-400 mt-2 px-1">
                  <span>{activeFactorDetail?.labels?.[0] || '--'}</span>
                  <span>{activeFactorDetail?.labels?.[1] || '--'}</span>
                  <span>{activeFactorDetail?.labels?.[2] || '--'}</span>
                </div>
                <p className="text-[11px] text-stone-400 mt-2">
                  原始样本 {activeFactorDetail?.factor?.sampleCount || 0} 场 · 当前系数 {activeFactorDetail?.factor?.value?.toFixed(2) || '1.00'}
                </p>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-stone-400 mt-4 text-center">
          系数 &gt; 1 代表该因子提升判断质量；系数 &lt; 1 代表该因子应下调权重。
        </p>
      </div>
      </div>

      {/* Layout Mode Toggle */}
      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={LayoutDashboard} /> 界面布局
          </h3>
          <button
            type="button"
            onClick={openThemeSettingsModal}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white/85 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors"
          >
            themes settings <ChevronRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {/* Modern */}
          <button
            onClick={() => {
              saveSystemConfig({ layoutMode: 'modern' })
              localStorage.setItem('dugou:layout-mode', 'modern')
              window.dispatchEvent(new CustomEvent('dugou:layout-changed', { detail: { mode: 'modern' } }))
            }}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              currentLayoutMode === 'modern'
                ? 'border-neutral-900 bg-neutral-50'
                : 'border-stone-200 hover:border-stone-300 bg-stone-50'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-md bg-white border border-neutral-200 flex flex-col overflow-hidden">
                <div className="h-[5px] bg-neutral-900 w-full" />
                <div className="flex-1 bg-neutral-50" />
              </div>
              <span className="text-sm font-medium text-stone-700">Modern</span>
              {currentLayoutMode === 'modern' && (
                <span className="text-[10px] px-2 py-0.5 bg-neutral-900 text-white rounded-full ml-auto">Active</span>
              )}
            </div>
            <p className="text-xs text-stone-400">Vercel-inspired. Clean monochrome, sharp typography, system-native feel.</p>
          </button>
          {/* Topbar */}
          <button
            onClick={() => {
              saveSystemConfig({ layoutMode: 'topbar' })
              localStorage.setItem('dugou:layout-mode', 'topbar')
              window.dispatchEvent(new CustomEvent('dugou:layout-changed', { detail: { mode: 'topbar' } }))
            }}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              currentLayoutMode === 'topbar'
                ? 'border-amber-400 bg-amber-50/50'
                : 'border-stone-200 hover:border-stone-300 bg-stone-50'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-stone-200 flex flex-col overflow-hidden">
                <div className="h-2 bg-amber-400 w-full" />
                <div className="flex-1 bg-stone-100" />
              </div>
              <span className="text-sm font-medium text-stone-700">Topbar</span>
              {currentLayoutMode === 'topbar' && (
                <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full ml-auto">Active</span>
              )}
            </div>
            <p className="text-xs text-stone-400">Glassmorphism topbar with warm amber accents and brand logo.</p>
          </button>
          {/* Sidebar */}
          <button
            onClick={() => {
              saveSystemConfig({ layoutMode: 'sidebar' })
              localStorage.setItem('dugou:layout-mode', 'sidebar')
              window.dispatchEvent(new CustomEvent('dugou:layout-changed', { detail: { mode: 'sidebar' } }))
            }}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              currentLayoutMode === 'sidebar'
                ? 'border-amber-400 bg-amber-50/50'
                : 'border-stone-200 hover:border-stone-300 bg-stone-50'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-stone-200 flex overflow-hidden">
                <div className="w-2 bg-amber-400 h-full" />
                <div className="flex-1 bg-stone-100" />
              </div>
              <span className="text-sm font-medium text-stone-700">Sidebar</span>
              {currentLayoutMode === 'sidebar' && (
                <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full ml-auto">Active</span>
              )}
            </div>
            <p className="text-xs text-stone-400">Collapsible sidebar with vertical navigation. Classic layout.</p>
          </button>
        </div>
        <p className="text-[11px] text-stone-400 mt-3 text-center">Layout changes take effect immediately.</p>
      </div>

      <div
        onClick={openFutureFeaturesModal}
        className="console-interactive-surface glow-card mt-6 rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50/90 via-white/92 to-cyan-50/78 p-6 cursor-pointer backdrop-blur-sm shadow-[0_20px_45px_rgba(56,189,248,0.18),inset_0_1px_0_rgba(255,255,255,0.86)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-sky-200 bg-white/80 text-sky-600">
                <Sparkles size={14} strokeWidth={1.8} />
              </span>
              <span className="text-xs text-sky-700 font-medium uppercase tracking-[0.1em]">Future Iteration</span>
              <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-100/70 px-2 py-0.5 text-[10px] text-sky-700 font-semibold">
                BETA
              </span>
            </div>
            <h3 className="text-lg font-semibold text-stone-800">未来迭代 · 概念版features前瞻</h3>
            <p className="text-sm text-stone-500 mt-2 max-w-3xl">
              装载完整研究原文（Part 4）与十项进阶方向的全量详细解读，支持分层阅读与右向左推出交互。
            </p>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              openFutureFeaturesModal()
            }}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white/85 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors"
          >
            查看详情 <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mt-12 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={Cloud} /> 云端同步（Supabase）
          </h3>
          <span className="text-xs text-stone-400">{syncStatus.enabled ? '已启用' : '未启用'}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-stone-50 rounded-xl">
            <p className="text-xs text-stone-400">环境变量</p>
            <p className={`text-sm font-medium mt-1 ${syncStatus.hasEnv ? 'text-emerald-600' : 'text-rose-500'}`}>
              {syncStatus.hasEnv ? '已配置' : '未配置'}
            </p>
            <p className="text-[11px] text-stone-400 mt-1">需要 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`</p>
          </div>
          <div className="p-3 bg-stone-50 rounded-xl">
            <p className="text-xs text-stone-400">最近同步</p>
            <p className="text-sm font-medium mt-1 text-stone-700">{syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : '--'}</p>
            {syncStatus.lastError ? <p className="text-[11px] text-rose-500 mt-1">{syncStatus.lastError}</p> : <p className="text-[11px] text-emerald-600 mt-1">状态正常</p>}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleToggleCloudSync}
              className={`px-3 py-2 rounded-xl text-sm transition-colors ${
                syncStatus.enabled ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              }`}
            >
              {syncStatus.enabled ? '暂停同步' : '开启同步'}
            </button>
            <button
              onClick={handleCloudSyncNow}
              disabled={!syncStatus.enabled || syncingNow}
              className="px-3 py-2 rounded-xl text-sm bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncingNow ? '同步中...' : '立即同步'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleCloudPull('merge')}
              disabled={!syncStatus.hasEnv || pullingCloud}
              className="px-3 py-2 rounded-xl text-sm bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pullingCloud ? '拉取中...' : '从云端合并拉取'}
            </button>
            <button
              onClick={() => handleCloudPull('replace')}
              disabled={!syncStatus.hasEnv || pullingCloud}
              className="px-3 py-2 rounded-xl text-sm bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              从云端覆盖拉取
            </button>
            {cloudPullStatus && <span className="text-xs text-stone-500">{cloudPullStatus}</span>}
          </div>
        </div>
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={FileSpreadsheet} /> Excel 数据进出
          </h3>
          {excelStatus && <span className="text-xs text-emerald-600">{excelStatus}</span>}
        </div>
        <p className="text-xs text-stone-400 mb-4">支持多 Sheet 导出（Investments / Matches / TeamProfiles / SystemConfig）与导入预览。</p>

        <div className="mb-4 rounded-xl border border-stone-200 bg-stone-50 p-3.5">
          <div className="grid grid-cols-3 gap-3 items-end">
            <label className="text-xs text-stone-500 col-span-1">
              固定导出频率
              <select
                value={normalizeBackupCadence(config.backupCadence)}
                onChange={(event) => handleBackupCadenceChange(event.target.value)}
                className="input-glow mt-1 w-full px-2.5 py-2 rounded-lg border border-stone-200 text-sm text-stone-700"
              >
                {BACKUP_CADENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="col-span-2 text-xs text-stone-500 space-y-1.5">
              <p>
                上次导出：<span className="text-stone-700">{backupSchedule.lastBackupLabel}</span>
              </p>
              <p>
                下次到期：<span className="text-stone-700">{backupSchedule.nextDueLabel}</span>
              </p>
              <p className={backupSchedule.isDue ? 'text-rose-600' : 'text-emerald-600'}>
                {backupSchedule.isDue
                  ? backupSchedule.hasLastBackup
                    ? `已到导出时间（超时约 ${Math.max(1, Math.round(backupSchedule.overdueHours))} 小时）`
                    : '尚未首次导出，建议立即备份'
                  : `距离下次到期约 ${Math.max(1, Math.ceil(backupSchedule.remainingHours))} 小时`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExportExcel}
            className={`btn-secondary btn-hover ${backupSchedule.isDue ? 'ring-2 ring-rose-200 text-rose-600 border-rose-200' : ''}`}
          >
            {backupSchedule.isDue ? '导出 Excel（已到期）' : '导出 Excel'}
          </button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportExcel}
            className="hidden"
          />
          <button onClick={() => excelInputRef.current?.click()} className="btn-primary btn-hover">
            导入 Excel
          </button>
          {excelError && <span className="text-xs text-rose-500">{excelError}</span>}
        </div>

        {excelPreview && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-stone-700">导入预览：{excelPreview.fileName}</p>
                <p className="text-xs text-stone-500 mt-1">
                  投资 {excelPreview.preview.investmentCount} 笔 · 比赛 {excelPreview.preview.matchCount} 场 · 球队 {excelPreview.preview.teamCount} 条
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyExcelImport('merge')}
                  className="px-3 py-1.5 rounded-lg text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                >
                  合并导入
                </button>
                <button
                  onClick={() => handleApplyExcelImport('replace')}
                  className="px-3 py-1.5 rounded-lg text-xs bg-stone-200 text-stone-700 hover:bg-stone-300 transition-colors"
                >
                  覆盖导入
                </button>
                <button
                  onClick={() => setExcelPreview(null)}
                  className="px-2 py-1.5 rounded-lg text-xs text-stone-400 hover:text-stone-600"
                >
                  取消
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-stone-100 bg-white p-3">
                <p className="text-xs text-stone-400 mb-2">投资样本预览</p>
                {(excelPreview.preview.sampleInvestments || []).length > 0 ? (
                  <div className="space-y-1 text-xs text-stone-600">
                    {excelPreview.preview.sampleInvestments.map((row, idx) => (
                      <div key={`inv-preview-${idx}`} className="flex items-center justify-between">
                        <span className="truncate max-w-[160px]">{row.id}</span>
                        <span className="text-stone-400">{row.status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">无可预览记录</p>
                )}
              </div>
              <div className="rounded-lg border border-stone-100 bg-white p-3">
                <p className="text-xs text-stone-400 mb-2">比赛样本预览</p>
                {(excelPreview.preview.sampleMatches || []).length > 0 ? (
                  <div className="space-y-1 text-xs text-stone-600">
                    {excelPreview.preview.sampleMatches.map((row, idx) => (
                      <div key={`match-preview-${idx}`} className="flex items-center justify-between">
                        <span className="truncate max-w-[160px]">{row.match || row.match_text || row.entry_text || row.entry || '-'}</span>
                        <span className="text-stone-400">{row.odds || '-'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-400">无可预览记录</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <ConsoleCardIcon IconComp={Database} /> JSON 数据备份
          </h3>
          {jsonStatus && <span className="text-xs text-emerald-600">{jsonStatus}</span>}
        </div>
        <p className="text-xs text-stone-400 mb-4">完整数据快照（含所有投资记录、系统配置、球队数据）的 JSON 格式导入导出。</p>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleJsonExport} className="btn-secondary btn-hover">
            导出 JSON Backup
          </button>
          <input ref={jsonInputRef} type="file" accept=".json" onChange={handleJsonImportFile} className="hidden" />
          <button onClick={() => jsonInputRef.current?.click()} className="btn-primary btn-hover">
            导入 JSON
          </button>
        </div>
      </div>

      <div className="glow-card mt-12 rounded-2xl border border-sky-100/85 bg-[linear-gradient(160deg,rgba(248,252,255,0.94),rgba(255,255,255,0.94)_50%,rgba(241,249,255,0.88))] p-4 sm:p-5 shadow-[0_18px_34px_-30px_rgba(56,189,248,0.38),inset_0_1px_0_rgba(255,255,255,0.9)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium text-stone-700 flex items-center gap-2">
              <ConsoleCardIcon IconComp={BarChart3} /> 访问记录
            </h3>
            <p className="mt-1 text-[11px] text-stone-400">
              记录全站流量轨迹（含 New / Portfolio / Settle / Dashboard / History / Console 的访问路径）。IP/MAC 在浏览器端通常不可直接读取，默认记为占位。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedAccessMonth}
              onChange={(event) => setSelectedAccessMonth(event.target.value)}
              className="h-8 rounded-xl border border-sky-200/85 bg-white/80 px-2.5 text-[11px] font-medium text-sky-700 outline-none transition-colors hover:border-sky-300 focus:border-sky-300"
            >
              {accessMonthOptions.map((option) => (
                <option key={`access-month-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="inline-flex items-center rounded-xl border border-sky-200/85 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-sky-700">
              page {accessLogPage}/{accessLogTotalPages}
            </span>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-sky-100/90 bg-white/75 px-3 py-2">
            <p className="text-[11px] text-stone-400">总访问</p>
            <p className="mt-0.5 text-sm font-semibold text-stone-700">{accessLogSummary.totalAll}</p>
          </div>
          <div className="rounded-lg border border-sky-100/90 bg-white/75 px-3 py-2">
            <p className="text-[11px] text-stone-400">{formatAccessMonthLabel(selectedAccessMonth)}活跃访问次数</p>
            <p className="mt-0.5 text-sm font-semibold text-stone-700">{accessLogSummary.total}</p>
          </div>
          <div className="rounded-lg border border-sky-100/90 bg-white/75 px-3 py-2">
            <p className="text-[11px] text-stone-400">端分布</p>
            <p className="mt-0.5 text-sm font-semibold text-stone-700">
              D {accessLogSummary.desktopCount} · M {accessLogSummary.mobileCount}
            </p>
          </div>
          <div className="rounded-lg border border-sky-100/90 bg-white/75 px-3 py-2">
            <p className="text-[11px] text-stone-400">最近访问</p>
            <p className="mt-0.5 text-sm font-semibold text-stone-700">
              {accessLogSummary.latest ? formatAccessTime(accessLogSummary.latest.created_at) : '--'}
            </p>
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-sky-100/90 bg-white/78">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-xs text-stone-600">
              <thead className="bg-sky-50/75 text-[10.5px] uppercase tracking-[0.08em] text-stone-400">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Time</th>
                  <th className="px-3 py-2.5 text-left font-medium">Endpoint</th>
                  <th className="px-3 py-2.5 text-left font-medium">Session Duration</th>
                  <th className="px-3 py-2.5 text-left font-medium">Device</th>
                  <th className="px-3 py-2.5 text-left font-medium">Browser / OS</th>
                  <th className="px-3 py-2.5 text-left font-medium">Network</th>
                  <th className="px-3 py-2.5 text-left font-medium">IP / MAC</th>
                  <th className="px-3 py-2.5 text-left font-medium">Session / Referrer</th>
                </tr>
              </thead>
              <tbody>
                {accessLogPageRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-[12px] text-stone-400">
                      当前月份暂无访问记录，访问任意页面后会自动采集。
                    </td>
                  </tr>
                ) : (
                  accessLogPageRows.map((row) => (
                    <tr key={row.id} className="border-t border-sky-100/70">
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <p className="font-medium text-stone-700">{formatAccessTime(row.created_at)}</p>
                        <p className="mt-0.5 text-[11px] text-stone-400">{row.timezone || '--'}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="font-medium text-stone-700">{row.route || '--'}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <p className="font-medium text-stone-700">{accessSessionDeltaMap.get(getAccessRowDurationKey(row)) || '00:00'}</p>
                        <p className="mt-0.5 text-[11px] text-stone-400">delta since prev · total {accessSessionDurationMap.get(row.session_id) || '00:00'}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <p className="font-medium capitalize text-stone-700">{row.device_type || '--'}</p>
                        <p className="mt-0.5 text-[11px] text-stone-400">{row.viewport || '--'}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <p className="font-medium text-stone-700">{row.client_browser || '--'}</p>
                        <p className="mt-0.5 text-[11px] text-stone-400">{row.client_os || '--'}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <p className="font-medium text-stone-700">{row.network_type || '--'}</p>
                        <p className="mt-0.5 text-[11px] text-stone-400">{row.language || '--'}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top whitespace-nowrap">
                        <p className="font-medium text-stone-700">{row.ip || '--'}</p>
                        <p className="mt-0.5 text-[11px] text-stone-400">{row.mac || '--'}</p>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="font-medium text-stone-700 font-mono">{toSessionTail(row.session_id)}</p>
                        <p className="mt-0.5 text-[11px] text-stone-400 truncate max-w-[210px]">{row.referrer || '--'}</p>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {accessLogsByMonth.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-stone-400">
              显示 {(accessLogPage - 1) * ACCESS_LOG_PAGE_SIZE + 1}-{Math.min(accessLogPage * ACCESS_LOG_PAGE_SIZE, accessLogSummary.total)} /{' '}
              {accessLogSummary.total}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAccessLogPage((prev) => Math.max(1, prev - 1))}
                disabled={accessLogPage <= 1}
                className="rounded-lg border border-sky-100 bg-white/80 px-2 py-1 text-[11px] text-stone-500 transition-colors hover:border-sky-200 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Prev
              </button>
              {accessLogPageWindow.map((pageNo) => (
                <button
                  key={`access-page-${pageNo}`}
                  type="button"
                  onClick={() => setAccessLogPage(pageNo)}
                  className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                    pageNo === accessLogPage
                      ? 'border-sky-300 bg-sky-100/80 text-sky-700'
                      : 'border-sky-100 bg-white/80 text-stone-500 hover:border-sky-200 hover:text-sky-700'
                  }`}
                >
                  {pageNo}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAccessLogPage((prev) => Math.min(accessLogTotalPages, prev + 1))}
                disabled={accessLogPage >= accessLogTotalPages}
                className="rounded-lg border border-sky-100 bg-white/80 px-2 py-1 text-[11px] text-stone-500 transition-colors hover:border-sky-200 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
