import { consultationInputHash } from "./card";
import { CONSULT_RUBRIC_ID } from "./rubric";
import { isBlankTemplate } from "./template";
import type { ConsultationRatingInput, ConsultationRatingResult, ConsultationRatingRow } from "./types";

/**
 * 코드 규칙 — 모델이 읽어도 바뀌지 않는 **확실한 것만**(Codex 협의 1차 2026-11-11: 길이·자리표시를 점수로 바꾸지 않는다).
 *  · empty  = 양식 머리·날짜·빈 항목명만 있고 상담 내용이 한 글자도 없다(후속 조치 칸에도 글이 없다) → 1점(모델을 부르지 않는다). 녹음 전사가 있으면 해당 없음.
 *    판정은 [`isBlankTemplate`](./template.ts) — 의심스러우면 모델이 읽는다(화면 미리보기 휴리스틱을 쓰지 않는다).
 *  · copied = 같은 글이 서로 다른 학생 둘 이상에게 그대로 입력됨 → 3점까지(아이마다 맞춘 글이 아니다 — 보고서 평점의 '같은 글은 이 아이만의 문장이 아니다'와 같다).
 */
export const COPY_CAP = 3;

export type RuleCode = "empty" | "copied";

/** 모델을 부르지 않고 정하는 경우 — 빈 양식. */
export function isEmptyRecord(c: Pick<ConsultationRatingInput, "summary" | "transcript" | "followUpAction">): boolean {
  return !c.transcript && !c.followUpAction?.trim() && isBlankTemplate(c.summary);
}

/** 최종 점수 = 모델 점수 + 코드 규칙(복사 상한). */
export function finalScore(res: ConsultationRatingResult, c: Pick<ConsultationRatingInput, "copyStudents">): { score: number; rule: RuleCode | null } {
  if (c.copyStudents > 1 && res.score > COPY_CAP) return { score: COPY_CAP, rule: "copied" };
  return { score: res.score, rule: null };
}

/** 저장 행 — 모델이 읽은 판정 + 규칙. `model`은 실제로 답한 모델. */
export function ratingRow(c: ConsultationRatingInput, res: ConsultationRatingResult, model: string): ConsultationRatingRow {
  const { score, rule } = finalScore(res, c);
  return {
    consultation_id: c.id, points: score, reason: res.reason, evidence: res.evidence, kinds: res.kinds,
    checks: { ...res.present, unsure: res.unsure }, rule, basis: c.transcript ? "recording" : "memo", rubric: CONSULT_RUBRIC_ID, model, input_hash: consultationInputHash(c),
  };
}

/** 빈 양식 행 — 모델 없이 1점. */
export function emptyRow(c: ConsultationRatingInput): ConsultationRatingRow {
  return {
    consultation_id: c.id, points: 1, reason: "상담 내용이 적히지 않은 빈 양식입니다", evidence: "", kinds: ["unknown"],
    checks: { reason: "not_recorded", context: "not_recorded", response: "not_recorded", next: "not_recorded", unsure: false },
    rule: "empty", basis: "memo", rubric: CONSULT_RUBRIC_ID, model: "rule", input_hash: consultationInputHash(c),
  };
}
