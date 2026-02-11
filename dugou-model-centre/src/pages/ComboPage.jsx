import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Info, Plus, Sparkles, XCircle } from 'lucide-react'
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
      const candidateMatchKeys = getSubsetMatchKeys(cand.subset)
      let concentrationPenalty = 0
      if (candidateMatchKeys.length > 0 && selected.length > 0) {
        let penaltyAcc = 0
        candidateMatchKeys.forEach((mk) => {
          const used = matchUseCount.get(mk) || 0
          if (used <= 0) return
          const usageRatio = used / selected.length
          penaltyAcc += usageRatio * usageRatio
        })
        concentrationPenalty = penaltyAcc / candidateMatchKeys.length
      }

      const score =
        safeLambda * normUtil
        - similarityWeight * maxSim
        + safeEta * coverageGain
        - concentrationWeight * concentrationPenalty
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

const normalizeHistoryRecommendation = (row, index = 0) => {
  const fallbackRank = index + 1
  const subset = Array.isArray(row?.subset) ? row.subset.filter(Boolean) : []
  const legs = Math.max(1, Number.parseInt(row?.legs || subset.length || 1, 10) || subset.length || 1)
  const amount = Math.max(0, Math.round(toFiniteNumber(row?.amount, 0)))
  const expectedReturn = toFiniteNumber(row?.expectedReturn, 0)
  const hitProbability = clamp(toFiniteNumber(row?.hitProbability ?? row?.p, 0), 0, 1)
  const profitWinProbability = clamp(toFiniteNumber(row?.profitWinProbability, 0), 0, 1)
  const combinedOdds = Math.max(1.01, toFiniteNumber(row?.combinedOdds ?? row?.odds, 1.01))
  const expectedRating = clamp(toFiniteNumber(row?.expectedRating, hitProbability), 0, 1)
  const layer = row?.layer || getLayerByRank(fallbackRank)
  const tier = row?.tier || `T${fallbackRank}`
  const explainSource = row?.explain && typeof row.explain === 'object' ? row.explain : {}

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
  const kelly = (p * odds - 1) / (odds - 1)
  if (!Number.isFinite(kelly) || kelly <= 0) return 0
  const base = Number(systemConfig.initialCapital || 0) * (kelly / Math.max(1, Number(systemConfig.kellyDivisor || 4)))
  const confLift = 0.88 + p * 0.24
  const raw = Math.max(0, base * confLift)
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

const calcAdjustedProbability = (match, systemConfig, calibrationContext) => {
  const confMultiplier = clamp(Number(calibrationContext?.multipliers?.conf || 1), 0.75, 1.25)
  const fseMultiplier = clamp(Number(calibrationContext?.multipliers?.fse || 1), 0.75, 1.25)
  const rawConf = clamp(match.conf, 0.05, 0.95)
  const conf =
    typeof calibrationContext?.calibrate === 'function'
      ? clamp(calibrationContext.calibrate(rawConf), 0.05, 0.95)
      : clamp(rawConf * confMultiplier, 0.05, 0.95)
  const modeFactor = MODE_FACTOR_MAP[match.mode] || 1
  const tysFactor = ((TYS_FACTOR_MAP[match.tysHome] || 1) + (TYS_FACTOR_MAP[match.tysAway] || 1)) / 2
  const fidFactor = FID_FACTOR_MAP[match.fid] || 1
  const fseMatch = Math.sqrt(clamp(match.fseHome, 0.05, 1) * clamp(match.fseAway, 0.05, 1))
  const fseFactor = clamp((0.88 + fseMatch * 0.24) * fseMultiplier, 0.72, 1.35)
  const confSignal = clamp(conf / 0.5, 0.15, 1.95)

  const weightedLift =
    confSignal ** getFactorWeight(systemConfig.weightConf, 0.45) *
    modeFactor ** getFactorWeight(systemConfig.weightMode, 0.16) *
    tysFactor ** getFactorWeight(systemConfig.weightTys, 0.12) *
    fidFactor ** getFactorWeight(systemConfig.weightFid, 0.14) *
    fseFactor ** getFactorWeight(systemConfig.weightFse, 0.07)

  const baseProbability = clamp(0.5 * weightedLift, 0.05, 0.95)
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

  const maxSubsetSize = Math.min(5, selectedMatches.length)
  const subsets = buildSubsets(selectedMatches, maxSubsetSize)

  const scoredAll = subsets.map((subset) => {
    const legs = subset.length
    const adjustedProfiles = subset.map((item) => {
      if (item.atomicProfile) return item.atomicProfile
      const fallbackOdds = Math.max(1.01, Number(item.odds) || 2.5)
      const unionProbability = calcAdjustedProbability(item, systemConfig, calibrationContext)
      return buildAtomicLegProfile(item, unionProbability, fallbackOdds)
    })
    const rawProfiles = subset.map((item) => {
      if (item.rawAtomicProfile) return item.rawAtomicProfile
      const fallbackOdds = Math.max(1.01, Number(item.odds) || 2.5)
      const unionProbability = clamp(Number(item.conf) || 0.5, 0.05, 0.95)
      return buildAtomicLegProfile(item, unionProbability, fallbackOdds)
    })
    const adjustedCombo = combineAtomicMatchProfiles(adjustedProfiles)
    const rawCombo = combineAtomicMatchProfiles(rawProfiles)
    const p = clamp(Number(adjustedCombo.hitProbability || 0), 0, 1)
    const profitWinProbability = clamp(Number(adjustedCombo.profitWinProbability || 0), 0, 1)
    const rawP = clamp(Number(rawCombo.hitProbability || 0), 0, 1)
    const fallbackOdds = subset.reduce((prod, item) => prod * Math.max(1.01, Number(item.odds) || 1.01), 1)
    const odds = Math.max(1.01, Number(adjustedCombo.equivalentOdds || fallbackOdds))
    const ev = Number(adjustedCombo.expectedReturn || 0)
    const variance = Math.max(0, Number(adjustedCombo.variance || 0))
    const sigma = Math.sqrt(Math.max(variance, 0.0001))
    const sharpe = ev / sigma
    const rewardTerm = alpha * ev
    const riskPenalty = (1 - alpha) * sigma
    // ── 思路2: Parlay bonus integrated into utility ──
    const pBonus = parlayBonusFn(legs, parlayBeta)
    // ── 思路6: Entry family diversity bonus ──
    const familyDiv = calcEntryFamilyDiversity(subset)
    const familyBonus = (familyDiv - 0.5) * 0.04 // small bonus for diverse entries within families
    const roleSignal = calcRoleStructureSignal(subset, roleTargets, roleMixStrength)
    const utility = rewardTerm - riskPenalty + pBonus + familyBonus + roleSignal.bonus
    const corr = calcSubsetSourceCorrelation(subset)
    const confAvg = subset.reduce((sum, item) => sum + clamp(item.conf, 0.05, 0.95), 0) / Math.max(legs, 1)
    return {
      subset,
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
  selectedRanked = rebalanceMatchConcentration(selectedRanked, concentrationPool, 10, 0.78)

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

  const recommendations = outputRanked.map((item, idx) => {
    const rank = idx + 1
    const layer = getLayerByRank(rank)
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
    })
    setShowAllRecommendations(false)
    pushPlanHistory(generated, selectedMatches, riskPref)

    const nextSelected = {}
    if (generated.recommendations[0]) {
      nextSelected[generated.recommendations[0].id] = true
    }
    setSelectedRecommendationIds(nextSelected)
  }

  const handleConfirmChecked = () => {
    if (selectedMatches.length === 0) {
      window.alert('请先勾选比赛。')
      return
    }
    const combos = candidateComboCount
    window.alert(`已勾选 ${selectedMatches.length} 场，可生成 ${combos} 个候选组合。`)
  }

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
          <p><strong>16. 输出</strong>：上方可勾选方案直接采纳；下方提供单组合排序与分层下注建议，并显示命中率/盈利率双指标。</p>
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

          <div className="space-y-3">
            {displayedCandidates.map((item, i) => {
              const hasManualRole = Object.prototype.hasOwnProperty.call(matchRoleOverrides, item.key)
              const effectiveRole = normalizeRoleTag(matchRoleOverrides[item.key] || item.autoRole)

              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-4 rounded-xl bg-stone-50 border border-stone-100 hover:border-amber-200 hover:bg-amber-50/50 transition-all cursor-pointer lift-card"
                >
                  <div className="flex items-center gap-3">
                    <div onClick={() => toggleCheck(i)} className={`custom-checkbox ${checkedMatches[i] ? 'checked' : ''}`} />
                    <div>
                      <p className="text-sm font-medium text-stone-700">{item.match}</p>
                      <p className="text-xs text-stone-400">
                        Conf <span className="font-medium text-stone-500">{item.conf.toFixed(2)}</span> · Odds{' '}
                        <span className="font-medium italic text-stone-500">{item.odds.toFixed(2)}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-stone-400">角色</span>
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
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-stone-400">Recom. Invest</span>
                    <span className="block text-sm font-semibold text-stone-700">{item.suggestedAmount > 0 ? `${item.suggestedAmount} rmb` : '--'}</span>
                    <span className={`text-[11px] ${item.adjustedEvPercent >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {formatPercent(item.adjustedEvPercent)}
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
              MarketLean {(calibrationContext.marketBlend?.marketLean || 0).toFixed(2)} · 策略 {activeStrategyMeta.label} · 候选组合{' '}
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

          <div className="mt-4 p-3.5 rounded-xl bg-violet-50/60 border border-violet-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-violet-700 font-medium">串关结构偏好</span>
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
                  className="px-2 py-1 rounded-md text-[11px] bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors"
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
            <p className="text-[10px] text-violet-500/70 mt-2">
              β 提升多关串联的效用分；λ 控制 MMR 去重力度；η 给未覆盖候选加分。
            </p>
            {Object.keys(generationSummary.legsDistribution || {}).length > 0 && (
              <div className="mt-2 pt-2 border-t border-violet-100">
                <p className="text-[10px] text-violet-600 mb-1">上次生成关数分布</p>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(generationSummary.legsDistribution)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([legs, count]) => (
                      <span key={legs} className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px]">
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

        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">推荐方案</h3>
            <span className="text-xs text-stone-400">Top {recommendations.length}</span>
          </div>

          <div className="space-y-3">
            {displayedRecommendations.map((item) => {
              const selected = Boolean(selectedRecommendationIds[item.id])
              return (
                <div
                  key={item.id}
                  onClick={() => toggleRecommendation(item.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer lift-card ${
                    selected ? 'border-amber-200 bg-amber-50/50' : 'border-stone-100 bg-stone-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${selected ? 'text-amber-600' : 'text-stone-500'}`}>{item.tierLabel}</span>
                      <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px] font-medium">{item.legs || item.subset.length}关</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-800">{item.allocation}</span>
                      <div className={`custom-checkbox ${selected ? 'checked' : ''}`} />
                    </div>
                  </div>
                  <p className="text-sm text-stone-700 mb-2">{item.combo}</p>
                  <div className="flex gap-4 text-xs text-stone-500">
                    <span>预期收益: <span className="text-emerald-600 font-medium">{item.ev}</span></span>
                    <span>Hit: <span className="italic font-semibold text-sky-600">{item.winRate}</span></span>
                    <span>Profit: <span className="italic font-semibold text-indigo-600">{item.profitWinRate}</span></span>
                    <span>Sharpe: <span className="italic font-semibold text-violet-600">{item.sharpe}</span></span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="px-2 py-0.5 rounded-full bg-stone-200/70 text-stone-600">Conf均值 {item.explain.confAvg.toFixed(2)}</span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">盈利率 {item.explain.profitWinPct.toFixed(1)}%</span>
                    <span className={`px-2 py-0.5 rounded-full ${item.explain.calibGainPp >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                      校准增益 {item.explain.calibGainPp >= 0 ? '+' : ''}{item.explain.calibGainPp.toFixed(1)}pp
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">风险惩罚占比 {item.explain.riskPenaltySharePct.toFixed(0)}%</span>
                    <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">相关性 {item.explain.corr.toFixed(2)}</span>
                    {item.explain.parlayBonus > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">串关+{item.explain.parlayBonus.toFixed(3)}</span>
                    )}
                    {Math.abs(item.explain.roleMixBonus) > 0.0001 && (
                      <span className={`px-2 py-0.5 rounded-full ${item.explain.roleMixBonus >= 0 ? 'bg-sky-100 text-sky-700' : 'bg-stone-200 text-stone-600'}`}>
                        角色{item.explain.roleMixBonus >= 0 ? '+' : ''}{item.explain.roleMixBonus.toFixed(3)}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-stone-200/70 text-stone-600">{item.explain.roleSignature}</span>
                    {item.coverageInjected && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">覆盖补位</span>
                    )}
                    {!item.explain.thresholdPass && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-600">阈值外</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {recommendations.length > 3 && !showAllRecommendations && (
            <button
              onClick={() => setShowAllRecommendations(true)}
              className="w-full mt-2.5 py-1.5 text-[13px] text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-xl transition-all"
            >
              展开查看全部 {recommendations.length} 个方案 ▼
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

          <div className="mt-4 p-4 rounded-xl bg-stone-50 border border-stone-100 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">总投资（全部推荐）</span>
              <span className="font-semibold">{generationSummary.totalInvest} rmb</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">组合预期收益（全部推荐）</span>
              <span className="font-semibold text-emerald-600">{formatPercent(generationSummary.expectedReturnPercent)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">阈值通过 / 候选总数</span>
              <span className="text-stone-600 font-medium">
                {generationSummary.qualifiedCombos} / {generationSummary.candidateCombos}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">被过滤组合</span>
              <span className="text-stone-500">{generationSummary.filteredOutCombos}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">覆盖补位</span>
              <span className="text-stone-500">{generationSummary.coverageInjectedCombos}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-stone-400">未覆盖勾选场次</span>
              <span className={generationSummary.uncoveredMatches > 0 ? 'text-rose-500' : 'text-emerald-600'}>
                {generationSummary.uncoveredMatches}
              </span>
            </div>
            <div className="pt-2 border-t border-stone-200">
              <div className="flex justify-between text-xs">
                <span className="text-stone-400">已选择方案</span>
                <span className="text-stone-600 font-medium">{selectedSummary.count} / {recommendations.length}</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-stone-400">已选投资</span>
                <span className="text-stone-600 font-medium">{selectedSummary.totalInvest} rmb</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-stone-400">已选预期收益</span>
                <span className="text-emerald-600 font-medium">{selectedSummary.count > 0 ? formatPercent(selectedSummary.expectedReturnPercent) : '--'}</span>
              </div>
            </div>
          </div>

          <div className="mt-3 p-4 rounded-xl border border-stone-100 bg-white">
            <p className="text-xs text-stone-500 mb-2">采纳前模拟（按当前选择）</p>
            {!adoptPreview.ready ? (
              <p className="text-xs text-stone-400">先生成并选择方案后显示。</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-stone-400">总暴露</span>
                  <span className="text-stone-700 font-medium">{Math.round(adoptPreview.totalInvest)} rmb</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">单场最大暴露</span>
                  <span className="text-stone-700">{Math.round(adoptPreview.maxSingleExposure)} rmb</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">集中度</span>
                  <span className={`${adoptPreview.concentration >= 0.45 ? 'text-rose-500' : 'text-emerald-600'}`}>
                    {(adoptPreview.concentration * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">最坏回撤估计（全失手）</span>
                  <span className={drawdownExceeded ? 'text-rose-600 font-semibold' : 'text-rose-500'}>
                    -{Math.round(adoptPreview.worstLoss)} rmb ({adoptPreview.worstDrawdownPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">二次确认阈值</span>
                  <span className={drawdownExceeded ? 'text-rose-600' : 'text-stone-600'}>
                    {maxWorstDrawdownAlertPct.toFixed(1)}%
                    {drawdownExceeded ? '（已超出）' : ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          <button onClick={handleAdopt} className="w-full mt-4 btn-secondary btn-hover">
            采纳已选方案
          </button>
        </div>
      </div>

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
          基于 Markowitz 均值-方差模型，结合原子结果建模与 Kelly 准则优化多资产配置，在风险约束下最大化预期收益，并通过时间近因 + REP + 市场先验融合做动态校准。
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
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-stone-700 truncate">
                      {item.selectedLabel}
                      {item.selectedCount > 2 ? ` + ${item.selectedCount - 2}场` : ''}
                    </p>
                    <p className="text-[11px] text-stone-400">
                      {new Date(item.createdAt).toLocaleString()} · Risk {item.riskPref}% · 候选 {item.candidateCombos}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-stone-500">EV / Invest</p>
                    <p className="text-sm font-semibold text-stone-700">{formatPercent(item.expectedReturnPercent)} / {item.totalInvest} rmb</p>
                  </div>
                  <button
                    onClick={() => restorePlanFromHistory(item)}
                    className="px-2.5 py-1 rounded-lg text-xs border border-stone-200 text-stone-600 hover:border-amber-300 hover:text-amber-700 hover:bg-amber-50 transition-colors"
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
