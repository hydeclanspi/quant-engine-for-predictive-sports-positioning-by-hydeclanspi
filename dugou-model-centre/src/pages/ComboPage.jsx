import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronsLeft, ChevronsRight, Plus, RefreshCw, ShieldCheck, ShieldOff, SlidersHorizontal, Sparkles, XCircle } from 'lucide-react'
import { bumpTeamSamples, getInvestments, getSystemConfig, saveInvestment } from '../lib/localData'
import { getPredictionCalibrationContext, buildComboRetrospective } from '../lib/analytics'
import {
  buildAtomicMatchProfile,
  combineAtomicMatchProfiles,
  estimateEntryAnchorOdds,
} from '../lib/atomicParlay'

const MODE_FACTOR_MAP = {
  常规: 1.0,
  '常规-稳': 1.05,
  '常规-杠杆': 0.95,
  '常规-激进': 0.95,
  半彩票半保险: 0.92,
  保险产品: 1.08,
  赌一把: 0.88,
}

const FID_FACTOR_MAP = {
  0: 0.92,
  0.25: 0.99,
  0.4: 1.02,
  0.5: 1.05,
  0.6: 1.07,
  0.75: 1.1,
}

const TYS_FACTOR_MAP = {
  S: 0.94,
  M: 1.0,
  L: 1.04,
  H: 1.08,
}

const LAYER_META = {
  主推: { tone: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', desc: '稳健优先，Sharpe 最高' },
  次推: { tone: 'text-sky-700', badge: 'bg-sky-100 text-sky-700', desc: '风险收益平衡' },
  博冷: { tone: 'text-violet-700', badge: 'bg-violet-100 text-violet-700', desc: '尾部机会，高波动' },
}

const MATCH_ROLE_OPTIONS = [
  { value: 'stable', label: '稳', tone: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { value: 'lever', label: '杠杆', tone: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'neutral_plus', label: '中性+自信', tone: 'bg-sky-100 text-sky-700 border-sky-200' },
  { value: 'neutral_soft', label: '中性-保守', tone: 'bg-stone-200 text-stone-600 border-stone-300' },
]

const MATCH_ROLE_COMPACT_LABEL = {
  stable: '稳',
  lever: '杠杆',
  neutral_plus: '中+信',
  neutral_soft: '中-守',
}

const RECOMMENDATION_OUTPUT_COUNT = 20
const QUICK_PREVIEW_RECOMMENDATION_COUNT = 7
const HARD_DECOUPLING_HINT_THRESHOLD = 5

const MATCH_ROLE_TILT_MAP = {
  stable: 0.18,
  lever: 0.24,
  neutral_plus: 0.12,
  neutral_soft: 0.06,
}

const MATCH_ROLE_PRESETS = {
  balanced: {
    label: '平衡',
    targets: { stable: 0.32, lever: 0.24, neutral_plus: 0.24, neutral_soft: 0.2 },
  },
  stableCore: {
    label: '稳健底盘',
    targets: { stable: 0.42, lever: 0.18, neutral_plus: 0.25, neutral_soft: 0.15 },
  },
  leverDrive: {
    label: '杠杆推进',
    targets: { stable: 0.24, lever: 0.38, neutral_plus: 0.24, neutral_soft: 0.14 },
  },
}

const DEFAULT_ROLE_PREFERENCE = {
  preset: 'balanced',
  mixStrength: 0.08,
  targets: MATCH_ROLE_PRESETS.balanced.targets,
}

const normalizeRoleTag = (value) => {
  const normalized = String(value || '').trim()
  if (normalized === 'stable') return 'stable'
  if (normalized === 'lever') return 'lever'
  if (normalized === 'neutral_plus') return 'neutral_plus'
  if (normalized === 'neutral_soft') return 'neutral_soft'
  return 'neutral_plus'
}

const normalizeRoleTargets = (value) => {
  const source = value && typeof value === 'object' ? value : MATCH_ROLE_PRESETS.balanced.targets
  const stable = Math.max(0, Number(source.stable) || 0)
  const lever = Math.max(0, Number(source.lever) || 0)
  const neutralPlus = Math.max(0, Number(source.neutral_plus) || 0)
  const neutralSoft = Math.max(0, Number(source.neutral_soft) || 0)
  const total = stable + lever + neutralPlus + neutralSoft
  if (total <= 0) return { ...MATCH_ROLE_PRESETS.balanced.targets }
  return {
    stable: stable / total,
    lever: lever / total,
    neutral_plus: neutralPlus / total,
    neutral_soft: neutralSoft / total,
  }
}

const sanitizeRolePreference = (value) => {
  const preset = value?.preset && MATCH_ROLE_PRESETS[value.preset] ? value.preset : DEFAULT_ROLE_PREFERENCE.preset
  const presetTargets = MATCH_ROLE_PRESETS[preset].targets
  const targets = normalizeRoleTargets(value?.targets || presetTargets)
  return {
    preset,
    mixStrength: clamp(Number(value?.mixStrength ?? DEFAULT_ROLE_PREFERENCE.mixStrength), 0, 0.2),
    targets,
  }
}

const inferMatchRoleByMetrics = (adjustedProb, odds, rawConf) => {
  const p = clamp(Number(adjustedProb) || 0, 0.02, 0.98)
  const odd = Math.max(1.01, Number(odds) || 1.01)
  const conf = clamp(Number(rawConf) || 0.5, 0.02, 0.98)
  const implied = clamp(1 / odd, 0.02, 0.98)
  const edge = p - implied

  if (p >= 0.58 && odd <= 2.25 && edge >= -0.015) return 'stable'
  if (odd >= 2.55 && p >= 0.27 && (edge >= 0.018 || conf >= 0.55)) return 'lever'
  if (edge >= 0.02 || p >= 0.5) return 'neutral_plus'
  return 'neutral_soft'
}

const calcRoleStructureSignal = (subset, roleTargets, mixStrength = 0.08, hyperparams = null) => {
  const rows = Array.isArray(subset) ? subset : []
  if (rows.length === 0) {
    return {
      bonus: 0,
      shares: { stable: 0, lever: 0, neutral_plus: 0, neutral_soft: 0 },
      signature: '--',
      alignmentGap: 0,
      diversity: 0,
    }
  }

  const counts = {
    stable: 0,
    lever: 0,
    neutral_plus: 0,
    neutral_soft: 0,
  }
  rows.forEach((item) => {
    const role = normalizeRoleTag(item.roleTag)
    counts[role] += 1
  })

  const shares = {
    stable: counts.stable / rows.length,
    lever: counts.lever / rows.length,
    neutral_plus: counts.neutral_plus / rows.length,
    neutral_soft: counts.neutral_soft / rows.length,
  }
  const tilt =
    shares.stable * MATCH_ROLE_TILT_MAP.stable +
    shares.lever * MATCH_ROLE_TILT_MAP.lever +
    shares.neutral_plus * MATCH_ROLE_TILT_MAP.neutral_plus +
    shares.neutral_soft * MATCH_ROLE_TILT_MAP.neutral_soft
  const concentration =
    shares.stable ** 2 +
    shares.lever ** 2 +
    shares.neutral_plus ** 2 +
    shares.neutral_soft ** 2
  const diversity = 1 - concentration
  const stableLeverSynergy = Math.sqrt(Math.max(0, shares.stable * shares.lever))
  const alignmentGap =
    Math.abs(shares.stable - roleTargets.stable) +
    Math.abs(shares.lever - roleTargets.lever) +
    Math.abs(shares.neutral_plus - roleTargets.neutral_plus) +
    Math.abs(shares.neutral_soft - roleTargets.neutral_soft)
  const rc = hyperparams?.roleCoefficients || { tilt: 0.62, diversity: 0.44, synergy: 0.48, gap: -0.78 }
  const rawScore = tilt * rc.tilt + diversity * rc.diversity + stableLeverSynergy * rc.synergy + alignmentGap * rc.gap
  const bonus = clamp(rawScore * mixStrength, -0.08, 0.08)

  return {
    bonus,
    shares,
    signature: `稳${counts.stable}/杠${counts.lever}/中+${counts.neutral_plus}/中-${counts.neutral_soft}`,
    alignmentGap,
    diversity,
  }
}
/* ── Parlay bonus: concave reward for multi-leg combos (思路2) ─────────── */
const parlayBonusFn = (legs, parlayBeta = 0.12) => {
  // 0 for singles, peaks around 3-4 legs, mild diminishing returns beyond 4
  if (legs <= 1) return 0
  // sqrt(legs-1) gives: 2-leg=1, 3-leg=1.41, 4-leg=1.73, 5-leg=2
  return parlayBeta * (Math.sqrt(legs - 1) - 0.15)
}

/* ── 方案D: 4-tier confidence classification ──────────────────────────── */
const DEFAULT_CONF_TIER_THRESHOLDS = { tier1: 0.72, tier2: 0.55, tier3: 0.40 }

const classifyConfidenceTier = (conf, thresholds = DEFAULT_CONF_TIER_THRESHOLDS) => {
  const c = clamp(Number(conf) || 0, 0, 1)
  if (c >= thresholds.tier1) return 'tier_1' // 强洞察 — anchor
  if (c >= thresholds.tier2) return 'tier_2' // 中洞察 — primary body
  if (c >= thresholds.tier3) return 'tier_3' // 弱洞察 — limited exposure
  return 'tier_4' // 极弱 — moonshot only
}

const CONF_TIER_LABELS = { tier_1: '强洞察', tier_2: '中洞察', tier_3: '弱洞察', tier_4: '极弱' }
const CONF_TIER_TONES = {
  tier_1: 'bg-emerald-100 text-emerald-700',
  tier_2: 'bg-sky-100 text-sky-600',
  tier_3: 'bg-amber-100 text-amber-600',
  tier_4: 'bg-stone-100 text-stone-500',
}

/* ── 方案B: Marginal Sharpe decay gate (universal) ───────────────────── */
const calcMarginalSharpeForLeg = (currentSubset, candidateLeg, systemConfig, calibrationContext, threshold = 0.15) => {
  if (currentSubset.length === 0) return { marginalSharpe: Infinity, shouldAdd: true }

  const buildProfileForSubset = (subset) => {
    const profiles = subset.map((item) => {
      if (item.atomicProfile) return item.atomicProfile
      const fallbackOdds = Math.max(1.01, Number(item.odds) || 2.5)
      const unionProb = calcAdjustedProbability(item, systemConfig, calibrationContext)
      return buildAtomicLegProfile(item, unionProb, fallbackOdds)
    })
    return combineAtomicMatchProfiles(profiles)
  }

  const beforeCombo = buildProfileForSubset(currentSubset)
  const afterCombo = buildProfileForSubset([...currentSubset, candidateLeg])
  const evBefore = Number(beforeCombo.expectedReturn || 0)
  const evAfter = Number(afterCombo.expectedReturn || 0)
  const sigmaBefore = Math.sqrt(Math.max(beforeCombo.variance || 0, 0.0001))
  const sigmaAfter = Math.sqrt(Math.max(afterCombo.variance || 0, 0.0001))
  const deltaEv = evAfter - evBefore
  const deltaSigma = sigmaAfter - sigmaBefore
  if (deltaSigma <= 0.001) return { marginalSharpe: deltaEv > 0 ? 10 : -10, shouldAdd: deltaEv > 0 }
  const marginalSharpe = deltaEv / deltaSigma
  return { marginalSharpe, shouldAdd: marginalSharpe > threshold }
}

/* ── Dynamic parameter optimizer: backtest to auto-tune all coefficients ── */
const backtestDynamicParams = (calibrationContext) => {
  const scatterData = Array.isArray(calibrationContext?.scatterData) ? calibrationContext.scatterData : []
  const defaults = {
    tierPenaltyPerWeakLeg: 0.12, tierAnchorBonus: 0.03, coveringBonus: 0.04,
    marginalSharpeThreshold: 0.15, maxWeakLegsPerCombo: 2,
    confTierThresholds: { ...DEFAULT_CONF_TIER_THRESHOLDS },
  }
  if (scatterData.length < 20) return { ...defaults, backtestSamples: scatterData.length, backtestReliability: 0 }

  // Analyze residuals (actual - conf) to find over/under-confidence patterns
  const residuals = scatterData.map((p) => ({ residual: p.y - p.x, conf: p.x, actual: p.y }))

  // Find over-confidence flip point (cumulative residual turns negative)
  const sortedByConf = [...residuals].sort((a, b) => b.conf - a.conf)
  let cumulResidual = 0
  let flipConf = 0.72
  for (let i = 0; i < sortedByConf.length; i++) {
    cumulResidual += sortedByConf[i].residual
    if (cumulResidual < 0 && i >= 5) { flipConf = sortedByConf[i].conf; break }
  }

  // Hit rates by conf bucket
  const buckets = [
    { min: 0.7, max: 1.0, hits: 0, total: 0 },
    { min: 0.55, max: 0.7, hits: 0, total: 0 },
    { min: 0.4, max: 0.55, hits: 0, total: 0 },
    { min: 0, max: 0.4, hits: 0, total: 0 },
  ]
  scatterData.forEach((p) => {
    const b = buckets.find((b) => p.x >= b.min && p.x < b.max) || buckets[3]
    b.total += 1
    if (p.y >= 0.5) b.hits += 1
  })
  const hitRates = buckets.map((b) => b.total > 3 ? b.hits / b.total : null)

  // Dynamic tier thresholds from hit rate breakpoints
  const t1 = clamp(flipConf, 0.62, 0.82)
  const strongHR = hitRates[0] !== null ? hitRates[0] : 0.65
  const midHR = hitRates[1] !== null ? hitRates[1] : 0.5
  const weakHR = hitRates[2] !== null ? hitRates[2] : 0.4
  const veryWeakHR = hitRates[3] !== null ? hitRates[3] : 0.3
  const gap = clamp(strongHR - weakHR, 0.05, 0.5)

  // FIX: tier2/tier3 are now TRULY dynamic based on hit rate crossover analysis
  // tier2 boundary: where mid-bucket hit rate drops below strong-bucket
  // Interpolate: if midHR is close to strongHR, tier2 can be lower (more inclusive)
  // If midHR is far below strongHR, tier2 should be higher (more selective)
  const midToStrongRatio = strongHR > 0.01 ? midHR / strongHR : 0.75
  const t2Raw = t1 - (t1 - 0.40) * clamp(midToStrongRatio, 0.4, 1.0)
  const t2 = clamp(t2Raw, 0.45, 0.65)

  // tier3 boundary: where weak-bucket performance drops below acceptable
  // If weakHR is decent (>0.4), we can afford a lower tier3 boundary
  // If weakHR is terrible (<0.25), tier3 should be raised
  const weakToMidRatio = midHR > 0.01 ? weakHR / midHR : 0.6
  const t3Raw = t2 - (t2 - 0.25) * clamp(weakToMidRatio, 0.3, 1.0)
  const t3 = clamp(t3Raw, 0.30, 0.50)

  // Dynamic coefficients scaled by historical performance
  const tierPenaltyPerWeakLeg = clamp(gap * 0.5, 0.06, 0.25)
  const tierAnchorBonus = clamp((strongHR - 0.5) * 0.12, 0.01, 0.08)

  // Covering bonus: proportional to variance of strong-conf predictions
  const highConfResiduals = residuals.filter((r) => r.conf >= t1)
  const highConfVar = highConfResiduals.length >= 5
    ? highConfResiduals.reduce((s, r) => s + r.residual * r.residual, 0) / highConfResiduals.length : 0.04
  const coveringBonus = clamp(Math.sqrt(highConfVar) * 0.2, 0.02, 0.10)

  // Sharpe gate: tighter when weak legs historically miss more
  const marginalSharpeThreshold = clamp(0.1 + (1 - weakHR) * 0.15, 0.08, 0.35)
  const maxWeakLegsPerCombo = weakHR >= 0.35 ? 2 : 1

  const reliability = clamp((scatterData.length - 20) / 60, 0, 1)

  return {
    tierPenaltyPerWeakLeg: Number(tierPenaltyPerWeakLeg.toFixed(4)),
    tierAnchorBonus: Number(tierAnchorBonus.toFixed(4)),
    coveringBonus: Number(coveringBonus.toFixed(4)),
    marginalSharpeThreshold: Number(marginalSharpeThreshold.toFixed(4)),
    maxWeakLegsPerCombo,
    confTierThresholds: {
      tier1: Number(t1.toFixed(3)),
      tier2: Number(t2.toFixed(3)),
      tier3: Number(t3.toFixed(3)),
    },
    backtestSamples: scatterData.length,
    backtestReliability: Number(reliability.toFixed(3)),
    bucketHitRates: hitRates.map((r) => r !== null ? Number(r.toFixed(3)) : null),
    hitRateGap: Number(gap.toFixed(3)),
  }
}

/* ── Monte Carlo portfolio simulation ──────────────────────────────── */
// FIX: Shared match sampling — same physical match produces same outcome
// across all combos in a single MC iteration. Previously each leg was
// independently sampled even when two combos shared the same match,
// which underestimated correlation risk (VaR too optimistic).
const runPortfolioMonteCarlo = (packageItems, iterations = 50000) => {
  if (!packageItems || packageItems.length === 0) return null

  // ── Step 1: Build unique match index (shared sampling) ──
  // Each unique match (by key) gets ONE probability and ONE random draw per iteration.
  const matchKeyToIdx = new Map()
  const matchProbs = [] // indexed by unique match index
  packageItems.forEach((item) => {
    (item.subset || []).forEach((m) => {
      const mk = m.key || `${m.homeTeam}-${m.awayTeam}-${m.entry}`
      if (!matchKeyToIdx.has(mk)) {
        const prob = Math.max(0.01, Math.min(0.99, Number(m.calibratedP ?? m.conf ?? 0.5)))
        matchKeyToIdx.set(mk, matchProbs.length)
        matchProbs.push(prob)
      }
    })
  })

  // ── Step 2: Build per-combo structure referencing shared match indices ──
  const combos = packageItems.map((item) => {
    const legMatchIndices = (item.subset || []).map((m) => {
      const mk = m.key || `${m.homeTeam}-${m.awayTeam}-${m.entry}`
      return matchKeyToIdx.get(mk) ?? -1
    }).filter((idx) => idx >= 0)
    const odds = Math.max(1.01, Number(item.combinedOdds || item.odds || 2.0))
    const stake = getEffectiveStakeForScoring(item)
    return { legMatchIndices, odds, stake }
  })

  const uniqueMatchCount = matchProbs.length

  // Seeded PRNG (xorshift32) for reproducibility — improved seed mixing
  let seed = 2654435761
  seed ^= (combos.length * 2654435761) >>> 0
  for (let i = 0; i < uniqueMatchCount; i++) {
    seed ^= Math.round(matchProbs[i] * 1e6 + i * 7919)
    seed = (seed ^ (seed << 13)) >>> 0
  }
  combos.forEach((c) => { seed ^= Math.round(c.stake * 31 + c.odds * 997) })
  const rand = () => { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }

  const pnls = new Float64Array(iterations)
  let profitCount = 0
  let allLoseCount = 0
  // Pre-allocate shared match outcome array (reused each iteration)
  const matchOutcomes = new Uint8Array(uniqueMatchCount)

  for (let i = 0; i < iterations; i++) {
    // ── Draw shared match outcomes: one roll per unique match ──
    for (let m = 0; m < uniqueMatchCount; m++) {
      matchOutcomes[m] = rand() < matchProbs[m] ? 1 : 0
    }

    let totalPnl = 0
    let anyWin = false
    for (let c = 0; c < combos.length; c++) {
      const combo = combos[c]
      let allHit = true
      for (let l = 0; l < combo.legMatchIndices.length; l++) {
        if (!matchOutcomes[combo.legMatchIndices[l]]) { allHit = false; break }
      }
      if (allHit) {
        totalPnl += combo.stake * (combo.odds - 1)
        anyWin = true
      } else {
        totalPnl -= combo.stake
      }
    }
    pnls[i] = totalPnl
    if (totalPnl > 0) profitCount++
    if (!anyWin) allLoseCount++
  }

  // Sort for percentile calculations
  const sorted = Float64Array.from(pnls).sort()
  const median = sorted[Math.floor(iterations * 0.5)]
  const var95 = sorted[Math.floor(iterations * 0.05)]
  const mean = pnls.reduce((s, v) => s + v, 0) / iterations
  const maxPnl = sorted[iterations - 1]
  const minPnl = sorted[0]

  // Histogram buckets (5 buckets) — FIX: guard against zero range (all same PnL)
  const range = maxPnl - minPnl
  const bucketWidth = range > 1e-9 ? range / 5 : 1
  const histogram = Array.from({ length: 5 }, (_, i) => ({
    min: minPnl + i * bucketWidth,
    max: minPnl + (i + 1) * bucketWidth,
    count: 0,
  }))
  for (let i = 0; i < iterations; i++) {
    const idx = range > 1e-9 ? Math.min(4, Math.floor((pnls[i] - minPnl) / bucketWidth)) : 0
    histogram[idx].count++
  }
  const maxBucketCount = Math.max(1, ...histogram.map((b) => b.count))

  return {
    iterations,
    profitProb: profitCount / iterations,
    allLoseProb: allLoseCount / iterations,
    median: Math.round(median * 100) / 100,
    var95: Math.round(var95 * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    maxPnl: Math.round(maxPnl * 100) / 100,
    minPnl: Math.round(minPnl * 100) / 100,
    histogram: histogram.map((b) => ({ ...b, pct: b.count / maxBucketCount })),
  }
}

/* ── Portfolio Allocation Optimizer ─────────────────────────────────── */
// Recommends which combos to buy together (portfolio packs) to maximize
// expected return while covering all counter-consensus insights.
// Uses greedy set-cover + MC-based utility scoring.
const getPortfolioCoverageKey = (item) => {
  const direct = String(item?.key || '').trim()
  if (direct) return direct
  const home = String(item?.homeTeam || '').trim()
  const away = String(item?.awayTeam || '').trim()
  if (!home && !away) return ''
  return `${home}-${away}`
}

const getTheoreticalWeightPctForScoring = (item) => {
  const allocatedWeight = Number(item?.allocatedWeight)
  if (Number.isFinite(allocatedWeight) && allocatedWeight >= 0) return Math.max(0, allocatedWeight * 100)
  const directPct = Number(item?.theoreticalWeightPct)
  if (Number.isFinite(directPct) && directPct >= 0) return Math.max(0, directPct)
  const explainPct = Number(item?.explain?.weightPct)
  if (Number.isFinite(explainPct) && explainPct >= 0) return Math.max(0, explainPct)
  if (typeof item?.allocation === 'string') {
    const match = item.allocation.match(/([0-9]+(?:\.[0-9]+)?)\s*%/)
    if (match?.[1]) return Math.max(0, Number(match[1]) || 0)
  }
  return 0
}

const getEffectiveStakeForScoring = (item) => {
  const amount = Number(item?.amount)
  if (Number.isFinite(amount) && amount > 0) return amount
  const theoreticalWeightPct = getTheoreticalWeightPctForScoring(item)
  if (theoreticalWeightPct > 0) return Math.max(1, theoreticalWeightPct)
  return 10
}

const getPortfolioKeyFromCombos = (combos) => {
  const signatures = (combos || [])
    .map((combo) => buildSubsetSignature(combo?.subset || []))
    .filter(Boolean)
    .sort()
  if (signatures.length === 0) return ''
  return signatures.join('||')
}

const getPortfolioKeyFromAllocationRow = (row, fallback = '') => {
  const direct = String(row?.portfolioKey || '').trim()
  if (direct) return direct
  const fromCombos = getPortfolioKeyFromCombos(row?.combos || [])
  if (fromCombos) return fromCombos
  const fromIds = (row?.comboIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort()
    .join('||')
  if (fromIds) return fromIds
  const fromLabel = String(row?.label || '').trim()
  if (fromLabel) return `label:${fromLabel}`
  return fallback
}

const normalizePortfolioAllocations = (rows) =>
  (Array.isArray(rows) ? rows : []).map((row, idx) => {
    const fallbackKey = `portfolio-${idx + 1}`
    const portfolioKey = getPortfolioKeyFromAllocationRow(row, fallbackKey) || fallbackKey
    return {
      ...row,
      portfolioKey,
      pinned: Boolean(row?.pinned),
    }
  })

const optimizePortfolioAllocations = (
  recommendations,
  maxPackages = 3,
  hyperparams = null,
  coverageTargetKeysInput = null,
  overlapTuning = null,
  decouplingPairs = null,
) => {
  if (!recommendations || recommendations.length < 2) return []
  const directedConstraints = parseDirectedDecouplingConstraints(decouplingPairs)
  const mandatorySupportCombos = directedConstraints
    .map((constraint) => recommendations.find((combo) => comboSatisfiesDirectedConstraint(combo, constraint)))
    .filter(Boolean)
  const mergedItems = [...mandatorySupportCombos, ...recommendations]
  const items = dedupeRankedBySignature(mergedItems).slice(0, 12)

  // Extract coverage target keys.
  // Prefer selected-match keys from caller so coverage displays true x / selectedCount.
  const allMatchKeys = new Set(
    Array.from(coverageTargetKeysInput || [])
      .map((k) => String(k || '').trim())
      .filter(Boolean),
  )
  if (allMatchKeys.size === 0) {
    items.forEach((item) => {
      const subset = item.subset || []
      subset.forEach((m) => {
        const mk = getPortfolioCoverageKey(m)
        if (mk) allMatchKeys.add(mk)
      })
    })
  }

  // Generate candidate portfolios (subsets of 2-5 combos)
  const portfolios = []
  const n = Math.min(items.length, directedConstraints.length > 0 ? 12 : 8)
  for (let mask = 3; mask < (1 << n); mask++) {
    const bits = []
    let count = 0
    for (let b = 0; b < n; b++) {
      if (mask & (1 << b)) { bits.push(b); count++ }
    }
    if (count < 2 || count > 5) continue
    portfolios.push(bits)
  }

  // Score each portfolio
  const scored = portfolios.map((indices) => {
    const selected = indices.map((i) => items[i])
    const effectiveStakes = selected.map((item) => getEffectiveStakeForScoring(item))
    const totalStake = effectiveStakes.reduce((s, value) => s + value, 0)
    const totalInvest = selected.reduce((sum, item) => sum + Math.max(0, Number(item?.amount) || 0), 0)
    const totalTheoreticalWeightPct = selected.reduce(
      (sum, item) => sum + getTheoreticalWeightPctForScoring(item),
      0,
    )
    // Coverage: how many unique matches are covered
    const covered = new Set()
    selected.forEach((item) => {
      ;(item.subset || []).forEach((m) => {
        const mk = getPortfolioCoverageKey(m)
        if (mk) covered.add(mk)
      })
    })
    const coverageRatio = allMatchKeys.size > 0 ? covered.size / allMatchKeys.size : 0
    // Expected value (weighted avg)
    const weightedEv = selected.reduce(
      (s, item, idx) => s + (item.expectedReturn || 0) * effectiveStakes[idx],
      0,
    ) / Math.max(totalStake, 1)
    // Layer diversity (unique layer tags)
    const layers = new Set(selected.map((item) => item.explain?.ftLayerTag).filter(Boolean))
    const layerDiv = layers.size / 4
    // Tier diversity (unique conf tiers present)
    const tiers = new Set()
    selected.forEach((item) => (item.confTiers || []).forEach((t) => tiers.add(t)))
    const tierDiv = tiers.size / 4
    // Avoid redundancy: continuous overlap penalty (scheme5), not binary overlap count.
    let overlapPenaltySum = 0
    let totalPairs = 0
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        totalPairs++
        const overlap = calcContinuousSubsetOverlap(selected[i].subset || [], selected[j].subset || [], overlapTuning)
        overlapPenaltySum += overlap
      }
    }
    const avgOverlapPenalty = totalPairs > 0 ? overlapPenaltySum / totalPairs : 0
    const diversityScore = clamp(1 - avgOverlapPenalty, 0, 1)

    // Composite utility — weights from walk-forward calibration
    const pw = hyperparams?.portfolioWeights || { ev: 0.35, coverage: 0.30, diversity: 0.20, layerDiv: 0.10, tierDiv: 0.05 }
    const utility =
      weightedEv * pw.ev +
      coverageRatio * pw.coverage +
      layerDiv * pw.layerDiv +
      tierDiv * pw.tierDiv +
      diversityScore * pw.diversity

    const constraintSatisfiedCount =
      directedConstraints.length > 0
        ? directedConstraints.reduce(
          (count, constraint) => count + (selected.some((combo) => comboSatisfiesDirectedConstraint(combo, constraint)) ? 1 : 0),
          0,
        )
        : 0
    const constraintCoverage =
      directedConstraints.length > 0
        ? clamp(constraintSatisfiedCount / directedConstraints.length, 0, 1)
        : 1
    const constraintSatisfied =
      directedConstraints.length === 0 || constraintSatisfiedCount >= directedConstraints.length
    const scoredUtility = utility + (directedConstraints.length > 0 ? constraintCoverage * 0.08 : 0)

    // Run mini MC for this portfolio
    const mc = runPortfolioMonteCarlo(selected, 10000)

    return {
      indices,
      comboIds: selected.map((s) => s.id),
      label: indices.map((i) => i + 1).join('+'),
      combos: selected,
      portfolioKey: getPortfolioKeyFromCombos(selected),
      totalStake: Math.round(totalStake),
      totalInvest: Math.round(totalInvest),
      totalTheoreticalWeightPct: Number(totalTheoreticalWeightPct.toFixed(1)),
      coverageRatio: Number(coverageRatio.toFixed(2)),
      covered: covered.size,
      totalMatches: allMatchKeys.size,
      weightedEv: Number((weightedEv * 100).toFixed(1)),
      layerDiv: Number(layerDiv.toFixed(2)),
      tierDiv: Number(tierDiv.toFixed(2)),
      diversityScore: Number(diversityScore.toFixed(2)),
      utility: Number(scoredUtility.toFixed(4)),
      constraintTotal: directedConstraints.length,
      constraintSatisfiedCount,
      constraintCoverage: Number(constraintCoverage.toFixed(3)),
      constraintSatisfied,
      mc,
    }
  })

  const fullyConstraintSatisfied =
    directedConstraints.length > 0 ? scored.filter((row) => row.constraintSatisfied) : []
  const rankedScored =
    directedConstraints.length > 0
      ? (fullyConstraintSatisfied.length > 0 ? fullyConstraintSatisfied : scored)
      : scored

  // Sort by constraint coverage first (when customization exists), then utility
  rankedScored.sort((a, b) => {
    const covDiff = (b.constraintCoverage || 0) - (a.constraintCoverage || 0)
    if (Math.abs(covDiff) > 1e-9) return covDiff
    return b.utility - a.utility
  })

  // Deduplicate: don't return portfolios that are subsets of higher-ranked ones
  const result = []
  const usedSigs = new Set()
  for (const p of rankedScored) {
    const sig = [...p.indices].sort().join(',')
    if (usedSigs.has(sig)) continue
    // Check if this is a subset of an already-selected portfolio
    let isSubset = false
    for (const existing of result) {
      const existingSet = new Set(existing.indices)
      if (p.indices.every((i) => existingSet.has(i))) { isSubset = true; break }
    }
    if (isSubset) continue
    result.push(p)
    usedSigs.add(sig)
    if (result.length >= maxPackages) break
  }

  return normalizePortfolioAllocations(result)
}

const buildPortfolioAllocationRowFromCombos = (
  combos,
  allRecommendations = [],
  coverageTargetKeysInput = null,
  hyperparams = null,
  overlapTuning = null,
  directedConstraints = [],
) => {
  const selected = Array.isArray(combos) ? combos.filter(Boolean) : []
  if (selected.length < 2) return null

  const allMatchKeys = new Set(
    Array.from(coverageTargetKeysInput || [])
      .map((k) => String(k || '').trim())
      .filter(Boolean),
  )
  if (allMatchKeys.size === 0) {
    selected.forEach((item) => {
      ;(item.subset || []).forEach((m) => {
        const mk = getPortfolioCoverageKey(m)
        if (mk) allMatchKeys.add(mk)
      })
    })
  }

  const effectiveStakes = selected.map((item) => getEffectiveStakeForScoring(item))
  const totalStake = effectiveStakes.reduce((sum, value) => sum + value, 0)
  const totalInvest = selected.reduce((sum, item) => sum + Math.max(0, Number(item?.amount) || 0), 0)
  const totalTheoreticalWeightPct = selected.reduce((sum, item) => sum + getTheoreticalWeightPctForScoring(item), 0)

  const covered = new Set()
  selected.forEach((item) => {
    ;(item.subset || []).forEach((m) => {
      const mk = getPortfolioCoverageKey(m)
      if (mk) covered.add(mk)
    })
  })
  const coverageRatio = allMatchKeys.size > 0 ? covered.size / allMatchKeys.size : 0
  const weightedEv = selected.reduce(
    (sum, item, idx) => sum + (item.expectedReturn || 0) * effectiveStakes[idx],
    0,
  ) / Math.max(totalStake, 1)

  const layers = new Set(selected.map((item) => item.explain?.ftLayerTag).filter(Boolean))
  const layerDiv = layers.size / 4
  const tiers = new Set()
  selected.forEach((item) => (item.confTiers || []).forEach((t) => tiers.add(t)))
  const tierDiv = tiers.size / 4

  let overlapPenaltySum = 0
  let totalPairs = 0
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      totalPairs += 1
      overlapPenaltySum += calcContinuousSubsetOverlap(selected[i].subset || [], selected[j].subset || [], overlapTuning)
    }
  }
  const avgOverlapPenalty = totalPairs > 0 ? overlapPenaltySum / totalPairs : 0
  const diversityScore = clamp(1 - avgOverlapPenalty, 0, 1)

  const pw = hyperparams?.portfolioWeights || { ev: 0.35, coverage: 0.30, diversity: 0.20, layerDiv: 0.10, tierDiv: 0.05 }
  const baseUtility =
    weightedEv * pw.ev +
    coverageRatio * pw.coverage +
    layerDiv * pw.layerDiv +
    tierDiv * pw.tierDiv +
    diversityScore * pw.diversity

  const constraintSatisfiedCount =
    directedConstraints.length > 0
      ? directedConstraints.reduce(
        (count, constraint) => count + (selected.some((combo) => comboSatisfiesDirectedConstraint(combo, constraint)) ? 1 : 0),
        0,
      )
      : 0
  const constraintCoverage =
    directedConstraints.length > 0
      ? clamp(constraintSatisfiedCount / directedConstraints.length, 0, 1)
      : 1
  const utility = baseUtility + (directedConstraints.length > 0 ? constraintCoverage * 0.08 : 0)

  const indices = selected.map((combo) => allRecommendations.findIndex((row) => row?.id === combo?.id))
  const validIndices = indices.filter((idx) => idx >= 0)
  const label =
    validIndices.length === selected.length
      ? validIndices.map((idx) => idx + 1).join('+')
      : selected.map((_, idx) => idx + 1).join('+')

  return {
    indices: validIndices,
    comboIds: selected.map((s) => s.id),
    label,
    combos: selected,
    portfolioKey: getPortfolioKeyFromCombos(selected),
    totalStake: Math.round(totalStake),
    totalInvest: Math.round(totalInvest),
    totalTheoreticalWeightPct: Number(totalTheoreticalWeightPct.toFixed(1)),
    coverageRatio: Number(coverageRatio.toFixed(2)),
    covered: covered.size,
    totalMatches: allMatchKeys.size,
    weightedEv: Number((weightedEv * 100).toFixed(1)),
    layerDiv: Number(layerDiv.toFixed(2)),
    tierDiv: Number(tierDiv.toFixed(2)),
    diversityScore: Number(diversityScore.toFixed(2)),
    utility: Number(utility.toFixed(4)),
    constraintTotal: directedConstraints.length,
    constraintSatisfiedCount,
    constraintCoverage: Number(constraintCoverage.toFixed(3)),
    constraintSatisfied: directedConstraints.length === 0 || constraintSatisfiedCount >= directedConstraints.length,
    mc: runPortfolioMonteCarlo(selected, 10000),
  }
}

