/**
 * 재료가 없을 때의 자리 — 성적 관리 · 학부모 만족도 · 강사 근태는 스냅샷의 `sources`로 센다(2026-10-15 원장 *"계산 안된거 … 다 해결해"*).
 * 재료가 없는 스냅샷(옛 스냅샷)이나 판정 표(0364a)를 아직 적용하지 않은 DB에선 그 지표가 수치 없이 자리만 선다 — '계산 전'
 * (수치가 null이라 그 지표의 '자료가 없을 때' 규칙으로 매겨진다). 2026-10-15 전에 저장된 달의 이 세 지표도 이 자리다.
 */
import type { GradesMetric, PunctualityMetric, SatisfactionMetric } from "./types";
import { METRIC_MAX } from "./types";

export const SOURCE_IDS = ["grades", "satisfaction", "punctuality"] as const;
export type SourceMetricId = (typeof SOURCE_IDS)[number];

const NOTE: Record<SourceMetricId, string> = {
  grades: "이 달은 성적 재료를 읽지 못해 세지 못했습니다.",
  satisfaction: "학부모 만족도를 저장하는 표가 아직 준비되지 않아 세지 못했습니다(DB에 반영되면 진행 중인 달부터 셉니다).",
  punctuality: "이 달은 출퇴근 재료를 읽지 못해 세지 못했습니다.",
};

export function uncountedItem<Id extends SourceMetricId>(id: Id): Extract<GradesMetric | SatisfactionMetric | PunctualityMetric, { id: Id }> {
  return { id, max: METRIC_MAX[id], value: null, raw: null, basis: "아직 계산 전", reason: NOTE[id], detail: [], uncounted: true } as unknown as
    Extract<GradesMetric | SatisfactionMetric | PunctualityMetric, { id: Id }>;
}
