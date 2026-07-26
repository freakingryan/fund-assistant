/**
 * 互动易（巨潮 cninfo）数据源（fund-assistant 自实现）
 *
 * 两步 POST：① 按代码取 orgId(secid)；② 用 orgId 拉取投资者问答（参数放 query string）。
 * 零鉴权、免登录。经共享 Worker 反代（buildProxyFetch）。
 *
 * @module extraSources/cninfo
 */

import type { CninfoIrmItem, EastmoneyDataSourceConfig } from "@/types";
import { buildProxyFetch } from "../proxyFetch";

const CNINFO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";

function cninfoFetch(config: EastmoneyDataSourceConfig): typeof fetch {
  const base = buildProxyFetch(config);
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", CNINFO_UA);
    return base(input, { ...init, headers });
  };
}

/**
 * 互动易问答（投资者提问 + 公司回复）。
 * @param code 6 位股票代码
 * @param pageNum 页码（默认 1）
 * @param pageSize 每页条数（默认 30）
 */
export async function getIrmQa(
  code: string,
  config: EastmoneyDataSourceConfig,
  pageNum = 1,
  pageSize = 30,
): Promise<CninfoIrmItem[]> {
  const fetchImpl = cninfoFetch(config);

  // Step1: 取 orgId（secid）
  const r1 = await fetchImpl("https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ keyWord: code }).toString(),
  });
  if (!r1.ok) throw new Error(`互动易查询失败: ${r1.status}`);
  const d1 = (await r1.json()) as { data?: Array<{ secid?: string }> };
  const orgId = d1.data?.[0]?.secid;
  if (!orgId) return [];

  // Step2: 参数必须放 query string（body 空），否则 HTTP 400
  const qs = new URLSearchParams({
    stockCode: code,
    orgId,
    pageNum: String(pageNum),
    pageSize: String(pageSize),
  });
  const r2 = await fetchImpl(
    `https://irm.cninfo.com.cn/newircs/company/question?${qs.toString()}`,
    { method: "POST" },
  );
  if (!r2.ok) throw new Error(`互动易问答失败: ${r2.status}`);
  const d2 = (await r2.json()) as { rows?: Array<Record<string, unknown>> };
  const rows = d2.rows ?? [];
  return rows
    .map((it) => ({
      code: String(it.stockCode ?? code),
      company: it.companyShortName != null ? String(it.companyShortName) : undefined,
      question: it.mainContent != null ? String(it.mainContent) : "",
      answer: it.attachedContent != null ? String(it.attachedContent) : null,
      askTime: it.pubDate != null ? Number(it.pubDate) : undefined,
      answerer: it.answerer != null ? String(it.answerer) : undefined,
    }))
    .filter((it) => it.question);
}
