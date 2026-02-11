import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAnalysisSnapshot, getDashboardSnapshot, getMetricsSnapshot } from '../lib/analytics'
import { getInvestments } from '../lib/localData'
import TimeRangePicker from '../components/TimeRangePicker'

const PERIOD_LABELS = {
  '1w': '近一周',
  '2w': '近两周',
  '1m': '近一月',
  all: '全部',
}

const ANALYSIS_TABS = [
  { id: 'combo', label: '组合策略分析' },
  { id: 'league', label: '联赛分析' },
  { id: 'mode', label: 'Mode 表现分析' },
  { id: 'conf', label: 'Conf 区间分析' },
  { id: 'time', label: '时间近因权重' },
]

const LEAGUE_ORDER = ['英超', '西甲', '意甲', '德甲', '法甲', '荷甲', '葡超', '土超', '沙特联', '国际赛', '其他']

const TEAM_LEAGUE_MAP = {
  曼城: '英超',
  阿森纳: '英超',
  利物浦: '英超',
  切尔西: '英超',
  狼队: '英超',
  桑德兰: '英超',
  热刺: '英超',
  纽卡: '英超',
  曼联: '英超',
  伯恩茅斯: '英超',
  利兹联: '英超',
  水晶宫: '英超',
  埃弗顿: '英超',
  富勒姆: '英超',
  布伦特福德: '英超',
  西汉姆: '英超',
  西汉姆联: '英超',
  伯恩利: '英超',
  诺丁汉森林: '英超',
  阿斯顿维拉: '英超',
  维拉: '英超',
  巴萨: '西甲',
  皇马: '西甲',
  马竞: '西甲',
  黄潜: '西甲',
  阿拉维斯: '西甲',
  那不勒斯: '意甲',
  博洛尼亚: '意甲',
  国际米兰: '意甲',
  热那亚: '意甲',
  米兰: '意甲',
  拜仁: '德甲',
  勒沃库森: '德甲',
  奥格斯堡: '德甲',
  法兰克福: '德甲',
  巴黎: '法甲',
  埃因霍温: '荷甲',
  波尔图: '葡超',
  葡体: '葡超',
  加拉塔萨雷: '土超',
  利雅得新月: '沙特联',
  达马克: '沙特联',
}

const POSITION_META = {
  1: { type: 'Solo Position', sublabel: '单标的持仓', kind: 'single', rank: 1 },
  2: { type: 'Double Position', sublabel: '双标的持仓', kind: 'bundle', rank: 2 },
  3: { type: 'Triple Position', sublabel: '三标的持仓', kind: 'bundle', rank: 3 },
  4: { type: 'Quad Position', sublabel: '四标的持仓', kind: 'bundle', rank: 4 },
}
const MODE_ORDER = ['常规', '常规-稳', '常规-杠杆', '半彩票半保险', '保险产品', '赌一把']
const COMBO_SIZE_BUCKETS = ['2串', '3串', '4串', '5+串']
const ADVANTAGE_CONF_BUCKETS = ['0.8+', '0.7-0.8', '0.6-0.7', '0.5-0.6', '0.4-0.5', '<0.4']
const ADVANTAGE_ODDS_BUCKETS = ['1.0-1.5', '1.5-2.0', '2.0-2.5', '2.5-3.0', '3.0-3.5', '3.5-4.0', '4.0+']
const COMBO_ANALYSIS_FILTER_KEY = 'dugou.combo.analysis_filter.v1'

const CONF_RANGE_ORDER = ['0.8+', '0.7-0.8', '0.6-0.7', '0.5-0.6', '0.4-0.5', '<0.4']

const normalizeMode = (mode) => (mode === '常规-激进' ? '常规-杠杆' : mode || '常规')
const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const calcRoi = (profit, input) => (input > 0 ? (profit / input) * 100 : 0)

