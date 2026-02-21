import { appendAccessLog } from './localData'

const ACCESS_LOG_SESSION_KEY = 'dugou.access_log.session.v1'

const getAccessSessionId = () => {
  if (typeof window === 'undefined') return 'server-session'
  try {
    const cached = window.sessionStorage.getItem(ACCESS_LOG_SESSION_KEY)
    if (cached) return cached
    const next = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    window.sessionStorage.setItem(ACCESS_LOG_SESSION_KEY, next)
    return next
  } catch {
    return `sess_${Date.now().toString(36)}`
  }
}

const detectDeviceType = (ua, viewportWidth) => {
  const source = String(ua || '').toLowerCase()
  if (/ipad|tablet/.test(source)) return 'tablet'
  if (/mobile|iphone|android/.test(source) || Number(viewportWidth || 0) <= 768) return 'mobile'
  return 'desktop'
}

const detectBrowserName = (ua) => {
  const source = String(ua || '')
  if (/Edg\//.test(source)) return 'Edge'
  if (/OPR\//.test(source)) return 'Opera'
  if (/Chrome\//.test(source)) return 'Chrome'
  if (/Safari\//.test(source) && !/Chrome\//.test(source)) return 'Safari'
  if (/Firefox\//.test(source)) return 'Firefox'
  return 'Unknown Browser'
}

const detectOsName = (ua, platform) => {
  const source = `${String(ua || '')} ${String(platform || '')}`.toLowerCase()
  if (source.includes('mac')) return 'macOS'
  if (source.includes('windows')) return 'Windows'
  if (source.includes('iphone') || source.includes('ipad') || source.includes('ios')) return 'iOS'
  if (source.includes('android')) return 'Android'
  if (source.includes('linux')) return 'Linux'
  return 'Unknown OS'
}

export const buildAccessSnapshot = (pathname = '') => {
  if (typeof window === 'undefined') return null
  const nav = window.navigator || {}
  const ua = nav.userAgent || ''
  const browser = detectBrowserName(ua)
  const os = detectOsName(ua, nav.platform)
  const screenWidth = window.screen?.width || 0
  const screenHeight = window.screen?.height || 0
  const viewportWidth = window.innerWidth || 0
  const viewportHeight = window.innerHeight || 0
  const language = nav.language || (Array.isArray(nav.languages) ? nav.languages[0] : '') || 'unknown'
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  const networkType = nav.connection?.effectiveType || nav.connection?.type || 'unknown'
  const origin = window.location?.origin || ''
  const route = pathname || window.location?.pathname || '/'

  return {
    created_at: new Date().toISOString(),
    route,
    endpoint: `${origin}${route}`,
    host: window.location?.host || '',
    origin,
    access_channel: route === '/params' ? 'web_console' : 'web_app',
    device_type: detectDeviceType(ua, viewportWidth),
    client_browser: browser,
    client_os: os,
    user_agent: ua,
    platform: nav.platform || nav.userAgentData?.platform || '',
    language,
    timezone,
    viewport: `${viewportWidth}x${viewportHeight}`,
    screen: `${screenWidth}x${screenHeight}`,
    network_type: networkType,
    referrer: document.referrer || 'direct',
    session_id: getAccessSessionId(),
    ip: 'N/A (browser restricted)',
    mac: 'N/A (browser restricted)',
  }
}

export const trackRouteAccess = (pathname = '') => {
  const snapshot = buildAccessSnapshot(pathname)
  if (!snapshot) return null
  return appendAccessLog(snapshot)
}

