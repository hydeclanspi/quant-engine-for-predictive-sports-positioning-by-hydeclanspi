/**
 * Natural Input Parser — rule-based NL understanding for match quick-entry.
 *
 * Accepts free text like:
 *   "伯恩茅斯胜/平曼联，conf3.5，odds8.1，FSE0.9"
 *   "arsenal W, chelsea D, conf 55 60, odds 1.8 3.2"
 *   "热刺胜/平 赌一把 odds4.5 conf35 tys:H fid0.75"
 *
 * Returns an array of match drafts compatible with createEmptyMatch().
 */

import { getTeamDirectoryProfiles } from './localData'
import { parseEntrySemantic, normalizeEntryName } from './entryParsing'

/* ── Constants ────────────────────────────────────────────────────────── */

const MODE_OPTIONS_SORTED = [
  '常规-稳', '常规-杠杆', '常规-激进', '半彩票半保险', '保险产品', '赌一把', '常规',
]
const MODE_ALIASES = new Map([
  ['stable', '常规-稳'], ['稳', '常规-稳'],
  ['leverage', '常规-杠杆'], ['杠杆', '常规-杠杆'],
  ['gamble', '赌一把'], ['赌', '赌一把'],
  ['insurance', '保险产品'], ['保险', '保险产品'],
  ['half', '半彩票半保险'],
])

const TYS_SET = new Set(['S', 'M', 'L', 'H'])

const FID_OPTIONS = [0, 0.25, 0.4, 0.5, 0.6, 0.75]
const snapFid = (v) => {
  let best = '0.4'
  let bestDist = Infinity
  for (const opt of FID_OPTIONS) {
    const d = Math.abs(v - opt)
    if (d < bestDist) { bestDist = d; best = String(opt) }
  }
  return best
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/* ── Stage 1: Normalize ───────────────────────────────────────────────── */

const normalize = (text) =>
  String(text || '')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/。/g, '.')
    .replace(/：/g, ':')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/[／]/g, '/')
    .replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/[—–－﹣−]/g, '-')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/* ── Stage 2: Extract parameters ──────────────────────────────────────── */

const normalizeConfValue = (raw) => {
  const num = Number.parseFloat(raw)
  if (!Number.isFinite(num) || num < 0) return null
  if (num <= 1.0) return { value: Math.round(num * 100), warning: null }
  if (num >= 10 && num <= 100) return { value: Math.round(num), warning: null }
  // 1 < num < 10 — ambiguous range. "3.5" → treat as 0.35 → 35
  const reconstructed = Math.round(num * 10)
  if (reconstructed >= 10 && reconstructed <= 95) {
    return { value: reconstructed, warning: `conf${raw} → ${reconstructed}%` }
  }
  return { value: Math.round(num), warning: `conf${raw} 含义模糊` }
}

const normalizeFseValue = (raw) => {
  const num = Number.parseFloat(raw)
  if (!Number.isFinite(num) || num < 0) return null
  if (num <= 1.0) return Math.round(num * 100)
  if (num <= 100) return Math.round(num)
  return null
}

