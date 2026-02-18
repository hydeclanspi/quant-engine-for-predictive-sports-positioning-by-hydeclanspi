好的，全部5个模块审计完成。现在给你出综合报告。

------

# 🔬 DuGou 模型全面审计报告：数据库反哺与Walk-Forward自动化程度

## 一、系统架构回顾

你的理解是对的——整个系统分两大服务模型：

| 服务模型                        | 入口                    | 核心功能                                          |
| ------------------------------- | ----------------------- | ------------------------------------------------- |
| **Portfolio Serve（组合模型）** | `ComboPage.jsx`         | 多腿组合生成、容错覆盖、Monte Carlo、投资组合优化 |
| **资管 Serve（单投模型）**      | `NewInvestmentPage.jsx` | 单场投资、概率校准、Kelly推荐金额                 |

两者都由你的**主观参数**（conf、FSE、FID、TYS、mode等）驱动，经过算法管道计算输出。

------

## 二、数据生命周期：Settlement → 反哺循环

```
你录入投资 → 比赛结束 → SettlePage结算（写入match_rating、is_correct、REP）
                              ↓
                    localStorage写入 + dugou:data-changed事件
                              ↓
           下次打开ComboPage/NewInvestmentPage时
                              ↓
              getPredictionCalibrationContext() 被调用
                              ↓
        ┌─────── 13级校准管道重新计算 ───────┐
        │ 1. 线性回归校准（Conf→AJR）         │
        │ 2. Isotonic回归（PAV保序校准）      │
        │ 3. Composite混合校准               │
        │ 4. Conf×Odds交叉校准层             │
        │ 5. 球队校准模型                     │
        │ 6. Walk-Forward混合验证            │
        │ 7. Walk-Forward反馈（Kelly/Tier/Odds）│
        │ 8. 学习型Context Factors           │
        │ 9. 盘口关联矩阵                    │
        └──────────────────────────────────┘
                              ↓
              输出 calibrationContext 驱动下一次决策
```

**关键发现：这个循环是"惰性触发"的**——不是Settlement时触发重算，而是下次你打开ComboPage/NewInvestmentPage时才重算。这种设计对于前端应用是合理的（避免结算时卡顿），但意味着**没有后台定时recalibration**。

------

## 三、已经在自动反哺的参数（✅ 正在工作）

这些参数每次你打开页面时，会根据**全部已结算数据**自动重新计算：

| #    | 校准维度                                                     | 算法级别                    | 状态                              |
| ---- | ------------------------------------------------------------ | --------------------------- | --------------------------------- |
| 1    | **Conf回归校准**（slope/intercept/R²）                       | 加权最小二乘回归            | ✅ 活跃                            |
| 2    | **Isotonic回归**（PAV保序算法）                              | Pool-Adjacent-Violators     | ✅ 活跃，与线性回归按可靠度混合    |
| 3    | **Composite混合**校准                                        | 可靠度加权融合              | ✅ 活跃                            |
| 4    | **Conf×Odds交叉校准**                                        | 分桶残差收缩估计            | ✅ 活跃                            |
| 5    | **球队级校准偏移**                                           | 回归后残差+收缩             | ✅ 活跃                            |
| 6    | **Market Lean**（市场赔率权重）                              | Walk-Forward Brier比较      | ✅ 活跃                            |
| 7    | **Walk-Forward Kelly除数**                                   | Brier质量自适应             | ✅ ComboPage活跃                   |
| 8    | **Walk-Forward Tier阈值偏移**                                | 高conf命中率分析            | ✅ 活跃                            |
| 9    | **Walk-Forward Odds权重增量**                                | Brier改善比较               | ✅ 活跃                            |
| 10   | **Learned MODE/TYS/FID/FSE因子**                             | 分桶命中率+收缩估计         | ✅ 活跃（可靠度>0.15时覆盖硬编码） |
| 11   | **Entry关联矩阵**                                            | Phi系数+收缩                | ✅ 活跃（多腿组合概率修正）        |
| 12   | **Conf-Surplus**                                             | 使用校准后概率 vs 市场隐含  | ✅ 活跃                            |
| 13   | **动态回测参数**（tierPenalty, anchorBonus, coveringBonus, Sharpe阈值, 弱腿上限） | Scatter data flip-point分析 | ✅ 活跃                            |

