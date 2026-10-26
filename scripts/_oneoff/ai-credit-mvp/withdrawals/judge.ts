// ① 퇴원 사유 — 학생 한 명씩 모델 판정 → 코드 확정. 결과는 03-withdrawals/runs/<버전>-<표본>-<모드>-<모델>.jsonl
// TSX_TSCONFIG_PATH=scripts/_oneoff/ai-credit-mvp/tsconfig.json AI_DEV_CLAUDE_CLI=1 NODE_ENV=development \
//   node --import tsx scripts/_oneoff/ai-credit-mvp/withdrawals/judge.ts --set tuning --version v1 [--model haiku] [--mode cli] [--limit N]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULT_ROOT, assertEvalEnv, callModel, type Mode } from "../lib/runner";
import { cardText, type WdRecord } from "./card";
import { PROMPTS } from "./prompts";
import { recordedCategories } from "./recorded";
import { decide, type Checklist } from "./verify";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

async function main() {
  const set = arg("set", "tuning")!, version = arg("version", "v1")!, model = (arg("model", "haiku") as "haiku" | "sonnet");
  const mode = arg("mode", "cli") as Mode, limit = Number(arg("limit", "0")), rep = Number(arg("rep", "0"));
  assertEvalEnv(mode);
  const prompt = PROMPTS[version];
  if (!prompt) throw new Error(`프롬프트 ${version} 없음`);
  const snap = join(RESULT_ROOT, "01-snapshots", "withdrawals");
  const rows: WdRecord[] = readFileSync(join(snap, "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ctx = JSON.parse(readFileSync(join(snap, "context.json"), "utf8")) as { tenantId: string };
  const splits = JSON.parse(readFileSync(join(snap, "splits.json"), "utf8")) as Record<string, string[]>;
  const want = set === "all" ? null : new Set(splits[set]);
  let targets = rows.filter((r) => !want || want.has(r.sid));
  if (limit) targets = targets.slice(0, limit);
  const t0 = Date.now();
  const results = await Promise.all(targets.map(async (r) => {
    if (r.held) return { ...decide(r, null), model: null, ms: 0, raw: null };
    const res = await callModel<Checklist>({
      task: "withdrawals", version, item: r.sid, mode, model, system: prompt.system, prompt: prompt.user(cardText(r, prompt.recordedLine ? { recorded: recordedCategories(r) } : {})),
      maxTokens: 4000, feature: "withdrawal_reason_restore", tenantId: ctx.tenantId, cacheDir: join(RESULT_ROOT, "03-withdrawals", "cache"), rep,
    });
    const raw = res.ok ? res.data : null;
    return { ...decide(r, raw), model: res.ok ? res.actualModels.join("+") : null, ms: res.ms, raw, error: res.ok ? undefined : res.error };
  }));
  const dir = join(RESULT_ROOT, "03-withdrawals", "runs");
  mkdirSync(dir, { recursive: true });
  // --tag = 코드 규칙만 바꾼 재계산(같은 입력은 캐시라 모델을 다시 부르지 않는다).
  const file = join(dir, `${version}${arg("tag", "")}-${set}-${mode}-${model}${rep ? `-rep${rep}` : ""}.jsonl`);
  writeFileSync(file, results.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const cnt = (s: string) => results.filter((x) => x.status === s).length;
  console.log(JSON.stringify({ file, n: results.length, 제안: cnt("제안"), 충돌: cnt("충돌"), 근거부족: cnt("근거 부족"), 보류: cnt("보류(개인정보)"),
    실패: results.filter((x) => "error" in x && x.error).length, 인용확인: results.reduce((a, x) => a + x.quoteChecked, 0), 인용불일치: results.reduce((a, x) => a + x.quoteFailed, 0), 초: Math.round((Date.now() - t0) / 1000) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
