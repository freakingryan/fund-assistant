/**
 * ima OpenAPI 取数层（BYOK，仅知识库路径）
 *
 * 角色定位：ima 在本功能里**只当「取数源 + 语义检索」**，不做生成式分析、不碰笔记。
 * 密钥由用户自带（设置页填写 clientId/apiKey，存本地 IndexedDB），与现有 AI key 同待遇。
 *
 * 认证：每个请求带两个自定义 Header（非标准 Bearer）：
 *   ima-openapi-clientid / ima-openapi-apikey + Content-Type: application/json
 * Base：https://ima.qq.com/openapi/wiki/v1/...
 * 成功判定：HTTP 200 且响应体 `code === 0`。
 *
 * CORS 兜底：浏览器直连 ima 若被 CORS 拦，可填 `proxyUrl`（Cloudflare Worker 等）。
 *   代理只转发 + 补 CORS 回包，**不持密钥**（key 始终从浏览器发出）。
 *   约定代理契约：POST { url, method, headers, body }，代理据此转发上游并把响应体回传。
 *
 * 路径/坑（已核实）：
 *  - 前缀必须是 `/openapi/wiki/v1/`（旧 `/wiki/v1/`、`/api/v1/` 会 401）。
 *  - `get_media_info` 返回的 `url_info.url` 是签名短链，需再 fetch 一次才拿到正文；
 *    笔记类（media_type 11）则直接附 `note_content` 正文（我们的主路径）。
 *
 * @module services/ima
 */

import type { ImaConfig } from "@/types";

/** ima 取数错误：区分鉴权 / 网络 / 未找到，便于 UI 给出不同引导 */
export class ImaError extends Error {
  code: "auth" | "network" | "notfound" | "unknown";
  constructor(code: ImaError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ImaError";
  }
}

/** ima OpenAPI 基址（已核实，自带 CORS* 不保证，故需 proxy 兜底） */
const IMA_BASE = "https://ima.qq.com";

/** 单条从知识库取回的媒体（投资意见） */
export interface ImaMediaItem {
  mediaId: string;
  title: string;
  /** note_content 或 url 抓回的正文；可能为空（如仅索引无正文） */
  text: string;
  /** 媒体创建时间戳（ms），来自列表项 create_time；用于同步增量与观点日期 */
  createdAt?: number;
}

function headersFor(cfg: ImaConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "ima-openapi-clientid": cfg.clientId,
    "ima-openapi-apikey": cfg.apiKey,
  };
}

/**
 * 统一的 ima 请求：直连或经 proxyUrl 转发，解析 `code` 业务码，归一为 ImaError。
 */
async function imaRequest<T>(cfg: ImaConfig, path: string, body: unknown): Promise<T> {
  const url = `${IMA_BASE}${path}`;
  const headers = headersFor(cfg);

  let res: Response;
  if (cfg.proxyUrl) {
    const proxyBase = cfg.proxyUrl.replace(/\/+$/, "");
    res = await fetch(proxyBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method: "POST", headers, body }),
    }).catch((e) =>
      Promise.reject(
        new ImaError(
          "network",
          `网络/CORS 失败：${(e as Error).message}。可尝试配置 proxyUrl 代理。`,
        ),
      ),
    );
  } else {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch((e) =>
      Promise.reject(
        new ImaError(
          "network",
          `网络/CORS 失败：${(e as Error).message}。可尝试配置 proxyUrl 代理。`,
        ),
      ),
    );
  }

  if (!res.ok) {
    if (res.status === 401)
      throw new ImaError("auth", "ima 密钥无效或已过期（约 1 月有效期），请重新生成。");
    throw new ImaError("network", `ima 接口返回 ${res.status}，请检查网络或配置 proxyUrl。`);
  }

  const data = (await res.json().catch(() => ({}))) as T & { code?: number; msg?: string };
  const d = data as { code?: number; msg?: string };
  if (typeof d.code === "number" && d.code !== 0) {
    if ([401, 10003, 1000].includes(d.code))
      throw new ImaError("auth", d.msg || "ima 密钥无效或已过期，请重新生成。");
    throw new ImaError("unknown", d.msg || `ima 错误码 ${d.code}`);
  }
  return data;
}

/** 取知识库内媒体正文（notes 直接附 note_content；网页类需二次抓取 url_info.url） */
async function getMediaText(cfg: ImaConfig, mediaId: string): Promise<string> {
  const data = await imaRequest<{ data?: { note_content?: string; url_info?: { url?: string } } }>(
    cfg,
    "/openapi/wiki/v1/get_media_info",
    { media_id: mediaId },
  );
  const inner = data?.data ?? {};
  if (inner.note_content && String(inner.note_content).trim()) return String(inner.note_content);
  if (inner.url_info?.url) {
    const t = await fetchUrlText(cfg, inner.url_info.url);
    if (t) return t;
  }
  return "";
}

