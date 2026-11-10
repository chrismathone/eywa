import "server-only";
import { randomUUID } from "node:crypto";
import { collectJSONBatch, submitJSONBatch, type BatchItem } from "@/lib/ai/generate-batch";
import { kstToday } from "@/lib/date-kst";
import { reportWarning } from "@/lib/observability/report-error";
import { bodyOf, consultationInputHash } from "../harness/card";
import { parseConsultationResult } from "../harness/parse";
import { RATING_FEATURE, ratingRequest } from "../harness/request";
import { CONSULT_RUBRIC_ID } from "../harness/rubric";
import { emptyRow, isEmptyRecord, ratingRow } from "../harness/rules";
import type { ConsultationRatingInput, ConsultationRatingRow } from "../harness/types";
import { loadCopyCounts, loadRatingMaterial, type RatingMaterial } from "./material";
import { QUEUE, QUEUE_COLS, RATINGS, claimQueued, db, failOrRetry, moveRow, releaseRow, type QueueRow } from "./queue";

/**
 * 상담 평점 배치(Anthropic Message Batches — 일반 호출의 50%) — generateJSON과 같은 관문(사실 원칙 · 지점 라이선스 · 키 그룹 'consultations')을 지난다.
 * 상담 한 건에 요청 하나(묶음 채점은 서로를 비교 기준으로 삼는다) · 기준 문안은 시스템 지침(캐시 지점).
 * 🔴 선점(submitting) 뒤 보낸다 · 수거는 배치 번호가 같은 줄만 바꾼다 · 저장은 **입력 지문이 그대로**일 때만(고쳐진 상담은 다시 줄을 선다).
 * 🔴 수거는 **줄 소유권(submitted → done 조건부 이동)을 먼저** 얻은 뒤 저장한다 — 늦은 수거·겹친 cron이 서로를 덮어쓰지 못하게(Codex 리뷰 2026-11-11).
 * 🔴 시도 횟수는 그 상담 탓인 실패에만 쓴다 — 배치 전체 장애(키·잔액·네트워크)·재료 조회 실패는 횟수 없이 되돌린다.
 * 🔴 지금 기준으로 매긴 평점이 입력까지 같으면 모델을 부르지 않는다(후속 체크 같은 사소한 저장이 비용이 되지 않게) — `touchUnchanged`.
 *    그런 '싼 줄'만 잡힌 바퀴는 멈추지 않고 다음 줄을 이어 집는다(대량 수정 때 새 상담이 몇 시간씩 밀리지 않게 — MAX_ROUNDS).
 * 🔴 처리 실패·금지 정보로 닫힌 줄은 점수로 바꾸지 않는다(대기열 failed + 한글 사유) — 닫을 때 옛 내용으로 매긴 평점이 남아 있으면 지운다(화면에 '—').
 */
const CLAIM_LIMIT = 60;
const MAX_ROUNDS = 8;
const WRITE_PARALLEL = 8;

/**
 * 독립 쓰기를 제한된 병렬로(B4 — 60건을 직렬 왕복하지 않는다). 🔴 한 건의 실패가 나머지를 건너뛰게 하지 않는다(allSettled) —
 * 배치 번호를 적는 쓰기가 중간에 멈추면 이미 과금된 배치를 수거할 길이 없는 줄이 남는다(재리뷰 2026-11-11). 첫 오류는 다 끝난 뒤 다시 던진다.
 */
async function inParallel(tasks: readonly (() => Promise<unknown>)[], width = WRITE_PARALLEL): Promise<void> {
  let first: unknown;
  for (let i = 0; i < tasks.length; i += width) {
    for (const r of await Promise.allSettled(tasks.slice(i, i + width).map((t) => t()))) if (r.status === "rejected" && first === undefined) first = r.reason;
  }
  if (first !== undefined) throw first;
}

