import { findTeamProfile, getInvestments, getSystemConfig, getTeamProfiles } from './localData'
import { getPrimaryEntryMarket } from './entryParsing'

const MODE_KEYS = ['常规', '常规-稳', '常规-杠杆', '半彩票半保险', '保险产品', '赌一把']
const MODE_ALIAS = {
  '常规-激进': '常规-杠杆',
}

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const formatDate = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

const normalize = (value) => String(value || '').trim().toLowerCase()
const normalizeMode = (mode) => MODE_ALIAS[mode] || mode
const isActiveInvestment = (item) => !Boolean(item?.is_archived)
const getActiveInvestments = () => getInvestments().filter(isActiveInvestment)

const getRangeDays = (periodKey) => {
  if (periodKey === '1w') return 7
  if (periodKey === '2w') return 14
  if (periodKey === '1m') return 30
  return null
}

const getPeriodRange = (periodKey, shift = 0, now = new Date()) => {
  const days = getRangeDays(periodKey)
  if (!days) return null
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  end.setDate(end.getDate() - days * shift)
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  return { start, end, days }
}

const inRange = (value, range) => {
  if (!range) return true
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return false
  return time >= range.start.getTime() && time <= range.end.getTime()
}

const splitInvestmentToMatches = (investment) => {
  const matches = Array.isArray(investment.matches) ? investment.matches : []
  if (matches.length === 0) return []

  const inputs = Math.max(0, toNumber(investment.inputs))
  const revenues = Math.max(0, toNumber(investment.revenues))
  const perInput = inputs / matches.length
  const odds = matches.map((match) => Math.max(0, toNumber(match.odds)))
  const oddsSum = odds.reduce((sum, value) => sum + value, 0)

  return matches.map((match, idx) => {
    const weightedRevenue = revenues > 0 && oddsSum > 0 ? (revenues * odds[idx]) / oddsSum : 0
    return {
      ...match,
      allocated_input: perInput,
      allocated_revenue: weightedRevenue,
      allocated_profit: weightedRevenue - perInput,
    }
  })
}

const getSettledInvestments = (investments) =>
  investments.filter(
    (item) =>
      isActiveInvestment(item) &&
      (item.status === 'win' || item.status === 'lose' || Number.isFinite(Number.parseFloat(item.profit))),
  )

const calcRoi = (profit, inputs) => (inputs > 0 ? (profit / inputs) * 100 : 0)

const calcRatingFit = (rows) => {
  if (rows.length === 0) return 0
  const avgAbsDiff =
    rows.reduce((sum, row) => sum + Math.abs(row.actual_rating - row.expected_rating), 0) / rows.length
  return clamp(1 - avgAbsDiff, 0, 1)
}

const getRatingRowsFromInvestments = (investments) => {
  const rows = []
  investments.forEach((item) => {
    const expectedFromInvestment = toNumber(item.expected_rating, NaN)
    const matches = Array.isArray(item.matches) ? item.matches : []
    matches.forEach((match) => {
      const expected = Number.isFinite(expectedFromInvestment)
        ? expectedFromInvestment
        : toNumber(match.conf, NaN)
      const actual = toNumber(match.match_rating, NaN)
      if (!Number.isFinite(expected) || !Number.isFinite(actual)) return
      rows.push({
        investment_id: item.id,
        date: item.created_at,
        match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
        expected_rating: expected,
        actual_rating: actual,
      })
    })
  })
  return rows
}

const buildConfCalibration = (investments) => {
  const bins = [
    { label: '0.0-0.2', min: 0, max: 0.2 },
    { label: '0.2-0.4', min: 0.2, max: 0.4 },
    { label: '0.4-0.6', min: 0.4, max: 0.6 },
    { label: '0.6-0.7', min: 0.6, max: 0.7 },
    { label: '0.7-0.8', min: 0.7, max: 0.8 },
    { label: '0.8+', min: 0.8, max: 1.01 },
  ]

  const rows = bins.map((bin) => ({
    ...bin,
    expected_sum: 0,
    actual_sum: 0,
    samples: 0,
  }))

  investments.forEach((item) => {
    const matches = Array.isArray(item.matches) ? item.matches : []
    matches.forEach((match) => {
      const conf = toNumber(match.conf, NaN)
      const actual = toNumber(match.match_rating, NaN)
      if (!Number.isFinite(conf) || !Number.isFinite(actual)) return
      const row = rows.find((bin) => conf >= bin.min && conf < bin.max)
      if (!row) return
      row.expected_sum += conf
      row.actual_sum += actual
      row.samples += 1
    })
  })

  return rows.map((row) => {
    const expected = row.samples > 0 ? row.expected_sum / row.samples : 0
    const actual = row.samples > 0 ? row.actual_sum / row.samples : 0
    return {
      label: row.label,
      expected,
      actual,
      samples: row.samples,
    }
  })
}

const buildBalanceSeries = (settledInvestments, initialCapital, periodKey) => {
  const sorted = [...settledInvestments].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const points = []
  let balance = initialCapital
  sorted.forEach((item) => {
    balance += toNumber(item.profit)
    points.push({
      date: item.created_at,
      label: formatDate(item.created_at),
      balance: Number(balance.toFixed(2)),
    })
  })

  if (periodKey === 'all') {
    return points.slice(-40)
  }

  const range = getPeriodRange(periodKey)
  if (!range) return points.slice(-40)

  const within = points.filter((point) => inRange(point.date, range))
  const before = points.filter((point) => new Date(point.date).getTime() < range.start.getTime())
  const baseline = before.length > 0 ? before[before.length - 1] : null
  const result = baseline ? [baseline, ...within] : within

  if (result.length === 0) {
    return [
      {
        date: new Date().toISOString(),
        label: formatDate(new Date().toISOString()),
        balance: Number(initialCapital.toFixed(2)),
      },
    ]
  }
  return result.slice(-40)
}

const calcRepBuckets = (settledInvestments) => {
  const buckets = {
    low: { label: '低随机性', count: 0, inputs: 0, profit: 0 },
    medium: { label: '中随机性', count: 0, inputs: 0, profit: 0 },
    high: { label: '高随机性', count: 0, inputs: 0, profit: 0 },
  }

  settledInvestments.forEach((item) => {
    const rep = toNumber(item.rep, 0)
    const inputs = Math.max(0, toNumber(item.inputs))
    const profit = toNumber(item.profit)
    const bucketKey = rep <= 0.4 ? 'low' : rep <= 0.8 ? 'medium' : 'high'
    buckets[bucketKey].count += 1
    buckets[bucketKey].inputs += inputs
    buckets[bucketKey].profit += profit
  })

  return Object.values(buckets).map((bucket) => ({
    ...bucket,
    roi: calcRoi(bucket.profit, bucket.inputs),
  }))
}

const calcConf04Stats = (settledInvestments) => {
  let total = 0
  let correct = 0
  settledInvestments.forEach((item) => {
    ;(item.matches || []).forEach((match) => {
      const conf = toNumber(match.conf, NaN)
      if (!Number.isFinite(conf) || conf < 0.4) return
      if (typeof match.is_correct !== 'boolean') return
      total += 1
      if (match.is_correct) correct += 1
    })
  })
  return { total, correct }
}

const getConfBandLabel = (conf) => {
  if (!Number.isFinite(conf)) return 'unknown'
  if (conf < 0.2) return '0.0-0.2'
  if (conf < 0.4) return '0.2-0.4'
  if (conf < 0.6) return '0.4-0.6'
  if (conf < 0.7) return '0.6-0.7'
  if (conf < 0.8) return '0.7-0.8'
  return '0.8+'
}

const getMatchOutcomeStatus = (match, fallbackStatus = 'pending') => {
  if (match?.is_correct === true) return 'win'
  if (match?.is_correct === false) return 'lose'
  if (fallbackStatus === 'win' || fallbackStatus === 'lose' || fallbackStatus === 'draw') return fallbackStatus
  return 'pending'
}

const calcStreakSummary = (settledInvestments) => {
  const sorted = [...settledInvestments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  let maxWin = 0
  let maxLose = 0
  let currentType = 'none'
  let currentLength = 0
  let runType = 'none'
  let runLength = 0

  sorted.forEach((item) => {
    const type = item.status === 'win' ? 'win' : item.status === 'lose' ? 'lose' : 'none'
    if (type === 'none') {
      runType = 'none'
      runLength = 0
      return
    }
    if (runType === type) {
      runLength += 1
    } else {
      runType = type
      runLength = 1
    }
    if (type === 'win') maxWin = Math.max(maxWin, runLength)
    if (type === 'lose') maxLose = Math.max(maxLose, runLength)
  })

  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const type = sorted[i].status === 'win' ? 'win' : sorted[i].status === 'lose' ? 'lose' : 'none'
    if (type === 'none') {
      if (currentType === 'none') continue
      break
    }
    if (currentType === 'none') {
      currentType = type
      currentLength = 1
    } else if (currentType === type) {
      currentLength += 1
    } else {
      break
    }
  }

  return {
    maxWin,
    maxLose,
    currentType,
    currentLength,
  }
}

