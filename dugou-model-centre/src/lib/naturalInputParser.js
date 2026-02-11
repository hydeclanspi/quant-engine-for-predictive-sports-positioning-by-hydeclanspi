/**
 * Natural Input Parser — rule-based NL understanding for match quick-entry.
 *
 * Supported syntax examples:
 *   "伯恩茅斯胜/平曼联 conf3.5 odds8.1 fse0.9"
 *   "ars w che, conf 0.9, 2.32/4.3 odds"
 *   "ars w/-1 d che, conf 0.9, 2.32/4.3 odds"
 *   "热刺胜/平 赌一把 odds4.5 conf35 tys:H fid0.75"
 *   "liv 3-1 mci, tys 0.9, 0.7, fse 0.2/0.4"
 *   "1.32 odds ars w che remark 我觉得必赢"
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

// Single-char / short entry tokens that the team scanner should NOT consume
// These need to be recognized when they sit alone between two teams: "ars w che"
const ENTRY_TOKENS_SHORT = new Set([
  'w', 'd', 'l', 'h', 'a', 'x',
  '胜', '平', '负', '主', '客',
  'win', 'draw', 'lose', 'home', 'away',
  '主胜', '客胜', '平局',
])

/* ── Stage 1: Normalize ───────────────────────────────────────────────── */

const normalizeText = (text) =>
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

/* ── Stage 2: Extract & strip parameters ──────────────────────────────── */