/** 평점 저장 — 상담 하나에 행 하나(기준 판이 바뀌면 같은 행을 새 값으로 바꾼다). `sourceUpdatedAt` = 재료를 읽던 때 그 상담의 updated_at. */
export async function saveRating(tenantId: string, row: ConsultationRatingRow, source: "cli" | "batch", sourceUpdatedAt: string | null): Promise<string | null> {
  const now = new Date().toISOString();
  const { error } = await db().from(RATINGS).upsert({ ...row, tenant_id: tenantId, source, rated_on: kstToday(), source_updated_at: sourceUpdatedAt, updated_at: now }, { onConflict: "consultation_id" });
  return error ? error.message : null;
}

type Lock = Record<string, string | null>;

/** 매길 수 없어 닫는다 — 줄은 failed(+ 그때의 상담 시각·기준 판), 옛 평점이 있으면 지운다. */
async function closeRow(tenantId: string, row: QueueRow, from: string, reason: string, match: Lock, at: string | null): Promise<void> {
  const moved = await moveRow(tenantId, row.consultation_id, from, { stage: "failed", error: reason.slice(0, 300), rubric: CONSULT_RUBRIC_ID, source_updated_at: at, lock_token: null, locked_at: null, batch_id: null, custom_id: null }, match);
  if (!moved) return;
  const { error } = await db().from(RATINGS).delete().eq("tenant_id", tenantId).eq("consultation_id", row.consultation_id);
  if (error) reportWarning("닫힌 상담의 옛 평점을 지우지 못했습니다", { scope: "consultation-rating.close", consultationId: row.consultation_id, error: error.message });
}

/** 지금 기준으로 이미 매긴 평점의 입력 지문(상담 id → 지문). */
async function currentHashes(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const { data, error } = await db().from(RATINGS).select("consultation_id, input_hash").eq("tenant_id", tenantId).eq("rubric", CONSULT_RUBRIC_ID).in("consultation_id", ids as string[]);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.consultation_id as string, r.input_hash as string]));
}

