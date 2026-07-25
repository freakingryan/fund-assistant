// 数据可视化专用配色 —— 非主题色、非涨跌方向语义色。
// 刻意不跟随 light/dark 主题，以保证 MA 折线与其图例颜色一致、可被用户区分。
// 图表线条 stroke 的 hex 同理保留（图表需稳定辨识度）。
//
// 集中所有图表组件散落的 hex/rgba 字面量，作为单一取色来源，避免配色漂移与重复定义。
export const MA_COLORS = ["#f59e0b", "#3b82f6", "#8b5cf6", "#14b8a6"] as const;
export const MA_LABELS = ["MA5", "MA10", "MA20", "MA60"] as const;

// ===== 涨跌方向语义色（涨红跌绿，中国习惯）=====
export const UP_COLOR = "#ef4444"; // 涨 / 命中 / 排名靠前
export const DOWN_COLOR = "#22c55e"; // 跌 / 未命中 / 排名靠后
export const NEUTRAL_GRAY = "#9ca3af"; // 中性 / 零轴
export const AMBER = "#f59e0b"; // 中段 / 警示

// ===== 基金类型配色（DashboardPage 持仓结构饼图）=====
export const TYPE_COLORS: Record<string, string> = {
  stock: "#ef4444",
  mixed: "#f97316",
  bond: "#22c55e",
  index: "#3b82f6",
  qdii: "#a855f7",
  money: "#06b6d4",
  etf: "#eab308",
  other: "#6b7280",
};
export const TYPE_FALLBACK = "#6b7280";

// 多系列兜底调色板（板块 / 多序列折线等）
export const SECTOR_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f97316",
  "#a855f7",
  "#06b6d4",
  "#eab308",
  "#ec4899",
  "#8b5cf6",
  "#10b981",
  "#f43f5e",
  "#6b7280",
];

// ===== K 线形态徽标配色（CandlestickChart 图例）=====
// 键类型用 string 放宽，避免 colors 模块反向依赖 klinePatterns 服务，保持叶子模块零 import。
export const PATTERN_STYLES: Partial<Record<string, { bg: string; text: string; border: string }>> =
  {
    hammer: { bg: "rgba(239,68,68,0.12)", text: "#dc2626", border: "#fca5a5" },
    bullish_marubozu: { bg: "rgba(239,68,68,0.12)", text: "#dc2626", border: "#fca5a5" },
    lower_shadow_yang: { bg: "rgba(239,68,68,0.12)", text: "#dc2626", border: "#fca5a5" },
    lower_shadow_yin: { bg: "rgba(239,68,68,0.12)", text: "#dc2626", border: "#fca5a5" },
    t_line: { bg: "rgba(239,68,68,0.12)", text: "#dc2626", border: "#fca5a5" },
    shooting_star: { bg: "rgba(34,197,94,0.12)", text: "#16a34a", border: "#86efac" },
    bearish_marubozu: { bg: "rgba(34,197,94,0.12)", text: "#16a34a", border: "#86efac" },
    upper_shadow_yin: { bg: "rgba(34,197,94,0.12)", text: "#16a34a", border: "#86efac" },
    inverted_t_line: { bg: "rgba(34,197,94,0.12)", text: "#16a34a", border: "#86efac" },
    doji: { bg: "rgba(156,163,175,0.12)", text: "#6b7280", border: "#d1d5db" },
    long_legged_doji: { bg: "rgba(156,163,175,0.12)", text: "#6b7280", border: "#d1d5db" },
    upper_shadow_yang: { bg: "rgba(156,163,175,0.12)", text: "#6b7280", border: "#d1d5db" },
    small_yang: { bg: "rgba(156,163,175,0.12)", text: "#6b7280", border: "#d1d5db" },
    small_yin: { bg: "rgba(156,163,175,0.12)", text: "#6b7280", border: "#d1d5db" },
  };

// ===== 回测图表配色 =====
export const RESULT_COLORS = {
  correct: UP_COLOR, // 涨红（命中）
  wrong: DOWN_COLOR, // 跌绿（未命中）
  neutral: NEUTRAL_GRAY, // 灰（中性）
};

export const ACCURACY_SERIES_COLORS = {
  accuracy: "#8b5cf6", // 蓝紫：准确率
  up: UP_COLOR, // 涨红：次日平均上涨
  down: DOWN_COLOR, // 跌绿：次日平均下跌
};

// ===== 图表辅助色（图例 / 光标 / 选中态 / 网格 / 折线）=====
export const BAND_FILL = "rgba(39,130,246,0.06)";
export const BAND_STROKE = "#3b82f6";
export const BAND_STROKE_SOFT = "#93c5fd";
export const CANDLE_SELECTED_UP = "#991b1b";
export const CANDLE_SELECTED_DOWN = "#166534";
export const LEGEND_SWATCH = "#93c5fd";
export const CURSOR_FILL = "rgba(148,163,184,0.1)";
export const CURSOR_STROKE = "rgba(148,163,184,0.3)";
export const KLINE_LINE = "#3b82f6";
