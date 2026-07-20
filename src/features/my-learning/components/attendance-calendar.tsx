import type { Session } from "../history";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

const CELL_CLASS: Record<string, string> = {
  출석: "bg-primary-soft text-primary font-bold",
  지각: "bg-amber-soft text-amber font-bold",
  결석: "bg-danger-soft text-danger font-bold",
};

// 모듈 스코프 — 렌더 순수성 룰(react-hooks/purity)을 피하려 컴포넌트 밖에서 Date 계산.
// 인자가 고정된 new Date()는 결정적이라 안전.
function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return cells;
}

/** 출결 달력 — 월별 그리드, 출석/지각/결석 색. */
export function AttendanceCalendar({ history }: { history: Session[] }) {
  const byMonth: Record<number, Record<number, string>> = {};
  for (const h of history) {
    const [m, d] = h.date.split("/").map(Number);
    (byMonth[m!] ??= {})[d!] = h.attendance;
  }
  const months = Object.keys(byMonth)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground text-[15px] font-bold">출결 달력</h2>
        <div className="flex items-center gap-2.5 text-[11px]">
          <Legend cls="bg-primary-soft" label="출석" />
          <Legend cls="bg-amber-soft" label="지각" />
          <Legend cls="bg-danger-soft" label="결석" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {months.map((m) => (
          <div key={m}>
            <p className="text-text-dim mb-1.5 text-[12px] font-bold">{m}월</p>
            <div className="grid grid-cols-7 gap-1 text-center">
              {DOW.map((w, i) => (
                <div
                  key={`d${i}`}
                  className={`text-[10px] font-bold ${i === 0 ? "text-danger" : "text-text-faint"}`}
                >
                  {w}
                </div>
              ))}
              {monthCells(2026, m).map((d, i) => {
                if (d == null) return <div key={i} />;
                const att = byMonth[m]![d];
                return (
                  <div
                    key={i}
                    className={`tabular flex aspect-square items-center justify-center rounded-md text-[11px] ${att ? CELL_CLASS[att] : "text-text-faint"}`}
                  >
                    {d}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`size-2.5 rounded-xs ${cls}`} />
      <span className="text-text-dim">{label}</span>
    </span>
  );
}
