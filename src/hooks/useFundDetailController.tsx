import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  createContext,
  useContext,
} from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { useHoldingsStore } from "@/stores/holdings";
import { usePlansStore } from "@/stores/plans";
import { useSettingsStore } from "@/stores/settings";
import { useRealtimeQuotes } from "@/hooks/useRealtimeQuotes";
import { dataSourceService } from "@/adapters/datasource/service";
import { generatePrompt } from "@/services/prompt";
import { getStrategiesByIds } from "@/services/analysisStrategies";
import type { PromptTemplateType } from "@/types";
import {
  getKlineCache,
  setKlineCache,
  deleteKlineCache,
  getKlineCacheTime,
  getPortfolioCache,
  setPortfolioCache,
  deletePortfolioCache,
  deleteQuotesCache,
  getQuotesCacheTime,
  getPortfolioCacheTime,
  getEmFactorsCache,
  setEmFactorsCache,
  getRegimeCache,
  setRegimeCache,
} from "@/services/klineCache";
import type {
  KLineData,
  FundQuote,
  EtfMapping,
  FundHolding,
  PlanAlert,
  EastmoneyDataSourceConfig,
} from "@/types";
import { asOfFromKlines, asOfFromQuotes, asOfFromPortfolio } from "@/lib/dataTime";
import { withTimeout } from "@/lib/promise";
import { detectPatterns, formatPatternsSummary } from "@/services/klinePatterns";
import { captureSnapshotForFund } from "@/services/backtest/decisionSnapshot";
import { collectEastmoneyFactors, EMPTY_EM_FACTORS } from "@/services/decision/eastmoneyFactors";
import { computeMarketRegime } from "@/services/decision/regimeFactor";
import { buildContextPack, type AnalysisContextPack } from "@/services/decision/contextPack";
import type { EmFactors, MarketRegime } from "@/services/decision/types";
import type { DetectedPattern } from "@/services/klinePatterns";
import { analyzeKline } from "@/services/klineAnalysis";
import type { KlineAnalysisResult } from "@/services/klineAnalysis";
import { callAI, getDefaultAI } from "@/services/ai";
import { evaluateSignal } from "@/services/signalEngine";
import type { SignalResult } from "@/services/signalEngine";
import { isOnExchangeEtfFund } from "@/lib/fundCategory";
import { toast } from "@/components/ui/toast";
import type { RealtimeValuation } from "@/hooks/useRealtimeQuotes";

/** Prompt 模板提示文案（诊断/调仓/K线），供模板选择 UI 复用 */
export const TEMPLATE_HINTS: Record<string, string> = {
  diagnostic: "根据持仓明细（成本/市值/收益率/涨跌幅）生成投资诊断，分析集中度、风险收益、调仓建议",
  rebalance:
    "结合持仓明细和投资计划提醒（收益率触发/涨跌幅/K线形态等），给出具体的调仓顺序和仓位调整建议",
  kline_enhanced:
    "结合持仓明细、ETF 映射和 K 线形态检测结果（算法预检测 + 量价数据），分析技术面趋势与入场时机",
};

/**
 * FundDetailPage 状态控制器：收敛 38 个 useState、所有数据加载 useEffect 与派生逻辑。
 * 详情页拆分为「控制器 + 纯展示子组件」，本 hook 只负责状态与行为，不渲染任何 UI。
 */
export interface FundDetailController {
  /** 当前基金（解析自 URL id；不存在时返回首个持仓或 null） */
  fund: FundHolding | null;
  etfMappings: EtfMapping[];
  alerts: PlanAlert[];
  handleSwitchFund: (newId: string) => void;

