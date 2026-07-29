/**
 * 注册自定义 Service Worker（vite-plugin-pwa injectManifest，injectRegister:false）。
 *
 * 仅在 production 构建注册；开发态跳过，避免自定义 SW 干扰 HMR 与 JSONP 取数联调。
 * SW 注册后提供 PWA 离线外壳 + 周期后台扫描能力（周期扫描是否真正运行，
 * 由设置项 notifications.backgroundScan 在 runBackgroundScan 内决定）。
 *
 * @module pwa/registerSW
 */

export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return; // 开发态不注册

  const base = import.meta.env.BASE_URL || "/";
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((e) => console.warn("[SW] 注册失败", (e as Error)?.message ?? e));
  });
}
