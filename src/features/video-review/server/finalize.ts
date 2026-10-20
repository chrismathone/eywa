import "server-only";
import { buildResult } from "../harness/result";
import type { VerifyVerdict } from "../harness/prompt-verify";
import { speechStats } from "../harness/transcript";
import { moveStage, type ReviewRow, type RowMatch } from "./rows";
import type { ReviewStage } from "../types";

/** 판정(+확인) 원문 → 결과를 저장하고 done으로. 이전 결과는 새 결과로 바뀐다(다시 분석). */
export async function finalizeReview(
  row: ReviewRow,
  from: ReviewStage | readonly ReviewStage[],
  judge: unknown,
  verdicts: VerifyVerdict[],
  verifyRaw: unknown,
  models: { judge: string | null; verify: string | null },
  /** 배치 번호·실행 토큰 — 늦게 온 옛 결과가 새 분석을 덮지 않게(적대 리뷰 2026-10-20). */
  match: RowMatch = {},
): Promise<boolean> {
  const result = buildResult({
    judge: (judge ?? {}) as Parameters<typeof buildResult>[0]["judge"],
    verdicts,
    speech: speechStats(row.transcript?.words ?? []),
    judgeModel: models.judge,
    verifyModel: models.verify,
    now: new Date(),
  });
  return moveStage(row, from, {
    stage: "done",
    judge,
    verify: verifyRaw,
    result,
    models: { ...row.models, judge: models.judge ?? "", verify: models.verify ?? "" },
    error: null,
    done_at: new Date().toISOString(),
    judge_batch: null,
    verify_batch: null,
    lock_token: null,
    locked_at: null,
  }, match);
}