const solveConstrainedPortfolioFromBase = (
  baseCombos,
  candidateCombos,
  directedConstraints = [],
  options = null,
) => {
  const base = Array.isArray(baseCombos) ? baseCombos.filter(Boolean) : []
  if (base.length < 2) return null

  const resolvedOptions = options && typeof options === 'object' ? options : {}
  const preserveBaseCoverage = Boolean(resolvedOptions.preserveBaseCoverage)
  const requiredSize = Math.max(2, Number.parseInt(resolvedOptions.size || base.length, 10) || base.length)
  const lockedPairs =
    Array.isArray(resolvedOptions.lockedPairs) && resolvedOptions.lockedPairs.length > 0
      ? resolvedOptions.lockedPairs
      : []
  const rawPool = dedupeRankedBySignature([...(base || []), ...(candidateCombos || [])])
  const pool = rawPool.slice(0, 24)
  if (pool.length < requiredSize) return null

  const baseSigSet = new Set(base.map((combo) => buildSubsetSignature(combo?.subset || [])).filter(Boolean))
  const protectedMatchKeys = new Set()
  if (preserveBaseCoverage) {
    base.forEach((combo) => {
      getSubsetMatchKeys(combo?.subset || []).forEach((key) => {
        if (key) protectedMatchKeys.add(key)
      })
    })
  }

  const poolKeys = pool.map((combo) => new Set(getSubsetMatchKeys(combo?.subset || [])))
  const poolSigs = pool.map((combo) => buildSubsetSignature(combo?.subset || []))

  let best = null
  const chosenIdx = []

  const evaluate = () => {
    const selected = chosenIdx.map((idx) => pool[idx]).filter(Boolean)
    if (selected.length !== requiredSize) return

    if (preserveBaseCoverage && protectedMatchKeys.size > 0) {
      const covered = new Set()
      chosenIdx.forEach((idx) => {
        poolKeys[idx].forEach((key) => covered.add(key))
      })
      for (const key of protectedMatchKeys) {
        if (!covered.has(key)) return
      }
    }

    const constraintSatisfiedCount =
      directedConstraints.length > 0
        ? directedConstraints.reduce(
          (count, constraint) => count + (selected.some((combo) => comboSatisfiesDirectedConstraint(combo, constraint)) ? 1 : 0),
          0,
        )
        : 0
    let matrixDrift = 0
    if (lockedPairs.length > 0) {
      lockedPairs.forEach((pair) => {
        const survives = selected.some((combo) =>
          comboSatisfiesDirectedConstraint(combo, { fromKey: pair.fromKey, toKey: pair.toKey }),
        )
        if (Boolean(survives) !== Boolean(pair.survives)) matrixDrift += 1
      })
    }

    let changedCount = 0
    let utilitySum = 0
    for (let i = 0; i < chosenIdx.length; i += 1) {
      const idx = chosenIdx[i]
      const sig = poolSigs[idx]
      if (!baseSigSet.has(sig)) changedCount += 1
      const utility = Number(pool[idx]?.utility)
      utilitySum += Number.isFinite(utility) ? utility : 0
    }
    const preservedCount = requiredSize - changedCount

    const candidate = {
      selected,
      constraintSatisfiedCount,
      matrixDrift,
      changedCount,
      preservedCount,
      utilitySum,
      constraintSatisfied:
        directedConstraints.length === 0 || constraintSatisfiedCount >= directedConstraints.length,
    }

    if (!best) {
      best = candidate
      return
    }

    if (candidate.constraintSatisfiedCount !== best.constraintSatisfiedCount) {
      if (candidate.constraintSatisfiedCount > best.constraintSatisfiedCount) best = candidate
      return
    }
    if (candidate.matrixDrift !== best.matrixDrift) {
      if (candidate.matrixDrift < best.matrixDrift) best = candidate
      return
    }
    if (candidate.changedCount !== best.changedCount) {
      if (candidate.changedCount < best.changedCount) best = candidate
      return
    }
    if (candidate.preservedCount !== best.preservedCount) {
      if (candidate.preservedCount > best.preservedCount) best = candidate
      return
    }
    if (candidate.utilitySum > best.utilitySum) best = candidate
  }

  const dfs = (start) => {
    if (chosenIdx.length === requiredSize) {
      evaluate()
      return
    }
    const remainNeed = requiredSize - chosenIdx.length
    for (let i = start; i <= pool.length - remainNeed; i += 1) {
      chosenIdx.push(i)
      dfs(i + 1)
      chosenIdx.pop()
    }
  }

  dfs(0)
  return best
}

/* ── 方案A+C+D+E: Fault-tolerant covering + layered hedging ────────── */
const generateFaultTolerantCombos = (selectedMatches, systemConfig, calibrationContext, dynParams) => {
  const thresholds = dynParams?.confTierThresholds || DEFAULT_CONF_TIER_THRESHOLDS
  const sharpeGate = dynParams?.marginalSharpeThreshold || 0.15

  const tieredMatches = selectedMatches.map((m) => ({
    ...m,
    confTier: classifyConfidenceTier(m.conf, thresholds),
  }))

  const tier1 = tieredMatches.filter((m) => m.confTier === 'tier_1')
  const tier2 = tieredMatches.filter((m) => m.confTier === 'tier_2')
  const tier3 = tieredMatches.filter((m) => m.confTier === 'tier_3')
  const tier4 = tieredMatches.filter((m) => m.confTier === 'tier_4')
  const strongMatches = [...tier1, ...tier2]
  const allNonExtreme = [...tier1, ...tier2, ...tier3]

  const result = []
  const addedSigs = new Set()
  const tryAdd = (subset, tag) => {
    if (subset.length === 0) return
    const sig = subset.map((m) => m.key).sort().join('|')
    if (addedSigs.has(sig)) return
    addedSigs.add(sig)
    result.push({ subset, layerTag: tag })
  }

  // ── Core (2串1): anchor profit safety net ──
  if (tier1.length >= 2) {
    buildSubsets(tier1, 2).filter((s) => s.length === 2).forEach((pair) => tryAdd(pair, 'core'))
  }
  if (tier1.length >= 1) {
    tier2.slice(0, 4).forEach((t2) => { tier1.forEach((t1) => tryAdd([t1, t2], 'core')) })
  }
  if (tier1.length === 0 && tier2.length >= 2) {
    buildSubsets(tier2, 2).filter((s) => s.length === 2).slice(0, 6).forEach((pair) => tryAdd(pair, 'core'))
  }

  // ── Satellite (3串1): strong + extended ──
  if (strongMatches.length >= 3) {
    buildSubsets(strongMatches, 3).filter((s) => s.length === 3).forEach((t) => tryAdd(t, 'satellite'))
  }
  // Extend with tier_3 legs if they pass Sharpe gate
  if (tier2.length >= 2 && tier3.length >= 1) {
    tier3.forEach((t3) => {
      const gate = calcMarginalSharpeForLeg(tier2.slice(0, 2), t3, systemConfig, calibrationContext, sharpeGate)
      if (gate.shouldAdd) {
        buildSubsets(tier2, 2).filter((s) => s.length === 2).slice(0, 4)
          .forEach((pair) => tryAdd([...pair, t3], 'satellite'))
      }
    })
  }

  // ── Covering: C(N, N-1) and C(N, N-2) for fault tolerance ──
  if (allNonExtreme.length >= 3 && allNonExtreme.length <= 8) {
    for (let skip = 0; skip < allNonExtreme.length; skip++) {
      const subset = allNonExtreme.filter((_, i) => i !== skip)
      if (subset.length >= 2 && subset.length <= 5) tryAdd(subset, 'covering')
    }
  }
  if (strongMatches.length >= 5 && strongMatches.length <= 7) {
    for (let i = 0; i < strongMatches.length; i++) {
      for (let j = i + 1; j < strongMatches.length; j++) {
        const subset = strongMatches.filter((_, k) => k !== i && k !== j)
        if (subset.length >= 2 && subset.length <= 5) tryAdd(subset, 'covering')
      }
    }
  }

  // ── Moonshot: weak legs with strong anchors, always Sharpe-gated ──
  const weakMatches = [...tier3, ...tier4]
  if (weakMatches.length > 0 && strongMatches.length >= 1) {
    weakMatches.forEach((weak) => {
      const anchors = tier1.length >= 2 ? tier1.slice(0, 2)
        : tier1.length === 1 && tier2.length >= 1 ? [tier1[0], tier2[0]]
        : tier2.slice(0, 2)
      if (anchors.length >= 1) {
        const gate = calcMarginalSharpeForLeg(anchors, weak, systemConfig, calibrationContext, sharpeGate)
        if (gate.shouldAdd) tryAdd([...anchors, weak], 'moonshot')
      }
    })
  }

  // ── Full combo parlays ──
  if (strongMatches.length >= 4 && strongMatches.length <= 5) tryAdd(strongMatches, 'moonshot')
  if (allNonExtreme.length >= 4 && allNonExtreme.length <= 5 && allNonExtreme.length !== strongMatches.length) {
    tryAdd(allNonExtreme, 'moonshot')
  }

  return { combos: result, tiers: { tier1, tier2, tier3, tier4 }, tieredMatches }
}

/* ── Entry family: identify match families for diversification (思路6) ── */
const buildMatchFamilyKey = (item) => `${item.homeTeam}__${item.awayTeam}`

const calcEntryFamilyDiversity = (subset) => {
  // Measures how well a combo uses diverse entries within same-match families
  // Returns value in [0, 1], higher = more diverse within families
  const familyMap = new Map()
  subset.forEach((item) => {
    const fk = buildMatchFamilyKey(item)
    if (!familyMap.has(fk)) {
      familyMap.set(fk, {
        count: 0,
        entries: new Set(),
      })
    }
    const bucket = familyMap.get(fk)
    bucket.count += 1
    bucket.entries.add(item.entry || item.key)
  })
  // If all items are from unique matches, diversity is 1 (no family overlap issue)
  if (familyMap.size === subset.length) return 1
  // For each family with >1 member, check unique-entry ratio.
  let totalMembers = 0
  let weightedDiversity = 0
  familyMap.forEach((bucket) => {
    if (!bucket || bucket.count <= 1) return
    const ratio = bucket.entries.size / bucket.count
    totalMembers += bucket.count
    weightedDiversity += ratio * bucket.count
  })
  if (totalMembers <= 0) return 1
  return Math.max(0, Math.min(1, weightedDiversity / totalMembers))
}

/* ── MMR (Maximal Marginal Relevance) reranking ──────────────────────── */
const getSubsetMatchKeys = (subset) => {
  const keys = new Set()
  ;(subset || []).forEach((item) => {
    keys.add(buildMatchRefKey(item))
  })
  return [...keys]
}

const calcContinuousSubsetOverlap = (subsetA, subsetB, overlapTuning = null) => {
  const keysA = getSubsetMatchKeys(subsetA)
  const keysB = getSubsetMatchKeys(subsetB)
  if (keysA.length === 0 || keysB.length === 0) return 0
  const setA = new Set(keysA)
  const setB = new Set(keysB)
  let overlap = 0
  setA.forEach((key) => {
    if (setB.has(key)) overlap += 1
  })
  if (overlap <= 0) return 0
  const union = new Set([...setA, ...setB]).size
  const minSize = Math.max(1, Math.min(setA.size, setB.size))
  const jaccard = union > 0 ? overlap / union : 0
  const contain = overlap / minSize
  const tuning = overlapTuning || resolveOverlapTuning(DEFAULT_QUALITY_FILTER, null)
  const base = contain * tuning.containWeight + jaccard * tuning.jaccardWeight
  const curved = Math.max(0, Math.min(1, base)) ** tuning.curve
  return clamp(curved * tuning.scale, 0, 1)
}

const mmrRerank = (candidates, lambda = 0.6, maxPick = 10, coverageTargetKeys = null, eta = 0.15, hyperparams = null, overlapTuning = null) => {
  // MMR: score(i) = lambda * utility(i) - (1-lambda) * maxSim(i, selected) + eta * coverageGain(i)
  if (candidates.length === 0) return []
  if (candidates.length <= 1) return [...candidates]
  const safeLambda = Math.max(0, Math.min(1, Number(lambda) || 0))
  const safeEta = Math.max(0, Math.min(1, Number(eta) || 0))
  const similarityWeight = Math.max(0, 1 - safeLambda)
  const concBase = hyperparams?.mmrConcentrationBase ?? 0.18
  const concEtaScale = hyperparams?.mmrConcentrationEtaScale ?? 0.08
  const concentrationWeight = concBase + safeEta * concEtaScale

  // Normalize utilities to [0, 1] for fair blending
  const utilValues = candidates.map((c) => c.utility)
  const uMin = Math.min(...utilValues)
  const uMax = Math.max(...utilValues)
  const uRange = uMax - uMin || 1

  const selected = []
  const remaining = new Set(candidates.map((_, i) => i))
  const coveredKeys = new Set()
  const matchUseCount = new Map()

  for (let step = 0; step < Math.min(maxPick, candidates.length); step += 1) {
    let bestIdx = -1
    let bestScore = -Infinity

    remaining.forEach((idx) => {
      const cand = candidates[idx]
      const normUtil = (cand.utility - uMin) / uRange

      // Max similarity to any already selected
      let maxSim = 0
      selected.forEach((sel) => {
        const sim = calcContinuousSubsetOverlap(cand.subset, sel.subset, overlapTuning)
        if (sim > maxSim) maxSim = sim
      })

      // Coverage gain: how many new uncovered keys does this add?
      let coverageGain = 0
      if (coverageTargetKeys && coverageTargetKeys.size > 0) {
        cand.subset.forEach((item) => {
          const mk = buildMatchRefKey(item)
          if (coverageTargetKeys.has(mk) && !coveredKeys.has(mk)) {
            coverageGain += 1
          }
        })
        coverageGain /= coverageTargetKeys.size // normalize
      }

      // Penalize over-concentration on the same match across top selections.
      // STRONG penalty: prevents single-point-of-failure where one match miss kills ALL combos
      const candidateMatchKeys = getSubsetMatchKeys(cand.subset)
      let concentrationPenalty = 0
      if (candidateMatchKeys.length > 0 && selected.length > 0) {
        let penaltyAcc = 0
        candidateMatchKeys.forEach((mk) => {
          const used = matchUseCount.get(mk) || 0
          if (used <= 0) return
          const usageRatio = used / Math.max(1, selected.length)
          // Quadratic penalty that ramps up aggressively when a match is overused
          // At 2 selected: if match used 2/2 = 1.0, penalty = 1.0 + 0.5 = 1.5
          penaltyAcc += usageRatio * usageRatio + (used >= 2 ? 0.5 * usageRatio : 0)
        })
        concentrationPenalty = penaltyAcc / candidateMatchKeys.length
      }

      // Extra penalty for sharing the HIGHEST-CONF leg with already-selected combos
      // This prevents all combos from anchoring on the same "safe" match
      let anchorSharePenalty = 0
      if (selected.length > 0 && cand.subset.length > 0) {
        // Find this combo's highest-conf leg (its "anchor")
        const anchor = [...cand.subset].sort((a, b) => (b.conf || 0) - (a.conf || 0))[0]
        const anchorKey = anchor ? buildMatchRefKey(anchor) : null
        if (anchorKey) {
          const anchorUsed = matchUseCount.get(anchorKey) || 0
          // If the anchor is already in 50%+ of selected combos, heavy penalty
          const anchorPenaltyMag = hyperparams?.mmrAnchorSharePenalty ?? 0.12
          anchorSharePenalty = anchorUsed >= 1 ? anchorPenaltyMag * (anchorUsed / Math.max(1, selected.length)) : 0
        }
      }

      const score =
        safeLambda * normUtil
        - similarityWeight * maxSim
        + safeEta * coverageGain
        - concentrationWeight * concentrationPenalty
        - anchorSharePenalty
      if (score > bestScore) {
        bestScore = score
        bestIdx = idx
      }
    })

    if (bestIdx < 0) break
    const picked = candidates[bestIdx]
    selected.push(picked)
    remaining.delete(bestIdx)
    // update coverage
    picked.subset.forEach((item) => {
      coveredKeys.add(buildMatchRefKey(item))
    })
    getSubsetMatchKeys(picked.subset).forEach((mk) => {
      matchUseCount.set(mk, (matchUseCount.get(mk) || 0) + 1)
    })
  }

  return selected
}

/* ── Stratified selection: layer quotas by legs count (思路3) ─────────── */
const stratifiedSelect = (scoredCombos, totalSlots = 10, minLegs = 2, hyperparams = null) => {
  // Group by leg count
  const byLegs = new Map()
  scoredCombos.forEach((combo) => {
    const legs = combo.subset.length
    if (!byLegs.has(legs)) byLegs.set(legs, [])
    byLegs.get(legs).push(combo)
  })

  // Sort each group internally by utility
  byLegs.forEach((group) => {
    group.sort((a, b) => b.utility - a.utility || b.sharpe - a.sharpe)
  })

  // Default quota preferences: favor 3-4 legs, fewer for 2 and 5, minimal for 1
  // Quotas are proportional targets, not hard limits
  const defaultQuotas = { 1: 0.0, 2: 0.2, 3: 0.35, 4: 0.3, 5: 0.15 }
  const quotaPrefs = hyperparams?.stratifiedQuotas ? { ...defaultQuotas, ...hyperparams.stratifiedQuotas } : defaultQuotas
  // If minLegs > 1, zero out quota for legs below minLegs
  for (let k = 1; k < minLegs; k += 1) {
    quotaPrefs[k] = 0
  }

  // Normalize quotas to only available leg groups
  const availableLegs = [...byLegs.keys()].filter((k) => k >= minLegs)
  if (availableLegs.length === 0) {
    // fallback: use all groups
    return scoredCombos.slice(0, totalSlots)
  }

  let quotaSum = availableLegs.reduce((sum, k) => sum + (quotaPrefs[k] || 0.1), 0)
  const quotas = new Map()
  availableLegs.forEach((k) => {
    const raw = ((quotaPrefs[k] || 0.1) / quotaSum) * totalSlots
    quotas.set(k, Math.max(1, Math.round(raw))) // at least 1 from each available group
  })

  // Adjust to not exceed totalSlots
  let quotaTotal = [...quotas.values()].reduce((s, v) => s + v, 0)
  while (quotaTotal > totalSlots) {
    // reduce from groups with most quota
    const sorted = [...quotas.entries()].sort((a, b) => b[1] - a[1])
    if (sorted[0][1] > 1) {
      quotas.set(sorted[0][0], sorted[0][1] - 1)
      quotaTotal -= 1
    } else break
  }
  while (quotaTotal < totalSlots) {
    // add to groups with most available candidates
    const sorted = [...quotas.entries()]
      .filter(([k]) => (byLegs.get(k)?.length || 0) > quotas.get(k))
      .sort((a, b) => (byLegs.get(b[0])?.length || 0) - (byLegs.get(a[0])?.length || 0))
    if (sorted.length > 0) {
      quotas.set(sorted[0][0], sorted[0][1] + 1)
      quotaTotal += 1
    } else break
  }

  // Select from each group
  const result = []
  quotas.forEach((quota, legs) => {
    const group = byLegs.get(legs) || []
    result.push(...group.slice(0, quota))
  })

  // If we still have room, fill from the best remaining across all groups
  if (result.length < totalSlots) {
    const selectedSigs = new Set(result.map((r) => buildSubsetSignature(r.subset)))
    const remaining = scoredCombos
      .filter((c) => c.subset.length >= minLegs && !selectedSigs.has(buildSubsetSignature(c.subset)))
      .sort((a, b) => b.utility - a.utility)
    for (const r of remaining) {
      if (result.length >= totalSlots) break
      result.push(r)
    }
  }

  return result.slice(0, totalSlots)
}

/* ── Coverage dynamic scoring (replaces hard injection) ──────────────── */
const applyCoverageDynamicBoost = (scoredCombos, selectedMatches, baseDecay = 0.6, hyperparams = null) => {
  // For each uncovered / under-covered candidate, boost combos that include it
  // The boost decays as coverage increases (diminishing returns)
  const targetKeys = new Set(selectedMatches.map((m) => buildMatchRefKey(m)))
  if (targetKeys.size === 0) return scoredCombos

  // Count how many times each target key appears across top combos
  const keyCounts = new Map()
  targetKeys.forEach((k) => keyCounts.set(k, 0))
  // First pass: count appearances in top N combos
  const topN = Math.min(20, scoredCombos.length)
  for (let i = 0; i < topN; i += 1) {
    scoredCombos[i].subset.forEach((item) => {
      const mk = buildMatchRefKey(item)
      if (keyCounts.has(mk)) {
        keyCounts.set(mk, keyCounts.get(mk) + 1)
      }
    })
  }

  // Compute boost for each combo based on how many under-covered keys it contains
  return scoredCombos.map((combo) => {
    let coverageBoost = 0
    combo.subset.forEach((item) => {
      const mk = buildMatchRefKey(item)
      if (keyCounts.has(mk)) {
        const count = keyCounts.get(mk)
        // Diminishing boost: full boost for 0 appearances, decaying as count increases
        const boostScale = hyperparams?.coverageDecayBoost ?? 0.08
        const boost = Math.pow(baseDecay, count) * boostScale
        coverageBoost += boost
      }
    })
    return {
      ...combo,
      coverageBoost,
      boostedUtility: combo.utility + coverageBoost,
    }
  })
}

const CANDIDATE_DISMISSED_KEY = 'dugou.combo.dismissed_candidates.v1'
const COMBO_PLAN_HISTORY_KEY = 'dugou.combo.plan_history.v1'
const COMBO_ANALYSIS_FILTER_KEY = 'dugou.combo.analysis_filter.v1'
const COMBO_STRATEGY_OPTIONS = [
  {
    value: 'manualCoverage',
    label: '勾选优先',
    desc: '优先保障每个已勾选比赛都进入推荐池，必要时自动补位。',
  },
  {
    value: 'softPenalty',
    label: '软惩罚',
    desc: '不过度一刀切，对不达标项做分数惩罚后继续参与排序。',
  },
  {
    value: 'thresholdStrict',
    label: '阈值优先',
    desc: '只保留满足胜率/相关性/覆盖率阈值的组合。',
  },
]
const COMBO_STRATEGY_DISPLAY_ORDER = ['manualCoverage', 'softPenalty', 'thresholdStrict']
const DEFAULT_COMBO_STRATEGY = 'softPenalty'
const DEFAULT_ALLOCATION_MODE = 'balanced'
const DEFAULT_SOLVER_MODE = 'heuristic'
const ALLOCATION_MODE_OPTIONS = [
  {
    value: 'precision',
    label: 'Precision',
    sub: '1 rmb 精细分配',
    selectedTone:
      'border-emerald-300/80 bg-gradient-to-br from-emerald-100/85 via-white to-teal-100/75 text-emerald-700 shadow-[0_8px_20px_rgba(16,185,129,0.18)]',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    sub: '10 rmb 平衡覆盖',
    selectedTone:
      'border-indigo-300/80 bg-gradient-to-br from-indigo-100/85 via-white to-sky-100/75 text-indigo-700 shadow-[0_8px_20px_rgba(99,102,241,0.16)]',
  },
]
const normalizeAllocationMode = (value) => (value === 'precision' ? 'precision' : 'balanced')
const SOLVER_MODE_OPTIONS = [
  {
    value: 'heuristic',
    label: '多阶段启发式',
    sub: '分层 + MMR + 覆盖修补',
    selectedTone:
      'border-indigo-300/80 bg-gradient-to-br from-indigo-100/85 via-white to-sky-100/75 text-indigo-700 shadow-[0_8px_20px_rgba(99,102,241,0.16)]',
  },
  {
    value: 'globalJoint',
    label: '全局联立优化',
    sub: '一次性联立优化覆盖与去重',
    selectedTone:
      'border-emerald-300/80 bg-gradient-to-br from-emerald-100/85 via-white to-teal-100/75 text-emerald-700 shadow-[0_8px_20px_rgba(16,185,129,0.18)]',
  },
]
const normalizeSolverMode = (value) => (value === 'globalJoint' ? 'globalJoint' : 'heuristic')

const normalizeMode = (mode) => (mode === '常规-激进' ? '常规-杠杆' : mode || '常规')

const getFineConfBucket = (conf) => {
  if (conf >= 0.8) return '0.8+'
  if (conf >= 0.7) return '0.7-0.8'
  if (conf >= 0.6) return '0.6-0.7'
  if (conf >= 0.5) return '0.5-0.6'
  if (conf >= 0.4) return '0.4-0.5'
  return '<0.4'
}

const getOddsBucketByHalf = (odds) => {
  if (!Number.isFinite(odds) || odds <= 0) return 'unknown'
  if (odds >= 4) return '4.0+'
  const start = Math.floor((odds - 1) / 0.5) * 0.5 + 1
  const end = start + 0.5
  return `${start.toFixed(1)}-${end.toFixed(1)}`
}

const readAnalysisFilter = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(COMBO_ANALYSIS_FILTER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const clearAnalysisFilter = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(COMBO_ANALYSIS_FILTER_KEY)
  } catch {
    // ignore
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const DEFAULT_COMBO_STRUCTURE = {
  minLegs: 2,
  parlayBeta: 0.12,
  mmrLambda: 0.55,
  coverageEta: 0.15,
}

const DEFAULT_QUALITY_FILTER = {
  antiOverlapPercent: 60,
  minWinRate: 5,
  maxCorr: 0.85,
  minCoveragePercent: 55,
  minCoverageEnabled: true,
}

const sanitizeComboStructure = (value) => ({
  minLegs: clamp(Number(value?.minLegs ?? DEFAULT_COMBO_STRUCTURE.minLegs), 1, 5),
  parlayBeta: clamp(Number(value?.parlayBeta ?? DEFAULT_COMBO_STRUCTURE.parlayBeta), 0, 0.5),
  mmrLambda: clamp(Number(value?.mmrLambda ?? DEFAULT_COMBO_STRUCTURE.mmrLambda), 0.2, 0.9),
  coverageEta: clamp(Number(value?.coverageEta ?? DEFAULT_COMBO_STRUCTURE.coverageEta), 0, 0.4),
})

const sanitizeQualityFilter = (value) => ({
  antiOverlapPercent: clamp(
    Number.parseFloat(value?.antiOverlapPercent ?? value?.overlapSeverity ?? DEFAULT_QUALITY_FILTER.antiOverlapPercent),
    0,
    100,
  ),
  minWinRate: clamp(Number.parseInt(value?.minWinRate ?? DEFAULT_QUALITY_FILTER.minWinRate, 10), 0, 100),
  maxCorr: clamp(Number.parseFloat(value?.maxCorr ?? DEFAULT_QUALITY_FILTER.maxCorr), 0, 1),
  minCoveragePercent: clamp(Number.parseFloat(value?.minCoveragePercent ?? DEFAULT_QUALITY_FILTER.minCoveragePercent), 0, 100),
  minCoverageEnabled: value?.minCoverageEnabled !== false,
})

const resolveOverlapTuning = (qualityFilter, hyperparams = null) => {
  const antiOverlapPct = clamp(Number(qualityFilter?.antiOverlapPercent ?? DEFAULT_QUALITY_FILTER.antiOverlapPercent), 0, 100) / 100
  const hpScale = clamp(Number(hyperparams?.overlapPenaltyScale ?? 1), 0.75, 1.35)
  const curve = clamp(1 + antiOverlapPct * 2 * hpScale, 1, 3.4)
  const scale = clamp(0.45 + antiOverlapPct * 0.55 * hpScale, 0.35, 1)
  return {
    containWeight: 0.38,
    jaccardWeight: 0.62,
    antiOverlapPct,
    curve,
    scale,
  }
}

const getFactorWeight = (value, fallback) => {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return fallback
  return clamp(n, 0.01, 1.5)
}

const buildId = (prefix = 'id') => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const formatPercent = (value) => {
  const num = Number(value || 0)
  const sign = num >= 0 ? '+' : ''
  return `${sign}${num.toFixed(1)}%`
}

const formatPercentProbe = (value) => {
  const num = Number(value || 0)
  const sign = num >= 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

const formatDateKey = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const readDismissedCandidateKeys = () => {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(CANDIDATE_DISMISSED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map((item) => String(item)))
  } catch {
    return new Set()
  }
}

const writeDismissedCandidateKeys = (keysSet) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CANDIDATE_DISMISSED_KEY, JSON.stringify([...keysSet]))
}

const readComboPlanHistory = () => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(COMBO_PLAN_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

const writeComboPlanHistory = (history) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(COMBO_PLAN_HISTORY_KEY, JSON.stringify(history))
}

const normalizeMatchLabelKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const collectHistoryMatchKeys = (historyRow, candidateRows = []) => {
  const keys = new Set()
  if (!historyRow || typeof historyRow !== 'object') return keys
  const labelKeys = new Set()

  if (historyRow.selectedRoleMap && typeof historyRow.selectedRoleMap === 'object') {
    Object.keys(historyRow.selectedRoleMap).forEach((key) => {
      const clean = String(key || '').trim()
      if (clean) keys.add(clean)
    })
  }

  if (Array.isArray(historyRow.recommendations)) {
    historyRow.recommendations.forEach((recommendation) => {
      const subset = Array.isArray(recommendation?.subset) ? recommendation.subset : []
      subset.forEach((match) => {
        if (!match) return
        const directKey = String(match.key || '').trim()
        if (directKey) keys.add(directKey)
        if (match.investmentId != null && match.matchIndex != null) {
          keys.add(`${match.investmentId}-${match.matchIndex}`)
        }
        const home = String(match.homeTeam || match.home_team || '').trim()
        const away = String(match.awayTeam || match.away_team || '').trim()
        if (home || away) {
          labelKeys.add(normalizeMatchLabelKey(`${home || '-'} vs ${away || '-'}`))
        } else if (match.match) {
          labelKeys.add(normalizeMatchLabelKey(match.match))
        }
      })
    })
  }

  if (Array.isArray(historyRow.candidateMatchKeys)) {
    historyRow.candidateMatchKeys.forEach((item) => {
      const keyText = normalizeMatchLabelKey(item?.matchKey)
      if (keyText) labelKeys.add(keyText)
    })
  }

  if (Array.isArray(candidateRows) && candidateRows.length > 0 && labelKeys.size > 0) {
    const rowLabelMap = new Map()
    candidateRows.forEach((row) => {
      const key = String(row?.key || '').trim()
      if (!key) return
      rowLabelMap.set(normalizeMatchLabelKey(row.match), key)
      rowLabelMap.set(normalizeMatchLabelKey(`${row.homeTeam || '-'} vs ${row.awayTeam || '-'}`), key)
    })
    labelKeys.forEach((labelKey) => {
      const matched = rowLabelMap.get(labelKey)
      if (matched) keys.add(matched)
    })
  }

  return keys
}

const collectHistoryCandidates = (historyRow) => {
  const map = new Map()
  if (!historyRow || typeof historyRow !== 'object') return []

  const pushCandidate = (rawMatch, fallbackSeed = 'history', fallbackIndex = 0) => {
    if (!rawMatch || typeof rawMatch !== 'object') return
    const investmentIdRaw = rawMatch.investmentId ?? rawMatch.investment_id ?? fallbackSeed
    const investmentId = String(investmentIdRaw || fallbackSeed || 'history').trim() || 'history'
    const parsedIndex = Number.parseInt(rawMatch.matchIndex ?? rawMatch.match_index ?? fallbackIndex, 10)
    const matchIndex = Number.isFinite(parsedIndex) ? parsedIndex : fallbackIndex
    const directKey = String(rawMatch.key || '').trim()
    const key = directKey || `${investmentId}-${matchIndex}`
    if (!key || map.has(key)) return

    const homeTeam = String(rawMatch.homeTeam || rawMatch.home_team || '-').trim() || '-'
    const awayTeam = String(rawMatch.awayTeam || rawMatch.away_team || '-').trim() || '-'
    const odds = Math.max(1.01, Number(rawMatch.odds ?? rawMatch.effectiveOdds ?? 2.5) || 2.5)
    const conf = clamp(Number(rawMatch.conf ?? rawMatch.expectedRating ?? 0.5) || 0.5, 0.05, 0.95)
    const entries = Array.isArray(rawMatch.entries)
      ? rawMatch.entries.map((entry) => ({ ...entry }))
      : []
    const fallbackEntry = entries
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean)
      .join(', ')

    map.set(key, {
      key,
      investmentId,
      matchIndex,
      match: `${homeTeam} vs ${awayTeam}`,
      homeTeam,
      awayTeam,
      entry: String(rawMatch.entry || rawMatch.entry_text || fallbackEntry || '-').trim() || '-',
      entries,
      entryMarketType: rawMatch.entryMarketType || rawMatch.entry_market_type || 'other',
      odds: Number(odds.toFixed(2)),
      conf: Number(conf.toFixed(2)),
      roughEvPercent: (conf * odds - 1) * 100,
      mode: rawMatch.mode || '常规',
      tysHome: rawMatch.tysHome || rawMatch.tys_home || 'M',
      tysAway: rawMatch.tysAway || rawMatch.tys_away || 'M',
      fid: Number(rawMatch.fid ?? 0.5),
      fseHome: Number(rawMatch.fseHome ?? rawMatch.fse_home ?? 0.5),
      fseAway: Number(rawMatch.fseAway ?? rawMatch.fse_away ?? 0.5),
      note: String(rawMatch.note || '').trim(),
    })
  }

  if (Array.isArray(historyRow.selectedMatchesSnapshot)) {
    historyRow.selectedMatchesSnapshot.forEach((match, idx) => {
      pushCandidate(match, `history-${historyRow.id || 'snapshot'}`, idx)
    })
  }

  if (Array.isArray(historyRow.recommendations)) {
    historyRow.recommendations.forEach((recommendation, recIdx) => {
      const subset = Array.isArray(recommendation?.subset) ? recommendation.subset : []
      subset.forEach((match, idx) => {
        pushCandidate(match, `history-${historyRow.id || recIdx}`, idx)
      })
    })
  }

  return [...map.values()]
}

