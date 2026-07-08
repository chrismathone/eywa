/**
 * "오늘 조치할 것" 통합 패널 — 조건부 운영 신호(무단결석·분석실패·미기록·결재대기·휴가)를
 * 한 밴드의 칩으로 모은다. 전부 0건이면 "모든 항목 정상" 한 줄(안심 신호 — ijw 패턴).
 * 칩 클릭 = 해당 메뉴 창으로 드릴다운.
 */
import { WindowLink } from "@/components/workspace/window-link";
import type { TodayActionItem } from "@/features/dashboard/today-actions";

const DOT: Record<TodayActionItem["severity"], string> = {
  danger: "bg-danger",
  amber: "bg-amber",
  info: "bg-blue",
};
const NUM: Record<TodayActionItem["severity"], string> = {
  danger: "text-danger",
  amber: "text-amber",
  info: "text-blue",
};

export function TodayActionsBand({ items }: { items: TodayActionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-card border-line shadow-card flex items-center gap-2.5 rounded-2xl border px-5 py-3">
        <span className="bg-primary-soft text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
          ✓
        </span>
        <span className="text-text-dim text-[12.5px]">
          오늘 조치할 항목이 없습니다 — 확인 항목 모두 정상
        </span>
      </div>
    );
  }
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-3.5">
      {/* 믹스 폰트 크기(13/12/11px)는 items-center(박스 중심)로는 작은 글씨가 ~1px 떠 보인다 —
          텍스트 줄답게 베이스라인 정렬, 비텍스트(점·구분선)만 self-center. */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-2">
        <h2 className="text-foreground shrink-0 text-[13px] font-bold whitespace-nowrap">
          오늘 조치할 것
        </h2>
        <span className="num text-text-faint font-mono text-[11px]">{items.length}</span>
        <span className="bg-line h-4 w-px shrink-0 self-center" aria-hidden="true" />
        {items.map((it) => (
          <WindowLink
            key={it.key}
            href={it.href}
            title={it.label}
            ariaLabel={`${it.label}${it.count !== null ? ` ${it.count}건` : ""} 보기`}
            className="group border-line hover:bg-bg-soft inline-flex max-w-full items-baseline gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors"
          >
            <span className={`${DOT[it.severity]} size-2 shrink-0 self-center rounded-full`} aria-hidden="true" />
            <span className="text-foreground text-[12px] font-semibold whitespace-nowrap">{it.label}</span>
            {it.count !== null ? (
              <span className={`num text-[12px] font-extrabold ${NUM[it.severity]}`}>{it.count}</span>
            ) : null}
            {it.detail ? (
              <span className="text-text-faint max-w-[14rem] truncate text-[11px]">{it.detail}</span>
            ) : null}
          </WindowLink>
        ))}
      </div>
    </section>
  );
}
