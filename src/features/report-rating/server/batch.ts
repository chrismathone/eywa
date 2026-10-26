import "server-only";
import { randomUUID } from "node:crypto";
import type { GenerateJSONOptions } from "@/lib/ai/generate";
import { collectJSONBatch, submitJSONBatch, type BatchItem } from "@/lib/ai/generate-batch";
import { kstToday } from "@/lib/date-kst";
import { reportWarning } from "@/lib/observability/report-error";
import { OWNER_RUBRIC_ID, buildOwnerPrompt, ownerInputHash, ownerRatingRow, parseOwnerResult, type OwnerResult } from "../harness/owner";
import { piiHits } from "../harness/pii";
import { loadOwnerSystem, ownerSystemProblem, type OwnerSystem } from "./anchors";
import { loadRatingMaterial, type RatingMaterial, type RatingSkip } from "./material";
import { QUEUE, QUEUE_COLS, WAIT_LIMIT_DAYS, claimQueued, db, failOrRetry, moveRow, releaseRow, waitedTooLong, type QueueRow } from "./queue";

/**
 * 평점 배치(Anthropic Message Batches — 일반 호출의 50%) — generateJSON과 같은 관문(사실 원칙 · 지점 라이선스 · 키 그룹 'ment')을 지난다.
 * 기준 = v6(원장 점수표 · harness/owner.ts) — 보고서 한 장에 요청 하나 · 기준과 원장 예시는 시스템 지침(캐시 지점, 지점마다 같다).
 * 🔴 선점(submitting) 뒤 보낸다 · 수거는 배치 번호가 같은 줄만 바꾼다 · 저장은 **입력 지문이 그대로**일 때만(고쳐 다시 보낸 보고서는 다시 줄 선다).
 * 🔴 시도 횟수는 그 보고서 탓인 실패에만 쓴다 — 배치 전체 장애(키·잔액·네트워크)·재료 조회 실패·발송 전은 횟수 없이 되돌린다.
 * 🔴 지금 기준(v6)으로 매긴 평점은 덮지 않는다 · 옛 기준 평점은 새 평점으로 바꾼다(화면은 지금 기준만 보여 준다).
 */
export const RATING_FEATURE = "lesson_report_rating";
const CLAIM_LIMIT = 60;

/** 요청 한 건 — 즉시 호출(`rateReportsNow`)과 같은 칸(바꾸면 둘 다). */
export function ratingRequest(tenantId: string, system: string, prompt: string): GenerateJSONOptions {
  return {
    system, cacheSystem: true, prompt, maxTokens: 32_000, tier: "fast", provider: "anthropic", allowedProviders: ["anthropic"],
    reasoningEffort: "medium", meta: { feature: RATING_FEATURE, tenantId },
  };
}

