import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, Plus, RefreshCw, SlidersHorizontal, Sparkles, XCircle } from 'lucide-react'
import { bumpTeamSamples, getInvestments, getSystemConfig, saveInvestment } from '../lib/localData'
import { getPredictionCalibrationContext } from '../lib/analytics'
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

const calcRoleStructureSignal = (subset, roleTargets, mixStrength = 0.08) => {
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
  const rawScore = tilt * 0.62 + diversity * 0.44 + stableLeverSynergy * 0.48 - alignmentGap * 0.78
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
  const weakHR = hitRates[2] !== null ? hitRates[2] : 0.4
  const gap = clamp(strongHR - weakHR, 0.05, 0.5)

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
      tier2: Number(clamp(0.55, 0.45, 0.65).toFixed(3)),
      tier3: Number(clamp(0.40, 0.30, 0.50).toFixed(3)),
    },
    backtestSamples: scatterData.length,
    backtestReliability: Number(reliability.toFixed(3)),
    bucketHitRates: hitRates.map((r) => r !== null ? Number(r.toFixed(3)) : null),
    hitRateGap: Number(gap.toFixed(3)),
  }
}

/* ── Monte Carlo portfolio simulation ──────────────────────────────── */
const runPortfolioMonteCarlo = (packageItems, iterations = 50000) => {
  if (!packageItems || packageItems.length === 0) return null

  // Build per-combo probability and payout data
  const combos = packageItems.map((item) => {
    const legProbs = item.subset.map((m) => {
      const raw = Number(m.calibratedP ?? m.conf ?? 0.5)
      return Math.max(0.01, Math.min(0.99, raw))
    })
    const odds = Math.max(1.01, Number(item.combinedOdds || item.odds || 2.0))
    const stake = Number(item.amount || 10)
    return { legProbs, odds, stake }
  })

  // Seeded PRNG (xorshift32) for reproducibility
  let seed = 2654435761
  combos.forEach((c) => { c.legProbs.forEach((p) => { seed ^= Math.round(p * 1e6) }) })
  const rand = () => { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }

  const pnls = new Float64Array(iterations)
  let profitCount = 0
  let allLoseCount = 0

  for (let i = 0; i < iterations; i++) {
    let totalPnl = 0
    let anyWin = false
    for (let c = 0; c < combos.length; c++) {
      const combo = combos[c]
      let allHit = true
      for (let l = 0; l < combo.legProbs.length; l++) {
        if (rand() >= combo.legProbs[l]) { allHit = false; break }
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

  // Histogram buckets (5 buckets)
  const range = maxPnl - minPnl
  const bucketWidth = range > 0 ? range / 5 : 1
  const histogram = Array.from({ length: 5 }, (_, i) => ({
    min: minPnl + i * bucketWidth,
    max: minPnl + (i + 1) * bucketWidth,
    count: 0,
  }))
  for (let i = 0; i < iterations; i++) {
    const idx = Math.min(4, Math.floor((pnls[i] - minPnl) / bucketWidth))
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
const optimizePortfolioAllocations = (recommendations, maxPackages = 3) => {
  if (!recommendations || recommendations.length < 2) return []
  const items = recommendations.slice(0, 12)

  // Extract unique match keys across all combos
  const allMatchKeys = new Set()
  items.forEach((item) => {
    const subset = item.subset || []
    subset.forEach((m) => allMatchKeys.add(m.key))
  })

  // Generate candidate portfolios (subsets of 2-5 combos)
  const portfolios = []
  const n = Math.min(items.length, 8)
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
    const totalStake = selected.reduce((s, item) => s + (Number(item.amount) || 10), 0)
    // Coverage: how many unique matches are covered
    const covered = new Set()
    selected.forEach((item) => (item.subset || []).forEach((m) => covered.add(m.key)))
    const coverageRatio = allMatchKeys.size > 0 ? covered.size / allMatchKeys.size : 0
    // Expected value (weighted avg)
    const weightedEv = selected.reduce((s, item) => s + (item.expectedReturn || 0) * (Number(item.amount) || 10), 0) / Math.max(totalStake, 1)
    // Layer diversity (unique layer tags)
    const layers = new Set(selected.map((item) => item.explain?.ftLayerTag).filter(Boolean))
    const layerDiv = layers.size / 4
    // Tier diversity (unique conf tiers present)
    const tiers = new Set()
    selected.forEach((item) => (item.confTiers || []).forEach((t) => tiers.add(t)))
    const tierDiv = tiers.size / 4
    // Avoid redundancy: penalize overlapping legs
    let overlapPairs = 0
    let totalPairs = 0
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        totalPairs++
        const keysI = new Set((selected[i].subset || []).map((m) => m.key))
        const keysJ = (selected[j].subset || []).map((m) => m.key)
        const overlap = keysJ.filter((k) => keysI.has(k)).length
        if (overlap > 0) overlapPairs++
      }
    }
    const diversityScore = totalPairs > 0 ? 1 - overlapPairs / totalPairs : 1

    // Composite utility
    const utility =
      weightedEv * 0.35 +
      coverageRatio * 0.30 +
      layerDiv * 0.10 +
      tierDiv * 0.05 +
      diversityScore * 0.20

    // Run mini MC for this portfolio
    const mc = runPortfolioMonteCarlo(selected, 10000)

    return {
      indices,
      comboIds: selected.map((s) => s.id),
      label: indices.map((i) => i + 1).join('+'),
      combos: selected,
      totalStake: Math.round(totalStake),
      coverageRatio: Number(coverageRatio.toFixed(2)),
      covered: covered.size,
      totalMatches: allMatchKeys.size,
      weightedEv: Number((weightedEv * 100).toFixed(1)),
      layerDiv: Number(layerDiv.toFixed(2)),
      tierDiv: Number(tierDiv.toFixed(2)),
      diversityScore: Number(diversityScore.toFixed(2)),
      utility: Number(utility.toFixed(4)),
      mc,
    }
  })

  // Sort by utility descending and take top N
  scored.sort((a, b) => b.utility - a.utility)

  // Deduplicate: don't return portfolios that are subsets of higher-ranked ones
  const result = []
  const usedSigs = new Set()
  for (const p of scored) {
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

  return result
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
const calcComboJaccard = (subsetA, subsetB) => {
  const keysA = new Set(subsetA.map((item) => item.key))
  const keysB = new Set(subsetB.map((item) => item.key))
  let overlap = 0
  keysA.forEach((k) => { if (keysB.has(k)) overlap += 1 })
  const union = new Set([...keysA, ...keysB]).size
  return union > 0 ? overlap / union : 0
}

const getSubsetMatchKeys = (subset) => {
  const keys = new Set()
  ;(subset || []).forEach((item) => {
    keys.add(buildMatchRefKey(item))
  })
  return [...keys]
}

const mmrRerank = (candidates, lambda = 0.6, maxPick = 10, coverageTargetKeys = null, eta = 0.15) => {
  // MMR: score(i) = lambda * utility(i) - (1-lambda) * maxSim(i, selected) + eta * coverageGain(i)
  if (candidates.length === 0) return []
  if (candidates.length <= 1) return [...candidates]
  const safeLambda = Math.max(0, Math.min(1, Number(lambda) || 0))
  const safeEta = Math.max(0, Math.min(1, Number(eta) || 0))
  const similarityWeight = Math.max(0, 1 - safeLambda)
  const concentrationWeight = 0.18 + safeEta * 0.08

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
        const sim = calcComboJaccard(cand.subset, sel.subset)
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
          anchorSharePenalty = anchorUsed >= 1 ? 0.12 * (anchorUsed / Math.max(1, selected.length)) : 0
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
const stratifiedSelect = (scoredCombos, totalSlots = 10, minLegs = 2) => {
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
  const quotaPrefs = { 1: 0.0, 2: 0.2, 3: 0.35, 4: 0.3, 5: 0.15 }
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
const applyCoverageDynamicBoost = (scoredCombos, selectedMatches, baseDecay = 0.6) => {
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
        const boost = Math.pow(baseDecay, count) * 0.08
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
    value: 'thresholdStrict',
    label: '阈值优先',
    desc: '只保留满足 EV/胜率/相关性阈值的组合。',
  },
  {
    value: 'softPenalty',
    label: '软惩罚',
    desc: '不过度一刀切，对不达标项做分数惩罚后继续参与排序。',
  },
]
const DEFAULT_COMBO_STRATEGY = 'softPenalty'

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

const sanitizeComboStructure = (value) => ({
  minLegs: clamp(Number(value?.minLegs ?? DEFAULT_COMBO_STRUCTURE.minLegs), 1, 5),
  parlayBeta: clamp(Number(value?.parlayBeta ?? DEFAULT_COMBO_STRUCTURE.parlayBeta), 0, 0.5),
  mmrLambda: clamp(Number(value?.mmrLambda ?? DEFAULT_COMBO_STRUCTURE.mmrLambda), 0.2, 0.9),
  coverageEta: clamp(Number(value?.coverageEta ?? DEFAULT_COMBO_STRUCTURE.coverageEta), 0, 0.4),
})

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

const collectHistoryMatchKeys = (historyRow) => {
  const keys = new Set()
  if (!historyRow || typeof historyRow !== 'object') return keys

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
        if (!match || match.investmentId == null || match.matchIndex == null) return
        keys.add(`${match.investmentId}-${match.matchIndex}`)
      })
    })
  }

  return keys
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
    allocation: row?.allocation || `${amount} rmb`,
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

