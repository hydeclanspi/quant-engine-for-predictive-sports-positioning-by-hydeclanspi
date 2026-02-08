const ENTRY_MARKET_META = {
  score: { label: '比分', rank: 1 },
  half_full: { label: '半全场', rank: 2 },
  handicap: { label: '让球', rank: 3 },
  total: { label: '大小球', rank: 4 },
  result: { label: '赛果', rank: 5 },
  other: { label: '其他', rank: 99 },
}

const OUTCOME_TOKEN_GROUPS = {
  win: ['w', 'win', 'home', 'homewin', 'h', '主胜', '主', '胜'],
  draw: ['d', 'draw', 'x', '平', '平局'],
  lose: ['l', 'lose', 'away', 'awaywin', 'a', '客胜', '客', '负'],
}

const TOTAL_DIRECTION_GROUPS = {
  over: ['over', 'o', '大', '大球'],
  under: ['under', 'u', '小', '小球'],
}

const OUTCOME_TOKEN_MAP = Object.entries(OUTCOME_TOKEN_GROUPS).reduce((acc, [outcome, tokens]) => {
  tokens.forEach((token) => {
    acc.set(String(token).trim().toLowerCase(), outcome)
  })
  return acc
}, new Map())

const TOTAL_DIRECTION_MAP = Object.entries(TOTAL_DIRECTION_GROUPS).reduce((acc, [direction, tokens]) => {
  tokens.forEach((token) => {
    acc.set(String(token).trim().toLowerCase(), direction)
  })
  return acc
}, new Map())

const getMarketMeta = (marketType) => ENTRY_MARKET_META[marketType] || ENTRY_MARKET_META.other

const normalizeToken = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')

const parseOutcomeToken = (value) => OUTCOME_TOKEN_MAP.get(normalizeToken(value)) || null

const parseTotalDirection = (value) => TOTAL_DIRECTION_MAP.get(normalizeToken(value)) || null

const toNumber = (value, fallback = Number.NaN) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const buildSemanticResult = (name, marketType, semanticKey = '', detail = null) => ({
  name,
  marketType,
  marketLabel: getMarketMeta(marketType).label,
  semanticKey,
  detail,
})

export const normalizeEntryName = (value) =>
  String(value || '')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/。/g, '.')
    .replace(/：/g, ':')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–－﹣−]/g, '-')
    .replace(/[／]/g, '/')
    .replace(/　/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;，；\s]+|[,;，；\s]+$/g, '')
    .trim()

const parseScoreEntry = (value) => {
  const match = String(value || '').match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/)
  if (!match) return null
  const home = Number.parseInt(match[1], 10)
  const away = Number.parseInt(match[2], 10)
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return {
    semanticKey: `${home}-${away}`,
    detail: { home, away },
  }
}

const parseHalfFullEntry = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return null

  const dashed = raw
    .replace(/[\/|>→]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .trim()
  const dashedMatch = dashed.match(/^([a-zA-Z\u4e00-\u9fa5]+)-([a-zA-Z\u4e00-\u9fa5]+)$/)
  if (dashedMatch) {
    const half = parseOutcomeToken(dashedMatch[1])
    const full = parseOutcomeToken(dashedMatch[2])
    if (half && full) {
      return {
        semanticKey: `${half}-${full}`,
        detail: { half, full },
      }
    }
  }

  const spaced = raw.split(/\s+/).filter(Boolean)
  if (spaced.length === 2) {
    const half = parseOutcomeToken(spaced[0])
    const full = parseOutcomeToken(spaced[1])
    if (half && full) {
      return {
        semanticKey: `${half}-${full}`,
        detail: { half, full },
      }
    }
  }

  const compact = dashed.replace(/-/g, '')
  if (/^[wdl]{2}$/i.test(compact)) {
    const half = parseOutcomeToken(compact.slice(0, 1))
    const full = parseOutcomeToken(compact.slice(1, 2))
    if (half && full) {
      return {
        semanticKey: `${half}-${full}`,
        detail: { half, full },
      }
    }
  }

  if (/^[胜平负]{2}$/.test(compact)) {
    const half = parseOutcomeToken(compact.slice(0, 1))
    const full = parseOutcomeToken(compact.slice(1, 2))
    if (half && full) {
      return {
        semanticKey: `${half}-${full}`,
        detail: { half, full },
      }
    }
  }

  const compactLower = compact.toLowerCase()
  const words = ['win', 'draw', 'lose']
  for (let i = 0; i < words.length; i += 1) {
    for (let j = 0; j < words.length; j += 1) {
      const left = words[i]
      const right = words[j]
      if (compactLower === `${left}${right}`) {
        return {
          semanticKey: `${left}-${right}`,
          detail: { half: left, full: right },
        }
      }
    }
  }

  return null
}

