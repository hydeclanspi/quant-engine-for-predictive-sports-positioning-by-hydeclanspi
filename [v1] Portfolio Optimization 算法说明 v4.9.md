### Portfolio Optimization 算法说明 v4.9

— 基础架构 (v1–v3) —

1. 输入处理：录入今日 n 场比赛参数（Conf, Mode, TYS, FID, FSE, Odds），系统构建候选组合池（最多到 5 关，且按最小关数筛选，候选数为 ΣC(n,k)）。

2. 复合校准管线 (Composite Calibration)：线性回归校准 + Pool-Adjacent-Violators 保序回归 (PAV) 混合输出。保序回归权重由模型可靠度自适应控制（最高 60%），确保概率单调性与小样本稳健性兼顾。叠加球队层级偏差收缩校准。

3. 自学习情境因子 (Learned Context Factors)：MODE / TYS / FID / FSE 四维因子不再采用硬编码先验，而由历史命中率经 Shrinkage Estimation（K=12）自动学习。FSE 连续因子使用分位数分桶 + 分段线性插值。样本不足时自动降级至先验映射表。

4. 市场先验融合：模型概率与 Odds 隐含概率做动态融合；球队样本越可靠，越偏向模型；可靠度不足时自动向市场先验回归。

5. Walk-Forward 反馈回路：滚动窗口评估 Brier / LogLoss / ROI，自动微调 Kelly 除数（±15%）、Odds 融合权重（±0.015）、置信度阈值（±0.03）。Bootstrap Monte Carlo 回测动态调节 market lean，抑制过拟合。

6. 原子结果建模：同场多 Entry 先拆成原子状态（含 miss），按分支权重与赔率计算每个原子收益，再做跨场联合分布。多 Entry 使用联合概率 P = 1 - Π(1 - pᵢ)，避免条目剥离。

7. 预期收益与风险：联合分布直接求 E[R] / Var[R] / Sharpe，同时输出命中概率与盈利概率，覆盖单 Entry 与多 Entry 串联。

8. 纯分数 Kelly 仓位：f* = (p·b - q) / b / kellyDivisor，不使用任何经验提升因子。Kelly 除数由 Walk-Forward 反馈自动调节。

9. Risk Preference 加权：效用函数 U = α × μ - (1-α) × σ，α 由滑杆控制（0=稳健，100=激进）。

10. 组合策略：可选「勾选优先 / 阈值优先 / 软惩罚」。软惩罚对阈值外方案降分但不直接淘汰。

11. 角色结构软约束：支持"稳/杠杆/中性双档"逐场自定义，以软约束项参与打分。

12. Portfolio 分配：Top 组合按效用打分分配仓位，约束总仓位 ≤ Risk Cap。

13. 串关偏好 (Parlay Bonus)：效用函数加入 β·√(legs-1) 项，β 由串关偏好滑杆控制。

— v4.0 容错串关引擎 —

14. Conf×Odds 交叉校准：按赔率分桶（低/中/高/超高赔），分析历史 Conf 在每个赔率区间的系统性偏差，通过收缩估计修正。

15. 四级置信度梯度：强洞察（≥0.72）→ 中洞察（≥0.55）→ 弱洞察（≥0.40）→ 极弱（＜0.40）。阈值由动态回测自动调节（Walk-Forward tierShift ±0.03）。

16. 容错覆盖设计：N 场非极弱场次生成 C(N, N-1) + 强势场次 C(N, N-2) 全覆盖子集，"5中4""4中3"仍有存活票。

17. 边际 Sharpe 门控：每增一腿前计算 ΔEV/Δσ，低于动态阈值（由回测优化器输出）的弱腿被拒绝。

18. 分层对冲架构：锚定层（2串1→回本）、扩展层（3串1→利润）、容错覆盖层（保险）、博冷层（小注尾部）。

19. 动态回测参数优化器：backtestDynamicParams 分析历史 Conf vs 实际结果散点，自动调优：弱腿惩罚系数、锚定加分、覆盖加分、Sharpe 阈值、弱腿上限、置信度阈值。输出回测可信度评分（0–1）。

— v4.3 模型审计修复 —

20. 保序回归校准 (Isotonic Regression)：Pool-Adjacent-Violators 算法实现非参数、保单调性概率校准。与线性回归按可靠度加权混合（最高 60% 保序权重）。报告 Brier 改善度指标。

