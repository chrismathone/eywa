import { EVIDENCE_STATES, KIND_CODES, type EvidenceState, type KindCode } from "./rubric";
import type { ConsultationRatingResult, PresentChecks } from "./types";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const squash = (s: string) => s.replace(/[\s"'“”‘’「」『』]+/g, "");

/**
 * 인용 검증 — evidence는 **본문에 실제로 있는 구절**만 남긴다(사실 원칙: 지어낸 인용을 화면에 내보내지 않는다).
 * 모델이 구절을 ' / ' · '…'로 이어 붙이는 일이 흔해 조각마다 대조한다. 하나도 못 찾으면 빈 문자열(점수는 그대로).
 */
export function verifiedQuote(evidence: string, body: string): string {
  const hay = squash(body);
  const kept = evidence.split(/\s*(?:\/|…|\.{3})\s*/).map((p) => p.replace(/^[\s"'“”‘’「」『』]+|[\s"'“”‘’「」『』]+$/g, "")).filter((p) => squash(p).length >= 2 && hay.includes(squash(p)));
  return cut(kept.join(" … "), 200);
}

function stateOf(v: unknown): EvidenceState {
  return (EVIDENCE_STATES as readonly string[]).includes(String(v)) ? (v as EvidenceState) : "unclear";
}

/** 모델 응답 → 판정. 점수가 1~5 정수(문자 숫자 포함)가 아니면 null(다음 번에 다시). 태그·네 칸은 모양이 틀려도 점수는 살린다. */
export function parseConsultationResult(data: unknown, body: string): ConsultationRatingResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const raw = typeof o.score === "number" ? o.score : typeof o.score === "string" && /^\s*[1-5]\s*$/.test(o.score) ? Number(o.score) : NaN;
  if (!Number.isInteger(raw) || raw < 1 || raw > 5) return null;
  const kinds = [...new Set((Array.isArray(o.kinds) ? o.kinds : []).map(String).filter((k): k is KindCode => (KIND_CODES as readonly string[]).includes(k)))].slice(0, 4);
  const p = (o.present && typeof o.present === "object" ? o.present : {}) as Record<string, unknown>;
  const present: PresentChecks = { reason: stateOf(p.reason), context: stateOf(p.context), response: stateOf(p.response), next: stateOf(p.next) };
  return {
    score: raw as ConsultationRatingResult["score"],
    reason: cut(text(o.reason), 120),
    evidence: verifiedQuote(text(o.evidence), body),
    kinds: kinds.length ? kinds : ["unknown"],
    present,
    unsure: o.unsure === true,
  };
}
