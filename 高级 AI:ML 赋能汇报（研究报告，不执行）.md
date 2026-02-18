Now for the final task — the Advanced AI/ML report. The user said "给我形成汇报一下即可，先不用执行这个" — so this is research/report only, no code changes needed.

好的，以下是所有任务的完成汇报：

------

## ✅ 已完成的4项任务

### 1. 投资组合展示：6个默认 + 展开至10个

- `optimizePortfolioAllocations` 调用参数从 `maxPackages=3` 改为 `maxPackages=10`
- 默认展示前 6 个，剩余以"展开更多 (+N)"按钮切换
- 收起/展开状态由 `showAllPortfolios` 控制

### 2. 算法说明卡片 v4.4 更新

- Modal 详情更新至 30 个步骤，分为5个模块：基础架构(v1-v3)、容错引擎(v4.0)、模型审计(v4.3)、Conf-Surplus与分散化(v4.4)、智能组合包
- 内联摘要卡增加版本号、详细描述和13个功能标签芯片
- 包含所有新特性：复合校准、保序回归、自学习因子、Walk-Forward、Conf-Surplus、锚定分散化、Entry相关性、Monte Carlo、Portfolio优化

### 3. 深度模型审计 — 发现并修复 6 个问题

| #    | 严重度     | 问题                                                         | 修复                                                         |
| ---- | ---------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| A    | 🔴 Critical | Walk-Forward 计算了动态 Kelly 除数但 `calcRecommendedAmount` 从未使用，一直用静态 `systemConfig.kellyDivisor` | 函数新增 `calibrationContext` 参数，读取 `walkForwardFeedback.adjustments.kellyDivisor` |
| B    | 🔴 Critical | Walk-Forward 计算了 `oddsWeightDelta` 但 `oddsWeightBase` 从未应用该增量 | `getPredictionCalibrationContext` 中 `oddsWeightBase` 现在加入 `wfOddsWeightDelta` |
| C    | 🟠 High     | NewInvestmentPage 的 `calcAdjustedConf` 仍使用硬编码 factor maps，未接入 `learnedFactors` | 完全对齐 ComboPage 的 learned factors 逻辑，`reliability > 0.15` 时使用学习值 |
| D    | 🟠 High     | FSE 公式两页不一致：NewInvestment `(0.85 + fseMatch * 0.3)` vs Combo `(0.88 + fseMatch * 0.24)` | 统一为 `(0.88 + fseMatch * 0.24)`，并修正 FSE 从 0-100 到 0-1 的归一化 |
| E    | 🟡 Medium   | `calcConfSurplus` 用原始 `match.conf` 而非校准后概率计算 surplus，可能产生误导性信号 | 新增 `calibratedP` 参数，surplus 现在基于模型校准概率 vs 市场隐含概率 |
| F    | 🟡 Medium   | Portfolio 优化器读 `item.confTiers` 但 recommendation 对象没有此顶层属性（只存在于 `explain.confTierSummary` 字符串），导致 tierDiv 永远为 0 | Recommendation 对象新增顶层 `confTiers` 数组                 |

------

### 4. 高级 AI/ML 赋能汇报（研究报告，不执行）

以下是可以进一步增强模型"智能"水平的方向，按可行性和预期价值排序：

#### Tier 1 — 高可行性、中短期可实现

**① Gradient Boosted Trees (XGBoost/LightGBM) 替代手工因子管线**

