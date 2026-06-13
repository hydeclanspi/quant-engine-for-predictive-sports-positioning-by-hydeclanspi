import {
  fetchLatestSnapshot,
  getCloudSyncState,
  saveCloudSyncState,
  scheduleSnapshotSync,
  syncSnapshotNow,
  getTimeMachineSession,
  startTimeMachineSession,
  exitTimeMachineSession,
  isInTimeMachineSession,
  getTimeMachineMonthKey,
  listTimeMachineSnapshots,
  fetchTimeMachineSnapshotById,
  saveTimeMachineSnapshot,
  ensureMonthlyTimeMachineSnapshot,
  deleteTimeMachineSnapshotById,
} from './cloudSync'
import { getPrimaryEntryMarket, normalizeEntries } from './entryParsing'
import { calcAtomicEquivalentOdds } from './atomicParlay'
import genesisBundle from '../data/genesisBundle.json'
import { isPreviewMode, DISPLAY_MODE_CHANGE_EVENT } from './displayMode'
import { previewRead, previewWrite, resetPreviewStore } from './previewStore'

const STORAGE_KEYS = {
  investments: 'dugou.investments.v1',
  teamProfiles: 'dugou.team_profiles.v1',
  systemConfig: 'dugou.system_config.v1',
  accessLogs: 'dugou.access_logs.v1',
}
const GENESIS_APPLIED_KEY = 'dugou.genesis_applied.v1'
const DATA_PATCH_V20260205_KEY = 'dugou.data_patch.v20260205'
const DATA_PATCH_V20260206_KEY = 'dugou.data_patch.v20260206'
const ACCESS_LOG_MAX_ROWS = 600
let cloudBootstrapInProgress = false

export const PAGE_AMBIENT_THEME_DEFAULTS = {
  new: 'soft_blue',
  combo: 'classic_white',
  settle: 'classic_white',
  dashboard_overview: 'classic_white',
  dashboard_analysis: 'classic_white',
  dashboard_metrics: 'classic_white',
  history: 'classic_white',
  teams: 'classic_white',
  params: 'classic_white',
}

export const PAGE_AMBIENT_THEME_VALUES = ['classic_white', 'soft_blue', 'soft_orange']

const normalizePageAmbientThemes = (themes) => {
  const incoming = themes && typeof themes === 'object' ? themes : {}
  const next = { ...PAGE_AMBIENT_THEME_DEFAULTS }
  Object.keys(PAGE_AMBIENT_THEME_DEFAULTS).forEach((key) => {
    const candidate = String(incoming[key] || '').trim()
    if (PAGE_AMBIENT_THEME_VALUES.includes(candidate)) {
      next[key] = candidate
    }
  })
  return next
}

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
  // 周期性结算记录（止盈/止损）—— 仅影响蓄水池当前周期，不影响历史总数据
  poolSettlements: [],
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
    initialPriors: {
      weightConf: 0.45,
      weightMode: 0.16,
      weightTys: 0.12,
      weightFid: 0.14,
      weightOdds: 0.06,
      weightFse: 0.07,
    },
  },
  pageAmbientThemes: { ...PAGE_AMBIENT_THEME_DEFAULTS },
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

