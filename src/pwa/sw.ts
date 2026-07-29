/// <reference lib="webworker" />
/**
 * 自定义 Service Worker（injectManifest 模式）
 *
 * vite-plugin-pwa 以本文件为入口编译出 sw.js，而非自动生成的默认 SW。
 * 这样我们才能挂载 `periodicsync`（Chromium 周期后台同步）与 `push` /
 * `notificationclick` 监听，实现「页面关闭后仍能触发投资计划提醒」。
 *
 * 注意：
 *  - 本文件及其 import 的模块链（backgroundScan → scanCapabilities → scanCore 等）
 *    必须全部 SW 安全（无 DOM / React / Zustand）。
 *  - `self.__WB_MANIFEST` 由 workbox 在构建期注入（预缓存清单）。
 *  - 开发态 devOptions 关闭，SW 仅在 `vite build` + `vite preview` 下生效，
 *    以免干扰 HMR 与 JSONP 取数联调。
 */

import { precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { runBackgroundScan } from "@/services/pwa/backgroundScan";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

const SCAN_TAG = "plan-background-scan";
const APP_URL = "/fund-assistant/";

self.skipWaiting();
clientsClaim();

// 预缓存应用外壳（workbox 注入清单）
precacheAndRoute(self.__WB_MANIFEST || []);

// ── 周期后台同步：页面关闭后按浏览器节奏触发扫描 ──
self.addEventListener("periodicsync", (event) => {
  const e = event as unknown as { tag: string; waitUntil: (p: Promise<unknown>) => void };
  if (e.tag === SCAN_TAG) {
    e.waitUntil(runBackgroundScan());
  }
});

// ── 服务端推送（可选，预留）：解析 payload 弹通知 ──
self.addEventListener("push", (event) => {
  const e = event as unknown as {
    data?: { json: () => unknown };
    waitUntil: (p: Promise<unknown>) => void;
  };
  let payload: { title?: string; body?: string } = {};
  try {
    payload = (e.data ? e.data.json() : {}) as { title?: string; body?: string };
  } catch {
    // 解析失败 → 使用默认文案
  }
  const title = payload.title || "基金投资助手";
  const body = payload.body || "有新的投资计划提醒";
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/fund-assistant/icons/icon-192.png",
      badge: "/fund-assistant/icons/icon-192.png",
      data: { url: APP_URL },
    }),
  );
});

// ── 点击通知：聚焦已打开的页面或新开页面 ──
self.addEventListener("notificationclick", (event) => {
  const e = event as unknown as {
    notification: { close: () => void; data?: { url?: string } };
    waitUntil: (p: Promise<unknown>) => void;
  };
  e.notification.close();
  const targetUrl = e.notification?.data?.url || APP_URL;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients as Array<{ focus?: () => void }>) {
        if (client.focus) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});
