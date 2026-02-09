import { fetchLatestSnapshot, getCloudSyncState, saveCloudSyncState, scheduleSnapshotSync, syncSnapshotNow } from './cloudSync'
import { getPrimaryEntryMarket, normalizeEntries } from './entryParsing'
import genesisBundle from '../data/genesisBundle.json'

const STORAGE_KEYS = {
  investments: 'dugou.investments.v1',
  teamProfiles: 'dugou.team_profiles.v1',
  systemConfig: 'dugou.system_config.v1',
}
const GENESIS_APPLIED_KEY = 'dugou.genesis_applied.v1'
const DATA_PATCH_V20260205_KEY = 'dugou.data_patch.v20260205'
const DATA_PATCH_V20260206_KEY = 'dugou.data_patch.v20260206'

const DEFAULT_SYSTEM_CONFIG = {
  initialCapital: 600,
  riskCapRatio: 0.12,
  defaultOdds: 2.5,
  kellyDivisor: 4,
  kellyOverrideEnabled: false,
  kellyOverrideValue: 4,
  kellyAdjustment: 0,
  maxWorstDrawdownAlertPct: 22,
  backupCadence: 'half_week',
  lastBackupAt: '',
  weightConf: 0.45,
  weightMode: 0.16,
  weightTys: 0.12,
  weightFid: 0.14,
  weightOdds: 0.06,
  weightFse: 0.07,
  // 注资历史记录
  capitalInjections: [],
  // 自适应权重优化配置
  adaptiveWeights: {
    enabled: false,                    // 是否启用自动应用
    mode: 'suggest',                   // 'suggest' | 'auto' | 'disabled'
    minSamples: 50,                    // 最小样本量
    learningRate: 0.05,                // 学习率
    maxSingleChange: 0.02,             // 单次最大变化
    priorStrength: 0.1,                // 向先验回归强度
    updateEveryN: 5,                   // 每N场更新一次
    lastUpdateAt: '',                  // 上次更新时间
    updateCount: 0,                    // 累计更新次数
    bounds: {
      weightConf: [0.25, 0.65],
      weightMode: [0.08, 0.28],
      weightTys: [0.05, 0.22],
      weightFid: [0.06, 0.24],
      weightOdds: [0.02, 0.12],
      weightFse: [0.03, 0.15],
    },
    priors: {
      weightConf: 0.45,
      weightMode: 0.16,
      weightTys: 0.12,
      weightFid: 0.14,
      weightOdds: 0.06,
      weightFse: 0.07,
    },
  },
}

const DEFAULT_TEAM_PROFILES = [
  { teamId: 'arsenal', teamName: '阿森纳', abbreviations: ['ars', 'arsenal', '阿森纳'], totalSamples: 18, avgRep: 0.42 },
  { teamId: 'chelsea', teamName: '切尔西', abbreviations: ['che', 'chelsea', '切尔西'], totalSamples: 16, avgRep: 0.48 },
  { teamId: 'liverpool', teamName: '利物浦', abbreviations: ['liv', 'liverpool', '利物浦'], totalSamples: 20, avgRep: 0.44 },
  { teamId: 'mancity', teamName: '曼城', abbreviations: ['mci', 'man city', '曼城'], totalSamples: 22, avgRep: 0.4 },
  { teamId: 'manutd', teamName: '曼联', abbreviations: ['mun', 'man united', '曼联'], totalSamples: 21, avgRep: 0.49 },
  { teamId: 'tottenham', teamName: '热刺', abbreviations: ['tot', 'spurs', '热刺'], totalSamples: 17, avgRep: 0.47 },
  { teamId: 'newcastle', teamName: '纽卡', abbreviations: ['new', 'newcastle', '纽卡'], totalSamples: 14, avgRep: 0.46 },
  { teamId: 'astonvilla', teamName: '维拉', abbreviations: ['avl', 'villa', '维拉'], totalSamples: 13, avgRep: 0.45 },
  { teamId: 'barcelona', teamName: '巴塞罗那', abbreviations: ['bar', 'barcelona', '巴萨', '巴塞罗那'], totalSamples: 15, avgRep: 0.43 },
  { teamId: 'realmadrid', teamName: '皇马', abbreviations: ['rma', 'real madrid', '皇马'], totalSamples: 19, avgRep: 0.41 },
]

