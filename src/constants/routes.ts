/**
 * 应用路由路径集中定义。
 *
 * 把全站散落的字面量路径（如 `navigate('/detail/' + id)`、`NavLink to="/holdings"`）
 * 收敛到单一来源，避免路径拼写错误与重构漂移。
 *
 * 注意：
 * - 路由「注册」仍在 src/router.tsx 中完成（/detail/:id、/stock/:code 等含动态段）。
 * - 此处仅作为「导航」来源，二者需保持同步（仅静态路径）。
 * - 函数式路径（detail / stock）用于拼接动态参数，避免在业务代码里手写模板字符串。
 * - 该模块为叶子模块，无任何 import 依赖，天然规避 AppLayout → router 的循环引用。
 */

export const ROUTES = {
  /** 仪表盘 / 概览 */
  home: "/",
  /** 持仓管理 */
  holdings: "/holdings",
  /** 基金详情（动态 id） */
  detail: (id: string) => `/detail/${id}`,
  /** 基金详情入口（无 id，自动跳转首个持仓） */
  detailGateway: "/detail",
  /** 个股 / ETF 详情（动态 code） */
  stock: (code: string) => `/stock/${code}`,
  /** 投资计划 */
  plans: "/plans",
  /** 提示词模板 */
  prompts: "/prompts",
  /** 通知 */
  notifications: "/notifications",
  /** 评分回测 */
  backtest: "/backtest",
  /** 综合评分排行榜 */
  ranking: "/ranking",
  /** 每日日报 */
  daily: "/daily",
  /** 设置 */
  settings: "/settings",
  /** 市场情绪（打板 / 龙虎榜 / 北向） */
  market: "/market",
} as const;
