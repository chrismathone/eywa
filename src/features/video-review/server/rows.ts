import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureLicensed, isFeatureOptedIn } from "@/lib/license/server";
import type { ReviewAssets, ReviewResult, ReviewStage, ReviewTranscript } from "../types";

/** 0390a `homework_video_reviews` 한 줄(서버 전용 — 전사·판정 원문을 담는다, 화면으로 내보내지 않는다). */
export type ReviewRow = {
  id: string;
  tenant_id: string;
  video_id: string;
  stage: ReviewStage;
  attempts: number;
  lock_token: string | null;
  assets: ReviewAssets | null;
  transcript_id: string | null;
  transcript: ReviewTranscript | null;
  judge: unknown;
  verify: unknown;
  result: ReviewResult | null;
  judge_batch: string | null;
  verify_batch: string | null;
  models: Record<string, string>;
  error: string | null;
  requested_at: string | null;
  done_at: string | null;
  updated_at: string;
};

export const REVIEW_COLUMNS =
  "id,tenant_id,video_id,stage,attempts,lock_token,assets,transcript_id,transcript,judge,verify,result,judge_batch,verify_batch,models,error,requested_at,done_at,updated_at";

export const db = () => createAdminClient();

/** 지점 스위치(운영 콘솔 라이선스 `video_review`, 기본 꺼짐). 꺼진 지점은 대기열·작업·화면 전부 없는 것처럼. */
export function videoReviewEnabled(tenantId: string): Promise<boolean> {
  return isFeatureOptedIn(tenantId, "video_review");
}

/** 외부 AI로 새 작업을 보낼 수 있는가. 이미 낸 전사·배치의 수거는 이 값과 무관하게 계속한다. */
export function aiAnalysisEnabled(tenantId: string): Promise<boolean> {
  return isFeatureLicensed(tenantId, "ai_analysis");
}

/** 단계 이름 말고도 같아야 하는 칸 — 배치 번호·실행 토큰(늦게 도착한 옛 수거가 새 분석을 덮지 않게, 적대 리뷰 2026-10-20). */
export type RowMatch = Partial<Record<"judge_batch" | "verify_batch" | "lock_token" | "transcript_id", string | null>>;

/** 단계를 옮긴다 — 예상한 단계(+ match 칸)일 때만. 옮겼으면 true. */
export async function moveStage(
  row: Pick<ReviewRow, "id" | "tenant_id">, from: ReviewStage | readonly ReviewStage[], patch: Record<string, unknown>, match: RowMatch = {},
): Promise<boolean> {
  const froms = typeof from === "string" ? [from] : [...from];
  let q = db().from("homework_video_reviews").update(patch).eq("tenant_id", row.tenant_id).eq("id", row.id).in("stage", froms);
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v as string);
  const { data, error } = await q.select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * 외부로 보내기 **전에** 줄을 선점한다 — from → to로 옮기며 실행 토큰을 찍고, 실제로 옮겨진 줄만 돌려준다.
 * cron이 겹쳐 돌아도 한 줄은 한 실행만 가져간다(전사·배치를 두 번 내는 과금 방지, 적대 리뷰 2026-10-20).
 */
/** 선점하는 단계마다 비울 '이전 외부 작업 번호' — 늦게 온 옛 결과·웹훅이 새 선점을 건드리지 못하게(2차 적대 리뷰 2026-10-20). */
const STALE_EXTERNAL: Partial<Record<ReviewStage, string>> = { transcribing: "transcript_id", judging: "judge_batch", verifying: "verify_batch" };

export async function claimRows(tenantId: string, from: ReviewStage, to: ReviewStage, limit: number): Promise<{ token: string; rows: ReviewRow[] }> {
  const token = randomUUID();
  const { data: picked, error } = await db().from("homework_video_reviews").select("id")
    .eq("tenant_id", tenantId).eq("stage", from).lte("available_at", new Date().toISOString())
    .order("created_at").limit(limit);
  if (error) throw error;
  const ids = (picked ?? []).map((r) => r.id as string);
  if (!ids.length) return { token, rows: [] };
  const { data, error: claimError } = await db().from("homework_video_reviews")
    .update({ stage: to, lock_token: token, locked_at: new Date().toISOString(), ...(STALE_EXTERNAL[to] ? { [STALE_EXTERNAL[to]!]: null } : {}) })
    .eq("tenant_id", tenantId).eq("stage", from).in("id", ids).select(REVIEW_COLUMNS);
  if (claimError) throw claimError;
  return { token, rows: (data ?? []) as unknown as ReviewRow[] };
}

/** 실패 처리 — 횟수가 남으면 retryStage로 뒤로 미루고, 넘으면 failed(한글 사유). 지금 단계·토큰이 그대로일 때만. */
export async function failOrRetry(row: ReviewRow, retryStage: ReviewStage, message: string, maxAttempts = 3, match: RowMatch = {}): Promise<void> {
  const attempts = row.attempts + 1;
  const giveUp = attempts >= maxAttempts;
  const waitMin = [5, 30, 120][Math.min(attempts - 1, 2)];
  await moveStage(row, row.stage, giveUp
    ? { stage: "failed", attempts, error: message.slice(0, 300), lock_token: null, locked_at: null }
    : { stage: retryStage, attempts, error: message.slice(0, 300), lock_token: null, locked_at: null,
        available_at: new Date(Date.now() + waitMin * 60_000).toISOString() }, match);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
