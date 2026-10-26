import "server-only";
import { randomUUID } from "node:crypto";
import type { GenerateJSONOptions } from "@/lib/ai/generate";
import { collectJSONBatch, submitJSONBatch, type BatchItem } from "@/lib/ai/generate-batch";
import { kstToday } from "@/lib/date-kst";
import { reportWarning } from "@/lib/observability/report-error";
import { buildRatingPrompt, RATING_BATCH_SIZE, RATING_SYSTEM } from "../harness/prompt";
import { piiHits } from "../harness/pii";
import { checklistsOf, ratingInputHash, ratingRow } from "../harness/rows";
import { codeSignals } from "../harness/signals";
import type { Checklist } from "../harness/types";
import { loadRatingMaterial, type RatingMaterial, type RatingSkip } from "./material";
import { QUEUE, QUEUE_COLS, WAIT_LIMIT_DAYS, claimQueued, db, failOrRetry, moveRow, releaseRow, waitedTooLong, type QueueRow } from "./queue";

/**
 * 평점 배치(Anthropic Message Batches — 일반 호출의 50%) — generateJSON과 같은 관문(사실 원칙 · 지점 라이선스 · 키 그룹 'ment')을 지난다.
 * 🔴 선점(submitting) 뒤 보낸다 · 수거는 배치 번호가 같은 줄만 바꾼다 · 저장은 **입력 지문이 그대로**일 때만(고쳐 다시 보낸 보고서는 다시 줄 선다).
 * 🔴 시도 횟수는 그 보고서 탓인 실패에만 쓴다 — 배치 전체 장애(키·잔액·네트워크)·재료 조회 실패·발송 전은 횟수 없이 되돌린다.
 * 🔴 기존 평점은 덮지 않는다(ignoreDuplicates — 10-22 오프라인 배치의 검증된 값이 남는다).
 */
export const RATING_FEATURE = "lesson_report_rating";
const CLAIM_LIMIT = 60;

/** 배치 한 건의 요청 — 즉시 호출(`rateReportsNow`)과 같은 칸(바꾸면 둘 다). */
export function ratingRequest(tenantId: string, prompt: string): GenerateJSONOptions {
  return {
    system: RATING_SYSTEM, cacheSystem: true, prompt, maxTokens: 32_000, tier: "fast", provider: "anthropic", allowedProviders: ["anthropic"],
    reasoningEffort: "medium", meta: { feature: RATING_FEATURE, tenantId },
  };
}