const getLayerByRank = (rank) => {
  if (rank === 1) return '主推'
  if (rank <= 3) return '次推'
  return '博冷'
}

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parsePercentText = (value, fallback = Number.NaN) => {
  if (typeof value !== 'string') return fallback
  const cleaned = value.replace('%', '').trim()
  const parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return fallback
  return parsed / 100
}

const normalizeHistoryRecommendation = (row, index = 0) => {
  const fallbackRank = index + 1
  const subset = Array.isArray(row?.subset) ? row.subset.filter(Boolean) : []
  const legs = Math.max(1, Number.parseInt(row?.legs || subset.length || 1, 10) || subset.length || 1)
  const amount = Math.max(0, Math.round(toFiniteNumber(row?.amount, 0)))
  const explainSource = row?.explain && typeof row.explain === 'object' ? row.explain : {}

  const derivedFromAtomic = (() => {
    if (subset.length === 0) return null
    const profiles = subset
      .map((item) => (item && item.atomicProfile && Array.isArray(item.atomicProfile.states) ? item.atomicProfile : null))
      .filter(Boolean)
    if (profiles.length !== subset.length) return null
    return combineAtomicMatchProfiles(profiles)
  })()

  const expectedReturn = (() => {
    const direct = toFiniteNumber(row?.expectedReturn, Number.NaN)
    if (Number.isFinite(direct)) return direct
    const fromEvText = parsePercentText(row?.ev, Number.NaN)
    if (Number.isFinite(fromEvText)) return fromEvText
    if (derivedFromAtomic) return toFiniteNumber(derivedFromAtomic.expectedReturn, 0)
    return 0
  })()

  const hitProbability = (() => {
    const direct = toFiniteNumber(row?.hitProbability ?? row?.p, Number.NaN)
    if (Number.isFinite(direct)) return clamp(direct, 0, 1)
    const fromText = parsePercentText(row?.winRate, Number.NaN)
    if (Number.isFinite(fromText)) return clamp(fromText, 0, 1)
    if (derivedFromAtomic) return clamp(toFiniteNumber(derivedFromAtomic.hitProbability, 0), 0, 1)
    return 0
  })()

  const profitWinProbability = (() => {
    const direct = toFiniteNumber(row?.profitWinProbability, Number.NaN)
    if (Number.isFinite(direct)) return clamp(direct, 0, 1)
    const fromExplain = toFiniteNumber(explainSource.profitWinPct, Number.NaN)
    if (Number.isFinite(fromExplain)) return clamp(fromExplain / 100, 0, 1)
    const fromText = parsePercentText(row?.profitWinRate, Number.NaN)
    if (Number.isFinite(fromText)) return clamp(fromText, 0, 1)
    if (derivedFromAtomic) return clamp(toFiniteNumber(derivedFromAtomic.profitWinProbability, 0), 0, 1)
    return clamp(hitProbability, 0, 1)
  })()

  const combinedOdds = Math.max(1.01, toFiniteNumber(row?.combinedOdds ?? row?.odds, derivedFromAtomic?.equivalentOdds ?? 1.01))
  const expectedRating = clamp(toFiniteNumber(row?.expectedRating, hitProbability), 0, 1)
  const layer = row?.layer || getLayerByRank(fallbackRank)
  const tier = row?.tier || `T${fallbackRank}`
  const theoreticalWeightPct = (() => {
    const direct = toFiniteNumber(row?.theoreticalWeightPct, Number.NaN)
    if (Number.isFinite(direct)) return Math.max(0, direct)
    const fromExplain = toFiniteNumber(explainSource.weightPct, Number.NaN)
    if (Number.isFinite(fromExplain)) return Math.max(0, fromExplain)
    if (typeof row?.allocation === 'string') {
      const match = row.allocation.match(/([0-9]+(?:\.[0-9]+)?)\s*%/)
      if (match?.[1]) return Math.max(0, toFiniteNumber(match[1], 0))
    }
    return 0
  })()
  const allocationText = amount > 0 ? `${amount} rmb` : `理论权重 ${theoreticalWeightPct.toFixed(1)}%`

  return {
    ...row,
    id: String(row?.id || `history-${fallbackRank}`),
    rank: Number.parseInt(row?.rank || fallbackRank, 10) || fallbackRank,
    tier,
    layer,
    tierLabel: row?.tierLabel || `${tier} ${layer}`,
    combo: String(row?.combo || buildComboTitle(subset) || `组合 ${fallbackRank}`),
    legs,
    amount,
    allocation: allocationText,
    theoreticalWeightPct: Number(theoreticalWeightPct.toFixed(1)),
    allocatedWeight: Number((theoreticalWeightPct / 100).toFixed(6)),
    ev: row?.ev || formatPercent(expectedReturn * 100),
    winRate: row?.winRate || `${Math.round(hitProbability * 100)}%`,
    profitWinRate: row?.profitWinRate || `${Math.round(profitWinProbability * 100)}%`,
    sharpe: row?.sharpe || toFiniteNumber(row?.utility, 0).toFixed(2),
    sigma: toFiniteNumber(row?.sigma, 0),
    utility: toFiniteNumber(row?.utility, 0),
    expectedReturn,
    subset,
    combinedOdds,
    expectedRating,
    coverageInjected: Boolean(row?.coverageInjected),
    explain: {
      weightPct: toFiniteNumber(explainSource.weightPct, 0),
      confAvg: toFiniteNumber(explainSource.confAvg, 0.5),
      calibGainPp: toFiniteNumber(explainSource.calibGainPp, 0),
      profitWinPct: toFiniteNumber(explainSource.profitWinPct, profitWinProbability * 100),
      riskPenaltySharePct: toFiniteNumber(explainSource.riskPenaltySharePct, 0),
      corr: toFiniteNumber(explainSource.corr, 0),
      parlayBonus: toFiniteNumber(explainSource.parlayBonus, 0),
      familyDiversity: toFiniteNumber(explainSource.familyDiversity, 1),
      roleMixBonus: toFiniteNumber(explainSource.roleMixBonus, 0),
      roleSignature: String(explainSource.roleSignature || '--'),
      thresholdPass: typeof explainSource.thresholdPass === 'boolean' ? explainSource.thresholdPass : true,
    },
  }
}

const calcRecommendedAmount = (probability, odds, systemConfig, riskCap, calibrationContext = null) => {
  if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) return 0
  const p = clamp(probability, 0.05, 0.95)
  // Pure Kelly criterion: f* = (p × b - q) / b where b = odds - 1, q = 1 - p
  const b = odds - 1
  const kelly = (p * b - (1 - p)) / b
  if (!Number.isFinite(kelly) || kelly <= 0) return 0
  // Fractional Kelly: divide by kellyDivisor (default 4 = 25% Kelly)
  // Apply walk-forward feedback adjustment if available
  const baseKellyDivisor = Number(systemConfig.kellyDivisor || 4)
  const wfFeedback = calibrationContext?.walkForwardFeedback
  const wfKellyDivisor = wfFeedback?.ready && Number.isFinite(wfFeedback.adjustments?.kellyDivisor)
    ? wfFeedback.adjustments.kellyDivisor
    : baseKellyDivisor
  const effectiveKellyDivisor = Math.max(1, wfKellyDivisor)
  const fraction = kelly / effectiveKellyDivisor
  const raw = Math.max(0, Number(systemConfig.initialCapital || 0) * fraction)
  if (raw <= 0) return 0
  const rounded = Math.round(raw / 10) * 10
  return Math.max(20, Math.min(riskCap, rounded))
}

const calcCombinationCount = (n, k) => {
  if (!Number.isFinite(n) || !Number.isFinite(k) || k < 0 || k > n) return 0
  const kk = Math.min(k, n - k)
  if (kk === 0) return 1
  let result = 1
  for (let i = 1; i <= kk; i += 1) {
    result = (result * (n - kk + i)) / i
  }
  return Math.round(result)
}

const countCandidateCombos = (matchCount, maxSubsetSize = 5, minSubsetSize = 1, gracefulFallback = true) => {
  const n = Math.max(0, Number.parseInt(matchCount, 10) || 0)
  if (n === 0) return 0
  const upper = Math.min(maxSubsetSize, n)
  const requestedMin = Math.max(1, Number.parseInt(minSubsetSize, 10) || 1)
  const lower = gracefulFallback && requestedMin > upper ? 1 : Math.min(requestedMin, upper)
  let total = 0
  for (let k = lower; k <= upper; k += 1) {
    total += calcCombinationCount(n, k)
  }
  return total
}

const allocateAmountsWithinRiskCap = (weights, riskCap, unit = 10, minActive = 0) => {
  if (!Array.isArray(weights) || weights.length === 0) return []
  const step = Math.max(1, Math.round(Number(unit) || 10))
  const cap = Math.max(0, Math.floor((Number(riskCap) || 0) / step) * step)
  if (cap <= 0) return Array(weights.length).fill(0)

  const safeWeights = weights.map((value) => Math.max(0, Number(value) || 0))
  const weightSum = safeWeights.reduce((sum, value) => sum + value, 0)
  if (weightSum <= 1e-9) {
    const next = Array(weights.length).fill(0)
    next[0] = step
    return next
  }

  const capUnits = Math.floor(cap / step)
  const rankedByWeight = safeWeights
    .map((value, index) => ({ index, value }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
  const maxActivatable = Math.min(weights.length, capUnits)
  const targetActive = Math.min(
    maxActivatable,
    Math.max(0, Number.parseInt(minActive, 10) || 0),
  )

  const units = Array(weights.length).fill(0)
  let remainUnits = capUnits
  for (let i = 0; i < targetActive; i += 1) {
    const target = rankedByWeight[i]
    if (!target) break
    units[target.index] += 1
    remainUnits -= 1
  }

  const rawUnits = safeWeights.map((value) => (value / weightSum) * Math.max(0, remainUnits))
  const baseUnits = rawUnits.map((value) => Math.floor(value))
  baseUnits.forEach((value, index) => {
    units[index] += value
  })
  remainUnits -= baseUnits.reduce((sum, value) => sum + value, 0)

  const order = rawUnits
    .map((value, index) => ({
      index,
      remainder: value - Math.floor(value),
      weight: safeWeights[index],
    }))
    .sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index)

  let cursor = 0
  while (remainUnits > 0 && order.length > 0) {
    const target = order[cursor % order.length]
    units[target.index] += 1
    remainUnits -= 1
    cursor += 1
  }

  return units.map((value) => value * step)
}

const getTodayMatches = () => {
  const pending = getInvestments().filter((item) => item.status === 'pending' && !item.is_archived)
  if (pending.length === 0) return []
  const dismissedKeys = readDismissedCandidateKeys()

  const todayKey = formatDateKey(new Date().toISOString())
  const todayPending = pending.filter((item) => formatDateKey(item.created_at) === todayKey)
  const source = todayPending.length > 0 ? todayPending : pending

  return source
    .flatMap((investment) =>
      (investment.matches || []).map((match, matchIdx) => {
        const conf = clamp(Number(match.conf || investment.expected_rating || 0.5), 0.05, 0.95)
        const odds = Math.max(1.01, Number(match.odds || investment.combined_odds || 2.5))
        const roughEv = conf * odds - 1
        return {
          key: `${investment.id}-${matchIdx}`,
          investmentId: investment.id,
          matchIndex: matchIdx,
          match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
          homeTeam: match.home_team || '-',
          awayTeam: match.away_team || '-',
          entry: match.entry_text || (Array.isArray(match.entries) ? match.entries.map((entry) => entry.name).join(', ') : '-'),
          entries: Array.isArray(match.entries) ? match.entries.map((entry) => ({ ...entry })) : [],
          entryMarketType: match.entry_market_type || 'other',
          odds: Number(odds.toFixed(2)),
          conf: Number(conf.toFixed(2)),
          roughEvPercent: roughEv * 100,
          mode: match.mode || '常规',
          tysHome: match.tys_home || 'M',
          tysAway: match.tys_away || 'M',
          fid: Number(match.fid ?? 0.5),
          fseHome: Number(match.fse_home ?? 0.5),
          fseAway: Number(match.fse_away ?? 0.5),
          note: match.note || '',
        }
      }),
    )
    .filter((match) => !dismissedKeys.has(match.key))
    .slice(0, 12)
}

const buildSubsets = (items, maxSubsetSize) => {
  const result = []
  const n = items.length
  const path = []

  const dfs = (start) => {
    if (path.length > 0 && path.length <= maxSubsetSize) {
      result.push([...path])
    }
    if (path.length === maxSubsetSize) return
    for (let i = start; i < n; i += 1) {
      path.push(items[i])
      dfs(i + 1)
      path.pop()
    }
  }

  dfs(0)
  return result
}

// ═══════════════════════════════════════════════════════════════
// Conf-Surplus: How much our conf exceeds market-implied probability.
// Positive surplus = we see value the market doesn't = edge.
// This is RELATIVE evaluation: conf 0.45 on a 3.2 odds match
// (implied ~31%) gives surplus +0.14, which is a STRONG edge.
// Conf 0.75 on a 1.19 odds match (implied ~84%) gives surplus -0.09.
// ═══════════════════════════════════════════════════════════════
const calcConfSurplus = (match, calibratedP = null, hyperparams = null) => {
  const rawConf = clamp(Number(match.conf || 0.5), 0.05, 0.95)
  // Use calibrated probability if available, otherwise raw conf
  // This ensures surplus reflects the model's actual calibrated edge, not uncalibrated input
  const modelProb = calibratedP != null && Number.isFinite(calibratedP) ? clamp(calibratedP, 0.05, 0.95) : rawConf
  const anchorOdds = estimateEntryAnchorOdds(
    Array.isArray(match.entries) ? match.entries : [],
    Number(match.odds || 2.5),
  )
  // Market implied probability (with vig removed — dynamic overround from backtest)
  const vig = hyperparams?.vigOverround ?? 0.05
  const rawImplied = 1 / Math.max(1.01, anchorOdds)
  const vigAdjusted = clamp(rawImplied * (1 - vig), 0.02, 0.98)
  const surplus = modelProb - vigAdjusted
  // Surplus ratio: how big is the edge relative to market prob
  // This normalizes across different odds levels
  const surplusRatio = vigAdjusted > 0.01 ? surplus / vigAdjusted : 0
  // Edge classification — dynamic thresholds from backtest
  const st = hyperparams?.surplusThresholds || { strongEdge: 0.12, moderateEdge: 0.04, neutral: -0.03 }
  return {
    surplus: Number(surplus.toFixed(4)),
    surplusRatio: Number(surplusRatio.toFixed(4)),
    marketImplied: Number(vigAdjusted.toFixed(4)),
    conf: rawConf,
    modelProb: Number(modelProb.toFixed(4)),
    anchorOdds: Number(anchorOdds.toFixed(2)),
    edgeClass: surplus >= st.strongEdge ? 'strong_edge' : surplus >= st.moderateEdge ? 'moderate_edge' : surplus >= st.neutral ? 'neutral' : 'negative_edge',
  }
}

const calcAdjustedProbability = (match, systemConfig, calibrationContext) => {
  const confMultiplier = clamp(Number(calibrationContext?.multipliers?.conf || 1), 0.75, 1.25)
  const fseMultiplier = clamp(Number(calibrationContext?.multipliers?.fse || 1), 0.75, 1.25)
  const rawConf = clamp(match.conf, 0.05, 0.95)
  const conf =
    typeof calibrationContext?.calibrate === 'function'
      ? clamp(calibrationContext.calibrate(rawConf), 0.05, 0.95)
      : clamp(rawConf * confMultiplier, 0.05, 0.95)

  // ── Use LEARNED factors from calibrationContext if available, fallback to hardcoded priors ──
  const lf = calibrationContext?.learnedFactors
  const hasLearnedFactors = lf && lf.reliability > 0.15

  // MODE factor: learned from historical hit-rate by mode
  const modeFactor = hasLearnedFactors && lf.mode?.[match.mode] != null
    ? lf.mode[match.mode]
    : (MODE_FACTOR_MAP[match.mode] || 1)

  // TYS factor: learned per TYS level, averaged for home/away
  const tysHome = hasLearnedFactors && lf.tys?.[match.tysHome] != null
    ? lf.tys[match.tysHome]
    : (TYS_FACTOR_MAP[match.tysHome] || 1)
  const tysAway = hasLearnedFactors && lf.tys?.[match.tysAway] != null
    ? lf.tys[match.tysAway]
    : (TYS_FACTOR_MAP[match.tysAway] || 1)
  const tysFactor = (tysHome + tysAway) / 2

  // FID factor: learned per FID bucket
  const fidKey = String(match.fid)
  const fidFactor = hasLearnedFactors && lf.fid?.[fidKey] != null
    ? lf.fid[fidKey]
    : (FID_FACTOR_MAP[match.fid] || 1)

  // FSE factor: learned via continuous interpolation from historical FSE buckets
  const fseMatch = Math.sqrt(clamp(match.fseHome, 0.05, 1) * clamp(match.fseAway, 0.05, 1))
  const fseFactor = hasLearnedFactors && typeof lf.fse?.interpolate === 'function'
    ? clamp(lf.fse.interpolate(fseMatch) * fseMultiplier, 0.72, 1.35)
    : clamp((0.88 + fseMatch * 0.24) * fseMultiplier, 0.72, 1.35)

  // Context-factor lift (mode, TYS, FID, FSE — everything EXCEPT conf itself)
  const contextLift =
    modeFactor ** getFactorWeight(systemConfig.weightMode, 0.16) *
    tysFactor ** getFactorWeight(systemConfig.weightTys, 0.12) *
    fidFactor ** getFactorWeight(systemConfig.weightFid, 0.14) *
    fseFactor ** getFactorWeight(systemConfig.weightFse, 0.07)

  // baseProbability = calibrated conf × context lift (conf is the foundation, not 0.5)
  const baseProbability = clamp(conf * contextLift, 0.05, 0.95)
  const anchorOdds = estimateEntryAnchorOdds(match.entries, Number(match.odds) || Number(systemConfig.defaultOdds || 2.5))
  if (typeof calibrationContext?.calibrateProbabilityForMatch !== 'function') return baseProbability
  return clamp(
    calibrationContext.calibrateProbabilityForMatch({
      baseProbability,
      conf: rawConf,
      odds: anchorOdds,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
    }),
    0.05,
    0.95,
  )
}

const buildAtomicLegProfile = (match, unionProbability, fallbackOdds = 2.5) =>
  buildAtomicMatchProfile({
    entries: Array.isArray(match.entries) ? match.entries : [],
    unionProbability,
    fallbackOdds,
  })

const translateEntry = (entry) => {
  if (!entry) return ''
  const e = entry.trim().toLowerCase()
  const map = { win: '胜', lose: '不敌', draw: '战平', 'draw/lose': '战平/不敌', 'win/draw': '胜/战平' }
  if (map[e]) return map[e]
  // Handle comma-separated like "draw, lose" → "战平/不敌"
  if (e.includes(',')) {
    return e.split(',').map(p => map[p.trim()] || p.trim()).join('/')
  }
  // Score entries like "1-1" or "2-0" stay as-is
  return entry.trim()
}

const buildComboTitle = (subset) =>
  subset
    .map((item) => {
      const fullEntry = (item.entry || '').trim()
      if (!fullEntry) return item.homeTeam
      return `${item.homeTeam}${fullEntry}`
    })
    .join(' × ')

const buildSubsetSignature = (subset) =>
  subset
    .map((item) => `${item.investmentId}-${item.matchIndex}-${item.entry}-${item.odds}`)
    .sort()
    .join('|')

const buildMatchRefKey = (item) => {
  const directKey = String(item?.key || '').trim()
  if (directKey) return directKey
  const investmentId = String(item?.investmentId || '').trim()
  const matchIndexRaw = item?.matchIndex
  const hasMatchIndex = matchIndexRaw !== undefined && matchIndexRaw !== null && String(matchIndexRaw).trim() !== ''
  if (investmentId && hasMatchIndex) return `${investmentId}-${matchIndexRaw}`
  const home = String(item?.homeTeam || '').trim()
  const away = String(item?.awayTeam || '').trim()
  if (home || away) return `${home}-${away}`
  return ''
}

const dedupeRankedBySignature = (rankedRows) => {
  const next = []
  const signatures = new Set()
  rankedRows.forEach((row) => {
    const sig = buildSubsetSignature(row.subset)
    if (!sig || signatures.has(sig)) return
    signatures.add(sig)
    next.push(row)
  })
  return next
}

const parseDirectedDecouplingConstraints = (decouplingPairs) => {
  if (!decouplingPairs || decouplingPairs.size <= 0) return []
  const seen = new Set()
  const parsed = []
  decouplingPairs.forEach((pairKey) => {
    const [fromKey, toKey] = String(pairKey || '').split('|')
    if (!fromKey || !toKey || fromKey === toKey) return
    const key = `${fromKey}|${toKey}`
    if (seen.has(key)) return
    seen.add(key)
    parsed.push({ key, fromKey, toKey })
  })
  return parsed
}

const getConstraintAliasesForMatch = (item) => {
  const aliases = new Set()
  const directKey = String(item?.key || '').trim()
  if (directKey) aliases.add(directKey)
  const refKey = String(buildMatchRefKey(item) || '').trim()
  if (refKey && !refKey.includes('undefined')) aliases.add(refKey)
  const home = String(item?.homeTeam || '').trim()
  const away = String(item?.awayTeam || '').trim()
  if (home || away) aliases.add(`${home}-${away}`)
  return aliases
}

const comboHasConstraintKey = (combo, targetKey) => {
  const cleanTarget = String(targetKey || '').trim()
  if (!combo || !cleanTarget) return false
  return (combo.subset || []).some((item) => getConstraintAliasesForMatch(item).has(cleanTarget))
}

const comboSatisfiesDirectedConstraint = (combo, constraint) => {
  if (!combo || !constraint) return false
  const hasTo = comboHasConstraintKey(combo, constraint.toKey)
  if (!hasTo) return false
  return !comboHasConstraintKey(combo, constraint.fromKey)
}

const enforceDirectedDecouplingHard = (seedRanked, fallbackRanked, constraints, maxRows = 10, options = null) => {
  if (!Array.isArray(seedRanked) || seedRanked.length === 0) return null
  if (!Array.isArray(constraints) || constraints.length === 0) return seedRanked.slice(0, maxRows)

  const rows = seedRanked.slice(0, maxRows)
  const usedSignatures = new Set(rows.map((row) => buildSubsetSignature(row.subset)).filter(Boolean))
  const candidates = Array.isArray(fallbackRanked) ? fallbackRanked : []
  const resolvedOptions = options && typeof options === 'object' ? options : {}
  const preserveBaseCoverage = Boolean(resolvedOptions.preserveBaseCoverage)
  const referenceRows =
    Array.isArray(resolvedOptions.referenceRows) && resolvedOptions.referenceRows.length > 0
      ? resolvedOptions.referenceRows
      : rows
  const protectedMatchKeys = new Set()
  if (preserveBaseCoverage) {
    referenceRows.forEach((row) => {
      getSubsetMatchKeys(row?.subset || []).forEach((key) => {
        if (key) protectedMatchKeys.add(key)
      })
    })
  }
  const getRowKeys = (row) => getSubsetMatchKeys(row?.subset || [])
  const buildUsageMap = () => {
    const map = new Map()
    rows.forEach((row) => {
      getRowKeys(row).forEach((key) => {
        map.set(key, (map.get(key) || 0) + 1)
      })
    })
    return map
  }
  let usageMap = buildUsageMap()
  const canSwapWithCoverageLock = (replaceIdx, replacement) => {
    if (!preserveBaseCoverage || protectedMatchKeys.size === 0) return true
    if (replaceIdx < 0 || !rows[replaceIdx] || !replacement) return false
    const outgoingKeys = new Set(getRowKeys(rows[replaceIdx]))
    const incomingKeys = new Set(getRowKeys(replacement))
    for (const key of protectedMatchKeys) {
      const current = usageMap.get(key) || 0
      const next =
        current -
        (outgoingKeys.has(key) ? 1 : 0) +
        (incomingKeys.has(key) ? 1 : 0)
      if (next <= 0) return false
    }
    return true
  }

  const isConstraintSatisfied = (constraint) => rows.some((row) => comboSatisfiesDirectedConstraint(row, constraint))
  const supportCountByConstraint = (constraint) =>
    rows.reduce((count, row) => count + (comboSatisfiesDirectedConstraint(row, constraint) ? 1 : 0), 0)

  const chooseReplaceIndex = (targetConstraint, replacement) => {
    const supportMap = new Map(constraints.map((constraint) => [constraint.key, supportCountByConstraint(constraint)]))
    const preferFromKey = String(targetConstraint?.fromKey || '').trim()
    const preferToKey = String(targetConstraint?.toKey || '').trim()
    let bestIdx = -1
    let bestUtility = Number.POSITIVE_INFINITY
    const pick = (predicate) => {
      rows.forEach((row, idx) => {
        if (!predicate(row, idx)) return
        const utility = Number(row.utility)
        const score = Number.isFinite(utility) ? utility : Number.NEGATIVE_INFINITY
        if (score < bestUtility) {
          bestUtility = score
          bestIdx = idx
        }
      })
      return bestIdx
    }
    const isCritical = (row) => {
      const supports = constraints.filter((constraint) => comboSatisfiesDirectedConstraint(row, constraint))
      return supports.some((constraint) => (supportMap.get(constraint.key) || 0) <= 1)
    }

    if (preferFromKey) {
      pick(
        (row, idx) =>
          !isCritical(row) &&
          comboHasConstraintKey(row, preferFromKey) &&
          (!preferToKey || !comboHasConstraintKey(row, preferToKey)) &&
          canSwapWithCoverageLock(idx, replacement),
      )
    }
    if (bestIdx < 0 && preferFromKey) {
      pick(
        (row, idx) =>
          !isCritical(row) &&
          comboHasConstraintKey(row, preferFromKey) &&
          canSwapWithCoverageLock(idx, replacement),
      )
    }
    if (bestIdx < 0) {
      pick((row, idx) => !isCritical(row) && canSwapWithCoverageLock(idx, replacement))
    }
    if (bestIdx < 0 && preferFromKey) {
      pick((row, idx) => comboHasConstraintKey(row, preferFromKey) && canSwapWithCoverageLock(idx, replacement))
    }
    if (bestIdx < 0) {
      pick((_, idx) => canSwapWithCoverageLock(idx, replacement))
    }

    return bestIdx
  }

  for (let guard = 0; guard < constraints.length * 6; guard += 1) {
    const missing = constraints.find((constraint) => !isConstraintSatisfied(constraint))
    if (!missing) break

    const replacementCandidates = candidates
      .filter((row) => {
        if (!comboSatisfiesDirectedConstraint(row, missing)) return false
        const sig = buildSubsetSignature(row.subset)
        return Boolean(sig) && !usedSignatures.has(sig)
      })
      .map((row) => {
        const keySet = new Set(getRowKeys(row))
        let keepScore = 0
        if (protectedMatchKeys.size > 0) {
          protectedMatchKeys.forEach((key) => {
            if (keySet.has(key)) keepScore += 1
          })
        }
        const utility = Number(row.utility)
        const utilScore = Number.isFinite(utility) ? utility : 0
        return { row, score: keepScore * 10 + utilScore }
      })
      .sort((a, b) => b.score - a.score)
    if (replacementCandidates.length === 0) return null

    let replacement = null
    let replaceIdx = -1
    for (const cand of replacementCandidates) {
      if (rows.length < maxRows) {
        replacement = cand.row
        replaceIdx = -1
        break
      }
      const idx = chooseReplaceIndex(missing, cand.row)
      if (idx >= 0) {
        replacement = cand.row
        replaceIdx = idx
        break
      }
    }
    if (!replacement) return null

    if (rows.length < maxRows) {
      rows.push(replacement)
      usedSignatures.add(buildSubsetSignature(replacement.subset))
      usageMap = buildUsageMap()
      continue
    }
    if (replaceIdx < 0) return null

    const nextSig = buildSubsetSignature(replacement.subset)
    const prevSig = buildSubsetSignature(rows[replaceIdx].subset)
    if (!nextSig || nextSig === prevSig) continue
    usedSignatures.delete(prevSig)
    rows[replaceIdx] = replacement
    usedSignatures.add(nextSig)
    usageMap = buildUsageMap()
  }

  if (constraints.some((constraint) => !isConstraintSatisfied(constraint))) return null
  return rows.slice(0, maxRows)
}

const rankWithSoftThresholdPenalty = (rows, minWinRate, maxCorr, minCoverage, alpha, hyperparams = null) => {
  const sp = hyperparams?.softPenaltyScales || { winGapBase: 0.85, winGapAlpha: 0.45, corrGapBase: 0.72, corrGapAlpha: 0.28, coverageGapBase: 0.9, coverageGapAlpha: 0.35 }
  const winGapScale = sp.winGapBase + (1 - alpha) * sp.winGapAlpha
  const corrGapScale = sp.corrGapBase + (1 - alpha) * sp.corrGapAlpha
  const coverageGapScale = sp.coverageGapBase + (1 - alpha) * sp.coverageGapAlpha
  return [...rows]
    .map((item) => {
      const winGap = Math.max(0, minWinRate - item.p)
      const corrGap = Math.max(0, item.corr - maxCorr)
      const coverageGap = Math.max(0, minCoverage - (item.coverageRate || 0))
      const thresholdPenalty =
        winGap * winGapScale +
        corrGap * corrGapScale +
        coverageGap * coverageGapScale
      return {
        ...item,
        thresholdPenalty,
        softUtility: item.utility - thresholdPenalty,
      }
    })
    .sort((a, b) => b.softUtility - a.softUtility || b.utility - a.utility || b.sharpe - a.sharpe)
}

const ensureCoverageInRanked = (baseRanked, fallbackRanked, selectedMatches, maxRows = 14) => {
  const targetKeys = new Set(selectedMatches.map((match) => buildMatchRefKey(match)))
  if (targetKeys.size === 0) {
    return {
      ranked: baseRanked.slice(0, maxRows),
      uncoveredCount: 0,
    }
  }

  const ranked = []
  const usedSignatures = new Set()
  const coveredKeys = new Set()
  const seedQuota = Math.min(8, maxRows)

  const tryPush = (item, injected = false) => {
    if (!item || ranked.length >= maxRows) return false
    const sig = buildSubsetSignature(item.subset)
    if (!sig || usedSignatures.has(sig)) return false
    usedSignatures.add(sig)
    const nextItem = {
      ...item,
      coverageInjected: Boolean(item.coverageInjected || injected),
    }
    ranked.push(nextItem)
    nextItem.subset.forEach((match) => {
      coveredKeys.add(buildMatchRefKey(match))
    })
    return true
  }

  baseRanked.slice(0, seedQuota).forEach((item) => {
    tryPush(item)
  })

  const getUncoveredKeys = () => [...targetKeys].filter((key) => !coveredKeys.has(key))
  getUncoveredKeys().forEach((matchKey) => {
    const supplemental = fallbackRanked.find((row) => row.subset.some((match) => buildMatchRefKey(match) === matchKey))
    tryPush(supplemental, true)
  })

  baseRanked.forEach((item) => {
    tryPush(item)
  })
  fallbackRanked.forEach((item) => {
    tryPush(item)
  })

  return {
    ranked: ranked.slice(0, maxRows),
    uncoveredCount: getUncoveredKeys().length,
  }
}

const rebalanceMatchConcentration = (baseRanked, fallbackRanked, maxRows = 10, maxShare = 0.78) => {
  const seed = Array.isArray(baseRanked) ? baseRanked.slice(0, maxRows) : []
  if (seed.length <= 1) return seed

  const maxAllowed = Math.max(2, Math.ceil(seed.length * maxShare))
  const fallback = Array.isArray(fallbackRanked) ? fallbackRanked : []
  const ranked = [...seed]
  const usedSignatures = new Set(ranked.map((row) => buildSubsetSignature(row.subset)).filter(Boolean))

  const buildMatchUsageMap = (rows) => {
    const usage = new Map()
    rows.forEach((row) => {
      getSubsetMatchKeys(row.subset).forEach((mk) => {
        usage.set(mk, (usage.get(mk) || 0) + 1)
      })
    })
    return usage
  }

  let usageMap = buildMatchUsageMap(ranked)

  for (let guard = 0; guard < 40; guard += 1) {
    const offenders = [...usageMap.entries()]
      .filter(([, count]) => count > maxAllowed)
      .sort((a, b) => b[1] - a[1])
    if (offenders.length === 0) break

    const [offenderKey, offenderCount] = offenders[0]
    let replaceIdx = -1
    for (let i = ranked.length - 1; i >= 0; i -= 1) {
      const row = ranked[i]
      const keys = getSubsetMatchKeys(row.subset)
      if (!keys.includes(offenderKey)) continue
      replaceIdx = i
      if (!row.coverageInjected) break
    }
    if (replaceIdx < 0) break

    const rowToReplace = ranked[replaceIdx]
    const rowSig = buildSubsetSignature(rowToReplace.subset)
    const rowKeys = new Set(getSubsetMatchKeys(rowToReplace.subset))
    let replacement = null
    for (const cand of fallback) {
      const candSig = buildSubsetSignature(cand.subset)
      if (!candSig || usedSignatures.has(candSig)) continue
      const candKeys = new Set(getSubsetMatchKeys(cand.subset))
      if (candKeys.has(offenderKey)) continue

      let projectedOffender = offenderCount
      if (rowKeys.has(offenderKey)) projectedOffender -= 1
      if (candKeys.has(offenderKey)) projectedOffender += 1
      if (projectedOffender >= offenderCount) continue

      replacement = cand
      break
    }
    if (!replacement) break

    ranked[replaceIdx] = {
      ...replacement,
      concentrationRebalanced: true,
    }
    if (rowSig) usedSignatures.delete(rowSig)
    const replacementSig = buildSubsetSignature(replacement.subset)
    if (replacementSig) usedSignatures.add(replacementSig)
    usageMap = buildMatchUsageMap(ranked)
  }

  return ranked
}

const calcSubsetSourceCorrelation = (subset) => {
  const size = subset.length
  if (size <= 1) return 0
  const sourceMap = new Map()
  subset.forEach((item) => {
    sourceMap.set(item.investmentId, (sourceMap.get(item.investmentId) || 0) + 1)
  })
  const hhi = [...sourceMap.values()].reduce((sum, count) => {
    const share = count / size
    return sum + share * share
  }, 0)
  const baseline = 1 / size
  return clamp((hhi - baseline) / (1 - baseline), 0, 1)
}

const calcSubsetPairCorrelation = (leftSubset, rightSubset, hyperparams = null) => {
  if (!Array.isArray(leftSubset) || !Array.isArray(rightSubset) || leftSubset.length === 0 || rightSubset.length === 0) {
    return 0
  }

  const toKeySet = (subset) => new Set(subset.map((item) => `${item.investmentId}-${item.matchIndex}`))
  const leftKeys = toKeySet(leftSubset)
  const rightKeys = toKeySet(rightSubset)
  let overlap = 0
  leftKeys.forEach((key) => {
    if (rightKeys.has(key)) overlap += 1
  })
  const minSize = Math.max(1, Math.min(leftKeys.size, rightKeys.size))
  const unionSize = new Set([...leftKeys, ...rightKeys]).size
  const overlapRatio = overlap / minSize
  const jaccard = unionSize > 0 ? overlap / unionSize : 0
  const cf = hyperparams?.correlationFormula || { base: 0.1, overlapWeight: 0.58, jaccardWeight: 0.24 }
  return clamp(cf.base + overlapRatio * cf.overlapWeight + jaccard * cf.jaccardWeight, 0, 0.96)
}

const buildCovarianceMatrix = (items, hyperparams = null) => {
  const n = items.length
  const matrix = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i += 1) {
    const varI = Math.max(0.0001, Number(items[i].variance || 0))
    matrix[i][i] = varI
    for (let j = i + 1; j < n; j += 1) {
      const varJ = Math.max(0.0001, Number(items[j].variance || 0))
      const corr = calcSubsetPairCorrelation(items[i].subset, items[j].subset, hyperparams)
      const cov = corr * Math.sqrt(varI * varJ)
      matrix[i][j] = cov
      matrix[j][i] = cov
    }
  }
  return matrix
}

