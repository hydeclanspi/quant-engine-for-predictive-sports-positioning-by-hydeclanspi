import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Check, X, Trash2 } from 'lucide-react'
import { deleteInvestment, getInvestments, updateInvestment } from '../lib/localData'
import { handleNoteShortcut } from '../lib/noteFormatting'
import { normalizeEntryName } from '../lib/entryParsing'

const formatDate = (isoString) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '--'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

const createPendingCombos = () =>
  getInvestments()
    .filter((item) => item.status === 'pending')
    .map((item) => ({
      id: item.id,
      date: formatDate(item.created_at),
      totalOdds: Number(item.combined_odds || 0).toFixed(2),
      totalInputs: Number(item.inputs || 0),
      matches:
        item.matches?.map((match) => ({
          homeTeam: match.home_team || '',
          awayTeam: match.away_team || '',
          match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
          entry: match.entry_text || (Array.isArray(match.entries) ? match.entries.map((entry) => entry.name).join(', ') : '-'),
          odds: Number(match.odds || 0).toFixed(2),
          preNote: match.note || '',
          results: match.results || '',
          isCorrect: typeof match.is_correct === 'boolean' ? match.is_correct : null,
          matchRating: match.match_rating ?? '',
          matchRep: match.match_rep ?? '',
          postNote: match.post_note || '',
        })) || [],
      revenues: Number(item.revenues || 0),
    }))

const createInitialForms = (combos) =>
  combos.reduce((acc, combo) => {
    acc[combo.id] = {
      revenues: String(combo.revenues || 0),
      matches: combo.matches.map((match) => ({
        results: match.results,
        isCorrect: match.isCorrect,
        matchRating: match.matchRating,
        matchRep: match.matchRep,
        postNote: match.postNote,
      })),
    }
    return acc
  }, {})

const getComboLabel = (matchCount) => {
  if (matchCount === 1) return 'Single Match'
  return `${matchCount} Matches Combo`
}

const AJR_MIN = 0
const AJR_MAX = 0.8
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const isEmptyValue = (value) => value === '' || value === null || value === undefined

const buildTeamMatchupKey = (homeTeam, awayTeam) => {
  const home = normalizeKey(homeTeam)
  const away = normalizeKey(awayTeam)
  if (!home || !away) return ''
  // 主客队严格匹配，避免把同队对阵但主客对调的历史误判为同一场
  return `${home}::${away}`
}

const toEntryNames = (entryText = '') =>
  normalizeEntryName(entryText)
    .split(',')
    .map((name) => normalizeEntryName(name).toLowerCase())
    .filter(Boolean)

const buildEntryKey = (entryText = '') => {
  const names = [...new Set(toEntryNames(entryText))]
  if (names.length === 0) return ''
  return names.sort().join('|')
}

const buildHistoryLookupKey = ({ homeTeam, awayTeam, entryText }) => {
  const matchupKey = buildTeamMatchupKey(homeTeam, awayTeam)
  const entryKey = buildEntryKey(entryText)
  if (!matchupKey || !entryKey) return ''
  return `${matchupKey}##${entryKey}`
}

const toNumberOrNull = (value) => {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

const isAjrValueValid = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return true
  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) && parsed >= AJR_MIN && parsed <= AJR_MAX
}

const toAjrOrNull = (value) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return null
  return Number(clamp(parsed, AJR_MIN, AJR_MAX).toFixed(2))
}

