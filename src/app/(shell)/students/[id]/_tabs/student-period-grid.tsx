"use client";

import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SUBJECT_SOFT, type SubjectMaps } from "@/features/owner/subjects";
import type { DayOfWeek, PeriodsConfig } from "@/features/timetable/lib/periods";
import {
  buildSubjectPeriodGrid,
  type SubjectPeriodGrid,
  type WeekGridRow,
} from "@/features/students/lib/week-grid";

const DAY_KO: Record<DayOfWeek, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const ROW_H = 46; // 교시 1칸 높이(rowSpan 병합·수학 묶음 라벨 2등분이 균일하도록 명시).
const GRID = "border-ink/20";

/**
 * 과목 탭 — 교시 행 × 요일 열, 실제 시간표 기본뷰 패리티. 평일표 + (있으면)주말표.
 * 단일 학생이라 한 칸 0/1개 수업. 연속 교시는 세로 rowSpan 병합(엑셀 셀병합), 수학계열은 2교시 묶음 라벨.
 */
export function StudentPeriodGrid({
  rows,
  subject,
  config,
  subjects,
}: {
  rows: WeekGridRow[];
  subject: string;
  config: PeriodsConfig;
  subjects: SubjectMaps;
}) {
  const weekday = buildSubjectPeriodGrid(rows, subject, false, config);
  const weekend = buildSubjectPeriodGrid(rows, subject, true, config);
  const hasWeekday = weekday.days.length > 0;
  const hasWeekend = weekend.days.length > 0;
  if (!hasWeekday && !hasWeekend) {
    return <p className="text-muted-foreground px-1 text-sm">이 과목의 시간표가 없습니다.</p>;
  }
  const cellColor = SUBJECT_SOFT[subjects.colorOf(subject)];
  return (
    <DragScrollArea>
      <div className="flex items-start gap-4">
        {hasWeekday ? (
          <PeriodTable grid={weekday} subject={subject} weekend={false} cellColor={cellColor} />
        ) : null}
        {hasWeekend ? (
          <PeriodTable grid={weekend} subject={subject} weekend cellColor={cellColor} />
        ) : null}
      </div>
    </DragScrollArea>
  );
}

function PeriodTable({
  grid,
  subject,
  weekend,
  cellColor,
}: {
  grid: SubjectPeriodGrid;
  subject: string;
  weekend: boolean;
  cellColor: string;
}) {
  const { days, rows, cellAt, blocks } = grid;
  // 수학계열(평일·비영어)만 2교시 묶음 라벨(1교시=1·2교시 …). 영어·주말·폴백은 개별 교시 라벨.
  const isMathFamily = !weekend && subject !== "english";
  const labelCls = `bg-bg-soft/70 text-foreground ${GRID} border-b border-r px-2 py-1 align-top text-[11px] font-semibold whitespace-nowrap`;
  return (
    <table className={`border-collapse border ${GRID} text-sm`} style={{ tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: 72 }} />
        {days.map((_, i) => (
          <col key={i} style={{ width: 104 }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className={`bg-bg-soft text-text-faint ${GRID} border-b border-r px-2 py-1.5 text-[11px] font-medium`}>
            {weekend ? "주말" : "교시"}
          </th>
          {days.map((d) => (
            <th key={d} className={`bg-bg-soft text-foreground ${GRID} border-b border-r px-2 py-1.5 text-center text-[12px] font-bold`}>
              {DAY_KO[d]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          const pid = /^p-(\d+)$/.exec(row.key)?.[1];
          const mathN = isMathFamily && pid ? Number(pid) : null;
          const nextRow = rows[ri + 1];
          const nextPid = nextRow ? /^p-(\d+)$/.exec(nextRow.key)?.[1] : undefined;
          const paired = mathN !== null && nextPid !== undefined && Number(nextPid) === mathN + 1;
          // 둘째 교시(짝수)는 **직전 행이 실제 짝(N-1)일 때만** 라벨 생략(그 rowSpan=2에 피복됨).
          // 폴백(비표준 시각) 행이 교시쌍 사이에 끼면 직전이 짝이 아니므로 개별 라벨로 그려 어긋남 방지.
          const prevRow = rows[ri - 1];
          const prevPid = prevRow ? /^p-(\d+)$/.exec(prevRow.key)?.[1] : undefined;
          const isGroupSecond =
            mathN !== null && mathN % 2 === 0 && prevPid !== undefined && Number(prevPid) === mathN - 1;
          return (
            <tr key={row.key} style={{ height: ROW_H }}>
              {isGroupSecond ? null : mathN !== null ? (
                // 묶음 병합(rowSpan=2)·시간범위 결합은 **홀수 앵커 + 실제 짝일 때만**. 짝수가 폴백으로
                // 앵커가 된 퇴화 케이스는 개별 라벨(다음 홀수와 오병합 금지).
                <td rowSpan={mathN % 2 === 1 && paired ? 2 : 1} className={labelCls}>
                  {Math.ceil(mathN / 2)}교시
                  <div className="text-text-faint mt-0.5 font-mono text-[9px] font-normal">
                    {mathN % 2 === 1 && paired
                      ? `${row.time.split("~")[0]}~${nextRow!.time.split("~")[1]}`
                      : row.time}
                  </div>
                </td>
              ) : (
                <td className={labelCls}>
                  {row.label}
                  <div className="text-text-faint mt-0.5 font-mono text-[9px] font-normal">{row.time}</div>
                </td>
              )}
              {days.map((d, ci) => {
                const block = blocks.get(`${ri}:${ci}`);
                if (!block) return null; // 위 병합 블록에 피복 — 렌더 스킵
                const c = cellAt(ri, ci);
                return (
                  <td
                    key={d}
                    rowSpan={block.rowSpan > 1 ? block.rowSpan : undefined}
                    className={`border-b border-r ${GRID} p-1 align-top ${c ? "" : "bg-ink/[0.03]"}`}
                  >
                    {c ? (
                      <div className={`flex h-full flex-col rounded-md px-1.5 py-1 ${cellColor}`}>
                        <span className="text-foreground text-[12px] leading-tight font-semibold break-keep">
                          {c.className}
                        </span>
                        {c.teacherName ? (
                          <span className="text-text-dim mt-0.5 text-[10px]">{c.teacherName}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
