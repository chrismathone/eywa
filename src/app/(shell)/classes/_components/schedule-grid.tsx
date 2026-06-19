"use client";

import { useMemo, useState } from "react";

type Period = { id: string; startTime: string; endTime: string };
type InitialSlot = { dayOfWeek: string; startTime: string };

const DAYS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];

const cellKey = (day: string, periodId: string) => `${day}__${periodId}`;

/**
 * 반 스케줄 = 요일(월~일) × 교시 클릭 그리드 (ijw 패리티). 셀을 눌러 토글하면 그 교시 시각으로
 * class_schedules 행이 만들어진다. 교시→시각은 부모가 넘긴 `periods`(테넌트 교시설정 기반)에서 나오므로
 * 저장 포맷(`schedule_day_i`/`schedule_start_i`/`schedule_end_i`)은 기존 서버액션 그대로 — 액션 수정 0.
 *
 * 과목 전환 시 부모가 periods(8↔10교시)를 갈아끼우면 선택은 periodId로 유지되고, 현재 교시표에 없는
 * 교시(예: 영어→수학 시 9·10)는 자동 비활성(저장에서도 제외).
 */
export function ScheduleGrid({
  periods,
  initial,
}: {
  periods: Period[];
  initial: InitialSlot[];
}) {
  // 초기 선택: 기존 스케줄의 (요일, 시작시각)을 현재 교시표에서 periodId로 역매핑(마운트 1회).
  const initialSelected = useMemo(() => {
    const startToId = new Map(periods.map((p) => [p.startTime, p.id]));
    const set = new Set<string>();
    for (const s of initial) {
      const id = startToId.get(s.startTime.slice(0, 5));
      if (id) set.add(cellKey(s.dayOfWeek, id));
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 한 번만(이후 사용자 선택 보존)
  }, []);
  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  const periodById = useMemo(() => new Map(periods.map((p) => [p.id, p])), [periods]);

  // 현재 교시표에 존재하는 선택만 유효 — 하이라이트·hidden input·카운트 모두 이 기준.
  const activeKeys = useMemo(
    () => [...selected].filter((k) => periodById.has(k.split("__")[1])),
    [selected, periodById],
  );
  const activeSet = useMemo(() => new Set(activeKeys), [activeKeys]);

  const rows = activeKeys.map((k) => {
    const [day, id] = k.split("__");
    const p = periodById.get(id)!;
    return { day, start: p.startTime, end: p.endTime };
  });

  const toggle = (day: string, periodId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = cellKey(day, periodId);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="space-y-2">
      {/* 제출용 hidden input — 선택 셀을 교시 시각으로 변환(기존 서버액션 포맷) */}
      {rows.map((r, i) => (
        <div key={`${r.day}-${r.start}-${i}`}>
          <input type="hidden" name={`schedule_day_${i}`} value={r.day} />
          <input type="hidden" name={`schedule_start_${i}`} value={r.start} />
          <input type="hidden" name={`schedule_end_${i}`} value={r.end} />
        </div>
      ))}

      <div className="border-border overflow-hidden rounded-md border">
        <table className="w-full table-fixed border-collapse text-center text-xs">
          <thead>
            <tr className="bg-muted/40">
              <th className="border-border text-muted-foreground w-10 border-b border-r py-1.5 font-medium">
                교시
              </th>
              {DAYS.map((d) => (
                <th
                  key={d.key}
                  className="border-border text-foreground border-b border-r py-1.5 font-medium last:border-r-0"
                >
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <th className="border-border bg-muted/20 text-muted-foreground border-b border-r py-1 font-normal leading-tight last:border-b-0">
                  <div className="text-foreground text-[11px] font-semibold">{p.id}</div>
                  <div className="num text-[9px]">{p.startTime}</div>
                </th>
                {DAYS.map((d) => {
                  const on = activeSet.has(cellKey(d.key, p.id));
                  return (
                    <td
                      key={d.key}
                      className="border-border border-b border-r p-0 last:border-r-0"
                    >
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${d.label} ${p.id}교시`}
                        onClick={() => toggle(d.key, p.id)}
                        className={`block h-9 w-full transition ${
                          on
                            ? "bg-primary/85 hover:bg-primary text-primary-foreground font-semibold"
                            : "hover:bg-muted text-transparent"
                        }`}
                      >
                        {on ? "●" : "·"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-semibold">{rows.length}</span>개 교시 선택 ·
        칸을 눌러 수업 교시를 지정하세요
      </p>
    </div>
  );
}