export default function SettlePage() {
  const [pendingCombos, setPendingCombos] = useState(() => createPendingCombos())
  // 默认展开第一条待结算记录
  const [expandedCombo, setExpandedCombo] = useState(() => {
    const initial = createPendingCombos()
    return initial.length > 0 ? initial[0].id : null
  })
  const [forms, setForms] = useState(() => createInitialForms(createPendingCombos()))
  const [selectedComboIds, setSelectedComboIds] = useState({})
  const [batchRating, setBatchRating] = useState('')
  const [batchRep, setBatchRep] = useState('')
  const [historyAutoFillSnapshots, setHistoryAutoFillSnapshots] = useState({})

  const settledHistoryLookup = useMemo(() => {
    const lookup = new Map()

    getInvestments()
      .filter((item) => item.status !== 'pending')
      .forEach((investment) => {
        const createdAtTs = Number(new Date(investment.created_at).getTime()) || 0
        const matches = Array.isArray(investment.matches) ? investment.matches : []

        matches.forEach((match) => {
          const entryText =
            match.entry_text ||
            (Array.isArray(match.entries) ? match.entries.map((entry) => normalizeEntryName(entry?.name || '')).join(', ') : '')
          const key = buildHistoryLookupKey({
            homeTeam: match.home_team,
            awayTeam: match.away_team,
            entryText,
          })
          if (!key) return

          const source = {
            createdAtTs,
            results: String(match.results || '').trim(),
            isCorrect: typeof match.is_correct === 'boolean' ? match.is_correct : null,
            matchRating: toAjrOrNull(match.match_rating),
            matchRep: toNumberOrNull(match.match_rep),
            postNote: String(match.post_note || '').trim(),
          }
          const hasFillPayload =
            source.results || source.isCorrect !== null || source.matchRating !== null || source.matchRep !== null || source.postNote
          if (!hasFillPayload) return

          const previous = lookup.get(key)
          if (!previous || source.createdAtTs > previous.createdAtTs) {
            lookup.set(key, source)
          }
        })
      })

    return lookup
  }, [pendingCombos.length])

  useEffect(() => {
    setSelectedComboIds((prev) => {
      const next = {}
      pendingCombos.forEach((combo) => {
        next[combo.id] = prev[combo.id] ?? true
      })
      return next
    })
  }, [pendingCombos])

  useEffect(() => {
    const pendingIds = new Set(pendingCombos.map((combo) => combo.id))
    setHistoryAutoFillSnapshots((prev) => {
      const next = {}
      Object.keys(prev).forEach((comboId) => {
        if (pendingIds.has(comboId)) {
          next[comboId] = prev[comboId]
        }
      })
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [pendingCombos])

  useEffect(() => {
    if (pendingCombos.length === 0 || settledHistoryLookup.size === 0) return

    let changed = false
    const nextForms = { ...forms }
    const nextSnapshots = {}

    pendingCombos.forEach((combo) => {
      const currentForm = nextForms[combo.id]
      if (!currentForm || !Array.isArray(currentForm.matches)) return
      const comboSnapshots = historyAutoFillSnapshots[combo.id] || {}

      let comboChanged = false
      const nextMatches = currentForm.matches.map((formMatch, matchIdx) => {
        const existingSnapshot = comboSnapshots[matchIdx]
        if (existingSnapshot?.status === 'applied' || existingSnapshot?.status === 'dismissed') return formMatch

        const comboMatch = combo.matches[matchIdx]
        if (!comboMatch) return formMatch

        const key = buildHistoryLookupKey({
          homeTeam: comboMatch.homeTeam,
          awayTeam: comboMatch.awayTeam,
          entryText: comboMatch.entry,
        })
        if (!key) return formMatch

        const matched = settledHistoryLookup.get(key)
        if (!matched) return formMatch

        let matchChanged = false
        const filledFields = []
        const nextMatch = { ...formMatch }

        if (!String(nextMatch.results || '').trim() && matched.results) {
          nextMatch.results = matched.results
          matchChanged = true
          filledFields.push('results')
        }
        if (nextMatch.isCorrect === null && matched.isCorrect !== null) {
          nextMatch.isCorrect = matched.isCorrect
          matchChanged = true
          filledFields.push('isCorrect')
        }
        if (isEmptyValue(nextMatch.matchRating) && matched.matchRating !== null) {
          nextMatch.matchRating = String(matched.matchRating)
          matchChanged = true
          filledFields.push('matchRating')
        }
        if (isEmptyValue(nextMatch.matchRep) && matched.matchRep !== null) {
          nextMatch.matchRep = String(matched.matchRep)
          matchChanged = true
          filledFields.push('matchRep')
        }
        if (isEmptyValue(nextMatch.postNote) && matched.postNote) {
          nextMatch.postNote = matched.postNote
          matchChanged = true
          filledFields.push('postNote')
        }

        if (!matchChanged) return formMatch
        comboChanged = true
        if (!nextSnapshots[combo.id]) nextSnapshots[combo.id] = {}
        nextSnapshots[combo.id][matchIdx] = {
          status: 'applied',
          previousMatch: { ...formMatch },
          filledFields,
        }
        return nextMatch
      })

      if (!comboChanged) return

      changed = true
      nextForms[combo.id] = {
        ...currentForm,
        matches: nextMatches,
      }
    })

    if (!changed) return
    setForms(nextForms)
    setHistoryAutoFillSnapshots((prev) => {
      const next = { ...prev }
      Object.keys(nextSnapshots).forEach((comboId) => {
        next[comboId] = {
          ...(next[comboId] || {}),
          ...nextSnapshots[comboId],
        }
      })
      return next
    })
  }, [forms, historyAutoFillSnapshots, pendingCombos, settledHistoryLookup])

  const selectedCount = useMemo(
    () => pendingCombos.filter((combo) => selectedComboIds[combo.id]).length,
    [pendingCombos, selectedComboIds],
  )

  const updateMatchField = (comboId, matchIdx, field, value) => {
    setForms((prev) => ({
      ...prev,
      [comboId]: {
        ...prev[comboId],
        matches: prev[comboId].matches.map((match, idx) => (idx === matchIdx ? { ...match, [field]: value } : match)),
      },
    }))
  }

  const updateRevenue = (comboId, value) => {
    setForms((prev) => ({
      ...prev,
      [comboId]: {
        ...prev[comboId],
        revenues: value,
      },
    }))
  }

  const revertHistoryAutoFillMatch = (comboId, matchIdx) => {
    const snapshot = historyAutoFillSnapshots[comboId]?.[matchIdx]
    if (!snapshot?.previousMatch || snapshot.status !== 'applied') return

    setForms((prev) => ({
      ...prev,
      [comboId]: {
        ...prev[comboId],
        matches: prev[comboId].matches.map((match, idx) => (idx === matchIdx ? { ...snapshot.previousMatch } : match)),
      },
    }))
    setHistoryAutoFillSnapshots((prev) => ({
      ...prev,
      [comboId]: {
        ...(prev[comboId] || {}),
        [matchIdx]: {
          status: 'dismissed',
        },
      },
    }))
  }

  const getValidationError = (form) => {
    if (!form) return '记录表单不存在。'
    const hasUnsetHit = form.matches.some((match) => match.isCorrect === null)
    if (hasUnsetHit) {
      return '请先把每场比赛的“是否命中”填写完整。'
    }

    const invalidAjrIndex = form.matches.findIndex((match) => !isAjrValueValid(match.matchRating))
    if (invalidAjrIndex >= 0) {
      return `第 ${invalidAjrIndex + 1} 场 AJR 需在 0~0.8 之间。`
    }

    const revenues = Number.parseFloat(form.revenues)
    if (!Number.isFinite(revenues) || revenues < 0) {
      return 'Revenue 实际收益需要是大于等于 0 的数字。'
    }
    return ''
  }

  const applySettlement = (combo, form) => {
    const revenues = Number.parseFloat(form.revenues)
    const status = form.matches.every((match) => match.isCorrect === true) ? 'win' : 'lose'
    const profit = Number((revenues - combo.totalInputs).toFixed(2))
    const ratingValues = form.matches.map((match) => toAjrOrNull(match.matchRating)).filter((value) => value !== null)
    const repValues = form.matches.map((match) => toNumberOrNull(match.matchRep)).filter((value) => value !== null)
    const actualRating =
      ratingValues.length > 0 ? Number((ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(2)) : null
    const rep = repValues.length > 0 ? Number((repValues.reduce((sum, value) => sum + value, 0) / repValues.length).toFixed(2)) : null
    const remarks = form.matches
      .map((match, idx) => {
        const note = String(match.postNote || '').trim()
        if (!note) return ''
        return `M${idx + 1}: ${note}`
      })
      .filter(Boolean)
      .join('；')

    updateInvestment(combo.id, (previous) => ({
      ...previous,
      status,
      revenues: Number(revenues.toFixed(2)),
      profit,
      actual_rating: actualRating,
      rep,
      remarks,
      matches: (previous.matches || []).map((match, idx) => ({
        ...match,
        results: String(form.matches[idx]?.results || '').trim(),
        is_correct: form.matches[idx]?.isCorrect ?? null,
        match_rating: toAjrOrNull(form.matches[idx]?.matchRating),
        match_rep: toNumberOrNull(form.matches[idx]?.matchRep),
        post_note: String(form.matches[idx]?.postNote || '').trim(),
      })),
    }))
  }

  const settleCombos = (targetCombos) => {
    const ids = new Set(targetCombos.map((combo) => combo.id))
    setPendingCombos((prev) => prev.filter((item) => !ids.has(item.id)))
    setForms((prev) => {
      const next = { ...prev }
      targetCombos.forEach((combo) => {
        delete next[combo.id]
      })
      return next
    })
    setSelectedComboIds((prev) => {
      const next = { ...prev }
      targetCombos.forEach((combo) => {
        delete next[combo.id]
      })
      return next
    })
    setHistoryAutoFillSnapshots((prev) => {
      const next = { ...prev }
      targetCombos.forEach((combo) => {
        delete next[combo.id]
      })
      return next
    })
    setExpandedCombo((prev) => (prev && ids.has(prev) ? null : prev))
  }

  const confirmSettlement = (combo) => {
    const form = forms[combo.id]
    const error = getValidationError(form)
    if (error) {
      window.alert(error)
      return
    }
    applySettlement(combo, form)

    // 找到当前结算项的下一条，用于自动展开
    const currentIndex = pendingCombos.findIndex((c) => c.id === combo.id)
    const nextCombo = pendingCombos[currentIndex + 1]

    settleCombos([combo])

    // 自动展开下一条待结算记录
    if (nextCombo) {
      setExpandedCombo(nextCombo.id)
    }
  }

  const handleDeletePending = (combo, event) => {
    event.stopPropagation()
    const ok = window.confirm(`确认删除这笔待结算记录吗？\n${combo.date} · ${getComboLabel(combo.matches.length)}`)
    if (!ok) return
    const deleted = deleteInvestment(combo.id)
    if (!deleted) return
    settleCombos([combo])
  }

  const toggleComboSelection = (comboId) => {
    setSelectedComboIds((prev) => ({ ...prev, [comboId]: !prev[comboId] }))
  }

  const toggleSelectAll = () => {
    const shouldSelectAll = selectedCount !== pendingCombos.length
    const next = {}
    pendingCombos.forEach((combo) => {
      next[combo.id] = shouldSelectAll
    })
    setSelectedComboIds(next)
  }

  const handleBatchSettlement = () => {
    const targetCombos = pendingCombos.filter((combo) => selectedComboIds[combo.id])
    if (targetCombos.length === 0) {
      window.alert('请先勾选要批量结算的记录。')
      return
    }

    const invalid = targetCombos
      .map((combo) => {
        const error = getValidationError(forms[combo.id])
        if (!error) return ''
        return `${combo.date} ${getComboLabel(combo.matches.length)}：${error}`
      })
      .filter(Boolean)

    if (invalid.length > 0) {
      window.alert(`以下记录尚未填完整，无法批量结算：\n${invalid.slice(0, 5).join('\n')}`)
      return
    }

    const ok = window.confirm(`确认批量结算已勾选的 ${targetCombos.length} 笔记录吗？`)
    if (!ok) return

    targetCombos.forEach((combo) => applySettlement(combo, forms[combo.id]))
    settleCombos(targetCombos)
  }

  const applyBatchFill = () => {
    const targetIds = pendingCombos.filter((combo) => selectedComboIds[combo.id]).map((combo) => combo.id)
    if (targetIds.length === 0) {
      window.alert('请先勾选要填充的记录。')
      return
    }

    const hasBatchRating = String(batchRating ?? '').trim() !== ''
    if (hasBatchRating && !isAjrValueValid(batchRating)) {
      window.alert('批量 AJR 需在 0~0.8 之间。')
      return
    }

    const ratingValue = hasBatchRating ? toAjrOrNull(batchRating) : null
    const repValue = toNumberOrNull(batchRep)
    if (ratingValue === null && repValue === null) {
      window.alert('请至少填写一个批量值（AJR 或 REP）。')
      return
    }

    setForms((prev) => {
      const next = { ...prev }
      targetIds.forEach((comboId) => {
        const form = next[comboId]
        if (!form) return
        next[comboId] = {
          ...form,
          matches: form.matches.map((match) => ({
            ...match,
            matchRating:
              ratingValue !== null && (match.matchRating === '' || match.matchRating === null || match.matchRating === undefined)
                ? String(ratingValue)
                : match.matchRating,
            matchRep:
              repValue !== null && (match.matchRep === '' || match.matchRep === null || match.matchRep === undefined)
                ? String(repValue)
                : match.matchRep,
          })),
        }
      })
      return next
    })
  }

  return (
    <div className="page-shell page-content-wide">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">待结算</h2>
        <p className="text-stone-400 text-sm mt-1">{pendingCombos.length} 笔投资待录入结果</p>
      </div>

      {pendingCombos.length > 0 && (
        <div className="mb-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="text-xs text-stone-500">已勾选 {selectedCount}/{pendingCombos.length}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              step="0.01"
              min={AJR_MIN}
              max={AJR_MAX}
              placeholder="批量 AJR"
              value={batchRating}
              onChange={(event) => setBatchRating(event.target.value)}
              className="w-24 sm:w-28 px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-right"
            />
            <input
              type="number"
              step="0.1"
              placeholder="批量 REP"
              value={batchRep}
              onChange={(event) => setBatchRep(event.target.value)}
              className="w-24 sm:w-28 px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-right"
            />
            <button onClick={applyBatchFill} className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors">
              填充空值
            </button>
            <button onClick={toggleSelectAll} className="px-3 py-1.5 text-xs rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors">
              {selectedCount === pendingCombos.length ? '取消全选' : '全选'}
            </button>
            <button onClick={handleBatchSettlement} className="px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors">
              批量结算已选
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {pendingCombos.map((combo) => (
          <div key={combo.id} className="glow-card bg-white rounded-2xl border border-stone-100 overflow-hidden">
            <div
              onClick={() => setExpandedCombo(expandedCombo === combo.id ? null : combo.id)}
              className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-stone-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    combo.matches.length === 1 ? 'bg-amber-100' : combo.matches.length === 2 ? 'bg-sky-100' : 'bg-violet-100'
                  }`}
                >
                  <span
                    className={`text-sm font-bold ${
                      combo.matches.length === 1 ? 'text-amber-600' : combo.matches.length === 2 ? 'text-sky-600' : 'text-violet-600'
                    }`}
                  >
                    {combo.matches.length}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-stone-800">{getComboLabel(combo.matches.length)}</p>
                  <p className="text-sm text-stone-500">
                    综合 Odds <span className="font-bold text-violet-600">{combo.totalOdds}</span> · 投资{' '}
                    <span className="font-bold text-amber-600">{combo.totalInputs} rmb</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleComboSelection(combo.id)
                  }}
                  className={`custom-checkbox ${selectedComboIds[combo.id] ? 'checked' : ''}`}
                  aria-label={selectedComboIds[combo.id] ? '取消勾选待结算记录' : '勾选待结算记录'}
                  aria-pressed={Boolean(selectedComboIds[combo.id])}
                />
                <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">待结算</span>
                {expandedCombo === combo.id ? <ChevronUp size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
                <button
                  type="button"
                  onClick={(event) => handleDeletePending(combo, event)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-stone-100/80 text-stone-500 hover:bg-rose-100 hover:text-rose-600 active:scale-95 transition-all"
                  title="删除待结算记录"
                  aria-label="删除待结算记录"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {expandedCombo === combo.id && (
              <div className="relative p-6 border-t border-stone-100 space-y-6 animate-fade-in">
                {combo.matches.map((match, matchIdx) => {
                  const matchAutoFillSnapshot = historyAutoFillSnapshots[combo.id]?.[matchIdx]
                  const showAutoFillTag = matchAutoFillSnapshot?.status === 'applied'
                  return (
                  <div key={`${combo.id}-${matchIdx}`} className={matchIdx > 0 ? 'pt-6 border-t border-stone-100' : ''}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-semibold text-stone-800">{match.match}</p>
                        {showAutoFillTag && (
                          <div className="history-float-panel history-float-enter px-1.5 py-0.5 rounded-md">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-medium text-sky-600">已自动填充</span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  revertHistoryAutoFillMatch(combo.id, matchIdx)
                                }}
                                className="history-float-item rounded-md border border-sky-200/70 bg-sky-100/70 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100/90 transition-colors"
                              >
                                撤回
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-stone-400">
                        Odds <span className="font-bold italic text-violet-600">{match.odds}</span>
                      </span>
                    </div>

                    <div className="mb-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-amber-600 font-medium">我的预测</span>
                          <span className="text-sm font-semibold text-stone-800">{match.entry}</span>
                        </div>
                        {match.preNote && <span className="text-xs text-stone-400">赛前备注: {match.preNote}</span>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div>
                        <label className="text-xs text-stone-400 mb-1.5 block">Results 实际结果</label>
                        <input
                          type="text"
                          placeholder="比分或结果..."
                          value={forms[combo.id]?.matches[matchIdx]?.results || ''}
                          onChange={(event) => updateMatchField(combo.id, matchIdx, 'results', event.target.value)}
                          className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-stone-400 mb-1.5 block">是否命中</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateMatchField(combo.id, matchIdx, 'isCorrect', true)}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-medium btn-hover flex items-center justify-center gap-1 ${
                              forms[combo.id]?.matches[matchIdx]?.isCorrect === true
                                ? 'bg-emerald-500 text-white'
                                : 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200'
                            }`}
                          >
                            <Check size={14} /> 中
                          </button>
                          <button
                            onClick={() => updateMatchField(combo.id, matchIdx, 'isCorrect', false)}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-medium btn-hover flex items-center justify-center gap-1 ${
                              forms[combo.id]?.matches[matchIdx]?.isCorrect === false
                                ? 'bg-rose-500 text-white'
                                : 'bg-stone-100 text-stone-500 border border-stone-200 hover:bg-stone-200'
                            }`}
                          >
                            <X size={14} /> 未中
                          </button>
                        </div>
                      </div>
                      <div className="relative group">
                        <label className="text-xs text-stone-400 mb-1.5 block">
                          Actual Judgmental Rating
                          <span className="ml-1 text-stone-300 cursor-help" title="赛后复盘评分">?</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={AJR_MIN}
                          max={AJR_MAX}
                          placeholder="0~0.8"
                          value={forms[combo.id]?.matches[matchIdx]?.matchRating ?? ''}
                          onChange={(event) => updateMatchField(combo.id, matchIdx, 'matchRating', event.target.value)}
                          className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm"
                        />
                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-56 p-2 bg-stone-800 text-white text-[10px] rounded-lg shadow-lg">
                          <p className="font-medium mb-1">赛后复盘评分 (0-0.8)</p>
                          <p>0.64-0.8: 判断极准，过程结果完美匹配</p>
                          <p>0.48-0.64: 判断正确，略有偏差</p>
                          <p>0.32-0.48: 判断一般，有明显失误</p>
                          <p>0.16-0.32: 判断较差，结果靠运气</p>
                          <p>&lt;0.16: 完全误判</p>
                        </div>
                      </div>
                      <div className="relative group">
                        <label className="text-xs text-stone-400 mb-1.5 block">
                          REP 随机事件
                          <span className="ml-1 text-stone-300 cursor-help" title="Random Events Parameter">?</span>
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="0~1.8"
                          value={forms[combo.id]?.matches[matchIdx]?.matchRep ?? ''}
                          onChange={(event) => updateMatchField(combo.id, matchIdx, 'matchRep', event.target.value)}
                          className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm"
                        />
                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-64 p-2 bg-stone-800 text-white text-[10px] rounded-lg shadow-lg">
                          <p className="font-medium mb-1">随机事件参数 (0-1.8)</p>
                          <p className="text-stone-300 mb-1">0: 没有随机事件</p>
                          <p className="text-stone-300 mb-1">0.2-0.8: 有随机事件但未影响结果</p>
                          <p className="text-amber-300 font-medium mt-1">以下为影响结果的随机事件:</p>
                          <p>1.2: 刻意制造的混乱 / 世界波 / 3+绝佳机会missed</p>
                          <p>1.4: 偶然出现的混乱 / 蒙了一脚</p>
                          <p>1.6: 点球、红牌 / 神仙球</p>
                          <p>1.8: 极其偶然，unpredictable</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="text-xs text-stone-400 mb-1.5 block">赛后备注（复盘心得）</label>
                      <textarea
                        rows={2}
                        placeholder="选填..."
                        value={forms[combo.id]?.matches[matchIdx]?.postNote || ''}
                        onChange={(event) => updateMatchField(combo.id, matchIdx, 'postNote', event.target.value)}
                        onKeyDown={(event) => {
                          const current = forms[combo.id]?.matches[matchIdx]?.postNote || ''
                          handleNoteShortcut(event, current, (next) => updateMatchField(combo.id, matchIdx, 'postNote', next))
                        }}
                        className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm resize-y min-h-16"
                      />
                      <p className="mt-1 text-[10px] text-stone-400">快捷键：Cmd/Ctrl+B 粗体 · Cmd/Ctrl+I 斜体 · Cmd/Ctrl+Shift+R 红色 · Cmd/Ctrl+Shift+B 蓝色</p>
                    </div>
                  </div>
                )})}

                <div className="pt-4 border-t border-stone-200">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <label className="text-xs text-stone-400 mb-1.5 block">Revenue 实际收益</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={forms[combo.id]?.revenues ?? '0'}
                          onChange={(event) => updateRevenue(combo.id, event.target.value)}
                          className="input-glow w-32 px-3 py-2.5 rounded-xl border border-stone-200 text-sm font-medium"
                        />
                        <span className="text-sm text-stone-500">rmb</span>
                        <span className="text-xs text-stone-400 ml-2">（按赔率比例分摊至各场）</span>
                      </div>
                    </div>
                    <button onClick={() => confirmSettlement(combo)} className="btn-primary btn-hover">
                      确认结算
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {pendingCombos.length === 0 && (
          <div className="glow-card bg-white rounded-2xl border border-stone-100 p-10 text-center text-stone-500">
            暂无待结算投资，去「新建投资」录一笔再回来吧。
          </div>
        )}
      </div>
    </div>
  )
}