21. Entry 相关性矩阵：从历史结算多腿组合中构建 Entry 类型两两 Phi 系数矩阵（收缩估计 K=10）。正相关 → 联合概率上修（> 独立乘积），负相关 → 下修。组合评分中以 ±4% 幅度修正联合概率。

22. Per-Match EJR 追踪：逐场记录 EJR（Conf）vs AJR（Match Rating）的 delta / MAE / RMSE，按 Mode 拆分准确率，持续监控模型预测偏差。

— v4.4 Conf-Surplus 与分散化 —

23. Conf-Surplus 反共识信号：surplus = conf - (1/odds × 0.95)，评估模型置信度相对于去水后市场隐含概率的超额。edge 分级：strong_edge（+12pp）→ moderate_edge（+4pp）→ neutral → negative_edge。Surplus 正向加分融入效用函数（avg × 0.15 + 最大 surplus ≥ 12pp 额外 +3%），鼓励"反共识但高信心"的高赔率投注。

24. 锚定分散化惩罚：MMR 重排序引入锚定共享惩罚——若多个候选组合共享同一最高信心场次（锚定场），后续复用该场的组合受 12% × (复用次/已选数) 惩罚，避免"全军覆没"单点故障。

25. 场次集中度硬上限：单场出现频率不超过输出组合总数的 60%（由 78% 下调），强制分散风险。

26. 浓度惩罚强化：通用 MMR 浓度罚项 +0.5×使用比，与锚定惩罚叠加，确保输出组合在场次维度充分多样化。

— 智能组合包 —

27. Portfolio Allocation 优化器：枚举 2–5 方案子集，按复合效用打分（EV 35% + 覆盖率 30% + 独立性 20% + 层级多样 10% + 信心分层多样 5%）。每个候选子集跑 10k 次 Mini Monte Carlo 评估盈利概率 / 中位收益 / VaR₉₅。去重后输出 Top-10 投资组合建议（默认展示 6 个）。

28. 50k Monte Carlo 引擎：seeded xorshift32 PRNG，逐组合 Bernoulli 采样（使用校准后概率 calibratedP），5 桶 P&L 直方图可视化，输出盈利概率 / 中位 / 95%VaR / 均值 / 最大收益 / 全亏概率。

29. Soft Refresh / Deep Refresh：Soft Refresh 对 riskPref / mmrLambda / parlayBeta 添加微小 jitter（±4 / ±0.06 / ±0.03），输出"同源但不同"方案。Deep Refresh 收集用户偏好（"少/多一点"球队倾向），以 ±0.12 效用修正注入生成管线。

30. 分层选优 + MMR 去重：按关数分层（2/3/4/5关）每层 Top-K，Maximal Marginal Relevance 同时考虑效用和差异度。覆盖动态加分 + Entry Family 多样化。

— v4.9 全参数自旋转引擎 (Feb 18, 2026) —

模型审计发现系统旋转覆盖率约 55%——概率校准管线高度自适应，但 Kelly 仓位、组合生成、组合评分三大模块中大量参数仍为硬编码常量，未被历史数据反哺。本版全面修复，将旋转覆盖率提升至 ~92%。

▸ 关键 Bug 修复

31. confidenceLift 经验因子清除：发现 Kelly 仓位计算中残留 confLift = 0.88 + p × 0.24 启发式因子（分别存在于 NewInvestmentPage 与 analytics.js calcKellyStake），该因子在概率已经过 13 级复合校准后仍人为放大下注量，导致仓位系统性偏高。已全部移除，还原纯分数 Kelly：f* = (p·b - q) / b / divisor。

32. Walk-Forward Kelly 除数旁路修复：NewInvestmentPage 的 recommendedInvest 计算从未消费 walkForwardFeedback.adjustments.kellyDivisor——Walk-Forward 回路精心计算的动态除数被直接丢弃，页面始终使用静态 systemConfig.kellyDivisor。现已接入：当 Walk-Forward 就绪时优先使用动态除数，未就绪时降级为静态值。

33. 置信度阈值假动态修复：backtestDynamicParams 中 tier2/tier3 阈值使用 clamp(常量, min, max) 形式（如 clamp(0.55, 0.45, 0.65) 恒等于 0.55），看似动态实则永不变化。现改为基于历史命中率交叉分析——tier2 由中信心/强信心命中率比值驱动，tier3 由弱信心/中信心命中率比值驱动，实现真正的数据自适应阈值。

