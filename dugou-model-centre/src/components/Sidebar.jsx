import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { 
  ChevronLeft,
  ChevronRight,
  Upload,
  Download,
} from 'lucide-react'
import { exportDataBundle, getInvestments, importDataBundle } from '../lib/localData'
import { exportDataBundleAsExcel } from '../lib/excel'
import HdcsC19Logo from './HdcsC19Logo'

export default function Sidebar({ collapsed, onToggleCollapse }) {
  const [showDataMenu, setShowDataMenu] = useState(false)
  const [expandedItems, setExpandedItems] = useState({
    dashboard: true,
    history: true,
  })
  const [dataVersion, setDataVersion] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const importInputRef = useRef(null)

  useEffect(() => {
    const onDataChanged = () => setDataVersion((prev) => prev + 1)
    window.addEventListener('dugou:data-changed', onDataChanged)
    return () => window.removeEventListener('dugou:data-changed', onDataChanged)
  }, [])

  const stats = useMemo(() => {
    const investments = getInvestments()
    return {
      pendingCount: investments.filter((item) => item.status === 'pending').length,
      totalCount: investments.length,
    }
  }, [dataVersion])

  const navItems = useMemo(
    () => [
      { id: 'new', path: '/new', label: '新建投资', iconChar: '◈' },
      { id: 'combo', path: '/combo', label: '智能组合', iconChar: '❖' },
      { id: 'settle', path: '/settle', label: '待结算', badge: String(stats.pendingCount), highlight: true, iconChar: '◉' },
      {
        id: 'dashboard',
        path: '/dashboard',
        label: 'Dashboard',
        iconChar: '◐',
        children: [
          { id: 'analysis', path: '/dashboard/analysis', label: '深度分析', iconChar: '◇' },
          { id: 'metrics', path: '/dashboard/metrics', label: '数据总览', iconChar: '▤' },
        ],
      },
      {
        id: 'history',
        path: '/history',
        label: '历史记录',
        badge: String(stats.totalCount),
        iconChar: '☰',
        children: [{ id: 'teams', path: '/history/teams', label: '球队档案馆', iconChar: '⚑' }],
      },
      { id: 'params', path: '/params', label: '参数后台', iconChar: '⚙' },
    ],
    [stats.pendingCount, stats.totalCount],
  )

  const toggleExpand = (itemId) => {
    setExpandedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }))
  }

  const isActive = (path) => {
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  const isChildActive = (children) => {
    return children?.some(child => location.pathname === child.path)
  }

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
  }

  const handleExportExcel = () => {
    exportDataBundleAsExcel('dugou-data')
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
    <div className={`h-screen bg-gradient-to-b from-stone-50 to-orange-50/30 border-r border-stone-200/60 flex flex-col transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'}`}>
      {/* Brand — Solo C19 Logo */}
      <div className="sidebar-brand-solo">
        <HdcsC19Logo size="md" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar">
        {navItems.map(item => {
          const parentActive = isActive(item.path) && !isChildActive(item.children)
          const hasSplitToggle = Boolean(item.children && !collapsed)
          return (
          <div key={item.id}>
            {/* Main nav item */}
            {hasSplitToggle ? (
              <div
                className={`sidebar-item w-full flex items-center rounded-xl text-sm transition-all
                  ${parentActive
                    ? 'bg-white shadow-sm text-stone-800'
                    : 'text-stone-500 hover:bg-white/60 hover:text-stone-700'}`}
              >
                <button
                  onClick={() => navigate(item.path)}
                  className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 pr-1"
                >
                  <span className={`text-base ${parentActive ? 'text-amber-500' : 'text-stone-400'}`}>
                    {item.iconChar}
                  </span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <span className={`ml-1 mr-0 text-[10px] px-2 py-0.5 rounded-full font-medium
                      ${item.highlight
                        ? 'bg-amber-100 text-amber-600'
                        : 'text-stone-400'}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => toggleExpand(item.id)}
                  aria-label={expandedItems[item.id] ? `折叠${item.label}` : `展开${item.label}`}
                  className={`ml-0.5 mr-1 px-1.5 py-2.5 text-[11.75px] leading-none transition-colors
                    ${expandedItems[item.id] ? 'text-stone-400/80' : 'text-stone-300 hover:text-stone-400/80'}`}
                >
                  {expandedItems[item.id] ? '▼' : '▲'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => navigate(item.path)}
                className={`sidebar-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all
                  ${parentActive
                    ? 'bg-white shadow-sm text-stone-800'
                    : 'text-stone-500 hover:bg-white/60 hover:text-stone-700'}`}
              >
                <span className={`text-base ${parentActive ? 'text-amber-500' : 'text-stone-400'}`}>
                  {item.iconChar}
                </span>

                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>

                    {item.badge && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium
                        ${item.highlight
                          ? 'bg-amber-100 text-amber-600'
                          : 'text-stone-400'}`}>
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </button>
            )}

            {/* Children */}
            {item.children && !collapsed && expandedItems[item.id] && (
              <div className="ml-8 mt-1 space-y-1">
                {item.children.map(child => (
                  <button
                    key={child.id}
                    onClick={() => navigate(child.path)}
                    className={`sidebar-item w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all
                      ${location.pathname === child.path 
                        ? 'bg-amber-50 text-amber-700' 
                        : 'text-stone-400 hover:text-stone-600 hover:bg-stone-50'}`}
                  >
                    <span>{child.iconChar}</span>
                    <span>{child.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          )
        })}
      </nav>

      {/* Bottom Section */}
      <div className="p-3 border-t border-stone-200/40 space-y-1">
        {/* Data Management */}
        {!collapsed && (
          <div className="relative">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="hidden"
            />
            <button 
              onClick={() => setShowDataMenu(!showDataMenu)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-stone-500 hover:text-stone-700 hover:bg-white/60 transition-all text-sm"
            >
              <span className="text-stone-400">⇄</span>
              <span>数据管理</span>
              <span className="ml-auto text-xs">{showDataMenu ? '▲' : '▼'}</span>
            </button>
            
            {showDataMenu && (
              <div className="mt-1 space-y-1 animate-fade-in">
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-stone-500 hover:text-amber-600 hover:bg-amber-50 transition-all text-xs"
                >
                  <Upload size={14} />
                  <span>导入 JSON</span>
                </button>
                <button
                  onClick={handleExport}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-stone-500 hover:text-amber-600 hover:bg-amber-50 transition-all text-xs"
                >
                  <Download size={14} />
                  <span>导出备份</span>
                </button>
                <button
                  onClick={handleExportExcel}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-stone-500 hover:text-amber-600 hover:bg-amber-50 transition-all text-xs"
                >
                  <Download size={14} />
                  <span>导出 Excel</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Collapse Toggle */}
        <button 
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-white/60 transition-all text-xs"
        >
          {collapsed ? (
            <ChevronRight size={16} />
          ) : (
            <>
              <ChevronLeft size={16} />
              <span>收起</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
