// 원장 점수표(앵커) 40건 — 모델 점수 없이 원장이 직접 1~5를 매기고 이유를 적는 시트. 결과 = ~/eywa-data/consult-rating/원장-상담-점수표-2026-11-11.xlsx (원문이 들어 있어 저장소 밖).
// TSX_TSCONFIG_PATH=scripts/_oneoff/consult-rating/tsconfig.json node --import tsx scripts/_oneoff/consult-rating/owner-sheet.ts [시드=3]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { copyKey, copyStudentCounts, isRecordingPlaceholder } from "@/features/consultation-rating/harness/copies";

const ROOT = join(homedir(), "eywa-data", "consult-rating");
type Row = { id: string; student_id: string; summary: string; subject: string | null; audience: string | null; grade: string | null; student: string; counselor: string | null; consulted_at: string; from_makeedu: boolean };
const rows: Row[] = readFileSync(join(ROOT, "cs-all.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const seed = Number(process.argv[2] ?? 3);
let s = (seed * 2654435761) >>> 0;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const copies = copyStudentCounts(rows);
const used = new Set(Object.values(JSON.parse(readFileSync(join(ROOT, "samples", "cal1.map.json"), "utf8")) as Record<string, string>)); // 교정에 쓴 48건과 겹치지 않게
const text = (r: Row) => visibleConsultationSummary(r.summary).trim();
const kind = (r: Row): string => (copies.get(r.id)! > 1 ? "copied" : /✅ 상담 내역/.test(r.summary) ? "form" : r.from_makeedu ? "makeedu" : /^\[[^\]]+\]/.test(text(r)) ? "bracket" : text(r).length < 60 ? "short" : "free");
const want: Record<string, number> = { copied: 4, form: 9, makeedu: 6, bracket: 8, short: 5, free: 8 };
const picked: Row[] = [];
for (const [k, n] of Object.entries(want)) {
  const pool = rows.filter((r) => !isRecordingPlaceholder(text(r)) && !used.has(r.id) && kind(r) === k).sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set<string>();
  while (seen.size < n && seen.size < pool.length) {
    const r = pool[Math.floor(rnd() * pool.length)];
    const key = copyKey(r.summary);
    if (k === "copied" && picked.some((p) => copyKey(p.summary) === key)) continue; // 같은 복사 묶음에서 둘을 뽑지 않는다
    if (!seen.has(r.id)) { seen.add(r.id); picked.push(r); }
  }
}
// 보는 순서는 섞는다(종류 순서가 점수에 번지지 않게)
picked.sort(() => rnd() - 0.5);
async function main() {
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("점수표");
ws.addRow(["번호", "과목", "학년", "학생", "상담자", "상담일", "상담 기록 원문", "원장 점수(1~5)", "이유(짧게)"]);
const map: Record<string, string> = {};
picked.forEach((r, i) => {
  map[String(i + 1)] = r.id;
  ws.addRow([i + 1, r.subject ?? "", r.grade ?? "", r.student, r.counselor ?? "", r.consulted_at.slice(0, 10), visibleConsultationSummary(r.summary).trim(), "", ""]);
});
ws.getRow(1).font = { bold: true };
ws.views = [{ state: "frozen", ySplit: 1 }];
[6, 7, 7, 10, 10, 12, 90, 14, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
ws.getColumn(7).alignment = { wrapText: true, vertical: "top" };
ws.eachRow((row, n) => { if (n > 1) row.alignment = { vertical: "top", wrapText: true }; });
const guide = wb.addWorksheet("안내");
[["무엇을", "상담 기록 40건에 1~5점을 매기고 이유를 짧게 적어 주세요. AI 점수는 넣지 않았습니다."],
  ["기준 한 줄", "수업보고서 점수표와 같은 잣대 — 이 기록에 상담자의 정성과 이 아이(가정)에 대한 구체적인 이야기가 담겼는가."],
  ["점수 눈금", "5 = 아이 이야기가 자세하고 앞으로 할 일까지 · 4 = 아이에 맞춘 이야기나 학부모에게 직접 건넨 성의 있는 안내 · 3 = 무난한 기록 · 2 = 기본 사항뿐 · 1 = 한 문장·성의 없음"],
  ["참고", "상담이 필요했는지·잘 풀렸는지는 점수가 아니라 '기록에 담긴 정성·구체성'입니다. 같은 글이 여러 학생에게 입력된 기록도 섞여 있습니다."],
  ["이 점수의 쓰임", "AI 평점의 눈높이를 원장님 기준에 맞추는 예시로 씁니다(수업보고서 평점 때와 같은 방식)."]].forEach((r) => guide.addRow(r));
guide.getColumn(1).width = 14; guide.getColumn(2).width = 110;
const out = join(ROOT, "원장-상담-점수표-2026-11-11.xlsx");
await wb.xlsx.writeFile(out);
writeFileSync(join(ROOT, "samples", "owner40.map.json"), JSON.stringify(map, null, 1));
console.log(JSON.stringify({ out, n: picked.length, 종류: picked.reduce((a, r) => ((a[kind(r)] = (a[kind(r)] ?? 0) + 1), a), {} as Record<string, number>) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
