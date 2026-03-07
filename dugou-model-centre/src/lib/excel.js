import * as XLSX from 'xlsx'
import { exportDataBundle } from './localData'

const WORKBOOK_FORMAT = 'dugou_excel_backup'
const WORKBOOK_SCHEMA_VERSION = 2

const SHEETS = {
  meta: '__Meta',
  systemConfigRaw: '__SystemConfigRaw',
  teamProfilesRaw: '__TeamProfilesRaw',
  investmentsRaw: '__InvestmentsRaw',
  matchesRaw: '__MatchesRaw',
  accessLogsRaw: '__AccessLogsRaw',
  investments: 'Investments',
  matches: 'Matches',
  teamProfiles: 'TeamProfiles',
  systemConfig: 'SystemConfig',
  accessLogs: 'AccessLogs',
}

const JSON_FILE_RE = /\.json$/i
const EXCEL_FILE_RE = /\.(xlsx|xls|xlsm)$/i
const LEGACY_OBJECT_CONFIG_KEYS = new Set(['adaptiveWeights', 'pageAmbientThemes'])
const LEGACY_ARRAY_CONFIG_KEYS = new Set(['capitalInjections'])

export const BACKUP_IMPORT_ACCEPT =
  'application/json,.json,.xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toArray = (value) => (Array.isArray(value) ? value : [])

const appendSheet = (workbook, rows, name) => {
  const safeRows = Array.isArray(rows) && rows.length > 0 ? rows : [{ note: 'empty' }]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(safeRows), name)
}

const safeStringify = (value) => {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return JSON.stringify(null)
  }
}

const parseJsonCell = (value, fallback = null) => {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const parseMaybeScalar = (value) => {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

const parseBooleanish = (value) => {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return undefined
  if (text === 'true') return true
  if (text === 'false') return false
  return undefined
}

const parseNumberish = (value, fallback = '') => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim()
  if (!text) return fallback
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getSheetRows = (workbook, name) => {
  const sheet = workbook?.Sheets?.[name]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true })
}

const buildReadableInvestmentRows = (investments) =>
  toArray(investments).map((item) => ({
    id: item.id,
    created_at: item.created_at,
    combo_name: item.combo_name,
    parlay_size: item.parlay_size,
    matches_count: Array.isArray(item.matches) ? item.matches.length : 0,
    inputs: item.inputs,
    suggested_amount: item.suggested_amount,
    expected_rating: item.expected_rating,
    combined_odds: item.combined_odds,
    status: item.status,
    revenues: item.revenues,
    profit: item.profit,
    actual_rating: item.actual_rating,
    rep: item.rep,
    remarks: item.remarks,
    is_archived: item.is_archived ? 'true' : 'false',
  }))

const buildReadableMatchRows = (investments) =>
  toArray(investments).flatMap((item) =>
    toArray(item.matches).map((match, idx) => ({
      investment_id: item.id,
      match_index: idx + 1,
      id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      entry_text: match.entry_text,
      entry_market_type: match.entry_market_type,
      entry_market_label: match.entry_market_label,
      entry_semantic_key: match.entry_semantic_key,
      entries_json: safeStringify(match.entries || []),
      odds: match.odds,
      conf: match.conf,
      mode: match.mode,
      tys_home: match.tys_home,
      tys_away: match.tys_away,
      fid: match.fid,
      fse_home: match.fse_home,
      fse_away: match.fse_away,
      fse_match: match.fse_match,
      results: match.results,
      is_correct: typeof match.is_correct === 'boolean' ? String(match.is_correct) : '',
      match_rating: match.match_rating,
      match_rep: match.match_rep,
      note: match.note,
      post_note: match.post_note,
    })),
  )

const buildReadableTeamRows = (teamProfiles) =>
  toArray(teamProfiles).map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    abbreviations: Array.isArray(team.abbreviations) ? team.abbreviations.join('|') : '',
    totalSamples: team.totalSamples,
    avgRep: team.avgRep,
  }))

