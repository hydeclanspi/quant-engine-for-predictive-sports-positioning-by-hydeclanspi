# 依赖风险高级分析系统 (Dependency Risk Premium Analysis System)

## 🎯 核心目标

解决组合投注中的"灾难性失败风险"问题：
- **问题**：4串中3串正确但1串失败，导致整个投注失败
- **目标**：学习历史失败组合，为新比赛对提供智能脆弱性评分
- **输出**：数据驱动的重组建议，降低关键依赖的失败风险

## 📊 核心算法框架

### 1. 依赖风险溢价 (Dependency Risk Premium)

基于条件概率方法（Method 2）计算：

```
Premium = P(both fail | together) - [P(A fails) × P(B fails)]
```

**参数含义：**
- `P(both fail | together)` = 观察到的共同失败率（从历史数据）
- `P(A fails)` = A的市场隐含失败率 = 1/odds_A
- `P(B fails)` = B的市场隐含失败率 = 1/odds_B

**溢价解释：**
- Premium > 0：存在正向依赖（更容易共同失败）
- Premium < 0：存在负向依赖（相互独立或互补）
- Premium ≈ 0：基本独立，无额外风险

### 2. 六重统计控制

#### ✅ 问题1：样本量偏差
**解决方案**：样本量信心权重

```javascript
<5样本    → 权重 0.1   (非常不可信)
5-10样本  → 权重 0.3   (较低信任度)
10-20样本 → 权重 0.6   (中等信任度)
20-30样本 → 权重 0.85  (高信任度)
≥30样本   → 权重 1.0   (完全信任)
```

#### ✅ 问题2：选择偏差
**解决方案**：市场隐含失败率 (Option A)

使用 `P(fail) = 1/odds` 而非历史失败率
- 原因：历史失败率容易被用户的偏好选择扭曲
- 优势：市场定价包含全球信息，更加客观

#### ✅ 问题3：幸存者偏差
**解决方案**：倾向评分匹配 (Propensity Matching - Method B)

比较特征相似的比赛对（如赔率4.6+1.7 vs 4.4+1.8）：
- 检查目标对是否被过度选择或过度避免
- 如果存在明显偏差，对溢价进行保守调整
- 调整系数：偏差强度 × 0.5

#### ✅ 问题4：时间效应
**解决方案**：时间权重系数

```javascript
最近60天（约2个月）的数据 → 权重 1.15x
更早的历史数据            → 权重 1.0x
```

加权计算：
```javascript
加权共同失败次数 = Σ(失败次数 × 时间权重)
加权总试验数     = Σ(试验数 × 时间权重)
```

#### ✅ 问题5：多重比较问题
**解决方案**：严格的p值阈值

```javascript
标准显著性水平：p < 0.05
本系统阈值：    p < 0.03 (更严格)
```

使用二项检验（正态近似）：
- 检验零假设：观察到的失败率 = 预期失败率
- 如果 pValue < 0.03，则认为存在显著依赖效应

#### ✅ 问题6：基准率调整
**解决方案**：保守的基准率正规化

```javascript
全局失败率 = 历史所有组合中失败的比例

调整策略（非激进）：
- 如果 Premium > 0：乘以 (1 - 0.2) = 0.8
- 如果 Premium < 0：乘以 (1 + 0.2) = 1.2

目的：不让基准率调整压倒真实的依赖信号
```

## 📚 API 文档

### 核心函数

#### `getMarketImpliedFailureRate(odds)`
获取市场隐含的失败率

```javascript
const failureRate = getMarketImpliedFailureRate(3.5)
// 返回：0.2857 (大约 28.6%)
```

---

#### `getConfidenceWeight(sampleSize)`
获取样本量信心权重

```javascript
const weight = getConfidenceWeight(8)
// 返回：0.3 (8个样本，权重较低)
```

---

#### `getTemporalWeight(date)`
获取时间权重系数

