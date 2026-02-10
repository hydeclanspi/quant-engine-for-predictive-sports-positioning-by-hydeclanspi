import { normalizeEntryRecord } from './entryParsing'

const EPS = 1e-9

const toNumber = (value, fallback = Number.NaN) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')

const RESULT_TOKEN_MAP = new Map([
  ['w', 'win'],
  ['win', 'win'],
  ['home', 'win'],
  ['homewin', 'win'],
  ['h', 'win'],
  ['主胜', 'win'],
  ['主', 'win'],
  ['胜', 'win'],
  ['1', 'win'],
  ['d', 'draw'],
  ['draw', 'draw'],
  ['x', 'draw'],
  ['平', 'draw'],
  ['平局', 'draw'],
  ['0', 'draw'],
  ['l', 'lose'],
  ['lose', 'lose'],
  ['away', 'lose'],
  ['awaywin', 'lose'],
  ['a', 'lose'],
  ['客胜', 'lose'],
  ['客', 'lose'],
  ['负', 'lose'],
  ['2', 'lose'],
])

const RESULT_LABEL_MAP = {
  win: '主胜',
  draw: '平',
  lose: '客胜',
}

const normalizeOutcomeToken = (value) => RESULT_TOKEN_MAP.get(normalizeText(value)) || null

const parseOutcomeSetFromText = (rawValue) => {
  const text = String(rawValue || '').trim()
  if (!text) return null
  const compact = normalizeText(text)
  const outcomes = new Set()

  if (
    compact.includes('胜平') ||
    compact.includes('平胜') ||
    compact.includes('主不败') ||
    compact.includes('1x') ||
    compact.includes('x1') ||
    compact.includes('winordraw') ||
    compact.includes('draworwin') ||
    compact.includes('homeordraw') ||
    compact.includes('draworhome')
  ) {
    outcomes.add('win')
    outcomes.add('draw')
  }

  if (
    compact.includes('平负') ||
    compact.includes('负平') ||
    compact.includes('客不败') ||
    compact.includes('x2') ||
    compact.includes('2x') ||
    compact.includes('draworlose') ||
    compact.includes('loseordraw') ||
    compact.includes('draworaway') ||
    compact.includes('awayordraw')
  ) {
    outcomes.add('draw')
    outcomes.add('lose')
  }

  if (
    compact.includes('胜负') ||
    compact.includes('负胜') ||
    compact.includes('12') ||
    compact.includes('21') ||
    compact.includes('winorlose') ||
    compact.includes('loseorwin') ||
    compact.includes('homeoraway') ||
    compact.includes('awayorhome')
  ) {
    outcomes.add('win')
    outcomes.add('lose')
  }

  const tokenized = String(text)
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[，,\/|+&;、]/g, ' ')
    .replace(/或/g, ' ')
    .replace(/和/g, ' ')
    .replace(/or/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)

  tokenized.forEach((token) => {
    const outcome = normalizeOutcomeToken(token)
    if (outcome) outcomes.add(outcome)
  })

  if (outcomes.size === 0) {
    if (text.includes('胜')) outcomes.add('win')
    if (text.includes('平')) outcomes.add('draw')
    if (text.includes('负')) outcomes.add('lose')
  }

  return outcomes.size > 0 ? outcomes : null
}

const parseResultOutcomeSet = (entry) => {
  const marketType = String(entry?.market_type || '').trim()
  if (marketType && marketType !== 'result' && marketType !== 'other') return null

  const semanticSet = parseOutcomeSetFromText(entry?.semantic_key)
  if (semanticSet) return semanticSet
  return parseOutcomeSetFromText(entry?.name)
}

const normalizeAtomicEntries = (entriesInput, fallbackOdds = Number.NaN) => {
  const rawEntries = Array.isArray(entriesInput) ? entriesInput : []
  return rawEntries
    .map((entry, idx) =>
      normalizeEntryRecord(
        {
          ...entry,
          name: entry?.name || entry?.entry || `entry-${idx + 1}`,
        },
        fallbackOdds,
      ),
    )
    .filter((entry) => entry.name && Number.isFinite(entry.odds) && entry.odds > 1)
}

