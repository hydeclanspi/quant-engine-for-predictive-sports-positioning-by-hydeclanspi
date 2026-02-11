import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  PlusCircle,
  LayoutGrid,
  Clock,
  BarChart3,
  History,
  SlidersHorizontal,
  ChevronDown,
  Search,
  Settings,
  Diamond,
  TrendingUp,
  FileText,
  Flag,
  Upload,
  Download,
} from 'lucide-react'
import { exportDataBundle, getInvestments, getSystemConfig, importDataBundle } from '../lib/localData'
import { exportDataBundleAsExcel } from '../lib/excel'

/* ──────────────────────────────────────────────────
   Navigation structure with Lucide icons
   ────────────────────────────────────────────────── */
const NAV_ITEMS = [
  { id: 'new', path: '/new', label: '新建投资', Icon: PlusCircle },
  { id: 'combo', path: '/combo', label: '智能组合', Icon: LayoutGrid },
  { id: 'settle', path: '/settle', label: '待结算', Icon: Clock, showBadge: 'pending' },
  {
    id: 'dashboard',
    path: '/dashboard',
    label: 'Dashboard',
    Icon: BarChart3,
    children: [
      { id: 'analysis', path: '/dashboard/analysis', label: '深度分析', Icon: TrendingUp },
      { id: 'metrics', path: '/dashboard/metrics', label: '数据总览', Icon: FileText },
    ],
  },
  {
    id: 'history',
    path: '/history',
    label: '历史记录',
    Icon: History,
    showBadge: 'total',
    children: [
      { id: 'teams', path: '/history/teams', label: '球队档案馆', Icon: Flag },
    ],
  },
  { id: 'params', path: '/params', label: '参数后台', Icon: SlidersHorizontal },
]

const PAGE_SUBTITLES = {
  '/': 'Record match predictions & calibration parameters',
  '/new': 'Record match predictions & calibration parameters',
  '/combo': 'Multi-match portfolio construction & analysis',
  '/settle': 'Pending settlement & outcome resolution',
  '/dashboard': 'Performance overview & fund tracking',
  '/dashboard/analysis': 'Deep calibration & prediction analysis',
  '/dashboard/metrics': 'Comprehensive data metrics overview',
  '/history': 'Historical investment records & outcomes',
  '/history/teams': 'Team profile archive & performance data',
  '/params': 'System configuration & calibration parameters',
}

