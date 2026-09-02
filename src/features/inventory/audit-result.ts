/**
 * 실사 결과 — 코드 고정 enum(순수). 색은 tone(의미색 캐논)으로만 고른다.
 */
import type { PillColor } from "@/components/atoms/pill";
import { type SemanticTone, toneColor } from "@/lib/design/semantic-color";

export const AUDIT_RESULTS = ["ok", "missing", "hold"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const AUDIT_RESULT_LABEL: Record<AuditResult, string> = {
  ok: "확인",
  missing: "미확인",
  hold: "보류",
};

/** 확인=정상(positive) · 미확인=못 찾음(critical) · 보류=다시 볼 것(caution). */
export const AUDIT_RESULT_TONE: Record<AuditResult, SemanticTone> = {
  ok: "positive",
  missing: "critical",
  hold: "caution",
};

export function isAuditResult(v: unknown): v is AuditResult {
  return typeof v === "string" && (AUDIT_RESULTS as readonly string[]).includes(v);
}

export function auditResultLabel(result: string | null | undefined): string {
  if (!result) return "";
  return isAuditResult(result) ? AUDIT_RESULT_LABEL[result] : result;
}

export function auditResultMeta(result: string): { label: string; color: PillColor; tone: SemanticTone } {
  const tone: SemanticTone = isAuditResult(result) ? AUDIT_RESULT_TONE[result] : "inert";
  return { label: auditResultLabel(result), color: toneColor(tone), tone };
}