export const TEAM_ALIAS_LIBRARY = [
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

  // ──────────────────────────────────────────────────────────────
  //  国际赛 · 2026 美加墨世界杯 48 强（后台预备）
  //  仅供「新建比赛」的输入解析 / 自动补全 / 缩写归一化使用：在被某场比赛
  //  实际使用并保存之前，不会出现在「球队档案馆」列表里——档案馆只渲染历史
  //  样本中出现过的球队。缩写取 FIFA 三字码 + 英文名 + 中文常用别名，与
  //  teamDatabase.js 的国际赛条目保持一致；首次被保存时档案会自动继承这些别名。
  // ──────────────────────────────────────────────────────────────
  // A 组
  { teamId: 'natl_mexico', teamName: '墨西哥', abbreviations: ['mex', 'mexico', '墨西哥', '墨西哥队'] },
  { teamId: 'natl_southafrica', teamName: '南非', abbreviations: ['rsa', 'south africa', '南非', '南非队'] },
  { teamId: 'natl_southkorea', teamName: '韩国', abbreviations: ['kor', 'korea', 'south korea', '韩国', '韩国队', '太极虎'] },
  { teamId: 'natl_czechia', teamName: '捷克', abbreviations: ['cze', 'czech', 'czechia', '捷克', '捷克队'] },
  // B 组
  { teamId: 'natl_canada', teamName: '加拿大', abbreviations: ['can', 'canada', '加拿大', '加拿大队'] },
  { teamId: 'natl_bosnia', teamName: '波黑', abbreviations: ['bih', 'bosnia', 'bosnia and herzegovina', '波黑', '波斯尼亚', '波黑队', '波斯尼亚和黑塞哥维那'] },
  { teamId: 'natl_qatar', teamName: '卡塔尔', abbreviations: ['qat', 'qatar', '卡塔尔', '卡塔尔队'] },
  { teamId: 'natl_switzerland', teamName: '瑞士', abbreviations: ['sui', 'switzerland', '瑞士', '瑞士队'] },
  // C 组
  { teamId: 'natl_brazil', teamName: '巴西', abbreviations: ['bra', 'brazil', '巴西', '巴西队', '桑巴军团', '五星巴西'] },
  { teamId: 'natl_morocco', teamName: '摩洛哥', abbreviations: ['mar', 'morocco', '摩洛哥', '摩洛哥队', '阿特拉斯雄狮'] },
  { teamId: 'natl_haiti', teamName: '海地', abbreviations: ['hai', 'haiti', '海地', '海地队'] },
  { teamId: 'natl_scotland', teamName: '苏格兰', abbreviations: ['sco', 'scotland', '苏格兰', '苏格兰队'] },
  // D 组
  { teamId: 'natl_usa', teamName: '美国', abbreviations: ['usa', 'united states', '美国', '美国队'] },
  { teamId: 'natl_paraguay', teamName: '巴拉圭', abbreviations: ['par', 'paraguay', '巴拉圭', '巴拉圭队'] },
  { teamId: 'natl_australia', teamName: '澳大利亚', abbreviations: ['aus', 'australia', '澳大利亚', '澳大利亚队', '袋鼠军团'] },
  { teamId: 'natl_turkey', teamName: '土耳其', abbreviations: ['tur', 'turkey', 'turkiye', '土耳其', '土耳其队'] },
  // E 组
  { teamId: 'natl_germany', teamName: '德国', abbreviations: ['ger', 'germany', '德国', '德国队', '日耳曼战车'] },
  { teamId: 'natl_curacao', teamName: '库拉索', abbreviations: ['cuw', 'curacao', '库拉索', '库拉索队'] },
  { teamId: 'natl_ivorycoast', teamName: '科特迪瓦', abbreviations: ['civ', 'ivory coast', 'cote divoire', '科特迪瓦', '象牙海岸', '科特迪瓦队'] },
  { teamId: 'natl_ecuador', teamName: '厄瓜多尔', abbreviations: ['ecu', 'ecuador', '厄瓜多尔', '厄瓜多尔队'] },
  // F 组
  { teamId: 'natl_netherlands', teamName: '荷兰', abbreviations: ['ned', 'netherlands', 'holland', '荷兰', '荷兰队', '橙衣军团'] },
  { teamId: 'natl_japan', teamName: '日本', abbreviations: ['jpn', 'japan', '日本', '日本队', '蓝色武士'] },
  { teamId: 'natl_sweden', teamName: '瑞典', abbreviations: ['swe', 'sweden', '瑞典', '瑞典队'] },
  { teamId: 'natl_tunisia', teamName: '突尼斯', abbreviations: ['tun', 'tunisia', '突尼斯', '突尼斯队'] },
  // G 组
  { teamId: 'natl_belgium', teamName: '比利时', abbreviations: ['bel', 'belgium', '比利时', '比利时队', '红魔', '欧洲红魔'] },
  { teamId: 'natl_egypt', teamName: '埃及', abbreviations: ['egy', 'egypt', '埃及', '埃及队', '法老'] },
  { teamId: 'natl_iran', teamName: '伊朗', abbreviations: ['irn', 'iran', '伊朗', '伊朗队', '波斯铁骑'] },
  { teamId: 'natl_newzealand', teamName: '新西兰', abbreviations: ['nzl', 'new zealand', '新西兰', '新西兰队', '全白队'] },
  // H 组
  { teamId: 'natl_spain', teamName: '西班牙', abbreviations: ['esp', 'spain', '西班牙', '西班牙队', '斗牛士军团'] },
  { teamId: 'natl_capeverde', teamName: '佛得角', abbreviations: ['cpv', 'cape verde', '佛得角', '佛得角队'] },
  { teamId: 'natl_saudi', teamName: '沙特阿拉伯', abbreviations: ['ksa', 'saudi arabia', 'saudi', '沙特阿拉伯', '沙特', '沙特队'] },
  { teamId: 'natl_uruguay', teamName: '乌拉圭', abbreviations: ['uru', 'uruguay', '乌拉圭', '乌拉圭队'] },
  // I 组
  { teamId: 'natl_france', teamName: '法国', abbreviations: ['fra', 'france', '法国', '法国队', '高卢雄鸡'] },
  { teamId: 'natl_senegal', teamName: '塞内加尔', abbreviations: ['sen', 'senegal', '塞内加尔', '塞内加尔队'] },
  { teamId: 'natl_iraq', teamName: '伊拉克', abbreviations: ['irq', 'iraq', '伊拉克', '伊拉克队'] },
  { teamId: 'natl_norway', teamName: '挪威', abbreviations: ['nor', 'norway', '挪威', '挪威队'] },
  // J 组
  { teamId: 'natl_argentina', teamName: '阿根廷', abbreviations: ['arg', 'argentina', '阿根廷', '阿根廷队', '潘帕斯雄鹰'] },
  { teamId: 'natl_algeria', teamName: '阿尔及利亚', abbreviations: ['alg', 'dza', 'algeria', '阿尔及利亚', '阿尔及利亚队'] },
  { teamId: 'natl_austria', teamName: '奥地利', abbreviations: ['aut', 'austria', '奥地利', '奥地利队'] },
  { teamId: 'natl_jordan', teamName: '约旦', abbreviations: ['jor', 'jordan', '约旦', '约旦队'] },
  // K 组
  { teamId: 'natl_portugal', teamName: '葡萄牙', abbreviations: ['por', 'portugal', '葡萄牙', '葡萄牙队'] },
  { teamId: 'natl_drcongo', teamName: '刚果民主', abbreviations: ['cod', 'dr congo', 'congo dr', '刚果民主', '刚果民主共和国', '刚果金', 'DR刚果'] },
  { teamId: 'natl_uzbekistan', teamName: '乌兹别克斯坦', abbreviations: ['uzb', 'uzbekistan', '乌兹别克斯坦', '乌兹别克', '乌兹别克斯坦队'] },
  { teamId: 'natl_colombia', teamName: '哥伦比亚', abbreviations: ['col', 'colombia', '哥伦比亚', '哥伦比亚队'] },
  // L 组
  { teamId: 'natl_england', teamName: '英格兰', abbreviations: ['eng', 'england', '英格兰', '英格兰队', '三狮军团'] },
  { teamId: 'natl_croatia', teamName: '克罗地亚', abbreviations: ['cro', 'croatia', '克罗地亚', '克罗地亚队', '格子军团'] },
  { teamId: 'natl_ghana', teamName: '加纳', abbreviations: ['gha', 'ghana', '加纳', '加纳队', '黑星'] },
  { teamId: 'natl_panama', teamName: '巴拿马', abbreviations: ['pan', 'panama', '巴拿马', '巴拿马队'] },
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

export const getTeamDirectoryProfiles = (profiles = getTeamProfiles()) => {
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
  if (isPreviewMode()) return previewRead(key, fallback)
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const writeJSON = (key, value) => {
  if (!isBrowser) return
  // Preview mode: writes are redirected to an in-memory store so the
  // public-facing demo never persists to the owner's localStorage or
  // syncs to the cloud snapshot bucket.
  if (isPreviewMode()) {
    previewWrite(key, value)
    window.dispatchEvent(new CustomEvent('dugou:data-changed', { detail: { key, preview: true } }))
    return
  }
  window.localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('dugou:data-changed', { detail: { key } }))
  if (
    !cloudBootstrapInProgress &&
    (
      key === STORAGE_KEYS.investments ||
      key === STORAGE_KEYS.teamProfiles ||
      key === STORAGE_KEYS.systemConfig ||
      key === STORAGE_KEYS.accessLogs
    )
  ) {
    scheduleSnapshotSync(() => exportDataBundle())
  }
}

// ── Display-mode change handling ──
// When the visitor unlocks (preview → full) or relocks (full → preview)
// we drop the in-memory demo store and fan out a data-changed event so
// every analytics memo / UI subscriber re-fetches against the new
// effective data source.
if (typeof window !== 'undefined') {
  const DISPLAY_MODE_HANDLER_KEY = '__dugouDisplayModeHandler__'
  if (typeof window[DISPLAY_MODE_HANDLER_KEY] === 'function') {
    window.removeEventListener(DISPLAY_MODE_CHANGE_EVENT, window[DISPLAY_MODE_HANDLER_KEY])
  }
  const handler = () => {
    resetPreviewStore()
    window.dispatchEvent(
      new CustomEvent('dugou:data-changed', { detail: { key: '__display_mode__' } }),
    )
  }
  window[DISPLAY_MODE_HANDLER_KEY] = handler
  window.addEventListener(DISPLAY_MODE_CHANGE_EVENT, handler)
}

// ── Time Machine data override layer ──
const getTimeMachineDataOverride = (key) => {
  if (!isBrowser) return null
  // In preview mode the Time Machine layer is bypassed entirely —
  // the readJSON preview interception below already routes every
  // storage read to the in-memory demo store. Letting TM run here
  // would otherwise leak real owner snapshots into the demo.
  if (isPreviewMode()) return null
  const session = getTimeMachineSession()
  if (!session || !session.bundle) return null

  switch (key) {
    case STORAGE_KEYS.investments:
      return Array.isArray(session.bundle.investments) ? session.bundle.investments : null
    case STORAGE_KEYS.teamProfiles:
      return Array.isArray(session.bundle.team_profiles) ? session.bundle.team_profiles : null
    case STORAGE_KEYS.systemConfig:
      return session.bundle.system_config && typeof session.bundle.system_config === 'object'
        ? session.bundle.system_config
        : null
    default:
      return null
  }
}

// 只读检查
// In preview mode we forcibly mask Time Machine state so the demo
// surface never advertises a TM session the visitor cannot actually
// inspect. The underlying TM session storage is left intact and will
// reappear once FULL mode is unlocked again.
export const isInTimeMachineMode = () => (isPreviewMode() ? false : isInTimeMachineSession())

export const getTimeMachineSessionInfo = () => {
  if (isPreviewMode()) return null
  const session = getTimeMachineSession()
  if (!session) return null
  return {
    snapshotId: session.snapshotId,
    title: session.title,
    monthKey: session.monthKey,
    snapshotAt: session.snapshotAt,
    startedAt: session.startedAt,
  }
}

const withTeamDefaults = (profile) => ({
  teamId: profile.teamId,
  teamName: profile.teamName,
  abbreviations: profile.abbreviations || [],
  totalSamples: Number(profile.totalSamples) || 0,
  avgRep: Number(profile.avgRep) || 0.5,
})

const normalizeAccessLogRecord = (record) => {
  const createdAtDate = new Date(record?.created_at || record?.visited_at || Date.now())
  const created_at = Number.isNaN(createdAtDate.getTime()) ? new Date().toISOString() : createdAtDate.toISOString()
  return {
    id: String(record?.id || `visit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
    created_at,
    route: String(record?.route || '/params'),
    endpoint: String(record?.endpoint || ''),
    host: String(record?.host || ''),
    origin: String(record?.origin || ''),
    access_channel: String(record?.access_channel || 'web'),
    device_type: String(record?.device_type || 'unknown'),
    client_browser: String(record?.client_browser || ''),
    client_os: String(record?.client_os || ''),
    user_agent: String(record?.user_agent || ''),
    platform: String(record?.platform || ''),
    language: String(record?.language || ''),
    timezone: String(record?.timezone || ''),
    viewport: String(record?.viewport || ''),
    screen: String(record?.screen || ''),
    network_type: String(record?.network_type || ''),
    referrer: String(record?.referrer || ''),
    session_id: String(record?.session_id || ''),
    ip: String(record?.ip || 'N/A (browser restricted)'),
    mac: String(record?.mac || 'N/A (browser restricted)'),
  }
}

export const getSystemConfig = () => {
  // 时光穿越模式优先 - 但保留UI偏好（pageAmbientThemes）
  const tmOverride = getTimeMachineDataOverride(STORAGE_KEYS.systemConfig)
  if (tmOverride !== null) {
    const merged = { ...DEFAULT_SYSTEM_CONFIG, ...tmOverride }
    // 时光穿越中不覆写UI偏好，使用当前的页面主题
    const currentConfig = readJSON(STORAGE_KEYS.systemConfig, null)
    if (currentConfig?.pageAmbientThemes) {
      merged.pageAmbientThemes = normalizePageAmbientThemes(currentConfig.pageAmbientThemes)
    } else {
      merged.pageAmbientThemes = normalizePageAmbientThemes(tmOverride?.pageAmbientThemes)
    }
    return merged
  }

  ensureGenesisApplied()
  const saved = readJSON(STORAGE_KEYS.systemConfig, null)
  const merged = { ...DEFAULT_SYSTEM_CONFIG, ...(saved || {}) }
  merged.pageAmbientThemes = normalizePageAmbientThemes(saved?.pageAmbientThemes)
  return merged
}

export const saveSystemConfig = (configPatch) => {
  // 允许保存UI相关配置即使在时光穿越模式中
  if (!configPatch) return getSystemConfig()

  const current = getSystemConfig()
  const next = {
    ...current,
    ...(configPatch || {}),
  }

  // 如果只是改变pageAmbientThemes（UI偏好），即使在时光穿越中也允许
  const isOnlyUIConfig = Object.keys(configPatch).every(key => key === 'pageAmbientThemes')
  if (!isOnlyUIConfig && !checkReadOnlyMode('Update System Config')) {
    // 返回当前配置但不保存
    return next
  }

  if (Object.prototype.hasOwnProperty.call(configPatch || {}, 'pageAmbientThemes')) {
    next.pageAmbientThemes = normalizePageAmbientThemes({
      ...current.pageAmbientThemes,
      ...((configPatch && configPatch.pageAmbientThemes) || {}),
    })
  }

  if (isOnlyUIConfig || isInTimeMachineMode() === false) {
    writeJSON(STORAGE_KEYS.systemConfig, next)
  }

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

export const getPoolSettlements = () => {
  const config = getSystemConfig()
  return Array.isArray(config.poolSettlements) ? config.poolSettlements : []
}

// 周期性结算：把蓄水池当前周期清零，并可选地为新周期划拨本金。
// 历史投资与总数据完全不动 —— 结算只在 poolSettlements 上画一条时间分界线，
// 蓄水池余额与下注基数从此只统计分界线之后的注资与盈亏。
export const settlePool = ({ type, realizedProfit = 0, poolBefore = 0, cycleBase = 0, newCapital = 0 } = {}) => {
  const config = getSystemConfig()
  const settlements = Array.isArray(config.poolSettlements) ? config.poolSettlements : []
  const injections = Array.isArray(config.capitalInjections) ? config.capitalInjections : []
  const now = Date.now()
  const allocation = Math.max(0, Number(newCapital) || 0)

  const settlement = {
    id: `stl_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type: type === 'stop_loss' ? 'stop_loss' : 'take_profit',
    realizedProfit: Number(realizedProfit) || 0,
    poolBefore: Number(poolBefore) || 0,
    cycleBase: Number(cycleBase) || 0,
    newCapital: allocation,
    linkedInjectionId: null,
    created_at: new Date(now).toISOString(),
  }

  const patch = { poolSettlements: [...settlements, settlement] }

  if (allocation > 0) {
    // 新周期划拨：记一条紧随结算之后的注资（+1ms 保证落在新周期内），
    // 并同步抬升 initialCapital（终身资金曲线把它视为一次真实的资金注入）。
    const injection = {
      id: `inj_${now}_${Math.random().toString(36).slice(2, 8)}`,
      amount: allocation,
      note: '周期结算划拨',
      created_at: new Date(now + 1).toISOString(),
    }
    settlement.linkedInjectionId = injection.id
    patch.capitalInjections = [...injections, injection]
    patch.initialCapital = Number(config.initialCapital || 0) + allocation
  }

  saveSystemConfig(patch)
  return settlement
}

// 撤销结算（结算后的十几秒内可回滚）：移除结算记录及其关联的划拨注资，并还原 initialCapital。
export const recallPoolSettlement = (settlementId) => {
  const config = getSystemConfig()
  const settlements = Array.isArray(config.poolSettlements) ? config.poolSettlements : []
  const target = settlements.find((item) => item.id === settlementId)
  if (!target) return false

  const patch = { poolSettlements: settlements.filter((item) => item.id !== settlementId) }
  if (target.linkedInjectionId) {
    const injections = Array.isArray(config.capitalInjections) ? config.capitalInjections : []
    patch.capitalInjections = injections.filter((item) => item.id !== target.linkedInjectionId)
    patch.initialCapital = Math.max(0, Number(config.initialCapital || 0) - Number(target.newCapital || 0))
  }
  saveSystemConfig(patch)
  return true
}

export const getTeamProfiles = () => {
  // 时光穿越模式优先
  const tmOverride = getTimeMachineDataOverride(STORAGE_KEYS.teamProfiles)
  if (tmOverride !== null) {
    const data = Array.isArray(tmOverride) ? tmOverride : []
    return data.map(withTeamDefaults)
  }

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
    .map((match) => {
      if (Array.isArray(match?.entries) && match.entries.length > 0) {
        const matchFallback = Number.parseFloat(match?.odds)
        const safeFallback = Number.isFinite(matchFallback) && matchFallback > 1 ? matchFallback : 2.5
        return calcAtomicEquivalentOdds(match.entries, safeFallback)
      }
      return Number.parseFloat(match?.odds)
    })
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
  const incomingAccessLogs = toArray(bundle.access_logs)
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeAccessLogRecord(item))

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

    const currentAccessLogs = getAccessLogs()
    const accessMap = new Map(currentAccessLogs.map((item) => [item.id, item]))
    incomingAccessLogs.forEach((item) => {
      const existing = accessMap.get(item.id)
      if (!existing) {
        accessMap.set(item.id, item)
        return
      }
      const incomingTime = new Date(item.created_at || 0).getTime()
      const existingTime = new Date(existing.created_at || 0).getTime()
      if (incomingTime >= existingTime) {
        accessMap.set(item.id, item)
      }
    })
    const mergedAccessLogs = [...accessMap.values()]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, ACCESS_LOG_MAX_ROWS)

    writeJSON(STORAGE_KEYS.systemConfig, { ...getSystemConfig(), ...incomingConfig })
    writeJSON(STORAGE_KEYS.teamProfiles, [...teamMap.values()])
    writeJSON(STORAGE_KEYS.investments, [...investmentMap.values()])
    writeJSON(STORAGE_KEYS.accessLogs, mergedAccessLogs)
    markGenesisApplied()
    return true
  }

  writeJSON(STORAGE_KEYS.systemConfig, { ...DEFAULT_SYSTEM_CONFIG, ...incomingConfig })
  writeJSON(STORAGE_KEYS.teamProfiles, incomingTeams.length > 0 ? incomingTeams : DEFAULT_TEAM_PROFILES)
  writeJSON(STORAGE_KEYS.investments, incomingInvestments)
  writeJSON(STORAGE_KEYS.accessLogs, incomingAccessLogs.slice(0, ACCESS_LOG_MAX_ROWS))
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
  // 时光穿越模式优先
  const tmOverride = getTimeMachineDataOverride(STORAGE_KEYS.investments)
  if (tmOverride !== null) {
    const data = Array.isArray(tmOverride) ? tmOverride : []
    return data
      .map((item) => normalizeInvestmentRecord(item))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  }

  ensureGenesisApplied()
  applyManualDataPatchV20260205()
  applyManualDataPatchV20260206()
  const saved = readJSON(STORAGE_KEYS.investments, [])
  if (!Array.isArray(saved)) return []
  return saved
    .map((item) => normalizeInvestmentRecord(item))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
}

