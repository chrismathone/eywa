import "server-only";
import { randomUUID } from "node:crypto";
import { isFeatureOptedIn } from "@/lib/license/server";
import { kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";

/**
 * 평점 정기 처리 대기열(0455a `lesson_report_rating_queue`). 지점 스위치 'report_rating'(운영 콘솔 · 행 없음 = 꺼짐)을 켠 지점만.
 * 🔴 admin(RLS 우회) — 모든 조회·쓰기에 tenant_id. 표가 없으면(0455a 적용 전) 아무것도 하지 않는다([[#95]]).
 */
export const db = () => createAdminClient();
export const QUEUE = "lesson_report_rating_queue";
/** 새로 줄 세우는 폭 — 발송된 지 이만큼 안의 보고서만(밀린 옛 보고서를 한꺼번에 몰아 매기지 않는다). */
export const ENQUEUE_DAYS = 14;
export const MAX_ATTEMPTS = 3;

export type QueueRow = { report_id: string; tenant_id: string; stage: string; input_hash: string | null; batch_id: string | null; custom_id: string | null; attempts: number; lock_token: string | null; created_at: string; updated_at: string };
export const QUEUE_COLS = "report_id, tenant_id, stage, input_hash, batch_id, custom_id, attempts, lock_token, created_at, updated_at";

export function reportRatingEnabled(tenantId: string): Promise<boolean> {
  return isFeatureOptedIn(tenantId, "report_rating");
}

/** 대기열 표가 있는가 — 없으면(42P01·PGRST205) false, 그 밖의 오류는 던진다. */
export async function ratingQueueReady(tenantId: string): Promise<boolean> {
  const { error } = await db().from(QUEUE).select("report_id").eq("tenant_id", tenantId).limit(1);
  if (!error) return true;
  if (error.code === "42P01" || error.code === "PGRST205" || /schema cache|does not exist/.test(error.message)) return false;
  throw new Error(error.message);
}

const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 정상 발송된 새 보고서(테스트 학생 제외 · 평점 없음 · 아직 줄 없음)를 줄 세운다. 줄 세운 수. */
export async function enqueueNewReports(tenantId: string, today: string = kstToday()): Promise<number> {
  const sent = await fetchAllPaged<{ id: string; student_id: string }>((from, to) => db().from("lesson_reports").select("id, student_id")
    .eq("tenant_id", tenantId).eq("classnote_status", "success").not("classnote_queued_at", "is", null)
    .gte("report_date", shift(today, -ENQUEUE_DAYS)).order("id").range(from, to));
  if (!sent.length) return 0;
  const ids = sent.map((r) => r.id);
  const [tests, rated, queued] = await Promise.all([
    fetchInChunks<{ id: string }>([...new Set(sent.map((r) => r.student_id))], (chunk) => db().from("students").select("id").eq("tenant_id", tenantId).eq("is_test", true).in("id", chunk)),
    fetchInChunks<{ report_id: string }>(ids, (chunk) => db().from("lesson_report_ratings").select("report_id").eq("tenant_id", tenantId).in("report_id", chunk)),
    fetchInChunks<{ report_id: string }>(ids, (chunk) => db().from(QUEUE).select("report_id").eq("tenant_id", tenantId).in("report_id", chunk)),
  ]);
  const testSet = new Set(tests.map((s) => s.id));
  const skip = new Set([...rated.map((r) => r.report_id), ...queued.map((r) => r.report_id)]);
  const fresh = sent.filter((r) => !testSet.has(r.student_id) && !skip.has(r.id)).map((r) => ({ report_id: r.id, tenant_id: tenantId, stage: "queued" }));
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await db().from(QUEUE).upsert(fresh.slice(i, i + 200), { onConflict: "report_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return fresh.length;
}

/** 줄을 옮긴다 — 예상한 단계(+ 같은 칸)일 때만. 옮겼으면 true(늦은 수거·겹친 cron이 서로를 덮지 않게). */
export async function moveRow(tenantId: string, reportId: string, from: string, patch: Record<string, unknown>, match: Record<string, string | null> = {}): Promise<boolean> {
  let q = db().from(QUEUE).update({ ...patch, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("report_id", reportId).eq("stage", from);
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select("report_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * 보내기 전에 선점 — queued → submitting(실행 토큰). 실제로 옮겨진 줄만 돌려준다.
 * 오래 손대지 않은 줄부터(updated_at) — 되돌려진 줄(발송 대기·일시 실패)이 앞을 막아 새 줄이 굶지 않게.
 */
export async function claimQueued(tenantId: string, limit: number): Promise<{ token: string; rows: QueueRow[] }> {
  const token = randomUUID();
  const { data: picked, error } = await db().from(QUEUE).select("report_id").eq("tenant_id", tenantId).eq("stage", "queued")
    .lt("attempts", MAX_ATTEMPTS).order("updated_at").limit(limit);
  if (error) throw new Error(error.message);
  const ids = (picked ?? []).map((r) => r.report_id as string);
  if (!ids.length) return { token, rows: [] };
  const { data, error: e2 } = await db().from(QUEUE).update({ stage: "submitting", lock_token: token, locked_at: new Date().toISOString(), batch_id: null, custom_id: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("stage", "queued").in("report_id", ids).select(QUEUE_COLS);
  if (e2) throw new Error(e2.message);
  return { token, rows: (data ?? []) as QueueRow[] };
}

/** 실패 — 횟수가 남으면 queued로 되돌리고, 넘으면 failed(한글 사유). 그 보고서 탓인 실패(거절·해석 불가·저장 실패)에만. */
export async function failOrRetry(row: QueueRow, from: string, message: string, match: Record<string, string | null>): Promise<void> {
  const attempts = row.attempts + 1;
  await moveRow(row.tenant_id, row.report_id, from, { stage: attempts >= MAX_ATTEMPTS ? "failed" : "queued", attempts, error: message.slice(0, 300), lock_token: null, locked_at: null, batch_id: null, custom_id: null }, match);
}

/**
 * 횟수를 쓰지 않고 queued로 되돌린다 — 그 보고서 탓이 아닌 일(배치 전체가 못 나감 · 키·잔액 · 재료 조회 실패 · 아직 발송 전).
 * 이런 실패에 횟수를 쓰면 한 번의 장애로 그 사이 줄이 전부 failed로 굳는다(적대 리뷰 2026-10-26).
 * 줄 선 지 WAIT_LIMIT_DAYS를 넘긴 '아직 발송 전'은 닫는다(끝내 안 나간 보고서가 대기열에 영영 남지 않게).
 */
export async function releaseRow(row: QueueRow, from: string, message: string, match: Record<string, string | null>): Promise<void> {
  await moveRow(row.tenant_id, row.report_id, from, { stage: "queued", error: message.slice(0, 300), lock_token: null, locked_at: null, batch_id: null, custom_id: null }, match);
}
export const WAIT_LIMIT_DAYS = ENQUEUE_DAYS;
export const waitedTooLong = (row: QueueRow, now = Date.now()) => now - Date.parse(row.created_at) > WAIT_LIMIT_DAYS * 86_400_000;
