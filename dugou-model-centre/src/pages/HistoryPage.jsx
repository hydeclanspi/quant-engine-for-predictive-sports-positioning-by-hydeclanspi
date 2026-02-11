import { Fragment, useEffect, useMemo, useState } from 'react'
import { Search, Filter, Trash2, Archive, Undo2, ChevronRight, ChevronDown } from 'lucide-react'
import { deleteInvestment, getInvestments, saveInvestment, setInvestmentArchived } from '../lib/localData'

const LEAGUE_ORDER = ['英超', '西甲', '意甲', '德甲', '法甲', '荷甲', '葡超', '土超', '沙特联', '国际赛', '其他']
const TEAM_LEAGUE_MAP = {
  曼城: '英超',
  阿森纳: '英超',
  利物浦: '英超',
  切尔西: '英超',
  狼队: '英超',
  桑德兰: '英超',
  热刺: '英超',
  纽卡: '英超',
  曼联: '英超',
  伯恩茅斯: '英超',
  利兹联: '英超',
  水晶宫: '英超',
  埃弗顿: '英超',
  富勒姆: '英超',
  布伦特福德: '英超',
  西汉姆: '英超',
  西汉姆联: '英超',
  伯恩利: '英超',
  诺丁汉森林: '英超',
  阿斯顿维拉: '英超',
  维拉: '英超',
  巴萨: '西甲',
  皇马: '西甲',
  马竞: '西甲',
  黄潜: '西甲',
  阿拉维斯: '西甲',
  那不勒斯: '意甲',
  博洛尼亚: '意甲',
  国际米兰: '意甲',
  热那亚: '意甲',
  米兰: '意甲',
  拜仁: '德甲',
  勒沃库森: '德甲',
  奥格斯堡: '德甲',
  法兰克福: '德甲',
  巴黎: '法甲',
  埃因霍温: '荷甲',
  波尔图: '葡超',
  葡体: '葡超',
  加拉塔萨雷: '土超',
  利雅得新月: '沙特联',
  达马克: '沙特联',
}

const ODDS_FILTER_OPTIONS = [
  { value: 'all', label: '全部赔率' },
  { value: 'lt2', label: '< 2.0', min: -Infinity, max: 2.0 },
  { value: '2to3', label: '2.0 - 3.0', min: 2.0, max: 3.0 },
  { value: '3to5', label: '3.0 - 5.0', min: 3.0, max: 5.0 },
  { value: 'gte5', label: '5.0+', min: 5.0, max: Infinity },
]

const AJR_FILTER_OPTIONS = [
  { value: 'all', label: '全部AJR' },
  { value: 'lt04', label: '< 0.4', min: -Infinity, max: 0.4 },
  { value: '04to06', label: '0.4 - 0.6', min: 0.4, max: 0.6 },
  { value: '06to08', label: '0.6 - 0.8', min: 0.6, max: 0.8 },
  { value: 'gte08', label: '0.8+', min: 0.8, max: Infinity },
]

const getConfColor = (conf) => {
  const c = Number.parseFloat(conf)
  if (c >= 0.8) return 'text-blue-700'
  if (c >= 0.7) return 'text-blue-600'
  if (c >= 0.6) return 'text-blue-500'
  if (c >= 0.5) return 'text-sky-500'
  return 'text-sky-400'
}

const getAJRColor = (ajr) => {
  const a = Number.parseFloat(ajr)
  if (Number.isNaN(a)) return 'text-stone-400'
  if (a >= 0.8) return 'text-emerald-700'
  if (a >= 0.7) return 'text-emerald-600'
  if (a >= 0.6) return 'text-emerald-500'
  return 'text-green-400'
}

const formatDate = (isoString) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '--'
  const year = date.getFullYear()
  const currentYear = new Date().getFullYear()
  const shortYear = String(year).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  if (year !== currentYear) return `${shortYear}.${month}.${day}`
  return `${month}-${day}`
}

const formatProfit = (profit) => {
  if (typeof profit !== 'number' || Number.isNaN(profit)) return '-'
  if (profit > 0) return `+${profit}`
  return String(profit)
}

const getDisplayStatus = (item) => {
  const rawStatus = item.status || 'pending'
  if (rawStatus === 'pending') return 'pending'
  if (rawStatus === 'draw') return 'draw'
  const numericProfit = Number(item.profit)
  if (Number.isFinite(numericProfit) && numericProfit === 0) return 'draw'
  return rawStatus === 'win' ? 'win' : 'lose'
}

const getOutcomeTone = (text) => {
  const token = String(text || '').toLowerCase()
  if (token.includes('draw')) return 'text-sky-600'
  if (token.includes('lose')) return 'text-rose-400'
  if (token.includes('win')) return 'text-emerald-700'
  return 'text-stone-600'
}