const extractParameters = (text) => {
  const params = { conf: [], odds: [], fse: [], fid: [], tys: [], mode: null }
  const warnings = []
  let cleaned = text

  // Mode — check longest first
  for (const mode of MODE_OPTIONS_SORTED) {
    const idx = cleaned.toLowerCase().indexOf(mode.toLowerCase())
    if (idx !== -1) {
      params.mode = mode
      cleaned = cleaned.slice(0, idx) + ' ' + cleaned.slice(idx + mode.length)
      break
    }
  }
  if (!params.mode) {
    for (const [alias, mode] of MODE_ALIASES) {
      const re = new RegExp(`\\b${alias}\\b`, 'i')
      if (re.test(cleaned)) {
        params.mode = mode
        cleaned = cleaned.replace(re, ' ')
        break
      }
    }
  }

  // Keyword-value pairs: conf, odds, fse, fid
  // Match keyword + optional separator + first number, then greedily consume trailing bare numbers
  const kvPatterns = [
    { key: 'conf', re: /\bconf[:\s]*(\d+(?:\.\d+)?)/gi },
    { key: 'odds', re: /\bodds[:\s]*(\d+(?:\.\d+)?)/gi },
    { key: 'fse',  re: /\bfse[:\s]*(\d+(?:\.\d+)?)/gi },
    { key: 'fid',  re: /\bfid[:\s]*(\d+(?:\.\d+)?)/gi },
  ]

  for (const { key, re } of kvPatterns) {
    let m
    while ((m = re.exec(cleaned)) !== null) {
      const values = [m[1]]
      // Look ahead for trailing bare numbers separated by spaces/commas
      const afterPos = m.index + m[0].length
      const afterText = cleaned.slice(afterPos)
      const trailingMatch = afterText.match(/^[\s,]*(\d+(?:\.\d+)?)(?:[\s,]+(\d+(?:\.\d+)?))?(?:[\s,]+(\d+(?:\.\d+)?))?(?:[\s,]+(\d+(?:\.\d+)?))?/)
      if (trailingMatch) {
        for (let i = 1; i <= 4; i++) {
          if (trailingMatch[i]) values.push(trailingMatch[i])
        }
      }

      if (key === 'conf') {
        for (const v of values) {
          const parsed = normalizeConfValue(v)
          if (parsed) {
            params.conf.push(parsed.value)
            if (parsed.warning) warnings.push(parsed.warning)
          }
        }
      } else if (key === 'odds') {
        for (const v of values) {
          const n = Number.parseFloat(v)
          if (Number.isFinite(n) && n > 1) params.odds.push(n)
        }
      } else if (key === 'fse') {
        for (const v of values) {
          const n = normalizeFseValue(v)
          if (n !== null) params.fse.push(n)
        }
      } else if (key === 'fid') {
        for (const v of values) {
          const n = Number.parseFloat(v)
          if (Number.isFinite(n)) params.fid.push(snapFid(n))
        }
      }
    }

    // Strip all matched keyword spans (including trailing numbers) from cleaned text
    cleaned = cleaned.replace(new RegExp(`\\b${key}[:\\s]*[\\d.,\\s]+`, 'gi'), ' ')
  }

  // TYS — pattern tys:H or tys H or tysH
  const tysRe = /\btys[:\s]*([smlhSMLH])\b/gi
  let tysMatch
  while ((tysMatch = tysRe.exec(cleaned)) !== null) {
    const v = tysMatch[1].toUpperCase()
    if (TYS_SET.has(v)) params.tys.push(v)
  }
  cleaned = cleaned.replace(/\btys[:\s]*[smlhSMLH]\b/gi, ' ')

  // Clean up leftover whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return { params, warnings, contentText: cleaned }
}

/* ── Stage 3: Greedy team name scan ───────────────────────────────────── */

let _cachedDict = null
let _cachedDictTimestamp = 0

const buildAliasDictionary = (profiles) => {
  const entries = []
  for (const profile of profiles) {
    const aliases = new Set()
    if (profile.teamName) aliases.add(profile.teamName)
    if (Array.isArray(profile.abbreviations)) {
      for (const a of profile.abbreviations) {
        if (a && a.trim()) aliases.add(a.trim())
      }
    }
    for (const alias of aliases) {
      entries.push({
        alias,
        aliasLower: alias.toLowerCase(),
        len: alias.length,
        teamId: profile.teamId,
        teamName: profile.teamName,
      })
    }
  }
  // Sort by alias length descending — longest match first
  entries.sort((a, b) => b.len - a.len)
  // Dedupe by lowercased alias
  const seen = new Set()
  return entries.filter((e) => {
    if (seen.has(e.aliasLower)) return false
    seen.add(e.aliasLower)
    return true
  })
}

const getAliasDictionary = () => {
  const now = Date.now()
  if (_cachedDict && now - _cachedDictTimestamp < 30000) return _cachedDict
  const profiles = getTeamDirectoryProfiles()
  _cachedDict = buildAliasDictionary(profiles)
  _cachedDictTimestamp = now
  return _cachedDict
}

const isLatinAlphanumeric = (ch) => /[a-zA-Z0-9]/.test(ch)