- 现状：MODE/TYS/FID/FSE → 手工 shrinkage 因子 → 乘性 context lift。本质上是人工定义特征交互。
- 升级：用 XGBoost/LightGBM 直接从 (conf, mode, tys_home, tys_away, fid, fse_home, fse_away, odds) 预测 is_correct。自动学习非线性交互、不需要人工分桶。
- 挑战：样本量。当前是数百到低千级样本，tree model 需要 ≥500 才开始有意义。可以用浅树 (max_depth=3) + 强正则化 + leave-one-out CV。
- 落地方式：在 analytics.js 中集成 [ml.js](https://github.com/mljs/ml) 或编译为 WASM 的轻量 LightGBM 推理引擎。训练离线做，导出模型 JSON。

**② Bayesian Updating / Online Learning**

- 现状：所有校准都是 batch（每次重新算全量历史）。
- 升级：用贝叶斯在线更新——每场结算后增量更新模型参数而非全量重算。对 conf 校准可以用 Beta-Binomial conjugate prior，每场更新 α/β。对因子可以用 Normal-Normal conjugate。
- 价值：实时适应近期 streak/slump，冷启动也更稳健。

**③ Elo/Glicko-2 自建球队实力评级**

- 现状：依赖外部 TYS 标注（S/M/L/H），本质是离散粗粒度。
- 升级：从历史比赛结果自建 Elo/Glicko-2 评级体系。每场比赛更新双方 Elo，Glicko-2 还跟踪 rating deviation（不确定性）。
- 落地：需要比赛结果数据（可以从结算记录反推或外部数据源）。Elo 差值可以直接转换为胜率先验。

**④ Copula 建模替代独立性假设**

- 现状：多腿组合的联合概率 = Π(p_i) + Entry 相关性 Phi 修正。本质仍是"独立假设 + 微调"。
- 升级：用 Copula（如 Clayton / Gaussian Copula）建模比赛结果之间的依赖结构。同一联赛、同一天的比赛通常有正相关（如进攻型联赛整体偏大球）。
- 价值：3+ 腿组合的联合概率估计更准确，直接影响 Sharpe / EV 计算质量。

#### Tier 2 — 中可行性、需要额外数据源

**⑤ NLP 舆情信号 (Sentiment Signal)**

- 思路：爬取赛前新闻/伤停/阵容信息，用预训练 LLM 或 FinBERT 提取情感分数（看好/看衰/中性）。作为 conf 的外部验证信号或独立特征。
- 价值：可以捕捉"内幕"级信息（关键球员伤停、换帅效应），conf 可能遗漏这些。
- 挑战：中文足球新闻 NLP 需要中文模型，数据获取和清洗工作量大。

**⑥ 赔率变动时序建模 (Odds Movement Features)**

- 思路：跟踪从开盘到临场的赔率变动曲线。Sharp 钱流（大资金线路变动）是市场定价效率的强信号。
- 特征：开盘 odds、临场 odds、Δodds、变动方向、变动速度。
- 价值：赔率下降 = 市场看好 → 如果 conf 也高则验证信号，如果 conf 低而赔率降则可能是信息不对称。
- 需要：实时或准实时赔率 API。

**⑦ Ensemble 模型 + Stacking**

- 思路：当前是单一管线（回归校准 + 保序回归）。可以跑多个 base learners（逻辑回归、随机森林、XGBoost、Naive Bayes），然后用 meta-learner（逻辑回归/简单平均）stack 它们的输出。
- 价值：Ensemble 通常比任何单模型更稳健，特别是在小样本下。
- 落地：base learners 可以在浏览器端用 ml.js/TensorFlow.js 跑推理。

#### Tier 3 — 实验性 / 长期方向

**⑧ Reinforcement Learning 下注策略**

- 思路：把 Kelly sizing + combo selection 建模为 MDP (Markov Decision Process)。State = 当前资金 + 今日比赛参数，Action = 选哪些 combo + 各投多少，Reward = 实际 P&L。
- 用 PPO/DQN 训练策略网络，自动学习最优 combo 构成和仓位分配。
- 挑战：超大 action space，样本效率极低（需要数万轮交互），不太适合真实下注场景。可以用模拟环境离线训练。

**⑨ 图神经网络 (GNN) 建模球队关系**

- 思路：球队之间有对战历史、转会关系、联赛层级关系。用 GNN 建模球队嵌入 (team embeddings)，捕捉传递性关系（A 胜 B，B 胜 C → A vs C 的先验）。
- 需要：大量历史对战数据。

**⑩ Transformer 序列模型**

- 思路：把用户的投注历史看作时序序列，用 Transformer 建模 conf → actual 的时序依赖（如连续高估后可能回调）。
- 需要：较长历史（数百条以上）。

------

**推荐优先级路线图**：

1. **立即可做**：② Bayesian Online Updating（纯代码改动，无新依赖）
2. **短期（1-2周）**：① XGBoost/LightGBM 概率模型（需集成 ml.js）
3. **中期（1个月）**：③ Elo/Glicko-2 + ④ Copula 联合分布
4. **需要数据基建**：⑤ NLP 舆情 + ⑥ 赔率变动时序
5. **实验性**：⑦ Ensemble Stacking → ⑧ RL → ⑨ GNN → ⑩ Transformer