const projectCappedSimplex = (weights, maxWeight) => {
  if (!Array.isArray(weights) || weights.length === 0) return []
  const cap = clamp(maxWeight, 0.08, 1)
  const n = weights.length
  let next = weights.map((value) => clamp(Number(value || 0), 0, cap))

  for (let guard = 0; guard < 64; guard += 1) {
    const sum = next.reduce((acc, value) => acc + value, 0)
    const diff = 1 - sum
    if (Math.abs(diff) < 1e-6) break

    if (diff > 0) {
      const free = next
        .map((value, index) => ({ value, index }))
        .filter((row) => row.value < cap - 1e-9)
      if (free.length === 0) break
      let remain = diff
      free.forEach((row, idx) => {
        if (remain <= 1e-9) return
        const room = cap - next[row.index]
        const grant = Math.min(room, remain / Math.max(1, free.length - idx))
        next[row.index] += grant
        remain -= grant
      })
    } else {
      const free = next
        .map((value, index) => ({ value, index }))
        .filter((row) => row.value > 1e-9)
      if (free.length === 0) break
      let remain = -diff
      free.forEach((row, idx) => {
        if (remain <= 1e-9) return
        const cut = Math.min(next[row.index], remain / Math.max(1, free.length - idx))
        next[row.index] -= cut
        remain -= cut
      })
    }
  }

  const finalSum = next.reduce((acc, value) => acc + value, 0)
  if (finalSum <= 1e-9) {
    const equal = 1 / n
    return Array(n).fill(equal)
  }
  next = next.map((value) => value / finalSum)
  return next.map((value) => clamp(value, 0, cap))
}

const optimizePortfolioWeights = (items, alpha, maxWeight, hyperparams = null) => {
  const n = items.length
  if (n === 0) return []
  if (n === 1) return [1]

  const mu = items.map((item) => Number(item.ev || 0))
  const covariance = buildCovarianceMatrix(items, hyperparams)
  const riskWeight = 1 - alpha
  const po = hyperparams?.portfolioOptimizer || { diversPenaltyBase: 0.03, diversPenaltyRiskScale: 0.16, learningRate: 0.16, iterations: 180 }
  const diversificationPenalty = clamp(riskWeight * po.diversPenaltyRiskScale + po.diversPenaltyBase, 0.01, 0.3)
  const learningRate = po.learningRate
  let weights = projectCappedSimplex(Array(n).fill(1 / n), maxWeight)

  // FIX: Learning rate decay prevents oscillation near optimum.
  // Cosine annealing: lr starts at full value, decays smoothly to ~10% at final iteration.
  for (let iter = 0; iter < po.iterations; iter += 1) {
    const decayedLr = learningRate * (0.1 + 0.9 * (1 + Math.cos(Math.PI * iter / po.iterations)) / 2)
    const gradient = weights.map((_, i) => {
      let covTerm = 0
      for (let j = 0; j < n; j += 1) {
        covTerm += covariance[i][j] * weights[j]
      }
      const expectedTerm = alpha * mu[i]
      const riskTerm = 2 * riskWeight * covTerm
      const concentrationTerm = 2 * diversificationPenalty * weights[i]
      return expectedTerm - riskTerm - concentrationTerm
    })
    weights = projectCappedSimplex(
      weights.map((value, i) => value + decayedLr * gradient[i]),
      maxWeight,
    )
  }

  return weights
}

const selectRankedByGlobalJointOptimization = (
  weightedUniverse,
  maxRows = 10,
  selectedMatchKeyCount = 1,
  minWinRate = 0,
  maxCorr = 1,
  overlapTuning = null,
  hyperparams = null,
) => {
  if (!Array.isArray(weightedUniverse) || weightedUniverse.length === 0) return []
  const pool = dedupeRankedBySignature(
    [...weightedUniverse].sort((a, b) => b.weight - a.weight || b.utility - a.utility),
  ).slice(0, 18)
  const n = pool.length
  const maxPick = Math.min(maxRows, n)
  if (maxPick <= 1) return pool.slice(0, maxPick)

  const heuristicPickCount = pool.filter((item, idx) => item.weight >= 0.045 || idx < maxRows).length
  const baselinePick = Math.max(
    1,
    Math.min(
      maxPick,
      Math.round(
        heuristicPickCount > 0
          ? heuristicPickCount
          : Math.max(3, n * 0.72),
      ),
    ),
  )
  const minPick = Math.max(1, Math.min(maxPick, Math.max(2, baselinePick - 2)))

  const utilValues = pool.map((item) => Number(item.utility) || 0)
  const weightValues = pool.map((item) => Number(item.weight) || 0)
  const uMin = Math.min(...utilValues)
  const uMax = Math.max(...utilValues)
  const wMin = Math.min(...weightValues)
  const wMax = Math.max(...weightValues)
  const uRange = uMax - uMin || 1
  const wRange = wMax - wMin || 1

  const qualityByIdx = pool.map((item, idx) => {
    const normUtil = (utilValues[idx] - uMin) / uRange
    const normWeight = (weightValues[idx] - wMin) / wRange
    return 0.68 * normUtil + 0.32 * normWeight
  })
  const matchKeysByIdx = pool.map((item) => getSubsetMatchKeys(item.subset))
  const pairOverlap = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const overlap = calcContinuousSubsetOverlap(pool[i].subset, pool[j].subset, overlapTuning)
      pairOverlap[i][j] = overlap
      pairOverlap[j][i] = overlap
    }
  }

  const jw = {
    quality: 0.52,
    coverage: 0.22,
    diversity: 0.2,
    concentrationPenalty: 0.08,
    thresholdPenalty: 0.24,
    ...(hyperparams?.globalJointWeights || {}),
  }
  const chosen = []
  const best = {
    score: Number.NEGATIVE_INFINITY,
    coverage: Number.NEGATIVE_INFINITY,
    quality: Number.NEGATIVE_INFINITY,
    indices: null,
  }

  const evaluateChosen = () => {
    if (chosen.length === 0) return
    let qualitySum = 0
    let pSum = 0
    let corrSum = 0
    const keyUse = new Map()
    let totalKeyUses = 0
    chosen.forEach((idx) => {
      qualitySum += qualityByIdx[idx]
      pSum += Number(pool[idx].p || 0)
      corrSum += Number(pool[idx].corr || 0)
      matchKeysByIdx[idx].forEach((mk) => {
        keyUse.set(mk, (keyUse.get(mk) || 0) + 1)
        totalKeyUses += 1
      })
    })

    const quality = qualitySum / chosen.length
    const avgP = pSum / chosen.length
    const avgCorr = corrSum / chosen.length
    const coverage = keyUse.size / Math.max(1, selectedMatchKeyCount)

    let pairSum = 0
    let pairCount = 0
    for (let i = 0; i < chosen.length; i += 1) {
      for (let j = i + 1; j < chosen.length; j += 1) {
        pairSum += pairOverlap[chosen[i]][chosen[j]]
        pairCount += 1
      }
    }
    const overlapAvg = pairCount > 0 ? pairSum / pairCount : 0
    const diversity = clamp(1 - overlapAvg, 0, 1)

    const maxUse = keyUse.size > 0 ? Math.max(...keyUse.values()) : 0
    const maxShare = chosen.length > 0 ? maxUse / chosen.length : 0
    let hhi = 0
    if (totalKeyUses > 0) {
      keyUse.forEach((count) => {
        const share = count / totalKeyUses
        hhi += share * share
      })
    }
    const keySize = Math.max(1, keyUse.size)
    const baseline = 1 / keySize
    const hhiNorm = keySize > 1 ? clamp((hhi - baseline) / (1 - baseline), 0, 1) : hhi
    const concentrationPenalty = clamp(0.65 * maxShare + 0.35 * hhiNorm, 0, 1.5)

    const winGap = Math.max(0, minWinRate - avgP)
    const corrGap = Math.max(0, avgCorr - maxCorr)
    const thresholdPenalty = winGap * 1.2 + corrGap

    const score =
      quality * jw.quality +
      coverage * jw.coverage +
      diversity * jw.diversity -
      concentrationPenalty * jw.concentrationPenalty -
      thresholdPenalty * jw.thresholdPenalty

    const better =
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 && (
        coverage > best.coverage + 1e-9 ||
        (Math.abs(coverage - best.coverage) <= 1e-9 && quality > best.quality + 1e-9)
      ))
    if (better) {
      best.score = score
      best.coverage = coverage
      best.quality = quality
      best.indices = [...chosen]
    }
  }

  const dfs = (start, need) => {
    if (need === 0) {
      evaluateChosen()
      return
    }
    for (let i = start; i <= n - need; i += 1) {
      chosen.push(i)
      dfs(i + 1, need - 1)
      chosen.pop()
    }
  }

  for (let k = minPick; k <= maxPick; k += 1) {
    dfs(0, k)
  }

  if (!best.indices || best.indices.length === 0) {
    return pool.slice(0, maxPick)
  }

  return best.indices
    .map((idx) => pool[idx])
    .sort((a, b) => b.weight - a.weight || b.utility - a.utility)
}

const generateRecommendations = (
  selectedMatches,
  riskPref,
  riskCap,
  systemConfig,
  calibrationContext,
  qualityFilter,
  comboStrategy = DEFAULT_COMBO_STRATEGY,
  comboStructure = null,
  rolePreference = null,
  teamBias = null, // Map<teamName, number> — positive = boost, negative = penalize
  comboRetrospective = null, // FIX #9: Combo-level retrospective learning signals
  allocationMode = DEFAULT_ALLOCATION_MODE,
  solverMode = DEFAULT_SOLVER_MODE,
  decouplingPairs = null, // Set<"rowKey|colKey"> — directed hard guarantee: when row fails, col must still survive elsewhere
) => {
  if (selectedMatches.length === 0) return null
  const recommendationCount = RECOMMENDATION_OUTPUT_COUNT
  const stratifiedCap = Math.max(18, recommendationCount + 6)
  const mmrCap = Math.max(14, recommendationCount + 4)
  const universeCap = Math.max(14, recommendationCount + 2)

  const alpha = clamp(riskPref / 100, 0, 1)
  const minWinRate = clamp(Number(qualityFilter?.minWinRate || 0) / 100, 0, 1)
  const maxCorr = clamp(Number(qualityFilter?.maxCorr ?? 1), 0, 1)
  const minCoverageEnabled = qualityFilter?.minCoverageEnabled !== false
  const minCoverage = minCoverageEnabled
    ? clamp(Number(qualityFilter?.minCoveragePercent ?? DEFAULT_QUALITY_FILTER.minCoveragePercent) / 100, 0, 1)
    : 0
  const selectedMatchKeyCount = Math.max(1, new Set(selectedMatches.map((match) => buildMatchRefKey(match))).size)

  const normalizedComboStructure = sanitizeComboStructure(comboStructure)
  const normalizedAllocationMode = normalizeAllocationMode(allocationMode)
  const normalizedSolverMode = normalizeSolverMode(solverMode)
  const allocationUnit = normalizedAllocationMode === 'precision' ? 1 : 10
  // ── 思路4: Minimum legs floor ──
  const minLegs = normalizedComboStructure.minLegs
  // ── 思路2: Parlay bonus strength ──
  const parlayBeta = normalizedComboStructure.parlayBeta
  // ── MMR lambda (diversity vs utility tradeoff) ──
  const mmrLambda = normalizedComboStructure.mmrLambda
  // ── Coverage dynamic boost eta ──
  const coverageEta = normalizedComboStructure.coverageEta
  const normalizedRolePreference = sanitizeRolePreference(rolePreference)
  const roleMixStrength = normalizedRolePreference.mixStrength
  const roleTargets = normalizedRolePreference.targets

  // ── Dynamic parameter optimization: backtest historical data ──
  const dynParams = backtestDynamicParams(calibrationContext)
  // ── Comprehensive combo hyperparameter calibration ──
  const hp = calibrationContext?.comboHyperparams || null
  const overlapTuning = resolveOverlapTuning(qualityFilter, hp)

  // ── FIX #9: Apply combo-level retrospective learning signals ──
  const retro = comboRetrospective?.ready ? comboRetrospective : null
  if (retro) {
    // Adjust tier anchor bonus based on historical anchor success rate
    dynParams.tierAnchorBonus = clamp(dynParams.tierAnchorBonus + (retro.anchorBonusAdj || 0), 0.01, 0.25)
    // Adjust covering bonus based on covering layer hit rate vs global average
    const coverHitRate = retro.layerHitRates?.covering
    if (coverHitRate != null && retro.globalComboHitRate > 0) {
      const coverLift = clamp(coverHitRate - retro.globalComboHitRate, -0.15, 0.15)
      dynParams.coveringBonus = clamp(dynParams.coveringBonus + coverLift * retro.reliability * 0.08, 0.0, 0.2)
    }
  }

  // ── FIX #3: Apply walk-forward feedback adjustments to tier thresholds ──
  // FIX: key names must match classifyConfidenceTier expectations (tier1, tier2, tier3 — no underscores)
  const wfFeedback = calibrationContext?.walkForwardFeedback
  const tierShift = wfFeedback?.ready ? (wfFeedback.adjustments?.tierShift || 0) : 0
  const dynThresholds = tierShift !== 0
    ? {
        tier1: clamp((dynParams.confTierThresholds?.tier1 || 0.72) + tierShift, 0.60, 0.85),
        tier2: clamp((dynParams.confTierThresholds?.tier2 || 0.55) + tierShift, 0.42, 0.70),
        tier3: clamp((dynParams.confTierThresholds?.tier3 || 0.40) + tierShift, 0.28, 0.55),
      }
    : dynParams.confTierThresholds

  const maxSubsetSize = Math.min(5, selectedMatches.length)
  const subsets = buildSubsets(selectedMatches, maxSubsetSize)

  // ── 方案A+C+D+E: Generate fault-tolerant covering combos ──
  const ftResult = generateFaultTolerantCombos(selectedMatches, systemConfig, calibrationContext, dynParams)
  const ftSubsets = ftResult.combos.map((c) => c.subset)
  const ftLayerTagMap = new Map()
  ftResult.combos.forEach((c) => {
    const sig = c.subset.map((m) => m.key).sort().join('|')
    ftLayerTagMap.set(sig, c.layerTag)
  })

  // Merge: add fault-tolerant combos that aren't already in the power-set
  const existingSigs = new Set(subsets.map((s) => s.map((m) => m.key).sort().join('|')))
  const mergedSubsets = [...subsets]
  ftSubsets.forEach((fts) => {
    const sig = fts.map((m) => m.key).sort().join('|')
    if (!existingSigs.has(sig)) {
      mergedSubsets.push(fts)
      existingSigs.add(sig)
    }
  })

  const scoredAll = mergedSubsets.map((subset) => {
    const legs = subset.length
    // Annotate each leg with calibrated probability + conf surplus for downstream MC simulation
    const annotatedSubset = subset.map((item) => {
      if (item.calibratedP !== undefined && item.confSurplus !== undefined) return item
      const cp = item.calibratedP !== undefined ? item.calibratedP : calcAdjustedProbability(item, systemConfig, calibrationContext)
      const cs = item.confSurplus !== undefined ? item.confSurplus : calcConfSurplus(item, cp, hp)
      return { ...item, calibratedP: cp, confSurplus: cs }
    })
    const adjustedProfiles = annotatedSubset.map((item) => {
      if (item.atomicProfile) return item.atomicProfile
      const fallbackOdds = Math.max(1.01, Number(item.odds) || 2.5)
      return buildAtomicLegProfile(item, item.calibratedP, fallbackOdds)
    })
    const rawProfiles = annotatedSubset.map((item) => {
      if (item.rawAtomicProfile) return item.rawAtomicProfile
      const fallbackOdds = Math.max(1.01, Number(item.odds) || 2.5)
      const unionProbability = clamp(Number(item.conf) || 0.5, 0.05, 0.95)
      return buildAtomicLegProfile(item, unionProbability, fallbackOdds)
    })
    const adjustedCombo = combineAtomicMatchProfiles(adjustedProfiles)
    const rawCombo = combineAtomicMatchProfiles(rawProfiles)
    let p = clamp(Number(adjustedCombo.hitProbability || 0), 0, 1)
    let profitWinProbability = clamp(Number(adjustedCombo.profitWinProbability || 0), 0, 1)
    const rawP = clamp(Number(rawCombo.hitProbability || 0), 0, 1)

    // ── FIX #4: Entry correlation adjustment (multiplicative, not additive) ──
    // Correct the independence assumption using pairwise correlation data.
    // Use multiplicative correction: p *= (1 + avgCorr) so same phi coefficient
    // produces proportional impact regardless of base probability level.
    const corrMatrix = calibrationContext?.entryCorrelation
    if (corrMatrix?.ready && legs >= 2) {
      let corrShift = 0
      let pairCount = 0
      for (let i = 0; i < annotatedSubset.length; i++) {
        for (let j = i + 1; j < annotatedSubset.length; j++) {
          const entryA = annotatedSubset[i].entryMarketType || annotatedSubset[i].entry_market_type || 'other'
          const entryB = annotatedSubset[j].entryMarketType || annotatedSubset[j].entry_market_type || 'other'
          const corr = corrMatrix.getCorrelation(entryA, entryB)
          if (corr.reliability > 0.2) {
            // Positive correlation → joint prob > product (independence underestimates)
            // Negative correlation → joint prob < product (independence overestimates)
            const corrScale = hp?.entryCorrelationScale ?? 0.04
            corrShift += corr.rho * corr.reliability * corrScale
            pairCount += 1
          }
        }
      }
      if (pairCount > 0) {
        const avgCorrAdj = corrShift / pairCount
        // Multiplicative correction: proportional impact at all probability levels
        const multiplier = 1 + clamp(avgCorrAdj / Math.max(p, 0.01), -0.25, 0.25)
        p = clamp(p * multiplier, 0.02, 0.98)
        profitWinProbability = clamp(profitWinProbability * multiplier, 0.02, 0.98)
      }
    }

    const fallbackOdds = annotatedSubset.reduce((prod, item) => prod * Math.max(1.01, Number(item.odds) || 1.01), 1)
    const odds = Math.max(1.01, Number(adjustedCombo.equivalentOdds || fallbackOdds))
    const ev = Number(adjustedCombo.expectedReturn || 0)
    const variance = Math.max(0, Number(adjustedCombo.variance || 0))
    const sigma = Math.sqrt(Math.max(variance, 0.0001))
    const sharpe = ev / sigma
    const rewardTerm = alpha * ev
    const riskPenalty = (1 - alpha) * sigma
    const pBonus = parlayBonusFn(legs, parlayBeta)
    const familyDiv = calcEntryFamilyDiversity(annotatedSubset)
    const fbBaseline = hp?.familyBonusBaseline ?? 0.5
    const fbScale = hp?.familyBonusScale ?? 0.04
    const familyBonus = (familyDiv - fbBaseline) * fbScale
    const roleSignal = calcRoleStructureSignal(annotatedSubset, roleTargets, roleMixStrength, hp)

    // ── 方案D: Confidence tier scoring with dynamic params ──
    const confTiers = annotatedSubset.map((item) => classifyConfidenceTier(item.conf, dynThresholds))
    const weakCount = confTiers.filter((t) => t === 'tier_3' || t === 'tier_4').length
    const tier1Count = confTiers.filter((t) => t === 'tier_1').length
    const tier3Count = confTiers.filter((t) => t === 'tier_3').length
    const tier4Count = confTiers.filter((t) => t === 'tier_4').length
    // Hard constraint: cap weak legs per combo (dynamic from backtest)
    const exceedsWeakCap = weakCount > dynParams.maxWeakLegsPerCombo
    // Dynamic penalty for excess weak legs
    const tierPenalty = weakCount >= 2
      ? dynParams.tierPenaltyPerWeakLeg * (weakCount - 1) + (tier4Count >= 2 ? 0.15 : 0)
      : 0
    // Dynamic anchor bonus
    const tierAnchorBonus = tier1Count >= 1 ? dynParams.tierAnchorBonus * Math.min(tier1Count, 3) : 0

    // ── Layer tag from fault-tolerant generation ──
    const subsetSig = annotatedSubset.map((m) => m.key).sort().join('|')
    const ftLayerTag = ftLayerTagMap.get(subsetSig) || null
    const coveringBonus = ftLayerTag === 'covering' ? dynParams.coveringBonus : 0

    // Hard penalty for combos that violate tier constraints — dynamic from backtest
    const hcPenaltyMag = hp?.hardConstraintPenalty ?? 0.5
    const hardConstraintPenalty = exceedsWeakCap ? hcPenaltyMag : 0

    // Team bias modifier (deep refresh)
    let teamBiasBonus = 0
    if (teamBias && teamBias.size > 0) {
      annotatedSubset.forEach((m) => {
        const home = m.homeTeam || ''
        const away = m.awayTeam || ''
        if (teamBias.has(home)) teamBiasBonus += teamBias.get(home)
        if (teamBias.has(away)) teamBiasBonus += teamBias.get(away)
      })
    }

    // ── Conf-Surplus Bonus: reward combos that capture counter-consensus edges ──
    // A combo containing a leg where conf significantly exceeds market-implied prob
    // is capturing arbitrage value that the market is mispricing.
    const surplusValues = annotatedSubset.map((item) => item.confSurplus?.surplus || 0)
    const avgSurplus = surplusValues.reduce((s, v) => s + v, 0) / Math.max(legs, 1)
    const maxSurplus = Math.max(...surplusValues)
    // Bonus scales with average surplus across legs, extra boost if any leg has strong edge
    // FIX #9: Retrospective surplus adjustment — if high-surplus combos were missed and actually hit, boost scale
    const sbScale = (hp?.surplusBonusScale ?? 0.15) + (retro?.surplusBonusAdj || 0)
    const sbMaxThreshold = hp?.surplusBonusMaxThreshold ?? 0.12
    const sbMaxBonus = hp?.surplusBonusMaxBonus ?? 0.03
    const confSurplusBonus = clamp(avgSurplus * sbScale, -0.08, 0.12) + (maxSurplus >= sbMaxThreshold ? sbMaxBonus : 0)

    const utility = rewardTerm - riskPenalty + pBonus + familyBonus + roleSignal.bonus
      - tierPenalty + tierAnchorBonus + coveringBonus - hardConstraintPenalty + teamBiasBonus
      + confSurplusBonus
    const corr = calcSubsetSourceCorrelation(annotatedSubset)
    const confAvg = annotatedSubset.reduce((sum, item) => sum + clamp(item.conf, 0.05, 0.95), 0) / Math.max(legs, 1)
    const subsetMatchKeyCount = new Set(annotatedSubset.map((match) => buildMatchRefKey(match))).size
    const coverageRate = clamp(subsetMatchKeyCount / selectedMatchKeyCount, 0, 1)
    return {
      subset: annotatedSubset,
      legs,
      p,
      profitWinProbability,
      hitProbability: p,
      rawP,
      odds,
      ev,
      variance,
      sigma,
      sharpe,
      utility,
      rewardTerm,
      riskPenalty,
      parlayBonus: pBonus,
      familyDiversity: familyDiv,
      roleMixBonus: roleSignal.bonus,
      roleSignature: roleSignal.signature,
      roleAlignmentGap: roleSignal.alignmentGap,
      roleDiversity: roleSignal.diversity,
      corr,
      confAvg,
      coverageRate,
      // New fields for tier and fault-tolerance
      confTiers,
      tier3Count,
      tier1Count,
      tierPenalty,
      tierAnchorBonus,
      ftLayerTag,
      coveringBonus,
      confSurplusBonus,
      avgSurplus,
      maxSurplus,
    }
  })

  // ── Pre-filter: apply minLegs (思路4) ──
  const scoredBase = scoredAll
  const legsFiltered = scoredBase.filter((item) => item.legs >= minLegs)
  const pool = legsFiltered.length > 0 ? legsFiltered : scoredBase // graceful fallback
  const coverageEligiblePool = minCoverageEnabled
    ? pool.filter((item) => (item.coverageRate || 0) >= minCoverage)
    : pool
  if (coverageEligiblePool.length === 0) return null

  const rankedAllByUtility = dedupeRankedBySignature([...coverageEligiblePool].sort((a, b) => b.utility - a.utility || b.sharpe - a.sharpe))
  const qualifiedRaw = coverageEligiblePool.filter(
    (item) =>
      item.p >= minWinRate &&
      item.corr <= maxCorr &&
      (item.coverageRate || 0) >= minCoverage,
  )
  const rankedQualified = dedupeRankedBySignature([...qualifiedRaw].sort((a, b) => b.utility - a.utility || b.sharpe - a.sharpe))
  const rankedSoftPenalty = dedupeRankedBySignature(
    rankWithSoftThresholdPenalty(rankedAllByUtility, minWinRate, maxCorr, minCoverage, alpha, hp),
  )

  let preparedRanked = []
  if (comboStrategy === 'thresholdStrict') {
    preparedRanked = rankedQualified
  } else if (comboStrategy === 'softPenalty') {
    preparedRanked = rankedSoftPenalty
  } else {
    preparedRanked = rankedQualified.length > 0 ? rankedQualified : rankedAllByUtility
  }

  if (preparedRanked.length === 0) {
    if (comboStrategy === 'thresholdStrict') return null
    preparedRanked = rankedAllByUtility
  }
  if (preparedRanked.length === 0) return null

  // ── 思路5: Coverage dynamic boost (replaces old hard injection for first pass) ──
  const targetKeys = new Set(selectedMatches.map((m) => buildMatchRefKey(m)))
  if (comboStrategy !== 'thresholdStrict') {
    preparedRanked = applyCoverageDynamicBoost(preparedRanked, selectedMatches, hp?.coverageDecayBase ?? 0.6, hp)
    preparedRanked.sort((a, b) => b.boostedUtility - a.boostedUtility || b.utility - a.utility)
  }

  // ── 思路3: Stratified selection by legs count ──
  // FIX #9: Apply retrospective legs-distribution learning to stratified quotas
  const effectiveHp = hp ? { ...hp } : null
  if (effectiveHp && retro?.stratifiedQuotaAdj && Object.keys(retro.stratifiedQuotaAdj).length > 0) {
    const base = effectiveHp.stratifiedQuotas || { 1: 0.0, 2: 0.2, 3: 0.35, 4: 0.3, 5: 0.15 }
    const adjusted = { ...base }
    for (const [legs, delta] of Object.entries(retro.stratifiedQuotaAdj)) {
      adjusted[legs] = clamp((adjusted[legs] || 0.1) + delta, 0, 0.6)
    }
    effectiveHp.stratifiedQuotas = adjusted
  }
  const stratifiedPool = stratifiedSelect(preparedRanked, stratifiedCap, minLegs, effectiveHp)

  // ── MMR reranking for final diversity ──
  const mmrPool = mmrRerank(
    stratifiedPool,
    mmrLambda,
    mmrCap,
    comboStrategy !== 'thresholdStrict' ? targetKeys : null,
    coverageEta,
    hp,
    overlapTuning,
  )

  const maxUniverse = Math.min(universeCap, mmrPool.length)
  const universe = mmrPool.slice(0, maxUniverse)
  const maxWeight = clamp(0.32 + alpha * 0.45, 0.32, 0.78)
  const weights = optimizePortfolioWeights(universe, alpha, maxWeight, hp)

  const weightedUniverse = universe.map((item, idx) => ({
    ...item,
    weight: Number.isFinite(weights[idx]) ? weights[idx] : 0,
  }))
  let selectedRanked =
    normalizedSolverMode === 'globalJoint'
      ? selectRankedByGlobalJointOptimization(
        weightedUniverse,
        recommendationCount,
        selectedMatchKeyCount,
        minWinRate,
        maxCorr,
        overlapTuning,
        hp,
      )
      : weightedUniverse
        .filter((item, idx) => item.weight >= 0.045 || idx < recommendationCount)
        .sort((a, b) => b.weight - a.weight || b.utility - a.utility)
        .slice(0, recommendationCount)

  // Legacy coverage injection as final safety net (lightweight, only fills gaps)
  if (comboStrategy !== 'thresholdStrict') {
    selectedRanked = ensureCoverageInRanked(selectedRanked, weightedUniverse, selectedMatches, recommendationCount).ranked
  }
  const concentrationPool = dedupeRankedBySignature(
    [...weightedUniverse].sort((a, b) => b.weight - a.weight || b.utility - a.utility),
  )
  // Max concentration: no single match may appear in more than 60% of combos
  // This prevents the single-point-of-failure scenario (e.g., 切尔西 miss kills ALL combos)
  selectedRanked = rebalanceMatchConcentration(selectedRanked, concentrationPool, recommendationCount, hp?.matchConcentrationCap ?? 0.60)

  // ── Directed hard guarantee (A→B): if A fails, B must have at least one surviving line ──
  // NOTE: This is directional. A→B does NOT imply B→A.
  const directedDecouplingConstraints = parseDirectedDecouplingConstraints(decouplingPairs)
  if (directedDecouplingConstraints.length > 0) {
    const constrainedRanked = enforceDirectedDecouplingHard(
      selectedRanked,
      concentrationPool,
      directedDecouplingConstraints,
      recommendationCount,
    )
    if (!constrainedRanked || constrainedRanked.length === 0) return null
    selectedRanked = constrainedRanked
  }

  const fallbackRanked = selectedRanked.length > 0 ? selectedRanked : weightedUniverse.slice(0, Math.min(3, weightedUniverse.length))
  const baseWeights = fallbackRanked.map((item) => Math.max(0, Number(item.weight) || 0))
  const utilityValues = fallbackRanked.map((item) => Number(item.utility) || 0)
  const evValues = fallbackRanked.map((item) => Number(item.ev) || 0)
  const baseMin = baseWeights.length > 0 ? Math.min(...baseWeights) : 0
  const baseMax = baseWeights.length > 0 ? Math.max(...baseWeights) : 0
  const baseSpread = baseMax - baseMin
  const utilMin = utilityValues.length > 0 ? Math.min(...utilityValues) : 0
  const utilMax = utilityValues.length > 0 ? Math.max(...utilityValues) : 0
  const utilRange = utilMax - utilMin
  const evMin = evValues.length > 0 ? Math.min(...evValues) : 0
  const evMax = evValues.length > 0 ? Math.max(...evValues) : 0
  const evRange = evMax - evMin
  const utilityBlend = baseSpread <= 0.012 ? 0.055 : 0.018
  const evBlend = baseSpread <= 0.012 ? 0.028 : 0.010
  const allocationSeed = fallbackRanked.map((item, idx) => {
    const base = baseWeights[idx]
    const injectedBoost = item.coverageInjected && comboStrategy !== 'thresholdStrict' ? 0.05 : 0
    const utilNorm = utilRange > 1e-9 ? (utilityValues[idx] - utilMin) / utilRange : 0.5
    const evNorm = evRange > 1e-9 ? (evValues[idx] - evMin) / evRange : 0.5
    return base + injectedBoost + utilityBlend * utilNorm + evBlend * evNorm
  })
  const weightSum = allocationSeed.reduce((sum, value) => sum + value, 0)
  const normalizedWeights = weightSum > 0
    ? allocationSeed.map((value) => value / weightSum)
    : allocationSeed.map((_, idx) => (fallbackRanked.length - idx) / (fallbackRanked.length * (fallbackRanked.length + 1) / 2))
  const minActiveCombos = normalizedAllocationMode === 'precision'
    ? 0
    : Math.min(
      fallbackRanked.length,
      Math.max(1, Math.floor(Math.max(0, Number(riskCap) || 0) / allocationUnit)),
      Math.max(3, Math.min(6, recommendationCount)),
    )
  const allocatedAmounts = allocateAmountsWithinRiskCap(
    normalizedWeights,
    riskCap,
    allocationUnit,
    minActiveCombos,
  )
  const rankedWithAmounts = fallbackRanked.map((item, idx) => ({
    ...item,
    allocatedAmount: allocatedAmounts[idx] || 0,
    allocatedWeight: normalizedWeights[idx] || 0,
  }))
  const fundedRanked = rankedWithAmounts
    .filter((item) => item.allocatedAmount > 0)
    .sort((a, b) => b.allocatedAmount - a.allocatedAmount || b.allocatedWeight - a.allocatedWeight || b.utility - a.utility)
  const reserveRanked = rankedWithAmounts
    .filter((item) => item.allocatedAmount <= 0)
    .sort((a, b) => b.allocatedWeight - a.allocatedWeight || b.utility - a.utility || b.sharpe - a.sharpe)
  const outputRanked = [...fundedRanked, ...reserveRanked].slice(0, recommendationCount)

  const FT_LAYER_TO_DISPLAY = {
    core: '主推',
    satellite: '次推',
    covering: '次推',
    moonshot: '博冷',
  }

  const recommendations = outputRanked.map((item, idx) => {
    const rank = idx + 1
    // Use fault-tolerant layer tag if available, otherwise fall back to rank-based
    const layer = (item.ftLayerTag && FT_LAYER_TO_DISPLAY[item.ftLayerTag]) || getLayerByRank(rank)
    const amount = item.allocatedAmount || 0
    const theoreticalWeightPct = (item.allocatedWeight || 0) * 100
    const allocationText = amount > 0 ? `${amount} rmb` : `理论权重 ${theoreticalWeightPct.toFixed(1)}%`
    const tierLabel = `T${rank}`

    return {
      id: `combo-${rank}`,
      rank,
      tier: tierLabel,
      layer,
      tierLabel: `${tierLabel} ${layer}`,
      combo: buildComboTitle(item.subset),
      legs: item.legs,
      amount,
      allocation: allocationText,
      theoreticalWeightPct: Number(theoreticalWeightPct.toFixed(1)),
      allocatedWeight: Number((item.allocatedWeight || 0).toFixed(6)),
      ev: formatPercent(item.ev * 100),
      winRate: `${Math.round(item.p * 100)}%`,
      profitWinRate: `${Math.round(item.profitWinProbability * 100)}%`,
      sharpe: item.sharpe.toFixed(2),
      sigma: Number(item.sigma.toFixed(3)),
      utility: Number(item.utility.toFixed(4)),
      expectedReturn: item.ev,
      subset: item.subset,
      combinedOdds: Number(item.odds.toFixed(2)),
      expectedRating: Number((item.hitProbability || item.p).toFixed(2)),
      coverageInjected: Boolean(item.coverageInjected),
      confTiers: item.confTiers || [],
      explain: {
        weightPct: Number((item.allocatedWeight * 100).toFixed(1)),
        confAvg: Number(item.confAvg.toFixed(2)),
        calibGainPp: Number(((item.p - item.rawP) * 100).toFixed(1)),
        profitWinPct: Number((item.profitWinProbability * 100).toFixed(1)),
        riskPenaltySharePct: Number(
          ((item.riskPenalty / (Math.abs(item.rewardTerm) + item.riskPenalty + 0.000001)) * 100).toFixed(1),
        ),
        corr: Number(item.corr.toFixed(2)),
        parlayBonus: Number((item.parlayBonus || 0).toFixed(3)),
        familyDiversity: Number((item.familyDiversity || 1).toFixed(2)),
        roleMixBonus: Number((item.roleMixBonus || 0).toFixed(3)),
        roleSignature: item.roleSignature || '--',
        thresholdPass:
          item.p >= minWinRate &&
          item.corr <= maxCorr &&
          (item.coverageRate || 0) >= minCoverage,
        ftLayerTag: item.ftLayerTag || null,
        confTierSummary: item.confTiers ? item.confTiers.join('/') : '--',
        tierPenalty: Number((item.tierPenalty || 0).toFixed(3)),
        tierAnchorBonus: Number((item.tierAnchorBonus || 0).toFixed(3)),
        coveringBonus: Number((item.coveringBonus || 0).toFixed(3)),
        confSurplusBonus: Number((item.confSurplusBonus || 0).toFixed(3)),
        avgSurplus: Number((item.avgSurplus || 0).toFixed(4)),
        maxSurplus: Number((item.maxSurplus || 0).toFixed(4)),
      },
    }
  })

  const totalInvest = recommendations.reduce((sum, item) => sum + item.amount, 0)
  const weightedEv =
    totalInvest > 0
      ? recommendations.reduce((sum, item) => sum + (item.amount / totalInvest) * item.expectedReturn, 0)
      : 0

  const layerSummary = ['主推', '次推', '博冷'].map((layer) => {
    const layerRows = recommendations.filter((item) => item.layer === layer)
    const layerInvest = layerRows.reduce((sum, item) => sum + item.amount, 0)
    const layerEv =
      layerInvest > 0
        ? layerRows.reduce((sum, item) => sum + (item.amount / layerInvest) * item.expectedReturn, 0)
        : 0

    return {
      layer,
      count: layerRows.length,
      totalInvest: layerInvest,
      expectedReturnPercent: layerEv * 100,
      avgSharpe:
        layerRows.length > 0
          ? layerRows.reduce((sum, item) => sum + Number(item.sharpe), 0) / layerRows.length
          : 0,
    }
  })

  // Compute legs distribution for summary
  const legsDistribution = {}
  recommendations.forEach((r) => {
    const k = r.legs || r.subset.length
    legsDistribution[k] = (legsDistribution[k] || 0) + 1
  })

  const ftTierCounts = Object.fromEntries(
    Object.entries(ftResult.tiers || {}).map(([tier, rows]) => [
      tier,
      Array.isArray(rows) ? rows.length : Number(rows) || 0,
    ]),
  )

  return {
    recommendations,
    rankingRows: recommendations,
    layerSummary,
    totalInvest,
    expectedReturnPercent: weightedEv * 100,
    candidateCombos: pool.length,
    qualifiedCombos: qualifiedRaw.length,
    filteredOutCombos: Math.max(0, pool.length - qualifiedRaw.length),
    coverageInjectedCombos: recommendations.filter((item) => item.coverageInjected).length,
    uncoveredMatches: ensureCoverageInRanked(recommendations, [], selectedMatches, recommendations.length).uncoveredCount,
    legsDistribution,
    dynParams,
    ftTiers: ftTierCounts,
    comboRetrospective: retro,
  }
}