const renderOutcomeText = (value) => {
  const text = String(value || '').trim()
  if (!text || text === '-') return <span className="text-stone-400">-</span>

  const parts = text.split(/(\s*[|+/]\s*)/g).filter(Boolean)
  return parts.map((part, idx) => {
    const trimmed = part.trim()
    const isSeparator = trimmed === '|' || trimmed === '+' || trimmed === '/'
    if (isSeparator) {
      return (
        <span key={`${trimmed}-${idx}`} className="text-stone-400">
          {` ${trimmed} `}
        </span>
      )
    }
    return (
      <span key={`${trimmed}-${idx}`} className={getOutcomeTone(trimmed)}>
        {trimmed}
      </span>
    )
  })
}

const renderStyledNote = (value) => {
  const text = String(value || '').trim()
  if (!text || text === '-') return <span className="text-stone-400">-</span>

  const lines = text.split('\n')
  return lines.map((line, lineIdx) => {
    const tokens = line.split(/(\[red\][\s\S]*?\[\/red\]|\[blue\][\s\S]*?\[\/blue\]|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean)
    return (
      <Fragment key={`line-${lineIdx}`}>
        {tokens.map((token, tokenIdx) => {
          if (token.startsWith('[red]') && token.endsWith('[/red]')) {
            return (
              <span key={`token-${lineIdx}-${tokenIdx}`} className="text-rose-500">
                {token.slice(5, -6)}
              </span>
            )
          }
          if (token.startsWith('[blue]') && token.endsWith('[/blue]')) {
            return (
              <span key={`token-${lineIdx}-${tokenIdx}`} className="text-sky-600">
                {token.slice(6, -7)}
              </span>
            )
          }
          if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
            return (
              <strong key={`token-${lineIdx}-${tokenIdx}`} className="font-semibold text-stone-700">
                {token.slice(2, -2)}
              </strong>
            )
          }
          if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
            return (
              <em key={`token-${lineIdx}-${tokenIdx}`} className="italic text-stone-700">
                {token.slice(1, -1)}
              </em>
            )
          }
          return <span key={`token-${lineIdx}-${tokenIdx}`}>{token}</span>
        })}
        {lineIdx < lines.length - 1 ? <br /> : null}
      </Fragment>
    )
  })
}

const stripNoteFormatting = (value) =>
  String(value || '')
    .replace(/\[red\]([\s\S]*?)\[\/red\]/g, '$1')
    .replace(/\[blue\]([\s\S]*?)\[\/blue\]/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/\*([\s\S]*?)\*/g, '$1')
    .trim()

const getNotePreview = (value, limit = 14) => {
  const plain = stripNoteFormatting(value)
  if (!plain || plain === '-') return '-'
  if (plain.length <= limit) return plain
  return `${plain.slice(0, limit)}...`
}

const hasNoteContent = (value) => {
  const plain = stripNoteFormatting(value)
  return Boolean(plain && plain !== '-')
}

const getStatusLabel = (status) => {
  if (status === 'pending') return '待结算'
  if (status === 'win') return '已中'
  if (status === 'draw') return '平局'
  return '未中'
}

const getStatusBadgeTone = (status) => {
  if (status === 'pending') return 'bg-amber-100 text-amber-700'
  if (status === 'win') return 'bg-emerald-100 text-emerald-800'
  if (status === 'draw') return 'bg-sky-100 text-sky-700'
  return 'bg-rose-50 text-rose-400'
}

const getMatchStatus = (match) => {
  if (match?.is_correct === true) return 'win'
  if (match?.is_correct === false) return 'lose'
  return 'pending'
}

const getTeamLeague = (teamName) => {
  const name = String(teamName || '').trim()
  if (!name) return '其他'
  if (/u23/i.test(name)) return '国际赛'
  return TEAM_LEAGUE_MAP[name] || '其他'
}

const getMatchLeague = (match) => {
  const homeLeague = getTeamLeague(match?.home_team)
  const awayLeague = getTeamLeague(match?.away_team)
  return homeLeague === '其他' ? awayLeague : homeLeague
}

const inRangeFilter = (value, option) => {
  if (!option || option.value === 'all') return true
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return false
  const min = option.min
  const max = option.max
  if (Number.isFinite(max)) {
    return number >= min && number < max
  }
  return number >= min
}

const buildComboTitle = (matches) => {
  const titles = matches
    .map((match) => `${match.home_team || '-'}vs${match.away_team || '-'}`)
    .filter(Boolean)
  if (titles.length === 0) return '组合'
  if (titles.length <= 2) return titles.join(' + ')
  return `${titles.slice(0, 2).join(' + ')} + ${titles.length - 2}场`
}