const isWordBoundary = (text, start, end) => {
  const before = start > 0 ? text[start - 1] : ''
  const after = end < text.length ? text[end] : ''
  const beforeBlocks = !before || !isLatinAlphanumeric(before)
  const afterBlocks = !after || !isLatinAlphanumeric(after)
  return beforeBlocks && afterBlocks
}

const scanTeamNames = (text, dict) => {
  const results = []
  const lower = text.toLowerCase()
  let pos = 0

  while (pos < lower.length) {
    let matched = false
    for (const entry of dict) {
      if (pos + entry.len > lower.length) continue
      if (lower.startsWith(entry.aliasLower, pos)) {
        // Word boundary check for short pure-Latin aliases to avoid "new" matching in "news" etc.
        if (entry.len <= 4 && /^[a-z]+$/i.test(entry.alias)) {
          if (!isWordBoundary(text, pos, pos + entry.len)) continue
        }
        // Multi-word latin aliases need boundary too
        if (/^[a-z\s]+$/i.test(entry.alias) && entry.alias.includes(' ')) {
          if (!isWordBoundary(text, pos, pos + entry.len)) continue
        }
        results.push({
          teamId: entry.teamId,
          teamName: entry.teamName,
          alias: entry.alias,
          start: pos,
          end: pos + entry.len,
        })
        pos += entry.len
        matched = true
        break
      }
    }
    if (!matched) pos++
  }

  return results
}

/* ── Stage 4: Extract residuals & parse entries ───────────────────────── */

const VERSUS_RE = /^(vs|v|对阵|对|-|×)$/i

// Known single-char entry tokens that can stick to a team name
const ENTRY_SINGLE_CHARS = new Set(['胜', '平', '负', '主', '客'])
const ENTRY_TWO_CHARS = ['主胜', '客胜', '平局', '客负']

const parseGapAsEntries = (gapText) => {
  if (!gapText || !gapText.trim()) return { entries: [], isVersus: false, unknown: [] }
  const cleaned = gapText.replace(/^[\s,;.]+|[\s,;.]+$/g, '').trim()
  if (!cleaned) return { entries: [], isVersus: false, unknown: [] }

  if (VERSUS_RE.test(cleaned)) return { entries: [], isVersus: true, unknown: [] }

  // Split on "/" for multi-entry (胜/平)
  const parts = cleaned.split(/[/]/).map((s) => s.trim()).filter(Boolean)
  const entries = []
  const unknown = []

  for (const part of parts) {
    const semantic = parseEntrySemantic(part)
    if (semantic.marketType !== 'other') {
      entries.push({ name: semantic.name, semantic })
    } else {
      unknown.push(part)
    }
  }

  return { entries, isVersus: false, unknown }
}

const extractSegments = (text, teamHits) => {
  const segments = []
  let cursor = 0

  for (const hit of teamHits) {
    if (cursor < hit.start) {
      const gap = text.slice(cursor, hit.start)
      if (gap.trim()) segments.push({ type: 'gap', text: gap.trim(), start: cursor, end: hit.start })
    }
    segments.push({ type: 'team', ...hit })
    cursor = hit.end
  }
  if (cursor < text.length) {
    const gap = text.slice(cursor).trim()
    if (gap) segments.push({ type: 'gap', text: gap, start: cursor, end: text.length })
  }

  return segments
}

/* ── Stage 5: Match segmentation ──────────────────────────────────────── */

