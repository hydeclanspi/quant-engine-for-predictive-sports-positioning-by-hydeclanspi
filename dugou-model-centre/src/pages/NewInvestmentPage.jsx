import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, ChevronDown, ChevronRight } from 'lucide-react'
import { bumpTeamSamples, findTeamProfile, getSystemConfig, getTeamProfiles, saveInvestment, searchTeamProfiles } from '../lib/localData'
import { handleNoteShortcut } from '../lib/noteFormatting'
import { getPredictionCalibrationContext, getModeKellyRecommendations } from '../lib/analytics'
import { getPrimaryEntryMarket, normalizeEntryName, normalizeEntryRecord } from '../lib/entryParsing'

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
  const [systemConfig] = useState(() => getSystemConfig())

  const teamProfiles = useMemo(() => getTeamProfiles(), [profilesVersion])
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

  const calcHarmonicMean = (entries) => {
    const validOdds = getValidEntries(entries).map((entry) => entry.odds)
    if (validOdds.length < 2) return null
    return validOdds.length / validOdds.reduce((sum, odd) => sum + 1 / odd, 0)
  }

  const calcMatchOdds = (entries) => {
    const validOdds = getValidEntries(entries).map((entry) => entry.odds)
    if (validOdds.length === 0) return systemConfig.defaultOdds
    return validOdds.length / validOdds.reduce((sum, odd) => sum + 1 / odd, 0)
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
    const odds = calcMatchOdds(match.entries)
    const oddsFactor = clamp(1 - (odds - systemConfig.defaultOdds) * 0.03, 0.86, 1.12)
    const confSignal = clamp(confBase / 0.5, 0.15, 1.95)
    const weightedLift =
      confSignal ** getFactorWeight(systemConfig.weightConf, 0.45) *
      modeFactor ** getFactorWeight(systemConfig.weightMode, 0.16) *
      tysFactor ** getFactorWeight(systemConfig.weightTys, 0.12) *
      fidFactor ** getFactorWeight(systemConfig.weightFid, 0.14) *
      oddsFactor ** getFactorWeight(systemConfig.weightOdds, 0.06) *
      fseFactor ** getFactorWeight(systemConfig.weightFse, 0.07)
    return clamp(0.5 * weightedLift, 0.05, 0.95)
  }

  const combinedOdds = useMemo(() => {
    const value = matches.reduce((product, match) => product * calcMatchOdds(match.entries), 1)
    return Number.isFinite(value) ? value : 0
  }, [matches, systemConfig])

  const expectedRating = useMemo(() => {
    if (matches.length === 0) return 0
    const average = matches.reduce((sum, match) => sum + calcAdjustedConf(match), 0) / matches.length
    return Number.isFinite(average) ? average : 0
  }, [calibrationContext, matches, systemConfig])

  // S4: 计算综合 Kelly 分母（加权平均各场 Mode 的 Kelly 分母）
  const effectiveKellyDivisor = useMemo(() => {
    if (matches.length === 0) return systemConfig.kellyDivisor
    const divisors = matches.map((match) => getKellyDivisorForMode(match.mode))
    const avg = divisors.reduce((sum, d) => sum + d, 0) / divisors.length
    return Number.isFinite(avg) ? avg : systemConfig.kellyDivisor
  }, [matches, modeKellyMap, systemConfig.kellyDivisor])

  const recommendedInvest = useMemo(() => {
    if (combinedOdds <= 1) return 0
    const combinedProbability = matches.reduce((product, match) => product * calcAdjustedConf(match), 1)
    const kelly = (combinedProbability * combinedOdds - 1) / (combinedOdds - 1)
    if (!Number.isFinite(kelly) || kelly <= 0) return 0
    // S4: 使用动态 Kelly 分母（基于 Mode）
    const raw = systemConfig.initialCapital * (kelly / effectiveKellyDivisor)
    const confidenceLift = 0.88 + expectedRating * 0.24
    return Math.min(riskCap, Math.max(0, Math.round(raw * confidenceLift)))
  }, [combinedOdds, effectiveKellyDivisor, expectedRating, matches, riskCap, systemConfig.initialCapital])

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
    return warnings
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
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">新建投资</h2>
        <p className="text-stone-400 text-sm mt-1">录入比赛信息与预测参数</p>
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/50">
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

            return (
              <div key={idx} className={idx > 0 ? 'pt-6 border-t border-stone-100' : ''}>
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
                  {match.entries.length > 1 && calcHarmonicMean(match.entries) && (
                    <p className="text-xs text-stone-500 mt-2">
                      Overall Odds（调和平均）:{' '}
                      <span className="font-semibold text-amber-600">{calcHarmonicMean(match.entries)?.toFixed(2)}</span>
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
                        <label className="text-xs text-stone-400 mb-1.5 block">FSE (主) Feature Sensor Beta</label>
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
                        <label className="text-xs text-stone-400 mb-1.5 block">FSE (客) Feature Sensor Beta</label>
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

        <div className="px-6 py-5 bg-gradient-to-r from-stone-50 to-orange-50/30 border-t border-stone-100">
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
                  Kelly÷{effectiveKellyDivisor.toFixed(1)} · Conf×{calibrationContext.multipliers.conf.toFixed(2)} · FSE×
                  {calibrationContext.multipliers.fse.toFixed(2)}
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
