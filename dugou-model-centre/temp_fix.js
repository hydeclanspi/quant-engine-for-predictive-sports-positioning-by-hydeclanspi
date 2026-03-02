// 临时文件，用来提取正确的修复

// 这是需要替换的新代码
const historicalData = useMemo(() => {
  const investments = getInvestments()
  
  // 尝试多种方式识别已结算的投资
  // 支持：revenues > 0（有收益=已结算）、is_settled标记、status标记等
  const settledInvestments = investments
    .filter(inv => {
      // 检查是否有 revenues 字段（表示已结算）
      const hasRevenues = inv.revenues !== undefined && inv.revenues !== null && Number(inv.revenues) !== 0
      // 或者检查是否标记为 settled
      const isSettled = inv.is_settled === true || inv.status === 'settled' || inv.status === 'settled_win' || inv.status === 'settled_loss'
      // 或者检查是否有比赛结果
      const hasResults = Array.isArray(inv.matches) && inv.matches.some(m => m.result !== undefined && m.result !== null)
      
      return hasRevenues || isSettled || hasResults
    })
    .slice(0, 150) // 限制前150个已结算投资以保持性能
    .map(inv => {
      const matches = Array.isArray(inv.matches) ? inv.matches : []
      
      return {
        matches: matches.map(m => ({
          odds: Number(m.odds) || 1,
          // 比赛结果：result字段、status字段或revenues计算
          result: m.result === true || m.result === 'won' || m.status === 'won' || m.won === true,
        })),
        // 投注结果：检查 revenues > 0 或 status 字段
        succeeded: Number(inv.revenues || 0) > 0 || inv.status === 'settled_win' || inv.status === 'won',
        createdAt: inv.created_at || inv.createdAt || new Date().toISOString(),
      }
    })
    .filter(d => d.matches.length > 0)
  
  return settledInvestments
}, [])
