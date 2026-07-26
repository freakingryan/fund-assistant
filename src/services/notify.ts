/**
 * 统一通知契约 + 噪声控制
 *
 * 单一入口 `notify()`：先过噪声闸门（安静时段 / 类型免打扰 / 去重 / 最小间隔 / 频率限制），
 * 再按设置通道分发到 inApp(应用内铃铛) / browser(浏览器推送) / feishu(Webhook)。
 *
 * 调用方（自动同步、投资计划扫描等）统一走 `notify()`，不再各自直发浏览器通知。
 *
 * @module notify
 */

import type { NotificationChannel } from "@/types";
import type { AppNotification } from "@/types";
import { useNotificationsStore } from "@/stores/notifications";
import { useSettingsStore } from "@/stores/settings";
import { sendNotification } from "./notification";

export interface NotifyInput {
  type: AppNotification["type"];
  title: string;
  body?: string;
  /**
   * 本次调用允许使用的通道（子集）。省略则使用设置中的 channels。
   * 仅能启用「全局已开启」的通道（与 settings.channels 取交集），不能凭空开启未启用的通道。
   */
  channels?: NotificationChannel[];
}

/** 噪声控制运行态（模块级，跨调用保持） */
const lastByDedupKey = new Map<string, number>();
const sendTimestamps: number[] = [];

/** 判断当前是否处于安静时段（支持跨午夜） */
function inQuietHours(start: string, end: string): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) return false;
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  if (s < e) return cur >= s && cur <= e;
  return cur >= s || cur <= e; // 跨午夜
}

async function sendFeishu(webhook: string, input: NotifyInput): Promise<void> {
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text: `${input.title}${input.body ? `\n${input.body}` : ""}` },
      }),
    });
  } catch {
    /* 飞书 webhook 浏览器直发可能受 CORS 限制，best-effort，失败静默 */
  }
}

/**
 * 发送一条通知（统一入口）。
 * 返回 true 表示通过噪声闸门并已分发；false 表示被噪声控制拦截。
 */
export function notify(input: NotifyInput): boolean {
  const settings = useSettingsStore.getState().settings;
  const noise = settings.notifications.noise;
  const globalChannels = settings.notifications.channels;

  // 1) 类型免打扰
  if (noise.typeOptOut.includes(input.type)) return false;
  // 2) 安静时段
  if (inQuietHours(noise.quietHoursStart, noise.quietHoursEnd)) return false;

  const now = Date.now();

  // 3) 去重（同 type+title 在窗口内仅首条生效）
  const key = `${input.type}:${input.title}`;
  const last = lastByDedupKey.get(key) ?? 0;
  if (now - last < noise.dedupWindowMin * 60_000) return false;
  // 4) 最小间隔
  const lastSend = sendTimestamps.length ? sendTimestamps[sendTimestamps.length - 1] : 0;
  if (lastSend && now - lastSend < noise.minIntervalSec * 1000) return false;
  // 5) 频率限制（每分钟上限）
  const cutoff = now - 60_000;
  while (sendTimestamps.length && sendTimestamps[0] < cutoff) sendTimestamps.shift();
  if (sendTimestamps.length >= noise.maxPerMinute) return false;

  // 通过所有噪声闸门 → 记录运行态并分发
  lastByDedupKey.set(key, now);
  sendTimestamps.push(now);

  const effective = (input.channels ?? globalChannels).filter((c) => globalChannels.includes(c));

  if (effective.includes("inApp")) {
    void useNotificationsStore.getState().addNotification({
      type: input.type,
      title: input.title,
      body: input.body,
    });
  }
  if (effective.includes("browser")) {
    sendNotification(input.title, input.body ? { body: input.body } : undefined);
  }
  if (effective.includes("feishu") && settings.notifications.feishuWebhook) {
    void sendFeishu(settings.notifications.feishuWebhook, input);
  }
  return true;
}
