// 평점 기준 v6 — 원장 점수표에 맞춘 판정(순수). 원장 2026-10-26 *"전혀 신뢰안가는 점수"* → *"원장님 점수표에 맞춤"* → *"진행해"*.
//
// 🔑 원장의 기준은 '학부모 감정'이 아니라 **정성·구체성**이었다(점수표 44건의 이유): 짧음·성의 없음 = 1 · 기본 = 2 ·
//    자동작성 수준(배운 것·결과·태도·과제가 고루) = 3 · 학부모에게 직접 건네는 성의(사정·일정 안내·부탁·진행 방식 설명) = 4 ·
//    아이를 부르며 자세히 + 앞으로 할 일 = 5.
// 🔑 판정 = Haiku가 원장 기준 + 원장이 매긴 예시(owner-anchors.ts)를 보고 1~5를 바로 매기고, 코드는 확실한 규칙 하나만 붙인다:
//    **손대지 않은 자동작성(ment_source='auto')은 3점까지**(점수표 44건 중 자동작성 11건 전부 3 이하).
//    정보 단위를 세는 코드 채점(v5)은 처음 보는 20건에서 r 0.5로 무너졌다 — '직접 건네는 성의'를 셀 수 없었다.
//    교차 시험(처음 보는 글): r 0.79~0.88 · 평균 차이 0.33~0.60 · 1점 이내 43~44/44. Sonnet이 더 나빴다(r 0.62~0.80).
// 실험 기록: D:\tmp\rating-trust-2026-10-26\v5\ (holistic.mjs · hscore.mjs).
import { createHash } from "node:crypto";
import type { OwnerAnchor } from "./owner-anchors";
import type { RatingReport } from "./types";

/** 저장 칸 `rubric` — 기준 문구·예시·카드 모양·상한 규칙이 바뀌면 올린다. 화면은 이 판으로 매긴 평점만 보여 준다. */
export const OWNER_RUBRIC_ID = "v6-owner44";

export const OWNER_RUBRIC = [
  "원장이 수업보고서를 평가하는 기준 — '이 보고서에 선생님의 정성과 이 아이에 대한 구체적인 이야기가 담겼는가'.",
  "- 5: 아이를 부르며 그날 이 아이의 모습·상황을 자세히 전하고, 앞으로 할 일(보충·지도·상담)까지 적었다. 직접 쓴 정성이 뚜렷하다.",
  "- 4: 이 아이에 맞춘 이야기나, 학부모에게 직접 건네는 성의 있는 말(상황 설명·일정 안내·부탁·진행 방식 설명)이 있다. 짧아도 성의가 보이면 4.",
  "- 3: 배운 것·결과·태도·과제가 고루 담긴 무난한 보고(자동작성 수준), 또는 적당한 개별 안내.",
  "- 2: 기본 사항 몇 가지뿐이고 이 아이에 대한 이야기가 없다.",
  "- 1: 한 문장·칸 내용을 그대로 옮김·성의 없음·아이와 상관없는 공지뿐.",
  "학부모가 받는 것과 같게 칸(진도·과제·태도)과 멘트를 함께 준다. 점수는 멘트의 정성으로 매긴다.",
].join("\n");

/** 카드에 싣는 칸 — 원장 점수표와 같은 다섯 칸(학부모가 받는 칸 + 멘트). */
export type OwnerCardFields = Pick<RatingReport, "progress" | "homework_score" | "attitude" | "homework_today" | "notes">;

export function ownerCard(r: OwnerCardFields): string {
  return [
    `진도: ${r.progress ?? ""}`,
    `지난 과제: ${r.homework_score ?? ""}`,
    `태도: ${r.attitude ?? ""}`,
    `오늘 과제: ${r.homework_today ?? ""}`,
    `멘트: ${String(r.notes ?? "").replace(/\s*\n\s*/g, " / ")}`,
  ].join("\n");
}

