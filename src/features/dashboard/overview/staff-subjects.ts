import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";

/**
 * 직원 한 사람의 담당 과목 묶음 — 원장 2026-09-12 *"하단 직원 구성에서 수학강사 영어강사 색깔 구분해줘. 과목 없는 강사는
 * 그냥 진한 회색"* · *"관리자도 마찬가지"*. 판정은 학년별 재원생 막대와 **같은** `subjectGroupOf`(영어 = EiE·인재원 영어,
 * 수학 = 수학(심화) 포함)이라 두 화면이 한 사람을 다른 색으로 부르지 않는다. `other` = 영어·수학이 아닌 과목만 맡은 사람
 * (국어 등 — '과목 없음'으로 뭉치면 거짓), `none` = `users.subjects`가 비어 있는 사람.
 */
export type StaffSubjectGroup = "english" | "math" | "both" | "other" | "none";

export type StaffRow = {
  label: string;
  value: number;
  bySubject: Record<StaffSubjectGroup, number>;
};

/** 운영 역할 라벨 — raw 코드(`teacher`)를 화면에 내지 않는다. */
export const STAFF_ROLE_LABELS: Readonly<Record<string, string>> = {
  master: "원장",
  admin: "관리자",
  manager: "매니저",
  teacher: "강사",
  counselor: "상담",
  accountant: "회계",
  viewer: "열람",
  parttime: "아르바이트",
};

export function staffSubjectGroup(
  subjects: readonly string[] | null | undefined,
  settings: readonly ProgramSubject[],
): StaffSubjectGroup {
  const groups = new Set<string>();
  for (const key of subjects ?? []) {
    const group = subjectGroupOf(key, settings);
    if (group) groups.add(group);
  }
  const english = groups.has("english");
  const math = groups.has("math");
  if (english && math) return "both";
  if (english) return "english";
  if (math) return "math";
  return groups.size ? "other" : "none";
}

const emptyBySubject = (): Record<StaffSubjectGroup, number> => ({ english: 0, math: 0, both: 0, other: 0, none: 0 });

/** 역할별 인원 + 그 안의 과목 묶음 — 종전 `distribution`과 같은 정렬(인원 많은 순 → 라벨 가나다). */
export function staffComposition(
  rows: readonly { role: string; subjects: readonly string[] | null | undefined }[],
  settings: readonly ProgramSubject[],
): StaffRow[] {
  const byRole = new Map<string, StaffRow>();
  for (const r of rows) {
    // 모르는 역할은 raw 코드를 화면에 내지 않는다(SYSTEM_ROLES는 닫힌 enum이라 지금은 안 온다).
    const label = STAFF_ROLE_LABELS[r.role] ?? "기타";
    const row = byRole.get(label) ?? { label, value: 0, bySubject: emptyBySubject() };
    row.value += 1;
    row.bySubject[staffSubjectGroup(r.subjects, settings)] += 1;
    byRole.set(label, row);
  }
  return [...byRole.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "ko"));
}
