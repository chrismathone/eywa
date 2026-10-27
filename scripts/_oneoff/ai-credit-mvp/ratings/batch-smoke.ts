// ② 앱 배치 경로 스모크(실제 Batch API · 소량) — submitJSONBatch → collectJSONBatch를 앱 요청(ratingRequest) 그대로. 저장은 하지 않는다(파일만).
// TSX_TSCONFIG_PATH=scripts/_oneoff/ai-credit-mvp/tsconfig.json NODE_ENV=development node --import tsx scripts/_oneoff/ai-credit-mvp/ratings/batch-smoke.ts [--groups 2]
// 🔴 운영 DB·Supabase 변수 없이(assertEvalEnv) — collectJSONBatch의 사용량 기록은 그래서 운영에 쓰이지 않는다. 비용은 결과 usage로 장부에.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAnthropic } from "@/lib/ai/anthropic";
import { collectJSONBatch, submitJSONBatch } from "@/lib/ai/generate-batch";
import { buildRatingPrompt, RATING_BATCH_SIZE, RATING_SYSTEM } from "@/features/report-rating/harness/prompt";
import { checklistsOf, ratingInputHash, ratingRow } from "@/features/report-rating/harness/rows";
import type { RatingReport } from "@/features/report-rating/harness/types";
import { RATING_FEATURE, ratingRequest } from "@/features/report-rating/server/batch";
import { API_CAP_USD, RESULT_ROOT, USAGE_LEDGER, apiSpentUsd, assertEvalEnv, costUsd } from "../lib/runner";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

async function main() {
  assertEvalEnv("api");
  if (apiSpentUsd() > API_CAP_USD - 0.5) throw new Error("API 상한 근접 — 멈춤");
  const snap = join(RESULT_ROOT, "01-snapshots", "ratings");
  const all: RatingReport[] = readFileSync(join(snap, "reports-all.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const R = new Map(all.map((r) => [r.id, r]));
  const ctx = JSON.parse(readFileSync(join(snap, "context.json"), "utf8")) as { tenantId: string };
  const ids: string[] = JSON.parse(readFileSync(join(snap, "splits.json"), "utf8")).final;
  const groups: RatingReport[][] = [];
  const pick = ids.map((id) => R.get(id)!).sort((a, b) => (a.d + a.id).localeCompare(b.d + b.id)).slice(0, Number(arg("groups", "2")) * RATING_BATCH_SIZE);
  for (let i = 0; i < pick.length; i += RATING_BATCH_SIZE) groups.push(pick.slice(i, i + RATING_BATCH_SIZE));
  const items = groups.map((g, i) => ({ customId: `smoke_${i}`, opts: ratingRequest(ctx.tenantId, RATING_SYSTEM, buildRatingPrompt(g).prompt) }));
  const t0 = Date.now();
  const sent = await submitJSONBatch(items);
  if (!sent?.batchId) throw new Error(`배치를 보내지 못함: ${JSON.stringify(sent?.rejected)}`);
  console.log("보냄", sent.batchId, sent.models, "거절", sent.rejected);
  const metas = Object.fromEntries(items.map((it) => [it.customId, { feature: RATING_FEATURE, tenantId: ctx.tenantId }]));
  let outcomes = null;
  for (let i = 0; i < 60 && !outcomes; i++) { await new Promise((r) => setTimeout(r, 30_000)); outcomes = await collectJSONBatch(sent.batchId, metas); }
  if (!outcomes) throw new Error("30분 안에 끝나지 않음 — 배치 번호로 나중에 수거");
  // 실제 토큰(배치는 정가의 50%) — 결과 줄의 usage를 직접 읽는다.
  const client = getAnthropic("default", "ment");
  let cost = 0;
  const usage: Record<string, unknown>[] = [];
  for await (const row of await client.messages.batches.results(sent.batchId)) {
    if (row.result.type !== "succeeded") continue;
    const u = row.result.message.usage;
    const c = costUsd(row.result.message.model, { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 }) * 0.5;
    cost += c;
    usage.push({ customId: row.custom_id, model: row.result.message.model, ...u, costUsd: c });
  }
  appendFileSync(USAGE_LEDGER, JSON.stringify({ at: new Date().toISOString(), task: "ratings", version: "batch-smoke", mode: "api", batch: true, item: sent.batchId, requested: Object.values(sent.models)[0], ok: true, ms: Date.now() - t0, costUsd: cost, usage }) + "\n");
  const rows = groups.flatMap((g, i) => {
    const o = outcomes![`smoke_${i}`];
    const { ids: rid, signals } = buildRatingPrompt(g);
    const checks = o?.ok ? checklistsOf(o.data, rid) : rid.map(() => null);
    return g.map((r, j) => ({ report_id: r.id, ok: !!checks[j], model: o?.ok ? o.model : null, error: o?.ok ? undefined : o?.error, ...(checks[j] ? ratingRow(r, checks[j]!, signals[j], o!.ok ? o.model : "", ratingInputHash(r)) : {}) }));
  });
  writeFileSync(join(RESULT_ROOT, "04-ratings", "batch-smoke.json"), JSON.stringify({ batchId: sent.batchId, seconds: Math.round((Date.now() - t0) / 1000), costUsd: cost, usage, rows }, null, 2));
  console.log(JSON.stringify({ 묶음: groups.length, 보고서: rows.length, 해석: rows.filter((r) => r.ok).length, 초: Math.round((Date.now() - t0) / 1000), 비용: cost.toFixed(4) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
