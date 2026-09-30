/**
 * 원생상담 → 반 매핑 판정의 **앱 쪽 입구**. 규칙 원천은 makeedu 워커와 같은 CJS 파일
 * ([consultation-class.cjs](../../../scripts/_makeedu/consultation-class.cjs)) — 여기서 규칙을 다시 쓰지 말 것
 * (앱과 동기화가 같은 상담을 다른 반으로 붙이게 된다). 이 파일은 타입만 입힌다.
 *
 * 순수 모듈(서버·클라 공용) — `server-only`·`"use client"` 금지([[#61]]·[[#81]]).
 */
import {
  CLASS_REASON_LABEL as RULE_REASON_LABEL,
  keepManualClass as ruleKeepManual,
  resolveConsultationClass as ruleResolve,
} from "../../../scripts/_makeedu/consultation-class.cjs";

export type ClassCandidate = {
  classId: string;
  className: string | null;
  /** 반 과목 키(`classes.subject`, 학원설정 키). */
  subject: string | null;
  /** 그날 이 반을 가르치는 사람 — 담임 ∪ 그날 교시 담당. */
  teacherIds: string[];
};

export type ClassReason = "matched" | "no_counselor" | "no_enrollment" | "not_teaching" | "subject_mismatch" | "ambiguous";

export type ClassJudgement = { classId: string | null; reason: ClassReason };

/** 저장 출처 — auto = 자동 판정 · manual = 사람이 고름(반이 비었으면 '미매핑'을 고른 것) · null = 아직 판정 안 함. */
export type ClassSource = "auto" | "manual";

export function resolveConsultationClass(input: {
  counselorId: string | null;
  subject: string | null;
  /** 학원설정 과목 `{ key: label }` — 상담 과목 글자(키·라벨)를 키로 푼다. */
  labels: Record<string, string>;
  candidates: readonly ClassCandidate[];
}): ClassJudgement {
  return ruleResolve({ ...input, candidates: [...input.candidates] }) as ClassJudgement;
}

/** 자동 경로(엑셀·동기화)의 저장값 — 사람이 고른 값(manual)은 판정이 덮지 않는다. */
export function keepManualClass(input: {
  stored: { classId: string | null; source: string | null } | null;
  judged: { classId: string | null };
}): { classId: string | null; source: ClassSource } {
  return ruleKeepManual(input) as { classId: string | null; source: ClassSource };
}

export const CLASS_REASON_LABEL = RULE_REASON_LABEL as Record<ClassReason, string>;

/** `${studentId}|${YYYY-MM-DD}` — 후보 Map의 키(워커 `loadClassCandidates`와 같은 모양). */
export function candidateKey(studentId: string, date: string): string {
  return `${studentId}|${date}`;
}
