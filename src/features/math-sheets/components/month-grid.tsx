"use client";

import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { actualBooksOf, type MathRecordLike, type StudentGoalMap } from "../lib/student-goals";
import type { MathSheetMonthData } from "../server/month-queries";
import type { GoalField } from "./use-student-goals";
import { HEAD_CELL_W, StudentHeadCell } from "./student-head-cell";
import { DayCells, DayHeadCells } from "./month-day-cells";

/**
 * MCS 월간 뷰의 **진도표** — 학생 × 수업일 표 하나. 왼쪽 고정열([`StudentHeadCell`](./student-head-cell.tsx):
 * 이름·목표 칸·목표 레일 두 줄) + 오른쪽 수업일 칸([`month-day-cells`](./month-day-cells.tsx)).
 *
 * 🔴 **보기는 이것 하나다**(원장 2026-09-02 *"탭 구분 자체를 없애고 진도표 화면만"*) — 카드·현황 표·레일 탭은
 *    같은 날 걷었다. 행 `key`는 학생 id.
 * 🔴 **바닥 합계 행은 없다**(원장 *"하단 행 제거 필요없음. 대신 여백 조금 남겨줄것"*) — 툴바 칩이 같은 수를 말한다.
 * 🔴 학생과 학생 사이는 **진한 선**(원장 *"행 구분을 좀 더 진한선으로"*) — 칸 테두리(`line-faint`)보다 굵고 진하게
 *    `<tr>`에 긋는다(border-collapse라 더 굵은 쪽이 이긴다).
 * ⚠️ 잡고 끌기(원장 *"마우스 드래그로도 좌우 이동"*) — 앱 규약의 DragScrollArea(폼 컨트롤·링크 위에선 팬을
 *    안 시작하고 끈 뒤의 click 1회는 삼킨다). px-1은 고정열 그림자 링이 잘리지 않게([[#114]]).
 */
export function MonthGrid({
  data,
  goals,
  onGoalChange,
  canEdit,
}: {
  data: MathSheetMonthData;
  goals: StudentGoalMap;
  onGoalChange: (studentId: string, field: GoalField, value: string) => void;
  canEdit: boolean;
}) {
  if (data.days.length === 0) {
    return (
      <p className="text-text-faint rounded-2xl border border-dashed p-8 text-center text-sm">
        {data.monthLabel}에는 이 반 수업이 없습니다.
      </p>
    );
  }

  // 이 달 실제로 쓴 교재(학생별) — 목표 칸의 "실제 …" 한 줄과 '실제로 맞추기'가 쓴다.
  const flat: MathRecordLike[] = data.students.flatMap((s) =>
    Object.entries(s.records).map(([date, rec]) => ({
      studentId: s.studentId,
      date,
      textbook: rec.textbook,
      progress: rec.progress,
    })),
  );

  return (
    <DragScrollArea className="px-1 pb-6">
      <table className="border-line-faint w-full min-w-[940px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th
              className={`bg-bg-soft border-line-faint text-text-dim sticky left-0 z-10 ${HEAD_CELL_W} border p-2 text-left text-[12.5px] font-extrabold`}
            >
              학생 · 이 달 목표
            </th>
            <DayHeadCells data={data} />
          </tr>
        </thead>
        <tbody className="[&>tr]:border-line-strong [&>tr]:border-t-2 [&>tr:last-child]:border-b-2">
          {data.students.map((stu) => (
            <tr key={stu.studentId}>
              <StudentHeadCell
                stu={stu}
                goal={goals[stu.studentId]}
                actualBooks={actualBooksOf(flat, stu.studentId)}
                canEdit={canEdit}
                onGoalChange={onGoalChange}
                classLabel={data.className}
              />
              <DayCells stu={stu} data={data} />
            </tr>
          ))}
        </tbody>
      </table>
      {/* 이 달에 실제로 쓴 교재 — 목표 입력 자동완성(표기 흔들림을 입력 단계에서 줄인다). */}
      <datalist id="mcs-book-options">
        {data.bookOptions.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
    </DragScrollArea>
  );
}