const segmentMatches = (segments) => {
  const matches = []
  let i = 0

  while (i < segments.length) {
    const seg = segments[i]

    if (seg.type === 'team') {
      const home = seg
      // Look for gap + team pattern (two teams with entry/versus between them)
      if (i + 2 < segments.length && segments[i + 1].type === 'gap' && segments[i + 2].type === 'team') {
        const gap = parseGapAsEntries(segments[i + 1].text)
        if (gap.entries.length > 0 || gap.isVersus) {
          // Two teams form one match
          const away = segments[i + 2]
          matches.push({
            home: { teamId: home.teamId, teamName: home.teamName, alias: home.alias },
            away: { teamId: away.teamId, teamName: away.teamName, alias: away.alias },
            entries: gap.entries,
            rawEntryText: segments[i + 1].text,
          })
          i += 3
          // Check for trailing entry after the away team
          if (i < segments.length && segments[i].type === 'gap') {
            const trailing = parseGapAsEntries(segments[i].text)
            if (trailing.entries.length > 0 && matches.length > 0) {
              // Add trailing entries to the last match
              const last = matches[matches.length - 1]
              last.entries.push(...trailing.entries)
              last.rawEntryText = (last.rawEntryText || '') + ' ' + segments[i].text
              i++
            }
          }
          continue
        }
      }

      // Look for adjacent gap with entry (single team + entry)
      if (i + 1 < segments.length && segments[i + 1].type === 'gap') {
        const gap = parseGapAsEntries(segments[i + 1].text)
        if (gap.entries.length > 0) {
          // Check if entry implies home/away position
          const firstEntry = gap.entries[0]
          const isAway = firstEntry.semantic?.semanticKey === 'lose' ||
            firstEntry.name === '客胜' || firstEntry.name === '客'

          matches.push({
            home: isAway ? null : { teamId: home.teamId, teamName: home.teamName, alias: home.alias },
            away: isAway ? { teamId: home.teamId, teamName: home.teamName, alias: home.alias } : null,
            entries: gap.entries,
            rawEntryText: segments[i + 1].text,
          })
          i += 2
          continue
        }
      }

      // Bare team, no entry
      matches.push({
        home: { teamId: home.teamId, teamName: home.teamName, alias: home.alias },
        away: null,
        entries: [],
        rawEntryText: '',
      })
      i++
      continue
    }

    if (seg.type === 'gap') {
      // Leading gap before any team — might contain entries for the first team
      // Or stray text. Try to parse entries.
      const gap = parseGapAsEntries(seg.text)
      if (gap.entries.length > 0 && i + 1 < segments.length && segments[i + 1].type === 'team') {
        // Entry before a team — e.g., "主胜 阿森纳" → entry belongs to next team
        const nextTeam = segments[i + 1]
        const firstEntry = gap.entries[0]
        const isAway = firstEntry.semantic?.semanticKey === 'lose' ||
          firstEntry.name === '客胜' || firstEntry.name === '客'
        matches.push({
          home: isAway ? null : { teamId: nextTeam.teamId, teamName: nextTeam.teamName, alias: nextTeam.alias },
          away: isAway ? { teamId: nextTeam.teamId, teamName: nextTeam.teamName, alias: nextTeam.alias } : null,
          entries: gap.entries,
          rawEntryText: seg.text,
        })
        i += 2
        continue
      }
      // Skip unrecognized gap text
      i++
      continue
    }

    i++
  }

  return matches
}

/* ── Stage 6: Assign parameters ───────────────────────────────────────── */

const assignParameters = (matches, params) => {
  const n = matches.length
  if (n === 0) return

  const assignArray = (arr, setter) => {
    if (!arr || arr.length === 0) return
    if (arr.length === 1) {
      // Global — apply to all
      matches.forEach((m) => setter(m, arr[0]))
    } else {
      // Per-match
      matches.forEach((m, i) => {
        if (i < arr.length) setter(m, arr[i])
      })
    }
  }

  assignArray(params.conf, (m, v) => { m.conf = clamp(v, 0, 100) })
  assignArray(params.odds, (m, v) => {
    // Assign odds to the first entry, or create one
    if (m.entries.length > 0) {
      m.entries[0].assignedOdds = v
    } else {
      m.assignedOdds = v
    }
  })
  assignArray(params.fse, (m, v) => { m.fse = clamp(v, 0, 100) })
  assignArray(params.fid, (m, v) => { m.fid = v })
  assignArray(params.tys, (m, v) => { m.tys = v })

  if (params.mode) {
    matches.forEach((m) => { m.mode = params.mode })
  }
}

/* ── Stage 7: Build match drafts ──────────────────────────────────────── */

