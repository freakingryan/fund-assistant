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
import ConsensusEpsPanel from "./ConsensusEpsPanel";
import HotListPanel from "./HotListPanel";
import IrmPanel from "./IrmPanel";
import MarketStatusBar from "./MarketStatusBar";
import EtfOptionPanel from "./EtfOptionPanel";

export default function MarketPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">市场情绪</h1>
        <p className="text-xs text-muted-foreground">
          打板情绪 / 龙虎榜 / 北向资金来自东方财富增强；一致预期EPS / 人气热榜 /
          互动易来自同花顺与巨潮（设置 → 数据源开启后展示）。
        </p>
      </div>
      <MarketStatusBar />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <EtfOptionPanel />
        </div>
        <LimitUpBoardPanel />
        <NorthboundPanel />
        <div className="lg:col-span-2">
          <DragonTigerPanel />
        </div>
        <ConsensusEpsPanel />
        <HotListPanel />
        <div className="lg:col-span-2">
          <IrmPanel />
        </div>
      </div>
    </div>
  );
}
