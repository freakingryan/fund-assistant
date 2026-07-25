/**
 * DataAsOf — 统一展示「接口数据对应的时间」
 *
 * 主文案：数据截至 {日期}（接口返回的数据时点，如周五收盘 / 净值日期 / K 线末根）
 * 副文案：获取于 {时间}（调用接口 / 缓存写入时间，北京时间）——体现数据来源与缓存时效
 * 若仅有获取时间而无数据时点，则只展示「数据获取于 {时间}」。
 */
import { CalendarClock } from "lucide-react";
import { formatDateOnly, formatDateTime } from "@/lib/dataTime";

interface Props {
  /** 数据对应的时间（接口内嵌，优先） */
  asOf?: number | null;
  /** 调用接口 / 缓存写入的时间（回退） */
  fetchedAt?: number | null;
  /** 行内紧凑模式：主副文案同一行，适合标题行 */
  inline?: boolean;
  /** 主文案前缀（默认「数据」），用于区分数据类型，如「综合评分」→「综合评分截至 …」 */
  label?: string;
  className?: string;
}

export default function DataAsOf({
  asOf,
  fetchedAt,
  inline,
  label = "数据",
  className = "",
}: Props) {
  const hasAsOf = asOf != null && !Number.isNaN(asOf);
  const hasFetched = fetchedAt != null && !Number.isNaN(fetchedAt);

  if (!hasAsOf && !hasFetched) return null;

  const main = hasAsOf
    ? `${label}截至 ${formatDateOnly(asOf)}`
    : `${label}获取于 ${formatDateTime(fetchedAt)}`;

  const sub = hasFetched ? `获取于 ${formatDateTime(fetchedAt)}（北京时间）` : undefined;

  const title = [
    hasAsOf ? `${label}时间：${formatDateTime(asOf)}（接口返回）` : null,
    hasFetched ? `获取时间：${formatDateTime(fetchedAt)}（北京时间）` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (inline) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] text-muted-foreground ${className}`}
        title={title}
      >
        <CalendarClock className="h-3 w-3 opacity-70" />
        <span>{main}</span>
        {sub && <span className="opacity-70">· {sub}</span>}
      </span>
    );
  }

  return (
    <div className={`flex flex-col gap-0.5 ${className}`} title={title}>
      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
        <CalendarClock className="h-3 w-3 opacity-70" />
        {main}
      </span>
      {sub && <span className="text-[10px] text-muted-foreground/70 pl-4">{sub}</span>}
    </div>
  );
}
