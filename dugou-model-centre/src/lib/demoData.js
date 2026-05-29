/**
 * Demo Data Bundle — what visitors see in preview mode.
 *
 * Hand-curated synthetic dataset: 40 investments over a 92-day window
 * (2025-10-01 → 2025-12-31), spanning all six strategy modes, parlay
 * sizes from 1 to 5 legs, and a realistic ~55% hit rate with a gently
 * positive ROI trajectory and one mild drawdown phase to make the
 * dashboard charts read naturally.
 *
 * Implementation note: instead of hand-typing 40 JSON records we
 * generate them deterministically from a seeded PRNG. This keeps the
 * file readable, the demo reproducible, and the parameter
 * distributions tunable. Three didactic showcase investments are
 * injected by hand to demonstrate specific algorithm capabilities:
 *   - high-surplus contrarian hit (rewards the conf-surplus signal)
 *   - anchor-failure parlay (motivates fragility heatmap)
 *   - fault-tolerant covering combo (4-of-5 survival pattern)
 */

const STORAGE_KEYS = {
  systemConfig: 'dugou.system_config.v1',
}

// ── Real-world team roster ─────────────────────────────────────────
// English Premier League 20 + European elite clubs. Strength ratings
// roughly track Elo/club-power signals from the 2023-24 cycle so the
// generated matchups look credible to anyone who follows football.
const TEAMS = [
  // ── EPL 20 ──
  { id: 'mancity',     name: '曼城',         abbr: 'mci', strength: 0.86 },
  { id: 'liverpool',   name: '利物浦',       abbr: 'liv', strength: 0.80 },
  { id: 'arsenal',     name: '阿森纳',       abbr: 'ars', strength: 0.78 },
  { id: 'tottenham',   name: '热刺',         abbr: 'tot', strength: 0.68 },
  { id: 'astonvilla',  name: '维拉',         abbr: 'avl', strength: 0.66 },
  { id: 'newcastle',   name: '纽卡斯尔',     abbr: 'new', strength: 0.66 },
  { id: 'chelsea',     name: '切尔西',       abbr: 'che', strength: 0.64 },
  { id: 'manutd',      name: '曼联',         abbr: 'mun', strength: 0.62 },
  { id: 'westham',     name: '西汉姆',       abbr: 'whu', strength: 0.56 },
  { id: 'brighton',    name: '布莱顿',       abbr: 'bha', strength: 0.55 },
  { id: 'crystalpalace', name: '水晶宫',     abbr: 'cry', strength: 0.50 },
  { id: 'brentford',   name: '布伦特福德',   abbr: 'bre', strength: 0.50 },
  { id: 'fulham',      name: '富勒姆',       abbr: 'ful', strength: 0.48 },
  { id: 'wolves',      name: '狼队',         abbr: 'wol', strength: 0.47 },
  { id: 'bournemouth', name: '伯恩茅斯',     abbr: 'bou', strength: 0.45 },
  { id: 'everton',     name: '埃弗顿',       abbr: 'eve', strength: 0.43 },
  { id: 'nottingham',  name: '诺丁汉森林',   abbr: 'nfo', strength: 0.41 },
  { id: 'burnley',     name: '伯恩利',       abbr: 'bur', strength: 0.34 },
  { id: 'sheffield',   name: '谢菲尔德联',   abbr: 'shu', strength: 0.32 },
  { id: 'luton',       name: '卢顿',         abbr: 'lut', strength: 0.30 },
  // ── EFL Championship promotion candidates (used in cup ties) ──
  { id: 'leeds',       name: '利兹联',       abbr: 'lee', strength: 0.42 },

  // ── European elites ──
  { id: 'realmadrid',  name: '皇马',         abbr: 'rma', strength: 0.84 },
  { id: 'bayern',      name: '拜仁',         abbr: 'bay', strength: 0.82 },
  { id: 'barcelona',   name: '巴萨',         abbr: 'bar', strength: 0.76 },
  { id: 'psg',         name: '巴黎圣日耳曼', abbr: 'psg', strength: 0.76 },
  { id: 'inter',       name: '国际米兰',     abbr: 'int', strength: 0.72 },
  { id: 'atletico',    name: '马竞',         abbr: 'atm', strength: 0.70 },
  { id: 'dortmund',    name: '多特蒙德',     abbr: 'bvb', strength: 0.66 },
  { id: 'juventus',    name: '尤文图斯',     abbr: 'juv', strength: 0.66 },
  { id: 'milan',       name: 'AC米兰',       abbr: 'acm', strength: 0.64 },
  { id: 'leverkusen',  name: '勒沃库森',     abbr: 'b04', strength: 0.62 },
]

const MODES = ['常规', '常规-稳', '常规-杠杆', '半彩票半保险', '保险产品', '赌一把']
const TYS_LEVELS = ['S', 'M', 'L', 'H']

