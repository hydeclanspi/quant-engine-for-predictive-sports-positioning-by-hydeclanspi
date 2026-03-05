/**
 * 依赖风险分析系统 - 单元测试
 * Tests for Dependency Risk Premium Analysis System
 *
 * 验证所有6重统计控制的正确实现
 */

import {
  getMarketImpliedFailureRate,
  getConfidenceWeight,
  getTemporalWeight,
  getWeightedObservedFailure,
  calculateDependencyPremium,
  calculateBinomialPValue,
  checkSurvivingBias,
  adjustForBaseRate,
  assessFragilityScore,
  assessComboFragility,
  generateFragilityRecommendations,
} from '../analytics'

describe('Dependency Risk Premium Analysis', () => {
  // ==========================================================================
  // 测试1：市场隐含失败率
  // ==========================================================================

  describe('getMarketImpliedFailureRate', () => {
    it('应该从赔率计算隐含失败率 (1/odds)', () => {
      expect(getMarketImpliedFailureRate(2.0)).toBeCloseTo(0.5, 2)
      expect(getMarketImpliedFailureRate(3.5)).toBeCloseTo(0.286, 2)
      expect(getMarketImpliedFailureRate(1.5)).toBeCloseTo(0.667, 2)
    })

    it('应该处理边界情况', () => {
      expect(getMarketImpliedFailureRate(1.01)).toBeGreaterThan(0.97)
      expect(getMarketImpliedFailureRate(100)).toBeLessThan(0.02)
    })

    it('应该返回NaN对于无效赔率', () => {
      expect(isNaN(getMarketImpliedFailureRate(0.5))).toBe(true)
      expect(isNaN(getMarketImpliedFailureRate(-1))).toBe(true)
      expect(isNaN(getMarketImpliedFailureRate('invalid'))).toBe(true)
    })
  })

  // ==========================================================================
  // 测试2：样本量信心权重
  // ==========================================================================

  describe('getConfidenceWeight', () => {
    it('应该根据样本量返回正确的权重', () => {
      expect(getConfidenceWeight(3)).toBe(0.1)
      expect(getConfidenceWeight(8)).toBe(0.3)
      expect(getConfidenceWeight(15)).toBe(0.6)
      expect(getConfidenceWeight(25)).toBe(0.85)
      expect(getConfidenceWeight(50)).toBe(1.0)
    })

    it('应该处理边界值', () => {
      expect(getConfidenceWeight(0)).toBe(0.1)
      expect(getConfidenceWeight(5)).toBe(0.1) // < 5
      expect(getConfidenceWeight(10)).toBe(0.3) // >= 10
    })

    it('应该处理非数字输入', () => {
      expect(getConfidenceWeight('abc')).toBe(0.1)
      expect(getConfidenceWeight(null)).toBe(0.1)
    })
  })

  // ==========================================================================
  // 测试3：时间权重
  // ==========================================================================

  describe('getTemporalWeight', () => {
    it('应该给最近60天的数据返回1.15倍权重', () => {
      const today = new Date()
      const recentDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) // 30天前

      expect(getTemporalWeight(recentDate, today)).toBe(1.15)
    })

    it('应该给60天前的数据返回1.0倍权重', () => {
      const today = new Date()
      const oldDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000) // 90天前

      expect(getTemporalWeight(oldDate, today)).toBe(1.0)
    })

    it('应该处理无效日期', () => {
      expect(getTemporalWeight('invalid')).toBe(1.0)
      expect(getTemporalWeight(null)).toBe(1.0)
    })

    it('边界：60天应该返回1.15', () => {
      const today = new Date()
      const boundaryDate = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)

      expect(getTemporalWeight(boundaryDate, today)).toBe(1.15)
    })

    it('边界：61天应该返回1.0', () => {
      const today = new Date()
      const justOldDate = new Date(today.getTime() - 61 * 24 * 60 * 60 * 1000)

      expect(getTemporalWeight(justOldDate, today)).toBe(1.0)
    })
  })

  // ==========================================================================
  // 测试4：加权观察失败统计
  // ==========================================================================

  describe('getWeightedObservedFailure', () => {
    it('只统计双边结果都已结算的pair，避免未结算样本污染分母', () => {
      const now = new Date().toISOString()
      const historicalData = [
        {
          matches: [
            { odds: 2.0, result: false },
            { odds: 2.0, result: false },
          ],
          createdAt: now,
        },
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: undefined },
          ],
          createdAt: now,
        },
      ]

      const observed = getWeightedObservedFailure(historicalData, 2.0, 2.0)
      expect(observed.rawPairCount).toBe(1)
      expect(observed.totalWeight).toBeGreaterThan(0)
      expect(observed.failedTogether).toBeCloseTo(observed.totalWeight, 6)
      expect(observed.partialMiss).toBeCloseTo(0, 6)
    })
  })

  // ==========================================================================
  // 测试4：依赖风险溢价计算
  // ==========================================================================

  describe('calculateDependencyPremium', () => {
    it('应该计算基础溢价', () => {
      const raceA = { odds: 2.0 }
      const raceB = { odds: 2.0 }
      const historicalData = [
        {
          matches: [
            { odds: 2.0, result: false },
            { odds: 2.0, result: false },
            { odds: 1.5, result: true },
          ],
          succeeded: false,
          createdAt: new Date().toISOString(),
        },
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: false },
            { odds: 1.5, result: true },
          ],
          succeeded: false,
          createdAt: new Date().toISOString(),
        },
      ]

      const result = calculateDependencyPremium(raceA, raceB, historicalData, 0, 1)

      expect(result.pFailA).toBeCloseTo(0.5, 2)
      expect(result.pFailB).toBeCloseTo(0.5, 2)
      expect(result.pFailBothIndependent).toBeCloseTo(0.25, 2)
      expect(result.pFailBothObserved).toBeCloseTo(0.5, 2) // 2个都失败了1次
      expect(result.premium).toBeCloseTo(0.25, 2) // 0.5 - 0.25
      expect(Number.isFinite(result.premium)).toBe(true)
    })

    it('应该返回NaN对于无效赔率', () => {
      const raceA = { odds: 'invalid' }
      const raceB = { odds: 2.0 }

      const result = calculateDependencyPremium(raceA, raceB, [])

      expect(isNaN(result.premium)).toBe(true)
    })

    it('应该处理空历史数据', () => {
      const raceA = { odds: 2.0 }
      const raceB = { odds: 2.0 }

      const result = calculateDependencyPremium(raceA, raceB, [])

      expect(Number.isFinite(result.premium)).toBe(true)
      expect(result.sampleSize).toBe(0)
      expect(result.pFailBothObserved).toBe(0)
    })

    it('应该包含所有必要的输出字段', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.5 }

      const result = calculateDependencyPremium(raceA, raceB, [])

      expect(result).toHaveProperty('premium')
      expect(result).toHaveProperty('pFailA')
      expect(result).toHaveProperty('pFailB')
      expect(result).toHaveProperty('pFailBothObserved')
      expect(result).toHaveProperty('pFailBothIndependent')
      expect(result).toHaveProperty('sampleSize')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('pValue')
      expect(result).toHaveProperty('isSignificant')
    })
  })

  // ==========================================================================
  // 测试5：p值计算
  // ==========================================================================

  describe('calculateBinomialPValue', () => {
    it('应该返回0-1之间的p值', () => {
      const pValue = calculateBinomialPValue(5, 10, 0.5)

      expect(pValue).toBeGreaterThanOrEqual(0)
      expect(pValue).toBeLessThanOrEqual(1)
    })

    it('应该在完全匹配预期时返回高p值', () => {
      // 观察到的正好是预期的
      const pValue = calculateBinomialPValue(5, 10, 0.5)

      expect(pValue).toBeGreaterThan(0.3)
    })

    it('应该在严重偏离预期时返回低p值', () => {
      // 观察到10次都失败，而预期只有50%
      const pValue = calculateBinomialPValue(10, 10, 0.05)

      expect(pValue).toBeLessThan(0.01)
    })
  })

  // ==========================================================================
  // 测试6：幸存者偏差匹配
  // ==========================================================================

  describe('checkSurvivingBias', () => {
    it('未结算pair不应计入matchedPairs', () => {
      const raceA = { odds: 2.0 }
      const raceB = { odds: 2.0 }
      const historicalData = [
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: undefined },
          ],
        },
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: true },
          ],
        },
      ]

      const result = checkSurvivingBias(raceA, raceB, historicalData)
      expect(result.matchedPairs).toBe(1)
      expect(result.exactWon).toBe(1)
    })
  })

  // ==========================================================================
  // 测试6：脆弱性评分
  // ==========================================================================

  describe('assessFragilityScore', () => {
    it('应该返回0-100之间的脆弱性分数', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.0 }

      const result = assessFragilityScore(raceA, raceB, [])

      expect(result.fragilityScore).toBeGreaterThanOrEqual(0)
      expect(result.fragilityScore).toBeLessThanOrEqual(100)
    })

    it('应该包含风险等级', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.0 }

      const result = assessFragilityScore(raceA, raceB, [])

      expect(['low', 'medium', 'high', 'critical', 'insufficient_data']).toContain(
        result.riskLevel,
      )
    })

    it('应该返回百分比格式的脆弱性', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.0 }

      const result = assessFragilityScore(raceA, raceB, [])

      expect(result.fragilityPercentage).toMatch(/%$/)
    })

    it('应该处理无效输入', () => {
      const result = assessFragilityScore(
        { odds: 'invalid' },
        { odds: 2.0 },
        [],
      )

      expect(result.riskLevel).toBe('insufficient_data')
    })
  })

  // ==========================================================================
  // 测试7：组合脆弱性
  // ==========================================================================

  describe('assessComboFragility', () => {
    it('应该分析完整4串组合', () => {
      const combo = [
        { odds: 1.5 },
        { odds: 3.1 },
        { odds: 5.4 },
        { odds: 6.2 },
      ]

      const result = assessComboFragility(combo, [])

      expect(result.comboSize).toBe(4)
      expect(result.overallFragility).toBeGreaterThanOrEqual(0)
      expect(result.overallFragility).toBeLessThanOrEqual(100)
      expect(Array.isArray(result.pairAnalysis)).toBe(true)
      expect(Array.isArray(result.criticalPairs)).toBe(true)
      expect(Array.isArray(result.recommendations)).toBe(true)
    })

    it('应该识别所有比赛对', () => {
      const combo = [
        { odds: 1.5 },
        { odds: 3.1 },
        { odds: 5.4 },
        { odds: 6.2 },
      ]

      const result = assessComboFragility(combo, [])

      // 4个比赛的组合应该有 C(4,2) = 6 对
      expect(result.pairAnalysis.length).toBe(6)
    })

    it('应该处理小于2个比赛的情况', () => {
      const combo = [{ odds: 1.5 }]

      const result = assessComboFragility(combo, [])

      expect(isNaN(result.overallFragility)).toBe(true)
      expect(result.comboSize).toBe(0)
    })
  })

  // ==========================================================================
  // 测试8：基准率调整
  // ==========================================================================

  describe('adjustForBaseRate', () => {
    it('应该对正溢价应用保守系数0.8', () => {
      const premium = 0.1
      const result = adjustForBaseRate(premium, [], 0.2)

      expect(result.adjustedPremium).toBeCloseTo(0.08, 2)
    })

    it('应该对负溢价应用保守系数1.2', () => {
      const premium = -0.1
      const result = adjustForBaseRate(premium, [], 0.2)

      expect(result.adjustedPremium).toBeCloseTo(-0.12, 2)
    })

    it('应该计算全局失败率', () => {
      const historicalData = [
        { succeeded: true, matches: [] },
        { succeeded: false, matches: [] },
        { succeeded: false, matches: [] },
      ]

      const result = adjustForBaseRate(0.05, historicalData, 0.2)

      expect(result.globalFailureRate).toBeCloseTo(0.667, 2)
    })
  })

  // ==========================================================================
  // 集成测试
  // ==========================================================================

  describe('完整工作流程', () => {
    it('应该能够评估真实场景的组合脆弱性', () => {
      // 模拟10个历史组合
      const historicalData = Array.from({ length: 10 }, (_, i) => ({
        matches: [
          { odds: 3.5, result: Math.random() > 0.3 },
          { odds: 2.1, result: Math.random() > 0.4 },
          { odds: 4.8, result: Math.random() > 0.2 },
          { odds: 1.7, result: Math.random() > 0.5 },
        ],
        succeeded: Math.random() > 0.6,
        createdAt: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString(),
      }))

      const newCombo = [
        { odds: 5.5 },
        { odds: 2.0 },
        { odds: 4.2 },
        { odds: 1.8 },
      ]

      const result = assessComboFragility(newCombo, historicalData)

      expect(result.comboSize).toBe(4)
      expect(result.overallFragility).toBeGreaterThanOrEqual(0)
      expect(result.overallFragility).toBeLessThanOrEqual(100)
      expect(result.pairAnalysis.length).toBe(6)

      // 应该有建议
      if (result.criticalPairs.length > 0) {
        expect(result.recommendations.length).toBeGreaterThan(0)
      }
    })

    it('应该输出脆弱性分数格式 "XX.XX%"', () => {
      const result = assessComboFragility(
        [
          { odds: 1.5 },
          { odds: 3.1 },
          { odds: 5.4 },
          { odds: 6.2 },
        ],
        [],
      )

      // 检查两个小数点的格式
      const scoreStr = result.overallFragility.toString()
      expect(scoreStr).toMatch(/^\d+(\.\d{1,2})?$/)
    })
  })
})
