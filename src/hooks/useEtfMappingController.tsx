import { useState, useCallback, useMemo, createContext, useContext } from "react";
import { useSettingsStore } from "@/stores/settings";
import { useHoldingsStore } from "@/stores/holdings";
import { dataSourceService } from "@/adapters/datasource/service";
import { fetchEtfMapping, fetchEtfMappings, recommendEtfMappingFix } from "@/services/ai";
import type { EtfMappingRecommendation } from "@/services/ai";
import { detectBrokenEtfMappings } from "@/services/etfMappingHealth";
import type { EtfMappingHealth } from "@/services/etfMappingHealth";
import { useEtfHealthStore } from "@/stores/etfHealth";
import { toast } from "@/components/ui/toast";
import type { EtfMapping } from "@/types";
import { isOnExchangeEtfFund } from "@/lib/fundCategory";

// 场内 ETF 代码段（这类持仓本身就是可交易品种，无需再做场外→场内映射）
export const EXCHANGE_ETF_PREFIX = /^(51|159|56|58|16)/;
const OTC_CODE = /^\d{6}$/;

interface Draft {
  otcCode: string;
  otcName: string;
  exchangeCode: string;
  exchangeName: string;
}

const emptyDraft: Draft = { otcCode: "", otcName: "", exchangeCode: "", exchangeName: "" };

type Row =
  | {
      kind: "holding";
      code: string;
      name: string;
      mapping: EtfMapping | null;
      mappingIndex: number | null;
    }
  | { kind: "orphan"; code: string; name: string; mapping: EtfMapping; mappingIndex: number };

// 主动型：名称未含 ETF/指数（如普通主动股票/混合基金）；其余归为「场内 ETF 类」。
// 复用 fundCategory 的 isOnExchangeEtfFund 作为唯一分类来源。
export function isActiveRow(r: Row): boolean {
  return !isOnExchangeEtfFund(r.name);
}

export function ruleLabel(rule: EtfMappingRecommendation["rule"]): string {
  switch (rule) {
    case "same_company_same_index":
      return "同公司同指数";
    case "same_index_diff_company":
      return "同指数跨公司";
    case "theme_related":
      return "仅主题相关";
    default:
      return "未知";
  }
}

export interface EtfMappingController {
  // 表单 / 编辑对话框
  open: boolean;
  editIndex: number | null;
  draft: Draft;
  searching: boolean;
  candidates: { exchangeCode: string; exchangeName: string }[];
  setDraft: (updater: (d: Draft) => Draft) => void;
  handleSearch: () => Promise<void>;
  handleAutoMatch: () => Promise<void>;
  pickCandidate: (c: { exchangeCode: string; exchangeName: string }) => void;
  handleSave: () => void;
  closeDialog: () => void;
  openAdd: () => void;
  openAddFromHolding: (code: string, name: string) => void;
  openEdit: (index: number) => void;

  // 表格数据
  primaryRows: Row[];
  activeRows: Row[];
  allRows: Row[];
  unmappedCount: number;
  brokenCodes: Set<string>;
  refreshing: number | null;
  handleRefresh: (index: number) => Promise<void>;
  handleDelete: (index: number) => void;

  // 批量补全
  batchRunning: boolean;
  batchProgress: { done: number; total: number };
  handleBatchResolve: () => Promise<void>;

  // 健康检测
  health: EtfMappingHealth[] | null;
  detecting: boolean;
  detectProgress: { done: number; total: number };
  handleDetect: () => Promise<void>;

  // AI 推荐修复
  recommending: boolean;
  recProgress: { done: number; total: number };
  handleAiFix: () => Promise<void>;
  reviewOpen: boolean;
  setReviewOpen: (v: boolean) => void;
  recommendations: EtfMappingRecommendation[];
  orderedRecs: EtfMappingRecommendation[];
  editRecs: Record<string, { code: string; name: string }>;
  setEditRecs: (v: Record<string, { code: string; name: string }>) => void;
  appliedCodes: Set<string>;
  handleApplyRec: (otcCode: string) => void;
  handleApplyAll: () => void;

  // 元数据
  etfMappingCount: number;
}