const RESULT_ENTRIES = {
  win: { text: '主胜', short: 'W' },
  draw: { text: '平局', short: 'D' },
  lose: { text: '主负', short: 'L' },
}

// ── Seeded PRNG (Mulberry32) ───────────────────────────────────────
const SEED = 0x6e4b1f5d
const createRng = (seed) => {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const rand = createRng(SEED)
const randRange = (min, max) => min + rand() * (max - min)
const randInt = (min, max) => Math.floor(randRange(min, max + 1))
const randChoice = (arr) => arr[Math.floor(rand() * arr.length)]
const randChoiceWeighted = (arr, weights) => {
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = rand() * sum
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i]
    if (r <= 0) return arr[i]
  }
  return arr[arr.length - 1]
}
const round2 = (v) => Math.round(v * 100) / 100
const round1 = (v) => Math.round(v * 10) / 10
const roundOdds = (v) => Math.round(v * 100) / 100

// ── Match outcome model ────────────────────────────────────────────
// Convert two team strengths into result probabilities. Larger gap
// → larger favourite tilt. A small draw probability is folded in.
const matchResultProbabilities = (homeStrength, awayStrength) => {
  // home advantage of ~3%
  const homeAdj = homeStrength + 0.03
  const total = homeAdj + awayStrength
  const winRaw = homeAdj / total
  const loseRaw = awayStrength / total
  // collapse a chunk into draw — closer matches have more draws
  const closeness = 1 - Math.abs(homeAdj - awayStrength)
  const drawProb = 0.14 + closeness * 0.16
  const winProb = winRaw * (1 - drawProb)
  const loseProb = loseRaw * (1 - drawProb)
  return { win: winProb, draw: drawProb, lose: loseProb }
}

const oddsForProbability = (p, vig = 1.08) => {
  // include bookmaker vig so demo odds feel like real market quotes
  if (p <= 0.001) return 999
  return roundOdds(vig / p)
}

// ── Build a single match ───────────────────────────────────────────
const pickTeamPair = (forbid = []) => {
  let home
  let away
  let guard = 0
  while (guard++ < 60) {
    home = randChoice(TEAMS)
    away = randChoice(TEAMS)
    if (home.id !== away.id && !forbid.includes(home.id) && !forbid.includes(away.id)) {
      return { home, away }
    }
  }
  return { home: TEAMS[0], away: TEAMS[1] }
}

const buildMatch = ({ home, away, mode, dateIso, idSuffix, parlaySize }) => {
  const probs = matchResultProbabilities(home.strength, away.strength)
  const oddsWin = oddsForProbability(probs.win)
  const oddsDraw = oddsForProbability(probs.draw)
  const oddsLose = oddsForProbability(probs.lose)

  // Favour the most-probable outcome heavily — the model is "smart"
  // by design, picking favourites ~70% of the time. This drives the
  // single-match hit rate toward the target ~58%.
  const ranked = [
    { key: 'win', odds: oddsWin, p: probs.win },
    { key: 'draw', odds: oddsDraw, p: probs.draw },
    { key: 'lose', odds: oddsLose, p: probs.lose },
  ].sort((a, b) => b.p - a.p)
  const pickedSlot = randChoiceWeighted([ranked[0], ranked[1], ranked[2]], [0.70, 0.22, 0.08])

  const entry = RESULT_ENTRIES[pickedSlot.key]
  const odds = pickedSlot.odds

  // Confidence is anchored to the model's belief in the picked outcome
  // (approximately 1/odds × vig adjustment), plus a positive subjective
  // lift so the displayed Conf values feel "confident".
  const implied = Math.min(0.92, Math.max(0.18, 1 / odds * 1.08))
  const conf = round2(Math.min(0.88, Math.max(0.42, implied + randRange(0.02, 0.22))))

  // Per-leg hit probability — calibrated so total settled hit rate
  // lands near 55%, in line with what a competent quant punter would
  // realistically achieve. Single-leg base 0.54; multi-leg legs are
  // slightly higher so a fraction of multi-leg combos still survive.
  const sizeBase = parlaySize === 1 ? 0.54
    : parlaySize === 2 ? 0.56
    : parlaySize === 3 ? 0.58
    : parlaySize === 4 ? 0.59
    : 0.60
  const confLift = (conf - 0.50) * 0.28
  const hitProb = Math.min(0.84, Math.max(0.34, sizeBase + confLift + randRange(-0.04, 0.04)))
  const isCorrect = rand() < hitProb

  // Synthesize a score consistent with hit/miss.
  const realisedResult = isCorrect
    ? pickedSlot.key
    : (pickedSlot.key === 'win' ? (rand() < 0.5 ? 'draw' : 'lose')
       : pickedSlot.key === 'lose' ? (rand() < 0.5 ? 'draw' : 'win')
       : (rand() < 0.5 ? 'win' : 'lose'))

  // AJR correlates with conf when right, tracks downward when wrong.
  const matchRating = isCorrect
    ? round2(Math.min(0.78, conf * 0.85 + randRange(0.05, 0.22)))
    : round2(Math.max(0.08, conf * 0.35 - randRange(0.04, 0.20)))

  const matchRep = rand() < 0.18
    ? round1(randRange(0.2, 1.6))
    : 0

  return {
    id: `demo_match_${idSuffix}`,
    home_team: home.name,
    away_team: away.name,
    entries: [{ name: entry.text, odds }],
    entry_text: entry.text,
    odds,
    conf,
    mode,
    tys_home: randChoiceWeighted(TYS_LEVELS, [0.22, 0.42, 0.26, 0.10]),
    tys_away: randChoiceWeighted(TYS_LEVELS, [0.22, 0.42, 0.26, 0.10]),
    fid: randChoice([0, 0.25, 0.4, 0.5, 0.6, 0.75]),
    fse_home: round2(randRange(0.35, 0.85)),
    fse_away: round2(randRange(0.35, 0.85)),
    fse_match: round2(randRange(0.4, 0.8)),
    note: '',
    results: synthesiseScore(realisedResult, home.strength, away.strength),
    is_correct: isCorrect,
    match_rating: matchRating,
    match_rep: matchRep || null,
    post_note: '',
  }
}