const buildReadableConfigRows = (systemConfig) =>
  Object.entries(systemConfig || {}).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : safeStringify(value),
    value_json: safeStringify(value),
  }))

const buildReadableAccessLogRows = (accessLogs) =>
  toArray(accessLogs).map((item) => ({
    id: item.id,
    created_at: item.created_at,
    route: item.route,
    endpoint: item.endpoint,
    host: item.host,
    origin: item.origin,
    access_channel: item.access_channel,
    device_type: item.device_type,
    client_browser: item.client_browser,
    client_os: item.client_os,
    session_id: item.session_id,
    timezone: item.timezone,
  }))

const buildRawInvestmentRows = (investments) =>
  toArray(investments).map((item) => {
    const safeItem = isPlainObject(item) ? item : {}
    const { matches = [], ...investmentBase } = safeItem
    return {
      id: investmentBase.id,
      created_at: investmentBase.created_at || '',
      parlay_size: investmentBase.parlay_size || toArray(matches).length || 0,
      matches_count: toArray(matches).length,
      payload_json: safeStringify(investmentBase),
    }
  })

const buildRawMatchRows = (investments) =>
  toArray(investments).flatMap((item) =>
    toArray(item.matches).map((match, idx) => ({
      investment_id: item.id,
      match_index: idx + 1,
      id: match.id,
      payload_json: safeStringify(match),
    })),
  )

const buildRawTeamRows = (teamProfiles) =>
  toArray(teamProfiles).map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    payload_json: safeStringify(team),
  }))

const buildRawAccessLogRows = (accessLogs) =>
  toArray(accessLogs).map((item) => ({
    id: item.id,
    created_at: item.created_at,
    payload_json: safeStringify(item),
  }))

const buildMetaRows = (bundle) => {
  const investments = toArray(bundle?.investments)
  const accessLogs = toArray(bundle?.access_logs)
  return [
    { key: 'format', value: WORKBOOK_FORMAT },
    { key: 'workbook_schema_version', value: WORKBOOK_SCHEMA_VERSION },
    { key: 'bundle_version', value: bundle?.version ?? 1 },
    { key: 'exported_at', value: bundle?.exported_at || new Date().toISOString() },
    { key: 'investment_count', value: investments.length },
    {
      key: 'match_count',
      value: investments.reduce((sum, item) => sum + toArray(item.matches).length, 0),
    },
    { key: 'team_profile_count', value: toArray(bundle?.team_profiles).length },
    { key: 'access_log_count', value: accessLogs.length },
  ]
}

const parseMetaMap = (workbook) =>
  getSheetRows(workbook, SHEETS.meta).reduce((accumulator, row) => {
    const key = String(row?.key || '').trim()
    if (!key) return accumulator
    accumulator[key] = parseMaybeScalar(row.value)
    return accumulator
  }, {})

const parseReadableSystemConfigRows = (rows) =>
  rows.reduce((config, row) => {
    const key = String(row?.key || '').trim()
    if (!key) return config

    let value
    if (typeof row?.value_json === 'string' && row.value_json.trim()) {
      value = parseJsonCell(row.value_json, undefined)
    }
    if (typeof value === 'undefined') {
      value = parseMaybeScalar(row?.value)
    }

    if (LEGACY_OBJECT_CONFIG_KEYS.has(key)) {
      if (!isPlainObject(value)) return config
    } else if (LEGACY_ARRAY_CONFIG_KEYS.has(key)) {
      if (!Array.isArray(value)) return config
    } else if (value === '[object Object]') {
      return config
    }

    config[key] = value
    return config
  }, {})

