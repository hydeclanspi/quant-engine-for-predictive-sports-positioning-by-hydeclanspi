# 依赖风险分析系统 - 快速开始指南

## ⚡ 5分钟快速理解

### 问题
"为什么我的4串投注经常因为其中1场失败而全部失败？"
→ **我需要识别哪些比赛对风险最高**

### 解决方案
```
算法学习历史失败组合
→ 识别高风险依赖关系
→ 为新组合评分
→ 提供重组建议
```

### 核心输出
**脆弱性评分**：0-100%
- 0-25%：✅ 安全
- 25-40%：⚠️ 注意
- 40-60%：⛔ 风险
- 60-100%：🚨 危险

---

## 🎯 最常用的3个函数

### 1️⃣ 评估单个比赛对
```javascript
import { assessFragilityScore } from './src/lib/analytics'

const result = assessFragilityScore(
  { odds: 5.5 },      // 比赛A
  { odds: 2.0 },      // 比赛B
  historicalData      // 历史数据
)

console.log(result.fragilityPercentage)  // "42.37%"
console.log(result.riskLevel)            // "high"
```

### 2️⃣ 评估完整组合（如4串）
```javascript
import { assessComboFragility } from './src/lib/analytics'

const analysis = assessComboFragility(
  [
    { odds: 1.5 },
    { odds: 3.1 },
    { odds: 5.4 },
    { odds: 6.2 }
  ],
  historicalData
)

console.log(analysis.overallFragility)   // 38.42（整体脆弱性）
console.log(analysis.criticalPairs)      // 脆弱性>40%的对
console.log(analysis.recommendations)    // 重组建议
```

### 3️⃣ 市场隐含失败率
```javascript
import { getMarketImpliedFailureRate } from './src/lib/analytics'

const failRate = getMarketImpliedFailureRate(3.5)
// 返回: 0.286 (28.6% 的失败概率)
```

---

## 📊 完整使用示例

### 场景：用户即将构建4串投注，想知道风险

```javascript
// 1. 获取历史数据（从数据库）
const investments = getInvestments()
const historicalData = investments
  .filter(inv => inv.status === 'settled')
  .map(inv => ({
    matches: inv.matches.map(m => ({
      odds: m.odds,
      result: m.status === 'won'
    })),
    succeeded: inv.status === 'won',
    createdAt: inv.createdAt
  }))

// 2. 用户选择了4场比赛
const selectedMatches = [
  { odds: 5.5 },
  { odds: 2.0 },
  { odds: 4.2 },
  { odds: 1.8 }
]

// 3. 评估脆弱性
import { assessComboFragility } from './src/lib/analytics'

const analysis = assessComboFragility(selectedMatches, historicalData)

// 4. 展示结果
if (analysis.overallFragility > 50) {
  showWarning(`⚠️ 这个4串组合的风险较高 (${analysis.overallFragility}%)`)

  // 显示关键脆弱对
  analysis.criticalPairs.forEach(pair => {
    const [i, j] = pair.pair
    showAlert(`比赛${i+1} × 比赛${j+1}: ${pair.assessment.fragilityPercentage}`)
  })

  // 显示建议
  analysis.recommendations.forEach(rec => {
    showSuggestion(rec.description)
  })
}
```

---

## 🔧 集成到前端组件

### 示例：在投注编辑器中集成脆弱性指示器

```jsx
// ComboBuilder.jsx
import { assessComboFragility } from '@/lib/analytics'

export function ComboBuilder() {
  const [matches, setMatches] = useState([])
  const [fragility, setFragility] = useState(null)

  // 每当选择的比赛变化时，重新计算脆弱性
  useEffect(() => {
    if (matches.length >= 2) {
      const historicalData = getHistoricalComboData()
      const analysis = assessComboFragility(matches, historicalData)
      setFragility(analysis)
    }
  }, [matches])

  return (
    <div>
      {/* 比赛选择器 */}
      <MatchSelector onChange={setMatches} />

      {/* 脆弱性指示器 */}
      {fragility && (
        <FragilityPanel
          score={fragility.overallFragility}
          riskLevel={fragility.pairAnalysis[0]?.assessment.riskLevel}
          criticalPairs={fragility.criticalPairs}
          recommendations={fragility.recommendations}
          onApplyRecommendation={(newCombo) => setMatches(newCombo)}
        />
      )}

      {/* 确认按钮 */}
      <button
        onClick={() => submitCombo(matches)}
        disabled={fragility?.overallFragility > 70}
      >
        提交投注
      </button>
    </div>
  )
}
```

---

## 📚 6重统计控制一览表

| 问题 | 原因 | 解决方案 | 实现位置 |
|------|------|--------|--------|
| 样本量小不可信 | 3个样本是随机还是真实模式？| 权重缩放：<5→0.1, ≥30→1.0 | `getConfidenceWeight()` |
| 历史失败率被扭曲 | 用户倾向投资他们认为会赢的 | 用市场隐含失败率(1/odds) | `getMarketImpliedFailureRate()` |
| 幸存者偏差 | 热门组合可能被过度选择 | 与相似对比较(如4.6+1.7 vs 4.4+1.8) | `checkSurvivingBias()` |
| 旧数据过时 | 市场环境已改变 | 最近2月数据×1.15倍 | `getTemporalWeight()` |
| 虚假显著性 | 做多个测试时易出现虚假阳性 | p值阈值<0.03(vs标准0.05) | `calculateBinomialPValue()` |
| 基准率压倒信号 | 全局失败率会掩盖真实依赖 | 保守调整：只调20% | `adjustForBaseRate()` |