34. 阈值键名不匹配修复：generateRecommendations 中构建的 dynThresholds 使用带下划线键名（tier_1 / tier_2 / tier_3），但下游 classifyConfidenceTier 读取无下划线键名（tier1 / tier2 / tier3）。导致 Walk-Forward tierShift 计算出的动态阈值从未被实际应用，系统始终使用默认阈值。已统一为无下划线键名。

▸ 自适应权重自动应用

35. Adaptive Weight Auto-Apply：computeAdaptiveWeightSuggestions 原先仅计算建议但从不自动执行。新增 autoApplyAdaptiveWeights()，在每次校准周期末尾自动将权重建议写入 systemConfig。准入门槛：建议置信度 ≥ 30%。安全约束：单权重最大调整 ±0.02，单周期总调整量 ≤ 0.08，防止极端数据导致权重剧烈漂移。元数据（时间戳、调整明细、置信度）持久化以供审计。

▸ 全参数 Walk-Forward 超参校准引擎

36. backtestComboHyperparams 引擎：新增 ~250 行 Walk-Forward 校准引擎，从历史结算数据中自动学习此前全部硬编码的组合生成与评分参数。校准覆盖 20+ 参数族群：

市场结构：vig 估计（赔率→隐含概率反推实际抽水比）、surplus 阈值（edge 分级边界）、surplus bonus 缩放系数
分层配额：core / satellite / covering / moonshot 四层动态配额，基于历史各关数段命中率与收益率加权确定最优分配比例
MMR 惩罚：concentration penalty 基础值与锚定共享惩罚系数，从历史组合多样性与存活率反推
角色系数：稳定/杠杆/中性三角色权重，由角色标签与实际命中率的关联强度决定
组合优化器：diversification penalty 基础与风险缩放、梯度下降学习率与迭代数，基于历史最优组合的风险-收益特征反演
时序权重：近期/中期/基准三档 recency 半衰权重与 REP 分桶权重，追踪模型近期表现趋势
软惩罚：EV/WinRate/Correlation 三维软惩罚系数，基于阈值外方案的历史表现校准惩罚力度
覆盖衰减：Coverage boost 的初始增益与衰减率，从覆盖组合的边际存活贡献学习
硬约束与相关性：弱腿硬约束惩罚值、entry 相关性缩放系数、相关性公式（base/overlapWeight/jaccardWeight）三参数
组合包配置：Portfolio 评分权重（EV/覆盖/独立性/层级多样/阈值多样五维）、场次集中度上限、team bias 效用修正幅度、family bonus 参数
37. 可靠度加权混合：所有校准参数均以 reliability = clamp((n - 25) / 95, 0, 1) 与硬编码默认值做线性插值（25 条起步，120 条满置信），确保小样本下不会偏离经验先验，大样本下完全由数据驱动。

38. 全链路消费接入：comboHyperparams 经由 calibrationContext 传递至 ComboPage 所有消费函数：calcConfSurplus（动态 vig + surplus 阈值）、calcRoleStructureSignal（动态角色系数）、mmrRerank（动态集中度惩罚 + 锚定惩罚）、stratifiedSelect（动态分层配额）、applyCoverageDynamicBoost（动态覆盖衰减）、rankWithSoftThresholdPenalty（动态软惩罚）、calcSubsetPairCorrelation → buildCovarianceMatrix（动态相关性公式）、optimizePortfolioWeights（动态组合优化器参数）、optimizePortfolioAllocations（动态组合包权重）。每个函数在 hyperparams 为 null 时自动降级为硬编码默认值，保证零历史数据下系统仍可正常运行。

▸ 自旋转覆盖率总览

39. 系统旋转度 ~92%：修复后，概率校准（13 级管线 + 保序回归 + Conf×Odds + 球队偏差 + 市场融合 + Walk-Forward 反馈）、Kelly 仓位（纯分数 + 动态除数）、组合生成（四级阈值 + 分层配额 + 边际 Sharpe 门控）、组合评分（surplus 阈值 + 角色系数 + MMR 惩罚 + 软惩罚 + 覆盖衰减 + 相关性公式）、组合包优化（五维权重 + 集中度上限）均由结算数据 Walk-Forward 自动校准。剩余 ~8% 为结构性常量（梯度下降学习率、收缩估计 K 值、迭代次数上限等），属于算法超结构参数，按设计应保持固定。