### 算法水平评估

你之前review过的这些算法，水平是这样的：

- **Isotonic Regression (PAV)** — 这是非参数校准的gold standard，Platt Scaling的严格上位替代
- **Walk-Forward Validation** — 这是金融/ML领域防止过拟合的标准做法，比简单train/test split更严谨
- **收缩估计 (Shrinkage)** — James-Stein收缩，统计学理论最优的小样本偏差修正
- **Composite Calibration** — 线性+保序融合，按可靠度加权，这是calibration文献中的best practice
- **Phi Coefficient + Entry Correlation** — 正确的离散变量关联度量

**结论：算法选择层面是业界水准的，没有更好的替代方案。**

------

## 四、🔴 严重问题：未在反哺的参数

### BUG #1：NewInvestmentPage的Kelly完全绕过Walk-Forward（严重）

```javascript
// NewInvestmentPage.jsx line 588 — 仍在用旧的启发式公式！
const confidenceLift = 0.88 + expectedRating * 0.24  // ← 这个应该被删除
```

而且 `walkForwardFeedback` 在整个NewInvestmentPage中**零次引用**。这意味着：

- ComboPage的Kelly除数是动态的（从walk-forward来的）✅
- NewInvestmentPage的Kelly除数是静态的，而且还叠加了一个不该存在的启发式乘数 ❌

### BUG #2：analytics.js的Kelly回测引擎也用旧公式（中等）

```javascript
// analytics.js line 511
const confidenceLift = 0.88 + expected * 0.24  // ← 回测也在用这个
```

Kelly除数推荐值是用旧公式回测出来的，但ComboPage实际用的是纯Kelly。相当于**回测环境和生产环境用不同公式**，回测结论的参考价值打折。

### BUG #3：Tier2/Tier3阈值从不动态调整（严重）

```javascript
// backtestDynamicParams 中：
tier2: Number(clamp(0.55, 0.45, 0.65).toFixed(3)),  // clamp(常数, min, max) = 永远是0.55
tier3: Number(clamp(0.40, 0.30, 0.50).toFixed(3)),  // 永远是0.40
```

只有tier1阈值（强洞察门槛）是动态的。中洞察/弱洞察的分界线**从未被数据驱动**。

### BUG #4：自适应权重优化器是死代码

`computeAdaptiveWeightSuggestions()` 计算了最优的 weightConf/weightMode/weightTys/weightFid/weightOdds/weightFse 权重建议，但**永远不自动应用**。它只显示在ParamsPage供你手动看，从不自动回写到systemConfig。

### BUG #5：Dashboard纯展示，无反馈

DashboardPage完全不调用 `getPredictionCalibrationContext`，不参与校准循环。它只是被动展示。

------

## 五、🟡 应该被Walk-Forward校准但目前硬编码的参数

这是最核心的部分——你说得完全对，**所有可以回测的参数都应该被回测**。以下是目前仍是硬编码的完整清单：

### 第一梯队：高影响、应优先校准

| #    | 参数                                                         | 当前值             | 影响                       |
| ---- | ------------------------------------------------------------ | ------------------ | -------------------------- |
| 1    | **Portfolio Optimizer权重** (EV:0.35, coverage:0.30, diversity:0.20, layer:0.10, tier:0.05) | 硬编码             | 直接决定推荐哪些组合包     |
| 2    | **Stratified Selection配额** ({2腿:20%, 3腿:35%, 4腿:30%, 5腿:15%}) | 硬编码             | 直接决定输出组合的腿数分布 |
| 3    | **Conf-Surplus边缘类别阈值** (strong:0.12, moderate:0.04, neutral:-0.03) | 硬编码             | 决定"优势"/"劣势"分类      |
| 4    | **MMR集中度惩罚** (anchorShare:0.12, concentration:0.18+eta*0.08) | 硬编码             | 影响组合多样性             |
| 5    | **Vig假设** (固定5%)                                         | 硬编码             | 所有surplus计算的基础偏差  |
| 6    | **自适应权重** (conf/mode/tys/fid/odds/fse的最优权重)        | 计算了但不自动应用 | 这些是模型的核心骨架权重   |