export const getAccessLogs = () => {
  ensureGenesisApplied()
  const saved = readJSON(STORAGE_KEYS.accessLogs, [])
  if (!Array.isArray(saved)) return []
  return saved
    .map((item) => normalizeAccessLogRecord(item))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, ACCESS_LOG_MAX_ROWS)
}

export const appendAccessLog = (record, options = {}) => {
  const maxRows = Number.isFinite(Number(options.maxRows))
    ? Math.max(50, Math.min(2000, Number(options.maxRows)))
    : ACCESS_LOG_MAX_ROWS
  const existing = getAccessLogs()
  const normalized = normalizeAccessLogRecord(record)
  const latest = existing[0]
  if (
    latest &&
    latest.session_id &&
    normalized.session_id &&
    latest.session_id === normalized.session_id &&
    latest.route === normalized.route &&
    latest.endpoint === normalized.endpoint &&
    latest.user_agent === normalized.user_agent &&
    Math.abs(new Date(normalized.created_at).getTime() - new Date(latest.created_at).getTime()) <= 8000
  ) {
    return latest
  }

  const next = [normalized, ...existing.filter((item) => item.id !== normalized.id)]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, maxRows)
  writeJSON(STORAGE_KEYS.accessLogs, next)
  return normalized
}

const checkReadOnlyMode = (operationName = 'Operation') => {
  if (isInTimeMachineMode()) {
    console.warn(`[DuGou] 时光穿越中：${operationName}已禁用，仅浏览历史快照。`)
    return false
  }
  return true
}