const buildMatchDraft = (parsed) => {
  const entries = parsed.entries.length > 0
    ? parsed.entries.map((e, i) => ({
        name: e.name || '',
        odds: i === 0
          ? String(e.assignedOdds || parsed.assignedOdds || '')
          : '',
      }))
    : [{ name: '', odds: String(parsed.assignedOdds || '') }]

  return {
    homeTeam: parsed.home?.teamName || '',
    awayTeam: parsed.away?.teamName || '',
    entries,
    conf: parsed.conf ?? 50,
    mode: parsed.mode || '常规',
    tys_home: parsed.tys || 'M',
    tys_away: parsed.tys || 'M',
    fid: parsed.fid || '0.4',
    fse_home: parsed.fse ?? 50,
    fse_away: parsed.fse ?? 50,
    note: '',
    _nlMeta: {
      homeResolution: parsed.home ? { teamId: parsed.home.teamId, alias: parsed.home.alias } : null,
      awayResolution: parsed.away ? { teamId: parsed.away.teamId, alias: parsed.away.alias } : null,
      rawEntryText: parsed.rawEntryText || '',
    },
  }
}

/* ── Stage 8: Diagnostics ─────────────────────────────────────────────── */

const scoreParse = (matches, diagnostics) => {
  if (matches.length === 0) return 0
  let score = 0.3 // base for having at least one match

  const hasTeams = matches.every((m) => m.homeTeam || m.awayTeam)
  if (hasTeams) score += 0.25

  const hasEntries = matches.every((m) => m.entries.some((e) => e.name))
  if (hasEntries) score += 0.2

  const bothTeams = matches.every((m) => m.homeTeam && m.awayTeam)
  if (bothTeams) score += 0.15

  const noWarnings = diagnostics.filter((d) => d.level === 'warning').length === 0
  if (noWarnings) score += 0.1

  return Math.min(1, score)
}

/* ── Main export ──────────────────────────────────────────────────────── */

export const parseNaturalInput = (rawText) => {
  const diagnostics = []
  if (!rawText || !rawText.trim()) {
    return { matches: [], diagnostics: [{ level: 'info', message: '输入为空' }], confidence: 0, rawInput: rawText || '' }
  }

  // Stage 1: Normalize
  const normalized = normalize(rawText)

  // Stage 2: Extract parameters
  const { params, warnings: paramWarnings, contentText } = extractParameters(normalized)
  for (const w of paramWarnings) {
    diagnostics.push({ level: 'warning', message: w })
  }

  // Stage 3: Greedy team scan
  const dict = getAliasDictionary()
  const teamHits = scanTeamNames(contentText, dict)

  if (teamHits.length === 0) {
    diagnostics.push({ level: 'error', message: '未识别到任何球队名称' })
    return { matches: [], diagnostics, confidence: 0, rawInput: rawText }
  }

  // Stage 4: Extract residual segments
  const segments = extractSegments(contentText, teamHits)

  // Stage 5: Segment into matches
  const rawMatches = segmentMatches(segments)

  if (rawMatches.length === 0) {
    diagnostics.push({ level: 'error', message: '无法组合出有效比赛' })
    return { matches: [], diagnostics, confidence: 0.1, rawInput: rawText }
  }

  // Stage 6: Assign parameters
  assignParameters(rawMatches, params)

  // Stage 7: Build drafts
  const matches = rawMatches.map(buildMatchDraft)

  // Stage 8: Diagnostics
  matches.forEach((m, idx) => {
    if (!m.homeTeam && !m.awayTeam) {
      diagnostics.push({ level: 'error', message: `比赛 ${idx + 1}: 缺少球队`, matchIndex: idx })
    } else if (!m.homeTeam || !m.awayTeam) {
      diagnostics.push({ level: 'info', message: `比赛 ${idx + 1}: 仅识别到一支球队 (${m.homeTeam || m.awayTeam})，请补充对手`, matchIndex: idx })
    }
    if (!m.entries.some((e) => e.name)) {
      diagnostics.push({ level: 'info', message: `比赛 ${idx + 1}: 未识别到投注项，请手动填写`, matchIndex: idx })
    }
    if (!m.entries.some((e) => e.odds)) {
      diagnostics.push({ level: 'info', message: `比赛 ${idx + 1}: 缺少赔率`, matchIndex: idx })
    }
  })

  const confidence = scoreParse(matches, diagnostics)

  return { matches, diagnostics, confidence, rawInput: rawText }
}
