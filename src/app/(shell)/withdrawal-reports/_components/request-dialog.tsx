"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { kstToday } from "@/lib/date-kst";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { withEmbed } from "@/components/workspace/embed-context";
import { requestWithdrawalReport } from "@/features/withdrawal-reports/server/actions";
import { automaticExitKind, type StaffOption, type StudentOption } from "@/features/withdrawal-reports/model";

const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const toggle = (items: string[], id: string) => items.includes(id) ? items.filter(x => x !== id) : [...items, id];
export function RequestDialog({ staff, students, labels, scope }: {
  staff: StaffOption[]; students: StudentOption[]; labels: Record<string, string>; scope: readonly string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [teacherIds, setTeachers] = useState<string[]>([]);
  const [managerIds, setManagers] = useState<string[]>([]);
  const [directorIds, setDirectors] = useState<string[]>([]);
  const [date, setDate] = useState(kstToday());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inFrame = useInFrame();
  const student = students.find(s => s.id === studentId);
  const eligible = staff.filter(s => student?.courses.some(c => c.teacherId === s.id && subjects.includes(c.subject)));
  const managers = staff.filter(s => ["admin", "manager", "master"].includes(s.role) && !teacherIds.includes(s.id) && !directorIds.includes(s.id));
  const directors = staff.filter(s => s.role === "master" && !teacherIds.includes(s.id) && !managerIds.includes(s.id));
  const kind = automaticExitKind(student?.courses ?? [], subjects);
  const missingTeacher = student?.courses.some(c => subjects.includes(c.subject) && (!c.teacherId || !teacherIds.includes(c.teacherId)));
  function chooseSubjects(s: StudentOption | undefined, next: string[]) {
    setSubjects(next);
    const authors = eligibleAuthors(s, next);
    setTeachers(authors);
    setManagers(staff.filter(u => ["admin", "manager", "master"].includes(u.role) && !authors.includes(u.id) && (u.approvalSubjects ?? u.subjects).some(x => next.includes(x))).map(u => u.id));
    setDirectors([]); setError("");
  }
  function eligibleAuthors(s: StudentOption | undefined, selected: string[]) {
    return staff.filter(u => s?.courses.some(c => selected.includes(c.subject) && c.teacherId === u.id)).map(u => u.id);
  }
  function submit() {
    setError("");
    startTransition(async () => {
      try {
        const res = await requestWithdrawalReport({ studentId, teacherIds, managerIds, directorIds, subjects, effectiveDate: date, note });
        if ("error" in res) { setError(res.error); return; }
        toast.success(`${teacherIds.length}명의 강사에게 보고서 작성을 요청했습니다.`);
        window.location.assign(inFrame ? withEmbed("/withdrawal-reports") : "/withdrawal-reports");
      } catch { setError("요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    });
  }
  const staffOptions = (people: StaffOption[]) => people.map(u => ({ value: u.id, label: u.name, hint: (u.approvalSubjects ?? u.subjects).map(s => labels[s] ?? s).join("·") }));
  return <Dialog open={open} onOpenChange={v => { if (!pending) setOpen(v); }}>
    <DialogTrigger render={<Button />}>+ 보고서 작성 요청</DialogTrigger>
    <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" showCloseButton={false}>
      <div className="border-b px-5 py-4"><DialogTitle>강사에게 보고서 작성 요청</DialogTitle><DialogDescription className="mt-1">강사별로 보고서 한 건을 작성합니다. 지정한 승인자가 모두 승인하면 처리합니다.</DialogDescription></div>
      <div className={`min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5 ${pending ? "pointer-events-none opacity-60" : ""}`} aria-busy={pending}>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-1 text-sm"><p>대상 학생</p><SearchableSelect portal options={students.map(s => ({ value: s.id, label: s.name, hint: `${s.school ?? ""} ${s.grade ?? ""}`.trim() }))} value={studentId} ariaLabel="대상 학생" placeholder="학생 검색·선택" searchPlaceholder="이름·학교로 검색" onValueChange={id => { if (pending) return; const s = students.find(x => x.id === id); setStudentId(id); chooseSubjects(s, [...new Set(s?.courses.map(c => c.subject).filter(x => !scope || scope.includes(x)) ?? [])]); }} /></div>
          <label className="space-y-1 text-sm">퇴원·수강종료일<input className={control} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        {student && <fieldset className="rounded-lg border px-3 py-2"><legend className="px-1 text-sm">종료할 과목</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{[...new Set(student.courses.map(c => c.subject))].map(s => <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subjects.includes(s)} disabled={!!scope && !scope.includes(s)} onChange={() => chooseSubjects(student, toggle(subjects, s))} />{labels[s] ?? s}</label>)}</div><p className="mt-2 text-xs text-muted-foreground">{student.courses.filter(c => subjects.includes(c.subject)).map(c => c.className).join(" · ")}</p></fieldset>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 text-sm"><p>작성 강사</p><SearchableSelect portal options={staffOptions(eligible)} value="" multiValues={teacherIds} ariaLabel="작성 강사" placeholder="담당 강사 선택" onValueChange={id => { if (pending) return; const next = toggle(teacherIds, id); setTeachers(next); setManagers(v => v.filter(x => !next.includes(x))); setDirectors(v => v.filter(x => !next.includes(x))); }} /></div>
          <div className="space-y-1 text-sm"><p>관리자 승인</p><SearchableSelect portal options={staffOptions(managers)} value="" multiValues={managerIds} ariaLabel="관리자 승인" placeholder="관리자 선택" onValueChange={id => { if (!pending) setManagers(v => toggle(v, id)); }} /></div>
          <div className="space-y-1 text-sm"><p>원장 승인 <span className="text-muted-foreground">(선택)</span></p><SearchableSelect portal options={staffOptions(directors)} value="" multiValues={directorIds} ariaLabel="원장 승인" placeholder="선택하지 않음" onValueChange={id => { if (!pending) setDirectors(v => toggle(v, id)); }} /></div>
        </div>
        <p className="text-xs text-muted-foreground">{directorIds.length ? "관리자 전원 승인 후, 선택한 원장 전원이 승인합니다." : "원장을 선택하지 않으면 지정한 관리자들이 최종 승인합니다."}</p>
        <label className="block space-y-1 text-sm">강사에게 전달할 내용<textarea className={control} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="확인할 내용이나 작성 요청 사유" /></label>
        {missingTeacher && <p className="text-sm text-att-late-ink">종료할 수강의 담당 강사를 모두 선택해 주세요. 담당자가 없는 반은 먼저 강사를 배정해 주세요.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3"><p className="text-xs text-muted-foreground">{student && subjects.length ? `${kind === "withdrawal" ? "전체 퇴원" : "과목 수강종료"} · 강사별 ${teacherIds.length}건` : "학생과 종료 과목을 선택해 주세요."}</p><div className="flex gap-2"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>닫기</Button><Button disabled={pending || !studentId || !subjects.length || !teacherIds.length || !managerIds.length || missingTeacher} onClick={submit}>{pending ? "요청 중…" : "강사에게 작성 요청"}</Button></div></div>
    </DialogContent>
  </Dialog>;
}
