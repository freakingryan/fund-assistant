import Dexie, { type EntityTable } from "dexie";
import type {
  AppNotification,
  DailyReport,
  FundHolding,
  FundQuote,
  InvestmentPlan,
  PlanAlert,
  UserSettings,
  DecisionLog,
} from "@/types";
import type {
  CaptureReport,
  ScoreSnapshot,
  AiBacktestAnalysis,
  TuningProposal,
} from "@/services/backtest/types";

/** quoteCache 行：最近一次前台扫描得到的某基金最新净值快照 */
export interface QuoteCacheRow {
  code: string;
  quote: FundQuote;
  updatedAt: string;
}

/** swMeta 通用键值行：用于存储 SW 运行态（如噪声闸门状态） */
export interface SwMetaRow {
  id: string;
  value: unknown;
}

export class FundAssistantDB extends Dexie {
  holdings!: EntityTable<FundHolding, "id">;
  plans!: EntityTable<InvestmentPlan, "id">;
  alerts!: EntityTable<PlanAlert, "id">;
  settings!: EntityTable<UserSettings, "id">;
  klineCache!: EntityTable<
    { id: string; code: string; period: string; data: any[]; cachedAt: number },
    "id"
  >;
  notifications!: EntityTable<AppNotification, "id">;
  scoreSnapshots!: EntityTable<ScoreSnapshot, "id">;
  captureReports!: EntityTable<CaptureReport, "id">;
  dailyReports!: EntityTable<DailyReport, "date">;
  aiAnalyses!: EntityTable<AiBacktestAnalysis, "id">;
  decisionLogs!: EntityTable<DecisionLog, "id">;
  tuningProposals!: EntityTable<TuningProposal, "id">;
  /** 最新净值快照缓存：供 Service Worker 后台扫描在页面关闭后使用（脱离 JSONP 依赖） */
  quoteCache!: EntityTable<QuoteCacheRow, "code">;
  /** Service Worker 运行态（噪声闸门去重/频率状态等），跨 SW 唤醒保持 */
  swMeta!: EntityTable<SwMetaRow, "id">;

  constructor() {
    super("FundAssistantDB");

    // v1 (dev): holdings, plans (per-fund), planLogs, settings
    // v2 (current): plans (global single plan), alerts (replaces planLogs)
    this.version(2)
      .stores({
        holdings: "id, code, market, type, sector, purchaseDate",
        plans: "id, enabled",
        alerts: "id, fundCode, triggeredAt",
        settings: "id",
      })
      .upgrade(async (_tx) => {
        console.warn("[DB] Upgrading from v1 to v2");
      });

    // v3: klineCache — K 线数据本地缓存
    this.version(3).stores({
      klineCache: "id, code, period, cachedAt",
    });

    // v4: notifications — 应用内通知（铃铛浮窗）
    this.version(4).stores({
      notifications: "id, createdAt, read",
    });

    // v5: scoreSnapshots — 每日收盘评分快照（回测验证）
    this.version(5).stores({
      scoreSnapshots: "id, fundCode, date, asOfDate, recommendation, outcome",
    });

    // v6: captureReports — 采集失败报告（标注"因数据源不可达而缺评分"）
    this.version(6).stores({
      captureReports: "id, date",
    });

    // v7: dailyReports — 每日日报（日期幂等，主键 date）
    this.version(7).stores({
      dailyReports: "date",
    });

    // v8: aiAnalyses — 回测 AI 辅助分析结果（可回看，主键 id）
    this.version(8).stores({
      aiAnalyses: "id, createdAt",
    });

    // v9: decisionLogs — 新手 SOP 投资体检决策日志（按基金代码 + 时间检索）
    this.version(9).stores({
      decisionLogs: "id, fundCode, createdAt",
    });

    // v10: tuningProposals — AI 调参提案（T5.2；状态流转即采纳历史）
    this.version(10).stores({
      tuningProposals: "id, status, createdAt",
    });

    // v11: quoteCache — 最新净值快照缓存（Service Worker 后台扫描在页面关闭后读取）
    this.version(11).stores({
      quoteCache: "code, updatedAt",
    });

    // v12: swMeta — Service Worker 运行态持久化（噪声闸门跨唤醒保持）
    this.version(12).stores({
      swMeta: "id",
    });
  }
}

export const db = new FundAssistantDB();
