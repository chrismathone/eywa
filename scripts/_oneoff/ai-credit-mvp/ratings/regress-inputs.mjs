// ② 옛 입력 재현 판정 + 회귀 표본(120) · 조정/최종 표본 고정 — API 호출 없음.
// node scripts/_oneoff/ai-credit-mvp/ratings/regress-inputs.mjs
// 옛 하네스(D:\tmp\report-rating-2026-10-22\check.mjs)의 codeSignals를 그대로 써서, 오늘 다시 만든 입력의 코드 신호가
// out-final.jsonl에 저장된 신호와 같은 행만 "입력 일치"로 본다(옛 reports.jsonl이 없어 이것이 재현의 최대치다).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OLD = "D:/tmp/report-rating-2026-10-22";
const SNAP = "D:/tmp/ai-credit-mvp-2026-10-26/01-snapshots/ratings";
const { codeSignals } = await import(pathToFileURL(join(OLD, "check.mjs")).href);
const jsonl = (f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const all = jsonl(join(SNAP, "reports-all.jsonl"));
const R = new Map(all.map((r) => [r.id, r]));
const old = jsonl(join(OLD, "out-final.jsonl"));
const h = (s) => createHash("sha256").update(s).digest("hex");

let missing = 0, same = 0;
const diffKeys = {};
const matched = [];
for (const x of old) {
  const r = R.get(x.report_id);
  if (!r) { missing++; continue; }
  const now = codeSignals(r);
  const keys = Object.keys(x.signals).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(x.signals[k]));
  if (!keys.length) { same++; matched.push(x); } else for (const k of keys) diffKeys[k] = (diffKeys[k] || 0) + 1;
}
// 회귀 120 = 입력 일치 행에서 수업일·점수 구간을 고르게(해시 순서) — 점수 구간별 최대 24 · 같은 날 최대 12.
const bucket = (p) => (p == null ? "x" : p < 2.5 ? "a" : p < 3.25 ? "b" : p < 3.75 ? "c" : p < 4.25 ? "d" : "e");
const perB = {}, perD = {};
const ordered = matched.slice().sort((a, b) => h(`rg|${a.report_id}`).localeCompare(h(`rg|${b.report_id}`)));
const picked = ordered.filter((x) => {
  const b = bucket(x.points), d = R.get(x.report_id).d;
  if ((perB[b] ?? 0) >= 24 || (perD[d] ?? 0) >= 12) return false;
  perB[b] = (perB[b] ?? 0) + 1; perD[d] = (perD[d] ?? 0) + 1; return true;
}).slice(0, 120);
// 드문 구간(낮은 점수)이 24를 못 채우면 남는 자리는 같은 해시 순으로(날짜 상한만 지킨다).
for (const x of ordered) { if (picked.length >= 120) break; const d = R.get(x.report_id).d; if (!picked.includes(x) && (perD[d] ?? 0) < 12) { picked.push(x); perD[d] = (perD[d] ?? 0) + 1; } }
const regression = picked.map((x) => x.report_id);

// 새 보고서: 평점 없는 정상 발송분(success) — 10-22 = 조정용(해시 순 60), 그 뒤 날짜 = 최종 평가(오늘 저녁 발송분은 마지막 추출 때 더한다).
const fresh = all.filter((r) => !r.rated && r.st === "success" && !r.held);
const tuning = fresh.filter((r) => r.d === "2026-10-22").sort((a, b) => h(`rt|${a.id}`).localeCompare(h(`rt|${b.id}`))).slice(0, 60).map((r) => r.id);
const final = fresh.filter((r) => r.d > "2026-10-22").map((r) => r.id);
const splits = { rule: "회귀 = 입력 일치 행 중 해시 순(점수 구간별 ≤24 · 날짜별 ≤12) 120 · 조정용 = 10-22 미평가 정상 발송분 해시 순 60 · 최종 = 10-23 이후 미평가 정상 발송분(마지막 추출에서 10-26분 추가)", regression, tuning, final };
writeFileSync(join(SNAP, "splits.json"), JSON.stringify(splits, null, 2));
const report = { oldRows: old.length, missingNow: missing, inputSame: same, inputDiffer: old.length - missing - same, differingSignals: diffKeys,
  regression: regression.length, tuning: tuning.length, final: final.length, freshTotal: fresh.length };
writeFileSync(join(SNAP, "reproduction.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
