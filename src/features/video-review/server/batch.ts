import "server-only";
import { collectJSONBatch, submitJSONBatch, type BatchItem } from "@/lib/ai/generate-batch";
import { isAiFeatureDisabledMessage } from "@/lib/license/rule";
import { reportWarning } from "@/lib/observability/report-error";
import { claimsFrom, verifyTargets } from "../harness/result";
import { parseVerdict, type VerifyVerdict } from "../harness/prompt-verify";
import { REVIEW_FEATURE } from "../types";
import { finalizeReview } from "./finalize";
import { loadMaterial, materialBytes } from "./material";
import { judgeRequest, verifyRequest } from "./requests";
import { REVIEW_COLUMNS, aiAnalysisEnabled, claimRows, db, errorText, failOrRetry, moveStage, type ReviewRow } from "./rows";

/**
 * 밤 배치(원장 2026-10-20 "배치로 진행") — 판정 배치 → 수거 → (실수가 있는 영상만) 확인 배치 → 수거 → done.
 * 🔴 줄은 보내기 전에 선점한다(claimRows) · 수거는 배치 번호가 같은 줄만 바꾼다(늦은 수거가 '다시 분석'을 덮지 않게) ·
 *    한 배치의 요청 크기는 BYTE_BUDGET 안쪽(Anthropic 상한 256MB — 잡음 많은 화면이면 영상 30개가 500MB를 넘는다, 적대 리뷰 2026-10-20).
 */
const CLAIM_LIMIT = 30;
const BYTE_BUDGET = 150 * 1024 * 1024;
const hex = (id: string) => id.replace(/-/g, "");

/** 선점했지만 외부 배치에 제출하지 못한 줄은 돌려놓는다(라이선스 거절을 비롯해 시도로 세지 않는다). */
async function release(
  rows: readonly ReviewRow[],
  from: "judging" | "verifying",
  back: "judge" | "verify",
  token: string,
  message?: string,
): Promise<void> {
  for (const row of rows) await moveStage(
    row,
    from,
    { stage: back, lock_token: null, locked_at: null, ...(message ? { error: message.slice(0, 300) } : {}) },
    { lock_token: token },
  );
}

/** 제출 순간 라이선스가 꺼졌거나 관문이 그 사유로 거절한 경우만 횟수 없이 되돌린다. */
async function aiSubmissionDisabled(tenantId: string, message: string): Promise<boolean> {
  return isAiFeatureDisabledMessage(message) || !(await aiAnalysisEnabled(tenantId));
}

export async function submitJudgeBatch(tenantId: string): Promise<number> {
  if (!(await aiAnalysisEnabled(tenantId))) return 0;
  const { token, rows } = await claimRows(tenantId, "judge", "judging", CLAIM_LIMIT);
  if (!rows.length) return 0;
  const items: BatchItem[] = [];
  const loaded: ReviewRow[] = [];
  const leftover: ReviewRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    if (bytes >= BYTE_BUDGET) { leftover.push(row); continue; }
    try {
      const m = await loadMaterial(row);
      if (bytes + materialBytes(m) > BYTE_BUDGET && items.length) { leftover.push(row); continue; }
      bytes += materialBytes(m);
      items.push({ customId: `j_${hex(row.id)}`, opts: judgeRequest(tenantId, m) });
      loaded.push(row);
    } catch (e) { await failOrRetry(row, "judge", `판정 자료 준비 실패: ${errorText(e)}`, 3, { lock_token: token }); }
  }
  await release(leftover, "judging", "judge", token);
  if (!items.length) return 0;
  let sent;
  try { sent = await submitJSONBatch(items); }
  catch (e) {
    const reason = errorText(e);
    const message = `판정 배치 보내기 실패: ${reason}`;
    if (await aiSubmissionDisabled(tenantId, reason)) await release(loaded, "judging", "judge", token, message);
    else for (const row of loaded) await failOrRetry(row, "judge", message, 3, { lock_token: token });
    return 0;
  }
  const rejected = new Map((sent?.rejected ?? []).map((r) => [r.customId, r.error]));
  let n = 0;
  for (const row of loaded) {
    const id = `j_${hex(row.id)}`;
    if (!sent?.batchId || rejected.has(id) || !sent.models[id]) {
      const message = rejected.get(id) ?? "판정 배치에 싣지 못했습니다";
      if (await aiSubmissionDisabled(tenantId, message)) await release([row], "judging", "judge", token, message);
      else await failOrRetry(row, "judge", message, 3, { lock_token: token });
      continue;
    }
    if (await moveStage(row, "judging", { judge_batch: sent.batchId, lock_token: null, locked_at: null, models: { ...row.models, judge: sent.models[id] } }, { lock_token: token })) n++;
  }
  return n;
}

/** 수거 한 번에 배치 하나가 실패해도(만료·조회 불가) 다른 배치와 뒤 단계는 계속 돈다. 이틀 넘게 못 거둔 배치의 줄은 다시 낸다. */
async function collectEach(tenantId: string, stage: "judging" | "verifying", run: (batchId: string, group: ReviewRow[]) => Promise<number>): Promise<number> {
  const col = stage === "judging" ? "judge_batch" : "verify_batch";
  const { data, error } = await db().from("homework_video_reviews").select(REVIEW_COLUMNS)
    .eq("tenant_id", tenantId).eq("stage", stage).not(col, "is", null).order("updated_at").limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ReviewRow[];
  let n = 0;
  for (const batchId of new Set(rows.map((r) => r[col] as string))) {
    const group = rows.filter((r) => r[col] === batchId);
    try { n += await run(batchId, group); }
    catch (e) {
      reportWarning("영상 메모 배치 수거 실패", { scope: "video-review.collect", batchId, error: errorText(e) });
      const stale = group.filter((r) => Date.now() - new Date(r.updated_at).getTime() > 2 * 86_400_000);
      for (const r of stale) await failOrRetry(r, stage === "judging" ? "judge" : "verify", "배치 결과를 받지 못해 다시 보냅니다", 3, { [col]: batchId });
    }
  }
  return n;
}