  // K 线
  period: string;
  setPeriod: (v: string) => void;
  klineData: any[];
  klineLoading: boolean;
  klineAsOf: number | null;
  klineFetchedAt: number | null;
  klineRefreshKey: number;
  setKlineRefreshKey: (updater: number | ((k: number) => number)) => void;
  fundIsOnExchangeEtf: boolean;
  useEtfKline: boolean;
  setUseEtfKline: (v: boolean) => void;
  showMA: boolean;
  setShowMA: (v: boolean) => void;
  showBollinger: boolean;
  setShowBollinger: (v: boolean) => void;
  handleRefreshKline: () => void;
  isRealKline: boolean;
  etfKlineError: string | null;
  setEtfKlineError: (v: string | null) => void;
  klineDetectedPatterns: DetectedPattern[];
  klinePatterns: string;
  klineAnalysis: KlineAnalysisResult | null;
  klineAnalyzing: boolean;
  klineAnalysisError: string | null;
  handleAnalyzeKline: () => void;
  // 形态高亮
  hoveredKlineIndex: number | null;
  setHoveredKlineIndex: (v: number | null) => void;
  selectedKlineIndex: number | null;
  setSelectedKlineIndex: (v: number | null) => void;
  effectiveKlineHighlight: number | null;
  handlePatternClick: (index: number | null) => void;

  // 信号
  signalResult: SignalResult | null;
  showSignalDetail: boolean;
  setShowSignalDetail: (v: boolean) => void;

  // ETF 代码
  etfCode: string | null;

  // 东财因子 + 市场 regime
  emFactors: EmFactors | undefined;
  regime: MarketRegime | undefined;
  /** 东财因子是否正在加载（true 时 StepRegime 应显示「加载中」而非「未接入」） */
  emLoading: boolean;
  /** 市场 regime 是否正在加载（true 时 StepRegime 应显示「加载中」而非「未计算」） */
  regimeLoading: boolean;
  eastmoneyConfig: EastmoneyDataSourceConfig;

  // 实时行情
  valuations: Record<string, RealtimeValuation>;
  refreshQuotes: () => void | Promise<void>;
  quotesLoading: boolean;
  quotes: FundQuote[];
  quotesAsOf: number | null;
  quotesFetchedAt: number | null;

  // 重仓股（持仓穿透）
  portfolio: {
    date: string;
    holdings: { code: string; name: string; ratio: number; value: number }[];
  } | null;
  portfolioLoading: boolean;
  portfolioAsOf: number | null;
  portfolioFetchedAt: number | null;
  handleRefreshPortfolio: () => void;

  // 刷新/弹窗状态
  refreshing: { kline: boolean; portfolio: boolean; quotes: boolean };
  editOpen: boolean;
  setEditOpen: (v: boolean) => void;
  adjustOpen: boolean;
  setAdjustOpen: (v: boolean) => void;
  capturingScore: boolean;
  handleCaptureScore: () => void;
  handleRefreshQuotes: () => void;

  // Prompt / AI
  /** 分析上下文包（P0-B 数据质量透出）：供 PromptAiCard 的「数据齐备度」面板消费 */
  contextPack: AnalysisContextPack;
  prompt: string;
  setPrompt: (v: string) => void;
  copied: boolean;
  templateType: PromptTemplateType;
  setTemplateType: (v: PromptTemplateType) => void;
  activeTab: "prompt" | "ai";
  setActiveTab: (v: "prompt" | "ai") => void;
  aiResponse: string;
  setAiResponse: (v: string) => void;
  aiLoading: boolean;
  aiError: string | null;
  setAiError: (v: string | null) => void;
  aiExpanded: boolean;
  setAiExpanded: (v: boolean) => void;
  aiConfigured: boolean;
  handleGenerate: () => void;
  handleGenerateKlinePrompt: () => void;
  handleCallAI: () => void;
  handleCopy: () => void;

  // 分析策略（P0-A 多策略问股）：选中的策略 id 列表与切换方法
  selectedStrategyIds: string[];
  setSelectedStrategyIds: (ids: string[]) => void;
  toggleStrategy: (id: string) => void;
  clearStrategies: () => void;
}

