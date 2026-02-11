import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, ChevronDown, ChevronRight } from 'lucide-react'
import { bumpTeamSamples, findTeamProfile, getInvestments, getSystemConfig, getTeamProfiles, saveInvestment, searchTeamProfiles } from '../lib/localData'
import { handleNoteShortcut } from '../lib/noteFormatting'
import { getPredictionCalibrationContext, getModeKellyRecommendations } from '../lib/analytics'
import { getPrimaryEntryMarket, normalizeEntryName, normalizeEntryRecord } from '../lib/entryParsing'
import {
  buildAtomicMatchProfile,
  calcAtomicEquivalentOdds,
  combineAtomicMatchProfiles,
  estimateEntryAnchorOdds,
  solveKellyFractionByAtomicDistribution,
} from '../lib/atomicParlay'
import { parseNaturalInput } from '../lib/naturalInputParser'

const MODE_OPTIONS = ['常规', '常规-稳', '常规-杠杆', '半彩票半保险', '保险产品', '赌一把']

// 默认 Kelly 分母映射（基于需求文档 S4）
// 保险产品用较小分母（更激进），赌一把用较大分母（更保守）
const DEFAULT_MODE_KELLY_DIVISOR = {
  常规: 4,
  '常规-稳': 3.5,
  '常规-杠杆': 4.5,
  '常规-激进': 4.5,
  半彩票半保险: 5,
  保险产品: 3,
  赌一把: 6,
}
const TYS_OPTIONS = ['S', 'M', 'L', 'H']
const FID_OPTIONS = ['0', '0.25', '0.4', '0.6', '0.75']
const CONF_QUICK_OPTIONS = [0.2, 0.4, 0.5, 0.6, 0.8]
const FSE_QUICK_OPTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]

const MODE_FACTOR_MAP = {
  常规: 1.0,
  '常规-稳': 1.05,
  '常规-杠杆': 0.95,
  '常规-激进': 0.95,
  半彩票半保险: 0.92,
  保险产品: 1.08,
  赌一把: 0.88,
}

const TYS_FACTOR_MAP = {
  S: 0.94,
  M: 1.0,
  L: 1.04,
  H: 1.08,
}

const FID_FACTOR_MAP = {
  '0': 0.92,
  '0.25': 0.99,
  '0.4': 1.02,
  '0.5': 1.05,
  '0.6': 1.07,
  '0.75': 1.1,
}

const createEmptyMatch = () => ({
  homeTeam: '',
  awayTeam: '',
  entries: [{ name: '', odds: '' }],
  conf: 50,
  mode: '常规',
  tys_home: 'M',
  tys_away: 'M',
  fid: '0.4',
  fse_home: 50,
  fse_away: 50,
  note: '',
})

const normalizeTeamNameInput = (value) =>
  String(value || '')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
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

