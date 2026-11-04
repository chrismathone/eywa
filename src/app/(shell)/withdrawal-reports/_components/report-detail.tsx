"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import type { ReportConsultation } from "@/features/withdrawal-reports/consultation";
import { ReportForm } from "./report-form";
import { LaterInvoices } from "./later-invoices";
import type { LaterInvoice } from "@/features/withdrawal-reports/server/refund";
import type { SubjectHistoryRow } from "@/features/withdrawal-reports/course-period";
import { fillEmptyReportFields } from "@/features/withdrawal-reports/prefill";
import { changeWithdrawalReport } from "@/features/withdrawal-reports/server/actions";
import { EMPTY_BODY, REPORT_ACTION_LABEL, directorIds, isDirectReport, reportCapabilities, reportStatusLabel, skipsManagerStep, type WithdrawalReport, type ReportEvent, type StaffOption, type ReportAction, type ReportBody } from "@/features/withdrawal-reports/model";

const control = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm disabled:bg-muted/20 disabled:text-foreground";
const dateTime = (v: string) => new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
export function ReportDetail({ report: r, events, staff, labels, userId, writable, directorLevel = false, consultations = [], assignmentChanged = false, prefill = {}, prefillWarning, withdrawalHref, laterInvoices = [], deskStaff = [], subjectHistory = [] }: {
  report: WithdrawalReport; events: ReportEvent[]; staff: StaffOption[]; labels: Record<string, string>; userId: string; writable: boolean; consultations?: ReportConsultation[]; assignmentChanged?: boolean; prefill?: Partial<ReportBody>; prefillWarning?: string;
  /** 원장 이상(`cancelsAsDirector`) — 남이 요청한 보고서도 취소 버튼이 선다. */
  directorLevel?: boolean;
  /** 학생이 지금 퇴원 상태이고 퇴원관리를 열 수 있을 때만 서버가 넣는다(`withdrawalDetailHref`). */
  withdrawalHref?: string | null;
  /** 퇴원월 뒤 청구(원장 2026-10-29) — 원장은 환불 승인 토글, 나머지는 보기만. */
  laterInvoices?: LaterInvoice[];
  /** 환불 승인 때 고를 데스크 담당자(원장에게만 내려온다). */
  deskStaff?: { id: string; name: string }[];
  subjectHistory?: SubjectHistoryRow[];
}) {
  const router = useRouter();
  const [body, setBody] = useState<ReportBody>(() => fillEmptyReportFields({ ...EMPTY_BODY, ...r.body }, prefill));
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<ReportAction | null>(null);
  // 확인 칸은 양식 아래에 있다 — 위쪽 '요청 취소'(원장 2026-10-30)를 눌러도 보이게 그 자리로 옮겨 준다.
  const decisionRef = useRef<HTMLElement>(null);
  useEffect(() => { if (decision) decisionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }); }, [decision]);
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();
  const capabilities = reportCapabilities(r, userId, writable, directorLevel);
  const nameOf = (id: string | null) => id ? staff.find(s => s.id === id)?.name ?? r.snapshot.courses.find(c => c.teacherId === id)?.teacherName ?? "이전 담당자" : "자동 처리";
  const update = <K extends keyof ReportBody>(key: K, value: ReportBody[K]) => setBody(b => ({ ...b, [key]: value }));
  function change(action: ReportAction) {
    setError("");
    startTransition(async () => {
      try {
        const result = await changeWithdrawalReport(r.id, action, r.revision, action === "save" || action === "submit" ? body : action === "reject" ? comment : undefined);
        if ("error" in result) { setError(result.error); return; }
        setDecision(null); setComment(""); toast.success(`${REPORT_ACTION_LABEL[action]}했습니다.`); router.refresh();
      } catch { setError("처리를 완료하지 못했습니다. 새로고침 후 상태를 확인해 주세요."); }
    });
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="flex flex-wrap items-center gap-3 text-sm"><Link className="text-primary hover:underline" href="/withdrawal-reports">← 보고서 목록</Link>{withdrawalHref && <WindowLink href={withdrawalHref} className="text-primary hover:underline">퇴원 상세</WindowLink>}</span><span className="flex items-center gap-2">{capabilities.cancel && <Button variant="outline" size="sm" disabled={pending} onClick={() => setDecision("cancel")}>요청 취소</Button>}<span className="rounded-full bg-muted px-3 py-1.5 text-sm">{reportStatusLabel(r, staff)}</span></span></div>
    <p className="text-sm">{r.exit_kind === "withdrawal" ? "퇴원" : "반 수강종료"} · {r.subjects.length ? r.subjects.map(s => labels[s] ?? "기타 과목").join(" · ") : "다니는 반 없음"}</p>
    {/* 관리자 바로 처리(강사 작성 없이, 원장 2026-10-23) — 누가·언제 처리했는지 먼저 말한다(양식의 상담·담임 의견 칸은 비어 있다). */}
    {isDirectReport(r) && <p className="rounded-lg border bg-muted/20 p-4 text-sm">관리자 바로 처리 · {nameOf(r.requested_by)} · {dateTime(r.created_at)} — 강사 작성과 승인 없이 처리한 기록입니다.</p>}
    {r.request_note && <div className="rounded-lg border bg-muted/20 p-4 text-sm"><div className="mb-2 font-medium">작성 요청 · {nameOf(r.requested_by)}</div><p className="whitespace-pre-wrap">{r.request_note}</p></div>}
    {r.last_comment && <p className="whitespace-pre-wrap rounded-lg border border-att-late-ink/20 bg-att-late p-4 text-sm text-att-late-ink">{r.last_comment}</p>}
    {r.status === "scheduled" && <p className="rounded-lg border bg-muted/20 p-4 text-sm">{isDirectReport(r) ? "처리 예약입니다." : "승인이 완료되었습니다."} {r.effective_date}에 처리하며, 그 전까지는 기존 수강 상태를 유지합니다.</p>}
    {r.status === "approved" && <p className="rounded-lg border bg-muted/20 p-4 text-sm">이 보고서는 승인이 완료되었습니다. 함께 요청한 다른 강사의 보고서 승인까지 모두 끝나면 처리합니다.</p>}
    {assignmentChanged && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">요청 이후 학생·수강·담당 강사가 변경되었습니다. 아래 내용은 요청 당시 기록이며, 제출·승인을 진행할 수 없습니다. 요청한 사람이 요청을 취소하고 현재 담당 기준으로 다시 요청해 주세요.</p>}
    {prefillWarning && <p role="alert" className="rounded-lg border p-4 text-sm">{prefillWarning}</p>}
    <ReportForm managerSkipped={skipsManagerStep(r, staff)} consultations={consultations} report={r} body={body} events={events} labels={labels} nameOf={nameOf} editable={capabilities.edit} pending={pending} onChange={update} subjectHistory={subjectHistory}
      refundCheck={r.status === "canceled" ? undefined : <LaterInvoices reportId={r.id} rows={laterInvoices} canApprove={writable && directorLevel} deskStaff={deskStaff} />} />
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {capabilities.edit && <><Button disabled={pending} variant="outline" onClick={() => change("save")}>임시 저장</Button><Button disabled={pending || assignmentChanged} onClick={() => setDecision("submit")}>관리자에게 제출</Button></>}
      {capabilities.approve && <><Button disabled={pending || assignmentChanged} onClick={() => setDecision("approve")}>승인</Button><Button disabled={pending} variant="outline" onClick={() => setDecision("reject")}>반려</Button></>}
    </div>
    {decision && <section ref={decisionRef} className="space-y-3 rounded-xl border bg-muted/20 p-5" aria-label="처리 확인">
      <p className="text-sm">{decision === "submit" ? `보고서를 제출하면 ${skipsManagerStep(r, staff) ? "원장" : "관리자"} 검토가 시작됩니다. 이후 수정은 반려 후 가능합니다.` : decision === "approve" ? `이 보고서를 승인합니다. ${r.status === "manager_pending" && directorIds(r).length ? "관리자 전원 승인 후 원장 검토로 넘어갑니다." : `함께 요청한 보고서와 모든 승인자의 승인이 끝나면 ${r.effective_date}에 ${r.exit_kind === "withdrawal" ? "퇴원" : "선택 과목 수강종료"}을 처리합니다. 처리일이 지났다면 즉시 반영됩니다.`}` : decision === "cancel" ? "함께 요청한 모든 강사의 보고서를 취소합니다. 학생의 수강 상태는 유지됩니다." : "수정이 필요한 내용을 적어 주세요. 이 보고서의 승인을 초기화하고 강사가 수정 후 다시 제출합니다."}</p>
      {decision === "reject" && <textarea className={control} aria-label="반려 사유" rows={3} maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} />}
      <div className="flex gap-2"><Button disabled={pending || (decision === "reject" && !comment.trim())} onClick={() => change(decision)}>{pending ? "처리 중…" : `${REPORT_ACTION_LABEL[decision]} 확인`}</Button><Button variant="outline" disabled={pending} onClick={() => setDecision(null)}>닫기</Button></div>
    </section>}
    <section className="rounded-xl border p-5"><h2 className="mb-4 text-sm font-semibold">처리 이력</h2><ol className="space-y-3">{events.map(e => <li key={e.id} className="text-sm"><div>{REPORT_ACTION_LABEL[e.action]} · {nameOf(e.actor_id)} <span className="ml-2 text-xs text-muted-foreground">{dateTime(e.created_at)}</span></div>{e.comment && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{e.comment}</p>}</li>)}</ol></section>
  </>;
}