function useFundDetailController(fundId: string): FundDetailController {
  const navigate = useNavigate();
  const holdings = useHoldingsStore((s) => s.holdings);
  const loadHoldings = useHoldingsStore((s) => s.loadHoldings);
  const etfMappings = useSettingsStore((s) => s.settings.etfMappings);
  const eastmoneyConfig = useSettingsStore((s) => s.settings.dataSource.eastmoney);
  const alerts = usePlansStore((s) => s.alerts);
  const loadAlerts = usePlansStore((s) => s.loadAlerts);

  // ─── 基础数据 ─────────────────────────────────
  const fund = useMemo(() => {
    const fromUrl = holdings.find((h) => h.id === fundId);
    return fromUrl || holdings[0] || null;
  }, [holdings, fundId]);

  useEffect(() => {
    if (holdings.length > 0 && fund && fund.id !== fundId) {
      navigate(ROUTES.detail(fund.id), { replace: true });
    }
  }, [holdings, fund, fundId, navigate]);

  const handleSwitchFund = (newId: string) => navigate(ROUTES.detail(newId));

  // ─── 状态 ─────────────────────────────────────
  const [period, setPeriod] = useState("3m");
  const [klineData, setKlineData] = useState<any[]>([]);
  const [klineLoading, setKlineLoading] = useState(false);
  /** K 线数据对应的时间（末根 date，接口返回优先） */
  const [klineAsOf, setKlineAsOf] = useState<number | null>(null);
  /** K 线缓存写入 / 调用接口的时间（回退） */
  const [klineFetchedAt, setKlineFetchedAt] = useState<number | null>(null);
  const [klineRefreshKey, setKlineRefreshKey] = useState(0);
  // 「场内 ETF 类」基金（名称含 etf/ETF/指数）默认优先展示「场内 ETF 真实 K 线」，
  // 其余基金默认展示「基金净值走势」；用户仍可在卡片内手动切换。
  const fundIsOnExchangeEtf = useMemo(
    () => (fund ? isOnExchangeEtfFund(fund.name) : false),
    [fund],
  );
  // 默认展示「基金净值走势」，而非「场内 ETF 真实 K 线」；用户可手动切换
  const [useEtfKline, setUseEtfKline] = useState(false);
  // 每支基金仅在其首次加载时套用一次默认（避免覆盖用户在本次浏览中的手动切换）
  const defaultAppliedFor = useRef<string | null>(null);
  const [showMA, setShowMA] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [templateType, setTemplateType] = useState<PromptTemplateType>("diagnostic");
  /** P0-A 多策略问股：选中的分析策略 id 列表 */
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>([]);
  const toggleStrategy = useCallback((id: string) => {
    setSelectedStrategyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);
  const clearStrategies = useCallback(() => setSelectedStrategyIds([]), []);
  /** Prompt / AI 双 Tab：默认展示生成的 Prompt，已配置 AI 时可切换到「直接调用 AI」 */
  const [activeTab, setActiveTab] = useState<"prompt" | "ai">("prompt");
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  /** AI 分析结果放大弹窗开关 */
  const [aiExpanded, setAiExpanded] = useState(false);
  /** 是否已配置可用 AI（设置页存在带 apiKey 的配置）— 驱动「直接调用 AI」Tab 是否可选 */
  const aiConfigured = useSettingsStore((s) => s.settings.aiConfigs.some((c) => c.apiKey));
  const [refreshing, setRefreshing] = useState({ kline: false, portfolio: false, quotes: false });
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [capturingScore, setCapturingScore] = useState(false);
  const [portfolio, setPortfolio] = useState<{
    date: string;
    holdings: { code: string; name: string; ratio: number; value: number }[];
  } | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioRefreshKey, setPortfolioRefreshKey] = useState(0);
  const [klineDetectedPatterns, setKlineDetectedPatterns] = useState<DetectedPattern[]>([]);
  const [klinePatterns, setKlinePatterns] = useState<string>("");
  const [klineAnalysis, setKlineAnalysis] = useState<KlineAnalysisResult | null>(null);
  const [klineAnalyzing, setKlineAnalyzing] = useState(false);
  const [klineAnalysisError, setKlineAnalysisError] = useState<string | null>(null);
  // 真实 K 线获取失败提示（接口冷却/网络异常）：保留用户切换意图，回退净值走势并提示，不静默切回开关
  const [etfKlineError, setEtfKlineError] = useState<string | null>(null);
  const [signalResult, setSignalResult] = useState<SignalResult | null>(null);
  const [showSignalDetail, setShowSignalDetail] = useState(false);
  const [hoveredKlineIndex, setHoveredKlineIndex] = useState<number | null>(null);
  const [selectedKlineIndex, setSelectedKlineIndex] = useState<number | null>(null);

  // 有效高亮：点击选中优先于悬停
  const effectiveKlineHighlight = useMemo(
    () => selectedKlineIndex ?? hoveredKlineIndex,
    [selectedKlineIndex, hoveredKlineIndex],
  );

  // K 线形态点击：切换持久化选中
  const handlePatternClick = useCallback((index: number | null) => {
    setSelectedKlineIndex((prev) => (prev === index ? null : index));
  }, []);

  // ─── 点击页面其他位置清除选中高亮 ────────────
  useEffect(() => {
    if (selectedKlineIndex === null) return;
    const handler = () => setSelectedKlineIndex(null);
    const timer = setTimeout(
      () => document.addEventListener("click", handler, { once: true }),
      100,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [selectedKlineIndex]);

  const etfCode = useMemo(() => {
    if (!fund) return null;
    const m = etfMappings.find((mapping) => mapping.otcCode === fund.code);
    return m?.exchangeCode || null;
  }, [fund, etfMappings]);

  // 进入「场内 ETF 类」且已有映射的基金时，默认套用一次真实 K 线展示；
  // 用 ref 记录已套用过的 fund.id，避免后续渲染/用户手动切换被覆盖。
  useEffect(() => {
    if (!fund) return;
    if (defaultAppliedFor.current === fund.id) return;
    defaultAppliedFor.current = fund.id;
    setUseEtfKline(fundIsOnExchangeEtf && !!etfCode);
  }, [fund?.id, fundIsOnExchangeEtf, etfCode]);

  // 是否正在展示「场内 ETF 真实 K 线」：以**实际载入的 K 线数据**为准（含真实 OHLC/成交量），
  // 而非仅靠开关意图——避免切换过程中旧的净值数据（无 OHLC）被误判为真实 K 线（全是十字星）。
  const isRealKline =
    useEtfKline && !!etfCode && klineData.length > 0 && (klineData[0]?.volume ?? 0) > 0;

  // 东财叠加层因子 + 市场 regime（异步；关闭/失败 → undefined，决策引擎自动降级、评分不变）
  const [emFactors, setEmFactors] = useState<EmFactors | undefined>(undefined);
  const [regime, setRegime] = useState<MarketRegime | undefined>(undefined);
  const [emLoading, setEmLoading] = useState(false);
  const [regimeLoading, setRegimeLoading] = useState(false);
  useEffect(() => {
    if (!fund) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmLoading(true);
    setRegimeLoading(true);

    const EM_TIMEOUT = 10000;
    const REGIME_TIMEOUT = 10000;

    const load = async () => {
      // 1) 先读缓存，命中则立即渲染（stale-while-revalidate），避免每次打开 SOP 都 loading
      const [cachedEm, cachedRegime] = await Promise.all([
        getEmFactorsCache(fund.code, eastmoneyConfig.enabled),
        getRegimeCache(),
      ]);
      if (cancelled) return;
      if (cachedEm) {
        setEmFactors(cachedEm);
        setEmLoading(false);
      }
      if (cachedRegime) {
        setRegime(cachedRegime);
        setRegimeLoading(false);
      }

      // 2) 后台刷新；带超时兜底，防止 Worker/网络挂起导致永远「加载中」
      const emPromise = eastmoneyConfig.enabled
        ? withTimeout(
            collectEastmoneyFactors(fund, etfMappings, eastmoneyConfig),
            EM_TIMEOUT,
            EMPTY_EM_FACTORS,
            "东财因子加载超时",
          )
        : Promise.resolve(EMPTY_EM_FACTORS);
      const regimePromise = withTimeout(
        computeMarketRegime().catch(() => undefined),
        REGIME_TIMEOUT,
        undefined,
        "市场 regime 加载超时",
      );

      const [freshEm, freshRegime] = await Promise.all([emPromise, regimePromise]);
      if (cancelled) return;

      setEmFactors(freshEm);
      // 东财关闭时 freshEm 也是 EMPTY，没必要写缓存；只有真实取到数据才持久化
      if (eastmoneyConfig.enabled && freshEm !== EMPTY_EM_FACTORS) {
        void setEmFactorsCache(fund.code, eastmoneyConfig.enabled, freshEm);
      }
      setEmLoading(false);

      if (freshRegime) {
        setRegime(freshRegime);
        void setRegimeCache(freshRegime);
      } else {
        setRegime(undefined);
      }
      setRegimeLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [fund, etfMappings, eastmoneyConfig]);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);
  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // 实时行情：同时获取场外基金 + 场内 ETF 映射
  const quoteCodes = useMemo(
    () => (fund ? [fund.code, ...(etfCode ? [etfCode] : [])] : []),
    [fund, etfCode],
  );
  const {
    valuations,
    refresh: refreshQuotes,
    loading: quotesLoading,
  } = useRealtimeQuotes(quoteCodes, 0);

  // 行情（最新净值）数据时间：优先接口 navDate，回退缓存写入时间
  const quotes = useMemo(
    () =>
      Object.values(valuations)
        .map((v) => v.quote)
        .filter(Boolean) as FundQuote[],
    [valuations],
  );
  const quotesAsOf = useMemo(() => asOfFromQuotes(quotes), [quotes]);
  const [quotesFetchedAt, setQuotesFetchedAt] = useState<number | null>(null);
  useEffect(() => {
    if (quoteCodes.length === 0) return;
    void getQuotesCacheTime(quoteCodes).then((ts) => setQuotesFetchedAt(ts));
  }, [quoteCodes]);

  // 重仓股（持仓穿透）数据时间：报告期 date，回退缓存写入时间
  const portfolioAsOf = useMemo(() => asOfFromPortfolio(portfolio), [portfolio]);
  const [portfolioFetchedAt, setPortfolioFetchedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!fund) return;
    void getPortfolioCacheTime(fund.code).then((ts) => setPortfolioFetchedAt(ts));
  }, [fund?.code, portfolioRefreshKey]);

  // ─── K 线刷新 ─────────────────────────────────
  const handleRefreshKline = useCallback(async () => {
    if (!fund) return;
    setRefreshing((s) => ({ ...s, kline: true }));
    await deleteKlineCache(`etf_${etfCode}`, period);
    await deleteKlineCache(fund.code, period);
    setKlineData([]);
    setKlineRefreshKey((k) => k + 1);
    setRefreshing((s) => ({ ...s, kline: false }));
  }, [fund, etfCode, period]);

  const handleRefreshPortfolio = useCallback(async () => {
    if (!fund) return;
    setRefreshing((s) => ({ ...s, portfolio: true }));
    await deletePortfolioCache(fund.code);
    setPortfolioLoading(true);
    setPortfolio(null);
    setPortfolioRefreshKey((k) => k + 1);
    setRefreshing((s) => ({ ...s, portfolio: false }));
  }, [fund]);

  // 刷新行情缓存
  const handleRefreshQuotes = useCallback(async () => {
    if (!fund) return;
    setRefreshing((s) => ({ ...s, quotes: true }));
    await deleteQuotesCache();
    await refreshQuotes();
    setRefreshing((s) => ({ ...s, quotes: false }));
  }, [fund, refreshQuotes]);

  // 记录今日评分快照（单基金），供回测验证使用
  const handleCaptureScore = useCallback(async () => {
    if (!fund) return;
    setCapturingScore(true);
    try {
      const snap = await captureSnapshotForFund(fund, etfMappings, eastmoneyConfig);
      if (snap) {
        toast({
          type: "success",
          message: `已记录 ${fund.name || fund.code} 今日评分（${snap.score}）`,
        });
      } else {
        toast({
          type: "error",
          message: "无法获取 K 线数据（纯净值基金需部署 Cloudflare Worker）",
        });
      }
    } catch {
      toast({ type: "error", message: "评分快照记录失败" });
    }
    setCapturingScore(false);
  }, [fund, etfMappings, eastmoneyConfig]);

  // ─── K 线数据加载 ─────────────────────────────
  useEffect(() => {
    if (!fund) return;
    let cancelled = false;
    setKlineLoading(true);
    const timer = setTimeout(() => {
      if (!cancelled) setKlineLoading(false);
    }, 15000);

    const load = async () => {
      const etfCacheKey = `etf_${etfCode}`;
      const navCacheKey = fund.code;
      const [cached, navCached] = await Promise.all([
        getKlineCache(etfCacheKey, period),
        getKlineCache(navCacheKey, period),
      ]);
      if (!cancelled) {
        if (useEtfKline && cached?.length) {
          clearTimeout(timer);
          setKlineData(cached);
          setKlineLoading(false);
          setEtfKlineError(null);
          getKlineCacheTime(etfCacheKey, period).then((ts) => {
            if (ts) {
              setKlineFetchedAt(ts);
              setKlineAsOf(asOfFromKlines(cached));
            }
          });
          return;
        }
        if (!useEtfKline && navCached?.length) {
          clearTimeout(timer);
          setKlineData(navCached);
          setKlineLoading(false);
          setEtfKlineError(null);
          getKlineCacheTime(navCacheKey, period).then((ts) => {
            if (ts) {
              setKlineFetchedAt(ts);
              setKlineAsOf(asOfFromKlines(navCached));
            }
          });
          return;
        }
      }
      const [etfData, navData] = await Promise.all([
        etfCode ? dataSourceService.fetchEtfKLine(etfCode, period) : Promise.resolve([]),
        dataSourceService.fetchKLine(fund.code, period),
      ]);
      if (!cancelled) {
        if (etfData.length > 0) setKlineCache(etfCacheKey, period, etfData);
        if (navData.length > 0) setKlineCache(navCacheKey, period, navData);
        clearTimeout(timer);
        setKlineLoading(false);
        // 最终展示的 K 线（与下方 setKlineData 保持一致）：用于派生数据时间
        const finalKline = useEtfKline ? (etfData.length > 0 ? etfData : navData) : navData;
        setKlineAsOf(asOfFromKlines(finalKline));
        setKlineFetchedAt(Date.now());
        if (useEtfKline) {
          if (etfData.length > 0) {
            // 真实 K 线载入成功：展示真实 K 线，保留开关为开启
            setKlineData(etfData);
            setEtfKlineError(null);
          } else {
            // 真实 K 线获取失败（接口冷却/网络异常）：保留用户切换意图（开关不静默切回），
            // 回退展示净值走势并提示原因，避免「点一下立即跳回」造成困惑
            setKlineData(navData.length > 0 ? navData : []);
            setEtfKlineError("真实 K 线获取失败（接口冷却或网络异常），已显示净值走势，可稍后重试");
          }
        } else {
          setKlineData(navData);
          setEtfKlineError(null);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fund?.code, period, etfCode, useEtfKline, klineRefreshKey]);

  // ─── 形态检测 + 评分 ──────────────────────────
  useEffect(() => {
    if (klineData.length === 0) return;
    const patterns = detectPatterns(klineData);
    setKlineDetectedPatterns(patterns);
    setKlinePatterns(formatPatternsSummary(patterns, klineData));
    setKlineAnalysis(null);
    setKlineAnalysisError(null);
    setSignalResult(evaluateSignal(klineData, patterns));
  }, [klineData]);

  // ─── AI 分析 ──────────────────────────────────
  const handleAnalyzeKline = useCallback(async () => {
    if (!fund || klineData.length === 0) return;
    setKlineAnalyzing(true);
    setKlineAnalysisError(null);
    try {
      const { result, usedAI, error } = await analyzeKline({
        code: fund.code,
        name: fund.name || fund.code,
        klineData,
        period,
        costNAV: fund.costNAV,
        currentNAV: valuations[fund.code]?.quote?.nav,
        shares: fund.shares,
      });
      setKlineAnalysis(result);
      if (!usedAI && error) setKlineAnalysisError(error);
    } catch (e) {
      setKlineAnalysisError(e instanceof Error ? e.message : "分析失败");
    }
    setKlineAnalyzing(false);
  }, [fund, klineData, period, valuations]);

  // ─── 持仓穿透 ─────────────────────────────────
  useEffect(() => {
    if (!fund) return;
    let cancelled = false;
    // 切换基金时立即清空旧重仓股数据，避免新旧数据混用
    setPortfolio(null);
    setPortfolioLoading(true);
    const load = async () => {
      const cached = await getPortfolioCache(fund.code);
      const hasValidRatio = (cached?.holdings ?? []).some((h) => h.ratio > 0);
      if (!cancelled && cached && hasValidRatio) {
        setPortfolio(cached);
        setPortfolioLoading(false);
        return;
      }
      // 缓存为空或全 0 比例时清理，避免旧脏缓存阻塞后续刷新
      if (cached && !hasValidRatio) {
        await deletePortfolioCache(fund.code);
      }
      const data = await dataSourceService.fetchFundPortfolio(fund.code);
      const dataHasValidRatio = (data?.holdings ?? []).some((h) => h.ratio > 0);
      if (!cancelled && data && data.holdings.length > 0 && dataHasValidRatio) {
        await setPortfolioCache(fund.code, data);
        setPortfolio(data);
      }
      if (!cancelled) setPortfolioLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
    // 用 fund?.code 代替 fund（对象引用 → 字符串值比较），避免 holdings 数组引用变化
    // 导致 fund 对象引用变化、effect 反复取消重跑
  }, [fund?.code, portfolioRefreshKey]);

  // ─── Prompt ───────────────────────────────────
  /** Analysis Context Pack（P0-B 数据质量透出）：从既有状态构建，喂给 Prompt 与 UI */
  const contextPack = useMemo<AnalysisContextPack>(() => {
    const fundQuote = fund ? valuations[fund.code]?.quote : null;
    const emAvailable =
      !!emFactors &&
      (emFactors.capitalFlow.available ||
        emFactors.sector.available ||
        emFactors.peerRank.available);
    return buildContextPack({
      hasQuote: !!fundQuote,
      quoteAsOf: quotesAsOf,
      klineData,
      isRealKline,
      hasTechnical: klineData.length > 0,
      hasFundamental: portfolio != null,
      fundamentalAsOf: portfolioAsOf,
      emAvailable,
      regimeAvailable: regime != null,
      hasNews: false,
    });
  }, [
    fund,
    valuations,
    quotesAsOf,
    klineData,
    isRealKline,
    portfolio,
    portfolioAsOf,
    emFactors,
    regime,
  ]);

  /** 依据当前模板类型与时间序列构建分析 Prompt（供「生成」与「直接调用 AI」复用） */
  const buildPrompt = useCallback(() => {
    const etfMappingsForFund = etfMappings.filter((m) => m.otcCode === fund?.code);
    const klineDataMap: Record<string, KLineData[]> = {};
    for (const m of etfMappingsForFund) {
      if (klineData.length > 0) klineDataMap[m.exchangeCode] = klineData;
    }
    const quotesForPrompt = Object.values(valuations)
      .map((v) => v.quote)
      .filter(Boolean) as FundQuote[];
    return generatePrompt({
      templateType,
      holdings: fund ? [fund] : [],
      quotes: quotesForPrompt,
      selectedIds: fund ? [fund.id] : [],
      etfMappings,
      alerts,
      klineDataMap: Object.keys(klineDataMap).length > 0 ? klineDataMap : undefined,
      strategies: getStrategiesByIds(selectedStrategyIds),
      contextPack,
    });
  }, [
    fund,
    templateType,
    valuations,
    etfMappings,
    alerts,
    klineData,
    selectedStrategyIds,
    contextPack,
  ]);

  const handleGenerate = useCallback(() => {
    const p = buildPrompt();
    setPrompt(p);
    setCopied(false);
    setAiResponse("");
    setAiError(null);
    setActiveTab("prompt");
  }, [buildPrompt]);

  const handleGenerateKlinePrompt = useCallback(() => {
    setTemplateType("kline_enhanced");
    const etfMappingsForFund = etfMappings.filter((m) => m.otcCode === fund?.code);
    const klineDataMap: Record<string, KLineData[]> = {};
    for (const m of etfMappingsForFund) {
      if (klineData.length > 0) klineDataMap[m.exchangeCode] = klineData;
    }
    const quotesForPrompt = Object.values(valuations)
      .map((v) => v.quote)
      .filter(Boolean) as FundQuote[];
    const result = generatePrompt({
      templateType: "kline_enhanced",
      holdings: fund ? [fund] : [],
      quotes: quotesForPrompt,
      selectedIds: fund ? [fund.id] : [],
      etfMappings,
      alerts,
      klineDataMap: Object.keys(klineDataMap).length > 0 ? klineDataMap : undefined,
      strategies: getStrategiesByIds(selectedStrategyIds),
      contextPack,
    });
    setPrompt(result);
    setCopied(false);
    setAiResponse("");
    setAiError(null);
    setActiveTab("prompt");
  }, [fund, valuations, etfMappings, alerts, klineData, selectedStrategyIds, contextPack]);

  /** 直接调用已配置的 AI 平台，将生成的 Prompt 提交并返回 AI 的回复 */
  const handleCallAI = useCallback(async () => {
    const p = prompt || buildPrompt();
    if (!prompt) {
      setPrompt(p);
      setCopied(false);
    }
    if (!p) return;
    const ai = getDefaultAI();
    if (!ai) {
      setAiError("请先在设置页配置 AI 平台（设置 → AI 平台）");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const resp = await callAI(ai, [{ role: "user", content: p }]);
      setAiResponse(resp);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 调用失败");
    } finally {
      setAiLoading(false);
    }
  }, [prompt, buildPrompt]);

  const handleCopy = useCallback(async () => {
    const text = activeTab === "ai" ? aiResponse : prompt;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [prompt, aiResponse, activeTab]);

  return {
    fund,
    etfMappings: etfMappings as any,
    alerts,
    handleSwitchFund,
    period,
    setPeriod,
    klineData,
    klineLoading,
    klineAsOf,
    klineFetchedAt,
    klineRefreshKey,
    setKlineRefreshKey,
    fundIsOnExchangeEtf,
    useEtfKline,
    setUseEtfKline,
    showMA,
    setShowMA,
    showBollinger,
    setShowBollinger,
    handleRefreshKline,
    isRealKline,
    etfKlineError,
    setEtfKlineError,
    klineDetectedPatterns,
    klinePatterns,
    klineAnalysis,
    klineAnalyzing,
    klineAnalysisError,
    handleAnalyzeKline,
    hoveredKlineIndex,
    setHoveredKlineIndex,
    selectedKlineIndex,
    setSelectedKlineIndex,
    effectiveKlineHighlight,
    handlePatternClick,
    signalResult,
    showSignalDetail,
    setShowSignalDetail,
    etfCode,
    emFactors,
    regime,
    emLoading,
    regimeLoading,
    eastmoneyConfig,
    valuations,
    refreshQuotes,
    quotesLoading,
    quotes,
    quotesAsOf,
    quotesFetchedAt,
    portfolio,
    portfolioLoading,
    portfolioAsOf,
    portfolioFetchedAt,
    handleRefreshPortfolio,
    refreshing,
    editOpen,
    setEditOpen,
    adjustOpen,
    setAdjustOpen,
    capturingScore,
    handleCaptureScore,
    handleRefreshQuotes,
    prompt,
    setPrompt,
    copied,
    templateType,
    setTemplateType,
    activeTab,
    setActiveTab,
    aiResponse,
    setAiResponse,
    aiLoading,
    aiError,
    setAiError,
    aiExpanded,
    setAiExpanded,
    aiConfigured,
    handleGenerate,
    handleGenerateKlinePrompt,
    handleCallAI,
    handleCopy,
    selectedStrategyIds,
    setSelectedStrategyIds,
    toggleStrategy,
    clearStrategies,
    contextPack,
  };
}

const FundDetailContext = createContext<FundDetailController | null>(null);

export function FundDetailProvider({
  fundId,
  children,
}: {
  fundId: string;
  children: React.ReactNode;
}) {
  const controller = useFundDetailController(fundId);
  return <FundDetailContext.Provider value={controller}>{children}</FundDetailContext.Provider>;
}

export function useFundDetail(): FundDetailController {
  const ctx = useContext(FundDetailContext);
  if (!ctx) {
    throw new Error("useFundDetail 必须在 <FundDetailProvider> 内使用");
  }
  return ctx;
}
