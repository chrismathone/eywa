// ④ 결석 문자 지표 — 판정 ↔ 기준(사람 정답표가 채워졌으면 그것, 아니면 Codex 잠정 정답 — 결과에 어느 쪽인지 적는다).
// node --import tsx scripts/_oneoff/ai-credit-mvp/attendance/metrics.ts <runs/파일.jsonl | past> <tuning|final> [--show]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RESULT_ROOT } from "../lib/runner";
import type { AtRecord } from "./prompts";

export type Ref = { category: string; dates: string[]; form: string; uncertain: boolean; source: "사람 정답" | "Codex 잠정" };
type Judged = { id: string; category: string; startsOn: string | null; endsOn: string | null; ok?: boolean };
const KO: Record<string, string> = { absence: "결석", late: "지각", early_leave: "조퇴", none: "없음" };
const FROM_KO: Record<string, string> = { 결석: "absence", 지각: "late", 조퇴: "early_leave", 없음: "none" };

export function expand(a: string | null, b: string | null): string[] {
  if (!a) return [];
  const out: string[] = [];
  for (let t = Date.parse(`${a}T00:00:00Z`), end = Date.parse(`${b ?? a}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** 사람 정답표(gold-labels.csv)에 출결종류가 하나라도 적혀 있으면 그것, 아니면 Codex 잠정 정답. */
export function loadRefs(set: string, rows: AtRecord[]): Map<string, Ref> {
  const byMid = new Map(rows.map((r) => [r.mid, r.id]));
  const gold = join(RESULT_ROOT, "05-attendance", "gold-labels.csv");
  if (existsSync(gold)) {
    const lines = parseCsv(readFileSync(gold, "utf8").replace(/^﻿/, "")).slice(1).filter((c) => c[5]?.trim());
    if (lines.length) return new Map(lines.filter((c) => byMid.has(c[0])).map((c) => [byMid.get(c[0])!, { category: FROM_KO[c[5].trim()] ?? "none",
      dates: c[6].split(/[;,\s]+/).filter(Boolean).sort(), form: c[7].trim(), uncertain: c[8].trim() === "불확실", source: "사람 정답" as const }]));
  }
  const items = JSON.parse(readFileSync(join(RESULT_ROOT, "05-attendance", "codex", set, "out.json"), "utf8")).items as { mid: string; category: string; dates: string[]; form: string; uncertain: boolean }[];
  return new Map(items.filter((x) => byMid.has(x.mid)).map((x) => [byMid.get(x.mid)!, { category: x.category, dates: [...x.dates].sort(), form: x.form, uncertain: x.uncertain, source: "Codex 잠정" as const }]));
}

export function score(judged: Judged[], refs: Map<string, Ref>) {
  const c = { n: 0, 정답일치: 0, 없는출결생성: 0, 통보누락: 0, 종류다름: 0, 날짜정확: 0, 날짜확대: 0, 띄엄띄엄첫날만: 0, 날짜일부: 0, 날짜빗나감: 0, 실패: 0, 기준출결: 0, 판정출결: 0 };
  const diffs: string[] = [];
  for (const j of judged) {
    const ref = refs.get(j.id);
    if (!ref) continue;
    c.n++;
    if (j.ok === false) { c.실패++; diffs.push(`${j.id} 실패`); continue; }
    const att = j.category !== "none", refAtt = ref.category !== "none";
    if (refAtt) c.기준출결++;
    if (att) c.판정출결++;
    if (!att && !refAtt) { c.정답일치++; continue; }
    if (att && !refAtt) { c.없는출결생성++; diffs.push(`${j.id} 없는 ${KO[j.category]} 생성`); continue; }
    if (!att && refAtt) { c.통보누락++; diffs.push(`${j.id} ${KO[ref.category]} 누락`); continue; }
    if (j.category !== ref.category) { c.종류다름++; diffs.push(`${j.id} 종류 ${KO[j.category]}≠${KO[ref.category]}`); continue; }
    const got = expand(j.startsOn, j.endsOn), want = ref.dates;
    const extra = got.filter((d) => !want.includes(d)), lack = want.filter((d) => !got.includes(d));
    if (!want.length || (!extra.length && !lack.length)) { c.날짜정확++; c.정답일치++; continue; }
    if (extra.length && got.some((d) => want.includes(d))) { c.날짜확대++; diffs.push(`${j.id} 날짜 확대 +${extra.join(",")}`); continue; }
    if (!extra.length && ref.form === "띄엄띄엄" && got[0] === want[0]) { c.띄엄띄엄첫날만++; c.정답일치++; continue; } // 운영 설계(가장 이른 날 + 나머지는 안내)
    if (!extra.length) { c.날짜일부++; diffs.push(`${j.id} 날짜 일부 -${lack.join(",")}`); continue; }
    c.날짜빗나감++; diffs.push(`${j.id} 날짜 빗나감 ${got.join(",")}≠${want.join(",")}`);
  }
  return { ...c, 정답일치율: c.n ? Math.round((c.정답일치 / c.n) * 1000) / 10 : null, diffs };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

if (process.argv[1]?.endsWith("metrics.ts")) {
  const [runFile, set] = process.argv.slice(2);
  const si = process.argv.indexOf("--snap"), snapName = si > 0 ? process.argv[si + 1] : "attendance";
  const rows: AtRecord[] = readFileSync(join(RESULT_ROOT, "01-snapshots", snapName, "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const want = new Set<string>(JSON.parse(readFileSync(join(RESULT_ROOT, "01-snapshots", snapName, "splits.json"), "utf8"))[set]);
  const judged: Judged[] = runFile === "past"
    ? rows.filter((r) => want.has(r.id)).map((r) => ({ id: r.id, category: r.past.category, startsOn: r.past.startsOn, endsOn: r.past.endsOn }))
    : readFileSync(join(RESULT_ROOT, "05-attendance", runFile), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const refs = loadRefs(snapName === "attendance" ? set : `${snapName}-${set}`, rows);
  const { diffs, ...m } = score(judged, refs);
  console.log(JSON.stringify({ 기준: [...refs.values()][0]?.source, ...m }));
  if (process.argv.includes("--show")) for (const d of diffs) console.log(d);
}
