import { ASSIGNED_DRAG_BLOCKED, BOARD_STAGES, ENROLLED_REVERT_BLOCKED, outcomeForDrop, stageOfOutcome, type BoardStageKey } from "./board-stages";

/**
 * 신규 콜&상담 **후속 조치**(원장 2026-10-22 *"후속 조치를 선택이 아닌 필수로 처리를 해서 자동적으로 이동처리 · 자동적으로 등록,
 * 미등록으로 처리 하기 · 선택 : 등록, 미등록 · 날짜 : 선택. 다음상담 진행 여부 등"* — 필수 시점 = *"상담 끝난 건을 저장할 때"*).
 *
 * 선택지·순서·이름은 칸반의 네 상태 그대로다(6b4fc88ab). 뜻은 결정 문서의 **등록 · 미등록 · 다음 상담(날짜 필수)** 셋이다(2026-10-23
 * 원장 *"골 프롬프트로 점검하고 바로 구현"* — Codex 검토 반영):
 *  · '상담 완료' = 다음 상담 → **다음 상담일 필수**(그날 알림·할 일이 그 날짜로 선다 — 날짜 없이 저장하면 아무것도 안 울린다)
 *  · 상담을 마친 건(저장 뒤 '상담 완료' 칸)은 '상담 전'을 고를 수 없다(필수 조치를 피하는 문이 된다)
 *  · 상담 전 접수(QR 등)를 그대로 저장하는 것·반 배정된 상담·등록·미등록은 날짜가 필요 없다.
 * ⚠️ 칸반 끌기·상세 '상태 변경'은 이 판정을 안 지난다(원장이 고른 필수 시점 = 저장) — 그래서 모든 미결에 날짜가 있는 것은 아니다.
 * 🔑 새 DB 칸이 없다: 상태는 outcome, 다음 상담일은 follow_up_date에 저장한다(저장은 폼 값으로 덮는다 — 칸을 비우면 날짜도 지워진다).
 * 🔑 칸 안의 원래 값은 지킨다(`outcomeForDrop` — 칸반 드롭과 같은 규칙: 노쇼를 '미등록'으로 고쳐 저장해도 노쇼 그대로).
 * 🔴 '등록 완료'를 '상담 완료'로 되돌리지 않는다 — 상태 변경(`setEnrollmentOutcome`)·칸반 드롭과 같은 문장(`ENROLLED_REVERT_BLOCKED`).
 * 순수 함수 — 화면(미리 막기)과 서버(게이트, #77)가 같이 부른다.
 */
export type FollowUpResult = BoardStageKey;

export const FOLLOW_UP_RESULTS: readonly { value: FollowUpResult; label: string; stage: BoardStageKey }[] =
  BOARD_STAGES.map(({ key, label }) => ({ value: key, label, stage: key }));

const stageLabel = (key: BoardStageKey) => BOARD_STAGES.find((stage) => stage.key === key)!.label;

export const FOLLOW_UP_REQUIRED_ERROR = `후속 조치를 골라 주세요 — ${stageLabel("consulted")}(다음 상담일) · ${stageLabel("unregistered")} · ${stageLabel("enrolled")} 중 하나`;
export const FOLLOW_UP_DATE_PAST = "다음 상담 날짜가 이미 지났습니다 — 오늘 이후로 넣어 주세요";
/** '상담 완료'(= 다음 상담)인데 날짜가 없다. */
export const FOLLOW_UP_DATE_REQUIRED = "다음 상담일을 넣어 주세요 — 그날 알림이 갑니다";
/** 상담을 마친 건을 '상담 전'으로 돌리려 했다(필수 조치를 피하는 문). */
export const FOLLOW_UP_BEFORE_BLOCKED = `상담을 마친 상담은 '${stageLabel("before")}'으로 돌릴 수 없습니다 — ${stageLabel("consulted")}(다음 상담일) · ${stageLabel("unregistered")} · ${stageLabel("enrolled")} 중에서 고르세요`;

