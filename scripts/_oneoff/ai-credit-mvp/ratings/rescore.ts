// ② 저장된 체크리스트를 지금 코드 규칙으로 다시 계산(AI 호출 없음) — 규칙만 바꾼 판을 비교할 때.
// node --import tsx scripts/_oneoff/ai-credit-mvp/ratings/rescore.ts <runs/입력.jsonl> <runs/출력.jsonl> [규칙 판 6|7]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ratingInputHash, ratingRow } from "@/features/report-rating/harness/rows";
import { codeSignals } from "@/features/report-rating/harness/signals";
import { scoreCheck } from "@/features/report-rating/harness/score";
import type { Checklist, RatingReport } from "@/features/report-rating/harness/types";
import { RESULT_ROOT } from "../lib/runner";

const [inp, outp, lv = "7"] = process.argv.slice(2);
const all: RatingReport[] = readFileSync(join(RESULT_ROOT, "01-snapshots", "ratings", "reports-all.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const R = new Map(all.map((r) => [r.id, r]));
const rows = readFileSync(join(RESULT_ROOT, "04-ratings", inp), "utf8").trim().split("\n").map((l) => JSON.parse(l)) as { report_id: string; check: Checklist | null; model?: string; ok: boolean }[];
const out = rows.map((x) => {
  const r = R.get(x.report_id)!;
  if (!x.check) return x;
  const row = ratingRow(r, x.check, codeSignals(r), x.model ?? "", ratingInputHash(r));
  // 규칙 판을 고정해 다시 매긴다(ratingRow는 앱 기본 판) — 6이면 옛 판으로 점수만 덮는다.
  if (lv === "6" && row) {
    const s = scoreCheck(x.check, codeSignals(r), r, 6);
    for (const it of row.items) it.score = s[it.key as keyof typeof s] && typeof (s as Record<string, { score: number }>)[it.key]?.score === "number" ? (s as Record<string, { score: number }>)[it.key].score : it.score;
  }
  return { ...x, ...(row ?? {}), ok: !!row };
});
writeFileSync(join(RESULT_ROOT, "04-ratings", outp), out.map((x) => JSON.stringify(x)).join("\n") + "\n");
console.log(`다시 계산 ${out.length}건 → ${outp} (규칙 ${lv}차)`);