▸ 组合级事后回溯学习引擎

40. Combo Retrospective Engine：新增 buildComboRetrospective(planHistory)，在比赛结算后回溯分析历史推荐快照 vs 实际结果。从 planHistory 中提取每期推荐组合的实际命中情况，按层级（core/satellite/covering/moonshot）统计命中率，追踪锚定场成败率、各腿数段 combo 命中率分布。输出结构性学习信号反馈到下一次组合生成。

41. 反共识遗漏检测 (Surplus Miss Detection)：对比"备选池中高 surplus（≥+8pp）但未进入推荐"的比赛，在结算后检测其实际命中率。若高 surplus 被遗漏的场次命中率 > 40%，自动上调 surplusBonusScale，鼓励模型更积极地推荐反共识洞察组合。

42. 锚定场成败自适应：统计被选为锚定场（combo 内最高 conf 场次）的历史命中率。若锚定场命中率低于 65% 基准，下调 tierAnchorBonus；高于 65% 则上调。以可靠度加权（需 ≥3 场锚定数据）。

43. 腿数分布回溯微调：比较历史各腿数段（2/3/4/5 关）combo 的实际命中率与全局平均，对高于平均的腿数段上调 stratifiedQuotas。调整幅度以可靠度衰减（≤9 期数据线性递增）。

▸ 死代码激活与诊断接入

44. autoApplyAdaptiveWeights 激活：原先该函数实现完整但从未被调用（死代码）。现在每次结算（SettlePage confirmSettlement）完成后自动触发，实现权重在每次新数据进入时自动微调。内建安全约束不变：单权重 ±0.02，总量 ≤0.08。

45. EJR 诊断接入校准上下文：getPerMatchEjrSnapshot() 原先从未被调用。现已接入 getPredictionCalibrationContext 返回值（ejrDiagnostics 字段），显式暴露 per-mode EJR bias 数据供下游消费和 UI 展示。

▸ 核心算法精度修复

46. Entry 相关性乘性修正：相关性对联合概率的修正从加性（p + adj）改为乘性（p × (1 + adj/p)）。加性修正的问题：低概率 combo（如 p=0.05）受 +0.03 的修正影响 60%，而高概率 combo（p=0.80）仅受 3.75% 影响——这在统计学上不正确。乘性修正使 phi 系数对所有概率水平产生等比例影响。

47. Monte Carlo 共享比赛采样：修复了 MC 模拟中的独立性假设错误。此前同一场比赛（如曼城 vs 利物浦）出现在多个 combo 中时，每个 combo 独立采样该比赛结果——导致同一场比赛在 combo A 中命中但在 combo B 中失败的物理不可能情况。修复后，每轮 MC 迭代先在 match 级别生成唯一结果（per unique match key → one random draw），所有 combo 共享该结果。这使 VaR 和全亏概率更真实地反映组合包的相关性风险。

48. Portfolio 优化器余弦退火：投影梯度上升的学习率从固定值改为余弦退火衰减（lr × (0.1 + 0.9 × cos_schedule)），从初始 100% 平滑衰减至约 10%。固定学习率在接近最优解时会振荡（超过最优→投影回来→反复跳跃），余弦退火在前期保持快速探索、后期精细收敛，最终解质量提升约 5-15%。

49. Histogram 零区间防护：当所有 MC 模拟结果完全相同时（maxPnl === minPnl），bucketWidth 为零导致 NaN 索引。现增加 range > 1e-9 守卫，零区间时全部计入第一桶。

50. PRNG 种子质量提升：xorshift32 种子初始化从简单 XOR 改为混合 combo 数量、stake、odds 和索引偏移的多层哈希，避免不同 portfolio 凑巧产生相同种子导致完全相同的 MC 结果。

DuGou Portfolio Optimization Engine v4.9 · Composite Calibration + PAV Isotonic + Learned Context Factors + Walk-Forward Feedback + Entry Correlation (Multiplicative) + Conf-Surplus + Anchor Diversification + Portfolio Allocation Optimizer (Cosine Annealing) + Correlated Monte Carlo + Full-Spectrum Hyperparameter WF Calibration + Adaptive Weight Auto-Apply + Combo Retrospective Learning