const synthesiseScore = (trueResult, homeStrength, awayStrength) => {
  const expectedHome = 0.6 + homeStrength * 1.4
  const expectedAway = 0.4 + awayStrength * 1.4
  const homeGoals = Math.max(0, Math.round(expectedHome + randRange(-0.6, 0.6)))
  const awayGoals = Math.max(0, Math.round(expectedAway + randRange(-0.6, 0.6)))
  if (trueResult === 'win' && homeGoals <= awayGoals) return `${awayGoals + 1}-${awayGoals}`
  if (trueResult === 'lose' && homeGoals >= awayGoals) return `${homeGoals}-${homeGoals + 1}`
  if (trueResult === 'draw' && homeGoals !== awayGoals) return `${homeGoals}-${homeGoals}`
  return `${homeGoals}-${awayGoals}`
}

// ── Investment timeline ────────────────────────────────────────────
const START_TS = new Date('2025-09-01T12:00:00.000Z').getTime()
const END_TS = new Date('2025-12-31T20:00:00.000Z').getTime()

// Distribution of parlay sizes — single matches dominate, then 2-leg,
// then taper. Matches the user's actual betting tendency profile.
const pickParlaySize = () => randChoiceWeighted([1, 2, 3, 4, 5], [0.34, 0.30, 0.20, 0.10, 0.06])

const pickMode = () => randChoiceWeighted(MODES, [0.32, 0.18, 0.18, 0.12, 0.12, 0.08])

const buildInvestment = (index, dateIso) => {
  const parlaySize = pickParlaySize()
  const mode = pickMode()

  const usedTeams = []
  const matches = []
  for (let leg = 0; leg < parlaySize; leg++) {
    const { home, away } = pickTeamPair(usedTeams)
    usedTeams.push(home.id, away.id)
    matches.push(buildMatch({
      home,
      away,
      mode,
      dateIso,
      idSuffix: `${index}_${leg + 1}`,
      parlaySize,
    }))
  }

  const combinedOdds = roundOdds(matches.reduce((acc, m) => acc * m.odds, 1))
  const isWin = matches.every((m) => m.is_correct)

  // Stake sizing: skew toward 8-18 yuan with hard caps that scale
  // inversely with combined odds so a single high-variance combo can
  // never produce a hundreds-of-yuan profit outlier.
  let inputs
  if (parlaySize === 1) {
    inputs = Math.round(randRange(10, 22))
  } else if (parlaySize === 2) {
    inputs = Math.round(randRange(7, 16))
  } else if (parlaySize === 3) {
    inputs = Math.round(randRange(4, 11))
  } else if (parlaySize === 4) {
    inputs = Math.round(randRange(3, 7))
  } else {
    inputs = Math.round(randRange(2, 5))
  }
  // Hard cap by combined-odds tier — maximum possible profit per
  // investment stays roughly within [-25, +55] yuan range so no
  // single combo dominates the dashboard trajectory.
  if (combinedOdds >= 50) inputs = Math.min(inputs, 1)
  else if (combinedOdds >= 25) inputs = Math.min(inputs, 2)
  else if (combinedOdds >= 12) inputs = Math.min(inputs, 4)
  else if (combinedOdds >= 6) inputs = Math.min(inputs, 7)
  else if (combinedOdds >= 3.5) inputs = Math.min(inputs, 12)
  inputs = Math.max(1, inputs)

  const expectedRating = round2(
    matches.reduce((acc, m) => acc + m.conf, 0) / matches.length * 0.85,
  )
  const actualRating = round2(
    matches.reduce((acc, m) => acc + m.match_rating, 0) / matches.length,
  )

  const revenues = isWin ? round2(inputs * combinedOdds) : 0
  const profit = round2(revenues - inputs)

  return {
    id: `demo_inv_${index}`,
    created_at: dateIso,
    parlay_size: parlaySize,
    inputs,
    suggested_amount: inputs,
    expected_rating: expectedRating,
    combined_odds: combinedOdds,
    status: isWin ? 'win' : 'lose',
    revenues,
    profit,
    actual_rating: actualRating,
    rep: matches.find((m) => m.match_rep)?.match_rep ?? null,
    remarks: '',
    matches,
  }
}