const calcRecommendedAmount = (probability, odds, systemConfig, riskCap) => {
  if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) return 0
  const p = clamp(probability, 0.05, 0.95)
  // Pure Kelly criterion: f* = (p × b - q) / b where b = odds - 1, q = 1 - p
  const b = odds - 1
  const kelly = (p * b - (1 - p)) / b
  if (!Number.isFinite(kelly) || kelly <= 0) return 0
  // Fractional Kelly: divide by kellyDivisor (default 4 = 25% Kelly)
  const fraction = kelly / Math.max(1, Number(systemConfig.kellyDivisor || 4))
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

const allocateAmountsWithinRiskCap = (weights, riskCap, unit = 10) => {
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
  const rawUnits = safeWeights.map((value) => (value / weightSum) * capUnits)
  const units = rawUnits.map((value) => Math.floor(value))
  let remainUnits = capUnits - units.reduce((sum, value) => sum + value, 0)

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
const calcConfSurplus = (match) => {
  const conf = clamp(Number(match.conf || 0.5), 0.05, 0.95)
  const anchorOdds = estimateEntryAnchorOdds(
    Array.isArray(match.entries) ? match.entries : [],
    Number(match.odds || 2.5),
  )
  // Market implied probability (with vig removed — assume ~5% overround)
  const rawImplied = 1 / Math.max(1.01, anchorOdds)
  const vigAdjusted = clamp(rawImplied * 0.95, 0.02, 0.98) // Remove ~5% vig
  const surplus = conf - vigAdjusted
  // Surplus ratio: how big is the edge relative to market prob
  // This normalizes across different odds levels
  const surplusRatio = vigAdjusted > 0.01 ? surplus / vigAdjusted : 0
  return {
    surplus: Number(surplus.toFixed(4)),
    surplusRatio: Number(surplusRatio.toFixed(4)),
    marketImplied: Number(vigAdjusted.toFixed(4)),
    conf,
    anchorOdds: Number(anchorOdds.toFixed(2)),
    // Edge classification
    edgeClass: surplus >= 0.12 ? 'strong_edge' : surplus >= 0.04 ? 'moderate_edge' : surplus >= -0.03 ? 'neutral' : 'negative_edge',
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

const buildComboTitle = (subset) =>
  subset
    .map((item) => {
      const shortEntry = (item.entry || '').split(',')[0].trim()
      if (!shortEntry) return item.homeTeam
      return `${item.homeTeam}${shortEntry}`
    })
    .join(' × ')

const buildSubsetSignature = (subset) =>
  subset
    .map((item) => `${item.investmentId}-${item.matchIndex}-${item.entry}-${item.odds}`)
    .sort()
    .join('|')

const buildMatchRefKey = (item) => `${item.investmentId}-${item.matchIndex}`

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

const rankWithSoftThresholdPenalty = (rows, minEv, minWinRate, maxCorr, alpha) => {
  const evGapScale = 1.15 + (1 - alpha) * 0.55
  const winGapScale = 0.85 + (1 - alpha) * 0.45
  const corrGapScale = 0.72 + (1 - alpha) * 0.28
  return [...rows]
    .map((item) => {
      const evGap = Math.max(0, minEv - item.ev)
      const winGap = Math.max(0, minWinRate - item.p)
      const corrGap = Math.max(0, item.corr - maxCorr)
      const thresholdPenalty = evGap * evGapScale + winGap * winGapScale + corrGap * corrGapScale
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

const calcSubsetPairCorrelation = (leftSubset, rightSubset) => {
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
  return clamp(0.1 + overlapRatio * 0.58 + jaccard * 0.24, 0, 0.96)
}

const buildCovarianceMatrix = (items) => {
  const n = items.length
  const matrix = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i += 1) {
    const varI = Math.max(0.0001, Number(items[i].variance || 0))
    matrix[i][i] = varI
    for (let j = i + 1; j < n; j += 1) {
      const varJ = Math.max(0.0001, Number(items[j].variance || 0))
      const corr = calcSubsetPairCorrelation(items[i].subset, items[j].subset)
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

const optimizePortfolioWeights = (items, alpha, maxWeight) => {
  const n = items.length
  if (n === 0) return []
  if (n === 1) return [1]

  const mu = items.map((item) => Number(item.ev || 0))
  const covariance = buildCovarianceMatrix(items)
  const riskWeight = 1 - alpha
  const diversificationPenalty = clamp(riskWeight * 0.16 + 0.03, 0.03, 0.2)
  const learningRate = 0.16
  let weights = projectCappedSimplex(Array(n).fill(1 / n), maxWeight)

  for (let iter = 0; iter < 180; iter += 1) {
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
      weights.map((value, i) => value + learningRate * gradient[i]),
      maxWeight,
    )
  }

  return weights
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
) => {
  if (selectedMatches.length === 0) return null

  const alpha = clamp(riskPref / 100, 0, 1)
  const minEv = Number(qualityFilter?.minEvPercent || 0) / 100
  const minWinRate = clamp(Number(qualityFilter?.minWinRate || 0) / 100, 0, 1)
  const maxCorr = clamp(Number(qualityFilter?.maxCorr ?? 1), 0, 1)

  const normalizedComboStructure = sanitizeComboStructure(comboStructure)
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

  // ── FIX #3: Apply walk-forward feedback adjustments to tier thresholds ──
  const wfFeedback = calibrationContext?.walkForwardFeedback
  const tierShift = wfFeedback?.ready ? (wfFeedback.adjustments?.tierShift || 0) : 0
  const dynThresholds = tierShift !== 0
    ? {
        tier_1: clamp((dynParams.confTierThresholds?.tier_1 || 0.72) + tierShift, 0.60, 0.85),
        tier_2: clamp((dynParams.confTierThresholds?.tier_2 || 0.55) + tierShift, 0.42, 0.70),
        tier_3: clamp((dynParams.confTierThresholds?.tier_3 || 0.40) + tierShift, 0.28, 0.55),
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
      const cs = item.confSurplus !== undefined ? item.confSurplus : calcConfSurplus(item)
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

    // ── FIX #4: Entry correlation adjustment ──
    // Correct the independence assumption using pairwise correlation data
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
            corrShift += corr.rho * corr.reliability * 0.04
            pairCount += 1
          }
        }
      }
      if (pairCount > 0) {
        const avgCorrAdj = corrShift / pairCount
        p = clamp(p + avgCorrAdj, 0.02, 0.98)
        profitWinProbability = clamp(profitWinProbability + avgCorrAdj, 0.02, 0.98)
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
    const familyBonus = (familyDiv - 0.5) * 0.04
    const roleSignal = calcRoleStructureSignal(annotatedSubset, roleTargets, roleMixStrength)

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

    // Hard penalty for combos that violate tier constraints
    const hardConstraintPenalty = exceedsWeakCap ? 0.5 : 0

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
    const confSurplusBonus = clamp(avgSurplus * 0.15, -0.08, 0.12) + (maxSurplus >= 0.12 ? 0.03 : 0)

    const utility = rewardTerm - riskPenalty + pBonus + familyBonus + roleSignal.bonus
      - tierPenalty + tierAnchorBonus + coveringBonus - hardConstraintPenalty + teamBiasBonus
      + confSurplusBonus
    const corr = calcSubsetSourceCorrelation(annotatedSubset)
    const confAvg = annotatedSubset.reduce((sum, item) => sum + clamp(item.conf, 0.05, 0.95), 0) / Math.max(legs, 1)
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
  const legsFiltered = scoredAll.filter((item) => item.legs >= minLegs)
  const pool = legsFiltered.length > 0 ? legsFiltered : scoredAll // graceful fallback

  const rankedAllByUtility = dedupeRankedBySignature([...pool].sort((a, b) => b.utility - a.utility || b.sharpe - a.sharpe))
  const qualifiedRaw = pool.filter((item) => item.ev >= minEv && item.p >= minWinRate && item.corr <= maxCorr)
  const rankedQualified = dedupeRankedBySignature([...qualifiedRaw].sort((a, b) => b.utility - a.utility || b.sharpe - a.sharpe))
  const rankedSoftPenalty = dedupeRankedBySignature(rankWithSoftThresholdPenalty(rankedAllByUtility, minEv, minWinRate, maxCorr, alpha))

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
    preparedRanked = applyCoverageDynamicBoost(preparedRanked, selectedMatches, 0.6)
    preparedRanked.sort((a, b) => b.boostedUtility - a.boostedUtility || b.utility - a.utility)
  }

  // ── 思路3: Stratified selection by legs count ──
  const stratifiedPool = stratifiedSelect(preparedRanked, 18, minLegs)

  // ── MMR reranking for final diversity ──
  const mmrPool = mmrRerank(
    stratifiedPool,
    mmrLambda,
    14,
    comboStrategy !== 'thresholdStrict' ? targetKeys : null,
    coverageEta,
  )

  const maxUniverse = Math.min(14, mmrPool.length)
  const universe = mmrPool.slice(0, maxUniverse)
  const maxWeight = clamp(0.32 + alpha * 0.45, 0.32, 0.78)
  const weights = optimizePortfolioWeights(universe, alpha, maxWeight)

  const weightedUniverse = universe.map((item, idx) => ({
    ...item,
    weight: Number.isFinite(weights[idx]) ? weights[idx] : 0,
  }))
  let selectedRanked = weightedUniverse
    .filter((item, idx) => item.weight >= 0.045 || idx < 10)
    .sort((a, b) => b.weight - a.weight || b.utility - a.utility)
    .slice(0, 10)

  // Legacy coverage injection as final safety net (lightweight, only fills gaps)
  if (comboStrategy !== 'thresholdStrict') {
    selectedRanked = ensureCoverageInRanked(selectedRanked, weightedUniverse, selectedMatches, 10).ranked
  }
  const concentrationPool = dedupeRankedBySignature(
    [...weightedUniverse].sort((a, b) => b.weight - a.weight || b.utility - a.utility),
  )
  // Max concentration: no single match may appear in more than 60% of combos
  // This prevents the single-point-of-failure scenario (e.g., 切尔西 miss kills ALL combos)
  selectedRanked = rebalanceMatchConcentration(selectedRanked, concentrationPool, 10, 0.60)

  const fallbackRanked = selectedRanked.length > 0 ? selectedRanked : weightedUniverse.slice(0, Math.min(3, weightedUniverse.length))
  const allocationSeed = fallbackRanked.map((item) => {
    const base = Math.max(0, item.weight)
    const injectedBoost = item.coverageInjected && comboStrategy !== 'thresholdStrict' ? 0.05 : 0
    return base + injectedBoost
  })
  const weightSum = allocationSeed.reduce((sum, value) => sum + value, 0)
  const normalizedWeights = allocationSeed.map((value) => (weightSum > 0 ? value / weightSum : 1 / allocationSeed.length))
  const allocatedAmounts = allocateAmountsWithinRiskCap(normalizedWeights, riskCap, 10)
  const rankedWithAmounts = fallbackRanked.map((item, idx) => ({
    ...item,
    allocatedAmount: allocatedAmounts[idx] || 0,
    allocatedWeight: normalizedWeights[idx] || 0,
  }))
  const materializedRanked = rankedWithAmounts.filter((item) => item.allocatedAmount > 0)
  const outputRanked = materializedRanked.length > 0 ? materializedRanked : rankedWithAmounts.slice(0, 1)

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
      allocation: `${amount} rmb`,
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
        thresholdPass: item.ev >= minEv && item.p >= minWinRate && item.corr <= maxCorr,
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
  const [qualityFilter, setQualityFilter] = useState({
    minEvPercent: 0,
    minWinRate: 5,
    maxCorr: 0.85,
  })
  const [comboStrategy, setComboStrategy] = useState(DEFAULT_COMBO_STRATEGY)
  const [comboStructure, setComboStructure] = useState(() => sanitizeComboStructure(DEFAULT_COMBO_STRUCTURE))
  const [rolePreference, setRolePreference] = useState(() => sanitizeRolePreference(DEFAULT_ROLE_PREFERENCE))
  const [matchRoleOverrides, setMatchRoleOverrides] = useState({})
  const [showRiskProbe, setShowRiskProbe] = useState(false)
  const [showAllRecommendations, setShowAllRecommendations] = useState(false)
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState({})
  const [showDeepRefresh, setShowDeepRefresh] = useState(false)
  const [lessTeams, setLessTeams] = useState(new Set())
  const [moreTeams, setMoreTeams] = useState(new Set())
  const [mcSimResult, setMcSimResult] = useState(null)
  const [portfolioAllocations, setPortfolioAllocations] = useState([])
  const [expandedComboIdx, setExpandedComboIdx] = useState(null)
  const [expandedPortfolioIdxSet, setExpandedPortfolioIdxSet] = useState(() => new Set())
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

  const candidateRows = useMemo(
    () =>
      todayMatches.map((item) => {
        const adjustedProb = calcAdjustedProbability(item, systemConfig, calibrationContext)
        const fallbackOdds = Math.max(1.01, Number(item.odds) || 2.5)
        const atomicProfile = buildAtomicLegProfile(item, adjustedProb, fallbackOdds)
        const rawAtomicProfile = buildAtomicLegProfile(item, clamp(Number(item.conf) || 0.5, 0.05, 0.95), fallbackOdds)
        const effectiveOdds = Math.max(1.01, Number(atomicProfile.equivalentOdds || fallbackOdds))
        const adjustedEvPercent = Number(atomicProfile.expectedReturn || 0) * 100
        const suggestedAmount = calcRecommendedAmount(adjustedProb, effectiveOdds, systemConfig, riskCap)
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
    () => (showAllRecommendations ? recommendations : recommendations.slice(0, 3)),
    [recommendations, showAllRecommendations],
  )

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
    const prefs = [40, 50, 60]
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
  }, [calibrationContext, comboStrategy, comboStructure, qualityFilter, riskCap, rolePreference, selectedMatches, systemConfig])

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
  }

  const pushPlanHistory = (generated, selectedRows, pref) => {
    const selectedLabel = selectedRows.slice(0, 2).map((row) => row.match).join(' + ')
    const roleMap = selectedRows.reduce((acc, row) => {
      if (row?.key) {
        acc[row.key] = normalizeRoleTag(row.roleTag)
      }
      return acc
    }, {})
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
      comboStrategy,
      comboStructure: sanitizeComboStructure(comboStructure),
      rolePreference: sanitizeRolePreference(rolePreference),
      selectedRoleMap: roleMap,
      coverageInjectedCombos: generated.coverageInjectedCombos,
      uncoveredMatches: generated.uncoveredMatches,
      legsDistribution: generated.legsDistribution || {},
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

    const historyMatchKeys = collectHistoryMatchKeys(historyRow)
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
      setTodayMatches(getTodayMatches())
    }

    setRiskPref(Number(historyRow.riskPref || 50))
    if (historyRow.comboStrategy) {
      setComboStrategy(historyRow.comboStrategy)
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

    const nextSelected = {}
    if (safeRecommendations[0]) {
      nextSelected[safeRecommendations[0].id] = true
    }
    setSelectedRecommendationIds(nextSelected)
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
    )
    if (!generated) {
      window.alert(
        comboStrategy === 'thresholdStrict'
          ? '当前阈值下没有可用方案，请降低最小 EV / 最小胜率，或放宽最大相关性。'
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
    pushPlanHistory(generated, selectedMatches, riskPref)

    const nextSelected = {}
    if (generated.recommendations[0]) {
      nextSelected[generated.recommendations[0].id] = true
    }
    setSelectedRecommendationIds(nextSelected)

    // Auto-run Monte Carlo simulation on the generated package
    const mc = runPortfolioMonteCarlo(generated.recommendations.slice(0, 8))
    setMcSimResult(mc)

    // Auto-run portfolio allocation optimizer
    const allocations = optimizePortfolioAllocations(generated.recommendations, 3)
    setPortfolioAllocations(allocations)
    setExpandedComboIdx(null)
    setExpandedPortfolioIdxSet(new Set())
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
    if (selectedMatches.length === 0) return
    const jRisk = overrides.riskPref ?? riskPref
    const jStructure = overrides.comboStructure ?? comboStructure
    const bias = overrides.teamBias ?? null
    const generated = generateRecommendations(
      selectedMatches, jRisk, riskCap, systemConfig, calibrationContext,
      qualityFilter, comboStrategy, jStructure, rolePreference, bias,
    )
    if (!generated) return
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
    const nextSelected = {}
    if (generated.recommendations[0]) nextSelected[generated.recommendations[0].id] = true
    setSelectedRecommendationIds(nextSelected)
    // Auto-run MC on the new package
    const mc = runPortfolioMonteCarlo(generated.recommendations.slice(0, 8))
    setMcSimResult(mc)
    // Auto-run portfolio allocation optimizer
    const allocations = optimizePortfolioAllocations(generated.recommendations, 3)
    setPortfolioAllocations(allocations)
    setExpandedComboIdx(null)
    setExpandedPortfolioIdxSet(new Set())
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
    lessTeams.forEach((t) => bias.set(t, (bias.get(t) || 0) - 0.12))
    moreTeams.forEach((t) => bias.set(t, (bias.get(t) || 0) + 0.12))
    setShowDeepRefresh(false)
    regenerateWithOverrides({ teamBias: bias })
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
      title: 'Portfolio Optimization 算法说明',
          content: (
        <div className="text-sm text-stone-600 space-y-4">
          <p><strong>1. 输入处理</strong>：录入今日 n 场比赛参数（Conf, Mode, TYS, FID, FSE, Odds），系统构建候选组合池（最多到 5 关，且按最小关数筛选，候选数为 ΣC(n,k)）。</p>
          <p><strong>2. Calibration 校准层</strong>：引入时间近因权重 + REP 方向性权重，先做 Conf 回归校准，再叠加球队层级偏差校准（小样本自动收缩）。</p>
          <p><strong>3. 市场先验融合</strong>：将模型概率与 Odds 隐含概率做动态融合；球队样本越可靠，越偏向模型；球队可靠度不足时自动向市场先验回归。</p>
          <p><strong>4. 滚动回测护栏</strong>：使用 walk-forward 窗口评估 Brier / LogLoss / ROI，策略层采用 Bootstrap Monte Carlo 回测，动态调节 market lean，抑制过拟合。</p>
          <p><strong>5. 原子结果建模</strong>：同场多 Entry 先拆成原子状态（含 miss），按分支权重与赔率计算每个原子收益，再做跨场联合分布，避免调和平均带来的失真。</p>
          <p><strong>6. 预期收益与风险</strong>：直接由联合分布求 E[R] / Var[R]，再得 Sharpe，同时输出命中概率与盈利概率（profit win rate），覆盖单 Entry 与多 Entry 串联情形。</p>
          <p><strong>7. Risk Preference 加权</strong>：效用函数 U = α × μ - (1-α) × σ，α 由滑杆控制（0=稳健，100=激进）。</p>
          <p><strong>8. 组合策略</strong>：可选「勾选优先 / 阈值优先 / 软惩罚」。软惩罚对阈值外方案降分但不直接淘汰。</p>
          <p><strong>9. 角色结构软约束</strong>：支持“稳/杠杆/中性双档”逐场自定义，并以软约束项参与打分，不做硬性赔率或配比锁定。</p>
          <p><strong>10. Portfolio 分配</strong>：对 Top 组合按效用打分分配仓位，约束总仓位不超过风控上限（Risk Cap）。</p>
          <p><strong>11. 串关偏好 (Parlay Bonus)</strong>：在效用函数中加入 β·√(legs-1) 项，天然提升多关串联的优先级；β 由「串关偏好」滑杆控制。</p>
          <p><strong>12. 分层选优 (Stratified Selection)</strong>：按关数分层（2/3/4/5关），每层按效用取 Top-K，跨层配额确保结构多样。</p>
          <p><strong>13. MMR 去重排序</strong>：使用 Maximal Marginal Relevance 算法，每选一个方案时同时考虑其效用和与已选方案的差异度，避免"前几名都带同一场"。</p>
          <p><strong>14. 覆盖动态加分</strong>：对候选中尚未被充分覆盖的场次，自动提升包含该场次的组合分数，随覆盖增加自然衰减。</p>
          <p><strong>15. Entry Family 多样化</strong>：同一场比赛的多个 entry（如曼联胜/平/double）被识别为一个 family，鼓励 family 内 entry 多样化。</p>
          <p className="mt-2 font-semibold text-stone-700">v4.0 — 容错串关引擎</p>
          <p><strong>16. Conf×Odds 交叉校准</strong>：按赔率分桶（低/中/高/超高赔），分析历史 Conf 在每个赔率区间的系统性偏差（过度自信/保守），通过收缩估计修正。</p>
          <p><strong>17. 置信度梯度分层</strong>：每场按 Conf 分为强洞察（≥0.72）、中洞察（≥0.55）、弱洞察。强洞察作锚点，弱洞察限制 ≤1场/票且禁止两个弱洞察同票。</p>
          <p><strong>18. 容错覆盖设计</strong>：对 N 场强洞察生成 C(N, N-1) 全覆盖子集。4中3时仍有存活票。</p>
          <p><strong>19. 边际 Sharpe 门控</strong>：每增加一腿前计算边际 Sharpe（ΔEV/Δσ），低于阈值的弱腿被拒绝。</p>
          <p><strong>20. 分层对冲架构</strong>：锚定层（2串1→回本）、扩展层（3串1→利润）、容错覆盖层（保险）、博冷层（小注尾部）。</p>
          <p><strong>21. 输出</strong>：上方可勾选方案直接采纳；下方提供单组合排序与分层下注建议，标注层级与置信度梯度。</p>
        </div>
      ),
    })
  }

  return (
    <div className="page-shell page-content-wide">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">智能组合建议</h2>
        <p className="text-stone-400 text-sm mt-1">基于 Portfolio Optimization 的最优下注方案</p>
      </div>

      <div className="combo-main-grid mb-6">
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">今日备选比赛</h3>
            <div className="flex items-center gap-2">
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
            </div>
          </div>

          {analysisFilter && (
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

          <div className="flex items-center justify-between text-xs text-stone-500 mb-3">
            <span>已勾选 {selectedMatches.length}/{displayedCandidates.length}</span>
            {displayedCandidates.length > 0 && (
              <button onClick={toggleCheckAll} className="text-amber-600 hover:text-amber-700">
                {allChecked ? '取消全选' : '全选'}
              </button>
            )}
          </div>

          <div className="space-y-2">
            {displayedCandidates.map((item, i) => {
              const hasManualRole = Object.prototype.hasOwnProperty.call(matchRoleOverrides, item.key)
              const effectiveRole = normalizeRoleTag(matchRoleOverrides[item.key] || item.autoRole)
              const activeRoleMeta = MATCH_ROLE_OPTIONS.find((r) => r.value === effectiveRole)

              return (
                <div
                  key={item.key}
                  className="group flex items-center gap-3 p-3 rounded-xl border border-stone-100 hover:border-indigo-200 bg-white hover:bg-indigo-50/20 transition-all cursor-pointer"
                >
                  <div onClick={() => toggleCheck(i)} className={`custom-checkbox flex-shrink-0 ${checkedMatches[i] ? 'checked' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-stone-700 truncate">{item.match}</p>
                      <span className={`px-1.5 py-[1px] rounded border text-[9px] font-medium flex-shrink-0 ${activeRoleMeta?.tone || 'bg-stone-100 text-stone-500 border-stone-200'}`}>
                        {activeRoleMeta?.label || '自动'}
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
                    {/* Role selector — appears on hover */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                      {MATCH_ROLE_OPTIONS.map((role) => {
                        const active = effectiveRole === role.value
                        return (
                          <button
                            key={`${item.key}-${role.value}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              setMatchRoleOverrides((prev) => ({
                                ...prev,
                                [item.key]: role.value,
                              }))
                            }}
                            className={`px-1.5 py-0.5 rounded-md border text-[10px] transition-colors ${
                              active
                                ? role.tone
                                : 'bg-white text-stone-400 border-stone-200 hover:border-stone-300'
                            }`}
                          >
                            {role.label}
                          </button>
                        )
                      })}
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          setMatchRoleOverrides((prev) => {
                            if (!Object.prototype.hasOwnProperty.call(prev, item.key)) return prev
                            const next = { ...prev }
                            delete next[item.key]
                            return next
                          })
                        }}
                        className={`px-1.5 py-0.5 rounded-md border text-[10px] transition-colors ${
                          hasManualRole
                            ? 'bg-white text-stone-400 border-stone-200 hover:border-stone-300'
                            : 'bg-sky-100 text-sky-700 border-sky-200'
                        }`}
                      >
                        自动
                      </button>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="block text-sm font-semibold text-stone-700">{item.suggestedAmount > 0 ? `${item.suggestedAmount}` : '--'}</span>
                    <span className="text-[10px] text-stone-400">rmb</span>
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

          <div className="mt-6 pt-6 border-t border-stone-100">
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

          <div className="mt-4 p-3.5 rounded-xl bg-stone-50 border border-stone-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-stone-500">质量阈值过滤（生成前）</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    setQualityFilter({
                      minEvPercent: 2,
                      minWinRate: 45,
                      maxCorr: 0.65,
                    })
                  }
                  className="px-2 py-1 rounded-md text-[11px] bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                >
                  一键强化过滤
                </button>
                <button
                  onClick={() =>
                    setQualityFilter({
                      minEvPercent: 0,
                      minWinRate: 5,
                      maxCorr: 0.85,
                    })
                  }
                  className="px-2 py-1 rounded-md text-[11px] bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                >
                  重置
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-stone-500">
                最小 EV %
                <input
                  type="number"
                  step="0.5"
                  value={qualityFilter.minEvPercent}
                  onChange={(event) =>
                    setQualityFilter((prev) => ({
                      ...prev,
                      minEvPercent: Number.parseFloat(event.target.value) || 0,
                    }))
                  }
                  className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-right"
                />
              </label>
              <label className="text-[11px] text-stone-500">
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
                  className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-right"
                />
              </label>
              <label className="text-[11px] text-stone-500">
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
                  className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-right"
                />
              </label>
            </div>
            <p className="text-[11px] text-stone-400 mt-2">
              相关性基于“同源注单集中度”（HHI）估计；值越大，组合越可能同涨同跌。
            </p>
            <div className="mt-3">
              <p className="text-[11px] text-stone-500 mb-1.5">组合生成策略</p>
              <div className="grid grid-cols-3 gap-2">
                {COMBO_STRATEGY_OPTIONS.map((option) => {
                  const selected = comboStrategy === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => setComboStrategy(option.value)}
                      className={`px-2 py-1.5 rounded-lg text-[11px] border transition-colors ${
                        selected
                          ? 'border-amber-300 bg-amber-100 text-amber-700'
                          : 'border-stone-200 bg-white text-stone-600 hover:border-amber-200 hover:text-amber-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-stone-400 mt-1.5">{activeStrategyMeta.desc}</p>
            </div>
          </div>

          <div className="mt-4 p-3.5 rounded-xl bg-teal-50/60 border border-teal-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-teal-700 font-medium">串关结构偏好</span>
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
                  className="px-2 py-1 rounded-md text-[11px] bg-teal-100 text-teal-700 hover:bg-teal-200 transition-colors"
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
                  className="px-2 py-1 rounded-md text-[11px] bg-stone-200 text-stone-600 hover:bg-stone-300 transition-colors"
                >
                  默认
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-stone-500">
                最小关数
                <select
                  value={comboStructure.minLegs}
                  onChange={(e) =>
                    setComboStructure((prev) => ({ ...prev, minLegs: Number(e.target.value) }))
                  }
                  className="input-glow mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-200 text-xs"
                >
                  <option value={1}>1（含单关）</option>
                  <option value={2}>2（至少2串1）</option>
                  <option value={3}>3（至少3串1）</option>
                  <option value={4}>4（至少4串1）</option>
                </select>
              </label>
              <label className="text-[11px] text-stone-500">
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
                  className="mt-1 w-full"
                />
                <span className="text-[10px] text-stone-400">{comboStructure.parlayBeta.toFixed(2)}（0=无偏好）</span>
              </label>
              <label className="text-[11px] text-stone-500">
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
                  className="mt-1 w-full"
                />
                <span className="text-[10px] text-stone-400">{comboStructure.mmrLambda.toFixed(2)}（低=更多样化）</span>
              </label>
              <label className="text-[11px] text-stone-500">
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
                  className="mt-1 w-full"
                />
                <span className="text-[10px] text-stone-400">{comboStructure.coverageEta.toFixed(2)}（高=候选全覆盖）</span>
              </label>
            </div>
            <p className="text-[10px] text-teal-500/70 mt-2">
              β 提升多关串联的效用分；λ 控制 MMR 去重力度；η 给未覆盖候选加分。
            </p>
            {Object.keys(generationSummary.legsDistribution || {}).length > 0 && (
              <div className="mt-2 pt-2 border-t border-teal-100">
                <p className="text-[10px] text-teal-600 mb-1">上次生成关数分布</p>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(generationSummary.legsDistribution)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([legs, count]) => (
                      <span key={legs} className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 text-[10px]">
                        {legs}关×{count}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 p-3.5 rounded-xl bg-sky-50/60 border border-sky-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-sky-700 font-medium">角色结构引导（软约束）</span>
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
                      className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${
                        active
                          ? 'border-sky-300 bg-sky-100 text-sky-700'
                          : 'border-stone-200 bg-white text-stone-600 hover:border-sky-200 hover:text-sky-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="text-[11px] text-stone-500 block">
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
                className="mt-1 w-full"
              />
              <span className="text-[10px] text-stone-400">
                {rolePreference.mixStrength.toFixed(2)}（0=不引导，越高越贴近你选择的“稳/杠杆/中性”风格）
              </span>
            </label>
            <p className="text-[10px] text-sky-600/80 mt-2">
              该机制只影响打分，不做硬筛选，不会强行锁死总赔率或固定配比。
            </p>
            <div className="mt-2.5 rounded-lg border border-sky-100 bg-white/70 px-2.5 py-2 text-[10px] text-stone-500 space-y-1">
              <p>操作解释：先选预设（平衡/稳健底盘/杠杆推进）定义你的大方向。</p>
              <p>γ（结构引导强度）：0 附近几乎不干预，越高越偏向你设定的角色结构。</p>
              <p>逐场角色按钮用于“点杀”某场风格；没把握就用“自动”。</p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={handleGenerate} className="flex-1 btn-primary btn-hover">
              生成最优组合
            </button>
            <button onClick={handleConfirmChecked} className="flex-1 btn-secondary btn-hover">
              确认投资已勾选
            </button>
          </div>
        </div>

        {/* ═══ 智能组合包 Hero Card ═══ */}
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 relative">
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
                className="w-full mt-3 py-2 rounded-xl text-xs font-medium text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                应用偏好并重新生成
              </button>
            </div>
          )}

          {/* Portfolio Allocation Optimizer */}
          {portfolioAllocations.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-gradient-to-br from-indigo-50/60 to-violet-50/30 border border-indigo-100">
              <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider mb-2">建议投资组合</p>
              <div className="space-y-1.5">
                {portfolioAllocations.map((alloc, aIdx) => (
                  <div key={aIdx}>
                    <div
                      onClick={() => togglePortfolioExpand(aIdx)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/70 border border-indigo-100/60 cursor-pointer hover:bg-white transition-all"
                    >
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${aIdx === 0 ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                        {aIdx === 0 ? '最优' : `#${aIdx + 1}`}
                      </span>
                      <span className="text-[13px] font-medium text-stone-700 flex-1">
                        组合 {alloc.label}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-stone-500">
                        <span>覆盖{alloc.covered}/{alloc.totalMatches}场</span>
                        <span className="text-emerald-600 font-medium">EV {alloc.weightedEv}%</span>
                        <span>{alloc.totalStake} rmb</span>
                      </div>
                      <svg className={`w-3 h-3 text-stone-400 transition-transform ${expandedPortfolioIdxSet.has(aIdx) ? 'rotate-180' : ''}`} viewBox="0 0 12 12" fill="none">
                        <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    {expandedPortfolioIdxSet.has(aIdx) && (
                      <div className="mt-1.5 ml-2 p-2.5 rounded-lg bg-white/50 border border-indigo-50 space-y-2 animate-fade-in">
                        <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                          <div className="text-center">
                            <p className="text-stone-400">覆盖率</p>
                            <p className="font-semibold text-indigo-600">{(alloc.coverageRatio * 100).toFixed(0)}%</p>
                          </div>
                          <div className="text-center">
                            <p className="text-stone-400">层多样</p>
                            <p className="font-semibold text-violet-600">{(alloc.layerDiv * 100).toFixed(0)}%</p>
                          </div>
                          <div className="text-center">
                            <p className="text-stone-400">独立性</p>
                            <p className="font-semibold text-sky-600">{(alloc.diversityScore * 100).toFixed(0)}%</p>
                          </div>
                          <div className="text-center">
                            <p className="text-stone-400">综合效用</p>
                            <p className="font-semibold text-stone-700">{alloc.utility.toFixed(3)}</p>
                          </div>
                        </div>
                        {alloc.mc && (
                          <div className="grid grid-cols-3 gap-1.5 text-[10px] pt-1 border-t border-indigo-50">
                            <div className="flex justify-between">
                              <span className="text-stone-400">盈利概率</span>
                              <span className={`font-semibold ${alloc.mc.profitProb >= 0.5 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {(alloc.mc.profitProb * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-stone-400">中位收益</span>
                              <span className={`font-mono text-[10px] ${alloc.mc.median >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {alloc.mc.median >= 0 ? '+' : ''}{alloc.mc.median}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-stone-400">95%VaR</span>
                              <span className="text-rose-500 font-mono text-[10px]">{alloc.mc.var95}</span>
                            </div>
                          </div>
                        )}
                        <div className="text-[10px] text-stone-400 pt-1">
                          包含: {alloc.combos.map((c) => c.combo).join(' · ')}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
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
              {recommendations.slice(0, 8).map((item, idx) => {
                const selected = Boolean(selectedRecommendationIds[item.id])
                const expanded = expandedComboIdx === idx
                const layerTag = item.explain?.ftLayerTag
                const layerDot = layerTag === 'core' ? 'bg-emerald-400'
                  : layerTag === 'covering' ? 'bg-teal-400'
                  : layerTag === 'satellite' ? 'bg-sky-400'
                  : layerTag === 'moonshot' ? 'bg-violet-400' : 'bg-stone-300'
                return (
                  <div key={item.id}>
                    <div
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                        selected ? 'bg-indigo-50/70 border border-indigo-200' : 'bg-stone-50/50 border border-transparent hover:bg-stone-50'
                      }`}
                    >
                      <span className="text-[11px] text-stone-400 font-mono w-4 shrink-0">{idx + 1}.</span>
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${layerDot}`} />
                      <div className="flex-1 min-w-0" onClick={() => setExpandedComboIdx(expanded ? null : idx)}>
                        <p className="text-[13px] text-stone-700 truncate">{item.combo}</p>
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
                      <div className="ml-6 mt-1 p-2.5 rounded-lg bg-stone-50/80 border border-stone-100 animate-fade-in">
                        <div className="grid grid-cols-4 gap-1.5 text-[10px] mb-2">
                          <div className="text-center">
                            <p className="text-stone-400">命中率</p>
                            <p className="font-semibold text-sky-600">{item.winRate}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-stone-400">盈利率</p>
                            <p className="font-semibold text-indigo-600">{item.profitWinRate}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-stone-400">Sharpe</p>
                            <p className="font-semibold text-violet-600">{item.sharpe}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-stone-400">校准增益</p>
                            <p className={`font-semibold ${item.explain.calibGainPp >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                              {item.explain.calibGainPp >= 0 ? '+' : ''}{item.explain.calibGainPp.toFixed(1)}pp
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1 text-[10px]">
                          {(item.subset || []).map((leg, li) => {
                            const cs = leg.confSurplus
                            const surplusVal = cs?.surplus || 0
                            return (
                              <div key={li} className="flex items-center gap-1.5 text-stone-600">
                                <span className="text-stone-400 w-3 shrink-0">{li + 1}</span>
                                <span className="flex-1 truncate">{leg.homeTeam} vs {leg.awayTeam}</span>
                                <span className="text-stone-500 shrink-0">{leg.entry || '-'}</span>
                                <span className="font-mono text-stone-500 shrink-0">@{Number(leg.odds || 0).toFixed(2)}</span>
                                <span className={`font-mono shrink-0 ${(leg.calibratedP || leg.conf) >= 0.55 ? 'text-emerald-600' : 'text-amber-500'}`}>
                                  P:{((leg.calibratedP || leg.conf) * 100).toFixed(0)}%
                                </span>
                                <span className={`font-mono shrink-0 text-[9px] ${surplusVal >= 0.04 ? 'text-emerald-600' : surplusVal >= -0.03 ? 'text-stone-400' : 'text-rose-400'}`}>
                                  {surplusVal >= 0 ? '+' : ''}{(surplusVal * 100).toFixed(0)}pp
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">
                          <span className="px-1 py-px rounded bg-stone-200/70 text-stone-500">相关 {item.explain.corr.toFixed(2)}</span>
                          <span className="px-1 py-px rounded bg-stone-200/70 text-stone-500">Conf均 {item.explain.confAvg.toFixed(2)}</span>
                          {item.explain.avgSurplus != null && (
                            <span className={`px-1 py-px rounded ${item.explain.avgSurplus >= 0.04 ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200/70 text-stone-500'}`}>
                              边际 {item.explain.avgSurplus >= 0 ? '+' : ''}{(item.explain.avgSurplus * 100).toFixed(1)}pp
                            </span>
                          )}
                          {item.explain.roleMixBonus > 0 && <span className="px-1 py-px rounded bg-sky-100 text-sky-600">角色+{item.explain.roleMixBonus.toFixed(2)}</span>}
                          {item.explain.familyDiversity > 0.6 && <span className="px-1 py-px rounded bg-violet-100 text-violet-600">多样{(item.explain.familyDiversity * 100).toFixed(0)}%</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {recommendations.length > 8 && (
                <p className="text-[10px] text-stone-400 text-center pt-1">+{recommendations.length - 8} 更多方案（详见下方展开）</p>
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
      {recommendations.length > 0 && (
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
          {recommendations.length > 3 && !showAllRecommendations && (
            <button
              onClick={() => setShowAllRecommendations(true)}
              className="w-full mt-2.5 py-1.5 text-[13px] text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
            >
              展开全部 {recommendations.length} 个方案 ▼
            </button>
          )}
          {recommendations.length > 3 && showAllRecommendations && (
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
            <span className="text-xs text-stone-400">按效用 U 排序</span>
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
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setShowRiskProbe((prev) => !prev)}
              className="px-2.5 py-1.5 rounded-lg border border-stone-200 text-[11px] text-stone-600 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50 transition-colors"
            >
              快速回测 40/50/60
            </button>
          </div>
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
                  </tr>
                </thead>
                <tbody>
                  {riskProbeRows.map((row) => (
                    <tr key={`probe-${row.riskPref}`} className={`border-b border-stone-100 ${row.best ? 'bg-amber-50' : ''}`}>
                      <td className="py-1.5">
                        <span className={`font-medium ${row.best ? 'text-amber-700' : 'text-stone-700'}`}>{row.riskPref}%</span>
                      </td>
                      <td className={`py-1.5 ${row.available ? 'text-emerald-600' : 'text-stone-400'}`}>
                        {row.available ? formatPercent(row.evPct) : '--'}
                      </td>
                      <td className="py-1.5 text-stone-600">{row.available ? `${Math.round(row.totalInvest)} rmb` : '--'}</td>
                      <td className="py-1.5 text-violet-700">{row.available ? row.topSharpe.toFixed(2) : '--'}</td>
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
            <h3 className="font-medium text-stone-700">分层下注建议</h3>
            <Sparkles size={14} className="text-amber-500" />
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

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700">Portfolio Optimization 算法说明</h3>
          <button onClick={openAlgoModal} className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1">
            <Info size={12} /> 展开详情
          </button>
        </div>
        <p className="text-sm text-stone-500">
          基于 Markowitz 均值-方差模型，结合原子结果建模与 Kelly 准则优化多资产配置。v4.0 新增容错串关引擎：Conf×Odds 交叉校准 → 置信度梯度分层 → C(N,N-1) 容错覆盖 → 边际 Sharpe 门控 → 分层对冲架构（锚定/扩展/容错/博冷），实现"4中3不归零"。
        </p>
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700">方案生成历史</h3>
          <button
            onClick={clearPlanHistory}
            disabled={planHistory.length === 0}
            className="text-xs text-stone-400 hover:text-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            清空历史
          </button>
        </div>

        {planHistory.length === 0 ? (
          <p className="text-sm text-stone-400">还没有历史生成记录，生成一次组合后会自动存档。</p>
        ) : (
          <div className="space-y-2">
            {planHistory.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-xl border border-stone-100 bg-stone-50/70 px-3 py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_170px_auto] items-center gap-x-4">
                  <div className="min-w-0">
                    <p className="text-sm text-stone-700 truncate">
                      {item.selectedLabel}
                      {item.selectedCount > 2 ? ` + ${item.selectedCount - 2}场` : ''}
                    </p>
                    <p className="text-[11px] text-stone-400">
                      {new Date(item.createdAt).toLocaleString()} · Risk {item.riskPref}% · 候选 {item.candidateCombos}
                    </p>
                  </div>
                  <div className="w-[170px] justify-self-end mr-3 text-right">
                    <p className="text-xs text-stone-500">EV / Invest</p>
                    <p className="text-sm font-semibold text-stone-700 whitespace-nowrap tabular-nums">
                      {formatPercent(item.expectedReturnPercent)} / {item.totalInvest} rmb
                    </p>
                  </div>
                  <button
                    onClick={() => restorePlanFromHistory(item)}
                    className="justify-self-end px-2.5 py-1 rounded-lg text-xs border border-stone-200 text-stone-600 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50 transition-colors"
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
  )
}