const parseReadableTeamRows = (rows) =>
  rows
    .map((row, index) => {
      const teamName = String(row?.teamName || '').trim()
      if (!teamName) return null
      const abbreviations = String(row?.abbreviations || '')
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean)
      return {
        teamId: String(row?.teamId || `legacy_team_${index + 1}`),
        teamName,
        abbreviations,
        totalSamples: parseNumberish(row?.totalSamples, 0),
        avgRep: parseNumberish(row?.avgRep, 0.5),
      }
    })
    .filter(Boolean)

const parseReadableMatchRows = (rows) => {
  const grouped = new Map()

  rows.forEach((row, index) => {
    const investmentId = String(row?.investment_id || '').trim()
    if (!investmentId) return

    const matches = grouped.get(investmentId) || []
    matches.push({
      order: parseNumberish(row?.match_index, index + 1),
      record: {
        id: String(row?.id || `${investmentId}_match_${index + 1}`),
        home_team: String(row?.home_team || ''),
        away_team: String(row?.away_team || ''),
        entry_text: String(row?.entry_text || ''),
        entry_market_type: String(row?.entry_market_type || ''),
        entry_market_label: String(row?.entry_market_label || ''),
        entry_semantic_key: String(row?.entry_semantic_key || ''),
        entries: parseJsonCell(String(row?.entries_json || ''), []),
        odds: parseNumberish(row?.odds),
        conf: parseNumberish(row?.conf),
        mode: String(row?.mode || ''),
        tys_home: String(row?.tys_home || ''),
        tys_away: String(row?.tys_away || ''),
        fid: parseNumberish(row?.fid),
        fse_home: parseNumberish(row?.fse_home),
        fse_away: parseNumberish(row?.fse_away),
        fse_match: parseNumberish(row?.fse_match),
        results: row?.results ?? '',
        is_correct: parseBooleanish(row?.is_correct),
        match_rating: parseNumberish(row?.match_rating),
        match_rep: parseNumberish(row?.match_rep),
        note: String(row?.note || ''),
        post_note: String(row?.post_note || ''),
      },
    })
    grouped.set(investmentId, matches)
  })

  return grouped
}

const parseReadableInvestmentRows = (rows, groupedMatches) =>
  rows
    .map((row) => {
      const id = String(row?.id || '').trim()
      if (!id) return null
      const matches = (groupedMatches.get(id) || [])
        .sort((a, b) => a.order - b.order)
        .map((item) => item.record)

      return {
        id,
        created_at: String(row?.created_at || new Date().toISOString()),
        combo_name: String(row?.combo_name || ''),
        parlay_size: parseNumberish(row?.parlay_size, matches.length || 1),
        inputs: parseNumberish(row?.inputs),
        suggested_amount: parseNumberish(row?.suggested_amount),
        expected_rating: parseNumberish(row?.expected_rating),
        combined_odds: parseNumberish(row?.combined_odds),
        status: String(row?.status || ''),
        revenues: parseNumberish(row?.revenues),
        profit: parseNumberish(row?.profit),
        actual_rating: parseNumberish(row?.actual_rating),
        rep: parseNumberish(row?.rep),
        remarks: String(row?.remarks || ''),
        is_archived: parseBooleanish(row?.is_archived) ?? false,
        matches,
      }
    })
    .filter(Boolean)

const parseReadableAccessLogRows = (rows) =>
  rows
    .map((row, index) => {
      const id = String(row?.id || '').trim()
      if (!id) return null
      return {
        id,
        created_at: String(row?.created_at || new Date().toISOString()),
        route: String(row?.route || '/params'),
        endpoint: String(row?.endpoint || ''),
        host: String(row?.host || ''),
        origin: String(row?.origin || ''),
        access_channel: String(row?.access_channel || 'web'),
        device_type: String(row?.device_type || 'unknown'),
        client_browser: String(row?.client_browser || ''),
        client_os: String(row?.client_os || ''),
        session_id: String(row?.session_id || `legacy_session_${index + 1}`),
        timezone: String(row?.timezone || ''),
      }
    })
    .filter(Boolean)

