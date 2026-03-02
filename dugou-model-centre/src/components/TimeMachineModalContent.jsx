import { Plus, X, RotateCcw, Archive, Database } from 'lucide-react'

/**
 * 高端时光穿越机弹窗内容组件
 * 设计风格：Google Gemini + 硅谷科技感 + 精英香槟叙事
 * - GlassCardIcon 高端 icon 设计
 * - 梯度渐变 + 多层阴影
 * - 大气、有张力的排版和间距
 */

// GlassCardIcon 组件 - 高端 icon 容器
const GlassCardIcon = ({ icon: Icon, tone = 'sky', iconSize = 14 }) => {
  const toneClass = {
    sky: 'border-sky-200 bg-gradient-to-b from-sky-50 via-cyan-50 to-white text-sky-600 shadow-[0_1px_2px_rgba(14,165,233,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]',
    indigo:
      'border-indigo-200 bg-gradient-to-b from-indigo-50 via-violet-50 to-white text-indigo-600 shadow-[0_1px_2px_rgba(99,102,241,0.16),inset_0_1px_0_rgba(255,255,255,0.88)]',
    emerald:
      'border-emerald-200 bg-gradient-to-b from-emerald-50 via-teal-50 to-white text-emerald-600 shadow-[0_1px_2px_rgba(16,185,129,0.17),inset_0_1px_0_rgba(255,255,255,0.88)]',
    violet:
      'border-violet-200 bg-gradient-to-b from-violet-50 via-fuchsia-50 to-white text-violet-600 shadow-[0_1px_2px_rgba(139,92,246,0.16),inset_0_1px_0_rgba(255,255,255,0.9)]',
  }

  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-xl border ${toneClass[tone] || toneClass.sky}`}
    >
      <Icon size={iconSize} strokeWidth={1.7} />
    </span>
  )
}

export default function TimeMachineModalContent({
  isInMode,
  sessionInfo,
  snapshots,
  page,
  totalPages,
  loading,
  error,
  manualTitle,
  saveStatus,
  onBeginSession,
  onExitSession,
  onSaveSnapshot,
  onEnsureMonthly,
  onPageChange,
  onTitleChange,
}) {
  return (
    <div className="space-y-6 py-2">
      {/* Current Session Info */}
      {isInMode && sessionInfo && (
        <div className="p-5 rounded-xl bg-gradient-to-br from-blue-100/70 to-cyan-100/60 border border-blue-200/70 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700/70 mb-2">
                当前查阅快照
              </p>
              <p className="text-[14px] font-bold text-blue-900 mb-2">{sessionInfo.title}</p>
              <p className="text-[11px] text-blue-700">{new Date(sessionInfo.snapshotAt).toLocaleString()}</p>
            </div>
            <button
              onClick={onExitSession}
              disabled={loading}
              className="btn-tm-exit"
            >
              <X size={14} strokeWidth={2.5} /> 退出穿越
            </button>
          </div>
        </div>
      )}

      {/* Snapshots List Section */}
      {!isInMode ? (
        <>
          {/* 标题区 */}
          <div className="mb-4">
            <div className="flex items-center gap-2.5 mb-4">
              <GlassCardIcon icon={Database} tone="sky" iconSize={15} />
              <h3 className="text-[13px] font-bold text-stone-800">历史快照库</h3>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-3 p-3.5 rounded-lg bg-red-50/95 border border-red-200/80 text-[11px] text-red-700 font-medium">
                {error}
              </div>
            )}

            {/* 快照列表 */}
            {loading && snapshots.length === 0 ? (
              <div className="py-8 text-center">
                <div className="inline-block animate-spin mb-2 w-5 h-5 border-2 border-stone-300 border-t-stone-500 rounded-full"></div>
                <p className="text-[12px] text-stone-500 font-medium">加载快照中...</p>
              </div>
            ) : snapshots.length === 0 ? (
              <div className="py-8 px-4 text-center bg-stone-50/60 rounded-xl border border-stone-200/60">
                <p className="text-[12px] text-stone-600 font-medium">暂无快照</p>
                <p className="text-[11px] text-stone-500 mt-1">手动保存或等待自动月度快照</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="group flex items-start justify-between p-4 rounded-xl border border-blue-150/60 bg-white/85 hover:bg-blue-50/80 hover:border-blue-200/80 transition-all duration-200 backdrop-blur-sm hover:shadow-[0_4px_12px_rgba(59,130,246,0.1)]"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <GlassCardIcon icon={Archive} tone="indigo" iconSize={14} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-stone-800 truncate">
                          {snap.meta?.title || 'Snapshot'}
                        </p>
                        <p className="text-[10px] text-stone-500 mt-2 flex items-center gap-2">
                          <span>{new Date(snap.updatedAt).toLocaleString()}</span>
                        </p>
                        <p className="text-[10px] text-stone-500 mt-1 flex items-center gap-2">
                          <span>{snap.stats?.investmentCount || 0} 投资</span>
                          <span>•</span>
                          <span>{snap.stats?.teamCount || 0} 团队</span>
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => onBeginSession(snap.id)}
                      disabled={loading}
                      className="ml-4 btn-tm-travel group-hover:scale-105 group-active:scale-95"
                    >
                      <RotateCcw size={12} strokeWidth={2.5} /> 穿越
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {snapshots.length > 0 && (
            <div className="flex items-center justify-between gap-3 pt-4 border-t border-blue-150/50">
              <p className="text-[10px] text-stone-600 font-medium">
                第 {page} / {totalPages} 页
              </p>
              <div className="flex gap-2">
                {[
                  { disabled: page <= 1, label: '上一页', onClick: () => onPageChange(Math.max(1, page - 1)) },
                  { disabled: page >= totalPages, label: '下一页', onClick: () => onPageChange(Math.min(totalPages, page + 1)) },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    onClick={btn.onClick}
                    disabled={btn.disabled || loading}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-medium border border-blue-200/70 bg-white/85 text-stone-700 hover:bg-blue-50/80 hover:border-blue-300/70 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Save Section */}
          <div className="space-y-4 border-t border-blue-150/50 pt-5">
            <div className="flex items-center gap-2.5">
              <GlassCardIcon icon={Plus} tone="emerald" iconSize={15} />
              <h3 className="text-[13px] font-bold text-stone-800">保存当前快照</h3>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                placeholder="可选：自定义标题"
                value={manualTitle}
                onChange={(e) => onTitleChange(e.target.value)}
                disabled={loading}
                className="flex-1 px-3.5 py-2.5 rounded-lg border border-blue-200/60 bg-white/85 text-[11px] text-stone-800 placeholder-stone-400 outline-none focus:border-blue-400/90 focus:bg-white transition-all disabled:opacity-50 backdrop-blur-sm"
              />
              <button
                onClick={onSaveSnapshot}
                disabled={loading}
                className="btn-tm-save"
              >
                保存
              </button>
              <button
                onClick={onEnsureMonthly}
                disabled={loading}
                className="btn-tm-monthly"
              >
                本月
              </button>
            </div>

            {/* Status Message */}
            {saveStatus && (
              <div
                className={`text-[11px] px-3.5 py-2.5 rounded-lg font-medium transition-all ${
                  saveStatus.includes('Failed') || saveStatus.includes('Error')
                    ? 'bg-red-50/95 text-red-700 border border-red-200/80'
                    : 'bg-emerald-50/95 text-emerald-700 border border-emerald-200/80'
                }`}
              >
                {saveStatus}
              </div>
            )}
          </div>
        </>
      ) : (
        /* In Time Machine Mode */
        <div className="py-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-b from-blue-100/80 to-cyan-100/60 border border-blue-200/60 mb-4">
            <div className="animate-pulse w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full"></div>
          </div>
          <p className="text-[13px] text-stone-700 font-bold mb-2">时光穿越中...</p>
          <p className="text-[11px] text-stone-600 mb-3">
            当前查阅：<span className="font-semibold text-stone-800">{sessionInfo?.title}</span>
          </p>
          <p className="text-[10px] text-stone-500">所有写操作已禁用，点击下方"退出穿越"返回现在</p>
        </div>
      )}
    </div>
  )
}