export async function submitRatingBatch(tenantId: string): Promise<number> {
  const { token, rows } = await claimQueued(tenantId, CLAIM_LIMIT);
  if (!rows.length) return 0;
  const lock = { lock_token: token };
  let material: RatingMaterial;
  let owner: OwnerSystem;
  try { [material, owner] = await Promise.all([loadRatingMaterial(tenantId, rows.map((r) => r.report_id)), loadOwnerSystem(tenantId)]); }
  catch (e) { for (const row of rows) await releaseRow(row, "submitting", `평점 재료를 읽지 못했습니다: ${errorText(e)}`, lock); throw e; }
  // 원장 예시가 모자라면(다른 지점 · 예시 글이 고쳐짐) 그 보고서 탓이 아니다 — 횟수 없이 되돌리고 단계 실패로 알린다.
  const problem = ownerSystemProblem(owner);
  if (problem) { for (const row of rows) await releaseRow(row, "submitting", problem, lock); throw new Error(problem); }
  const items: BatchItem[] = [];
  const plan: { row: QueueRow; customId: string; hash: string }[] = [];
  for (const row of rows) {
    const why = material.skip.get(row.report_id);
    const r = material.reports.get(row.report_id);
    const prompt = r ? buildOwnerPrompt(r) : "";
    const pii = r ? piiHits(prompt) : [];
    if (why || !r) await closeOrWait(row, "submitting", why ?? { drop: true, reason: "평점 대상이 아닙니다" }, lock);
    // 🔴 외부 AI 전송 금지 정보(주민번호·계좌·카드·급여)가 글 안에 있으면 그 보고서는 보내지 않는다(가려 보내지 않는다).
    else if (pii.length) await closeOrWait(row, "submitting", { drop: true, reason: `외부 AI로 보낼 수 없는 정보(${pii.join("·")})가 있어 매기지 않습니다` }, lock);
    else {
      const customId = `rr_${randomUUID().replace(/-/g, "")}`;
      items.push({ customId, opts: ratingRequest(tenantId, owner.system, prompt) });
      plan.push({ row, customId, hash: ownerInputHash(r.id, r, material.mentSource.get(r.id)) });
    }
  }
  if (!items.length) return 0;
  // 배치 전체가 못 나가면(키·잔액·라이선스·네트워크) 그 보고서 탓이 아니다 — 횟수 없이 되돌리고 단계 실패로 알린다.
  let sent;
  try { sent = await submitJSONBatch(items); }
  catch (e) { for (const p of plan) await releaseRow(p.row, "submitting", `평점 배치 보내기 실패: ${errorText(e)}`, lock); throw e; }
  if (!sent?.batchId) {
    const why = sent?.rejected?.[0]?.error ?? "평점 배치를 만들지 못했습니다";
    for (const p of plan) await releaseRow(p.row, "submitting", why, lock);
    throw new Error(why);
  }
  const rejected = new Map((sent.rejected ?? []).map((r) => [r.customId, r.error]));
  let n = 0;
  for (const p of plan) {
    // 싣기 전 거절(라이선스·모델 조회 오류 등)은 그 보고서 탓이 아니다 — 횟수 없이 되돌린다(재리뷰 2026-10-26).
    if (rejected.has(p.customId) || !sent.models[p.customId]) { await releaseRow(p.row, "submitting", rejected.get(p.customId) ?? "평점 배치에 싣지 못했습니다", lock); continue; }
    // custom_id 꼴 `<요청>#0` = 옛 묶음(5장) 줄과 같은 모양 — 수거가 같은 방식으로 짝을 찾는다.
    const ok = await moveRow(tenantId, p.row.report_id, "submitting",
      { stage: "submitted", batch_id: sent.batchId, custom_id: `${p.customId}#0`, input_hash: p.hash, model: sent.models[p.customId], lock_token: null, locked_at: null }, lock);
    if (ok) n++;
  }
  return n;
}

/** 지금 매길 수 없는 줄 — 닫거나(drop) 횟수 없이 되돌린다(wait · 너무 오래 기다렸으면 닫는다). */
async function closeOrWait(row: QueueRow, from: string, why: RatingSkip, match: Record<string, string | null>): Promise<void> {
  if (why.drop || waitedTooLong(row)) {
    const reason = why.drop ? why.reason : `줄 선 지 ${WAIT_LIMIT_DAYS}일이 지나도록 발송되지 않아 매기지 않습니다`;
    await moveRow(row.tenant_id, row.report_id, from, { stage: "failed", error: reason.slice(0, 300), lock_token: null, locked_at: null, batch_id: null, custom_id: null }, match);
  } else await releaseRow(row, from, why.reason, match);
}

export async function collectRatingBatches(tenantId: string): Promise<number> {
  const { data, error } = await db().from(QUEUE).select(QUEUE_COLS).eq("tenant_id", tenantId).eq("stage", "submitted").not("batch_id", "is", null).order("updated_at").limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as QueueRow[];
  let saved = 0;
  for (const batchId of new Set(rows.map((r) => r.batch_id!))) {
    const group = rows.filter((r) => r.batch_id === batchId);
    try { saved += await collectOne(tenantId, batchId, group); }
    catch (e) {
      reportWarning("평점 배치 수거 실패", { scope: "report-rating.collect", batchId, error: errorText(e) });
      for (const r of group.filter((x) => Date.now() - Date.parse(x.updated_at) > 2 * 86_400_000)) await releaseRow(r, "submitted", "배치 결과를 받지 못해 다시 보냅니다", { batch_id: batchId });
    }
  }
  return saved;
}

