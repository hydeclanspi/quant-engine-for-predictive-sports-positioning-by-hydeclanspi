import { useEffect, useMemo, useRef, useState } from 'react'
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
import { exportDataBundle, getCloudSyncStatus, getInvestments, getSystemConfig, importDataBundle, pullCloudSnapshotNow, runCloudSyncNow, saveSystemConfig, setCloudSyncEnabled } from '../lib/localData'
import { getPrimaryEntryMarket, normalizeEntryRecord } from '../lib/entryParsing'
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
  const priors = adaptiveConfig.priors || DEFAULT_PRIORS

  // 初始化 tempBounds
  useEffect(() => {
    if (showBoundsEditor && Object.keys(tempBounds).length === 0) {
      setTempBounds(JSON.parse(JSON.stringify(bounds)))
    }
  }, [showBoundsEditor, bounds, tempBounds])

  const handleApplySuggestion = (key, value) => {
    const newConfig = { ...config, [key]: value }
    // 更新 priors 为新值，作为下次优化的起点
    const newAdaptive = {
      ...adaptiveConfig,
      priors: { ...priors, [key]: value },
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
    const newPriors = { ...priors }
    suggestions.suggestions.forEach((s) => {
      if (s.confidence >= 0.5 && Math.abs(s.change) > 0.001) {
        newConfig[s.key] = s.suggested
        newPriors[s.key] = s.suggested
      }
    })
    newConfig.adaptiveWeights = {
      ...adaptiveConfig,
      priors: newPriors,
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
            <span className="text-amber-500">⚡</span> 自适应权重优化
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
  const excelInputRef = useRef(null)

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

  const ratingRows = useMemo(() => getExpectedVsActualRows(240), [dataVersion])
  const modeKellyRows = useMemo(() => getModeKellyRecommendations(), [dataVersion])
  const kellyMatrix = useMemo(() => getKellyDivisorMatrix(), [dataVersion])
  const kellyBacktest = useMemo(() => getKellyDivisorBacktest(), [dataVersion])
  const calibrationContext = useMemo(() => getPredictionCalibrationContext(), [dataVersion])
  const modelValidation = useMemo(() => getModelValidationSnapshot(), [dataVersion])
  const hasKellyBacktest = useMemo(
    () => kellyBacktest.globalRows.some((row) => row.samples > 0),
    [kellyBacktest.globalRows],
  )
  const recommendedKellyDivisor = useMemo(() => {
    if (!modeKellyRows || modeKellyRows.length === 0) return 4
    const totalSamples = modeKellyRows.reduce((sum, row) => sum + (row.samples || 0), 0)
    if (totalSamples === 0) return 4
    const weightedSum = modeKellyRows.reduce((sum, row) => sum + (row.kellyDivisor || 4) * (row.samples || 0), 0)
    return Number((weightedSum / totalSamples).toFixed(1))
  }, [modeKellyRows])
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
              label: '风险',
              tone: 'text-rose-700',
              badge: 'bg-rose-50 border-rose-200 text-rose-700',
            }
          : {
              label: '样本不足',
              tone: 'text-stone-600',
              badge: 'bg-stone-100 border-stone-200 text-stone-600',
            }

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

  return (
    <div className="page-shell page-content-wide">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">参数后台</h2>
        <p className="text-stone-400 text-sm mt-1">系统参数、动态校准系数与 Kelly 分母历史校准</p>
      </div>

      <div onClick={openRatingModal} className="glow-card bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 rounded-2xl p-6 border border-amber-200 mb-6 cursor-pointer">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-600 text-lg">❖</span>
              <span className="text-xs text-amber-600 font-medium uppercase">Core Metric</span>
            </div>
            <h3 className="text-xl font-semibold text-stone-800">Expected vs Actual Judgmental Rating</h3>
            <p className="text-sm text-stone-500 mt-1">系统预期拟合度（点击查看完整历史记录）</p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold text-amber-600">
              {(ratingRows.reduce((sum, row) => sum + (1 - Math.abs(row.diff)), 0) / Math.max(ratingRows.length, 1)).toFixed(2)}
            </div>
            <p className="text-sm text-emerald-600 mt-1">样本 {ratingRows.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <h3 className="font-medium text-stone-700 mb-4 flex items-center gap-2">
            <span className="text-amber-500">◐</span> 资金与风控
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
              <div>
                <span className="text-sm text-stone-700">初始本金</span>
                <p className="text-xs text-stone-400">Initial Capital</p>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-stone-400">¥</span>
                <input
                  type="number"
                  value={config.initialCapital}
                  onChange={(event) => handleConfigChange('initialCapital', event.target.value)}
                  onBlur={() => {
                    const value = Math.max(0, Number(config.initialCapital || 0))
                    saveSystemConfig({ initialCapital: value })
                  }}
                  className="input-glow w-24 px-2 py-1.5 text-right text-sm font-medium rounded-lg border border-stone-200"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
              <div>
                <span className="text-sm text-stone-700">风控比例上限</span>
                <p className="text-xs text-stone-400">Risk Cap Ratio</p>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  value={config.riskCapRatio}
                  onChange={(event) => handleConfigChange('riskCapRatio', event.target.value)}
                  className="input-glow w-24 px-2 py-1.5 text-right text-sm font-medium rounded-lg border border-stone-200"
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
              <div>
                <span className="text-sm text-stone-700">默认 Odds</span>
                <p className="text-xs text-stone-400">Default Odds</p>
              </div>
              <input
                type="number"
                step="0.01"
                value={config.defaultOdds}
                onChange={(event) => handleConfigChange('defaultOdds', event.target.value)}
                className="input-glow w-24 px-2 py-1.5 text-right text-sm font-medium rounded-lg border border-stone-200"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-stone-50 rounded-xl">
              <div>
                <span className="text-sm text-stone-700">最坏回撤二次确认阈值</span>
                <p className="text-xs text-stone-400">Worst Drawdown Confirm (%)</p>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="5"
                  max="95"
                  step="1"
                  value={config.maxWorstDrawdownAlertPct}
                  onChange={(event) => handleConfigChange('maxWorstDrawdownAlertPct', event.target.value)}
                  className="input-glow w-24 px-2 py-1.5 text-right text-sm font-medium rounded-lg border border-stone-200"
                />
                <span className="text-stone-400 text-sm">%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <h3 className="font-medium text-stone-700 mb-4 flex items-center gap-2">
            <span className="text-amber-500">◈</span> Kelly 参数
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

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
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

        {!hasKellyBacktest ? (
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
                {kellyBacktest.globalRows.map((row) => {
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

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <span className="text-amber-500">✶</span> 赛前评分权重
          </h3>
          <span className="text-xs text-stone-400">用于新建投资与智能组合的评分计算链路</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {WEIGHT_FIELDS.map((field) => (
            <div key={field.key} className="p-3 bg-stone-50 rounded-xl">
              <label className="text-xs text-stone-400 mb-1.5 block">{field.label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1.5"
                  value={config[field.key]}
                  onChange={(event) => handleConfigChange(field.key, event.target.value)}
                  className="input-glow w-full px-3 py-2 rounded-lg text-sm text-right border border-stone-200"
                />
              </div>
              <p className="text-[11px] text-stone-400 mt-1">{field.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <span className="text-amber-500">⌛</span> 时间近因机制
          </h3>
          <span className="text-xs text-stone-400">样本 {calibrationContext.sampleCount} · n={calibrationContext.n}</span>
        </div>

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
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <span className="text-amber-500">☁</span> 云端同步（Supabase）
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
            <span className="text-amber-500">⬇</span> Excel 数据进出
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

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <span className="text-amber-500">📈</span> 回归分析校准
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

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <span className="text-amber-500">◎</span> 模型收口验证
          </h3>
          <span className={`text-xs px-2 py-1 rounded border ${modelValidationMeta.badge}`}>{modelValidationMeta.label}</span>
        </div>

        {!modelValidation.ready ? (
          <p className="text-sm text-stone-500">{modelValidation.message || '暂无验证结果。'}</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="p-3 bg-stone-50 rounded-xl">
                <p className="text-xs text-stone-400">样本总量</p>
                <p className="text-sm font-semibold text-stone-700 mt-1">{modelValidation.sampleCount}</p>
                <p className="text-[11px] text-stone-400 mt-1">
                  Train {modelValidation.trainSamples} · Test {modelValidation.testSamples}
                </p>
              </div>
              <div className="p-3 bg-stone-50 rounded-xl">
                <p className="text-xs text-stone-400">Test Brier</p>
                <p className="text-sm font-semibold text-stone-700 mt-1">
                  {modelValidation.brier.testRaw.toFixed(4)} → {modelValidation.brier.testCalibrated.toFixed(4)}
                </p>
                <p className={`text-[11px] mt-1 ${modelValidation.brier.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  改善 {toSigned(modelValidation.brier.gainPct, 2, '%')}
                </p>
              </div>
              <div className="p-3 bg-stone-50 rounded-xl">
                <p className="text-xs text-stone-400">Test LogLoss</p>
                <p className="text-sm font-semibold text-stone-700 mt-1">
                  {modelValidation.logLoss.testRaw.toFixed(4)} → {modelValidation.logLoss.testCalibrated.toFixed(4)}
                </p>
                <p className={`text-[11px] mt-1 ${modelValidation.logLoss.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  改善 {toSigned(modelValidation.logLoss.gainPct, 2, '%')}
                </p>
              </div>
              <div className="p-3 bg-stone-50 rounded-xl">
                <p className="text-xs text-stone-400">稳健性漂移</p>
                <p className={`text-sm font-semibold mt-1 ${modelValidationMeta.tone}`}>
                  {toSigned(modelValidation.brier.drift, 4)}
                </p>
                <p className="text-[11px] text-stone-400 mt-1">Test-Calibrated Brier - Train-Calibrated Brier</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-xl border border-stone-200 bg-white">
                <p className="text-xs text-stone-400">Kelly 策略回测（Raw Conf）</p>
                <p className={`text-sm font-semibold mt-1 ${modelValidation.strategy.raw.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  ROI {toSigned(modelValidation.strategy.raw.roi, 2, '%')}
                </p>
                <p className="text-[11px] text-stone-400 mt-1">
                  回撤 -{modelValidation.strategy.raw.maxDrawdown.toFixed(2)}% · 样本 {modelValidation.strategy.raw.samples} · MC {modelValidation.strategy.raw.runs || 0}
                </p>
              </div>
              <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/40">
                <p className="text-xs text-amber-700">Kelly 策略回测（Calibrated Conf）</p>
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
                <p className="text-xs text-stone-500">Walk-forward 结果</p>
                <p className="text-xs text-stone-400">
                  正向窗口 {modelValidation.positiveWalkForward}/{modelValidation.walkForward.length}
                </p>
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
                      <span className={`${row.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        Brier 改善 {toSigned(row.gainPct, 2, '%')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11px] text-stone-400 mt-2">注：策略回测使用 Bootstrap Monte Carlo（目标 100000 次，按样本量自动做计算预算缩放）。</p>
          </>
        )}
      </div>

      {/* 自适应权重优化 Beta */}
      <AdaptiveWeightCard config={config} setConfig={setConfig} saveSystemConfig={saveSystemConfig} dataVersion={dataVersion} />

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <span className="text-amber-500">◇</span> 动态校准系数
          </h3>
          <span className="text-xs text-stone-400 px-2 py-1 bg-stone-100 rounded">只读 · 随历史样本自动更新</span>
        </div>

        <div className="grid grid-cols-6 gap-3">
          {factorData.map((item) => (
            <div
              key={item.label}
              onClick={() => setExpandedFactor((prev) => (prev === item.label ? null : item.label))}
              className={`p-3 rounded-xl text-center cursor-pointer transition-all ${
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

      {/* Layout Mode Toggle */}
      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700 flex items-center gap-2">
            <span className="text-amber-500">⬡</span> 界面布局
          </h3>
          <span className="text-xs text-stone-400">Navigation Layout Preference</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => {
              saveSystemConfig({ layoutMode: 'topbar' })
              localStorage.setItem('dugou:layout-mode', 'topbar')
              window.dispatchEvent(new CustomEvent('dugou:layout-changed', { detail: { mode: 'topbar' } }))
            }}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              (config.layoutMode || 'topbar') === 'topbar'
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
              {(config.layoutMode || 'topbar') === 'topbar' && (
                <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full ml-auto">Active</span>
              )}
            </div>
            <p className="text-xs text-stone-400">Horizontal navigation at the top. Modern, spacious layout with more content area.</p>
          </button>
          <button
            onClick={() => {
              saveSystemConfig({ layoutMode: 'sidebar' })
              localStorage.setItem('dugou:layout-mode', 'sidebar')
              window.dispatchEvent(new CustomEvent('dugou:layout-changed', { detail: { mode: 'sidebar' } }))
            }}
            className={`p-4 rounded-xl border-2 transition-all text-left ${
              config.layoutMode === 'sidebar'
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
              {config.layoutMode === 'sidebar' && (
                <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full ml-auto">Active</span>
              )}
            </div>
            <p className="text-xs text-stone-400">Vertical navigation on the left. Classic layout with collapsible sidebar.</p>
          </button>
        </div>
        <p className="text-[11px] text-stone-400 mt-3 text-center">Layout changes take effect immediately.</p>
      </div>
    </div>
  )
}
