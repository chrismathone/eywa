"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { REPORT_STATUS, managerIds, directorIds, type ReportListRow, type StaffOption, type StudentOption } from "@/features/withdrawal-reports/model";
import { RequestDialog } from "./request-dialog";

export function ReportList({ reports, completedLimited, staff, students, labels, userId, canRequest, scope }: {
  reports: ReportListRow[]; completedLimited: boolean; staff: StaffOption[]; students: StudentOption[]; labels: Record<string, string>; userId: string; canRequest: boolean; scope: readonly string[] | null;
}) {
  const [filter, setFilter] = useState("pending");
  const staffName = (id: string) => staff.find(s => s.id === id)?.name ?? "이전 담당자";
  const filtered = reports.filter(r => filter === "all" || (filter === "done" ? ["completed", "canceled"].includes(r.status) : !["completed", "canceled"].includes(r.status)));
  const reviewers = (r: ReportListRow, kind: "manager" | "director") => {
    const ids = kind === "manager" ? managerIds(r) : directorIds(r);
    const decisions = kind === "manager" ? r.manager_decisions : r.director_decisions;
    const at = kind === "manager" ? r.manager_approved_at : r.director_approved_at;
    return ids.map(id => `${decisions?.[id] || at ? "✓" : "○"} ${staffName(id)}`).join(" · ");
  };
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded-lg border bg-muted/20 p-1" aria-label="보고서 상태 필터">{[["pending", "진행 중"], ["done", "완료·취소"], ["all", "전체"]].map(([key, label]) => <Button key={key} size="sm" variant={filter === key ? "default" : "ghost"} onClick={() => setFilter(key)} aria-pressed={filter === key}>{label}</Button>)}</div>{canRequest && <RequestDialog staff={staff} students={students} labels={labels} scope={scope} />}</div>
    <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>{["학생·처리 구분", "퇴원·종료일", "작성 강사", "승인 진행", "상태"].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{filtered.map(r => <tr key={r.id} className="border-t hover:bg-muted/20">
      <td className="px-4 py-4"><Link className="font-semibold text-primary hover:underline" href={`/withdrawal-reports/${r.id}`}>{r.snapshot.name}</Link><div className="mt-1 text-xs text-muted-foreground">{r.exit_kind === "withdrawal" ? "전체 퇴원" : "수강종료"} · {r.subjects.map(s => labels[s] ?? s).join("·")}</div></td>
      <td className="whitespace-nowrap px-4 py-4">{r.effective_date}</td><td className="whitespace-nowrap px-4 py-4">{staffName(r.teacher_id)}</td><td className="px-4 py-4 text-xs"><div>관리자 {reviewers(r, "manager")}</div>{directorIds(r).length ? <div className="mt-1">원장 {reviewers(r, "director")}</div> : <div className="mt-1 text-muted-foreground">관리자가 최종 승인</div>}</td>
      <td className="px-4 py-4"><span className={`inline-block rounded-full px-2.5 py-1 text-xs ${r.status === "completed" ? "bg-att-present text-att-present-ink" : ["revision", "blocked"].includes(r.status) ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>{REPORT_STATUS[r.status]}</span>{["requested", "revision"].includes(r.status) && r.teacher_id === userId && <div className="mt-1 text-xs text-primary">내 작성 대기</div>}</td>
    </tr>)}</tbody></table>{!filtered.length && <p className="p-10 text-center text-sm text-muted-foreground">해당하는 퇴원보고서가 없습니다.</p>}</div>
    {completedLimited && <p className="text-xs text-muted-foreground">진행 중인 요청은 모두 표시하며, 완료·취소 건은 최근 200건까지 표시합니다.</p>}
  </>;
}
