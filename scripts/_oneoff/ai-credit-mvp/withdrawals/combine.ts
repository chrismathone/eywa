// ① 2회 합의 — 같은 카드를 두 번 판정해 상태·대분류가 같을 때만 그 판정을 쓰고, 다르면 '충돌(판정 흔들림)'으로 올린다(사람이 고른다).
// node --import tsx scripts/_oneoff/ai-credit-mvp/withdrawals/combine.ts <runs/첫째.jsonl> <runs/둘째.jsonl> <runs/출력.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REASON_LABEL } from "@/features/withdrawals/types";
import { RESULT_ROOT } from "../lib/runner";
import type { Proposal } from "./verify";

const read = (f: string): Proposal[] => readFileSync(join(RESULT_ROOT, "03-withdrawals", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const label = (p: Proposal) => `${p.status}${p.reason ? ` ${REASON_LABEL[p.reason]}` : ""}`;

export function combine(a: Proposal, b: Proposal | undefined): Proposal & { agreed: boolean } {
  if (!b) return { ...a, agreed: false, notes: [...a.notes, "두 번째 판정 없음"] };
  const same = a.status === b.status && (a.status !== "제안" || a.reason === b.reason);
  if (same) return { ...a, agreed: true, detail: a.detail === b.detail ? a.detail : null, notes: a.detail === b.detail ? a.notes : [...a.notes, "세부가 두 번 판정에서 달라 비움"] };
  return { ...a, status: "충돌", agreed: false, notes: [...a.notes, `판정 흔들림: ${label(a)} ↔ ${label(b)}`] };
}

if (process.argv[1]?.endsWith("combine.ts")) {
  const [f1, f2, out] = process.argv.slice(2);
  const B = new Map(read(f2).map((p) => [p.sid, p]));
  const rows = read(f1).map((a) => combine(a, B.get(a.sid)));
  writeFileSync(join(RESULT_ROOT, "03-withdrawals", out), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(JSON.stringify({ n: rows.length, 합의: rows.filter((r) => r.agreed).length, 흔들림: rows.filter((r) => !r.agreed).length }));
}
