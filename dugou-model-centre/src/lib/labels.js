import { useMemo } from 'react'
import { FULL_MODE, PREVIEW_MODE, useDisplayMode } from './displayMode'

/**
 * Label Dictionary — display-mode-aware terminology.
 *
 * In FULL_MODE everything reads exactly as it does today:
 * Conf / TYS / FID / FSE / REP / Mode-six-types stay intact.
 *
 * In PREVIEW_MODE proprietary parameter names are masked.
 * Public math terminology (Kelly / Brier / Sharpe / etc.)
 * is intentionally NOT masked — those are resume-positive
 * statistical concepts, not private fingerprints.
 *
 * Each entry has a `short` variant for tight UI slots and a
 * `long` variant for tooltips / labeled fields.
 */

const FULL_LABELS = {
  conf: { short: 'Conf', long: 'Confidence' },
  conf_zh: { short: '置信度', long: '主观置信度' },
  tys: { short: 'TYS', long: 'TYS-base' },
  tys_zh: { short: 'TYS', long: '球队强度档位' },
  fid: { short: 'FID', long: 'FID' },
  fid_zh: { short: 'FID', long: '信息深度' },
  fse: { short: 'FSE', long: 'Feature Sensor Beta' },
  fse_zh: { short: 'FSE', long: '特性感知度' },
  rep: { short: 'REP', long: 'Random Events Parameter' },
  rep_zh: { short: 'REP', long: '随机事件参数' },
  mode: { short: 'Mode', long: 'Strategy Mode' },
  mode_zh: { short: '模式', long: '策略模式' },
  rating: { short: 'Rating', long: 'Judgmental Rating' },
  rating_zh: { short: '评分', long: '主观评分' },
  modes: {
    常规: '常规',
    '常规-稳': '常规-稳',
    '常规-杠杆': '常规-杠杆',
    半彩票半保险: '半彩票半保险',
    保险产品: '保险产品',
    赌一把: '赌一把',
  },
  modesShort: {
    常规: '常规',
    '常规-稳': '常规-稳',
    '常规-杠杆': '常规-杠杆',
    半彩票半保险: '半彩票半保险',
    保险产品: '保险产品',
    赌一把: '赌一把',
  },
  formLabel: {
    mode: 'Mode 模式',
    conf: 'Conf. 主观置信度',
    tysHome: 'TYS-base (主)',
    tysAway: 'TYS-base (客)',
    fid: 'FID 信息深度',
    fseHome: 'FSE (主) Feature Sensor Beta',
    fseAway: 'FSE (客) Feature Sensor Beta',
    calibrationGroup: '校准参数（TYS / FID / FSE）',
  },
}

const PREVIEW_LABELS = {
  conf: { short: 'α', long: 'Param α' },
  conf_zh: { short: '参数α', long: '参数 α（置信度）' },
  tys: { short: 'β', long: 'Param β' },
  tys_zh: { short: '参数β', long: '参数 β（强度档位）' },
  fid: { short: 'γ', long: 'Param γ' },
  fid_zh: { short: '参数γ', long: '参数 γ（信息深度）' },
  fse: { short: 'δ', long: 'Param δ' },
  fse_zh: { short: '参数δ', long: '参数 δ（感知度）' },
  rep: { short: 'ε', long: 'Stochastic Noise' },
  rep_zh: { short: '随机扰动', long: '随机扰动 ε' },
  mode: { short: 'Strategy', long: 'Strategy Class' },
  mode_zh: { short: '策略', long: '策略类型' },
  rating: { short: 'Score', long: 'Judgmental Score' },
  rating_zh: { short: '评分', long: '后验评分' },
  modes: {
    常规: 'Baseline-Drift',
    '常规-稳': 'Mean-Reverting',
    '常规-杠杆': 'Momentum-Carry',
    半彩票半保险: 'Convex-Barbell',
    保险产品: 'Defensive-Anchor',
    赌一把: 'Heavy-Tail Sprint',
  },
  modesShort: {
    常规: 'Σ',
    '常规-稳': 'μ',
    '常规-杠杆': 'λ',
    半彩票半保险: 'Φ',
    保险产品: 'Ω',
    赌一把: 'Θ',
  },
  formLabel: {
    mode: 'Strategy 策略类型',
    conf: 'α · 主观置信度',
    tysHome: 'β · 强度 (主)',
    tysAway: 'β · 强度 (客)',
    fid: 'γ · 信息深度',
    fseHome: 'δ (主) · 感知度',
    fseAway: 'δ (客) · 感知度',
    calibrationGroup: '校准参数（β / γ / δ）',
  },
}

export const getLabelDict = (mode) => (mode === PREVIEW_MODE ? PREVIEW_LABELS : FULL_LABELS)

export const useLabels = () => {
  const mode = useDisplayMode()
  return useMemo(() => getLabelDict(mode), [mode])
}

/**
 * Translate a raw Mode name (the canonical 6-type Chinese key) into
 * the current display-mode label. Falls back to the raw value if
 * the mode is unknown.
 */
export const maskModeName = (rawMode, displayMode) => {
  const dict = getLabelDict(displayMode)
  return dict.modes[rawMode] || rawMode
}

export { FULL_MODE, PREVIEW_MODE }