const TEAM_ALIAS_LIBRARY = [
  // Premier League (full coverage + common aliases)
  { teamId: 'arsenal', teamName: '阿森纳', abbreviations: ['ars', 'afc', 'arsenal', 'gunners', '阿森纳'] },
  { teamId: 'astonvilla', teamName: '阿斯顿维拉', abbreviations: ['avl', 'villa', 'aston villa', '阿斯顿维拉', '维拉'] },
  { teamId: 'bournemouth', teamName: '伯恩茅斯', abbreviations: ['bou', 'bournemouth', 'afcb', '伯恩茅斯', '樱桃'] },
  { teamId: 'brentford', teamName: '布伦特福德', abbreviations: ['bre', 'brentford', '布伦特福德'] },
  { teamId: 'brighton', teamName: '布莱顿', abbreviations: ['bha', 'brighton', 'brighton & hove albion', '布莱顿'] },
  { teamId: 'burnley', teamName: '伯恩利', abbreviations: ['bur', 'burnley', '伯恩利'] },
  { teamId: 'chelsea', teamName: '切尔西', abbreviations: ['che', 'chelsea', 'cfc', '切尔西'] },
  { teamId: 'crystalpalace', teamName: '水晶宫', abbreviations: ['cry', 'crystal palace', '水晶宫'] },
  { teamId: 'everton', teamName: '埃弗顿', abbreviations: ['eve', 'everton', '埃弗顿'] },
  { teamId: 'fulham', teamName: '富勒姆', abbreviations: ['ful', 'fulham', '富勒姆'] },
  { teamId: 'ipswich', teamName: '伊普斯维奇', abbreviations: ['ips', 'ipswich', 'ipswich town', '伊普斯维奇'] },
  { teamId: 'leicester', teamName: '莱斯特城', abbreviations: ['lei', 'leicester', 'leicester city', '莱斯特城'] },
  { teamId: 'leeds', teamName: '利兹联', abbreviations: ['lee', 'leeds', 'leeds united', '利兹联'] },
  { teamId: 'liverpool', teamName: '利物浦', abbreviations: ['liv', 'liverpool', 'lfc', '利物浦'] },
  { teamId: 'mancity', teamName: '曼城', abbreviations: ['mci', 'man city', 'manchester city', 'city', '曼城'] },
  { teamId: 'manutd', teamName: '曼联', abbreviations: ['mun', 'man utd', 'manchester united', 'utd', '曼联'] },
  { teamId: 'newcastle', teamName: '纽卡斯尔', abbreviations: ['new', 'newcastle', 'newcastle united', '纽卡', '纽卡斯尔'] },
  { teamId: 'nottingham', teamName: '诺丁汉森林', abbreviations: ['nfo', "nott'm forest", 'nottingham forest', '诺丁汉森林'] },
  { teamId: 'southampton', teamName: '南安普顿', abbreviations: ['sou', 'southampton', '南安普顿'] },
  { teamId: 'sunderland', teamName: '桑德兰', abbreviations: ['sun', 'sunderland', '桑德兰'] },
  { teamId: 'tottenham', teamName: '热刺', abbreviations: ['tot', 'spurs', 'tottenham', 'tottenham hotspur', '热刺'] },
  { teamId: 'westham', teamName: '西汉姆联', abbreviations: ['whu', 'west ham', 'west ham united', '西汉姆', '西汉姆联'] },
  { teamId: 'wolves', teamName: '狼队', abbreviations: ['wol', 'wolves', 'wolverhampton', 'wolverhampton wanderers', '狼队'] },

  // La Liga (mainstream)
  { teamId: 'realmadrid', teamName: '皇马', abbreviations: ['rma', 'real madrid', 'madrid', '皇马'] },
  { teamId: 'barcelona', teamName: '巴塞罗那', abbreviations: ['bar', 'fcb', 'barcelona', '巴萨', '巴塞罗那'] },
  { teamId: 'atletico', teamName: '马竞', abbreviations: ['atm', 'atleti', 'atletico madrid', '马竞'] },
  { teamId: 'athletic', teamName: '毕尔巴鄂', abbreviations: ['ath', 'athletic club', 'athletic bilbao', '毕尔巴鄂'] },
  { teamId: 'realsociedad', teamName: '皇家社会', abbreviations: ['rso', 'real sociedad', '皇家社会'] },
  { teamId: 'betis', teamName: '贝蒂斯', abbreviations: ['bet', 'real betis', '贝蒂斯'] },
  { teamId: 'sevilla', teamName: '塞维利亚', abbreviations: ['sev', 'sevilla', '塞维利亚'] },
  { teamId: 'valencia', teamName: '瓦伦西亚', abbreviations: ['val', 'valencia', '瓦伦西亚'] },
  { teamId: 'villarreal', teamName: '黄潜', abbreviations: ['vil', 'villarreal', '黄潜', '比利亚雷亚尔'] },
  { teamId: 'girona', teamName: '赫罗纳', abbreviations: ['gir', 'girona', '赫罗纳'] },

  // Serie A (mainstream)
  { teamId: 'inter', teamName: '国际米兰', abbreviations: ['int', 'inter', 'inter milan', '国际米兰', '国米'] },
  { teamId: 'milan', teamName: '米兰', abbreviations: ['mil', 'ac milan', 'milan', '米兰', 'ac米兰'] },
  { teamId: 'juventus', teamName: '尤文', abbreviations: ['juv', 'juventus', '尤文', '尤文图斯'] },
  { teamId: 'napoli', teamName: '那不勒斯', abbreviations: ['nap', 'napoli', '那不勒斯'] },
  { teamId: 'roma', teamName: '罗马', abbreviations: ['rom', 'roma', '罗马'] },
  { teamId: 'lazio', teamName: '拉齐奥', abbreviations: ['laz', 'lazio', '拉齐奥'] },
  { teamId: 'atalanta', teamName: '亚特兰大', abbreviations: ['ata', 'atalanta', '亚特兰大'] },
  { teamId: 'fiorentina', teamName: '佛罗伦萨', abbreviations: ['fio', 'fiorentina', '佛罗伦萨'] },
  { teamId: 'bologna', teamName: '博洛尼亚', abbreviations: ['bol', 'bologna', '博洛尼亚'] },

  // Bundesliga (mainstream)
  { teamId: 'bayern', teamName: '拜仁', abbreviations: ['bay', 'bayern', 'bayern munich', '拜仁'] },
  { teamId: 'dortmund', teamName: '多特', abbreviations: ['bvb', 'dor', 'dortmund', 'borussia dortmund', '多特'] },
  { teamId: 'leverkusen', teamName: '勒沃库森', abbreviations: ['lev', 'leverkusen', '勒沃库森'] },
  { teamId: 'leipzig', teamName: '莱比锡', abbreviations: ['rbl', 'rbl leipzig', 'leipzig', '莱比锡'] },
  { teamId: 'stuttgart', teamName: '斯图加特', abbreviations: ['stu', 'stuttgart', '斯图加特'] },
  { teamId: 'frankfurt', teamName: '法兰克福', abbreviations: ['sge', 'fra', 'frankfurt', '法兰克福'] },
  { teamId: 'wolfsburg', teamName: '沃尔夫斯堡', abbreviations: ['wob', 'wolfsburg', '沃尔夫斯堡'] },
  { teamId: 'gladbach', teamName: '门兴', abbreviations: ['bmg', "m'gladbach", 'gladbach', '门兴'] },

  // Ligue 1 (mainstream)
  { teamId: 'psg', teamName: '巴黎圣日耳曼', abbreviations: ['psg', 'paris', 'paris saint-germain', '巴黎', '巴黎圣日耳曼'] },
  { teamId: 'marseille', teamName: '马赛', abbreviations: ['om', 'marseille', '马赛'] },
  { teamId: 'monaco', teamName: '摩纳哥', abbreviations: ['asm', 'monaco', '摩纳哥'] },
  { teamId: 'lille', teamName: '里尔', abbreviations: ['losc', 'lil', 'lille', '里尔'] },
  { teamId: 'lyon', teamName: '里昂', abbreviations: ['lyo', 'lyon', '里昂'] },
  { teamId: 'nice', teamName: '尼斯', abbreviations: ['nic', 'nice', '尼斯'] },
]

