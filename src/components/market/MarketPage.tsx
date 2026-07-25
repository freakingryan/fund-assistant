/**
 * 市场情绪页
 * 聚合打板情绪 / 龙虎榜 / 北向资金三张市场级数据卡片。全部走 stock-sdk 网络 service，
 * 受「东财增强」开关门控（未开启时各卡显示占位提示）。
 *
 * @module market/MarketPage
 */

import LimitUpBoardPanel from "./LimitUpBoardPanel";
import DragonTigerPanel from "./DragonTigerPanel";
import NorthboundPanel from "./NorthboundPanel";

export default function MarketPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">市场情绪</h1>
        <p className="text-xs text-muted-foreground">
          打板情绪 / 龙虎榜 / 北向资金，数据来自东方财富增强（设置 → 数据源开启后展示）。
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LimitUpBoardPanel />
        <NorthboundPanel />
        <div className="lg:col-span-2">
          <DragonTigerPanel />
        </div>
      </div>
    </div>
  );
}
