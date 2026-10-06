/**
 * 원스크린 × **수업 나누기**(0351a) — 로스터에 세울 행 계획(순수, Vitest).
 *
 * 원장 2026-10-06: *"출결은 맡아진 시간에는 그 선생님 몫 · 수업보고서는 원래반 담임이 쓰도록"*.
 *  - **받는 반**: 그 학생이 그날 그 반 행으로 선다(수강행 없이 — 보강 예약과 같은 결). 출결 알약은 열리고
 *    (그 반에 찍힌다 = 받는 선생님 몫), **보고서 쪽은 잠긴다**(`reportOptout`과 같은 잠금 축 + 이유 문구).
 *  - **원래 반**: 행은 그대로(나머지 시간은 여기서 수업한다) 그 시간이 어디로 가는지 작은 표식만.
 * 🔴 이미 그 반 수강생이면 받는 반 행을 따로 세우지 않는다(정규 행이 이미 있다 — 두 줄이 되면 출결이 둘로 보인다).
 */
import { splitDayOf, splitRowNote } from "@/features/class-splits/attendance";
import type { ClassSplit } from "@/features/class-splits/rules";

export const SPLIT_REPORT_NOTICE = "보고서는 원래 반에서 씁니다";

export type SplitRowPlan = {
  /** 받는 반 행으로 세울 학생 — `note`는 행 표식(`나눔 17:20~18:20 ← 이성우(중1 수학)`). */
  incoming: { studentId: string; classId: string; note: string }[];
  /** 원래 반 행 표식 — 키 `학생id|반id`. */
  outgoing: Map<string, string>;
};

export function planSplitRows(
  activeClassIds: readonly string[],
  date: string,
  splits: readonly ClassSplit[],
  classNames: ReadonlyMap<string, { name: string; teacherName: string | null }>,
  enrolledKey: ReadonlySet<string>,
): SplitRowPlan {
  const plan: SplitRowPlan = { incoming: [], outgoing: new Map() };
  if (splits.length === 0) return plan;
  const seen = new Set<string>();
  for (const classId of activeClassIds) {
    const day = splitDayOf(classId, date, splits);
    for (const v of day.incoming) {
      const key = `${v.studentId}|${classId}`;
      if (enrolledKey.has(key) || seen.has(key)) continue;
      seen.add(key);
      plan.incoming.push({ studentId: v.studentId, classId, note: splitRowNote("in", v, classNames.get(v.otherClassId)) });
    }
    for (const v of day.outgoing) {
      const key = `${v.studentId}|${classId}`;
      const note = splitRowNote("out", v, classNames.get(v.otherClassId));
      const prev = plan.outgoing.get(key);
      plan.outgoing.set(key, prev ? `${prev} · ${note}` : note);
    }
  }
  return plan;
}

/** 잠긴 보고서 칸의 이유 문구 — 나눔 행이면 그 사실을, 아니면 호출부의 기존 문구(미발송 반 등). */
export function rowLockNotice(subject: { splitIn?: string }, fallback: string): string {
  return subject.splitIn ? `${SPLIT_REPORT_NOTICE} · ${subject.splitIn}` : fallback;
}
