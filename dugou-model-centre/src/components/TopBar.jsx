import { useLocation } from 'react-router-dom'

const PAGE_LABELS = {
  '/': 'New Investment',
  '/new': 'New Investment',
  '/combo': 'Smart Portfolio',
  '/settle': 'Settlement',
  '/dashboard': 'Dashboard',
  '/dashboard/analysis': 'Deep Analysis',
  '/dashboard/metrics': 'Metrics Overview',
  '/history': 'History',
  '/history/teams': 'Team Archive',
  '/params': 'Parameters',
}

export default function TopBar() {
  const location = useLocation()
  const pageLabel = PAGE_LABELS[location.pathname] || ''

  return (
    <div className="topbar">
      <div className="topbar-left">
        {pageLabel && (
          <span className="topbar-page-label">{pageLabel}</span>
        )}
        <span className="topbar-subtitle">
          <span className="topbar-subtitle-accent">Quantitative Calibration & Tracking Engine</span>
          {' '}for Predictive Sports Positioning
        </span>
      </div>

      {/* Thin gradient line — atmospheric accent */}
      <div className="topbar-gradient-line">
        <div className="topbar-gradient-line-inner" />
      </div>
    </div>
  )
}
