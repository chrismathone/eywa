// 조정용 검토 도우미 — 카드 + 모델 원응답 + 평가자 판정(조정용 표본만 볼 것). node --import tsx …/show.ts <run.jsonl> <set> sid...
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESULT_ROOT } from "../lib/runner";
import { cardText, type WdRecord } from "./card";
const [runFile, set, ...sids] = process.argv.slice(2);
const rows: WdRecord[] = readFileSync(join(RESULT_ROOT, "01-snapshots", "withdrawals", "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const runs = readFileSync(join(RESULT_ROOT, "03-withdrawals", runFile), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const codex = JSON.parse(readFileSync(join(RESULT_ROOT, "03-withdrawals", "codex", set, "out.json"), "utf8")).cases;
for (const sid of sids) {
  console.log("\n" + cardText(rows.find((r) => r.sid === sid)!).slice(0, 2500));
  console.log("→ 모델:", JSON.stringify(runs.find((r) => r.sid === sid)?.raw));
  console.log("→ 평가자:", JSON.stringify(codex.find((c: { sid: string }) => c.sid === sid)));
}