const isBrowser = typeof window !== 'undefined'

const normalize = (value) => String(value || '').trim().toLowerCase()

const markGenesisApplied = () => {
  if (!isBrowser) return
  window.localStorage.setItem(GENESIS_APPLIED_KEY, '1')
}

const mergeAliases = (...groups) => {
  const values = []
  groups.forEach((group) => {
    if (Array.isArray(group)) {
      values.push(...group)
      return
    }
    values.push(group)
  })

  const seen = new Set()
  const result = []
  values.forEach((raw) => {
    const clean = String(raw || '').trim()
    if (!clean) return
    const key = normalize(clean)
    if (seen.has(key)) return
    seen.add(key)
    result.push(clean)
  })
  return result
}

const getTeamDirectoryProfiles = (profiles = getTeamProfiles()) => {
  const byName = new Map()

  TEAM_ALIAS_LIBRARY.forEach((profile) => {
    const key = normalize(profile.teamName)
    byName.set(key, {
      teamId: profile.teamId,
      teamName: profile.teamName,
      abbreviations: mergeAliases([profile.teamName], profile.abbreviations || []),
      totalSamples: 0,
      avgRep: 0.5,
    })
  })

  profiles.map(withTeamDefaults).forEach((profile) => {
    const key = normalize(profile.teamName)
    const existing = byName.get(key)
    if (existing) {
      byName.set(key, {
        ...existing,
        ...profile,
        teamName: existing.teamName || profile.teamName,
        abbreviations: mergeAliases(
          [existing.teamName, profile.teamName],
          existing.abbreviations || [],
          profile.abbreviations || [],
        ),
      })
      return
    }

    byName.set(key, {
      ...profile,
      abbreviations: mergeAliases([profile.teamName], profile.abbreviations || []),
    })
  })

  return [...byName.values()]
}