const formatShortDateWithYear = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const year = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseTimestamp = (value) => {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

const getModeBadgeClass = (mode) => {
  if (mode === '保险产品') return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  if (mode === '赌一把') return 'bg-rose-50 text-rose-600 border border-rose-200'
  if (mode === '半彩票半保险') return 'bg-violet-50 text-violet-600 border border-violet-200'
  if (mode === '常规-稳') return 'bg-sky-50 text-sky-600 border border-sky-200'
  if (mode === '常规-杠杆' || mode === '常规-激进') return 'bg-amber-50 text-amber-700 border border-amber-200'
  return 'bg-stone-100 text-stone-600 border border-stone-200'
}

const getConfBadgeClass = (confPercent) => {
  if (confPercent >= 80) return 'text-blue-700'
  if (confPercent >= 70) return 'text-blue-600'
  if (confPercent >= 60) return 'text-sky-600'
  if (confPercent >= 50) return 'text-sky-500'
  return 'text-stone-500'
}

const createResettableMatchFields = () => ({
  entries: [{ name: '', odds: '' }],
  conf: 50,
  mode: '常规',
  tys_home: 'M',
  tys_away: 'M',
  fid: '0.4',
  fse_home: 50,
  fse_away: 50,
  note: '',
})

const normalizeModeValue = (value) => (MODE_OPTIONS.includes(value) ? value : '常规')
const normalizeTysValue = (value) => {
  const text = String(value || '').trim().toUpperCase()
  return TYS_OPTIONS.includes(text) ? text : 'M'
}

const normalizeFidOption = (value) => {
  const num = Number.parseFloat(value)
  if (!Number.isFinite(num)) return '0.4'
  return (
    [...FID_OPTIONS]
      .map((option) => ({ option, diff: Math.abs(Number.parseFloat(option) - num) }))
      .sort((a, b) => a.diff - b.diff)[0]?.option || '0.4'
  )
}

const normalizeSliderPercent = (value, fallback = 50) => {
  const num = Number.parseFloat(value)
  if (!Number.isFinite(num)) return fallback
  if (num <= 1.2) return clamp(Math.round(num * 100), 0, 100)
  return clamp(Math.round(num), 0, 100)
}

const normalizeTeamKey = (value) => normalizeTeamNameInput(value).toLowerCase()

const normalizeMatchupKey = (homeTeam, awayTeam) => {
  const home = normalizeTeamKey(homeTeam)
  const away = normalizeTeamKey(awayTeam)
  if (!home || !away) return ''
  return [home, away].sort().join('::')
}

const buildEntryDraftsFromHistory = (match) => {
  const entryList = Array.isArray(match?.entries) ? match.entries : []
  const normalizedEntries = entryList
    .map((entry) => {
      const name = normalizeEntryName(entry?.name || '')
      const odd = Number.parseFloat(entry?.odds)
      return {
        name,
        odds: Number.isFinite(odd) && odd > 0 ? String(odd) : '',
      }
    })
    .filter((entry) => entry.name || entry.odds)

  if (normalizedEntries.length > 0) return normalizedEntries

  const fallbackText = String(match?.entry_text || '').trim()
  if (fallbackText) {
    const names = fallbackText
      .split(',')
      .map((name) => normalizeEntryName(name))
      .filter(Boolean)
    const fallbackOdds = Number.parseFloat(match?.odds)
    if (names.length > 0) {
      return names.map((name, idx) => ({
        name,
        odds: idx === 0 && Number.isFinite(fallbackOdds) && fallbackOdds > 0 ? String(fallbackOdds) : '',
      }))
    }
  }

  return [{ name: '', odds: '' }]
}

const getHistoryOddsLabel = (match, entries) => {
  const directOdds = Number.parseFloat(match?.odds)
  if (Number.isFinite(directOdds) && directOdds > 0) return directOdds.toFixed(2)
  const firstEntryOdds = Number.parseFloat(entries.find((entry) => Number.parseFloat(entry?.odds) > 0)?.odds)
  if (Number.isFinite(firstEntryOdds) && firstEntryOdds > 0) return firstEntryOdds.toFixed(2)
  return '--'
}

export default function NewInvestmentPage() {
  const navigate = useNavigate()
  const [dataVersion, setDataVersion] = useState(0)
  const [parlaySize, setParlaySize] = useState(1)
  const [matches, setMatches] = useState([createEmptyMatch()])
  const [comboName, setComboName] = useState('')
  const [showModeDropdown, setShowModeDropdown] = useState({})
  const [actualInput, setActualInput] = useState('180')
  const [activeTeamInput, setActiveTeamInput] = useState(null)
  const [profilesVersion, setProfilesVersion] = useState(0)
  const [historyPrefillApplied, setHistoryPrefillApplied] = useState({})
  const [historyFloatDismissed, setHistoryFloatDismissed] = useState({})
  const [quickInputText, setQuickInputText] = useState('')
  const [quickInputOpen, setQuickInputOpen] = useState(false)
  const [quickInputResult, setQuickInputResult] = useState(null)
  const [systemConfig] = useState(() => getSystemConfig())

  const teamProfiles = useMemo(() => getTeamProfiles(), [profilesVersion])
  const historicalMatchLibrary = useMemo(() => {
    const investments = getInvestments().filter((item) => !item?.is_archived)
    return investments
      .flatMap((investment) => {
        const matchesInInvestment = Array.isArray(investment?.matches) ? investment.matches : []
        return matchesInInvestment
          .map((match, matchIdx) => {
            const homeTeam = normalizeTeamNameInput(match?.home_team)
            const awayTeam = normalizeTeamNameInput(match?.away_team)
            const matchupKey = normalizeMatchupKey(homeTeam, awayTeam)
            if (!matchupKey) return null
            const homeKey = normalizeTeamKey(homeTeam)
            const awayKey = normalizeTeamKey(awayTeam)
            const entries = buildEntryDraftsFromHistory(match)
            const entryPreview = entries
              .map((entry) => String(entry.name || '').trim())
              .filter(Boolean)
              .join(' / ')
            const oddsLabel = getHistoryOddsLabel(match, entries)
            return {
              id: `${investment.id || 'inv'}_${match?.id || matchIdx}`,
              createdAt: investment.created_at,
              createdAtTs: parseTimestamp(investment.created_at),
              dateLabel: formatShortDateWithYear(investment.created_at),
              homeKey,
              awayKey,
              matchupKey,
              entries,
              entryPreview,
              oddsLabel,
              mode: normalizeModeValue(match?.mode),
              confPercent: normalizeSliderPercent(match?.conf, 50),
              tys_home: normalizeTysValue(match?.tys_home),
              tys_away: normalizeTysValue(match?.tys_away),
              fid: normalizeFidOption(match?.fid),
              fse_home: normalizeSliderPercent(match?.fse_home, 50),
              fse_away: normalizeSliderPercent(match?.fse_away, 50),
              note: String(match?.note || ''),
            }
          })
          .filter(Boolean)
      })
      .sort((a, b) => b.createdAtTs - a.createdAtTs)
  }, [dataVersion])
  const historySuggestionsByMatchup = useMemo(() => {
    const map = new Map()
    historicalMatchLibrary.forEach((item) => {
      if (!map.has(item.matchupKey)) map.set(item.matchupKey, [])
      map.get(item.matchupKey).push(item)
    })
    map.forEach((items, key) => {
      map.set(
        key,
        [...items].sort((a, b) => b.createdAtTs - a.createdAtTs),
      )
    })
    return map
  }, [historicalMatchLibrary])
  const latestTeamFseMap = useMemo(() => {
    const map = new Map()
    historicalMatchLibrary.forEach((item) => {
      if (item.homeKey && !map.has(item.homeKey)) {
        map.set(item.homeKey, { value: item.fse_home, dateLabel: item.dateLabel })
      }
      if (item.awayKey && !map.has(item.awayKey)) {
        map.set(item.awayKey, { value: item.fse_away, dateLabel: item.dateLabel })
      }
    })
    return map
  }, [historicalMatchLibrary])
  const riskCap = useMemo(
    () => Math.round(systemConfig.initialCapital * systemConfig.riskCapRatio),
    [systemConfig.initialCapital, systemConfig.riskCapRatio],
  )
  const calibrationContext = useMemo(() => getPredictionCalibrationContext(), [dataVersion])

  // S4: 根据历史数据计算每个 Mode 的最优 Kelly 分母
  const modeKellyMap = useMemo(() => {
    const recommendations = getModeKellyRecommendations()
    const map = new Map()
    recommendations.forEach((row) => {
      if (row.samples >= 3) {
        // 样本量足够时使用历史数据推荐值
        map.set(row.mode, row.kellyDivisor)
      }
    })
    return map
  }, [dataVersion])

  // 获取某个 Mode 的 Kelly 分母（优先使用历史数据，否则用默认值）
  const getKellyDivisorForMode = (mode) => {
    if (modeKellyMap.has(mode)) return modeKellyMap.get(mode)
    return DEFAULT_MODE_KELLY_DIVISOR[mode] || systemConfig.kellyDivisor
  }

  useEffect(() => {
    const onDataChanged = () => setDataVersion((prev) => prev + 1)
    window.addEventListener('dugou:data-changed', onDataChanged)
    return () => window.removeEventListener('dugou:data-changed', onDataChanged)
  }, [])

  useEffect(() => {
    setMatches((prev) =>
      Array.from({ length: parlaySize }, (_, i) => {
        if (!prev[i]) return createEmptyMatch()
        return {
          ...prev[i],
          entries: prev[i].entries.map((entry) => ({ ...entry })),
        }
      }),
    )
    setActualInput(parlaySize > 1 ? '80' : '180')
  }, [parlaySize])

  useEffect(() => {
    setHistoryPrefillApplied((prev) => {
      const next = {}
      Object.keys(prev).forEach((key) => {
        if (Number.parseInt(key, 10) < parlaySize) {
          next[key] = prev[key]
        }
      })
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [parlaySize])

  useEffect(() => {
    setHistoryFloatDismissed((prev) => {
      const next = {}
      Object.keys(prev).forEach((key) => {
        if (Number.parseInt(key, 10) < parlaySize) {
          next[key] = prev[key]
        }
      })
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [parlaySize])

  const parsedActualInput = useMemo(() => {
    const parsed = Number.parseInt(String(actualInput || '').trim(), 10)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }, [actualInput])

  const updateMatch = (idx, field, value) => {
    setMatches((prev) => {
      const next = [...prev]
      const normalizedValue =
        field === 'homeTeam' || field === 'awayTeam' ? normalizeTeamNameInput(value) : value
      next[idx] = { ...next[idx], [field]: normalizedValue }
      return next
    })
    if (field === 'homeTeam' || field === 'awayTeam') {
      setHistoryPrefillApplied((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, idx)) return prev
        const next = { ...prev }
        delete next[idx]
        return next
      })
      setHistoryFloatDismissed((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, idx)) return prev
        const next = { ...prev }
        delete next[idx]
        return next
      })
    }
  }

  const updateEntry = (idx, entryIdx, field, value) => {
    setMatches((prev) => {
      const next = [...prev]
      const match = next[idx]
      const entries = [...match.entries]
      const oldEntry = entries[entryIdx]
      const normalizedValue = field === 'name' ? normalizeEntryName(value) : value
      entries[entryIdx] = { ...oldEntry, [field]: normalizedValue }
      next[idx] = { ...match, entries }
      return next
    })
  }

  const addEntry = (idx) => {
    setMatches((prev) => {
      const next = [...prev]
      next[idx] = { ...next[idx], entries: [...next[idx].entries, { name: '', odds: '' }] }
      return next
    })
  }

  const removeEntry = (idx, entryIdx) => {
    setMatches((prev) => {
      const next = [...prev]
      if (next[idx].entries.length <= 1) return prev
      const entries = [...next[idx].entries]
      entries.splice(entryIdx, 1)
      next[idx] = { ...next[idx], entries }
      return next
    })
  }

  const parseOdds = (value) => Number.parseFloat(value)

  const getValidEntries = (entries) =>
    entries
      .map((entry) => normalizeEntryRecord({ name: entry.name, odds: parseOdds(entry.odds) }, parseOdds(entry.odds)))
      .filter((entry) => entry.name && Number.isFinite(entry.odds) && entry.odds > 0)

  const calcMatchOdds = (entries) => {
    const validEntries = getValidEntries(entries)
    return calcAtomicEquivalentOdds(validEntries, systemConfig.defaultOdds)
  }

  const calcMatchAnchorOdds = (entries) => {
    const validEntries = getValidEntries(entries)
    return estimateEntryAnchorOdds(validEntries, systemConfig.defaultOdds)
  }

  const calcAdjustedConf = (match) => {
    // 优先使用回归方程校准（含可靠度收缩），回退到分组平均乘数
    const rawConf = clamp(match.conf / 100, 0.05, 0.95)
    const confBase =
      typeof calibrationContext?.calibrate === 'function'
        ? clamp(calibrationContext.calibrate(rawConf), 0.05, 0.95)
        : clamp(rawConf * clamp(Number(calibrationContext.multipliers.conf || 1), 0.75, 1.25), 0.05, 0.95)
    const fseMultiplier = clamp(Number(calibrationContext.multipliers.fse || 1), 0.75, 1.25)
    const modeFactor = MODE_FACTOR_MAP[match.mode] || 1
    const tysFactor = ((TYS_FACTOR_MAP[match.tys_home] || 1) + (TYS_FACTOR_MAP[match.tys_away] || 1)) / 2
    const fidFactor = FID_FACTOR_MAP[match.fid] || 1
    const fseMatch = Math.sqrt((match.fse_home / 100) * (match.fse_away / 100))
    const fseFactor = clamp((0.85 + fseMatch * 0.3) * fseMultiplier, 0.72, 1.35)
    const odds = calcMatchAnchorOdds(match.entries)
    const confSignal = clamp(confBase / 0.5, 0.15, 1.95)
    const weightedLift =
      confSignal ** getFactorWeight(systemConfig.weightConf, 0.45) *
      modeFactor ** getFactorWeight(systemConfig.weightMode, 0.16) *
      tysFactor ** getFactorWeight(systemConfig.weightTys, 0.12) *
      fidFactor ** getFactorWeight(systemConfig.weightFid, 0.14) *
      fseFactor ** getFactorWeight(systemConfig.weightFse, 0.07)
    const baseProbability = clamp(0.5 * weightedLift, 0.05, 0.95)
    if (typeof calibrationContext?.calibrateProbabilityForMatch !== 'function') return baseProbability
    return clamp(
      calibrationContext.calibrateProbabilityForMatch({
        baseProbability,
        conf: rawConf,
        odds,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
      }),
      0.05,
      0.95,
    )
  }

  const atomicMatchProfiles = useMemo(
    () =>
      matches.map((match) => {
        const unionProbability = calcAdjustedConf(match)
        const validEntries = getValidEntries(match.entries)
        return {
          ...buildAtomicMatchProfile({
            entries: validEntries,
            unionProbability,
            fallbackOdds: systemConfig.defaultOdds,
          }),
          unionProbability,
        }
      }),
    [calibrationContext, matches, systemConfig],
  )

  const combinedAtomicProfile = useMemo(
    () => combineAtomicMatchProfiles(atomicMatchProfiles),
    [atomicMatchProfiles],
  )

  const combinedOdds = useMemo(() => {
    const conditionalOdds = Number(combinedAtomicProfile.conditionalOdds)
    if (Number.isFinite(conditionalOdds) && conditionalOdds > 0) {
      return conditionalOdds
    }
    const fallback = matches.reduce((product, match) => product * calcMatchOdds(match.entries), 1)
    return Number.isFinite(fallback) ? fallback : 0
  }, [combinedAtomicProfile, matches, systemConfig.defaultOdds])

  const expectedRating = useMemo(() => {
    if (atomicMatchProfiles.length === 0) return 0
    const average = atomicMatchProfiles.reduce((sum, row) => sum + row.unionProbability, 0) / atomicMatchProfiles.length
    return Number.isFinite(average) ? average : 0
  }, [atomicMatchProfiles])

  // S4: 计算综合 Kelly 分母（加权平均各场 Mode 的 Kelly 分母）
  const effectiveKellyDivisor = useMemo(() => {
    if (matches.length === 0) return systemConfig.kellyDivisor
    const divisors = matches.map((match) => getKellyDivisorForMode(match.mode))
    const avg = divisors.reduce((sum, d) => sum + d, 0) / divisors.length
    return Number.isFinite(avg) ? avg : systemConfig.kellyDivisor
  }, [matches, modeKellyMap, systemConfig.kellyDivisor])

  const recommendedInvest = useMemo(() => {
    const states = combinedAtomicProfile.states || []
    if (states.length === 0) return 0
    const kelly = solveKellyFractionByAtomicDistribution(states, 0.95)
    if (!Number.isFinite(kelly) || kelly <= 0) return 0
    // S4: 使用动态 Kelly 分母（基于 Mode）
    const raw = systemConfig.initialCapital * (kelly / effectiveKellyDivisor)
    const confidenceLift = 0.88 + expectedRating * 0.24
    return Math.min(riskCap, Math.max(0, Math.round(raw * confidenceLift)))
  }, [combinedAtomicProfile, effectiveKellyDivisor, expectedRating, riskCap, systemConfig.initialCapital])

  const getTeamSuggestions = (query) => searchTeamProfiles(query, teamProfiles, 6)

  const applyTeamSuggestion = (matchIdx, side, profileName) => {
    const targetField = side === 'home' ? 'homeTeam' : 'awayTeam'
    updateMatch(matchIdx, targetField, profileName)
    setActiveTeamInput(null)
  }

  const getTeamHint = (name) => {
    if (!name) return null
    const profile = findTeamProfile(name, teamProfiles)
    if (!profile) return '新球队（确认投资后自动建档）'
    const clean = normalizeTeamNameInput(name)
    if (clean && clean !== profile.teamName) {
      return `将自动规范为 ${profile.teamName}`
    }
    return `${profile.totalSamples}场 · REP ${profile.avgRep.toFixed(2)}`
  }

  const canonicalizeTeamName = (name) => {
    const clean = normalizeTeamNameInput(name)
    if (!clean) return ''
    const profile = findTeamProfile(clean, teamProfiles)
    return profile?.teamName || clean
  }

  const resolveTypingTeamName = (name) => {
    const clean = normalizeTeamNameInput(name)
    if (!clean) return ''
    const profile = findTeamProfile(clean, teamProfiles)
    return profile?.teamName || clean
  }

  const getMatchOddsWarnings = (entries) => {
    const validOdds = getValidEntries(entries).map((entry) => entry.odds)
    const warnings = []
    if (validOdds.length === 0) return warnings
    const maxOdds = Math.max(...validOdds)
    const minOdds = Math.min(...validOdds)
    if (maxOdds > 15) {
      warnings.push(`最高赔率 ${maxOdds.toFixed(2)} 偏高，请确认是否小数点录入错误。`)
    }
    if (minOdds < 1.1) {
      warnings.push(`最低赔率 ${minOdds.toFixed(2)} 偏低，请确认是否录入正确。`)
    }
    if (validOdds.length > 1 && maxOdds / Math.max(minOdds, 0.01) > 8) {
      warnings.push('同场 Entry 赔率跨度较大，请确认是否跨盘口混录。')
    }
    if (validOdds.length > 1) {
      const atomicOdds = calcMatchOdds(entries)
      if (Number.isFinite(atomicOdds) && atomicOdds <= 1.05) {
        warnings.push(`同场多 Entry 当前等效赔率约 ${atomicOdds.toFixed(2)}，更偏向对冲结构。`)
      }
    }
    return warnings
  }

  const applyHistoryPrefill = (idx, historyItem) => {
    if (!historyItem) return
    setMatches((prev) => {
      const next = [...prev]
      const current = next[idx]
      if (!current) return prev

      const currentHomeKey = normalizeTeamNameInput(current.homeTeam).toLowerCase()
      const currentAwayKey = normalizeTeamNameInput(current.awayTeam).toLowerCase()
      const reversed = currentHomeKey === historyItem.awayKey && currentAwayKey === historyItem.homeKey

      next[idx] = {
        ...current,
        entries: historyItem.entries.map((entry) => ({ ...entry })),
        conf: historyItem.confPercent,
        mode: historyItem.mode,
        tys_home: reversed ? historyItem.tys_away : historyItem.tys_home,
        tys_away: reversed ? historyItem.tys_home : historyItem.tys_away,
        fid: historyItem.fid,
        fse_home: reversed ? historyItem.fse_away : historyItem.fse_home,
        fse_away: reversed ? historyItem.fse_home : historyItem.fse_away,
        note: historyItem.note,
      }
      return next
    })
    setHistoryPrefillApplied((prev) => ({
      ...prev,
      [idx]: {
        id: historyItem.id,
        dateLabel: historyItem.dateLabel,
        mode: historyItem.mode,
        confPercent: historyItem.confPercent,
        entryPreview: historyItem.entryPreview,
        oddsLabel: historyItem.oddsLabel,
      },
    }))
    setHistoryFloatDismissed((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, idx)) return prev
      const next = { ...prev }
      delete next[idx]
      return next
    })
    setShowModeDropdown((prev) => ({ ...prev, [idx]: false }))
  }

  const clearHistoryPrefill = (idx) => {
    setMatches((prev) => {
      const next = [...prev]
      const current = next[idx]
      if (!current) return prev
      next[idx] = {
        ...current,
        ...createResettableMatchFields(),
      }
      return next
    })
    setHistoryPrefillApplied((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, idx)) return prev
      const next = { ...prev }
      delete next[idx]
      return next
    })
    setHistoryFloatDismissed((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, idx)) return prev
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }

  const dismissHistorySuggestions = (idx) => {
    setHistoryFloatDismissed((prev) => {
      if (prev[idx]) return prev
      return {
        ...prev,
        [idx]: true,
      }
    })
  }

  const validateForm = () => {
    if (!Number.isFinite(parsedActualInput) || parsedActualInput <= 0) {
      return '请先填写 Inputs 实际投资金额（必须大于 0）。'
    }

    for (let idx = 0; idx < matches.length; idx += 1) {
      const match = matches[idx]
      if (!match.homeTeam.trim() || !match.awayTeam.trim()) {
        return `第 ${idx + 1} 场还没填完主队/客队。`
      }
      if (match.homeTeam.trim() === match.awayTeam.trim()) {
        return `第 ${idx + 1} 场主队和客队不能相同。`
      }
      const validEntries = getValidEntries(match.entries)
      if (validEntries.length === 0) {
        return `第 ${idx + 1} 场至少要有 1 条有效 Entry（名称 + 正数赔率）。`
      }
    }
    return ''
  }

  const resetForm = () => {
    setMatches(Array.from({ length: parlaySize }, () => createEmptyMatch()))
    setShowModeDropdown({})
    setActiveTeamInput(null)
    setHistoryPrefillApplied({})
    setHistoryFloatDismissed({})
  }

  const buildInvestmentPayload = () => {
    const validationMessage = validateForm()
    if (validationMessage) {
      window.alert(validationMessage)
      return null
    }

    const normalizedMatches = matches.map((match) => {
      const validEntries = getValidEntries(match.entries)
      const entryMarket = getPrimaryEntryMarket(validEntries, validEntries.map((entry) => entry.name).join(', '))
      const matchOdds = calcMatchOdds(match.entries)
      const fseHome = Number((match.fse_home / 100).toFixed(2))
      const fseAway = Number((match.fse_away / 100).toFixed(2))
      return {
        id: buildId('match'),
        home_team: canonicalizeTeamName(match.homeTeam),
        away_team: canonicalizeTeamName(match.awayTeam),
        entries: validEntries,
        entry_text: validEntries.map((entry) => entry.name).join(', '),
        entry_market_type: entryMarket.marketType,
        entry_market_label: entryMarket.marketLabel,
        entry_semantic_key: entryMarket.semanticKey,
        odds: Number(matchOdds.toFixed(2)),
        conf: Number((match.conf / 100).toFixed(2)),
        mode: match.mode,
        tys_home: match.tys_home,
        tys_away: match.tys_away,
        fid: Number.parseFloat(match.fid),
        fse_home: fseHome,
        fse_away: fseAway,
        fse_match: Number(Math.sqrt(fseHome * fseAway).toFixed(2)),
        note: match.note.trim(),
        results: '',
        is_correct: null,
        match_rating: null,
        match_rep: null,
      }
    })

    const newInvestment = {
      id: buildId('inv'),
      created_at: new Date().toISOString(),
      parlay_size: parlaySize,
      combo_name: parlaySize > 1 ? comboName.trim() : '',
      inputs: parsedActualInput,
      suggested_amount: recommendedInvest,
      expected_rating: Number(expectedRating.toFixed(2)),
      combined_odds: Number(combinedOdds.toFixed(2)),
      status: 'pending',
      revenues: null,
      profit: null,
      actual_rating: null,
      rep: null,
      remarks: '',
      matches: normalizedMatches,
    }

    return { newInvestment, normalizedMatches }
  }

  const handleQuickInput = () => {
    if (!quickInputText.trim()) return
    const result = parseNaturalInput(quickInputText)
    setQuickInputResult(result)
    if (result.matches.length === 0) return

    // Apply parsed matches to form
    const newSize = Math.min(5, result.matches.length)
    setParlaySize(newSize)
    setMatches(
      result.matches.slice(0, 5).map((draft) => ({
        ...createEmptyMatch(),
        ...draft,
        // strip internal _nlMeta from form state
      })),
    )
    setActualInput(newSize === 1 ? '180' : '80')
    setHistoryPrefillApplied({})
    setHistoryFloatDismissed({})
  }

  const persistCurrentInvestment = () => {
    const payload = buildInvestmentPayload()
    if (!payload) return null
    const { newInvestment, normalizedMatches } = payload
    saveInvestment(newInvestment)
    bumpTeamSamples(normalizedMatches.flatMap((item) => [item.home_team, item.away_team]))
    setProfilesVersion((prev) => prev + 1)
    setComboName('')
    resetForm()
    return newInvestment
  }

  const handleConfirmInvestment = () => {
    persistCurrentInvestment()
  }

  const handleAddToCombo = () => {
    const saved = persistCurrentInvestment()
    if (!saved) return
    navigate('/combo')
  }

  return (
    <div className="page-shell page-content-fluid">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">新建投资</h2>
        <p className="text-stone-400 text-sm mt-1.5 leading-relaxed">录入比赛信息与预测参数 · Record match predictions & calibration parameters</p>
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 p-4 mb-5">
        <button
          onClick={() => setQuickInputOpen((prev) => !prev)}
          className="flex items-center gap-2 text-sm text-stone-600 hover:text-amber-600 transition-colors w-full"
        >
          {quickInputOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="font-medium">Quick Input</span>
          <span className="ml-1 px-[5px] py-[0.5px] rounded border border-indigo-200 bg-indigo-50 text-[7.5px] font-semibold uppercase tracking-[0.08em] text-indigo-500">Beta</span>
          <span className="text-[11px] text-stone-400 ml-1">自然语言快捷录入</span>
        </button>

        {quickInputOpen && (
          <div className="mt-3 space-y-2">
            <textarea
              value={quickInputText}
              onChange={(e) => setQuickInputText(e.target.value)}
              placeholder={'示例：利兹联win/平拜仁 conf3.5 odds7.4 fse0.72\n或：arsenal W, chelsea D, conf 55 60, odds 1.8 3.2'}
              rows={3}
              className="input-glow w-full px-3 py-2 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400 resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleQuickInput}
                disabled={!quickInputText.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                解析并填入
              </button>
              {quickInputText.trim() && (
                <button
                  onClick={() => { setQuickInputText(''); setQuickInputResult(null) }}
                  className="px-3 py-1.5 rounded-lg text-xs text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
                >
                  清空
                </button>
              )}
            </div>

            {quickInputResult && (
              <div className="mt-2 space-y-1">
                {quickInputResult.matches.length > 0 && (
                  <p className="text-[11px] text-emerald-600">
                    已识别 {quickInputResult.matches.length} 场比赛
                    {quickInputResult.confidence >= 0.7 ? '' : ' (部分字段可能需要手动补充)'}
                  </p>
                )}
                {quickInputResult.diagnostics.map((d, i) => (
                  <p
                    key={i}
                    className={`text-[11px] ${
                      d.level === 'error' ? 'text-rose-500' : d.level === 'warning' ? 'text-amber-600' : 'text-stone-400'
                    }`}
                  >
                    {d.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-stone-100 bg-stone-50/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 flex-nowrap min-w-0">
              <span className="text-sm text-stone-600 whitespace-nowrap">Portfolio Construction</span>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((size) => (
                  <button
                    key={size}
                    onClick={() => setParlaySize(size)}
                    className={`w-10 h-10 rounded-xl text-sm font-medium btn-hover transition-all ${
                      size === parlaySize
                        ? 'bg-gradient-to-br from-amber-400 to-orange-400 text-white shadow-lg shadow-orange-200/40'
                        : 'bg-white border border-stone-200 text-stone-500 hover:border-amber-300 hover:text-amber-600'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <span className="text-xs text-stone-400 ml-2 whitespace-nowrap">{parlaySize === 1 ? '(single match)' : `(${parlaySize} matches combo)`}</span>
            </div>

            {parlaySize > 1 && (
              <div className="w-40 md:w-44 shrink-0">
                <input
                  type="text"
                  placeholder="title name (可选)"
                  value={comboName}
                  onChange={(event) => setComboName(event.target.value)}
                  className="input-glow w-full px-3 py-2 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                />
              </div>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {matches.map((match, idx) => {
            const homeSuggestions =
              activeTeamInput?.matchIdx === idx && activeTeamInput?.side === 'home' ? getTeamSuggestions(match.homeTeam) : []
            const awaySuggestions =
              activeTeamInput?.matchIdx === idx && activeTeamInput?.side === 'away' ? getTeamSuggestions(match.awayTeam) : []
            const matchupKey = normalizeMatchupKey(match.homeTeam, match.awayTeam)
            const historySuggestions = matchupKey ? (historySuggestionsByMatchup.get(matchupKey) || []).slice(0, 3) : []
            const appliedHistory = historyPrefillApplied[idx] || null
            const isHistorySuggestionDismissed = Boolean(historyFloatDismissed[idx])
            const homeTeamKey = normalizeTeamKey(match.homeTeam)
            const awayTeamKey = normalizeTeamKey(match.awayTeam)
            const homeFseHistorySuggestion = homeTeamKey ? (latestTeamFseMap.get(homeTeamKey) ?? null) : null
            const awayFseHistorySuggestion = awayTeamKey ? (latestTeamFseMap.get(awayTeamKey) ?? null) : null

            return (
              <div key={idx} className={`relative ${idx > 0 ? 'pt-6 border-t border-stone-100' : ''}`}>
                {appliedHistory ? (
                  <div className="absolute right-1 top-0 z-30 history-float-wrap">
                    <div className="history-float-panel history-float-enter px-2.5 py-2">
                      <div className="relative z-[1] flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[9px] uppercase tracking-[0.11em] text-stone-500/95">已套用历史参数</p>
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/65 text-stone-600 border border-white/70">
                              {appliedHistory.dateLabel}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${getModeBadgeClass(appliedHistory.mode)}`}>{appliedHistory.mode}</span>
                            <span className={`text-[10px] font-semibold ${getConfBadgeClass(appliedHistory.confPercent)}`}>
                              Conf {(appliedHistory.confPercent / 100).toFixed(2)}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => clearHistoryPrefill(idx)}
                          className="relative z-[1] shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium border border-amber-200/90 bg-amber-50/90 text-amber-700 hover:bg-amber-100 transition-colors"
                        >
                          撤回
                        </button>
                      </div>
                      <p className="relative z-[1] mt-1.5 text-[10px] text-stone-500 truncate">
                        <span>
                          Entries · <span className="font-semibold">{appliedHistory.entryPreview || '未记录'}</span>
                        </span>
                        <span className="ml-1.5 text-[10px] italic text-violet-600">
                          odds <span className="font-semibold">{appliedHistory.oddsLabel || '--'}</span>
                        </span>
                      </p>
                    </div>
                  </div>
                ) : (
                  historySuggestions.length > 0 && !isHistorySuggestionDismissed && (
                    <div className="absolute right-1 top-0 z-30 history-float-wrap">
                      <div className="history-float-panel history-float-enter px-2.5 py-2">
                        <div className="relative z-[1] flex items-center justify-between gap-2">
                          <span className="text-[9px] uppercase tracking-[0.11em] text-stone-500/95">历史对阵匹配</span>
                          <span className="text-[9px] text-stone-400/95">{historySuggestions.length} 条</span>
                        </div>
                        <div className="relative z-[1] mt-1.5 space-y-1 max-h-36 overflow-y-auto custom-scrollbar pr-0.5">
                          {historySuggestions.map((historyItem) => (
                            <button
                              key={historyItem.id}
                              type="button"
                              onClick={() => applyHistoryPrefill(idx, historyItem)}
                              className="history-float-item w-full text-left rounded-lg border border-white/75 bg-white/72 px-2 py-1.5 hover:border-amber-200/80 hover:bg-amber-50/70"
                            >
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/70 text-stone-600 border border-stone-200/80">
                                  {historyItem.dateLabel}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${getModeBadgeClass(historyItem.mode)}`}>{historyItem.mode}</span>
                                <span className={`text-[10px] font-semibold ${getConfBadgeClass(historyItem.confPercent)}`}>
                                  Conf {(historyItem.confPercent / 100).toFixed(2)}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] text-stone-500 truncate">
                                <span>
                                  Entries · <span className="font-semibold">{historyItem.entryPreview || '未记录'}</span>
                                </span>
                                <span className="ml-1.5 text-[10px] italic text-violet-600">
                                  odds <span className="font-semibold">{historyItem.oddsLabel || '--'}</span>
                                </span>
                              </p>
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => dismissHistorySuggestions(idx)}
                          title="关闭历史匹配浮层"
                          className="absolute bottom-1 right-1 z-[2] h-4 w-4 inline-flex items-center justify-center rounded-full border border-white/70 bg-white/58 hover:bg-white/88 text-[11px] font-medium leading-none text-stone-400 transition-colors"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )
                )}

                <div className="flex items-center gap-3 mb-4">
                  <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center">
                    <span className="text-amber-600 text-xs font-bold">{idx + 1}</span>
                  </div>
                  <span className="text-sm font-medium text-stone-700">比赛信息</span>
                </div>

                <div className="grid grid-cols-11 gap-3 items-center mb-4">
                  <div className="col-span-5 relative">
                    <label className="text-xs text-stone-400 mb-1.5 block">主队</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="输入球队名或缩写..."
                        value={match.homeTeam}
                        onFocus={() => setActiveTeamInput({ matchIdx: idx, side: 'home' })}
                        onBlur={() => setTimeout(() => setActiveTeamInput(null), 120)}
                        onChange={(event) => {
                          updateMatch(idx, 'homeTeam', resolveTypingTeamName(event.target.value))
                          setActiveTeamInput({ matchIdx: idx, side: 'home' })
                        }}
                        className="input-glow w-full px-4 py-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                      />
                      {match.homeTeam && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-stone-400 pointer-events-none">
                          {getTeamHint(match.homeTeam)}
                        </div>
                      )}
                    </div>
                    {homeSuggestions.length > 0 && (
                      <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl border border-stone-200 shadow-lg z-20 overflow-hidden">
                        {homeSuggestions.map((team) => (
                          <button
                            key={`${team.teamId}-home-${idx}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyTeamSuggestion(idx, 'home', team.teamName)}
                            className="w-full px-3 py-2 text-left hover:bg-amber-50 transition-colors"
                          >
                            <div className="text-sm text-stone-700">{team.teamName}</div>
                            <div className="text-[11px] text-stone-400">
                              {team.totalSamples} 场 · REP {team.avgRep.toFixed(2)}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="col-span-1 text-center text-stone-300 text-lg">vs</div>

                  <div className="col-span-5 relative">
                    <label className="text-xs text-stone-400 mb-1.5 block">客队</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="输入球队名或缩写..."
                        value={match.awayTeam}
                        onFocus={() => setActiveTeamInput({ matchIdx: idx, side: 'away' })}
                        onBlur={() => setTimeout(() => setActiveTeamInput(null), 120)}
                        onChange={(event) => {
                          updateMatch(idx, 'awayTeam', resolveTypingTeamName(event.target.value))
                          setActiveTeamInput({ matchIdx: idx, side: 'away' })
                        }}
                        className="input-glow w-full px-4 py-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                      />
                      {match.awayTeam && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-stone-400 pointer-events-none">
                          {getTeamHint(match.awayTeam)}
                        </div>
                      )}
                    </div>
                    {awaySuggestions.length > 0 && (
                      <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl border border-stone-200 shadow-lg z-20 overflow-hidden">
                        {awaySuggestions.map((team) => (
                          <button
                            key={`${team.teamId}-away-${idx}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyTeamSuggestion(idx, 'away', team.teamName)}
                            className="w-full px-3 py-2 text-left hover:bg-amber-50 transition-colors"
                          >
                            <div className="text-sm text-stone-700">{team.teamName}</div>
                            <div className="text-[11px] text-stone-400">
                              {team.totalSamples} 场 · REP {team.avgRep.toFixed(2)}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-stone-400">Entries 预测结果</label>
                    <button onClick={() => addEntry(idx)} className="text-xs text-amber-500 hover:text-amber-600 flex items-center gap-1">
                      <Plus size={12} /> 添加 Entry
                    </button>
                  </div>
                  <div className="space-y-2">
                    {match.entries.map((entry, entryIdx) => (
                      <div key={entryIdx} className="grid grid-cols-11 gap-3 items-center">
                        <div className="col-span-5">
                          <input
                            type="text"
                            placeholder="主胜 / 平 / 大2.5..."
                            value={entry.name}
                            onChange={(event) => updateEntry(idx, entryIdx, 'name', event.target.value)}
                            className="input-glow w-full px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                          />
                        </div>
                        <div className="col-span-1" />
                        <div className="col-span-4">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Odds"
                            value={entry.odds}
                            onChange={(event) => updateEntry(idx, entryIdx, 'odds', event.target.value)}
                            className="input-glow w-full px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
                          />
                        </div>
                        <div className="col-span-1 text-center">
                          {match.entries.length > 1 && (
                            <button onClick={() => removeEntry(idx, entryIdx)} className="text-stone-400 hover:text-rose-500 transition-colors">
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {match.entries.length > 1 && (
                    <p className="text-xs text-stone-500 mt-2">
                      Overall Odds（原子等效）:{' '}
                      <span className="font-semibold text-amber-600">{calcMatchOdds(match.entries).toFixed(2)}</span>
                    </p>
                  )}
                  {getMatchOddsWarnings(match.entries).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {getMatchOddsWarnings(match.entries).map((warning, warningIdx) => (
                        <p key={warningIdx} className="text-[11px] text-rose-500">
                          ⚠ {warning}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="relative">
                    <label className="text-xs text-stone-400 mb-1.5 block">Mode 模式</label>
                    <button
                      onClick={() => setShowModeDropdown((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      className="input-glow w-full px-4 py-3 rounded-xl border border-stone-200 text-sm text-left bg-white flex items-center justify-between hover:border-amber-300 transition-colors"
                    >
                      <span>{match.mode}</span>
                      <ChevronDown size={14} className="text-stone-400" />
                    </button>
                    {showModeDropdown[idx] && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-10 overflow-hidden animate-fade-in">
                        {MODE_OPTIONS.map((opt) => (
                          <button
                            type="button"
                            key={opt}
                            onClick={() => {
                              updateMatch(idx, 'mode', opt)
                              setShowModeDropdown((prev) => ({ ...prev, [idx]: false }))
                            }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                              match.mode === opt ? 'bg-amber-50 text-amber-700' : 'hover:bg-stone-50'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="col-span-2">
                    <label className="text-xs text-stone-400 mb-1.5 block">Conf. 主观置信度</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={match.conf}
                        onChange={(event) => updateMatch(idx, 'conf', Number.parseInt(event.target.value, 10))}
                        className="flex-1"
                      />
                      <span className="text-sm font-medium text-amber-600 w-10">{(match.conf / 100).toFixed(2)}</span>
                    </div>
                    <div className="mt-2 pr-[3rem]">
                      <div className="flex items-center justify-between">
                        {CONF_QUICK_OPTIONS.map((value) => (
                          <button
                            key={value}
                            onClick={() => updateMatch(idx, 'conf', Math.round(value * 100))}
                            className={`px-2 py-[3px] text-[10px] rounded-lg btn-hover transition-all ${
                              match.conf === value * 100
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <details className="group" open>
                  <summary className="flex items-center gap-2 cursor-pointer text-sm text-stone-500 hover:text-stone-700 mb-3 select-none">
                    <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                    <span>校准参数（TYS / FID / FSE）</span>
                  </summary>
                  <div className="pl-4 border-l-2 border-amber-100">
                    <div className="grid grid-cols-4 gap-4 mb-3">
                      <div>
                        <label className="text-xs text-stone-400 mb-1.5 block">TYS-base (主)</label>
                        <div className="flex gap-1">
                          {TYS_OPTIONS.map((value) => (
                            <button
                              key={value}
                              onClick={() => updateMatch(idx, 'tys_home', value)}
                              className={`flex-1 py-2 rounded-lg text-xs font-medium btn-hover transition-all ${
                                value === match.tys_home
                                  ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                  : 'bg-stone-50 text-stone-500 border border-stone-100 hover:border-stone-200'
                              }`}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-stone-400 mb-1.5 block">TYS-base (客)</label>
                        <div className="flex gap-1">
                          {TYS_OPTIONS.map((value) => (
                            <button
                              key={value}
                              onClick={() => updateMatch(idx, 'tys_away', value)}
                              className={`flex-1 py-2 rounded-lg text-xs font-medium btn-hover transition-all ${
                                value === match.tys_away
                                  ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                  : 'bg-stone-50 text-stone-500 border border-stone-100 hover:border-stone-200'
                              }`}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs text-stone-400 mb-1.5 block">FID 信息深度</label>
                        <div className="flex gap-1">
                          {FID_OPTIONS.map((value) => (
                            <button
                              key={value}
                              onClick={() => updateMatch(idx, 'fid', value)}
                              className={`flex-1 py-2 rounded-lg text-xs font-medium btn-hover transition-all ${
                                value === match.fid
                                  ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                  : 'bg-stone-50 text-stone-500 border border-stone-100 hover:border-stone-200'
                              }`}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <label className="text-xs text-stone-400 block">FSE (主) Feature Sensor Beta</label>
                          {homeFseHistorySuggestion && (
                            <button
                              type="button"
                              onClick={() => updateMatch(idx, 'fse_home', homeFseHistorySuggestion.value)}
                              title={`${match.homeTeam || '主队'} 最近历史 FSE ${homeFseHistorySuggestion.dateLabel}`}
                              className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                                match.fse_home === homeFseHistorySuggestion.value
                                  ? 'border-sky-300 bg-sky-100 text-sky-700 shadow-[0_6px_14px_rgba(56,189,248,0.22)]'
                                  : 'border-sky-200/80 bg-sky-50/90 text-sky-700 hover:bg-sky-100 shadow-[0_6px_12px_rgba(56,189,248,0.16)]'
                              }`}
                            >
                              {(homeFseHistorySuggestion.value / 100).toFixed(2)}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={match.fse_home}
                            onChange={(event) => updateMatch(idx, 'fse_home', Number.parseInt(event.target.value, 10))}
                            className="flex-1"
                          />
                          <span className="text-sm font-medium text-stone-600 w-10">{(match.fse_home / 100).toFixed(2)}</span>
                        </div>
                        <div className="mt-1 pr-[1.25rem]">
                          <div className="flex items-center justify-between">
                            {FSE_QUICK_OPTIONS.map((value) => (
                              <button
                                key={value}
                                onClick={() => updateMatch(idx, 'fse_home', Math.round(value * 100))}
                                className={`px-1.5 py-0.5 text-[10px] rounded btn-hover ${
                                  match.fse_home === value * 100 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-400'
                                }`}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <label className="text-xs text-stone-400 block">FSE (客) Feature Sensor Beta</label>
                          {awayFseHistorySuggestion && (
                            <button
                              type="button"
                              onClick={() => updateMatch(idx, 'fse_away', awayFseHistorySuggestion.value)}
                              title={`${match.awayTeam || '客队'} 最近历史 FSE ${awayFseHistorySuggestion.dateLabel}`}
                              className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                                match.fse_away === awayFseHistorySuggestion.value
                                  ? 'border-sky-300 bg-sky-100 text-sky-700 shadow-[0_6px_14px_rgba(56,189,248,0.22)]'
                                  : 'border-sky-200/80 bg-sky-50/90 text-sky-700 hover:bg-sky-100 shadow-[0_6px_12px_rgba(56,189,248,0.16)]'
                              }`}
                            >
                              {(awayFseHistorySuggestion.value / 100).toFixed(2)}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={match.fse_away}
                            onChange={(event) => updateMatch(idx, 'fse_away', Number.parseInt(event.target.value, 10))}
                            className="flex-1"
                          />
                          <span className="text-sm font-medium text-stone-600 w-10">{(match.fse_away / 100).toFixed(2)}</span>
                        </div>
                        <div className="mt-1 pr-[1.25rem]">
                          <div className="flex items-center justify-between">
                            {FSE_QUICK_OPTIONS.map((value) => (
                              <button
                                key={value}
                                onClick={() => updateMatch(idx, 'fse_away', Math.round(value * 100))}
                                className={`px-1.5 py-0.5 text-[10px] rounded btn-hover ${
                                  match.fse_away === value * 100 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-400'
                                }`}
                              >
                                {value}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </details>

                <div className="mt-4">
                  <label className="text-xs text-stone-400 mb-1.5 block">赛前备注</label>
                  <textarea
                    rows={2}
                    placeholder="选填，记录预判依据或关注点..."
                    value={match.note}
                    onChange={(event) => updateMatch(idx, 'note', event.target.value)}
                    onKeyDown={(event) => {
                      handleNoteShortcut(event, match.note, (next) => updateMatch(idx, 'note', next))
                    }}
                    className="input-glow w-full px-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400 resize-y min-h-16"
                  />
                  <p className="mt-1 text-[10px] text-stone-400">快捷键：Cmd/Ctrl+B 粗体 · Cmd/Ctrl+I 斜体 · Cmd/Ctrl+Shift+R 红色 · Cmd/Ctrl+Shift+B 蓝色</p>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-6 py-6 bg-gradient-to-r from-stone-50 to-orange-50/30 border-t border-stone-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-xs text-stone-400 block">综合 Odds</span>
                <span className="text-xl font-semibold text-stone-800">{combinedOdds.toFixed(2)}</span>
              </div>
              <div className="w-px h-10 bg-stone-200" />
              <div>
                <span className="text-xs text-stone-400 block">Expected Rating</span>
                <span className="text-xl font-semibold text-stone-800">{expectedRating.toFixed(2)}</span>
              </div>
              <div className="w-px h-10 bg-stone-200" />
              <div>
                <span className="text-xs text-stone-400 block">Recom. Invest</span>
                <span className="text-xl font-semibold text-amber-600">¥ {recommendedInvest}</span>
              </div>
              <div className="w-px h-10 bg-stone-200" />
              <div>
                <span className="text-xs text-stone-400 block">风控上限</span>
                <span className="text-sm text-stone-500">¥ {riskCap} ({Math.round(systemConfig.riskCapRatio * 100)}%)</span>
                <span className="block text-[10px] text-stone-400 mt-0.5">
                  Atomic Kelly÷{effectiveKellyDivisor.toFixed(1)} · Conf×{calibrationContext.multipliers.conf.toFixed(2)} · FSE×
                  {calibrationContext.multipliers.fse.toFixed(2)} · TeamCal {calibrationContext.teamCalibration?.teamCount || 0}队 ·
                  MarketLean {(calibrationContext.marketBlend?.marketLean || 0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div>
                <label className="text-xs text-stone-400 mb-1 block">Inputs 实际投资</label>
                <input
                  type="number"
                  value={actualInput}
                  onChange={(event) => setActualInput(event.target.value)}
                  className="input-glow w-28 px-3 py-2 rounded-xl border border-stone-200 text-sm font-medium focus:outline-none focus:border-amber-400"
                />
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={handleConfirmInvestment} className="btn-primary btn-hover">
                  确认投资
                </button>
                <button
                  onClick={handleAddToCombo}
                  className="px-5 py-2 border border-stone-300 text-stone-600 rounded-xl text-xs font-medium hover:bg-stone-50 hover:border-amber-300 btn-hover transition-all"
                >
                  + 加入今日备选
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
