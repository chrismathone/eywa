"use client";

import { useState } from "react";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { SHEET_BOX_FRAME, SHEET_INPUT } from "../ui-box";
import { actualBooksOf, offGoalBooksOf, type MonthGoalMap, type PlanLineLike } from "../lib/goal-match";
import type { GoalField, GoalRole } from "./use-month-goals";

/**
 * 월간 목표 스트립 — 시트 원본의 '담임/부담임 월간계획'(6영역 × 교재·목표 진도)을 가로로 편 것.
 * **여기서 바로 고친다**(원장 2026-08-31) — 값은 주간 시트 좌측 패널과 같은 칸이다.
 *
 * 🔴 6열로 늘어놓지 않는다 — 읽기 전용일 땐 됐지만 입력칸이 되면 한 칸이 100px로 눌려 교재명이
 *    통째로 잘린다(시안 실측). 3열 × 2행으로 펴고 한 칸을 `[영역][교재][목표]` 한 줄로 둔다.
 * ⚠️ 목표 아래 한 줄은 **실제로 나간 교재**다 — 목표와 다르면 앰버로 짚는다(경고 판정은
 *    [`goal-match`](../lib/goal-match.ts) 단일 소스라 달력·진도표와 같은 답을 낸다).
 */
export function MonthGoalStrip({
  monthLabel,
  skillAreas,
  goals,
  role,
  onRole,
  lines,
  canEdit,
  savedAt,
  onField,
}: {
  monthLabel: string;
  skillAreas: SkillAreaSetting[];
  goals: { homeroom: MonthGoalMap; assistant: MonthGoalMap };
  /** 보고 있는 역할 — 진도표 첫 열과 같은 값을 봐야 해서 부모가 소유한다. */
  role: GoalRole;
  onRole: (role: GoalRole) => void;
  /** 이 달 계획 줄 전체 — '실제로 나간 교재'를 여기서 뽑는다. */
  lines: readonly PlanLineLike[];
  canEdit: boolean;
  /** 마지막 저장 시각(ms) — 있으면 머리줄에 '저장됨'. */
  savedAt: number | null;
  onField: (role: GoalRole, skillArea: string, field: GoalField, value: string) => void;
}) {
  const [folded, setFolded] = useState(false);
  const map = goals[role];
  const roleChip = (key: GoalRole, label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={role === key}
      onClick={() => onRole(key)}
      className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11.5px] font-bold transition ${
        role === key
          ? "border-foreground bg-foreground text-background"
          : "border-line-strong text-text-dim hover:bg-bg-soft"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="border-line overflow-hidden rounded-xl border">
      <div className="bg-bg-soft flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[12.5px] font-bold">
        <span>{role === "homeroom" ? "담임" : "부담임"} 월간계획</span>
        <span className="text-text-faint num">{monthLabel}</span>
        <span className="flex gap-1">
          {roleChip("homeroom", "담임")}
          {roleChip("assistant", "부담임")}
        </span>
        <span className={`ml-auto text-[11.5px] font-semibold ${savedAt ? "text-green" : "text-text-faint"}`}>
          {savedAt ? "저장됨" : "주간 시트와 같은 칸입니다"}
        </span>
        <button
          type="button"
          onClick={() => setFolded((v) => !v)}
          className="border-line-strong text-text-dim hover:border-primary hover:text-primary cursor-pointer rounded-full border px-2 py-0.5 text-[11.5px] font-bold"
        >
          {folded ? "펼치기" : "접기"}
        </button>
      </div>
      {folded ? null : (
        <div className="bg-line-faint grid gap-px sm:grid-cols-2 xl:grid-cols-3">
          {skillAreas.map((area) => {
            const cell = map[area.key] ?? { textbook: null, targetProgress: null };
            const off = offGoalBooksOf(lines, area.key, map);
            const actual = actualBooksOf(lines, area.key);
            return (
              <div key={area.key} className="flex flex-col gap-1 bg-white px-2.5 py-1.5">
                <div className="grid grid-cols-[74px_minmax(0,1fr)_92px] items-center gap-1.5">
                  <span
                    className={`${SHEET_BOX_FRAME} inline-flex h-5 w-full items-center justify-center truncate px-1 text-[12px] font-bold ${
                      SUBJECT_SOFT[skillAreaColorOf(skillAreas, area.key)]
                    }`}
                    title={area.label}
                  >
                    {area.label}
                  </span>
                  <input
                    className={SHEET_INPUT}
                    defaultValue={cell.textbook ?? ""}
                    readOnly={!canEdit}
                    placeholder="교재명"
                    aria-label={`${area.label} 월간 목표 교재명`}
                    onChange={(e) => onField(role, area.key, "textbook", e.target.value)}
                  />
                  <input
                    className={SHEET_INPUT}
                    defaultValue={cell.targetProgress ?? ""}
                    readOnly={!canEdit}
                    placeholder="목표"
                    aria-label={`${area.label} 목표 진도`}
                    onChange={(e) => onField(role, area.key, "targetProgress", e.target.value)}
                  />
                </div>
                <p className="text-text-faint pl-[80px] text-[11.5px]">
                  {actual.length === 0 ? (
                    "이 달 진행 없음"
                  ) : off.length > 0 ? (
                    <>
                      실제 <span className="text-amber font-bold">{off[0]}</span>
                      {off.length > 1 ? <span className="num"> 외 {off.length - 1}</span> : null}
                    </>
                  ) : cell.textbook ? (
                    <>
                      실제 <span className="text-green font-bold">목표대로</span>
                    </>
                  ) : (
                    <>
                      실제 {actual[0]}
                      {actual.length > 1 ? <span className="num"> 외 {actual.length - 1}</span> : null}
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