// ── Didactic showcase samples ──────────────────────────────────────
// Three hand-crafted investments that demonstrate specific algorithm
// capabilities cleanly. Recruiters scrolling the history list will hit
// these and see exactly what the model does well.
const buildShowcaseSamples = () => {
  // Sample A: high-surplus contrarian hit (rare 5x+ winner).
  const sampleA = {
    id: 'demo_inv_showcase_a',
    created_at: '2025-11-04T19:30:00.000Z',
    parlay_size: 1,
    inputs: 14,
    suggested_amount: 14,
    expected_rating: 0.62,
    combined_odds: 5.20,
    status: 'win',
    revenues: 72.80,
    profit: 58.80,
    actual_rating: 0.72,
    rep: null,
    remarks: 'High Conf-Surplus signal: model conviction far above market implied',
    matches: [{
      id: 'demo_match_showcase_a_1',
      home_team: '维拉',
      away_team: '曼城',
      entries: [{ name: '主胜', odds: 5.20 }],
      entry_text: '主胜',
      odds: 5.20,
      conf: 0.62,
      mode: '常规-杠杆',
      tys_home: 'L',
      tys_away: 'M',
      fid: 0.6,
      fse_home: 0.78,
      fse_away: 0.55,
      fse_match: 0.66,
      note: '',
      results: '2-1',
      is_correct: true,
      match_rating: 0.72,
      match_rep: null,
      post_note: '',
    }],
  }

  // Sample B: anchor failure — 3-leg parlay, lost on a single leg.
  // Motivates the fragility heatmap / dependency analysis features.
  const sampleB = {
    id: 'demo_inv_showcase_b',
    created_at: '2025-11-18T20:00:00.000Z',
    parlay_size: 3,
    inputs: 12,
    suggested_amount: 12,
    expected_rating: 0.58,
    combined_odds: 8.96,
    status: 'lose',
    revenues: 0,
    profit: -12,
    actual_rating: 0.41,
    rep: 1.4,
    remarks: 'Anchor leg failed — fragility heatmap flagged this dependency',
    matches: [
      {
        id: 'demo_match_showcase_b_1',
        home_team: '曼城', away_team: '布伦特福德',
        entries: [{ name: '主胜', odds: 1.55 }], entry_text: '主胜', odds: 1.55,
        conf: 0.78, mode: '常规', tys_home: 'H', tys_away: 'S',
        fid: 0.5, fse_home: 0.72, fse_away: 0.48, fse_match: 0.59,
        note: '', results: '3-0', is_correct: true, match_rating: 0.78,
        match_rep: null, post_note: '',
      },
      {
        id: 'demo_match_showcase_b_2',
        home_team: '阿森纳', away_team: '富勒姆',
        entries: [{ name: '主胜', odds: 1.85 }], entry_text: '主胜', odds: 1.85,
        conf: 0.70, mode: '常规', tys_home: 'H', tys_away: 'M',
        fid: 0.4, fse_home: 0.66, fse_away: 0.54, fse_match: 0.60,
        note: '', results: '2-1', is_correct: true, match_rating: 0.66,
        match_rep: null, post_note: '',
      },
      {
        id: 'demo_match_showcase_b_3',
        home_team: '热刺', away_team: '切尔西',
        entries: [{ name: '主胜', odds: 2.35 }], entry_text: '主胜', odds: 2.35,
        conf: 0.58, mode: '常规', tys_home: 'M', tys_away: 'M',
        fid: 0.6, fse_home: 0.66, fse_away: 0.62, fse_match: 0.64,
        note: '', results: '1-2', is_correct: false, match_rating: 0.18,
        match_rep: 1.4, post_note: '38分钟红牌——比赛结果被随机事件扭曲',
      },
    ],
  }

  // Sample C: fault-tolerant covering combo, 4-of-5 survival.
  const sampleC = {
    id: 'demo_inv_showcase_c',
    created_at: '2025-12-09T19:15:00.000Z',
    parlay_size: 4,
    inputs: 4,
    suggested_amount: 4,
    expected_rating: 0.55,
    combined_odds: 18.40,
    status: 'win',
    revenues: 73.60,
    profit: 69.60,
    actual_rating: 0.64,
    rep: null,
    remarks: 'Fault-tolerant coverage survived — covering layer paid off',
    matches: [
      {
        id: 'demo_match_showcase_c_1',
        home_team: '利物浦', away_team: '诺丁汉森林',
        entries: [{ name: '主胜', odds: 1.55 }], entry_text: '主胜', odds: 1.55,
        conf: 0.74, mode: '半彩票半保险', tys_home: 'H', tys_away: 'S',
        fid: 0.5, fse_home: 0.64, fse_away: 0.52, fse_match: 0.58,
        note: '', results: '2-0', is_correct: true, match_rating: 0.72,
        match_rep: null, post_note: '',
      },
      {
        id: 'demo_match_showcase_c_2',
        home_team: '拜仁', away_team: '勒沃库森',
        entries: [{ name: '主胜', odds: 2.10 }], entry_text: '主胜', odds: 2.10,
        conf: 0.60, mode: '半彩票半保险', tys_home: 'L', tys_away: 'M',
        fid: 0.4, fse_home: 0.60, fse_away: 0.50, fse_match: 0.55,
        note: '', results: '3-1', is_correct: true, match_rating: 0.66,
        match_rep: null, post_note: '',
      },
      {
        id: 'demo_match_showcase_c_3',
        home_team: '国际米兰', away_team: '尤文图斯',
        entries: [{ name: '主胜', odds: 2.40 }], entry_text: '主胜', odds: 2.40,
        conf: 0.58, mode: '半彩票半保险', tys_home: 'M', tys_away: 'M',
        fid: 0.5, fse_home: 0.58, fse_away: 0.52, fse_match: 0.55,
        note: '', results: '2-1', is_correct: true, match_rating: 0.62,
        match_rep: null, post_note: '',
      },
      {
        id: 'demo_match_showcase_c_4',
        home_team: '皇马', away_team: '巴萨',
        entries: [{ name: '主胜', odds: 2.03 }], entry_text: '主胜', odds: 2.03,
        conf: 0.58, mode: '半彩票半保险', tys_home: 'H', tys_away: 'H',
        fid: 0.6, fse_home: 0.72, fse_away: 0.70, fse_match: 0.71,
        note: '', results: '3-2', is_correct: true, match_rating: 0.70,
        match_rep: null, post_note: '',
      },
    ],
  }

  return [sampleA, sampleB, sampleC]
}

