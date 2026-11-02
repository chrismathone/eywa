"use client";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { kstToday } from "@/lib/date-kst";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { withEmbed } from "@/components/workspace/embed-context";
import { processWithdrawalDirectly, requestWithdrawalReport } from "@/features/withdrawal-reports/server/actions";
import { automaticExitKind, type StaffOption, type StudentOption } from "@/features/withdrawal-reports/model";
import { bundledGroupLabels, defaultApproverIds, reportAuthorIds, requestApprovers, requestManagers, selfManagedSubjects, toggleCourseGroup } from "@/features/withdrawal-reports/request-options";
import { DirectFields } from "./direct-fields";

const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const toggle = (items: string[], id: string) => items.includes(id) ? items.filter(x => x !== id) : [...items, id];
type Mode = "request" | "direct";
/** 고른 반 → 작성 강사(그 반의 담임)와 기본 관리자 — 학생을 고를 때와 창을 그 학생으로 열 때 같은 계산. */
function selectionFor(staff: StaffOption[], s: StudentOption | undefined, next: string[]) {
  const selected = s?.courses.filter(c => next.includes(c.id)) ?? [];
  const authors = reportAuthorIds(selected.filter(c => staff.some(u => u.id === c.teacherId)));
  const teacherIds = staff.filter(u => authors.includes(u.id)).map(u => u.id);
  return { enrollmentIds: next, teacherIds, managerIds: defaultApproverIds(requestApprovers(staff, selected, selected.map(c => c.subject), teacherIds)) };
}
/**
 * 퇴원보고서 시작 창 — 강사에게 작성 요청 / **강사 작성 없이 바로 처리**(원장 2026-10-23, `directReady` = 0453a 적용 DB에서만).
 * 원생 화면의 '퇴원보고서'가 `?request=<학생>`으로 이 창을 그 학생을 고른 채 연다(퇴원은 퇴원보고서로만).
 * 다니는 반이 없는 원생은 담임이 없어 작성 요청을 못 하니 바로 처리(퇴원만)로 연다.
 */