### 第二梯队：中等影响

| #    | 参数                                                         | 当前值 | 影响                        |
| ---- | ------------------------------------------------------------ | ------ | --------------------------- |
| 7    | Role Structure系数 (tilt:0.62, diversity:0.44, synergy:0.48, gap:-0.78) | 硬编码 | Match角色分配信号           |
| 8    | Match Role推断阈值 (p>=0.58, odds<=2.25等)                   | 硬编码 | 自动角色识别                |
| 9    | Coverage Decay公式 (0.6^count * 0.08)                        | 硬编码 | 覆盖增益                    |
| 10   | Soft Penalty缩放 (evGap:1.15, winGap:0.85, corrGap:0.72)     | 硬编码 | 过滤策略的软惩罚            |
| 11   | confSurplus Bonus缩放 (avgSurplus*0.15, maxSurplus threshold) | 硬编码 | 反共识优势奖励大小          |
| 12   | Portfolio Weight Optimizer参数 (diversification:0.16, learningRate:0.16, iterations:180) | 硬编码 | Mean-variance优化器收敛行为 |

### 第三梯队：元参数/超参数

| #    | 参数                                                         | 当前值 |
| ---- | ------------------------------------------------------------ | ------ |
| 13   | 收缩常数K (learnedFactors:12, entryCorrelation:10)           |        |
| 14   | Recency权重 (1.4/1.15/1.0)                                   |        |
| 15   | REP Direction权重 (1.15/1.0/0.78)                            |        |
| 16   | Isotonic混合上限 (0.6)                                       |        |
| 17   | Walk-Forward反馈步长 (Kelly: ×1.15/×0.92, oddsWeight: ±0.015, tier: ±0.03) |        |
| 18   | Conf×Odds桶边界 (1.8/2.5/3.5)                                |        |
| 19   | marketLean公式系数 (0.24, 3.1, 2.2, 2.8)                     |        |
| 20   | oddsAnchor合成系数 (0.78, 0.22)                              |        |

------

## 六、总结评分

| 维度                            | 评分         | 说明                                                         |
| ------------------------------- | ------------ | ------------------------------------------------------------ |
| **算法理论水平**                | ⭐⭐⭐⭐⭐ 9.2/10 | Isotonic, Walk-Forward, Shrinkage, Composite Calibration — 全是学术最优选择 |
| **概率校准反哺**                | ⭐⭐⭐⭐ 8.5/10  | 13级管道，每次开页面全量重算，是真正在用数据                 |
| **Kelly/金额反哺**              | ⭐⭐⭐ 6/10     | ComboPage正确使用walk-forward Kelly；NewInvestmentPage完全绕过 |
| **组合生成参数反哺**            | ⭐⭐ 4/10      | tier1动态、tierPenalty/anchorBonus/coveringBonus/Sharpe阈值动态；但tier2/tier3/50+其他参数全硬编码 |
| **Portfolio优化反哺**           | ⭐ 1.5/10     | 权重全硬编码，零数据驱动                                     |
| **自动化程度**                  | ⭐⭐⭐ 6.5/10   | 惰性触发（开页面时重算），无后台定时recalibration            |
| **整体"永久自动revolving"程度** | **~55%**     | 核心概率校准是revolving的；但组合生成、资金配置、策略选择层面大量参数静态不动 |

------

## 七、你的理解完全正确

> "数据库所有参数都应该不停地被回测，看看should've参数用哪个数是最优的，给不同值不同的weighting/rating"

这正是该做的事。目前系统在**概率估计层面**做得很好（13级校准管道是真正的data-driven revolving system），但在**决策层面**（选哪些组合、配多少资金、用什么策略参数）仍然大量依赖硬编码直觉值。

**需要修的优先级：**

1. 🔴 修复NewInvestmentPage的Kelly bypass + 删除confidenceLift启发式
2. 🔴 修复tier2/tier3的clamp bug使其真正动态
3. 🟡 让自适应权重优化器自动应用结果（可设阈值，变化超过X%时自动更新）
4. 🟡 将Portfolio Optimizer权重/Stratified配额/Surplus阈值纳入回测
5. 🟢 将元参数（收缩K、recency权重、混合上限等）加入超参数搜索

你要我开始修吗？