function useEtfMappingController(): EtfMappingController {
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings);
  const addEtfMapping = useSettingsStore((s) => s.addEtfMapping);
  const updateEtfMapping = useSettingsStore((s) => s.updateEtfMapping);
  const removeEtfMapping = useSettingsStore((s) => s.removeEtfMapping);
  const holdings = useHoldingsStore((s) => s.holdings);

  const [open, setOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<{ exchangeCode: string; exchangeName: string }[]>(
    [],
  );
  const [refreshing, setRefreshing] = useState<number | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  // ETF 映射健康检测 + AI 推荐修复
  const [health, setHealth] = useState<EtfMappingHealth[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectProgress, setDetectProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [recommendations, setRecommendations] = useState<EtfMappingRecommendation[]>([]);
  const [recommending, setRecommending] = useState(false);
  const [recProgress, setRecProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [editRecs, setEditRecs] = useState<Record<string, { code: string; name: string }>>({});
  // 已应用的场外码集合：应用后按钮禁用，且记录移到末尾
  const [appliedCodes, setAppliedCodes] = useState<Set<string>>(new Set());

  const setDraft = useCallback((updater: (d: Draft) => Draft) => setDraftState(updater), []);

  // 合并：所有持仓（附其映射状态）+ 持仓中不存在的孤儿映射
  const rows = useMemo<Row[]>(() => {
    const mapByCode = new Map<string, { m: EtfMapping; i: number }>();
    etfMappings.forEach((m, i) => {
      if (!mapByCode.has(m.otcCode)) mapByCode.set(m.otcCode, { m, i });
    });
    const seen = new Set<string>();
    const result: Row[] = [];
    for (const h of holdings) {
      seen.add(h.code);
      const hit = mapByCode.get(h.code);
      result.push({
        kind: "holding",
        code: h.code,
        name: h.name,
        mapping: hit?.m ?? null,
        mappingIndex: hit?.i ?? null,
      });
    }
    for (const m of etfMappings) {
      if (seen.has(m.otcCode)) continue;
      const idx = mapByCode.get(m.otcCode)?.i ?? -1;
      result.push({
        kind: "orphan",
        code: m.otcCode,
        name: m.otcName,
        mapping: m,
        mappingIndex: idx,
      });
    }
    // 主动型（名称未含 ETF/指数）排到末尾，并用分界线隔开
    const primary = result.filter((r) => !isActiveRow(r));
    const active = result.filter((r) => isActiveRow(r));
    return [...primary, ...active];
  }, [holdings, etfMappings]);

  const primaryRows = useMemo(() => rows.filter((r) => !isActiveRow(r)), [rows]);
  const activeRows = useMemo(() => rows.filter((r) => isActiveRow(r)), [rows]);

  const unmappedCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.kind === "holding" &&
          !r.mapping &&
          !EXCHANGE_ETF_PREFIX.test(r.code) &&
          OTC_CODE.test(r.code) &&
          !isActiveRow(r),
      ).length,
    [rows],
  );

  const openAdd = useCallback(() => {
    setDraftState(emptyDraft);
    setEditIndex(null);
    setCandidates([]);
    setOpen(true);
  }, []);

  const openAddFromHolding = useCallback((code: string, name: string) => {
    setDraftState({ otcCode: code, otcName: name, exchangeCode: "", exchangeName: "" });
    setEditIndex(null);
    setCandidates([]);
    setOpen(true);
  }, []);

  const openEdit = useCallback(
    (index: number) => {
      const m = etfMappings[index];
      if (!m) return;
      setDraftState({ ...m });
      setEditIndex(index);
      setCandidates([]);
      setOpen(true);
    },
    [etfMappings],
  );

  const closeDialog = useCallback(() => {
    setOpen(false);
    setEditIndex(null);
    setDraftState(emptyDraft);
    setCandidates([]);
  }, []);

  // 按场内 ETF 名称/代码搜索候选（复用数据源搜索兜底）
  const handleSearch = useCallback(async () => {
    const keyword = (draft.otcName || draft.otcCode).trim();
    if (!keyword) {
      toast({ type: "warning", message: "请先填写场外基金名称或代码" });
      return;
    }
    setSearching(true);
    setCandidates([]);
    try {
      const results = await dataSourceService.searchStocks(keyword);
      const etfs = results
        .map((r: any) => ({
          exchangeCode: String(r.code || "").replace(/^(SZ|SH)/, ""),
          exchangeName: String(r.name || ""),
        }))
        .filter((r) => OTC_CODE.test(r.exchangeCode) && EXCHANGE_ETF_PREFIX.test(r.exchangeCode));
      if (etfs.length > 0) {
        setCandidates(etfs);
      } else {
        toast({ type: "info", message: "未搜到场内 ETF，可尝试「自动匹配」或手动填写" });
      }
    } catch {
      toast({ type: "error", message: "搜索失败，请手动填写场内 ETF 代码" });
    }
    setSearching(false);
  }, [draft.otcCode, draft.otcName]);

  // 按场外代码自动匹配（数据源 → AI 兜底）
  const handleAutoMatch = useCallback(async () => {
    const code = draft.otcCode.trim();
    if (!code) {
      toast({ type: "warning", message: "请先填写场外基金代码" });
      return;
    }
    setSearching(true);
    try {
      const result = await fetchEtfMapping(code, draft.otcName);
      if (result?.exchangeCode) {
        setDraftState((d) => ({
          ...d,
          otcName: d.otcName || result.otcName || code,
          exchangeCode: result.exchangeCode,
          exchangeName: result.exchangeName || result.exchangeCode,
        }));
        setCandidates([]);
        toast({
          type: "success",
          message: `自动匹配到：${result.exchangeCode} ${result.exchangeName}`,
        });
      } else {
        toast({ type: "info", message: "未自动匹配到，可手动填写或搜索" });
      }
    } catch {
      toast({ type: "error", message: "自动匹配失败，请手动填写" });
    }
    setSearching(false);
  }, [draft.otcCode]);

  const handleSave = useCallback(() => {
    if (!draft.otcCode.trim()) {
      toast({ type: "warning", message: "场外基金代码必填" });
      return;
    }
    if (!draft.exchangeCode.trim()) {
      toast({ type: "warning", message: "场内 ETF 代码必填" });
      return;
    }
    const payload: EtfMapping = {
      otcCode: draft.otcCode.trim(),
      otcName: draft.otcName.trim() || draft.otcCode.trim(),
      exchangeCode: draft.exchangeCode.trim(),
      exchangeName: draft.exchangeName.trim() || draft.exchangeCode.trim(),
    };
    if (editIndex === null) {
      addEtfMapping(payload.otcCode, payload.otcName, payload.exchangeCode, payload.exchangeName);
      toast({ type: "success", message: "已新增 ETF 映射" });
    } else {
      updateEtfMapping(editIndex, payload);
      toast({ type: "success", message: "已更新 ETF 映射" });
    }
    closeDialog();
  }, [draft, editIndex, addEtfMapping, updateEtfMapping, closeDialog]);

  const handleDelete = useCallback(
    (index: number) => {
      const m = etfMappings[index];
      if (!m) return;
      removeEtfMapping(index);
      toast({ type: "success", message: `已删除映射：${m.otcCode} → ${m.exchangeCode}` });
    },
    [etfMappings, removeEtfMapping],
  );

  const handleRefresh = useCallback(
    async (index: number) => {
      const m = etfMappings[index];
      if (!m) return;
      setRefreshing(index);
      try {
        const result = await fetchEtfMapping(m.otcCode, m.otcName);
        if (result?.exchangeCode) {
          updateEtfMapping(index, {
            otcCode: result.otcCode || m.otcCode,
            otcName: result.otcName || m.otcName,
            exchangeCode: result.exchangeCode,
            exchangeName: result.exchangeName || result.exchangeCode,
          });
          toast({
            type: "success",
            message: `已刷新：${result.exchangeCode} ${result.exchangeName}`,
          });
        } else {
          toast({ type: "info", message: `${m.otcCode} 未找到可更新的场内 ETF` });
        }
      } catch {
        toast({ type: "error", message: `刷新失败：${m.otcCode}` });
      }
      setRefreshing(null);
    },
    [etfMappings, updateEtfMapping],
  );

  const handleBatchResolve = useCallback(async () => {
    const targets = rows
      .filter(
        (r) =>
          r.kind === "holding" &&
          !r.mapping &&
          !EXCHANGE_ETF_PREFIX.test(r.code) &&
          OTC_CODE.test(r.code) &&
          !isActiveRow(r),
      )
      .map((r) => (r.kind === "holding" ? r.code : ""))
      .filter(Boolean);
    if (targets.length === 0) {
      toast({ type: "info", message: "没有需要补全的未映射场外基金" });
      return;
    }
    // 收集名称，便于日志与 AI 兜底携带上下文
    const names: Record<string, string> = {};
    for (const r of rows) if (r.kind === "holding") names[r.code] = r.name;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: targets.length });
    try {
      const { found, missing } = await fetchEtfMappings(targets, {
        onProgress: (done, total) => setBatchProgress({ done, total }),
        names,
      });
      for (const m of found) {
        await addEtfMapping(m.otcCode, m.otcName, m.exchangeCode, m.exchangeName);
      }
      toast({
        type: found.length > 0 ? "success" : "info",
        message: `批量补全完成：新增 ${found.length} 条映射${missing.length > 0 ? `，${missing.length} 条未找到` : ""}`,
      });
    } catch {
      toast({ type: "error", message: "批量补全失败" });
    } finally {
      setBatchRunning(false);
    }
  }, [rows, addEtfMapping]);

  const pickCandidate = useCallback((c: { exchangeCode: string; exchangeName: string }) => {
    setDraftState((d) => ({ ...d, exchangeCode: c.exchangeCode, exchangeName: c.exchangeName }));
    setCandidates([]);
  }, []);

  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // 检测「K 线端点取数失败」的映射（映射错误）；正常项走缓存、不重复检测
  const handleDetect = useCallback(async () => {
    if (etfMappings.length === 0) {
      toast({ type: "info", message: "暂无映射可检测" });
      return;
    }
    setDetecting(true);
    setDetectProgress({ done: 0, total: etfMappings.length });
    try {
      const result = await detectBrokenEtfMappings(etfMappings, {
        onProgress: (d, t) => setDetectProgress({ done: d, total: t }),
      });
      setHealth(result.all);
      if (result.broken.length === 0) {
        toast({
          type: "success",
          message: `检测完成：全部 ${result.healthy.length} 条映射 K 线均可正常取数`,
        });
      } else {
        toast({ type: "warning", message: `检测到 ${result.broken.length} 条映射 K 线取数失败` });
      }
    } catch {
      toast({ type: "error", message: "检测失败" });
    } finally {
      setDetecting(false);
    }
  }, [etfMappings]);

  // 对检测到的错误映射，逐条调用 AI 推荐修正项（R1-R4 + 流动性预排序 + K 线验证）
  const handleAiFix = useCallback(async () => {
    setAppliedCodes(new Set());
    const brokenList = (health ? health.filter((h) => !h.ok) : []).map((h) => ({
      otcCode: h.otcCode,
      otcName: h.otcName,
      exchangeCode: h.exchangeCode,
      exchangeName: h.exchangeName,
    }));
    if (brokenList.length === 0) {
      toast({ type: "info", message: "没有检测到错误的映射，无需修复" });
      return;
    }
    setRecommending(true);
    setRecProgress({ done: 0, total: brokenList.length });
    const recs: EtfMappingRecommendation[] = [];
    for (let i = 0; i < brokenList.length; i++) {
      const rec = await recommendEtfMappingFix(brokenList[i]);
      if (rec) recs.push(rec);
      setRecProgress({ done: i + 1, total: brokenList.length });
      await wait(300);
    }
    setRecommendations(recs);
    setEditRecs(
      Object.fromEntries(
        recs.map((r) => [
          r.otcCode,
          { code: r.recommendedExchangeCode, name: r.recommendedExchangeName },
        ]),
      ),
    );
    setRecommending(false);
    setReviewOpen(true);
    const failed = brokenList.length - recs.length;
    toast({
      type: recs.length > 0 ? "success" : "error",
      message: `AI 推荐完成：${recs.length} 条有建议${failed > 0 ? `，${failed} 条 AI 未给出` : ""}`,
    });
  }, [health]);

  const handleApplyRec = useCallback(
    (otcCode: string) => {
      const edit = editRecs[otcCode];
      const rec = recommendations.find((r) => r.otcCode === otcCode);
      if (!edit || !rec) return;
      const idx = etfMappings.findIndex((m) => m.otcCode === otcCode);
      if (idx < 0) {
        toast({ type: "error", message: `未找到映射 ${otcCode}` });
        return;
      }
      updateEtfMapping(idx, {
        otcCode,
        otcName: rec.otcName,
        exchangeCode: edit.code.trim(),
        exchangeName: edit.name.trim() || edit.code.trim(),
      });
      setAppliedCodes((prev) => new Set(prev).add(otcCode));
      // 仅当 AI 验证通过才记为健康；否则保留为错误待复查
      useEtfHealthStore.getState().set(edit.code.trim(), rec.verified);
      setHealth((prev) =>
        prev
          ? prev.map((h) =>
              h.otcCode === otcCode
                ? {
                    ...h,
                    exchangeCode: edit.code.trim(),
                    exchangeName: edit.name.trim(),
                    ok: rec.verified,
                  }
                : h,
            )
          : prev,
      );
      toast({ type: "success", message: `已更新 ${otcCode} → ${edit.code.trim()}` });
    },
    [editRecs, recommendations, etfMappings, updateEtfMapping],
  );

  const handleApplyAll = useCallback(() => {
    const otcCodes = Object.keys(editRecs);
    if (otcCodes.length === 0) return;
    let applied = 0;
    for (const otcCode of otcCodes) {
      const edit = editRecs[otcCode];
      const rec = recommendations.find((r) => r.otcCode === otcCode);
      const idx = etfMappings.findIndex((m) => m.otcCode === otcCode);
      if (!edit || !rec || idx < 0) continue;
      updateEtfMapping(idx, {
        otcCode,
        otcName: rec.otcName,
        exchangeCode: edit.code.trim(),
        exchangeName: edit.name.trim() || edit.code.trim(),
      });
      useEtfHealthStore.getState().set(edit.code.trim(), rec.verified);
      applied++;
    }
    setHealth((prev) =>
      prev
        ? prev.map((h) => {
            const edit = editRecs[h.otcCode];
            const rec = recommendations.find((r) => r.otcCode === h.otcCode);
            return edit && rec
              ? {
                  ...h,
                  exchangeCode: edit.code.trim(),
                  exchangeName: edit.name.trim(),
                  ok: rec.verified,
                }
              : h;
          })
        : prev,
    );
    setAppliedCodes(new Set(Object.keys(editRecs)));
    setReviewOpen(false);
    toast({ type: "success", message: `已应用 ${applied} 条推荐映射` });
  }, [editRecs, recommendations, etfMappings, updateEtfMapping]);

  // 检测结果为「K 线失败」的 exchangeCode 集合，用于表格红标
  const brokenCodes = useMemo(
    () => new Set((health || []).filter((h) => !h.ok).map((h) => h.exchangeCode)),
    [health],
  );

  // AI 推荐审查：已应用的记录排到末尾（未应用的保持原有相对顺序）
  const orderedRecs = useMemo(
    () =>
      [...recommendations].sort((a, b) => {
        const aa = appliedCodes.has(a.otcCode);
        const bb = appliedCodes.has(b.otcCode);
        return aa === bb ? 0 : aa ? 1 : -1;
      }),
    [recommendations, appliedCodes],
  );

  return {
    open,
    editIndex,
    draft,
    searching,
    candidates,
    setDraft,
    handleSearch,
    handleAutoMatch,
    pickCandidate,
    handleSave,
    closeDialog,
    openAdd,
    openAddFromHolding,
    openEdit,

    primaryRows,
    activeRows,
    allRows: rows,
    unmappedCount,
    brokenCodes,
    refreshing,
    handleRefresh,
    handleDelete,

    batchRunning,
    batchProgress,
    handleBatchResolve,

    health,
    detecting,
    detectProgress,
    handleDetect,

    recommending,
    recProgress,
    handleAiFix,
    reviewOpen,
    setReviewOpen,
    recommendations,
    orderedRecs,
    editRecs,
    setEditRecs,
    appliedCodes,
    handleApplyRec,
    handleApplyAll,

    etfMappingCount: etfMappings.length,
  };
}

const EtfMappingContext = createContext<EtfMappingController | null>(null);

export function EtfMappingProvider({ children }: { children: React.ReactNode }) {
  const controller = useEtfMappingController();
  return <EtfMappingContext.Provider value={controller}>{children}</EtfMappingContext.Provider>;
}

export function useEtfMapping(): EtfMappingController {
  const ctx = useContext(EtfMappingContext);
  if (!ctx) throw new Error("useEtfMapping 必须在 <EtfMappingProvider> 内使用");
  return ctx;
}