async function collectOne(tenantId: string, batchId: string, group: QueueRow[]): Promise<number> {
  const customIds = [...new Set(group.map((r) => r.custom_id!.split("#")[0]))];
  const metas = Object.fromEntries(customIds.map((id) => [id, { feature: RATING_FEATURE, tenantId }]));
  const outcomes = await collectJSONBatch(batchId, metas);
  if (!outcomes) return 0; // 아직 처리 중 — 다음 cron이 다시 묻는다
  const material = await loadRatingMaterial(tenantId, group.map((r) => r.report_id));
  const match = { batch_id: batchId };
  let saved = 0;
  for (const row of group) {
    const outcome = outcomes[row.custom_id!.split("#")[0]];
    if (!outcome?.ok) {
      const why = outcome?.error ?? "배치 결과가 없습니다";
      await (TRANSIENT_BATCH_ERROR.test(why) ? releaseRow : failOrRetry)(row, "submitted", why, match);
      continue;
    }
    // 한 줄의 실패(해석·저장)가 같은 배치의 다른 줄 수거를 막지 않게 줄마다 감싼다.
    try { if (await collectRow(tenantId, row, material, parseOwnerResult(outcome.data), outcome.model, match)) saved++; }
    catch (e) { await failOrRetry(row, "submitted", `평점 수거 실패: ${errorText(e)}`, match); }
  }
  return saved;
}

/** 수거한 줄 하나 — 저장했으면 true. 지금 기준 평점이 이미 있으면 덮지 않는다(옛 기준 평점은 바꾼다). */
async function collectRow(tenantId: string, row: QueueRow, material: RatingMaterial, res: OwnerResult | null, model: string, match: Record<string, string | null>): Promise<boolean> {
  const why = material.skip.get(row.report_id);
  const r = material.reports.get(row.report_id);
  if (why || !r) { await closeOrWait(row, "submitted", why ?? { drop: true, reason: "평점 대상이 아닙니다" }, match); return false; }
  const ms = material.mentSource.get(r.id) ?? null;
  if (ownerInputHash(r.id, r, ms) !== row.input_hash) { await releaseRow(row, "submitted", "보고서가 바뀌어 다시 매깁니다", match); return false; }
  if (!res) { await failOrRetry(row, "submitted", "평점 응답을 해석하지 못했습니다", match); return false; }
  const { data: cur, error: readError } = await db().from("lesson_report_ratings").select("rubric").eq("tenant_id", tenantId).eq("report_id", r.id).maybeSingle();
  if (readError) { await failOrRetry(row, "submitted", `평점 확인 실패: ${readError.message}`, match); return false; }
  if ((cur as { rubric?: string } | null)?.rubric === OWNER_RUBRIC_ID) {
    await moveRow(tenantId, row.report_id, "submitted", { stage: "done", error: "지금 기준 평점이 이미 있어 덮지 않았습니다" }, match);
    return false;
  }
  const out = ownerRatingRow(r.id, res, ms, model, row.input_hash!);
  const { error } = await db().from("lesson_report_ratings").upsert({ ...out, tenant_id: tenantId, rated_on: kstToday() }, { onConflict: "report_id" });
  if (error) { await failOrRetry(row, "submitted", `평점 저장 실패: ${error.message}`, match); return false; }
  return moveRow(tenantId, row.report_id, "submitted", { stage: "done", error: null }, match);
}

// 배치 항목의 만료·취소·과부하·서버 오류는 그 보고서 탓이 아니다 — 횟수는 해석 불가·잘못된 요청·거절에만 쓴다(재리뷰 2026-10-26).
const TRANSIENT_BATCH_ERROR = /(만료|취소|overloaded|api_error|rate_limit|timeout|배치 결과가 없습니다)/;
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
