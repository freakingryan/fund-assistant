// 数据可视化专用配色 —— 非主题色、非涨跌方向语义色。
// 刻意不跟随 light/dark 主题，以保证 MA 折线与其图例颜色一致、可被用户区分。
// 图表线条 stroke 的 hex 同理保留（图表需稳定辨识度）。
export const MA_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#14b8a6'] as const
export const MA_LABELS = ['MA5', 'MA10', 'MA20', 'MA60'] as const
