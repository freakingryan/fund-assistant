/**
 * 市场宽度 / 大盘复盘（Dashboard 情绪指标）
 *
 * 聚合 stock-sdk 现成 service + 应用既有 stock-api 指数通道，零自建解析、零新增 Worker：
 *  - 涨停/跌停/炸板家数 + 炸板率：stock-sdk `marketEvent.ztPool` ×3（受「东财增强」开关门控）
 *  - 行业板块领涨/领跌：stock-sdk `board.industry.list` 按 changePercent 排序（受开关门控）
 *  - 主要指数涨跌：stock-api `auto.getStocks`（腾讯/新浪/东财 fallback，与 ETF 行情同通道，不依赖开关）
 *  - 市场状态：stock-sdk `calendar.getMarketStatus`（纯时间计算，无网络）
 *
 * 遵循评估 §7.4「不自建东财解析、不引入 Python」与 §6.2.4「市场宽度卡落 Dashboard」原则。
 *
 * @module marketBreadth
 */

import type { IndustryBoard } from "stock-sdk";
import StockApiDefault from "stock-api";
import { buildEastmoneySdk } from "@/services/eastmoneySdk";
import { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
import { useSettingsStore } from "@/stores/settings";

// 复用 StockApiAdapter 的取法：stock-api 浏览器构建仅默认导出含运行时 `stocks` 对象，
// 命名导出 `auto` 不在浏览器 ESM bundle 内，故走 `StockApiDefault.stocks.auto`。
type StockApiModule = (typeof StockApiDefault)["stocks"];
type StockResult = Awaited<ReturnType<StockApiModule["auto"]["getStocks"]>>[number];

/** 涨停/跌停/炸板家数 + 炸板率 */
export interface LimitUpStats {
  /** 涨停家数 */
  limitUp: number;
  /** 跌停家数 */
  limitDown: number;
  /** 炸板家数（曾触及涨停后开板） */
  broken: number;
  /** 炸板率 = 炸板 / (涨停 + 炸板)，0~1；分母为 0 时返回 0 */
  brokenRate: number;
}

/** 行业板块领涨 / 领跌（按 changePercent 排序） */
export interface IndustryBoardRank {
  /** 领涨 TOP（changePercent 降序） */
  top: IndustryBoard[];
  /** 领跌 TOP（changePercent 升序） */
  bottom: IndustryBoard[];
}

/** 指数实时行情（来自 stock-api，与 ETF 行情同通道） */
export interface IndexQuote {
  /** 指数代码（如 SH000001） */
  code: string;
  /** 指数名称（如 上证指数） */
  name: string;
  /** 最新点位 */
  price: number;
  /** 涨跌幅 %（如 -1.61 表示 -1.61%） */
  changePercent: number;
}

/** 市场状态标签转由 marketStatus 模块统一定义（避免重复实现） */
export { MARKET_STATUS_LABEL } from "@/services/marketStatus";

/** 默认关注的主要指数（腾讯/东财代码格式） */
export const DEFAULT_INDEX_CODES: string[] = [
  "sh000001", // 上证指数
  "sz399001", // 深证成指
  "sz399006", // 创业板指
  "sh000688", // 科创50
  "sh000300", // 沪深300
];

/** 涨停/跌停/炸板家数 + 炸板率（数据源：marketEvent.ztPool） */
export async function fetchLimitUpStats(): Promise<LimitUpStats> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  const [zt, dt, broken] = await Promise.all([
    sdk.marketEvent.ztPool("zt"),
    sdk.marketEvent.ztPool("dt"),
    sdk.marketEvent.ztPool("broken"),
  ]);
  const limitUp = zt.length;
  const limitDown = dt.length;
  const brokenCount = broken.length;
  const denom = limitUp + brokenCount;
  const brokenRate = denom > 0 ? brokenCount / denom : 0;
  return { limitUp, limitDown, broken: brokenCount, brokenRate };
}

/** 行业板块领涨 / 领跌 TOP（数据源：board.industry.list） */
export async function fetchIndustryBoardRank(limit = 5): Promise<IndustryBoardRank> {
  const config = useSettingsStore.getState().settings.dataSource.eastmoney;
  if (!config.enabled) throw new EastmoneyDisabledError();
  const sdk = buildEastmoneySdk(config);
  const boards = await sdk.board.industry.list();
  const sorted = [...boards].sort(
    (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity),
  );
  return {
    top: sorted.slice(0, limit),
    bottom: sorted.slice(-limit).reverse(),
  };
}

/**
 * 主要指数实时行情（数据源：stock-api auto.getStocks，与 ETF 行情同通道）。
 * 不依赖「东财增强」开关，浏览器直连腾讯/新浪/东财 fallback。
 */
export async function fetchIndexQuotes(
  codes: string[] = DEFAULT_INDEX_CODES,
): Promise<IndexQuote[]> {
  if (codes.length === 0) return [];
  const quotes: StockResult[] = await StockApiDefault.stocks.auto.getStocks(codes);
  return quotes
    .filter((q) => q && q.now > 0 && q.name)
    .map((q) => ({
      code: q.code,
      name: q.name,
      price: q.now,
      changePercent: (q.percent ?? 0) * 100,
    }));
}

/** 市场状态查询转由 marketStatus 模块统一实现（避免重复实现） */
export { getMarketStatusCN } from "@/services/marketStatus";

export { EastmoneyDisabledError } from "@/services/sectorFundFlowRank";
