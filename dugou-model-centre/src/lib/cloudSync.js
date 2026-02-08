import { createClient } from '@supabase/supabase-js'

const SYNC_STATE_KEY = 'dugou.cloud_sync_state.v1'

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
