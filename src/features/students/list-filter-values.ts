/**
 * 원생목록 **다중 선택 필터 값**과 운영실 '재원생 구성' 막대가 싣는 축(학교급 · 수강 구성) — 순수 모듈.
 *
 * 원장 2026-09-28: *"이런 류의 드랍다운 선택은 중복 선택가능하게 변경"* — 열 머리 필터(수강 과목·학년·담당 강사)는
 * 여러 값을 고른다. URL은 `subject=math,english`, 계정 저장값(`users.ui_prefs.students`)도 같은 쉼표 문자열이다
 * — 옛 단일 값(`math`)은 원소 하나짜리 목록으로 그대로 읽힌다(호환). "전체" = 빈 목록 = `all`.
 * 여러 값은 **합집합**(수학·영어 = 둘 중 하나라도 듣는 학생)이다 — 요일 필터(`days=mon,wed`)와 같은 뜻.
 *
 * 🔴 서버·클라 양쪽이 쓴다 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]·[[#81]]).
 */
import { getGradeLevel, isPreschoolGrade } from "@/lib/format/school-grade";
import type { SubjectMix } from "./enrolled-composition";
import { parseMulti } from "@/lib/multi-value";

// 다중 값 풀이는 공용(열 머리 필터 FilterSelect도 쓴다) — 여기서 다시 내보낸다.
export { joinMulti, orderMulti, parseMulti } from "@/lib/multi-value";

/**
 * 수강 과목 필터의 **'미수강'** — 지금 수강 중인 과목이 하나도 없는 학생(원장 2026-09-28).
 * 판정 = 운영실 '재원생 구성'의 미수강 막대와 같은 `activeStudentIds`(enrolled-composition.ts) 여집합.
 * 과목 키는 학원설정이 `subject_N`·표준 영문 키로만 만들어서 이 값과 겹치지 않는다.
 */
export const NO_SUBJECT = "__none__";

/** 학교급 — 운영실 '재원생 구성' 줄. 학년 문자열에서 뽑는 파생값이라 학원설정 enum이 아니다(`getGradeLevel`). */
export const STUDENT_LEVELS = [
  { key: "elem", label: "초등" },
  { key: "middle", label: "중등" },
  { key: "high", label: "고등" },
  { key: "preschool", label: "미취학" },
  { key: "etc", label: "기타·미입력" },
] as const;
export type StudentLevel = (typeof STUDENT_LEVELS)[number]["key"];

/** 한 학생의 학교급 — `levelSubjectSplit`(막대)과 원생목록 `level=`(목록)이 **이 함수 하나**를 지난다. */
export function studentLevelOf(grade: string | null | undefined): StudentLevel {
  if (isPreschoolGrade(grade)) return "preschool";
  const level = getGradeLevel(grade?.trim());
  return level === "초" ? "elem" : level === "중" ? "middle" : level === "고" ? "high" : "etc";
}

export const levelLabel = (key: StudentLevel): string => STUDENT_LEVELS.find((l) => l.key === key)?.label ?? key;
export const levelKeyOfLabel = (label: string): StudentLevel | null =>
  STUDENT_LEVELS.find((l) => l.label === label)?.key ?? null;

export function parseLevels(raw: unknown): StudentLevel[] {
  return parseMulti(raw).filter((v): v is StudentLevel => STUDENT_LEVELS.some((l) => l.key === v));
}

/**
 * 수강 구성(영어·수학 두 축) — `subjectMixOf`의 넷 중 막대에 서는 셋 + '기타 과목'(활성 수강은 있는데 영어·수학이 아님).
 * 🔴 `neither`를 그대로 싣지 않는다 — 그건 미수강과 기타 과목을 합친 값이라 막대 어디에도 없는 숫자다.
 *    미수강은 수강 과목 필터의 `NO_SUBJECT`로 연다(원장 지시: '미수강' 막대 → 수강 과목 = 미수강).
 */
export const STUDENT_MIXES = [
  { key: "englishOnly", label: "영어만" },
  { key: "both", label: "동시수강" },
  { key: "mathOnly", label: "수학만" },
  { key: "other", label: "기타 과목" },
] as const;
export type StudentMixFilter = (typeof STUDENT_MIXES)[number]["key"];

export const mixLabel = (key: StudentMixFilter): string => STUDENT_MIXES.find((m) => m.key === key)?.label ?? key;

export function parseMixes(raw: unknown): StudentMixFilter[] {
  return parseMulti(raw).filter((v): v is StudentMixFilter => STUDENT_MIXES.some((m) => m.key === v));
}

/**
 * 한 학생이 수강 구성 필터에 드는가 — 막대 조각과 같은 `subjectMixOf` 결과 + 활성 여부.
 * `other` = 활성 수강이 있는데 영어·수학 어느 쪽도 아님(막대의 '기타 과목' = neither − 미수강).
 */
export function mixMatches(mix: SubjectMix, active: boolean, wanted: readonly StudentMixFilter[]): boolean {
  if (wanted.length === 0) return true;
  if (mix === "neither") return active && wanted.includes("other");
  return wanted.includes(mix);
}
