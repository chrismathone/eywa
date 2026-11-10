import "server-only";
import { randomUUID } from "node:crypto";
import { isFeatureOptedIn } from "@/lib/license/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { pickDue } from "../due";
import { CONSULT_RUBRIC_ID } from "../harness/rubric";

/**
 * 원생상담 평점 정기 처리 대기열(s2_0044 `student_consultation_rating_queue`). 지점 스위치 'consult_rating'(운영 콘솔 · 행 없음 = 꺼짐)을 켠 지점만.
 * 수업보고서 평점 대기열(report-rating/server/queue.ts)과 같은 모양 — 다른 점: 상담은 **고칠 수 있다**(보고서는 보낸 뒤 안 바뀐다) → 줄 세우는 조건이
 * '지금 기준 평점이 없다'뿐 아니라 '평점을 매긴 뒤 고쳐졌다'까지다.
 * 🔴 admin(RLS 우회) — 모든 조회·쓰기에 tenant_id. 표가 없으면(s2_0044 적용 전) 아무것도 하지 않는다([[#95]]).
 */
export const db = () => createAdminClient();
export const QUEUE = "student_consultation_rating_queue";
export const RATINGS = "student_consultation_ratings";
export const MAX_ATTEMPTS = 3;

export type QueueRow = { consultation_id: string; tenant_id: string; stage: string; input_hash: string | null; source_updated_at: string | null; rubric: string | null; batch_id: string | null; custom_id: string | null; attempts: number; lock_token: string | null; created_at: string; updated_at: string };
export const QUEUE_COLS = "consultation_id, tenant_id, stage, input_hash, source_updated_at, rubric, batch_id, custom_id, attempts, lock_token, created_at, updated_at";

export function consultationRatingEnabled(tenantId: string): Promise<boolean> {
  return isFeatureOptedIn(tenantId, "consult_rating");
}

/** 대기열 표가 있는가 — 없으면(42P01·PGRST205) false, 그 밖의 오류는 던진다. */
export async function ratingQueueReady(tenantId: string): Promise<boolean> {
  const { error } = await db().from(QUEUE).select("consultation_id").eq("tenant_id", tenantId).limit(1);
  if (!error) return true;
  if (error.code === "42P01" || error.code === "PGRST205" || /schema cache|does not exist/.test(error.message)) return false;
  throw new Error(error.message);
}

/**
 * 줄 세울 상담 — 판정은 순수 함수 [`pickDue`](../due.ts)(평점이 없거나 · 재료를 읽은 뒤 고쳐졌거나 · 기준 판이 올랐거나; 닫힌 줄은 고쳐지기 전엔 안 세운다).
 * 🔴 `updated_at`은 후속 체크·반 판정 같은 사소한 저장에도 오른다 — 여기서는 **후보**만 고르고, 정말 달라졌는지는 입력 지문으로 보내기 전에 다시 확인한다
 * (같으면 평점 행의 source_updated_at만 올려 다음 바퀴에 후보가 되지 않게 한다 — batch.ts `touchUnchanged`).
 * 🔴 **동시 cron 보호**: 새 줄은 `ignoreDuplicates` 삽입만(이미 있는 줄을 건드리지 않는다), 끝난 줄(done·failed)을 다시 세우는 갱신은 **그 단계일 때만**(조건부 update) —
 *    늦게 도는 enqueue가 그 사이 `submitted`로 간 줄을 `queued`로 덮어 배치 번호를 지우면 과금된 배치를 수거할 길이 사라진다(Codex 리뷰 2026-11-11).
 * 반환 = 줄 세운 수.
 */
