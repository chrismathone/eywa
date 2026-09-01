"use client";

import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { BADGE_BASE, BADGE_TONE } from "@/features/attendance/cell-display";
import { BADGE_LABEL, badgeTitle } from "@/features/attendance/enrollment-span";
import type { MathCellState } from "../lib/cell-state";
import { actualBooksOf, type MathRecordLike, type StudentGoalMap } from "../lib/student-goals";
import type { MathSheetMonthData } from "../server/month-queries";
import type { GoalField } from "./use-student-goals";
import { GoalCell } from "./goal-cell";

/**
 * A안 — **학생 × 수업일 진도표**. MCS의 기본 보기.
 *
 * 🔴 칸이 비는 이유 셋을 **다른 무늬**로 그린다(`cell-state.ts` 참조) — 왔는데 안 적힌 칸(빗금)과
 *    출결조차 없는 칸(회색)과 결석(연회색 라벨)을 한 색으로 뭉치면 "미작성 969건" 같은 거짓말이 된다.
 * 🔴 목표 칸은 **왼쪽 고정열**에 둔다 — 목표와 실제가 한 줄에서 만나야 어긋남이 눈에 들어온다.
 * 🔴 **달 중간에 나간 학생은 지우지 않고 회색 줄로 남긴다**(원장 2026-09-01, 출석부와 같은 문법):
 *    이름 칸이 회색으로 내려앉고 `퇴원`·`반이동` 표식이 붙는다. 나간 뒤의 칸은 이미 `off-roster`
 *    회색이라, 지운 것과 달리 **그 학생이 실제로 다닌 날의 기록이 그대로 남는다**.
 * ⚠️ 교재 입력은 `datalist`로 **이 달에 실제로 쓴 책**을 제안한다. 표기 흔들림(`쎈 6-2` vs `쎈 초6-2`)은
 *    판정으로 다 접을 수 없으므로(학년 표기가 빠지면 다른 책과 구분이 안 된다) 입력 단계에서 줄인다.
 */
const CELL_TONE: Record<MathCellState, string> = {
  written: "",
  unwritten:
    "bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(188,56,56,.07)_5px,rgba(188,56,56,.07)_10px)]",
  absent: "bg-bg-soft/60",
  untracked: "bg-muted",
  "off-roster": "bg-muted/40",
};

const CELL_NOTE: Record<Exclude<MathCellState, "written">, string> = {
  unwritten: "출석 · 기록 없음",
  absent: "결석",
  untracked: "출결도 기록도 없음",
  "off-roster": "수강 전/후",
};

export function MonthSheet({
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

  const flat: MathRecordLike[] = data.students.flatMap((s) =>
    Object.entries(s.records).map(([date, rec]) => ({
      studentId: s.studentId,
      date,
      textbook: rec.textbook,
      progress: rec.progress,
    })),
  );

  return (
    <div className="overflow-x-auto px-1">
      <table className="border-line-faint w-full min-w-[940px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line-faint text-text-dim sticky left-0 z-10 w-[232px] border p-2 text-left text-[12.5px] font-extrabold">
              학생 · 이 달 목표
            </th>
            {data.days.map((day) => {
              const warn = (data.offGoalByDate[day.date] ?? 0) > 0;
              return (
                <th
                  key={day.date}
                  className={`border-line-faint num border p-2 text-center text-[12.5px] font-extrabold whitespace-nowrap ${
                    warn ? "bg-amber-soft text-amber" : "bg-bg-soft text-text-dim"
                  }`}
                >
                  {Number(day.date.slice(5, 7))}/{Number(day.date.slice(8, 10))}
                  <span className="ml-1 font-semibold opacity-70">
                    {"일월화수목금토"[new Date(`${day.date}T00:00:00Z`).getUTCDay()]}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.students.map((stu) => {
            const goal = goals[stu.studentId];
            const actual = actualBooksOf(flat, stu.studentId);
            return (
              <tr key={stu.studentId}>
                <td
                  // ⚠️ 고정열은 **불투명**이어야 한다 — 반투명 배경이면 스크롤한 본문이 비친다([[#74]]).
                  className={`border-line-faint sticky left-0 z-10 border p-2 align-top ${
                    stu.rosterPhase === "ended" ? "bg-bg-soft" : "bg-white"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/students/${stu.studentId}`}
                      className={`hover:text-primary min-w-0 truncate text-[14px] font-extrabold ${
                        stu.rosterPhase === "ended" ? "text-text-faint" : ""
                      }`}
                    >
                      {stu.name}
                    </Link>
                    <span className="text-text-faint shrink-0 text-[11.5px]">
                      {schoolGradeLabel(stu.school, stu.grade)}
                    </span>
                    {/* 신입·퇴원·반이동 — 그 달에 경계가 있는 학생만. 판정·라벨·툴팁 모두 출석부와 같은 소스. */}
                    {stu.badges.length > 0 ? (
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {stu.badges.map((b) => (
                          <span
                            key={`${b.kind}-${b.date}`}
                            title={badgeTitle(b, data.className)}
                            className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}
                          >
                            {BADGE_LABEL[b.kind]}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <GoalCell
                    studentId={stu.studentId}
                    studentGrade={stu.grade ?? ""}
                    goal={goal}
                    actualBooks={actual}
                    canEdit={canEdit}
                    onChange={onGoalChange}
                  />
                </td>
                {data.days.map((day) => {
                  const state = stu.cells[day.date] ?? "untracked";
                  const rec = stu.records[day.date];
                  const stalled = stu.stalledDates.includes(day.date);
                  return (
                    <td
                      key={day.date}
                      className={`border-line-faint min-w-[178px] border p-2 align-top ${CELL_TONE[state]} ${
                        rec?.offGoal ? "border-l-amber bg-amber-soft/40 border-l-[3px]" : ""
                      }`}
                    >
                      {rec ? (
                        <>
                          {rec.textbook ? (
                            <div
                              className={`mb-0.5 text-[12px] leading-tight font-bold ${
                                rec.offGoal ? "text-amber" : "text-primary"
                              }`}
                            >
                              {rec.textbook}
                            </div>
                          ) : null}
                          <div className="text-text-dim text-[13px] leading-snug whitespace-pre-line">
                            {rec.progress ?? "—"}
                          </div>
                          {stalled ? (
                            <div className="text-amber mt-1 flex items-center gap-1 text-[11.5px] font-bold">
                              <EyIcon name="alert" size={11} />
                              같은 진도 반복
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="text-text-faint text-[11.5px] font-bold">
                          {CELL_NOTE[state as Exclude<MathCellState, "written">]}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="bg-bg-soft border-line-faint text-text-dim sticky left-0 z-10 border p-1.5 text-[12px] font-bold">
              그날 기록 / 온 학생
            </td>
            {data.days.map((day) => {
              const written = data.students.filter((s) => s.cells[day.date] === "written").length;
              const came = data.students.filter(
                (s) => s.cells[day.date] === "written" || s.cells[day.date] === "unwritten",
              ).length;
              return (
                <td
                  key={day.date}
                  className="bg-bg-soft border-line-faint text-text-dim num border p-1.5 text-center text-[12px] font-bold"
                >
                  {written} / {came}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
      {/* 이 달에 실제로 쓴 교재 — 목표 입력 자동완성(표기 흔들림을 입력 단계에서 줄인다). */}
      <datalist id="mcs-book-options">
        {data.bookOptions.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
    </div>
  );
}