const normalizeSplitWeights = (count, weightsInput) => {
  if (count <= 0) return []
  const fallback = Array(count).fill(1 / count)
  if (!Array.isArray(weightsInput) || weightsInput.length !== count) return fallback
  const safe = weightsInput.map((value) => Math.max(0, toNumber(value, 0)))
  const sum = safe.reduce((acc, value) => acc + value, 0)
  if (sum <= EPS) return fallback
  return safe.map((value) => value / sum)
}

const buildEntryDescriptors = (entries) => {
  const outcomeSets = entries.map((entry) => parseResultOutcomeSet(entry))
  const useResultOutcomeModel = outcomeSets.every((set) => set && set.size > 0)
  return entries.map((entry, idx) => {
    const atoms = useResultOutcomeModel ? outcomeSets[idx] : new Set([`entry_${idx}`])
    return {
      id: `entry-${idx + 1}`,
      index: idx,
      name: entry.name,
      odds: entry.odds,
      atoms,
      implied: clamp(1 / entry.odds, 0.0001, 0.995),
    }
  })
}

const buildAtomWeights = (descriptors) => {
  const atomWeightMap = new Map()
  descriptors.forEach((descriptor) => {
    const atomCount = Math.max(1, descriptor.atoms.size)
    const share = descriptor.implied / atomCount
    descriptor.atoms.forEach((atom) => {
      atomWeightMap.set(atom, (atomWeightMap.get(atom) || 0) + share)
    })
  })

  const atomKeys = [...atomWeightMap.keys()]
  if (atomKeys.length === 0) return new Map()

  const totalWeight = atomKeys.reduce((sum, atom) => sum + (atomWeightMap.get(atom) || 0), 0)
  if (totalWeight <= EPS) {
    const equal = 1 / atomKeys.length
    const equalMap = new Map()
    atomKeys.forEach((atom) => equalMap.set(atom, equal))
    return equalMap
  }

  const normalizedMap = new Map()
  atomKeys.forEach((atom) => normalizedMap.set(atom, (atomWeightMap.get(atom) || 0) / totalWeight))
  return normalizedMap
}

export const estimateEntryUnionProbability = (entriesInput, fallbackOdds = 2.5) => {
  const fallback = clamp(1 / Math.max(1.01, toNumber(fallbackOdds, 2.5)), 0.02, 0.95)
  const entries = normalizeAtomicEntries(entriesInput, fallbackOdds)
  if (entries.length === 0) return fallback
  const missProbability = entries.reduce((miss, entry) => {
    const implied = clamp(1 / entry.odds, 0.001, 0.97)
    return miss * (1 - implied)
  }, 1)
  return clamp(1 - missProbability, 0.02, 0.95)
}

export const estimateEntryAnchorOdds = (entriesInput, fallbackOdds = 2.5) => {
  const unionProbability = estimateEntryUnionProbability(entriesInput, fallbackOdds)
  return Math.max(1.01, 1 / Math.max(unionProbability, 0.001))
}