const normalizeConfValue = (raw) => {
  const num = Number.parseFloat(raw)
  if (!Number.isFinite(num) || num < 0) return null
  if (num <= 1.0) return { value: Math.round(num * 100), warning: null }
  if (num >= 10 && num <= 100) return { value: Math.round(num), warning: null }
  // 1 < num < 10 — "3.5" → treat as 0.35 → 35
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

// Split a value-group string like "0.2/0.4" or "0.2,0.4" or "0.2 0.4" into number strings
const splitValueGroup = (str) =>
  String(str || '')
    .split(/[/,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && /^\d+(?:\.\d+)?$/.test(s))

const extractParameters = (text) => {
  const params = {
    conf: [],
    odds: [],          // flat list of odds values
    oddsGroups: [],    // per-match groups, each group is an array (for multi-entry linking)
    fse_home: [],
    fse_away: [],
    fse_global: [],    // when no h/a specified, will be distributed later
    fid: [],
    tys_home: [],
    tys_away: [],
    tys_global: [],
    mode: null,
    remark: '',
  }
  const warnings = []
  let cleaned = text

  // ── Remark / 备注 — grab everything after the keyword ──
  const remarkRe = /\b(?:remark|备注|note)[:\s]*(.*)/i
  const remarkMatch = cleaned.match(remarkRe)
  if (remarkMatch) {
    params.remark = remarkMatch[1].trim()
    cleaned = cleaned.slice(0, remarkMatch.index).trim()
  }

  // ── Mode ──
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

  // ── FSE with home/away ──
  // "fse h 0.8" or "fse home 0.2" or "fsea0.3"
  const fseHRe = /\bfse[\s_-]*(?:h|home|主)[:\s]*(\d+(?:\.\d+)?)/gi
  const fseARe = /\bfse[\s_-]*(?:a|away|客)[:\s]*(\d+(?:\.\d+)?)/gi
  let fseM
  while ((fseM = fseHRe.exec(cleaned)) !== null) {
    const v = normalizeFseValue(fseM[1])
    if (v !== null) params.fse_home.push(v)
  }
  cleaned = cleaned.replace(fseHRe, ' ')
  while ((fseM = fseARe.exec(cleaned)) !== null) {
    const v = normalizeFseValue(fseM[1])
    if (v !== null) params.fse_away.push(v)
  }
  cleaned = cleaned.replace(fseARe, ' ')

  // ── FSE global (no h/a) — supports "fse 0.2/0.4" or "fse 0.2, 0.4" ──
  const fseGlobalRe = /\bfse[:\s]*([\d./,\s]+)/gi
  while ((fseM = fseGlobalRe.exec(cleaned)) !== null) {
    const vals = splitValueGroup(fseM[1])
    for (const v of vals) {
      const n = normalizeFseValue(v)
      if (n !== null) params.fse_global.push(n)
    }
  }
  cleaned = cleaned.replace(/\bfse[:\s]*[\d./,\s]+/gi, ' ')

  // ── TYS with home/away ──
  const tysHRe = /\btys[\s_-]*(?:h|home|主)[:\s]*([smlhSMLH])/gi
  const tysARe = /\btys[\s_-]*(?:a|away|客)[:\s]*([smlhSMLH])/gi
  let tysM
  while ((tysM = tysHRe.exec(cleaned)) !== null) {
    const v = tysM[1].toUpperCase()
    if (TYS_SET.has(v)) params.tys_home.push(v)
  }
  cleaned = cleaned.replace(tysHRe, ' ')
  while ((tysM = tysARe.exec(cleaned)) !== null) {
    const v = tysM[1].toUpperCase()
    if (TYS_SET.has(v)) params.tys_away.push(v)
  }
  cleaned = cleaned.replace(tysARe, ' ')

  // ── TYS global ──
  const tysGlobalRe = /\btys[:\s]*([smlhSMLH])(?:[\s/,]+([smlhSMLH]))?/gi
  while ((tysM = tysGlobalRe.exec(cleaned)) !== null) {
    const v1 = tysM[1].toUpperCase()
    if (TYS_SET.has(v1)) params.tys_global.push(v1)
    if (tysM[2]) {
      const v2 = tysM[2].toUpperCase()
      if (TYS_SET.has(v2)) params.tys_global.push(v2)
    }
  }
  cleaned = cleaned.replace(/\btys[:\s]*[smlhSMLH](?:[\s/,]+[smlhSMLH])?/gi, ' ')

  // ── Conf — both "conf 0.9" and "0.9 conf" ──
  // Forward: conf <values>
  const confFwdRe = /\bconf[:\s]*([\d./,\s]+)/gi
  let cM
  while ((cM = confFwdRe.exec(cleaned)) !== null) {
    for (const v of splitValueGroup(cM[1])) {
      const parsed = normalizeConfValue(v)
      if (parsed) {
        params.conf.push(parsed.value)
        if (parsed.warning) warnings.push(parsed.warning)
      }
    }
  }
  cleaned = cleaned.replace(confFwdRe, ' ')
  // Reverse: <values> conf
  const confRevRe = /([\d./,\s]+)\s*\bconf\b/gi
  while ((cM = confRevRe.exec(cleaned)) !== null) {
    for (const v of splitValueGroup(cM[1])) {
      const parsed = normalizeConfValue(v)
      if (parsed) {
        params.conf.push(parsed.value)
        if (parsed.warning) warnings.push(parsed.warning)
      }
    }
  }
  cleaned = cleaned.replace(confRevRe, ' ')

  // ── Odds — both "odds 2.32/4.3" and "2.32/4.3 odds" and "1.32 odds" ──
  // Forward: odds <values>
  const oddsFwdRe = /\bodds[:\s]*([\d./,\s]+)/gi
  let oM
  while ((oM = oddsFwdRe.exec(cleaned)) !== null) {
    const group = []
    for (const v of splitValueGroup(oM[1])) {
      const n = Number.parseFloat(v)
      if (Number.isFinite(n) && n >= 1) { params.odds.push(n); group.push(n) }
    }
    if (group.length > 0) params.oddsGroups.push(group)
  }
  cleaned = cleaned.replace(oddsFwdRe, ' ')
  // Reverse: <values> odds
  const oddsRevRe = /([\d./,\s]+)\s*\bodds\b/gi
  while ((oM = oddsRevRe.exec(cleaned)) !== null) {
    const group = []
    for (const v of splitValueGroup(oM[1])) {
      const n = Number.parseFloat(v)
      if (Number.isFinite(n) && n >= 1) { params.odds.push(n); group.push(n) }
    }
    if (group.length > 0) params.oddsGroups.push(group)
  }
  cleaned = cleaned.replace(oddsRevRe, ' ')

  // ── FID — "fid 0.6" or "0.6 fid" ──
  const fidFwdRe = /\bfid[:\s]*([\d./,\s]+)/gi
  let fM
  while ((fM = fidFwdRe.exec(cleaned)) !== null) {
    for (const v of splitValueGroup(fM[1])) {
      const n = Number.parseFloat(v)
      if (Number.isFinite(n)) params.fid.push(snapFid(n))
    }
  }
  cleaned = cleaned.replace(fidFwdRe, ' ')
  const fidRevRe = /([\d./,\s]+)\s*\bfid\b/gi
  while ((fM = fidRevRe.exec(cleaned)) !== null) {
    for (const v of splitValueGroup(fM[1])) {
      const n = Number.parseFloat(v)
      if (Number.isFinite(n)) params.fid.push(snapFid(n))
    }
  }
  cleaned = cleaned.replace(fidRevRe, ' ')

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
  entries.sort((a, b) => b.len - a.len)
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
  const beforeOk = !before || !isLatinAlphanumeric(before)
  const afterOk = !after || !isLatinAlphanumeric(after)
  return beforeOk && afterOk
}

const scanTeamNames = (text, dict) => {
  const results = []
  const lower = text.toLowerCase()
  let pos = 0

  while (pos < lower.length) {
    let matched = false
    for (const entry of dict) {
      if (pos + entry.len > lower.length) continue
      if (!lower.startsWith(entry.aliasLower, pos)) continue

      // Skip if this "alias" is actually an entry token (single-char like w/d/l)
      if (ENTRY_TOKENS_SHORT.has(entry.aliasLower)) continue

      // Word boundary for short Latin aliases
      if (entry.len <= 4 && /^[a-z]+$/i.test(entry.alias)) {
        if (!isWordBoundary(text, pos, pos + entry.len)) continue
      }
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
    if (!matched) pos++
  }

  return results
}

/* ── Stage 4: Extract residuals & parse entries ───────────────────────── */

const VERSUS_RE = /^(vs|v|对阵|对|×)$/i

const SHORT_OUTCOME_TOKEN_MAP = new Map([
  ['w', 'win'],
  ['h', 'win'],
  ['home', 'win'],
  ['win', 'win'],
  ['d', 'draw'],
  ['x', 'draw'],
  ['draw', 'draw'],
  ['l', 'lose'],
  ['a', 'lose'],
  ['away', 'lose'],
  ['lose', 'lose'],
])

const getCanonicalEntryName = (rawToken, semantic) => {
  if (!semantic || semantic.marketType !== 'result') return semantic?.name || String(rawToken || '')
  const key = String(rawToken || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  const mapped = SHORT_OUTCOME_TOKEN_MAP.get(key)
  if (mapped) return mapped
  if (semantic.semanticKey === 'win') return 'win'
  if (semantic.semanticKey === 'draw') return 'draw'
  if (semantic.semanticKey === 'lose') return 'lose'
  return semantic.name || String(rawToken || '')
}

const parseGapAsEntries = (gapText) => {
  if (!gapText || !gapText.trim()) return { entries: [], isVersus: false, unknown: [] }
  const cleaned = gapText.replace(/^[\s,;.]+|[\s,;.]+$/g, '').trim()
  if (!cleaned) return { entries: [], isVersus: false, unknown: [] }

  if (VERSUS_RE.test(cleaned)) return { entries: [], isVersus: true, unknown: [] }

  // Split on "/" for multi-entry (胜/平, w/d, w/-1 d)
  // But also handle space-separated tokens: "w d" → two entries
  // Strategy: first split on "/" then split each part on spaces
  const slashParts = cleaned.split(/\//).map((s) => s.trim()).filter(Boolean)
  const entries = []
  const unknown = []

  for (const part of slashParts) {
    // Each slash-part might contain space-separated tokens: "-1 d" → one handicap entry
    // Try the whole part first
    const semantic = parseEntrySemantic(part)
    if (semantic.marketType !== 'other') {
      entries.push({ name: getCanonicalEntryName(part, semantic), semantic })
      continue
    }
    // Try splitting on spaces
    const spaceParts = part.split(/\s+/).filter(Boolean)
    let anyParsed = false
    for (const sp of spaceParts) {
      const sem = parseEntrySemantic(sp)
      if (sem.marketType !== 'other') {
        entries.push({ name: getCanonicalEntryName(sp, sem), semantic: sem })
        anyParsed = true
      } else {
        unknown.push(sp)
      }
    }
    if (!anyParsed && spaceParts.length > 0) {
      // None parsed individually either
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
      // Look for gap + team (two teams with entry/versus between)
      if (i + 2 < segments.length && segments[i + 1].type === 'gap' && segments[i + 2].type === 'team') {
        const gap = parseGapAsEntries(segments[i + 1].text)
        if (gap.entries.length > 0 || gap.isVersus) {
          const away = segments[i + 2]
          const match = {
            home: { teamId: home.teamId, teamName: home.teamName, alias: home.alias },
            away: { teamId: away.teamId, teamName: away.teamName, alias: away.alias },
            entries: gap.entries,
            rawEntryText: segments[i + 1].text,
          }
          i += 3
          // trailing entry after away team
          if (i < segments.length && segments[i].type === 'gap') {
            const trailing = parseGapAsEntries(segments[i].text)
            if (trailing.entries.length > 0) {
              match.entries.push(...trailing.entries)
              match.rawEntryText = (match.rawEntryText || '') + ' ' + segments[i].text
              i++
            }
          }
          matches.push(match)
          continue
        }
      }

      // Team immediately followed by another team (no gap) — "ars che" → one match
      if (i + 1 < segments.length && segments[i + 1].type === 'team') {
        const away = segments[i + 1]
        matches.push({
          home: { teamId: home.teamId, teamName: home.teamName, alias: home.alias },
          away: { teamId: away.teamId, teamName: away.teamName, alias: away.alias },
          entries: [],
          rawEntryText: '',
        })
        i += 2
        continue
      }

      // Single team + trailing gap with entry
      if (i + 1 < segments.length && segments[i + 1].type === 'gap') {
        const gap = parseGapAsEntries(segments[i + 1].text)
        if (gap.entries.length > 0) {
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

      // Bare team
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
      const gap = parseGapAsEntries(seg.text)
      if (gap.entries.length > 0 && i + 1 < segments.length && segments[i + 1].type === 'team') {
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

  // Helper: assign single-value or per-match array
  const assignSimple = (arr, setter) => {
    if (!arr || arr.length === 0) return
    if (arr.length === 1) {
      matches.forEach((m) => setter(m, arr[0]))
    } else {
      matches.forEach((m, i) => { if (i < arr.length) setter(m, arr[i]) })
    }
  }

  // ── Conf ──
  assignSimple(params.conf, (m, v) => { m.conf = clamp(v, 0, 100) })

  // ── FID ──
  assignSimple(params.fid, (m, v) => { m.fid = v })

  // ── Mode ──
  if (params.mode) {
    matches.forEach((m) => { m.mode = params.mode })
  }

  // ── Remark ──
  if (params.remark) {
    matches.forEach((m) => { m.remark = params.remark })
  }

  // ── FSE (home/away aware) ──
  // Priority: explicit h/a > global paired values
  if (params.fse_home.length > 0 || params.fse_away.length > 0) {
    assignSimple(params.fse_home, (m, v) => { m.fse_home = clamp(v, 0, 100) })
    assignSimple(params.fse_away, (m, v) => { m.fse_away = clamp(v, 0, 100) })
  } else if (params.fse_global.length > 0) {
    // If 2 values per match → first=home, second=away
    // If 2 values total and 1 match → [home, away]
    // If 1 value total → apply to both
    const fg = params.fse_global
    if (fg.length === 1) {
      matches.forEach((m) => { m.fse_home = clamp(fg[0], 0, 100); m.fse_away = clamp(fg[0], 0, 100) })
    } else if (fg.length === 2 && n === 1) {
      // 2 values, 1 match → home/away
      matches[0].fse_home = clamp(fg[0], 0, 100)
      matches[0].fse_away = clamp(fg[1], 0, 100)
    } else if (fg.length === n * 2) {
      // Exactly 2 per match
      matches.forEach((m, i) => {
        m.fse_home = clamp(fg[i * 2], 0, 100)
        m.fse_away = clamp(fg[i * 2 + 1], 0, 100)
      })
    } else if (fg.length >= 2 && fg.length % 2 === 0) {
      // Even number, pair them up
      const pairs = Math.min(Math.floor(fg.length / 2), n)
      for (let i = 0; i < pairs; i++) {
        matches[i].fse_home = clamp(fg[i * 2], 0, 100)
        matches[i].fse_away = clamp(fg[i * 2 + 1], 0, 100)
      }
    } else {
      // Odd or unmatched — apply each to both sides per match
      assignSimple(fg, (m, v) => { m.fse_home = clamp(v, 0, 100); m.fse_away = clamp(v, 0, 100) })
    }
  }

  // ── TYS (home/away aware) ──
  if (params.tys_home.length > 0 || params.tys_away.length > 0) {
    assignSimple(params.tys_home, (m, v) => { m.tys_home = v })
    assignSimple(params.tys_away, (m, v) => { m.tys_away = v })
  } else if (params.tys_global.length > 0) {
    const tg = params.tys_global
    if (tg.length === 1) {
      matches.forEach((m) => { m.tys_home = tg[0]; m.tys_away = tg[0] })
    } else if (tg.length === 2 && n === 1) {
      matches[0].tys_home = tg[0]
      matches[0].tys_away = tg[1]
    } else if (tg.length === n * 2) {
      matches.forEach((m, i) => {
        m.tys_home = tg[i * 2]
        m.tys_away = tg[i * 2 + 1]
      })
    } else if (tg.length >= 2 && tg.length % 2 === 0) {
      const pairs = Math.min(Math.floor(tg.length / 2), n)
      for (let i = 0; i < pairs; i++) {
        matches[i].tys_home = tg[i * 2]
        matches[i].tys_away = tg[i * 2 + 1]
      }
    } else {
      assignSimple(tg, (m, v) => { m.tys_home = v; m.tys_away = v })
    }
  }

  // ── Odds — link to entries per-match ──
  // oddsGroups contains parsed groups. If a group has N values and the match has N entries,
  // link them 1:1. Otherwise fall back to assigning first odds to first entry.
  if (params.oddsGroups.length > 0) {
    // Distribute groups to matches
    const groups = params.oddsGroups
    matches.forEach((m, mi) => {
      // Determine which odds group belongs to this match
      let group = null
      if (groups.length === 1) {
        group = groups[0] // single group → apply to first match (or all if 1 match)
        if (n > 1 && mi > 0) group = null // only first match gets it unless values match
      } else if (mi < groups.length) {
        group = groups[mi]
      }

      if (!group || group.length === 0) return

      if (m.entries.length > 0) {
        // Try to link odds to entries by position
        m.entries.forEach((e, ei) => {
          if (ei < group.length) {
            e.assignedOdds = group[ei]
          }
        })
      } else {
        m.assignedOdds = group[0]
      }
    })
  } else if (params.odds.length > 0) {
    // Flat odds list — assign per match
    assignSimple(params.odds, (m, v) => {
      if (m.entries.length > 0) {
        m.entries[0].assignedOdds = v
      } else {
        m.assignedOdds = v
      }
    })
  }
}

/* ── Stage 7: Build match drafts ──────────────────────────────────────── */

const buildMatchDraft = (parsed) => {
  const entries = parsed.entries.length > 0
    ? parsed.entries.map((e) => ({
        name: e.name || '',
        odds: String(e.assignedOdds || ''),
      }))
    : [{ name: '', odds: String(parsed.assignedOdds || '') }]

  return {
    homeTeam: parsed.home?.teamName || '',
    awayTeam: parsed.away?.teamName || '',
    entries,
    conf: parsed.conf ?? 50,
    mode: parsed.mode || '常规',
    tys_home: parsed.tys_home || 'M',
    tys_away: parsed.tys_away || 'M',
    fid: parsed.fid || '0.4',
    fse_home: parsed.fse_home ?? 50,
    fse_away: parsed.fse_away ?? 50,
    note: parsed.remark || '',
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
  let score = 0.3
  if (matches.every((m) => m.homeTeam || m.awayTeam)) score += 0.25
  if (matches.every((m) => m.entries.some((e) => e.name))) score += 0.2
  if (matches.every((m) => m.homeTeam && m.awayTeam)) score += 0.15
  if (diagnostics.filter((d) => d.level === 'warning').length === 0) score += 0.1
  return Math.min(1, score)
}

/* ── Main export ──────────────────────────────────────────────────────── */

export const parseNaturalInput = (rawText) => {
  const diagnostics = []
  if (!rawText || !rawText.trim()) {
    return { matches: [], diagnostics: [{ level: 'info', message: '输入为空' }], confidence: 0, rawInput: rawText || '' }
  }

  // Stage 1
  const normalized = normalizeText(rawText)

  // Stage 2
  const { params, warnings: paramWarnings, contentText } = extractParameters(normalized)
  for (const w of paramWarnings) diagnostics.push({ level: 'warning', message: w })

  // Stage 3
  const dict = getAliasDictionary()
  const teamHits = scanTeamNames(contentText, dict)

  if (teamHits.length === 0) {
    diagnostics.push({ level: 'error', message: '未识别到任何球队名称' })
    return { matches: [], diagnostics, confidence: 0, rawInput: rawText }
  }

  // Stage 4
  const segments = extractSegments(contentText, teamHits)

  // Stage 5
  const rawMatches = segmentMatches(segments)

  if (rawMatches.length === 0) {
    diagnostics.push({ level: 'error', message: '无法组合出有效比赛' })
    return { matches: [], diagnostics, confidence: 0.1, rawInput: rawText }
  }

  // Stage 6
  assignParameters(rawMatches, params)

  // Stage 7
  const matches = rawMatches.map(buildMatchDraft)

  // Stage 8
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
