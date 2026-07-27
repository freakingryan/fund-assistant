/**
 * 步骤指示器 — 5 步 SOP 的进度展示（当前/完成/未达态）。
 *
 * @module components/holdings/guide/GuideProgress
 */

interface Props {
  steps: string[];
  current: number;
  onJump?: (index: number) => void;
}

export default function GuideProgress({ steps, current, onJump }: Props) {
  return (
    <nav aria-label="步骤进度" className="flex items-center gap-1 sm:gap-2">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        const clickable = onJump && i <= current;
        return (
          <div key={label} className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onJump?.(i)}
              aria-current={state === "active" ? "step" : undefined}
              className={[
                "flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors shrink-0",
                state === "done" && "bg-up/10 text-up",
                state === "active" && "bg-primary text-primary-foreground",
                state === "todo" && "bg-muted text-muted-foreground",
                clickable && "cursor-pointer hover:opacity-80",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span
                className={[
                  "flex h-4 w-4 items-center justify-center rounded-full text-[9px]",
                  state === "done"
                    ? "bg-up text-white"
                    : state === "active"
                      ? "bg-primary-foreground/20"
                      : "bg-background/40",
                ].join(" ")}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline truncate">{label}</span>
            </button>
            {i < steps.length - 1 && (
              <div
                className={["h-px flex-1 min-w-[8px]", i < current ? "bg-up/40" : "bg-border"].join(
                  " ",
                )}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