const signed = (value, digits = 1, suffix = '') => {
  const num = Number(value || 0)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(digits)}${suffix}`
}

const toRmb = (value, withSign = false) => {
  const num = Number(value || 0)
  if (withSign) {
    const sign = num > 0 ? '+' : num < 0 ? '-' : ''
    return `${sign}¥${Math.round(Math.abs(num))}`
  }
  return `¥${Math.round(Math.abs(num))}`
}

const formatDate = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

const getMomentumTone = (direction) => {
  if (direction === 'up') return 'text-emerald-600'
  if (direction === 'down') return 'text-rose-500'
  return 'text-stone-500'
}

const getMomentumLabel = (direction) => {
  if (direction === 'up') return '上行'
  if (direction === 'down') return '下行'
  return '震荡'
}

const getRangeDays = (periodKey) => {
  if (periodKey === '1w') return 7
  if (periodKey === '2w') return 14
  if (periodKey === '1m') return 30
  return null
}

const getPeriodRange = (periodKey, now = new Date()) => {
  const days = getRangeDays(periodKey)
  if (!days) return null
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

const inRange = (value, range) => {
  if (!range) return true
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return false
  return time >= range.start.getTime() && time <= range.end.getTime()
}

const getEntryText = (match) => {
  if (match?.entry_text) return match.entry_text
  if (Array.isArray(match?.entries)) {
    return match.entries
      .map((entry) => entry?.name)
      .filter(Boolean)
      .join(', ')
  }
  return '-'
}

const getConfRange = (conf) => {
  if (conf >= 0.8) return '0.8+'
  if (conf >= 0.7) return '0.7-0.8'
  if (conf >= 0.6) return '0.6-0.7'
  if (conf >= 0.5) return '0.5-0.6'
  if (conf >= 0.4) return '0.4-0.5'
  return '<0.4'
}

const getComboSizeBucket = (count) => {
  if (count <= 2) return '2串'
  if (count === 3) return '3串'
  if (count === 4) return '4串'
  return '5+串'
}

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
  if (ajr >= 0.6) return 'text-emerald-500'
  return 'text-green-400'
}

const writeComboAnalysisFilter = (payload) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COMBO_ANALYSIS_FILTER_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

const getTeamLeague = (teamName) => {
  const name = String(teamName || '').trim()
  if (!name) return '其他'
  if (/u23/i.test(name)) return '国际赛'
  return TEAM_LEAGUE_MAP[name] || '其他'
}

const formatMatchRecord = (investment, match, allocatedInput, allocatedProfit, statusLabel) => ({
  date: formatDate(investment.created_at),
  match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
  entry: getEntryText(match),
  result: match.results || '-',
  odds: Number.isFinite(Number(match.odds)) ? Number(match.odds).toFixed(2) : '-',
  ajr: Number.isFinite(Number(match.match_rating)) ? Number(match.match_rating).toFixed(2) : '-',
  conf: Number.isFinite(Number(match.conf)) ? Number(match.conf).toFixed(2) : '-',
  roi: signed(calcRoi(allocatedProfit, allocatedInput), 1, '%'),
  amount: toRmb(allocatedProfit, true),
  status: statusLabel,
})

const splitInvestmentToMatches = (investment) => {
  const matches = Array.isArray(investment.matches) ? investment.matches : []
  if (matches.length === 0) return []
  const input = Math.max(0, toNumber(investment.inputs, 0))
  const revenues = Math.max(0, toNumber(investment.revenues, 0))
  const perInput = input / matches.length
  const odds = matches.map((match) => Math.max(0, toNumber(match.odds, 0)))
  const oddsSum = odds.reduce((sum, value) => sum + value, 0)
  const fallbackPerProfit = toNumber(investment.profit, 0) / matches.length

  return matches.map((match, idx) => {
    const weightedRevenue = revenues > 0 && oddsSum > 0 ? (revenues * odds[idx]) / oddsSum : Number.NaN
    const allocatedProfit = Number.isFinite(weightedRevenue) ? weightedRevenue - perInput : fallbackPerProfit
    return {
      ...match,
      allocated_input: perInput,
      allocated_profit: allocatedProfit,
    }
  })
}

const buildAnalysisDeepData = (periodKey) => {
  const range = getPeriodRange(periodKey)
  const investments = getInvestments().filter(
    (item) =>
      !item?.is_archived &&
      inRange(item.created_at, range) &&
      (item.status === 'win' || item.status === 'lose' || Number.isFinite(Number(item.profit))),
  )

  const positionAgg = new Map()
  const positionHistoryData = {}
  const comboAgg = new Map()
  const comboHistoryData = {}
  const comboMatrixAgg = new Map()
  const comboMatrixHistory = {}
  const confAgg = new Map(
    CONF_RANGE_ORDER.map((label) => [
      label,
      {
        range: label,
        samples: 0,
        wins: 0,
        inputs: 0,
        profit: 0,
        expectedSum: 0,
        expectedCount: 0,
        actualSum: 0,
        actualCount: 0,
      },
    ]),
  )
  const confHistoryByRange = Object.fromEntries(CONF_RANGE_ORDER.map((label) => [label, []]))
  const leagueAgg = new Map()
  const leagueHistory = new Map()
  const matchChronoRows = []

  investments.forEach((investment) => {
    const matches = splitInvestmentToMatches(investment)
    if (matches.length === 0) return
    const matchCount = Number(investment.parlay_size || matches.length || 1)
    const meta = POSITION_META[matchCount] || { type: 'Multi Position', sublabel: '多标的持仓', kind: 'bundle', rank: 5 }
    const positionKey = meta.type
    const statusLabel = investment.status === 'win' ? '已中' : investment.status === 'lose' ? '未中' : '待结算'

    if (!positionAgg.has(positionKey)) {
      positionAgg.set(positionKey, {
        type: meta.type,
        sublabel: meta.sublabel,
        rank: meta.rank,
        samples: 0,
        wins: 0,
        inputs: 0,
        profit: 0,
        oddsSum: 0,
        nearMiss: 0,
      })
      positionHistoryData[positionKey] = {
        kind: meta.kind,
        records: [],
      }
    }

    const totalInput = Math.max(0, toNumber(investment.inputs, 0))
    const totalProfit = toNumber(investment.profit, 0)
    const totalOdds = Math.max(1, toNumber(investment.combined_odds, 1))
    const correctCount = matches.filter((match) => match.is_correct === true).length
    const positionRow = positionAgg.get(positionKey)

    positionRow.samples += 1
    positionRow.inputs += totalInput
    positionRow.profit += totalProfit
    positionRow.oddsSum += totalOdds
    if (investment.status === 'win') positionRow.wins += 1
    if (matchCount > 1 && correctCount === matchCount - 1) positionRow.nearMiss += 1

    if (meta.kind === 'single') {
      const firstMatch = matches[0]
      positionHistoryData[positionKey].records.push({
        date: formatDate(investment.created_at),
        match: `${firstMatch.home_team || '-'} vs ${firstMatch.away_team || '-'}`,
        entry: getEntryText(firstMatch),
        result: firstMatch.results || '-',
        odds: Number.isFinite(Number(firstMatch.odds)) ? Number(firstMatch.odds).toFixed(2) : '-',
        ajr: Number.isFinite(Number(firstMatch.match_rating)) ? Number(firstMatch.match_rating).toFixed(2) : '-',
        inputs: toRmb(totalInput),
        roi: signed(calcRoi(totalProfit, totalInput), 1, '%'),
      })
    } else {
      positionHistoryData[positionKey].records.push({
        ticket: investment.id,
        date: formatDate(investment.created_at),
        totalInput: toRmb(totalInput),
        roi: signed(calcRoi(totalProfit, totalInput), 1, '%'),
        status: statusLabel,
        matches: matches.map((match) =>
          formatMatchRecord(investment, match, match.allocated_input, match.allocated_profit, statusLabel),
        ),
      })
    }

    const modeCounts = {}
    matches.forEach((match) => {
      const mode = normalizeMode(match.mode)
      modeCounts[mode] = (modeCounts[mode] || 0) + 1
    })
    const dominantMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '常规'
    const avgConf =
      matches.reduce((sum, match) => sum + clamp(toNumber(match.conf, 0.5), 0.05, 0.95), 0) / Math.max(matches.length, 1)
    const comboKey = `${meta.type} × ${dominantMode} × Conf ${getConfRange(avgConf)}`

    if (!comboAgg.has(comboKey)) {
      comboAgg.set(comboKey, {
        combo: comboKey,
        samples: 0,
        wins: 0,
        inputs: 0,
        profit: 0,
      })
      comboHistoryData[comboKey] = []
    }

    const comboRow = comboAgg.get(comboKey)
    comboRow.samples += 1
    comboRow.inputs += totalInput
    comboRow.profit += totalProfit
    if (investment.status === 'win') comboRow.wins += 1

    const comboBundleRecord = {
      ticket: investment.id,
      date: formatDate(investment.created_at),
      totalInput: toRmb(totalInput),
      roi: signed(calcRoi(totalProfit, totalInput), 1, '%'),
      status: statusLabel,
      matches: matches.map((match) =>
        formatMatchRecord(investment, match, match.allocated_input, match.allocated_profit, statusLabel),
      ),
    }

    comboHistoryData[comboKey].push(comboBundleRecord)

    if (matchCount >= 2) {
      const sizeBucket = getComboSizeBucket(matchCount)
      const matrixKey = `${sizeBucket}|${dominantMode}`
      if (!comboMatrixAgg.has(matrixKey)) {
        comboMatrixAgg.set(matrixKey, {
          sizeBucket,
          mode: dominantMode,
          samples: 0,
          wins: 0,
          inputs: 0,
          profit: 0,
        })
        comboMatrixHistory[matrixKey] = []
      }

      const matrixCell = comboMatrixAgg.get(matrixKey)
      matrixCell.samples += 1
      matrixCell.inputs += totalInput
      matrixCell.profit += totalProfit
      if (investment.status === 'win') matrixCell.wins += 1
      comboMatrixHistory[matrixKey].push(comboBundleRecord)
    }

    matches.forEach((match) => {
      const conf = toNumber(match.conf, Number.NaN)
      const ajr = toNumber(match.match_rating, Number.NaN)
      const odds = toNumber(match.odds, Number.NaN)
      const confRange = Number.isFinite(conf) ? getConfRange(conf) : '<0.4'
      const confRow = confAgg.get(confRange)
      if (confRow) {
        confRow.samples += 1
        confRow.inputs += match.allocated_input
        confRow.profit += match.allocated_profit
        if (match.is_correct === true) confRow.wins += 1
        if (Number.isFinite(conf)) {
          confRow.expectedSum += conf
          confRow.expectedCount += 1
        }
        if (Number.isFinite(ajr)) {
          confRow.actualSum += ajr
          confRow.actualCount += 1
        }
      }

      confHistoryByRange[confRange]?.push(
        formatMatchRecord(investment, match, match.allocated_input, match.allocated_profit, statusLabel),
      )

      const homeLeague = getTeamLeague(match.home_team)
      const awayLeague = getTeamLeague(match.away_team)
      const league = homeLeague === '其他' ? awayLeague : homeLeague

      if (!leagueAgg.has(league)) {
        leagueAgg.set(league, {
          league,
          samples: 0,
          wins: 0,
          inputs: 0,
          profit: 0,
          ajrSum: 0,
          ajrCount: 0,
        })
        leagueHistory.set(league, [])
      }

      const leagueRow = leagueAgg.get(league)
      leagueRow.samples += 1
      leagueRow.inputs += match.allocated_input
      leagueRow.profit += match.allocated_profit
      if (match.is_correct === true) leagueRow.wins += 1
      if (Number.isFinite(ajr)) {
        leagueRow.ajrSum += ajr
        leagueRow.ajrCount += 1
      }

      leagueHistory.get(league)?.push(formatMatchRecord(investment, match, match.allocated_input, match.allocated_profit, statusLabel))

      matchChronoRows.push({
        created_at: investment.created_at,
      })
    })
  })

  const positionRows = [...positionAgg.values()]
    .map((row) => ({
      ...row,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      avgOdds: row.samples > 0 ? row.oddsSum / row.samples : 0,
      partial: row.rank > 1 ? `${row.rank}/${row.rank - 1}中: ${row.nearMiss}/${row.samples}` : null,
    }))
    .sort((a, b) => a.rank - b.rank)

  const maxPositionRoi = positionRows.length > 0 ? Math.max(...positionRows.map((row) => row.roi)) : -Infinity
  const positionRowsWithBest = positionRows.map((row) => ({
    ...row,
    best: row.roi === maxPositionRoi,
  }))

  const comboRows = [...comboAgg.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      combo: row.combo,
      samples: row.samples,
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      roi: calcRoi(row.profit, row.inputs),
    }))
    .sort((a, b) => b.roi - a.roi || b.samples - a.samples)
    .slice(0, 6)

  const comboMatrixRows = COMBO_SIZE_BUCKETS.map((sizeBucket) => ({
    sizeBucket,
    cells: MODE_ORDER.map((mode) => {
      const key = `${sizeBucket}|${mode}`
      const row = comboMatrixAgg.get(key)
      if (!row) {
        return {
          key,
          sizeBucket,
          mode,
          samples: 0,
          roi: 0,
          hitRate: 0,
          hasData: false,
        }
      }
      return {
        key,
        sizeBucket,
        mode,
        samples: row.samples,
        roi: calcRoi(row.profit, row.inputs),
        hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
        hasData: true,
      }
    }),
  }))

  const confRows = CONF_RANGE_ORDER.map((range) => confAgg.get(range))
    .filter((row) => row && row.samples > 0)
    .map((row) => {
      const expected = row.expectedCount > 0 ? row.expectedSum / row.expectedCount : 0
      const actual = row.actualCount > 0 ? row.actualSum / row.actualCount : 0
      return {
        range: row.range,
        expected,
        actual,
        diff: actual - expected,
        samples: row.samples,
      }
    })

  const leagueRows = [...leagueAgg.values()]
    .map((row) => ({
      league: row.league,
      samples: row.samples,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      avgAjr: row.ajrCount > 0 ? row.ajrSum / row.ajrCount : Number.NaN,
      history: (leagueHistory.get(row.league) || []).sort((a, b) => (a.date < b.date ? 1 : -1)),
    }))
    .sort((a, b) => {
      const orderA = LEAGUE_ORDER.indexOf(a.league)
      const orderB = LEAGUE_ORDER.indexOf(b.league)
      const normalizedA = orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA
      const normalizedB = orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB
      return normalizedA - normalizedB || b.samples - a.samples
    })

  const sortedMatches = matchChronoRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const totalMatchSamples = sortedMatches.length
  const n = Math.max(1, Math.floor(totalMatchSamples / 50))
  const recentWindow = 6 * n
  const middleWindow = 5 * n
  const recentCount = Math.min(totalMatchSamples, recentWindow)
  const middleCount = Math.min(Math.max(totalMatchSamples - recentWindow, 0), middleWindow)
  const oldCount = Math.max(totalMatchSamples - recentWindow - middleWindow, 0)

  const timeWeights = [
    { period: `最近 ${recentWindow} 场`, weight: '1.4x', count: recentCount, highlight: true },
    { period: `第 ${7 * n}~${11 * n} 场`, weight: '1.15x', count: middleCount, highlight: false },
    { period: `第 ${12 * n}+ 场`, weight: '1.0x', count: oldCount, highlight: false },
  ]

  Object.values(positionHistoryData).forEach((detail) => {
    detail.records.sort((a, b) => (a.date < b.date ? 1 : -1))
  })
  Object.keys(comboHistoryData).forEach((key) => {
    comboHistoryData[key].sort((a, b) => (a.date < b.date ? 1 : -1))
  })
  Object.keys(comboMatrixHistory).forEach((key) => {
    comboMatrixHistory[key].sort((a, b) => (a.date < b.date ? 1 : -1))
  })
  Object.keys(confHistoryByRange).forEach((key) => {
    confHistoryByRange[key].sort((a, b) => (a.date < b.date ? 1 : -1))
  })

  return {
    positionRows: positionRowsWithBest,
    positionHistoryData,
    comboRows,
    comboHistoryData,
    comboMatrixRows,
    comboMatrixHistory,
    confRows,
    confHistoryByRange,
    leagueRows,
    timeWeights,
    totalMatchSamples,
  }
}

const ModalPagination = ({ page, totalPages, onChange }) => (
  <div className="pt-3 border-t border-stone-200">
    <div className="flex items-center justify-between">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className={`px-3 py-1.5 rounded-lg text-xs ${page === 1 ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'}`}
      >
        ← 上一页
      </button>
      <span className="text-xs text-stone-400">
        第 {page} / {totalPages} 页
      </span>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className={`px-3 py-1.5 rounded-lg text-xs ${page === totalPages ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'}`}
      >
        下一页 →
      </button>
    </div>
  </div>
)

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
      <ModalPagination page={currentPage} totalPages={totalPages} onChange={setPage} />
    </div>
  )
}

