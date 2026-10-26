// 공용 실행기 스모크 — node --import tsx scripts/_oneoff/ai-credit-mvp/smoke.ts [--api]
// (TSX_TSCONFIG_PATH=scripts/_oneoff/ai-credit-mvp/tsconfig.json · AI_DEV_CLAUDE_CLI=1 · 운영 환경변수 없이)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULT_ROOT, assertEvalEnv, callModel, type Mode } from "./lib/runner";

async function main() {
  const mode: Mode = process.argv.includes("--api") ? "api" : "cli";
  const out: Record<string, unknown> = { at: new Date().toISOString(), mode };
  // ① 운영 DB 변수가 있으면 거절하는가
  process.env.DATABASE_URL = "postgres://x";
  try { assertEvalEnv(mode); out.guard = "실패 — 거절하지 않음"; } catch (e) { out.guard = `거절됨: ${(e as Error).message.slice(0, 60)}`; }
  delete process.env.DATABASE_URL;
  assertEvalEnv(mode);

  const tenantId = process.env.MVP_TENANT_ID ?? "00000000-0000-0000-0000-000000000000";
  const base = { task: "smoke", version: "v1", mode, feature: "parent_attendance_intent", tenantId, maxTokens: 2000, cacheDir: join(RESULT_ROOT, "02-harness", `cache-${mode}`) };
  const prompt = '다음 문장에서 날짜만 JSON으로: "10월 5일과 8일 결석" → {"dates":["MM-DD",...]}';
  const calls = [];
  for (const model of ["haiku", "sonnet"] as const) {
    const r = await callModel<{ dates: string[] }>({ ...base, item: `${model}-1`, model, prompt });
    calls.push({ model, ok: r.ok, ...(r.ok ? { data: r.data, actualModels: r.actualModels, ms: r.ms, cached: r.cached } : { error: r.error }) });
  }
  const again = await callModel<{ dates: string[] }>({ ...base, item: "haiku-1-again", model: "haiku", prompt });
  out.calls = calls;
  out.cacheReuse = again.ok && again.cached ? "같은 입력 → 캐시 재사용" : "재사용 안 됨";
  writeFileSync(join(RESULT_ROOT, "02-harness", `smoke-results-${mode}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
