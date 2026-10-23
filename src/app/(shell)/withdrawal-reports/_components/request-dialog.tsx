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
import { requestManagers } from "@/features/withdrawal-reports/request-options";

const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const toggle = (items: string[], id: string) => items.includes(id) ? items.filter(x => x !== id) : [...items, id];
export function RequestDialog({ staff, students, labels, scope }: {
  staff: StaffOption[]; students: StudentOption[]; labels: Record<string, string>; scope: readonly string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [enrollmentIds, setEnrollments] = useState<string[]>([]);
  const [teacherIds, setTeachers] = useState<string[]>([]);
  const [managerIds, setManagers] = useState<string[]>([]);
  const [directorIds, setDirectors] = useState<string[]>([]);
  const [date, setDate] = useState(kstToday());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inFrame = useInFrame();
  const student = students.find(s => s.id === studentId);
  const courses = student?.courses.filter(c => enrollmentIds.includes(c.id)) ?? [];
  const subjects = [...new Set(courses.map(c => c.subject))];
  const eligible = staff.filter(s => courses.some(c => c.teacherId === s.id));
  const managers = requestManagers(staff, courses, subjects, teacherIds, directorIds);
  const selectedManagers = managerIds.filter(id => managers.some(u => u.id === id));
  const directors = staff.filter(s => s.role === "master" && !teacherIds.includes(s.id) && !selectedManagers.includes(s.id));
  const kind = automaticExitKind(student?.courses ?? [], enrollmentIds);
  function chooseCourses(s: StudentOption | undefined, next: string[]) {
    setEnrollments(next);
    const authors = eligibleAuthors(s, next);
    const selected = s?.courses.filter(c => next.includes(c.id)) ?? [];
    setTeachers(authors);
    setManagers(requestManagers(staff, selected, selected.map(c => c.subject), authors).map(u => u.id));
    setDirectors([]); setError("");
  }
  function eligibleAuthors(s: StudentOption | undefined, selected: string[]) {
    return staff.filter(u => s?.courses.some(c => selected.includes(c.id) && c.teacherId === u.id)).map(u => u.id);
  }
  function chooseTeachers(next: string[]) {
    const principals = directorIds.filter(id => !next.includes(id));
    const candidates = requestManagers(staff, courses, subjects, next, principals);
    // Keep valid manual choices; newly included subjects receive their default managers.
    setManagers(candidates.filter(u => managerIds.includes(u.id) || !managers.some(previous => previous.id === u.id)).map(u => u.id));
    setTeachers(next); setDirectors(principals); setError("");
  }
  function submit() {
    setError("");
    startTransition(async () => {
      try {
        const res = await requestWithdrawalReport({ studentId, teacherIds, managerIds: selectedManagers, directorIds, subjects, enrollmentIds, effectiveDate: date, note });
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
      <div className="border-b px-5 py-4"><DialogTitle>강사에게 보고서 작성 요청</DialogTitle><DialogDescription className="mt-1">종료할 반과 작성 강사를 선택합니다. 지정한 승인자가 모두 승인하면 선택한 반을 종료합니다.</DialogDescription></div>
      <div className={`min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5 ${pending ? "pointer-events-none opacity-60" : ""}`} aria-busy={pending}>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-1 text-sm"><p>대상 학생</p><SearchableSelect portal options={students.map(s => ({ value: s.id, label: s.name, hint: `${s.school ?? ""} ${s.grade ?? ""}`.trim() }))} value={studentId} ariaLabel="대상 학생" placeholder="학생 검색·선택" searchPlaceholder="이름·학교로 검색" onValueChange={id => { if (pending) return; const s = students.find(x => x.id === id); setStudentId(id); chooseCourses(s, s?.courses.filter(c => !scope || scope.includes(c.subject)).map(c => c.id) ?? []); }} /></div>
          <label className="space-y-1 text-sm">퇴원·수강종료일<input className={control} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        {student && <fieldset className="rounded-lg border px-3 py-2"><legend className="px-1 text-sm">종료할 반</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{student.courses.map(c => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enrollmentIds.includes(c.id)} disabled={!!scope && !scope.includes(c.subject)} onChange={() => chooseCourses(student, toggle(enrollmentIds, c.id))} />{c.className} · {labels[c.subject] ?? c.subject} · {c.teacherName ?? "담당자 미지정"}</label>)}</div><p className="mt-2 text-xs text-muted-foreground">선택한 반의 수강만 종료합니다. 모든 수강을 선택하면 전체 퇴원으로 처리합니다.</p></fieldset>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 text-sm"><p>작성 강사</p><SearchableSelect portal options={staffOptions(eligible)} value="" multiValues={teacherIds} ariaLabel="작성 강사" placeholder="담당 강사 선택" onValueChange={id => { if (!pending && eligible.some(u => u.id === id)) chooseTeachers(toggle(teacherIds, id)); }} /></div>
          <div className="space-y-1 text-sm"><p>관리자 승인</p><SearchableSelect portal options={staffOptions(managers)} value="" multiValues={selectedManagers} ariaLabel="관리자 승인" placeholder={teacherIds.length ? "해당 과목 관리자 선택" : "담당 강사를 먼저 선택"} onValueChange={id => { if (!pending && managers.some(u => u.id === id)) setManagers(toggle(selectedManagers, id)); }} /></div>
          <div className="space-y-1 text-sm"><p>원장 승인 <span className="text-muted-foreground">(선택)</span></p><SearchableSelect portal options={staffOptions(directors)} value="" multiValues={directorIds} ariaLabel="원장 승인" placeholder="선택하지 않음" onValueChange={id => { if (!pending) setDirectors(v => toggle(v, id)); }} /></div>
        </div>
        <p className="text-xs text-muted-foreground">{teacherIds.length === 1 ? "선택한 강사 한 명이 모든 선택 반을 묶어 보고서 한 건을 작성합니다. 다른 담임의 보고서는 요청하지 않습니다." : "선택한 강사마다 담당 반의 보고서를 요청합니다. 작성자를 선택하지 않은 반도 종료 대상에 포함됩니다."}</p>
        <p className="text-xs text-muted-foreground">{directorIds.length ? "관리자 전원 승인 후, 선택한 원장 전원이 승인합니다." : "원장을 선택하지 않으면 지정한 관리자들이 최종 승인합니다."}</p>
        {teacherIds.length > 0 && managers.length === 0 && <p className="text-sm text-att-late-ink">선택할 수 있는 해당 과목 관리자가 없습니다. 담당 과목과 승인자 선택을 확인해 주세요.</p>}
        <label className="block space-y-1 text-sm">강사에게 전달할 내용<textarea className={control} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="확인할 내용이나 작성 요청 사유" /></label>
        {courses.length > 0 && eligible.length === 0 && <p className="text-sm text-att-late-ink">선택한 반의 작성 강사를 찾지 못했습니다. 반의 담임 배정을 확인해 주세요.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3"><p className="text-xs text-muted-foreground">{student && courses.length ? `${kind === "withdrawal" ? "전체 퇴원" : "반 수강종료"} · ${courses.length}개 반 · 보고서 ${teacherIds.length}건` : "학생과 종료할 반을 선택해 주세요."}</p><div className="flex gap-2"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>닫기</Button><Button disabled={pending || !studentId || !courses.length || !teacherIds.length || !selectedManagers.length} onClick={submit}>{pending ? "요청 중…" : "강사에게 작성 요청"}</Button></div></div>
    </DialogContent>
  </Dialog>;
}