const readJSON = (key, fallback) => {
  if (!isBrowser) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const writeJSON = (key, value) => {
  if (!isBrowser) return
  window.localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('dugou:data-changed', { detail: { key } }))
  if (
    key === STORAGE_KEYS.investments ||
    key === STORAGE_KEYS.teamProfiles ||
    key === STORAGE_KEYS.systemConfig
  ) {
    scheduleSnapshotSync(() => exportDataBundle())
  }
}

const withTeamDefaults = (profile) => ({
  teamId: profile.teamId,
  teamName: profile.teamName,
  abbreviations: profile.abbreviations || [],
  totalSamples: Number(profile.totalSamples) || 0,
  avgRep: Number(profile.avgRep) || 0.5,
})

export const getSystemConfig = () => {
  ensureGenesisApplied()
  const saved = readJSON(STORAGE_KEYS.systemConfig, null)
  return { ...DEFAULT_SYSTEM_CONFIG, ...(saved || {}) }
}

export const saveSystemConfig = (configPatch) => {
  const current = getSystemConfig()
  const next = {
    ...current,
    ...(configPatch || {}),
  }
  writeJSON(STORAGE_KEYS.systemConfig, next)
  return next
}

export const getCapitalInjections = () => {
  const config = getSystemConfig()
  return Array.isArray(config.capitalInjections) ? config.capitalInjections : []
}