// ── Marquee fixtures ───────────────────────────────────────────────
// The four highlight matchups (Arsenal-Liverpool, Man City-Chelsea,
// Barca-Real, Bayern-PSG) appear in two places:
//   1) Three SETTLED bundles in History, with realistic results — the
//      4-leg combo demonstrates the canonical "3-correct-1-incorrect
//      anchor failure" pattern that motivates the fragility heatmap.
//   2) FOUR fresh PENDING single-match investments — these are the
//      "upcoming gameweek" candidates that populate the ComboPage
//      portfolio surface in preview mode.

const MARQUEE_FIXTURES = {
  arsenalLiverpool: {
    home: '阿森纳', away: '利物浦', entry: '主胜', odds: 2.45,
    conf: 0.58, mode: '常规',
    tysHome: 'M', tysAway: 'H', fid: 0.5, fseHome: 0.64, fseAway: 0.68,
    note: '伦敦德比红军客场',
  },
  mancityChelsea: {
    home: '曼城', away: '切尔西', entry: '主胜', odds: 1.85,
    conf: 0.68, mode: '常规-杠杆',
    tysHome: 'H', tysAway: 'M', fid: 0.6, fseHome: 0.74, fseAway: 0.62,
    note: '伊蒂哈德主场强度差距明显',
  },
  barcaReal: {
    home: '巴萨', away: '皇马', entry: '主胜', odds: 2.80,
    conf: 0.52, mode: '半彩票半保险',
    tysHome: 'L', tysAway: 'H', fid: 0.5, fseHome: 0.66, fseAway: 0.72,
    note: '国家德比 · 历史相互克制',
  },
  bayernPsg: {
    home: '拜仁', away: '巴黎圣日耳曼', entry: '主胜', odds: 2.20,
    conf: 0.62, mode: '常规',
    tysHome: 'H', tysAway: 'L', fid: 0.5, fseHome: 0.70, fseAway: 0.60,
    note: '欧冠淘汰赛 · 安联球场主场加成',
  },
  // Additional pending-only fixtures (next gameweek extras)
  milanInter: {
    home: 'AC米兰', away: '国际米兰', entry: '主胜', odds: 2.90,
    conf: 0.48, mode: '半彩票半保险',
    tysHome: 'M', tysAway: 'H', fid: 0.5, fseHome: 0.62, fseAway: 0.68,
    note: '米兰德比 · 经典对抗 · 平局倾向较高',
  },
  manutdEverton: {
    home: '曼联', away: '埃弗顿', entry: '主胜', odds: 1.65,
    conf: 0.70, mode: '常规-稳',
    tysHome: 'H', tysAway: 'S', fid: 0.6, fseHome: 0.60, fseAway: 0.46,
    note: '老特拉福德主场 · 升降级压力下的稳态投注',
    // Still part of the pending 2-leg English bundle on the Settle page,
    // but hidden from the Portfolio candidate pool (demo polish).
    excludeFromPortfolio: true,
  },
  leedsNottingham: {
    home: '利兹联', away: '诺丁汉森林', entry: '主胜', odds: 2.05,
    conf: 0.58, mode: '常规',
    tysHome: 'M', tysAway: 'M', fid: 0.4, fseHome: 0.54, fseAway: 0.52,
    note: '埃兰路主场 · 双方近期状态相近 · 信息深度偏低',
  },
  dortmundLeverkusen: {
    home: '多特蒙德', away: '勒沃库森', entry: '主胜', odds: 2.35,
    conf: 0.55, mode: '常规-杠杆',
    tysHome: 'M', tysAway: 'M', fid: 0.5, fseHome: 0.64, fseAway: 0.62,
    note: '德甲焦点 · 威斯特法伦主场 · 进攻对攻倾向',
  },
}

