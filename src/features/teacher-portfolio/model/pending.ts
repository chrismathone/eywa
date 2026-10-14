/**
 * 아직 계산이 들어오지 않은 원장 구성 지표(2026-10-13 *"지금 바로 원장 8개 구성으로 바꿔"*) — 수치 없이 자리만 선다.
 * 수치가 null이라 지표의 '자료가 없을 때' 규칙(기본 0점, 결정 4)으로 매겨진다. 계산이 들어오면 그 지표는 여기서 빠진다.
 */
import { METRIC_MAX, type PendingMetric, type PendingMetricId } from "./types";

/** 지표 → 들어오는 단계 · 무엇을 세게 되는지(근거 화면이 그대로 보인다). */
export const PENDING_NOTE: Record<PendingMetricId, string> = {
  grades: "성적관리에 등록된 성적(일일·확인 테스트 · 월말평가 · 내신)으로 매깁니다. 계산은 5단계에서 들어옵니다.",
  satisfaction: "학부모 글·댓글의 문구 판정(확실한 것은 바로, 애매한 것은 확인 뒤)과 원장·관리자가 넣은 클레임을 총점에 그대로 더하고 뺍니다. 계산은 3단계에서 들어옵니다.",
  punctuality: "메이크에듀 출퇴근 기록의 지각·결근 횟수(연차 제외)로 매깁니다. 연동 앱이 출퇴근을 가져오는 4단계에서 들어옵니다.",
};

export const PENDING_IDS = Object.keys(PENDING_NOTE) as PendingMetricId[];

export function pendingItems(): PendingMetric[] {
  return PENDING_IDS.map((id) => ({ id, max: METRIC_MAX[id], value: null, raw: null, basis: "아직 계산 전", reason: PENDING_NOTE[id], detail: [], uncounted: true }));
}
