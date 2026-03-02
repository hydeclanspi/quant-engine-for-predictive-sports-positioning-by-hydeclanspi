# 依赖矩阵智能建议系统 - 实现路线图

## 📅 当前状态

✅ **Phase 1 完成** (2026-03-02)
- 核心算法框架实现完毕
- 所有11个API函数已导出
- 生产构建验证通过 (npm run build ✓)
- 完整的技术文档已编写

## 🎯 Phase 2 - 数据准备与集成 (待开始)

### 2.1 历史数据收集
**目标**：从现有投资数据中提取历史组合失败记录

```javascript
// 需要实现的数据转换函数
export const extractHistoricalComboData = () => {
  const investments = getActiveInvestments()

  // 转换为算法期望的格式
  return investments.map(inv => ({
    matches: inv.matches.map(m => ({
      odds: m.odds,
      result: m.status === 'won',  // true/false
      matchDate: m.matchDate
    })),
    succeeded: inv.status === 'won',
    createdAt: inv.createdAt,
    investmentId: inv.id
  }))
}
```

### 2.2 数据质量检查
**验证项**：
- [ ] 所有赔率 > 1.0
- [ ] 所有时间戳为有效ISO格式
- [ ] 每个组合至少有2场比赛
- [ ] 历史数据样本 > 10个（建议 > 30个）
- [ ] 没有明显的数据缺失或异常值

### 2.3 缓存与性能优化
**考虑事项**：
- 预计算常用的历史统计（全局失败率、样本分布等）
- 实现增量更新而不是每次重新计算
- 考虑在后台定期更新脆弱性分数

## 🎨 Phase 3 - 前端集成 (待开始)

### 3.1 创建新UI组件
**需要的组件**：
```
src/components/
├── FragilityIndicator.jsx          # 脆弱性指示器
├── FragilityScoreCard.jsx          # 脆弱性分数卡片
├── CriticalPairsWarning.jsx        # 关键脆弱对警告
└── ComboRestructureModal.jsx        # 重组建议弹窗
```

### 3.2 集成点1：投注构建界面
**位置**：ParamsPage或投注编辑器
**显示内容**：
- 实时脆弱性分数（当用户添加比赛时更新）
- 关键脆弱对高亮
- 智能重组建议

**交互**：
```jsx
<ComboFragilityPanel
  matches={selectedMatches}
  historicalData={historicalComboData}
  onApplyRecommendation={(newCombo) => {
    // 用户点击"应用建议"按钮
    replaceCombo(newCombo)
  }}
/>
```

### 3.3 集成点2：投资快照与历史回顾
**位置**：时光穿越机或投资详情
**显示内容**：
- 已完成投资的脆弱性评分（回顾性）
- 对比：预测脆弱性 vs 实际结果
- 学习规律

### 3.4 集成点3：风险仪表板
**位置**：DashboardPage新增卡片
**显示内容**：
- 当前活跃投资的脆弱性分布
- 极高风险组合（脆弱性 > 60%）预警
- 周/月脆弱性趋势

## 🔧 Phase 4 - 后端API端点 (待开始)

### 4.1 新增API端点

#### POST /api/combo/analyze-new
```javascript
请求体：
{
  matches: [
    { odds: 5.5, teamA: '...', teamB: '...' },
    { odds: 2.0, ... }
  ]
}

响应：
{
  fragilityScore: 42.37,
  riskLevel: 'high',
  criticalPairs: [...],
  recommendations: [...],
  confidence: 0.6
}
```

#### GET /api/combo/:id/fragility-analysis
```javascript
响应：
{
  investmentId: 'inv_123',
  combo: [...],
  fragilityScore: 38.42,
  analysis: {
    pairAnalysis: [...],
    components: {...}
  },
  historicalContext: {
    // 与历史数据的对比
  }
}
```

#### POST /api/analysis/update-historical-cache
```javascript
// 后台任务：更新历史数据缓存
响应：
{
  success: true,
  samplesProcessed: 342,
  lastUpdate: '2026-03-02T10:30:00Z'
}
```

