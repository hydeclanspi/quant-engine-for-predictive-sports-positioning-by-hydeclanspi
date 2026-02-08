import { useState, useEffect, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'

// Components
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
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

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [modalData, setModalData] = useState(null)
  const mainScrollRef = useRef(null)
  const location = useLocation()

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
        {/* Top Header Bar — C2 Ligature Connect (scrolls with content) */}
        <TopBar />

        {/* Page Content — below the header bar */}
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
      </main>

      {modalData && <Modal data={modalData} onClose={closeModal} />}
    </div>
  )
}

export default App
