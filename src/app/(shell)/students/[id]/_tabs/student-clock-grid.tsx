"use client";

import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { Pill } from "@/components/atoms/pill";
import type { SubjectMaps } from "@/features/owner/subjects";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import { buildWeekGrid, weekCellKey, type WeekGridRow } from "@/features/students/lib/week-grid";

const DAY_KO: Record<DayOfWeek, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

/**
 * '전체' 탭 — 시각(HH:MM) 행 × 요일 열. 전 과목·전 강사 통합(과목마다 교시 체계가 달라 시각이 유일한 정확 병합축).
 * 셀 = 과목 pill + 반명 + 강사 + 교시.
 */
export function StudentClockGrid({
  rows,
  subjects,
}: {
  rows: WeekGridRow[];
  subjects: SubjectMaps;
}) {
  const { days, times, cells } = buildWeekGrid(rows);
  if (times.length === 0) {
    return <p className="text-muted-foreground px-1 text-sm">표시할 시간표가 없습니다.</p>;
  }
  return (
    <DragScrollArea>
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-border text-muted-foreground border-b text-xs">
            <th className="w-14 px-3 py-2 text-left font-medium">시각</th>
            {days.map((d) => (
              <th key={d} className="border-border/60 border-l px-3 py-2 text-center font-medium">
                {DAY_KO[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {times.map((t) => (
            <tr key={t}>
              <td className="text-text-dim num px-3 py-2 align-top font-mono text-xs whitespace-nowrap">
                {t}
              </td>
              {days.map((d) => {
                const cellList = cells.get(weekCellKey(d, t)) ?? [];
                return (
                  <td key={d} className="border-border/60 border-l px-2 py-1.5 align-top">
                    {cellList.length === 0 ? (
                      <span className="text-text-faint/40 flex justify-center text-xs">·</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {cellList.map((c, i) => (
                          <div key={i} className="bg-bg-soft/60 rounded-md px-2 py-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Pill color={subjects.colorOf(c.subject)}>
                                {subjects.labelOf(c.subject)}
                              </Pill>
                              <span className="text-foreground font-medium break-keep">
                                {c.className}
                              </span>
                            </div>
                            <div className="text-text-faint mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              {c.teacherName ? <span>{c.teacherName}</span> : null}
                              {c.periodLabel ? <span className="num">· {c.periodLabel}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
