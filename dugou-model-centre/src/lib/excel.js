import * as XLSX from 'xlsx'
import { exportDataBundle } from './localData'

export const buildDataWorkbook = (bundle) => {
  const investments = Array.isArray(bundle?.investments) ? bundle.investments : []
  const teamProfiles = Array.isArray(bundle?.team_profiles) ? bundle.team_profiles : []
  const systemConfig = bundle?.system_config || {}

  const investmentRows = investments.map((item) => ({
    id: item.id,
    created_at: item.created_at,
    parlay_size: item.parlay_size,
    combo_name: item.combo_name,
    inputs: item.inputs,
    suggested_amount: item.suggested_amount,
    expected_rating: item.expected_rating,
    combined_odds: item.combined_odds,
    status: item.status,
    revenues: item.revenues,
    profit: item.profit,
    actual_rating: item.actual_rating,
    rep: item.rep,
    remarks: item.remarks,
    is_archived: item.is_archived ? 'true' : 'false',
  }))

  const matchRows = investments.flatMap((item) =>
    (item.matches || []).map((match, idx) => ({
      investment_id: item.id,
      match_index: idx + 1,
      id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      entry_text: match.entry_text,
      entry_market_type: match.entry_market_type,
      entry_market_label: match.entry_market_label,
      entry_semantic_key: match.entry_semantic_key,
      entries_json: JSON.stringify(match.entries || []),
      odds: match.odds,
      conf: match.conf,
      mode: match.mode,
      tys_home: match.tys_home,
      tys_away: match.tys_away,
      fid: match.fid,
      fse_home: match.fse_home,
      fse_away: match.fse_away,
      fse_match: match.fse_match,
      results: match.results,
      is_correct: typeof match.is_correct === 'boolean' ? String(match.is_correct) : '',
      match_rating: match.match_rating,
      match_rep: match.match_rep,
      note: match.note,
      post_note: match.post_note,
    })),
  )

  const teamRows = teamProfiles.map((team) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    abbreviations: Array.isArray(team.abbreviations) ? team.abbreviations.join('|') : '',
    totalSamples: team.totalSamples,
    avgRep: team.avgRep,
  }))

  const configRows = Object.entries(systemConfig).map(([key, value]) => ({
    key,
    value,
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(investmentRows), 'Investments')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(matchRows), 'Matches')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(teamRows), 'TeamProfiles')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(configRows), 'SystemConfig')
  return workbook
}

export const downloadWorkbook = (workbook, filenamePrefix = 'dugou-data') => {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const dateKey = new Date().toISOString().slice(0, 10)
  anchor.href = href
  anchor.download = `${filenamePrefix}-${dateKey}.xlsx`
  anchor.click()
  URL.revokeObjectURL(href)
}

export const exportDataBundleAsExcel = (filenamePrefix = 'dugou-data') => {
  const bundle = exportDataBundle()
  const workbook = buildDataWorkbook(bundle)
  downloadWorkbook(workbook, filenamePrefix)
}
