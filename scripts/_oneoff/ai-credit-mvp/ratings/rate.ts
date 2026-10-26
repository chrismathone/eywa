// ② 평점 — 앱과 같은 지침·프롬프트·해석·점수(src/features/report-rating)로 표본을 매긴다. 결과 = 04-ratings/runs/<표본>-<모드>-<모델>[-repN].jsonl
// TSX_TSCONFIG_PATH=scripts/_oneoff/ai-credit-mvp/tsconfig.json AI_DEV_CLAUDE_CLI=1 NODE_ENV=development \
//   node --import tsx scripts/_oneoff/ai-credit-mvp/ratings/rate.ts --set regression|tuning|final [--mode cli|api] [--model haiku] [--limit N] [--rep N]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRatingPrompt, RATING_BATCH_SIZE, RATING_SYSTEM } from "@/features/report-rating/harness/prompt";
import { checklistsOf, ratingInputHash, ratingRow } from "@/features/report-rating/harness/rows";
import type { RatingReport } from "@/features/report-rating/harness/types";
import { RESULT_ROOT, assertEvalEnv, callModel, type Mode } from "../lib/runner";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

async function main() {
  const set = arg("set", "regression")!, mode = arg("mode", "cli") as Mode, model = (arg("model", "haiku") as "haiku" | "sonnet");
  const limit = Number(arg("limit", "0")), rep = Number(arg("rep", "0"));
  assertEvalEnv(mode);
  const snap = join(RESULT_ROOT, "01-snapshots", "ratings");
  const all: (RatingReport & { held?: boolean })[] = readFileSync(join(snap, "reports-all.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const R = new Map(all.map((r) => [r.id, r]));
  const ctx = JSON.parse(readFileSync(join(snap, "context.json"), "utf8")) as { tenantId: string };
  const ids: string[] = JSON.parse(readFileSync(join(snap, "splits.json"), "utf8"))[set];
  let targets = ids.map((id) => R.get(id)!).filter((r) => r && !r.held);
  if (limit) targets = targets.slice(0, limit);
  // 옛 배치처럼 같은 날끼리 5장씩(날짜 · id 순)
  targets.sort((a, b) => (a.d + a.id).localeCompare(b.d + b.id));
  const groups: RatingReport[][] = [];
  for (let i = 0; i < targets.length; i += RATING_BATCH_SIZE) groups.push(targets.slice(i, i + RATING_BATCH_SIZE));
  const t0 = Date.now();
  const out = (await Promise.all(groups.map(async (g) => {
    const { prompt, ids: rid, signals } = buildRatingPrompt(g);
    const res = await callModel<unknown>({ task: "ratings", version: "app1", item: g.map((r) => r.id.slice(0, 8)).join(","), mode, model, system: RATING_SYSTEM, prompt,
      maxTokens: 32_000, effort: "medium", feature: "lesson_report_rating", tenantId: ctx.tenantId, cacheDir: join(RESULT_ROOT, "04-ratings", "cache"), rep, concurrency: Number(arg("conc", "3")) });
    const checks = res.ok ? checklistsOf(res.data, rid) : rid.map(() => null);
    return g.map((r, i) => {
      const row = checks[i] ? ratingRow(r, checks[i]!, signals[i], res.ok ? res.actualModels.join("+") : "", ratingInputHash(r)) : null;
      return { report_id: r.id, d: r.d, ok: !!row, error: res.ok ? (row ? undefined : "체크리스트 누락·모양 오류") : res.error, ms: res.ms, ...(row ?? {}), check: checks[i] };
    });
  }))).flat();
  const dir = join(RESULT_ROOT, "04-ratings", "runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${set}-${mode}-${model}${rep ? `-rep${rep}` : ""}.jsonl`);
  writeFileSync(file, out.map((x) => JSON.stringify(x)).join("\n") + "\n");
  console.log(JSON.stringify({ file, n: out.length, ok: out.filter((x) => x.ok).length, calls: groups.length, 초: Math.round((Date.now() - t0) / 1000) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
