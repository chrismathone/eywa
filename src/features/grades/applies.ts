/**
 * **그 학생이 그 시험을 치는가** — 제도상 안 치는 조합은 칸을 아예 막는다(원장 2026-09-22:
 * *"중간 기말은 초등학생이 치지않음"* · *"2학기도 중간기말도 중1은 시험없음"*).
 *
 * 🔑 왜 막나: 안 치는 학생이 빈 칸으로 남으면 **미기입으로 보인다** — 204명 중 절반이 초등인 반에서
 *    "입력 0/204"는 거짓 신호고, 붉은 칸을 채우려고 사람이 0을 적게 만든다.
 * 🔴 이건 **사람이 누르는 '시험없음'(사유 포함)과 다른 것**이다. 여기 것은 제도상 해당 없음이라
 *    사유를 묻지 않고, 저장되지도 않는다(행을 만들지 않는다). 개인 사정으로 안 본 학생은 화면에서
 *    '시험없음'을 눌러 사유를 남긴다.
 * 🔴 **중1은 학기를 가린다**(원장 2026-09-23: *"1학년 2학기가 없지 1학기는 시험있는데 아예 빠지는데?"*)
 *    — 1학기는 중간·기말을 치므로 명단에 **떠야 한다**. 학년만 보고 막았더니 중1이 1학기에도 통째로
 *    사라졌다. 초등은 두 학기 모두 안 친다(학기를 안 본다).
 * ⚠️ 학년은 `students.grade` 문자열이다(`초6`·`중1`·`고2`). 규칙은 **접두 판정**이라 `중1-2` 같은
 *    변형도 중1로 본다. 모르는 값(빈 값·`7세`)은 **막지 않는다** — 모른다고 칸을 지우면 실제로 시험을
 *    본 학생이 사라진다(모르면 열어 두는 쪽이 안전하다).
 */

import type { ExamSlotKey } from "./exam-slots";
import type { Term } from "./term";

/** 학교 중간·기말 — 이 둘만 학년 제한이 있다. */
const SCHOOL_TERM_EXAMS: readonly ExamSlotKey[] = ["midterm", "final"];

const clean = (grade: string | null | undefined) => String(grade ?? "").replace(/\s+/g, "");

export function isElementaryGrade(grade: string | null | undefined): boolean {
  return /^초/.test(clean(grade));
}

/** 중학교 1학년 — **2학기**가 자유학기라 그 학기만 중간·기말을 치지 않는다(원장 확인). */
export function isMiddleFirstGrade(grade: string | null | undefined): boolean {
  return /^중1(?!\d)/.test(clean(grade));
}

/**
 * 그 칸이 **존재하는 시험**인가. false면 명단에서 뺀다(입력·집계 대상 아님).
 * 🔴 `term`을 반드시 넘길 것 — 중1은 1학기엔 치고 2학기엔 안 친다.
 */
export function examAppliesTo(slot: ExamSlotKey, grade: string | null | undefined, term: Term): boolean {
  if (!SCHOOL_TERM_EXAMS.includes(slot)) return true;
  if (isElementaryGrade(grade)) return false;
  if (isMiddleFirstGrade(grade) && term === 2) return false;
  return true;
}

/** 화면에 적는 사유 — 왜 이 칸이 비어 있는지 한 줄로. */
export function notApplicableReason(
  slot: ExamSlotKey,
  grade: string | null | undefined,
  term: Term,
): string | null {
  if (examAppliesTo(slot, grade, term)) return null;
  if (isElementaryGrade(grade)) return "초등학생은 중간·기말고사를 치지 않습니다";
  return "중1은 2학기에 중간·기말고사를 치지 않습니다";
}