export const addCapitalInjection = (amount, note = '') => {
  const config = getSystemConfig()
  const injections = Array.isArray(config.capitalInjections) ? config.capitalInjections : []
  const newInjection = {
    id: `inj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    amount: Number(amount),
    note: String(note || '').trim(),
    created_at: new Date().toISOString(),
  }
  const updatedInjections = [...injections, newInjection]
  saveSystemConfig({ capitalInjections: updatedInjections })
  return newInjection
}

export const getTeamProfiles = () => {
  ensureGenesisApplied()
  applyManualDataPatchV20260206()
  const saved = readJSON(STORAGE_KEYS.teamProfiles, null)
  if (Array.isArray(saved) && saved.length > 0) {
    return saved.map(withTeamDefaults)
  }
  writeJSON(STORAGE_KEYS.teamProfiles, DEFAULT_TEAM_PROFILES)
  return DEFAULT_TEAM_PROFILES
}

export const searchTeamProfiles = (query, profiles = getTeamProfiles(), limit = 6) => {
  const normalized = normalize(query)
  if (!normalized) return []

  const directory = getTeamDirectoryProfiles(profiles)
  const scored = directory
    .map((profile) => {
      const teamName = normalize(profile.teamName)
      const allAliases = mergeAliases([teamName], (profile.abbreviations || []).map(normalize))
      const exact = allAliases.some((alias) => alias === normalized)
      const startsWith = allAliases.some((alias) => alias.startsWith(normalized))
      const contains = allAliases.some((alias) => alias.includes(normalized))
      let score = 0
      if (exact) score += 12
      if (startsWith) score += 4
      if (contains) score += 1
      return { profile, score }
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.profile.totalSamples - a.profile.totalSamples ||
        a.profile.teamName.length - b.profile.teamName.length,
    )
    .slice(0, limit)
    .map((item) => item.profile)

  return scored
}

export const findTeamProfile = (query, profiles = getTeamProfiles()) => {
  const normalized = normalize(query)
  if (!normalized) return null
  const directory = getTeamDirectoryProfiles(profiles)
  return (
    directory.find((profile) => {
      const aliases = [profile.teamName, ...(profile.abbreviations || [])]
      return aliases.some((alias) => normalize(alias) === normalized)
    }) || null
  )
}

const createNewTeamProfile = (teamName) => {
  const cleanName = String(teamName || '').trim()
  const teamId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `team_${crypto.randomUUID()}`
      : `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const libraryHit = TEAM_ALIAS_LIBRARY.find((profile) => normalize(profile.teamName) === normalize(cleanName))
  const abbreviations =
    libraryHit && Array.isArray(libraryHit.abbreviations) && libraryHit.abbreviations.length > 0
      ? mergeAliases([cleanName], libraryHit.abbreviations)
      : [normalize(cleanName)]

  return {
    teamId,
    teamName: cleanName,
    abbreviations,
    totalSamples: 0,
    avgRep: 0.5,
  }
}

export const ensureTeamProfile = (teamName) => {
  const cleanName = String(teamName || '').trim()
  if (!cleanName) return null

  const current = getTeamProfiles()
  const existing = findTeamProfile(cleanName, current)
  if (existing) return existing

  const created = createNewTeamProfile(cleanName)
  writeJSON(STORAGE_KEYS.teamProfiles, [...current, created])
  return created
}

export const bumpTeamSamples = (teamNames = []) => {
  if (!Array.isArray(teamNames) || teamNames.length === 0) return

  const current = getTeamProfiles()
  let changed = false

  const updated = current.map((profile) => ({ ...profile }))

  teamNames.forEach((name) => {
    const cleanName = String(name || '').trim()
    if (!cleanName) return

    let matchedProfile = updated.find((profile) => {
      const aliases = [profile.teamName, ...(profile.abbreviations || [])]
      return aliases.some((alias) => normalize(alias) === normalize(cleanName))
    })

    if (!matchedProfile) {
      matchedProfile = createNewTeamProfile(cleanName)
      updated.push(matchedProfile)
    }

    matchedProfile.totalSamples += 1
    changed = true
  })

  if (changed) {
    writeJSON(STORAGE_KEYS.teamProfiles, updated)
  }
}

const VALID_TYS_VALUES = new Set(['S', 'M', 'L', 'H'])

const normalizeTysValue = (value) => {
  const normalizedValue = String(value || '').trim().toUpperCase()
  return VALID_TYS_VALUES.has(normalizedValue) ? normalizedValue : ''
}

const normalizeMatchRecord = (matchRaw) => {
  const match = matchRaw && typeof matchRaw === 'object' ? { ...matchRaw } : {}
  const legacyTys = normalizeTysValue(match.tys_base || match.tysBase || match.tys)
  const tysHome = normalizeTysValue(match.tys_home) || legacyTys || 'M'
  const tysAway = normalizeTysValue(match.tys_away) || legacyTys || tysHome
  const fidParsed = Number.parseFloat(match.fid)
  const fid = Number.isFinite(fidParsed) ? fidParsed : 0.4
  const fallbackOdds = Number.parseFloat(match.odds)
  const entries = normalizeEntries(match.entries, match.entry_text || match.entry || '', fallbackOdds)
  const normalizedEntryText = String(match.entry_text || '').trim() || entries.map((entry) => entry.name).join(', ')
  const entryMarket = getPrimaryEntryMarket(entries, normalizedEntryText)

  return {
    ...match,
    entries,
    entry_text: normalizedEntryText,
    entry_market_type: match.entry_market_type || entryMarket.marketType,
    entry_market_label: match.entry_market_label || entryMarket.marketLabel,
    entry_semantic_key: match.entry_semantic_key || entryMarket.semanticKey,
    tys_home: tysHome,
    tys_away: tysAway,
    fid,
  }
}

const calcCombinedOdds = (matches, fallback = 0) => {
  const odds = matches
    .map((match) => Number.parseFloat(match?.odds))
    .filter((odd) => Number.isFinite(odd) && odd > 0)

  if (odds.length === 0) {
    const parsedFallback = Number.parseFloat(fallback)
    return Number.isFinite(parsedFallback) ? parsedFallback : 0
  }

  const product = odds.reduce((result, odd) => result * odd, 1)
  return Number(product.toFixed(2))
}

const normalizeInvestmentRecord = (itemRaw) => {
  const item = itemRaw && typeof itemRaw === 'object' ? { ...itemRaw } : {}
  const matches = Array.isArray(item.matches) ? item.matches.map(normalizeMatchRecord) : []
  const parlaySizeParsed = Number.parseInt(item.parlay_size, 10)
  const parlaySize = Number.isFinite(parlaySizeParsed) && parlaySizeParsed > 0 ? parlaySizeParsed : matches.length || 1
  const combinedOdds = calcCombinedOdds(matches, item.combined_odds)

  return {
    ...item,
    parlay_size: parlaySize,
    combined_odds: combinedOdds,
    matches,
  }
}

const cloneMatchWithOverrides = (match, overrides = {}) => {
  if (!match || typeof match !== 'object') return null
  const next = { ...match, ...overrides }

  if (Array.isArray(match.entries)) {
    next.entries = match.entries.map((entry) => ({ ...entry }))
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'odds')) {
    const parsedOdds = Number.parseFloat(overrides.odds)
    if (Number.isFinite(parsedOdds)) {
      next.odds = parsedOdds
      if (Array.isArray(next.entries) && next.entries.length > 0) {
        next.entries = next.entries.map((entry, index) => (index === 0 ? { ...entry, odds: parsedOdds } : entry))
      }
    }
  }

  return normalizeMatchRecord(next)
}

