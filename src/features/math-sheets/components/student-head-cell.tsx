"use client";

import Link from "next/link";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { BADGE_BASE, BADGE_TONE } from "@/features/attendance/cell-display";
import { BADGE_LABEL, badgeTitle } from "@/features/attendance/enrollment-span";
import { pickPrimaryRail, railDiffLabel, RAIL_STATUS_LABEL } from "../lib/goal-rail";
import type { StudentGoalMap } from "../lib/student-goals";
import type { MathStudentRow, StudentRail } from "../server/month-queries";
import type { GoalField } from "./use-student-goals";
import { GoalCell } from "./goal-cell";
import { GoalRailRows, RAIL_ROW_LABEL, RAIL_TONE } from "./goal-rail-bar";

/** 고정열 폭 — 머리 칸(`month-grid`)과 같은 값. */
export const HEAD_CELL_W = "w-[232px]";

function fmtDate(d: string | null): string {
  return d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "";
}

/** 1행(현재진도) 아래 글 — 차시 이름 + 날짜. 이 달 기록이 없으면 "이후 기록 없음"을 숨기지 않는다. */
function nowTextOf(r: StudentRail): string | null {
  if (!r.nowLesson) return null;
  if (r.rail.nowDate) return `${r.nowLesson} (${fmtDate(r.rail.nowDate)})`;
  if (r.startDate) return `${r.nowLesson} (${fmtDate(r.startDate)} 이후 기록 없음)`;
  return r.nowLesson;
}

/**
 * 2행(목표진도) 아래 글 — 목표 차시 이름. 목표가 없거나 견줄 수 없으면 **이유가 이름보다 먼저다**(라벨 단일 소스) —
 * 목표 차시 자체는 바로 위 목표 칸에 적혀 있어서, 여기서 이름을 되풀이하면 "왜 막대가 비었나"의 답이 사라진다.
 */
function goalTextOf(r: StudentRail): string | null {
  if (r.rail.status === "no-goal" || r.rail.status === "goal-behind") return RAIL_STATUS_LABEL[r.rail.status];
  return r.endLesson;
}

/**
 * MCS 월간 뷰의 **왼쪽 고정열** — 이름·표식 · 이 달 목표 칸 · 목표 레일 두 줄.
 *
 * 🔴 두 보기(진도표·현황 표)가 **이 칸을 그대로 공유한다** — 행 높이는 이 칸이 정하므로 어느 보기를
 *    골라도 같은 학생이 같은 높이·같은 자리에 선다(원장 2026-09-02 *"어떤 탭을 고르던 해당 학생의
 *    행높이가 똑같아서 전환이 자연스러워 보이도록"* · *"진도표가 기준 행이 되도록"*). 오른쪽 칸은 이 높이
 *    안에 들어오게 짠다(넘치면 그 보기에서만 그 행이 자란다).
 * 🔴 레일은 별도 탭이 아니라 **여기, 목표 칸 아래**다(원장 2026-09-02 *"진도레일 탭 없애고 진도표 하단으로"*).
 * ⚠️ 고정열은 **불투명**이어야 한다 — 반투명 배경이면 스크롤한 본문이 비친다([[#74]]).
 */
export function StudentHeadCell({
  stu,
  goal,
  actualBooks,
  canEdit,
  onGoalChange,
  classLabel,
}: {
  stu: MathStudentRow;
  goal: StudentGoalMap[string] | undefined;
  actualBooks: string[];
  canEdit: boolean;
  onGoalChange: (studentId: string, field: GoalField, value: string) => void;
  /** 반 이름 — 반이동 툴팁("가반 → 나반")에만 쓴다. */
  classLabel: string;
}) {
  const ended = stu.rosterPhase === "ended";
  const primary = pickPrimaryRail(stu.rails);
  const showRail = primary != null && primary.rail.start != null && !ended;
  const tone = primary ? RAIL_TONE[primary.rail.status] : null;
  const diff = primary ? railDiffLabel(primary.rail) : null;
  return (
    <td
      className={`border-line-faint sticky left-0 z-10 border p-2 align-top ${HEAD_CELL_W} ${
        ended ? "bg-bg-soft" : "bg-white"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Link
          href={`/students/${stu.studentId}`}
          className={`hover:text-primary min-w-0 truncate text-[14px] font-extrabold ${ended ? "text-text-faint" : ""}`}
        >
          {stu.name}
        </Link>
        <span className="text-text-faint shrink-0 text-[11.5px]">{schoolGradeLabel(stu.school, stu.grade)}</span>
        {/* 신입·퇴원·반이동 — 그 달에 경계가 있는 학생만. 판정·라벨·툴팁 모두 출석부와 같은 소스. */}
        {stu.badges.length > 0 ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {stu.badges.map((b) => (
              <span key={`${b.kind}-${b.date}`} title={badgeTitle(b, classLabel)} className={`${BADGE_BASE} ${BADGE_TONE[b.kind]}`}>
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
        actualBooks={actualBooks}
        canEdit={canEdit}
        onChange={onGoalChange}
      />
      {/* 목표 칸 바로 아래 **레일 두 줄**(현재진도 / 목표진도) — 어느 보기에서든 "계획 대비 어디인가"가
          고정열에 있다. 판정·문구는 현황 표와 같은 부품(goal-rail.ts)이다. */}
      {showRail && primary && tone ? (
        <div className="mt-2 px-0.5">
          <GoalRailRows
            rail={primary.rail}
            nowText={nowTextOf(primary)}
            goalText={goalTextOf(primary)}
            title={[
              primary.startLesson ? `시작 ${primary.startLesson}` : null,
              primary.planLesson ? `계획 ${primary.planLesson}` : null,
              primary.nowLesson ? `${RAIL_ROW_LABEL.now} ${primary.nowLesson}` : null,
              primary.endLesson ? `${RAIL_ROW_LABEL.goal} ${primary.endLesson}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <div className="num mt-1 flex items-baseline gap-1.5 text-[10.5px]">
            {primary.rail.progressPct != null ? (
              <b className={`font-extrabold ${TONE_TEXT[tone]}`}>{primary.rail.progressPct}%</b>
            ) : primary.rail.moved != null && primary.rail.moved > 0 ? (
              <b className="text-text-dim font-extrabold">+{primary.rail.moved}차시</b>
            ) : null}
            {diff ? <span className={`font-bold ${TONE_TEXT[tone]}`}>{diff}</span> : null}
          </div>
        </div>
      ) : null}
    </td>
  );
}
