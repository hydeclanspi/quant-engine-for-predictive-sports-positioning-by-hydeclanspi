import { createClient } from '@supabase/supabase-js'

const SYNC_STATE_KEY = 'dugou.cloud_sync_state.v1'
const TIME_MACHINE_PREFIX = 'timemachine:'
const TIME_MACHINE_SCHEMA = 'dugou_time_snapshot_v1'
const TIME_MACHINE_DEFAULT_PAGE_SIZE = 6

const DEFAULT_SYNC_STATE = {
  enabled: false,
  lastSyncAt: '',
  lastError: '',
}

const isBrowser = typeof window !== 'undefined'
let syncTimer = null
let syncInFlight = false

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
}

const getSupabaseEnv = () => {
  const url = import.meta.env.VITE_SUPABASE_URL || ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  return {
    url: String(url).trim(),
    anonKey: String(anonKey).trim(),
  }
}

const getSupabaseClient = () => {
  const env = getSupabaseEnv()
  if (!env.url || !env.anonKey) return null
  return createClient(env.url, env.anonKey)
}

const pad2 = (value) => String(value).padStart(2, '0')

export const getTimeMachineMonthKey = (inputDate = new Date()) => {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

const buildMonthlySnapshotId = (monthKey) => `${TIME_MACHINE_PREFIX}monthly:${monthKey}`

const buildManualSnapshotId = () =>
  `${TIME_MACHINE_PREFIX}manual:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const normalizeTimeMachineBundle = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null
  const systemConfig = snapshot.system_config && typeof snapshot.system_config === 'object' ? snapshot.system_config : null
  const teamProfiles = Array.isArray(snapshot.team_profiles) ? snapshot.team_profiles : null
  const investments = Array.isArray(snapshot.investments) ? snapshot.investments : null
  if (!systemConfig || !teamProfiles || !investments) return null

  return {
    version: Number(snapshot.version) || 1,
    exported_at: String(snapshot.exported_at || new Date().toISOString()),
    system_config: systemConfig,
    team_profiles: teamProfiles,
    investments,
  }
}

const normalizeTimeMachineMeta = (rawMeta = {}, fallback = {}) => {
  const mode = rawMeta.mode === 'monthly' ? 'monthly' : 'manual'
  const snapshotAt = String(rawMeta.snapshot_at || fallback.snapshotAt || new Date().toISOString())
  const monthKey = String(rawMeta.month_key || fallback.monthKey || '')
  const titleFallback = mode === 'monthly' && monthKey ? `${monthKey} 月度快照` : '手动快照'
  return {
    mode,
    monthKey,
    snapshotAt,
    title: String(rawMeta.title || titleFallback),
    createdAt: String(rawMeta.created_at || fallback.createdAt || snapshotAt),
    includeAccessLogs: false,
  }
}

const parseTimeMachineRow = (row) => {
  if (!row || typeof row !== 'object') return null
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : null

  if (payload?.schema === TIME_MACHINE_SCHEMA && payload.bundle) {
    const bundle = normalizeTimeMachineBundle(payload.bundle)
    if (!bundle) return null
    const meta = normalizeTimeMachineMeta(payload.meta || {}, {
      snapshotAt: row.updated_at,
      createdAt: row.updated_at,
    })
    return {
      id: String(row.id || ''),
      updatedAt: String(row.updated_at || meta.snapshotAt),
      meta,
      bundle,
      stats: {
        investmentCount: Array.isArray(bundle.investments) ? bundle.investments.length : 0,
        teamCount: Array.isArray(bundle.team_profiles) ? bundle.team_profiles.length : 0,
      },
    }
  }

  const legacyBundle = normalizeTimeMachineBundle(payload || {})
  if (!legacyBundle) return null
  const fallbackMonth = getTimeMachineMonthKey(row.updated_at || Date.now())
  const mode = String(row.id || '').includes(':monthly:') ? 'monthly' : 'manual'
  const meta = normalizeTimeMachineMeta(
    {
      mode,
      month_key: mode === 'monthly' ? fallbackMonth : '',
      snapshot_at: row.updated_at || new Date().toISOString(),
      title: mode === 'monthly' ? `${fallbackMonth} 月度快照` : '手动快照',
    },
    { snapshotAt: row.updated_at, createdAt: row.updated_at, monthKey: fallbackMonth },
  )
  return {
    id: String(row.id || ''),
    updatedAt: String(row.updated_at || meta.snapshotAt),
    meta,
    bundle: legacyBundle,
    stats: {
      investmentCount: Array.isArray(legacyBundle.investments) ? legacyBundle.investments.length : 0,
      teamCount: Array.isArray(legacyBundle.team_profiles) ? legacyBundle.team_profiles.length : 0,
    },
  }
}

export const getCloudSyncState = () => {
  const saved = readJSON(SYNC_STATE_KEY, null)
  const env = getSupabaseEnv()
  return {
    ...DEFAULT_SYNC_STATE,
    ...(saved || {}),
    hasEnv: Boolean(env.url && env.anonKey),
  }
}

export const saveCloudSyncState = (patch) => {
  const current = getCloudSyncState()
  const next = {
    enabled: current.enabled,
    lastSyncAt: current.lastSyncAt,
    lastError: current.lastError,
    ...(patch || {}),
  }
  writeJSON(SYNC_STATE_KEY, next)
  return getCloudSyncState()
}

const doSyncSnapshot = async (snapshot) => {
  const state = getCloudSyncState()
  if (!state.enabled) {
    return { ok: false, reason: 'disabled' }
  }

  const client = getSupabaseClient()
  if (!client) {
    const next = saveCloudSyncState({
      lastError: 'Supabase 环境变量未配置（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。',
    })
    return { ok: false, reason: 'missing_env', state: next }
  }

  const payload = {
    id: 'latest',
    payload: snapshot,
    updated_at: new Date().toISOString(),
  }

  const { error } = await client.from('dugou_sync_snapshots').upsert(payload)
  if (error) {
    const next = saveCloudSyncState({ lastError: error.message || 'Supabase 同步失败。' })
    return { ok: false, reason: 'sync_failed', state: next }
  }

  const next = saveCloudSyncState({
    lastSyncAt: new Date().toISOString(),
    lastError: '',
  })
  return { ok: true, state: next }
}

export const syncSnapshotNow = async (snapshot) => {
  if (syncInFlight) return { ok: false, reason: 'in_flight', state: getCloudSyncState() }
  syncInFlight = true
  try {
    return await doSyncSnapshot(snapshot)
  } finally {
    syncInFlight = false
  }
}

export const fetchLatestSnapshot = async () => {
  const client = getSupabaseClient()
  if (!client) {
    const next = saveCloudSyncState({
      lastError: 'Supabase 环境变量未配置（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。',
    })
    return { ok: false, reason: 'missing_env', state: next }
  }

  const { data, error } = await client
    .from('dugou_sync_snapshots')
    .select('payload, updated_at')
    .eq('id', 'latest')
    .maybeSingle()

  if (error) {
    const next = saveCloudSyncState({ lastError: error.message || 'Supabase 拉取失败。' })
    return { ok: false, reason: 'pull_failed', state: next }
  }

  if (!data?.payload || typeof data.payload !== 'object') {
    const next = saveCloudSyncState({ lastError: '云端暂无可用快照。' })
    return { ok: false, reason: 'empty_remote', state: next }
  }

  const next = saveCloudSyncState({
    lastSyncAt: new Date().toISOString(),
    lastError: '',
  })
  return {
    ok: true,
    snapshot: data.payload,
    remoteUpdatedAt: data.updated_at || '',
    state: next,
  }
}

export const saveTimeMachineSnapshot = async ({ snapshot, title = '', mode = 'manual', monthKey = '' } = {}) => {
  const client = getSupabaseClient()
  if (!client) {
    const next = saveCloudSyncState({
      lastError: 'Supabase 环境变量未配置（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。',
    })
    return { ok: false, reason: 'missing_env', state: next }
  }

  const bundle = normalizeTimeMachineBundle(snapshot)
  if (!bundle) return { ok: false, reason: 'invalid_snapshot' }

  const normalizedMode = mode === 'monthly' ? 'monthly' : 'manual'
  const normalizedMonthKey = normalizedMode === 'monthly' ? (monthKey || getTimeMachineMonthKey(Date.now())) : ''
  const snapshotId = normalizedMode === 'monthly' ? buildMonthlySnapshotId(normalizedMonthKey) : buildManualSnapshotId()
  const snapshotAt = new Date().toISOString()
  const resolvedTitle = String(title || '').trim() || (normalizedMode === 'monthly' ? `${normalizedMonthKey} 月度快照` : '手动快照')

  const payload = {
    schema: TIME_MACHINE_SCHEMA,
    meta: {
      mode: normalizedMode,
      month_key: normalizedMonthKey,
      snapshot_at: snapshotAt,
      created_at: snapshotAt,
      title: resolvedTitle,
      include_access_logs: false,
    },
    bundle,
  }

  const { error } = await client.from('dugou_sync_snapshots').upsert({
    id: snapshotId,
    payload,
    updated_at: snapshotAt,
  })

  if (error) {
    const next = saveCloudSyncState({ lastError: error.message || '时光快照保存失败。' })
    return { ok: false, reason: 'save_failed', state: next }
  }

  return {
    ok: true,
    snapshotId,
    meta: {
      mode: normalizedMode,
      monthKey: normalizedMonthKey,
      snapshotAt,
      title: resolvedTitle,
    },
  }
}

export const ensureMonthlyTimeMachineSnapshot = async ({ snapshot, now = Date.now() } = {}) => {
  const client = getSupabaseClient()
  if (!client) {
    const next = saveCloudSyncState({
      lastError: 'Supabase 环境变量未配置（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。',
    })
    return { ok: false, reason: 'missing_env', state: next }
  }

  const monthKey = getTimeMachineMonthKey(now)
  if (!monthKey) return { ok: false, reason: 'invalid_month' }
  const snapshotId = buildMonthlySnapshotId(monthKey)

  const { data: existing, error: checkError } = await client
    .from('dugou_sync_snapshots')
    .select('id, updated_at')
    .eq('id', snapshotId)
    .maybeSingle()

  if (checkError) {
    const next = saveCloudSyncState({ lastError: checkError.message || '月度快照检查失败。' })
    return { ok: false, reason: 'check_failed', state: next }
  }

  if (existing?.id) {
    return {
      ok: true,
      created: false,
      snapshotId,
      monthKey,
      snapshotAt: existing.updated_at || '',
    }
  }

  const result = await saveTimeMachineSnapshot({
    snapshot,
    mode: 'monthly',
    monthKey,
  })
  if (!result?.ok) return { ...result, created: false, monthKey }
  return { ...result, created: true, monthKey }
}

export const listTimeMachineSnapshots = async ({ page = 1, pageSize = TIME_MACHINE_DEFAULT_PAGE_SIZE } = {}) => {
  const client = getSupabaseClient()
  if (!client) {
    const next = saveCloudSyncState({
      lastError: 'Supabase 环境变量未配置（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。',
    })
    return { ok: false, reason: 'missing_env', state: next, rows: [], total: 0 }
  }

  const safePageSize = Math.max(1, Math.min(50, Number(pageSize) || TIME_MACHINE_DEFAULT_PAGE_SIZE))
  const safePage = Math.max(1, Number(page) || 1)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize - 1

  const { data, error, count } = await client
    .from('dugou_sync_snapshots')
    .select('id, payload, updated_at', { count: 'exact' })
    .like('id', `${TIME_MACHINE_PREFIX}%`)
    .order('updated_at', { ascending: false })
    .range(from, to)

  if (error) {
    const next = saveCloudSyncState({ lastError: error.message || '时光快照列表读取失败。' })
    return { ok: false, reason: 'list_failed', state: next, rows: [], total: 0, page: safePage, pageSize: safePageSize }
  }

  const rows = Array.isArray(data)
    ? data
        .map((row) => parseTimeMachineRow(row))
        .filter(Boolean)
    : []

  return {
    ok: true,
    rows,
    total: Number.isFinite(Number(count)) ? Number(count) : rows.length,
    page: safePage,
    pageSize: safePageSize,
  }
}

export const fetchTimeMachineSnapshotById = async (snapshotId) => {
  const client = getSupabaseClient()
  if (!client) {
    const next = saveCloudSyncState({
      lastError: 'Supabase 环境变量未配置（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。',
    })
    return { ok: false, reason: 'missing_env', state: next }
  }

  const id = String(snapshotId || '').trim()
  if (!id) return { ok: false, reason: 'invalid_id' }

  const { data, error } = await client
    .from('dugou_sync_snapshots')
    .select('id, payload, updated_at')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    const next = saveCloudSyncState({ lastError: error.message || '时光快照读取失败。' })
    return { ok: false, reason: 'fetch_failed', state: next }
  }

  const parsed = parseTimeMachineRow(data)
  if (!parsed) return { ok: false, reason: 'snapshot_not_found' }

  return {
    ok: true,
    snapshotId: parsed.id,
    bundle: parsed.bundle,
    meta: parsed.meta,
    stats: parsed.stats,
    updatedAt: parsed.updatedAt,
  }
}

export const scheduleSnapshotSync = (snapshotFactory) => {
  const state = getCloudSyncState()
  if (!state.enabled || typeof snapshotFactory !== 'function') return

  if (syncTimer) {
    window.clearTimeout(syncTimer)
  }

  syncTimer = window.setTimeout(async () => {
    syncTimer = null
    if (syncInFlight) return
    syncInFlight = true
    try {
      const snapshot = snapshotFactory()
      await doSyncSnapshot(snapshot)
    } finally {
      syncInFlight = false
    }
  }, 600)
}

// ── Time Machine Session Management ──
const TIME_MACHINE_SESSION_KEY = 'dugou.time_machine_session.v1'

export const getTimeMachineSession = () => {
  if (!isBrowser) return null
  try {
    const raw = window.sessionStorage.getItem(TIME_MACHINE_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const startTimeMachineSession = (snapshotData) => {
  if (!isBrowser) return { ok: false, reason: 'browser_only' }
  if (!snapshotData || typeof snapshotData !== 'object') {
    return { ok: false, reason: 'invalid_snapshot' }
  }

  const session = {
    snapshotId: String(snapshotData.snapshotId || ''),
    snapshotAt: String(snapshotData.updatedAt || new Date().toISOString()),
    title: String(snapshotData.meta?.title || '快照'),
    monthKey: String(snapshotData.meta?.monthKey || ''),
    bundle: snapshotData.bundle || {},
    startedAt: new Date().toISOString(),
  }

  try {
    window.sessionStorage.setItem(TIME_MACHINE_SESSION_KEY, JSON.stringify(session))
    window.dispatchEvent(new CustomEvent('dugou:time-machine-changed', { detail: { active: true, session } }))
    return { ok: true, session }
  } catch {
    return { ok: false, reason: 'session_storage_error' }
  }
}

export const exitTimeMachineSession = () => {
  if (!isBrowser) return { ok: false, reason: 'browser_only' }
  try {
    window.sessionStorage.removeItem(TIME_MACHINE_SESSION_KEY)
    window.dispatchEvent(new CustomEvent('dugou:time-machine-changed', { detail: { active: false, session: null } }))
    return { ok: true }
  } catch {
    return { ok: false, reason: 'session_storage_error' }
  }
}

export const isInTimeMachineSession = () => {
  return Boolean(getTimeMachineSession())
}
