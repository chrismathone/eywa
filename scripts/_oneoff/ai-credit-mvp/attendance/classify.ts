// ④ 결석 문자 — 운영과 같은 프롬프트(buildClassifyPrompt)·운영 묶음(classified_at으로 다시 묶은 것)·연락일(KST)·정규화(normalizeIntent)로 판정.
// 결과 = 05-attendance/runs/<버전>-<표본>-<모드>-<모델>.jsonl · 분류·알림 서버 함수(classifyPendingParentMessages)는 부르지 않는다.
// TSX_TSCONFIG_PATH=… AI_DEV_CLAUDE_CLI=1 NODE_ENV=development node --import tsx scripts/_oneoff/ai-credit-mvp/attendance/classify.ts --set tuning --model haiku [--version op]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildClassifyPrompt, normalizeIntent, uncoveredDatesIn } from "@/features/attendance/parent-alerts/intent";
import { RESULT_ROOT, assertEvalEnv, callModel, type Mode } from "../lib/runner";
import { PROMPTS, type AtRecord } from "./prompts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };

async function main() {
  const set = arg("set", "tuning")!, mode = arg("mode", "cli") as Mode, model = (arg("model", "haiku") as "haiku" | "sonnet");
  const version = arg("version", "op")!, rep = Number(arg("rep", "0"));
  assertEvalEnv(mode);
  const build = PROMPTS[version] ?? (version === "op" ? buildClassifyPrompt : null);
  if (!build) throw new Error(`프롬프트 ${version} 없음`);
  const snapName = arg("snap", "attendance")!; // attendance-tune2 = 10-02 전 추가 조정용
  const snap = join(RESULT_ROOT, "01-snapshots", snapName);
  const rows: AtRecord[] = readFileSync(join(snap, "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ctx = JSON.parse(readFileSync(join(snap, "context.json"), "utf8")) as { tenantId: string };
  const want = set === "all" ? null : new Set<string>(JSON.parse(readFileSync(join(snap, "splits.json"), "utf8"))[set]);
  const targets = rows.filter((r) => !r.held && (!want || want.has(r.id)));
  const groups = new Map<number, AtRecord[]>();
  for (const r of targets) groups.set(r.opBatch, [...(groups.get(r.opBatch) ?? []), r]);
  const t0 = Date.now();
  // --limit N = 앞의 묶음 N개만(실제 API 운영 조건 확인 — 호출 10회 이하).
  const limit = Number(arg("limit", "0"));
  const picked = limit ? [...groups.values()].slice(0, limit) : [...groups.values()];
  const out = (await Promise.all(picked.map(async (g) => {
    const items = g.map((r) => ({ id: r.id, studentName: r.student, date: r.messageDate, content: r.content }));
    const res = await callModel<{ results?: Record<string, unknown>[] }>({ task: "attendance", version, item: g.map((r) => r.mid).join(","), mode, model,
      prompt: build(items), maxTokens: 4096, feature: "parent_attendance_intent", tenantId: ctx.tenantId, cacheDir: join(RESULT_ROOT, "05-attendance", "cache"), rep, concurrency: Number(arg("conc", "3")) });
    const byId = new Map((res.ok ? res.data.results ?? [] : []).map((x) => [String(x.id ?? ""), x]));
    return g.map((r) => {
      // 운영과 같다 — 모델이 빠뜨린 건은 none(알리지 않음)으로 확정한다.
      const intent = normalizeIntent(byId.get(r.id) ?? {}, { messageDate: r.messageDate });
      return { id: r.id, mid: r.mid, messageDate: r.messageDate, ok: res.ok, missing: res.ok && !byId.has(r.id), error: res.ok ? undefined : res.error, ms: res.ms,
        model: res.ok ? res.actualModels.join("+") : null, ...intent, uncovered: uncoveredDatesIn(r.content, intent, { messageDate: r.messageDate }) };
    });
  }))).flat();
  const dir = join(RESULT_ROOT, "05-attendance", "runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${version}-${snapName === "attendance" ? "" : `${snapName}-`}${set}-${mode}-${model}${rep ? `-rep${rep}` : ""}.jsonl`);
  writeFileSync(file, out.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const cnt = (c: string) => out.filter((x) => x.category === c).length;
  console.log(JSON.stringify({ file, n: out.length, calls: picked.length, 실패: out.filter((x) => !x.ok).length, 누락: out.filter((x) => x.missing).length,
    absence: cnt("absence"), late: cnt("late"), early_leave: cnt("early_leave"), none: cnt("none"), 초: Math.round((Date.now() - t0) / 1000) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
