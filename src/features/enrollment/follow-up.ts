import { ENROLLED_REVERT_BLOCKED, outcomeForDrop, stageOfOutcome, type BoardStageKey } from "./board-stages";

/**
 * 신규 콜&상담 **후속 조치**(원장 2026-10-22 *"후속 조치를 선택이 아닌 필수로 처리를 해서 자동적으로 이동처리 · 자동적으로 등록,
 * 미등록으로 처리 하기 · 선택 : 등록, 미등록 · 날짜 : 선택. 다음상담 진행 여부 등"* — 필수 시점 = *"상담 끝난 건을 저장할 때"*).
 *
 * 고르는 값 셋 = 등록 · 미등록 · 다음 상담(날짜). 고르면 칸반 칸이 따라 움직인다 — 상태(outcome)를 따로 고칠 일이 없다.
 * 🔑 새 DB 칸이 없다: 등록·미등록은 상태 그 자체이고, '다음 상담'은 '상담 완료' 칸 + 후속 조치일(`follow_up_date`)이다.
 * 🔑 칸 안의 원래 값은 지킨다(`outcomeForDrop` — 칸반 드롭과 같은 규칙: 노쇼를 '미등록'으로 고쳐 저장해도 노쇼 그대로).
 * 🔴 '등록 완료'를 '상담 완료'로 되돌리지 않는다 — 상태 변경(`setEnrollmentOutcome`)·칸반 드롭과 같은 문장(`ENROLLED_REVERT_BLOCKED`).
 * 순수 함수 — 화면(미리 막기)과 서버(게이트, #77)가 같이 부른다.
 */
export type FollowUpResult = "enrolled" | "declined" | "next";

export const FOLLOW_UP_RESULTS: readonly { value: FollowUpResult; label: string; stage: BoardStageKey }[] = [
  { value: "enrolled", label: "등록", stage: "enrolled" },
  { value: "declined", label: "미등록", stage: "unregistered" },
  { value: "next", label: "다음 상담", stage: "consulted" },
];

export const FOLLOW_UP_REQUIRED_ERROR = "후속 조치를 골라 주세요 — 등록 · 미등록 · 다음 상담(날짜) 중 하나";
export const FOLLOW_UP_DATE_REQUIRED = "다음 상담 날짜를 넣어 주세요";
export const FOLLOW_UP_DATE_PAST = "다음 상담 날짜가 이미 지났습니다 — 오늘 이후로 넣어 주세요";

export function parseFollowUpResult(v: unknown): FollowUpResult | null {
  return v === "enrolled" || v === "declined" || v === "next" ? v : null;
}

/** 저장 뒤 '상담 완료' 칸에 놓이는 상담이면 후속 조치를 반드시 고른다(상담 전 접수 · 이미 등록·미등록으로 끝난 상담은 면제). */
export function followUpRequired(outcomeAfterSave: string): boolean {
  return stageOfOutcome(outcomeAfterSave) === "consulted";
}

/** 화면이 처음 고른 채로 보여 줄 값 — 지금 칸에서 읽는다. 상담 완료 칸은 후속 조치일이 있을 때만 '다음 상담'(없으면 비워 고르게 한다). */
export function initialFollowUpResult(outcome: string | null | undefined, followUpDate: string | null | undefined): FollowUpResult | null {
  if (!outcome) return null;
  const stage = stageOfOutcome(outcome);
  if (stage === "enrolled") return "enrolled";
  if (stage === "unregistered") return "declined";
  if (stage === "consulted" && followUpDate) return "next";
  return null;
}

/**
 * 저장할 상태 정하기.
 * @param current 저장 전 상태(새 상담은 `consulted` — 직원이 쓰는 상담은 상담을 한 뒤다 · QR 접수를 '상담 완료로 저장'하면 `consulted`)
 * @param storedDate 저장돼 있던 후속 조치일(그대로 두면 지난 날짜라도 받는다 — 기한 지남 알림이 그 건을 말한다)
 * @returns 저장할 상태와 '등록 상태' 칸 값(등록·미등록을 고르면 같이 맞춘다 · 다음 상담은 손대지 않는다), 또는 막는 이유
 */
export function resolveFollowUp(input: {
  current: string;
  result: FollowUpResult | null;
  followUpDate: string | null;
  storedDate: string | null;
  today: string;
}): { outcome: string; registrationStatus: string | null } | { error: string } {
  const { current, result, followUpDate, storedDate, today } = input;
  if (!result) return followUpRequired(current) ? { error: FOLLOW_UP_REQUIRED_ERROR } : { outcome: current, registrationStatus: null };
  const target = FOLLOW_UP_RESULTS.find((r) => r.value === result)!.stage;
  if (current === "enrolled" && target !== "enrolled" && target !== "unregistered") return { error: ENROLLED_REVERT_BLOCKED };
  if (result === "next") {
    if (!followUpDate) return { error: FOLLOW_UP_DATE_REQUIRED };
    if (followUpDate < today && followUpDate !== storedDate) return { error: FOLLOW_UP_DATE_PAST };
  }
  return {
    outcome: outcomeForDrop(target, current),
    registrationStatus: result === "enrolled" ? "등록완료" : result === "declined" ? "미등록" : null,
  };
}

/**
 * 후속 조치가 아직 남은 상태 = 상담 전(대기·예약) · 상담 완료(상담·AI 완료) — 알림·할 일은 이 상태의 상담만 본다.
 * 🔴 DB 함수 `staff_tasks_private.enrollment_followup_active`(20261022190000)와 같은 목록 — 한쪽만 바꾸면 알림과 할 일이 갈린다.
 */
export const FOLLOW_UP_OPEN_OUTCOMES = ["pending", "scheduled", "consulted", "ai_done"] as const;
/** 알림·할 일 도입일 — 이 날 이후의 후속 조치일만(옛 상담의 지난 날짜는 울리지 않는다 · DB `enrollment_followup_start`와 같은 값). */
export const FOLLOW_UP_ALERT_START = "2026-10-22";
