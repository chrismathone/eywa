import { EyIcon } from "@/components/icons/eywa-icons";

/** 상단 바 — 날짜 + 반 필터 칩 + "오늘 마감 X/N" 진행률 */
export function OneScreenTopBar({
  today,
  classTags,
  classFilter,
  onFilter,
  doneCount,
  total,
}: {
  today: string;
  classTags: readonly string[];
  classFilter: string;
  onFilter: (tag: string) => void;
  doneCount: number;
  total: number;
}) {
  const pctDone = total ? Math.round((doneCount / total) * 100) : 0;
  return (
    <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="bg-primary-soft text-primary flex size-7 items-center justify-center rounded-sm">
          <EyIcon name="check" size={14} />
        </span>
        <div>
          <p className="micro text-text-faint">수업 마감</p>
          <p className="text-foreground text-[13px] font-bold">{today}</p>
        </div>
      </div>

      <span className="bg-line h-4 w-px" aria-hidden />

      <div className="flex flex-wrap items-center gap-1.5">
        {classTags.map((tag) => {
          const on = tag === classFilter;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onFilter(tag)}
              aria-pressed={on}
              className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
                on
                  ? "bg-primary text-primary-foreground"
                  : "border-line text-text-dim hover:bg-bg-soft border"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="bg-bg-soft relative h-2 w-28 overflow-hidden rounded-pill">
          <div
            className="bg-primary absolute inset-y-0 left-0 rounded-pill transition-all"
            style={{ width: `${pctDone}%` }}
          />
        </div>
        <span className="text-text-dim font-mono text-[11px]">
          오늘 마감 <span className="text-foreground font-bold">{doneCount}</span>/{total}
        </span>
      </div>
    </div>
  );
}