export async function submitRatingBatch(tenantId: string): Promise<number> {
  const { token, rows } = await claimQueued(tenantId, CLAIM_LIMIT);
  if (!rows.length) return 0;
  const lock = { lock_token: token };
  let material: RatingMaterial;
  try { material = await loadRatingMaterial(tenantId, rows.map((r) => r.report_id)); }
  catch (e) { for (const row of rows) await releaseRow(row, "submitting", `평점 재료를 읽지 못했습니다: ${errorText(e)}`, lock); throw e; }
  const ready: QueueRow[] = [];
  for (const row of rows) {
    const why = material.skip.get(row.report_id);
    const r = material.reports.get(row.report_id);
    const pii = r ? piiHits(buildRatingPrompt([r]).prompt) : [];
    if (why || !r) await closeOrWait(row, "submitting", why ?? { drop: true, reason: "평점 대상이 아닙니다" }, lock);
    // 🔴 외부 AI 전송 금지 정보(주민번호·계좌·카드·급여)가 글 안에 있으면 그 보고서는 보내지 않는다(가려 보내지 않는다).
    else if (pii.length) await closeOrWait(row, "submitting", { drop: true, reason: `외부 AI로 보낼 수 없는 정보(${pii.join("·")})가 있어 매기지 않습니다` }, lock);
    else ready.push(row);
  }
  if (!ready.length) return 0;
  // 같은 날 · 같은 반끼리 묶는다(옛 배치와 같은 5장 묶음 — 카드끼리 비교하지 말라고 일러 둔다).
  ready.sort((x, y) => (material.reports.get(x.report_id)!.d + x.report_id).localeCompare(material.reports.get(y.report_id)!.d + y.report_id));
  const items: BatchItem[] = [];
  const plan: { row: QueueRow; customId: string; slot: number; hash: string }[] = [];
  for (let i = 0; i < ready.length; i += RATING_BATCH_SIZE) {
    const group = ready.slice(i, i + RATING_BATCH_SIZE);
    const customId = `rr_${randomUUID().replace(/-/g, "")}`;
    const reports = group.map((r) => material.reports.get(r.report_id)!);
    items.push({ customId, opts: ratingRequest(tenantId, buildRatingPrompt(reports).prompt) });
    group.forEach((row, slot) => plan.push({ row, customId, slot, hash: ratingInputHash(reports[slot]) }));
  }
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
    const ok = await moveRow(tenantId, p.row.report_id, "submitting",
      { stage: "submitted", batch_id: sent.batchId, custom_id: `${p.customId}#${p.slot}`, input_hash: p.hash, model: sent.models[p.customId], lock_token: null, locked_at: null }, lock);
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
  for (const customId of customIds) {
    const members = group.filter((r) => r.custom_id!.startsWith(`${customId}#`)).sort((a, b) => slotOf(a) - slotOf(b));
    const outcome = outcomes[customId];
    if (!outcome?.ok) {
      const why = outcome?.error ?? "배치 결과가 없습니다";
      for (const r of members) await (TRANSIENT_BATCH_ERROR.test(why) ? releaseRow : failOrRetry)(r, "submitted", why, match);
      continue;
    }
    const size = Math.max(...members.map(slotOf)) + 1;
    const checks = checklistsOf(outcome.data, Array.from({ length: size }, (_, i) => `r${i + 1}`));
    for (const row of members) {
      // 한 줄의 실패(점수 계산·저장)가 같은 배치의 다른 줄 수거를 막지 않게 줄마다 감싼다.
      try { if (await collectRow(tenantId, row, material, checks[slotOf(row)] ?? null, outcome.model, match)) saved++; }
      catch (e) { await failOrRetry(row, "submitted", `평점 수거 실패: ${errorText(e)}`, match); }
    }
  }
  return saved;
}

/** 수거한 줄 하나 — 저장했으면 true. 이미 평점이 있으면 덮지 않는다. */
async function collectRow(tenantId: string, row: QueueRow, material: RatingMaterial, check: Checklist | null, model: string, match: Record<string, string | null>): Promise<boolean> {
  const why = material.skip.get(row.report_id);
  const r = material.reports.get(row.report_id);
  if (why || !r) { await closeOrWait(row, "submitted", why ?? { drop: true, reason: "평점 대상이 아닙니다" }, match); return false; }
  if (ratingInputHash(r) !== row.input_hash) { await releaseRow(row, "submitted", "보고서가 바뀌어 다시 매깁니다", match); return false; }
  const out = check ? ratingRow(r, check, codeSignals(r), model, row.input_hash!) : null;
  if (!out) { await failOrRetry(row, "submitted", "평점 응답을 해석하지 못했습니다", match); return false; }
  const { data: put, error } = await db().from("lesson_report_ratings")
    .upsert({ ...out, tenant_id: tenantId, rated_on: kstToday() }, { onConflict: "report_id", ignoreDuplicates: true }).select("report_id");
  if (error) { await failOrRetry(row, "submitted", `평점 저장 실패: ${error.message}`, match); return false; }
  const kept = !(put ?? []).length; // 이미 평점이 있었다(덮지 않았다)
  return (await moveRow(tenantId, row.report_id, "submitted", { stage: "done", error: kept ? "이미 평점이 있어 덮지 않았습니다" : null }, match)) && !kept;
}

// 배치 항목의 만료·취소·과부하·서버 오류는 그 보고서 탓이 아니다 — 횟수는 해석 불가·잘못된 요청·거절에만 쓴다(재리뷰 2026-10-26).
const TRANSIENT_BATCH_ERROR = /(만료|취소|overloaded|api_error|rate_limit|timeout|배치 결과가 없습니다)/;
const slotOf = (r: QueueRow) => Number(r.custom_id!.split("#")[1] ?? 0);
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
