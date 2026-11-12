import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import { bodyOf } from "../harness/card";
import { parseConsultationResult } from "../harness/parse";
import { emptyRow, isEmptyRecord, ratingRow } from "../harness/rules";
import type { ConsultationRatingInput, ConsultationRatingRow } from "../harness/types";
import { ratingRequest } from "../harness/request";

/**
 * 평점 즉시 호출(상담마다 요청 하나) — 배치와 **같은 지침·프롬프트·해석·점수**(기준 v1). 운영 조건 확인과 시험 실행기(CLI ↔ 배치 동등성 확인)가 쓴다.
 * 🔴 화면 버튼·페이지 로드에서 부르지 않는다(AI는 명시 트리거만 · 평점은 '다시 매기기'를 두지 않는다).
 * 저장은 하지 않는다 — 돌려받은 행을 부르는 쪽이 정한다. 빈 양식은 모델을 부르지 않고 규칙으로 1점.
 */
export async function rateConsultationsNow(tenantId: string, inputs: readonly ConsultationRatingInput[]): Promise<{ rows: (ConsultationRatingRow | null)[] }> {
  const rows: (ConsultationRatingRow | null)[] = [];
  for (const c of inputs) {
    if (isEmptyRecord(c)) { rows.push(emptyRow(c)); continue; }
    const res = await generateJSON<unknown>({ ...ratingRequest(tenantId, c), keyName: "consultations", meta: { feature: "student_consultation_rating", tenantId } });
    const parsed = parseConsultationResult(res.data, bodyOf(c));
    rows.push(parsed ? ratingRow(c, parsed, res.model) : null);
  }
  return { rows };
}
