import React, { useState } from 'react';

// DUGOU Model Centre v5.8 - UI Design Prototype
// Design Direction: Warm, breathable, Notion/Arc-inspired with modern sidebar

const DugouDesign = () => {
  const [activePage, setActivePage] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Sidebar Navigation Component
  const Sidebar = () => (
    <div 
      className={`h-screen bg-gradient-to-b from-stone-50 to-orange-50/30 border-r border-stone-200/60 flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-56'}`}
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* Logo Area */}
      <div className="p-4 border-b border-stone-200/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-200/50">
            <span className="text-white font-bold text-sm">DG</span>
          </div>
          {!sidebarCollapsed && (
            <div>
              <h1 className="font-semibold text-stone-800 text-sm tracking-tight">DUGOU</h1>
              <p className="text-[10px] text-stone-400">Model Centre v5.8</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-3 space-y-1">
        {[
          { id: 'dashboard', icon: '◐', label: 'Dashboard', badge: null },
          { id: 'new', icon: '◈', label: '新建投资', badge: null },
          { id: 'history', icon: '☰', label: '历史记录', badge: '23' },
          { id: 'settle', icon: '◉', label: '待结算', badge: '3' },
          { id: 'combo', icon: '❖', label: '智能组合', badge: null },
          { id: 'params', icon: '⚙', label: '参数后台', badge: null },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 group
              ${activePage === item.id 
                ? 'bg-white shadow-sm shadow-stone-200/50 text-stone-800' 
                : 'text-stone-500 hover:bg-white/60 hover:text-stone-700'}`}
          >
            <span className={`text-base ${activePage === item.id ? 'text-amber-500' : 'text-stone-400 group-hover:text-stone-500'}`}>
              {item.icon}
            </span>
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge && (
                  <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-600 font-medium">
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="p-3 border-t border-stone-200/40">
        <button 
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-white/60 transition-all text-xs"
        >
          {sidebarCollapsed ? '→' : '← 收起'}
        </button>
      </div>
    </div>
  );

  // Dashboard Page
  const DashboardPage = () => (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-stone-800" style={{ fontFamily: "'Playfair Display', serif" }}>
            Dashboard
          </h2>
          <p className="text-stone-400 text-sm mt-1">2026年2月 · 本月投资 12 笔</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800 transition-colors">
            导出报告
          </button>
          <button className="px-5 py-2.5 bg-gradient-to-r from-amber-400 to-orange-400 text-white rounded-xl text-sm font-medium shadow-lg shadow-orange-200/40 hover:shadow-orange-300/50 transition-all">
            + 新建投资
          </button>
        </div>
      </div>

      {/* Key Metrics Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '蓄水池余额', value: '¥2,847', change: '+18.2%', positive: true, icon: '◐' },
          { label: '本月 ROI', value: '+12.4%', change: '↑ 3.1%', positive: true, icon: '◈' },
          { label: '命中率', value: '67.3%', change: '稳定', positive: true, icon: '◉' },
          { label: 'Exp. vs Act. Rating', value: '0.92', change: '校准良好', positive: true, icon: '❖' },
        ].map((metric, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 border border-stone-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-stone-400 text-xs uppercase tracking-wide">{metric.label}</span>
              <span className="text-amber-400 text-lg">{metric.icon}</span>
            </div>
            <div className="text-2xl font-semibold text-stone-800">{metric.value}</div>
            <div className={`text-xs mt-1 ${metric.positive ? 'text-emerald-500' : 'text-rose-500'}`}>
              {metric.change}
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Main Chart - 资金走势 */}
        <div className="col-span-2 bg-white rounded-2xl p-6 border border-stone-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-medium text-stone-700">资金走势</h3>
            <div className="flex gap-2">
              {['7D', '1M', '3M', 'ALL'].map(period => (
                <button key={period} className={`px-3 py-1 text-xs rounded-lg transition-all ${period === '1M' ? 'bg-amber-100 text-amber-700' : 'text-stone-400 hover:bg-stone-50'}`}>
                  {period}
                </button>
              ))}
            </div>
          </div>
          {/* Fake Chart */}
          <div className="h-48 flex items-end gap-1 px-4">
            {[40, 45, 42, 55, 48, 62, 58, 70, 65, 75, 72, 85, 80, 88, 92].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div 
                  className="w-full rounded-t-sm bg-gradient-to-t from-amber-400 to-orange-300 opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
                  style={{ height: `${h}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-4 px-4 text-xs text-stone-400">
            <span>1月18日</span>
            <span>1月25日</span>
            <span>2月1日</span>
          </div>
        </div>

        {/* Side Panel - Conf 校准曲线 */}
        <div className="bg-white rounded-2xl p-6 border border-stone-100">
          <h3 className="font-medium text-stone-700 mb-4">Conf 校准曲线</h3>
          <div className="space-y-3">
            {[
              { conf: '0.8+', expected: '80%', actual: '76%', samples: 12 },
              { conf: '0.6-0.8', expected: '70%', actual: '68%', samples: 28 },
              { conf: '0.4-0.6', expected: '50%', actual: '52%', samples: 35 },
              { conf: '0.2-0.4', expected: '30%', actual: '34%', samples: 18 },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-stone-500 w-14">{row.conf}</span>
                <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-300 to-orange-400 rounded-full" style={{ width: row.actual }} />
                </div>
                <span className="text-xs text-stone-600 w-10">{row.actual}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-stone-400 mt-4 text-center">整体校准偏差: -2.3%</p>
        </div>
      </div>

      {/* Bottom Row - 优势领域 & 近期记录 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 优势领域识别 */}
        <div className="bg-white rounded-2xl p-6 border border-stone-100">
          <h3 className="font-medium text-stone-700 mb-4">优势领域识别</h3>
          <div className="space-y-2">
            {[
              { combo: 'Conf 0.6+ × 常规模式 × 英超', roi: '+23.4%', samples: 18, color: 'emerald' },
              { combo: 'TYS-M × FID 0.5+ × 单关', roi: '+18.7%', samples: 24, color: 'amber' },
              { combo: 'Conf 0.4-0.6 × 保险产品', roi: '+15.2%', samples: 15, color: 'sky' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-stone-50 hover:bg-stone-100/80 transition-colors cursor-pointer">
                <div>
                  <p className="text-sm text-stone-700">{item.combo}</p>
                  <p className="text-xs text-stone-400 mt-0.5">{item.samples} samples</p>
                </div>
                <span className={`text-sm font-medium text-${item.color}-600`}>{item.roi}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 近期投资 */}
        <div className="bg-white rounded-2xl p-6 border border-stone-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-stone-700">近期投资</h3>
            <button className="text-xs text-amber-500 hover:text-amber-600">查看全部 →</button>
          </div>
          <div className="space-y-2">
            {[
              { match: 'ARS vs CHE', entries: '主胜', status: 'pending', amount: '¥180' },
              { match: 'LIV vs MCI', entries: '大2.5', status: 'win', amount: '+¥220' },
              { match: 'TOT vs MUN', entries: '平局', status: 'lose', amount: '-¥150' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-stone-50 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    item.status === 'pending' ? 'bg-amber-400' : 
                    item.status === 'win' ? 'bg-emerald-400' : 'bg-rose-400'
                  }`} />
                  <div>
                    <p className="text-sm text-stone-700">{item.match}</p>
                    <p className="text-xs text-stone-400">{item.entries}</p>
                  </div>
                </div>
                <span className={`text-sm font-medium ${
                  item.status === 'win' ? 'text-emerald-600' : 
                  item.status === 'lose' ? 'text-rose-500' : 'text-stone-600'
                }`}>{item.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // New Investment Page
  const NewInvestmentPage = () => (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-stone-800" style={{ fontFamily: "'Playfair Display', serif" }}>
          新建投资
        </h2>
        <p className="text-stone-400 text-sm mt-1">录入比赛信息与预测参数</p>
      </div>

      {/* Main Form Card */}
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        {/* Parlay Selector */}
        <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-4">
            <span className="text-sm text-stone-600">串关数</span>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button 
                  key={n}
                  className={`w-10 h-10 rounded-xl text-sm font-medium transition-all ${
                    n === 1 
                      ? 'bg-gradient-to-br from-amber-400 to-orange-400 text-white shadow-lg shadow-orange-200/40' 
                      : 'bg-white border border-stone-200 text-stone-500 hover:border-amber-300 hover:text-amber-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-stone-400 ml-2">（1 = 单场投资）</span>
          </div>
        </div>

        {/* Match Section */}
        <div className="p-6 space-y-6">
          {/* Match Header */}
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center">
              <span className="text-amber-600 text-xs font-bold">1</span>
            </div>
            <span className="text-sm font-medium text-stone-700">比赛信息</span>
          </div>

          {/* Teams Input */}
          <div className="grid grid-cols-11 gap-3 items-center">
            <div className="col-span-5">
              <label className="text-xs text-stone-400 mb-1.5 block">主队</label>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="输入球队名或缩写..."
                  className="w-full px-4 py-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                  defaultValue="ARS"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">
                  阿森纳 · 18场 · REP 0.42
                </div>
              </div>
            </div>
            <div className="col-span-1 text-center text-stone-300 text-lg">vs</div>
            <div className="col-span-5">
              <label className="text-xs text-stone-400 mb-1.5 block">客队</label>
              <input 
                type="text" 
                placeholder="输入球队名或缩写..."
                className="w-full px-4 py-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                defaultValue="CHE"
              />
            </div>
          </div>

          {/* Core Params Row */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-stone-400 mb-1.5 block">Entries 预测结果</label>
              <input 
                type="text" 
                placeholder="主胜 / 平 / 客胜 / 大2.5..."
                className="w-full px-4 py-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                defaultValue="主胜"
              />
            </div>
            <div>
              <label className="text-xs text-stone-400 mb-1.5 block">Odds 赔率</label>
              <input 
                type="number" 
                step="0.01"
                className="w-full px-4 py-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
                defaultValue="2.15"
              />
            </div>
            <div>
              <label className="text-xs text-stone-400 mb-1.5 block">Conf 置信度</label>
              <div className="relative">
                <input 
                  type="range" 
                  min="0" max="100" 
                  defaultValue="65"
                  className="w-full h-2 bg-stone-100 rounded-full appearance-none cursor-pointer accent-amber-500"
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-stone-400">0</span>
                  <span className="text-sm font-medium text-amber-600">0.65</span>
                  <span className="text-xs text-stone-400">1</span>
                </div>
              </div>
            </div>
          </div>

          {/* Calibration Params */}
          <div className="pt-4 border-t border-stone-100">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm font-medium text-stone-700">校准参数</span>
              <span className="text-xs text-stone-400">影响建议金额的系数</span>
            </div>

            <div className="grid grid-cols-4 gap-4">
              {/* Mode */}
              <div>
                <label className="text-xs text-stone-400 mb-1.5 block">Mode 模式</label>
                <select className="w-full px-3 py-3 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400 bg-white">
                  <option>常规</option>
                  <option>常规-稳</option>
                  <option>常规-杠杆</option>
                  <option>半彩票半保险</option>
                  <option>保险产品</option>
                  <option>赌一把</option>
                </select>
              </div>

              {/* TYS Home */}
              <div>
                <label className="text-xs text-stone-400 mb-1.5 block">TYS-base (主)</label>
                <div className="flex gap-1">
                  {['S', 'M', 'L', 'H'].map(v => (
                    <button key={v} className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${
                      v === 'M' 
                        ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                        : 'bg-stone-50 text-stone-500 border border-stone-100 hover:border-stone-200'
                    }`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* TYS Away */}
              <div>
                <label className="text-xs text-stone-400 mb-1.5 block">TYS-base (客)</label>
                <div className="flex gap-1">
                  {['S', 'M', 'L', 'H'].map(v => (
                    <button key={v} className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${
                      v === 'L' 
                        ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                        : 'bg-stone-50 text-stone-500 border border-stone-100 hover:border-stone-200'
                    }`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* FID */}
              <div>
                <label className="text-xs text-stone-400 mb-1.5 block">FID 信息深度</label>
                <div className="flex gap-1">
                  {['0', '0.25', '0.5', '0.75'].map(v => (
                    <button key={v} className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all ${
                      v === '0.5' 
                        ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                        : 'bg-stone-50 text-stone-500 border border-stone-100 hover:border-stone-200'
                    }`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* FSE */}
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="text-xs text-stone-400 mb-1.5 block">FSE (主) Feature Sensor</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="range" 
                    min="0" max="100" 
                    defaultValue="70"
                    className="flex-1 h-2 bg-stone-100 rounded-full appearance-none cursor-pointer accent-amber-500"
                  />
                  <span className="text-sm font-medium text-stone-600 w-10">0.70</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-stone-400 mb-1.5 block">FSE (客) Feature Sensor</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="range" 
                    min="0" max="100" 
                    defaultValue="55"
                    className="flex-1 h-2 bg-stone-100 rounded-full appearance-none cursor-pointer accent-amber-500"
                  />
                  <span className="text-sm font-medium text-stone-600 w-10">0.55</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Result Panel */}
        <div className="px-6 py-5 bg-gradient-to-r from-stone-50 to-orange-50/30 border-t border-stone-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <div>
                <span className="text-xs text-stone-400 block">Expected Rating</span>
                <span className="text-xl font-semibold text-stone-800">0.62</span>
              </div>
              <div className="w-px h-10 bg-stone-200" />
              <div>
                <span className="text-xs text-stone-400 block">Recom. Invest</span>
                <span className="text-xl font-semibold text-amber-600">¥ 185</span>
              </div>
              <div className="w-px h-10 bg-stone-200" />
              <div>
                <span className="text-xs text-stone-400 block">风控上限</span>
                <span className="text-sm text-stone-500">¥ 341 (12%)</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div>
                <label className="text-xs text-stone-400 mb-1 block">Inputs 实际投资</label>
                <input 
                  type="number"
                  className="w-28 px-3 py-2 rounded-xl border border-stone-200 text-sm font-medium focus:outline-none focus:border-amber-400"
                  defaultValue="180"
                />
              </div>
              <button className="px-6 py-3 bg-gradient-to-r from-amber-400 to-orange-400 text-white rounded-xl text-sm font-medium shadow-lg shadow-orange-200/40 hover:shadow-orange-300/50 transition-all">
                确认投资
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // History Page (Simplified)
  const HistoryPage = () => (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-stone-800" style={{ fontFamily: "'Playfair Display', serif" }}>
            历史记录
          </h2>
          <p className="text-stone-400 text-sm mt-1">共 93 条投资记录</p>
        </div>
        <div className="flex items-center gap-3">
          <input 
            type="text"
            placeholder="搜索球队、日期..."
            className="px-4 py-2 rounded-xl border border-stone-200 text-sm w-64 focus:outline-none focus:border-amber-400"
          />
          <button className="px-4 py-2 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50">
            筛选
          </button>
        </div>
      </div>

      {/* Filter Tags */}
      <div className="flex gap-2 mb-4">
        {['全部', '待结算', '已中', '未中', '单关', '串关'].map((tag, i) => (
          <button key={tag} className={`px-4 py-1.5 rounded-full text-sm transition-all ${
            i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
          }`}>
            {tag}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-stone-50 text-xs text-stone-500">
              <th className="px-4 py-3 text-left font-medium">日期</th>
              <th className="px-4 py-3 text-left font-medium">比赛</th>
              <th className="px-4 py-3 text-left font-medium">Entries</th>
              <th className="px-4 py-3 text-left font-medium">Odds</th>
              <th className="px-4 py-3 text-left font-medium">Conf</th>
              <th className="px-4 py-3 text-left font-medium">Inputs</th>
              <th className="px-4 py-3 text-left font-medium">状态</th>
              <th className="px-4 py-3 text-left font-medium">盈亏</th>
            </tr>
          </thead>
          <tbody>
            {[
              { date: '02-02', match: 'ARS vs CHE', entries: '主胜', odds: 2.15, conf: 0.65, inputs: 180, status: 'pending', profit: '-' },
              { date: '02-01', match: 'LIV vs MCI', entries: '大2.5', odds: 1.85, conf: 0.72, inputs: 200, status: 'win', profit: '+170' },
              { date: '01-31', match: 'TOT vs MUN', entries: '平局', odds: 3.40, conf: 0.42, inputs: 120, status: 'lose', profit: '-120' },
              { date: '01-30', match: 'NEW vs AVL', entries: '客胜', odds: 2.60, conf: 0.55, inputs: 150, status: 'win', profit: '+240' },
            ].map((row, i) => (
              <tr key={i} className="border-t border-stone-100 hover:bg-stone-50/50 cursor-pointer transition-colors">
                <td className="px-4 py-3 text-sm text-stone-500">{row.date}</td>
                <td className="px-4 py-3 text-sm font-medium text-stone-700">{row.match}</td>
                <td className="px-4 py-3 text-sm text-stone-600">{row.entries}</td>
                <td className="px-4 py-3 text-sm text-stone-600">{row.odds}</td>
                <td className="px-4 py-3 text-sm text-stone-600">{row.conf}</td>
                <td className="px-4 py-3 text-sm text-stone-600">¥{row.inputs}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    row.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    row.status === 'win' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-rose-100 text-rose-700'
                  }`}>
                    {row.status === 'pending' ? '待结算' : row.status === 'win' ? '已中' : '未中'}
                  </span>
                </td>
                <td className={`px-4 py-3 text-sm font-medium ${
                  row.profit === '-' ? 'text-stone-400' :
                  row.profit.startsWith('+') ? 'text-emerald-600' : 'text-rose-500'
                }`}>{row.profit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Smart Combo Page
  const ComboPage = () => (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800" style={{ fontFamily: "'Playfair Display', serif" }}>
          智能组合建议
        </h2>
        <p className="text-stone-400 text-sm mt-1">基于 Portfolio Optimization 的最优下注方案</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left - Input Matches */}
        <div className="bg-white rounded-2xl border border-stone-100 p-6">
          <h3 className="font-medium text-stone-700 mb-4">今日备选比赛</h3>
          <div className="space-y-3">
            {[
              { match: 'ARS vs CHE', conf: 0.65, odds: 2.15, ev: '+8.2%' },
              { match: 'LIV vs MCI', conf: 0.58, odds: 1.95, ev: '+5.1%' },
              { match: 'BAR vs RMA', conf: 0.45, odds: 2.80, ev: '+3.6%' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex items-center gap-3">
                  <input type="checkbox" defaultChecked className="w-4 h-4 accent-amber-500" />
                  <div>
                    <p className="text-sm font-medium text-stone-700">{item.match}</p>
                    <p className="text-xs text-stone-400">Conf {item.conf} · Odds {item.odds}</p>
                  </div>
                </div>
                <span className="text-sm font-medium text-emerald-600">{item.ev}</span>
              </div>
            ))}
          </div>

          {/* Risk Preference */}
          <div className="mt-6 pt-6 border-t border-stone-100">
            <label className="text-sm text-stone-600 mb-3 block">风险偏好</label>
            <div className="flex items-center gap-4">
              <span className="text-xs text-stone-400">保守</span>
              <input 
                type="range" 
                min="0" max="100" 
                defaultValue="50"
                className="flex-1 h-2 bg-stone-100 rounded-full appearance-none cursor-pointer accent-amber-500"
              />
              <span className="text-xs text-stone-400">激进</span>
            </div>
          </div>

          <button className="w-full mt-6 py-3 bg-gradient-to-r from-amber-400 to-orange-400 text-white rounded-xl text-sm font-medium shadow-lg shadow-orange-200/40">
            生成最优组合
          </button>
        </div>

        {/* Right - Recommendations */}
        <div className="bg-white rounded-2xl border border-stone-100 p-6">
          <h3 className="font-medium text-stone-700 mb-4">推荐方案</h3>
          
          <div className="space-y-3">
            {[
              { tier: 'T1 主推', combo: 'ARS主胜 × LIV大2.5', allocation: '¥280', ev: '+12.4%', sharpe: '1.82' },
              { tier: 'T2 次推', combo: 'ARS主胜 单关', allocation: '¥180', ev: '+8.2%', sharpe: '1.45' },
              { tier: 'T3 博冷', combo: '三串一', allocation: '¥60', ev: '+18.7%', sharpe: '0.92' },
            ].map((item, i) => (
              <div key={i} className={`p-4 rounded-xl border ${i === 0 ? 'border-amber-200 bg-amber-50/50' : 'border-stone-100 bg-stone-50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-medium ${i === 0 ? 'text-amber-600' : 'text-stone-500'}`}>{item.tier}</span>
                  <span className="text-sm font-semibold text-stone-800">{item.allocation}</span>
                </div>
                <p className="text-sm text-stone-700 mb-2">{item.combo}</p>
                <div className="flex gap-4 text-xs text-stone-500">
                  <span>EV: <span className="text-emerald-600">{item.ev}</span></span>
                  <span>Sharpe: {item.sharpe}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-4 rounded-xl bg-stone-50 border border-stone-100">
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">总投资</span>
              <span className="font-semibold text-stone-800">¥520</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-stone-500">组合 EV</span>
              <span className="font-medium text-emerald-600">+11.2%</span>
            </div>
          </div>

          <button className="w-full mt-4 py-3 border border-amber-300 text-amber-600 rounded-xl text-sm font-medium hover:bg-amber-50 transition-colors">
            一键采纳方案
          </button>
        </div>
      </div>
    </div>
  );

  // Params Page (Simplified)
  const ParamsPage = () => (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800" style={{ fontFamily: "'Playfair Display', serif" }}>
          参数后台
        </h2>
        <p className="text-stone-400 text-sm mt-1">系统参数与校准系数配置</p>
      </div>

      {/* Core Display - Exp vs Act Rating */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-6 border border-amber-100 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-amber-600 font-medium">核心指标</span>
            <h3 className="text-lg font-semibold text-stone-800 mt-1">Expected vs Actual Judgmental Rating</h3>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-amber-600">0.92</div>
            <p className="text-xs text-stone-500 mt-1">偏差 -8% · 校准良好</p>
          </div>
        </div>
      </div>

      {/* System Params */}
      <div className="bg-white rounded-2xl border border-stone-100 p-6 mb-4">
        <h3 className="font-medium text-stone-700 mb-4">系统参数</h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: '初始本金', key: 'initial_capital', value: 600, editable: true },
            { label: '风控比例上限', key: 'risk_cap_ratio', value: '12%', editable: true },
            { label: '默认赔率', key: 'default_odds', value: 2.5, editable: true },
            { label: 'Kelly 分母', key: 'kelly_divisor', value: 4, editable: true },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between p-3 rounded-xl bg-stone-50">
              <span className="text-sm text-stone-600">{item.label}</span>
              <input 
                type="text" 
                defaultValue={item.value}
                className="w-20 px-2 py-1 text-right text-sm rounded-lg border border-stone-200 focus:outline-none focus:border-amber-400"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Calibration Factors - Read Only */}
      <div className="bg-white rounded-2xl border border-stone-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-stone-700">动态校准系数</h3>
          <span className="text-xs text-stone-400">基于历史数据自动计算 · 只读</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Conf Factor', value: '1.08' },
            { label: 'Mode Factor', value: '0.95' },
            { label: 'TYS Factor', value: '1.02' },
            { label: 'FID Factor', value: '1.12' },
            { label: 'Odds Factor', value: '0.98' },
            { label: 'FSE Factor', value: '1.05' },
          ].map(item => (
            <div key={item.label} className="p-3 rounded-xl bg-stone-50 text-center">
              <span className="text-xs text-stone-400 block">{item.label}</span>
              <span className="text-lg font-semibold text-stone-700">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // Render current page
  const renderPage = () => {
    switch(activePage) {
      case 'dashboard': return <DashboardPage />;
      case 'new': return <NewInvestmentPage />;
      case 'history': return <HistoryPage />;
      case 'combo': return <ComboPage />;
      case 'params': return <ParamsPage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <div className="flex h-screen bg-stone-100/50" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap');
      `}</style>
      
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
    </div>
  );
};

export default DugouDesign;