const buildRow = (item) => {
  const firstMatch = item.matches?.[0]
  const matches = Array.isArray(item.matches) ? item.matches : []
  const parlaySize = Number(item.parlay_size || item.matches?.length || 1)
  const comboName = String(item.combo_name || '').trim()
  const kind = parlaySize === 1 ? 'Solo' : 'Combo'
  const status = getDisplayStatus(item)
  const comboHitCount = matches.filter((match) => match?.is_correct === true).length
  const entries =
    matches
      .map((match) => {
        if (match.entry_text) return match.entry_text
        if (Array.isArray(match.entries)) return match.entries.map((entry) => entry.name).join(', ')
        return ''
      })
      .filter(Boolean)
      .join(' | ') || '-'

  const results = matches.map((match) => match.results).filter(Boolean).join(' | ') || '-'

  const preNote =
    matches
      .map((match) => match.note)
      .filter(Boolean)
      .join('；') || '-'

  const matchRows = matches.map((match, idx) => ({
    id: `${item.id}-m${idx + 1}`,
    seqLabel: `M${idx + 1}`,
    date: formatDate(item.created_at),
    league: getMatchLeague(match),
    match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
    entries:
      match.entry_text ||
      (Array.isArray(match.entries) ? match.entries.map((entry) => entry.name).join(', ') : '-') ||
      '-',
    results: match.results || '-',
    odds: Number(match.odds || 0).toFixed(2),
    oddsValue: Number.parseFloat(match.odds),
    conf: typeof match.conf === 'number' ? Number(match.conf).toFixed(2) : '-',
    ajr: toFixedOrDash(match.match_rating, 2),
    ajrValue: Number.parseFloat(match.match_rating),
    status: getMatchStatus(match),
    preNote: match.note || '-',
    postNote: match.post_note || '-',
  }))

  const matchAjrValues = matchRows.map((entry) => entry.ajrValue).filter((value) => Number.isFinite(value))
  const avgMatchAjr =
    matchAjrValues.length > 0
      ? matchAjrValues.reduce((sum, value) => sum + value, 0) / matchAjrValues.length
      : Number.NaN
  const investmentAjr = Number.parseFloat(item.actual_rating)
  const displayAjrValue =
    parlaySize > 1
      ? avgMatchAjr
      : Number.isFinite(investmentAjr)
        ? investmentAjr
        : avgMatchAjr

  return {
    id: item.id,
    kind,
    parlaySize,
    date: formatDate(item.created_at),
    match:
      parlaySize === 1
        ? `${firstMatch?.home_team || '-'} vs ${firstMatch?.away_team || '-'}`
        : comboName || buildComboTitle(matches),
    comboOverview: parlaySize > 1 ? `combo · ${parlaySize}场` : '',
    comboHitCount,
    entries: parlaySize > 1 ? '-' : entries,
    results: parlaySize > 1 ? `${comboHitCount}/${parlaySize}` : results,
    odds: Number(item.combined_odds || 0).toFixed(2),
    conf: parlaySize > 1 ? '-' : Number(item.expected_rating || 0).toFixed(2),
    ajr: Number.isFinite(displayAjrValue) ? displayAjrValue.toFixed(2) : '-',
    inputs: Number(item.inputs || 0),
    status,
    isArchived: Boolean(item.is_archived),
    profit: formatProfit(item.profit),
    preNote: parlaySize > 1 ? (preNote === '-' ? '-' : '见分场赛前备注') : preNote,
    postNote: item.remarks || '-',
    leagues: [...new Set(matchRows.map((entry) => entry.league).filter(Boolean))],
    oddsValues: matchRows.map((entry) => entry.oddsValue).filter((value) => Number.isFinite(value)),
    ajrValues: matchRows.map((entry) => entry.ajrValue).filter((value) => Number.isFinite(value)),
    matchRows,
  }
}

const toFixedOrDash = (value, digits = 2) => {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return '-'
  return n.toFixed(digits)
}

const formatRmbAmount = (value) => {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return '-'
  const rounded = Math.round(n)
  if (Math.abs(n - rounded) < 0.01) return String(rounded)
  return n.toFixed(2)
}

