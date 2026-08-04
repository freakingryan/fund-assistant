# 均线研判（MA Judgment）功能规划

> 目标：为「场内 ETF / 个股」详情页提供基于代表性 X 日线的买卖研判——站稳 X 日线建议加仓/入场，跌破 X 日线建议止盈/减仓/清仓。

## 决策口径（已与用户确认）

| 项            | 决策                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| 均线集合      | **20 / 60 / 120 / 250 日线**（月/季/半年/年线，短中长三档）                                                        |
| 站稳/跌破定义 | **连续 N=3 日确认**：收盘价连续 3 日 ≥ MA = 站稳；连续 3 日 ≤ MA = 跌破；未达 3 日但方向明确 = 未确认；缠绕 = 中性 |
| 展示位置      | 详情页（StockDetailPage）新增独立「均线研判」面板                                                                  |
| 数据来源      | 面板自带拉取 1y 日线（约 250 根），不受图表周期影响（图表默认 3m 仅 66 根，不够算 250 日线）                       |

## 建议映射（每档均线）

- 20日线（短）：站稳→短线向好，逢回踩加仓/入场；跌破→短线转弱，止盈减仓
- 60日线（中）：站稳→中线向上，持有为主；跌破→中线走弱，减仓避险
- 120日线（中长）：站稳→中期多头，趋势持仓；跌破→中期转空，警惕下行
- 250日线（长/牛熊分界）：站稳→长期牛市，长线持有；跌破→长期破位，考虑清仓

## 实现拆解

1. `src/services/maJudgment.ts`（纯函数，零网络）
   - `sma(closes, period)` 通用简单移动平均。
   - `judgeMaLines(klines, confirmDays=3)` → 逐线计算 MA、现价距离%、连续站上/跌破天数、状态、建议文案；汇总综合姿态（strong_bull/bull/neutral/bear/strong_bear）与一句摘要。
   - 导出 `MA_LINES`、`CONFIRM_DAYS`、类型 `MaJudgment` / `MaJudgmentResult`。

2. `src/components/holdings/MaJudgmentPanel.tsx`
   - Props: `{ code: string }`。
   - 自带 `getKlineCache/setKlineCache` + `dataSourceService.fetchStockKLine(code, "1y")`（key 隔离为 `maj_${code}`）。
   - 渲染：每线卡片（标签 / MA值 / 现价距MA% / 状态徽章 / 建议文案）；顶部综合姿态 + 摘要；底部连续3日确认规则说明。
   - 视觉对齐 `TechnicalIndicatorsPanel`（Card / Stat 风格、`text-up`/`text-down` 中国配色）。

3. `src/components/holdings/StockDetailPage.tsx`
   - 导入 `MaJudgmentPanel`，在 `DecisionAdvisorCard` 下方渲染（传入 `code`）。
   - 右侧「数据说明」补充一条均线研判说明。

## 验收标准

- [x] `judgeMaLines` 对典型序列（全站上 / 全跌破 / 缠绕 / 数据不足）输出正确状态与建议。
- [x] 面板在 ETF/个股详情页正确拉取 1y 日线并展示 4 条均线研判。
- [x] `eslint` 与 `vite build` 零报错（eslint: 0 error / 3 warning，warning 为既有 set-state-in-effect 风格，不阻断；vite build exit 0）。
- [x] 文档（plan 进度 + 必要处 README）同步更新。
- [x] 不自动 push（用户授权前）。

## 进度

- 2026-08-04 完成规划、服务层、面板、接线、验证。
  - 新增 `src/services/maJudgment.ts`（纯函数 `judgeMaLines` + `MA_LINES`/`CONFIRM_DAYS=3`）。
  - 新增 `src/components/holdings/MaJudgmentPanel.tsx`（自带 1y 日线拉取，key=`maj_${code}`）。
  - 修改 `src/components/holdings/StockDetailPage.tsx`（导入并渲染面板 + 数据说明补充）。
  - 验证：`eslint` 0 error、`vite build` 成功（dist/index.html 已生成）。
- 待办：用户授权后 `git commit`（本地，不 push）。

## 范围边界

- 仅研判展示，不自动发通知/下单（与「建议」文案一致）。
- 周线/月线聚合不在本次范围（当前全量数据均为日线）。

## 补充：基金详情页（FundDetailPage）接入

> 用户反馈：在路由 `/detail/:id`（基金详情页）看不到均线研判。原实现只接到了 `/stock/:code`（场内ETF/个股页），接错页面。

- 根因：`FundDetailPage`（`/detail/:id`）与 `StockDetailPage`（`/stock/:code`）是两个独立路由；面板原先只挂在后者。
- 修复：`MaJudgmentPanel` 升级为三源输入（优先级 `etfCode` > `code` > `navCode`）：
  - `etfCode`：基金关联的场内 ETF/指数代码（`ctrl.etfCode`，来自 OTC→ETF 映射），走 `fetchEtfKLine`（真实 K 线）。
  - `code`：个股/ETF 代码（`StockDetailPage`），走 `fetchStockKLine`（不变，零回归）。
  - `navCode`：基金净值代码（`fund.code`），走 `fetchKLine`（单位净值序列，均线只看收盘价），作为无 etfCode 基金的兜底。
- 缓存 key 按数据源隔离：`maj_etf_*` / `maj_stock_*` / `maj_nav_*`。
- 净值序列语境下，标题显示「净值均线研判」，现价列显示「净值」，规则说明注明「单位净值」。
- 接线：`FundDetailLayout.tsx` 在 `FundDecisionAdvisorCard` 下方整行渲染 `<MaJudgmentPanel etfCode={ctrl.etfCode ?? undefined} navCode={fund.code} />`。
- 验证（2026-08-04）：`eslint` 0 error / 1 warning（既有 set-state-in-effect 风格）；`vite build` exit 0。