export default function TopBar() {
  const [openDropdown, setOpenDropdown] = useState(null)
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [logoEntrance, setLogoEntrance] = useState(true)
  const dropdownRef = useRef(null)
  const searchInputRef = useRef(null)
  const settingsRef = useRef(null)
  const importInputRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()

  // Logo entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setLogoEntrance(false), 3200)
    return () => clearTimeout(timer)
  }, [])

  // Listen for data changes (for badges)
  useEffect(() => {
    const onDataChanged = () => setDataVersion((prev) => prev + 1)
    window.addEventListener('dugou:data-changed', onDataChanged)
    return () => window.removeEventListener('dugou:data-changed', onDataChanged)
  }, [])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(null)
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Close dropdown on route change
  useEffect(() => {
    setOpenDropdown(null)
    setShowSearch(false)
    setShowSettings(false)
  }, [location.pathname])

  // Focus search input when opened
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [showSearch])

  const stats = useMemo(() => {
    const investments = getInvestments()
    return {
      pendingCount: investments.filter((item) => item.status === 'pending').length,
      totalCount: investments.length,
    }
  }, [dataVersion])

  const isActive = (path) => {
    if (path === '/new' && (location.pathname === '/' || location.pathname === '/new')) return true
    return location.pathname === path
  }

  const isGroupActive = (item) => {
    if (isActive(item.path)) return true
    return item.children?.some(child => location.pathname === child.path)
  }

  const getBadge = (item) => {
    if (item.showBadge === 'pending') return stats.pendingCount > 0 ? stats.pendingCount : null
    if (item.showBadge === 'total') return stats.totalCount > 0 ? stats.totalCount : null
    return null
  }

  const currentSubtitle = PAGE_SUBTITLES[location.pathname] || ''

  /* Data management handlers */
  const handleExport = () => {
    const bundle = exportDataBundle()
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const dateKey = new Date().toISOString().slice(0, 10)
    anchor.href = href
    anchor.download = `dugou-backup-${dateKey}.json`
    anchor.click()
    URL.revokeObjectURL(href)
    setShowSettings(false)
  }

  const handleExportExcel = () => {
    exportDataBundleAsExcel('dugou-data')
    setShowSettings(false)
  }

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const shouldMerge = window.confirm('导入模式：点击「确定」= 合并；点击「取消」= 覆盖当前数据。')
      const mode = shouldMerge ? 'merge' : 'replace'
      const ok = importDataBundle(parsed, mode)
      if (!ok) {
        window.alert('导入失败：文件结构不正确。')
        return
      }
      window.alert(mode === 'merge' ? '导入成功（合并模式）' : '导入成功（覆盖模式）')
      setDataVersion((prev) => prev + 1)
    } catch {
      window.alert('导入失败：请确认选择的是 hydecaside 导出的 JSON 文件。')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <header className="topbar-v2">
      {/* ── Left: Brand ── */}
      <div className="topbar-v2-brand" onClick={() => navigate('/new')}>
        <div className={`c19-logo-sm ${logoEntrance ? 'c19-entrance' : ''}`}>
          {logoEntrance ? (
            <div className="c19-draw-border c19-draw-border-sm">
              <svg viewBox="0 0 32 32">
                <defs>
                  <linearGradient id="c19DrawGradSm" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fbbf24" />
                    <stop offset="50%" stopColor="#f97316" />
                    <stop offset="100%" stopColor="#fcd34d" />
                  </linearGradient>
                </defs>
                <rect x="1" y="1" width="30" height="30" rx="8" ry="8" />
              </svg>
            </div>
          ) : (
            <div className="c19-logo-border c19-logo-border-sm" />
          )}
          <div className="c19-logo-inner c19-logo-inner-sm" />
          <div className="c19-logo-content c19-logo-content-sm">
            <span className="c19-t c19-t-sm">HD</span>
            <span className="c19-dot c19-dot-sm" />
            <span className="c19-b c19-b-sm">CS</span>
          </div>
          <div className="c19-logo-shimmer" />
        </div>
        <div className="topbar-v2-brand-text">
          <span className="topbar-v2-brand-name">DUGOU</span>
          <span className="topbar-v2-brand-sub">Model Centre</span>
        </div>
      </div>

      {/* ── Subtle vertical divider ── */}
      <div className="topbar-v2-divider" />

      {/* ── Center: Navigation ── */}
      <nav className="topbar-v2-nav" ref={dropdownRef}>
        {NAV_ITEMS.map(item => {
          const active = isGroupActive(item)
          const badge = getBadge(item)
          const hasChildren = item.children && item.children.length > 0

          return (
            <div key={item.id} className="topbar-v2-nav-group">
              <button
                onClick={() => {
                  if (hasChildren) {
                    setOpenDropdown(openDropdown === item.id ? null : item.id)
                  } else {
                    navigate(item.path)
                  }
                }}
                className={`topbar-v2-nav-item ${active ? 'topbar-v2-nav-active' : ''}`}
              >
                <item.Icon
                  size={15}
                  strokeWidth={active ? 2 : 1.5}
                  className={`topbar-v2-nav-icon ${active ? 'topbar-v2-nav-icon-active' : ''}`}
                />
                <span className="topbar-v2-nav-label">{item.label}</span>
                {badge != null && (
                  <span className={`topbar-v2-badge ${item.showBadge === 'pending' ? 'topbar-v2-badge-highlight' : ''}`}>
                    {badge}
                  </span>
                )}
                {hasChildren && (
                  <ChevronDown
                    size={11}
                    strokeWidth={1.5}
                    className={`topbar-v2-chevron ${openDropdown === item.id ? 'topbar-v2-chevron-open' : ''}`}
                  />
                )}
              </button>

              {/* Dropdown for children */}
              {hasChildren && openDropdown === item.id && (
                <div className="topbar-v2-dropdown">
                  {/* Parent link at top of dropdown */}
                  <button
                    onClick={() => { navigate(item.path); setOpenDropdown(null) }}
                    className={`topbar-v2-dropdown-item ${isActive(item.path) ? 'topbar-v2-dropdown-active' : ''}`}
                  >
                    <item.Icon size={14} strokeWidth={1.5} />
                    <span>{item.label} Overview</span>
                  </button>
                  <div className="topbar-v2-dropdown-divider" />
                  {item.children.map(child => (
                    <button
                      key={child.id}
                      onClick={() => { navigate(child.path); setOpenDropdown(null) }}
                      className={`topbar-v2-dropdown-item ${isActive(child.path) ? 'topbar-v2-dropdown-active' : ''}`}
                    >
                      <child.Icon size={14} strokeWidth={1.5} />
                      <span>{child.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* ── Right: utilities ── */}
      <div className="topbar-v2-right">
        {/* Contextual subtitle — shows on wider screens */}
        {currentSubtitle && (
          <span className="topbar-v2-context-hint">{currentSubtitle}</span>
        )}

        {/* Gradient accent line */}
        <div className="topbar-v2-accent-line">
          <div className="topbar-v2-accent-line-inner" />
        </div>

        {/* Settings / Data management */}
        <div className="relative" ref={settingsRef}>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`topbar-v2-icon-btn ${showSettings ? 'topbar-v2-icon-btn-active' : ''}`}
            aria-label="Settings"
          >
            <Settings size={16} strokeWidth={1.5} />
          </button>

          {showSettings && (
            <div className="topbar-v2-settings-dropdown">
              <div className="topbar-v2-settings-label">Data Management</div>
              <button
                onClick={() => importInputRef.current?.click()}
                className="topbar-v2-settings-item"
              >
                <Upload size={13} strokeWidth={1.5} />
                <span>导入 JSON</span>
              </button>
              <button onClick={handleExport} className="topbar-v2-settings-item">
                <Download size={13} strokeWidth={1.5} />
                <span>导出备份</span>
              </button>
              <button onClick={handleExportExcel} className="topbar-v2-settings-item">
                <Download size={13} strokeWidth={1.5} />
                <span>导出 Excel</span>
              </button>
              <div className="topbar-v2-settings-divider" />
              <div className="topbar-v2-settings-version">v5.8</div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