const buildDataRows = (investments) => {
  if (!Array.isArray(investments)) return []

  return investments.flatMap((item) => {
    const matches = Array.isArray(item.matches) && item.matches.length > 0 ? item.matches : [{}]
    const parlaySize = Number(item.parlay_size || matches.length || 1)
    const kind = parlaySize === 1 ? 'Solo' : 'Combo'
    const investmentStatus = getDisplayStatus(item)
    const totalInputs = Number.parseFloat(item.inputs)
    const totalRevenues = Number.parseFloat(item.revenues)
    const settledProfit = Number.parseFloat(item.profit)
    const perInput = Number.isFinite(totalInputs) && matches.length > 0 ? totalInputs / matches.length : 0
    const fallbackPerProfit = Number.isFinite(settledProfit) && matches.length > 0 ? settledProfit / matches.length : Number.NaN

    const validOdds = matches
      .map((match) => Number.parseFloat(match?.odds))
      .filter((odd) => Number.isFinite(odd) && odd > 0)
    const oddsSum = validOdds.reduce((sum, odd) => sum + odd, 0)

    return matches.map((match, idx) => {
      const odds = Number.parseFloat(match?.odds)
      const weightedRevenue =
        Number.isFinite(totalRevenues) && totalRevenues > 0 && oddsSum > 0 && Number.isFinite(odds) && odds > 0
          ? (totalRevenues * odds) / oddsSum
          : Number.NaN
      const allocatedProfit = Number.isFinite(weightedRevenue) ? weightedRevenue - perInput : fallbackPerProfit
      const matchStatus = getMatchStatus(match)
      const status =
        investmentStatus === 'pending'
          ? 'pending'
          : matchStatus === 'pending'
            ? investmentStatus
            : matchStatus

      const entries =
        match.entry_text ||
        (Array.isArray(match.entries) ? match.entries.map((entry) => entry.name).join(', ') : '-') ||
        '-'

      return {
        id: `${item.id}-flat-${idx + 1}`,
        investmentId: item.id,
        isPrimary: idx === 0,
        kind,
        isArchived: Boolean(item.is_archived),
        date: formatDate(item.created_at),
        league: getMatchLeague(match),
        match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
        entries,
        results: match.results || '-',
        odds: toFixedOrDash(match.odds, 2),
        oddsValue: Number.parseFloat(match?.odds),
        conf: toFixedOrDash(match.conf, 2),
        ajr: toFixedOrDash(match.match_rating, 2),
        ajrValue: Number.parseFloat(match?.match_rating),
        inputs: formatRmbAmount(perInput),
        status,
        profit:
          investmentStatus === 'pending'
            ? '-'
            : formatProfit(Number.isFinite(allocatedProfit) ? Number(allocatedProfit.toFixed(2)) : Number.NaN),
        preNote: match.note || '-',
        postNote: match.post_note || '-',
      }
    })
  })
}

