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
  Settings,
  TrendingUp,
  FileText,
  Flag,
  Upload,
  Download,
  Dot,
} from 'lucide-react'
import { exportDataBundle, getInvestments, importDataBundle } from '../lib/localData'
import { exportDataBundleAsExcel } from '../lib/excel'

/* ──────────────────────────────────────────────────
   Modern Navigation — Vercel/Linear design language
   Near-monochrome · surgical accent · extreme clarity
   ────────────────────────────────────────────────── */

const NAV_ITEMS = [
  { id: 'new', path: '/new', label: 'New', Icon: PlusCircle },
  { id: 'combo', path: '/combo', label: 'Portfolio', Icon: LayoutGrid },
  { id: 'settle', path: '/settle', label: 'Settle', Icon: Clock, showBadge: 'pending' },
  {
    id: 'dashboard',
    path: '/dashboard',
    label: 'Dashboard',
    Icon: BarChart3,
    children: [
      { id: 'dashboard-main', path: '/dashboard', label: 'Overview', Icon: BarChart3 },
      { id: 'analysis', path: '/dashboard/analysis', label: 'Analysis', Icon: TrendingUp },
      { id: 'metrics', path: '/dashboard/metrics', label: 'Metrics', Icon: FileText },
    ],
  },
  {
    id: 'history',
    path: '/history',
    label: 'History',
    Icon: History,
    showBadge: 'total',
    children: [
      { id: 'history-main', path: '/history', label: 'Records', Icon: History },
      { id: 'teams', path: '/history/teams', label: 'Teams', Icon: Flag },
    ],
  },
  { id: 'params', path: '/params', label: 'Settings', Icon: SlidersHorizontal },
]

const PAGE_TITLES = {
  '/': 'New Investment',
  '/new': 'New Investment',
  '/combo': 'Smart Portfolio',
  '/settle': 'Settlement',
  '/dashboard': 'Dashboard',
  '/dashboard/analysis': 'Deep Analysis',
  '/dashboard/metrics': 'Metrics',
  '/history': 'History',
  '/history/teams': 'Team Archive',
  '/params': 'Settings',
}

export default function ModernTopBar() {
  const [openDropdown, setOpenDropdown] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const dropdownRef = useRef(null)
  const settingsRef = useRef(null)
  const importInputRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const onDataChanged = () => setDataVersion((prev) => prev + 1)
    window.addEventListener('dugou:data-changed', onDataChanged)
    return () => window.removeEventListener('dugou:data-changed', onDataChanged)
  }, [])

  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpenDropdown(null)
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setShowSettings(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    setOpenDropdown(null)
    setShowSettings(false)
  }, [location.pathname])

  const stats = useMemo(() => {
    const investments = getInvestments()
    return {
      pendingCount: investments.filter((i) => i.status === 'pending').length,
      totalCount: investments.length,
    }
  }, [dataVersion])

  const isActive = (path) => {
    if (path === '/new' && (location.pathname === '/' || location.pathname === '/new')) return true
    return location.pathname === path
  }

  const isGroupActive = (item) => {
    if (isActive(item.path)) return true
    return item.children?.some((c) => location.pathname === c.path)
  }

  const getBadge = (item) => {
    if (item.showBadge === 'pending') return stats.pendingCount > 0 ? stats.pendingCount : null
    if (item.showBadge === 'total') return stats.totalCount > 0 ? stats.totalCount : null
    return null
  }

  const pageTitle = PAGE_TITLES[location.pathname] || ''

  /* Data management */
  const handleExport = () => {
    const bundle = exportDataBundle()
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `dugou-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
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
      const ok = importDataBundle(parsed, shouldMerge ? 'merge' : 'replace')
      if (!ok) { window.alert('导入失败：文件结构不正确。'); return }
      window.alert(shouldMerge ? '导入成功（合并模式）' : '导入成功（覆盖模式）')
      setDataVersion((prev) => prev + 1)
    } catch { window.alert('导入失败') }
    finally { event.target.value = '' }
  }

  return (
    <header className="mn-bar">
      {/* ── Brand ── */}
      <button className="mn-brand" onClick={() => navigate('/new')}>
        <div className="mn-brand-mark">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="0.5" y="0.5" width="19" height="19" rx="5" stroke="#6366f1" strokeWidth="1.2" />
            <rect x="4" y="4" width="12" height="12" rx="3" fill="#6366f1" opacity="0.1" />
            <rect x="6.5" y="6.5" width="7" height="7" rx="2" fill="url(#mnBrandGrad)" />
            <defs>
              <linearGradient id="mnBrandGrad" x1="6.5" y1="6.5" x2="13.5" y2="13.5" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366f1" />
                <stop offset="1" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <span className="mn-brand-name">dugou</span>
      </button>

      {/* ── Breadcrumb separator ── */}
      <span className="mn-sep">/</span>

      {/* ── Page context ── */}
      <span className="mn-page-title">{pageTitle}</span>

      {/* ── Separator ── */}
      <div className="h-4 w-px bg-gradient-to-b from-transparent via-neutral-200 to-transparent mx-2 flex-shrink-0" />

      {/* ── Nav ── */}
      <nav className="mn-nav" ref={dropdownRef}>
        {NAV_ITEMS.map((item) => {
          const active = isGroupActive(item)
          const badge = getBadge(item)
          const hasChildren = item.children && item.children.length > 0

          return (
            <div key={item.id} className="mn-nav-group">
              <button
                onClick={() => {
                  if (hasChildren) {
                    setOpenDropdown(openDropdown === item.id ? null : item.id)
                  } else {
                    navigate(item.path)
                  }
                }}
                className={`mn-nav-item ${active ? 'mn-nav-active' : ''}`}
              >
                <span>{item.label}</span>
                {badge != null && <span className="mn-badge">{badge}</span>}
                {hasChildren && (
                  <ChevronDown
                    size={12}
                    strokeWidth={1.5}
                    className={`mn-chevron ${openDropdown === item.id ? 'mn-chevron-open' : ''}`}
                  />
                )}
              </button>

              {hasChildren && openDropdown === item.id && (
                <div className="mn-dropdown">
                  {item.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => { navigate(child.path); setOpenDropdown(null) }}
                      className={`mn-dropdown-item ${isActive(child.path) ? 'mn-dropdown-active' : ''}`}
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

      {/* ── Right ── */}
      <div className="mn-right">
        {/* Status indicator dot — alive pulse */}
        <div className="mn-status-dot" title="System active">
          <div className="mn-status-dot-ping" />
          <div className="mn-status-dot-core" />
        </div>

        {/* Settings */}
        <div className="relative" ref={settingsRef}>
          <input ref={importInputRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`mn-icon-btn ${showSettings ? 'mn-icon-btn-active' : ''}`}
          >
            <Settings size={15} strokeWidth={1.5} />
          </button>

          {showSettings && (
            <div className="mn-dropdown mn-dropdown-right">
              <div className="mn-dropdown-label">Data</div>
              <button onClick={() => importInputRef.current?.click()} className="mn-dropdown-item">
                <Upload size={13} strokeWidth={1.5} />
                <span>Import JSON</span>
              </button>
              <button onClick={handleExport} className="mn-dropdown-item">
                <Download size={13} strokeWidth={1.5} />
                <span>Export Backup</span>
              </button>
              <button onClick={handleExportExcel} className="mn-dropdown-item">
                <Download size={13} strokeWidth={1.5} />
                <span>Export Excel</span>
              </button>
              <div className="mn-dropdown-sep" />
              <div className="mn-dropdown-footer">v6.0 · airy</div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
