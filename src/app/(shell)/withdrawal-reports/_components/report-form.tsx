import { REASON_LABEL } from "@/features/withdrawals/types";
import { directorIds, managerIds, type ReportBody, type ReportEvent, type WithdrawalReport } from "@/features/withdrawal-reports/model";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { ReportSheet } from "./report-sheet";

const date = (value: string) => new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
export function ReportForm({ report: r, body, events, labels, nameOf, editable, pending, onChange }: {
  report: WithdrawalReport; body: ReportBody; events: ReportEvent[]; labels: Record<string, string>;
  nameOf: (id: string | null) => string; editable: boolean; pending: boolean;
  onChange: <K extends keyof ReportBody>(key: K, value: ReportBody[K]) => void;
}) {
  const courses = r.snapshot.courses.filter(c => r.subjects.includes(c.subject) && (!r.group_id || c.teacherId === r.teacher_id));
  const textField = (key: "detail" | "attendance" | "studentConsultation" | "parentConsultation" | "teacherOpinion" | "arrearsNote", label: string, rows: number) => editable
    ? <textarea aria-label={label} rows={rows} maxLength={key === "arrearsNote" ? 1000 : 5000} value={body[key]} disabled={pending} onChange={e => onChange(key, e.target.value)} />
    : body[key];
  const writtenAt = events.findLast(e => e.action === "save" || e.action === "submit")?.created_at;
  const approvers = (kind: "manager" | "director") => {
    const ids = kind === "manager" ? managerIds(r) : directorIds(r);
    const decisions = kind === "manager" ? r.manager_decisions : r.director_decisions;
    const legacyAt = kind === "manager" ? r.manager_approved_at : r.director_approved_at;
    return {
      role: kind === "manager" ? "팀장" : "원장",
      name: ids.map(nameOf).join("\n"),
      date: ids.length ? ids.map(id => `결재일 : ${decisions?.[id] || legacyAt ? date(decisions?.[id] ?? legacyAt!) : ""}`).join("\n") : "결재일 :",
    };
  };
  const applied = events.findLast(e => e.action === "apply");
  return <ReportSheet
    subject={r.subjects.map(s => labels[s] ?? "기타 과목").join(" · ")}
    signatures={[
      { role: "담임", name: nameOf(r.teacher_id), date: `작성일 : ${writtenAt ? date(writtenAt) : ""}` },
      approvers("manager"), approvers("director"),
    ]}
    fields={{
      name: r.snapshot.name,
      grade: schoolGradeLabel(r.snapshot.school, r.snapshot.grade),
      className: courses.map(c => c.className).join("\n"),
      exitDate: r.effective_date,
      period: courses.map(c => `${courses.length > 1 ? `${c.className}: ` : ""}${c.startDate} ~ ${r.effective_date}`).join("\n"),
      teacher: nameOf(r.teacher_id),
      attendance: textField("attendance", "출결·현황", 2),
      reason: editable ? <select aria-label="퇴원사유" value={body.reason} disabled={pending} onChange={e => onChange("reason", e.target.value as ReportBody["reason"])}>{Object.entries(REASON_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : REASON_LABEL[body.reason],
      detail: <>{textField("detail", "퇴원 상세사유", 7)}{editable && <small>{Array.from(body.detail.trim()).length}자 · 제출 시 200자 이상</small>}</>,
      studentConsultation: textField("studentConsultation", "학생상담", 8),
      parentConsultation: textField("parentConsultation", "학부모상담", 8),
      teacherOpinion: textField("teacherOpinion", "담임 의견", 7),
      tuition: editable ? <input aria-label="원비" value={body.tuition} maxLength={200} disabled={pending} onChange={e => onChange("tuition", e.target.value)} /> : body.tuition,
      arrears: <>{editable ? <select aria-label="미납 여부" value={body.arrears} disabled={pending} onChange={e => onChange("arrears", e.target.value as ReportBody["arrears"])}><option value="unknown">확인 필요</option><option value="no">미납 없음</option><option value="yes">미납 있음</option></select> : { unknown: "확인 필요", no: "미납 없음", yes: "미납 있음" }[body.arrears]}{(editable || body.arrearsNote) && textField("arrearsNote", "원비·미납 확인 메모", 2)}</>,
      processing: r.applied_at ? `${nameOf(applied?.actor_id ?? null)} · ${date(r.applied_at)} 처리 완료` : `요청: ${nameOf(r.requested_by)} · ${r.status === "canceled" ? "요청 취소" : "승인 완료 후 자동 처리"}`,
    }}
  />;
}
