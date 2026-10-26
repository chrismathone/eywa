// ② 앱으로 옮긴 평점 하네스 ↔ 옛 오프라인 하네스 전수 대조(API 호출 없음).
// TSX_TSCONFIG_PATH=scripts/_oneoff/ai-credit-mvp/tsconfig.json node --import tsx scripts/_oneoff/ai-credit-mvp/ratings/parity.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assembleRatingReports, type SentReport } from "@/features/report-rating/harness/assemble";
import { cardText } from "@/features/report-rating/harness/card";
import { CHECK_PROMPT } from "@/features/report-rating/harness/prompt";
import { RUBRIC_V4 } from "@/features/report-rating/harness/rubric";
import { points, scoreCheck } from "@/features/report-rating/harness/score";
import { codeSignals } from "@/features/report-rating/harness/signals";
import type { Checklist, RatingReport } from "@/features/report-rating/harness/types";
import { RESULT_ROOT } from "../lib/runner";

const OLD = "D:/tmp/report-rating-2026-10-22";
const jsonl = (f: string) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function main() {
  const oldCheck = await import(pathToFileURL(join(OLD, "check.mjs")).href);
  const oldCommon = await import(pathToFileURL(join(OLD, "common.mjs")).href);
  const all: RatingReport[] = jsonl(join(RESULT_ROOT, "01-snapshots", "ratings", "reports-all.jsonl"));
  const R = new Map(all.map((r) => [r.id, r]));
  const stored = jsonl(join(OLD, "out-final.jsonl")) as { report_id: string; points: number | null; check: Checklist; [k: string]: unknown }[];
  const out: Record<string, unknown> = {
    checkPromptSame: CHECK_PROMPT === oldCheck.CHECK_PROMPT,
    rubricSame: RUBRIC_V4 === readFileSync(join(OLD, "rubric-v4.md"), "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, ""),
  };
  let sigDiff = 0, cardDiff = 0;
  const examples: string[] = [];
  for (const r of all) {
    if (JSON.stringify(codeSignals(r)) !== JSON.stringify(oldCheck.codeSignals(r))) { sigDiff++; if (examples.length < 3) examples.push(`신호 ${r.id}`); }
    if (cardText(r, "r1") !== oldCommon.cardText(r, "r1", { v3: true })) { cardDiff++; if (examples.length < 6) examples.push(`카드 ${r.id}`); }
  }
  let pointDiff = 0, itemDiff = 0, claimDiff = 0;
  for (const x of stored) {
    const r = R.get(x.report_id)!;
    const s = scoreCheck(structuredClone(x.check), codeSignals(r), r, 6); // 옛 평점 재현 = 6차 규칙
    if (points(s) !== x.points) { pointDiff++; if (examples.length < 9) examples.push(`점수 ${x.report_id} ${points(s)}≠${x.points}`); }
    for (const k of ["warmth", "personal", "concern", "clarity", "trust"] as const) if (s[k].score !== (x[k] as { score: number }).score) { itemDiff++; break; }
    if (s.claim_risk !== x.claim_risk) claimDiff++;
  }
  // 앱 재료 조립(assemble.ts) ↔ 추출기가 붙인 값 — 추출 파일은 이미 (학생·과목·수업일·작성 시각) 차례라 그 차례를 작성 시각 대신으로 쓴다.
  const KEYS = ["prev_date", "sim_prev", "sim_class", "class_size_today", "sim_class_text", "sim_class_same", "classmate_names"] as const;
  const population = all.map((r, i) => ({ ...(r as unknown as SentReport), created_at: new Date(Date.UTC(2000, 0, 1) + i * 1000).toISOString() }));
  for (const p of population) for (const k of KEYS) delete (p as Record<string, unknown>)[k];
  const rebuilt = assembleRatingReports(population);
  let assembleDiff = 0;
  for (const r of all) {
    const b = rebuilt.get(r.id) as Record<string, unknown>;
    if (KEYS.some((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify((r as Record<string, unknown>)[k] ?? null))) { assembleDiff++; if (examples.length < 12) examples.push(`조립 ${r.id}`); }
  }
  Object.assign(out, { reports: all.length, signalDiff: sigDiff, cardDiff, assembleDiff, storedRescored: stored.length, pointDiff, itemDiff, claimDiff, examples });
  writeFileSync(join(RESULT_ROOT, "04-ratings", "parity.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}
main().catch((e) => { console.error(e); process.exit(1); });
