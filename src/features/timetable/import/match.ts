// 학생/반 매칭 — 순수 함수. 이름·학교·학년으로 학생 id를, 반이름으로 반 id를 해석.
// ijw excelImport.ts의 matchStudent를 aywa 정규화 모델로 이식(테넌트 RLS 하 서버에서 호출).

import type { ClassRef, StudentRef } from "./types";

/** 비교용 정규화 — 공백 제거 + 소문자(한글은 영향 없음). null/빈값은 "". */
export function norm(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, "").toLowerCase();
}

export type MatchResult<T> =
  | { status: "ok"; value: T }
  | { status: "none" }
  | { status: "ambiguous"; candidates: T[] };

/** 반이름 → classId. 동명이반(과목 다름 등)이면 ambiguous. */
export function matchClass(className: string, classes: ClassRef[]): MatchResult<string> {
  const key = norm(className);
  if (!key) return { status: "none" };
  const hits = classes.filter((c) => norm(c.className) === key);
  if (hits.length === 0) return { status: "none" };
  if (hits.length > 1) return { status: "ambiguous", candidates: hits.map((c) => c.classId) };
  return { status: "ok", value: hits[0].classId };
}

/**
 * 이름+학교+학년 → studentId. 1차: 이름+학교+학년 완전일치. 동명이인 → ambiguous.
 * 학교/학년이 비었으면 이름만으로 후보를 좁히되, 후보가 여럿이면 ambiguous.
 */
export function matchStudent(
  name: string,
  school: string | null,
  grade: string | null,
  students: StudentRef[],
): MatchResult<string> {
  const n = norm(name);
  if (!n) return { status: "none" };
  const byName = students.filter((s) => norm(s.name) === n);
  if (byName.length === 0) return { status: "none" };
  if (byName.length === 1) return { status: "ok", value: byName[0].studentId };

  // 동명이인 → 학교+학년으로 좁힘
  const sc = norm(school);
  const gr = norm(grade);
  const narrowed = byName.filter(
    (s) => (!sc || norm(s.school) === sc) && (!gr || norm(s.grade) === gr),
  );
  if (narrowed.length === 1) return { status: "ok", value: narrowed[0].studentId };
  if (narrowed.length === 0) return { status: "none" };
  return { status: "ambiguous", candidates: narrowed.map((s) => s.studentId) };
}