/** 枚举知识库（可选文件夹）下的媒体列表，分页直到取完（上限 20 页防失控） */
async function listKbMedia(
  cfg: ImaConfig,
): Promise<Array<{ mediaId: string; title: string; createdAt?: number }>> {
  const out: Array<{ mediaId: string; title: string; createdAt?: number }> = [];
  let cursor = "";
  let hasMore = true;
  let pages = 0;
  while (hasMore && pages < 20) {
    const body: Record<string, unknown> = { knowledge_base_id: cfg.kbId, limit: 50 };
    if (cfg.kbFolderId) body.folder_id = cfg.kbFolderId;
    if (cursor) body.cursor = cursor;
    const data = await imaRequest<{
      data?: {
        list?: Array<{ media_id: string; title?: string; create_time?: number }>;
        cursor?: string;
        has_more?: boolean;
      };
    }>(cfg, "/openapi/wiki/v1/get_knowledge_list", body);
    const inner = data?.data ?? {};
    for (const it of inner.list ?? []) {
      out.push({
        mediaId: it.media_id,
        title: it.title ?? "",
        createdAt: it.create_time ? it.create_time * 1000 : undefined,
      });
    }
    cursor = inner.cursor ?? "";
    hasMore = Boolean(inner.has_more) && Boolean(cursor);
    pages++;
  }
  return out;
}

/** 经直连 / proxy 抓取一个 URL 的正文（best-effort，失败返回空串，不阻断同步） */
async function fetchUrlText(cfg: ImaConfig, url: string): Promise<string> {
  try {
    let res: Response;
    if (cfg.proxyUrl) {
      const proxyBase = cfg.proxyUrl.replace(/\/+$/, "");
      res = await fetch(proxyBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, method: "GET" }),
      });
    } else {
      res = await fetch(url);
    }
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

/** 连通性探测：用 get_addable_knowledge_base_list 验证 key 可达 */
export async function probeConnection(cfg: ImaConfig): Promise<{ ok: boolean; message: string }> {
  if (!cfg.enabled || !cfg.clientId || !cfg.apiKey)
    return { ok: false, message: "请先在设置中填写 ima 的 clientId / apiKey 并启用。" };
  try {
    await imaRequest(cfg, "/openapi/wiki/v1/get_addable_knowledge_base_list", {
      cursor: "",
      limit: 1,
    });
    return { ok: true, message: "ima 连接成功" };
  } catch (e) {
    return { ok: false, message: e instanceof ImaError ? e.message : String(e) };
  }
}

/**
 * 从知识库同步投资意见（用户目标·首选路径）。
 * 前提：用户须在 ima 侧把对话「保存到知识库」的指定 KB/文件夹。
 * @returns 取回正文的媒体项（已过滤空正文）；每条由调用方跑 extractDirections(Case A)。
 */
export async function syncFromImaKb(
  cfg: ImaConfig,
  opts?: { sinceTs?: number },
): Promise<ImaMediaItem[]> {
  if (!cfg.kbId) throw new ImaError("unknown", "请先在设置中填写知识库 ID（kbId）。");
  const list = await listKbMedia(cfg);
  const filtered = opts?.sinceTs
    ? list.filter((m) => !m.createdAt || m.createdAt >= opts.sinceTs!)
    : list;
  const items = await Promise.all(
    filtered.map(async (m) => ({
      mediaId: m.mediaId,
      title: m.title,
      text: await getMediaText(cfg, m.mediaId),
      createdAt: m.createdAt,
    })),
  );
  return items.filter((i) => i.text.trim().length > 0);
}

/**
 * URL 抓取兜底：经 ima import_urls 把公众号/网页正文入库后取回。
 * 注意 import_urls 需 knowledge_base_id + folder_id（均必填），故要求设置里填了 kbFolderId。
 */
export async function fetchArticle(url: string, cfg: ImaConfig): Promise<{ markdown: string }> {
  if (!cfg.kbId || !cfg.kbFolderId)
    throw new ImaError("unknown", "使用 ima 抓取需先在设置中填写知识库 ID 与文件夹 ID。");
  const data = await imaRequest<{
    data?: { results?: Record<string, { ret_code?: number; media_id?: string }> };
  }>(cfg, "/openapi/wiki/v1/import_urls", {
    knowledge_base_id: cfg.kbId,
    folder_id: cfg.kbFolderId,
    urls: [url],
  });
  const results = data?.data?.results ?? {};
  const entry = results[url];
  if (!entry || !entry.media_id)
    throw new ImaError("notfound", "ima 抓取失败：未返回媒体 ID（链接可能不被支持或需登录）。");
  const text = await getMediaText(cfg, entry.media_id);
  if (!text)
    throw new ImaError(
      "notfound",
      "ima 已抓取但未取到正文（公众号/小红书反爬或需登录）。请改用粘贴文本。",
    );
  return { markdown: text };
}
