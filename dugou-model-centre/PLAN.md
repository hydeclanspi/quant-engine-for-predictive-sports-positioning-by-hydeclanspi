# v4.9 补丁 — 组合级自学习闭环 + 死代码激活

## 总览
修复 2 个算法断点（死代码激活），新增 1 个组合级事后回溯学习模块。

---

## FIX A — 激活 autoApplyAdaptiveWeights 死代码
- **问题**: 函数实现完整但从未被调用，权重永远不会自动更新
- **方案**: 结算后自动触发——在 SettlePage `confirmSettlement` 完成后调用
- **文件**: `SettlePage.jsx` — import + 调用

## FIX B — getPerMatchEjrSnapshot 接入校准上下文
- **问题**: EJR诊断函数从未被调用
- **方案**: 接入 `getPredictionCalibrationContext` 返回值
- **文件**: `analytics.js`

## FIX C — 组合级事后回溯学习引擎 (核心新功能)
- **问题**: 无机制评估"推荐了什么 vs 应该推荐什么"
- **新增**: `buildComboRetrospective()` (~150行) in analytics.js
  - 读取 planHistory 快照 + 结算结果
  - 匹配每条推荐combo的实际命中情况
  - 计算层级命中率、反共识遗漏率、最优腿数分布、锚定场成败率
  - 输出学习信号反馈到 generateRecommendations
- **消费**: stratifiedSelect配额微调、surplusBonus缩放、anchorBonus调整
- **文件**: `analytics.js` + `ComboPage.jsx`
  - pushPlanHistory 增强快照字段
  - generateRecommendations 消费 retrospective 信号

## FIX D — 算法说明卡更新
- 在v4.9 section尾部追加描述
- **文件**: `ComboPage.jsx`

---

## 改动文件: analytics.js, ComboPage.jsx, SettlePage.jsx
