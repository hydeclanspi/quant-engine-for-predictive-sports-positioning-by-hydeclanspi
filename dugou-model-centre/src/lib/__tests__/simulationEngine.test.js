/**
 * 仿真引擎核心数值原语 - 单元测试
 * Tests for the Kelly staking, seeded RNG, and Monte-Carlo seeding primitives.
 *
 * 这些是回测 / 蒙特卡洛仿真的纯数学内核，通过 analytics.js 的
 * `__testables` 测试钩子做白盒验证，锁定数值回归。
 */

import { __testables } from '../analytics'

const {
  calcKellyStake,
  resolveMonteCarloRuns,
  createSeededRng,
  buildMonteCarloSeed,
  MONTE_CARLO_TARGET_RUNS,
  MONTE_CARLO_MIN_RUNS,
} = __testables

describe('仿真引擎核心原语', () => {
  // ==========================================================================
  // 凯利注码 calcKellyStake(expected, odds, divisor, config)
  // kelly = (expected·odds − 1) / (odds − 1)
  // ==========================================================================
  describe('calcKellyStake', () => {
    const config = { initialCapital: 1000, riskCapRatio: 1 }

    it('正期望优势返回 capital × 凯利分数', () => {
      // kelly = (0.6·2 − 1)/(2 − 1) = 0.2 → 1000 × 0.2 = 200
      expect(calcKellyStake(0.6, 2.0, 1, config)).toBeCloseTo(200, 6)
    })

    it('负期望优势（无优势）返回 0', () => {
      // kelly = (0.4·2 − 1)/1 = −0.2 → 0
      expect(calcKellyStake(0.4, 2.0, 1, config)).toBe(0)
    })

    it('期望恰好打平（kelly = 0）返回 0', () => {
      // kelly = (0.5·2 − 1)/1 = 0 → 0
      expect(calcKellyStake(0.5, 2.0, 1, config)).toBe(0)
    })

    it('分数凯利：divisor 按比例缩小注码', () => {
      // base = 1000 × (0.2 / 4) = 50
      expect(calcKellyStake(0.6, 2.0, 4, config)).toBeCloseTo(50, 6)
    })

    it('风险上限 riskCapRatio 会夹住注码', () => {
      // kelly = (0.9·2 − 1)/1 = 0.8 → base = 800，但 riskCap = 1000 × 0.05 = 50
      const cappedConfig = { initialCapital: 1000, riskCapRatio: 0.05 }
      expect(calcKellyStake(0.9, 2.0, 1, cappedConfig)).toBeCloseTo(50, 6)
    })

    it('divisor < 1 被夹到 1（不会放大注码）', () => {
      // Math.max(1, 0.5) = 1 → 与 divisor=1 同结果
      expect(calcKellyStake(0.6, 2.0, 0, config)).toBeCloseTo(200, 6)
    })

    it('注码永远非负', () => {
      expect(calcKellyStake(0.1, 1.2, 1, config)).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // 蒙特卡洛运行次数预算 resolveMonteCarloRuns(sampleCount, targetRuns)
  // ==========================================================================
  describe('resolveMonteCarloRuns', () => {
    it('小样本时夹到目标运行次数', () => {
      // n=10 → budgetCap=600000 ≥ 12000 → min(100000, 600000)=100000
      expect(resolveMonteCarloRuns(10)).toBe(MONTE_CARLO_TARGET_RUNS)
    })

    it('中等样本时按预算缩减但不低于最小运行数', () => {
      // n=100 → budgetCap=60000 ≥ 12000 → min(100000, 60000)=60000
      const runs = resolveMonteCarloRuns(100)
      expect(runs).toBe(60000)
      expect(runs).toBeGreaterThanOrEqual(MONTE_CARLO_MIN_RUNS)
    })

    it('大样本时退到硬地板 4000', () => {
      // n=10000 → budgetCap=600 < 12000 → 硬地板 4000
      expect(resolveMonteCarloRuns(10000)).toBe(4000)
    })

    it('结果始终落在 [4000, 目标值] 区间内', () => {
      for (const n of [1, 5, 50, 500, 5000, 50000]) {
        const runs = resolveMonteCarloRuns(n)
        expect(runs).toBeGreaterThanOrEqual(4000)
        expect(runs).toBeLessThanOrEqual(MONTE_CARLO_TARGET_RUNS)
      }
    })

    it('无效样本量回退为 n=1', () => {
      expect(resolveMonteCarloRuns(0)).toBe(MONTE_CARLO_TARGET_RUNS)
      expect(resolveMonteCarloRuns('abc')).toBe(MONTE_CARLO_TARGET_RUNS)
    })
  })

  // ==========================================================================
  // 可复现随机数发生器 createSeededRng(seed)
  // ==========================================================================
  describe('createSeededRng', () => {
    const take = (rng, count) => Array.from({ length: count }, () => rng())

    it('相同种子产生完全相同的序列（可复现）', () => {
      const a = take(createSeededRng(42), 8)
      const b = take(createSeededRng(42), 8)
      expect(a).toEqual(b)
    })

    it('默认种子也是确定性的', () => {
      const a = take(createSeededRng(), 5)
      const b = take(createSeededRng(), 5)
      expect(a).toEqual(b)
    })

    it('不同种子产生不同的序列', () => {
      const a = take(createSeededRng(1), 8)
      const b = take(createSeededRng(2), 8)
      expect(a).not.toEqual(b)
    })

    it('所有输出落在 [0, 1) 区间', () => {
      const values = take(createSeededRng(7), 500)
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
      }
    })

    it('序列在统计上不退化（均值接近 0.5）', () => {
      const values = take(createSeededRng(123), 5000)
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      expect(mean).toBeGreaterThan(0.45)
      expect(mean).toBeLessThan(0.55)
    })
  })

  // ==========================================================================
  // 蒙特卡洛种子哈希 buildMonteCarloSeed(rows, salt)
  // ==========================================================================
  describe('buildMonteCarloSeed', () => {
    const rows = [
      { expected: 0.6, odds: 2.1, unitReturn: 1.1 },
      { expected: 0.45, odds: 3.4, unitReturn: -1 },
      { expected: 0.7, odds: 1.8, unitReturn: 0.8 },
    ]

    it('相同输入与盐值产生相同种子', () => {
      expect(buildMonteCarloSeed(rows, 0)).toBe(buildMonteCarloSeed(rows, 0))
    })

    it('不同盐值产生不同种子', () => {
      expect(buildMonteCarloSeed(rows, 0)).not.toBe(buildMonteCarloSeed(rows, 1))
    })

    it('行内容改变会改变种子', () => {
      const mutated = [...rows.slice(0, 2), { expected: 0.71, odds: 1.8, unitReturn: 0.8 }]
      expect(buildMonteCarloSeed(rows, 0)).not.toBe(buildMonteCarloSeed(mutated, 0))
    })

    it('行数改变会改变种子', () => {
      expect(buildMonteCarloSeed(rows, 0)).not.toBe(buildMonteCarloSeed(rows.slice(0, 2), 0))
    })

    it('返回无符号 32 位整数', () => {
      const seed = buildMonteCarloSeed(rows, 0)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(0xffffffff)
    })
  })

  // ==========================================================================
  // 端到端可复现：相同数据 → 相同种子 → 相同 RNG 序列
  // ==========================================================================
  describe('端到端可复现性', () => {
    it('相同行经由 seed→RNG 管线得到一致的随机序列', () => {
      const rows = [
        { expected: 0.55, odds: 2.5, unitReturn: 1.5 },
        { expected: 0.62, odds: 1.9, unitReturn: 0.9 },
      ]
      const seedA = buildMonteCarloSeed(rows, 3)
      const seedB = buildMonteCarloSeed(rows, 3)
      const seqA = Array.from({ length: 10 }, () => createSeededRng(seedA)())
      const rngB = createSeededRng(seedB)
      const seqB = Array.from({ length: 10 }, () => rngB())
      // seedA === seedB，但 seqA 每次都 new 一个 RNG 取第一个值，故全相等
      expect(seedA).toBe(seedB)
      expect(seqA.every((v) => v === seqA[0])).toBe(true)
      expect(seqB[0]).toBe(seqA[0])
    })
  })
})
