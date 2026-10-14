"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { kstToday } from "@/lib/date-kst";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { withEmbed } from "@/components/workspace/embed-context";
import { requestWithdrawalReport } from "@/features/withdrawal-reports/server/actions";
import { REPORT_STATUS, type ReportListRow, type StaffOption, type StudentOption } from "@/features/withdrawal-reports/model";

const control = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary";
export function ReportList({ reports, completedLimited, staff, students, labels, userId, canRequest, scope }: {
  reports: ReportListRow[]; completedLimited: boolean; staff: StaffOption[]; students: StudentOption[]; labels: Record<string, string>; userId: string; canRequest: boolean; scope: readonly string[] | null;
}) {
  const [showRequest, setShowRequest] = useState(false);
  const inFrame = useInFrame();
  const [studentId, setStudentId] = useState("");
  const [search, setSearch] = useState("");
  const [exitKind, setExitKind] = useState<"withdrawal" | "subject_end">("subject_end");
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [directorId, setDirectorId] = useState("");
  const [date, setDate] = useState(kstToday());
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("pending");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const student = students.find(s => s.id === studentId);
  const allSubjects = [...new Set(student?.courses.map(c => c.subject) ?? [])];
  const subjects = exitKind === "withdrawal" ? allSubjects : selectedSubjects;
  const teachers = staff.filter(s => student?.courses.some(c => c.teacherId === s.id && subjects.includes(c.subject)));
  const staffName = (id: string) => staff.find(s => s.id === id)?.name ?? "이전 담당자";
  const filtered = reports.filter(r => filter === "all" || (filter === "done" ? ["completed", "canceled"].includes(r.status) : !["completed", "canceled"].includes(r.status)));
  function submit() {
    setError("");
    startTransition(async () => {
      try {
        const res = await requestWithdrawalReport({ studentId, teacherId, managerId, directorId, exitKind, subjects, effectiveDate: date, note });
        if ("error" in res) { setError(res.error); return; }
        toast.success("강사에게 보고서 작성을 요청했습니다.");
        const destination = `/withdrawal-reports/${res.id}`;
        window.location.assign(inFrame ? withEmbed(destination) : destination);
      } catch { setError("요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    });
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-1 rounded-lg border bg-muted/20 p-1" aria-label="보고서 상태 필터">
        {[["pending", "진행 중"], ["done", "완료·취소"], ["all", "전체"]].map(([key, label]) => <Button key={key} size="sm" variant={filter === key ? "default" : "ghost"} onClick={() => setFilter(key)} aria-pressed={filter === key}>{label}</Button>)}
      </div>
      {canRequest && <Button onClick={() => setShowRequest(v => !v)} aria-expanded={showRequest}>{showRequest ? "요청 입력 닫기" : "+ 보고서 작성 요청"}</Button>}
    </div>
    {showRequest && <section className="space-y-5 rounded-xl border bg-card p-5" aria-label="보고서 작성 요청">
      <div><h2 className="font-semibold">강사에게 보고서 작성 요청</h2><p className="mt-1 text-sm text-muted-foreground">요청만으로 수강이 종료되지는 않습니다. 작성자와 두 승인자는 서로 다른 사람을 지정해 주세요.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm">학생 검색<input className={control} value={search} onChange={e => setSearch(e.target.value)} placeholder="이름·학교로 검색" /></label>
        <label className="space-y-1.5 text-sm">대상 학생<select className={control} value={studentId} onChange={e => { setStudentId(e.target.value); setSelectedSubjects([]); setTeacherId(""); }}><option value="">학생 선택</option>{students.filter(s => `${s.name} ${s.school ?? ""}`.includes(search.trim()) || s.id === studentId).map(s => <option key={s.id} value={s.id}>{s.name} · {s.school} {s.grade}</option>)}</select></label>
        <label className="space-y-1.5 text-sm">처리 구분<select className={control} value={exitKind} onChange={e => { setExitKind(e.target.value as typeof exitKind); setTeacherId(""); }}><option value="subject_end">과목 수강종료</option><option value="withdrawal" disabled={!!scope && allSubjects.some(s => !scope.includes(s))}>전체 퇴원</option></select></label>
        <label className="space-y-1.5 text-sm">퇴원·수강종료일<input className={control} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
      {student && <fieldset className="rounded-lg border bg-muted/20 p-4"><legend className="px-2 text-sm font-medium">종료할 과목</legend>
        <div className="flex flex-wrap gap-5">{allSubjects.map(s => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subjects.includes(s)} disabled={exitKind === "withdrawal" || (!!scope && !scope.includes(s))} onChange={e => { setSelectedSubjects(v => e.target.checked ? [...v, s] : v.filter(x => x !== s)); setTeacherId(""); }} />{labels[s] ?? "기타 과목"}</label>)}</div>
        <p className="mt-3 text-xs text-muted-foreground">{student.courses.filter(c => subjects.includes(c.subject)).map(c => c.className).join(" · ") || "과목을 선택해 주세요."}</p>
        {exitKind === "subject_end" && <p className="mt-2 text-xs text-muted-foreground">과목 수강종료는 학생의 재원 상태를 유지합니다. 학원 전체를 그만두는 경우에는 전체 퇴원을 선택해 주세요.</p>}
      </fieldset>}
      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1.5 text-sm">작성 강사<select className={control} value={teacherId} onChange={e => { setTeacherId(e.target.value); setManagerId(""); setDirectorId(""); }}><option value="">담당 강사 선택</option>{teachers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="space-y-1.5 text-sm">관리자 승인<select className={control} value={managerId} onChange={e => setManagerId(e.target.value)}><option value="">관리자 선택</option>{staff.filter(s => ["admin", "manager", "master"].includes(s.role) && s.id !== teacherId && s.id !== directorId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="space-y-1.5 text-sm">원장 승인<select className={control} value={directorId} onChange={e => setDirectorId(e.target.value)}><option value="">원장 선택</option>{staff.filter(s => s.role === "master" && s.id !== teacherId && s.id !== managerId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <label className="block space-y-1.5 text-sm">강사에게 전달할 내용<textarea className={control} rows={3} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="확인할 내용이나 작성 요청 사유" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending || !studentId || !subjects.length || !teacherId || !managerId || !directorId} onClick={submit}>{pending ? "요청 중…" : "강사에게 작성 요청"}</Button>
    </section>}
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm"><thead className="bg-muted/50"><tr>{["학생·처리 구분", "퇴원·종료일", "작성 강사", "승인 진행", "상태"].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{filtered.map(r => <tr key={r.id} className="border-t hover:bg-muted/20"><td className="px-4 py-4"><Link className="font-semibold text-primary underline-offset-4 hover:underline" href={`/withdrawal-reports/${r.id}`}>{r.snapshot.name}</Link><div className="mt-1 text-xs text-muted-foreground">{r.exit_kind === "withdrawal" ? "전체 퇴원" : "수강종료"} · {r.subjects.map(s => labels[s] ?? "기타 과목").join("·")}</div></td>
          <td className="whitespace-nowrap px-4 py-4">{r.effective_date}</td><td className="whitespace-nowrap px-4 py-4">{staffName(r.teacher_id)}</td>
          <td className="px-4 py-4 text-xs"><div>{r.manager_approved_at ? "✓" : "○"} 관리자 {staffName(r.manager_id)}</div><div className="mt-1">{r.director_approved_at ? "✓" : "○"} 원장 {staffName(r.director_id)}</div></td>
          <td className="px-4 py-4"><span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${r.status === "completed" ? "bg-att-present text-att-present-ink" : r.status === "revision" || r.status === "blocked" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"}`}>{REPORT_STATUS[r.status]}</span>{(r.status === "requested" || r.status === "revision") && r.teacher_id === userId && <div className="mt-1 text-xs text-primary">내 작성 대기</div>}</td></tr>)}</tbody>
      </table>
      {!filtered.length && <p className="p-10 text-center text-sm text-muted-foreground">해당하는 퇴원보고서가 없습니다.</p>}
    </div>
    {completedLimited && <p className="text-xs text-muted-foreground">진행 중인 요청은 모두 표시하며, 완료·취소 건은 최근 200건까지 표시합니다.</p>}
  </>;
}
