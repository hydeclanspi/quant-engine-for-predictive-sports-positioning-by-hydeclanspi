# DuGou Model Centre · 渡狗模型中心

> **A self-hosted quantitative decision-support system for football match modeling.**
> 一套自研的足球赛事量化分析与决策辅助系统 —— 从自然语言录入、组合构建、
> 凯利仓位、蒙特卡洛仿真到模型校准，端到端跑在浏览器里。

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38BDF8?logo=tailwindcss&logoColor=white)
![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)
![CI](https://img.shields.io/badge/CI-lint%20·%20test%20·%20build-2088FF?logo=githubactions&logoColor=white)

> ⚠️ **草稿 / Draft** —— 本 README 为初稿，内容与措辞仍在迭代中。

---

## 简介 · Overview

DuGou Model Centre 是一个**个人自研、长期迭代**的量化分析项目（已迭代至 v4.9，
`src/` 约 4 万行）。它把每一笔历史赛事数据当作样本，通过一套纯函数式的分析引擎
（`src/lib/analytics.js`，约 6.3k 行）转换成可决策的量化指标：命中率、ROI、
期望-实际偏差、凯利建议仓位、组合脆弱性评分、模型校准拟合度等。

整个系统**本地优先（local-first）**：数据默认存于浏览器，登录后可选地与 Supabase
云端同步；分析全部在前端完成，无需后端算力。

> 📌 本项目是作者用于学习量化建模与软件工程的**个人作品集项目**，不构成任何投资建议。

---

## 在线体验 · Live Demo

🔗 **[hydeclanspi.vercel.app](https://hydeclanspi.vercel.app)**

线上提供一个**公开演示模式（Preview Mode）**：

- **参数脱敏** —— 核心模型参数以希腊字母占位（变量 α / β / γ / δ、随机扰动 ε），
  既能完整展示交互与算法效果，又不泄露真实模型配置。
- **数据短暂（ephemeral）** —— 演示数据仅存在于内存 / sessionStorage，
  关闭标签页即清空，每次打开都是一致的初始状态。
- **行为一致** —— 演示模式与完整模式共用同一套计算管线，仅在展示层做遮罩，
  保证"所见即真实逻辑"。

---

## 核心功能 · Features

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 新建投资 | `/new` | 支持**自然语言一句话录入**，自动解析为结构化投注单 |
| 组合构建 | `/combo` | 串关组合、凯利建议仓位、组合脆弱性（依赖风险）评估 |
| 待结算 | `/settle` | 待兑付组合的批量结算与盈亏登记 |
| 数据看板 | `/dashboard` | 资金曲线、命中率、ROI 等核心 KPI |
| 深度分析 | `/dashboard/analysis` | 分模式 / 分盘口的多维度切片分析 |
| 指标中心 | `/dashboard/metrics` | 期望-实际偏差、校准、统计显著性检验 |
| 历史档案 | `/history` | 全量历史投资的检索与回溯 |
| 球队画像 | `/history/teams` | 按球队聚合的历史表现画像 |
| 参数标定 | `/params` | 模型参数标定、预测序贯回测、校准回归（R²） |

---

## 工程亮点 · Engineering Highlights

### 🧠 纯函数式分析引擎（`src/lib/analytics.js`）
所有派生指标由纯函数计算：输入历史数据，输出结构化结果，无副作用。
文件顶部有完整的**管线（Pipeline）Banner 注释**，自上而下分为五个阶段：
归一化 → 加权统计 → 凯利仓位 → 蒙特卡洛仿真 → 模型校验。

### ⚡ 三段式记忆化缓存（Memoization）
分析计算偏重 CPU，页面间又反复请求同一结果。缓存系统结合：
1. **修订号失效** —— 任意写操作触发 `revision++`，所有旧缓存键以 revision 为前缀
   自然作废；
2. **领域事件驱动** —— 监听 `dugou:data-changed` 事件，跨组件 / 跨标签页解耦失效；
3. **作用域分桶** —— 每个计算域（dashboard / kellyMatrix / calibration …）各自一个
   `Map`，互不污染。

### 🎲 可复现的蒙特卡洛仿真
`buildMonteCarloSeed → createSeededRng` 实现确定性的 mulberry32 RNG：同一份历史
数据每次都得到**完全一致**的随机序列，便于回归测试与方案对照。运行次数由
`resolveMonteCarloRuns` 在运算预算内按样本量动态决定。

### 📐 统计严谨性
- **分数凯利（Fractional Kelly）** 注码 + 风险上限夹逼；
- **依赖风险溢价 / 组合脆弱性评分** —— 二项检验 + 互补误差函数 `erfc`
  （Abramowitz–Stegun 近似），量化"多腿串关同时崩盘"的隐性风险；
- **预测序贯回测（prequential）** 与校准回归（拟合度 R²）评估模型可信度。

### 🗣️ 自然语言录入
`naturalInputParser.js` / `entryParsing.js` 把"曼城 win, 赔率 1.85, 大 2.5"这类
自由文本解析成结构化投注单，统一比分 / 半全场 / 让球 / 大小球 / 赛果等盘口语义。

### ✅ 测试与质量门禁
- **Vitest** 单元测试覆盖分析内核（凯利、蒙特卡洛种子、依赖风险、语义解析）；
- **ESLint 9 flat config**，规则取舍以"抓真 bug、放过纯风格"为原则；
- **GitHub Actions CI** 在每次推送 / PR 上执行 lint → test → build 三道门禁。

---

## 技术栈 · Tech Stack

| 层 | 选型 |
| --- | --- |
| 前端框架 | React 18 + Vite 5 |
| 样式 | Tailwind CSS 3 |
| 路由 | React Router 6 |
| 存储 | Local-first（localStorage）+ Supabase 云同步 |
| 数据导入导出 | SheetJS (`xlsx`) |
| 日期处理 | date-fns |
| 图标 | lucide-react |
| 测试 | Vitest（v8 coverage） |
| 代码规范 | ESLint 9（flat config） |
| CI | GitHub Actions |

---

## 项目结构 · Architecture

```
src/
├── App.jsx                 # 路由与全局布局
├── pages/                  # 9 个功能页面（见上方 Features 表）
├── components/             # 复用 UI：顶栏 / 侧栏 / 弹窗 / 图标 / 热力图卡片 …
├── lib/                    # 业务与算法内核
│   ├── analytics.js        # ⭐ 量化分析引擎（管线 + 记忆化缓存）
│   ├── atomicParlay.js     # 串关原子拆解
│   ├── naturalInputParser.js / entryParsing.js  # 自然语言 → 结构化
│   ├── demoData.js / previewStore.js            # 公开演示模式（脱敏 + 短暂）
│   ├── displayMode.js / labels.js               # 预览 / 完整模式的展示层遮罩
│   ├── cloudSync.js / localData.js              # 云同步 + 本地存储
│   ├── excel.js            # Excel 导入导出
│   ├── teamDatabase.js     # 球队信息库
│   └── __tests__/          # 单元测试
├── hooks/  utils/  styles/  data/
```

---

## 本地开发 · Getting Started

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:3000）
npm run dev

# 代码规范检查 / 自动修复
npm run lint
npm run lint:fix

# 单元测试
npm test                # 跑一次
npm run test:watch      # 监听模式
npm run test:coverage   # 覆盖率报告

# 生产构建 / 本地预览构建产物
npm run build
npm run preview
```

> 云同步功能需配置 Supabase 环境变量；不配置时系统以纯本地模式运行，功能不受影响。

---

## 路线图 · Roadmap（草稿）

- [ ] 页面级 `React.lazy` 路由懒加载，进一步压缩首屏体积
- [ ] 将超大页面组件（ParamsPage / ComboPage）拆分为子组件
- [ ] 提升单元测试覆盖率至核心 `lib/` 全覆盖
- [ ] 无障碍（a11y）：弹窗 focus-trap、role 标注

---

## 免责声明 · Disclaimer

本项目为作者个人用于学习**量化建模与前端工程**的作品集项目，所有分析输出仅供
技术演示与自我研究之用，**不构成任何形式的投资 / 博彩建议**。请理性看待，
切勿用于非法用途。
