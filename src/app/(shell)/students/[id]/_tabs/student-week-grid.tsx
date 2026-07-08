import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { Pill } from "@/components/atoms/pill";
import type { SubjectMaps } from "@/features/owner/subjects";
import type { StudentClassRow } from "@/features/students/server/queries";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import { buildWeekGrid, weekCellKey } from "@/features/students/lib/week-grid";

const DAY_KO: Record<DayOfWeek, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

/**
 * 학생 개인 주간 시간표(읽기전용) — 전 과목·전 강사 통합. "다른 선생님 수업"까지 한 판에서 본다.
 * 과목마다 교시 체계가 달라 **시각(HH:MM) 행 × 요일 열**로 병합(배치 로직은 buildWeekGrid 순수함수).
 * 데이터는 수업 탭이 이미 로드한 current 행의 slots(등원요일 필터 완료) — 추가 쿼리 0.
 */
export function StudentWeekGrid({
  rows,
  subjects,
}: {
  rows: StudentClassRow[];
  subjects: SubjectMaps;
}) {
  const { days, times, cells } = buildWeekGrid(rows);
  // 시간표에 놓을 슬롯이 하나도 없으면(전부 시간 미정 등) 그리드 자체를 숨긴다 — 빈 판 노출 방지.
  if (times.length === 0) return null;

  return (
    <section className="bg-card border-border rounded-md border">
      <header className="border-border flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">주간 시간표</h2>
          <p className="text-muted-foreground text-xs">
            전 과목·전 강사 통합 · 실제 등원 요일 기준 (읽기전용)
          </p>
        </div>
      </header>
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
    </section>
  );
}