const calcMomentumSummary = (settledInvestments) => {
  const sorted = [...settledInvestments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  if (sorted.length === 0) {
    return {
      score: 0,
      direction: 'flat',
      strength: 'mild',
      recentSamples: 0,
      baseSamples: 0,
      recentRoi: 0,
      baseRoi: 0,
      roiDelta: 0,
      recentHitRate: 0,
      baseHitRate: 0,
      hitRateDelta: 0,
    }
  }

  const calcWindow = (items) => {
    const samples = items.length
    if (samples === 0) {
      return { samples: 0, roi: 0, hitRate: 0 }
    }
    const inputs = items.reduce((sum, item) => sum + Math.max(0, toNumber(item.inputs)), 0)
    const profit = items.reduce((sum, item) => sum + toNumber(item.profit), 0)
    const wins = items.filter((item) => item.status === 'win').length
    return {
      samples,
      roi: calcRoi(profit, inputs),
      hitRate: (wins / samples) * 100,
    }
  }

  const recentSize = Math.max(2, Math.min(6, Math.ceil(sorted.length * 0.4)))
  const recentWindow = sorted.slice(-recentSize)
  const historyBeforeRecent = sorted.slice(0, Math.max(0, sorted.length - recentSize))
  const baselineWindow = historyBeforeRecent.slice(-Math.max(2, Math.min(10, historyBeforeRecent.length)))
  const recent = calcWindow(recentWindow)
  const baseline = calcWindow(baselineWindow.length > 0 ? baselineWindow : sorted.slice(0, Math.max(1, sorted.length - 1)))

  const roiDelta = recent.roi - baseline.roi
  const hitRateDelta = recent.hitRate - baseline.hitRate
  const score = clamp(roiDelta / 12 + hitRateDelta / 20, -2, 2)
  const absScore = Math.abs(score)
  const direction = score > 0.35 ? 'up' : score < -0.35 ? 'down' : 'flat'
  const strength = absScore >= 1.1 ? 'strong' : absScore >= 0.6 ? 'medium' : 'mild'

  return {
    score: Number(score.toFixed(2)),
    direction,
    strength,
    recentSamples: recent.samples,
    baseSamples: baseline.samples,
    recentRoi: Number(recent.roi.toFixed(2)),
    baseRoi: Number(baseline.roi.toFixed(2)),
    roiDelta: Number(roiDelta.toFixed(2)),
    recentHitRate: Number(recent.hitRate.toFixed(1)),
    baseHitRate: Number(baseline.hitRate.toFixed(1)),
    hitRateDelta: Number(hitRateDelta.toFixed(1)),
  }
}

const calcModeBreakdown = (investments) => {
  const map = new Map()
  MODE_KEYS.forEach((mode) => {
    map.set(mode, { mode, samples: 0, inputs: 0, profit: 0 })
  })

  investments.forEach((item) => {
    splitInvestmentToMatches(item).forEach((match) => {
      const mode = normalizeMode(match.mode)
      const canonicalMode = MODE_KEYS.includes(mode) ? mode : '常规'
      const row = map.get(canonicalMode)
      row.samples += 1
      row.inputs += match.allocated_input
      row.profit += match.allocated_profit
    })
  })

  return [...map.values()].map((row) => ({
    ...row,
    roi: calcRoi(row.profit, row.inputs),
  }))
}

const KELLY_DIVISOR_CANDIDATES = [2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10]

const getDominantModeFromInvestment = (investment) => {
  const matches = Array.isArray(investment?.matches) ? investment.matches : []
  if (matches.length === 0) return '常规'
  const counts = new Map()
  matches.forEach((match) => {
    const mode = MODE_KEYS.includes(normalizeMode(match.mode)) ? normalizeMode(match.mode) : '常规'
    counts.set(mode, (counts.get(mode) || 0) + 1)
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '常规'
}

const estimateInvestmentExpected = (investment) => {
  const expected = toNumber(investment?.expected_rating, NaN)
  if (Number.isFinite(expected)) return clamp(expected, 0.05, 0.95)
  const matches = Array.isArray(investment?.matches) ? investment.matches : []
  const confValues = matches.map((match) => toNumber(match.conf, NaN)).filter(Number.isFinite)
  if (confValues.length === 0) return 0.5
  const avg = confValues.reduce((sum, value) => sum + value, 0) / confValues.length
  return clamp(avg, 0.05, 0.95)
}

const estimateInvestmentOdds = (investment, fallbackOdds = 2.5) => {
  const combined = toNumber(investment?.combined_odds, NaN)
  if (Number.isFinite(combined) && combined > 1) return combined
  const matches = Array.isArray(investment?.matches) ? investment.matches : []
  const odds = matches.map((match) => toNumber(match.odds, NaN)).filter((value) => Number.isFinite(value) && value > 1)
  if (odds.length === 0) return fallbackOdds
  const product = odds.reduce((result, value) => result * value, 1)
  return Number(product.toFixed(2))
}

const toKellySimulationRowsFromInvestments = (investments, config) =>
  investments
    .map((item) => {
      const inputs = Math.max(0, toNumber(item.inputs, 0))
      if (inputs <= 0) return null
      const profit = toNumber(item.profit, 0)
      if (!Number.isFinite(profit)) return null
      const expected = estimateInvestmentExpected(item)
      const odds = estimateInvestmentOdds(item, toNumber(config.defaultOdds, 2.5))
      if (!Number.isFinite(expected) || !Number.isFinite(odds) || odds <= 1) return null
      return {
        expected,
        odds,
        inputs,
        profit,
      }
    })
    .filter(Boolean)

const calcKellyStake = (expected, odds, divisor, config) => {
  const kelly = (expected * odds - 1) / (odds - 1)
  if (!Number.isFinite(kelly) || kelly <= 0) return 0
  const confidenceLift = 0.88 + expected * 0.24
  const base = toNumber(config.initialCapital, 0) * (kelly / Math.max(1, divisor))
  const riskCap = toNumber(config.initialCapital, 0) * toNumber(config.riskCapRatio, 0)
  const raw = base * confidenceLift
  return Math.max(0, Math.min(riskCap, raw))
}

const simulateKellyDivisorFromRows = (rows, divisor, config) => {
  let balance = toNumber(config.initialCapital, 0)
  let peak = balance
  let maxDrawdown = 0
  let totalInvest = 0
  let totalProfit = 0
  let wins = 0
  let samples = 0
  const sampleReturns = []

  rows.forEach((row) => {
    const inputs = Math.max(0, toNumber(row.inputs, 0))
    const profit = toNumber(row.profit, 0)
    if (inputs <= 0) return
    const expected = clamp(toNumber(row.expected, 0.5), 0.05, 0.95)
    const odds = Math.max(1.01, toNumber(row.odds, toNumber(config.defaultOdds, 2.5)))
    const stake = Math.round(calcKellyStake(expected, odds, divisor, config))
    if (stake <= 0) return
    const profitRatio = profit / inputs
    const simProfit = stake * profitRatio
    totalInvest += stake
    totalProfit += simProfit
    samples += 1
    if (simProfit > 0) wins += 1
    sampleReturns.push(profitRatio)

    balance += simProfit
    if (balance > peak) peak = balance
    const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  })

  const roi = calcRoi(totalProfit, totalInvest)
  const hitRate = samples > 0 ? (wins / samples) * 100 : 0
  const avgReturn = sampleReturns.length > 0 ? sampleReturns.reduce((sum, value) => sum + value, 0) / sampleReturns.length : 0
  const variance =
    sampleReturns.length > 1
      ? sampleReturns.reduce((sum, value) => sum + (value - avgReturn) ** 2, 0) / sampleReturns.length
      : 0
  const volatility = Math.sqrt(Math.max(variance, 0))
  const sharpe = volatility > 0 ? avgReturn / volatility : avgReturn > 0 ? 1 : 0
  const samplePenalty = samples > 0 ? clamp(12 / Math.max(1, samples), 0, 12) : 12
  const score = roi - maxDrawdown * 0.72 + sharpe * 8 - samplePenalty

  return {
    divisor,
    samples,
    totalInvest,
    totalProfit,
    roi,
    hitRate,
    maxDrawdown,
    sharpe,
    score: Number(score.toFixed(3)),
  }
}

const sweepKellyDivisors = (rows, config, divisors = KELLY_DIVISOR_CANDIDATES) =>
  divisors.map((divisor) => simulateKellyDivisorFromRows(rows, divisor, config))

const pickClosestDivisor = (divisors, target, fallback) => {
  if (!Array.isArray(divisors) || divisors.length === 0) return fallback
  return [...divisors].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0]
}

const pickKellyDivisor = (rows, config, fallbackDivisor = 4, divisors = KELLY_DIVISOR_CANDIDATES) => {
  const results = sweepKellyDivisors(rows, config, divisors)
  const validRows = results.filter((row) => row.samples > 0)
  const safeFallback = pickClosestDivisor(divisors, fallbackDivisor, divisors[0])

  if (validRows.length === 0) {
    return {
      rows: results,
      best: null,
      rawBest: null,
      reliability: 0,
      recommendedDivisor: safeFallback,
      sampleCount: 0,
    }
  }

  const rawBest = [...validRows].sort((a, b) => b.score - a.score || b.samples - a.samples || a.divisor - b.divisor)[0]
  const reliability = clamp((rawBest.samples - 6) / 22, 0, 1)
  const blendedDivisor = rawBest.divisor * reliability + safeFallback * (1 - reliability)
  const recommendedDivisor = pickClosestDivisor(divisors, blendedDivisor, rawBest.divisor)
  const best = validRows.find((row) => row.divisor === recommendedDivisor) || rawBest

  return {
    rows: results,
    best,
    rawBest,
    reliability: Number(reliability.toFixed(3)),
    recommendedDivisor,
    sampleCount: best.samples,
  }
}

export const getKellyDivisorBacktest = (divisors = KELLY_DIVISOR_CANDIDATES) => {
  const config = getSystemConfig()
  const investments = getSettledInvestments(getActiveInvestments()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const globalRowsSource = toKellySimulationRowsFromInvestments(investments, config)
  const globalPick = pickKellyDivisor(globalRowsSource, config, toNumber(config.kellyDivisor, 4), divisors)

  const globalRows = globalPick.rows
  const globalBest = globalPick.best
    ? {
        ...globalPick.best,
        reliability: globalPick.reliability,
        recommendedDivisor: globalPick.recommendedDivisor,
      }
    : null

  const modeMap = new Map()
  investments.forEach((item) => {
    const mode = getDominantModeFromInvestment(item)
    if (!modeMap.has(mode)) modeMap.set(mode, [])
    modeMap.get(mode).push(item)
  })

  const modeRecommendations = MODE_KEYS.map((mode) => {
    const modeRows = modeMap.get(mode) || []
    const sourceRows = toKellySimulationRowsFromInvestments(modeRows, config)
    const pick = pickKellyDivisor(
      sourceRows,
      config,
      globalPick.recommendedDivisor || toNumber(config.kellyDivisor, 4),
      divisors,
    )
    const best = pick.best
      ? {
          ...pick.best,
          reliability: pick.reliability,
          recommendedDivisor: pick.recommendedDivisor,
        }
      : null
    return {
      mode,
      best,
      rows: pick.rows,
    }
  })

  return {
    divisors,
    globalRows,
    globalBest,
    modeRecommendations,
  }
}

export const getDashboardSnapshot = (periodKey = '2w') => {
  const config = getSystemConfig()
  const allInvestments = getActiveInvestments()
  const range = getPeriodRange(periodKey)
  const periodInvestments = allInvestments.filter((item) => inRange(item.created_at, range))

  const settledAll = getSettledInvestments(allInvestments)
  const settledPeriod = getSettledInvestments(periodInvestments)
  const settledPrevious = (() => {
    if (!range) return []
    const previousRange = getPeriodRange(periodKey, 1)
    return getSettledInvestments(allInvestments.filter((item) => inRange(item.created_at, previousRange)))
  })()

  const totalInputsPeriod = settledPeriod.reduce((sum, item) => sum + Math.max(0, toNumber(item.inputs)), 0)
  const totalProfitPeriod = settledPeriod.reduce((sum, item) => sum + toNumber(item.profit), 0)
  const roiPeriod = calcRoi(totalProfitPeriod, totalInputsPeriod)

  const totalInputsPrev = settledPrevious.reduce((sum, item) => sum + Math.max(0, toNumber(item.inputs)), 0)
  const totalProfitPrev = settledPrevious.reduce((sum, item) => sum + toNumber(item.profit), 0)
  const roiPrev = calcRoi(totalProfitPrev, totalInputsPrev)

  const winsPeriod = settledPeriod.filter((item) => item.status === 'win').length
  const hitRatePeriod = settledPeriod.length > 0 ? (winsPeriod / settledPeriod.length) * 100 : 0
  const winsPrev = settledPrevious.filter((item) => item.status === 'win').length
  const hitRatePrev = settledPrevious.length > 0 ? (winsPrev / settledPrevious.length) * 100 : 0

  const ratingRowsPeriod = getRatingRowsFromInvestments(periodInvestments)
  const ratingRowsPrev = getRatingRowsFromInvestments(settledPrevious)
  const ratingFit = calcRatingFit(ratingRowsPeriod)
  const ratingFitPrev = calcRatingFit(ratingRowsPrev)

  const initialCapital = toNumber(config.initialCapital, 0)
  const poolBalance = initialCapital + settledAll.reduce((sum, item) => sum + toNumber(item.profit), 0)

  const conf04 = calcConf04Stats(settledPeriod)
  const confCalibration = buildConfCalibration(settledPeriod)
  const repBuckets = calcRepBuckets(settledPeriod)
  const balanceLedger = (() => {
    // 获取注资记录
    const injections = Array.isArray(config.capitalInjections) ? config.capitalInjections : []

    // 找到最早的注资时间，用于确定"旧数据"的分界点
    const sortedInjections = [...injections].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const firstInjectionTime = sortedInjections.length > 0 ? new Date(sortedInjections[0].created_at).getTime() : Infinity

    // 计算第一次注资之前的初始资金（即用户设置的原始资金，不包含任何注资）
    const totalInjected = injections.reduce((sum, inj) => sum + toNumber(inj.amount), 0)
    const originalCapital = initialCapital - totalInjected

    // 按时间排序所有已结算投资
    const sortedSettled = [...settledAll].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

    // 构建账本：先处理所有投资（使用原始资金计算），然后把注资插入到正确的时间位置
    const ledgerEntries = []
    let runningBalance = originalCapital

    // 投资和注资的合并索引
    let investmentIdx = 0
    let injectionIdx = 0

    while (investmentIdx < sortedSettled.length || injectionIdx < sortedInjections.length) {
      const nextInvestment = sortedSettled[investmentIdx]
      const nextInjection = sortedInjections[injectionIdx]

      const investmentTime = nextInvestment ? new Date(nextInvestment.created_at).getTime() : Infinity
      const injectionTime = nextInjection ? new Date(nextInjection.created_at).getTime() : Infinity

      if (injectionTime <= investmentTime && nextInjection) {
        // 处理注资
        const before = runningBalance
        const amount = toNumber(nextInjection.amount)
        const amountLabel = Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
        runningBalance += amount
        ledgerEntries.push({
          id: nextInjection.id,
          date: nextInjection.created_at,
          dateLabel: formatDate(nextInjection.created_at),
          match: `注资新增 ${amountLabel} rmb`,
          before: Number(before.toFixed(2)),
          profit: Number(amount.toFixed(2)),
          after: Number(runningBalance.toFixed(2)),
          isInjection: true,
        })
        injectionIdx++
      } else if (nextInvestment) {
        // 处理投资
        const before = runningBalance
        const profit = toNumber(nextInvestment.profit)
        runningBalance += profit
        const firstMatch = nextInvestment.matches?.[0]
        ledgerEntries.push({
          id: nextInvestment.id,
          date: nextInvestment.created_at,
          dateLabel: formatDate(nextInvestment.created_at),
          match:
            Number(nextInvestment.parlay_size || nextInvestment.matches?.length || 1) > 1
              ? `${firstMatch?.home_team || '-'} vs ${firstMatch?.away_team || '-'} 等${nextInvestment.parlay_size}场`
              : `${firstMatch?.home_team || '-'} vs ${firstMatch?.away_team || '-'}`,
          before: Number(before.toFixed(2)),
          profit: Number(profit.toFixed(2)),
          after: Number(runningBalance.toFixed(2)),
          isInjection: false,
        })
        investmentIdx++
      }
    }

    return ledgerEntries.reverse()
  })()

  const recent = periodInvestments.slice(0, 8).map((item) => {
    const firstMatch = item.matches?.[0]
    const label =
      Number(item.parlay_size || item.matches?.length || 1) > 1
        ? `${firstMatch?.home_team || '-'} vs ${firstMatch?.away_team || '-'} 等${item.parlay_size}场`
        : `${firstMatch?.home_team || '-'} vs ${firstMatch?.away_team || '-'}`

    return {
      id: item.id,
      match: label,
      entry: firstMatch?.entry_text || firstMatch?.entries?.map((entry) => entry.name).join(', ') || '-',
      status: item.status || 'pending',
      amount:
        item.status === 'pending'
          ? `${toNumber(item.inputs)} rmb`
          : `${toNumber(item.profit) >= 0 ? '+' : ''}${toNumber(item.profit).toFixed(0)} rmb`,
    }
  })

  const periodMatchRows = settledPeriod
    .flatMap((item) =>
      splitInvestmentToMatches(item).map((match, idx) => {
        const conf = toNumber(match.conf, NaN)
        const ajr = toNumber(match.match_rating, NaN)
        const rep = toNumber(match.match_rep, toNumber(item.rep, NaN))
        const input = Math.max(0, toNumber(match.allocated_input))
        const profit = toNumber(match.allocated_profit)
        const status = getMatchOutcomeStatus(match, item.status)
        return {
          id: `${item.id}-m${idx + 1}`,
          investmentId: item.id,
          date: item.created_at,
          dateLabel: formatDate(item.created_at),
          homeTeam: match.home_team || '-',
          awayTeam: match.away_team || '-',
          match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
          entry: match.entry_text || (Array.isArray(match.entries) ? match.entries.map((entry) => entry.name).join(', ') : '-') || '-',
          conf,
          ajr,
          rep,
          odds: toNumber(match.odds, NaN),
          input,
          profit,
          roi: input > 0 ? calcRoi(profit, input) : 0,
          status,
          confBand: getConfBandLabel(conf),
        }
      }),
    )
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const repDetailBuckets = {
    low: { key: 'low', label: '低 REP (<=0.4)', rows: [] },
    mid: { key: 'mid', label: '中 REP (0.4~0.8)', rows: [] },
    high: { key: 'high', label: '高 REP (>0.8)', rows: [] },
  }

  periodMatchRows.forEach((row) => {
    if (!Number.isFinite(row.rep)) return
    if (row.rep <= 0.4) repDetailBuckets.low.rows.push(row)
    else if (row.rep <= 0.8) repDetailBuckets.mid.rows.push(row)
    else repDetailBuckets.high.rows.push(row)
  })

  const repDetail = Object.values(repDetailBuckets).map((bucket) => {
    const inputs = bucket.rows.reduce((sum, row) => sum + row.input, 0)
    const profit = bucket.rows.reduce((sum, row) => sum + row.profit, 0)
    const hitCount = bucket.rows.filter((row) => row.status === 'win').length
    return {
      key: bucket.key,
      label: bucket.label,
      samples: bucket.rows.length,
      hitRate: bucket.rows.length > 0 ? (hitCount / bucket.rows.length) * 100 : 0,
      roi: calcRoi(profit, inputs),
      rows: bucket.rows,
    }
  })

  const confDetailMap = new Map(
    ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.7', '0.7-0.8', '0.8+'].map((label) => [
      label,
      {
        label,
        samples: 0,
        expectedSum: 0,
        actualSum: 0,
        inputs: 0,
        profit: 0,
        wins: 0,
        rows: [],
      },
    ]),
  )

  periodMatchRows.forEach((row) => {
    if (!Number.isFinite(row.conf)) return
    const bucket = confDetailMap.get(row.confBand)
    if (!bucket) return
    bucket.samples += 1
    bucket.expectedSum += row.conf
    if (Number.isFinite(row.ajr)) bucket.actualSum += row.ajr
    bucket.inputs += row.input
    bucket.profit += row.profit
    if (row.status === 'win') bucket.wins += 1
    bucket.rows.push(row)
  })

  const confDetail = [...confDetailMap.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      label: row.label,
      samples: row.samples,
      expected: row.expectedSum / row.samples,
      actual: row.actualSum / row.samples,
      diff: row.actualSum / row.samples - row.expectedSum / row.samples,
      hitRate: (row.wins / row.samples) * 100,
      roi: calcRoi(row.profit, row.inputs),
      rows: row.rows,
    }))

  const advantageMap = new Map()
  periodMatchRows.forEach((row) => {
    const teams = [row.homeTeam, row.awayTeam]
    teams.forEach((team) => {
      if (!advantageMap.has(team)) {
        advantageMap.set(team, {
          team,
          samples: 0,
          inputs: 0,
          profit: 0,
          wins: 0,
        })
      }
      const item = advantageMap.get(team)
      item.samples += 1
      item.inputs += row.input / 2
      item.profit += row.profit / 2
      if (row.status === 'win') item.wins += 1
    })
  })

  const advantageRows = [...advantageMap.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      ...row,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: (row.wins / row.samples) * 100,
    }))

  const advantage = {
    top: advantageRows
      .filter((row) => row.samples >= 2)
      .sort((a, b) => b.roi - a.roi || b.hitRate - a.hitRate)
      .slice(0, 6),
    bottom: advantageRows
      .filter((row) => row.samples >= 2)
      .sort((a, b) => a.roi - b.roi || a.hitRate - b.hitRate)
      .slice(0, 6),
  }

  const streaks = calcStreakSummary(settledPeriod)
  const momentum = calcMomentumSummary(settledPeriod)

  return {
    periodInvestments: periodInvestments.length,
    settledPeriod: settledPeriod.length,
    pendingPeriod: periodInvestments.length - settledPeriod.length,
    poolBalance: Number(poolBalance.toFixed(2)),
    roiPeriod: Number(roiPeriod.toFixed(2)),
    roiDelta: Number((roiPeriod - roiPrev).toFixed(2)),
    hitRatePeriod: Number(hitRatePeriod.toFixed(1)),
    hitRateDelta: Number((hitRatePeriod - hitRatePrev).toFixed(1)),
    ratingFit: Number(ratingFit.toFixed(2)),
    ratingFitDelta: Number((ratingFit - ratingFitPrev).toFixed(2)),
    conf04,
    confCalibration,
    repBuckets,
    balanceLedger,
    recent,
    periodMatchRows,
    repDetail,
    confDetail,
    advantage,
    streaks,
    momentum,
    timeline: buildBalanceSeries(settledAll, toNumber(config.initialCapital, 0), periodKey),
    modeBreakdown: calcModeBreakdown(settledPeriod),
    ratingRows: ratingRowsPeriod
      .map((row) => ({
        ...row,
        dateLabel: formatDate(row.date),
        diff: Number((row.actual_rating - row.expected_rating).toFixed(2)),
      }))
      .slice(0, 120),
  }
}

