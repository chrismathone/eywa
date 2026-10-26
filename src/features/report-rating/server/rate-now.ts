import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import { buildRatingPrompt } from "../harness/prompt";
import { checklistsOf, ratingInputHash, ratingRow, type RatingRow } from "../harness/rows";
import type { RatingReport } from "../harness/types";
import { ratingRequest } from "./batch";

/**
 * 평점 즉시 호출(묶음 하나 · 최대 5장) — 밤 배치와 **같은 지침·프롬프트·해석·점수**. 운영 조건 확인과 시험 실행기가 쓴다.
 * 🔴 화면 버튼·페이지 로드에서 부르지 않는다(AI는 명시 트리거만 · 평점은 '다시 매기기'를 두지 않는다 — reports-ai.md 2026-10-23).
 * 저장은 하지 않는다 — 돌려받은 행을 부르는 쪽이 정한다.
 */
export async function rateReportsNow(tenantId: string, reports: readonly RatingReport[]): Promise<{ rows: (RatingRow | null)[]; model: string }> {
  const { prompt, ids, signals } = buildRatingPrompt(reports);
  const res = await generateJSON<unknown>({ ...ratingRequest(tenantId, prompt), meta: { feature: "lesson_report_rating", tenantId } });
  const checks = checklistsOf(res.data, ids);
  return { model: res.model, rows: reports.map((r, i) => (checks[i] ? ratingRow(r, checks[i]!, signals[i], res.model, ratingInputHash(r)) : null)) };
}
