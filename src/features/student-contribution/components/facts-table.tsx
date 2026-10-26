"use client";
import { useState } from "react";
import { ContributionLink as Link } from "./student-contribution-scope";
import type { EvidenceRef, StudentFact } from "@/features/students/ontology/types";
import { ListPager } from "./list-pager";
import { factLabels, fieldClass, sourceLabels } from "./presentation";

function sourceHref(e: EvidenceRef, studentId: string) {
  if (e.source === "enrollment_consultations") return `/enrollment/${e.id}`;
  const tab = e.source === "invoices" || e.source === "makeedu_history_bills" ? "billing"
    : e.source === "enrollments" ? "classes" : e.source === "attendance_records" ? "attendance"
      : e.source === "student_homework_videos" ? "homework-videos" : e.source === "student_grades" || e.source === "lesson_reports" ? "grades" : "contribution";
  return `/students/${e.studentId || studentId}?tab=${tab}`;
}
function summary(f: StudentFact) {
  const v = f.value as Record<string, unknown>;
  if (f.kind === "tuition") return `${Number(v.tuitionWon).toLocaleString("ko-KR")}원 · 청구 월 기준`;
  if (f.kind === "attendance") return `${({ present: "출석", late: "지각", absent: "결석", excused: "사유 결석", makeup: "보강", early_leave: "조퇴" }[String(v.status)] ?? String(v.status))}${v.slot ? ` · ${v.slot}` : ""}${v.seat ? ` · ${v.seat}번 좌석` : ""}`;
  if (f.kind === "exam") return `${v.subject ?? "평가"} · ${v.score} / ${v.max}점`;
  if (f.kind === "observation") return `${v.author ?? "작성자 미확인"} · ${v.evidence || "인정할 관찰 내용 없음"}`;
  if (f.kind === "enrolled") return `${v.start} ~ ${v.end ?? "계속"}${v.onHold ? " · 현재 휴원" : ""}`;
  if (f.kind === "referred") return v.startedOn ? `${v.startedOn} 수업 시작 확인` : "소개 상담 · 수업 시작 확인 전";
  if (f.kind === "homework") return v.status === "submitted" ? "영상 제출 확인" : "제출 확인 전";
  return "상담 기록";
}
export function FactsTable({ facts }: { facts: readonly StudentFact[] }) {
  const [kind, setKind] = useState("all"), [page, setPage] = useState(1);
  const rows = facts.filter((f) => kind === "all" || f.kind === kind).sort((a, b) => b.occurred.value.localeCompare(a.occurred.value));
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 10)));
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
      <label className="flex items-center gap-3 text-sm">기록 종류<select aria-label="기록 종류" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className={fieldClass}>
        <option value="all">전체 기록 ({facts.length})</option>{Object.entries(factLabels).filter(([k]) => facts.some((f) => f.kind === k)).map(([k, label]) => <option key={k} value={k}>{label} ({facts.filter((f) => f.kind === k).length})</option>)}</select></label>
      <p className="text-xs">발생일 최신순 · 날짜가 월까지만 있으면 월 단위 원자료입니다.</p>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-160 table-fixed text-left text-sm"><colgroup><col className="w-36" /><col className="w-40" /><col /><col className="w-40" /></colgroup>
      <thead className="bg-secondary"><tr>{["발생일", "기록", "내용", "원본·근거"].map((s) => <th scope="col" key={s} className="px-5 py-3 font-medium">{s}</th>)}</tr></thead>
      <tbody>{rows.slice((current - 1) * 10, current * 10).map((f) => <tr key={f.id} className="border-b border-line-faint align-top last:border-0">
        <td className="px-5 py-3 tabular-nums">{f.occurred.value}</td><td className="px-5 py-3">{factLabels[f.kind]}<span className="mt-1 block text-xs">{f.basis === "ai" ? "AI 판정" : f.basis === "rule" ? "규칙 판정" : "원본 기록"}{f.state !== "active" ? ` · ${f.state === "cancelled" ? "취소" : "확인 전"}` : ""}</span></td>
        <td className="break-words px-5 py-3 leading-relaxed">{summary(f)}</td><td className="px-5 py-3">
          {f.evidence[0] && <Link className="text-primary underline underline-offset-4" href={sourceHref(f.evidence[0], f.studentId)}>원본 보기</Link>}
          <details className="mt-2 text-xs"><summary className="cursor-pointer">근거 {f.evidence.length}건</summary><ul className="mt-2 space-y-2">{f.evidence.map((e) => <li key={`${e.source}:${e.id}`}><Link className="text-primary underline" href={sourceHref(e, f.studentId)}>{sourceLabels[e.source]}</Link><span className="mt-1 block break-all">기록 번호 {e.id}</span></li>)}</ul><p className="mt-2">확인 {new Date(f.recordedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p></details>
        </td></tr>)}</tbody></table></div>
    {!rows.length && <p className="px-5 py-10 text-center text-sm">이 달에 집계된 {kind === "all" ? "" : factLabels[kind as StudentFact["kind"]]} 기록이 없습니다. 다른 월을 선택해 확인해 주세요.</p>}
    <ListPager page={current} total={rows.length} pageSize={10} onChange={setPage} label="학생 기록" />
  </div>;
}