export function collectJudgeBatches(tenantId: string): Promise<number> {
  return collectEach(tenantId, "judging", async (batchId, group) => {
    const metas = Object.fromEntries(group.map((r) => [`j_${hex(r.id)}`, { tenantId, feature: REVIEW_FEATURE.judge }]));
    const results = await collectJSONBatch(batchId, metas);
    if (!results) return 0;
    let n = 0;
    for (const row of group) {
      const out = results[`j_${hex(row.id)}`];
      const match = { judge_batch: batchId };
      if (!out || !out.ok) { await failOrRetry(row, "judge", out ? out.error : "배치 결과에 이 영상이 없습니다", 3, match); continue; }
      const claims = claimsFrom(out.data as Parameters<typeof claimsFrom>[0]);
      const ok = claims.length
        ? await moveStage(row, "judging", { stage: "verify", judge: out.data, judge_batch: null, available_at: new Date().toISOString(), models: { ...row.models, judge: out.model } }, match)
        : await finalizeReview({ ...row, models: { ...row.models, judge: out.model } }, "judging", out.data, [], null, { judge: out.model, verify: null }, match);
      if (ok) n++;
    }
    return n;
  });
}

export async function submitVerifyBatch(tenantId: string): Promise<number> {
  if (!(await aiAnalysisEnabled(tenantId))) return 0;
  const { token, rows } = await claimRows(tenantId, "verify", "verifying", CLAIM_LIMIT);
  if (!rows.length) return 0;
  const items: BatchItem[] = [];
  const loaded: ReviewRow[] = [];
  const leftover: ReviewRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    if (bytes >= BYTE_BUDGET) { leftover.push(row); continue; }
    try {
      const claims = verifyTargets(claimsFrom(row.judge as Parameters<typeof claimsFrom>[0]));
      const m = await loadMaterial(row);
      const size = materialBytes(m) * claims.length;
      if (bytes + size > BYTE_BUDGET && items.length) { leftover.push(row); continue; }
      bytes += size;
      claims.forEach((c, i) => items.push({ customId: `v_${hex(row.id)}_${i}`, opts: verifyRequest(tenantId, c, m) }));
      loaded.push(row);
    } catch (e) { await failOrRetry(row, "verify", `확인 자료 준비 실패: ${errorText(e)}`, 3, { lock_token: token }); }
  }
  await release(leftover, "verifying", "verify", token);
  if (!items.length) return 0;
  let sent;
  try { sent = await submitJSONBatch(items); }
  catch (e) {
    const reason = errorText(e);
    const message = `확인 배치 보내기 실패: ${reason}`;
    if (await aiSubmissionDisabled(tenantId, reason)) await release(loaded, "verifying", "verify", token, message);
    else for (const row of loaded) await failOrRetry(row, "verify", message, 3, { lock_token: token });
    return 0;
  }
  if (!sent?.batchId) {
    const rejected = new Map((sent?.rejected ?? []).map((r) => [r.customId, r.error]));
    for (const row of loaded) {
      const idPrefix = `v_${hex(row.id)}_`;
      const message = [...rejected].find(([id]) => id.startsWith(idPrefix))?.[1] ?? "확인 배치에 싣지 못했습니다";
      if (await aiSubmissionDisabled(tenantId, message)) await release([row], "verifying", "verify", token, message);
      else await failOrRetry(row, "verify", message, 3, { lock_token: token });
    }
    return 0;
  }
  let n = 0;
  for (const row of loaded) {
    if (await moveStage(row, "verifying", { verify_batch: sent.batchId, lock_token: null, locked_at: null }, { lock_token: token })) n++;
  }
  return n;
}

export function collectVerifyBatches(tenantId: string): Promise<number> {
  return collectEach(tenantId, "verifying", async (batchId, group) => {
    const metas: Record<string, { tenantId: string; feature: string }> = {};
    const claimCount = new Map(group.map((r) => [r.id, verifyTargets(claimsFrom(r.judge as Parameters<typeof claimsFrom>[0])).length]));
    for (const r of group) for (let i = 0; i < (claimCount.get(r.id) ?? 0); i++) metas[`v_${hex(r.id)}_${i}`] = { tenantId, feature: REVIEW_FEATURE.verify };
    const results = await collectJSONBatch(batchId, metas);
    if (!results) return 0;
    let n = 0;
    for (const row of group) {
      const raw: unknown[] = [];
      const verdicts: VerifyVerdict[] = [];
      let model: string | null = null;
      for (let i = 0; i < (claimCount.get(row.id) ?? 0); i++) {
        const out = results[`v_${hex(row.id)}_${i}`];
        // 확인을 못 받은 주장은 '애매'(=선생님 확인 필요)로 둔다 — 오류로 띄우지도, 지우지도 않는다.
        verdicts.push(out?.ok ? parseVerdict(out.data) : "애매");
        raw.push(out?.ok ? out.data : { error: out?.error ?? "결과 없음" });
        if (out?.ok) model = out.model;
      }
      if (await finalizeReview(row, "verifying", row.judge, verdicts, raw, { judge: row.models.judge ?? null, verify: model }, { verify_batch: batchId })) n++;
    }
    return n;
  });
}