export default function ComboPage({ openModal }) {
  const navigate = useNavigate()
  const restoreCheckedKeysRef = useRef(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [dismissedCount, setDismissedCount] = useState(() => readDismissedCandidateKeys().size)
  const [planHistory, setPlanHistory] = useState(() => readComboPlanHistory())
  const [todayMatches, setTodayMatches] = useState(() => getTodayMatches())
  const [checkedMatches, setCheckedMatches] = useState([])
  const [analysisFilter, setAnalysisFilter] = useState(() => readAnalysisFilter())
  const [riskPref, setRiskPref] = useState(50)
  const [recommendations, setRecommendations] = useState([])
  const [rankingRows, setRankingRows] = useState([])
  const [layerSummary, setLayerSummary] = useState([])
  const [qualityFilter, setQualityFilter] = useState(() => sanitizeQualityFilter(DEFAULT_QUALITY_FILTER))
  const [comboStrategy, setComboStrategy] = useState(DEFAULT_COMBO_STRATEGY)
  const [allocationMode, setAllocationMode] = useState(DEFAULT_ALLOCATION_MODE)
  const [solverMode, setSolverMode] = useState(DEFAULT_SOLVER_MODE)
  const [comboStructure, setComboStructure] = useState(() => sanitizeComboStructure(DEFAULT_COMBO_STRUCTURE))
  const [rolePreference, setRolePreference] = useState(() => sanitizeRolePreference(DEFAULT_ROLE_PREFERENCE))
  const [matchRoleOverrides, setMatchRoleOverrides] = useState({})
  const [showRiskProbe, setShowRiskProbe] = useState(false)
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [showAllQuickRecommendations, setShowAllQuickRecommendations] = useState(false)
  const [showRecommendationDetailCard, setShowRecommendationDetailCard] = useState(false)
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState({})
  const [showDeepRefresh, setShowDeepRefresh] = useState(false)
  const [lessTeams, setLessTeams] = useState(new Set())
  const [moreTeams, setMoreTeams] = useState(new Set())
  const [mcSimResult, setMcSimResult] = useState(null)
  const [portfolioAllocations, setPortfolioAllocations] = useState([])
  const [expandedComboIdxSet, setExpandedComboIdxSet] = useState(() => new Set())
  const [expandedPortfolioIdxSet, setExpandedPortfolioIdxSet] = useState(() => new Set())
  const [showAllPortfolios, setShowAllPortfolios] = useState(false)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [ftCellOverrides, setFtCellOverrides] = useState({}) // { portfolioKey: { "rowKey|colKey": "decouple"|"release" } }
  const [ftDirtyPortfolios, setFtDirtyPortfolios] = useState(() => new Set()) // Set<portfolioKey>
  const [generationSummary, setGenerationSummary] = useState({
    totalInvest: 0,
    expectedReturnPercent: 0,
    candidateCombos: 0,
    qualifiedCombos: 0,
    filteredOutCombos: 0,
    coverageInjectedCombos: 0,
    uncoveredMatches: 0,
    legsDistribution: {},
  })

  const [systemConfig] = useState(() => getSystemConfig())
  const calibrationContext = useMemo(() => getPredictionCalibrationContext(), [dataVersion])
  const comboRetrospective = useMemo(() => buildComboRetrospective(planHistory), [dataVersion, planHistory])

  const riskCap = useMemo(
    () => Math.round(systemConfig.initialCapital * systemConfig.riskCapRatio),
    [systemConfig.initialCapital, systemConfig.riskCapRatio],
  )
  const maxWorstDrawdownAlertPct = useMemo(() => {
    const value = Number.parseFloat(systemConfig.maxWorstDrawdownAlertPct)
    if (!Number.isFinite(value)) return 22
    return clamp(value, 5, 95)
  }, [systemConfig.maxWorstDrawdownAlertPct])
  const activeStrategyMeta =
    COMBO_STRATEGY_OPTIONS.find((option) => option.value === comboStrategy) || COMBO_STRATEGY_OPTIONS[0]
  const activeSolverMeta =
    SOLVER_MODE_OPTIONS.find((option) => option.value === solverMode) || SOLVER_MODE_OPTIONS[0]
  const minCoverageGateEnabled = qualityFilter.minCoverageEnabled !== false
  const overlapTuning = useMemo(
    () => resolveOverlapTuning(qualityFilter, calibrationContext?.comboHyperparams || null),
    [qualityFilter, calibrationContext],
  )

  const candidateRows = useMemo(
    () =>
      todayMatches.map((item) => {
        const adjustedProb = calcAdjustedProbability(item, systemConfig, calibrationContext)
        const fallbackOdds = Math.max(1.01, Number(item.odds) || 2.5)
        const atomicProfile = buildAtomicLegProfile(item, adjustedProb, fallbackOdds)
        const rawAtomicProfile = buildAtomicLegProfile(item, clamp(Number(item.conf) || 0.5, 0.05, 0.95), fallbackOdds)
        const effectiveOdds = Math.max(1.01, Number(atomicProfile.equivalentOdds || fallbackOdds))
        const adjustedEvPercent = Number(atomicProfile.expectedReturn || 0) * 100
        const suggestedAmount = calcRecommendedAmount(adjustedProb, effectiveOdds, systemConfig, riskCap, calibrationContext)
        const autoRole = inferMatchRoleByMetrics(adjustedProb, effectiveOdds, item.conf)
        return {
          ...item,
          adjustedProb,
          adjustedEvPercent,
          suggestedAmount,
          effectiveOdds,
          atomicProfile,
          rawAtomicProfile,
          autoRole,
        }
      }),
    [calibrationContext, riskCap, systemConfig, todayMatches],
  )

  const displayedCandidates = useMemo(() => {
    if (!analysisFilter) return candidateRows
    return candidateRows.filter((match) => {
      if (analysisFilter.mode && normalizeMode(match.mode) !== analysisFilter.mode) return false
      if (analysisFilter.confBucket) {
        const bucket = getFineConfBucket(Number(match.conf))
        if (bucket !== analysisFilter.confBucket) return false
      }
      if (analysisFilter.oddsBucket) {
        const bucket = getOddsBucketByHalf(Number(match.odds))
        if (bucket !== analysisFilter.oddsBucket) return false
      }
      return true
    })
  }, [analysisFilter, candidateRows])

  const selectedMatches = useMemo(
    () =>
      displayedCandidates
        .filter((_, idx) => checkedMatches[idx])
        .map((row) => ({
          ...row,
          roleTag: normalizeRoleTag(matchRoleOverrides[row.key] || row.autoRole),
        })),
    [checkedMatches, displayedCandidates, matchRoleOverrides],
  )
  const candidateComboCount = useMemo(
    () => countCandidateCombos(selectedMatches.length, 5, comboStructure.minLegs, true),
    [selectedMatches.length, comboStructure.minLegs],
  )

  const displayedRecommendations = useMemo(
    () => (showAllRecommendations ? recommendations : recommendations.slice(0, QUICK_PREVIEW_RECOMMENDATION_COUNT)),
    [recommendations, showAllRecommendations],
  )

  const quickPreviewRecommendations = useMemo(
    () =>
      showAllQuickRecommendations
        ? recommendations
        : recommendations.slice(0, QUICK_PREVIEW_RECOMMENDATION_COUNT),
    [recommendations, showAllQuickRecommendations],
  )

  const toggleQuickComboExpand = (idx) => {
    setExpandedComboIdxSet((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const toggleExpandAllQuickComboDetails = () => {
    setExpandedComboIdxSet((prev) => {
      const allExpanded =
        quickPreviewRecommendations.length > 0 &&
        quickPreviewRecommendations.every((_, idx) => prev.has(idx))
      if (allExpanded) return new Set()
      return new Set(quickPreviewRecommendations.map((_, idx) => idx))
    })
  }

  const selectedRecommendations = useMemo(
    () => recommendations.filter((item) => selectedRecommendationIds[item.id]),
    [recommendations, selectedRecommendationIds],
  )

  const selectedSummary = useMemo(() => {
    const selectedTotalInvest = selectedRecommendations.reduce((sum, item) => sum + item.amount, 0)
    const selectedExpectedReturnPercent =
      selectedTotalInvest > 0
        ? selectedRecommendations.reduce((sum, item) => sum + item.amount * item.expectedReturn, 0) / selectedTotalInvest
        : 0

    return {
      count: selectedRecommendations.length,
      totalInvest: selectedTotalInvest,
      expectedReturnPercent: selectedExpectedReturnPercent * 100,
    }
  }, [selectedRecommendations])

  const adoptPreview = useMemo(() => {
    const target = selectedRecommendations.length > 0 ? selectedRecommendations : recommendations.slice(0, 1)
    if (target.length === 0) {
      return {
        ready: false,
        totalInvest: 0,
        maxSingleExposure: 0,
        concentration: 0,
        worstLoss: 0,
        worstDrawdownPct: 0,
      }
    }

    const exposureMap = new Map()
    target.forEach((combo) => {
      combo.subset.forEach((match) => {
        const key = `${match.homeTeam} vs ${match.awayTeam}`
        const perMatch = combo.subset.length > 0 ? combo.amount / combo.subset.length : 0
        exposureMap.set(key, (exposureMap.get(key) || 0) + perMatch)
      })
    })

    const totalInvest = target.reduce((sum, row) => sum + row.amount, 0)
    const maxSingleExposure = Math.max(0, ...exposureMap.values())
    const concentration = totalInvest > 0 ? maxSingleExposure / totalInvest : 0

    const investments = getInvestments().filter((item) => !item.is_archived)
    const settledProfit = investments.reduce((sum, item) => {
      const profit = Number.parseFloat(item.profit)
      return Number.isFinite(profit) ? sum + profit : sum
    }, 0)
    const currentPool = Math.max(1, Number(systemConfig.initialCapital || 0) + settledProfit)
    const worstLoss = totalInvest
    const worstDrawdownPct = (worstLoss / currentPool) * 100

    return {
      ready: true,
      totalInvest,
      maxSingleExposure,
      concentration,
      worstLoss,
      worstDrawdownPct,
    }
  }, [recommendations, selectedRecommendations, systemConfig.initialCapital])
  const drawdownExceeded = adoptPreview.ready && adoptPreview.worstDrawdownPct > maxWorstDrawdownAlertPct

  const riskProbeRows = useMemo(() => {
    const prefs = [30, 40, 50, 60, 70]
    // Use precision allocation inside probe to surface risk-sensitivity
    // instead of being flattened by 10-rmb bucket rounding.
    const probeAllocationMode = 'precision'
    const rows = prefs.map((pref) => {
      const generated = generateRecommendations(
        selectedMatches,
        pref,
        riskCap,
        systemConfig,
        calibrationContext,
        qualityFilter,
        comboStrategy,
        comboStructure,
        rolePreference,
        null,
        comboRetrospective,
        probeAllocationMode,
        solverMode,
      )
      if (!generated || generated.recommendations.length === 0) {
        return {
          riskPref: pref,
          available: false,
          evPct: 0,
          totalInvest: 0,
          topSharpe: 0,
          qualified: 0,
          topCorr: 0,
        }
      }
      const top = generated.recommendations[0]
      return {
        riskPref: pref,
        available: true,
        evPct: generated.expectedReturnPercent,
        totalInvest: generated.totalInvest,
        topSharpe: Number(top?.sharpe || 0),
        qualified: generated.qualifiedCombos,
        topCorr: Number(top?.explain?.corr || 0),
      }
    })

    const best = rows
      .filter((row) => row.available)
      .sort((a, b) => b.evPct - a.evPct || b.topSharpe - a.topSharpe || a.topCorr - b.topCorr)[0]

    return rows.map((row) => ({
      ...row,
      best: Boolean(best && row.riskPref === best.riskPref),
    }))
  }, [calibrationContext, comboStrategy, comboStructure, qualityFilter, riskCap, rolePreference, selectedMatches, systemConfig, comboRetrospective, solverMode])

  const matchExposure = useMemo(() => {
    const map = new Map()
    selectedRecommendations.forEach((row) => {
      row.subset.forEach((match) => {
        const key = `${match.homeTeam} vs ${match.awayTeam}`
        const prev = map.get(key) || { match: key, count: 0, amount: 0 }
        const unitAmount = row.subset.length > 0 ? row.amount / row.subset.length : 0
        prev.count += 1
        prev.amount += unitAmount
        map.set(key, prev)
      })
    })

    return [...map.values()]
      .sort((a, b) => b.amount - a.amount || b.count - a.count)
      .slice(0, 5)
  }, [selectedRecommendations])

  const applyRiskProbeBest = (nextRiskPref) => {
    if (!Number.isFinite(nextRiskPref) || nextRiskPref === riskPref) return
    setRiskPref(nextRiskPref)
    regenerateWithOverrides({ riskPref: nextRiskPref })
  }

  const allChecked = checkedMatches.length > 0 && checkedMatches.every(Boolean)

  useEffect(() => {
    const onDataChanged = () => setDataVersion((prev) => prev + 1)
    window.addEventListener('dugou:data-changed', onDataChanged)
    return () => window.removeEventListener('dugou:data-changed', onDataChanged)
  }, [])

  useEffect(() => {
    const latest = getTodayMatches()
    setTodayMatches(latest)
  }, [dataVersion])

  useEffect(() => {
    const pendingKeys = Array.isArray(restoreCheckedKeysRef.current) ? restoreCheckedKeysRef.current : null
    if (pendingKeys) {
      const keySet = new Set(pendingKeys.map((key) => String(key)))
      const nextChecked = displayedCandidates.map((row) => keySet.has(String(row.key)))
      setCheckedMatches(nextChecked.some(Boolean) ? nextChecked : displayedCandidates.map(() => true))
      restoreCheckedKeysRef.current = null
      return
    }
    setCheckedMatches(displayedCandidates.map(() => true))
  }, [displayedCandidates])

  useEffect(() => {
    setMatchRoleOverrides((prev) => {
      const validKeys = new Set(candidateRows.map((row) => row.key))
      let changed = false
      const next = {}
      Object.entries(prev).forEach(([key, value]) => {
        if (!validKeys.has(key)) {
          changed = true
          return
        }
        next[key] = normalizeRoleTag(value)
      })
      return changed ? next : prev
    })
  }, [candidateRows])

  const toggleCheck = (idx) => {
    setCheckedMatches((prev) => prev.map((value, i) => (i === idx ? !value : value)))
  }

  const toggleCheckAll = () => {
    const next = !allChecked
    setCheckedMatches((prev) => prev.map(() => next))
  }

  const refreshTodayMatches = () => {
    const latest = getTodayMatches()
    setTodayMatches(latest)
    setCheckedMatches(latest.map(() => true))
  }

  const clearTodayCandidates = () => {
    if (candidateRows.length === 0) return
    const ok = window.confirm('确认清空当前「今日备选」吗？仅清空本页候选，不会删除已保存投资记录。')
    if (!ok) return
    const dismissed = readDismissedCandidateKeys()
    candidateRows.forEach((row) => dismissed.add(row.key))
    writeDismissedCandidateKeys(dismissed)
    setDismissedCount(dismissed.size)

    setTodayMatches([])
    setCheckedMatches([])
    setRecommendations([])
    setRankingRows([])
    setLayerSummary([])
    setSelectedRecommendationIds({})
    setMatchRoleOverrides({})
    setGenerationSummary({
      totalInvest: 0,
      expectedReturnPercent: 0,
      candidateCombos: 0,
      qualifiedCombos: 0,
      filteredOutCombos: 0,
      coverageInjectedCombos: 0,
      uncoveredMatches: 0,
      legsDistribution: {},
    })
    setShowAllRecommendations(false)
    setShowAllQuickRecommendations(false)
    setShowRecommendationDetailCard(false)
  }

  const pushPlanHistory = (generated, selectedRows, pref, snapshot = null) => {
    const selectedLabel = selectedRows.slice(0, 2).map((row) => row.match).join(' + ')
    const roleMap = selectedRows.reduce((acc, row) => {
      if (row?.key) {
        acc[row.key] = normalizeRoleTag(row.roleTag)
      }
      return acc
    }, {})
    // FIX #9: Snapshot candidate match keys + surplus for retrospective learning
    const candidateMatchKeys = selectedRows.map((row) => ({
      matchKey: `${(row.homeTeam || '-').trim()} vs ${(row.awayTeam || '-').trim()}`,
      surplus: row.confSurplus?.surplus || 0,
      conf: row.conf || 0,
      odds: row.odds || 0,
    }))
    const entry = {
      id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      riskPref: pref,
      selectedCount: selectedRows.length,
      selectedLabel: selectedLabel || '未命名方案',
      candidateCombos: generated.candidateCombos,
      qualifiedCombos: generated.qualifiedCombos,
      filteredOutCombos: generated.filteredOutCombos,
      totalInvest: generated.totalInvest,
      expectedReturnPercent: generated.expectedReturnPercent,
      recommendations: generated.recommendations,
      layerSummary: generated.layerSummary,
      candidateMatchKeys,
      comboStrategy,
      allocationMode: normalizeAllocationMode(allocationMode),
      solverMode: normalizeSolverMode(solverMode),
      comboStructure: sanitizeComboStructure(comboStructure),
      rolePreference: sanitizeRolePreference(rolePreference),
      selectedRoleMap: roleMap,
      coverageInjectedCombos: generated.coverageInjectedCombos,
      uncoveredMatches: generated.uncoveredMatches,
      legsDistribution: generated.legsDistribution || {},
      selectedMatchesSnapshot: selectedRows.map((row) => ({ ...row })),
      portfolioAllocations:
        Array.isArray(snapshot?.portfolioAllocations) ? snapshot.portfolioAllocations : [],
      mcSimResult:
        snapshot?.mcSimResult && typeof snapshot.mcSimResult === 'object' ? snapshot.mcSimResult : null,
    }
    setPlanHistory((prev) => {
      const next = [entry, ...prev].slice(0, 12)
      writeComboPlanHistory(next)
      return next
    })
  }

  const restorePlanFromHistory = (historyRow) => {
    if (!historyRow || !Array.isArray(historyRow.recommendations)) return
    clearAnalysisFilter()
    setAnalysisFilter(null)

    const latestTodayMatches = getTodayMatches()
    const historyCandidates = collectHistoryCandidates(historyRow)
    const mergedMap = new Map()
    historyCandidates.forEach((row) => {
      const key = String(row?.key || '').trim()
      if (!key) return
      mergedMap.set(key, row)
    })
    latestTodayMatches.forEach((row) => {
      const key = String(row?.key || '').trim()
      if (!key || mergedMap.has(key)) return
      mergedMap.set(key, row)
    })
    const mergedCandidates = [...mergedMap.values()]
    const historyMatchKeys = collectHistoryMatchKeys(historyRow, mergedCandidates)
    setTodayMatches(mergedCandidates)
    if (historyMatchKeys.size > 0) {
      const dismissed = readDismissedCandidateKeys()
      let changed = false
      historyMatchKeys.forEach((key) => {
        if (dismissed.delete(String(key))) changed = true
      })
      if (changed) {
        writeDismissedCandidateKeys(dismissed)
        setDismissedCount(dismissed.size)
      }
      restoreCheckedKeysRef.current = [...historyMatchKeys]
    } else if (historyCandidates.length > 0) {
      restoreCheckedKeysRef.current = historyCandidates
        .map((row) => String(row?.key || '').trim())
        .filter(Boolean)
    }

    setRiskPref(Number(historyRow.riskPref || 50))
    if (historyRow.comboStrategy) {
      setComboStrategy(historyRow.comboStrategy)
    }
    if (historyRow.allocationMode) {
      setAllocationMode(normalizeAllocationMode(historyRow.allocationMode))
    }
    if (historyRow.solverMode) {
      setSolverMode(normalizeSolverMode(historyRow.solverMode))
    }
    if (historyRow.comboStructure) {
      setComboStructure(sanitizeComboStructure(historyRow.comboStructure))
    }
    if (historyRow.rolePreference) {
      setRolePreference(sanitizeRolePreference(historyRow.rolePreference))
    }
    if (historyRow.selectedRoleMap && typeof historyRow.selectedRoleMap === 'object') {
      const nextRoleMap = {}
      Object.entries(historyRow.selectedRoleMap).forEach(([key, value]) => {
        nextRoleMap[key] = normalizeRoleTag(value)
      })
      setMatchRoleOverrides(nextRoleMap)
    }
    const safeRecommendations = historyRow.recommendations
      .filter((item) => item && typeof item === 'object')
      .slice(0, 20)
      .map((item, idx) => normalizeHistoryRecommendation(item, idx))
    setRecommendations(safeRecommendations)
    setRankingRows(safeRecommendations)
    setLayerSummary(Array.isArray(historyRow.layerSummary) ? historyRow.layerSummary : [])
    setGenerationSummary({
      totalInvest: Number(historyRow.totalInvest || 0),
      expectedReturnPercent: Number(historyRow.expectedReturnPercent || 0),
      candidateCombos: Number(historyRow.candidateCombos || 0),
      qualifiedCombos: Number(historyRow.qualifiedCombos || 0),
      filteredOutCombos: Number(historyRow.filteredOutCombos || 0),
      coverageInjectedCombos: Number(historyRow.coverageInjectedCombos || 0),
      uncoveredMatches: Number(historyRow.uncoveredMatches || 0),
      legsDistribution: historyRow.legsDistribution && typeof historyRow.legsDistribution === 'object'
        ? historyRow.legsDistribution
        : {},
    })
    setShowAllRecommendations(false)
    setShowAllQuickRecommendations(false)
    setShowRecommendationDetailCard(false)
    const restoreCoverageTargetKeys =
      historyMatchKeys.size > 0
        ? Array.from(historyMatchKeys)
        : selectedMatches.map((m) => getPortfolioCoverageKey(m))
    const restoredAllocations =
      Array.isArray(historyRow.portfolioAllocations) && historyRow.portfolioAllocations.length > 0
        ? historyRow.portfolioAllocations
        : optimizePortfolioAllocations(
          safeRecommendations,
          10,
          calibrationContext?.comboHyperparams || null,
          restoreCoverageTargetKeys,
          overlapTuning,
        )
    setPortfolioAllocations(normalizePortfolioAllocations(restoredAllocations))
    const restoredMc =
      historyRow.mcSimResult && typeof historyRow.mcSimResult === 'object'
        ? historyRow.mcSimResult
        : runPortfolioMonteCarlo(safeRecommendations.slice(0, RECOMMENDATION_OUTPUT_COUNT))
    setMcSimResult(restoredMc)
    setExpandedComboIdxSet(new Set())
    setExpandedPortfolioIdxSet(new Set())
    setShowAllPortfolios(false)

    setSelectedRecommendationIds({})
  }

  const clearPlanHistory = () => {
    if (planHistory.length === 0) return
    const ok = window.confirm('确认清空组合方案生成历史吗？')
    if (!ok) return
    setPlanHistory([])
    writeComboPlanHistory([])
  }

  const restoreDismissedCandidates = () => {
    if (dismissedCount === 0) return
    const ok = window.confirm('恢复之前清空的备选记录吗？')
    if (!ok) return
    writeDismissedCandidateKeys(new Set())
    setDismissedCount(0)
    refreshTodayMatches()
  }

  const toggleRecommendation = (id) => {
    setSelectedRecommendationIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const togglePortfolioExpand = (idx) => {
    setExpandedPortfolioIdxSet((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const toggleExpandAllPortfolio = () => {
    setExpandedPortfolioIdxSet((prev) => {
      const allExpanded =
        portfolioAllocations.length > 0 &&
        portfolioAllocations.every((_, idx) => prev.has(idx))
      if (allExpanded) return new Set()
      return new Set(portfolioAllocations.map((_, idx) => idx))
    })
  }

  const handleGenerate = () => {
    if (selectedMatches.length === 0) {
      window.alert('请先勾选至少 1 场比赛。')
      return
    }

    const generated = generateRecommendations(
      selectedMatches,
      riskPref,
      riskCap,
      systemConfig,
      calibrationContext,
      qualityFilter,
      comboStrategy,
      comboStructure,
      rolePreference,
      null,
      comboRetrospective,
      allocationMode,
      solverMode,
    )
    if (!generated) {
      window.alert(
        comboStrategy === 'thresholdStrict'
          ? `当前阈值下没有可用方案，请降低最小胜率${minCoverageGateEnabled ? ' / 最小覆盖率' : ''}，或放宽最大相关性。`
          : '当前参数下没有可用方案，请调整风险偏好或降低过滤强度后重试。',
      )
      return
    }

    setRecommendations(generated.recommendations)
    setRankingRows(generated.rankingRows)
    setLayerSummary(generated.layerSummary)
    setGenerationSummary({
      totalInvest: generated.totalInvest,
      expectedReturnPercent: generated.expectedReturnPercent,
      candidateCombos: generated.candidateCombos,
      qualifiedCombos: generated.qualifiedCombos,
      filteredOutCombos: generated.filteredOutCombos,
      coverageInjectedCombos: generated.coverageInjectedCombos,
      uncoveredMatches: generated.uncoveredMatches,
      legsDistribution: generated.legsDistribution || {},
      dynParams: generated.dynParams || null,
      ftTiers: generated.ftTiers || null,
    })
    setShowAllRecommendations(false)
    setShowAllQuickRecommendations(false)
    setShowRecommendationDetailCard(false)

    // Auto-run Monte Carlo simulation on the generated package
    const mc = runPortfolioMonteCarlo(generated.recommendations.slice(0, RECOMMENDATION_OUTPUT_COUNT))
    setMcSimResult(mc)

    // Auto-run portfolio allocation optimizer
    const allocations = optimizePortfolioAllocations(
      generated.recommendations,
      10,
      calibrationContext?.comboHyperparams || null,
      selectedMatches.map((m) => getPortfolioCoverageKey(m)),
      overlapTuning,
    )
    const normalizedAllocations = normalizePortfolioAllocations(allocations)
    setPortfolioAllocations(normalizedAllocations)
    pushPlanHistory(generated, selectedMatches, riskPref, {
      portfolioAllocations: normalizedAllocations,
      mcSimResult: mc,
    })

    setSelectedRecommendationIds({})
    setExpandedComboIdxSet(new Set())
    setExpandedPortfolioIdxSet(new Set())
    setShowAllPortfolios(false)
    setLeftPanelCollapsed(true)
    setFtCellOverrides({})
    setFtDirtyPortfolios(new Set())
  }

  const handleConfirmChecked = () => {
    if (selectedMatches.length === 0) {
      window.alert('请先勾选比赛。')
      return
    }
    const combos = candidateComboCount
    window.alert(`已勾选 ${selectedMatches.length} 场，可生成 ${combos} 个候选组合。`)
  }

  // Core re-generate with optional overrides
  const regenerateWithOverrides = (overrides = {}) => {
    if (selectedMatches.length === 0) return false
    const jRisk = overrides.riskPref ?? riskPref
    const jStructure = overrides.comboStructure ?? comboStructure
    const jAllocationMode = normalizeAllocationMode(overrides.allocationMode ?? allocationMode)
    const jSolverMode = normalizeSolverMode(overrides.solverMode ?? solverMode)
    const bias = overrides.teamBias ?? null
    const decouple = overrides.decouplingPairs ?? null
    const generated = generateRecommendations(
      selectedMatches, jRisk, riskCap, systemConfig, calibrationContext,
      qualityFilter, comboStrategy, jStructure, rolePreference, bias,
      comboRetrospective,
      jAllocationMode,
      jSolverMode,
      decouple,
    )
    if (!generated) {
      if (parseDirectedDecouplingConstraints(decouple).length > 0) {
        window.alert('当前容错依赖约束在候选空间中无可行解。请减少翻转项、放宽阈值，或增加候选比赛后重试。')
      }
      return false
    }
    setRecommendations(generated.recommendations)
    setRankingRows(generated.rankingRows)
    setLayerSummary(generated.layerSummary)
    setGenerationSummary({
      totalInvest: generated.totalInvest, expectedReturnPercent: generated.expectedReturnPercent,
      candidateCombos: generated.candidateCombos, qualifiedCombos: generated.qualifiedCombos,
      filteredOutCombos: generated.filteredOutCombos, coverageInjectedCombos: generated.coverageInjectedCombos,
      uncoveredMatches: generated.uncoveredMatches, legsDistribution: generated.legsDistribution || {},
      dynParams: generated.dynParams || null, ftTiers: generated.ftTiers || null,
    })
    setShowAllRecommendations(false)
    setShowAllQuickRecommendations(false)
    setShowRecommendationDetailCard(false)
    setSelectedRecommendationIds({})
    // Auto-run MC on the new package
    const mc = runPortfolioMonteCarlo(generated.recommendations.slice(0, RECOMMENDATION_OUTPUT_COUNT))
    setMcSimResult(mc)
    // Auto-run portfolio allocation optimizer
    const allocations = optimizePortfolioAllocations(
      generated.recommendations,
      10,
      calibrationContext?.comboHyperparams || null,
      selectedMatches.map((m) => getPortfolioCoverageKey(m)),
      overlapTuning,
      decouple,
    )
    // Fault-tolerance customization should pin the NEW regenerated top package,
    // not the pre-regeneration snapshot. Otherwise the user sees a placebo "定制".
    const pinGeneratedTop = Boolean(overrides._pinGeneratedTop)
    const hasDirectedConstraints = parseDirectedDecouplingConstraints(decouple).length > 0
    let rankedAllocations = allocations
    if (pinGeneratedTop && hasDirectedConstraints) {
      const satisfiedIdx = allocations.findIndex((row) => row?.constraintSatisfied)
      if (satisfiedIdx > 0) {
        rankedAllocations = [allocations[satisfiedIdx], ...allocations.filter((_, idx) => idx !== satisfiedIdx)]
      }
    }
    const nextAllocations = normalizePortfolioAllocations(rankedAllocations.map((row, idx) => {
      const pinned = pinGeneratedTop && idx === 0
      return row?.pinned === pinned ? row : { ...row, pinned }
    }))
    setPortfolioAllocations(nextAllocations)
    if (pinGeneratedTop && hasDirectedConstraints && nextAllocations[0] && !nextAllocations[0].constraintSatisfied) {
      window.alert('当前容错约束在现有候选下无法完全满足，已给出最接近解。可减少翻转项或放宽阈值后重试。')
    }
    setExpandedComboIdxSet(new Set())
    setExpandedPortfolioIdxSet(new Set())
    setShowAllPortfolios(false)
    setFtCellOverrides({})
    setFtDirtyPortfolios(new Set())
    return true
  }

  // Soft refresh: jitter coefficients for a different but still sound output
  const handleSoftRefresh = () => {
    if (selectedMatches.length === 0) return
    const jitter = (v, range) => v + (Math.random() - 0.5) * 2 * range
    regenerateWithOverrides({
      riskPref: Math.round(clamp(jitter(riskPref, 4), 5, 95)),
      comboStructure: {
        ...comboStructure,
        mmrLambda: clamp(jitter(comboStructure.mmrLambda, 0.06), 0.25, 0.85),
        parlayBeta: clamp(jitter(comboStructure.parlayBeta, 0.03), 0, 0.35),
      },
    })
  }

  // Deep refresh: apply team bias and regenerate
  const handleDeepRefreshCommit = () => {
    const bias = new Map()
    const biasMag = calibrationContext?.comboHyperparams?.teamBiasMagnitude ?? 0.12
    lessTeams.forEach((t) => bias.set(t, (bias.get(t) || 0) - biasMag))
    moreTeams.forEach((t) => bias.set(t, (bias.get(t) || 0) + biasMag))
    setShowDeepRefresh(false)
    regenerateWithOverrides({ teamBias: bias })
  }

  // Fault tolerance matrix: toggle a cell override
  // Fault tolerance matrix: toggle a cell override
  // We record the SEMANTIC INTENT of each flip, not just that it was flipped:
  //   'decouple' = original ✗ flipped to ✓ = "I want these two matches to survive independently"
  //               → generates a decoupling constraint for the algorithm
  //   'release'  = original ✓ flipped to ✗ = "I don't care about this dependency, free up room"
  //               → no constraint, just gives the algorithm more freedom
  const handleFtCellToggle = (portfolioKeyInput, rowKey, colKey, originalSurvives) => {
    const portfolioKey = String(portfolioKeyInput || '').trim()
    if (!portfolioKey) return
    setFtCellOverrides((prev) => {
      const patchKey = `${rowKey}|${colKey}`
      const existing = prev[portfolioKey] || {}
      const next = { ...existing }
      if (patchKey in next) {
        delete next[patchKey] // undo flip — restore to original
      } else {
        // originalSurvives=true (was ✓) → user flips to ✗ → 'release'
        // originalSurvives=false (was ✗) → user flips to ✓ → 'decouple'
        next[patchKey] = originalSurvives ? 'release' : 'decouple'
      }
      return { ...prev, [portfolioKey]: next }
    })
    setFtDirtyPortfolios((prev) => new Set([...prev, portfolioKey]))
  }

  // Fault tolerance matrix: row-level "reduce dependency" — marks ALL red cells in this row as desired-green
  const handleFtRowReduce = (portfolioKeyInput, rowKey, ftMatches, comboMatchSets) => {
    const portfolioKey = String(portfolioKeyInput || '').trim()
    if (!portfolioKey) return
    setFtCellOverrides((prev) => {
      const existing = prev[portfolioKey] || {}
      const next = { ...existing }
      ftMatches.forEach((colMatch) => {
        if (colMatch.key === rowKey) return
        const survives = comboMatchSets.some((cs) => cs.has(colMatch.key) && !cs.has(rowKey))
        if (!survives) {
          const patchKey = `${rowKey}|${colMatch.key}`
          next[patchKey] = 'decouple' // original ✗ → desired ✓
        }
      })
      return { ...prev, [portfolioKey]: next }
    })
    setFtDirtyPortfolios((prev) => new Set([...prev, portfolioKey]))
  }

  // Fault tolerance matrix: confirm and regenerate with directed hard guarantees
  // SEMANTICS:
  //   ✗→✓ ('decouple') = "when row-match fails, I want col-match to survive elsewhere"
  //     → generates a directed HARD guarantee (row→col), not symmetric.
  //   ✓→✗ ('release') = "I don't care about this dependency, free up room for algorithm"
  //     → NO constraint generated, just releases freedom for the optimizer
  //
  // The regenerated result should be surfaced as 【定制】 at position 0, so the user sees
  // the actual effect of matrix customization instead of a stale pre-regeneration snapshot.
  const handleFtConfirmRegenerate = (portfolioKeyInput) => {
    const portfolioKey = String(portfolioKeyInput || '').trim()
    if (!portfolioKey) return
    const overrides = ftCellOverrides[portfolioKey] || {}
    const entries = Object.entries(overrides)
    if (entries.length === 0) return
    const decouplePairs = new Set()
    const releasePairs = new Set()
    entries.forEach(([k, intent]) => {
      const [rk, ck] = k.split('|')
      if (!rk || !ck || rk === ck) return
      if (intent === 'decouple') decouplePairs.add(`${rk}|${ck}`)
      if (intent === 'release') releasePairs.add(`${rk}|${ck}`)
    })
    const baseAlloc = portfolioAllocations.find((row) => String(row?.portfolioKey || '').trim() === portfolioKey)
    const baseCombos = Array.isArray(baseAlloc?.combos) ? baseAlloc.combos.filter(Boolean) : []
    if (baseCombos.length < 2) {
      window.alert('当前组合包规模过小，无法基于容错矩阵重算。')
      return
    }

    const directedConstraints = parseDirectedDecouplingConstraints(decouplePairs)
    const baseMatchKeys = new Set()
    baseCombos.forEach((combo) => {
      getSubsetMatchKeys(combo?.subset || []).forEach((key) => {
        if (key) baseMatchKeys.add(key)
      })
    })
    const lockedPairs = []
    const baseKeyList = [...baseMatchKeys]
    for (let i = 0; i < baseKeyList.length; i += 1) {
      for (let j = 0; j < baseKeyList.length; j += 1) {
        if (i === j) continue
        const fromKey = baseKeyList[i]
        const toKey = baseKeyList[j]
        const pairKey = `${fromKey}|${toKey}`
        if (decouplePairs.has(pairKey) || releasePairs.has(pairKey)) continue
        const survives = baseCombos.some((combo) => comboSatisfiesDirectedConstraint(combo, { fromKey, toKey }))
        lockedPairs.push({ fromKey, toKey, survives })
      }
    }
    const fallbackCandidates = dedupeRankedBySignature([...recommendations, ...baseCombos])
    const solved = solveConstrainedPortfolioFromBase(
      baseCombos,
      fallbackCandidates,
      directedConstraints,
      {
        preserveBaseCoverage: true,
        size: baseCombos.length,
        lockedPairs,
      },
    )
    const constrainedCombos = solved?.selected || null

    if (!constrainedCombos || constrainedCombos.length === 0) {
      window.alert('当前容错依赖约束在现有候选空间无可行解。已保留你的翻转设置，请减少翻转项后重试。')
      return
    }

    const customRow = buildPortfolioAllocationRowFromCombos(
      constrainedCombos,
      recommendations,
      selectedMatches.map((m) => getPortfolioCoverageKey(m)),
      calibrationContext?.comboHyperparams || null,
      overlapTuning,
      directedConstraints,
    )
    if (!customRow) {
      window.alert('定制组合包构建失败，请稍后重试。')
      return
    }

    const preserved = portfolioAllocations
      .filter((row) => String(row?.portfolioKey || '').trim() !== portfolioKey)
      .map((row) => (row?.pinned ? { ...row, pinned: false } : row))
    const nextAllocations = normalizePortfolioAllocations([{ ...customRow, pinned: true }, ...preserved].slice(0, 10))
    setPortfolioAllocations(nextAllocations)
    setExpandedPortfolioIdxSet(new Set([0]))
    setExpandedComboIdxSet(new Set())
    setShowAllPortfolios(false)
    setFtCellOverrides((prev) => {
      const next = { ...prev }
      delete next[portfolioKey]
      return next
    })
    setFtDirtyPortfolios((prev) => {
      const next = new Set(prev)
      next.delete(portfolioKey)
      return next
    })
    if (directedConstraints.length > 0 && solved && solved.constraintSatisfiedCount < directedConstraints.length) {
      window.alert('当前只找到部分满足约束的近似解。你可以继续微调翻转。')
    } else if (solved && solved.matrixDrift > 0) {
      window.alert(`本次在满足约束前提下最小改动完成，未翻转关系有 ${solved.matrixDrift} 处发生变化。`)
    }
  }

  // Extract unique team names from current candidates
  const waitlistTeams = useMemo(() => {
    const teams = new Set()
    selectedMatches.forEach((m) => {
      if (m.homeTeam) teams.add(m.homeTeam)
      if (m.awayTeam) teams.add(m.awayTeam)
    })
    return [...teams].sort()
  }, [selectedMatches])

  const handleAdopt = () => {
    const toAdopt = selectedRecommendations.length > 0 ? selectedRecommendations : recommendations.slice(0, 1)
    if (toAdopt.length === 0) {
      window.alert('请先点击“生成最优组合”。')
      return
    }

    if (drawdownExceeded) {
      const ok = window.confirm(
        `当前方案最坏回撤估计 ${adoptPreview.worstDrawdownPct.toFixed(1)}%，超过阈值 ${maxWorstDrawdownAlertPct.toFixed(
          1,
        )}%。\n这笔采纳可能显著放大资金波动，确认继续吗？`,
      )
      if (!ok) return
    }

    const baseTime = Date.now()
    const touchedTeams = []

    toAdopt.forEach((combo, index) => {
      const matches = combo.subset.map((item, matchIndex) => ({
        id: buildId('match'),
        home_team: item.homeTeam,
        away_team: item.awayTeam,
        entries: item.entries.length > 0 ? item.entries : [{ name: item.entry || '主胜', odds: item.odds }],
        entry_text: item.entry || '-',
        odds: item.odds,
        conf: item.conf,
        mode: item.mode,
        tys_home: item.tysHome,
        tys_away: item.tysAway,
        fid: item.fid,
        fse_home: item.fseHome,
        fse_away: item.fseAway,
        fse_match: Number(Math.sqrt(item.fseHome * item.fseAway).toFixed(2)),
        note: item.note,
        results: '',
        is_correct: null,
        match_rating: null,
        match_rep: null,
        _combo_match_idx: matchIndex,
      }))

      const investment = {
        id: buildId('inv'),
        created_at: new Date(baseTime + index * 1000).toISOString(),
        parlay_size: matches.length,
        combo_name: matches.length > 1 ? `智能组合 ${combo.tier} · ${combo.combo}` : '',
        inputs: combo.amount,
        suggested_amount: combo.amount,
        expected_rating: combo.expectedRating,
        combined_odds: combo.combinedOdds,
        status: 'pending',
        revenues: null,
        profit: null,
        actual_rating: null,
        rep: null,
        remarks: '',
        matches,
      }

    saveInvestment(investment)
      matches.forEach((match) => {
        touchedTeams.push(match.home_team)
        touchedTeams.push(match.away_team)
      })
    })

    bumpTeamSamples(touchedTeams)
    refreshTodayMatches()
    setDismissedCount(readDismissedCandidateKeys().size)
    window.alert(`已采纳 ${toAdopt.length} 个方案并写入待结算。`)
  }

  const openAlgoModal = () => {
    openModal({
      title: 'Portfolio Optimization 算法说明 v4.9',
          content: (
        <div className="text-sm text-stone-600 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <p className="font-semibold text-indigo-600 text-xs tracking-wide">— 概率校准与信号提取 —</p>
          <p><strong>1. 输入建模</strong>：接入 n 场比赛的多维特征向量（Conf, Mode, TYS, FID, FSE, Odds），构建候选组合池 ΣC(n,k)（k ≤ 5，受最小关数约束）。</p>
          <p><strong>2. 复合校准管线</strong>：线性回归与 Pool-Adjacent-Violators 保序回归 (PAV) 的自适应混合。保序回归权重由样本可靠度控制（上限 60%），在概率单调性保证与小样本稳健性之间取得最优平衡，叠加球队层级偏差收缩校准。</p>
          <p><strong>3. 自学习情境因子</strong>：MODE / TYS / FID / FSE 四维情境因子经 Shrinkage Estimation（K=12）从历史命中率中在线学习。FSE 连续维度采用分位数分桶 + 分段线性插值建模。样本量不足时平滑降级至先验映射。</p>
          <p><strong>4. 市场先验融合</strong>：模型后验概率与赔率隐含概率动态加权融合。融合系数随样本可靠度自适应——高可靠度偏向模型输出，低可靠度自动回归市场先验。</p>
          <p><strong>5. Walk-Forward 反馈回路</strong>：滚动窗口计算 Brier Score / LogLoss / ROI 诊断指标，自动微调 Kelly 除数（±15%）、赔率融合权重（±0.015）、置信度阈值（±0.03）。Bootstrap Monte Carlo 动态调节 market lean，抑制过拟合风险。</p>
          <p><strong>6. 原子结果建模</strong>：同场多 Entry 拆解为原子状态（含 miss 分支），按分支权重与赔率构建收益树，跨场做联合分布。多 Entry 采用联合概率 P = 1 - Π(1 - pᵢ)，保持条目完整性。</p>
          <p><strong>7. 收益与风险度量</strong>：基于联合分布直接求解 E[R] / Var[R] / Sharpe，同步输出命中概率与盈利概率，统一覆盖单 Entry 与多 Entry 串联场景。</p>
          <p><strong>8. 纯分数 Kelly 仓位</strong>：f* = (p·b - q) / b / kellyDivisor，无任何经验修正因子。Kelly 除数由 Walk-Forward 反馈实时调节。</p>

          <p className="font-semibold text-indigo-600 text-xs tracking-wide mt-2">— 效用函数与策略控制 —</p>
          <p><strong>9. Risk Preference 加权</strong>：效用函数 U = α·μ - (1-α)·σ，α 由风险偏好滑杆控制（0 = 稳健，100 = 激进）。</p>
          <p><strong>10. 组合策略模式</strong>：支持勾选优先 / 阈值优先 / 软惩罚三种模式。软惩罚对阈值外方案施加梯度降分而非硬淘汰，保留长尾价值。</p>
          <p><strong>11. 角色结构软约束</strong>：逐场支持"稳 / 杠杆 / 中性双档"自定义标注，以软约束项参与效用打分。</p>
          <p><strong>12. 仓位分配</strong>：Top 组合按效用排序分配仓位，总仓位受 Risk Cap 硬约束。</p>
          <p><strong>13. 串关偏好</strong>：效用函数引入 β·√(legs-1) 凸奖励项，β 由串关偏好滑杆参数化。</p>

          <p className="font-semibold text-indigo-600 text-xs tracking-wide mt-2">— 容错串关引擎 —</p>
          <p><strong>14. Conf×Odds 交叉校准</strong>：按赔率区间分桶（低 / 中 / 高 / 超高），分析模型置信度在各赔率段的系统性偏差，经收缩估计修正。</p>
          <p><strong>15. 四级置信度梯度</strong>：强洞察（≥0.72）→ 中洞察（≥0.55）→ 弱洞察（≥0.40）→ 极弱（＜0.40）。阈值由 Walk-Forward tierShift（±0.03）自适应调节。</p>
          <p><strong>16. 容错覆盖设计</strong>：N 场非极弱场次生成 C(N, N-1) + 强势场次 C(N, N-2) 覆盖子集——即"N 中 N-1"与"N 中 N-2"均保有存活票。</p>
          <p><strong>17. 边际 Sharpe 门控</strong>：每增一腿前计算边际 ΔEV/Δσ，低于动态阈值（由回测优化器输出）的弱腿被拒绝加入。</p>
          <p><strong>18. 四层对冲架构</strong>：锚定层（2 串 1 → 回本基线）、扩展层（3 串 1 → 利润增长）、容错覆盖层（保险冗余）、博冷层（小仓位尾部博弈）。</p>
          <p><strong>19. 动态参数优化器</strong>：分析历史 Conf vs 实际结果散点图，自动调优弱腿惩罚系数、锚定加分、覆盖加分、Sharpe 阈值、弱腿上限、置信度阈值六类参数，输出回测可信度评分（0–1）。</p>

          <p className="font-semibold text-indigo-600 text-xs tracking-wide mt-2">— 高阶校准与相关性建模 —</p>
          <p><strong>20. 保序回归校准</strong>：Pool-Adjacent-Violators 算法实现非参数、保单调性概率校准，与线性回归按可靠度加权混合（保序权重上限 60%）。输出 Brier Score 改善度指标。</p>
          <p><strong>21. Entry 相关性矩阵</strong>：从历史结算多腿组合中构建 Entry 类型两两 φ 系数矩阵（收缩估计 K=10）。正相关 → 联合概率乘性上修（{'>'} 独立乘积），负相关 → 乘性下修，修正幅度与概率水平等比例。</p>
          <p><strong>22. Per-Match EJR 监控</strong>：逐场追踪 EJR（模型置信度）vs AJR（赛后评级）的 δ / MAE / RMSE，按 Mode 维度拆分，持续监控预测偏差分布。</p>

          <p className="font-semibold text-indigo-600 text-xs tracking-wide mt-2">— Conf-Surplus 与组合分散化 —</p>
          <p><strong>23. Conf-Surplus 反共识信号</strong>：<code>surplus = conf - (1/odds × 0.95)</code>，量化模型置信度相对去水市场隐含概率的超额。分四级 edge：strong（+12pp）→ moderate（+4pp）→ neutral → negative。Surplus 正向加分融入效用函数（均值 × 0.15 + 峰值 ≥ 12pp 额外 +3%），激励反共识高信心投注。</p>
          <p><strong>24. 锚定分散化惩罚</strong>：MMR 重排序中引入锚定共享惩罚——共享同一最高信心场次的后续组合受 12% × (复用次 / 已选数) 效用扣减，防止单点故障导致全军覆没。</p>
          <p><strong>25. 场次集中度硬上限</strong>：单场出现频率不超过输出组合总数的 60%，强制分散场次维度风险。</p>
          <p><strong>26. 浓度惩罚叠加</strong>：通用 MMR 浓度罚项 +0.5 × 使用比，与锚定惩罚叠加，确保输出组合充分多样化。</p>

          <p className="font-semibold text-indigo-600 text-xs tracking-wide mt-2">— 智能组合包 —</p>
          <p><strong>27. Portfolio Allocation 优化器</strong>：枚举 2–5 方案子集，按复合效用打分（EV 35% · 覆盖率 30% · 独立性 20% · 层级多样 10% · 信心梯度多样 5%）。每个候选子集运行 10k Mini Monte Carlo 评估盈利概率 / 中位收益 / VaR₉₅，去重后输出 Top-10 投资组合。</p>
          <p><strong>28. 50k Monte Carlo 引擎</strong>：Seeded xorshift32 PRNG，逐组合 Bernoulli 采样（使用校准后概率 calibratedP），生成 5 桶 P&L 直方图。输出：盈利概率 / 中位收益 / 95% VaR / 均值 / 最大收益 / 全亏概率。</p>
          <p><strong>29. Soft / Deep Refresh</strong>：Soft Refresh 对 riskPref / mmrLambda / parlayBeta 注入微量 jitter（±4 / ±0.06 / ±0.03），输出同源异构方案。Deep Refresh 收集用户球队偏好，以 ±0.12 效用修正注入生成管线。</p>
          <p><strong>30. 分层选优 + MMR 去重</strong>：按关数分层（2/3/4/5 关）每层 Top-K，Maximal Marginal Relevance 兼顾效用与差异度，叠加覆盖动态加分与 Entry Family 多样化。</p>

          <p className="font-semibold text-indigo-600 text-xs tracking-wide mt-2">— 全参数自适应引擎 —</p>
          <p className="text-xs text-stone-400 italic">系统审计显示参数自适应覆盖率约 55%——概率校准管线高度自适应，但仓位、组合生成、组合评分三大模块中大量参数仍为静态常量。本版将全链路参数纳入 Walk-Forward 校准，自适应覆盖率提升至 ~92%。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ Kelly 仓位校准</p>
          <p><strong>31. 经验因子清除</strong>：移除 Kelly 计算中残留的启发式增益因子 <code>confLift = 0.88 + p × 0.24</code>（该因子在概率已经过 13 级复合校准后仍人为放大仓位），还原纯分数 Kelly <code>f* = (p·b - q) / b / divisor</code>。</p>
          <p><strong>32. Walk-Forward 除数全链路接入</strong>：Kelly 除数由 Walk-Forward 反馈回路动态输出，现已在全部仓位计算路径中接入消费。未就绪时平滑降级为静态配置值。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ 置信度阈值自适应</p>
          <p><strong>33. 数据驱动阈值</strong>：置信度分层阈值（tier2 / tier3）由历史命中率交叉分析驱动——tier2 响应中信心 / 强信心命中率比值，tier3 响应弱信心 / 中信心命中率比值，实现真正的数据自适应边界。</p>
          <p><strong>34. 阈值传递一致性</strong>：统一阈值键名格式，确保 Walk-Forward tierShift 计算出的动态阈值在全链路中被正确消费。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ 自适应权重引擎</p>
          <p><strong>35. Adaptive Weight Auto-Apply</strong>：每次结算周期末尾，系统自动评估权重调整建议（置信度 ≥ 30% 准入），在安全约束内执行微调（单权重 ±0.02，单周期总量 ≤ 0.08），并持久化审计元数据。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ 全参数 Walk-Forward 超参校准</p>
          <p><strong>36. Hyperparameter WF 引擎</strong>：从历史结算数据中自动学习此前全部静态参数，校准覆盖 20+ 参数族群：</p>
          <ul className="list-disc list-inside ml-4 space-y-0.5 text-[12.5px] text-stone-500">
            <li><strong>市场结构</strong>：vig 估计、surplus 阈值边界、surplus bonus 缩放系数</li>
            <li><strong>分层配额</strong>：core / satellite / covering / moonshot 四层配额，按历史各关数段命中率与收益率加权优化</li>
            <li><strong>MMR 惩罚</strong>：concentration penalty 与锚定共享惩罚系数，从组合多样性与存活率反推</li>
            <li><strong>角色系数</strong>：稳定 / 杠杆 / 中性三角色权重，由角色标签与命中率关联强度决定</li>
            <li><strong>组合优化器</strong>：diversification penalty、学习率与迭代数，基于历史最优组合的风险-收益特征反演</li>
            <li><strong>时序权重</strong>：近期 / 中期 / 基准三档 recency 半衰权重，追踪模型近期表现趋势</li>
            <li><strong>软惩罚</strong>：EV / WinRate / Correlation 三维惩罚系数，基于阈值外方案的历史表现校准</li>
            <li><strong>覆盖衰减</strong>：Coverage boost 初始增益与衰减率，从覆盖组合的边际存活贡献学习</li>
            <li><strong>硬约束与相关性</strong>：弱腿惩罚值、entry 相关性缩放系数、相关性三参数（base / overlapWeight / jaccardWeight）</li>
            <li><strong>组合包配置</strong>：Portfolio 五维评分权重、场次集中度上限、team bias 修正幅度、family bonus 参数</li>
          </ul>
          <p className="mt-1"><strong>37. 可靠度加权混合</strong>：全部校准参数以 <code>reliability = clamp((n-25)/95, 0, 1)</code> 与先验默认值线性插值。25 条数据起步学习，120 条达到满置信——小样本不偏离先验，大样本完全数据驱动。</p>
          <p><strong>38. 全链路参数传递</strong>：校准后的 <code>comboHyperparams</code> 经 <code>calibrationContext</code> 注入全部下游消费函数（surplus 计算、角色评分、MMR 重排、分层选优、覆盖加分、软惩罚、相关性建模、组合优化、组合包评分共 9 个模块）。任一模块在参数缺失时自动降级为内置默认值，保证零历史数据下系统正常运行。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ 自适应覆盖率</p>
          <p><strong>39. ~92% 参数自适应</strong>：概率校准（13 级管线 + 保序回归 + Conf×Odds + 球队偏差 + 市场融合 + Walk-Forward）、Kelly 仓位（纯分数 + 动态除数）、组合生成（四级阈值 + 分层配额 + Sharpe 门控）、组合评分（surplus + 角色 + MMR + 软惩罚 + 覆盖衰减 + 相关性）、组合包（五维权重 + 集中度上限）均由结算数据自动校准。余 ~8% 为算法超结构常量（学习率、收缩 K 值、迭代上限等），按设计保持固定。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ 组合级回溯学习</p>
          <p><strong>40. Combo Retrospective Engine</strong>：每轮结算后，系统自动回溯比对历史推荐快照与实际结果——按层级（core / satellite / covering / moonshot）统计命中率，追踪锚定场表现与各腿数段分布特征，输出结构性学习信号反馈至下一轮组合生成。</p>
          <p><strong>41. 反共识遗漏检测</strong>：追踪备选池中高 surplus（≥+8pp）但未入选的场次，在结算后校验其实际命中率。若遗漏场次命中率 {'>'} 40%，自动上调 surplus bonus 缩放系数，提升模型对反共识洞察的推荐灵敏度。</p>
          <p><strong>42. 锚定场自适应</strong>：持续统计锚定场（组合内最高置信度场次）的历史命中率。偏离 65% 基准时自动调节锚定加分系数，以可靠度加权平滑（需 ≥3 场锚定样本）。</p>
          <p><strong>43. 腿数配额回溯微调</strong>：对比各腿数段（2/3/4/5 关）的实际命中率与全局均值，对表现优于均值的腿数段上调分层配额，调整幅度随数据量（≤9 期）线性递增。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ 在线学习闭环</p>
          <p><strong>44. 权重实时微调</strong>：每次结算完成后自动触发自适应权重评估与应用，实现模型参数在每批新数据进入时的增量更新。安全约束：单权重 ±0.02，单周期总量 ≤ 0.08。</p>
          <p><strong>45. EJR 诊断管线</strong>：Per-Match EJR 快照（逐场置信度偏差、分 Mode 精度）实时接入校准上下文，为下游校准与 UI 监控提供结构化诊断数据。</p>

          <p className="font-medium text-stone-700 text-xs mt-2 mb-1">▸ 数值精度与模拟保真度</p>
          <p><strong>46. 相关性乘性修正</strong>：Entry 相关性对联合概率的修正从加性（p + adj）改为乘性（p × (1 + adj/p)），使 φ 系数对各概率水平产生等比例影响——加性修正在低概率场景（p ≈ 0.05）会产生 60% 的非线性扭曲，乘性修正消除了这一偏差。</p>
          <p><strong>47. 相关性 Monte Carlo</strong>：MC 模拟中，同一场比赛在多个组合中共享唯一采样结果（per match key → single draw），取代此前各组合独立采样的假设。这使 VaR 与全亏概率准确反映组合间的结构性相关风险。</p>
          <p><strong>48. 余弦退火优化</strong>：Portfolio 权重优化器的投影梯度上升引入余弦退火学习率调度（<code>lr × (0.1 + 0.9 × cos_schedule)</code>），前期快速探索、后期精细收敛，最终解质量提升约 5–15%。</p>
          <p><strong>49. 数值边界防护</strong>：MC 直方图在 P&L 全同值时自动启用退化区间处理（range {'>'} 1e-9 守卫），消除零区间导致的 NaN 索引风险。</p>
          <p><strong>50. PRNG 种子隔离</strong>：xorshift32 种子初始化采用多层哈希（混合组合数量、仓位、赔率与索引偏移），确保不同 portfolio 的 MC 模拟序列充分独立。</p>

          <p className="text-[11px] text-stone-400 mt-3 pt-2 border-t border-stone-100">DuGou Portfolio Optimization Engine v4.9 · Composite Calibration · PAV Isotonic · Learned Context Factors · Walk-Forward Feedback · Entry Correlation (Multiplicative) · Conf-Surplus · Anchor Diversification · Portfolio Allocation (Cosine Annealing) · Correlated Monte Carlo · Full-Spectrum WF Hyperparameter Calibration · Adaptive Weight Auto-Apply · Combo Retrospective Learning</p>
        </div>
      ),
    })
  }

  return (
    <div className="page-shell page-content-wide motion-v2-scope">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">智能组合建议</h2>
        <p className="text-stone-400 text-sm mt-1">基于 Portfolio Optimization 的最优投资方案</p>
      </div>

      <div className={`combo-main-grid mb-6${leftPanelCollapsed ? ' combo-left-collapsed' : ''}`}>
        <div className={`motion-v2-surface glow-card bg-white rounded-2xl border border-stone-100 ${leftPanelCollapsed ? 'px-4 py-4' : 'p-6'} transition-[padding] duration-300`}>
          <div className={`flex items-center justify-between ${leftPanelCollapsed ? 'mb-2' : 'mb-4'}`}>
            <h3 className={`font-medium text-stone-700 ${leftPanelCollapsed ? 'text-[13px]' : ''}`}>今日备选比赛</h3>
            <div className="flex items-center gap-2">
              {!leftPanelCollapsed && (
                <>
                  <button
                    onClick={clearTodayCandidates}
                    disabled={candidateRows.length === 0}
                    className="px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-400 hover:text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="清空今日备选"
                  >
                    <XCircle size={13} />
                  </button>
                  <button onClick={() => navigate('/new')} className="text-xs text-amber-500 hover:text-amber-600 flex items-center gap-1">
                    <Plus size={12} /> 添加比赛
                  </button>
                </>
              )}
              <button
                onClick={() => setLeftPanelCollapsed((p) => !p)}
                className={`p-1.5 rounded-lg text-stone-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors ${leftPanelCollapsed ? 'absolute top-2.5 right-2.5 z-10' : ''}`}
                title={leftPanelCollapsed ? '展开面板' : '收起面板'}
              >
                {leftPanelCollapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
              </button>
            </div>
          </div>

          {!leftPanelCollapsed && analysisFilter && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs">
              <span className="text-stone-600">
                分析联动过滤：{analysisFilter.mode} · Conf {analysisFilter.confBucket} · Odds {analysisFilter.oddsBucket}
              </span>
              <button
                onClick={() => {
                  clearAnalysisFilter()
                  setAnalysisFilter(null)
                }}
                className="text-amber-700 hover:text-amber-800"
              >
                清除
              </button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-stone-500 mb-2">
            <span>已勾选 {selectedMatches.length}/{displayedCandidates.length}</span>
            {!leftPanelCollapsed && displayedCandidates.length > 0 && (
              <button onClick={toggleCheckAll} className="motion-v2-ghost-btn text-amber-600 hover:text-amber-700">
                {allChecked ? '取消全选' : '全选'}
              </button>
            )}
          </div>

          <div className={leftPanelCollapsed ? 'space-y-1' : 'space-y-2'}>
            {displayedCandidates.map((item, i) => {
              const effectiveRole = normalizeRoleTag(matchRoleOverrides[item.key] || item.autoRole)
              const activeRoleMeta = MATCH_ROLE_OPTIONS.find((r) => r.value === effectiveRole)

              return leftPanelCollapsed ? (
                <div
                  key={item.key}
                  onClick={() => toggleCheck(i)}
                  className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg border border-stone-100 hover:border-indigo-200 bg-white hover:bg-indigo-50/20 transition-all cursor-pointer"
                >
                  <div className={`custom-checkbox flex-shrink-0 ${checkedMatches[i] ? 'checked' : ''}`} />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-stone-700 truncate flex-1">{item.match}</p>
                    <span className={`px-1.5 py-[1px] rounded border text-[9px] font-medium flex-shrink-0 ${activeRoleMeta?.tone || 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                      {MATCH_ROLE_COMPACT_LABEL[effectiveRole] || '自动'}
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  key={item.key}
                  className="motion-v2-row motion-v2-selectable group flex items-center gap-3 p-3 rounded-xl border border-stone-100 hover:border-indigo-200 bg-white hover:bg-indigo-50/20 transition-all cursor-pointer"
                >
                  <div onClick={() => toggleCheck(i)} className={`custom-checkbox flex-shrink-0 ${checkedMatches[i] ? 'checked' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-stone-700 truncate">{item.match}</p>
                      <span className={`px-1.5 py-[1px] rounded border text-[9px] font-medium flex-shrink-0 ${activeRoleMeta?.tone || 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                        {MATCH_ROLE_COMPACT_LABEL[effectiveRole] || '自动'}
                      </span>
                      {(() => {
                        const tier = classifyConfidenceTier(item.conf)
                        return (
                          <span className={`px-1.5 py-[1px] rounded text-[9px] font-medium flex-shrink-0 ${CONF_TIER_TONES[tier] || 'bg-stone-100 text-stone-500'}`}>
                            {CONF_TIER_LABELS[tier] || '未知'}
                          </span>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-stone-400">
                      <span>Conf <span className="font-medium text-stone-500">{item.conf.toFixed(2)}</span></span>
                      <span>Odds <span className="font-medium italic text-stone-500">{item.odds.toFixed(2)}</span></span>
                      <span className={`font-medium ${item.adjustedEvPercent >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        EV {formatPercent(item.adjustedEvPercent)}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <select
                      value={effectiveRole}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation()
                        const nextValue = event.target.value
                        setMatchRoleOverrides((prev) => {
                          if (nextValue === 'auto') {
                            if (!Object.prototype.hasOwnProperty.call(prev, item.key)) return prev
                            const next = { ...prev }
                            delete next[item.key]
                            return next
                          }
                          return {
                            ...prev,
                            [item.key]: nextValue,
                          }
                        })
                      }}
                      className="h-7 min-w-[76px] rounded-md border border-stone-200 bg-white/85 px-2 text-[11px] font-medium text-stone-600 outline-none focus:border-indigo-300"
                    >
                      <option value="auto">自动</option>
                      {MATCH_ROLE_OPTIONS.map((role) => (
                        <option key={`${item.key}-${role.value}`} value={role.value}>
                          {MATCH_ROLE_COMPACT_LABEL[role.value] || role.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-right flex-shrink-0 min-w-[102px]">
                    <span className="block text-sm font-bold tabular-nums text-stone-700">
                      {item.suggestedAmount > 0 ? `${item.suggestedAmount} rmb` : '-- rmb'}
                    </span>
                  </div>
                </div>
              )
            })}

            {displayedCandidates.length === 0 && (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-stone-400">{analysisFilter ? '当前筛选条件下暂无可用备选比赛' : '暂无可用备选比赛'}</p>
                {dismissedCount > 0 && (
                  <button
                    onClick={restoreDismissedCandidates}
                    className="text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    恢复已清空记录（{dismissedCount}）
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="combo-left-panel-detail mt-6 pt-6 border-t border-stone-100">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-stone-600">Risk Preference</label>
              <span className="text-sm font-medium text-amber-600">{riskPref}%</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-stone-400">保守</span>
              <input
                type="range"
                min="0"
                max="100"
                value={riskPref}
                onChange={(event) => setRiskPref(Number.parseInt(event.target.value, 10))}
                className="flex-1"
              />
              <span className="text-xs text-stone-400">激进</span>
            </div>
            <p className="text-[11px] text-stone-400 mt-2">
              近因 n={calibrationContext.n} · Conf×{calibrationContext.multipliers.conf.toFixed(2)} · FSE×
              {calibrationContext.multipliers.fse.toFixed(2)} · TeamCal {calibrationContext.teamCalibration?.teamCount || 0}队 ·
              MarketLean {(calibrationContext.marketBlend?.marketLean || 0).toFixed(2)} · ConfOdds校准 {(calibrationContext.confOddsCalibration?.reliability || 0).toFixed(2)} · 策略 {activeStrategyMeta.label} · 候选组合{' '}
              {generationSummary.candidateCombos || candidateComboCount}
            </p>
          </div>

          <div className="combo-left-panel-detail flex gap-3 mt-4">
            <button onClick={handleGenerate} className="flex-1 btn-primary btn-hover">
              生成最优组合
            </button>
            <button onClick={handleConfirmChecked} className="flex-1 btn-secondary btn-hover">
              确认投资已勾选
            </button>
          </div>

          <div className="combo-left-panel-detail mt-4 p-4 rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/60 shadow-[0_14px_34px_rgba(16,185,129,0.10)] backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-emerald-600 font-semibold tracking-[0.02em]">串关结构偏好</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    setComboStructure({
                      minLegs: 3,
                      parlayBeta: 0.18,
                      mmrLambda: 0.5,
                      coverageEta: 0.2,
                    })
                  }
                  className="px-2.5 py-1 rounded-md text-[11px] border border-emerald-300/80 bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-600 hover:from-emerald-200 hover:to-teal-200 transition-colors"
                >
                  强串联
                </button>
                <button
                  onClick={() =>
                    setComboStructure({
                      minLegs: 2,
                      parlayBeta: 0.12,
                      mmrLambda: 0.55,
                      coverageEta: 0.15,
                    })
                  }
                  className="px-2.5 py-1 rounded-md text-[11px] border border-stone-200 bg-white/85 text-stone-600 hover:border-emerald-200 hover:text-emerald-600 transition-colors"
                >
                  默认
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-stone-500 rounded-xl border border-emerald-100/80 bg-white/75 px-2.5 py-2 backdrop-blur-[2px]">
                最小关数
                <select
                  value={comboStructure.minLegs}
                  onChange={(e) =>
                    setComboStructure((prev) => ({ ...prev, minLegs: Number(e.target.value) }))
                  }
                  className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-emerald-100 text-xs bg-white/90"
                >
                  <option value={1}>1（含单关）</option>
                  <option value={2}>2（至少2串1）</option>
                  <option value={3}>3（至少3串1）</option>
                  <option value={4}>4（至少4串1）</option>
                </select>
              </label>
              <label className="text-[11px] text-stone-500 rounded-xl border border-emerald-100/80 bg-white/75 px-2.5 py-2 backdrop-blur-[2px]">
                串关偏好 β
                <input
                  type="range"
                  min="0"
                  max="0.35"
                  step="0.01"
                  value={comboStructure.parlayBeta}
                  onChange={(e) =>
                    setComboStructure((prev) => ({ ...prev, parlayBeta: Number(e.target.value) }))
                  }
                  className="mt-1 w-full accent-emerald-500"
                />
                <span className="text-[10px] text-emerald-600/75">{comboStructure.parlayBeta.toFixed(2)}（0=无偏好）</span>
              </label>
              <label className="text-[11px] text-stone-500 rounded-xl border border-emerald-100/80 bg-white/75 px-2.5 py-2 backdrop-blur-[2px]">
                多样性强度 λ
                <input
                  type="range"
                  min="0.25"
                  max="0.85"
                  step="0.05"
                  value={comboStructure.mmrLambda}
                  onChange={(e) =>
                    setComboStructure((prev) => ({ ...prev, mmrLambda: Number(e.target.value) }))
                  }
                  className="mt-1 w-full accent-emerald-500"
                />
                <span className="text-[10px] text-emerald-600/75">{comboStructure.mmrLambda.toFixed(2)}（低=更多样化）</span>
              </label>
              <label className="text-[11px] text-stone-500 rounded-xl border border-emerald-100/80 bg-white/75 px-2.5 py-2 backdrop-blur-[2px]">
                覆盖强度 η
                <input
                  type="range"
                  min="0"
                  max="0.35"
                  step="0.05"
                  value={comboStructure.coverageEta}
                  onChange={(e) =>
                    setComboStructure((prev) => ({ ...prev, coverageEta: Number(e.target.value) }))
                  }
                  className="mt-1 w-full accent-emerald-500"
                />
                <span className="text-[10px] text-emerald-600/75">{comboStructure.coverageEta.toFixed(2)}（高=候选全覆盖）</span>
              </label>
            </div>
            <p className="text-[10px] text-emerald-600/75 mt-2">
              β 提升多关串联的效用分；λ 控制 MMR 去重力度；η 给未覆盖候选加分。
            </p>
            {Object.keys(generationSummary.legsDistribution || {}).length > 0 && (
              <div className="mt-2.5 pt-2.5 border-t border-emerald-200/70">
                <p className="text-[10px] text-emerald-600 mb-1">上次生成关数分布</p>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(generationSummary.legsDistribution)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([legs, count]) => (
                      <span key={legs} className="px-1.5 py-0.5 rounded border border-emerald-200/70 bg-emerald-100/80 text-emerald-600 text-[10px]">
                        {legs}关×{count}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="combo-left-panel-detail mt-4 p-4 rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/78 via-white to-violet-50/62 shadow-[0_14px_34px_rgba(99,102,241,0.10)] backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-indigo-700 font-semibold tracking-[0.02em]">质量阈值过滤（生成前）</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    setQualityFilter((prev) =>
                      sanitizeQualityFilter({
                        ...prev,
                        antiOverlapPercent: 78,
                        minWinRate: 45,
                        maxCorr: 0.65,
                      }),
                    )
                  }
                  className="px-2.5 py-1 rounded-md text-[11px] border border-indigo-300/80 bg-gradient-to-r from-indigo-100 to-violet-100 text-indigo-700 hover:from-indigo-200 hover:to-violet-200 transition-colors"
                >
                  一键强化过滤
                </button>
                <button
                  onClick={() =>
                    setQualityFilter((prev) =>
                      sanitizeQualityFilter({
                        ...DEFAULT_QUALITY_FILTER,
                        minCoverageEnabled: prev.minCoverageEnabled !== false,
                      }),
                    )
                  }
                  className="px-2.5 py-1 rounded-md text-[11px] border border-stone-200 bg-white/85 text-stone-600 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
                >
                  重置
                </button>
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[11px] text-indigo-700/85 mb-1.5 font-medium">组合生成策略</p>
              <div className="grid grid-cols-3 gap-2">
                {COMBO_STRATEGY_DISPLAY_ORDER.map((strategyValue) => {
                  const option = COMBO_STRATEGY_OPTIONS.find((item) => item.value === strategyValue)
                  if (!option) return null
                  const selected = comboStrategy === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => setComboStrategy(option.value)}
                      className={`px-2 py-1.5 rounded-lg text-[11px] border transition-all ${
                        selected
                          ? 'border-violet-300 bg-gradient-to-r from-violet-100 to-indigo-100 text-violet-700 shadow-[0_4px_14px_rgba(139,92,246,0.14)]'
                          : 'border-stone-200 bg-white/90 text-stone-600 hover:border-indigo-200 hover:text-indigo-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-indigo-700/60 mt-1.5">{activeStrategyMeta.desc}</p>
            </div>
            <div className="mt-3.5 pt-3 border-t border-indigo-200/70">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-semibold text-indigo-700/85 tracking-wide">资金分配模式</p>
                <span className="text-[10px] text-indigo-500/60 uppercase tracking-[0.16em]">Allocation</span>
              </div>
              <div className="grid grid-cols-2 gap-2 p-1.5 rounded-xl border border-sky-100/80 bg-gradient-to-r from-sky-50/70 via-white to-emerald-50/65 backdrop-blur-sm">
                {ALLOCATION_MODE_OPTIONS.map((option) => {
                  const selected = allocationMode === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => setAllocationMode(option.value)}
                      className={`rounded-lg border px-2.5 py-2.5 text-left transition-all ${
                        selected
                          ? option.selectedTone
                          : 'border-stone-200/80 bg-white/85 text-stone-600 hover:border-sky-200 hover:bg-sky-50/40'
                      }`}
                    >
                      <p className="text-[12px] font-semibold leading-tight">{option.label}</p>
                      <p className="mt-0.5 text-[10px] leading-tight opacity-90">{option.sub}</p>
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-indigo-700/60 mt-1.5">
                Precision 按 1 rmb 细粒度分配；Balanced 按 10 rmb 递进并优先保障组合覆盖面。
              </p>
            </div>
            <div className="mt-3.5 pt-3 border-t border-indigo-200/70">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] text-indigo-700/85 font-medium">阈值参数</p>
                <button
                  onClick={() =>
                    setQualityFilter((prev) =>
                      sanitizeQualityFilter({
                        ...prev,
                        minCoverageEnabled: !(prev.minCoverageEnabled !== false),
                      }),
                    )
                  }
                  className={`h-6 w-6 inline-flex items-center justify-center rounded-md border transition-all ${
                    minCoverageGateEnabled
                      ? 'border-emerald-300/80 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-stone-300/80 bg-white text-stone-400 hover:border-indigo-300 hover:text-indigo-600'
                  }`}
                  title={minCoverageGateEnabled ? '关闭最小覆盖率硬约束' : '开启最小覆盖率硬约束'}
                >
                  {minCoverageGateEnabled ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <label className="text-[11px] text-stone-500 rounded-xl border border-indigo-100/80 bg-white/78 px-2.5 py-2 backdrop-blur-[2px]">
                  Overlap Aversion %
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={qualityFilter.antiOverlapPercent}
                    onChange={(event) =>
                      setQualityFilter((prev) =>
                        sanitizeQualityFilter({
                          ...prev,
                          antiOverlapPercent: Number(event.target.value),
                        }),
                      )
                    }
                    className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-indigo-100 text-xs text-right bg-white/90"
                  />
                </label>
                <label className="text-[11px] text-stone-500 rounded-xl border border-indigo-100/80 bg-white/78 px-2.5 py-2 backdrop-blur-[2px]">
                  最小胜率 %
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={qualityFilter.minWinRate}
                    onChange={(event) =>
                      setQualityFilter((prev) => ({
                        ...prev,
                        minWinRate: clamp(Number.parseInt(event.target.value || '0', 10), 0, 100),
                      }))
                    }
                    className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-indigo-100 text-xs text-right bg-white/90"
                  />
                </label>
                <label className="text-[11px] text-stone-500 rounded-xl border border-indigo-100/80 bg-white/78 px-2.5 py-2 backdrop-blur-[2px]">
                  最大相关性
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={qualityFilter.maxCorr}
                    onChange={(event) =>
                      setQualityFilter((prev) => ({
                        ...prev,
                        maxCorr: clamp(Number.parseFloat(event.target.value || '0'), 0, 1),
                      }))
                    }
                    className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-indigo-100 text-xs text-right bg-white/90"
                  />
                </label>
                <label className="text-[11px] text-stone-500 rounded-xl border border-indigo-100/80 bg-white/78 px-2.5 py-2 backdrop-blur-[2px]">
                  最小覆盖率 %
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={qualityFilter.minCoveragePercent}
                    onChange={(event) =>
                      setQualityFilter((prev) => ({
                        ...prev,
                        minCoveragePercent: clamp(Number.parseInt(event.target.value || '0', 10), 0, 100),
                      }))
                    }
                    className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-indigo-100 text-xs text-right bg-white/90"
                  />
                </label>
              </div>
              <p className="text-[11px] text-indigo-700/65 mt-2">
                覆盖率按“组合覆盖的候选比赛占比”估计；相关性基于“同源注单集中度”（HHI）估计，值越大越可能同涨同跌。
              </p>
              <div className="mt-3.5 pt-3 border-t border-indigo-200/70">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[11px] font-semibold text-indigo-700/85 tracking-wide">算法求解模式</p>
                  <span className="text-[10px] text-indigo-500/60 uppercase tracking-[0.16em]">Solver</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-1.5 rounded-xl border border-sky-100/80 bg-gradient-to-r from-sky-50/70 via-white to-emerald-50/65 backdrop-blur-sm">
                  {SOLVER_MODE_OPTIONS.map((option) => {
                    const selected = solverMode === option.value
                    return (
                      <button
                        key={option.value}
                        onClick={() => setSolverMode(option.value)}
                        className={`rounded-lg border px-2.5 py-2.5 text-left transition-all ${
                          selected
                            ? option.selectedTone
                            : 'border-stone-200/80 bg-white/85 text-stone-600 hover:border-sky-200 hover:bg-sky-50/40'
                        }`}
                      >
                        <p className="text-[12px] font-semibold leading-tight">{option.label}</p>
                        <p className="mt-0.5 text-[10px] leading-tight opacity-90">{option.sub}</p>
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-indigo-700/60 mt-1.5">
                  当前：{activeSolverMeta.label}。切换后将直接影响生成排序与最终组合包。
                </p>
              </div>
            </div>
          </div>

          <div className="combo-left-panel-detail mt-4 p-4 rounded-2xl border border-sky-200/75 bg-gradient-to-br from-sky-50/82 via-white to-cyan-50/62 shadow-[0_14px_34px_rgba(14,165,233,0.10)] backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-sky-700 font-semibold tracking-[0.02em]">角色结构引导（软约束）</span>
              <div className="flex items-center gap-1.5">
                {Object.entries(MATCH_ROLE_PRESETS).map(([key, preset]) => {
                  const active = rolePreference.preset === key
                  return (
                    <button
                      key={key}
                      onClick={() =>
                        setRolePreference((prev) =>
                          sanitizeRolePreference({
                            ...prev,
                            preset: key,
                            targets: preset.targets,
                          }),
                        )
                      }
                      className={`px-2.5 py-1 rounded-md text-[11px] border transition-all ${
                        active
                          ? 'border-sky-300/90 bg-gradient-to-r from-sky-100 to-cyan-100 text-sky-700 shadow-[0_4px_14px_rgba(14,165,233,0.14)]'
                          : 'border-stone-200 bg-white/90 text-stone-600 hover:border-sky-200 hover:text-sky-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="text-[11px] text-stone-500 block rounded-xl border border-sky-100/80 bg-white/76 px-2.5 py-2 backdrop-blur-[2px]">
              结构引导强度 γ
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.01"
                value={rolePreference.mixStrength}
                onChange={(event) =>
                  setRolePreference((prev) =>
                    sanitizeRolePreference({
                      ...prev,
                      mixStrength: Number(event.target.value),
                    }),
                  )
                }
                className="mt-1 w-full accent-sky-500"
              />
              <span className="text-[10px] text-sky-700/70">
                {rolePreference.mixStrength.toFixed(2)}（0=不引导，越高越贴近你选择的“稳/杠杆/中性”风格）
              </span>
            </label>
            <p className="text-[10px] text-sky-700/80 mt-2">
              该机制只影响打分，不做硬筛选，不会强行锁死总赔率或固定配比。
            </p>
            <div className="mt-2.5 rounded-xl border border-sky-200/70 bg-gradient-to-br from-white/92 to-sky-50/60 px-2.5 py-2 text-[10px] text-stone-500 space-y-1">
              <p>操作解释：先选预设（平衡/稳健底盘/杠杆推进）定义你的大方向。</p>
              <p>γ（结构引导强度）：0 附近几乎不干预，越高越偏向你设定的角色结构。</p>
              <p>逐场角色按钮用于"点杀"某场风格；没把握就用"自动"。</p>
            </div>
          </div>

          {/* ═══ Collapsed Summary Zone (visible only when left panel collapsed) ═══ */}
          <div className="combo-left-panel-summary">
            <div className="mt-2 pt-2 border-t border-stone-100/60 space-y-1 text-[11px] text-stone-500">
              <div className="flex items-center justify-between">
                <span className="text-stone-400">Risk</span>
                <span className="font-semibold text-amber-600">{riskPref}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-400">策略</span>
                <span className="font-medium text-stone-600">{activeStrategyMeta.label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-400">关数</span>
                <span className="font-medium text-stone-600">≥{comboStructure.minLegs}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-400">资金分配</span>
                <span className="font-medium text-stone-600">{allocationMode}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[9px] text-stone-400 font-mono pt-0.5">
                <span>β {comboStructure.parlayBeta.toFixed(2)}</span>
                <span className="text-stone-200">·</span>
                <span>λ {comboStructure.mmrLambda.toFixed(2)}</span>
                <span className="text-stone-200">·</span>
                <span>η {comboStructure.coverageEta.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex gap-2 mt-3.5">
              <button
                onClick={handleConfirmChecked}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-stone-200 text-stone-600 shadow-sm hover:border-indigo-300 hover:text-indigo-600 hover:shadow-[0_2px_8px_rgba(99,102,241,0.12)] hover:scale-105 active:scale-95 transition-all"
                title="确认投资已勾选"
              >
                <Check size={15} strokeWidth={2.5} />
              </button>
              <button
                onClick={handleGenerate}
                className="h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-[12px] font-medium whitespace-nowrap shadow-[0_2px_8px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_14px_rgba(99,102,241,0.45)] hover:scale-[1.02] active:scale-95 transition-all"
                title="生成最优组合"
              >
                <Sparkles size={15} strokeWidth={2} />
                <span>生成最优组合</span>
              </button>
            </div>
          </div>
        </div>

        {/* ═══ 智能组合包 Hero Card ═══ */}
        <div className="motion-v2-surface glow-card bg-white rounded-2xl border border-stone-100 p-6 relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-indigo-500" />
              <h3 className="font-medium text-stone-700">智能组合包</h3>
              {recommendations.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 font-medium">
                  {recommendations.length} 方案
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleSoftRefresh}
                disabled={recommendations.length === 0}
                className="p-1.5 rounded-lg text-stone-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="重新生成（微调系数）"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => setShowDeepRefresh((v) => !v)}
                disabled={waitlistTeams.length === 0}
                className="p-1.5 rounded-lg text-stone-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="深度调整（球队偏好）"
              >
                <SlidersHorizontal size={14} />
              </button>
            </div>
          </div>

          {/* Deep Refresh Floating Panel */}
          {showDeepRefresh && (
            <div className="absolute right-4 top-14 z-50 w-[320px] rounded-2xl border border-sky-200/60 bg-sky-50/80 backdrop-blur-xl shadow-2xl p-4 animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-sky-700">球队偏好调整</p>
                <button onClick={() => setShowDeepRefresh(false)} className="text-[11px] text-sky-400 hover:text-sky-600">关闭</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider mb-1.5">少一点</p>
                  <div className="flex flex-wrap gap-1">
                    {waitlistTeams.map((t) => (
                      <button
                        key={`less-${t}`}
                        onClick={() => setLessTeams((prev) => { const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next })}
                        className={`px-2 py-1 rounded-lg text-[11px] transition-all ${
                          lessTeams.has(t)
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'bg-white/70 border border-sky-200/60 text-stone-600 hover:border-rose-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider mb-1.5">多一点</p>
                  <div className="flex flex-wrap gap-1">
                    {waitlistTeams.map((t) => (
                      <button
                        key={`more-${t}`}
                        onClick={() => setMoreTeams((prev) => { const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next })}
                        className={`px-2 py-1 rounded-lg text-[11px] transition-all ${
                          moreTeams.has(t)
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-white/70 border border-sky-200/60 text-stone-600 hover:border-emerald-300'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={handleDeepRefreshCommit}
                disabled={lessTeams.size === 0 && moreTeams.size === 0}
                className="w-full mt-3 py-2 rounded-xl text-xs font-medium text-white bg-[linear-gradient(90deg,#10b981,#14b8a6)] hover:bg-[linear-gradient(90deg,#059669,#0f766e)] transition-all disabled:cursor-not-allowed disabled:bg-emerald-100 disabled:text-emerald-400 disabled:border disabled:border-emerald-200/70 shadow-sm"
              >
                应用偏好并重新生成
              </button>
            </div>
          )}

          {/* Portfolio Allocation Optimizer */}
          {portfolioAllocations.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-gradient-to-br from-indigo-50/60 to-violet-50/30 border border-indigo-100">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">建议投资组合</p>
                <button
                  onClick={toggleExpandAllPortfolio}
                  className="motion-v2-ghost-btn text-[10px] px-2 py-1 rounded-md border border-indigo-200/70 bg-white/70 text-indigo-600 hover:bg-white transition-colors"
                >
                  {portfolioAllocations.every((_, idx) => expandedPortfolioIdxSet.has(idx)) ? '全部收起' : '一键展开'}
                </button>
              </div>
              <div className="space-y-1.5">
                {(showAllPortfolios ? portfolioAllocations : portfolioAllocations.slice(0, 6)).map((alloc, aIdx) => {
                  const allocKey = String(alloc?.portfolioKey || `portfolio-${aIdx + 1}`)
                  const selectedCoverageTargetKeys = new Set(
                    selectedMatches
                      .map((m) => getPortfolioCoverageKey(m))
                      .filter(Boolean),
                  )
                  const coveredKeysForHeader = new Set()
                  alloc.combos.forEach((combo) => {
                    ;(combo.subset || []).forEach((leg) => {
                      const mk = getPortfolioCoverageKey(leg)
                      if (mk) coveredKeysForHeader.add(mk)
                    })
                  })
                  const coverageTotal =
                    selectedCoverageTargetKeys.size > 0
                      ? selectedCoverageTargetKeys.size
                      : Math.max(0, Number(alloc.totalMatches) || 0)
                  const coverageCovered =
                    selectedCoverageTargetKeys.size > 0
                      ? [...selectedCoverageTargetKeys].filter((key) => coveredKeysForHeader.has(key)).length
                      : Math.max(0, Number(alloc.covered) || 0)
                  const coverageRatioDisplay = coverageTotal > 0 ? coverageCovered / coverageTotal : 0
                  const portfolioExposureText = Number(alloc.totalInvest || 0) > 0
                    ? `${Math.round(Number(alloc.totalInvest || 0))} rmb`
                    : `理论${Number(alloc.totalTheoreticalWeightPct || 0).toFixed(1)}%`

                  return (
                  <div key={allocKey}>
                    <div
                      onClick={() => togglePortfolioExpand(aIdx)}
                      className="motion-v2-row flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/70 border border-indigo-100/60 cursor-pointer hover:bg-white transition-all"
                    >
                      {(() => {
                        const hasPinned = portfolioAllocations[0]?.pinned
                        const isFirstNonPinned = hasPinned ? aIdx === 1 : aIdx === 0
                        const rank = hasPinned ? aIdx : aIdx + 1 // rank among non-pinned (1-based)
                        if (alloc.pinned) return (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}>定制</span>
                        )
                        if (isFirstNonPinned) return (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500 text-white">最优</span>
                        )
                        return (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600">#{rank}</span>
                        )
                      })()}
                      <span className="text-[13px] font-medium text-stone-700 flex-1">
                        组合 {alloc.label}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-stone-500">
                        <span>覆盖{coverageCovered}/{coverageTotal}场</span>
                        <span className="text-emerald-600 font-medium">EV {alloc.weightedEv}%</span>
                        <span>{portfolioExposureText}</span>
                      </div>
                      <svg className={`w-3 h-3 text-stone-400 transition-transform ${expandedPortfolioIdxSet.has(aIdx) ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none">
                        <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    {expandedPortfolioIdxSet.has(aIdx) && (
                      <div className="mt-2 rounded-2xl overflow-hidden animate-fade-in" style={{ background: 'linear-gradient(135deg, rgba(249,250,255,0.95) 0%, rgba(255,255,255,0.92) 50%, rgba(245,248,255,0.95) 100%)', backdropFilter: 'blur(16px) saturate(120%)', border: '1px solid rgba(99,102,241,0.08)', boxShadow: '0 4px 20px -4px rgba(99,102,241,0.10), inset 0 1px 0 rgba(255,255,255,0.8)' }}>
                        {/* ─── Coverage info bar ─── */}
                        {(() => {
                          const coveredKeys = new Set()
                          alloc.combos.forEach((combo) => {
                            ;(combo.subset || []).forEach((leg) => {
                              const mk = getPortfolioCoverageKey(leg)
                              if (mk) coveredKeys.add(mk)
                            })
                          })
                          const entryLabel = (e) => {
                            if (!e) return 'vs'
                            return e.trim()
                          }
                          const isFullCoverage = coverageTotal > 0 && coverageCovered >= coverageTotal
                          return (
                            <div className="px-4 pt-3 pb-1">
                              <div className={`inline-flex flex-wrap gap-1.5 ${isFullCoverage ? 'px-2.5 py-1.5 rounded-xl' : ''}`}
                                style={isFullCoverage ? { background: 'linear-gradient(135deg, rgba(16,185,129,0.05) 0%, rgba(52,211,153,0.07) 100%)' } : undefined}
                              >
                                {selectedMatches.map((m, mIdx) => {
                                  const mk = getPortfolioCoverageKey(m)
                                  const isCovered = coveredKeys.has(mk)
                                  return (
                                    <span key={mk || `coverage-${aIdx}-${mIdx}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${
                                      isFullCoverage
                                        ? 'text-stone-300 border border-stone-100/50'
                                        : isCovered
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                          : 'bg-stone-100/60 text-stone-400 border border-stone-200/50'
                                    }`}>
                                      <span className={isFullCoverage ? '' : 'font-semibold'}>{m.homeTeam || '?'}</span>
                                      <span className={isFullCoverage ? 'text-stone-200' : isCovered ? 'text-emerald-500/70' : 'text-stone-300'}>{entryLabel(m.entry)}</span>
                                      <span className={isFullCoverage ? '' : 'font-semibold'}>{m.awayTeam || '?'}</span>
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })()}

                        {/* ─── Combo team breakdown (primary, large) ─── */}
                        <div className="p-4 space-y-2.5">
                          {alloc.combos.map((combo, cIdx) => {
                            const cLayerTag = combo.explain?.ftLayerTag
                            const comboOrigIdx = alloc.indices?.[cIdx]
                            return (
                              <div key={cIdx} className="combo-portfolio-card p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <div className="flex items-center gap-2.5">
                                    <span className="text-[13px] font-bold text-indigo-600">组合 {comboOrigIdx != null ? comboOrigIdx + 1 : cIdx + 1}</span>
                                    {cLayerTag && (
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${
                                        cLayerTag === 'core' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/60'
                                          : cLayerTag === 'covering' ? 'bg-teal-50 text-teal-600 border border-teal-200/60'
                                          : cLayerTag === 'satellite' ? 'bg-sky-50 text-sky-600 border border-sky-200/60'
                                          : 'bg-violet-50 text-violet-600 border border-violet-200/60'
                                      }`}>
                                        {cLayerTag === 'core' ? '锚定' : cLayerTag === 'covering' ? '容错' : cLayerTag === 'satellite' ? '扩展' : '博冷'}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-[13px] font-mono font-semibold text-stone-500">×{Number(combo.combinedOdds || combo.odds || 0).toFixed(1)}</span>
                                    <span className="text-[13px] font-bold text-stone-800">{combo.allocation}</span>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {(combo.subset || []).map((leg, li) => (
                                    <div key={li} className="combo-team-pill px-3 py-2 flex items-center gap-1.5">
                                      <span className="text-[13px] font-semibold text-stone-800">{leg.homeTeam}</span>
                                      <span className="text-[11px] text-indigo-400/70 font-medium">{translateEntry(leg.entry) || 'vs'}</span>
                                      <span className="text-[13px] font-semibold text-stone-800">{leg.awayTeam}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* ─── Fault Tolerance Matrix (Interactive) ─── */}
                        {(() => {
                          const ftMatches = []
                          const ftMatchSet = new Set()
                          alloc.combos.forEach((combo) => {
                            ;(combo.subset || []).forEach((leg) => {
                              const mk = leg.key || `${leg.homeTeam}-${leg.awayTeam}`
                              if (!ftMatchSet.has(mk)) {
                                ftMatchSet.add(mk)
                                ftMatches.push({ key: mk, label: `${leg.homeTeam || '?'} vs ${leg.awayTeam || '?'}`, shortLabel: leg.homeTeam || mk.split('-')[0] })
                              }
                            })
                          })
                          if (ftMatches.length < 2) return null
                          const comboMatchSets = alloc.combos.map((combo) => {
                            const s = new Set()
                            ;(combo.subset || []).forEach((leg) => s.add(leg.key || `${leg.homeTeam}-${leg.awayTeam}`))
                            return s
                          })
                          const overridesForThis = ftCellOverrides[allocKey] || {}
                          const isDirty = ftDirtyPortfolios.has(allocKey) && Object.keys(overridesForThis).length > 0
                          return (
                            <div className="px-4 pb-2">
                              <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-[0.1em] mb-2">容错依赖矩阵</p>
                              <div className="overflow-x-auto rounded-xl" style={{ background: 'rgba(255,255,255,0.5)' }}>
                                <table className="w-full text-[11px] border-collapse">
                                  <thead>
                                    <tr>
                                      <th className="text-left py-1.5 px-2 text-[10px] text-stone-400 font-medium sticky left-0 bg-white/90 z-10 min-w-[100px]">当…翻车时</th>
                                      {ftMatches.map((m) => (
                                        <th key={m.key} className="py-1.5 px-1.5 text-[10px] text-stone-500 font-medium text-center whitespace-nowrap">{m.shortLabel}</th>
                                      ))}
                                      <th className="w-7" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ftMatches.map((rowMatch, ri) => {
                                      // Count reds in this row
                                      const redCount = ftMatches.filter((cm, ci) => {
                                        if (ri === ci) return false
                                        return !comboMatchSets.some((cs) => cs.has(cm.key) && !cs.has(rowMatch.key))
                                      }).length
                                      return (
                                      <tr key={rowMatch.key} className="border-t border-stone-100/60">
                                        <td className="py-1.5 px-2 text-stone-600 font-medium sticky left-0 bg-white/90 z-10 whitespace-nowrap">{rowMatch.shortLabel}</td>
                                        {ftMatches.map((colMatch, ci) => {
                                          if (ri === ci) {
                                            return <td key={colMatch.key} className="py-1.5 px-1.5 text-center"><span className="inline-block w-5 h-5 rounded-md bg-stone-100 text-stone-300 text-[10px] leading-5">—</span></td>
                                          }
                                          const survives = comboMatchSets.some((cs) => cs.has(colMatch.key) && !cs.has(rowMatch.key))
                                          const patchKey = `${rowMatch.key}|${colMatch.key}`
                                          const isFlipped = patchKey in overridesForThis
                                          const displayGreen = isFlipped ? !survives : survives
                                          return (
                                            <td key={colMatch.key} className="py-1.5 px-1.5 text-center">
                                              <button
                                                onClick={() => handleFtCellToggle(allocKey, rowMatch.key, colMatch.key, survives)}
                                                className="ft-cell-btn inline-flex items-center justify-center w-5 h-5 rounded-md cursor-pointer transition-all duration-200 ease-out hover:scale-110 active:scale-95"
                                                style={{ background: displayGreen ? 'rgba(236,253,245,1)' : isFlipped ? 'rgba(236,253,245,0.7)' : 'rgba(255,241,242,1)', border: isFlipped ? '1.5px solid rgba(99,102,241,0.35)' : '1px solid transparent' }}
                                                title={displayGreen ? `${colMatch.shortLabel} 存活` : `${colMatch.shortLabel} 全军覆没 — 点击以要求容错`}
                                              >
                                                {displayGreen ? (
                                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-emerald-500"><path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                ) : (
                                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-rose-400"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                                )}
                                              </button>
                                            </td>
                                          )
                                        })}
                                        <td className="py-1.5 pl-1.5 pr-1">
                                          {redCount > 0 && (
                                            <button
                                              onClick={() => handleFtRowReduce(allocKey, rowMatch.key, ftMatches, comboMatchSets)}
                                              className="ft-dissolve-bar group flex items-center h-5 cursor-pointer"
                                              title={`降低 ${rowMatch.shortLabel} 的依赖性`}
                                            >
                                              <span className="ft-dissolve-rose" />
                                              <span className="ft-dissolve-emerald" />
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              {isDirty && (
                                <button
                                  onClick={() => handleFtConfirmRegenerate(allocKey)}
                                  className="w-full mt-2 py-1.5 rounded-xl text-[11px] font-medium transition-all duration-200"
                                  style={{
                                    background: 'linear-gradient(90deg, rgba(16,185,129,0.08) 0%, rgba(20,184,166,0.08) 100%)',
                                    border: '1px solid rgba(16,185,129,0.2)',
                                    color: '#059669',
                                  }}
                                >
                                  基于容错偏好重新计算 ({Object.keys(overridesForThis).length} 项调整)
                                </button>
                              )}
                            </div>
                          )
                        })()}

                        {/* ─── Stats ribbon (compact, below combos) ─── */}
                        <div className="px-4 pb-4 space-y-2">
                          <div className="grid grid-cols-4 gap-1.5">
                            <div className="text-center py-2 px-1 rounded-xl bg-indigo-50/60">
                              <p className="text-[9px] text-stone-400 uppercase tracking-wider">覆盖率</p>
                              <p className="font-bold text-indigo-600 text-[15px] mt-0.5">{(coverageRatioDisplay * 100).toFixed(0)}%</p>
                            </div>
                            <div className="text-center py-2 px-1 rounded-xl bg-violet-50/50">
                              <p className="text-[9px] text-stone-400 uppercase tracking-wider">层多样</p>
                              <p className="font-bold text-violet-600 text-[15px] mt-0.5">{(alloc.layerDiv * 100).toFixed(0)}%</p>
                            </div>
                            <div className="text-center py-2 px-1 rounded-xl bg-sky-50/50">
                              <p className="text-[9px] text-stone-400 uppercase tracking-wider">独立性</p>
                              <p className="font-bold text-sky-600 text-[15px] mt-0.5">{(alloc.diversityScore * 100).toFixed(0)}%</p>
                            </div>
                            <div className="text-center py-2 px-1 rounded-xl bg-stone-50/80">
                              <p className="text-[9px] text-stone-400 uppercase tracking-wider">效用</p>
                              <p className="font-bold text-stone-700 text-[15px] mt-0.5">{alloc.utility.toFixed(3)}</p>
                            </div>
                          </div>
                          {alloc.mc && (
                            <div className="flex items-center gap-3 text-xs px-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-stone-400">盈利</span>
                                <span className={`font-bold ${alloc.mc.profitProb >= 0.5 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                  {(alloc.mc.profitProb * 100).toFixed(1)}%
                                </span>
                              </div>
                              <span className="text-stone-200">·</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-stone-400">中位</span>
                                <span className={`font-mono font-bold ${alloc.mc.median >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                  {alloc.mc.median >= 0 ? '+' : ''}{alloc.mc.median}
                                </span>
                              </div>
                              <span className="text-stone-200">·</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-stone-400">VaR</span>
                                <span className="text-rose-500 font-mono font-bold">{alloc.mc.var95}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  )
                })}
                {portfolioAllocations.length > 6 && (
                  <button
                    onClick={() => setShowAllPortfolios(v => !v)}
                    className="motion-v2-ghost-btn w-full mt-1 py-1 rounded-lg text-[10px] font-medium text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50/60 transition-all flex items-center justify-center gap-1"
                  >
                    {showAllPortfolios ? (
                      <>收起 <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none"><path d="M3 7.5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></>
                    ) : (
                      <>展开更多 (+{portfolioAllocations.length - 6}) <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none"><path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Package List */}
          {recommendations.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-stone-400">点击左侧「生成最优组合」查看推荐组合包</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-end gap-1.5 -mt-1 mb-1.5">
                <button
                  onClick={() => setShowRecommendationDetailCard((v) => !v)}
                  title={showRecommendationDetailCard ? '隐藏方案详情' : '显示方案详情'}
                  className={`motion-v2-ghost-btn inline-flex items-center justify-center w-7 h-7 rounded-md border backdrop-blur-md transition-colors ${
                    showRecommendationDetailCard
                      ? 'border-emerald-300/80 bg-emerald-50/75 text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_6px_18px_-14px_rgba(16,185,129,0.55)]'
                      : 'border-emerald-200/70 bg-white/75 text-emerald-500 hover:bg-emerald-50/70'
                  }`}
                >
                  <span className="text-[14px] leading-none -translate-y-[0.5px]">↓</span>
                </button>
                <button
                  onClick={toggleExpandAllQuickComboDetails}
                  className="motion-v2-ghost-btn text-[10px] px-2 py-1 rounded-md border border-emerald-200/70 bg-emerald-50/55 text-emerald-700 hover:bg-emerald-50/75 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_18px_-14px_rgba(16,185,129,0.55)] transition-colors"
                >
                  {quickPreviewRecommendations.length > 0 &&
                  quickPreviewRecommendations.every((_, idx) => expandedComboIdxSet.has(idx))
                    ? '全部收起明细'
                    : '一键展开明细'}
                </button>
              </div>
              {quickPreviewRecommendations.map((item, idx) => {
                const selected = Boolean(selectedRecommendationIds[item.id])
                const expanded = expandedComboIdxSet.has(idx)
                const layerTag = item.explain?.ftLayerTag
                const layerDot = layerTag === 'core' ? 'bg-emerald-400'
                  : layerTag === 'covering' ? 'bg-teal-400'
                  : layerTag === 'satellite' ? 'bg-sky-400'
                  : layerTag === 'moonshot' ? 'bg-violet-400' : 'bg-stone-300'
                return (
                  <div key={item.id}>
                    <div
                      className={`motion-v2-row motion-v2-selectable flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                        selected ? 'bg-indigo-50/70 border border-indigo-200' : 'bg-stone-50/50 border border-transparent hover:bg-stone-50'
                      }`}
                    >
                      <span className="text-[11px] text-stone-400 font-mono w-4 shrink-0">{idx + 1}.</span>
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${layerDot}`} />
                      <div className="flex-1 min-w-0" onClick={() => toggleQuickComboExpand(idx)}>
                        <p className="text-[13px] text-stone-700 truncate whitespace-nowrap">
                          {Array.isArray(item.subset) && item.subset.length > 0
                            ? item.subset.map((leg, legIdx) => {
                                const legEntry = String(leg.entry || '').trim()
                                return (
                                  <span key={leg.key || `${leg.homeTeam}-${leg.awayTeam}-${leg.entry}-${legIdx}`} className="inline-flex items-baseline">
                                    {legIdx > 0 && (
                                      <span className="mx-1 text-[13px] font-medium text-stone-800 align-middle">×</span>
                                    )}
                                    <span className="font-medium text-stone-800">{leg.homeTeam || '-'}</span>
                                    {legEntry && (
                                      <span className="ml-0.5 text-[11px] font-medium text-stone-500">
                                        {legEntry}
                                      </span>
                                    )}
                                  </span>
                                )
                              })
                            : item.combo}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-stone-400">
                          <span>{item.legs || item.subset.length}关</span>
                          <span>×{(Number(item.combinedOdds || item.odds || 0)).toFixed(1)}</span>
                          {item.explain?.confTierSummary && item.explain.confTierSummary !== '--' && (
                            <span className="text-stone-500">{item.explain.confTierSummary}</span>
                          )}
                          {layerTag && (
                            <span className={`px-1 py-px rounded text-[9px] font-medium ${
                              layerTag === 'core' ? 'bg-emerald-100 text-emerald-600'
                              : layerTag === 'covering' ? 'bg-teal-100 text-teal-600'
                              : layerTag === 'satellite' ? 'bg-sky-100 text-sky-600'
                              : 'bg-violet-100 text-violet-600'
                            }`}>
                              {layerTag === 'core' ? '锚定' : layerTag === 'covering' ? '容错' : layerTag === 'satellite' ? '扩展' : '博冷'}
                            </span>
                          )}
                          <svg className={`w-2.5 h-2.5 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none">
                            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[12px] font-semibold text-stone-700">{item.allocation}</p>
                        <p className="text-[10px] text-emerald-600">{item.ev}</p>
                      </div>
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleRecommendation(item.id) }}
                        className={`w-3.5 h-3.5 rounded border-2 shrink-0 transition-colors cursor-pointer ${
                          selected ? 'bg-indigo-500 border-indigo-500' : 'border-stone-300'
                        }`}
                      >
                        {selected && (
                          <svg viewBox="0 0 12 12" className="w-full h-full text-white">
                            <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </div>
                    {/* Expandable Detail Panel */}
                    {expanded && (
                      <div className="ml-4 mt-1.5 p-3.5 rounded-xl border border-stone-100/80 animate-fade-in" style={{ background: 'linear-gradient(135deg, rgba(249,250,255,0.92) 0%, rgba(255,255,255,0.88) 100%)' }}>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          <div className="text-center py-1.5 rounded-lg bg-sky-50/60">
                            <p className="text-[9px] text-stone-400 mb-0.5">命中率</p>
                            <p className="font-bold text-sky-600 text-[12px]">{item.winRate}</p>
                          </div>
                          <div className="text-center py-1.5 rounded-lg bg-indigo-50/60">
                            <p className="text-[9px] text-stone-400 mb-0.5">盈利率</p>
                            <p className="font-bold text-indigo-600 text-[12px]">{item.profitWinRate}</p>
                          </div>
                          <div className="text-center py-1.5 rounded-lg bg-violet-50/50">
                            <p className="text-[9px] text-stone-400 mb-0.5">Sharpe</p>
                            <p className="font-bold text-violet-600 text-[12px]">{item.sharpe}</p>
                          </div>
                          <div className="text-center py-1.5 rounded-lg bg-stone-50/80">
                            <p className="text-[9px] text-stone-400 mb-0.5">校准增益</p>
                            <p className={`font-bold text-[12px] ${item.explain.calibGainPp >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                              {item.explain.calibGainPp >= 0 ? '+' : ''}{item.explain.calibGainPp.toFixed(1)}pp
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {(item.subset || []).map((leg, li) => {
                            const cs = leg.confSurplus
                            const surplusVal = cs?.surplus || 0
                            return (
                              <div key={li} className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg bg-white/60 text-[11px]">
                                <span className="text-stone-300 text-[10px] w-4 shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>{li + 1}</span>
                                <span className="font-medium text-stone-800 flex-1 truncate text-[11px]">{leg.homeTeam} vs {leg.awayTeam}</span>
                                <span className="text-indigo-600 font-semibold shrink-0 px-1.5 py-0.5 rounded bg-indigo-50 text-[10px]">{leg.entry || '-'}</span>
                                <span className="text-stone-500 font-semibold shrink-0 text-[11px] tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>@{Number(leg.odds || 0).toFixed(2)}</span>
                                <span className={`font-semibold shrink-0 text-[10px] tracking-tight ${(leg.calibratedP || leg.conf) >= 0.55 ? 'text-emerald-600' : 'text-amber-500'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  P:{((leg.calibratedP || leg.conf) * 100).toFixed(0)}%
                                </span>
                                <span className={`shrink-0 text-[10px] font-medium tracking-tight ${surplusVal >= 0.04 ? 'text-emerald-500' : surplusVal >= -0.03 ? 'text-stone-400' : 'text-rose-400'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {surplusVal >= 0 ? '+' : ''}{(surplusVal * 100).toFixed(0)}pp
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[9px]">
                          <span className="px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-500">相关 {item.explain.corr.toFixed(2)}</span>
                          <span className="px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-500">Conf均 {item.explain.confAvg.toFixed(2)}</span>
                          {item.explain.avgSurplus != null && (
                            <span className={`px-1.5 py-0.5 rounded-md ${item.explain.avgSurplus >= 0.04 ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                              边际 {item.explain.avgSurplus >= 0 ? '+' : ''}{(item.explain.avgSurplus * 100).toFixed(1)}pp
                            </span>
                          )}
                          {item.explain.roleMixBonus > 0 && <span className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-600">角色+{item.explain.roleMixBonus.toFixed(2)}</span>}
                          {item.explain.familyDiversity > 0.6 && <span className="px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-600">多样{(item.explain.familyDiversity * 100).toFixed(0)}%</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {recommendations.length > QUICK_PREVIEW_RECOMMENDATION_COUNT && (
                <button
                  onClick={() => {
                    setShowAllQuickRecommendations((prev) => !prev)
                    setExpandedComboIdxSet(new Set())
                  }}
                  className="w-full pt-1 text-[10px] text-center text-indigo-500 hover:text-indigo-600"
                >
                  {showAllQuickRecommendations
                    ? `收起到前 ${QUICK_PREVIEW_RECOMMENDATION_COUNT} 个方案 ▲`
                    : `一键展开全部 ${recommendations.length} 个方案 ▼`}
                </button>
              )}
            </div>
          )}

          {/* Package Stats */}
          {recommendations.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-stone-50 p-2 text-center">
                <p className="text-[10px] text-stone-400">总投入</p>
                <p className="text-sm font-semibold text-stone-700">{generationSummary.totalInvest}<span className="text-[10px] font-normal text-stone-400 ml-0.5">rmb</span></p>
              </div>
              <div className="rounded-lg bg-stone-50 p-2 text-center">
                <p className="text-[10px] text-stone-400">预期收益</p>
                <p className="text-sm font-semibold text-emerald-600">{formatPercent(generationSummary.expectedReturnPercent)}</p>
              </div>
              <div className="rounded-lg bg-stone-50 p-2 text-center">
                <p className="text-[10px] text-stone-400">回测可信度</p>
                <p className={`text-sm font-semibold ${(generationSummary.dynParams?.backtestReliability || 0) >= 0.5 ? 'text-emerald-600' : 'text-amber-500'}`}>
                  {((generationSummary.dynParams?.backtestReliability || 0) * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          )}

          {/* Tier Distribution Pills */}
          {generationSummary.ftTiers && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {Object.entries(generationSummary.ftTiers).map(([tier, matches]) => (
                <span key={tier} className={`px-1.5 py-0.5 rounded text-[10px] ${CONF_TIER_TONES[tier] || 'bg-stone-100 text-stone-500'}`}>
                  {CONF_TIER_LABELS[tier] || tier}: {Array.isArray(matches) ? matches.length : matches}场
                </span>
              ))}
            </div>
          )}

          {/* Monte Carlo Simulation Panel */}
          {mcSimResult && (
            <div className="mt-4 p-3 rounded-xl bg-gradient-to-br from-stone-50 to-indigo-50/30 border border-stone-100">
              <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
                蒙特卡洛模拟 · {mcSimResult.iterations.toLocaleString()}次
              </p>
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-stone-400">盈利概率</span>
                  <span className={`font-semibold ${mcSimResult.profitProb >= 0.5 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {(mcSimResult.profitProb * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">中位收益</span>
                  <span className={`font-mono ${mcSimResult.median >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {mcSimResult.median >= 0 ? '+' : ''}{mcSimResult.median}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">平均收益</span>
                  <span className={`font-mono ${mcSimResult.mean >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {mcSimResult.mean >= 0 ? '+' : ''}{mcSimResult.mean}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">95%VaR</span>
                  <span className="text-rose-500 font-mono">{mcSimResult.var95}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">最大收益</span>
                  <span className="text-emerald-600 font-mono">+{mcSimResult.maxPnl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">全亏概率</span>
                  <span className="text-rose-500 font-mono">{(mcSimResult.allLoseProb * 100).toFixed(1)}%</span>
                </div>
              </div>
              {/* Mini Histogram */}
              <div className="mt-2.5 flex items-end gap-0.5 h-8">
                {mcSimResult.histogram.map((bucket, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className={`w-full rounded-sm transition-all ${bucket.min >= 0 ? 'bg-emerald-300' : 'bg-rose-300'}`}
                      style={{ height: `${Math.max(2, bucket.pct * 100)}%` }}
                    />
                    <span className="text-[8px] text-stone-400 leading-none">
                      {bucket.min >= 0 ? '+' : ''}{Math.round(bucket.min)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Adopt Preview (compact) */}
          {adoptPreview.ready && (
            <div className="mt-3 p-2.5 rounded-xl border border-stone-100 bg-white space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-stone-400">总暴露</span>
                <span className="text-stone-700 font-medium">{Math.round(adoptPreview.totalInvest)} rmb</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-400">集中度</span>
                <span className={adoptPreview.concentration >= 0.45 ? 'text-rose-500' : 'text-emerald-600'}>
                  {(adoptPreview.concentration * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-400">最坏回撤</span>
                <span className={drawdownExceeded ? 'text-rose-600 font-semibold' : 'text-rose-500'}>
                  -{Math.round(adoptPreview.worstLoss)} rmb ({adoptPreview.worstDrawdownPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          )}

          <button onClick={handleAdopt} className="w-full mt-4 btn-primary btn-hover">
            采纳已选方案
          </button>
        </div>
      </div>

      {/* ═══ Detailed Recommendations (moved from hero) ═══ */}
      {recommendations.length > 0 && showRecommendationDetailCard && (
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">方案详情</h3>
            <span className="text-xs text-stone-400">Top {recommendations.length}</span>
          </div>
          <div className="space-y-3">
            {displayedRecommendations.map((item) => {
              const selected = Boolean(selectedRecommendationIds[item.id])
              return (
                <div
                  key={`detail-${item.id}`}
                  onClick={() => toggleRecommendation(item.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer lift-card ${
                    selected ? 'border-indigo-200 bg-indigo-50/40' : 'border-stone-100 bg-stone-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${selected ? 'text-indigo-600' : 'text-stone-500'}`}>{item.tierLabel}</span>
                      <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px] font-medium">{item.legs || item.subset.length}关</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-800">{item.allocation}</span>
                      <div className={`custom-checkbox ${selected ? 'checked' : ''}`} />
                    </div>
                  </div>
                  <p className="text-sm text-stone-700 mb-2">{item.combo}</p>
                  <div className="flex gap-4 text-xs text-stone-500">
                    <span>EV: <span className="text-emerald-600 font-medium">{item.ev}</span></span>
                    <span>Hit: <span className="font-semibold text-sky-600">{item.winRate}</span></span>
                    <span>Profit: <span className="font-semibold text-indigo-600">{item.profitWinRate}</span></span>
                    <span>Sharpe: <span className="font-semibold text-violet-600">{item.sharpe}</span></span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded-full bg-stone-200/70 text-stone-600">Conf {item.explain.confAvg.toFixed(2)}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">盈利 {item.explain.profitWinPct.toFixed(1)}%</span>
                    <span className={`px-1.5 py-0.5 rounded-full ${item.explain.calibGainPp >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                      校准 {item.explain.calibGainPp >= 0 ? '+' : ''}{item.explain.calibGainPp.toFixed(1)}pp
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">相关 {item.explain.corr.toFixed(2)}</span>
                    {item.explain.ftLayerTag && (
                      <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                        item.explain.ftLayerTag === 'core' ? 'bg-emerald-100 text-emerald-700'
                        : item.explain.ftLayerTag === 'covering' ? 'bg-teal-100 text-teal-700'
                        : item.explain.ftLayerTag === 'satellite' ? 'bg-sky-100 text-sky-700'
                        : 'bg-violet-100 text-violet-700'
                      }`}>
                        {item.explain.ftLayerTag === 'core' ? '锚定层' : item.explain.ftLayerTag === 'covering' ? '容错覆盖' : item.explain.ftLayerTag === 'satellite' ? '扩展层' : '博冷层'}
                      </span>
                    )}
                    {item.explain.confTierSummary && item.explain.confTierSummary !== '--' && (
                      <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-600">置信 {item.explain.confTierSummary}</span>
                    )}
                    {item.explain.tierPenalty > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600">弱罚 -{item.explain.tierPenalty}</span>
                    )}
                    {item.explain.coveringBonus > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">容错+{item.explain.coveringBonus}</span>
                    )}
                    {item.coverageInjected && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">覆盖补位</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {recommendations.length > QUICK_PREVIEW_RECOMMENDATION_COUNT && !showAllRecommendations && (
            <button
              onClick={() => setShowAllRecommendations(true)}
              className="w-full mt-2.5 py-1.5 text-[13px] text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
            >
              展开全部 {recommendations.length} 个方案 ▼
            </button>
          )}
          {recommendations.length > QUICK_PREVIEW_RECOMMENDATION_COUNT && showAllRecommendations && (
            <button
              onClick={() => setShowAllRecommendations(false)}
              className="w-full mt-2.5 py-1.5 text-[13px] text-stone-500 hover:text-stone-700 hover:bg-stone-50 rounded-xl transition-all"
            >
              收起 ▲
            </button>
          )}

          {/* Generation Stats + Dynamic Params */}
          <div className="mt-4 p-3.5 rounded-xl bg-stone-50 border border-stone-100 space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-stone-400">阈值通过 / 候选</span><span className="text-stone-600 font-medium">{generationSummary.qualifiedCombos} / {generationSummary.candidateCombos}</span></div>
            <div className="flex justify-between"><span className="text-stone-400">被过滤</span><span className="text-stone-500">{generationSummary.filteredOutCombos}</span></div>
            <div className="flex justify-between"><span className="text-stone-400">覆盖补位</span><span className="text-stone-500">{generationSummary.coverageInjectedCombos}</span></div>
            <div className="flex justify-between"><span className="text-stone-400">未覆盖场次</span><span className={generationSummary.uncoveredMatches > 0 ? 'text-rose-500' : 'text-emerald-600'}>{generationSummary.uncoveredMatches}</span></div>
            {generationSummary.dynParams && (
              <div className="pt-2 mt-1 border-t border-stone-200 space-y-1">
                <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">动态回测参数</p>
                <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                  <div className="flex justify-between"><span className="text-stone-400">弱腿罚</span><span className="font-mono text-stone-600">{generationSummary.dynParams.tierPenaltyPerWeakLeg?.toFixed(3)}</span></div>
                  <div className="flex justify-between"><span className="text-stone-400">锚定</span><span className="font-mono text-stone-600">{generationSummary.dynParams.tierAnchorBonus?.toFixed(3)}</span></div>
                  <div className="flex justify-between"><span className="text-stone-400">覆盖</span><span className="font-mono text-stone-600">{generationSummary.dynParams.coveringBonus?.toFixed(3)}</span></div>
                  <div className="flex justify-between"><span className="text-stone-400">Sharpe</span><span className="font-mono text-stone-600">{generationSummary.dynParams.marginalSharpeThreshold?.toFixed(3)}</span></div>
                  <div className="flex justify-between"><span className="text-stone-400">弱腿上限</span><span className="font-mono text-stone-600">{generationSummary.dynParams.maxWeakLegsPerCombo}</span></div>
                  <div className="flex justify-between"><span className="text-stone-400">可信度</span><span className={`font-mono ${(generationSummary.dynParams.backtestReliability || 0) >= 0.5 ? 'text-emerald-600' : 'text-amber-500'}`}>{((generationSummary.dynParams.backtestReliability || 0) * 100).toFixed(0)}%</span></div>
                </div>
                {generationSummary.dynParams.confTierThresholds && (
                  <p className="text-[9px] text-stone-400 mt-1">T1≥{generationSummary.dynParams.confTierThresholds.tier1?.toFixed(2)} | T2≥{generationSummary.dynParams.confTierThresholds.tier2?.toFixed(2)} | T3≥{generationSummary.dynParams.confTierThresholds.tier3?.toFixed(2)}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="combo-secondary-grid mb-6">
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">单组合方案排序</h3>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border border-emerald-200/80 bg-[linear-gradient(120deg,rgba(236,253,245,0.86),rgba(255,255,255,0.9)_52%,rgba(240,253,250,0.84))] text-[11px] font-medium text-emerald-700 tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_10px_22px_-18px_rgba(16,185,129,0.5)] backdrop-blur-[1px]">
              按效用 U 排序
              <Sparkles size={12} strokeWidth={1.9} className="text-emerald-500" />
            </span>
          </div>
          {rankingRows.length === 0 ? (
            <p className="text-sm text-stone-400">先点击「生成最优组合」查看 Top 排序。</p>
          ) : (
            <div className="space-y-2">
              {rankingRows.map((row) => (
                <div key={`rank-${row.id}`} className="flex items-center gap-3 p-2.5 rounded-lg border border-stone-100 bg-stone-50/70">
                  <div className="w-7 h-7 rounded-lg bg-stone-200/70 text-stone-700 text-xs font-semibold flex items-center justify-center">
                    {row.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-700 truncate">{row.combo}</p>
                    <p className="text-[11px] text-stone-400">
                      <span className="text-violet-600 font-medium">{row.legs || row.subset.length}关</span> · Odds {row.combinedOdds.toFixed(2)} · Hit {row.winRate} · Profit {row.profitWinRate}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-stone-500">EV / σ</p>
                    <p className="text-sm font-semibold text-stone-700">{row.ev} / {row.sigma.toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 relative">
          {showRiskProbe && (
            <div className="absolute right-6 top-14 z-30 w-[20rem] rounded-xl border border-stone-200 bg-white shadow-xl p-3 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-stone-500">Risk Preference 小回测</p>
                <button
                  onClick={() => setShowRiskProbe(false)}
                  className="text-[11px] text-stone-400 hover:text-stone-600"
                >
                  关闭
                </button>
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-stone-500">
                    <th className="py-1.5">Risk</th>
                    <th className="py-1.5">EV</th>
                    <th className="py-1.5">投入</th>
                    <th className="py-1.5">Top Sharpe</th>
                    <th className="py-1.5 text-right"> </th>
                  </tr>
                </thead>
                <tbody>
                  {riskProbeRows.map((row) => (
                    <tr key={`probe-${row.riskPref}`} className={`border-b border-stone-100 ${row.best ? 'bg-amber-50' : ''}`}>
                      <td className="py-1.5">
                        <span className={`font-medium ${row.best ? 'text-amber-700' : 'text-stone-700'}`}>{row.riskPref}%</span>
                      </td>
                      <td className={`py-1.5 ${row.available ? 'text-emerald-600' : 'text-stone-400'}`}>
                        {row.available ? formatPercentProbe(row.evPct) : '--'}
                      </td>
                      <td className="py-1.5 text-stone-600">{row.available ? `${Math.round(row.totalInvest)} rmb` : '--'}</td>
                      <td className="py-1.5 text-violet-700">{row.available ? row.topSharpe.toFixed(2) : '--'}</td>
                      <td className="py-1.5 text-right">
                        {row.best && row.available && row.riskPref !== riskPref ? (
                          <button
                            onClick={() => applyRiskProbeBest(row.riskPref)}
                            className="px-2 py-0.5 rounded-md border border-emerald-300/80 bg-emerald-50 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100/75 transition-colors"
                          >
                            Apply
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-stone-400 mt-2">
                黄底为当前阈值下综合最优档位（EV 优先，Sharpe 次优先）。
              </p>
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">分层投资建议</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRiskProbe((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] border text-[11px] font-medium tracking-[0.02em] backdrop-blur-[1px] transition-all ${
                  showRiskProbe
                    ? 'border-violet-300/85 bg-[linear-gradient(120deg,rgba(237,233,254,0.9),rgba(255,255,255,0.92)_55%,rgba(224,231,255,0.88))] text-violet-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_22px_-18px_rgba(99,102,241,0.55)]'
                    : 'border-violet-200/80 bg-[linear-gradient(120deg,rgba(243,244,255,0.9),rgba(255,255,255,0.9)_55%,rgba(238,242,255,0.84))] text-violet-600 hover:border-violet-300/90 hover:text-violet-700 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_20px_-16px_rgba(99,102,241,0.45)]'
                }`}
              >
                <Sparkles size={12} strokeWidth={1.9} className={showRiskProbe ? 'text-violet-600' : 'text-violet-500'} />
                快速回测 40/50/60
              </button>
            </div>
          </div>

          {layerSummary.length === 0 ? (
            <p className="text-sm text-stone-400">暂无分层结果，生成方案后自动计算。</p>
          ) : (
            <div className="space-y-3">
              {layerSummary.map((layer) => {
                const meta = LAYER_META[layer.layer]
                return (
                  <div key={layer.layer} className="rounded-xl border border-stone-100 bg-stone-50/70 p-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-1 rounded-full ${meta.badge}`}>{layer.layer}</span>
                      <span className="text-xs text-stone-400">{layer.count} 个方案</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-stone-400">建议投入</p>
                        <p className={`font-semibold ${meta.tone}`}>{layer.totalInvest} rmb</p>
                      </div>
                      <div>
                        <p className="text-stone-400">预期收益</p>
                        <p className="font-semibold text-emerald-600">{formatPercent(layer.expectedReturnPercent)}</p>
                      </div>
                      <div>
                        <p className="text-stone-400">平均 Sharpe</p>
                        <p className="font-semibold text-violet-700">{layer.avgSharpe.toFixed(2)}</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-stone-400 mt-1.5">{meta.desc}</p>
                  </div>
                )
              })}
            </div>
          )}

          {matchExposure.length > 0 && (
            <div className="mt-4 pt-4 border-t border-stone-100">
              <p className="text-xs text-stone-500 mb-2">已选方案仓位集中度（Top 5）</p>
              <div className="space-y-1.5">
                {matchExposure.map((item) => (
                  <div key={item.match} className="flex items-center justify-between text-xs">
                    <span className="text-stone-600 truncate mr-3">{item.match}</span>
                    <span className="text-stone-500">{Math.round(item.amount)} rmb · {item.count} 次</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="motion-v2-surface glow-card relative overflow-hidden mt-6 rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50/90 via-white/92 to-cyan-50/78 p-6 backdrop-blur-sm shadow-[0_18px_42px_rgba(56,189,248,0.14),inset_0_1px_0_rgba(255,255,255,0.86)]">
        <div className="pointer-events-none absolute -top-14 right-20 h-40 w-40 rounded-full bg-sky-200/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-cyan-200/22 blur-3xl" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="mt-[3.3px] flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-[8px] border border-sky-200/90 bg-gradient-to-br from-white/95 via-sky-50/85 to-cyan-50/80 text-sky-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
                <Sparkles size={12} strokeWidth={1.9} />
              </span>
              <span className="text-xs text-sky-700 font-medium uppercase tracking-[0.1em] whitespace-nowrap">Algorithm Brief</span>
              <span className="inline-flex items-center rounded-[7px] border border-sky-200/90 bg-gradient-to-r from-white/92 via-sky-50/82 to-white/88 px-1.5 py-[1px] text-[9px] tracking-[0.03em] text-sky-700 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] whitespace-nowrap">
                v4.9
              </span>
              <h3 className="text-lg font-semibold text-stone-800 leading-tight whitespace-nowrap">Portfolio Optimization 算法说明</h3>
            </div>
            <button
              onClick={openAlgoModal}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white/85 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 transition-colors"
            >
              <Sparkles size={12} strokeWidth={1.9} className="text-cyan-500" />
              查看详情 <span className="text-sm leading-none">›</span>
            </button>
          </div>
          <p className="text-sm text-stone-500 leading-relaxed">
            基于 Markowitz 均值-方差框架，融合复合概率校准管线（线性回归 + PAV 保序回归自适应混合）、自学习情境因子（Shrinkage K=12）、Walk-Forward 反馈回路（自动调参 Kelly/Odds权重/阈值），构建多资产联合分布并以纯分数 Kelly 准则优化仓位。v4.0 容错引擎实现四级置信度梯度 + C(N,N-1) 容错覆盖 + 边际 Sharpe 门控 + 分层对冲架构。v4.3 引入 Entry 相关性矩阵（Phi 系数修正联合概率）与 Per-Match EJR 追踪。v4.4 新增 Conf-Surplus 反共识信号 + 锚定分散化惩罚 + Portfolio Allocation 优化器 + 50k Monte Carlo。v4.9 全参数自旋转引擎：修复 Kelly 经验因子残留与 Walk-Forward 旁路，新增 backtestComboHyperparams 引擎从结算数据自动校准 20+ 组合生成/评分参数族群（vig、surplus 阈值、分层配额、MMR 惩罚、角色系数、组合优化器、时序权重、软惩罚、覆盖衰减、相关性公式等），可靠度加权混合确保小样本稳健。系统旋转覆盖率从 ~55% 提升至 ~92%。
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['复合校准','保序回归','自学习因子','Walk-Forward','原子建模','Kelly准则','容错覆盖','Sharpe门控','Conf-Surplus','锚定分散化','Entry相关性','Monte Carlo','Portfolio优化','超参WF校准','自适应权重','全参数自旋转','组合回溯学习'].map(tag => (
              <span key={tag} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/80 text-indigo-500 border border-indigo-100/70 backdrop-blur-[1px]">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
      </div>

      <div className="glow-card relative overflow-hidden rounded-2xl border border-cyan-100 bg-gradient-to-br from-white via-cyan-50/35 to-violet-50/30 p-6 mt-6">
        <div className="pointer-events-none absolute -top-12 right-14 h-36 w-36 rounded-full bg-cyan-200/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-14 -left-10 h-36 w-36 rounded-full bg-violet-200/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-medium text-stone-700">方案生成历史</h3>
              <p className="text-[11px] text-stone-400 mt-1">最近策略快照 · 可一键恢复当时生成状态</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-cyan-200 bg-white/85 px-2.5 py-1 text-[10px] font-medium text-cyan-700">
                最近 {Math.min(planHistory.length, 8)} 条
              </span>
              <button
                onClick={clearPlanHistory}
                disabled={planHistory.length === 0}
                className="text-xs text-stone-400 hover:text-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                清空历史
              </button>
            </div>
          </div>

          {planHistory.length === 0 ? (
            <p className="text-sm text-stone-400">还没有历史生成记录，生成一次组合后会自动存档。</p>
          ) : (
            <div className="space-y-2.5">
              {planHistory.slice(0, 8).map((item, index) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/80 bg-white/72 backdrop-blur-sm px-3.5 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_190px_auto] items-center gap-x-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-flex items-center rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] text-stone-500 font-medium">
                          #{index + 1}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-600 font-medium">
                          Risk {item.riskPref}%
                        </span>
                      </div>
                      <p className="text-sm text-stone-700 truncate">
                        {item.selectedLabel}
                        {item.selectedCount > 2 ? ` + ${item.selectedCount - 2}场` : ''}
                      </p>
                      <p className="text-[11px] text-stone-400">
                        {new Date(item.createdAt).toLocaleString()} · 候选 {item.candidateCombos}
                      </p>
                    </div>
                    <div className="w-[190px] justify-self-end mr-2 text-right">
                      <p className="text-[11px] text-stone-500 uppercase tracking-[0.08em]">EV / Invest</p>
                      <p className="text-[14px] leading-tight font-semibold text-stone-700 whitespace-nowrap tabular-nums">
                        <span className={item.expectedReturnPercent >= 0 ? 'text-emerald-600' : 'text-rose-500'}>
                          {formatPercent(item.expectedReturnPercent)}
                        </span>
                        <span className="text-[13px] font-semibold text-stone-600"> / {item.totalInvest} rmb</span>
                      </p>
                    </div>
                    <button
                      onClick={() => restorePlanFromHistory(item)}
                      className="justify-self-end px-2.5 py-1 rounded-lg text-xs border border-cyan-200 bg-white text-cyan-700 hover:border-cyan-300 hover:bg-cyan-50 transition-colors"
                    >
                      恢复
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