const makeMarqueeMatch = (idSuffix, fields, outcome) => {
  // outcome: { results, isCorrect, matchRating, matchRep?, postNote? }
  return {
    id: `demo_inv_marquee_${idSuffix}`,
    home_team: fields.home,
    away_team: fields.away,
    entries: [{ name: fields.entry, odds: fields.odds }],
    entry_text: fields.entry,
    odds: fields.odds,
    conf: fields.conf,
    mode: fields.mode,
    tys_home: fields.tysHome,
    tys_away: fields.tysAway,
    fid: fields.fid,
    fse_home: fields.fseHome,
    fse_away: fields.fseAway,
    fse_match: round2(Math.sqrt(fields.fseHome * fields.fseAway)),
    note: fields.note || '',
    exclude_from_portfolio: fields.excludeFromPortfolio === true,
    results: outcome.results,
    is_correct: outcome.isCorrect,
    match_rating: outcome.matchRating,
    match_rep: outcome.matchRep ?? null,
    post_note: outcome.postNote || '',
  }
}

// ── Settled marquee bundles (History) ──────────────────────────────
const buildMarqueeSettled = () => {
  const dateIso = '2025-12-30T19:00:00.000Z'

  // Outcomes — designed so the 4-leg follows the "anchor-failure"
  // narrative: three legs hit, one fails on a high-variance result.
  // 阿森纳 vs 利物浦 → 主胜 (correct)
  // 曼城 vs 切尔西 → 主胜 (correct)
  // 巴萨 vs 皇马 → 客胜 (INCORRECT — Real Madrid stole the derby)
  // 拜仁 vs 巴黎 → 主胜 (correct)
  const arsenalLiverpoolOutcome = {
    results: '2-1', isCorrect: true, matchRating: 0.66, postNote: '萨利巴关键解围',
  }
  const mancityChelseaOutcome = {
    results: '3-1', isCorrect: true, matchRating: 0.72, postNote: '哈兰德梅开二度',
  }
  const barcaRealOutcome = {
    results: '1-2', isCorrect: false, matchRating: 0.22, matchRep: 1.4,
    postNote: '维尼修斯 89 分钟绝杀 · 模型置信度 0.52 显然偏低',
  }
  const bayernPsgOutcome = {
    results: '2-0', isCorrect: true, matchRating: 0.70, postNote: '凯恩 + 穆夏拉锁定胜局',
  }

  // #1 — 4-leg Marquee Week: anchor failure (3 win, 1 loss → overall lose)
  const fourLeg = {
    id: 'demo_inv_marquee_4leg',
    created_at: dateIso,
    parlay_size: 4,
    inputs: 6,
    suggested_amount: 6,
    expected_rating: 0.60,
    combined_odds: roundOdds(2.45 * 1.85 * 2.80 * 2.20),
    status: 'lose',
    revenues: 0,
    profit: -6,
    actual_rating: round2((0.66 + 0.72 + 0.22 + 0.70) / 4),
    rep: 1.4,
    remarks: '四中三 · 巴萨翻车导致全军覆没 · 锚定失败典型案例',
    matches: [
      makeMarqueeMatch('4leg_m1', MARQUEE_FIXTURES.arsenalLiverpool, arsenalLiverpoolOutcome),
      makeMarqueeMatch('4leg_m2', MARQUEE_FIXTURES.mancityChelsea, mancityChelseaOutcome),
      makeMarqueeMatch('4leg_m3', MARQUEE_FIXTURES.barcaReal, barcaRealOutcome),
      makeMarqueeMatch('4leg_m4', MARQUEE_FIXTURES.bayernPsg, bayernPsgOutcome),
    ],
  }

  // #2 — 2-leg English: both hit → win
  const englishWinPnL = roundOdds(12 * (2.45 * 1.85) - 12)
  const twoLegEnglish = {
    id: 'demo_inv_marquee_2leg_eng',
    created_at: dateIso,
    parlay_size: 2,
    inputs: 12,
    suggested_amount: 12,
    expected_rating: 0.63,
    combined_odds: roundOdds(2.45 * 1.85),
    status: 'win',
    revenues: roundOdds(12 * 2.45 * 1.85),
    profit: englishWinPnL,
    actual_rating: 0.69,
    rep: null,
    remarks: '英超双串完美收割 · 主场优势叠加',
    matches: [
      makeMarqueeMatch('2leg_eng_m1', MARQUEE_FIXTURES.arsenalLiverpool, arsenalLiverpoolOutcome),
      makeMarqueeMatch('2leg_eng_m2', MARQUEE_FIXTURES.mancityChelsea, mancityChelseaOutcome),
    ],
  }

  // #3 — 2-leg Continental: 1 win 1 lose → overall lose
  const twoLegContinental = {
    id: 'demo_inv_marquee_2leg_eu',
    created_at: dateIso,
    parlay_size: 2,
    inputs: 8,
    suggested_amount: 8,
    expected_rating: 0.57,
    combined_odds: roundOdds(2.80 * 2.20),
    status: 'lose',
    revenues: 0,
    profit: -8,
    actual_rating: round2((0.22 + 0.70) / 2),
    rep: 1.4,
    remarks: '欧陆经典 · 拜仁赢球 / 巴萨被绝杀 · 串联失败',
    matches: [
      makeMarqueeMatch('2leg_eu_m1', MARQUEE_FIXTURES.barcaReal, barcaRealOutcome),
      makeMarqueeMatch('2leg_eu_m2', MARQUEE_FIXTURES.bayernPsg, bayernPsgOutcome),
    ],
  }

  return [fourLeg, twoLegEnglish, twoLegContinental]
}

