"use client";

import { SheetClassName, SheetTeacherName, SheetText } from "@/features/teacher-view/interface-label";

import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SUBJECT_SOFT, type SubjectMaps } from "@/features/owner/subjects";
import { isPerPeriodSubject, type DayOfWeek, type PeriodsConfig } from "@/features/timetable/lib/periods";
import {
  buildSubjectPeriodGrid,
  type GridRowMode,
  type SubjectPeriodGrid,
  type WeekGridRow,
} from "@/features/students/lib/week-grid";
import {
  CELL_COL_W,
  periodRowHeightsForGrid,
  sumSpan,
} from "@/features/students/lib/week-grid-row-height";
// LAB '따로 수업(*LAB)' 표식 — 시간표와 같은 글자·모양(단일 소스).
import { LAB_SEPARATE_LABEL, LAB_SEPARATE_TEXT_CLASS, LAB_SEPARATE_TIP } from "@/features/timetable/lib/lab-separate";

const DAY_KO: Record<DayOfWeek, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};
const GRID = "border-ink/20";

/**
 * 과목 탭 — 교시 행 × 요일 열, 그 과목 시간표 패리티. 평일표 + (있으면)주말표.
 * 단일 학생이라 한 칸 0/1개 수업. 연속 교시는 **보이는 내용(반·담당·자리·방)이 같고 시간이 이어질 때만**
 * 세로 rowSpan 병합(week-grid-merge.ts), 수학계열은 2교시 묶음 라벨.
 * 행 구성(rowMode)은 그 과목 시간표가 처음 여는 뷰의 규칙 — 통합뷰 과목(영어)은 수업 있는 교시만.
 * tableHeight = 카드 고정 총높이(과목 표 내용 높이의 최댓값) — 칸 줄 수만큼 행을 키운 뒤, 표가 이
 * 높이를 채우도록 남는 세로만 나눈다. 탭을 바꿔도 카드가 안 흔들린다(행 적은 과목은 행이 늘어남).
 */
export function StudentPeriodGrid({
  rows,
  subject,
  config,
  subjects,
  tableHeight,
  rowMode,
}: {
  rows: WeekGridRow[];
  subject: string;
  config: PeriodsConfig;
  subjects: SubjectMaps;
  tableHeight: number;
  rowMode: GridRowMode;
}) {
  const weekday = buildSubjectPeriodGrid(rows, subject, false, config, rowMode);
  const weekend = buildSubjectPeriodGrid(rows, subject, true, config, rowMode);
  const hasWeekday = weekday.days.length > 0;
  const hasWeekend = weekend.days.length > 0;
  if (!hasWeekday && !hasWeekend) {
    return <p className="text-muted-foreground px-1 text-sm"><SheetText value={"이 과목의 시간표가 없습니다."} /></p>;
  }
  const cellColor = SUBJECT_SOFT[subjects.colorOf(subject)];
  return (
    <DragScrollArea>
      <div className="flex items-start gap-4">
        {hasWeekday ? (
          <PeriodTable grid={weekday} weekend={false} cellColor={cellColor} tableHeight={tableHeight} perPeriod={isPerPeriodSubject(subject, config)} />
        ) : null}
        {hasWeekend ? (
          <PeriodTable grid={weekend} weekend cellColor={cellColor} tableHeight={tableHeight} perPeriod={isPerPeriodSubject(subject, config)} />
        ) : null}
      </div>
    </DragScrollArea>
  );
}

