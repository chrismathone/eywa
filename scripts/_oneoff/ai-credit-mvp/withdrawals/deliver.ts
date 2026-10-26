// ① 산출물 — review.xlsx(행별 승인) · proposals.jsonl · source-coverage.csv · impact-preview.csv. AI 호출 없음.
// node --import tsx scripts/_oneoff/ai-credit-mvp/withdrawals/deliver.ts <runs/조정용 결과.jsonl> <runs/최종 결과.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { REASON_DETAILS, reasonDetailOf } from "@/features/withdrawals/reason-detail";
import { REASON_LABEL, normalizeReason, reasonDisplay, type WithdrawalReason } from "@/features/withdrawals/types";
import { RESULT_ROOT } from "../lib/runner";
import type { WdRecord } from "./card";
import { EXCLUDED_DEFAULT } from "./guideline";
import { recordedCategories } from "./recorded";
import type { Proposal } from "./verify";

type Full = WdRecord & { studentId: string; name: string; nameMatchedUnmapped: { aid: string; exitDate: string | null; subject: string | null; className: string | null }[] };
const OUT = join(RESULT_ROOT, "03-withdrawals");
const jsonl = <T>(f: string): T[] => readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map((v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";

async function main() {
  const [tuneFile, finalFile] = process.argv.slice(2);
  const recs: Full[] = jsonl(join(RESULT_ROOT, "01-snapshots", "withdrawals", "inputs.jsonl"));
  const ctx = JSON.parse(readFileSync(join(RESULT_ROOT, "01-snapshots", "withdrawals", "context.json"), "utf8"));
  const props = new Map([...jsonl<Proposal>(join(OUT, tuneFile)), ...jsonl<Proposal>(join(OUT, finalFile))].map((p) => [p.sid, p]));
  writeFileSync(join(OUT, "proposals.jsonl"), recs.map((r) => JSON.stringify({ ...(props.get(r.sid) ?? { status: "보류(개인정보)" }), sid: r.sid, studentId: r.studentId, withdrawnAt: r.withdrawnAt })).join("\n") + "\n");

  const wb = new ExcelJS.Workbook();
  const guide = wb.addWorksheet("안내");
  [["이 표는", "옛 퇴원 기록(침산 · 사유가 빈 238명)의 사유 제안입니다. 운영 DB에는 아직 아무것도 쓰지 않았습니다."],
    ["승인", "'제안' 줄을 확인하고 맞으면 '승인' 칸에 O. 사유를 고치려면 '사유 키'·'세부 키'·'메모'를 고친 뒤 O(키 목록은 '사유 키' 시트)."],
    ["충돌", "자료끼리 다른 사유를 말한 줄 — 후보 사유가 적혀 있지만 그대로 적용하지 않습니다. 고르실 때만 키를 적고 O."],
    ["근거 부족", "사유를 알 수 있는 글이 없는 줄(예: 메이크에듀 '기타'만) — 비워 둡니다."],
    ["강사 평가 제외", "졸업·이사·질병·권고퇴원은 강사 퇴원율에서 빠지는 사유라 글에 그 사실이 직접 적혀 있을 때만 제안했습니다."],
    ["원장 확인 1", "'고등수학관 이동'은 지금 '기타 + 메모'로 제안했습니다. 강사 퇴원율에서 뺄 사유(졸업처럼)로 볼지는 원장님이 정하실 일입니다."],
    ["마감한 달", "강사평가에서 마감한 달(2026-04~09)은 사유를 채워도 점수가 바뀌지 않습니다(DB가 굳힘). 사유 통계에는 반영됩니다."],
    ["적용", "승인한 줄만 적용 스크립트(apply.mjs)가 조건부로 바꾸고 백업·감사로그를 남깁니다. 되돌리기 = revert.mjs."]].forEach((r) => guide.addRow(r));
  guide.getColumn(1).width = 16; guide.getColumn(2).width = 110;

  const ws = wb.addWorksheet("검토");
  const head = ["승인", "상태", "사유", "세부", "메모", "사유 키", "세부 키", "강사평가 제외", "근거(원문 그대로)", "근거 위치", "기록된 분류", "판정 메모", "학생", "학년", "퇴원일", "원본 보고서", "메이크에듀 사유(원문)", "원본 상세사유(앞 300자)", "학생 id", "번호"];
  ws.addRow(head);
  const order: Record<string, number> = { 제안: 0, 충돌: 1, "근거 부족": 2, "보류(개인정보)": 3 };
  const sorted = [...recs].sort((a, b) => (order[props.get(a.sid)?.status ?? "근거 부족"] - order[props.get(b.sid)?.status ?? "근거 부족"]) || String(a.withdrawnAt).localeCompare(String(b.withdrawnAt)));
  for (const r of sorted) {
    const p = props.get(r.sid);
    const reason = p?.reason as WithdrawalReason | null;
    const same = r.sources.archives.filter((a) => a.thisWithdrawal !== "다른 때(과목 종료 등)");
    ws.addRow(["", p?.status ?? "", reason ? REASON_LABEL[reason] : "", reasonDetailOf(p?.detail)?.label ?? "", p?.memo ?? "", reason ?? "", p?.detail ?? "",
      reason && (EXCLUDED_DEFAULT as readonly string[]).includes(reason) ? "예" : "", (p?.evidence ?? []).map((e) => e.quote).join(" / "), (p?.evidence ?? []).map((e) => e.src).join(" / "),
      recordedCategories(r).map((x) => x.text).join(" / "), (p?.notes ?? []).join(" / "), r.name, r.grade ?? "", r.withdrawnAt ?? "", r.group,
      r.sources.makeedu?.reasonRaw ?? "", same.map((a) => a.fields["상세사유"] ?? "").join(" / ").slice(0, 300), r.studentId, r.sid]);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  [6, 8, 10, 22, 14, 14, 18, 8, 50, 18, 24, 40, 8, 6, 11, 9, 40, 50, 38, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const keys = wb.addWorksheet("사유 키");
  keys.addRow(["사유 키", "사유", "세부 키", "세부"]);
  for (const [k, label] of Object.entries(REASON_LABEL)) {
    const details = REASON_DETAILS[k as WithdrawalReason];
    if (!details.length) keys.addRow([k, label, "", "(세부 없음)"]);
    for (const d of details) keys.addRow([k, label, d.key, d.label]);
  }
  // 적용기(apply.mjs)가 승인 CSV의 키·라벨을 대조하는 표 — 앱의 사유 목록(reason-detail.ts)에서 그대로 뽑는다.
  writeFileSync(join(OUT, "reason-keys.json"), JSON.stringify({
    reasons: REASON_LABEL,
    details: Object.fromEntries(Object.entries(REASON_DETAILS).flatMap(([reason, ds]) => ds.map((d) => [d.key, { reason, label: d.label }]))),
  }, null, 2));
  const um = wb.addWorksheet("이름만 같은 미연결 원본");
  um.addRow(["학생", "퇴원일", "원본 번호", "원본 종료일", "과목", "반", "메모"]);
  for (const r of recs) for (const u of r.nameMatchedUnmapped) um.addRow([r.name, r.withdrawnAt, u.aid, u.exitDate, u.subject, u.className, "이름만 같다 — 연결 불확실이라 근거로 쓰지 않았다(퇴원보고서 화면의 학생 연결에서 확인)"]);
  await wb.xlsx.writeFile(join(OUT, "review.xlsx"));

  writeFileSync(join(OUT, "source-coverage.csv"), csv([["번호", "학생 id", "퇴원일", "메이크에듀 사유", "원본(같은 퇴원)", "원본(다른 때)", "퇴원 무렵 수강 종료 줄", "퇴원 전 90일 원생상담", "퇴원 전 60일 학부모 글", "이름만 같은 미연결 원본"],
    ...recs.map((r) => [r.sid, r.studentId, r.withdrawnAt, r.sources.makeedu?.reasonRaw ? "있음" : "없음", r.sources.archives.filter((a) => a.thisWithdrawal !== "다른 때(과목 종료 등)").length,
      r.sources.archives.filter((a) => a.thisWithdrawal === "다른 때(과목 종료 등)").length, r.sources.enrollments.filter((e) => e.gapDays != null && Math.abs(e.gapDays) <= 31).length,
      r.sources.consultations.length, r.sources.parentMessages.length, r.nameMatchedUnmapped.length])]));

  // 영향 미리보기 — 모든 제안을 승인했다고 가정(실제는 원장이 고른 줄만).
  // 저장된 키는 옛 표기(dissatisfied 등)가 섞여 있다 — 앱과 같은 정규화로 묶는다(같은 사유가 두 줄로 갈리거나 영문 키가 보이지 않게).
  const before: Record<string, number> = {};
  for (const x of ctx.withdrawnReasonDistribution as { reason: string; n: number }[]) {
    const k = x.reason === "(빈칸)" ? "(빈칸)" : normalizeReason(x.reason) ?? x.reason;
    before[k] = (before[k] ?? 0) + x.n;
  }
  const after = { ...before };
  const closed = new Set<string>(ctx.closedPortfolioMonths.map((m: { month: string }) => m.month));
  const monthRows: unknown[][] = [];
  for (const r of recs) {
    const p = props.get(r.sid);
    if (p?.status !== "제안" || !p.reason) continue;
    after["(빈칸)"]--; after[p.reason] = (after[p.reason] ?? 0) + 1;
    const month = String(r.withdrawnAt).slice(0, 7);
    if ((EXCLUDED_DEFAULT as readonly string[]).includes(p.reason)) monthRows.push([r.sid, month, REASON_LABEL[p.reason as WithdrawalReason], closed.has(month) ? "마감한 달 — 점수 불변" : month < "2026-04" ? "강사평가 시작 전 달" : "아직 열린 달 — 다음 집계부터 퇴원율에서 빠짐"]);
  }
  const keysAll = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  writeFileSync(join(OUT, "impact-preview.csv"), csv([["사유", "지금(퇴원생 474명)", "제안 모두 승인 시"], ...keysAll.map((k) => [k === "(빈칸)" ? "(빈칸)" : reasonDisplay(k) ?? k, before[k] ?? 0, after[k] ?? 0]),
    [], ["강사 평가 제외 사유 제안", "퇴원 달", "사유", "강사평가 영향"], ...monthRows]));
  const cnt = (s: string) => [...props.values()].filter((p) => p.status === s).length;
  console.log(JSON.stringify({ 제안: cnt("제안"), 충돌: cnt("충돌"), 근거부족: cnt("근거 부족"), 제외사유제안: monthRows.length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
