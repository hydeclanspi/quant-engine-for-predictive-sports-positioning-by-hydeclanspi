import { Plus, X, RotateCcw } from 'lucide-react'

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
    <div className="space-y-5 py-2">
      {/* Current Session Info */}
      {isInMode && sessionInfo && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-blue-100/60 to-cyan-100/50 border border-blue-200/60 backdrop-blur-sm">
          <p className="text-[11px] font-semibold text-blue-900 mb-2">📍 当前查阅快照</p>
          <p className="text-[13px] font-bold text-blue-800 mb-1">{sessionInfo.title}</p>
          <p className="text-[11px] text-blue-700 mb-3">{new Date(sessionInfo.snapshotAt).toLocaleString()}</p>
          <button
            onClick={onExitSession}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-red-100 to-red-100/50 text-red-700 border border-red-200/70 hover:border-red-300/90 hover:shadow-[0_4px_12px_rgba(239,68,68,0.15)] transition-all duration-200 disabled:opacity-50"
          >
            <X size={13} strokeWidth={2} /> 退出穿越
          </button>
        </div>
      )}

      {/* Snapshots List Section */}
      {!isInMode ? (
        <>
          <div>
            <label className="text-[12px] font-bold text-stone-800 block mb-3">📚 历史快照库</label>
            {error && (
              <div className="mb-3 p-3 rounded-lg bg-red-50/90 border border-red-200/70 text-[11px] text-red-700 font-medium">
                {error}
              </div>
            )}
            {loading && snapshots.length === 0 ? (
              <div className="py-8 text-center text-stone-400 text-[12px]">
                <div className="inline-block animate-spin mb-2">⏳</div>
                <p>加载快照中...</p>
              </div>
            ) : snapshots.length === 0 ? (
              <div className="py-8 px-4 text-center bg-stone-50/70 rounded-lg border border-stone-200/60">
                <p className="text-[12px] text-stone-500 font-medium">暂无快照</p>
                <p className="text-[11px] text-stone-400 mt-1">手动保存或等待自动月度快照</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="group flex items-center justify-between p-3.5 rounded-xl border border-blue-150/70 bg-white/80 hover:bg-blue-50/70 hover:border-blue-200/90 transition-all duration-200 backdrop-blur-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-stone-800 truncate">
                        {snap.meta?.title || 'Snapshot'}
                      </p>
                      <p className="text-[10px] text-stone-500 mt-1">
                        {new Date(snap.updatedAt).toLocaleString()} · {snap.stats?.investmentCount || 0} 投资 · {snap.stats?.teamCount || 0} 团队
                      </p>
                    </div>
                    <button
                      onClick={() => onBeginSession(snap.id)}
                      disabled={loading}
                      className="ml-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-[0_6px_16px_rgba(59,130,246,0.35)] transition-all duration-200 disabled:opacity-50 whitespace-nowrap group-hover:scale-105 group-active:scale-95"
                    >
                      <RotateCcw size={11} strokeWidth={2} /> 穿越
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {snapshots.length > 0 && (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-blue-150/50">
              <p className="text-[10px] text-stone-500">
                第 {page} / {totalPages} 页
              </p>
              <div className="flex gap-1.5">
                {[
                  { disabled: page <= 1, label: '上一页', onClick: () => onPageChange(Math.max(1, page - 1)) },
                  { disabled: page >= totalPages, label: '下一页', onClick: () => onPageChange(Math.min(totalPages, page + 1)) },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    onClick={btn.onClick}
                    disabled={btn.disabled || loading}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-medium border border-blue-200/70 bg-white/80 text-stone-600 hover:bg-blue-50/80 hover:border-blue-300/70 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Save Section */}
          <div className="space-y-3 border-t border-blue-150/50 pt-4">
            <label className="text-[12px] font-bold text-stone-800 block">💾 保存当前快照</label>
            <div className="flex gap-2.5">
              <input
                type="text"
                placeholder="可选：自定义标题"
                value={manualTitle}
                onChange={(e) => onTitleChange(e.target.value)}
                disabled={loading}
                className="flex-1 px-3 py-2.5 rounded-lg border border-blue-200/60 bg-white/85 text-[11px] text-stone-700 placeholder-stone-400 outline-none focus:border-blue-400/80 focus:bg-white transition-all disabled:opacity-50 backdrop-blur-sm"
              />
              <button
                onClick={onSaveSnapshot}
                disabled={loading}
                className="px-3.5 py-2.5 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:shadow-[0_6px_16px_rgba(16,185,129,0.35)] transition-all duration-200 disabled:opacity-50 whitespace-nowrap"
              >
                <Plus size={11} className="inline mr-1" strokeWidth={2} />保存
              </button>
              <button
                onClick={onEnsureMonthly}
                disabled={loading}
                className="px-3.5 py-2.5 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:shadow-[0_6px_16px_rgba(168,85,247,0.35)] transition-all duration-200 disabled:opacity-50 whitespace-nowrap"
              >
                📅 本月
              </button>
            </div>

            {/* Status Message */}
            {saveStatus && (
              <div
                className={`text-[11px] px-3 py-2.5 rounded-lg font-medium transition-all ${
                  saveStatus.includes('Failed') || saveStatus.includes('Error')
                    ? 'bg-red-50/90 text-red-700 border border-red-200/70'
                    : 'bg-emerald-50/90 text-emerald-700 border border-emerald-200/70'
                }`}
              >
                {saveStatus}
              </div>
            )}
          </div>
        </>
      ) : (
        /* In Time Machine Mode - Show minimal UI */
        <div className="py-6 text-center">
          <p className="text-[13px] text-stone-600 font-medium mb-4">你正在时光穿越模式中浏览历史数据</p>
          <p className="text-[11px] text-stone-500 mb-4">
            当前快照：<span className="font-semibold text-stone-700">{sessionInfo?.title}</span>
          </p>
          <p className="text-[10px] text-stone-400">
            所有写操作已禁用 · 点击下方"退出穿越"按钮返回现在
          </p>
        </div>
      )}
    </div>
  )
}
