# Combo Page UI Overhaul: "Smart Portfolio Pack" Card

## Overview
Redesign the right panel of the ComboPage to feature a new **"Smart Portfolio Pack"** (智能组合包) hero card that replaces the old "推荐方案" section. The old content moves below alongside the existing secondary cards. The new card is purpose-built for the v4.1 fault-tolerant parlay engine — showcasing the best recommended betting package with algorithm-derived metrics, Monte Carlo simulation (50,000 runs), and interactive refresh controls.

## Layout Changes

### Before (current structure):
```
combo-main-grid (2-col):
  Left: 今日备选 + controls + risk + filters + generate button
  Right: 推荐方案 card (recommendations list + stats + dynParams + adoptPreview + adopt button)

combo-secondary-grid (2-col):
  Left: 单组合方案排序
  Right: 分层下注建议 + risk probe

Algorithm card
History card
```

### After (new structure):
```
combo-main-grid (2-col):
  Left: 今日备选 + controls + risk + filters + generate button (unchanged)
  Right: NEW "智能组合包" hero card (compact best-package display + MC sim + refresh icons)

combo-secondary-grid → becomes 3 cards in a new layout:
  Card 1: OLD 推荐方案 (moved here, full list + stats + dynParams)
  Card 2: 单组合方案排序 (existing)
  Card 3: 分层下注建议 (existing)

Algorithm card (unchanged)
History card (unchanged)
```

## New "智能组合包" Hero Card Design

### Header Row
- Title: "智能组合包" with Sparkles icon
- Right side: two icons side-by-side
  - **Refresh icon** (RefreshCw from lucide) — "soft refresh" re-roll with slight coefficient jitter
  - **SlidersHorizontal icon** (or Sliders) — "deep refresh" opens floating preference panel

### Body: Recommended Package List
- Shows the top N (5-8) recommended combos as a numbered list
- Each row: `1. MUN + LIV + ARS` format with compact inline badges
  - Layer badge (锚定层/容错覆盖/扩展层/博冷层) — tiny colored dot or short label
  - Confidence tier summary (e.g., "2强1中")
  - Odds × combined odds value
  - Suggested stake (e.g., "¥20")
- Compact layout: no expand/collapse, just the clean list
- Each row is selectable (click to toggle check state) — selected items feed into the MC simulation below

### Package Stats Summary (below the list)
- 2×3 or 3×2 mini-grid of key stats:
  - 总投入 / 预期收益率 / 组合 Sharpe
  - Hit概率 / 最大回报 / 容错覆盖率
- Single row of dynamic backtest params (compact): 回测可信度 badge, tier分布 pills

### Monte Carlo Simulation Panel (50,000 runs)
- Title: "蒙特卡洛模拟 · 50,000次"
- For the selected package (all items by default), run MC simulation:
  - For each of 50,000 iterations, for each combo in the package:
    - For each leg: draw Bernoulli(p_calibrated) to determine hit/miss
    - Compute payout: if all legs hit → stake × odds; else → -stake
    - Sum across all combos in package → one iteration's total P&L
  - Compute distribution stats:
    - **盈利概率**: % of iterations with total P&L > 0
    - **中位收益**: median P&L
    - **95%VaR**: 5th percentile loss
    - **平均收益**: mean P&L
    - **最大收益**: max P&L observed
    - **全亏概率**: % of iterations where every single combo loses
- Display as a compact stat grid (similar to adoptPreview style)
- Show a mini histogram (5-bucket distribution bar) of P&L ranges using inline CSS bars

### Adopt Button
- Full-width green "采纳已选方案" button at bottom of this card

## Deep Refresh Floating Panel Design

### Trigger
- Click the SlidersHorizontal icon in the card header

### Panel Design
- Floating card, positioned below the icon, z-50
- Glassmorphism: `backdrop-blur-xl bg-sky-50/80 border border-sky-200/60 shadow-2xl`
- Light blue/cyan water-like aesthetic
- Rounded-2xl, ~320px wide

### Content
- Two columns: "少一点" (left) | "多一点" (right)
- Header labels with subtle sky-blue styling
- Below each: list of ALL unique team names from current waitlist matches
  - Each team = a pill/chip, clickable toggle
  - Selected state: filled bg (sky-500 text-white for 少一点, emerald-500 for 多一点)
  - Unselected: bg-white/70 border text-stone-600
  - Teams can be selected in both columns independently (though semantically contradictory, the algorithm handles it)
- Bottom: full-width green commit button with rounded corners
- "关闭" link or click-outside to dismiss

### Algorithm Behind Deep Refresh
When committed with team preferences:
- "少一点" teams get a -0.08 to -0.15 utility modifier on any combo containing them
- "多一点" teams get a +0.08 to +0.15 utility boost
- Re-run `generateRecommendations` with these modifiers injected
- This preserves the mathematical framework while respecting user intuition

## Soft Refresh Algorithm
When the regular refresh icon is clicked:
- Add small random jitter (±5%) to `riskPref`
- Nudge `mmrLambda` by ±0.05 (diversity shift → different combos surface)
- Nudge `parlayBeta` by ±0.02
- Re-run `generateRecommendations` with jittered params
- Restore original params after generation (jitter is one-shot)
- This guarantees a different but still mathematically sound output

## Files to Modify

### 1. `src/pages/ComboPage.jsx`
- Add new state: `teamBias` (Map of team → bias value), `showDeepRefresh` (boolean), `mcSimResult` (object)
- Add new Lucide imports: `RefreshCw`, `SlidersHorizontal`
- Add `runMonteCarloSim(packageItems, iterations=50000)` function
- Add `handleSoftRefresh()` function
- Add `handleDeepRefreshCommit(lessTeams, moreTeams)` function
- Move old "推荐方案" card content into a new card in `combo-secondary-grid` (making it 3 cards)
- Build new hero card JSX in the right column of `combo-main-grid`
- Build floating deep-refresh panel JSX

### 2. `src/index.css`
- Update `combo-secondary-grid` to support 3-column layout at wider widths, 2-col at medium, 1-col on mobile
- Add glassmorphism styles for deep-refresh panel (`.deep-refresh-panel`)
- Add MC histogram bar styles

## Implementation Order
1. Add new state variables and imports
2. Implement `runMonteCarloSim` function
3. Implement `handleSoftRefresh` and `handleDeepRefreshCommit`
4. Restructure JSX: move old card down, build new hero card
5. Build deep-refresh floating panel
6. Update CSS grid for 3-card secondary layout
7. Build and verify
