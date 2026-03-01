你图里这些 tag 目前是两套独立逻辑：

1. `稳 / 杠杆 / 中+信 / 中-守`（左边第一个小标签，角色标签）
- 定义在 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L44)。
- 自动判定函数在 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L126)：
  - `p = adjustedProb`
  - `odd = effectiveOdds`
  - `implied = 1/odd`
  - `edge = p - implied`
  - 规则：
    - `p >= 0.58 && odd <= 2.25 && edge >= -0.015` -> `稳`
    - `odd >= 2.55 && p >= 0.27 && (edge >= 0.018 || conf >= 0.55)` -> `杠杆`
    - `edge >= 0.02 || p >= 0.5` -> `中+信`
    - 否则 -> `中-守`
- 显示时会先看你是否手动改了下拉框：`manual override` 优先，否则用自动判定。见 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L4893)。

2. `强洞察 / 中洞察 / 弱洞察 / 极弱`（第二个小标签，洞察层级）
- 定义在 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L205)。
- 左侧候选卡显示时用的是 `item.conf` 的静态阈值：
  - `>= 0.72` -> `强洞察`
  - `>= 0.55` -> `中洞察`
  - `>= 0.40` -> `弱洞察`
  - `< 0.40` -> `极弱`
- 显示调用在 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L4923)。

3. 一个容易混淆的点
- 组合生成引擎内部会用“动态阈值”（回测 + walk-forward）来分 tier，不一定和左侧候选卡完全同一阈值。
- 动态阈值生成在 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L251)；
- walk-forward 的 `tierShift` 在 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L3065)；
- 组合评分使用动态 tier 在 [ComboPage.jsx](/Users/xuyantong/Desktop/2026%20Files/The%20DuGou/DuGou%20长期优化迭代基地/dugou-model-centre/src/pages/ComboPage.jsx#L3172)。

如果你愿意，我下一步可以把这两套阈值在 UI 上明确标注成“展示阈值（静态）/求解阈值（动态）”，避免误读。