const parseHandicapEntry = (value) => {
  const candidate = String(value || '')
    .replace(/[()]/g, ' ')
    .replace(/让球?/g, ' ')
    .replace(/([+-])\s+(\d)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!candidate) return null

  const leadingNumber = candidate.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]+)$/)
  if (leadingNumber) {
    const line = toNumber(leadingNumber[1], Number.NaN)
    const outcome = parseOutcomeToken(leadingNumber[2])
    if (Number.isFinite(line) && outcome) {
      return {
        semanticKey: `${line}:${outcome}`,
        detail: { line, outcome },
      }
    }
  }

  const trailingNumber = candidate.match(/^([a-zA-Z\u4e00-\u9fa5]+)\s*([+-]?\d+(?:\.\d+)?)$/)
  if (trailingNumber) {
    const outcome = parseOutcomeToken(trailingNumber[1])
    const line = toNumber(trailingNumber[2], Number.NaN)
    if (Number.isFinite(line) && outcome) {
      return {
        semanticKey: `${line}:${outcome}`,
        detail: { line, outcome },
      }
    }
  }

  return null
}

const parseTotalEntry = (value) => {
  const compact = String(value || '')
    .trim()
    .replace(/\s+/g, '')
  if (!compact) return null

  const leadingDirection = compact.match(/^(over|under|o|u|大|小)(\d+(?:\.\d+)?)$/i)
  if (leadingDirection) {
    const direction = parseTotalDirection(leadingDirection[1])
    const line = toNumber(leadingDirection[2], Number.NaN)
    if (direction && Number.isFinite(line)) {
      return {
        semanticKey: `${direction}:${line}`,
        detail: { direction, line },
      }
    }
  }

  const trailingDirection = compact.match(/^(\d+(?:\.\d+)?)(over|under|o|u|大|小)$/i)
  if (trailingDirection) {
    const line = toNumber(trailingDirection[1], Number.NaN)
    const direction = parseTotalDirection(trailingDirection[2])
    if (direction && Number.isFinite(line)) {
      return {
        semanticKey: `${direction}:${line}`,
        detail: { direction, line },
      }
    }
  }

  return null
}

const parseResultEntry = (value) => {
  const outcome = parseOutcomeToken(value)
  if (!outcome) return null
  return {
    semanticKey: outcome,
    detail: { outcome },
  }
}

export const parseEntrySemantic = (value) => {
  const name = normalizeEntryName(value)
  if (!name) return buildSemanticResult('', 'other', '', null)

  const score = parseScoreEntry(name)
  if (score) return buildSemanticResult(name, 'score', score.semanticKey, score.detail)

  const halfFull = parseHalfFullEntry(name)
  if (halfFull) return buildSemanticResult(name, 'half_full', halfFull.semanticKey, halfFull.detail)

  const handicap = parseHandicapEntry(name)
  if (handicap) return buildSemanticResult(name, 'handicap', handicap.semanticKey, handicap.detail)

  const total = parseTotalEntry(name)
  if (total) return buildSemanticResult(name, 'total', total.semanticKey, total.detail)

  const result = parseResultEntry(name)
  if (result) return buildSemanticResult(name, 'result', result.semanticKey, result.detail)

  return buildSemanticResult(name, 'other', normalizeToken(name), null)
}

export const normalizeEntryRecord = (entryInput, fallbackOdds = Number.NaN) => {
  const source =
    entryInput && typeof entryInput === 'object'
      ? { ...entryInput }
      : {
          name: entryInput,
        }
  const semantic = parseEntrySemantic(source.name || source.entry || '')
  const odds = toNumber(source.odds, toNumber(fallbackOdds, Number.NaN))

  return {
    ...source,
    name: semantic.name,
    odds,
    market_type: semantic.marketType,
    market_label: semantic.marketLabel,
    semantic_key: semantic.semanticKey,
    parse_detail: semantic.detail,
  }
}

export const normalizeEntries = (entriesInput, entryText = '', fallbackOdds = Number.NaN) => {
  if (Array.isArray(entriesInput) && entriesInput.length > 0) {
    return entriesInput
      .map((entry) => normalizeEntryRecord(entry, fallbackOdds))
      .filter((entry) => entry.name)
  }

  const rawText = normalizeEntryName(entryText)
  if (!rawText) return []
  return rawText
    .split(/[|,]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((name) => normalizeEntryRecord({ name, odds: fallbackOdds }, fallbackOdds))
    .filter((entry) => entry.name)
}

export const getPrimaryEntryMarket = (entriesInput, entryText = '') => {
  const entries = normalizeEntries(entriesInput, entryText)
  if (entries.length === 0) {
    return {
      marketType: 'other',
      marketLabel: getMarketMeta('other').label,
      semanticKey: '',
    }
  }

  const counts = new Map()
  entries.forEach((entry, index) => {
    const marketType = String(entry.market_type || '').trim() || 'other'
    if (!counts.has(marketType)) {
      counts.set(marketType, {
        count: 0,
        rank: getMarketMeta(marketType).rank,
        firstIndex: index,
      })
    }
    counts.get(marketType).count += 1
  })

  const best = [...counts.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count
    if (a[1].rank !== b[1].rank) return a[1].rank - b[1].rank
    return a[1].firstIndex - b[1].firstIndex
  })[0]

  const marketType = best ? best[0] : 'other'
  const firstEntry = entries.find((entry) => (entry.market_type || 'other') === marketType) || entries[0]

  return {
    marketType,
    marketLabel: getMarketMeta(marketType).label,
    semanticKey: firstEntry?.semantic_key || '',
  }
}