const parseRawWorkbook = (workbook) => {
  const meta = parseMetaMap(workbook)

  const systemConfigRow = getSheetRows(workbook, SHEETS.systemConfigRaw)[0]
  const systemConfig = isPlainObject(parseJsonCell(systemConfigRow?.payload_json, null))
    ? parseJsonCell(systemConfigRow.payload_json, {})
    : parseReadableSystemConfigRows(getSheetRows(workbook, SHEETS.systemConfig))

  const teamProfiles = getSheetRows(workbook, SHEETS.teamProfilesRaw)
    .map((row) => parseJsonCell(row?.payload_json, null))
    .filter(isPlainObject)

  const rawMatchMap = new Map()
  getSheetRows(workbook, SHEETS.matchesRaw).forEach((row, index) => {
    const investmentId = String(row?.investment_id || '').trim()
    if (!investmentId) return
    const match = parseJsonCell(row?.payload_json, null)
    if (!isPlainObject(match)) return
    const bucket = rawMatchMap.get(investmentId) || []
    bucket.push({
      order: parseNumberish(row?.match_index, index + 1),
      record: match,
    })
    rawMatchMap.set(investmentId, bucket)
  })

  const rawInvestments = getSheetRows(workbook, SHEETS.investmentsRaw)
    .map((row) => {
      const investmentBase = parseJsonCell(row?.payload_json, null)
      if (!isPlainObject(investmentBase)) return null

      const id = String(investmentBase.id || row?.id || '').trim()
      if (!id) return null

      const workbookMatches = (rawMatchMap.get(id) || [])
        .sort((a, b) => a.order - b.order)
        .map((item) => item.record)
      const inlineMatches = toArray(investmentBase.matches).filter(isPlainObject)

      return {
        ...investmentBase,
        id,
        matches: workbookMatches.length > 0 ? workbookMatches : inlineMatches,
      }
    })
    .filter(Boolean)

  rawMatchMap.forEach((items, investmentId) => {
    if (rawInvestments.some((item) => item.id === investmentId)) return
    rawInvestments.push({
      id: investmentId,
      created_at: '',
      matches: items.sort((a, b) => a.order - b.order).map((item) => item.record),
    })
  })

  const accessLogs = getSheetRows(workbook, SHEETS.accessLogsRaw)
    .map((row) => parseJsonCell(row?.payload_json, null))
    .filter(isPlainObject)

  return {
    version: parseNumberish(meta.bundle_version, 1),
    exported_at: String(meta.exported_at || new Date().toISOString()),
    system_config: systemConfig,
    team_profiles:
      teamProfiles.length > 0 ? teamProfiles : parseReadableTeamRows(getSheetRows(workbook, SHEETS.teamProfiles)),
    investments:
      rawInvestments.length > 0
        ? rawInvestments
        : parseReadableInvestmentRows(
            getSheetRows(workbook, SHEETS.investments),
            parseReadableMatchRows(getSheetRows(workbook, SHEETS.matches)),
          ),
    access_logs:
      accessLogs.length > 0 ? accessLogs : parseReadableAccessLogRows(getSheetRows(workbook, SHEETS.accessLogs)),
  }
}

const parseLegacyWorkbook = (workbook) => {
  const matches = parseReadableMatchRows(getSheetRows(workbook, SHEETS.matches))
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    system_config: parseReadableSystemConfigRows(getSheetRows(workbook, SHEETS.systemConfig)),
    team_profiles: parseReadableTeamRows(getSheetRows(workbook, SHEETS.teamProfiles)),
    investments: parseReadableInvestmentRows(getSheetRows(workbook, SHEETS.investments), matches),
    access_logs: parseReadableAccessLogRows(getSheetRows(workbook, SHEETS.accessLogs)),
  }
}

