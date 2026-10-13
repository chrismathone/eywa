"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SystemRole } from "@/lib/permissions";
import { REASON_LABEL } from "@/features/withdrawals/types";
import { changeWithdrawalReport } from "@/features/withdrawal-reports/server/actions";
import { EMPTY_BODY, REPORT_STATUS, REPORT_ACTION_LABEL, reportCapabilities, type WithdrawalReport, type ReportEvent, type StaffOption, type ReportAction, type ReportBody } from "@/features/withdrawal-reports/model";

const control = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm disabled:bg-muted/20 disabled:text-foreground";
const dateTime = (v: string) => new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
export function ReportDetail({ report: r, events, staff, labels, userId, writable, role }: {
  report: WithdrawalReport; events: ReportEvent[]; staff: StaffOption[]; labels: Record<string, string>; userId: string; writable: boolean; role?: SystemRole;
}) {
  const router = useRouter();
  const [body, setBody] = useState<ReportBody>({ ...EMPTY_BODY, ...r.body });
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<ReportAction | null>(null);
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();
  const capabilities = reportCapabilities(r, userId, writable, role);
  const nameOf = (id: string | null) => id ? staff.find(s => s.id === id)?.name ?? "이전 담당자" : "자동 처리";
  const courses = r.snapshot.courses.filter(c => r.subjects.includes(c.subject));
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
  const textField = (key: keyof Pick<ReportBody, "detail" | "attendance" | "studentConsultation" | "parentConsultation" | "teacherOpinion" | "arrearsNote">, title: string, rows = 3) => <label className="block space-y-2 text-sm"><span className="font-medium">{title}</span>{capabilities.edit ? <textarea className={control} rows={rows} maxLength={key === "arrearsNote" ? 1000 : 5000} value={body[key]} disabled={pending} onChange={e => update(key, e.target.value)} /> : <p className="min-h-14 whitespace-pre-wrap rounded-md bg-muted/20 p-3 leading-relaxed">{body[key] || "미기재"}</p>}</label>;
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link className="text-sm text-primary hover:underline" href="/withdrawal-reports">← 보고서 목록</Link><span className="rounded-full bg-muted px-3 py-1.5 text-sm">{REPORT_STATUS[r.status]}</span></div>
    <div className="grid gap-3 md:grid-cols-3">
      {[["작성 강사", r.teacher_id, null], ["관리자 승인", r.manager_id, r.manager_approved_at], ["원장 승인", r.director_id, r.director_approved_at]].map(([title, id, at]) => <div key={title} className={`rounded-lg border p-4 ${at ? "border-att-present-ink/20 bg-att-present/40" : "bg-card"}`}><div className="text-xs text-muted-foreground">{title}</div><div className="mt-1 font-semibold">{nameOf(id)}</div><div className="mt-1 text-xs text-muted-foreground">{at ? `✓ ${dateTime(at)}` : title === "작성 강사" ? "보고서 작성 담당" : "승인 전"}</div></div>)}
    </div>
    {r.request_note && <div className="rounded-lg border bg-muted/20 p-4 text-sm"><div className="mb-2 font-medium">작성 요청 · {nameOf(r.requested_by)}</div><p className="whitespace-pre-wrap">{r.request_note}</p></div>}
    {r.last_comment && <p className="whitespace-pre-wrap rounded-lg border border-att-late-ink/20 bg-att-late p-4 text-sm text-att-late-ink">{r.last_comment}</p>}
    {r.status === "scheduled" && <p className="rounded-lg border bg-muted/20 p-4 text-sm">승인이 완료되었습니다. {r.effective_date}에 처리하며, 그 전까지는 기존 수강 상태를 유지합니다.</p>}
    <section className="space-y-6 rounded-xl border bg-card p-5 md:p-7" aria-label="퇴원 처리서">
      <div className="border-b pb-4"><h2 className="text-xl font-semibold">퇴원 처리서</h2><p className="mt-1 text-sm text-muted-foreground">{r.exit_kind === "withdrawal" ? "전체 퇴원" : "과목 수강종료"} · {r.subjects.map(s => labels[s] ?? "기타 과목").join(" · ")}</p></div>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {[["성명", r.snapshot.name], ["학교·학년", `${r.snapshot.school ?? ""} ${r.snapshot.grade ?? ""}`.trim() || "미기재"], ["반명", courses.map(c => c.className).join(" · ")], ["퇴원·수강종료일", r.effective_date], ["수강기간", courses.map(c => `${c.className}: ${c.startDate} ~ ${r.effective_date}`).join("\n")], ["담임", nameOf(r.teacher_id)]].map(([title, value]) => <div key={title}><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium">{value}</dd></div>)}
      </dl>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block space-y-2 text-sm"><span className="font-medium">퇴원사유</span><select className={control} value={body.reason} disabled={!capabilities.edit || pending} onChange={e => update("reason", e.target.value as ReportBody["reason"])}>{Object.entries(REASON_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {textField("attendance", "출결·현황", 2)}
      </div>
      <div>{textField("detail", "퇴원 상세사유", 6)}{capabilities.edit && <p className="mt-1 text-right text-xs text-muted-foreground">{Array.from(body.detail.trim()).length}자 · 제출 시 200자 이상</p>}</div>
      <fieldset className="space-y-4 rounded-lg border p-4"><legend className="px-2 text-sm font-semibold">상담 결과</legend><div className="grid gap-5 md:grid-cols-2">{textField("studentConsultation", "학생상담", 4)}{textField("parentConsultation", "학부모상담", 4)}</div>{capabilities.edit && <p className="text-xs text-muted-foreground">상담하지 못한 경우에는 그 사유를 적어 주세요.</p>}</fieldset>
      {textField("teacherOpinion", "담임 의견", 4)}
      <div className="grid gap-5 md:grid-cols-2"><label className="space-y-2 text-sm"><span className="font-medium">원비</span><input className={control} value={body.tuition} maxLength={200} disabled={!capabilities.edit || pending} onChange={e => update("tuition", e.target.value)} placeholder="금액·환불 등 확인한 내용" /></label>
        <label className="space-y-2 text-sm"><span className="font-medium">미납 여부</span><select className={control} value={body.arrears} disabled={!capabilities.edit || pending} onChange={e => update("arrears", e.target.value as ReportBody["arrears"])}><option value="unknown">확인 필요</option><option value="no">미납 없음</option><option value="yes">미납 있음</option></select></label></div>
      {textField("arrearsNote", "원비·미납 확인 메모", 2)}
      <div className="border-t pt-4 text-sm"><span className="text-muted-foreground">퇴원처리 · </span>{r.applied_at ? `${dateTime(r.applied_at)} 처리 완료` : "관리자 및 원장 승인 후 처리"}</div>
    </section>
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {capabilities.edit && <><Button disabled={pending} variant="outline" onClick={() => change("save")}>임시 저장</Button><Button disabled={pending} onClick={() => setDecision("submit")}>관리자에게 제출</Button></>}
      {capabilities.approve && <><Button disabled={pending} onClick={() => setDecision("approve")}>승인</Button><Button disabled={pending} variant="outline" onClick={() => setDecision("reject")}>반려</Button></>}
      {capabilities.cancel && <Button variant="ghost" disabled={pending} onClick={() => setDecision("cancel")}>요청 취소</Button>}
    </div>
    {decision && <section className="space-y-3 rounded-xl border bg-muted/20 p-5" aria-label="처리 확인">
      <p className="text-sm">{decision === "submit" ? "보고서를 제출하면 관리자 검토가 시작됩니다. 이후 수정은 반려 후 가능합니다." : decision === "approve" ? r.status === "director_pending" ? `${r.effective_date} 기준으로 ${r.exit_kind === "withdrawal" ? "전체 퇴원을" : "선택 과목의 수강종료를"} 승인합니다. 처리일이 지났다면 즉시 반영됩니다.` : "관리자 승인을 완료하고 원장에게 최종 승인을 요청합니다." : decision === "cancel" ? "작성 요청을 취소합니다. 학생의 수강 상태는 유지됩니다." : "수정이 필요한 내용을 적어 주세요. 강사가 수정 후 다시 제출합니다."}</p>
      {decision === "reject" && <textarea className={control} aria-label="반려 사유" rows={3} maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} />}
      <div className="flex gap-2"><Button disabled={pending || (decision === "reject" && !comment.trim())} onClick={() => change(decision)}>{pending ? "처리 중…" : `${REPORT_ACTION_LABEL[decision]} 확인`}</Button><Button variant="outline" disabled={pending} onClick={() => setDecision(null)}>닫기</Button></div>
    </section>}
    <section className="rounded-xl border p-5"><h2 className="mb-4 text-sm font-semibold">처리 이력</h2><ol className="space-y-3">{events.map(e => <li key={e.id} className="border-l-2 pl-3 text-sm"><div>{REPORT_ACTION_LABEL[e.action]} · {nameOf(e.actor_id)} <span className="ml-2 text-xs text-muted-foreground">{dateTime(e.created_at)}</span></div>{e.comment && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{e.comment}</p>}</li>)}</ol></section>
  </>;
}
