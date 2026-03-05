import { Fragment, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { getTeamsSnapshot } from '../lib/analytics'
import { getInvestments, getTeamProfiles } from '../lib/localData'
import { lookupTeam, LEAGUE_TAGS } from '../lib/teamDatabase'
import TimeRangePicker from '../components/TimeRangePicker'

const PERIOD_LABELS = {
  '1w': '近一周',
  '2w': '近两周',
  '1m': '近一月',
  all: '全部时间',
}

const LEAGUE_ALL_KEY = 'all'
// LEAGUE_ORDER uses imported LEAGUE_TAGS — comprehensive list from teamDatabase.js
const LEAGUE_ORDER = LEAGUE_TAGS

const toSigned = (value, digits = 2, suffix = '') => {
  const num = Number(value || 0)
  const sign = num > 0 ? '+' : ''
  return `${sign}${num.toFixed(digits)}${suffix}`
}

const normalize = (value) => String(value || '').trim().toLowerCase()

const getRangeDays = (periodKey) => {
  if (periodKey === '1w') return 7
  if (periodKey === '2w') return 14
  if (periodKey === '1m') return 30
  return null
}

const getPeriodRange = (periodKey, now = new Date()) => {
  const days = getRangeDays(periodKey)
  if (!days) return null
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  return { start, end }
}

const inRange = (value, range) => {
  if (!range) return true
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return false
  return time >= range.start.getTime() && time <= range.end.getTime()
}

const formatDateDash = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

const getEntryText = (match) => {
  if (match?.entry_text) return match.entry_text
  if (Array.isArray(match?.entries)) {
    return match.entries
      .map((entry) => entry?.name)
      .filter(Boolean)
      .join(', ')
  }
  return '-'
}

const getAJRColor = (ajr) => {
  const value = Number.parseFloat(ajr)
  if (!Number.isFinite(value)) return 'text-stone-400'
  if (value >= 0.8) return 'text-emerald-700'
  if (value >= 0.7) return 'text-emerald-600'
  if (value >= 0.6) return 'text-teal-500'
  if (value >= 0.4) return 'text-teal-400'
  if (value >= 0.2) return 'text-emerald-300'
  return 'text-emerald-200'
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000

// 样本量字符串
const getSampleText = (count) => `样本 ${count}`

const normalizeSeries = (series) => {
  if (!Array.isArray(series)) return [0]
  const values = series.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  return values.length > 0 ? values : [0]
}

const buildTeamMatchGroupKey = (homeTeam, awayTeam) => `${normalize(homeTeam)}__${normalize(awayTeam)}`

const groupTeamHistoryRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const groups = []
  const latestGroupIndexByMatch = new Map()

  rows.forEach((row, rowIndex) => {
    const matchKey = row.matchKey || buildTeamMatchGroupKey(row.homeTeam, row.awayTeam)
    const groupIndex = latestGroupIndexByMatch.get(matchKey)
    const timestamp = Number.isFinite(row.timestamp) ? row.timestamp : 0
    const canMerge =
      Number.isInteger(groupIndex) &&
      groups[groupIndex] &&
      Number.isFinite(groups[groupIndex].anchorTimestamp) &&
      groups[groupIndex].anchorTimestamp - timestamp <= TWO_DAYS_MS

    if (canMerge) {
      groups[groupIndex].items.push(row)
      return
    }

    const nextGroup = {
      id: `${matchKey}-${timestamp}-${rowIndex}`,
      matchKey,
      anchorTimestamp: timestamp,
      items: [row],
    }
    groups.push(nextGroup)
    latestGroupIndexByMatch.set(matchKey, groups.length - 1)
  })

  return groups
}

const buildAliasMap = (profiles) => {
  const map = new Map()
  profiles.forEach((profile) => {
    const canonicalName = normalize(profile.teamName) === '西汉姆' ? '西汉姆联' : profile.teamName
    const aliases = [profile.teamName, ...(profile.abbreviations || [])]
    aliases.forEach((alias) => map.set(normalize(alias), canonicalName))
  })
  return map
}

const normalizeTeamName = (teamName, aliasMap) => {
  const resolved = aliasMap.get(normalize(teamName)) || String(teamName || '').trim()
  if (normalize(resolved) === '西汉姆') return '西汉姆联'
  return resolved
}

const getTeamLeague = (teamName) => {
  const normalizedName = String(teamName || '').trim()
  if (!normalizedName) return '其他'
  if (/u\d+|U\d+/i.test(normalizedName)) return '国际赛'
  const match = lookupTeam(normalizedName)
  return match ? match.league : '其他'
}

const buildTeamHistoryRowsMap = (periodKey) => {
  const range = getPeriodRange(periodKey)
  const aliasMap = buildAliasMap(getTeamProfiles())
  const investments = getInvestments().filter((item) => !item?.is_archived && inRange(item.created_at, range))
  const rowsByTeam = new Map()

  const appendRow = (teamName, row) => {
    if (!teamName) return
    if (!rowsByTeam.has(teamName)) rowsByTeam.set(teamName, [])
    rowsByTeam.get(teamName).push(row)
  }

  investments.forEach((investment) => {
    const matches = Array.isArray(investment.matches) ? investment.matches : []
    if (matches.length === 0) return

    const inputs = Number.parseFloat(investment.inputs)
    const revenues = Number.parseFloat(investment.revenues)
    const settledProfit = Number.parseFloat(investment.profit)
    const perInput = Number.isFinite(inputs) ? inputs / matches.length : 0
    const fallbackPerProfit = Number.isFinite(settledProfit) ? settledProfit / matches.length : Number.NaN
    const isPending = investment.status === 'pending'

    const validOdds = matches
      .map((match) => Number.parseFloat(match?.odds))
      .filter((odd) => Number.isFinite(odd) && odd > 0)
    const oddsSum = validOdds.reduce((sum, odd) => sum + odd, 0)

    matches.forEach((match) => {
      const odd = Number.parseFloat(match?.odds)
      const weightedRevenue =
        Number.isFinite(revenues) && revenues > 0 && oddsSum > 0 && Number.isFinite(odd) && odd > 0 ? (revenues * odd) / oddsSum : Number.NaN
      const allocatedProfit = Number.isFinite(weightedRevenue) ? weightedRevenue - perInput : fallbackPerProfit
      const profitText =
        isPending || !Number.isFinite(allocatedProfit) ? '待结算' : `${allocatedProfit >= 0 ? '+' : '-'}¥${Math.round(Math.abs(allocatedProfit))}`
      const homeTeam = normalizeTeamName(match.home_team, aliasMap)
      const awayTeam = normalizeTeamName(match.away_team, aliasMap)
      const timestamp = new Date(investment.created_at || 0).getTime()
      const ajr = Number.parseFloat(match?.match_rating)
      const row = {
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
        date: formatDateDash(investment.created_at),
        match: `${homeTeam || '-'} vs ${awayTeam || '-'}`,
        entry: getEntryText(match),
        result: match.results || '-',
        odds: Number.isFinite(odd) ? odd.toFixed(2) : '-',
        ajr: Number.isFinite(ajr) ? ajr.toFixed(2) : '-',
        ajrValue: Number.isFinite(ajr) ? ajr : null,
        profit: profitText,
        homeTeam,
        awayTeam,
        matchKey: buildTeamMatchGroupKey(homeTeam, awayTeam),
      }

      appendRow(homeTeam, row)
      appendRow(awayTeam, row)
    })
  })

  rowsByTeam.forEach((rows, teamName) => {
    rowsByTeam.set(teamName, rows.sort((a, b) => b.timestamp - a.timestamp))
  })

  return rowsByTeam
}

export default function TeamsPage() {
  const [selectedTeamName, setSelectedTeamName] = useState('阿森纳')
  const [searchQuery, setSearchQuery] = useState('')
  const [timePeriod, setTimePeriod] = useState('all')
  const [leagueFilter, setLeagueFilter] = useState(LEAGUE_ALL_KEY)
  const [teamHistoryPage, setTeamHistoryPage] = useState(1)
  const [expandedHistoryGroupIds, setExpandedHistoryGroupIds] = useState([])
  const [roiHoverIndex, setRoiHoverIndex] = useState(null)
  const [ratingHoverIndex, setRatingHoverIndex] = useState(null)

  const teamsByPeriod = useMemo(() => getTeamsSnapshot('', timePeriod), [timePeriod])
  const leagueOptions = useMemo(() => {
    const leagues = [...new Set(teamsByPeriod.map((team) => getTeamLeague(team.name)))]
    leagues.sort((a, b) => {
      const aIdx = LEAGUE_ORDER.indexOf(a)
      const bIdx = LEAGUE_ORDER.indexOf(b)
      const normalizedA = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx
      const normalizedB = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx
      return normalizedA - normalizedB || a.localeCompare(b, 'zh-Hans-CN')
    })
    return leagues.reduce(
      (acc, league) => ({
        ...acc,
        [league]: league,
      }),
      { [LEAGUE_ALL_KEY]: '全部联赛' },
    )
  }, [teamsByPeriod])
  const searchedTeams = useMemo(() => getTeamsSnapshot(searchQuery, timePeriod), [searchQuery, timePeriod])
  const teams = useMemo(() => {
    if (leagueFilter === LEAGUE_ALL_KEY) return searchedTeams
    return searchedTeams.filter((team) => getTeamLeague(team.name) === leagueFilter)
  }, [searchedTeams, leagueFilter])
  const teamHistoryRowsMap = useMemo(() => buildTeamHistoryRowsMap(timePeriod), [timePeriod])

  useEffect(() => {
    if (!leagueOptions[leagueFilter]) setLeagueFilter(LEAGUE_ALL_KEY)
  }, [leagueFilter, leagueOptions])

  useEffect(() => {
    setRoiHoverIndex(null)
    setRatingHoverIndex(null)
  }, [selectedTeamName])

  const selectedTeam = useMemo(
    () => (selectedTeamName === '__none__' ? null : teams.find((team) => team.name === selectedTeamName) || teams[0] || null),
    [selectedTeamName, teams],
  )
  const selectedTeamDetail = useMemo(() => {
    if (!selectedTeam) return null
    const roiLabels = (selectedTeam.roiHistory || []).map((item) => String(item.label || '').replace('-', '/')).slice(-8)
    const roiSeries = (selectedTeam.roiHistory || []).map((item) => Number(item.value || 0)).slice(-8)
    const history = teamHistoryRowsMap.get(selectedTeam.name) || []
    const ratingRows = history.filter((row) => Number.isFinite(row.ajrValue)).slice(0, 8).reverse()
    const ratingLabels = ratingRows.map((row) => String(row.date || '--').replace('-', '/'))
    const ratingSeries = ratingRows.map((row) => Number(row.ajrValue || 0))
    const historyGroups = groupTeamHistoryRows(history)

    return {
      roiLabels: roiLabels.length > 0 ? roiLabels : ['--', '--', '--'],
      roiSeries: roiSeries.length > 0 ? roiSeries : [0],
      ratingLabels: ratingLabels.length > 0 ? ratingLabels : ['--', '--', '--'],
      ratingSeries: ratingSeries.length > 0 ? ratingSeries : [0],
      history,
      historyGroups,
    }
  }, [selectedTeam, teamHistoryRowsMap])
  const teamHistoryPageSize = 7
  const totalTeamHistoryPages = selectedTeamDetail ? Math.max(1, Math.ceil(selectedTeamDetail.historyGroups.length / teamHistoryPageSize)) : 1
  const currentTeamHistoryPage = Math.min(teamHistoryPage, totalTeamHistoryPages)
  const pagedTeamHistoryGroups = selectedTeamDetail
    ? selectedTeamDetail.historyGroups.slice((currentTeamHistoryPage - 1) * teamHistoryPageSize, currentTeamHistoryPage * teamHistoryPageSize)
    : []
  const expandedHistoryGroupSet = useMemo(() => new Set(expandedHistoryGroupIds), [expandedHistoryGroupIds])
  const expandableGroupIds = useMemo(
    () => pagedTeamHistoryGroups.filter((group) => group.items.length > 1).map((group) => group.id),
    [pagedTeamHistoryGroups],
  )
  const allPageGroupsExpanded =
    expandableGroupIds.length > 0 && expandableGroupIds.every((groupId) => expandedHistoryGroupSet.has(groupId))

  const toggleHistoryGroup = (groupId) => {
    setExpandedHistoryGroupIds((prev) => {
      if (prev.includes(groupId)) return prev.filter((id) => id !== groupId)
      return [...prev, groupId]
    })
  }

  const toggleExpandAllHistoryGroups = () => {
    if (expandableGroupIds.length === 0) return
    setExpandedHistoryGroupIds((prev) => {
      if (allPageGroupsExpanded) return prev.filter((id) => !expandableGroupIds.includes(id))
      const next = new Set(prev)
      expandableGroupIds.forEach((id) => next.add(id))
      return [...next]
    })
  }

  return (
    <div className="page-shell page-content-fluid">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">球队档案馆</h2>
        <p className="text-stone-400 text-sm mt-1">球队维度：样本量 / ROI / AJR 走势</p>
      </div>

      <div className="glow-card bg-white rounded-2xl p-4 border border-stone-100 mb-6 relative z-30">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              placeholder="搜索球队名称或缩写..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="input-glow w-full pl-10 pr-4 py-2.5 rounded-xl border border-stone-200 text-sm focus:outline-none focus:border-amber-400"
            />
          </div>
          <TimeRangePicker
            value={timePeriod}
            onChange={setTimePeriod}
            options={PERIOD_LABELS}
            variant="aqua"
            buttonClassName="whitespace-nowrap"
          />
          <TimeRangePicker
            value={leagueFilter}
            onChange={setLeagueFilter}
            options={leagueOptions}
            variant="aqua"
            buttonClassName="whitespace-nowrap"
          />
          <div className="text-sm text-stone-400">共 {teams.length} 支球队</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {teams.map((team) => {
          const isSelected = selectedTeam?.name === team.name
          return (
          <div
            key={team.name}
            onClick={() => {
              setSelectedTeamName(team.name)
              setTeamHistoryPage(1)
              setExpandedHistoryGroupIds([])
            }}
            className={`team-select-card glow-card bg-white rounded-2xl p-5 border cursor-pointer transition-all lift-card ${
              isSelected ? 'team-select-card--selected' : 'border-stone-100'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-stone-800">{team.name}</span>
                <span className="team-abbr-glass px-1.5 py-[2px] text-[9px] tracking-[0.06em]">
                  {team.abbr}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] tabular-nums ${isSelected ? 'text-sky-600' : 'text-stone-400'}`}>{team.totalSamples} 场</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <span className="text-xs text-stone-400 block">ROI</span>
                <span className={`text-sm font-medium ${team.roi >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {toSigned(team.roi, 1, '%')}
                </span>
              </div>
              <div>
                <span className="text-xs text-stone-400 block">Avg AJR</span>
                <span className="text-sm font-medium text-stone-700">{Number(team.avgAjr || 0).toFixed(2)}</span>
              </div>
              <div>
                <span className="text-xs text-stone-400 block">AJR-Conf</span>
                <span className={`text-sm font-medium ${team.ratingDiff >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {toSigned(team.ratingDiff, 2)}
                </span>
              </div>
            </div>
          </div>
          )
        })}
      </div>

      {selectedTeam && selectedTeamDetail && (
        <div className="glow-card bg-white rounded-2xl border border-stone-100 p-6 animate-fade-in">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h3 className="font-medium text-stone-800">{selectedTeam.name} · 详细档案</h3>
                <span className="team-abbr-glass px-2.5 py-0.5 text-[10px] tracking-[0.08em]">
                  {selectedTeam.abbr}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedTeamName('__none__')
                  setTeamHistoryPage(1)
                  setExpandedHistoryGroupIds([])
                }}
                className="text-stone-400 hover:text-stone-600"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-stone-600 mb-3">ROI 走势</h4>
                <div className="h-40 rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-white px-3 py-2">
                  <svg viewBox="0 0 100 48" className="w-full h-[118px]" onMouseLeave={() => setRoiHoverIndex(null)}>
                    {(() => {
                      const series = normalizeSeries(selectedTeamDetail.roiSeries)
                      const min = Math.min(...series)
                      const max = Math.max(...series)
                      const span = Math.max(max - min, 1)
                      const step = series.length > 1 ? 84 / (series.length - 1) : 0
                      const points = series.map((value, idx) => {
                        const x = 8 + idx * step
                        const y = 38 - ((value - min) / span) * 27
                        return {
                          x,
                          y,
                          value,
                          label: selectedTeamDetail.roiLabels[idx] || selectedTeamDetail.roiLabels[selectedTeamDetail.roiLabels.length - 1] || '--',
                        }
                      })
                      const activePoint = Number.isInteger(roiHoverIndex) ? points[roiHoverIndex] || null : null
                      const line = points.map((p) => `${p.x},${p.y}`).join(' ')
                      const yAxisTop = 11
                      const yAxisBottom = 38
                      const tickCount = 5
                      const tickYs = Array.from(
                        { length: tickCount },
                        (_, idx) => yAxisTop + (idx * (yAxisBottom - yAxisTop)) / (tickCount - 1),
                      )
                      const tickValues = Array.from(
                        { length: tickCount },
                        (_, idx) => max - (idx * (max - min)) / (tickCount - 1),
                      )
                      const bubbleWidth = 28
                      const bubbleHeight = 9.8
                      const bubbleX = activePoint ? clamp(activePoint.x - bubbleWidth / 2, 8, 92 - bubbleWidth) : 8
                      const bubbleY = activePoint ? clamp(activePoint.y - bubbleHeight - 2.8, 2, 34) : 2

                      return (
                        <>
                          <defs>
                            <linearGradient id="teamRoiLineLg" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#818cf8" />
                              <stop offset="100%" stopColor="#6366f1" />
                            </linearGradient>
                          </defs>
                          <line x1="8" y1="9.8" x2="8" y2="42" stroke="#c7d2fe" strokeWidth="0.45" />
                          <line x1="8" y1="42" x2="92" y2="42" stroke="#e0e7ff" strokeWidth="0.45" />
                          {tickYs.map((tickY, idx) => (
                            <line
                              key={`roi-tick-line-${idx}`}
                              x1="8"
                              y1={tickY}
                              x2="92"
                              y2={tickY}
                              stroke="#c7d2fe"
                              strokeWidth={idx === 0 || idx === tickYs.length - 1 ? '0.34' : '0.3'}
                              strokeDasharray={idx === 0 || idx === tickYs.length - 1 ? undefined : '1.1 1.8'}
                              opacity={idx === 0 || idx === tickYs.length - 1 ? 0.75 : 0.55}
                            />
                          ))}
                          {tickYs.map((tickY, idx) => (
                            <text
                              key={`roi-tick-label-${idx}`}
                              x="6.5"
                              y={tickY + 0.9}
                              fontSize="2.5"
                              textAnchor="end"
                              fill={idx === 0 ? '#818cf8' : '#94a3b8'}
                            >
                              {toSigned(tickValues[idx], 1, '%')}
                            </text>
                          ))}
                          <polyline fill="none" stroke="url(#teamRoiLineLg)" strokeWidth="1.2" points={line} />
                          {points.map((p, idx) => (
                            <g key={idx}>
                              <circle cx={p.x} cy={p.y} r={activePoint && roiHoverIndex === idx ? '1.7' : '1.15'} fill="#6366f1" />
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r="3.1"
                                fill="transparent"
                                className="cursor-pointer"
                                onMouseEnter={() => setRoiHoverIndex(idx)}
                                onFocus={() => setRoiHoverIndex(idx)}
                              />
                            </g>
                          ))}
                          {activePoint && (
                            <g pointerEvents="none">
                              <line x1={activePoint.x} y1={activePoint.y + 1.5} x2={activePoint.x} y2="42" stroke="#a5b4fc" strokeWidth="0.35" strokeDasharray="1.1 1.4" />
                              <rect x={bubbleX} y={bubbleY} width={bubbleWidth} height={bubbleHeight} rx="2.3" fill="rgba(255,255,255,0.92)" stroke="#c7d2fe" strokeWidth="0.45" />
                              <text x={bubbleX + bubbleWidth / 2} y={bubbleY + 3.45} textAnchor="middle" fontSize="2.7" fontWeight="600" fill="#4f46e5">
                                {toSigned(activePoint.value, 1, '%')}
                              </text>
                              <text x={bubbleX + bubbleWidth / 2} y={bubbleY + 7.2} textAnchor="middle" fontSize="2.25" fill="#64748b">
                                {activePoint.label}
                              </text>
                            </g>
                          )}
                        </>
                      )
                    })()}
                  </svg>
                  <div className="flex justify-between text-[10px] text-stone-400 px-1">
                    <span>{selectedTeamDetail.roiLabels[0]}</span>
                    <span>{selectedTeamDetail.roiLabels[Math.floor((selectedTeamDetail.roiLabels.length - 1) / 2)]}</span>
                    <span>{selectedTeamDetail.roiLabels[selectedTeamDetail.roiLabels.length - 1]}</span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-stone-600 mb-3">Actual Judgemental Rating 走势</h4>
                <div className="h-40 rounded-xl border border-sky-100 bg-gradient-to-b from-sky-50/60 to-white px-3 py-2">
                  <svg viewBox="0 0 100 48" className="w-full h-[118px]" onMouseLeave={() => setRatingHoverIndex(null)}>
                    {(() => {
                      const series = normalizeSeries(selectedTeamDetail.ratingSeries)
                      const min = Math.min(...series)
                      const max = Math.max(...series)
                      const span = Math.max(max - min, 0.02)
                      const step = series.length > 1 ? 84 / (series.length - 1) : 0
                      const points = series.map((value, idx) => {
                        const x = 8 + idx * step
                        const y = 38 - ((value - min) / span) * 27
                        return {
                          x,
                          y,
                          value,
                          label: selectedTeamDetail.ratingLabels[idx] || selectedTeamDetail.ratingLabels[selectedTeamDetail.ratingLabels.length - 1] || '--',
                        }
                      })
                      const activePoint = Number.isInteger(ratingHoverIndex) ? points[ratingHoverIndex] || null : null
                      const line = points.map((p) => `${p.x},${p.y}`).join(' ')
                      const yAxisTop = 11
                      const yAxisBottom = 38
                      const tickCount = 5
                      const tickYs = Array.from(
                        { length: tickCount },
                        (_, idx) => yAxisTop + (idx * (yAxisBottom - yAxisTop)) / (tickCount - 1),
                      )
                      const tickValues = Array.from(
                        { length: tickCount },
                        (_, idx) => max - (idx * (max - min)) / (tickCount - 1),
                      )
                      const bubbleWidth = 26
                      const bubbleHeight = 9.8
                      const bubbleX = activePoint ? clamp(activePoint.x - bubbleWidth / 2, 8, 92 - bubbleWidth) : 8
                      const bubbleY = activePoint ? clamp(activePoint.y - bubbleHeight - 2.8, 2, 34) : 2

                      return (
                        <>
                          <defs>
                            <linearGradient id="teamRatingLineLg" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#38bdf8" />
                              <stop offset="100%" stopColor="#2563eb" />
                            </linearGradient>
                          </defs>
                          <line x1="8" y1="9.8" x2="8" y2="42" stroke="#bae6fd" strokeWidth="0.45" />
                          <line x1="8" y1="42" x2="92" y2="42" stroke="#e0f2fe" strokeWidth="0.45" />
                          {tickYs.map((tickY, idx) => (
                            <line
                              key={`rating-tick-line-${idx}`}
                              x1="8"
                              y1={tickY}
                              x2="92"
                              y2={tickY}
                              stroke="#bae6fd"
                              strokeWidth={idx === 0 || idx === tickYs.length - 1 ? '0.34' : '0.3'}
                              strokeDasharray={idx === 0 || idx === tickYs.length - 1 ? undefined : '1.1 1.8'}
                              opacity={idx === 0 || idx === tickYs.length - 1 ? 0.75 : 0.55}
                            />
                          ))}
                          {tickYs.map((tickY, idx) => (
                            <text
                              key={`rating-tick-label-${idx}`}
                              x="6.5"
                              y={tickY + 0.9}
                              fontSize="2.5"
                              textAnchor="end"
                              fill={idx === 0 ? '#0284c7' : '#94a3b8'}
                            >
                              {tickValues[idx].toFixed(2)}
                            </text>
                          ))}
                          <polyline fill="none" stroke="url(#teamRatingLineLg)" strokeWidth="1" points={line} />
                          {points.map((p, idx) => (
                            <g key={idx}>
                              <circle cx={p.x} cy={p.y} r={activePoint && ratingHoverIndex === idx ? '1.5' : '0.9'} fill={p.value >= 0 ? '#0284c7' : '#0ea5e9'} />
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r="2.9"
                                fill="transparent"
                                className="cursor-pointer"
                                onMouseEnter={() => setRatingHoverIndex(idx)}
                                onFocus={() => setRatingHoverIndex(idx)}
                              />
                            </g>
                          ))}
                          {activePoint && (
                            <g pointerEvents="none">
                              <line x1={activePoint.x} y1={activePoint.y + 1.5} x2={activePoint.x} y2="42" stroke="#7dd3fc" strokeWidth="0.35" strokeDasharray="1.1 1.4" />
                              <rect x={bubbleX} y={bubbleY} width={bubbleWidth} height={bubbleHeight} rx="2.3" fill="rgba(255,255,255,0.92)" stroke="#bae6fd" strokeWidth="0.45" />
                              <text x={bubbleX + bubbleWidth / 2} y={bubbleY + 3.45} textAnchor="middle" fontSize="2.7" fontWeight="600" fill="#0369a1">
                                {activePoint.value.toFixed(2)}
                              </text>
                              <text x={bubbleX + bubbleWidth / 2} y={bubbleY + 7.2} textAnchor="middle" fontSize="2.25" fill="#64748b">
                                {activePoint.label}
                              </text>
                            </g>
                          )}
                        </>
                      )
                    })()}
                  </svg>
                  <div className="flex justify-between text-[10px] text-stone-400 px-1">
                    <span>{selectedTeamDetail.ratingLabels[0]}</span>
                    <span>{selectedTeamDetail.ratingLabels[Math.floor((selectedTeamDetail.ratingLabels.length - 1) / 2)]}</span>
                    <span>{selectedTeamDetail.ratingLabels[selectedTeamDetail.ratingLabels.length - 1]}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-stone-100 pt-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-stone-700">近期投资比赛明细</h4>
                <div className="flex items-center gap-3">
                  {expandableGroupIds.length > 0 && (
                    <button
                      onClick={toggleExpandAllHistoryGroups}
                      className="rounded-md border border-sky-200 px-2.5 py-1 text-[11px] font-medium text-sky-600 transition-colors hover:bg-sky-50"
                    >
                      {allPageGroupsExpanded ? '一键收起' : '一键展开'}
                    </button>
                  )}
                  <span className="text-xs text-stone-400">共 {selectedTeamDetail.history.length} 场</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-stone-500">
                      <th className="py-2">日期</th>
                      <th className="py-2 pl-5">比赛</th>
                      <th className="py-2">entry</th>
                      <th className="py-2">result</th>
                      <th className="py-2">赔率</th>
                      <th className="py-2">AJR</th>
                      <th className="py-2">盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTeamHistoryGroups.map((group) => {
                      const headRow = group.items[0]
                      const isExpandable = group.items.length > 1
                      const isExpanded = expandedHistoryGroupSet.has(group.id)

                      return (
                        <Fragment key={group.id}>
                          <tr className="border-b border-stone-50">
                            <td className="py-2 text-stone-500">{headRow.date}</td>
                            <td className="py-2 pl-5 text-stone-700">
                              <div className="relative flex items-center gap-2">
                                {isExpandable && (
                                  <button
                                    onClick={() => toggleHistoryGroup(group.id)}
                                    className="absolute -left-5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-sky-200 text-[10px] leading-none text-sky-600 transition-colors hover:bg-sky-50"
                                    aria-label={isExpanded ? '收起同场投注' : '展开同场投注'}
                                  >
                                    {isExpanded ? '−' : '+'}
                                  </button>
                                )}
                                <span>{headRow.match}</span>
                                {isExpandable && (
                                  <span className="inline-flex h-[16px] items-center rounded-full border border-sky-200 bg-sky-50 px-1 text-[8px] leading-none font-medium text-sky-600">
                                    同场 {group.items.length} 次
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 text-stone-600">{headRow.entry}</td>
                            <td className="py-2 text-stone-500">{headRow.result}</td>
                            <td className="py-2 text-violet-600 italic font-semibold">{headRow.odds}</td>
                            <td className={`py-2 font-semibold ${headRow.ajr === '-' ? 'text-stone-400' : getAJRColor(headRow.ajr)}`}>{headRow.ajr}</td>
                            <td
                              className={`py-2 font-medium ${
                                headRow.profit.startsWith('+')
                                  ? 'text-emerald-600'
                                  : headRow.profit.startsWith('-')
                                  ? 'text-rose-500'
                                  : 'text-stone-500'
                              }`}
                            >
                              {headRow.profit}
                            </td>
                          </tr>
                          {isExpanded &&
                            group.items.slice(1).map((row, nestedIdx) => (
                              <tr key={`${group.id}-${nestedIdx}`} className="border-b border-sky-50 bg-sky-50/20">
                                <td className="py-2 pl-4 text-stone-400">{row.date}</td>
                                <td className="py-2 pl-5 text-stone-600">
                                  <div className="relative flex items-center gap-2">
                                    <span className="absolute -left-5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center" aria-hidden="true">
                                      <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                                    </span>
                                    <span>{row.match}</span>
                                  </div>
                                </td>
                                <td className="py-2 text-stone-600">{row.entry}</td>
                                <td className="py-2 text-stone-500">{row.result}</td>
                                <td className="py-2 text-violet-600 italic font-semibold">{row.odds}</td>
                                <td className={`py-2 font-semibold ${row.ajr === '-' ? 'text-stone-400' : getAJRColor(row.ajr)}`}>{row.ajr}</td>
                                <td
                                  className={`py-2 font-medium ${
                                    row.profit.startsWith('+') ? 'text-emerald-600' : row.profit.startsWith('-') ? 'text-rose-500' : 'text-stone-500'
                                  }`}
                                >
                                  {row.profit}
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      )
                    })}
                    {pagedTeamHistoryGroups.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-stone-400">
                          暂无球队样本明细
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => setTeamHistoryPage(Math.max(1, currentTeamHistoryPage - 1))}
                  disabled={currentTeamHistoryPage === 1}
                  className={`px-3 py-1.5 rounded-lg text-xs ${
                    currentTeamHistoryPage === 1 ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'
                  }`}
                >
                  ← 上一页
                </button>
                <span className="text-xs text-stone-400">
                  第 {currentTeamHistoryPage} / {totalTeamHistoryPages} 页
                </span>
                <button
                  onClick={() => setTeamHistoryPage(Math.min(totalTeamHistoryPages, currentTeamHistoryPage + 1))}
                  disabled={currentTeamHistoryPage === totalTeamHistoryPages}
                  className={`px-3 py-1.5 rounded-lg text-xs ${
                    currentTeamHistoryPage === totalTeamHistoryPages ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-stone-100'
                  }`}
                >
                  下一页 →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
