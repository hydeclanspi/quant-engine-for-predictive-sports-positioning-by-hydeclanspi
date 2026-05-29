import { cloneElement, isValidElement, useMemo } from 'react'
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
  conf: { short: 'α', long: '变量 α' },
  conf_zh: { short: '变量 α', long: '变量 α' },
  tys: { short: 'β', long: '变量 β' },
  tys_zh: { short: '变量 β', long: '变量 β' },
  fid: { short: 'γ', long: '变量 γ' },
  fid_zh: { short: '变量 γ', long: '变量 γ' },
  fse: { short: 'δ', long: '变量 δ' },
  fse_zh: { short: '变量 δ', long: '变量 δ' },
  rep: { short: 'ε', long: '随机扰动 ε' },
  rep_zh: { short: '随机扰动 ε', long: '随机扰动 ε' },
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
    mode: 'Strategy · 策略类型',
    conf: '变量 α',
    tysHome: '变量 β (主)',
    tysAway: '变量 β (客)',
    fid: '变量 γ',
    fseHome: '变量 δ (主)',
    fseAway: '变量 δ (客)',
    calibrationGroup: '校准参数 (β · γ · δ)',
  },
}

export const getLabelDict = (mode) => (mode === PREVIEW_MODE ? PREVIEW_LABELS : FULL_LABELS)

/**
 * Returns a function that rewrites known proprietary param names
 * in any string. Pass-through in FULL mode, substitute in PREVIEW.
 * Useful for label arrays / data structures that are too tedious to
 * mask field-by-field (eg MetricsPage KPI cards).
 */
const PREVIEW_TEXT_SUBSTITUTIONS = [
  ['主观置信度', '变量 α'],
  ['信息深度', '变量 γ'],
  ['特性感知度', '变量 δ'],
  ['随机事件参数', '随机扰动 ε'],
  ['随机事件', '随机扰动'],
  ['Feature Sensor Beta', 'δ'],
  ['TYS-base', 'β'],
  // Order matters: longer English forms first so they don't get
  // partially overwritten by shorter ones (eg 'Conf 矩阵' before 'Conf').
  ['Conf 历史明细', 'α 历史明细'],
  ['Conf vs AJR', 'α vs AJR'],
  ['Conf 矩阵', 'α 矩阵'],
  ['Conf 区间', 'α 区间'],
  ['Avg Conf', 'Avg α'],
  ['平均 Conf', '平均 α'],
  ['Conf', 'α'],
  ['FID vs Return', 'γ vs Return'],
  ['FSE vs Return', 'δ vs Return'],
  ['REP vs Return', 'ε vs Return'],
  ['FID', 'γ'],
  ['FSE', 'δ'],
  ['TYS', 'β'],
  ['REP', 'ε'],
]

export const usePreviewTextMask = () => {
  const mode = useDisplayMode()
  return useMemo(() => {
    if (mode !== PREVIEW_MODE) return (text) => text
    return (text) => {
      if (!text || typeof text !== 'string') return text
      let result = text
      for (const [from, to] of PREVIEW_TEXT_SUBSTITUTIONS) {
        result = result.split(from).join(to)
      }
      return result
    }
  }, [mode])
}

/**
 * Recursively apply a text mask to every string node in a React tree.
 * Pass-through in FULL mode (maskText is identity), substitutes in PREVIEW.
 * Lets long methodology essays be masked with a single wrap instead of
 * hand-wrapping hundreds of <p> nodes. Only call on subtrees verified free
 * of full words containing a code prefix (eg 'Confidence' / 'Config').
 */
export const maskReactTree = (node, maskText) => {
  if (typeof node === 'string') return maskText(node)
  if (Array.isArray(node)) return node.map((child) => maskReactTree(child, maskText))
  if (isValidElement(node)) {
    const children = node.props?.children
    if (children == null) return node
    const masked = maskReactTree(children, maskText)
    return cloneElement(node, undefined, ...(Array.isArray(masked) ? masked : [masked]))
  }
  return node
}

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
