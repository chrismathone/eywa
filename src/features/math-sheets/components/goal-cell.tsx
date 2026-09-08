"use client";

import { useState } from "react";
import { ProgressSelector } from "@/features/onescreen/components/progress-selector";
import type { StudentGoal } from "../lib/student-goals";
import type { GoalField } from "./use-student-goals";

/**
 * 진도표 왼쪽 고정열의 **이 달 목표** 칸 — 교재(자유 입력) + 목표 진도(차시 선택).
 *
 * 원장 2026-09-01: *"교재는 현재처럼 커스텀 입력하게 해놓고, 목표 차시는 우리 수업보고서에서 진도
 * 클릭하는 거 활용해서 선택하도록 하면 될거같은데"*.
 *
 * 🔴 **진도 피커는 새로 만들지 않는다** — 원스크린이 매일 쓰는 [`ProgressSelector`]와 **같은 부품**이다.
 *    두 벌이면 커리큘럼·차시 표기가 갈려서, 목표로 고른 차시와 실제로 적힌 차시가 글자부터 달라진다
 *    (그러면 위치 매칭도 어긋난다).
 * 🔴 **교재는 자유 입력 그대로** — 수학 교재는 커리큘럼에 없는 것(프린트·학원 자체 교재)이 흔하다.
 *    대신 `datalist`로 **이 달 실제로 쓴 책**을 제안해 표기 흔들림을 입력에서 줄인다.
 * ⚠️ 진도 학년(`studyGrade`)은 칸마다 따로 기억한다 — 선행 나가는 학생과 현행 학생이 한 표에 섞여 있어
 *    하나로 묶으면 남의 학년으로 피커가 열린다. 기본값은 그 학생의 학년.
 */
export function GoalCell({
  studentId,
  studentGrade,
  goal,
  actualBooks,
  canEdit,
  onChange,
}: {
  studentId: string;
  studentGrade: string;
  goal: StudentGoal | undefined;
  /** 이 달 실제로 나간 교재(등장 순) — 아래 한 줄 + '실제로 맞추기'가 쓴다. */
  actualBooks: string[];
  canEdit: boolean;
  onChange: (studentId: string, field: GoalField, value: string) => void;
}) {
  const [studyGrade, setStudyGrade] = useState(studentGrade || "중1");
  // 교재 입력은 비제어(defaultValue)라 '실제로 맞추기'가 값을 넣으려면 DOM을 직접 건드려야 한다.
  const [bookOverride, setBookOverride] = useState<string | null>(null);
  const bookValue = bookOverride ?? goal?.textbook ?? "";

  return (
    <div className="border-line mt-1.5 rounded-lg border border-dashed p-1.5">
      {/* 라벨 서식은 고정열의 학생 이름과 **같고 크기만 절반**(원장 2026-09-02 *"이달 목표도 학생 이름과 같은
          서식으로"* → *"이달목표는 50%로 줄여"* — student-head-cell `NAME_TEXT` 20px의 절반 = 14px... 반올림해 14px). */}
      <div className="text-foreground mb-1 flex items-center gap-1 text-sm leading-tight font-extrabold">
        이 달 목표
        {/* 표기 흔들림을 판정으로 다 접을 수는 없어서(학년 표기가 빠지면 다른 책과 구분이 안 된다)
            **실제로 나간 책을 그대로 목표에 넣는** 길을 하나 둔다 — 가장 흔한 입력이기도 하다. */}
        {canEdit && actualBooks.length > 0 && actualBooks[0] !== bookValue ? (
          <button
            type="button"
            className="text-primary hover:bg-primary-soft ml-auto cursor-pointer rounded px-1 py-px text-xs font-bold"
            title={`실제로 나간 교재 "${actualBooks[0]}"를 목표로 넣습니다`}
            onClick={() => {
              setBookOverride(actualBooks[0]!);
              onChange(studentId, "textbook", actualBooks[0]!);
            }}
          >
            실제로
          </button>
        ) : null}
      </div>
      <input
        className="border-line-faint mb-1 w-full rounded border px-1.5 py-1 text-sm font-bold disabled:bg-transparent"
        list="mcs-book-options"
        placeholder="교재"
        value={bookValue}
        disabled={!canEdit}
        onChange={(e) => {
          setBookOverride(e.target.value);
          onChange(studentId, "textbook", e.target.value);
        }}
      />
      <ProgressSelector
        value={goal?.targetProgress ?? ""}
        onChange={(joined) => onChange(studentId, "targetProgress", joined)}
        studyGrade={studyGrade}
        onStudyGrade={setStudyGrade}
        studentGrade={studentGrade}
        ariaLabel="이 달 목표 진도"
        locked={!canEdit}
      />
      {actualBooks.length > 0 ? (
        <div className="text-text-faint mt-1 text-xs leading-snug">실제 {actualBooks.join(" · ")}</div>
      ) : null}
    </div>
  );
}
