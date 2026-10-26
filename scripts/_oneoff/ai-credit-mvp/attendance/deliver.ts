// ④ 산출물 — all-results.jsonl(과거 운영 · 새 판정들 · 기준) · disagreements.xlsx(어느 하나라도 갈린 건 + 사람 확인 칸) · metrics.json.
// node --import tsx scripts/_oneoff/ai-credit-mvp/attendance/deliver.ts <표본 tuning|final> <이름=runs/파일.jsonl> ...
// 기준은 metrics.ts loadRefs — 사람 정답표가 채워졌으면 그것, 아니면 'Codex 잠정'(그렇게 적는다).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { RESULT_ROOT } from "../lib/runner";
import { expand, loadRefs, score } from "./metrics";
import type { AtRecord } from "./prompts";

type J = { id: string; category: string; startsOn: string | null; endsOn: string | null; detail?: string | null; ok?: boolean; uncovered?: string[] };
const KO: Record<string, string> = { absence: "결석", late: "지각", early_leave: "조퇴", none: "없음" };
const show = (j: J | undefined) => (!j ? "-" : j.ok === false ? "실패" : j.category === "none" ? "없음" : `${KO[j.category]} ${expand(j.startsOn, j.endsOn).map((d) => d.slice(5)).join(",")}`);

async function main() {
  const [set, ...pairs] = process.argv.slice(2);
  const snap = join(RESULT_ROOT, "01-snapshots", "attendance");
  const rows: AtRecord[] = readFileSync(join(snap, "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const want = new Set<string>(JSON.parse(readFileSync(join(snap, "splits.json"), "utf8"))[set]);
  const list = rows.filter((r) => want.has(r.id)).sort((a, b) => (a.messageDate + a.mid).localeCompare(b.messageDate + b.mid));
  const refs = loadRefs(set, rows);
  const runs: [string, Map<string, J>][] = [["과거 운영(DeepSeek v4-pro 등)", new Map(list.map((r) => [r.id, { id: r.id, category: r.past.category, startsOn: r.past.startsOn, endsOn: r.past.endsOn, detail: r.past.detail }]))]];
  for (const p of pairs) {
    const [name, file] = p.split("=");
    runs.push([name, new Map(readFileSync(join(RESULT_ROOT, "05-attendance", file), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((j: J) => [j.id, j]))]);
  }
  const source = [...refs.values()][0]?.source ?? "기준 없음";
  const metrics = Object.fromEntries(runs.map(([name, m]) => { const { diffs: _d, ...s } = score([...m.values()].filter((j) => want.has(j.id)), refs); return [name, s]; }));
  writeFileSync(join(RESULT_ROOT, "05-attendance", `metrics-${set}.json`), JSON.stringify({ 표본: set, 기준: source, 건수: list.length, metrics }, null, 2));
  writeFileSync(join(RESULT_ROOT, "05-attendance", `all-results-${set}.jsonl`), list.map((r) => JSON.stringify({ mid: r.mid, messageDate: r.messageDate, content: r.content, ref: refs.get(r.id) ?? null,
    ...Object.fromEntries(runs.map(([name, m]) => [name, m.get(r.id) ?? null])) })).join("\n") + "\n");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("갈린 건");
  ws.addRow(["번호", "연락일", "원문", `기준(${source})`, ...runs.map(([n]) => n), "사람 확인(종류)", "사람 확인(날짜들)", "메모"]);
  for (const r of list) {
    const ref = refs.get(r.id);
    const refText = !ref ? "-" : ref.category === "none" ? "없음" : `${KO[ref.category]} ${ref.dates.map((d) => d.slice(5)).join(",")}${ref.uncertain ? " (불확실)" : ""}`;
    const cells = runs.map(([, m]) => show(m.get(r.id)));
    if (new Set([refText.replace(" (불확실)", ""), ...cells]).size === 1) continue; // 모두 같으면 뺀다
    ws.addRow([r.mid, r.messageDate, r.content, refText, ...cells, "", "", ""]);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.getColumn(3).width = 70; ws.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  for (let i = 4; i <= 4 + runs.length; i++) ws.getColumn(i).width = 18;
  const ms = wb.addWorksheet("지표");
  ms.addRow(["판정", ...Object.keys(Object.values(metrics)[0] ?? {})]);
  for (const [n, s] of Object.entries(metrics)) ms.addRow([n, ...Object.values(s)]);
  ms.addRow([]); ms.addRow([`기준 = ${source}${source === "Codex 잠정" ? " — 사람 정답이 아니다. gold-labels.csv를 채우면 같은 명령으로 다시 계산된다." : ""}`]);
  await wb.xlsx.writeFile(join(RESULT_ROOT, "05-attendance", `disagreements-${set}.xlsx`));
  console.log(JSON.stringify({ set, 기준: source, 건수: list.length, 갈린건: ws.rowCount - 1, metrics }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
