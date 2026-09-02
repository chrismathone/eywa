"use client";

import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { actualBooksOf, type MathRecordLike, type StudentGoalMap } from "../lib/student-goals";
import type { MathSheetMonthData, MathStudentRow } from "../server/month-queries";
import type { McsMonthView } from "../view-prefs";
import type { GoalField } from "./use-student-goals";
import { HEAD_CELL_W, StudentHeadCell } from "./student-head-cell";
import { DayCells, DayFootRow, DayHeadCells } from "./month-day-cells";
import { StatusCells, StatusHeadCells } from "./month-status-cells";

/**
 * MCS 월간 뷰의 **표 껍데기 하나** — 두 보기(진도표·현황 표)가 같은 표·같은 행을 쓴다.
 *
 * 🔴 **진도표가 기준 행이다**(원장 2026-09-02) — 행마다 왼쪽 고정열([`StudentHeadCell`](./student-head-cell.tsx):
 *    이름·목표 칸·미니 레일)은 보기와 무관하게 똑같고, 오른쪽 칸만 갈린다. 행 높이를 정하는 것이 그 고정열이라
 *    보기를 바꿔도 같은 학생이 같은 높이·같은 자리에 선다(*"전환이 자연스러워 보이도록"*). 행 순서도 한 벌
 *    (`students` — 툴바 '느린 순'이 세 보기를 함께 정렬한다).
 * 🔴 행 `key`는 학생 id — 보기를 바꿔도 `<tr>`이 살아남아 목표 입력칸(비제어)의 상태가 유지된다.
 * ⚠️ 잡고 끌기(원장 2026-09-02 *"마우스 드래그로도 좌우 이동"*) — 앱 규약의 DragScrollArea(폼 컨트롤·링크
 *    위에선 팬을 안 시작하고 끈 뒤의 click 1회는 삼킨다). px-1은 고정열 그림자 링이 잘리지 않게([[#114]]).
 */
export function MonthGrid({
  data,
  view,
  students,
  goals,
  onGoalChange,
  canEdit,
}: {
  data: MathSheetMonthData;
  view: McsMonthView;
  /** 그릴 순서의 행 — 정렬은 호출부(툴바)가 정한다. 바닥 합계는 이 순서와 무관하게 `data.students`를 센다. */
  students: readonly MathStudentRow[];
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
    <DragScrollArea className="px-1">
      <table className="border-line-faint w-full min-w-[940px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th
              className={`bg-bg-soft border-line-faint text-text-dim sticky left-0 z-10 ${HEAD_CELL_W} border p-2 text-left text-[12.5px] font-extrabold`}
            >
              학생 · 이 달 목표
            </th>
            {view === "sheet" ? <DayHeadCells data={data} /> : <StatusHeadCells />}
          </tr>
        </thead>
        <tbody>
          {students.map((stu) => (
            <tr key={stu.studentId}>
              <StudentHeadCell
                stu={stu}
                goal={goals[stu.studentId]}
                actualBooks={actualBooksOf(flat, stu.studentId)}
                canEdit={canEdit}
                onGoalChange={onGoalChange}
                classLabel={data.className}
              />
              {view === "sheet" ? <DayCells stu={stu} data={data} /> : <StatusCells stu={stu} data={data} />}
            </tr>
          ))}
        </tbody>
        {view === "sheet" ? (
          <tfoot>
            <DayFootRow data={data} />
          </tfoot>
        ) : null}
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
