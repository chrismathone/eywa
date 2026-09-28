/**
 * 강사 스코프 화면의 **표시 축**을 그 강사 기준으로 좁히는 판정 — 단일 소스(순수 함수).
 *
 * 배경(원장 2026-08-20): "수학 선생님인데도 영어가 게이지 차있네? … 담당 강사도 나 말고 이외의 선생님도
 * 있고." 목록에 **보이는 학생·반은 이미 강사 스코프로 좁혀져 있는데**, 그 위에 얹힌 축(과목 게이지·과목
 * 배지·담당 강사·필터 선택지)은 학원 전체 기준이라 남의 과목·남의 강사가 새어 나왔다.
 *
 * 🔴 이 모듈은 **누가 보이는지(스코프)를 바꾸지 않는다.** `getTeacherScope`의 학생 판정은 그대로 두고,
 *    이미 보이는 행 위에 그리는 축만 좁힌다.
 *
 * 두 가지 fail-open을 지킨다(둘 다 아래 Vitest가 잠금):
 * - **스코프 null**(관리자·풀셸) → 축 없음 = 종전과 완전히 동일.
 * - **스코프는 있는데 subjects가 빈 배열**(담당 반 0개 — 부담임 영어 슬롯 폴백 등) → 좁히지 않는다.
 *   좁히면 모든 과목이 사라져 화면이 통째로 빈다(권한 폴백 fail-open과 같은 결).
 */

import { NO_SUBJECT, joinMulti, parseMulti } from "./list-filter-values";

/** 좁힐 과목 집합. `null` = 좁히지 않음(관리자 or 담당 과목 미상). */
export type SubjectAxis = ReadonlySet<string> | null;

/** 강사 스코프(`effectiveTeacherScope()`) → 표시 축. null/빈 subjects는 축 없음(fail-open). */
export function subjectAxisOf(
  scope: { subjects: string[] } | null | undefined,
): SubjectAxis {
  const subjects = scope?.subjects ?? [];
  if (subjects.length === 0) return null;
  return new Set(subjects);
}

/**
 * 이 과목이 축에 드는가.
 * ⚠️ 과목 미상(null/빈 문자열)은 **통과**시킨다 — 미분류를 지우면 정보가 사라지고, 그건 남의 과목이
 * 새는 것보다 나쁘다(보강 후보 `subjectMatchesAnchor`와 같은 비대칭).
 */
export function axisHasSubject(axis: SubjectAxis, subject: string | null | undefined): boolean {
  if (!axis) return true;
  if (!subject) return true;
  return axis.has(subject);
}

/** 학생 행의 '수강 과목' 배지 — 축 과목만. 순서는 입력 그대로(호출부가 이미 정렬). */
export function narrowSubjects(axis: SubjectAxis, subjects: string[]): string[] {
  if (!axis) return subjects;
  return subjects.filter((s) => axis.has(s));
}

/** (과목, 담당 강사명) 짝 — 학생이 다니는 반 하나. */
export type SubjectTeacher = { subject: string | null | undefined; name: string };

/**
 * 학생 행의 '담당 강사' — **축 과목 반의 담당만** 남긴다(영어 담임이 사라진다).
 * 🔴 **같은 과목의 다른 강사는 남긴다** — 한 학생이 수학 반 둘을 다니면(이수진·이성우) 그건 이 강사에게
 *    의미 있는 정보다. 원장이 지운 건 "과목이 다른 강사"이지 "나 말고 전부"가 아니다.
 * 정렬은 종전과 같은 기본 `.sort()`(코드포인트) — localeCompare로 바꾸면 관리자 화면 순서가 달라진다.
 */
export function narrowTeacherNames(axis: SubjectAxis, pairs: SubjectTeacher[]): string[] {
  const names = pairs
    .filter((p) => axisHasSubject(axis, p.subject))
    .map((p) => p.name)
    .filter(Boolean);
  return [...new Set(names)].sort();
}

/** 과목별 집계(히어로 카드 게이지) — 축 과목만. */
export function narrowSubjectCounts(
  axis: SubjectAxis,
  bySubject: Record<string, number>,
): Record<string, number> {
  if (!axis) return bySubject;
  return Object.fromEntries(Object.entries(bySubject).filter(([k]) => axis.has(k)));
}

/**
 * 과목 필터 선택지 — 축 과목만(맨 앞 "전체"는 항상 유지).
 * "고를 수 있는데 결과가 0인 선택지"를 만들지 않기 위한 것.
 */
export function narrowSubjectFilters<T extends { value: string }>(
  axis: SubjectAxis,
  filters: T[],
): T[] {
  if (!axis) return filters;
  return filters.filter((f) => f.value === "all" || axis.has(f.value));
}

/**
 * 과목 필터를 화면에 띄울 것인가 — 축이 있고 담당 과목이 1개뿐이면 숨긴다(선택지 하나인 드롭다운은 잡음).
 * ⚠️ 관리자(축 없음)에선 **항상 true** — 학원 과목이 1개여도 종전 화면이 바뀌면 안 된다.
 * ⚠️ 판정을 **학원설정 목록이 아니라 축 자체**로 한다 — 아래 coerce가 설정 로드보다 먼저 돌아야 하고,
 *    미등록 과목 키가 섞여도 "감췄는데 값은 살아 있는" 조합이 안 생긴다.
 */
export function showSubjectFilter(axis: SubjectAxis): boolean {
  if (!axis) return true;
  return axis.size > 1;
}

/**
 * 화면에 걸려 있을 과목 필터 값.
 * - 축 밖 과목이면 "전체"(그대로 두면 결과가 영원히 0명).
 * - 🔴 **필터를 감춘 화면에선 축 안 과목이어도 "전체"** — 되돌릴 컨트롤이 없는데 값이 살아 있으면
 *   조용히 행이 빠진다(과목 필터는 `on_hold=false`까지 보므로 **휴원 학생이 사라진다**).
 * 저장된 필터(localStorage 복원)·직접 URL 둘 다 이 한 규칙을 지난다(화면·엑셀 공용).
 * 다중 선택(`math,english`, 원장 2026-09-28)이면 **값마다** 같은 규칙 — 축 밖 과목만 떨어지고 남은 게 없으면 "전체".
 * '미수강'(`NO_SUBJECT`)은 과목이 아니라 축과 무관하게 남는다(축 과목 수강이 없는 학생 — 판정도 축을 본다).
 */
export function coerceSubjectFilter(axis: SubjectAxis, subject: string | undefined): string {
  const s = subject ?? "all";
  if (!axis || s === "all") return s;
  if (!showSubjectFilter(axis)) return "all";
  return joinMulti(parseMulti(s).filter((v) => v === NO_SUBJECT || axis.has(v)));
}
