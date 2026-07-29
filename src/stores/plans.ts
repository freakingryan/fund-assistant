import { create } from "zustand";
import { db } from "./db";
import type { InvestmentPlan, PlanRule, PlanAlert, FundHolding, FundQuote } from "@/types";
import { dataSourceService } from "@/adapters/datasource/service";
import { computeFundTrendScore } from "@/services/backtest/decisionSnapshot";
import { useSettingsStore } from "./settings";
import { evaluatePlanRules } from "@/services/plans/scanCore";

const DEFAULT_PLAN: Omit<InvestmentPlan, "id" | "createdAt" | "updatedAt"> = {
  name: "全局投资计划",
  description: "所有持仓基金共用此套规则",
  rules: [
    {
      id: crypto.randomUUID(),
      type: "return",
      threshold: -10,
      comparator: "lte",
      action: "buy",
      shares: 1,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      type: "return",
      threshold: 15,
      comparator: "gte",
      action: "sell",
      shares: 2,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      type: "daily_change",
      threshold: 3,
      comparator: "lte",
      action: "buy",
      shares: 0,
      enabled: true,
    },
  ],
  enabled: true,
};

interface PlansState {
  plan: InvestmentPlan | null;
  alerts: PlanAlert[];
  loading: boolean;
  scanning: boolean;
  error: string | null;

  loadPlan: () => Promise<void>;
  updatePlan: (
    data: Partial<Omit<InvestmentPlan, "id" | "createdAt" | "updatedAt">>,
  ) => Promise<void>;
  addRule: (rule: Omit<PlanRule, "id">) => Promise<void>;
  updateRule: (ruleId: string, data: Partial<PlanRule>) => Promise<void>;
  removeRule: (ruleId: string) => Promise<void>;
  togglePlanEnabled: () => Promise<void>;

  /** 手动扫描：检查所有持仓是否符合规则 */
  scan: (holdings: FundHolding[]) => Promise<PlanAlert[]>;

  loadAlerts: () => Promise<void>;
  markAlertExecuted: (alertId: string) => Promise<void>;
  dismissAlert: (alertId: string) => Promise<void>;
}

