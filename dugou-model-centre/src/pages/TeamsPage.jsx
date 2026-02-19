import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { getTeamsSnapshot } from '../lib/analytics'
import { getInvestments, getTeamProfiles } from '../lib/localData'
import TimeRangePicker from '../components/TimeRangePicker'

const PERIOD_LABELS = {
  '1w': '近一周',
  '2w': '近两周',
  '1m': '近一月',
  all: '全部时间',
}

const LEAGUE_ALL_KEY = 'all'
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

// 样本量字符串
const getSampleText = (count) => `样本 ${count}`

const normalizeSeries = (series) => {
  if (!Array.isArray(series)) return [0]
  const values = series.map((value) => Number(value)).filter((value) => Number.isFinite(value))
  return values.length > 0 ? values : [0]
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
  if (/u23/i.test(normalizedName)) return '国际赛'
  return TEAM_LEAGUE_MAP[normalizedName] || '其他'
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
      const ajr = Number.parseFloat(match?.match_rating)
      const row = {
        timestamp: new Date(investment.created_at || 0).getTime(),
        date: formatDateDash(investment.created_at),
        match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
        entry: getEntryText(match),
        result: match.results || '-',
        odds: Number.isFinite(odd) ? odd.toFixed(2) : '-',
        ajr: Number.isFinite(ajr) ? ajr.toFixed(2) : '-',
        profit: profitText,
      }

      const homeTeam = normalizeTeamName(match.home_team, aliasMap)
      const awayTeam = normalizeTeamName(match.away_team, aliasMap)
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

  const selectedTeam = useMemo(
    () => (selectedTeamName === '__none__' ? null : teams.find((team) => team.name === selectedTeamName) || teams[0] || null),
    [selectedTeamName, teams],
  )
  const selectedTeamDetail = useMemo(() => {
    if (!selectedTeam) return null
    const labels = (selectedTeam.roiHistory || []).map((item) => String(item.label || '').replace('-', '/')).slice(-8)
    const roiSeries = (selectedTeam.roiHistory || []).map((item) => Number(item.value || 0)).slice(-8)
    const ratingSeries = (selectedTeam.ratingHistory || []).map((item) => Number(item.value || 0)).slice(-8)
    const history = teamHistoryRowsMap.get(selectedTeam.name) || []

    return {
      labels: labels.length > 0 ? labels : ['--', '--', '--'],
      roiSeries: roiSeries.length > 0 ? roiSeries : [0],
      ratingSeries: ratingSeries.length > 0 ? ratingSeries : [0],
      history,
    }
  }, [selectedTeam, teamHistoryRowsMap])
  const teamHistoryPageSize = 4
  const totalTeamHistoryPages = selectedTeamDetail ? Math.max(1, Math.ceil(selectedTeamDetail.history.length / teamHistoryPageSize)) : 1
  const currentTeamHistoryPage = Math.min(teamHistoryPage, totalTeamHistoryPages)
  const pagedTeamHistory = selectedTeamDetail
    ? selectedTeamDetail.history.slice((currentTeamHistoryPage - 1) * teamHistoryPageSize, currentTeamHistoryPage * teamHistoryPageSize)
    : []

  return (
    <div className="page-shell page-content-fluid">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">球队档案馆</h2>
        <p className="text-stone-400 text-sm mt-1">球队维度：样本量 / ROI / AJR-Conf 走势</p>
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
                {isSelected && <span className="team-select-pill">已选中</span>}
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
                <span className="text-xs text-stone-400 block">Avg REP</span>
                <span className="text-sm font-medium text-stone-700">{team.avgRep.toFixed(2)}</span>
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
                  <svg viewBox="0 0 100 48" className="w-full h-[118px]">
                    {(() => {
                      const series = normalizeSeries(selectedTeamDetail.roiSeries)
                      const min = Math.min(...series)
                      const max = Math.max(...series)
                      const span = Math.max(max - min, 1)
                      const step = series.length > 1 ? 84 / (series.length - 1) : 0
                      const points = series.map((value, idx) => {
                        const x = 8 + idx * step
                        const y = 38 - ((value - min) / span) * 27
                        return { x, y, value }
                      })
                      const line = points.map((p) => `${p.x},${p.y}`).join(' ')
                      const area = `${line} 92,42 8,42`

                      return (
                        <>
                          <defs>
                            <linearGradient id="teamRoiLineLg" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#818cf8" />
                              <stop offset="100%" stopColor="#6366f1" />
                            </linearGradient>
                          </defs>
                          <line x1="8" y1="42" x2="92" y2="42" stroke="#e0e7ff" strokeWidth="0.45" />
                          <line x1="8" y1="30" x2="92" y2="30" stroke="#c7d2fe" strokeWidth="0.35" strokeDasharray="1.2 1.8" />
                          <polyline fill="none" stroke="url(#teamRoiLineLg)" strokeWidth="1.2" points={line} />
                          {points.map((p, idx) => (
                            <g key={idx}>
                              <circle cx={p.x} cy={p.y} r="1.15" fill="#6366f1" />
                              {idx === points.length - 1 && (
                                <text x={p.x - 3} y={p.y - 3.2} fontSize="3.1" fill="#4338ca">{`ROI ${p.value.toFixed(1)}%`}</text>
                              )}
                            </g>
                          ))}
                        </>
                      )
                    })()}
                  </svg>
                  <div className="flex justify-between text-[10px] text-stone-400 px-1">
                    <span>{selectedTeamDetail.labels[0]}</span>
                    <span>{selectedTeamDetail.labels[Math.floor((selectedTeamDetail.labels.length - 1) / 2)]}</span>
                    <span>{selectedTeamDetail.labels[selectedTeamDetail.labels.length - 1]}</span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-stone-600 mb-3">(Act. - Conf) Rating 走势</h4>
                <div className="h-40 rounded-xl border border-sky-100 bg-gradient-to-b from-sky-50/60 to-white px-3 py-2">
                  <svg viewBox="0 0 100 48" className="w-full h-[118px]">
                    {(() => {
                      const series = normalizeSeries(selectedTeamDetail.ratingSeries)
                      const min = Math.min(...series)
                      const max = Math.max(...series)
                      const span = Math.max(max - min, 0.02)
                      const step = series.length > 1 ? 84 / (series.length - 1) : 0
                      const points = series.map((value, idx) => {
                        const x = 8 + idx * step
                        const y = 38 - ((value - min) / span) * 27
                        return { x, y, value }
                      })
                      const line = points.map((p) => `${p.x},${p.y}`).join(' ')
                      const zeroY = 38 - ((0 - min) / span) * 27

                      return (
                        <>
                          <defs>
                            <linearGradient id="teamRatingLineLg" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#38bdf8" />
                              <stop offset="100%" stopColor="#2563eb" />
                            </linearGradient>
                          </defs>
                          <line x1="8" y1="42" x2="92" y2="42" stroke="#e0f2fe" strokeWidth="0.45" />
                          <line x1="8" y1="30" x2="92" y2="30" stroke="#bae6fd" strokeWidth="0.35" strokeDasharray="1.2 1.8" />
                          <line x1="8" y1={zeroY} x2="92" y2={zeroY} stroke="#7dd3fc" strokeWidth="0.5" strokeDasharray="1.4 1.8" />
                          <polyline fill="none" stroke="url(#teamRatingLineLg)" strokeWidth="1" points={line} />
                          {points.map((p, idx) => (
                            <circle key={idx} cx={p.x} cy={p.y} r="0.9" fill={p.value >= 0 ? '#0284c7' : '#0ea5e9'} />
                          ))}
                          <text x="9" y={zeroY - 1.8} fontSize="2.8" fill="#0284c7">0</text>
                        </>
                      )
                    })()}
                  </svg>
                  <div className="flex justify-between text-[10px] text-stone-400 px-1">
                    <span>{selectedTeamDetail.labels[0]}</span>
                    <span>{selectedTeamDetail.labels[Math.floor((selectedTeamDetail.labels.length - 1) / 2)]}</span>
                    <span>{selectedTeamDetail.labels[selectedTeamDetail.labels.length - 1]}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-stone-100 pt-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-stone-700">近期投资比赛明细</h4>
                <span className="text-xs text-stone-400">共 {selectedTeamDetail.history.length} 场</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-stone-500">
                      <th className="py-2">日期</th>
                      <th className="py-2">比赛</th>
                      <th className="py-2">entry</th>
                      <th className="py-2">result</th>
                      <th className="py-2">赔率</th>
                      <th className="py-2">AJR</th>
                      <th className="py-2">盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTeamHistory.map((row, idx) => (
                      <tr key={`${row.match}-${row.date}-${idx}`} className="border-b border-stone-50">
                        <td className="py-2 text-stone-500">{row.date}</td>
                        <td className="py-2 text-stone-700">{row.match}</td>
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
                    {pagedTeamHistory.length === 0 && (
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