```javascript
const weight = getTemporalWeight('2026-02-28')  // 最近日期
// 返回：1.15

const weight = getTemporalWeight('2025-12-01')  // 两个月前
// 返回：1.0
```

---

#### `calculateDependencyPremium(raceA, raceB, historicalData, raceAIndex, raceBIndex)`
**核心函数**：计算依赖风险溢价

```javascript
const raceA = { odds: 3.5 }
const raceB = { odds: 1.8 }
const historicalData = [
  {
    matches: [
      { odds: 3.5, result: false },
      { odds: 1.8, result: false },
      { odds: 2.1, result: true }
    ],
    succeeded: false,
    createdAt: '2026-02-28'
  },
  // ... 更多历史记录
]

const result = calculateDependencyPremium(
  raceA,
  raceB,
  historicalData,
  0,  // raceAIndex
  1   // raceBIndex
)

// 返回：
{
  premium: 0.082,                    // 8.2%的正向依赖溢价
  pFailA: 0.286,                    // A的失败率：28.6%
  pFailB: 0.556,                    // B的失败率：55.6%
  pFailBothObserved: 0.24,          // 观察到的共同失败率：24%
  pFailBothIndependent: 0.159,      // 独立假设下的共同失败率：15.9%
  sampleSize: 10,                   // 10个样本
  confidence: 0.3,                  // 样本量权重：0.3（较低）
  pValue: 0.042,                    // p值
  isSignificant: false,             // p > 0.03，不显著
  observedFailedCount: 2.4,         // 加权失败次数
  weightedCount: 10                 // 加权总数
}
```

---

#### `checkSurvivingBias(raceA, raceB, historicalData, raceAIndex, raceBIndex, toleranceFactor)`
检查幸存者偏差（倾向评分匹配）

```javascript
const bias = checkSurvivingBias(
  { odds: 3.5 },
  { odds: 1.8 },
  historicalData,
  0,
  1,
  0.15  // 特征相似度容差（±15%）
)

// 返回：
{
  hasBias: true,
  biasDirection: 'overselected',    // 这对被过度选择
  biasStrength: 0.22,               // 偏差强度：22%
  matchedPairs: 15,                 // 找到15对特征相似的对
  investedInTarget: 12,             // 其中12对被投资
  investedInSimilar: 8              // 特征相似的对中8对被投资
}
```

---

#### `adjustForBaseRate(premium, historicalData, conservativeFactor)`
保守的基准率调整

```javascript
const adjusted = adjustForBaseRate(
  0.082,           // 原始溢价
  historicalData,
  0.2              // 保守系数
)

// 返回：
{
  adjustedPremium: 0.066,           // 调整后：0.082 × 0.8 = 0.066
  adjustmentFactor: 0.8,
  globalFailureRate: 0.35,          // 全局失败率：35%
  conservativeFactor: 0.2
}
```

---

#### `assessFragilityScore(raceA, raceB, historicalData, raceAIndex, raceBIndex)`
**主要输出函数**：综合脆弱性评分

```javascript
const fragility = assessFragilityScore(
  { odds: 5.5 },
  { odds: 2.0 },
  historicalData,
  0,
  1
)

// 返回：
{
  fragilityScore: 42.37,                    // 42.37分（0-100）
  fragilityPercentage: "42.37%",           // 用户友好格式
  riskLevel: "high",                        // 风险等级：low/medium/high/critical
  isSignificant: true,                      // 统计上显著
  confidence: 0.6,                          // 信心度：60%
  components: {
    premium: { ... },                       // 依赖溢价详情
    bias: { ... },                          // 幸存者偏差详情
    adjusted: { ... }                       // 基准率调整详情
  }
}
```

脆弱性评分计算：
```javascript
fragilityScore = [(adjustedPremium + 0.5) / 1.0] × 100
```

**风险等级判定：**
- fragilityScore > 60：🔴 CRITICAL（极危险）
- 40-60：🟠 HIGH（高风险）
- 25-40：🟡 MEDIUM（中等风险）
- < 25：🟢 LOW（低风险）

