// ④ 사람 정답표 양식(gold-labels.csv · 빈 칸) + 사무실 검토용 원문 묶음(blind-review.xlsx) — 모델 판정·과거 판정은 싣지 않는다(블라인드).
// node --import tsx scripts/_oneoff/ai-credit-mvp/attendance/gold.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { RESULT_ROOT } from "../lib/runner";
import type { AtRecord } from "./prompts";

export const GOLD_COLUMNS = ["번호", "연락일", "학생", "원문", "표본", "출결종류", "날짜들", "형태", "확실성", "근거문장", "메모"] as const;
const GUIDE = [
  ["칸", "적는 법"],
  ["출결종류", "결석 / 지각 / 조퇴 / 없음 — 앞으로의 통보만(지난 일 설명·보강 문의·인사는 없음)"],
  ["날짜들", "해당 날짜를 모두 YYYY-MM-DD로, 세미콜론(;)으로 — 예 2026-10-22;2026-10-27. '오늘'은 연락일 기준"],
  ["형태", "하루 / 기간(연속된 날) / 띄엄띄엄(떨어진 날 여러 개)"],
  ["확실성", "확실 / 불확실(…할 수도 있다·확정되면 연락 같은 조건부)"],
  ["근거문장", "원문에서 판단 근거가 된 구절을 그대로"],
  ["표본", "조정용 = 프롬프트를 고칠 때 본 글 · 최종 = 마지막 평가에만 쓰는 글(먼저 채워 주시면 좋습니다)"],
];
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function main() {
  const snap = join(RESULT_ROOT, "01-snapshots", "attendance");
  const rows: AtRecord[] = readFileSync(join(snap, "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const splits = JSON.parse(readFileSync(join(snap, "splits.json"), "utf8")) as { tuning: string[]; final: string[] };
  const setOf = (id: string) => (splits.tuning.includes(id) ? "조정용" : splits.final.includes(id) ? "최종" : "제외");
  const list = rows.filter((r) => !r.held).sort((a, b) => (a.messageDate + a.mid).localeCompare(b.messageDate + b.mid));
  const data = list.map((r) => [r.mid, r.messageDate, r.student, r.content, setOf(r.id), "", "", "", "", "", ""]);
  const dir = join(RESULT_ROOT, "05-attendance");
  writeFileSync(join(dir, "gold-labels.csv"), "﻿" + [GOLD_COLUMNS, ...data].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
  const wb = new ExcelJS.Workbook();
  const g = wb.addWorksheet("안내");
  GUIDE.forEach((r) => g.addRow(r));
  g.getColumn(1).width = 12; g.getColumn(2).width = 90; g.getRow(1).font = { bold: true };
  const ws = wb.addWorksheet("정답 적기");
  ws.columns = GOLD_COLUMNS.map((h) => ({ header: h, key: h, width: h === "원문" ? 70 : h === "근거문장" ? 40 : 14 }));
  data.forEach((r) => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.getColumn(4).alignment = { wrapText: true, vertical: "top" };
  for (const [col, opts] of [[6, '"결석,지각,조퇴,없음"'], [8, '"하루,기간,띄엄띄엄"'], [9, '"확실,불확실"']] as const)
    for (let i = 2; i <= data.length + 1; i++) ws.getCell(i, col).dataValidation = { type: "list", allowBlank: true, formulae: [opts] };
  await wb.xlsx.writeFile(join(dir, "blind-review.xlsx"));
  console.log(JSON.stringify({ rows: data.length, 조정용: data.filter((r) => r[4] === "조정용").length, 최종: data.filter((r) => r[4] === "최종").length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