### 4.2 后端集成函数

```javascript
// src/lib/fragilityCaching.js

// 初始化缓存
export const initFragilityCache = () => {
  const historicalData = extractHistoricalComboData()
  return {
    data: historicalData,
    globalStats: {
      failureRate: calculateGlobalFailureRate(historicalData),
      avgComboSize: calculateAvgComboSize(historicalData),
      lastUpdate: new Date()
    }
  }
}

// 分析新组合
export const analyzeNewCombo = (matches, cache) => {
  return assessComboFragility(matches, cache.data)
}

// 定期更新
export const updateFragilityCache = () => {
  // 在服务器启动或定时任务中调用
  const cache = initFragilityCache()
  // 保存到内存或数据库
  saveFragilityCache(cache)
}
```

## 📊 Phase 5 - 持续优化 (待开始)

### 5.1 A/B测试
**测试内容**：
- 显示脆弱性分数是否改变用户的投注行为
- 脆弱性分数的预测准确度
- 用户是否遵循建议

### 5.2 反馈循环
**收集**：
- 用户是否接受建议
- 接受建议后的实际结果
- 脆弱性预测 vs 实际失败率对比

### 5.3 模型改进
**迭代方向**：
- 调整权重参数（如时间权重系数、样本量权重曲线）
- 添加新的统计控制（如赛事级别控制、联赛固有风险调整）
- 多变量依赖分析（不仅两两比较，还有三个或更多比赛的依赖）

## 🚨 优先级与时间表

### 🔴 P0 - 关键路径 (第1周)
- [ ] Phase 2.1: 历史数据提取与转换
- [ ] Phase 2.2: 数据质量检查
- [ ] Phase 4.1: 基础API端点实现
- [ ] Phase 3.1: 基础UI组件

### 🟡 P1 - 次要功能 (第2周)
- [ ] Phase 3.2-3.4: 各个集成点的详细实现
- [ ] Phase 4.2: 后端缓存系统
- [ ] 文档与使用说明

### 🟢 P2 - 优化与扩展 (第3周+)
- [ ] Phase 5: 持续优化与反馈循环
- [ ] 性能优化
- [ ] 高级特性（多变量依赖、赛事级别控制等）

## 💡 实现建议

### 1. 从最简单的集成点开始
建议顺序：
1. **投注构建界面** - 最直接的用户价值
2. **API端点** - 为其他组件提供服务
3. **风险仪表板** - 汇总展示
4. **历史回顾** - 学习与验证

### 2. 数据驱动的开发
- 先用真实数据验证算法（不依赖UI）
- 逐步添加可视化
- 收集用户反馈后迭代

### 3. 渐进式推出
- Beta版本：内部使用，收集反馈
- 第一波：部分用户
- 全量推出：基于反馈优化后

## 📚 文档参考

**详细技术文档**：见 `DEPENDENCY_RISK_ANALYSIS_SYSTEM.md`

核心内容：
- API参考与代码示例
- 数据格式规范
- 统计学基础
- 集成建议

## ❓ 待决定事项

1. **历史数据范围**
   - 使用全部历史数据？还是最近N个月？
   - 建议：最近6-12个月（数据新鲜 + 样本足够）

2. **缓存刷新频率**
   - 每日？每小时？实时？
   - 建议：每日一次（平衡准确性和性能）

3. **默认显示配置**
   - 在投注构建界面默认启用？还是可选？
   - 建议：默认启用，用户可关闭

4. **算法参数微调**
   - 时间权重系数（目前1.15） - 需要验证
   - p值阈值（目前0.03） - 可根据反馈调整
   - 保守系数（目前0.2） - 非激进 vs 更激进的权衡

## 🎓 学习资源

如需深入理解底层数学：
- 条件概率与贝叶斯推理
- 倾向评分匹配 (Propensity Score Matching)
- 二项检验与正态近似
- 幸存者偏差与选择偏差

---

**下一步**：
根据时间表，开始 Phase 2.1（历史数据提取）。建议在启动任何UI工作之前，先完成数据验证和API实现。