export async function enqueueConsultations(tenantId: string): Promise<number> {
  const [rows, rated, queued, tests] = await Promise.all([
    fetchAllPaged<{ id: string; student_id: string; updated_at: string }>((from, to) => db().from("student_consultations").select("id, student_id, updated_at")
      .eq("tenant_id", tenantId).order("id").range(from, to)),
    fetchAllPaged<{ consultation_id: string; source_updated_at: string | null }>((from, to) => db().from(RATINGS).select("consultation_id, source_updated_at")
      .eq("tenant_id", tenantId).eq("rubric", CONSULT_RUBRIC_ID).order("consultation_id").range(from, to)),
    fetchAllPaged<{ consultation_id: string; stage: string; rubric: string | null; source_updated_at: string | null }>((from, to) => db().from(QUEUE).select("consultation_id, stage, rubric, source_updated_at")
      .eq("tenant_id", tenantId).order("consultation_id").range(from, to)),
    fetchAllPaged<{ id: string }>((from, to) => db().from("students").select("id").eq("tenant_id", tenantId).eq("is_test", true).order("id").range(from, to)),
  ]);
  const due = pickDue(rows, rated, queued, new Set(tests.map((s) => s.id)), CONSULT_RUBRIC_ID);
  if (!due.length) return 0;
  const exists = new Set(queued.map((q) => q.consultation_id));
  const fresh = due.filter((id) => !exists.has(id));
  const again = due.filter((id) => exists.has(id));
  const now = new Date().toISOString();
  let n = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const slice = fresh.slice(i, i + 200).map((id) => ({ consultation_id: id, tenant_id: tenantId, stage: "queued", rubric: CONSULT_RUBRIC_ID }));
    const { data, error } = await db().from(QUEUE).upsert(slice, { onConflict: "consultation_id", ignoreDuplicates: true }).select("consultation_id");
    if (error) throw new Error(error.message);
    n += (data ?? []).length;
  }
  const chunks: string[][] = [];
  for (let i = 0; i < again.length; i += 100) chunks.push(again.slice(i, i + 100));
  for (let i = 0; i < chunks.length; i += 5) {
    const done = await Promise.all(chunks.slice(i, i + 5).map(async (ids) => {
      const { data, error } = await db().from(QUEUE).update({ stage: "queued", rubric: CONSULT_RUBRIC_ID, attempts: 0, error: null, lock_token: null, locked_at: null, batch_id: null, custom_id: null, updated_at: now })
        .eq("tenant_id", tenantId).in("consultation_id", ids).in("stage", ["done", "failed"]).select("consultation_id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    }));
    n += done.reduce((a, b) => a + b, 0);
  }
  return n;
}

/** 줄을 옮긴다 — 예상한 단계(+ 같은 칸)일 때만. 옮겼으면 true(늦은 수거·겹친 cron이 서로를 덮지 않게). */
export async function moveRow(tenantId: string, consultationId: string, from: string, patch: Record<string, unknown>, match: Record<string, string | null> = {}): Promise<boolean> {
  let q = db().from(QUEUE).update({ ...patch, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("consultation_id", consultationId).eq("stage", from);
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select("consultation_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** 보내기 전에 선점 — queued → submitting(실행 토큰). 실제로 옮겨진 줄만 돌려준다. 오래 손대지 않은 줄부터(updated_at). */
export async function claimQueued(tenantId: string, limit: number): Promise<{ token: string; rows: QueueRow[] }> {
  const token = randomUUID();
  const { data: picked, error } = await db().from(QUEUE).select("consultation_id").eq("tenant_id", tenantId).eq("stage", "queued")
    .lt("attempts", MAX_ATTEMPTS).order("updated_at").limit(limit);
  if (error) throw new Error(error.message);
  const ids = (picked ?? []).map((r) => r.consultation_id as string);
  if (!ids.length) return { token, rows: [] };
  const { data, error: e2 } = await db().from(QUEUE).update({ stage: "submitting", lock_token: token, locked_at: new Date().toISOString(), batch_id: null, custom_id: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("stage", "queued").in("consultation_id", ids).select(QUEUE_COLS);
  if (e2) throw new Error(e2.message);
  return { token, rows: (data ?? []) as QueueRow[] };
}

/** 실패 — 횟수가 남으면 queued로 되돌리고, 넘으면 failed(한글 사유). 그 상담 탓인 실패(거절·해석 불가·저장 실패)에만. */
export async function failOrRetry(row: QueueRow, from: string, message: string, match: Record<string, string | null>, at?: string | null): Promise<void> {
  const attempts = row.attempts + 1;
  // 🔴 닫을 때(failed) 그 상담의 시각·기준 판을 함께 적는다 — 안 적으면 pickDue가 '확인 못 한 줄'로 보고 30분마다 다시 세운다(재리뷰 2026-11-11).
  await moveRow(row.tenant_id, row.consultation_id, from, { stage: attempts >= MAX_ATTEMPTS ? "failed" : "queued", attempts, rubric: CONSULT_RUBRIC_ID, source_updated_at: at === undefined ? row.source_updated_at : at, error: message.slice(0, 300), lock_token: null, locked_at: null, batch_id: null, custom_id: null }, match);
}

/** 횟수를 쓰지 않고 queued로 되돌린다 — 그 상담 탓이 아닌 일(배치 전체가 못 나감 · 키·잔액 · 재료 조회 실패). 한 번의 장애로 그 사이 줄이 전부 failed로 굳지 않게. */
export async function releaseRow(row: QueueRow, from: string, message: string, match: Record<string, string | null>): Promise<void> {
  await moveRow(row.tenant_id, row.consultation_id, from, { stage: "queued", error: message.slice(0, 300), lock_token: null, locked_at: null, batch_id: null, custom_id: null }, match);
}
