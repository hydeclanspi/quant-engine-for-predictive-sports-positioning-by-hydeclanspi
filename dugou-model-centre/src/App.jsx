import { useState, useEffect, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'

// Components
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ModernTopBar from './components/ModernTopBar'
import Modal from './components/Modal'

// Pages
import NewInvestmentPage from './pages/NewInvestmentPage'
import DashboardPage from './pages/DashboardPage'
import HistoryPage from './pages/HistoryPage'
import SettlePage from './pages/SettlePage'
import ComboPage from './pages/ComboPage'
import ParamsPage from './pages/ParamsPage'
import TeamsPage from './pages/TeamsPage'
import AnalysisPage from './pages/AnalysisPage'
import MetricsPage from './pages/MetricsPage'

import { getSystemConfig } from './lib/localData'

const LAYOUT_KEY = 'dugou:layout-mode'
const VALID_MODES = ['topbar', 'sidebar', 'modern']

function App() {
  const [layoutMode, setLayoutMode] = useState(() => {
    const cached = localStorage.getItem(LAYOUT_KEY)
    if (VALID_MODES.includes(cached)) return cached
    const config = getSystemConfig()
    return VALID_MODES.includes(config.layoutMode) ? config.layoutMode : 'modern'
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [modalData, setModalData] = useState(null)
  const mainScrollRef = useRef(null)
  const location = useLocation()

  // Listen for layout mode changes from ParamsPage
  useEffect(() => {
    const onLayoutChange = (e) => {
      const mode = e.detail?.mode
      if (VALID_MODES.includes(mode)) {
        setLayoutMode(mode)
        localStorage.setItem(LAYOUT_KEY, mode)
      }
    }
    window.addEventListener('dugou:layout-changed', onLayoutChange)
    return () => window.removeEventListener('dugou:layout-changed', onLayoutChange)
  }, [])

  // Glow card mouse tracking effect
  useEffect(() => {
    const handleMouseMove = (e) => {
      const cards = document.querySelectorAll('.glow-card')
      cards.forEach(card => {
        const rect = card.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        card.style.setProperty('--mouse-x', `${x}%`)
        card.style.setProperty('--mouse-y', `${y}%`)
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Scroll to top on route change
  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0
    }
  }, [location.pathname])

  const openModal = (data) => setModalData(data)
  const closeModal = () => setModalData(null)

  const pageRoutes = (
    <Routes>
      <Route path="/" element={<NewInvestmentPage openModal={openModal} />} />
      <Route path="/new" element={<NewInvestmentPage openModal={openModal} />} />
      <Route path="/combo" element={<ComboPage openModal={openModal} />} />
      <Route path="/settle" element={<SettlePage openModal={openModal} />} />
      <Route path="/dashboard" element={<DashboardPage openModal={openModal} />} />
      <Route path="/dashboard/analysis" element={<AnalysisPage openModal={openModal} />} />
      <Route path="/dashboard/metrics" element={<MetricsPage openModal={openModal} />} />
      <Route path="/history" element={<HistoryPage openModal={openModal} />} />
      <Route path="/history/teams" element={<TeamsPage openModal={openModal} />} />
      <Route path="/params" element={<ParamsPage openModal={openModal} />} />
    </Routes>
  )

  /* ── Modern layout — Vercel/Linear design language ── */
  if (layoutMode === 'modern') {
    return (
      <div className="flex flex-col h-screen theme-modern" style={{ background: '#f7f8fa' }}>
        <ModernTopBar />
        <main
          ref={mainScrollRef}
          className="flex-1 overflow-auto custom-scrollbar min-w-0"
        >
          <div key={location.pathname} className="page-enter">
            {pageRoutes}
          </div>
        </main>
        {modalData && <Modal data={modalData} onClose={closeModal} />}
      </div>
    )
  }

  /* ── Topbar layout (default) ── */
  if (layoutMode === 'topbar') {
    return (
      <div className="flex flex-col h-screen bg-stone-100/50">
        <TopBar />
        <main
          ref={mainScrollRef}
          className="flex-1 overflow-auto custom-scrollbar min-w-0"
        >
          <div key={location.pathname} className="page-enter">
            {pageRoutes}
          </div>
        </main>
        {modalData && <Modal data={modalData} onClose={closeModal} />}
      </div>
    )
  }

  /* ── Sidebar layout (legacy) ── */
  return (
    <div className="flex h-screen bg-stone-100/50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main
        ref={mainScrollRef}
        className="flex-1 overflow-auto custom-scrollbar min-w-0"
      >
        <div key={location.pathname} className="page-enter">
          {pageRoutes}
        </div>
      </main>
      {modalData && <Modal data={modalData} onClose={closeModal} />}
    </div>
  )
}

export default App