export function parseFollowUpResult(v: unknown): FollowUpResult | null {
  // 배포 전 열린 폼과 로컬 초안도 같은 상태로 받는다.
  if (v === "declined") return "unregistered";
  if (v === "next") return "consulted";
  return FOLLOW_UP_RESULTS.find((r) => r.value === v)?.value ?? null;
}

/** 저장 뒤 '상담 완료' 칸에 놓이는 상담이면 후속 조치를 반드시 고른다(상담 전 접수 · 이미 등록·미등록으로 끝난 상담은 면제). */
export function followUpRequired(outcomeAfterSave: string): boolean {
  return stageOfOutcome(outcomeAfterSave) === "consulted";
}

/** 이미 결정했거나 다음 상담일을 정한 건은 현재 칸을 선택한다. 나머지 상담 완료 건은 명시적으로 고르게 한다. */
export function initialFollowUpResult(outcome: string | null | undefined, followUpDate: string | null | undefined, assignedClassCount = 0): FollowUpResult | null {
  if (assignedClassCount > 0) return "enrolled";
  if (!outcome) return null;
  const stage = stageOfOutcome(outcome);
  if (stage === "enrolled") return "enrolled";
  if (stage === "unregistered") return "unregistered";
  if (stage === "consulted" && followUpDate) return "consulted";
  return null;
}

/**
 * 저장할 상태 정하기.
 * @param current 저장 전 상태(새 상담은 `consulted` — 직원이 쓰는 상담은 상담을 한 뒤다 · QR 접수를 '상담 완료로 저장'하면 `consulted`)
 * @param storedDate 저장돼 있던 후속 조치일(그대로 두면 지난 날짜라도 받는다 — 기한 지남 알림이 그 건을 말한다)
 * @returns 칸반과 폼이 함께 사용하는 상태, 또는 막는 이유. 옛 registration_status는 쓰지 않는다.
 */
export function resolveFollowUp(input: {
  current: string;
  result: FollowUpResult | null;
  followUpDate: string | null;
  storedDate: string | null;
  today: string;
  assignedClassCount?: number;
}): { outcome: string } | { error: string } {
  const { current, result, followUpDate, storedDate, today } = input;
  if ((input.assignedClassCount ?? 0) > 0) {
    if (result && result !== "enrolled") return { error: ASSIGNED_DRAG_BLOCKED };
    return { outcome: "enrolled" };
  }
  if (!result) return followUpRequired(current) ? { error: FOLLOW_UP_REQUIRED_ERROR } : { outcome: current };
  const target = FOLLOW_UP_RESULTS.find((r) => r.value === result)!.stage;
  if (current === "enrolled" && target !== "enrolled" && target !== "unregistered") return { error: ENROLLED_REVERT_BLOCKED };
  if (target === "before" && followUpRequired(current)) return { error: FOLLOW_UP_BEFORE_BLOCKED };
  // 저장은 폼의 날짜로 덮으므로 판정도 폼의 날짜로 한다 — 저장돼 있던 날짜를 지우고 '상담 완료'로 저장하면 날짜가 사라진다.
  if (target === "consulted" && !followUpDate) return { error: FOLLOW_UP_DATE_REQUIRED };
  if ((target === "before" || target === "consulted") && followUpDate) {
    if (followUpDate < today && followUpDate !== storedDate) return { error: FOLLOW_UP_DATE_PAST };
  }
  return {
    outcome: outcomeForDrop(target, current),
  };
}

/**
 * 후속 조치가 아직 남은 상태 = 상담 전(대기·예약) · 상담 완료(상담·AI 완료) — 알림·할 일은 이 상태의 상담만 본다.
 * 🔴 DB 함수 `staff_tasks_private.enrollment_followup_active`(0441a)와 같은 목록 — 한쪽만 바꾸면 알림과 할 일이 갈린다.
 */
export const FOLLOW_UP_OPEN_OUTCOMES = ["pending", "scheduled", "consulted", "ai_done"] as const;
/** 알림·할 일 도입일 — 이 날 이후의 후속 조치일만(옛 상담의 지난 날짜는 울리지 않는다 · DB `enrollment_followup_start`와 같은 값). */
export const FOLLOW_UP_ALERT_START = "2026-10-22";
