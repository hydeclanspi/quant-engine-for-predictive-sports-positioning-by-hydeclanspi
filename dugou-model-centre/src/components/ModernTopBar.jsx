import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  PlusCircle,
  LayoutGrid,
  Clock,
  BarChart3,
  History,
  ChevronDown,
  TrendingUp,
  FileText,
  Flag,
} from 'lucide-react'
import { getInvestments } from '../lib/localData'
import WaxSealS2Logo from './WaxSealS2Logo'

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
    children: [
      { id: 'history-main', path: '/history', label: 'Records', Icon: History },
      { id: 'teams', path: '/history/teams', label: 'Teams', Icon: Flag },
    ],
  },
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
  '/params': 'Console',
}

const ConsoleIcon = ({ size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <rect x="2.25" y="3" width="15.5" height="13.5" rx="3" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.8 7.2H14.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5.8 10H10.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M5.8 12.8H12.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M13.7 10L14.9 11.2L16.6 8.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function ModernTopBar() {
  const [openDropdown, setOpenDropdown] = useState(null)
  const [dataVersion, setDataVersion] = useState(0)
  const dropdownRef = useRef(null)
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
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    setOpenDropdown(null)
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

  return (
    <header className="mn-bar">
      {/* ── Brand ── */}
      <button className="mn-brand" onClick={() => navigate('/new')}>
        <WaxSealS2Logo size="sm" />
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

        {/* Console — direct nav link (replaces gear icon dropdown) */}
        <button
          onClick={() => navigate('/params')}
          className={`mn-settings-link ${location.pathname === '/params' ? 'mn-settings-link-active' : ''}`}
        >
          <ConsoleIcon size={14} />
          <span>Console</span>
        </button>
      </div>
    </header>
  )
}