---

## 🎓 关键概念速查

### 依赖风险溢价（Premium）
```
Premium = P(A失败 AND B失败)实际 - P(A失败 AND B失败)如果独立

例如：
实际：两个都失败的次数占总次数的30%
独立假设：应该是 28.6% × 55.6% = 15.9%
溢价 = 30% - 15.9% = 14.1%（正向依赖）
```

**解释**：这两场比赛失败的关联性比随机预期高14.1%

### 脆弱性评分
```
理解：0% = 完全安全，100% = 极度危险

计算：
FragilityScore = [(AdjustedPremium + 0.5) / 1.0] × 100

例如：
如果AdjustedPremium = 0.168
FragilityScore = [(0.168 + 0.5) / 1.0] × 100 = 66.8%（危险）
```

### 置信度（Confidence）
```
含义：这个评分可信度有多高（基于样本量）

示例：
- Confidence = 0.1  →  基于5个样本，信任度只有10%
- Confidence = 0.6  →  基于15个样本，信任度60%
- Confidence = 1.0  →  基于30+个样本，充分信任
```

---

## ⚠️ 常见错误与解决

### ❌ 错误1：赔率为0.8
```javascript
const result = assessFragilityScore({ odds: 0.8 }, ...)
// 结果：NaN（无效输入）
// 原因：赔率必须 > 1.0
// 修复：检查数据质量
```

### ❌ 错误2：样本数太少
```javascript
const analysis = assessComboFragility(combo, [])  // 0个历史样本
// 结果：riskLevel = "insufficient_data"
// 原因：无法从空历史数据学习
// 修复：收集更多历史投注数据（建议 > 10个）
```

### ❌ 错误3：时间戳格式错误
```javascript
historicalData = [{
  createdAt: '2026/03/02'  // ❌ 错误格式
}]
// 修复：使用ISO格式
historicalData = [{
  createdAt: '2026-03-02T10:30:00Z'  // ✅ 正确
}]
```

---

## 🚀 性能优化提示

### 1. 缓存历史数据
```javascript
// ❌ 不要每次都读取
const analysis = assessComboFragility(
  combo,
  getInvestments().map(...)  // 每次都遍历全部
)

// ✅ 缓存历史数据
const historicalDataCache = extractHistoricalComboData()
const analysis = assessComboFragility(combo, historicalDataCache)
```

### 2. 定期更新缓存
```javascript
// 在应用启动时，或每天更新一次
setInterval(() => {
  window.fragilityCacheData = extractHistoricalComboData()
}, 24 * 60 * 60 * 1000)  // 24小时
```

### 3. 避免重复计算
```javascript
// ❌ 当用户改变比赛顺序时不需要重新计算
const fragility1 = assessComboFragility([A, B, C, D], data)
const fragility2 = assessComboFragility([A, C, B, D], data)  // 完全相同

// ✅ 缓存相同输入的结果
const memoized = useMemo(
  () => assessComboFragility(matches, historicalData),
  [matches, historicalData]
)
```

---

## 📖 详细文档位置

| 需要... | 查看文件 | 位置 |
|--------|--------|------|
| **完整API参考** | `DEPENDENCY_RISK_ANALYSIS_SYSTEM.md` | 项目根目录 |
| **实现路线图** | `IMPLEMENTATION_ROADMAP.md` | 项目根目录 |
| **项目总结** | `PROJECT_COMPLETION_SUMMARY.md` | 项目根目录 |
| **源代码** | `src/lib/analytics.js` | 核心函数定义 |
| **单元测试** | `src/lib/__tests__/dependencyRisk.test.js` | 测试示例 |
| **代码注释** | 源文件中的JSDoc | 每个函数头部 |

---

## 💬 常见问题

### Q: 为什么我的组合脆弱性是50%，但历史上这样的组合成功了？
**A**: 脆弱性是基于统计模式，不是保证。50%意味着这类组合的失败风险约为50%，但单个案例可能成功。这就是为什么我们看数据而不是单个结果。

### Q: 可以完全信任这个系统的建议吗？
**A**: 不能。系统提供的是数据驱动的洞察，但：
- 历史可能不代表未来
- 个别比赛可能有特殊因素
- 最终决定权在用户手上

### Q: 如果没有历史数据怎么办？
**A**: 系统会检测到样本不足，标记为"insufficient_data"。建议：
1. 先积累至少10-30个结果完成的投注
2. 定期更新缓存
3. 3个月后数据会充分可靠

### Q: 脆弱性分数会实时更新吗？
**A**: 目前不会。分数基于历史数据，历史数据通常：
- 每天更新一次（新投注完成）
- 或每周更新一次（定期维护）
- 实时更新需要复杂的流式计算，暂未实现

---

## 🎯 下一步

1. **了解**：阅读本文档（5分钟）
2. **学习**：查看详细文档 `DEPENDENCY_RISK_ANALYSIS_SYSTEM.md`（20分钟）
3. **测试**：运行单元测试看实际例子（10分钟）
4. **集成**：按照 `IMPLEMENTATION_ROADMAP.md` 开始Phase 2（待排期）

---

**版本**：1.0.0
**最后更新**：2026-03-02
**状态**：✅ 生产就绪

