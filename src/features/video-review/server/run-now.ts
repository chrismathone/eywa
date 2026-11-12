import "server-only";
import { randomUUID } from "node:crypto";
import { generateJSON } from "@/lib/ai/generate";
import { claimsFrom, verifyTargets } from "../harness/result";
import { parseVerdict, type VerifyVerdict } from "../harness/prompt-verify";
import { RUNNABLE_NOW } from "../view";
import { finalizeReview } from "./finalize";
import { loadMaterial } from "./material";
import { judgeRequest, verifyRequest } from "./requests";
import { REVIEW_COLUMNS, db, errorText, moveStage, type ReviewRow } from "./rows";

/**
 * '다시 분석'(일반 호출 · 정가) — 같은 요청(requests.ts)을 즉시 돌린다. 전사는 다시 하지 않는다.
 * 시작할 때 judging(배치 없음)으로 잡아 cron·다른 버튼과 겹치지 않게 하고, 실패하면 이전 결과를 지우지 않고 judge로 돌린다.
 */
export async function runReviewNow(tenantId: string, videoId: string, requestedBy: string): Promise<void> {
  const { data, error } = await db().from("homework_video_reviews").select(REVIEW_COLUMNS)
    .eq("tenant_id", tenantId).eq("video_id", videoId).maybeSingle();
  if (error) throw error;
  const row = data as unknown as ReviewRow | null;
  if (!row || !row.transcript || !row.assets) return;
  const now = new Date().toISOString();
  const token = randomUUID();
  // 실행 토큰으로 선점 — 끝날 때도 이 토큰이 그대로일 때만 저장한다(겹친 버튼·늦은 배치 수거와 서로 덮지 않게).
  if (!(await moveStage(row, RUNNABLE_NOW, { stage: "judging", judge_batch: null, lock_token: token, locked_at: now, requested_by: requestedBy, requested_at: now, error: null }))) return;
  const claimed = { ...row, stage: "judging" as const, lock_token: token };
  try {
    const m = await loadMaterial(claimed);
    // meta를 글자 그대로 적는다 — 가드(key-groups.test)가 호출부에서 기능 이름을 읽는다. 값은 requests.ts와 같다.
    const judged = await generateJSON<unknown>({ ...judgeRequest(tenantId, m), meta: { tenantId, feature: "video_review_judge" } });
    const claims = claimsFrom(judged.data as Parameters<typeof claimsFrom>[0]);
    const verdicts: VerifyVerdict[] = [];
    const raw: unknown[] = [];
    let verifyModel: string | null = null;
    for (const c of verifyTargets(claims)) {
      try {
        const v = await generateJSON<unknown>({ ...verifyRequest(tenantId, c, m), meta: { tenantId, feature: "video_review_verify" } });
        verdicts.push(parseVerdict(v.data)); raw.push(v.data); verifyModel = v.model;
      } catch (e) { verdicts.push("애매"); raw.push({ error: errorText(e) }); }
    }
    await finalizeReview(claimed, "judging", judged.data, verdicts, claims.length ? raw : null, { judge: judged.model, verify: verifyModel }, { lock_token: token });
  } catch (e) {
    await moveStage(claimed, "judging", { stage: row.result ? "done" : "judge", lock_token: null, locked_at: null, error: `다시 분석 실패: ${errorText(e)}`.slice(0, 300) }, { lock_token: token });
  }
}
