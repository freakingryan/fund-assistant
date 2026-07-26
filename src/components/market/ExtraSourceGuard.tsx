/**
 * 同花顺 / 互动易数据源开关护栏。
 * 未开启 extraSources 或未配置 Worker 反代时，渲染占位提示而非卡片内容。
 *
 * @module market/ExtraSourceGuard
 */

import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { useSettingsStore } from "@/stores/settings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ExtraSourceGuard({ children }: { children: ReactNode }) {
  const enabled = useSettingsStore((s) => s.settings.dataSource.extraSources.enabled);
  const proxyMode = useSettingsStore((s) => s.settings.dataSource.eastmoney.mode);
  const proxyUrl = useSettingsStore((s) => s.settings.dataSource.eastmoney.proxyUrl);
  const navigate = useNavigate();

  if (!enabled) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground mb-3">同花顺 / 互动易数据源未开启</p>
          <Button size="sm" variant="outline" onClick={() => navigate(ROUTES.settings)}>
            前往设置开启
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (proxyMode !== "proxy" || !proxyUrl) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            需配置 Worker 反代：同花顺/巨潮经浏览器直连会被 CORS 拦截
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate(ROUTES.settings)}>
            前往设置配置
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
