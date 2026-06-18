import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { ScheduleSlotWithStudents } from "@/features/timetable/server/queries";
import {
  slotPeriodRow,
  type DayOfWeek,
  type PeriodRow,
  type TimetableSubject,
} from "@/features/timetable/lib/periods";
import { cellClassKey, mergeRuns, sortDaysByGroup } from "@/features/timetable/lib/grid";
import { ClassCell } from "./class-cell";

const DAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

// 요일그룹 헤더 색 — 월목(파랑)/화금(보라)/수(초록)/주말(amber). class-cell 셀은 과목색이라 헤더만 틴트.
function weekdayTint(day: string): string {
  switch (day) {
    case "mon":
    case "thu":
      return "bg-blue-soft";
    case "tue":
    case "fri":
      return "bg-purple-soft";
    case "wed":
      return "bg-primary-soft";
    case "sat":
    case "sun":
      return "bg-amber-soft";
    default:
      return "bg-bg-soft";
  }
}

/**
 * 시간표 기본뷰 — 강사 × 요일(그룹 순서) 컬럼, 교시 행. 과목 단일 선택이라 한 교시 체계.
 * 같은 반이 월·목(또는 화·금)에 걸리면 colSpan으로 한 칸 병합(ijw식). 셀 = ClassCell(학생 세로 명단).
 * 서버 컴포넌트(순수 계산) — ClassCell/DragScrollArea(client)를 자식으로 렌더.
 */
export function WeekdayGroupTables({ slots }: { slots: ScheduleSlotWithStudents[] }) {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;

  const teachers = Array.from(new Set(slots.map((s) => s.teacherName ?? "—"))).sort((a, b) =>
    a.localeCompare(b, "ko"),
  );

  // 강사별 요일(그룹 순서로 정렬 — 월목/화금 인접)
  const teacherDays = new Map<string, DayOfWeek[]>();
  for (const t of teachers) {
    const days = Array.from(
      new Set(slots.filter((s) => (s.teacherName ?? "—") === t).map((s) => s.dayOfWeek as DayOfWeek)),
    );
    teacherDays.set(t, sortDaysByGroup(days));
  }

  // 행(교시) — 슬롯의 periodRow를 unique key로 모아 시각순 정렬
  const rowMap = new Map<string, PeriodRow>();
  const rowOf = (s: ScheduleSlotWithStudents) =>
    slotPeriodRow(subject, s.startTime, s.dayOfWeek as DayOfWeek);
  for (const s of slots) {
    const r = rowOf(s);
    if (!rowMap.has(r.key)) rowMap.set(r.key, r);
  }
  const rows = Array.from(rowMap.values()).sort((a, b) => a.order - b.order);

  // (teacher::day::rowKey) → slots
  const cell = new Map<string, ScheduleSlotWithStudents[]>();
  for (const s of slots) {
    const k = `${s.teacherName ?? "—"}::${s.dayOfWeek}::${rowOf(s).key}`;
    const list = cell.get(k) ?? [];
    list.push(s);
    cell.set(k, list);
  }

  return (
    <DragScrollArea className="bg-card border-line shadow-card min-h-0 flex-1 rounded-2xl border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          {/* 강사 행 */}
          <tr>
            <th
              rowSpan={2}
              className="bg-bg-soft border-line sticky left-0 z-10 w-[100px] border-b border-r p-3 text-left align-bottom"
            >
              <span className="micro">교시</span>
            </th>
            {teachers.map((t) => {
              const days = teacherDays.get(t) ?? [];
              if (days.length === 0) return null;
              return (
                <th
                  key={t}
                  colSpan={days.length}
                  className="bg-bg-soft border-line border-b border-r px-3 py-2 text-center"
                >
                  <span className="text-foreground text-[13px] font-bold">{t}</span>
                </th>
              );
            })}
          </tr>
          {/* 요일 행 (요일그룹 색 밴드) */}
          <tr>
            {teachers.flatMap((t) =>
              (teacherDays.get(t) ?? []).map((d) => (
                <th
                  key={`${t}-${d}`}
                  className={`${weekdayTint(d)} border-line text-text-dim min-w-[150px] border-b border-r px-2 py-1 text-center font-mono text-[10px] font-bold`}
                >
                  {DAY_LABEL[d] ?? d}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="bg-bg-soft border-line text-foreground sticky left-0 z-10 border-b border-r px-3 py-2 align-top text-[12px] font-bold whitespace-nowrap">
                {row.label}
                <div className="text-text-faint mt-0.5 font-mono text-[10px]">{row.time}</div>
              </td>
              {teachers.flatMap((t) => {
                const days = teacherDays.get(t) ?? [];
                const keys = days.map((d) =>
                  cellClassKey((cell.get(`${t}::${d}::${row.key}`) ?? []).map((s) => s.classId)),
                );
                // 같은 반이 인접 요일(월목/화금)에 걸리면 colSpan 병합 → 한 칸.
                return mergeRuns(days, keys).map((run) => {
                  const d = days[run.index]!;
                  const list = (cell.get(`${t}::${d}::${row.key}`) ?? [])
                    .slice()
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));
                  return (
                    <td
                      key={`${t}-${d}-${row.key}`}
                      colSpan={run.span}
                      className="border-line border-b border-r p-1.5 align-top"
                    >
                      {list.length === 0 ? (
                        <span className="text-text-faint text-[11px]">—</span>
                      ) : (
                        <div className="space-y-1.5">
                          {list.map((s) => (
                            <ClassCell key={s.id} slot={s} roster="names" />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                });
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