export default function HistoryPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('全部')
  const [layoutMode, setLayoutMode] = useState('modern')
  const [leagueFilter, setLeagueFilter] = useState('all')
  const [oddsFilter, setOddsFilter] = useState('all')
  const [ajrFilter, setAjrFilter] = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingUndo, setPendingUndo] = useState(null)
  const [expandedComboIds, setExpandedComboIds] = useState({})
  const [expandedSoloIds, setExpandedSoloIds] = useState({})
  const [notePopup, setNotePopup] = useState(null)

  const filters = ['全部', '待结算', '已中', '未中', 'Solo', 'Combo', '已归档']
  const rawInvestments = useMemo(() => getInvestments(), [refreshKey])
  const rawRows = useMemo(() => rawInvestments.map(buildRow), [rawInvestments])
  const dataRows = useMemo(() => buildDataRows(rawInvestments), [rawInvestments])
  const leagueOptions = useMemo(() => {
    const set = new Set()
    rawRows.forEach((row) => {
      ;(row.leagues || []).forEach((league) => {
        if (league) set.add(league)
      })
    })
    const sorted = [...set].sort((a, b) => {
      const orderA = LEAGUE_ORDER.indexOf(a)
      const orderB = LEAGUE_ORDER.indexOf(b)
      const normalizedA = orderA === -1 ? Number.MAX_SAFE_INTEGER : orderA
      const normalizedB = orderB === -1 ? Number.MAX_SAFE_INTEGER : orderB
      return normalizedA - normalizedB || a.localeCompare(b, 'zh-Hans-CN')
    })
    return [{ value: 'all', label: '全部联赛' }, ...sorted.map((league) => ({ value: league, label: league }))]
  }, [rawRows])
  const activeOddsOption = useMemo(() => ODDS_FILTER_OPTIONS.find((option) => option.value === oddsFilter) || ODDS_FILTER_OPTIONS[0], [oddsFilter])
  const activeAjrOption = useMemo(() => AJR_FILTER_OPTIONS.find((option) => option.value === ajrFilter) || AJR_FILTER_OPTIONS[0], [ajrFilter])

  useEffect(
    () => () => {
      if (pendingUndo?.timeoutId) {
        window.clearTimeout(pendingUndo.timeoutId)
      }
    },
    [pendingUndo],
  )

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return rawRows.filter((row) => {
      if (activeFilter === '已归档') {
        if (!row.isArchived) return false
      } else if (row.isArchived) {
        return false
      }

      const passFilter =
        activeFilter === '全部' ||
        activeFilter === '已归档' ||
        (activeFilter === '待结算' && row.status === 'pending') ||
        (activeFilter === '已中' && row.status === 'win') ||
        (activeFilter === '未中' && row.status === 'lose') ||
        activeFilter === row.kind

      if (!passFilter) return false

      if (leagueFilter !== 'all' && !(row.leagues || []).includes(leagueFilter)) return false
      if (oddsFilter !== 'all' && !(row.oddsValues || []).some((value) => inRangeFilter(value, activeOddsOption))) return false
      if (ajrFilter !== 'all' && !(row.ajrValues || []).some((value) => inRangeFilter(value, activeAjrOption))) return false
      if (!query) return true

      const nestedText =
        row.matchRows
          ?.map((item) => [item.match, item.league, item.entries, item.results, item.preNote, item.postNote].join(' '))
          .join(' ') || ''
      const target = [row.date, row.match, row.comboOverview, row.entries, row.preNote, row.postNote, ...(row.leagues || []), nestedText]
        .join(' ')
        .toLowerCase()
      return target.includes(query)
    })
  }, [activeAjrOption, activeFilter, activeOddsOption, ajrFilter, leagueFilter, oddsFilter, rawRows, searchQuery])

  const filteredDataRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return dataRows.filter((row) => {
      if (activeFilter === '已归档') {
        if (!row.isArchived) return false
      } else if (row.isArchived) {
        return false
      }

      const passFilter =
        activeFilter === '全部' ||
        activeFilter === '已归档' ||
        (activeFilter === '待结算' && row.status === 'pending') ||
        (activeFilter === '已中' && row.status === 'win') ||
        (activeFilter === '未中' && row.status === 'lose') ||
        activeFilter === row.kind

      if (!passFilter) return false

      if (leagueFilter !== 'all' && row.league !== leagueFilter) return false
      if (oddsFilter !== 'all' && !inRangeFilter(row.oddsValue, activeOddsOption)) return false
      if (ajrFilter !== 'all' && !inRangeFilter(row.ajrValue, activeAjrOption)) return false
      if (!query) return true

      const target = [row.date, row.league, row.match, row.entries, row.results, row.preNote, row.postNote].join(' ').toLowerCase()
      return target.includes(query)
    })
  }, [activeAjrOption, activeFilter, activeOddsOption, ajrFilter, dataRows, leagueFilter, oddsFilter, searchQuery])

  const handleDeleteRecord = (id, event) => {
    event.stopPropagation()
    const ok = window.confirm('确认删除这条投资记录吗？此操作不可撤销。')
    if (!ok) return
    const target = rawInvestments.find((item) => item.id === id)
    if (!target) return
    if (pendingUndo?.timeoutId) {
      window.clearTimeout(pendingUndo.timeoutId)
    }
    const deleted = deleteInvestment(id)
    if (!deleted) return
    const timeoutId = window.setTimeout(() => {
      setPendingUndo(null)
    }, 5000)
    setPendingUndo({
      id,
      record: target,
      timeoutId,
    })
    setRefreshKey((prev) => prev + 1)
  }

  const handleToggleArchive = (id, archived, event) => {
    event.stopPropagation()
    const ok = setInvestmentArchived(id, !archived)
    if (!ok) return
    setRefreshKey((prev) => prev + 1)
  }

  const handleUndoDelete = () => {
    if (!pendingUndo) return
    if (pendingUndo.timeoutId) {
      window.clearTimeout(pendingUndo.timeoutId)
    }
    saveInvestment(pendingUndo.record)
    setPendingUndo(null)
    setRefreshKey((prev) => prev + 1)
  }

  useEffect(() => {
    const visibleIds = new Set(filteredRows.map((row) => row.id))
    setExpandedComboIds((prev) => {
      const next = {}
      Object.entries(prev).forEach(([id, expanded]) => {
        if (expanded && visibleIds.has(id)) next[id] = true
      })
      return next
    })
    setExpandedSoloIds((prev) => {
      const next = {}
      Object.entries(prev).forEach(([id, expanded]) => {
        if (expanded && visibleIds.has(id)) next[id] = true
      })
      return next
    })
  }, [filteredRows])

  const showNote = (note, label, event) => {
    event.stopPropagation()
    const plain = stripNoteFormatting(note)
    if (!plain || plain === '-') return
    setNotePopup({
      note,
      label,
      position: { x: event.clientX, y: event.clientY },
    })
  }

  const totalCount = layoutMode === 'modern' ? rawRows.length : dataRows.length
  const allExpandedInModern =
    filteredRows.length > 0 &&
    filteredRows.every((row) => (row.parlaySize === 1 ? Boolean(expandedSoloIds[row.id]) : Boolean(expandedComboIds[row.id])))

  const toggleExpandAllInModern = () => {
    if (allExpandedInModern) {
      setExpandedComboIds({})
      setExpandedSoloIds({})
      return
    }
    const nextComboExpanded = {}
    const nextSoloExpanded = {}
    filteredRows.forEach((row) => {
      if (row.parlaySize === 1) {
        nextSoloExpanded[row.id] = true
      } else {
        nextComboExpanded[row.id] = true
      }
    })
    setExpandedComboIds(nextComboExpanded)
    setExpandedSoloIds(nextSoloExpanded)
  }

  return (
    <div className="page-shell page-content-wide" onClick={() => setNotePopup(null)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-stone-800 font-display">历史记录</h2>
          <p className="text-stone-400 text-sm mt-1">共 {totalCount} 条投资记录</p>
        </div>
        <div className="flex w-full md:w-auto flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              placeholder="搜索球队、日期..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="input-glow pl-10 pr-4 py-2 rounded-xl border border-stone-200 text-sm w-full sm:w-64 focus:outline-none focus:border-amber-400"
            />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white/90 px-2 py-1">
            <Filter size={14} className="text-stone-400" />
            <select
              value={leagueFilter}
              onChange={(event) => setLeagueFilter(event.target.value)}
              className="bg-transparent text-xs text-stone-600 focus:outline-none"
            >
              {leagueOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-stone-300">|</span>
            <select
              value={oddsFilter}
              onChange={(event) => setOddsFilter(event.target.value)}
              className="bg-transparent text-xs text-stone-600 focus:outline-none"
            >
              {ODDS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-stone-300">|</span>
            <select
              value={ajrFilter}
              onChange={(event) => setAjrFilter(event.target.value)}
              className="bg-transparent text-xs text-stone-600 focus:outline-none"
            >
              {AJR_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setLayoutMode((prev) => (prev === 'modern' ? 'data' : 'modern'))}
            className="btn-secondary btn-hover flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {layoutMode === 'modern' ? '视图：现代' : '视图：数据'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {filters.map((tag) => (
          <button
            key={tag}
            onClick={() => setActiveFilter(tag)}
            className={`px-4 py-1.5 rounded-full text-sm btn-hover transition-all ${
              activeFilter === tag ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="glow-card bg-white rounded-2xl border border-stone-100 overflow-hidden">
        {layoutMode === 'modern' ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-stone-50 text-[11px] text-stone-500">
                <th className="px-2.5 py-3 text-left font-medium whitespace-nowrap w-16">日期</th>
                <th className="px-3 py-3 text-left font-medium">比赛</th>
                <th className="px-3 py-3 text-left font-medium">Entries</th>
                <th className="px-3 py-3 text-left font-medium">Results</th>
                <th className="px-3 py-3 text-left font-medium">AJR</th>
                <th className="px-3 py-3 text-left font-medium">盈亏</th>
                <th className="px-3 py-3 text-right font-medium">
                  <div className="inline-flex items-center gap-2">
                    <span>操作</span>
                    <button
                      type="button"
                      onClick={toggleExpandAllInModern}
                      className="px-2 py-1 rounded-md border border-stone-200 text-[10px] text-stone-500 hover:text-stone-700 hover:bg-stone-50 transition-colors"
                    >
                      {allExpandedInModern ? '全部收起' : '全部展开'}
                    </button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isSolo = row.parlaySize === 1
                const isExpanded = isSolo ? Boolean(expandedSoloIds[row.id]) : Boolean(expandedComboIds[row.id])

                return (
                <Fragment key={row.id}>
                  <tr className="border-t border-stone-100 bg-amber-50/20 hover:bg-amber-50/40 transition-colors text-[11px]">
                    <td className="px-2.5 py-2.5 text-stone-500 whitespace-nowrap min-w-[64px]">{row.date}</td>
                    <td className="px-3 py-2.5 font-medium text-stone-700">
                      {isSolo ? (
                        <button
                          onClick={() => setExpandedSoloIds((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                          className="w-full flex items-center justify-between gap-3 text-left group"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? '收起详情' : '展开详情'}
                        >
                          <span className="block">{row.match}</span>
                          <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border border-stone-200 text-stone-400 group-hover:text-stone-600 group-hover:border-stone-300">
                            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setExpandedComboIds((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                          }}
                          className="inline-flex items-start gap-2 text-left group"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? '收起详情' : '展开详情'}
                        >
                          <span className="mt-0.5 text-stone-400 group-hover:text-stone-600">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </span>
                          <span>
                            <span className="block">{row.match}</span>
                            <span className="block mt-0.5 text-[10px] font-normal text-stone-500">{row.comboOverview}</span>
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 max-w-36">
                      {row.parlaySize > 1 ? (
                        <span className="text-stone-400">{row.parlaySize} 场</span>
                      ) : (
                        <div className="truncate text-stone-600">{renderOutcomeText(row.entries)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 max-w-32 font-semibold">
                      {row.parlaySize > 1 ? (
                        <span className="inline-flex items-center font-medium text-stone-400">
                          {row.comboHitCount}
                          <span className="mx-[2px] text-stone-400">/</span>
                          {row.parlaySize}
                        </span>
                      ) : (
                        <div className="truncate">{renderOutcomeText(row.results)}</div>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 font-semibold ${row.ajr === '-' ? 'text-stone-300' : getAJRColor(row.ajr)}`}>
                      {row.ajr === '-' ? '—' : row.ajr}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-semibold ${
                        row.profit === '-'
                          ? 'text-stone-400'
                          : row.status === 'draw'
                            ? 'text-sky-600'
                            : row.profit.startsWith('+')
                              ? 'text-emerald-600'
                              : 'text-rose-500'
                      }`}
                    >
                      {row.profit}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={(event) => handleToggleArchive(row.id, row.isArchived, event)}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-stone-400 hover:text-sky-600 hover:bg-sky-50 transition-colors mr-1"
                        title={row.isArchived ? '取消归档' : '归档记录'}
                        aria-label={row.isArchived ? '取消归档' : '归档记录'}
                      >
                        {row.isArchived ? <Undo2 size={13} /> : <Archive size={13} />}
                      </button>
                      <button
                        onClick={(event) => handleDeleteRecord(row.id, event)}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-stone-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                        title="删除记录"
                        aria-label="删除记录"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>

                  {isSolo && isExpanded && (
                    <tr className="border-t border-stone-100 bg-white text-[11px]">
                      <td colSpan={7} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-stone-400">状态</span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${getStatusBadgeTone(row.status)}`}>
                              {getStatusLabel(row.status)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-stone-400">Odds</span>
                            <span className="font-semibold italic text-violet-600">{row.odds}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-stone-400">Conf</span>
                            <span className={`font-semibold ${getConfColor(row.conf)}`}>{row.conf}</span>
                          </div>
                          <div className="max-w-[280px]">
                            <span className="text-stone-400 mr-1.5">赛前备注</span>
                            <span className="text-stone-600">{renderStyledNote(row.preNote || '-')}</span>
                          </div>
                          <div className="max-w-[280px]">
                            <span className="text-stone-400 mr-1.5">赛后备注</span>
                            <span className="text-stone-600">{renderStyledNote(row.postNote || '-')}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!isSolo && isExpanded && (
                    <tr className="border-t border-stone-100 bg-stone-50/60 text-[11px]">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="rounded-xl border border-stone-200 bg-white p-4">
                          <div className="space-y-2">
                            {row.matchRows.map((matchRow) => (
                              <div key={matchRow.id} className="rounded-lg border border-stone-100 px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-stone-700 font-medium">
                                    {matchRow.seqLabel} · {matchRow.match}
                                  </p>
                                  <p className="text-[10px] text-stone-400">{matchRow.date}</p>
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-6">
                                  <div>
                                    <p className="text-[10px] text-stone-400">Entries</p>
                                    <p className="mt-0.5">{renderOutcomeText(matchRow.entries)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-stone-400">Results</p>
                                    <p className="mt-0.5 font-semibold">{renderOutcomeText(matchRow.results)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-stone-400">Odds</p>
                                    <p className="mt-0.5 font-semibold italic text-violet-600">{matchRow.odds}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-stone-400">Conf / AJR</p>
                                    <p className="mt-0.5 font-semibold">
                                      <span className={matchRow.conf === '-' ? 'text-stone-300' : getConfColor(matchRow.conf)}>
                                        {matchRow.conf === '-' ? '—' : matchRow.conf}
                                      </span>
                                      <span className="mx-1 text-stone-300">/</span>
                                      <span className={matchRow.ajr === '-' ? 'text-stone-300' : getAJRColor(matchRow.ajr)}>
                                        {matchRow.ajr === '-' ? '—' : matchRow.ajr}
                                      </span>
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-stone-400">状态</p>
                                    <p className="mt-0.5">
                                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${getStatusBadgeTone(matchRow.status)}`}>
                                        {getStatusLabel(matchRow.status)}
                                      </span>
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-stone-400">备注</p>
                                    <p className="mt-0.5 text-stone-600">
                                      {renderStyledNote(matchRow.preNote !== '-' ? matchRow.preNote : matchRow.postNote || '-')}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="grid gap-2 mt-3 border-t border-stone-100 pt-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                              <p className="text-[10px] text-stone-400">状态</p>
                              <p className="mt-1">
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${getStatusBadgeTone(row.status)}`}>
                                  {getStatusLabel(row.status)}
                                </span>
                              </p>
                            </div>
                            <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                              <p className="text-[10px] text-stone-400">投入</p>
                              <p className="mt-1 font-semibold text-amber-600">{row.inputs} rmb</p>
                            </div>
                            <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                              <p className="text-[10px] text-stone-400">Odds</p>
                              <p className="mt-1 font-semibold italic text-violet-600">{row.odds}</p>
                            </div>
                            <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                              <p className="text-[10px] text-stone-400">Conf</p>
                              <p className="mt-1 font-semibold text-stone-300">—</p>
                            </div>
                          </div>
                        </div>
                      </td>
                      </tr>
                  )}
                </Fragment>
                )
              })}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <p className="text-sm text-stone-500">还没有匹配的数据，先去「新建投资」录入一条吧。</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-stone-50 text-[11px] text-stone-500">
                  <th className="px-2 py-3 text-left font-medium">日期</th>
                  <th className="px-2 py-3 text-left font-medium">比赛</th>
                  <th className="px-2 py-3 text-left font-medium">Entries</th>
                  <th className="px-2 py-3 text-left font-medium">Results</th>
                  <th className="px-2 py-3 text-left font-medium">Odds</th>
                  <th className="px-2 py-3 text-left font-medium">Conf</th>
                  <th className="px-2 py-3 text-left font-medium">AJR</th>
                  <th className="px-2 py-3 text-left font-medium">Inputs</th>
                  <th className="px-2 py-3 text-left font-medium">状态</th>
                  <th className="px-2 py-3 text-left font-medium">盈亏</th>
                  <th className="px-2 py-3 text-left font-medium">赛前备注</th>
                  <th className="px-2 py-3 text-left font-medium">赛后备注</th>
                  <th className="px-2 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredDataRows.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100 hover:bg-amber-50/30 transition-colors text-[11px]">
                    <td className="px-2 py-2.5 text-stone-500 whitespace-nowrap">{row.date}</td>
                    <td className="px-2 py-2.5 font-medium text-stone-700">{row.match}</td>
                    <td className="px-2 py-2.5 text-stone-600">{renderOutcomeText(row.entries)}</td>
                    <td className="px-2 py-2.5 font-semibold">{renderOutcomeText(row.results)}</td>
                    <td className="px-2 py-2.5 font-bold italic text-violet-600">{row.odds}</td>
                    <td className={`px-2 py-2.5 font-semibold ${row.conf === '-' ? 'text-stone-400' : getConfColor(row.conf)}`}>{row.conf}</td>
                    <td className={`px-2 py-2.5 font-semibold ${row.ajr === '-' ? 'text-stone-400' : getAJRColor(row.ajr)}`}>{row.ajr}</td>
                    <td className="px-2 py-2.5 font-semibold text-amber-600">{row.inputs === '-' ? '-' : `${row.inputs} rmb`}</td>
                    <td className="px-2 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${getStatusBadgeTone(row.status)}`}>
                        {getStatusLabel(row.status)}
                      </span>
                    </td>
                    <td
                      className={`px-2 py-2.5 font-semibold ${
                        row.profit === '-'
                          ? 'text-stone-400'
                          : row.status === 'draw'
                            ? 'text-sky-600'
                            : row.profit.startsWith('+')
                              ? 'text-emerald-600'
                              : 'text-rose-500'
                      }`}
                    >
                      {row.profit}
                    </td>
                    <td className="px-2 py-2.5 max-w-32">
                      {hasNoteContent(row.preNote) ? (
                        <button onClick={(event) => showNote(row.preNote, '赛前备注', event)} className="note-cell block w-full truncate text-left text-stone-600">
                          {getNotePreview(row.preNote)}
                        </button>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 max-w-32">
                      {hasNoteContent(row.postNote) ? (
                        <button onClick={(event) => showNote(row.postNote, '赛后备注', event)} className="note-cell block w-full truncate text-left text-stone-600">
                          {getNotePreview(row.postNote)}
                        </button>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {row.isPrimary ? (
                        <>
                          <button
                            onClick={(event) => handleToggleArchive(row.investmentId, row.isArchived, event)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-stone-400 hover:text-sky-600 hover:bg-sky-50 transition-colors mr-1"
                            title={row.isArchived ? '取消归档' : '归档记录'}
                            aria-label={row.isArchived ? '取消归档' : '归档记录'}
                          >
                            {row.isArchived ? <Undo2 size={13} /> : <Archive size={13} />}
                          </button>
                          <button
                            onClick={(event) => handleDeleteRecord(row.investmentId, event)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-stone-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                            title="删除记录"
                            aria-label="删除记录"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredDataRows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-6 py-16 text-center">
                      <p className="text-sm text-stone-500">还没有匹配的数据，先去「新建投资」录入一条吧。</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {notePopup && (
        <div
          className="fixed bg-white rounded-xl shadow-xl border border-stone-200 p-4 max-w-72 z-50 animate-fade-in"
          style={{
            top: Math.min(notePopup.position.y + 10, window.innerHeight - 220),
            left: Math.min(notePopup.position.x, window.innerWidth - 300),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-stone-400">{notePopup.label ? `${notePopup.label} · 完整内容` : '完整备注'}</span>
            <button onClick={() => setNotePopup(null)} className="text-stone-400 hover:text-stone-600 text-sm">
              ×
            </button>
          </div>
          <div className="text-sm text-stone-700 leading-relaxed">{renderStyledNote(notePopup.note)}</div>
        </div>
      )}

      {pendingUndo && (
        <div className="fixed bottom-5 right-5 z-50 bg-stone-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-fade-in">
          <span className="text-xs">记录已删除</span>
          <button
            onClick={handleUndoDelete}
            className="text-xs px-2 py-1 rounded-md bg-amber-400 text-stone-900 font-medium hover:bg-amber-300 transition-colors"
          >
            撤销
          </button>
        </div>
      )}
    </div>
  )
}