const normalizeTeamName = (teamName, aliasMap) => {
  const key = normalize(teamName)
  return aliasMap.get(key) || String(teamName || '').trim()
}

const buildAliasMap = (profiles) => {
  const map = new Map()
  profiles.forEach((profile) => {
    const aliases = [profile.teamName, ...(profile.abbreviations || [])]
    aliases.forEach((alias) => map.set(normalize(alias), profile.teamName))
  })
  return map
}

const pickTeamAbbr = (teamName, profile) => {
  const aliases = [profile?.abbreviations || [], profile?.teamName, teamName]
    .flat()
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  const asciiAliases = aliases.filter((alias) => /^[\x20-\x7e]+$/.test(alias))
  const shortCode = asciiAliases.find((alias) => /^[a-z0-9]{2,5}$/i.test(alias))
  if (shortCode) return shortCode.toUpperCase()

  const asciiAlias = asciiAliases.find((alias) => /^[a-z0-9 .'-]{2,20}$/i.test(alias))
  if (asciiAlias) {
    const compact = asciiAlias.replace(/[^a-z0-9]/gi, '').toUpperCase()
    if (compact.length >= 2) return compact.slice(0, 5)
  }

  return String(teamName || '').trim()
}

export const getTeamsSnapshot = (query = '', periodKey = 'all') => {
  const profiles = getTeamProfiles()
  const range = getPeriodRange(periodKey)
  const investments = getActiveInvestments().filter((item) => inRange(item.created_at, range))
  const aliasMap = buildAliasMap(profiles)
  const teamMap = new Map()

  const ensureTeam = (teamName) => {
    if (!teamMap.has(teamName)) {
      const profile = findTeamProfile(teamName, profiles)
      teamMap.set(teamName, {
        name: teamName,
        abbr: pickTeamAbbr(teamName, profile),
        totalSamples: 0,
        totalInputs: 0,
        totalProfit: 0,
        repValues: [],
        ratingDiffValues: [],
        roiHistoryRaw: [],
        ratingHistoryRaw: [],
      })
    }
    return teamMap.get(teamName)
  }

  profiles.forEach((profile) => {
    ensureTeam(profile.teamName)
  })

  investments.forEach((investment) => {
    const splitMatches = splitInvestmentToMatches(investment)
    splitMatches.forEach((match) => {
      const teams = [normalizeTeamName(match.home_team, aliasMap), normalizeTeamName(match.away_team, aliasMap)]
      const conf = toNumber(match.conf, NaN)
      const matchRating = toNumber(match.match_rating, NaN)
      const rep = toNumber(match.match_rep, NaN)

      teams.forEach((teamName) => {
        const team = ensureTeam(teamName)
        team.totalSamples += 1
        team.totalInputs += match.allocated_input
        team.totalProfit += match.allocated_profit
        if (Number.isFinite(rep)) team.repValues.push(rep)
        if (Number.isFinite(conf) && Number.isFinite(matchRating)) {
          const diff = matchRating - conf
          team.ratingDiffValues.push(diff)
          team.ratingHistoryRaw.push({ date: investment.created_at, value: diff })
        }
        team.roiHistoryRaw.push({
          date: investment.created_at,
          input: match.allocated_input,
          profit: match.allocated_profit,
        })
      })
    })
  })

  const queryNormalized = normalize(query)
  const teams = [...teamMap.values()]
    .map((team) => {
      const roi = calcRoi(team.totalProfit, team.totalInputs)
      const avgRep =
        team.repValues.length > 0 ? team.repValues.reduce((sum, value) => sum + value, 0) / team.repValues.length : 0.5
      const ratingDiff =
        team.ratingDiffValues.length > 0
          ? team.ratingDiffValues.reduce((sum, value) => sum + value, 0) / team.ratingDiffValues.length
          : 0

      const roiHistory = (() => {
        let inputCum = 0
        let profitCum = 0
        return team.roiHistoryRaw
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .map((point) => {
            inputCum += point.input
            profitCum += point.profit
            return {
              date: point.date,
              label: formatDate(point.date),
              value: calcRoi(profitCum, inputCum),
            }
          })
          .slice(-20)
      })()

      const ratingHistory = team.ratingHistoryRaw
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((point) => ({
          date: point.date,
          label: formatDate(point.date),
          value: point.value,
        }))
        .slice(-20)

      return {
        ...team,
        roi,
        avgRep,
        ratingDiff,
        roiHistory,
        ratingHistory,
      }
    })
    .filter((team) => {
      if (!queryNormalized) return true
      const target = `${team.name} ${team.abbr}`.toLowerCase()
      return target.includes(queryNormalized)
    })
    .sort((a, b) => b.totalSamples - a.totalSamples)

  return teams
}

export const getExpectedVsActualRows = (limit = 120) => {
  const investments = getSettledInvestments(getActiveInvestments())
  return getRatingRowsFromInvestments(investments)
    .map((row) => ({
      ...row,
      dateLabel: formatDate(row.date),
      diff: Number((row.actual_rating - row.expected_rating).toFixed(2)),
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)
}

const getConfBucket = (conf) => {
  if (conf >= 0.7) return '0.7-1.0'
  if (conf >= 0.4) return '0.4-0.7'
  return '0.0-0.4'
}

const getOddsBucket = (odds) => {
  if (odds >= 3) return '3.0+'
  if (odds >= 2) return '2.0-3.0'
  return '1.0-2.0'
}

export const getKellyDivisorMatrix = () => {
  const config = getSystemConfig()
  const investments = getSettledInvestments(getActiveInvestments())
  const globalRowsSource = toKellySimulationRowsFromInvestments(investments, config)
  const globalPick = pickKellyDivisor(globalRowsSource, config, toNumber(config.kellyDivisor, 4))
  const rows = new Map()

  investments.forEach((investment) => {
    splitInvestmentToMatches(investment).forEach((match) => {
      const mode = normalizeMode(match.mode)
      const canonicalMode = MODE_KEYS.includes(mode) ? mode : '常规'
      const conf = toNumber(match.conf, NaN)
      const odds = toNumber(match.odds, NaN)
      if (!Number.isFinite(conf) || !Number.isFinite(odds)) return
      const confBucket = getConfBucket(conf)
      const oddsBucket = getOddsBucket(odds)
      const key = `${canonicalMode}|${confBucket}|${oddsBucket}`
      if (!rows.has(key)) {
        rows.set(key, {
          mode: canonicalMode,
          confBucket,
          oddsBucket,
          samples: 0,
          inputs: 0,
          profit: 0,
          hits: 0,
          rows: [],
        })
      }
      const row = rows.get(key)
      row.samples += 1
      row.inputs += match.allocated_input
      row.profit += match.allocated_profit
      if (match.is_correct === true) row.hits += 1
      row.rows.push({
        expected: clamp(conf, 0.05, 0.95),
        odds: Math.max(1.01, odds),
        inputs: Math.max(0, toNumber(match.allocated_input, 0)),
        profit: toNumber(match.allocated_profit, 0),
      })
    })
  })

  return [...rows.values()]
    .map((row) => {
      const roi = calcRoi(row.profit, row.inputs)
      const hitRate = row.samples > 0 ? (row.hits / row.samples) * 100 : 0
      const pick = pickKellyDivisor(
        row.rows,
        config,
        globalPick.recommendedDivisor || toNumber(config.kellyDivisor, 4),
      )
      return {
        mode: row.mode,
        confBucket: row.confBucket,
        oddsBucket: row.oddsBucket,
        samples: row.samples,
        inputs: row.inputs,
        profit: row.profit,
        roi,
        hitRate,
        kellyDivisor: pick.recommendedDivisor,
        kellyReliability: pick.reliability,
      }
    })
    .sort((a, b) => b.samples - a.samples)
}

export const getModeKellyRecommendations = () => {
  const config = getSystemConfig()
  const investments = getSettledInvestments(getActiveInvestments())
  const globalRowsSource = toKellySimulationRowsFromInvestments(investments, config)
  const globalPick = pickKellyDivisor(globalRowsSource, config, toNumber(config.kellyDivisor, 4))

  const grouped = new Map()
  MODE_KEYS.forEach((mode) => {
    grouped.set(mode, [])
  })

  investments.forEach((item) => {
    const mode = getDominantModeFromInvestment(item)
    const key = grouped.has(mode) ? mode : '常规'
    grouped.get(key).push(item)
  })

  return [...grouped.entries()].map(([mode, items]) => {
    const sourceRows = toKellySimulationRowsFromInvestments(items, config)
    const pick = pickKellyDivisor(
      sourceRows,
      config,
      globalPick.recommendedDivisor || toNumber(config.kellyDivisor, 4),
    )
    const inputs = sourceRows.reduce((sum, row) => sum + row.inputs, 0)
    const profit = sourceRows.reduce((sum, row) => sum + row.profit, 0)
    const roi = calcRoi(profit, inputs)
    return {
      mode,
      samples: sourceRows.length,
      roi,
      kellyDivisor: pick.recommendedDivisor,
      reliability: pick.reliability,
    }
  })
}

const calcStdDev = (values) => {
  if (!values || values.length === 0) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
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
  if (!Number.isFinite(denominator) || denominator === 0) return 0
  return numerator / denominator
}

/**
 * 加权线性回归 (Weighted Least Squares)
 * @param {number[]} xs - X 值数组
 * @param {number[]} ys - Y 值数组
 * @param {number[]} weights - 权重数组 (可选，默认等权重)
 * @returns {{ slope: number, intercept: number, r2: number, rmse: number, n: number }}
 */
const weightedLinearRegression = (xs, ys, weights = null) => {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) {
    return { slope: 1, intercept: 0, r2: 0, rmse: 0, n: 0 }
  }

  const n = xs.length
  const w = weights || Array(n).fill(1)

  // 计算加权平均
  const sumW = w.reduce((sum, wi) => sum + wi, 0)
  const meanX = w.reduce((sum, wi, i) => sum + wi * xs[i], 0) / sumW
  const meanY = w.reduce((sum, wi, i) => sum + wi * ys[i], 0) / sumW

  // 计算加权协方差和方差
  let covXY = 0
  let varX = 0

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    covXY += w[i] * dx * dy
    varX += w[i] * dx * dx
  }

  // 斜率和截距
  const slope = varX > 0 ? covXY / varX : 1
  const intercept = meanY - slope * meanX

  // 计算 R² 和 RMSE
  let ssTot = 0
  let ssRes = 0

  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i]
    const residual = ys[i] - predicted
    ssTot += w[i] * (ys[i] - meanY) ** 2
    ssRes += w[i] * residual ** 2
  }

  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
  const rmse = Math.sqrt(ssRes / sumW)

  return {
    slope: Number(slope.toFixed(4)),
    intercept: Number(intercept.toFixed(4)),
    r2: Number(clamp(r2, 0, 1).toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
    n,
  }
}

const getRepDirectionWeight = (rep) => {
  if (!Number.isFinite(rep)) return 1.0
  if (rep <= 0.4) return 1.15
  if (rep <= 0.8) return 1.0
  return 0.78
}

/**
 * 获取 Conf 回归校准数据
 * 使用加权线性回归分析 Expected (Conf) vs Actual (Match Rating) 的关系
 * 权重考虑时间近因和 REP 方向性
 * @returns {{ regression: object, scatterData: array, calibrate: function }}
 */
export const getConfRegressionCalibration = (matchRowsInput = null) => {
  const matchRows = Array.isArray(matchRowsInput)
    ? [...matchRowsInput].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    : getSettledInvestments(getActiveInvestments())
        .flatMap((investment) =>
          splitInvestmentToMatches(investment).map((match) => ({
            investment,
            match,
            created_at: investment.created_at,
          })),
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const sampleCount = matchRows.length
  const n = Math.max(1, Math.floor(sampleCount / 50))

  // 收集有效数据点
  const validPoints = []

  matchRows.forEach((row, index) => {
    const conf = toNumber(row.match.conf, Number.NaN)
    const actual = toNumber(row.match.match_rating, Number.NaN)
    if (!Number.isFinite(conf) || !Number.isFinite(actual) || conf <= 0) return

    // 计算时间近因权重
    let recencyWeight = 1.0
    if (index < 6 * n) recencyWeight = 1.4
    else if (index < 11 * n) recencyWeight = 1.15

    // 计算 REP 方向性权重
    const repValue = toNumber(row.match.match_rep, toNumber(row.investment.rep, Number.NaN))
    const repWeight = getRepDirectionWeight(repValue)

    // 综合权重
    const weight = recencyWeight * repWeight

    validPoints.push({
      x: conf,
      y: actual,
      weight,
      date: row.created_at,
      match: `${row.match.home_team || '-'} vs ${row.match.away_team || '-'}`,
      rep: repValue,
      recencyBand: index < 6 * n ? 'recent' : index < 11 * n ? 'mid' : 'base',
    })
  })

  if (validPoints.length < 3) {
    return {
      regression: { slope: 1, intercept: 0, r2: 0, rmse: 0, n: 0 },
      scatterData: [],
      calibrate: (conf) => conf,
      calibrationMultiplier: 1,
      regressionReliability: 0,
    }
  }

  // 执行加权线性回归
  const xs = validPoints.map((p) => p.x)
  const ys = validPoints.map((p) => p.y)
  const weights = validPoints.map((p) => p.weight)

  const regression = weightedLinearRegression(xs, ys, weights)

  // 计算校准乘数 (用于简单乘法校准)
  const weightedSumX = validPoints.reduce((sum, p) => sum + p.x * p.weight, 0)
  const weightedSumY = validPoints.reduce((sum, p) => sum + p.y * p.weight, 0)
  const totalWeight = validPoints.reduce((sum, p) => sum + p.weight, 0)
  const avgX = weightedSumX / totalWeight
  const avgY = weightedSumY / totalWeight
  const calibrationMultiplier = avgX > 0 ? clamp(avgY / avgX, 0.7, 1.3) : 1

  // 小样本/弱拟合自动收缩到原始 Conf，防止回归校准过拟合
  const reliabilityBySamples = clamp((validPoints.length - 8) / 52, 0, 1)
  const reliabilityByFit = clamp((regression.r2 - 0.02) / 0.28, 0, 1)
  const regressionReliability = clamp(reliabilityBySamples * 0.72 + reliabilityByFit * 0.28, 0, 1)

  // 校准函数：优先使用回归方程，并与乘数法做稳定融合
  const calibrate = (conf) => {
    if (!Number.isFinite(conf) || conf <= 0) return conf
    const linearCalibrated = regression.intercept + regression.slope * conf
    const multiplierCalibrated = conf * calibrationMultiplier
    const blendedModel = linearCalibrated * 0.72 + multiplierCalibrated * 0.28
    const stabilized = conf * (1 - regressionReliability) + blendedModel * regressionReliability
    return clamp(stabilized, 0.1, 0.95)
  }

  // 为散点图准备数据
  const scatterData = validPoints.map((p) => ({
    x: Number(p.x.toFixed(3)),
    y: Number(p.y.toFixed(3)),
    weight: Number(p.weight.toFixed(2)),
    date: formatDate(p.date),
    match: p.match,
    rep: Number.isFinite(p.rep) ? Number(p.rep.toFixed(2)) : null,
    recencyBand: p.recencyBand,
    residual: Number((p.y - (regression.intercept + regression.slope * p.x)).toFixed(3)),
  }))

  return {
    regression,
    scatterData,
    calibrate,
    calibrationMultiplier: Number(calibrationMultiplier.toFixed(4)),
    regressionReliability: Number(regressionReliability.toFixed(4)),
  }
}

const getRepDirectionBucket = (rep) => {
  if (!Number.isFinite(rep)) return 'medium'
  if (rep <= 0.4) return 'low'
  if (rep <= 0.8) return 'medium'
  return 'high'
}

const getRecencyBandByIndex = (index, n) => {
  if (index < 6 * n) return 'recent'
  if (index < 11 * n) return 'mid'
  return 'base'
}

export const getPredictionCalibrationContext = () => {
  const settled = getSettledInvestments(getActiveInvestments())
  const matchRows = settled
    .flatMap((investment) =>
      splitInvestmentToMatches(investment).map((match) => ({
        investment,
        match,
        created_at: investment.created_at,
      })),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const sampleCount = matchRows.length
  const n = Math.max(1, Math.floor(sampleCount / 50))

  const bands = {
    recent: { key: 'recent', label: `最近 ${6 * n} 场`, weight: 1.4, samples: 0 },
    mid: { key: 'mid', label: `${6 * n + 1}~${11 * n} 场`, weight: 1.15, samples: 0 },
    base: { key: 'base', label: `${11 * n + 1}+ 场`, weight: 1.0, samples: 0 },
  }

  const repBuckets = {
    low: { key: 'low', label: 'REP ≤ 0.4', weight: 1.15, samples: 0 },
    medium: { key: 'medium', label: '0.4 < REP ≤ 0.8', weight: 1.0, samples: 0 },
    high: { key: 'high', label: 'REP > 0.8', weight: 0.78, samples: 0 },
  }

  let confWeightedSum = 0
  let confWeightTotal = 0
  let fseWeightedSum = 0
  let fseWeightTotal = 0

  matchRows.forEach((row, index) => {
    const bandKey = getRecencyBandByIndex(index, n)
    const band = bands[bandKey]
    band.samples += 1

    const repValue = toNumber(row.match.match_rep, toNumber(row.investment.rep, Number.NaN))
    const repKey = getRepDirectionBucket(repValue)
    const repBucket = repBuckets[repKey]
    repBucket.samples += 1

    const sampleWeight = band.weight * repBucket.weight
    const conf = toNumber(row.match.conf, Number.NaN)
    const actual = toNumber(row.match.match_rating, Number.NaN)
    if (!Number.isFinite(conf) || !Number.isFinite(actual) || conf <= 0) return

    const confRatio = clamp(actual / conf, 0.6, 1.4)
    confWeightedSum += confRatio * sampleWeight
    confWeightTotal += sampleWeight

    const fseHome = toNumber(row.match.fse_home, Number.NaN)
    const fseAway = toNumber(row.match.fse_away, Number.NaN)
    if (!Number.isFinite(fseHome) || !Number.isFinite(fseAway)) return
    const fseMatch = Math.sqrt(clamp(fseHome, 0.05, 1) * clamp(fseAway, 0.05, 1))
    const fseBaseline = 0.88 + fseMatch * 0.24
    const fseRatio = clamp(confRatio / fseBaseline, 0.6, 1.4)
    fseWeightedSum += fseRatio * sampleWeight
    fseWeightTotal += sampleWeight
  })

  const confMultiplier = confWeightTotal > 0 ? clamp(confWeightedSum / confWeightTotal, 0.75, 1.25) : 1
  const fseMultiplier = fseWeightTotal > 0 ? clamp(fseWeightedSum / fseWeightTotal, 0.75, 1.25) : 1

  const effectiveRecencyWeight =
    sampleCount > 0
      ? (bands.recent.samples * bands.recent.weight + bands.mid.samples * bands.mid.weight + bands.base.samples * bands.base.weight) /
        sampleCount
      : 1

  // 获取回归校准数据
  const regressionData = getConfRegressionCalibration()

  return {
    sampleCount,
    n,
    multipliers: {
      conf: Number(confMultiplier.toFixed(3)),
      fse: Number(fseMultiplier.toFixed(3)),
    },
    effectiveRecencyWeight: Number(effectiveRecencyWeight.toFixed(3)),
    bands: [bands.recent, bands.mid, bands.base],
    repBuckets: [repBuckets.low, repBuckets.medium, repBuckets.high],
    // 新增回归分析数据
    regression: regressionData.regression,
    regressionMultiplier: regressionData.calibrationMultiplier,
    regressionReliability: regressionData.regressionReliability,
    scatterData: regressionData.scatterData,
    calibrate: regressionData.calibrate,
  }
}

const toCalibrationMatchRows = (rows) =>
  rows.map((row) => ({
    investment: {
      rep: row.rep,
      created_at: row.created_at,
    },
    match: {
      conf: row.conf,
      match_rating: row.actual,
      match_rep: row.rep,
      home_team: '',
      away_team: '',
    },
    created_at: row.created_at,
  }))

const getBinaryOutcomeRows = () => {
  const settled = getSettledInvestments(getActiveInvestments())
  return settled
    .flatMap((investment) =>
      splitInvestmentToMatches(investment).map((match) => {
        if (typeof match.is_correct !== 'boolean') return null
        const conf = toNumber(match.conf, Number.NaN)
        const odds = toNumber(match.odds, Number.NaN)
        if (!Number.isFinite(conf) || !Number.isFinite(odds) || conf <= 0 || odds <= 1) return null
        return {
          created_at: investment.created_at,
          conf: clamp(conf, 0.02, 0.98),
          actual: match.is_correct ? 1 : 0,
          odds,
          rep: toNumber(match.match_rep, toNumber(investment.rep, Number.NaN)),
        }
      }),
    )
    .filter(Boolean)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

const calcBrierScore = (rows, predictFn) => {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  const loss = rows.reduce((sum, row) => {
    const p = clamp(toNumber(predictFn(row), row.conf), 0.001, 0.999)
    const y = row.actual
    return sum + (p - y) ** 2
  }, 0)
  return loss / rows.length
}

const calcLogLoss = (rows, predictFn) => {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  const loss = rows.reduce((sum, row) => {
    const p = clamp(toNumber(predictFn(row), row.conf), 0.001, 0.999)
    const y = row.actual
    return sum - (y * Math.log(p) + (1 - y) * Math.log(1 - p))
  }, 0)
  return loss / rows.length
}

const calcCalibrationMae = (rows, predictFn, bins = 8) => {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  const bucketMap = new Map()
  rows.forEach((row) => {
    const p = clamp(toNumber(predictFn(row), row.conf), 0.001, 0.999)
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))
    if (!bucketMap.has(idx)) {
      bucketMap.set(idx, { count: 0, pSum: 0, ySum: 0 })
    }
    const bucket = bucketMap.get(idx)
    bucket.count += 1
    bucket.pSum += p
    bucket.ySum += row.actual
  })

  const total = [...bucketMap.values()].reduce((sum, bucket) => sum + bucket.count, 0)
  if (total <= 0) return 0
  return (
    [...bucketMap.values()].reduce((sum, bucket) => {
      const pAvg = bucket.pSum / bucket.count
      const yAvg = bucket.ySum / bucket.count
      return sum + Math.abs(pAvg - yAvg) * bucket.count
    }, 0) / total
  )
}

const simulateKellyStrategyByRows = (rows, predictFn, config, divisor) => {
  let balance = toNumber(config.initialCapital, 0)
  let peak = balance
  let maxDrawdown = 0
  let totalInvest = 0
  let totalProfit = 0
  let samples = 0
  let wins = 0

  rows.forEach((row) => {
    const p = clamp(toNumber(predictFn(row), row.conf), 0.02, 0.98)
    const odds = Math.max(1.01, toNumber(row.odds, toNumber(config.defaultOdds, 2.5)))
    const stake = Math.round(calcKellyStake(p, odds, divisor, config))
    if (stake <= 0) return

    const unitReturn = row.actual === 1 ? odds - 1 : -1
    const simProfit = stake * unitReturn
    totalInvest += stake
    totalProfit += simProfit
    samples += 1
    if (simProfit > 0) wins += 1

    balance += simProfit
    if (balance > peak) peak = balance
    const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  })

  return {
    samples,
    totalInvest,
    totalProfit,
    roi: calcRoi(totalProfit, totalInvest),
    hitRate: samples > 0 ? (wins / samples) * 100 : 0,
    maxDrawdown,
  }
}

const evaluateWalkForward = (rows) => {
  const checkpoints = [0.55, 0.7, 0.82]
  const windows = []
  checkpoints.forEach((ratio, idx) => {
    const split = Math.floor(rows.length * ratio)
    const testSize = Math.max(8, Math.floor(rows.length * 0.12))
    const trainRows = rows.slice(0, split)
    const testRows = rows.slice(split, Math.min(rows.length, split + testSize))
    if (trainRows.length < 12 || testRows.length < 6) return

    const fit = getConfRegressionCalibration(toCalibrationMatchRows(trainRows))
    const rawBrier = calcBrierScore(testRows, (row) => row.conf)
    const calibratedBrier = calcBrierScore(testRows, (row) => fit.calibrate(row.conf))
    const gain = rawBrier > 0 ? ((rawBrier - calibratedBrier) / rawBrier) * 100 : 0

    windows.push({
      label: `W${idx + 1}`,
      trainSamples: trainRows.length,
      testSamples: testRows.length,
      rawBrier: Number(rawBrier.toFixed(4)),
      calibratedBrier: Number(calibratedBrier.toFixed(4)),
      gainPct: Number(gain.toFixed(2)),
    })
  })
  return windows
}

export const getModelValidationSnapshot = () => {
  const config = getSystemConfig()
  const rows = getBinaryOutcomeRows()
  const minimumSamples = 24

  if (rows.length < minimumSamples) {
    return {
      ready: false,
      minimumSamples,
      sampleCount: rows.length,
      trainSamples: 0,
      testSamples: 0,
      stability: 'insufficient',
      message: `样本不足：需至少 ${minimumSamples} 场已结算且含命中信息。`,
      walkForward: [],
    }
  }

  const splitIndex = Math.min(rows.length - 8, Math.max(12, Math.floor(rows.length * 0.7)))
  const trainRows = rows.slice(0, splitIndex)
  const testRows = rows.slice(splitIndex)
  const calibration = getConfRegressionCalibration(toCalibrationMatchRows(trainRows))

  const rawPredict = (row) => row.conf
  const calibratedPredict = (row) => calibration.calibrate(row.conf)

  const trainRawBrier = calcBrierScore(trainRows, rawPredict)
  const trainCalBrier = calcBrierScore(trainRows, calibratedPredict)
  const testRawBrier = calcBrierScore(testRows, rawPredict)
  const testCalBrier = calcBrierScore(testRows, calibratedPredict)

  const trainRawLogLoss = calcLogLoss(trainRows, rawPredict)
  const trainCalLogLoss = calcLogLoss(trainRows, calibratedPredict)
  const testRawLogLoss = calcLogLoss(testRows, rawPredict)
  const testCalLogLoss = calcLogLoss(testRows, calibratedPredict)

  const testRawMae = calcCalibrationMae(testRows, rawPredict)
  const testCalMae = calcCalibrationMae(testRows, calibratedPredict)

  const divisor = Math.max(1, toNumber(config.kellyDivisor, 4))
  const strategyRaw = simulateKellyStrategyByRows(testRows, rawPredict, config, divisor)
  const strategyCalibrated = simulateKellyStrategyByRows(testRows, calibratedPredict, config, divisor)

  const brierGainPct = testRawBrier > 0 ? ((testRawBrier - testCalBrier) / testRawBrier) * 100 : 0
  const logLossGainPct = testRawLogLoss > 0 ? ((testRawLogLoss - testCalLogLoss) / testRawLogLoss) * 100 : 0
  const maeGainPct = testRawMae > 0 ? ((testRawMae - testCalMae) / testRawMae) * 100 : 0
  const drift = testCalBrier - trainCalBrier

  const walkForward = evaluateWalkForward(rows)
  const positiveWalkForward = walkForward.filter((row) => row.gainPct > 0).length

  let stability = 'stable'
  if (drift > 0.03 || brierGainPct < -2) stability = 'risk'
  else if (drift > 0.015 || brierGainPct < 1) stability = 'watch'

  return {
    ready: true,
    minimumSamples,
    sampleCount: rows.length,
    trainSamples: trainRows.length,
    testSamples: testRows.length,
    divisor,
    stability,
    regressionReliability: calibration.regressionReliability,
    brier: {
      trainRaw: Number(trainRawBrier.toFixed(4)),
      trainCalibrated: Number(trainCalBrier.toFixed(4)),
      testRaw: Number(testRawBrier.toFixed(4)),
      testCalibrated: Number(testCalBrier.toFixed(4)),
      gainPct: Number(brierGainPct.toFixed(2)),
      drift: Number(drift.toFixed(4)),
    },
    logLoss: {
      trainRaw: Number(trainRawLogLoss.toFixed(4)),
      trainCalibrated: Number(trainCalLogLoss.toFixed(4)),
      testRaw: Number(testRawLogLoss.toFixed(4)),
      testCalibrated: Number(testCalLogLoss.toFixed(4)),
      gainPct: Number(logLossGainPct.toFixed(2)),
    },
    calibrationMae: {
      testRaw: Number(testRawMae.toFixed(4)),
      testCalibrated: Number(testCalMae.toFixed(4)),
      gainPct: Number(maeGainPct.toFixed(2)),
    },
    strategy: {
      raw: {
        roi: Number(strategyRaw.roi.toFixed(2)),
        maxDrawdown: Number(strategyRaw.maxDrawdown.toFixed(2)),
        hitRate: Number(strategyRaw.hitRate.toFixed(1)),
        samples: strategyRaw.samples,
      },
      calibrated: {
        roi: Number(strategyCalibrated.roi.toFixed(2)),
        maxDrawdown: Number(strategyCalibrated.maxDrawdown.toFixed(2)),
        hitRate: Number(strategyCalibrated.hitRate.toFixed(1)),
        samples: strategyCalibrated.samples,
      },
    },
    walkForward,
    positiveWalkForward,
  }
}

const getFineConfBucket = (conf) => {
  if (conf >= 0.8) return '0.8+'
  if (conf >= 0.7) return '0.7-0.8'
  if (conf >= 0.6) return '0.6-0.7'
  if (conf >= 0.5) return '0.5-0.6'
  if (conf >= 0.4) return '0.4-0.5'
  return '<0.4'
}

const FINE_CONF_BUCKET_ORDER = ['0.8+', '0.7-0.8', '0.6-0.7', '0.5-0.6', '0.4-0.5', '<0.4']

const getOddsBucketByHalf = (odds) => {
  if (!Number.isFinite(odds) || odds <= 0) return 'unknown'
  if (odds >= 4) return '4.0+'
  const start = Math.floor((odds - 1) / 0.5) * 0.5 + 1
  const end = start + 0.5
  return `${start.toFixed(1)}-${end.toFixed(1)}`
}

const ODDS_BUCKET_ORDER = ['1.0-1.5', '1.5-2.0', '2.0-2.5', '2.5-3.0', '3.0-3.5', '3.5-4.0', '4.0+']

const getReturnsByPeriod = (settledInvestments, days, now = new Date()) => {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  return settledInvestments
    .filter((item) => inRange(item.created_at, { start, end }))
    .map((item) => ({
      profit: toNumber(item.profit),
      inputs: Math.max(0, toNumber(item.inputs)),
      ret: toNumber(item.inputs) > 0 ? toNumber(item.profit) / toNumber(item.inputs) : 0,
    }))
}

const calcStreaks = (settledInvestments) => {
  const sorted = [...settledInvestments].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  let maxWin = 0
  let maxLose = 0
  let curWin = 0
  let curLose = 0

  sorted.forEach((item) => {
    const isWin = item.status === 'win'
    if (isWin) {
      curWin += 1
      curLose = 0
    } else {
      curLose += 1
      curWin = 0
    }
    if (curWin > maxWin) maxWin = curWin
    if (curLose > maxLose) maxLose = curLose
  })

  return { maxWin, maxLose }
}

export const getAnalysisSnapshot = (periodKey = 'all') => {
  const range = getPeriodRange(periodKey)
  const investments = getActiveInvestments().filter((item) => inRange(item.created_at, range))
  const settled = getSettledInvestments(investments)
  const modeKelly = getModeKellyRecommendations()
  const modeKellyMap = new Map(modeKelly.map((row) => [row.mode, row.kellyDivisor]))

  const strategyMap = new Map([
    [1, { type: 'solo', label: 'Solo Position', sublabel: '单标的持仓', samples: 0, wins: 0, inputs: 0, profit: 0, oddsSum: 0 }],
    [2, { type: 'double', label: 'Double Position', sublabel: '双标的持仓', samples: 0, wins: 0, inputs: 0, profit: 0, oddsSum: 0 }],
    [3, { type: 'triple', label: 'Triple Position', sublabel: '三标的持仓', samples: 0, wins: 0, inputs: 0, profit: 0, oddsSum: 0 }],
    [4, { type: 'quad', label: 'Quad Position', sublabel: '四标的持仓', samples: 0, wins: 0, inputs: 0, profit: 0, oddsSum: 0 }],
  ])
  const multiBucket = {
    type: 'multi',
    label: 'Multi Position',
    sublabel: '多标的持仓',
    samples: 0,
    wins: 0,
    inputs: 0,
    profit: 0,
    oddsSum: 0,
  }

  settled.forEach((item) => {
    const size = Number(item.parlay_size || item.matches?.length || 1)
    const target = strategyMap.get(size) || multiBucket
    target.samples += 1
    target.inputs += Math.max(0, toNumber(item.inputs))
    target.profit += toNumber(item.profit)
    target.oddsSum += Math.max(1, toNumber(item.combined_odds, 1))
    if (item.status === 'win') target.wins += 1
  })

  const strategyData = [...strategyMap.values(), multiBucket]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      ...row,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      avgOdds: row.samples > 0 ? row.oddsSum / row.samples : 0,
    }))

  const modeRowsMap = new Map()
  MODE_KEYS.forEach((mode) => {
    modeRowsMap.set(mode, {
      mode,
      samples: 0,
      wins: 0,
      inputs: 0,
      profit: 0,
      oddsSum: 0,
      diffSum: 0,
      diffCount: 0,
    })
  })

  settled.forEach((item) => {
    splitInvestmentToMatches(item).forEach((match) => {
      const mode = MODE_KEYS.includes(normalizeMode(match.mode)) ? normalizeMode(match.mode) : '常规'
      const row = modeRowsMap.get(mode)
      row.samples += 1
      row.inputs += match.allocated_input
      row.profit += match.allocated_profit
      row.oddsSum += Math.max(1, toNumber(match.odds, 1))
      if (match.is_correct === true) row.wins += 1
      const conf = toNumber(match.conf, NaN)
      const ajr = toNumber(match.match_rating, NaN)
      if (Number.isFinite(conf) && Number.isFinite(ajr)) {
        row.diffSum += ajr - conf
        row.diffCount += 1
      }
    })
  })

  const modeData = [...modeRowsMap.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      mode: row.mode,
      samples: row.samples,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      avgOdds: row.samples > 0 ? row.oddsSum / row.samples : 0,
      avgActualMinusConf: row.diffCount > 0 ? row.diffSum / row.diffCount : 0,
      kelly: modeKellyMap.get(row.mode) || 4,
    }))
    .sort((a, b) => b.samples - a.samples)

  const confBucketMap = new Map([
    ['0.0-0.4', { confBucket: '0.0-0.4', samples: 0, wins: 0, inputs: 0, profit: 0, expectedSum: 0, actualSum: 0 }],
    ['0.4-0.7', { confBucket: '0.4-0.7', samples: 0, wins: 0, inputs: 0, profit: 0, expectedSum: 0, actualSum: 0 }],
    ['0.7-1.0', { confBucket: '0.7-1.0', samples: 0, wins: 0, inputs: 0, profit: 0, expectedSum: 0, actualSum: 0 }],
  ])

  settled.forEach((item) => {
    splitInvestmentToMatches(item).forEach((match) => {
      const conf = toNumber(match.conf, NaN)
      if (!Number.isFinite(conf)) return
      const key = getConfBucket(conf)
      const row = confBucketMap.get(key)
      row.samples += 1
      row.inputs += match.allocated_input
      row.profit += match.allocated_profit
      row.expectedSum += conf
      if (match.is_correct === true) row.wins += 1
      const ajr = toNumber(match.match_rating, NaN)
      if (Number.isFinite(ajr)) row.actualSum += ajr
    })
  })

  const confData = [...confBucketMap.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      ...row,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: (row.wins / row.samples) * 100,
      expected: row.expectedSum / row.samples,
      actual: row.actualSum / row.samples,
    }))

  const entryTypeMap = new Map()
  settled.forEach((item) => {
    splitInvestmentToMatches(item).forEach((match) => {
      const market = getPrimaryEntryMarket(match.entries, match.entry_text || '')
      const key = market.marketType || 'other'
      if (!entryTypeMap.has(key)) {
        entryTypeMap.set(key, {
          marketType: key,
          marketLabel: market.marketLabel || '其他',
          samples: 0,
          wins: 0,
          inputs: 0,
          profit: 0,
          examples: [],
        })
      }
      const row = entryTypeMap.get(key)
      row.samples += 1
      row.inputs += match.allocated_input
      row.profit += match.allocated_profit
      if (match.is_correct === true) row.wins += 1

      const sampleEntry = Array.isArray(match.entries) ? String(match.entries[0]?.name || '').trim() : ''
      if (sampleEntry && row.examples.length < 3 && !row.examples.includes(sampleEntry)) {
        row.examples.push(sampleEntry)
      }
    })
  })

  const entryTypeData = [...entryTypeMap.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      marketType: row.marketType,
      marketLabel: row.marketLabel,
      samples: row.samples,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      examples: row.examples.join(' / '),
    }))
    .sort((a, b) => b.samples - a.samples || b.roi - a.roi)

  return {
    strategyData,
    modeData,
    confData,
    entryTypeData,
  }
}