export const buildAtomicMatchProfile = ({
  entries: entriesInput,
  unionProbability,
  fallbackOdds = 2.5,
  splitWeights,
} = {}) => {
  const normalizedEntries = normalizeAtomicEntries(entriesInput, fallbackOdds)
  const safeEntries =
    normalizedEntries.length > 0
      ? normalizedEntries
      : [
          normalizeEntryRecord(
            {
              name: 'default',
              odds: Math.max(1.01, toNumber(fallbackOdds, 2.5)),
            },
            fallbackOdds,
          ),
        ]

  const descriptors = buildEntryDescriptors(safeEntries)
  const weights = normalizeSplitWeights(descriptors.length, splitWeights)
  const baseUnionProbability = Number.isFinite(toNumber(unionProbability, Number.NaN))
    ? clamp(toNumber(unionProbability, Number.NaN), 0.001, 0.999)
    : estimateEntryUnionProbability(safeEntries, fallbackOdds)
  const atomWeights = buildAtomWeights(descriptors)

  const outcomeStates = [...atomWeights.entries()]
    .map(([atom, atomWeight]) => {
      const probability = clamp(baseUnionProbability * atomWeight, 0, 1)
      const gross = descriptors.reduce((sum, descriptor, idx) => {
        if (!descriptor.atoms.has(atom)) return sum
        return sum + weights[idx] * descriptor.odds
      }, 0)
      return {
        id: atom,
        label: RESULT_LABEL_MAP[atom] || atom,
        probability,
        gross,
        net: gross - 1,
        isMiss: false,
      }
    })
    .filter((state) => state.probability > EPS)

  const missProbability = clamp(1 - baseUnionProbability, 0, 1)
  const states = [...outcomeStates]
  if (missProbability > EPS) {
    states.push({
      id: 'miss',
      label: 'miss',
      probability: missProbability,
      gross: 0,
      net: -1,
      isMiss: true,
    })
  }

  const totalProbability = states.reduce((sum, state) => sum + state.probability, 0)
  const normalizedStates =
    totalProbability > EPS
      ? states.map((state) => ({
          ...state,
          probability: state.probability / totalProbability,
        }))
      : [
          {
            id: 'miss',
            label: 'miss',
            probability: 1,
            gross: 0,
            net: -1,
            isMiss: true,
          },
        ]

  const expectedGross = normalizedStates.reduce((sum, state) => sum + state.probability * state.gross, 0)
  const expectedReturn = expectedGross - 1
  const variance = normalizedStates.reduce((sum, state) => {
    const diff = state.net - expectedReturn
    return sum + state.probability * diff * diff
  }, 0)
  const hitProbability = normalizedStates.reduce((sum, state) => sum + (state.isMiss ? 0 : state.probability), 0)
  const profitWinProbability = normalizedStates.reduce((sum, state) => sum + (state.net > 0 ? state.probability : 0), 0)
  const conditionalGross = hitProbability > EPS
    ? normalizedStates.reduce((sum, state) => sum + (state.isMiss ? 0 : state.probability * state.gross), 0) / hitProbability
    : 0

  const entryHitProbabilities = descriptors.map((descriptor) =>
    normalizedStates.reduce((sum, state) => {
      if (state.isMiss) return sum
      return descriptor.atoms.has(state.id) ? sum + state.probability : sum
    }, 0),
  )

  return {
    entries: descriptors.map((descriptor, idx) => ({
      id: descriptor.id,
      name: descriptor.name,
      odds: descriptor.odds,
      splitWeight: weights[idx],
      atomKeys: [...descriptor.atoms],
      hitProbability: entryHitProbabilities[idx] || 0,
    })),
    states: normalizedStates,
    hitProbability,
    missProbability: Math.max(0, 1 - hitProbability),
    profitWinProbability,
    expectedGross,
    expectedReturn,
    variance: Math.max(variance, 0),
    sigma: Math.sqrt(Math.max(variance, 0)),
    conditionalOdds: conditionalGross,
    equivalentOdds: conditionalGross,
    fallbackOdds: Math.max(1.01, toNumber(fallbackOdds, 2.5)),
  }
}