const averageMatchField = (matches, field) => {
  const values = matches
    .map((match) => Number.parseFloat(match?.[field]))
    .filter((value) => Number.isFinite(value))
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const buildInvestmentLegSignature = (item) => {
  const matches = Array.isArray(item?.matches) ? item.matches : []
  const legs = matches
    .map((match) => {
      const odd = Number.parseFloat(match?.odds)
      const oddText = Number.isFinite(odd) ? odd.toFixed(2) : '-'
      const entryText =
        match?.entry_text ||
        (Array.isArray(match?.entries) ? match.entries.map((entry) => entry?.name || '').filter(Boolean).join('|') : '')
      return [normalize(match?.home_team), normalize(match?.away_team), normalize(entryText), oddText].join('::')
    })
    .join('||')

  return `${matches.length}::${legs}`
}

const buildSplitInvestmentsFromLegacy11 = (legacyItem) => {
  const baseMatches = Array.isArray(legacyItem?.matches) ? legacyItem.matches : []
  if (baseMatches.length === 0) return []

  const baseTime = new Date(legacyItem.created_at || '2026-01-28T12:00:00.000Z').getTime()
  const specs = [
    { idSuffix: 't1', inputs: 100, legs: [{ index: 1 }, { index: 5 }] }, // 2x1, 100
    { idSuffix: 't2', inputs: 100, legs: [{ index: 1 }, { index: 4 }, { index: 2 }] }, // 3x1, 100
    { idSuffix: 't3', inputs: 40, legs: [{ index: 11 }, { index: 4 }, { index: 5 }] }, // 3x1, 40
    { idSuffix: 't4', inputs: 40, legs: [{ index: 5 }, { index: 7, odds: 1.63 }, { index: 3 }] }, // 3x1, 40
    { idSuffix: 't5', inputs: 40, legs: [{ index: 1 }, { index: 10, odds: 1.84 }, { index: 6, odds: 3.93 }] }, // 3x1, 40
    { idSuffix: 't6', inputs: 42, legs: [{ index: 1 }, { index: 8, odds: 4.3 }, { index: 9, odds: 4.9 }] }, // 3x1, 42
  ]

  return specs
    .map((spec, specIndex) => {
      const matches = spec.legs
        .map((leg, legIndex) => {
          const source = baseMatches[leg.index - 1]
          if (!source) return null
          return cloneMatchWithOverrides(source, {
            id: `${legacyItem.id}_${spec.idSuffix}_m${legIndex + 1}`,
            ...(Number.isFinite(Number.parseFloat(leg.odds)) ? { odds: Number(leg.odds) } : {}),
          })
        })
        .filter(Boolean)

      if (matches.length === 0) return null

      const combinedOdds = calcCombinedOdds(matches, 0)
      const expectedRating = Number(averageMatchField(matches, 'conf').toFixed(2))
      const actualRating = Number(averageMatchField(matches, 'match_rating').toFixed(2))
      const status = matches.every((match) => match.is_correct === true) ? 'win' : 'lose'
      const stake = Number(spec.inputs)
      const revenues = status === 'win' ? Number((stake * combinedOdds).toFixed(2)) : 0
      const profit = Number((revenues - stake).toFixed(2))

      return normalizeInvestmentRecord({
        ...legacyItem,
        id: `${legacyItem.id}_${spec.idSuffix}`,
        created_at: new Date(baseTime + specIndex * 60000).toISOString(),
        parlay_size: matches.length,
        inputs: stake,
        suggested_amount: stake,
        expected_rating: expectedRating,
        combined_odds: combinedOdds,
        status,
        revenues,
        profit,
        actual_rating: actualRating,
        matches,
      })
    })
    .filter(Boolean)
}

const applyManualDataPatchV20260205 = () => {
  if (!isBrowser) return
  if (window.localStorage.getItem(DATA_PATCH_V20260205_KEY) === '1') return

  const rawInvestments = readJSON(STORAGE_KEYS.investments, null)
  if (!Array.isArray(rawInvestments)) {
    window.localStorage.setItem(DATA_PATCH_V20260205_KEY, '1')
    return
  }

  let nextInvestments = rawInvestments.map((item) => normalizeInvestmentRecord(item))
  let changed = false

  const january31Index = nextInvestments.findIndex((item) => item.id === 'gen_inv_45')
  if (january31Index >= 0) {
    const target = nextInvestments[january31Index]
    const inputs = Number.parseFloat(target.inputs)
    const safeInputs = Number.isFinite(inputs) ? inputs : 0
    const patchedProfit = 85.11
    const patchedRevenues = Number((safeInputs + patchedProfit).toFixed(2))

    if (target.status !== 'win' || Number(target.profit) !== patchedProfit || Number(target.revenues) !== patchedRevenues) {
      nextInvestments[january31Index] = normalizeInvestmentRecord({
        ...target,
        status: 'win',
        revenues: patchedRevenues,
        profit: patchedProfit,
      })
      changed = true
    }
  }

  const legacyElevenCombo = nextInvestments.find((item) => item.id === 'gen_inv_44' && Number(item.parlay_size) === 11)
  if (legacyElevenCombo) {
    const splitRecords = buildSplitInvestmentsFromLegacy11(legacyElevenCombo)
    const existingSignatures = new Set(
      nextInvestments
        .filter((item) => item.id !== legacyElevenCombo.id)
        .map((item) => buildInvestmentLegSignature(item)),
    )

    const uniqueSplitRecords = splitRecords.filter((item) => {
      const signature = buildInvestmentLegSignature(item)
      if (!signature || existingSignatures.has(signature)) return false
      existingSignatures.add(signature)
      return true
    })

    nextInvestments = nextInvestments.filter((item) => item.id !== legacyElevenCombo.id)
    if (uniqueSplitRecords.length > 0) {
      nextInvestments = [...nextInvestments, ...uniqueSplitRecords]
    }
    changed = true
  }

  if (changed) {
    writeJSON(STORAGE_KEYS.investments, nextInvestments)
  }

  window.localStorage.setItem(DATA_PATCH_V20260205_KEY, '1')
}

const normalizeLegacyTeamName = (value) => {
  const raw = String(value || '').trim()
  if (raw === 's伯恩茅斯') return '伯恩茅斯'
  return value
}

const applyManualDataPatchV20260206 = () => {
  if (!isBrowser) return
  if (window.localStorage.getItem(DATA_PATCH_V20260206_KEY) === '1') return

  const rawTeamProfiles = readJSON(STORAGE_KEYS.teamProfiles, null)
  const rawInvestments = readJSON(STORAGE_KEYS.investments, null)

  let teamProfilesChanged = false
  let investmentsChanged = false

  if (Array.isArray(rawTeamProfiles)) {
    const nextProfiles = rawTeamProfiles.map((profile) => {
      const fixedTeamName = normalizeLegacyTeamName(profile?.teamName)
      const fixedAbbr = Array.isArray(profile?.abbreviations)
        ? profile.abbreviations.map((abbr) => normalizeLegacyTeamName(abbr))
        : []

      if (fixedTeamName !== profile?.teamName) teamProfilesChanged = true
      if (fixedAbbr.some((abbr, idx) => abbr !== profile?.abbreviations?.[idx])) teamProfilesChanged = true

      return withTeamDefaults({
        ...profile,
        teamName: fixedTeamName || profile?.teamName,
        abbreviations: fixedAbbr,
      })
    })

    if (teamProfilesChanged) {
      writeJSON(STORAGE_KEYS.teamProfiles, nextProfiles)
    }
  }

  if (Array.isArray(rawInvestments)) {
    let nextInvestments = rawInvestments.map((item) => {
      const matches = Array.isArray(item?.matches) ? item.matches : []
      let localChanged = false

      const fixedMatches = matches.map((match) => {
        const fixedHome = normalizeLegacyTeamName(match?.home_team)
        const fixedAway = normalizeLegacyTeamName(match?.away_team)
        if (fixedHome !== match?.home_team || fixedAway !== match?.away_team) {
          localChanged = true
        }
        return normalizeMatchRecord({
          ...match,
          home_team: fixedHome,
          away_team: fixedAway,
        })
      })

      if (localChanged) investmentsChanged = true
      return normalizeInvestmentRecord({
        ...item,
        matches: fixedMatches,
      })
    })

    // Guard rail: only remove exact duplicate single bets for 2026-01-17 曼联 vs 曼城
    const seenDerbySignatures = new Set()
    const dedupedInvestments = []

    nextInvestments.forEach((item) => {
      const matches = Array.isArray(item?.matches) ? item.matches : []
      const isTarget =
        String(item?.created_at || '').startsWith('2026-01-17') &&
        Number(item?.parlay_size || matches.length || 1) === 1 &&
        matches.length === 1 &&
        ((matches[0]?.home_team === '曼联' && matches[0]?.away_team === '曼城') ||
          (matches[0]?.home_team === '曼城' && matches[0]?.away_team === '曼联'))

      if (!isTarget) {
        dedupedInvestments.push(item)
        return
      }

      const match = matches[0]
      const signature = JSON.stringify([
        item.created_at,
        match.home_team,
        match.away_team,
        match.entry_text,
        match.odds,
        match.conf,
        match.mode,
        match.results,
        match.is_correct,
        item.inputs,
        item.revenues,
        item.profit,
      ])

      if (seenDerbySignatures.has(signature)) {
        investmentsChanged = true
        return
      }

      seenDerbySignatures.add(signature)
      dedupedInvestments.push(item)
    })

    if (investmentsChanged) {
      writeJSON(STORAGE_KEYS.investments, dedupedInvestments)
    }
  }

  window.localStorage.setItem(DATA_PATCH_V20260206_KEY, '1')
}

const toArray = (value) => (Array.isArray(value) ? value : [])

const applyDataBundle = (bundle, mode = 'replace') => {
  if (!bundle || typeof bundle !== 'object') return false

  const incomingConfig = bundle.system_config && typeof bundle.system_config === 'object' ? bundle.system_config : {}
  const incomingTeams = toArray(bundle.team_profiles).map(withTeamDefaults)
  const incomingInvestments = toArray(bundle.investments)
    .filter((item) => item && typeof item === 'object' && item.id)
    .map((item) => normalizeInvestmentRecord(item))

  if (mode === 'merge') {
    const currentTeams = getTeamProfiles()
    const teamMap = new Map(currentTeams.map((team) => [normalize(team.teamName), team]))
    incomingTeams.forEach((team) => {
      const key = normalize(team.teamName)
      if (!teamMap.has(key)) {
        teamMap.set(key, team)
      }
    })

    const currentInvestments = getInvestments()
    const investmentMap = new Map(currentInvestments.map((item) => [item.id, item]))
    incomingInvestments.forEach((item) => {
      if (!investmentMap.has(item.id)) {
        investmentMap.set(item.id, item)
      }
    })

    writeJSON(STORAGE_KEYS.systemConfig, { ...getSystemConfig(), ...incomingConfig })
    writeJSON(STORAGE_KEYS.teamProfiles, [...teamMap.values()])
    writeJSON(STORAGE_KEYS.investments, [...investmentMap.values()])
    markGenesisApplied()
    return true
  }

  writeJSON(STORAGE_KEYS.systemConfig, { ...DEFAULT_SYSTEM_CONFIG, ...incomingConfig })
  writeJSON(STORAGE_KEYS.teamProfiles, incomingTeams.length > 0 ? incomingTeams : DEFAULT_TEAM_PROFILES)
  writeJSON(STORAGE_KEYS.investments, incomingInvestments)
  markGenesisApplied()
  return true
}

const ensureGenesisApplied = () => {
  if (!isBrowser) return
  if (window.localStorage.getItem(GENESIS_APPLIED_KEY) === '1') return
  const ok = applyDataBundle(genesisBundle, 'replace')
  if (ok) {
    window.localStorage.setItem(GENESIS_APPLIED_KEY, '1')
  }
}

export const getInvestments = () => {
  ensureGenesisApplied()
  applyManualDataPatchV20260205()
  applyManualDataPatchV20260206()
  const saved = readJSON(STORAGE_KEYS.investments, [])
  if (!Array.isArray(saved)) return []
  return saved
    .map((item) => normalizeInvestmentRecord(item))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
}

export const saveInvestment = (investment) => {
  const existing = getInvestments()
  const normalized = normalizeInvestmentRecord(investment)
  const next = [normalized, ...existing]
  writeJSON(STORAGE_KEYS.investments, next)
  return normalized
}

export const updateInvestment = (investmentId, updater) => {
  const existing = getInvestments()
  let changed = false

  const next = existing.map((item) => {
    if (item.id !== investmentId) return item
    changed = true
    const updated = typeof updater === 'function' ? updater(item) : { ...item, ...(updater || {}) }
    return normalizeInvestmentRecord(updated)
  })

  if (!changed) return null
  writeJSON(STORAGE_KEYS.investments, next)
  return next.find((item) => item.id === investmentId) || null
}

export const deleteInvestment = (investmentId) => {
  const existing = getInvestments()
  const next = existing.filter((item) => item.id !== investmentId)
  if (next.length === existing.length) return false
  writeJSON(STORAGE_KEYS.investments, next)
  return true
}

export const setInvestmentArchived = (investmentId, archived = true) => {
  const updated = updateInvestment(investmentId, (previous) => ({
    ...previous,
    is_archived: Boolean(archived),
  }))
  return Boolean(updated)
}

export const exportDataBundle = () => ({
  version: 1,
  exported_at: new Date().toISOString(),
  system_config: getSystemConfig(),
  team_profiles: getTeamProfiles(),
  investments: getInvestments(),
})

export const importDataBundle = (bundle, mode = 'replace') => {
  return applyDataBundle(bundle, mode)
}

export const restoreGenesisData = () => {
  const ok = applyDataBundle(genesisBundle, 'replace')
  if (ok && isBrowser) {
    window.localStorage.setItem(GENESIS_APPLIED_KEY, '1')
  }
  return ok
}

export const getCloudSyncStatus = () => getCloudSyncState()

export const setCloudSyncEnabled = (enabled) =>
  saveCloudSyncState({
    enabled: Boolean(enabled),
    lastError: '',
  })

export const bootstrapCloudSnapshotOnLoad = async () => {
  const status = getCloudSyncState()
  if (!status.hasEnv) {
    return { ok: false, reason: 'missing_env', applied: false }
  }
  return pullCloudSnapshotNow('replace')
}

export const runCloudSyncNow = async () => {
  const snapshot = exportDataBundle()
  return syncSnapshotNow(snapshot)
}

export const pullCloudSnapshotNow = async (mode = 'merge') => {
  const result = await fetchLatestSnapshot()
  if (!result?.ok || !result?.snapshot) return { ...result, applied: false }

  const normalizedMode = mode === 'replace' ? 'replace' : 'merge'
  const applied = applyDataBundle(result.snapshot, normalizedMode)
  if (!applied) {
    const state = saveCloudSyncState({
      lastError: '云端快照结构不符合 DUGOU 模板，未应用。',
    })
    return {
      ok: false,
      reason: 'invalid_snapshot',
      state,
      applied: false,
    }
  }

  return {
    ...result,
    applied: true,
    mode: normalizedMode,
  }
}