/** 멘트 지문 — 예시가 원장이 본 글 그대로인지 확인한다(공백 차이는 같은 글로 본다). */
export function notesHash(notes: string | null | undefined): string {
  return createHash("sha256").update(String(notes ?? "").replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

/** 예시 하나 = 카드 + 원장 점수(이유). 글은 DB에서 읽어 넘긴다(server/anchors.ts). */
export type LoadedAnchor = { anchor: OwnerAnchor; card: OwnerCardFields };

/** 시스템 지침 = 기준 + 원장이 매긴 예시 — 지점마다 같고 보고서마다 같아 캐시 지점이 된다(순서 고정). */
export function buildOwnerSystem(anchors: readonly LoadedAnchor[]): string {
  const examples = anchors.map(({ anchor, card }) => `${ownerCard(card)}\n→ 원장 ${anchor.score}점${anchor.why ? ` (${anchor.why})` : ""}`);
  return [OWNER_RUBRIC, "", "[원장이 직접 매긴 예시]", ...examples.flatMap((x) => [x, ""])].join("\n").trimEnd();
}

/** 보고서 한 건의 사용자 글(사실 원칙은 generateJSON이 앞에 붙인다). */
export function buildOwnerPrompt(r: OwnerCardFields): string {
  return [
    "[매길 보고서]",
    ownerCard(r),
    "",
    "위 기준과 예시의 눈높이에 맞춰 이 보고서를 1~5 정수로 매긴다. 근거는 멘트에서 인용한다.",
    '답은 JSON 하나만: {"score":3,"reason":"한 줄 이유","evidence":"멘트 인용"}',
  ].join("\n");
}

export type OwnerResult = { score: 1 | 2 | 3 | 4 | 5; reason: string; evidence: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 모델 응답 → 점수·이유·인용. 1~5 정수(문자 숫자 포함)가 아니면 null(다음 번에 다시). */
export function parseOwnerResult(data: unknown): OwnerResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const raw = typeof o.score === "number" ? o.score : typeof o.score === "string" && /^\s*[1-5]\s*$/.test(o.score) ? Number(o.score) : NaN;
  if (!Number.isInteger(raw) || raw < 1 || raw > 5) return null;
  return { score: raw as OwnerResult["score"], reason: text(o.reason), evidence: text(o.evidence) };
}

/** 손대지 않은 자동작성 상한 — 원장 점수표에서 자동작성은 3점을 넘은 적이 없다. */
export const AUTO_MENT_CAP = 3;

/** 최종 점수 = 모델 점수 + 코드 규칙(자동작성 상한). */
export function ownerFinalScore(res: OwnerResult, mentSource: string | null | undefined): { score: number; capped: boolean } {
  if (mentSource === "auto" && res.score > AUTO_MENT_CAP) return { score: AUTO_MENT_CAP, capped: true };
  return { score: res.score, capped: false };
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type OwnerRatingRow = {
  report_id: string; points: number; items: { key: string; label: string; score: number; note: string }[];
  parent_feeling: null; suggestion: null; claim: null; claim_reason: null;
  rubric: string; model: string; input_hash: string;
};

/** 저장 행 — 항목은 '정성·구체성' 하나(이유 + 멘트 인용). 클레임·학부모 느낌·고칠 점은 이 기준에 없다. */
export function ownerRatingRow(reportId: string, res: OwnerResult, mentSource: string | null | undefined, model: string, inputHash: string): OwnerRatingRow {
  const { score, capped } = ownerFinalScore(res, mentSource);
  const parts = [
    capped ? `손대지 않은 자동작성 멘트라 ${AUTO_MENT_CAP}점까지` : "",
    res.reason,
    res.evidence ? `“${cut(res.evidence, 80)}”` : "",
  ].filter(Boolean);
  return {
    report_id: reportId, points: score,
    items: [{ key: "owner", label: "정성·구체성", score, note: cut(parts.join(" · "), 240) || "—" }],
    parent_feeling: null, suggestion: null, claim: null, claim_reason: null,
    rubric: OWNER_RUBRIC_ID, model, input_hash: inputHash,
  };
}

/**
 * 입력 지문 — 학부모가 받는 칸(카드 다섯 칸) + 작성 방식 + 기준 판. 보고서를 고쳐 다시 보내면 달라진다(수거 때 확인).
 * 작성 방식은 상한 규칙이 읽으므로 함께 넣는다(자동 → 수정으로 바뀌면 다시 매긴다).
 */
export function ownerInputHash(id: string, r: OwnerCardFields, mentSource: string | null | undefined): string {
  const own = [id, r.progress, r.homework_score, r.attitude, r.homework_today, r.notes, mentSource ?? null];
  return createHash("sha256").update(`${OWNER_RUBRIC_ID}\n${JSON.stringify(own)}`).digest("hex").slice(0, 32);
}