---

#### `assessComboFragility(matchGroup, historicalData)`
评估完整组合的脆弱性（如4串）

```javascript
const comboFragility = assessComboFragility(
  [
    { odds: 1.5 },
    { odds: 3.1 },
    { odds: 5.4 },
    { odds: 6.2 }
  ],
  historicalData
)

// 返回：
{
  comboSize: 4,                             // 组合大小
  overallFragility: 38.42,                  // 整体脆弱性：38.42%
  pairAnalysis: [                           // 所有对的分析
    { pair: [0,1], assessment: {...} },
    { pair: [0,2], assessment: {...} },
    // ... 更多对
  ],
  criticalPairs: [                          // 脆弱性 > 40% 的对
    { pair: [1,3], assessment: {...} }
  ],
  recommendations: [                        // 智能建议
    {
      type: 'split',
      description: '将 4 串分割为多个 2-3 串组合...',
      suggestedSplits: [...]
    }
  ]
}
```

---

#### `generateFragilityRecommendations(matchGroup, pairAnalysis, criticalPairs)`
生成智能重组建议

```javascript
const recommendations = generateFragilityRecommendations(
  matchGroup,
  pairAnalysis,
  criticalPairs
)

// 返回示例：
[
  {
    type: 'exclude',
    description: '排除比赛 3（赔率 6.2），仅投注其他 3 场',
    excludedIndex: 2,
    newComboSize: 3,
    riskReduction: 'medium'
  },
  {
    type: 'split',
    description: '将 4 串分割为多个 2-3 串组合，降低灾难性失败风险',
    suggestedSplits: [
      { combo1: [0,1], combo2: [2,3] },
      { combo1: [0,2,3], combo2: [1,2] }
    ],
    riskReduction: 'high'
  }
]
```

## 🔄 典型工作流程

### 用例：评估并改进一个4串投注

```javascript
// 1. 定义新的投注组合
const newCombo = [
  { odds: 5.5 },    // 比赛A
  { odds: 2.0 },    // 比赛B
  { odds: 4.2 },    // 比赛C
  { odds: 1.8 }     // 比赛D
]

// 2. 获取历史学习数据（从数据库）
const historicalData = getHistoricalComboFailures()  // 你的数据来源

// 3. 评估整体脆弱性
const analysis = assessComboFragility(newCombo, historicalData)

console.log(`整体脆弱性: ${analysis.overallFragility}%`)
// 输出: 整体脆弱性: 38.42%

// 4. 检查关键脆弱对
if (analysis.criticalPairs.length > 0) {
  console.log('⚠️  发现关键脆弱对：')
  analysis.criticalPairs.forEach(cp => {
    const [i, j] = cp.pair
    console.log(`  - 比赛${i+1} × 比赛${j+1}: ${cp.assessment.fragilityScore}% 脆弱性`)
  })
}

// 5. 应用建议
console.log('\n💡 重组建议：')
analysis.recommendations.forEach(rec => {
  if (rec.type === 'split') {
    console.log(`${rec.description}`)
    console.log('建议组合：')
    rec.suggestedSplits.forEach((split, idx) => {
      console.log(`  方案${idx+1}: ${split.combo1.join('+')} 和 ${split.combo2.join('+')}`)
    })
  }
})
```

## 📈 数据格式规范

### 历史组合数据格式

```javascript
{
  // 比赛信息
  matches: [
    {
      odds: 3.5,                    // 赔率（必需）
      result: false,                // 结果：true(赢) / false(输)
      // 可选字段
      teamName: 'Team A',
      matchDate: '2026-02-28',
      league: 'Premier League'
    },
    // ... 更多比赛
  ],

  // 组合结果
  succeeded: false,                 // 整个组合是否成功

  // 时间戳
  createdAt: '2026-02-28T10:30:00Z',  // ISO格式时间戳

  // 可选的元数据
  inputs: 100,                      // 投入金额
  revenues: 0,                      // 收益
  investmentId: 'inv_123'           // 投资ID
}
```

