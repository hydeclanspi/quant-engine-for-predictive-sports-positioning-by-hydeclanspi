import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Coins, ChevronLeft, ChevronRight, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react'
import { getDashboardSnapshot } from '../lib/analytics'

const PAGE_SIZE = 12

const toRmb = (value) => `¥${Number(value || 0).toFixed(0)}`
const toPercent = (value, digits = 1) => `${Number(value || 0).toFixed(digits)}%`
const toSigned = (value, digits = 0) => {
  const num = Number(value || 0)
  return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}`
}

const CHIP_TONES = {
  stone: 'border-stone-200 bg-stone-50 text-stone-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

function FlowChip({ label, value, tone = 'stone' }) {
  return (
    <div className={`flex-1 rounded-xl border px-2 py-2 text-center ${CHIP_TONES[tone]}`}>
      <p className="text-[10px] font-medium opacity-70">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  )
}

export default function BalanceLedgerPanel({ periodKey = '2w', onConfirmSettle }) {
  const [tick, setTick] = useState(0)
  const [page, setPage] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [allocInput, setAllocInput] = useState('')

  // 自刷新：结算 / 撤销 / 注资都会写入 systemConfig 并派发 dugou:data-changed。
  // 由于本面板是 Modal 的静态内容节点（props 不会再被父级更新），自身监听事件来重算 snapshot。
  useEffect(() => {
    const handler = () => setTick((t) => t + 1)
    window.addEventListener('dugou:data-changed', handler)
    return () => window.removeEventListener('dugou:data-changed', handler)
  }, [])

  // tick 是手动刷新触发器（data-changed 事件后递增），故意作为依赖。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => getDashboardSnapshot(periodKey), [periodKey, tick])
  const poolBalance = snapshot.poolBalance
  const roiPeriod = snapshot.roiPeriod
  const cycleProfit = snapshot.cycleProfit ?? 0
  const cycleBaseCapital = snapshot.cycleBaseCapital ?? 0
  const ledger = snapshot.balanceLedger || []

  const settleType = cycleProfit >= 0 ? 'take_profit' : 'stop_loss'
  const isProfit = settleType === 'take_profit'

  // 数据变化后行数可能改变，回到第一页避免越界
  useEffect(() => {
    setPage(0)
  }, [tick, periodKey])

  const totalPages = Math.max(1, Math.ceil(ledger.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const pageRows = ledger.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const allocation = Math.max(0, Number(allocInput) || 0)

  const handleConfirm = () => {
    onConfirmSettle?.({
      type: settleType,
      realizedProfit: cycleProfit,
      poolBefore: poolBalance,
      cycleBase: cycleBaseCapital,
      newCapital: allocation,
    })
    setConfirming(false)
    setAllocInput('')
  }

  return (
    <div className="motion-v2-scope space-y-4">
      {/* 头部：当前余额 + 近期ROI（左） | 周期结算（右） */}
      <div className="flex items-stretch justify-between gap-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 via-amber-50/70 to-white p-4 shadow-sm">
        <div className="flex items-center gap-5">
          <div>
            <span className="text-xs font-medium text-amber-700/80">当前余额</span>
            <p className="text-2xl font-bold tabular-nums text-amber-600">{toRmb(poolBalance)}</p>
          </div>
          <div className="h-10 w-px bg-amber-200/70" />
          <div>
            <span className="text-xs font-medium text-stone-400">近期 ROI</span>
            <p className={`text-lg font-semibold tabular-nums ${roiPeriod >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {toPercent(roiPeriod)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="motion-v2-ghost-btn group inline-flex items-center gap-2 self-center rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-amber-100 px-4 py-2.5 text-sm font-semibold text-amber-800 shadow-sm transition hover:from-amber-100 hover:to-amber-200"
        >
          <Coins size={16} className="transition-transform group-hover:-rotate-12" />
          周期结算
        </button>
      </div>

      {/* 明细表 */}
      <div className="overflow-hidden rounded-2xl border border-stone-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50/60 text-left text-stone-500">
              <th className="px-3 py-2 font-medium">日期</th>
              <th className="px-3 py-2 font-medium">比赛</th>
              <th className="px-3 py-2 font-medium">操作前余额</th>
              <th className="px-3 py-2 font-medium">盈亏</th>
              <th className="px-3 py-2 font-medium">操作后余额</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              if (row.isSettlement) {
                const isStopLoss = row.settlementType === 'stop_loss'
                const settleAmount = Math.round(Number(row.before) || 0)
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-stone-100 transition-colors ${isStopLoss ? 'bg-rose-50/70' : 'bg-emerald-50/70'}`}
                  >
                    <td className="px-3 py-2.5 text-stone-400">{row.dateLabel}</td>
                    <td className="px-3 py-2.5 font-medium">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold ${
                          isStopLoss ? 'bg-rose-200/80 text-rose-900' : 'bg-emerald-200/80 text-emerald-900'
                        }`}
                      >
                        {isStopLoss ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                        {row.match} {settleAmount} rmb
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-stone-500">{toRmb(row.before)}</td>
                    <td className={`px-3 py-2.5 font-semibold tabular-nums ${row.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {toSigned(row.profit)}
                    </td>
                    <td className="px-3 py-2.5 font-semibold tabular-nums text-stone-600">{toRmb(row.after)}</td>
                  </tr>
                )
              }
              return (
                <tr
                  key={row.id}
                  className={`border-b border-stone-100 transition-colors ${row.isInjection ? 'bg-yellow-50/90' : 'hover:bg-stone-50/60'}`}
                >
                  <td className="px-3 py-2.5 text-stone-400">{row.dateLabel}</td>
                  <td className={`px-3 py-2.5 ${row.isInjection ? 'font-medium text-amber-900' : 'text-stone-700'}`}>
                    {row.isInjection ? (
                      <span className="inline-block rounded-sm bg-yellow-300/85 px-2 py-0.5 font-semibold text-amber-900">{row.match}</span>
                    ) : (
                      row.match
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-stone-500">{toRmb(row.before)}</td>
                  <td
                    className={`px-3 py-2.5 font-medium tabular-nums ${
                      row.isInjection ? 'text-amber-700' : row.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'
                    }`}
                  >
                    {row.isInjection ? `+${row.profit.toFixed(0)}` : toSigned(row.profit)}
                  </td>
                  <td className="px-3 py-2.5 font-semibold tabular-nums text-stone-700">{toRmb(row.after)}</td>
                </tr>
              )
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-stone-400">
                  暂无记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {ledger.length > 0 && (
        <div className="flex items-center justify-between px-1 text-xs text-stone-400">
          <span>
            共 {ledger.length} 条 · 第 {safePage + 1}/{totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* 结算确认窗口（portal 到 body，避免被 Modal 的 overflow / z-index 裁剪） */}
      {confirming &&
        createPortal(
          <div
            className="theme-modern fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(15,23,42,0.32)] p-4 backdrop-blur-[8px] backdrop-saturate-[1.4] animate-fade-in"
            onClick={() => setConfirming(false)}
          >
            <div
              className="motion-v2-scope w-full max-w-md overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-500">Cycle Settlement</span>
                <h3 className="mt-1 text-xl font-bold text-stone-800">周期性结算</h3>
                <p className="mt-1 text-xs leading-relaxed text-stone-400">
                  清零当前蓄水池、开启新周期。历史战绩与所有指标计算均不受影响。
                </p>
              </div>

              {/* 止盈 / 止损 裁决 */}
              <div
                className={`mx-6 mt-4 flex items-center gap-3 rounded-2xl border p-4 ${
                  isProfit ? 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white' : 'border-rose-100 bg-gradient-to-br from-rose-50 to-white'
                }`}
              >
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    isProfit ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500'
                  }`}
                >
                  {isProfit ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-stone-400">本周期{isProfit ? '止盈' : '止亏'}</p>
                  <p className={`text-2xl font-bold tabular-nums ${isProfit ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {toSigned(cycleProfit)}
                    <span className="ml-1 text-sm font-medium text-stone-400">rmb</span>
                  </p>
                </div>
              </div>

              {/* 资金流转 */}
              <div className="mx-6 mt-4 flex items-center justify-between gap-2">
                <FlowChip label="当前" value={toRmb(poolBalance)} tone="stone" />
                <ArrowRight size={14} className="shrink-0 text-stone-300" />
                <FlowChip label="结算清零" value="¥0" tone="amber" />
                <ArrowRight size={14} className="shrink-0 text-stone-300" />
                <FlowChip label="新周期" value={allocation > 0 ? toRmb(allocation) : '¥0'} tone="emerald" />
              </div>

              {/* 新周期启动资金（可留空 = 仅清零，稍后用 +注资 划拨） */}
              <div className="mx-6 mt-5">
                <div className="flex items-center justify-between text-xs font-medium text-stone-500">
                  <span>新周期启动资金</span>
                  <span className="text-stone-300">可留空 · 稍后用 +注资 划拨</span>
                </div>
                <div className="mt-1.5 flex items-center rounded-xl border border-stone-200 bg-stone-50/50 px-3 transition focus-within:border-emerald-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100">
                  <span className="text-stone-400">¥</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={allocInput}
                    onChange={(e) => setAllocInput(e.target.value)}
                    placeholder="0"
                    className="w-full bg-transparent px-2 py-2.5 text-sm text-stone-800 outline-none focus-visible:!outline-none placeholder:text-stone-300"
                  />
                </div>
              </div>

              {/* 操作 */}
              <div className="mt-5 flex gap-3 border-t border-stone-100 bg-stone-50/40 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="flex-1 rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-medium text-stone-500 transition hover:bg-stone-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className={`motion-v2-ghost-btn flex-[1.4] rounded-xl py-2.5 text-sm font-semibold text-white shadow-md transition ${
                    isProfit
                      ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700'
                      : 'bg-gradient-to-b from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700'
                  }`}
                >
                  确认结算{isProfit ? '止盈' : '止损'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