/** 입력이 그대로인 상담 — 모델을 부르지 않고 평점 행의 source_updated_at만 올려 다음 바퀴에 후보가 되지 않게 한다. */
async function touchUnchanged(tenantId: string, row: QueueRow, lock: Lock, at: string | null): Promise<void> {
  const { error } = await db().from(RATINGS).update({ source_updated_at: at, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("consultation_id", row.consultation_id);
  if (error) { await failOrRetry(row, "submitting", `평점 확인 실패: ${error.message}`, lock, at); return; }
  await moveRow(tenantId, row.consultation_id, "submitting", { stage: "done", error: null, rubric: CONSULT_RUBRIC_ID, source_updated_at: at, lock_token: null, locked_at: null }, lock);
}

/** 빈 양식 — 모델 없이 규칙으로 1점(저장 → 줄 끝). */
async function saveEmpty(tenantId: string, row: QueueRow, c: ConsultationRatingInput, lock: Lock, at: string | null): Promise<void> {
  const err = await saveRating(tenantId, emptyRow(c), "batch", at);
  if (err) await failOrRetry(row, "submitting", `평점 저장 실패: ${err}`, lock, at);
  else await moveRow(tenantId, row.consultation_id, "submitting", { stage: "done", error: null, rubric: CONSULT_RUBRIC_ID, source_updated_at: at, lock_token: null, locked_at: null }, lock);
}

type Plan = { row: QueueRow; customId: string; hash: string; at: string | null };

/** 한 바퀴 — 선점한 줄을 가르고(싼 줄은 바로 끝내고) 모델 요청이 있으면 배치로 보낸다. 요청을 실은 수와 요청이 있었는지를 돌려준다. */
async function submitRound(tenantId: string, token: string, rows: QueueRow[], copies: Map<string, number>): Promise<{ sent: number; requested: boolean }> {
  const lock: Lock = { lock_token: token };
  const ids = rows.map((r) => r.consultation_id);
  let material: RatingMaterial;
  let current: Map<string, string>;
  try { [material, current] = await Promise.all([loadRatingMaterial(tenantId, ids, copies), currentHashes(tenantId, ids)]); }
  catch (e) { for (const row of rows) await releaseRow(row, "submitting", `평점 재료를 읽지 못했습니다: ${errorText(e)}`, lock); throw e; }
  const items: BatchItem[] = [];
  const plan: Plan[] = [];
  const cheap: (() => Promise<unknown>)[] = [];
  for (const row of rows) {
    const c = material.inputs.get(row.consultation_id);
    const at = material.updatedAt.get(row.consultation_id) ?? null;
    if (!c) { const why = material.skip.get(row.consultation_id)?.reason ?? "평점 대상이 아닙니다"; cheap.push(() => closeRow(tenantId, row, "submitting", why, lock, at)); continue; }
    const hash = consultationInputHash(c);
    if (current.get(c.id) === hash) { cheap.push(() => touchUnchanged(tenantId, row, lock, at)); continue; }
    if (isEmptyRecord(c)) { cheap.push(() => saveEmpty(tenantId, row, c, lock, at)); continue; }
    const customId = `cr_${randomUUID().replace(/-/g, "")}`;
    items.push({ customId, opts: ratingRequest(tenantId, c) });
    plan.push({ row, customId, hash, at });
  }
  await inParallel(cheap);
  if (!items.length) return { sent: 0, requested: false };
  // 배치 전체가 못 나가면(키·잔액·라이선스·네트워크) 그 상담 탓이 아니다 — 횟수 없이 되돌리고 단계 실패로 알린다.
  let sent;
  try { sent = await submitJSONBatch(items); }
  catch (e) { await inParallel(plan.map((p) => () => releaseRow(p.row, "submitting", `평점 배치 보내기 실패: ${errorText(e)}`, lock))); throw e; }
  if (!sent?.batchId) {
    const why = sent?.rejected?.[0]?.error ?? "평점 배치를 만들지 못했습니다";
    await inParallel(plan.map((p) => () => releaseRow(p.row, "submitting", why, lock)));
    throw new Error(why);
  }
  const rejected = new Map((sent.rejected ?? []).map((r) => [r.customId, r.error]));
  let n = 0;
  await inParallel(plan.map((p) => async () => {
    if (rejected.has(p.customId) || !sent.models[p.customId]) { await releaseRow(p.row, "submitting", rejected.get(p.customId) ?? "평점 배치에 싣지 못했습니다", lock); return; }
    // 배치 번호를 줄에 적기 전에 죽으면 그 요청은 수거할 수 없다 — 그래서 보낸 직후 곧바로 병렬로 적는다(recoverStuck가 15분 뒤 되돌린다).
    const ok = await moveRow(tenantId, p.row.consultation_id, "submitting",
      { stage: "submitted", batch_id: sent.batchId, custom_id: `${p.customId}#0`, input_hash: p.hash, source_updated_at: p.at, rubric: CONSULT_RUBRIC_ID, model: sent.models[p.customId], lock_token: null, locked_at: null }, lock);
    if (ok) n++;
  }));
  return { sent: n, requested: true };
}

export async function submitRatingBatch(tenantId: string): Promise<number> {
  let copies: Map<string, number> | null = null; // 지점 전체 상담을 한 바퀴에 한 번만 읽는다
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { token, rows } = await claimQueued(tenantId, CLAIM_LIMIT);
    if (!rows.length) return 0;
    try { copies ??= await loadCopyCounts(tenantId); }
    catch (e) { for (const row of rows) await releaseRow(row, "submitting", `평점 재료를 읽지 못했습니다: ${errorText(e)}`, { lock_token: token }); throw e; }
    const { sent, requested } = await submitRound(tenantId, token, rows, copies);
    if (requested) return sent; // 모델 요청을 실은 바퀴에서 멈춘다 — 싼 줄만 잡힌 바퀴는 다음 줄을 이어 집는다
  }
  return 0;
}

export async function collectRatingBatches(tenantId: string): Promise<number> {
  const copies: { v: Map<string, number> | null } = { v: null }; // 같은 글 수는 한 바퀴에 한 번만(배치마다 지점 전체 상담을 다시 읽지 않는다)
  const { data, error } = await db().from(QUEUE).select(QUEUE_COLS).eq("tenant_id", tenantId).eq("stage", "submitted").not("batch_id", "is", null).order("updated_at").limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as QueueRow[];
  let saved = 0;
  for (const batchId of new Set(rows.map((r) => r.batch_id!))) {
    const group = rows.filter((r) => r.batch_id === batchId);
    try { saved += await collectOne(tenantId, batchId, group, copies); }
    catch (e) {
      reportWarning("상담 평점 배치 수거 실패", { scope: "consultation-rating.collect", batchId, error: errorText(e) });
      for (const r of group.filter((x) => Date.now() - Date.parse(x.updated_at) > 2 * 86_400_000)) await releaseRow(r, "submitted", "배치 결과를 받지 못해 다시 보냅니다", { batch_id: batchId });
    }
  }
  return saved;
}

async function collectOne(tenantId: string, batchId: string, group: QueueRow[], copies: { v: Map<string, number> | null }): Promise<number> {
  const customIds = [...new Set(group.map((r) => r.custom_id!.split("#")[0]))];
  const metas = Object.fromEntries(customIds.map((id) => [id, { feature: RATING_FEATURE, tenantId }]));
  const outcomes = await collectJSONBatch(batchId, metas);
  if (!outcomes) return 0; // 아직 처리 중 — 다음 cron이 다시 묻는다
  copies.v ??= await loadCopyCounts(tenantId);
  const material = await loadRatingMaterial(tenantId, group.map((r) => r.consultation_id), copies.v);
  const match = { batch_id: batchId };
  let saved = 0;
  await inParallel(group.map((row) => async () => {
    const outcome = outcomes[row.custom_id!.split("#")[0]];
    if (!outcome?.ok) {
      const why = outcome?.error ?? "배치 결과가 없습니다";
      await (TRANSIENT_BATCH_ERROR.test(why) ? releaseRow : failOrRetry)(row, "submitted", why, match);
      return;
    }
    // 한 줄의 실패(해석·저장)가 같은 배치의 다른 줄 수거를 막지 않게 줄마다 감싼다.
    try { if (await collectRow(tenantId, row, material, outcome.data, outcome.model, match)) saved++; }
    catch (e) { await failOrRetry(row, "submitted", `평점 수거 실패: ${errorText(e)}`, match); }
  }));
  return saved;
}

/** 수거한 줄 하나 — 저장했으면 true. 상담이 그 사이 고쳐졌으면(지문이 다르면) 저장하지 않고 다시 줄을 세운다. */
async function collectRow(tenantId: string, row: QueueRow, material: RatingMaterial, data: unknown, model: string, match: Lock): Promise<boolean> {
  const c = material.inputs.get(row.consultation_id);
  if (!c) { await closeRow(tenantId, row, "submitted", material.skip.get(row.consultation_id)?.reason ?? "평점 대상이 아닙니다", match, material.updatedAt.get(row.consultation_id) ?? null); return false; }
  if (consultationInputHash(c) !== row.input_hash) { await releaseRow(row, "submitted", "상담이 바뀌어 다시 매깁니다", match); return false; }
  const res = parseConsultationResult(data, bodyOf(c));
  if (!res) { await failOrRetry(row, "submitted", "평점 응답을 해석하지 못했습니다", match); return false; }
  // 소유권 먼저 — 이 줄이 아직 이 배치의 것일 때만 done으로 옮기고(조건부), 옮긴 쪽만 저장한다. 저장이 실패하면 done에서 다시 줄로 되돌린다.
  if (!(await moveRow(tenantId, row.consultation_id, "submitted", { stage: "done", error: null }, match))) return false;
  const err = await saveRating(tenantId, ratingRow(c, res, model), "batch", row.source_updated_at);
  if (err) { await failOrRetry(row, "done", `평점 저장 실패: ${err}`, match); return false; }
  return true;
}

// 배치 항목의 만료·취소·과부하·서버 오류는 그 상담 탓이 아니다 — 횟수는 해석 불가·잘못된 요청·거절에만 쓴다.
const TRANSIENT_BATCH_ERROR = /(만료|취소|overloaded|api_error|rate_limit|timeout|배치 결과가 없습니다)/;
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
