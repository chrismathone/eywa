import "server-only";
import { generateJSON } from "@/lib/ai/generate";
import { buildOwnerPrompt, ownerInputHash, ownerRatingRow, parseOwnerResult, type OwnerRatingRow } from "../harness/owner";
import type { RatingReport } from "../harness/types";
import { loadOwnerSystem, ownerSystemProblem } from "./anchors";
import { ratingRequest } from "./batch";

/**
 * 평점 즉시 호출(보고서마다 요청 하나) — 밤 배치와 **같은 지침·프롬프트·해석·점수**(기준 v6). 운영 조건 확인과 시험 실행기가 쓴다.
 * 🔴 화면 버튼·페이지 로드에서 부르지 않는다(AI는 명시 트리거만 · 평점은 '다시 매기기'를 두지 않는다 — reports-ai.md 2026-10-23).
 * 저장은 하지 않는다 — 돌려받은 행을 부르는 쪽이 정한다. mentSource = 보고서별 멘트 작성 방식(자동작성 상한).
 */
export async function rateReportsNow(
  tenantId: string,
  reports: readonly RatingReport[],
  mentSource: ReadonlyMap<string, string | null> = new Map(),
): Promise<{ rows: (OwnerRatingRow | null)[] }> {
  const owner = await loadOwnerSystem(tenantId);
  const problem = ownerSystemProblem(owner);
  if (problem) throw new Error(problem);
  const rows: (OwnerRatingRow | null)[] = [];
  for (const r of reports) {
    const res = await generateJSON<unknown>({ ...ratingRequest(tenantId, owner.system, buildOwnerPrompt(r)), meta: { feature: "lesson_report_rating", tenantId } });
    const parsed = parseOwnerResult(res.data);
    const ms = mentSource.get(r.id) ?? null;
    rows.push(parsed ? ownerRatingRow(r.id, parsed, ms, res.model, ownerInputHash(r.id, r, ms)) : null);
  }
  return { rows };
}