export const combineAtomicMatchProfiles = (profilesInput) => {
  const profiles = Array.isArray(profilesInput) ? profilesInput.filter(Boolean) : []
  if (profiles.length === 0) {
    return {
      states: [{ probability: 1, gross: 0, net: -1 }],
      expectedGross: 0,
      expectedReturn: -1,
      variance: 0,
      sigma: 0,
      hitProbability: 0,
      profitWinProbability: 0,
      conditionalOdds: 0,
      equivalentOdds: 0,
    }
  }

  let distribution = [{ probability: 1, gross: 1 }]
  profiles.forEach((profile) => {
    const nextMap = new Map()
    const states = Array.isArray(profile.states) ? profile.states : []
    distribution.forEach((baseState) => {
      states.forEach((state) => {
        const probability = baseState.probability * state.probability
        if (probability <= EPS) return
        const gross = baseState.gross * state.gross
        const key = gross.toFixed(8)
        if (!nextMap.has(key)) {
          nextMap.set(key, {
            probability: 0,
            gross,
          })
        }
        nextMap.get(key).probability += probability
      })
    })
    distribution = [...nextMap.values()]
  })

  const totalProbability = distribution.reduce((sum, state) => sum + state.probability, 0)
  const states =
    totalProbability > EPS
      ? distribution
          .map((state) => ({
            probability: state.probability / totalProbability,
            gross: state.gross,
            net: state.gross - 1,
          }))
          .filter((state) => state.probability > EPS)
      : [{ probability: 1, gross: 0, net: -1 }]

  const expectedGross = states.reduce((sum, state) => sum + state.probability * state.gross, 0)
  const expectedReturn = expectedGross - 1
  const variance = states.reduce((sum, state) => {
    const diff = state.net - expectedReturn
    return sum + state.probability * diff * diff
  }, 0)
  const hitProbability = states.reduce((sum, state) => sum + (state.gross > 0 ? state.probability : 0), 0)
  const profitWinProbability = states.reduce((sum, state) => sum + (state.net > 0 ? state.probability : 0), 0)
  const conditionalOdds = hitProbability > EPS
    ? states.reduce((sum, state) => sum + (state.gross > 0 ? state.probability * state.gross : 0), 0) / hitProbability
    : 0

  return {
    states,
    expectedGross,
    expectedReturn,
    variance: Math.max(variance, 0),
    sigma: Math.sqrt(Math.max(variance, 0)),
    hitProbability,
    profitWinProbability,
    conditionalOdds,
    equivalentOdds: conditionalOdds,
  }
}

export const solveKellyFractionByAtomicDistribution = (statesInput, maxFraction = 0.95) => {
  const states = Array.isArray(statesInput)
    ? statesInput
        .map((state) => ({
          probability: clamp(toNumber(state?.probability, 0), 0, 1),
          net: toNumber(state?.net, Number.NaN),
        }))
        .filter((state) => state.probability > EPS && Number.isFinite(state.net))
    : []
  if (states.length === 0) return 0
  const safeMaxFraction = clamp(toNumber(maxFraction, 0.95), 0, 0.95)
  if (safeMaxFraction <= 0) return 0

  const evalObjective = (fraction) => {
    let score = 0
    for (let i = 0; i < states.length; i += 1) {
      const growth = 1 + fraction * states[i].net
      if (growth <= 1e-9) return Number.NEGATIVE_INFINITY
      score += states[i].probability * Math.log(growth)
    }
    return score
  }

  let bestFraction = 0
  let bestScore = evalObjective(0)

  const coarseStep = 0.02
  for (let fraction = coarseStep; fraction <= safeMaxFraction + EPS; fraction += coarseStep) {
    const score = evalObjective(fraction)
    if (score > bestScore) {
      bestScore = score
      bestFraction = fraction
    }
  }

  let step = coarseStep / 5
  for (let iter = 0; iter < 4; iter += 1) {
    const low = Math.max(0, bestFraction - step * 2)
    const high = Math.min(safeMaxFraction, bestFraction + step * 2)
    for (let fraction = low; fraction <= high + EPS; fraction += step) {
      const score = evalObjective(fraction)
      if (score > bestScore) {
        bestScore = score
        bestFraction = fraction
      }
    }
    step *= 0.5
  }

  return clamp(bestFraction, 0, safeMaxFraction)
}

export const calcAtomicEquivalentOdds = (entriesInput, fallbackOdds = 2.5) => {
  const unionProbability = estimateEntryUnionProbability(entriesInput, fallbackOdds)
  const profile = buildAtomicMatchProfile({
    entries: entriesInput,
    unionProbability,
    fallbackOdds,
  })
  return Math.max(1.01, toNumber(profile.conditionalOdds, fallbackOdds))
}
