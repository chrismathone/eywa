"use client";

export type ChipSeries = { key: string; label: string; color: string };

/**
 * 범례 겸 선 고르기 — 일반 차트의 범례처럼 **색 선 + 이름**만(값은 마우스 오버 상자가 말한다) · **그래프 아래**에 둔다(원장 2026-10-22
 * *"라벨류는 밑에"* · *"다른 화면의 꺾은선도 전부 일치화"* — 이 칩을 쓰는 카드는 차트 범례를 끈다 `legend={false}`).
 * 누르면 그 선을 끄고 켠다(마지막 남은 선은 안 꺼진다). 꺼진 항목은 흐리게 · 상태는 `aria-pressed`로 알린다.
 */
export function SeriesChips({ series, off, onToggle }: { series: ChipSeries[]; off: readonly string[]; onToggle: (key: string) => void }) {
  return (
    <div role="group" aria-label="그래프에 그릴 선 — 누르면 끄고 켭니다" className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {series.map((s) => {
        const on = !off.includes(s.key);
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(s.key)}
            title={on ? `${s.label} 선 끄기` : `${s.label} 선 켜기`}
            className={`hover:bg-bg-soft/60 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-opacity ${on ? "text-foreground" : "text-muted-foreground line-through opacity-50"}`}
          >
            <span aria-hidden className="inline-block h-[3px] w-4 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="whitespace-nowrap">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