export function RequestDialog({ staff, students, labels, scope, initialStudentId = null, directReady = false }: {
  staff: StaffOption[]; students: StudentOption[]; labels: Record<string, string>; scope: readonly string[] | null;
  initialStudentId?: string | null; directReady?: boolean;
}) {
  const initial = initialStudentId ? students.find(s => s.id === initialStudentId && (s.courses.length > 0 || directReady)) : undefined;
  const initialPick = selectionFor(staff, initial, initial?.courses.filter(c => !scope || scope.includes(c.subject)).map(c => c.id) ?? []);
  const [open, setOpen] = useState(!!initialStudentId);
  const [mode, setMode] = useState<Mode>(initial && initial.courses.length === 0 ? "direct" : "request");
  const [studentId, setStudentId] = useState(initial?.id ?? "");
  const [enrollmentIds, setEnrollments] = useState<string[]>(initialPick.enrollmentIds);
  const [teacherIds, setTeachers] = useState<string[]>(initialPick.teacherIds);
  // 작성 강사는 고르지 않는다 — 과목마다 담당 선생님(`reportAuthorIds` · 메인반 담임)으로 고정(원장 2026-10-30 *"무조건 담당 선생님만 작성하고 나머지는 해당 보고서에서 반이 다 딸려가서 하나로"*).
  const authorNames = staff.filter(u => teacherIds.includes(u.id)).map(u => u.name);
  const [managerIds, setManagers] = useState<string[]>(initialPick.managerIds);
  const [directorIds, setDirectors] = useState<string[]>([]);
  const [date, setDate] = useState(kstToday());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const reasonForm = useRef<HTMLFormElement>(null);
  const inFrame = useInFrame();
  const direct = mode === "direct";
  const choices = direct ? students : students.filter(s => s.courses.length > 0);
  const student = choices.find(s => s.id === studentId);
  const courses = student?.courses.filter(c => enrollmentIds.includes(c.id)) ?? [];
  const subjects = [...new Set(courses.map(c => c.subject))];
  const eligible = staff.filter(s => courses.some(c => c.teacherId === s.id));
  const managers = requestManagers(staff, courses, subjects, teacherIds, directorIds);
  const selectedManagers = managerIds.filter(id => managers.some(u => u.id === id));
  const directors = staff.filter(s => s.role === "master" && !teacherIds.includes(s.id) && !selectedManagers.includes(s.id));
  const noCourses = !!student && student.courses.length === 0;
  const bundled = bundledGroupLabels(courses, labels);
  const skipManagers = selfManagedSubjects(staff, courses, teacherIds).length > 0;
  const needsDirector = requestApprovers(staff, courses, subjects, teacherIds, directorIds).needsDirector;
  const directorOnly = skipManagers && !needsDirector;
  // 진행 중인 다른 과목 보고서의 반도 남은 반으로 센다 — 그 보고서까지 끝나 남은 반이 없으면 DB가 그때 퇴원으로 마무리한다(s2_0014).
  const busy = student?.busyCourses ?? [];
  const kind = noCourses ? "withdrawal" : automaticExitKind([...(student?.courses ?? []), ...busy], enrollmentIds);
  function chooseCourses(s: StudentOption | undefined, next: string[]) {
    const pick = selectionFor(staff, s, next);
    setEnrollments(pick.enrollmentIds); setTeachers(pick.teacherIds); setManagers(pick.managerIds);
    setDirectors([]); setError("");
  }
  function chooseMode(next: Mode) {
    if (pending) return;
    setMode(next); setError("");
    if (next === "request" && noCourses) { setStudentId(""); chooseCourses(undefined, []); }
  }
  const go = (path: string) => window.location.assign(inFrame ? withEmbed(path) : path);
  function submit() {
    setError("");
    startTransition(async () => {
      try {
        const res = await requestWithdrawalReport({ studentId, teacherIds, managerIds: selectedManagers, directorIds, subjects, enrollmentIds, effectiveDate: date, note });
        if ("error" in res) { setError(res.error); return; }
        toast.success(`${teacherIds.length}명의 강사에게 보고서 작성을 요청했습니다.`);
        go("/withdrawal-reports");
      } catch { setError("요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    });
  }
  function submitDirect() {
    const form = reasonForm.current;
    // 사유 칸(대분류 필수 · '기타'면 메모 필수)을 먼저 — 비었으면 브라우저가 그 칸을 짚어 준다. 서버도 같은 규칙으로 다시 본다.
    if (!form || !form.reportValidity()) return;
    const fd = new FormData(form);
    setError("");
    startTransition(async () => {
      try {
        const res = await processWithdrawalDirectly({ studentId, enrollmentIds: noCourses ? [] : enrollmentIds, effectiveDate: date,
          reason: String(fd.get("reason") ?? ""), reasonDetail: String(fd.get("detail") ?? ""), memo: String(fd.get("memo") ?? "") });
        if ("error" in res) { setError(res.error); return; }
        toast.success(date > kstToday() ? `${date}에 처리하도록 예약했습니다.` : "바로 처리했습니다.");
        go(`/withdrawal-reports/${res.id}`);
      } catch { setError("처리 결과를 확인하지 못했습니다. 목록에서 상태를 확인해 주세요."); }
    });
  }
  const staffOptions = (people: StaffOption[]) => people.map(u => ({ value: u.id, label: u.name, hint: (u.approvalSubjects ?? u.subjects).map(s => labels[s] ?? s).join("·") }));
  const ready = !!studentId && (noCourses ? direct : courses.length > 0);
  const summary = !student ? "학생과 종료할 반을 선택해 주세요." : noCourses ? "퇴원 · 다니는 반 없음 · 강사 작성 없음"
    : courses.length ? `${kind === "withdrawal" ? "퇴원" : "반 수강종료"} · ${courses.length}개 반 · ${direct ? "강사 작성 없음" : `보고서 ${teacherIds.length}건`}` : "종료할 반을 선택해 주세요.";
  return <Dialog open={open} onOpenChange={v => { if (!pending) setOpen(v); }}>
    <DialogTrigger render={<Button />}>+ 보고서 작성 요청</DialogTrigger>
    <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" showCloseButton={false}>
      <div className="border-b px-5 py-4"><DialogTitle>{direct ? "강사 작성 없이 바로 처리" : "강사에게 보고서 작성 요청"}</DialogTitle><DialogDescription className="mt-1">{direct ? "종료할 반과 사유를 정해 바로 퇴원·수강종료합니다. 처리 내용은 퇴원보고서 기록으로 남습니다." : "종료할 반을 선택하면 과목마다 담당 선생님에게 작성을 요청합니다. 지정한 승인자가 모두 승인하면 선택한 반을 종료합니다."}</DialogDescription></div>
      <div className={`min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5 ${pending ? "pointer-events-none opacity-60" : ""}`} aria-busy={pending}>
        {directReady && <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="처리 방식">
          <label className="flex items-center gap-2"><input type="radio" name="report-mode" checked={!direct} onChange={() => chooseMode("request")} />강사에게 작성 요청</label>
          <label className="flex items-center gap-2"><input type="radio" name="report-mode" checked={direct} onChange={() => chooseMode("direct")} />강사 작성 없이 바로 처리</label>
        </fieldset>}
        {initialStudentId && !initial && !studentId && <p role="status" className="rounded-lg border p-3 text-sm">이 원생은 지금 고를 수 없습니다. 재원·휴원 중이고 퇴원 예약이 없는 원생(담당 과목)만 퇴원보고서를 시작할 수 있습니다. {directReady ? "다니는 반이 없는 원생은 ‘강사 작성 없이 바로 처리’로만 퇴원할 수 있습니다." : "다니는 반이 없는 원생은 원생 상태 변경을 맡은 사람이 바로 처리합니다."}</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-1 text-sm"><p>대상 학생</p><SearchableSelect portal options={choices.map(s => ({ value: s.id, label: s.name, hint: `${s.school ?? ""} ${s.grade ?? ""}`.trim() }))} value={studentId} ariaLabel="대상 학생" placeholder="학생 검색·선택" searchPlaceholder="이름·학교로 검색" onValueChange={id => { if (pending) return; const s = choices.find(x => x.id === id); setStudentId(id); chooseCourses(s, s?.courses.filter(c => !scope || scope.includes(c.subject)).map(c => c.id) ?? []); }} /></div>
          <label className="space-y-1 text-sm">퇴원·수강종료일<input className={control} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        {student && !noCourses && <fieldset className="rounded-lg border px-3 py-2"><legend className="px-1 text-sm">종료할 반</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{student.courses.map(c => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enrollmentIds.includes(c.id)} disabled={!!scope && !scope.includes(c.subject)} onChange={() => chooseCourses(student, toggleCourseGroup(student.courses, enrollmentIds, c.id))} />{c.className} · {labels[c.subject] ?? c.subject} · {c.teacherName ?? "담당자 미지정"}{c.reportOptout && <span className="text-muted-foreground">(수업보고서 미발송)</span>}</label>)}</div><p className="mt-2 text-xs text-muted-foreground">한 반을 고르면 같은 과목의 반도 함께 종료합니다. 모든 과목을 고르면 퇴원으로 처리합니다.</p>{busy.length > 0 && <p role="note" className="mt-1 text-xs text-muted-foreground">{[...new Set(busy.map(c => labels[c.subject] ?? c.subject))].join("·")} 반({busy.map(c => c.className).join(", ")})은 진행 중인 퇴원보고서가 있어 여기서 고를 수 없습니다. 그 보고서까지 끝나 남은 반이 없으면 퇴원으로 처리됩니다.</p>}</fieldset>}
        {!noCourses && bundled.length > 0 && <p role="note" className="border-line rounded-lg border border-dashed px-3 py-2 text-sm">{bundled.join(" · ")}을 한 과목으로 묶어 함께 종료합니다.{direct ? "" : " 보고서는 과목마다 작성 강사 한 명이 쓰고, 다른 반 담임에게는 작성 요청이 가지 않습니다."}</p>}
        {direct ? <DirectFields formRef={reasonForm} future={date > kstToday()} noCourses={noCourses} /> : <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 text-sm"><p>작성 강사</p><p className="border-line bg-muted/30 rounded-md border px-3 py-2" aria-label="작성 강사">{authorNames.length ? authorNames.join(", ") : <span className="text-muted-foreground">반을 선택하면 정해집니다</span>}</p></div>
            <div className="space-y-1 text-sm"><p>{directorOnly ? "원장 승인" : "관리자 승인"}</p><SearchableSelect portal options={staffOptions(managers)} value="" multiValues={selectedManagers} ariaLabel="관리자 승인" placeholder={directorOnly ? "승인할 원장 선택" : teacherIds.length ? "해당 과목 관리자 선택" : "반을 먼저 선택"} onValueChange={id => { if (!pending && managers.some(u => u.id === id)) setManagers(toggle(selectedManagers, id)); }} /></div>
            {!directorOnly && <div className="space-y-1 text-sm"><p>원장 승인 <span className="text-muted-foreground">(선택)</span></p><SearchableSelect portal options={staffOptions(directors)} value="" multiValues={directorIds} ariaLabel="원장 승인" placeholder="선택하지 않음" onValueChange={id => { if (!pending) setDirectors(v => toggle(v, id)); }} /></div>}
          </div>
          <p className="text-xs text-muted-foreground">{teacherIds.length > 1 ? "과목마다 담당 선생님 한 명이 그 과목의 반을 모두 묶어 보고서를 작성합니다. 다른 반 담임에게는 요청하지 않습니다." : "담당 선생님 한 명이 선택한 반을 모두 묶어 보고서 한 건을 작성합니다. 다른 반 담임에게는 요청하지 않습니다."}</p>
          {skipManagers && <p role="note" className="border-line rounded-lg border border-dashed px-3 py-2 text-sm">{directorOnly ? "작성 강사가 그 과목 관리자이므로 관리자 칸을 건너뛰고 원장 승인으로 바로 넘어갑니다." : "작성 강사가 관리자인 과목이 있어 원장 승인이 필요합니다. 원장을 선택해 주세요."}</p>}
          {!directorOnly && <p className="text-xs text-muted-foreground">{directorIds.length ? "관리자 전원 승인 후, 선택한 원장 전원이 승인합니다." : "원장을 선택하지 않으면 지정한 관리자들이 최종 승인합니다."}</p>}
          {teacherIds.length > 0 && managers.length === 0 && <p className="text-sm text-att-late-ink">선택할 수 있는 해당 과목 관리자가 없습니다. 담당 과목과 승인자 선택을 확인해 주세요.</p>}
          <label className="block space-y-1 text-sm">강사에게 전달할 내용<textarea className={control} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="확인할 내용이나 작성 요청 사유" /></label>
          {courses.length > 0 && eligible.length === 0 && <p className="text-sm text-att-late-ink">선택한 반의 작성 강사를 찾지 못했습니다. 반의 담임 배정을 확인해 주세요.</p>}
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3"><p className="text-xs text-muted-foreground">{summary}</p><div className="flex gap-2"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>닫기</Button>{direct
        ? <Button disabled={pending || !ready} onClick={submitDirect}>{pending ? "처리 중…" : kind === "withdrawal" ? "바로 퇴원 처리" : "바로 수강종료"}</Button>
        : <Button disabled={pending || !ready || !teacherIds.length || !selectedManagers.length || (needsDirector && !directorIds.length)} onClick={submit}>{pending ? "요청 중…" : "강사에게 작성 요청"}</Button>}</div></div>
    </DialogContent>
  </Dialog>;
}