export const saveInvestment = (investment) => {
  if (!checkReadOnlyMode('New Investment')) return null
  const existing = getInvestments()
  const normalized = normalizeInvestmentRecord(investment)
  const next = [normalized, ...existing]
  writeJSON(STORAGE_KEYS.investments, next)
  return normalized
}

export const updateInvestment = (investmentId, updater) => {
  if (!checkReadOnlyMode('Update Investment')) return null
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
  if (!checkReadOnlyMode('Delete Investment')) return false
  const existing = getInvestments()
  const next = existing.filter((item) => item.id !== investmentId)
  if (next.length === existing.length) return false
  writeJSON(STORAGE_KEYS.investments, next)
  return true
}

export const setInvestmentArchived = (investmentId, archived = true) => {
  if (!checkReadOnlyMode('Archive Investment')) return false
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
  access_logs: getAccessLogs(),
})

export const importDataBundle = (bundle, mode = 'replace') => {
  return applyDataBundle(bundle, mode)
}

export const restoreGenesisData = () => {
  if (isPreviewMode()) return false
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
  // In preview mode we never reach out to Supabase — the demo bundle
  // is fully self-contained and reaching the cloud would either leak
  // real owner snapshots into the demo or churn cloud bandwidth for
  // anonymous visitors.
  if (isPreviewMode()) return { ok: false, reason: 'preview_mode_blocked', applied: false }
  cloudBootstrapInProgress = true
  const status = getCloudSyncState()
  if (!status.hasEnv) {
    cloudBootstrapInProgress = false
    return { ok: false, reason: 'missing_env', applied: false }
  }
  try {
    return await pullCloudSnapshotNow('replace')
  } finally {
    cloudBootstrapInProgress = false
  }
}