## 🎓 统计学基础

### 为什么需要这些控制？

#### 1. 样本量问题
**问题**：如果只有3个样本，观察到的失败率可能完全是随机变异
**解决**：小样本数据获得低权重，大样本数据获得高权重

#### 2. 选择偏差
**问题**：用户倾向于选择他们认为会赢的比赛，导致历史失败率被扭曲
**解决**：使用市场定价（赔率）作为客观的失败率估计，而不是历史频率

#### 3. 幸存者偏差
**问题**：某对组合被频繁投资可能是因为它们看起来更吸引人（无关紧要的相关性），或者反之亦然
**解决**：与特征相似但不同的组合进行对比，检查是否存在不合理的选择偏好

#### 4. 时间效应
**问题**：旧数据可能来自不同的市场环境或更差的决策能力
**解决**：给最近的数据更高的权重

#### 5. 多重比较问题
**问题**：如果你做很多次统计检验，即使没有真实效应，也可能看到虚假的显著性
**解决**：使用更严格的阈值（p < 0.03 而不是 p < 0.05）

#### 6. 基准率
**问题**：全局失败率可能会压倒真实的依赖信号
**解决**：保守地应用基准率调整（只调整20%），不让它压倒核心依赖发现

## 🚀 集成建议

### 前端集成点

1. **投注构建界面**（ParamsPage或投注编辑器）
   ```jsx
   // 当用户构建组合时，显示脆弱性指示器
   <FragilityIndicator
     matches={selectedMatches}
     historicalData={historicalComboData}
     onRecommendation={handleRecommendation}
   />
   ```

2. **风险仪表板**
   ```jsx
   // 在主仪表板中显示脆弱组合预警
   <RiskyComboAlert
     combo={combo}
     fragilityScore={score}
     recommendations={recommendations}
   />
   ```

3. **历史回顾**（时光穿越机）
   ```jsx
   // 在快照中标记脆弱对
   <SnapshotAnalysis
     snapshot={snapshot}
     fragility={assessComboFragility(...)}
   />
   ```

### 后端集成点

1. **定期分析更新**
   ```javascript
   // 每天/每周重新计算脆弱性分数
   const allCombos = getInvestments()
   allCombos.forEach(combo => {
     const fragility = assessComboFragility(
       combo.matches,
       getHistoricalData()
     )
     saveFragilityScore(combo.id, fragility)
   })
   ```

2. **API端点**
   ```javascript
   // GET /api/combo/:id/fragility
   // 返回组合的脆弱性分析

   // POST /api/combo/analyze-new
   // 评估新提议的组合
   ```

## ⚠️ 限制与注意事项

1. **数据质量依赖**
   - 系统的准确性完全依赖于历史数据的质量和完整性
   - 需要足够的历史样本（建议 > 30个组合）

2. **因果关系 ≠ 相关性**
   - 高脆弱性分数表示统计相关性，不必然意味着因果关系
   - 可能存在未观察到的混淆变量

3. **市场变化**
   - 旧数据可能不适用于当前市场条件
   - 时间权重调整有限，可能需要定期重新校准

4. **小概率尾部事件**
   - 对于极端赔率的比赛（< 1.05 或 > 100），误差可能更大
   - 建议对这类比赛进行人工审查

## 📝 版本历史

- **v1.0.0** (2026-03-02)
  - 初始实现：6重统计控制
  - 核心函数：依赖溢价、脆弱性评分、组合分析
  - 建议生成系统

## 📞 技术支持

如有问题，请检查：
1. 历史数据格式是否符合规范
2. 赔率数据是否有效（> 1.0）
3. 样本量是否足够（建议 > 10）
4. 时间戳是否为ISO格式

---

**系统设计目标**：在不过度干预用户决策的前提下，提供数据驱动的风险洞察，帮助用户更聪慧地结构化他们的投注组合。
