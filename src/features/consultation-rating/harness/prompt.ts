import { CONSULT_RUBRIC } from "./rubric";
import { consultationCard } from "./card";
import type { ConsultationRatingInput } from "./types";

/** 시스템 지침 — 기준(문안만 · 앵커 예시는 아직 없다). 사실 원칙은 generateJSON이 앞에 붙인다. */
export const CONSULT_SYSTEM = CONSULT_RUBRIC;

/** 상담 한 건의 사용자 글 — 1건 = 1요청(묶음 채점은 서로를 비교 기준으로 삼는다). */
export function buildConsultationPrompt(c: ConsultationRatingInput): string {
  return [
    "[평가할 상담 기록]",
    consultationCard(c),
    "",
    "위 기준으로 이 기록 하나를 1~5 정수로 매긴다. evidence는 본문에서 그대로 옮긴 구절만 쓴다(없으면 빈 문자열).",
    '답은 JSON 하나만: {"score":3,"reason":"한 줄 이유(40자 안팎)","evidence":"본문 인용","kinds":["schedule"],"present":{"reason":"present","context":"not_recorded","response":"not_recorded","next":"present"},"unsure":false}',
  ].join("\n");
}