const looksLikeRawBackupWorkbook = (workbook) =>
  Boolean(
    workbook?.Sheets?.[SHEETS.meta] ||
      workbook?.Sheets?.[SHEETS.systemConfigRaw] ||
      workbook?.Sheets?.[SHEETS.investmentsRaw],
  )

const isBundleShape = (bundle) =>
  Boolean(bundle) &&
  typeof bundle === 'object' &&
  isPlainObject(bundle.system_config || {}) &&
  Array.isArray(bundle.team_profiles) &&
  Array.isArray(bundle.investments) &&
  Array.isArray(bundle.access_logs)

export const buildDataWorkbook = (bundle) => {
  const safeBundle = {
    version: bundle?.version ?? 1,
    exported_at: bundle?.exported_at || new Date().toISOString(),
    system_config: isPlainObject(bundle?.system_config) ? bundle.system_config : {},
    team_profiles: toArray(bundle?.team_profiles),
    investments: toArray(bundle?.investments),
    access_logs: toArray(bundle?.access_logs),
  }

  const workbook = XLSX.utils.book_new()

  appendSheet(workbook, buildMetaRows(safeBundle), SHEETS.meta)
  appendSheet(
    workbook,
    [{ payload_json: safeStringify(safeBundle.system_config) }],
    SHEETS.systemConfigRaw,
  )
  appendSheet(workbook, buildRawTeamRows(safeBundle.team_profiles), SHEETS.teamProfilesRaw)
  appendSheet(workbook, buildRawInvestmentRows(safeBundle.investments), SHEETS.investmentsRaw)
  appendSheet(workbook, buildRawMatchRows(safeBundle.investments), SHEETS.matchesRaw)
  appendSheet(workbook, buildRawAccessLogRows(safeBundle.access_logs), SHEETS.accessLogsRaw)

  appendSheet(workbook, buildReadableInvestmentRows(safeBundle.investments), SHEETS.investments)
  appendSheet(workbook, buildReadableMatchRows(safeBundle.investments), SHEETS.matches)
  appendSheet(workbook, buildReadableTeamRows(safeBundle.team_profiles), SHEETS.teamProfiles)
  appendSheet(workbook, buildReadableConfigRows(safeBundle.system_config), SHEETS.systemConfig)
  appendSheet(workbook, buildReadableAccessLogRows(safeBundle.access_logs), SHEETS.accessLogs)

  return workbook
}

export const parseDataBundleFromWorkbook = (workbook) => {
  const bundle = looksLikeRawBackupWorkbook(workbook)
    ? parseRawWorkbook(workbook)
    : parseLegacyWorkbook(workbook)

  if (!isBundleShape(bundle)) {
    throw new Error('invalid_excel_backup')
  }

  return bundle
}

export const parseDataBundleFromExcelBuffer = (arrayBuffer) => {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  return parseDataBundleFromWorkbook(workbook)
}

export const readDataBundleFromImportFile = async (file) => {
  if (!file) {
    throw new Error('missing_backup_file')
  }

  const filename = String(file.name || '').toLowerCase()

  if (JSON_FILE_RE.test(filename)) {
    return JSON.parse(await file.text())
  }

  if (EXCEL_FILE_RE.test(filename)) {
    return parseDataBundleFromExcelBuffer(await file.arrayBuffer())
  }

  try {
    return JSON.parse(await file.text())
  } catch {
    return parseDataBundleFromExcelBuffer(await file.arrayBuffer())
  }
}

export const downloadWorkbook = (workbook, filenamePrefix = 'dugou-data') => {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const dateKey = new Date().toISOString().slice(0, 10)
  anchor.href = href
  anchor.download = `${filenamePrefix}-${dateKey}.xlsx`
  anchor.click()
  URL.revokeObjectURL(href)
}

export const exportDataBundleAsExcel = (filenamePrefix = 'dugou-data') => {
  const bundle = exportDataBundle()
  const workbook = buildDataWorkbook(bundle)
  downloadWorkbook(workbook, filenamePrefix)
}