function PeriodTable({
  grid,
  weekend,
  cellColor,
  tableHeight,
  perPeriod,
}: {
  grid: SubjectPeriodGrid;
  weekend: boolean;
  cellColor: string;
  tableHeight: number;
  /** 교시마다 한 줄인 과목(영어·새 학원 일반판) — 두 교시 묶음 라벨을 안 쓴다(periods.ts isPerPeriodSubject). */
  perPeriod: boolean;
}) {
  const { days, rows, cellAt, blocks } = grid;
  // 칸 내용(반·담당/자리·방)이 들어가게 행을 키운 뒤, 카드 총높이(tableHeight)까지 남는 세로만 나눈다.
  const heights = periodRowHeightsForGrid(grid, tableHeight);
  // 수학계열(평일·비영어)만 2교시 묶음 라벨(1교시=1·2교시 …). 영어·주말·폴백은 개별 교시 라벨.
  const isMathFamily = !weekend && !perPeriod;
  const labelCls = `bg-bg-soft/70 text-foreground ${GRID} border-b border-r px-2 py-1 align-top text-xs font-bold whitespace-nowrap`;
  return (
    <table className={`border-collapse border ${GRID} text-sm`} style={{ tableLayout: "fixed" }}>
      <colgroup>
        {/* 라벨 열 112px — 2026-09-08 v5 글자 기준 실측: `HH:MM~HH:MM`(11자)이 14px에서 ≈90px라
            112 − px-2 16 − border 1 = 95px가 필요하다(72px 시절엔 55px뿐이라 뒤 2글자가 옆 칸에 덮였다).
            시간표 LABEL_W=104는 패딩 없는 레일 기준이라 여기선 px-2 만큼 더 잡는다. */}
        <col style={{ width: 112 }} />
        {days.map((_, i) => (
          <col key={i} style={{ width: CELL_COL_W }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className={`bg-bg-soft text-text-faint ${GRID} border-b border-r px-2 py-1.5 text-xs font-medium`}>
            <SheetText value={weekend ? "주말" : "교시"} />
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
          const rowH = heights[ri] ?? 0;
          const labelSpan = oddPaired ? 2 : 1;
          return (
            <tr key={row.key} style={{ height: rowH }}>
              {isGroupSecond ? null : mathN !== null ? (
                // 묶음 병합(rowSpan=2)·시간범위 결합은 **홀수 앵커 + 실제 짝일 때만**. 짝수가 폴백으로
                // 앵커가 된 퇴화 케이스는 개별 라벨(다음 홀수와 오병합 금지).
                <td rowSpan={labelSpan} className={labelCls} style={{ height: sumSpan(heights, ri, labelSpan) }}>
                  {Math.ceil(mathN / 2)}<SheetText value={"교시"} /><div className="text-text-faint num mt-0.5 text-xs font-normal">
                    {oddPaired ? `${row.time.split("~")[0]}~${nextRow!.time.split("~")[1]}` : row.time}
                  </div>
                </td>
              ) : (
                <td className={labelCls} style={{ height: rowH }}>
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
                const spanH = sumSpan(heights, ri, block.rowSpan);
                return (
                  <td
                    key={d}
                    rowSpan={block.rowSpan > 1 ? block.rowSpan : undefined}
                    style={{ height: spanH }}
                    className={`border-b border-r ${GRID} overflow-hidden p-1 align-top ${c ? "" : "bg-ink/[0.03]"}`}
                  >
                    {c ? (
                      <div
                        className={`flex min-w-0 flex-col rounded-md px-1.5 py-1 ${cellColor}`}
                        style={{ height: spanH - 8 }} // p-1(상하 8px) 보정 → 셀 전체 채움
                      >
                        <span className="text-foreground text-xs leading-tight font-bold break-keep">
                          <SheetClassName value={c.className} />
                        </span>
                        {/* 🔴 자리(LAB·JJ) 교시는 **사람이 아니라 방**이다 — 이름 자리에 자리 이름을 적고
                            테두리 알약으로 사람과 구분한다(원장 2026-09-07 "JJ실도 있을텐데 표현 제대로"). */}
                        {c.seat ? (
                          // '따로 수업(*LAB)' 교시면 시간표와 **같은 글자·같은 모양**(`*LAB` 이탤릭+밑줄, 0271a).
                          <span
                            className={`border-line text-text-dim mt-0.5 w-fit rounded-full border px-1 text-xs${
                              c.labSeparate ? ` ${LAB_SEPARATE_TEXT_CLASS}` : ""
                            }`}
                            title={c.labSeparate ? LAB_SEPARATE_TIP : undefined}
                          >
                            {c.labSeparate ? LAB_SEPARATE_LABEL : c.seat}
                          </span>
                        ) : c.teacherName ? (
                          <span className="text-text-dim mt-0.5 text-xs"><SheetTeacherName value={c.teacherName} /></span>
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
