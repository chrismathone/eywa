// ② 산출물 — new-ratings.xlsx(평점·근거 표 + Codex 대조) · results.jsonl · unresolved.csv. AI 호출 없음.
// node --import tsx scripts/_oneoff/ai-credit-mvp/ratings/deliver.ts <runs/최종 결과.jsonl> [codex 표본 이름, 기본 final]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { RATING_ITEMS } from "@/features/report-rating/harness/types";
import { RESULT_ROOT } from "../lib/runner";
import { loadRef } from "./compare";

const LABEL: Record<string, string> = { warmth: "따뜻함", personal: "개별성", concern: "아쉬운 점", clarity: "알기 쉬움", trust: "믿음" };
const SRC: Record<string, string> = { auto: "AI 자동작성", auto_edited: "AI 작성 후 수정", manual: "직접 작성" };

async function main() {
  const [file, codexSet = "final"] = process.argv.slice(2);
  const OUT = join(RESULT_ROOT, "04-ratings");
  const all = new Map(readFileSync(join(RESULT_ROOT, "01-snapshots", "ratings", "reports-all.jsonl"), "utf8").trim().split("\n").map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  const run = readFileSync(join(OUT, file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ref = existsSync(join(OUT, "codex", codexSet, "out.json")) ? loadRef(`codex:${codexSet}`) : new Map();
  writeFileSync(join(OUT, "results.jsonl"), run.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const bad = run.filter((x) => !x.ok);
  writeFileSync(join(OUT, "unresolved.csv"), "﻿보고서 id,수업일,사유\n" + bad.map((x) => `${x.report_id},${x.d},${String(x.error ?? "").replace(/,/g, " ")}`).join("\n") + "\n");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("새 평점");
  ws.addRow(["수업일", "담임", "학생", "반", "과목", "작성 방식", "평점", ...RATING_ITEMS.map((k) => LABEL[k]), "클레임(1차 판정만)", "학부모 느낌", "개선 제안", ...RATING_ITEMS.map((k) => `${LABEL[k]} 근거`), "Codex 평점", "차이"]);
  for (const x of run.filter((y) => y.ok).sort((a, b) => a.d.localeCompare(b.d))) {
    const r = all.get(x.report_id);
    const items = Object.fromEntries((x.items as { key: string; score: number; note: string }[]).map((i) => [i.key, i]));
    const c = ref.get(x.report_id);
    ws.addRow([x.d, r?.teacher_name ?? "", r?.student ?? "", r?.class_name ?? "", r?.subject === "english" ? "영어" : "수학", SRC[r?.ment_source] ?? "기록 없음", x.points,
      ...RATING_ITEMS.map((k) => items[k]?.score || ""), x.claim ? x.claim_reason : "", x.parent_feeling ?? "", x.suggestion ?? "", ...RATING_ITEMS.map((k) => items[k]?.note ?? ""),
      c?.points ?? "", c?.points != null ? +(x.points - c.points).toFixed(1) : ""]);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  [11, 8, 8, 16, 6, 12, 6, 7, 7, 7, 7, 7, 28, 28, 34, 34, 34, 34, 34, 34, 9, 6].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const g = wb.addWorksheet("안내");
  [["기준", "학부모가 받아봤을 때 좋은 감정을 느끼는가(10-22 기준 v4) · 코드 규칙 7차(앱 기본) · Claude Haiku 5.5 체크리스트"],
    ["클레임", "Haiku 단독 1차 판정만 — 10-22처럼 Sonnet·Codex 2단계 검증을 거친 '확정'이 아니다"],
    ["Codex 평점", "모델 이름·점수 없이 같은 카드와 기준으로 Codex가 따로 매긴 값(독립 평가) — 정답이 아니라 비교 기준"],
    ["저장", "이 표는 운영 DB에 올리지 않았다(정기 처리를 켜면 같은 값이 목록 '평점' 열에 선다)"]].forEach((r) => g.addRow(r));
  g.getColumn(1).width = 12; g.getColumn(2).width = 100;
  await wb.xlsx.writeFile(join(OUT, "new-ratings.xlsx"));
  console.log(JSON.stringify({ rows: run.length, ok: run.length - bad.length, unresolved: bad.length, codex: ref.size }));
}
main().catch((e) => { console.error(e); process.exit(1); });