const BundleUnitCards = ({ records }) => (
  <div className="space-y-3">
    {records.map((unit, idx) => (
      <div key={`${unit.ticket}-${idx}`} className="p-4 rounded-xl border border-stone-100 bg-stone-50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-stone-700">{unit.ticket}</p>
            <p className="text-xs text-stone-400">
              {unit.date} · 投入 {unit.totalInput}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-sm font-semibold ${unit.roi.startsWith('+') ? 'text-emerald-600' : 'text-rose-500'}`}>{unit.roi}</p>
            <p className="text-[10px] text-stone-400">{unit.status}</p>
          </div>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-stone-100 text-left text-stone-500">
                <th className="py-2">比赛</th>
                <th className="py-2">entry</th>
                <th className="py-2">result</th>
                <th className="py-2">赔率</th>
                <th className="py-2">AJR</th>
              </tr>
            </thead>
            <tbody>
              {unit.matches.map((match, matchIdx) => (
                <tr key={`${match.match}-${matchIdx}`} className="border-b border-stone-100/70">
                  <td className="py-2 text-stone-700">{match.match}</td>
                  <td className="py-2 text-stone-600">{match.entry}</td>
                  <td className="py-2 text-stone-500">{match.result}</td>
                  <td className="py-2 text-violet-600 italic font-semibold">{match.odds}</td>
                  <td className={`py-2 font-semibold ${getAJRColor(match.ajr)}`}>{match.ajr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ))}
  </div>
)

export default function AnalysisPage({ openModal }) {
  const navigate = useNavigate()
  const [analysisTab, setAnalysisTab] = useState('combo')
  const [expandedLeague, setExpandedLeague] = useState(null)
  const [leaguePages, setLeaguePages] = useState({})
  const [timePeriod, setTimePeriod] = useState('all')
  const [advantageMode, setAdvantageMode] = useState(MODE_ORDER[0])

  const baseSnapshot = useMemo(() => getAnalysisSnapshot(timePeriod), [timePeriod])
  const dashboardSnapshot = useMemo(() => getDashboardSnapshot(timePeriod), [timePeriod])
  const metricsSnapshot = useMemo(() => getMetricsSnapshot(timePeriod), [timePeriod])
  const deepData = useMemo(() => buildAnalysisDeepData(timePeriod), [timePeriod])
  const hasAnyData =
    deepData.totalMatchSamples > 0 || baseSnapshot.modeData.length > 0 || baseSnapshot.strategyData.length > 0
  const momentumSummary = useMemo(() => {
    const momentum = dashboardSnapshot?.momentum || {}
    const streaks = dashboardSnapshot?.streaks || {}
    const currentType = streaks.currentType || 'none'
    const currentLength = Number(streaks.currentLength || 0)
    const streakLabel =
      currentType === 'win' && currentLength > 0
        ? `连胜 ${currentLength}`
        : currentType === 'lose' && currentLength > 0
          ? `连败 ${currentLength}`
          : '暂无连续性'

    const recommendation =
      momentum.direction === 'up'
        ? '可维持主推仓位，次推小幅增配'
        : momentum.direction === 'down'
          ? '建议降低高赔率暴露，回归稳健仓位'
          : '维持当前结构，等待新的方向确认'

    return {
      streakLabel,
      direction: momentum.direction || 'flat',
      strength: momentum.strength || 'mild',
      roiDelta: Number(momentum.roiDelta || 0),
      hitRateDelta: Number(momentum.hitRateDelta || 0),
      recentRoi: Number(momentum.recentRoi || 0),
      baseRoi: Number(momentum.baseRoi || 0),
      recentHitRate: Number(momentum.recentHitRate || 0),
      baseHitRate: Number(momentum.baseHitRate || 0),
      recentSamples: Number(momentum.recentSamples || 0),
      baseSamples: Number(momentum.baseSamples || 0),
      recommendation,
    }
  }, [dashboardSnapshot?.momentum, dashboardSnapshot?.streaks])

  const advantageModes = useMemo(() => {
    const modeSet = new Set((metricsSnapshot.matchRows || []).map((row) => row.mode))
    const ordered = MODE_ORDER.filter((mode) => modeSet.has(mode))
    return ordered.length > 0 ? ordered : MODE_ORDER
  }, [metricsSnapshot.matchRows])

  useEffect(() => {
    if (!advantageModes.includes(advantageMode)) {
      setAdvantageMode(advantageModes[0] || MODE_ORDER[0])
    }
  }, [advantageMode, advantageModes])

  const advantageCellMap = useMemo(() => {
    const map = new Map()
    ;(metricsSnapshot.matchRows || []).forEach((row) => {
      const mode = row.mode || '常规'
      const confBucket = row.confBucket || '<0.4'
      const oddsBucket = row.oddsBucket || 'unknown'
      if (!ADVANTAGE_CONF_BUCKETS.includes(confBucket)) return
      if (!ADVANTAGE_ODDS_BUCKETS.includes(oddsBucket)) return
      const key = `${mode}|${confBucket}|${oddsBucket}`
      if (!map.has(key)) {
        map.set(key, {
          mode,
          confBucket,
          oddsBucket,
          samples: 0,
          wins: 0,
          inputs: 0,
          profit: 0,
        })
      }
      const cell = map.get(key)
      cell.samples += 1
      cell.inputs += Number(row.allocatedInput || 0)
      cell.profit += Number(row.allocatedProfit || 0)
      if (row.isCorrect) cell.wins += 1
    })
    return map
  }, [metricsSnapshot.matchRows])

  const getAdvantageCell = (mode, confBucket, oddsBucket) => {
    const cell = advantageCellMap.get(`${mode}|${confBucket}|${oddsBucket}`)
    if (!cell) {
      return {
        mode,
        confBucket,
        oddsBucket,
        samples: 0,
        roi: 0,
        hitRate: 0,
        hasData: false,
      }
    }
    return {
      ...cell,
      roi: calcRoi(cell.profit, cell.inputs),
      hitRate: cell.samples > 0 ? (cell.wins / cell.samples) * 100 : 0,
      hasData: true,
    }
  }

  const advantageHighlights = useMemo(() => {
    const cells = []
    ADVANTAGE_CONF_BUCKETS.forEach((confBucket) => {
      ADVANTAGE_ODDS_BUCKETS.forEach((oddsBucket) => {
        const cell = getAdvantageCell(advantageMode, confBucket, oddsBucket)
        if (cell.hasData) cells.push(cell)
      })
    })
    const filtered = cells.filter((cell) => cell.samples >= 2)
    const sorted = [...filtered].sort((a, b) => b.roi - a.roi || b.samples - a.samples)
    return {
      top: sorted.slice(0, 3),
      bottom: sorted.slice(-3).reverse(),
    }
  }, [advantageCellMap, advantageMode])

  useEffect(() => {
    if (!expandedLeague && deepData.leagueRows.length > 0) {
      setExpandedLeague(deepData.leagueRows[0].league)
    }
  }, [deepData.leagueRows, expandedLeague])

  const getLeaguePage = (leagueName) => leaguePages[leagueName] || 1
  const setLeaguePage = (leagueName, page) =>
    setLeaguePages((prev) => ({
      ...prev,
      [leagueName]: page,
    }))

  const openPositionHistoryDetail = (positionType) => {
    if (!openModal) return
    const detail = deepData.positionHistoryData[positionType]
    if (!detail) return

    const PositionHistoryDetailContent = () => {
      const [page, setPage] = useState(1)
      if (detail.kind === 'single') {
        const pageSize = 6
        const totalPages = Math.max(1, Math.ceil(detail.records.length / pageSize))
        const currentPage = Math.min(page, totalPages)
        const rows = detail.records.slice((currentPage - 1) * pageSize, currentPage * pageSize)
        return (
          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="py-2">日期</th>
                  <th className="py-2">比赛</th>
                  <th className="py-2">entry</th>
                  <th className="py-2">result</th>
                  <th className="py-2">赔率</th>
                  <th className="py-2">AJR</th>
                  <th className="py-2">投入</th>
                  <th className="py-2">ROI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={`${row.match}-${idx}`} className="border-b border-stone-100">
                    <td className="py-2 text-stone-500">{row.date}</td>
                    <td className="py-2 text-stone-700">{row.match}</td>
                    <td className="py-2 text-stone-600">{row.entry}</td>
                    <td className="py-2 text-stone-500">{row.result}</td>
                    <td className="py-2 text-violet-600 italic font-semibold">{row.odds}</td>
                    <td className={`py-2 font-semibold ${getAJRColor(row.ajr)}`}>{row.ajr}</td>
                    <td className="py-2 text-amber-700">{row.inputs}</td>
                    <td className={`py-2 font-medium ${row.roi.startsWith('+') ? 'text-emerald-600' : 'text-rose-500'}`}>{row.roi}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ModalPagination page={currentPage} totalPages={totalPages} onChange={setPage} />
          </div>
        )
      }

      const pageSize = 2
      const totalPages = Math.max(1, Math.ceil(detail.records.length / pageSize))
      const currentPage = Math.min(page, totalPages)
      const rows = detail.records.slice((currentPage - 1) * pageSize, currentPage * pageSize)

      return (
        <div className="space-y-4">
          <BundleUnitCards records={rows} />
          <ModalPagination page={currentPage} totalPages={totalPages} onChange={setPage} />
        </div>
      )
    }

    openModal({
      title: `${positionType} · 投资历史明细`,
      content: <PositionHistoryDetailContent />,
    })
  }

  const openComboHistoryDetail = (comboKey) => {
    if (!openModal) return
    const records = deepData.comboHistoryData[comboKey] || []

    const ComboHistoryDetailContent = () => {
      const [page, setPage] = useState(1)
      const pageSize = 2
      const totalPages = Math.max(1, Math.ceil(records.length / pageSize))
      const currentPage = Math.min(page, totalPages)
      const rows = records.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      return (
        <div className="space-y-4">
          <BundleUnitCards records={rows} />
          <ModalPagination page={currentPage} totalPages={totalPages} onChange={setPage} />
        </div>
      )
    }

    openModal({
      title: `${comboKey} · 配置历史明细`,
      content: <ComboHistoryDetailContent />,
    })
  }

  const openAdvantageCellDetail = (cell) => {
    if (!openModal || !cell?.hasData) return
    const rows = (metricsSnapshot.matchRows || []).filter(
      (row) => row.mode === cell.mode && row.confBucket === cell.confBucket && row.oddsBucket === cell.oddsBucket,
    )
    openModal({
      title: `${cell.mode} · Conf ${cell.confBucket} × Odds ${cell.oddsBucket}`,
      content: <PaginatedMatchTable rows={rows} />,
    })
  }

  const applyAdvantageFilterToCombo = (cell) => {
    if (!cell?.hasData) return
    writeComboAnalysisFilter({
      source: 'analysis-advantage',
      mode: cell.mode,
      confBucket: cell.confBucket,
      oddsBucket: cell.oddsBucket,
      createdAt: new Date().toISOString(),
    })
    navigate('/combo')
  }

  const openComboMatrixDetail = (cell) => {
    if (!openModal || !cell?.hasData) return
    const key = `${cell.sizeBucket}|${cell.mode}`
    const records = deepData.comboMatrixHistory[key] || []

    const ComboMatrixDetailContent = () => {
      const [page, setPage] = useState(1)
      const pageSize = 2
      const totalPages = Math.max(1, Math.ceil(records.length / pageSize))
      const currentPage = Math.min(page, totalPages)
      const rows = records.slice((currentPage - 1) * pageSize, currentPage * pageSize)

      return (
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between">
            <span className="text-sm text-stone-700">
              {cell.sizeBucket} × {cell.mode}
            </span>
            <span className="text-xs text-stone-500">
              {cell.samples} 样本 · ROI {signed(cell.roi, 1, '%')} · 命中率 {cell.hitRate.toFixed(1)}%
            </span>
          </div>
          <BundleUnitCards records={rows} />
          <ModalPagination page={currentPage} totalPages={totalPages} onChange={setPage} />
        </div>
      )
    }

    openModal({
      title: `${cell.sizeBucket} × ${cell.mode} · 串关配置历史`,
      content: <ComboMatrixDetailContent />,
    })
  }

  const openConfRangeDetail = (confRange) => {
    if (!openModal) return
    const rows = deepData.confHistoryByRange[confRange] || []

    const ConfRangeHistoryDetailContent = () => {
      const [page, setPage] = useState(1)
      const pageSize = 6
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
      const currentPage = Math.min(page, totalPages)
      const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-200">
            <span className="text-sm font-medium text-stone-700">Conf 区间 {confRange}</span>
            <span className="text-xs text-stone-500">{rows.length} 条样本</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">日期</th>
                <th className="py-2">比赛</th>
                <th className="py-2">entry</th>
                <th className="py-2">result</th>
                <th className="py-2">Conf</th>
                <th className="py-2">AJR</th>
                <th className="py-2">ROI</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => (
                <tr key={`${row.match}-${idx}`} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="py-2 text-stone-500">{row.date}</td>
                  <td className="py-2 text-stone-700">{row.match}</td>
                  <td className="py-2 text-stone-600">{row.entry}</td>
                  <td className="py-2 text-stone-500">{row.result}</td>
                  <td className={`py-2 font-semibold ${getConfColor(row.conf)}`}>{row.conf}</td>
                  <td className={`py-2 font-semibold ${getAJRColor(row.ajr)}`}>{row.ajr}</td>
                  <td className={`py-2 font-medium ${row.roi.startsWith('+') ? 'text-emerald-600' : 'text-rose-500'}`}>{row.roi}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ModalPagination page={currentPage} totalPages={totalPages} onChange={setPage} />
        </div>
      )
    }

    openModal({
      title: `Conf ${confRange} · 样本历史明细`,
      content: <ConfRangeHistoryDetailContent />,
    })
  }

  const openModeHistoryDetail = (mode) => {
    if (!openModal) return
    const rows = (metricsSnapshot.matchRows || [])
      .filter((row) => row.mode === mode)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const ModeHistoryDetailContent = () => {
      const [page, setPage] = useState(1)
      const pageSize = 8
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
      const currentPage = Math.min(page, totalPages)
      const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

      if (rows.length === 0) {
        return <p className="text-sm text-stone-500">当前窗口该 Mode 暂无样本。</p>
      }

      return (
        <div className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2">日期</th>
                <th className="py-2">比赛</th>
                <th className="py-2">Conf</th>
                <th className="py-2">AJR</th>
                <th className="py-2">Odds</th>
                <th className="py-2">REP</th>
                <th className="py-2">ROI</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id} className="border-b border-stone-100">
                  <td className="py-2 text-stone-500">{row.dateLabel}</td>
                  <td className="py-2 text-stone-700">{row.match}</td>
                  <td className={`py-2 font-medium ${getConfColor(row.conf)}`}>{Number.isFinite(row.conf) ? row.conf.toFixed(2) : '-'}</td>
                  <td className={`py-2 font-medium ${getAJRColor(row.ajr)}`}>{Number.isFinite(row.ajr) ? row.ajr.toFixed(2) : '-'}</td>
                  <td className="py-2 text-violet-600 italic font-semibold">{Number.isFinite(row.odds) ? row.odds.toFixed(2) : '-'}</td>
                  <td className="py-2 text-stone-600">{Number.isFinite(row.rep) ? row.rep.toFixed(2) : '-'}</td>
                  <td className={`py-2 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ModalPagination page={currentPage} totalPages={totalPages} onChange={setPage} />
        </div>
      )
    }

    openModal({
      title: `${mode} · 历史样本明细`,
      content: <ModeHistoryDetailContent />,
    })
  }

  return (
    <div className="page-shell page-content-wide">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-stone-800 font-display">深度分析</h2>
          <p className="text-stone-400 text-sm mt-1">多维度投资表现洞察</p>
        </div>
        <TimeRangePicker value={timePeriod} onChange={setTimePeriod} options={PERIOD_LABELS} />
      </div>

      {!hasAnyData && (
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-4">
          <h3 className="text-lg font-semibold text-stone-800 mb-2">当前时间窗口暂无可分析样本</h3>
          <p className="text-sm text-stone-500 mb-4">先新建投资并完成结算，系统会自动生成组合、联赛、Mode 与 Conf 的分析层。</p>
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

      <div className="flex gap-2 mb-6">
        {ANALYSIS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setAnalysisTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm transition-all btn-hover ${
              analysisTab === tab.id ? 'bg-amber-100 text-amber-700 font-medium' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {analysisTab === 'combo' && (
        <div className="space-y-4">
          <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-stone-700">最优组合发现</h3>
              <span className="text-xs text-stone-400">点选某个配置查看近期记录</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {deepData.comboRows.map((row) => (
                <div
                  key={row.combo}
                  onClick={() => openComboHistoryDetail(row.combo)}
                  className="p-4 rounded-xl bg-stone-50 hover:bg-amber-50 transition-all cursor-pointer lift-card border border-stone-100"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-stone-700">{row.combo}</span>
                    <span className={`text-lg font-semibold ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {signed(row.roi, 1, '%')}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs text-stone-500">
                    <span>{row.samples} 样本</span>
                    <span>命中率 {row.hitRate.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-stone-700">不同 Position 表现对比</h3>
              <span className="text-xs text-stone-400">点选某个 Position 查看历史</span>
            </div>
            <div className="space-y-3">
              {deepData.positionRows.map((item) => (
                <div
                  key={item.type}
                  onClick={() => openPositionHistoryDetail(item.type)}
                  className={`p-4 rounded-xl border transition-all lift-card cursor-pointer ${
                    item.best ? 'border-emerald-200 bg-emerald-50/50' : 'border-stone-100 bg-stone-50 hover:bg-amber-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div>
                        <span className="font-medium text-stone-700">{item.type}</span>
                        <span className="text-xs text-stone-400 ml-2">{item.sublabel}</span>
                      </div>
                      {item.best && <span className="text-[10px] px-2 py-0.5 bg-emerald-200 text-emerald-700 rounded-full font-medium">最优</span>}
                      {item.partial && <span className="text-[10px] text-stone-400 bg-stone-100 px-2 py-0.5 rounded">{item.partial}</span>}
                    </div>
                    <span className={`text-lg font-semibold ${item.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {signed(item.roi, 1, '%')}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-stone-500">
                    <span>{item.samples} 样本</span>
                    <span>命中率 {item.hitRate.toFixed(1)}%</span>
                    <span>平均赔率 {item.avgOdds.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-stone-700">最优串关组合分析（S8）</h3>
              <span className="text-xs text-stone-400">串关规模 × 主导 Mode · 点击单元格查看历史</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-stone-500">
                    <th className="py-2 pr-3 min-w-[72px]">规模</th>
                    {MODE_ORDER.map((mode) => (
                      <th key={`head-${mode}`} className="py-2 px-1 min-w-[96px] text-center font-medium">
                        {mode}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deepData.comboMatrixRows.map((row) => (
                    <tr key={`matrix-${row.sizeBucket}`} className="border-b border-stone-100">
                      <td className="py-2.5 pr-3 font-medium text-stone-700">{row.sizeBucket}</td>
                      {row.cells.map((cell) => {
                        const intensity = Math.min(Math.abs(cell.roi) / 40, 1)
                        const bgColor = !cell.hasData
                          ? 'rgba(245,245,244,0.65)'
                          : cell.roi >= 0
                            ? `rgba(16,185,129,${0.1 + intensity * 0.22})`
                            : `rgba(251,113,133,${0.08 + intensity * 0.16})`
                        const textTone = !cell.hasData ? 'text-stone-300' : cell.roi >= 0 ? 'text-emerald-700' : 'text-rose-600'

                        return (
                          <td key={cell.key} className="py-2 px-1">
                            <button
                              onClick={() => openComboMatrixDetail(cell)}
                              disabled={!cell.hasData}
                              style={{ background: bgColor }}
                              className={`w-full rounded-lg border border-stone-200/70 py-1.5 px-1 text-center transition-all ${
                                cell.hasData ? 'hover:shadow-sm' : 'cursor-not-allowed'
                              }`}
                            >
                              <p className={`text-sm font-semibold ${textTone}`}>{cell.hasData ? signed(cell.roi, 1, '%') : '--'}</p>
                              <p className="text-[10px] text-stone-500">{cell.hasData ? `${cell.samples}场 · ${cell.hitRate.toFixed(0)}%` : '无样本'}</p>
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

          <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-stone-700">优势领域识别 2.0</h3>
              <span className="text-xs text-stone-400">Mode × Conf × Odds · 点击单元格查看样本明细</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              {advantageModes.map((mode) => (
                <button
                  key={`adv-${mode}`}
                  onClick={() => setAdvantageMode(mode)}
                  className={`px-3 py-1.5 rounded-full text-xs transition-all ${
                    advantageMode === mode ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                  }`}
                >
                  {mode}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => applyAdvantageFilterToCombo(advantageHighlights.top[0])}
                  disabled={!advantageHighlights.top[0]}
                  className="px-3 py-1.5 rounded-full text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  一键带入智能组合
                </button>
                {advantageHighlights.top[0] && (
                  <span className="text-[11px] text-stone-400">
                    {advantageHighlights.top[0].confBucket} × {advantageHighlights.top[0].oddsBucket}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/60">
                <p className="text-[11px] text-emerald-700">Top 区域</p>
                {advantageHighlights.top.length > 0 ? (
                  <div className="mt-1 space-y-1 text-xs text-stone-600">
                    {advantageHighlights.top.map((cell) => (
                      <button
                        key={`top-${cell.confBucket}-${cell.oddsBucket}`}
                        onClick={() => openAdvantageCellDetail(cell)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1 hover:bg-white/80"
                      >
                        <span>
                          {cell.confBucket} × {cell.oddsBucket}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-emerald-700">{signed(cell.roi, 1, '%')}</span>
                          <span className="text-[10px] text-amber-600" onClick={(event) => {
                            event.stopPropagation()
                            applyAdvantageFilterToCombo(cell)
                          }}>
                            带入
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-stone-400 mt-2">样本不足</p>
                )}
              </div>
              <div className="p-3 rounded-xl border border-rose-200 bg-rose-50/55">
                <p className="text-[11px] text-rose-600">Bottom 区域</p>
                {advantageHighlights.bottom.length > 0 ? (
                  <div className="mt-1 space-y-1 text-xs text-stone-600">
                    {advantageHighlights.bottom.map((cell) => (
                      <button
                        key={`bottom-${cell.confBucket}-${cell.oddsBucket}`}
                        onClick={() => openAdvantageCellDetail(cell)}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1 hover:bg-white/80"
                      >
                        <span>
                          {cell.confBucket} × {cell.oddsBucket}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-rose-600">{signed(cell.roi, 1, '%')}</span>
                          <span className="text-[10px] text-amber-600" onClick={(event) => {
                            event.stopPropagation()
                            applyAdvantageFilterToCombo(cell)
                          }}>
                            带入
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-stone-400 mt-2">样本不足</p>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-stone-500">
                    <th className="py-2 pr-3 min-w-[80px]">Conf</th>
                    {ADVANTAGE_ODDS_BUCKETS.map((bucket) => (
                      <th key={`adv-odds-${bucket}`} className="py-2 px-1 min-w-[90px] text-center font-medium">
                        {bucket}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ADVANTAGE_CONF_BUCKETS.map((confBucket) => (
                    <tr key={`adv-row-${confBucket}`} className="border-b border-stone-100">
                      <td className="py-2.5 pr-3 font-medium text-stone-700">{confBucket}</td>
                      {ADVANTAGE_ODDS_BUCKETS.map((oddsBucket) => {
                        const cell = getAdvantageCell(advantageMode, confBucket, oddsBucket)
                        const intensity = Math.min(Math.abs(cell.roi) / 40, 1)
                        const bgColor = !cell.hasData
                          ? 'rgba(245,245,244,0.65)'
                          : cell.roi >= 0
                            ? `rgba(16,185,129,${0.08 + intensity * 0.18})`
                            : `rgba(251,113,133,${0.06 + intensity * 0.14})`
                        const textTone = !cell.hasData ? 'text-stone-300' : cell.roi >= 0 ? 'text-emerald-700' : 'text-rose-600'

                        return (
                          <td key={`adv-cell-${confBucket}-${oddsBucket}`} className="py-2 px-1">
                            <button
                              onClick={() => openAdvantageCellDetail(cell)}
                              disabled={!cell.hasData}
                              style={{ background: bgColor }}
                              className={`w-full rounded-lg border border-stone-200/70 py-1.5 px-1 text-center transition-all ${
                                cell.hasData ? 'hover:shadow-sm' : 'cursor-not-allowed'
                              }`}
                            >
                              <p className={`text-sm font-semibold ${textTone}`}>{cell.hasData ? signed(cell.roi, 1, '%') : '--'}</p>
                              <p className="text-[10px] text-stone-500">{cell.hasData ? `${cell.samples}场 · ${cell.hitRate.toFixed(0)}%` : '无样本'}</p>
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
        </div>
      )}

      {analysisTab === 'league' && (
        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <h3 className="font-medium text-stone-700 mb-1">联赛表现对比</h3>
          <p className="text-xs text-stone-400 mb-4">点击联赛可展开对应近期投资比赛历史明细</p>
          <div className="space-y-3">
            {deepData.leagueRows.map((item) => {
              const isExpanded = expandedLeague === item.league
              const pageSize = 5
              const totalPages = Math.max(1, Math.ceil(item.history.length / pageSize))
              const currentPage = Math.min(getLeaguePage(item.league), totalPages)
              const pageRows = item.history.slice((currentPage - 1) * pageSize, currentPage * pageSize)

              return (
                <div key={item.league} className="rounded-xl border border-stone-100 bg-stone-50 overflow-hidden">
                  <button
                    onClick={() => setExpandedLeague(isExpanded ? null : item.league)}
                    className="w-full flex items-center justify-between p-4 hover:bg-amber-50 transition-all"
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-medium text-stone-700 w-16">{item.league}</span>
                      <span className="text-xs text-stone-400">{item.samples} 样本</span>
                      <span className={`font-semibold text-sm ${item.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {signed(item.roi, 1, '%')}
                      </span>
                    </div>
                    <div className="flex items-center gap-5">
                      <span className="text-sm text-stone-600">命中率 {item.hitRate.toFixed(1)}%</span>
                      <span className={`text-sm font-medium ${getAJRColor(item.avgAjr.toFixed(2))}`}>
                        平均 AJR {Number.isFinite(item.avgAjr) ? item.avgAjr.toFixed(2) : '-'}
                      </span>
                      <span className="text-xs text-stone-400">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 bg-white border-t border-stone-100">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs mt-3">
                          <thead>
                            <tr className="border-b border-stone-100 text-left text-stone-500">
                              <th className="py-2">日期</th>
                              <th className="py-2">比赛</th>
                              <th className="py-2">entry</th>
                              <th className="py-2">result</th>
                              <th className="py-2">赔率</th>
                              <th className="py-2">状态</th>
                              <th className="py-2">AJR</th>
                              <th className="py-2">盈亏</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageRows.map((row, idx) => (
                              <tr key={`${row.match}-${idx}`} className="border-b border-stone-50">
                                <td className="py-2 text-stone-500">{row.date}</td>
                                <td className="py-2 text-stone-700">{row.match}</td>
                                <td className="py-2 text-stone-600">{row.entry}</td>
                                <td className="py-2 text-stone-500">{row.result}</td>
                                <td className="py-2 text-violet-600 italic font-semibold">{row.odds}</td>
                                <td className="py-2">
                                  <span
                                    className={`px-1.5 py-0.5 rounded-full text-[10px] border ${
                                      row.status === '已中'
                                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                        : row.status === '未中'
                                          ? 'bg-rose-50 text-rose-500 border-rose-100'
                                          : 'bg-amber-50 text-amber-600 border-amber-100'
                                    }`}
                                  >
                                    {row.status}
                                  </span>
                                </td>
                                <td className={`py-2 font-semibold ${getAJRColor(row.ajr)}`}>{row.ajr}</td>
                                <td className={`py-2 font-medium ${row.amount.startsWith('+') ? 'text-emerald-600' : 'text-rose-500'}`}>
                                  {row.amount}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <button
                          onClick={() => setLeaguePage(item.league, Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                          className={`px-3 py-1.5 rounded-lg text-xs ${currentPage === 1 ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'}`}
                        >
                          ← 上一页
                        </button>
                        <span className="text-xs text-stone-400">
                          第 {currentPage} / {totalPages} 页
                        </span>
                        <button
                          onClick={() => setLeaguePage(item.league, Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                          className={`px-3 py-1.5 rounded-lg text-xs ${currentPage === totalPages ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'}`}
                        >
                          下一页 →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {analysisTab === 'mode' && (
        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">各 Mode 历史表现</h3>
            <span className="text-xs text-stone-400">点击行可查看该 Mode 的样本历史</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="py-2 font-medium">Mode</th>
                <th className="py-2 font-medium">样本数</th>
                <th className="py-2 font-medium">ROI</th>
                <th className="py-2 font-medium">命中率</th>
                <th className="py-2 font-medium">Avg(Act-Conf)</th>
                <th className="py-2 font-medium">平均 Odds</th>
                <th className="py-2 font-medium">建议 Kelly</th>
              </tr>
            </thead>
            <tbody>
              {baseSnapshot.modeData.map((row) => (
                <tr
                  key={row.mode}
                  onClick={() => openModeHistoryDetail(row.mode)}
                  className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer"
                >
                  <td className="py-3 font-medium text-stone-700">{row.mode}</td>
                  <td className="py-3 text-stone-600">{row.samples}</td>
                  <td className={`py-3 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signed(row.roi, 1, '%')}</td>
                  <td className="py-3 text-stone-600">{row.hitRate.toFixed(1)}%</td>
                  <td className={`py-3 font-medium ${row.avgActualMinusConf >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {signed(row.avgActualMinusConf, 2)}
                  </td>
                  <td className="py-3 text-stone-600">{row.avgOdds.toFixed(2)}</td>
                  <td className="py-3 text-amber-600 font-medium">{row.kelly.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {baseSnapshot.entryTypeData?.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-stone-700">Entries 类型表现（N4）</h4>
                <span className="text-xs text-stone-400">按语义解析后的盘口类型切片</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-stone-500">
                    <th className="py-2 font-medium">类型</th>
                    <th className="py-2 font-medium">样本数</th>
                    <th className="py-2 font-medium">ROI</th>
                    <th className="py-2 font-medium">命中率</th>
                    <th className="py-2 font-medium">示例</th>
                  </tr>
                </thead>
                <tbody>
                  {baseSnapshot.entryTypeData.map((row) => (
                    <tr key={row.marketType} className="border-b border-stone-100">
                      <td className="py-2.5 font-medium text-stone-700">{row.marketLabel}</td>
                      <td className="py-2.5 text-stone-600">{row.samples}</td>
                      <td className={`py-2.5 font-medium ${row.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {signed(row.roi, 1, '%')}
                      </td>
                      <td className="py-2.5 text-stone-600">{row.hitRate.toFixed(1)}%</td>
                      <td className="py-2.5 text-stone-500 text-xs">{row.examples || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-stone-400 mt-4">此表 Kelly 建议已同步至参数后台</p>
        </div>
      )}

      {analysisTab === 'conf' && (
        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">Conf 区间分析</h3>
            <span className="text-xs text-stone-400">点击区间查看样本历史</span>
          </div>
          <div className="grid grid-cols-6 gap-3">
            {deepData.confRows.map((row) => (
              <button
                key={row.range}
                onClick={() => openConfRangeDetail(row.range)}
                className="p-4 rounded-xl bg-stone-50 text-center hover:bg-amber-50 border border-stone-100 hover:border-amber-200 transition-all lift-card"
              >
                <span className="text-lg font-semibold text-stone-700">{row.range}</span>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-stone-400">预期</span>
                    <span>{row.expected.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">实际</span>
                    <span>{row.actual.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-400">偏差</span>
                    <span className={row.diff >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{signed(row.diff, 2)}</span>
                  </div>
                </div>
                <p className="text-xs text-stone-400 mt-2">{row.samples} 样本</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {analysisTab === 'time' && (
        <div className="glow-card bg-white rounded-2xl p-6 border border-stone-100">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-medium text-stone-700">时间近因机制</h3>
            <span className="text-[10px] px-2 py-0.5 bg-stone-100 text-stone-500 rounded">
              n={Math.max(1, Math.floor(deepData.totalMatchSamples / 50))}
            </span>
          </div>
          <p className="text-sm text-stone-500 mb-6">Conf、FSE 等参数应用时间衰减权重，近期表现影响更大。</p>
          <div className="grid grid-cols-3 gap-6">
            {deepData.timeWeights.map((item) => (
              <div
                key={item.period}
                className={`p-6 rounded-xl text-center ${item.highlight ? 'bg-amber-50 border border-amber-200' : 'bg-stone-50'}`}
              >
                <span className={`text-3xl font-bold ${item.highlight ? 'text-amber-600' : 'text-stone-400'}`}>{item.weight}</span>
                <p className="text-sm text-stone-600 mt-2">{item.period}</p>
                <p className="text-xs text-stone-400 mt-1">{item.count} 场样本</p>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 rounded-xl border border-stone-100 bg-stone-50/70">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-stone-700">连续性动量（S5/S6）</h4>
              <span className={`text-xs font-medium ${getMomentumTone(momentumSummary.direction)}`}>
                {getMomentumLabel(momentumSummary.direction)} · {momentumSummary.strength}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-white border border-stone-100">
                <p className="text-stone-400">当前连续性</p>
                <p className="mt-1 text-sm font-semibold text-stone-700">{momentumSummary.streakLabel}</p>
                <p className="text-stone-400 mt-1">
                  最近 {momentumSummary.recentSamples} 场 / 基线 {momentumSummary.baseSamples} 场
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white border border-stone-100">
                <p className="text-stone-400">ROI 动量</p>
                <p className={`mt-1 text-sm font-semibold ${momentumSummary.roiDelta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {signed(momentumSummary.roiDelta, 1, '%')}
                </p>
                <p className="text-stone-400 mt-1">
                  {momentumSummary.recentRoi.toFixed(1)}% vs {momentumSummary.baseRoi.toFixed(1)}%
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white border border-stone-100">
                <p className="text-stone-400">命中率动量</p>
                <p className={`mt-1 text-sm font-semibold ${momentumSummary.hitRateDelta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {signed(momentumSummary.hitRateDelta, 1, 'pp')}
                </p>
                <p className="text-stone-400 mt-1">
                  {momentumSummary.recentHitRate.toFixed(1)}% vs {momentumSummary.baseHitRate.toFixed(1)}%
                </p>
              </div>
            </div>
            <p className="text-xs text-stone-500 mt-3">{momentumSummary.recommendation}</p>
          </div>
        </div>
      )}

      <div className="mt-6 glow-card bg-white rounded-2xl p-5 border border-stone-100">
        <h3 className="font-medium text-stone-700 mb-2">快速概览</h3>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div className="p-3 rounded-xl bg-stone-50">
            <p className="text-xs text-stone-400">Position 维度样本</p>
            <p className="text-lg font-semibold text-stone-800">{deepData.positionRows.reduce((sum, row) => sum + row.samples, 0)}</p>
          </div>
          <div className="p-3 rounded-xl bg-stone-50">
            <p className="text-xs text-stone-400">联赛覆盖</p>
            <p className="text-lg font-semibold text-stone-800">{deepData.leagueRows.length} 个联赛</p>
          </div>
          <div className="p-3 rounded-xl bg-stone-50">
            <p className="text-xs text-stone-400">Conf 分层样本</p>
            <p className="text-lg font-semibold text-stone-800">{deepData.confRows.reduce((sum, row) => sum + row.samples, 0)}</p>
          </div>
          <div className="p-3 rounded-xl bg-stone-50">
            <p className="text-xs text-stone-400">Mode 样本</p>
            <p className="text-lg font-semibold text-stone-800">{metricsSnapshot.matrix.mode.reduce((sum, row) => sum + row.samples, 0)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