export const getMetricsSnapshot = (periodKey = 'all') => {
  const config = getSystemConfig()
  const range = getPeriodRange(periodKey)
  const investments = getActiveInvestments().filter((item) => inRange(item.created_at, range))
  const settled = getSettledInvestments(investments)
  const splitMatches = settled.flatMap((item) =>
    splitInvestmentToMatches(item).map((match, matchIndex) => ({
      ...match,
      investment_id: item.id,
      created_at: item.created_at,
      parlay_size: Number(item.parlay_size || item.matches?.length || 1),
      status: item.status,
      match_index: matchIndex,
    })),
  )
  const returns = settled.map((item) => {
    const inputs = Math.max(0, toNumber(item.inputs))
    const profit = toNumber(item.profit)
    return inputs > 0 ? profit / inputs : 0
  })

  const totalInputs = settled.reduce((sum, item) => sum + Math.max(0, toNumber(item.inputs)), 0)
  const totalProfit = settled.reduce((sum, item) => sum + toNumber(item.profit), 0)
  const roi = calcRoi(totalProfit, totalInputs)
  const wins = settled.filter((item) => item.status === 'win').length
  const hitRate = settled.length > 0 ? (wins / settled.length) * 100 : 0
  const avgExpectedEdge =
    splitMatches.length > 0
      ? splitMatches.reduce((sum, match) => sum + (toNumber(match.conf) * toNumber(match.odds) - 1), 0) / splitMatches.length
      : 0

  const maxWin = settled.reduce((max, item) => Math.max(max, toNumber(item.profit)), 0)
  const maxLoss = settled.reduce((min, item) => Math.min(min, toNumber(item.profit)), 0)
  const streaks = calcStreaks(settled)

  const volatility = calcStdDev(returns) * 100
  const meanReturn = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0
  const downsideReturns = returns.filter((value) => value < 0)
  const downsideVolatility = calcStdDev(downsideReturns.length > 0 ? downsideReturns : [0])
  const sharpe = volatility > 0 ? (meanReturn / (volatility / 100)) * Math.sqrt(returns.length || 1) : 0
  const sortino = downsideVolatility > 0 ? (meanReturn / downsideVolatility) * Math.sqrt(returns.length || 1) : 0

  const grossProfit = settled.reduce((sum, item) => sum + Math.max(0, toNumber(item.profit)), 0)
  const grossLoss = Math.abs(settled.reduce((sum, item) => sum + Math.min(0, toNumber(item.profit)), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0

  const poolBalance = toNumber(config.initialCapital) + totalProfit
  const utilization = poolBalance > 0 ? (totalInputs / Math.max(poolBalance, 1)) * 100 : 0

  const returns7 = getReturnsByPeriod(settled, 7)
  const returns14 = getReturnsByPeriod(settled, 14)
  const returns30 = getReturnsByPeriod(settled, 30)
  const roi7 = calcRoi(
    returns7.reduce((sum, row) => sum + row.profit, 0),
    returns7.reduce((sum, row) => sum + row.inputs, 0),
  )
  const roi14 = calcRoi(
    returns14.reduce((sum, row) => sum + row.profit, 0),
    returns14.reduce((sum, row) => sum + row.inputs, 0),
  )
  const roi30 = calcRoi(
    returns30.reduce((sum, row) => sum + row.profit, 0),
    returns30.reduce((sum, row) => sum + row.inputs, 0),
  )

  let runningBalance = toNumber(config.initialCapital)
  let peak = runningBalance
  let maxDrawdown = 0
  ;[...settled]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .forEach((item) => {
      runningBalance += toNumber(item.profit)
      if (runningBalance > peak) peak = runningBalance
      const drawdown = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    })

  const modeMatrixMap = new Map()
  MODE_KEYS.forEach((mode) =>
    modeMatrixMap.set(mode, {
      mode,
      samples: 0,
      wins: 0,
      inputs: 0,
      profit: 0,
      oddsSum: 0,
      confSum: 0,
      confCount: 0,
      ajrSum: 0,
      ajrCount: 0,
      diffSum: 0,
      diffCount: 0,
    }),
  )

  const confMatrixMap = new Map(
    FINE_CONF_BUCKET_ORDER.map((bucket) => [
      bucket,
      {
        bucket,
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

  const oddsMatrixMap = new Map(
    ODDS_BUCKET_ORDER.map((bucket) => [
      bucket,
      {
        bucket,
        samples: 0,
        wins: 0,
        inputs: 0,
        profit: 0,
        confSum: 0,
        confCount: 0,
        ajrSum: 0,
        ajrCount: 0,
      },
    ]),
  )

  const entryMatrixMap = new Map()

  const corrPairs = {
    confAjr: { x: [], y: [] },
    oddsReturn: { x: [], y: [] },
    repReturn: { x: [], y: [] },
    fidReturn: { x: [], y: [] },
    fseReturn: { x: [], y: [] },
  }

  const matchRows = splitMatches
    .map((match) => {
      const mode = MODE_KEYS.includes(normalizeMode(match.mode)) ? normalizeMode(match.mode) : '常规'
      const conf = toNumber(match.conf, NaN)
      const ajr = toNumber(match.match_rating, NaN)
      const odds = toNumber(match.odds, NaN)
      const rep = toNumber(match.match_rep, NaN)
      const fid = toNumber(match.fid, NaN)
      const fseHome = toNumber(match.fse_home, NaN)
      const fseAway = toNumber(match.fse_away, NaN)
      const fse =
        Number.isFinite(fseHome) && Number.isFinite(fseAway)
          ? Number(Math.sqrt(clamp(fseHome, 0.05, 1) * clamp(fseAway, 0.05, 1)).toFixed(3))
          : Number.NaN
      const allocatedInput = Math.max(0, toNumber(match.allocated_input, 0))
      const allocatedProfit = toNumber(match.allocated_profit, 0)
      const roiByMatch = allocatedInput > 0 ? calcRoi(allocatedProfit, allocatedInput) : 0
      const confBucket = Number.isFinite(conf) ? getFineConfBucket(conf) : '<0.4'
      const oddsBucket = Number.isFinite(odds) ? getOddsBucketByHalf(odds) : 'unknown'
      const entryMarket = getPrimaryEntryMarket(match.entries, match.entry_text || '')
      const entryType = entryMarket.marketType || 'other'
      const entryLabel = entryMarket.marketLabel || '其他'

      const modeRow = modeMatrixMap.get(mode) || modeMatrixMap.get('常规')
      modeRow.samples += 1
      modeRow.inputs += allocatedInput
      modeRow.profit += allocatedProfit
      if (match.is_correct === true) modeRow.wins += 1
      if (Number.isFinite(odds)) modeRow.oddsSum += odds
      if (Number.isFinite(conf)) {
        modeRow.confSum += conf
        modeRow.confCount += 1
      }
      if (Number.isFinite(ajr)) {
        modeRow.ajrSum += ajr
        modeRow.ajrCount += 1
      }
      if (Number.isFinite(conf) && Number.isFinite(ajr)) {
        modeRow.diffSum += ajr - conf
        modeRow.diffCount += 1
      }

      const confRow = confMatrixMap.get(confBucket)
      if (confRow) {
        confRow.samples += 1
        confRow.inputs += allocatedInput
        confRow.profit += allocatedProfit
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

      const oddsRow = oddsMatrixMap.get(oddsBucket)
      if (oddsRow) {
        oddsRow.samples += 1
        oddsRow.inputs += allocatedInput
        oddsRow.profit += allocatedProfit
        if (match.is_correct === true) oddsRow.wins += 1
        if (Number.isFinite(conf)) {
          oddsRow.confSum += conf
          oddsRow.confCount += 1
        }
        if (Number.isFinite(ajr)) {
          oddsRow.ajrSum += ajr
          oddsRow.ajrCount += 1
        }
      }

      if (!entryMatrixMap.has(entryType)) {
        entryMatrixMap.set(entryType, {
          marketType: entryType,
          marketLabel: entryLabel,
          samples: 0,
          wins: 0,
          inputs: 0,
          profit: 0,
          confSum: 0,
          confCount: 0,
          ajrSum: 0,
          ajrCount: 0,
          oddsSum: 0,
          oddsCount: 0,
        })
      }
      const entryRow = entryMatrixMap.get(entryType)
      entryRow.samples += 1
      entryRow.inputs += allocatedInput
      entryRow.profit += allocatedProfit
      if (match.is_correct === true) entryRow.wins += 1
      if (Number.isFinite(conf)) {
        entryRow.confSum += conf
        entryRow.confCount += 1
      }
      if (Number.isFinite(ajr)) {
        entryRow.ajrSum += ajr
        entryRow.ajrCount += 1
      }
      if (Number.isFinite(odds)) {
        entryRow.oddsSum += odds
        entryRow.oddsCount += 1
      }

      const matchReturn = allocatedInput > 0 ? allocatedProfit / allocatedInput : 0
      if (Number.isFinite(conf) && Number.isFinite(ajr)) {
        corrPairs.confAjr.x.push(conf)
        corrPairs.confAjr.y.push(ajr)
      }
      if (Number.isFinite(odds)) {
        corrPairs.oddsReturn.x.push(odds)
        corrPairs.oddsReturn.y.push(matchReturn)
      }
      if (Number.isFinite(rep)) {
        corrPairs.repReturn.x.push(rep)
        corrPairs.repReturn.y.push(matchReturn)
      }
      if (Number.isFinite(fid)) {
        corrPairs.fidReturn.x.push(fid)
        corrPairs.fidReturn.y.push(matchReturn)
      }
      if (Number.isFinite(fse)) {
        corrPairs.fseReturn.x.push(fse)
        corrPairs.fseReturn.y.push(matchReturn)
      }

      return {
        id: `${match.investment_id}-${match.match_index}`,
        investmentId: match.investment_id,
        date: match.created_at,
        dateLabel: formatDate(match.created_at),
        match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
        entry:
          match.entry_text ||
          (Array.isArray(match.entries) ? match.entries.map((entry) => entry?.name).filter(Boolean).join(', ') : '-') ||
          '-',
        result: match.results || '-',
        mode,
        conf: Number.isFinite(conf) ? conf : Number.NaN,
        ajr: Number.isFinite(ajr) ? ajr : Number.NaN,
        odds: Number.isFinite(odds) ? odds : Number.NaN,
        rep: Number.isFinite(rep) ? rep : Number.NaN,
        fid: Number.isFinite(fid) ? fid : Number.NaN,
        fse: Number.isFinite(fse) ? fse : Number.NaN,
        confBucket,
        oddsBucket,
        entryType,
        entryLabel,
        parlaySize: match.parlay_size,
        isCorrect: match.is_correct === true,
        allocatedInput,
        allocatedProfit,
        roi: roiByMatch,
      }
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const modeKellyMap = new Map(getModeKellyRecommendations().map((row) => [row.mode, row.kellyDivisor]))

  const modeMatrix = [...modeMatrixMap.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      mode: row.mode,
      samples: row.samples,
      roi: calcRoi(row.profit, row.inputs),
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      avgOdds: row.samples > 0 ? row.oddsSum / row.samples : 0,
      avgConf: row.confCount > 0 ? row.confSum / row.confCount : 0,
      avgAjr: row.ajrCount > 0 ? row.ajrSum / row.ajrCount : 0,
      avgActualMinusConf: row.diffCount > 0 ? row.diffSum / row.diffCount : 0,
      kelly: modeKellyMap.get(row.mode) || toNumber(config.kellyDivisor, 4),
    }))
    .sort((a, b) => b.samples - a.samples)

  const confMatrix = FINE_CONF_BUCKET_ORDER.map((bucket) => confMatrixMap.get(bucket))
    .filter((row) => row && row.samples > 0)
    .map((row) => {
      const expected = row.expectedCount > 0 ? row.expectedSum / row.expectedCount : 0
      const actual = row.actualCount > 0 ? row.actualSum / row.actualCount : 0
      return {
        bucket: row.bucket,
        samples: row.samples,
        hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
        roi: calcRoi(row.profit, row.inputs),
        expected,
        actual,
        diff: actual - expected,
      }
    })

  const oddsMatrix = ODDS_BUCKET_ORDER.map((bucket) => oddsMatrixMap.get(bucket))
    .filter((row) => row && row.samples > 0)
    .map((row) => ({
      bucket: row.bucket,
      samples: row.samples,
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      roi: calcRoi(row.profit, row.inputs),
      avgConf: row.confCount > 0 ? row.confSum / row.confCount : 0,
      avgAjr: row.ajrCount > 0 ? row.ajrSum / row.ajrCount : 0,
      diff: row.confCount > 0 && row.ajrCount > 0 ? row.ajrSum / row.ajrCount - row.confSum / row.confCount : 0,
    }))

  const entriesMatrix = [...entryMatrixMap.values()]
    .filter((row) => row.samples > 0)
    .map((row) => ({
      marketType: row.marketType,
      marketLabel: row.marketLabel,
      samples: row.samples,
      hitRate: row.samples > 0 ? (row.wins / row.samples) * 100 : 0,
      roi: calcRoi(row.profit, row.inputs),
      avgConf: row.confCount > 0 ? row.confSum / row.confCount : 0,
      avgAjr: row.ajrCount > 0 ? row.ajrSum / row.ajrCount : 0,
      avgOdds: row.oddsCount > 0 ? row.oddsSum / row.oddsCount : 0,
      diff: row.confCount > 0 && row.ajrCount > 0 ? row.ajrSum / row.ajrCount - row.confSum / row.confCount : 0,
    }))
    .sort((a, b) => b.samples - a.samples || b.roi - a.roi)

  const correlations = {
    conf_vs_ajr: calcPearson(corrPairs.confAjr.x, corrPairs.confAjr.y),
    odds_vs_return: calcPearson(corrPairs.oddsReturn.x, corrPairs.oddsReturn.y),
    rep_vs_return: calcPearson(corrPairs.repReturn.x, corrPairs.repReturn.y),
    fid_vs_return: calcPearson(corrPairs.fidReturn.x, corrPairs.fidReturn.y),
    fse_vs_return: calcPearson(corrPairs.fseReturn.x, corrPairs.fseReturn.y),
  }

  return {
    headline: {
      totalInvestments: settled.length,
      totalInputs,
      totalProfit,
      roi,
      maxWin,
      maxLoss,
      maxWinStreak: streaks.maxWin,
      maxLoseStreak: streaks.maxLose,
      avgConf:
        splitMatches.length > 0
          ? splitMatches.reduce((sum, match) => sum + toNumber(match.conf), 0) / splitMatches.length
          : 0,
      avgOdds:
        splitMatches.length > 0
          ? splitMatches.reduce((sum, match) => sum + toNumber(match.odds), 0) / splitMatches.length
          : 0,
      sharpe,
      hitRate,
      avgExpectedEdge,
    },
    trends: {
      roi7,
      roi14,
      roi30,
    },
    risk: {
      maxDrawdown,
      volatility,
      sortino,
    },
    efficiency: {
      avgProfitPerInvest: settled.length > 0 ? totalProfit / settled.length : 0,
      profitFactor,
      utilization,
    },
    matrix: {
      mode: modeMatrix,
      conf: confMatrix,
      odds: oddsMatrix,
      entries: entriesMatrix,
    },
    correlations,
    matchRows,
  }
}

// ============================================================================
// 自适应权重优化 (Adaptive Weight Optimization)
// 基于在线梯度下降，根据历史表现自动微调权重参数
// ============================================================================

const WEIGHT_KEYS = ['weightConf', 'weightMode', 'weightTys', 'weightFid', 'weightOdds', 'weightFse']

const DEFAULT_WEIGHT_BOUNDS = {
  weightConf: [0.25, 0.65],
  weightMode: [0.08, 0.28],
  weightTys: [0.05, 0.22],
  weightFid: [0.06, 0.24],
  weightOdds: [0.02, 0.12],
  weightFse: [0.03, 0.15],
}

const DEFAULT_WEIGHT_PRIORS = {
  weightConf: 0.45,
  weightMode: 0.16,
  weightTys: 0.12,
  weightFid: 0.14,
  weightOdds: 0.06,
  weightFse: 0.07,
}

/**
 * 计算单个投资的综合得分贡献
 * 用于评估各权重参数的贡献度
 */
const computeInvestmentScore = (investment, weights) => {
  const matches = Array.isArray(investment.matches) ? investment.matches : []
  if (matches.length === 0) return { score: 0, profit: 0, components: {} }

  const profit = toNumber(investment.profit, 0)
  const inputs = Math.max(1, toNumber(investment.inputs, 1))
  const roi = profit / inputs

  // 提取各维度特征
  const avgConf = matches.reduce((sum, m) => sum + toNumber(m.conf, 0.5), 0) / matches.length
  const avgOdds = matches.reduce((sum, m) => sum + toNumber(m.odds, 2), 0) / matches.length
  const avgFseHome = matches.reduce((sum, m) => sum + toNumber(m.fse_home, 0.5), 0) / matches.length
  const avgFseAway = matches.reduce((sum, m) => sum + toNumber(m.fse_away, 0.5), 0) / matches.length
  const avgFse = Math.sqrt(avgFseHome * avgFseAway)

  // TYS 和 FID 特征
  const tysFeature = (() => {
    const tysMap = { S: 1.0, M: 0.7, L: 0.4, H: 0.2 }
    const tysValues = matches.map((m) => tysMap[m.tys_base_home] || 0.5)
    return tysValues.reduce((sum, v) => sum + v, 0) / tysValues.length
  })()

  const fidFeature = (() => {
    const fidValues = matches.map((m) => toNumber(m.fid_base_home, 0.5))
    return fidValues.reduce((sum, v) => sum + v, 0) / fidValues.length
  })()

  // Mode 特征
  const modeFeature = (() => {
    const mode = normalizeMode(investment.mode || '常规')
    const modeScores = {
      '常规': 0.5,
      '常规-稳': 0.7,
      '常规-杠杆': 0.3,
      '半彩票半保险': 0.4,
      '保险产品': 0.8,
      '赌一把': 0.1,
    }
    return modeScores[mode] || 0.5
  })()

  const components = {
    conf: avgConf,
    mode: modeFeature,
    tys: tysFeature,
    fid: fidFeature,
    odds: clamp(1 - (avgOdds - 1.5) / 3, 0, 1), // 低赔率得分高
    fse: avgFse,
  }

  return { score: roi, profit, inputs, components }
}

/**
 * 估计权重参数的梯度
 * 使用数值微分近似
 */
const estimateWeightGradients = (investments, currentWeights, epsilon = 0.01) => {
  const gradients = {}
  const baseScore = computePortfolioScore(investments, currentWeights)

  WEIGHT_KEYS.forEach((key) => {
    // 正向扰动
    const weightsPlus = { ...currentWeights, [key]: currentWeights[key] + epsilon }
    const scorePlus = computePortfolioScore(investments, weightsPlus)

    // 负向扰动
    const weightsMinus = { ...currentWeights, [key]: currentWeights[key] - epsilon }
    const scoreMinus = computePortfolioScore(investments, weightsMinus)

    // 中心差分梯度
    gradients[key] = (scorePlus - scoreMinus) / (2 * epsilon)
  })

  return { gradients, baseScore }
}

/**
 * 计算投资组合的综合得分
 * 考虑ROI、风险调整、权重偏好
 */
const computePortfolioScore = (investments, weights) => {
  if (investments.length === 0) return 0

  let totalWeightedProfit = 0
  let totalInputs = 0
  let losses = []

  investments.forEach((inv) => {
    const { profit, inputs, components } = computeInvestmentScore(inv, weights)

    // 加权因子 = 各维度特征 × 对应权重的加权和
    const weightFactor =
      (components.conf || 0.5) * (weights.weightConf || 0.45) +
      (components.mode || 0.5) * (weights.weightMode || 0.16) +
      (components.tys || 0.5) * (weights.weightTys || 0.12) +
      (components.fid || 0.5) * (weights.weightFid || 0.14) +
      (components.odds || 0.5) * (weights.weightOdds || 0.06) +
      (components.fse || 0.5) * (weights.weightFse || 0.07)

    totalWeightedProfit += profit * weightFactor
    totalInputs += inputs

    if (profit < 0) losses.push(profit)
  })

  const roi = totalInputs > 0 ? totalWeightedProfit / totalInputs : 0

  // 风险惩罚项
  const avgLoss = losses.length > 0 ? losses.reduce((s, l) => s + l, 0) / losses.length : 0
  const riskPenalty = Math.abs(avgLoss) * 0.1

  return roi - riskPenalty
}

/**
 * 计算建议的权重调整
 * 返回每个权重的建议值和置信度
 */
export const computeAdaptiveWeightSuggestions = () => {
  const config = getSystemConfig()
  const adaptiveConfig = config.adaptiveWeights || {}
  const bounds = adaptiveConfig.bounds || DEFAULT_WEIGHT_BOUNDS
  const priors = adaptiveConfig.priors || DEFAULT_WEIGHT_PRIORS
  const learningRate = toNumber(adaptiveConfig.learningRate, 0.05)
  const maxSingleChange = toNumber(adaptiveConfig.maxSingleChange, 0.02)
  const priorStrength = toNumber(adaptiveConfig.priorStrength, 0.1)
  const minSamples = toNumber(adaptiveConfig.minSamples, 50)

  const investments = getSettledInvestments(getActiveInvestments())
  const sampleCount = investments.length

  // 样本量不足
  if (sampleCount < minSamples) {
    return {
      suggestions: WEIGHT_KEYS.map((key) => ({
        key,
        label: key.replace('weight', ''),
        current: toNumber(config[key], priors[key]),
        suggested: toNumber(config[key], priors[key]),
        prior: priors[key],
        bounds: bounds[key] || DEFAULT_WEIGHT_BOUNDS[key],
        gradient: 0,
        confidence: 0,
        change: 0,
        reason: '样本量不足',
      })),
      sampleCount,
      minSamples,
      ready: false,
      lastUpdateAt: adaptiveConfig.lastUpdateAt || null,
      updateCount: adaptiveConfig.updateCount || 0,
    }
  }

  // 提取当前权重
  const currentWeights = {}
  WEIGHT_KEYS.forEach((key) => {
    currentWeights[key] = toNumber(config[key], priors[key])
  })

  // 计算梯度
  const { gradients, baseScore } = estimateWeightGradients(investments, currentWeights)

  // 计算建议
  const suggestions = WEIGHT_KEYS.forEach((key) => {
    const gradient = gradients[key] || 0
    const current = currentWeights[key]
    const prior = priors[key]
    const [minBound, maxBound] = bounds[key] || DEFAULT_WEIGHT_BOUNDS[key]

    // 梯度下降更新 + 向先验回归
    let rawChange = learningRate * gradient - priorStrength * (current - prior)

    // 限制单次变化幅度
    rawChange = clamp(rawChange, -maxSingleChange, maxSingleChange)

    // 计算建议值并约束在边界内
    const suggested = clamp(current + rawChange, minBound, maxBound)
    const actualChange = suggested - current

    // 置信度计算：基于梯度一致性和样本量
    const gradientMagnitude = Math.abs(gradient)
    const sampleFactor = Math.min(1, sampleCount / 100)
    const confidence = clamp(gradientMagnitude * 10 * sampleFactor, 0, 1)

    return {
      key,
      label: key.replace('weight', ''),
      current: Number(current.toFixed(4)),
      suggested: Number(suggested.toFixed(4)),
      prior,
      bounds: [minBound, maxBound],
      gradient: Number(gradient.toFixed(6)),
      confidence: Number(confidence.toFixed(2)),
      change: Number(actualChange.toFixed(4)),
      reason: actualChange > 0 ? '建议上调' : actualChange < 0 ? '建议下调' : '维持不变',
    }
  })

  const suggestionsList = WEIGHT_KEYS.map((key) => {
    const gradient = gradients[key] || 0
    const current = currentWeights[key]
    const prior = priors[key]
    const [minBound, maxBound] = bounds[key] || DEFAULT_WEIGHT_BOUNDS[key]

    // 梯度下降更新 + 向先验回归
    let rawChange = learningRate * gradient - priorStrength * (current - prior)

    // 限制单次变化幅度
    rawChange = clamp(rawChange, -maxSingleChange, maxSingleChange)

    // 计算建议值并约束在边界内
    const suggested = clamp(current + rawChange, minBound, maxBound)
    const actualChange = suggested - current

    // 置信度计算：基于梯度一致性和样本量
    const gradientMagnitude = Math.abs(gradient)
    const sampleFactor = Math.min(1, sampleCount / 100)
    const confidence = clamp(gradientMagnitude * 10 * sampleFactor, 0, 1)

    return {
      key,
      label: key.replace('weight', ''),
      current: Number(current.toFixed(4)),
      suggested: Number(suggested.toFixed(4)),
      prior,
      bounds: [minBound, maxBound],
      gradient: Number(gradient.toFixed(6)),
      confidence: Number(confidence.toFixed(2)),
      change: Number(actualChange.toFixed(4)),
      reason: actualChange > 0 ? '建议上调' : actualChange < 0 ? '建议下调' : '维持不变',
    }
  })

  return {
    suggestions: suggestionsList,
    sampleCount,
    minSamples,
    ready: true,
    baseScore: Number(baseScore.toFixed(4)),
    lastUpdateAt: adaptiveConfig.lastUpdateAt || null,
    updateCount: adaptiveConfig.updateCount || 0,
  }
}
