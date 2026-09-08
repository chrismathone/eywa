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
const GRID = "border-ink/20";

/**
 * 과목 탭 — 교시 행 × 요일 열, 실제 시간표 기본뷰 패리티. 평일표 + (있으면)주말표.
 * 단일 학생이라 한 칸 0/1개 수업. 연속 교시는 세로 rowSpan 병합, 수학계열은 2교시 묶음 라벨.
 * tableHeight = 카드 고정 총높이(가장 교시 많은 과목 기준) — 표가 이 높이를 채우도록 행 높이를 조정해
 * 탭을 바꿔도 높이가 안 흔들린다(교시 적은 과목은 행이 늘어남).
 */
export function StudentPeriodGrid({
  rows,
  subject,
  config,
  subjects,
  tableHeight,
}: {
  rows: WeekGridRow[];
  subject: string;
  config: PeriodsConfig;
  subjects: SubjectMaps;
  tableHeight: number;
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
          <PeriodTable grid={weekday} subject={subject} weekend={false} cellColor={cellColor} tableHeight={tableHeight} />
        ) : null}
        {hasWeekend ? (
          <PeriodTable grid={weekend} subject={subject} weekend cellColor={cellColor} tableHeight={tableHeight} />
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
  tableHeight,
}: {
  grid: SubjectPeriodGrid;
  subject: string;
  weekend: boolean;
  cellColor: string;
  tableHeight: number;
}) {
  const { days, rows, cellAt, blocks } = grid;
  // 이 표가 고정 총높이(tableHeight)를 채우도록 행 높이 = 총높이/행수. 교시 적은 과목일수록 행이 커진다.
  const rowHeight = tableHeight / Math.max(1, rows.length);
  // 수학계열(평일·비영어)만 2교시 묶음 라벨(1교시=1·2교시 …). 영어·주말·폴백은 개별 교시 라벨.
  const isMathFamily = !weekend && subject !== "english";
  const labelCls = `bg-bg-soft/70 text-foreground ${GRID} border-b border-r px-2 py-1 align-top text-xs font-bold whitespace-nowrap`;
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
          <th className={`bg-bg-soft text-text-faint ${GRID} border-b border-r px-2 py-1.5 text-xs font-medium`}>
            {weekend ? "주말" : "교시"}
          </th>
          {days.map((d) => (
            <th key={d} className={`bg-bg-soft text-foreground ${GRID} border-b border-r px-2 py-1.5 text-center text-xs font-bold`}>
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
          const oddPaired = mathN !== null && mathN % 2 === 1 && paired;
          return (
            <tr key={row.key} style={{ height: rowHeight }}>
              {isGroupSecond ? null : mathN !== null ? (
                // 묶음 병합(rowSpan=2)·시간범위 결합은 **홀수 앵커 + 실제 짝일 때만**. 짝수가 폴백으로
                // 앵커가 된 퇴화 케이스는 개별 라벨(다음 홀수와 오병합 금지).
                <td rowSpan={oddPaired ? 2 : 1} className={labelCls} style={{ height: rowHeight * (oddPaired ? 2 : 1) }}>
                  {Math.ceil(mathN / 2)}교시
                  <div className="text-text-faint num mt-0.5 text-xs font-normal">
                    {oddPaired ? `${row.time.split("~")[0]}~${nextRow!.time.split("~")[1]}` : row.time}
                  </div>
                </td>
              ) : (
                <td className={labelCls} style={{ height: rowHeight }}>
                  {/* 교시 이름을 비운 학원은 시간대가 이름 자리로 올라온다(2026-08-13, periodListLabel). */}
                  {row.label ? (
                    <>
                      {row.label}
                      <div className="text-text-faint num mt-0.5 text-xs font-normal">{row.time}</div>
                    </>
                  ) : (
                    <span className="num">{row.time}</span>
                  )}
                </td>
              )}
              {days.map((d, ci) => {
                const block = blocks.get(`${ri}:${ci}`);
                if (!block) return null; // 위 병합 블록에 피복 — 렌더 스킵
                const c = cellAt(ri, ci);
                // 이 셀이 차지하는 총높이(연속 교시 병합 반영) — 색 블록이 셀 전체를 채우도록 명시.
                // (h-full=height:100%는 table td에서 불안정해 하단 빈공간이 생김 → 실제 시간표처럼 명시 높이.)
                const spanH = block.rowSpan * rowHeight;
                return (
                  <td
                    key={d}
                    rowSpan={block.rowSpan > 1 ? block.rowSpan : undefined}
                    style={{ height: spanH }}
                    className={`border-b border-r ${GRID} p-1 align-top ${c ? "" : "bg-ink/[0.03]"}`}
                  >
                    {c ? (
                      <div
                        className={`flex flex-col rounded-md px-1.5 py-1 ${cellColor}`}
                        style={{ height: spanH - 8 }} // p-1(상하 8px) 보정 → 셀 전체 채움
                      >
                        <span className="text-foreground text-xs leading-tight font-bold break-keep">
                          {c.className}
                        </span>
                        {/* 🔴 자리(LAB·JJ) 교시는 **사람이 아니라 방**이다 — 이름 자리에 자리 이름을 적고
                            테두리 알약으로 사람과 구분한다(원장 2026-09-07 "JJ실도 있을텐데 표현 제대로"). */}
                        {c.seat ? (
                          <span className="border-line text-text-dim mt-0.5 w-fit rounded-full border px-1 text-xs">
                            {c.seat}
                          </span>
                        ) : c.teacherName ? (
                          <span className="text-text-dim mt-0.5 text-xs">{c.teacherName}</span>
                        ) : null}
                        {c.room ? (
                          <span className="text-text-faint mt-auto pt-0.5 text-xs">{c.room}</span>
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
