// ② 평점 일치도 — 실행 결과 ↔ 기준(옛 저장 평점 또는 Codex 블라인드 채점). 주 지표 = 종합 평균 절대 오차(목표 ≤ 0.35) · 항목별 1점 이내(목표 ≥ 95%).
// node --import tsx scripts/_oneoff/ai-credit-mvp/ratings/compare.ts <runs/파일.jsonl> <old|codex:<표본>> [--csv 출력.csv]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RATING_ITEMS } from "@/features/report-rating/harness/types";
import { RESULT_ROOT } from "../lib/runner";

type Scores = { points: number | null; items: Record<string, number>; claim: boolean };
const jsonl = (f: string) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pts = (items: Record<string, number>) => { const s = RATING_ITEMS.map((k) => items[k]).filter((x) => x >= 1 && x <= 5); return s.length ? Math.round(avg(s) * 10) / 10 : null; };
const pearson = (xs: number[], ys: number[]) => { const mx = avg(xs), my = avg(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return b && c ? a / Math.sqrt(b * c) : NaN; };

export function loadRef(ref: string): Map<string, Scores> {
  if (ref === "old") return new Map(jsonl("D:/tmp/report-rating-2026-10-22/out-final.jsonl").map((x) => [x.report_id, { points: x.points, items: Object.fromEntries(RATING_ITEMS.map((k) => [k, x[k]?.score ?? 0])), claim: !!x.claim_risk }]));
  const set = ref.replace(/^codex:/, "");
  const dir = join(RESULT_ROOT, "04-ratings", "codex", set);
  const map = JSON.parse(readFileSync(join(dir, "map.json"), "utf8")) as Record<string, string>;
  const cards = JSON.parse(readFileSync(join(dir, "out.json"), "utf8")).cards as Record<string, { score: number }>[];
  return new Map(cards.filter((c) => map[c.id as unknown as string]).map((c) => {
    const items = Object.fromEntries(RATING_ITEMS.map((k) => [k, c[k]?.score ?? 0]));
    return [map[c.id as unknown as string], { points: pts(items), items, claim: !!(c as unknown as { claim_risk: boolean }).claim_risk }];
  }));
}

export function compare(run: { report_id: string; ok: boolean; points?: number; items?: { key: string; score: number }[]; claim?: string | null }[], ref: Map<string, Scores>) {
  const both = run.filter((x) => x.ok && ref.has(x.report_id) && ref.get(x.report_id)!.points != null);
  const a = both.map((x) => x.points!), b = both.map((x) => ref.get(x.report_id)!.points!);
  const diffs = a.map((v, i) => Math.abs(v - b[i]));
  const item: Record<string, string> = {};
  let near = 0, n = 0;
  for (const k of RATING_ITEMS) {
    let kn = 0, kNear = 0, exact = 0;
    for (const x of both) {
      const s = x.items!.find((i) => i.key === k)!.score, t = ref.get(x.report_id)!.items[k];
      if (!(s >= 1) || !(t >= 1)) continue;
      kn++; if (Math.abs(s - t) <= 1) kNear++; if (s === t) exact++;
    }
    near += kNear; n += kn;
    item[k] = `±1 ${Math.round((kNear / kn) * 100)}% · 같음 ${Math.round((exact / kn) * 100)}% (${kn})`;
  }
  return {
    n: both.length, failed: run.filter((x) => !x.ok).length, 평균_실행: +avg(a).toFixed(2), 평균_기준: +avg(b).toFixed(2),
    종합_평균절대오차: +avg(diffs).toFixed(3), 종합_같음: `${Math.round((diffs.filter((d) => d === 0).length / both.length) * 100)}%`,
    "종합_0.5이내": `${Math.round((diffs.filter((d) => d <= 0.5).length / both.length) * 100)}%`, 상관: +pearson(a, b).toFixed(2),
    "항목_1점이내": `${Math.round((near / n) * 1000) / 10}%`, 항목별: item,
    클레임: `실행 ${both.filter((x) => x.claim).length} · 기준 ${both.filter((x) => ref.get(x.report_id)!.claim).length} · 둘 다 ${both.filter((x) => x.claim && ref.get(x.report_id)!.claim).length}`,
    rows: both.map((x, i) => ({ report_id: x.report_id, run: a[i], ref: b[i], diff: +(a[i] - b[i]).toFixed(1) })),
  };
}

if (process.argv[1]?.endsWith("compare.ts")) {
  const [runFile, ref] = process.argv.slice(2);
  const { rows, ...m } = compare(jsonl(join(RESULT_ROOT, "04-ratings", runFile)), loadRef(ref));
  console.log(JSON.stringify(m));
  const ci = process.argv.indexOf("--csv");
  if (ci > 0) writeFileSync(join(RESULT_ROOT, "04-ratings", process.argv[ci + 1]), "\ufeffreport_id,실행,기준,차이\n" + rows.map((r) => `${r.report_id},${r.run},${r.ref},${r.diff}`).join("\n") + "\n");
}
