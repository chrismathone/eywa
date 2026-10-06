// 반영 계획(GridApplyPlan) → 화면에 보여 줄 미리보기. 순수.
//
// 화면은 계획을 **그대로** 보여 준다(따로 다시 판정하지 않는다) — 미리보기에서 본 것과 적용되는 것이 달라질 틈을 없앤다.

import { gridPlanHash, planSize, type GridApplyPlan } from "./apply-plan";
import type { DeltaIgnored } from "./types";

const DAY_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

export interface MathGridPreview {
  tabName: string;
  /** 쓸 내용의 해시 — 적용할 때 서버가 다시 세운 계획과 대조한다. */
  hash: string;
  /** 쓸 것의 건수(만들 반 + 이동 + 추가 + 종료). */
  total: number;
  classes: { name: string; teacher: string; when: string[]; room: string; students: string[] }[];
  moves: { student: string; from: string; to: string; toNew: boolean; days: string }[];
  adds: { student: string; to: string; toNew: boolean; held: boolean; days: string }[];
  removes: { student: string; from: string }[];
  /** 읽었지만 시트로는 반영하지 않는 것 — 무엇을, 왜. */
  skipped: DeltaIgnored[];
  notes: string[];
  /** 못 읽은 것. */
  warnings: string[];
  stats: { classCells: number; students: number };
}

/** 등원 요일 꼬리표 — 전 요일이면 빈 글자, 일부 요일이면 "수요일만". */
const daysText = (days: string[]) => (days.length === 0 ? "" : `${days.map((d) => DAY_KO[d] ?? d).join("·")}요일만`);

export function toGridPreview(
  plan: GridApplyPlan,
  tabName: string,
  stats: MathGridPreview["stats"],
): MathGridPreview {
  const joining = (key: string) =>
    [...plan.moves, ...plan.adds].filter((x) => x.to.key === key).map((x) => x.label);
  return {
    tabName,
    hash: gridPlanHash(plan),
    total: planSize(plan),
    classes: plan.classes.map((c) => ({
      name: c.name,
      teacher: c.teacherName,
      when: c.when,
      room: c.room,
      students: joining(c.key),
    })),
    moves: plan.moves.map((m) => ({
      student: m.label,
      from: m.fromName,
      to: m.to.name,
      toNew: !m.to.classId,
      days: daysText(m.attendanceDays),
    })),
    adds: plan.adds.map((a) => ({
      student: a.label,
      to: a.to.name,
      toNew: !a.to.classId,
      held: a.onHold,
      days: daysText(a.attendanceDays),
    })),
    removes: plan.removes.map((r) => ({ student: r.label, from: r.className })),
    skipped: plan.skipped,
    notes: plan.notes,
    warnings: plan.warnings,
    stats,
  };
}