export const usePlansStore = create<PlansState>((set, get) => ({
  plan: null,
  alerts: [],
  loading: false,
  scanning: false,
  error: null,

  loadPlan: async () => {
    set({ loading: true });
    try {
      let plan = await db.plans.get("global-plan");
      if (!plan) {
        const now = new Date().toISOString();
        plan = { ...DEFAULT_PLAN, id: "global-plan", createdAt: now, updatedAt: now };
        await db.plans.add(plan);
      }
      set({ plan, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  updatePlan: async (data) => {
    const now = new Date().toISOString();
    const plan = get().plan!;
    const updated = { ...plan, ...data, updatedAt: now };
    await db.plans.put(updated);
    set({ plan: updated });
  },

  addRule: async (rule) => {
    const newRule: PlanRule = { ...rule, id: crypto.randomUUID() };
    const plan = get().plan!;
    const updated = {
      ...plan,
      rules: [...plan.rules, newRule],
      updatedAt: new Date().toISOString(),
    };
    await db.plans.put(updated);
    set({ plan: updated });
  },

  updateRule: async (ruleId, data) => {
    const plan = get().plan!;
    const updated = {
      ...plan,
      rules: plan.rules.map((r) => (r.id === ruleId ? { ...r, ...data } : r)),
      updatedAt: new Date().toISOString(),
    };
    await db.plans.put(updated);
    set({ plan: updated });
  },

  removeRule: async (ruleId) => {
    const plan = get().plan!;
    const updated = {
      ...plan,
      rules: plan.rules.filter((r) => r.id !== ruleId),
      updatedAt: new Date().toISOString(),
    };
    await db.plans.put(updated);
    set({ plan: updated });
  },

  togglePlanEnabled: async () => {
    const plan = get().plan!;
    const updated = { ...plan, enabled: !plan.enabled, updatedAt: new Date().toISOString() };
    await db.plans.put(updated);
    set({ plan: updated });
  },

  scan: async (holdings) => {
    set({ scanning: true });
    const plan = get().plan;
    if (!plan || !plan.enabled) {
      set({ scanning: false });
      return [];
    }

    const enabledRules = plan.rules.filter((r) => r.enabled);
    if (enabledRules.length === 0) {
      set({ scanning: false });
      return [];
    }

    const codes = holdings.map((h) => h.code);
    // 前台扫描：直接走完整数据源（含 OTC 基金 JSONP 估值）
    const quotes = await dataSourceService.fetchQuotes(codes);
    // 持久化最新净值到 quoteCache，供 Service Worker 后台扫描在页面关闭后使用
    await persistQuoteCache(quotes);

    const alerts = await evaluatePlanRules({
      holdings,
      plan,
      strategy: {
        // 已在前台获取，直接复用（保持单次请求语义）
        fetchQuotes: () => Promise.resolve(quotes),
        fetchEtfKLine: (code, period) => dataSourceService.fetchEtfKLine(code, period),
        computeTrendScore: (fund, mappings) => computeFundTrendScore(fund, mappings),
        etfMappings: useSettingsStore.getState().settings.etfMappings,
      },
      dedup: {
        existingKeys: await buildExistingKeys(),
        dcaAlertMap: await buildDcaAlertMap(),
      },
    });

    // 保存到 DB
    if (alerts.length > 0) {
      await db.alerts.bulkAdd(alerts);
    }

    // 合并到已有 alerts
    set((s) => ({
      alerts: [...alerts, ...s.alerts],
      scanning: false,
    }));

    return alerts;
  },

  loadAlerts: async () => {
    const alerts = await db.alerts.orderBy("triggeredAt").reverse().toArray();
    set({ alerts });
  },

  markAlertExecuted: async (alertId) => {
    const now = new Date().toISOString();
    await db.alerts.update(alertId, { executed: true, executedAt: now });
    set((s) => ({
      alerts: s.alerts.map((a) =>
        a.id === alertId ? { ...a, executed: true, executedAt: now } : a,
      ),
    }));
  },

  dismissAlert: async (alertId) => {
    await db.alerts.update(alertId, { dismissed: true });
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, dismissed: true } : a)),
    }));
  },
}));

/**
 * 已存在且未处理的提醒键集合（fundCode|ruleId），用于扫描去重。
 * 注意：此实现依赖 IndexedDB，仅供前台调用；SW 侧有等价实现。
 */
async function buildExistingKeys(): Promise<Set<string>> {
  const existing = await db.alerts.filter((a) => !a.executed && !a.dismissed).toArray();
  return new Set(existing.map((a) => `${a.fundCode}|${a.ruleId}`));
}

/**
 * DCA 规则去重：取每只基金最近一次 dca 提醒时间，用于「距上次 N 天」判定。
 */
async function buildDcaAlertMap(): Promise<Map<string, string>> {
  const dcaAlerts = await db.alerts.filter((a) => a.ruleType === "dca").toArray();
  const map = new Map<string, string>();
  for (const a of dcaAlerts) {
    const key = `${a.fundCode}|dca`;
    const prev = map.get(key);
    if (!prev || a.triggeredAt > prev) map.set(key, a.triggeredAt);
  }
  return map;
}

/**
 * 将最新净值快照写入 quoteCache，供 Service Worker 后台扫描在页面关闭后使用。
 * 后台扫描因此能在无 DOM/JSONP 的情况下拿到「最近一次前台扫描」的净值。
 */
async function persistQuoteCache(quotes: FundQuote[]): Promise<void> {
  if (quotes.length === 0) return;
  const now = new Date().toISOString();
  await db.quoteCache.bulkPut(quotes.map((q) => ({ code: q.code, quote: q, updatedAt: now })));
}
