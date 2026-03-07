import { useEffect, useRef, useState } from 'react'
import { Archive, Database, Plus, RotateCcw, Sparkles, X } from 'lucide-react'

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

const pad2 = (value) => String(value).padStart(2, '0')

const formatSnapshotDateTime = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

const buildFriendlyReason = (reason) => {
  const text = String(reason || '').trim()
  if (!text) return '请稍后重试。'

  const reasonMap = {
    missing_env: '缺少 Supabase 环境配置。',
    invalid_snapshot: '快照结构异常。',
    snapshot_not_found: '未找到对应快照。',
    save_failed: '云端写入失败。',
    exception: '保存过程中发生异常。',
  }

  return reasonMap[text] || text
}

export default function TimeMachineModalContent({
  isInMode,
  sessionInfo,
  snapshots,
  page,
  totalPages,
  loading,
  error,
  onBeginSession,
  onExitSession,
  onSaveSnapshot,
  onEnsureMonthly,
  onLoadPage,
  onDeleteSnapshot,
}) {
  const [localSnapshots, setLocalSnapshots] = useState(Array.isArray(snapshots) ? snapshots : [])
  const [localPage, setLocalPage] = useState(Number(page) > 0 ? Number(page) : 1)
  const [localTotalPages, setLocalTotalPages] = useState(Number(totalPages) > 0 ? Number(totalPages) : 1)
  const [localLoading, setLocalLoading] = useState(Boolean(loading))
  const [localError, setLocalError] = useState(String(error || ''))
  const [localIsInMode, setLocalIsInMode] = useState(Boolean(isInMode))
  const [localSessionInfo, setLocalSessionInfo] = useState(sessionInfo || null)
  const [draftTitle, setDraftTitle] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [feedback, setFeedback] = useState(null)
  const feedbackTimerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (localIsInMode || localSnapshots.length > 0 || typeof onLoadPage !== 'function') return
    handlePageShift(localPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isBusy = localLoading || Boolean(busyAction)

  const pushFeedback = (next) => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current)
    }

    const payload = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tone: next?.tone || 'success',
      eyebrow: String(next?.eyebrow || '').trim(),
      title: String(next?.title || '').trim(),
      detail: String(next?.detail || '').trim(),
      meta: String(next?.meta || '').trim(),
    }

    setFeedback(payload)
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback(null)
      feedbackTimerRef.current = null
    }, payload.tone === 'error' ? 3600 : 2800)
  }

  const handleTravel = async (snapshotId) => {
    setLocalLoading(true)
    setLocalError('')
    try {
      const result = await onBeginSession(snapshotId)
      if (result?.ok) {
        setLocalIsInMode(true)
        setLocalSessionInfo(result.session || localSessionInfo)
      } else {
        setLocalError(buildFriendlyReason(result?.reason || 'Failed to enter time machine'))
      }
    } catch {
      setLocalError('进入时光穿越失败。')
    } finally {
      setLocalLoading(false)
    }
  }

  const handleExit = async () => {
    setLocalLoading(true)
    try {
      const result = await onExitSession()
      if (result?.ok) {
        setLocalIsInMode(false)
        setLocalSessionInfo(null)
      }
    } finally {
      setLocalLoading(false)
    }
  }

  const handlePageShift = async (nextPage) => {
    if (typeof onLoadPage !== 'function') return
    setLocalLoading(true)
    setLocalError('')
    try {
      const result = await onLoadPage(nextPage)
      if (result?.ok) {
        setLocalSnapshots(Array.isArray(result.rows) ? result.rows : [])
        setLocalPage(Number(result.page) > 0 ? Number(result.page) : nextPage)
        setLocalTotalPages(Number(result.totalPages) > 0 ? Number(result.totalPages) : 1)
      } else {
        setLocalError(buildFriendlyReason(result?.reason || 'Failed to load snapshots'))
      }
    } catch {
      setLocalError('读取历史快照失败。')
    } finally {
      setLocalLoading(false)
    }
  }

  const handleSaveManual = async () => {
    setBusyAction('manual')
    setLocalError('')
    try {
      const result = await onSaveSnapshot(draftTitle)
      if (result?.ok) {
        setDraftTitle('')
        pushFeedback({
          tone: 'success',
          eyebrow: 'Chrono Seal Armed',
          title: '已成功时光存档',
          detail: '刷新页面后即可重新读取',
          meta: result?.meta?.title ? `存档名称 · ${result.meta.title}` : '',
        })
      } else {
        pushFeedback({
          tone: 'error',
          eyebrow: 'Chrono Seal Interrupted',
          title: '时光存档失败',
          detail: buildFriendlyReason(result?.reason),
        })
      }
    } catch {
      pushFeedback({
        tone: 'error',
        eyebrow: 'Chrono Seal Interrupted',
        title: '时光存档失败',
        detail: '保存过程中发生异常，请稍后重试。',
      })
    } finally {
      setBusyAction('')
    }
  }

  const handleSaveMonthly = async () => {
    setBusyAction('monthly')
    setLocalError('')
    try {
      const result = await onEnsureMonthly()
      if (result?.ok) {
        pushFeedback({
          tone: 'success',
          eyebrow: 'Monthly Archive Ready',
          title: result.created ? '本月快照已生成' : '本月快照已存在',
          detail: '刷新页面后即可重新读取',
          meta: result?.snapshotAt ? `归档时间 · ${formatSnapshotDateTime(result.snapshotAt)}` : '',
        })
      } else {
        pushFeedback({
          tone: 'error',
          eyebrow: 'Monthly Archive Interrupted',
          title: '本月快照生成失败',
          detail: buildFriendlyReason(result?.reason),
        })
      }
    } catch {
      pushFeedback({
        tone: 'error',
        eyebrow: 'Monthly Archive Interrupted',
        title: '本月快照生成失败',
        detail: '保存过程中发生异常，请稍后重试。',
      })
    } finally {
      setBusyAction('')
    }
  }

  return (
    <div className="space-y-6 py-2">
      {localIsInMode && localSessionInfo && (
        <div className="p-5 rounded-xl bg-gradient-to-br from-blue-100/70 to-cyan-100/60 border border-blue-200/70 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700/70 mb-2">
                当前查阅快照
              </p>
              <p className="text-[14px] font-bold text-blue-900 mb-2">{localSessionInfo.title}</p>
              <p className="text-[11px] text-blue-700">{formatSnapshotDateTime(localSessionInfo.snapshotAt)}</p>
            </div>
            <button
              onClick={handleExit}
              disabled={isBusy}
              className="btn-tm-exit"
            >
              <X size={14} strokeWidth={2.5} /> 退出穿越
            </button>
          </div>
        </div>
      )}

      {!localIsInMode ? (
        <>
          <div className="mb-4">
            <div className="flex items-center gap-2.5 mb-4">
              <GlassCardIcon icon={Database} tone="sky" iconSize={15} />
              <h3 className="text-[13px] font-bold text-stone-800">历史快照库</h3>
            </div>

            {localError && (
              <div className="mb-3 p-3.5 rounded-lg bg-red-50/95 border border-red-200/80 text-[11px] text-red-700 font-medium">
                {localError}
              </div>
            )}

            {localLoading && localSnapshots.length === 0 ? (
              <div className="py-8 text-center">
                <div className="inline-block animate-spin mb-2 w-5 h-5 border-2 border-stone-300 border-t-stone-500 rounded-full"></div>
                <p className="text-[12px] text-stone-500 font-medium">加载快照中...</p>
              </div>
            ) : localSnapshots.length === 0 ? (
              <div className="py-8 px-4 text-center bg-stone-50/60 rounded-xl border border-stone-200/60">
                <p className="text-[12px] text-stone-600 font-medium">暂无快照</p>
                <p className="text-[11px] text-stone-500 mt-1">手动保存或等待自动月度快照</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {localSnapshots.map((snap) => (
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
                          <span>{formatSnapshotDateTime(snap.updatedAt)}</span>
                        </p>
                        <p className="text-[10px] text-stone-500 mt-1 flex items-center gap-2">
                          <span>{snap.stats?.investmentCount || 0} 投资</span>
                          <span>•</span>
                          <span>{snap.stats?.teamCount || 0} 团队</span>
                        </p>
                      </div>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <button
                        onClick={() => onDeleteSnapshot && onDeleteSnapshot(snap.id)}
                        disabled={isBusy}
                        title="删除快照"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-rose-200/50 bg-white/85 text-rose-500 hover:border-rose-300/70 hover:bg-rose-50/80 transition-all disabled:opacity-50"
                      >
                        <Archive size={13} />
                      </button>
                      <button
                        onClick={() => handleTravel(snap.id)}
                        disabled={isBusy}
                        className="btn-tm-travel group-hover:scale-105 group-active:scale-95"
                      >
                        <RotateCcw size={12} strokeWidth={2.5} /> 穿越
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {localSnapshots.length > 0 && (
            <div className="flex items-center justify-between gap-3 pt-4 border-t border-blue-150/50">
              <p className="text-[10px] text-stone-600 font-medium">
                第 {localPage} / {localTotalPages} 页
              </p>
              <div className="flex gap-2">
                {[
                  { disabled: localPage <= 1, label: '上一页', onClick: () => handlePageShift(Math.max(1, localPage - 1)) },
                  { disabled: localPage >= localTotalPages, label: '下一页', onClick: () => handlePageShift(Math.min(localTotalPages, localPage + 1)) },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    onClick={btn.onClick}
                    disabled={btn.disabled || isBusy}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-medium border border-blue-200/70 bg-white/85 text-stone-700 hover:bg-blue-50/80 hover:border-blue-300/70 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4 border-t border-blue-150/50 pt-5">
            <div className="flex items-center gap-2.5">
              <GlassCardIcon icon={Plus} tone="emerald" iconSize={15} />
              <h3 className="text-[13px] font-bold text-stone-800">保存当前快照</h3>
            </div>

            <div className="relative overflow-hidden rounded-[1.35rem] border border-emerald-100/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.96),rgba(246,253,250,0.96)_52%,rgba(239,250,247,0.9))] px-4 py-4 shadow-[0_12px_34px_-26px_rgba(16,185,129,0.26),inset_0_1px_0_rgba(255,255,255,0.95)]">
              <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/90 to-transparent" />

              {feedback && (
                <div
                  key={feedback.id}
                  className={`tm-save-feedback ${feedback.tone === 'error' ? 'tm-save-feedback-error' : 'tm-save-feedback-success'}`}
                >
                  <div className="tm-save-feedback-halo" />
                  <div className="tm-save-feedback-card">
                    <div className="tm-save-feedback-chip">
                      <Sparkles size={12} strokeWidth={1.9} />
                      <span>{feedback.eyebrow}</span>
                    </div>
                    <p className="tm-save-feedback-title">{feedback.title}</p>
                    <p className="tm-save-feedback-detail">{feedback.detail}</p>
                    {feedback.meta && <p className="tm-save-feedback-meta">{feedback.meta}</p>}
                  </div>
                </div>
              )}

              <div className="flex gap-3 max-[880px]:flex-col">
                <input
                  type="text"
                  placeholder="可选：自定义标题"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  disabled={isBusy}
                  className="flex-1 rounded-xl border border-sky-200/65 bg-white/92 px-3.5 py-2.5 text-[11px] text-stone-800 placeholder-stone-400 outline-none transition-all focus:border-sky-400/90 focus:bg-white focus:shadow-[0_0_0_3px_rgba(56,189,248,0.12)] disabled:opacity-50"
                />
                <button
                  onClick={handleSaveManual}
                  disabled={isBusy}
                  className={`btn-tm-save ${busyAction === 'manual' ? 'tm-save-button-live' : ''}`}
                >
                  {busyAction === 'manual' ? '时光存档中...' : '保存快照'}
                </button>
                <button
                  onClick={handleSaveMonthly}
                  disabled={isBusy}
                  className="btn-tm-monthly"
                >
                  {busyAction === 'monthly' ? '归档中...' : '生成本月快照'}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="py-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-b from-blue-100/80 to-cyan-100/60 border border-blue-200/60 mb-4">
            <div className="animate-pulse w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full"></div>
          </div>
          <p className="text-[13px] text-stone-700 font-bold mb-2">时光穿越中...</p>
          <p className="text-[11px] text-stone-600 mb-3">
            当前查阅：<span className="font-semibold text-stone-800">{localSessionInfo?.title}</span>
          </p>
          <p className="text-[10px] text-stone-500">所有写操作已禁用，点击下方"退出穿越"返回现在</p>
        </div>
      )}
    </div>
  )
}