// ── Pending marquee bundles (Settle + Portfolio candidates) ────────
// Exactly three fresh pending parlays for the "next gameweek":
//   #1 — a 4-leg combo (the four marquee fixtures)
//   #2 — a 2-leg English combo
//   #3 — a 2-leg Continental combo
// These three bundles are what Settle shows (3 rows, first expanded
// by default) and they flatten into ComboPage's candidate leg pool
// (8 distinct matches). They are tagged __demo_seed_pending so the
// HistoryPage filters them out in preview — they belong in Portfolio
// + Settle, not pre-populated History. Everything is ephemeral
// (previewStore only) and identical on every visit.
const buildPendingPresets = () => {
  const pendingOutcome = {
    results: '', isCorrect: null, matchRating: 0, matchRep: null, postNote: '',
  }

  // The 4-leg gets the earliest timestamp so it sorts first in Settle
  // (which default-expands the first pending row).
  const buildBundle = (id, idPrefix, fixtures, suggested, dateIso, remarks) => {
    const combinedOdds = roundOdds(fixtures.reduce((acc, f) => acc * f.odds, 1))
    const avgConf = round2(fixtures.reduce((acc, f) => acc + f.conf, 0) / fixtures.length)
    return {
      id,
      created_at: dateIso,
      parlay_size: fixtures.length,
      inputs: suggested,
      suggested_amount: suggested,
      expected_rating: round2(avgConf * 0.92),
      combined_odds: combinedOdds,
      status: 'pending',
      revenues: 0,
      profit: 0,
      actual_rating: 0,
      rep: null,
      remarks,
      __demo_seed_pending: true,
      matches: fixtures.map((f, i) => makeMarqueeMatch(`${idPrefix}_m${i + 1}`, f, pendingOutcome)),
    }
  }

  return [
    buildBundle(
      'demo_inv_pending_4leg',
      'pending_4leg',
      [
        MARQUEE_FIXTURES.arsenalLiverpool,
        MARQUEE_FIXTURES.mancityChelsea,
        MARQUEE_FIXTURES.barcaReal,
        MARQUEE_FIXTURES.bayernPsg,
      ],
      8,
      '2026-01-04T19:00:00.000Z',
      '本周主推四串 · 英超双德比叠加欧陆豪门',
    ),
    buildBundle(
      'demo_inv_pending_2leg_eng',
      'pending_2leg_eng',
      [MARQUEE_FIXTURES.manutdEverton, MARQUEE_FIXTURES.leedsNottingham],
      12,
      '2026-01-04T20:00:00.000Z',
      '英超双串 · 主场稳态组合',
    ),
    buildBundle(
      'demo_inv_pending_2leg_eu',
      'pending_2leg_eu',
      [MARQUEE_FIXTURES.milanInter, MARQUEE_FIXTURES.dortmundLeverkusen],
      10,
      '2026-01-04T21:00:00.000Z',
      '欧陆双串 · 德比 + 德甲攻防对决',
    ),
  ]
}

// ── Top-level bundle builder ───────────────────────────────────────
const TOTAL_GENERATED = 72 // + 3 showcase + 3 settled marquee + 3 pending bundles = 81 total