export const runCloudSyncNow = async () => {
  if (isPreviewMode()) return { ok: false, reason: 'preview_mode_blocked' }
  const snapshot = exportDataBundle()
  return syncSnapshotNow(snapshot)
}

export const pullCloudSnapshotNow = async (mode = 'merge') => {
  if (isPreviewMode()) return { ok: false, reason: 'preview_mode_blocked', applied: false }
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

// ── Time Machine Public API ──

export const beginTimeMachineSession = async (snapshotId) => {
  if (isPreviewMode()) return { ok: false, reason: 'preview_mode_blocked' }
  const result = await fetchTimeMachineSnapshotById(snapshotId)
  if (!result.ok) return result

  const sessionResult = startTimeMachineSession({
    snapshotId: result.snapshotId,
    bundle: result.bundle,
    meta: result.meta,
    updatedAt: result.updatedAt,
  })

  if (sessionResult.ok) {
    window.dispatchEvent(new CustomEvent('dugou:data-changed', { detail: { key: 'all' } }))
  }

  return sessionResult
}

export const endTimeMachineSession = () => {
  const result = exitTimeMachineSession()
  if (result.ok) {
    window.dispatchEvent(new CustomEvent('dugou:data-changed', { detail: { key: 'all' } }))
  }
  return result
}

export const listHistoricalSnapshots = (page = 1, pageSize = 6) => {
  if (isPreviewMode()) return Promise.resolve({ ok: true, items: [], total: 0, page, pageSize })
  return listTimeMachineSnapshots({ page, pageSize })
}

export const saveSnapshot = async (title = '', mode = 'manual') => {
  if (isPreviewMode()) return { ok: false, reason: 'preview_mode_blocked' }
  const snapshot = exportDataBundle()

  // Debug: 检查数据结构
  if (!snapshot.system_config || typeof snapshot.system_config !== 'object') {
    console.error('[saveSnapshot] Invalid system_config:', snapshot.system_config)
    return { ok: false, reason: 'invalid_system_config' }
  }
  if (!Array.isArray(snapshot.team_profiles)) {
    console.error('[saveSnapshot] Invalid team_profiles:', snapshot.team_profiles)
    return { ok: false, reason: 'invalid_team_profiles' }
  }
  if (!Array.isArray(snapshot.investments)) {
    console.error('[saveSnapshot] Invalid investments:', snapshot.investments)
    return { ok: false, reason: 'invalid_investments' }
  }

  return saveTimeMachineSnapshot({
    snapshot,
    title,
    mode,
  })
}

export const ensureCurrentMonthSnapshot = async () => {
  if (isPreviewMode()) return { ok: false, reason: 'preview_mode_blocked' }
  const snapshot = exportDataBundle()
  return ensureMonthlyTimeMachineSnapshot({ snapshot })
}

export const deleteTimeMachineSnapshot = async (snapshotId) => {
  if (isPreviewMode()) return { ok: false, reason: 'preview_mode_blocked' }
  try {
    const result = await deleteTimeMachineSnapshotById(snapshotId)
    return result
  } catch (err) {
    return { ok: false, reason: err.message || 'Unknown error' }
  }
}
