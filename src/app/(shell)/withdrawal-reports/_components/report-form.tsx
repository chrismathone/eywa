import type { ReactNode } from "react";
import { REASON_DETAILS, reasonDetailOf } from "@/features/withdrawals/reason-detail";
import { subjectPeriodGroups, type SubjectHistoryRow } from "@/features/withdrawal-reports/course-period";
import { PeriodCell } from "./period-cell";
import type { ReportConsultation } from "@/features/withdrawal-reports/consultation";
import { GrowingTextarea } from "./growing-textarea";
import { ConsultationLinks } from "./consultation-links";
import { REASON_LABEL } from "@/features/withdrawals/types";
import { directorIds, isDirectReport, managerIds, MIN_DETAIL_LENGTH, refundWaiting, type RefundStep, type ReportBody, type ReportEvent, type WithdrawalReport } from "@/features/withdrawal-reports/model";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { ReportSheet } from "./report-sheet";
import { TuitionDetail } from "./tuition-detail";
import { reportCourses } from "@/features/withdrawal-reports/target-courses";

const date = (value: string) => new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
export function ReportForm({ report: r, body, events, labels, nameOf, editable, pending, onChange, consultations = [], subjectHistory = [], refundCheck, managerSkipped = false, refundSteps = [] }: {
  /** 관리자 승인 생략(원장 2026-11-03 — 작성 강사가 과목 관리자) — 결재란 관리자 칸 '생략'. */
  managerSkipped?: boolean;
  /** 데스크 환불 단계(원장 2026-11-03) — 있으면 결재란에 '데스크' 칸(담당 · 환불완료일). */
  refundSteps?: RefundStep[];
  consultations?: ReportConsultation[];
  refundCheck?: ReactNode;
  subjectHistory?: SubjectHistoryRow[];
  report: WithdrawalReport; body: ReportBody; events: ReportEvent[]; labels: Record<string, string>;
  nameOf: (id: string | null) => string; editable: boolean; pending: boolean;
  onChange: <K extends keyof ReportBody>(key: K, value: ReportBody[K]) => void;
}) {
  const courses = reportCourses(r);
  const textField = (key: "detail" | "attendance" | "studentConsultation" | "parentConsultation" | "teacherOpinion" | "arrearsNote", label: string, placeholder?: string) => editable
    ? <GrowingTextarea aria-label={label} placeholder={placeholder} maxLength={key === "arrearsNote" ? 1000 : 5000} value={body[key]} disabled={pending} onChange={e => onChange(key, e.target.value)} />
    : body[key];
  const writtenAt = events.findLast(e => e.action === "save" || e.action === "submit")?.created_at;
  const approvers = (kind: "manager" | "director") => {
    const ids = kind === "manager" ? managerIds(r) : directorIds(r);
    const decisions = kind === "manager" ? r.manager_decisions : r.director_decisions;
    const legacyAt = kind === "manager" ? r.manager_approved_at : r.director_approved_at;
    return {
      role: kind === "manager" ? "관리자" : "원장",
      name: ids.map(nameOf).join("\n"),
      date: ids.length ? ids.map(id => `결재일 : ${decisions?.[id] || legacyAt ? date(decisions?.[id] ?? legacyAt!) : ""}`).join("\n") : "결재일 :",
    };
  };
  const applied = events.findLast(e => e.action === "apply");
  // 관리자 바로 처리(원장 2026-10-23) — 강사가 쓰지 않았다. 결재란은 처리한 관리자 한 칸, 담임명은 그 반의 담임(요청 당시)으로.
  const direct = isDirectReport(r);
  const homeroom = [...new Set(courses.map(c => c.teacherName).filter(Boolean))].join(", ") || "—";
  // 결재란(원장 2026-11-03): 원장 칸은 원장을 지정했던 옛 보고서에만 · 데스크 환불을 요청했으면 '데스크' 칸(담당 · 환불완료일).
  const desk = refundSteps.length ? [{ role: "데스크", name: refundSteps.map(s => s.deskName).join("\n"), date: refundSteps.map(s => `환불완료일 : ${s.completedDate ?? ""}`).join("\n") }] : [];
  const deskWaiting = refundWaiting(r, refundSteps);
  return <ReportSheet
    refundCheck={refundCheck}
    subject={r.subjects.map(s => labels[s] ?? "기타 과목").join(" · ")}
    consultationLinks={<ConsultationLinks records={consultations} selected={body.consultationIds ?? []} editable={editable} pending={pending} onChange={ids => onChange("consultationIds", ids)} />}
    signatures={direct
      ? [{ role: "바로 처리", name: nameOf(r.requested_by), date: `처리 요청일 : ${date(r.created_at)}` }, ...desk]
      : [
          { role: "담임", name: nameOf(r.teacher_id), date: `작성일 : ${writtenAt ? date(writtenAt) : ""}` },
          managerSkipped ? { role: "관리자", name: "생략", date: "작성 강사가 과목 관리자" } : approvers("manager"),
          ...(directorIds(r).length ? [approvers("director")] : []),
          ...desk,
        ]}
    fields={{
      name: r.snapshot.name,
      grade: schoolGradeLabel(r.snapshot.school, r.snapshot.grade),
      className: courses.map(c => c.className).join("\n"),
      exitDate: r.effective_date,
      period: <PeriodCell groups={subjectPeriodGroups(courses, subjectHistory, r.effective_date, s => labels[s] ?? "기타 과목")} />,
      teacher: direct ? homeroom : nameOf(r.teacher_id),
      attendance: textField("attendance", "최근 3개월 출결 현황"),
      reason: editable ? <div className="flex flex-wrap gap-2"><select aria-label="퇴원사유" style={{ flex: "1 1 180px" }} value={body.reason} disabled={pending} onChange={e => { onChange("reason", e.target.value as ReportBody["reason"]); onChange("reasonDetail", ""); }}>{Object.entries(REASON_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{REASON_DETAILS[body.reason].length > 0 && <select aria-label="세부 퇴원사유" style={{ flex: "1 1 240px" }} value={body.reasonDetail ?? ""} disabled={pending} onChange={e => onChange("reasonDetail", e.target.value)}><option value="">세부 사유 선택</option>{REASON_DETAILS[body.reason].map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select>}</div> : [REASON_LABEL[body.reason], reasonDetailOf(body.reasonDetail)?.label].filter(Boolean).join(" · "),
      detail: <>{textField("detail", "퇴원 상세사유", `${MIN_DETAIL_LENGTH}자 이상 작성해 주세요`)}{editable && <small>{Array.from(body.detail.trim()).length} / {MIN_DETAIL_LENGTH}자</small>}</>,
      studentConsultation: textField("studentConsultation", "학생상담"),
      parentConsultation: textField("parentConsultation", "학부모상담"),
      teacherOpinion: textField("teacherOpinion", "담임 의견"),
      tuition: <TuitionDetail text={body.tuition || "수납 기록 확인 필요"} />,
      arrears: <><span>{ { unknown: "청구 기록 확인 필요", no: "미납 없음", yes: "미납 있음" }[body.arrears]}</span>{body.arrearsNote && <div className="whitespace-pre-line">{body.arrearsNote}</div>}</>,
      processing: r.applied_at ? `${nameOf(applied?.actor_id ?? null)} · ${date(r.applied_at)} 처리 완료${direct ? " (관리자 바로 처리)" : ""}` : `${direct ? "관리자 바로 처리" : "요청"}: ${nameOf(r.requested_by)} · ${r.status === "canceled" ? "요청 취소" : direct ? `${r.effective_date} 처리 예약${deskWaiting ? " · 데스크 환불 완료 후" : ""}` : deskWaiting ? "승인·데스크 환불 완료 후 자동 처리" : "승인 완료 후 자동 처리"}`,
    }}
  />;
}