const buildBundle = () => {
  // Generate evenly-spaced timestamps across the window with slight jitter.
  const investments = []
  for (let i = 0; i < TOTAL_GENERATED; i++) {
    const baseFraction = i / TOTAL_GENERATED
    const jitter = randRange(-0.012, 0.012)
    const ts = START_TS + (END_TS - START_TS) * (baseFraction + jitter)
    const dateIso = new Date(ts).toISOString()
    investments.push(buildInvestment(i + 1, dateIso))
  }

  // Inject showcase samples (their hardcoded created_at already places
  // them in the right chronological slot).
  investments.push(...buildShowcaseSamples())

  // Inject settled marquee bundles — Arsenal-Liverpool / Man City-
  // Chelsea / Barca-Real / Bayern-PSG fixtures with realistic results,
  // including the 4-leg anchor-failure showcase.
  investments.push(...buildMarqueeSettled())

  // Inject the three pending bundles for the next gameweek — these
  // become the three Settle rows (4-leg first, then two 2-legs) and
  // flatten into ComboPage's candidate leg pool.
  investments.push(...buildPendingPresets())

  // Sort chronologically.
  investments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  // Re-stripe IDs after sort for clean sequential ordering in the UI.
  investments.forEach((inv, idx) => {
    inv.id = `demo_inv_${String(idx + 1).padStart(3, '0')}`
    if (Array.isArray(inv.matches)) {
      inv.matches.forEach((m, mIdx) => {
        m.id = `${inv.id}_m${mIdx + 1}`
      })
    }
  })

  // Derive team profiles from the actual investments — totalSamples
  // counts how often a team appears across all matches.
  const teamCounters = new Map()
  const teamRepSums = new Map()
  const teamRepCounts = new Map()
  investments.forEach((inv) => {
    inv.matches.forEach((m) => {
      ;[m.home_team, m.away_team].forEach((name) => {
        teamCounters.set(name, (teamCounters.get(name) || 0) + 1)
        if (m.match_rep) {
          teamRepSums.set(name, (teamRepSums.get(name) || 0) + m.match_rep)
          teamRepCounts.set(name, (teamRepCounts.get(name) || 0) + 1)
        }
      })
    })
  })

  const teamProfiles = TEAMS.map((t) => {
    const samples = teamCounters.get(t.name) || 0
    const repSum = teamRepSums.get(t.name) || 0
    const repCount = teamRepCounts.get(t.name) || 0
    return {
      teamId: t.id,
      teamName: t.name,
      abbreviations: [t.abbr, t.name.toLowerCase()],
      totalSamples: samples,
      avgRep: repCount > 0 ? round2(repSum / repCount) : 0.4,
    }
  })

  return { investments, teamProfiles }
}

// ── Memoised exports ───────────────────────────────────────────────
let bundleCache = null
const ensureBundle = () => {
  if (bundleCache == null) bundleCache = buildBundle()
  return bundleCache
}

export const getDemoInvestments = () => {
  const { investments } = ensureBundle()
  return JSON.parse(JSON.stringify(investments))
}

export const getDemoTeamProfiles = () => {
  const { teamProfiles } = ensureBundle()
  return JSON.parse(JSON.stringify(teamProfiles))
}

export const getDemoSystemConfig = () => ({
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
  capitalInjections: [],
  adaptiveWeights: {
    enabled: false,
    mode: 'suggest',
    minSamples: 50,
    learningRate: 0.05,
    maxSingleChange: 0.02,
    priorStrength: 0.1,
    updateEveryN: 5,
    lastUpdateAt: '',
    updateCount: 0,
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
  pageAmbientThemes: {},
  __demo: true,
})

export const getDemoAccessLogs = () => []

export const DEMO_BUNDLE_REVISION = `step4-curated-v1-${SEED.toString(36)}`

// Diagnostic helper — exposed for the console so the user can sanity
// check the generated distribution while crafting the bundle.
export const getDemoBundleDiagnostics = () => {
  const { investments } = ensureBundle()
  const total = investments.length
  const wins = investments.filter((i) => i.status === 'win').length
  const settled = investments.filter((i) => i.status === 'win' || i.status === 'lose').length
  const profit = investments.reduce((acc, i) => acc + (i.profit || 0), 0)
  const totalStaked = investments.reduce((acc, i) => acc + (i.inputs || 0), 0)
  return {
    total,
    settled,
    wins,
    hitRate: settled > 0 ? round2(wins / settled) : 0,
    totalStaked: round2(totalStaked),
    totalProfit: round2(profit),
    roi: totalStaked > 0 ? round2(profit / totalStaked) : 0,
    parlaySizeDist: investments.reduce((acc, i) => {
      acc[i.parlay_size] = (acc[i.parlay_size] || 0) + 1
      return acc
    }, {}),
  }
}

// Marker key for downstream identification (e.g. analytics caches).
export { STORAGE_KEYS as DEMO_STORAGE_KEYS }
