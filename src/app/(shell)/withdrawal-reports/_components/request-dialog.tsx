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
import { lastLessonHint } from "@/features/withdrawal-reports/last-lesson";
import { approverOptions, subjectEndGroups, defaultApproverIds, reportApprovalPlan, reportAuthorIds, reportManagerIds, toggleCourseGroup } from "@/features/withdrawal-reports/request-options";
import { DirectFields } from "./direct-fields";
import { ApprovalPlanNote } from "./approval-plan-note";
import { useLastLessonDate } from "./use-last-lesson-date";

const control = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const toggle = (items: string[], id: string) => items.includes(id) ? items.filter(x => x !== id) : [...items, id];
type Mode = "request" | "direct";
/** 고른 반 → 작성 강사(그 반의 담임)와 기본 관리자 — 학생을 고를 때와 창을 그 학생으로 열 때 같은 계산. */
function selectionFor(staff: StaffOption[], s: StudentOption | undefined, next: string[]) {
  const selected = s?.courses.filter(c => next.includes(c.id)) ?? [];
  const authors = reportAuthorIds(selected.filter(c => staff.some(u => u.id === c.teacherId)));
  const teacherIds = staff.filter(u => authors.includes(u.id)).map(u => u.id);
  return { enrollmentIds: next, teacherIds, managerIds: defaultApproverIds(reportApprovalPlan(staff, selected, teacherIds)) };
}
/**
 * 퇴원보고서 시작 창 — 강사에게 작성 요청 / **강사 작성 없이 바로 처리**(원장 2026-10-23, `directReady` = 0453a 적용 DB에서만).
 * 원생 화면의 '퇴원보고서'가 `?request=<학생>`으로 이 창을 그 학생을 고른 채 연다(퇴원은 퇴원보고서로만).
 * 다니는 반이 없는 원생은 담임이 없어 작성 요청을 못 하니 바로 처리(퇴원만)로 연다.
 * 원장 2026-11-03: 원장 승인 칸은 없다(관리자 승인 + 환불을 요청했으면 데스크 환불 처리) · 작성 강사가 그 과목 관리자면 관리자 승인을 생략한다
 * · 날짜 칸 = '마지막 수업일'(학생·반을 고르면 출결에서 채운다 — `useLastLessonDate`).
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
  const lastLesson = useLastLessonDate({ studentId: initial?.id ?? "", enrollmentIds: initialPick.enrollmentIds });
  const date = lastLesson.date;
  // 출결에서 날짜를 찾는 동안은 보내지 않는다 — 오늘 날짜로 먼저 요청되지 않게.
  const dateLoading = lastLesson.source === "loading";
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
  // 보고서(작성 강사)마다 승인 계획 — 작성 강사가 그 보고서 과목의 관리자면 그 보고서만 관리자 승인 생략(원장 2026-11-03). 서버가 같은 계산으로 다시 정한다.
  const plan = reportApprovalPlan(staff, courses, teacherIds);
  const managers = approverOptions(plan);
  const skipAll = plan.length > 0 && plan.every(p => p.skip);
  const selectedManagers = managerIds.filter(id => managers.some(u => u.id === id));
  const perReport = reportManagerIds(plan, selectedManagers);
  const noCourses = !!student && student.courses.length === 0;
  const endGroups = subjectEndGroups(courses, labels);
  // 진행 중인 다른 과목 보고서의 반도 남은 반으로 센다 — 그 보고서까지 끝나 남은 반이 없으면 DB가 그때 퇴원으로 마무리한다(s2_0014).
  const busy = student?.busyCourses ?? [];
  const kind = noCourses ? "withdrawal" : automaticExitKind([...(student?.courses ?? []), ...busy], enrollmentIds);
  function chooseCourses(s: StudentOption | undefined, next: string[], newStudent = false) {
    const pick = selectionFor(staff, s, next);
    setEnrollments(pick.enrollmentIds); setTeachers(pick.teacherIds); setManagers(pick.managerIds);
    setError("");
    lastLesson.refresh(s?.id ?? "", pick.enrollmentIds, newStudent);
  }
  function chooseMode(next: Mode) {
    if (pending) return;
    setMode(next); setError("");
    if (next === "request" && noCourses) { setStudentId(""); chooseCourses(undefined, [], true); }
  }
  const go = (path: string) => window.location.assign(inFrame ? withEmbed(path) : path);
  function submit() {
    setError("");
    startTransition(async () => {
      try {
        const res = await requestWithdrawalReport({ studentId, teacherIds, managerIds: selectedManagers, reportManagerIds: perReport.byTeacher, subjects, enrollmentIds, effectiveDate: date, note });
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
      <div className="border-b px-5 py-4"><DialogTitle>{direct ? "강사 작성 없이 바로 처리" : "강사에게 보고서 작성 요청"}</DialogTitle><DialogDescription className="mt-1">{direct ? "종료할 반과 사유를 정해 바로 퇴원·수강종료합니다. 처리 내용은 퇴원보고서 기록으로 남습니다." : "종료할 반을 선택하면 과목마다 담당 선생님에게 작성을 요청합니다. 관리자 승인이 끝나면(보고서에서 환불을 요청했다면 데스크 환불 처리까지) 선택한 반을 종료합니다."}</DialogDescription></div>
      <div className={`min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5 ${pending ? "pointer-events-none opacity-60" : ""}`} aria-busy={pending}>
        {directReady && <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="처리 방식">
          <label className="flex items-center gap-2"><input type="radio" name="report-mode" checked={!direct} onChange={() => chooseMode("request")} />강사에게 작성 요청</label>
          <label className="flex items-center gap-2"><input type="radio" name="report-mode" checked={direct} onChange={() => chooseMode("direct")} />강사 작성 없이 바로 처리</label>
        </fieldset>}
        {initialStudentId && !initial && !studentId && <p role="status" className="rounded-lg border p-3 text-sm">이 원생은 지금 고를 수 없습니다. 재원·휴원 중이고 퇴원 예약이 없는 원생(담당 과목)만 퇴원보고서를 시작할 수 있습니다. {directReady ? "다니는 반이 없는 원생은 ‘강사 작성 없이 바로 처리’로만 퇴원할 수 있습니다." : "다니는 반이 없는 원생은 원생 상태 변경을 맡은 사람이 바로 처리합니다."}</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-1 text-sm"><p>대상 학생</p><SearchableSelect portal options={choices.map(s => ({ value: s.id, label: s.name, hint: `${s.school ?? ""} ${s.grade ?? ""}`.trim() }))} value={studentId} ariaLabel="대상 학생" placeholder="학생 검색·선택" searchPlaceholder="이름·학교로 검색" onValueChange={id => { if (pending) return; const s = choices.find(x => x.id === id); setStudentId(id); chooseCourses(s, s?.courses.filter(c => !scope || scope.includes(c.subject)).map(c => c.id) ?? [], true); }} /></div>
          <div className="space-y-1 text-sm"><label className="block space-y-1">마지막 수업일<input className={control} type="date" value={date} onChange={e => lastLesson.edit(e.target.value)} /></label><p className="text-xs text-muted-foreground" role="status">{lastLessonHint(lastLesson.source)}</p></div>
        </div>
        {student && !noCourses && <fieldset className="rounded-lg border px-3 py-2"><legend className="px-1 text-sm">종료할 반</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{student.courses.map(c => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enrollmentIds.includes(c.id)} disabled={!!scope && !scope.includes(c.subject)} onChange={() => chooseCourses(student, toggleCourseGroup(student.courses, enrollmentIds, c.id))} />{c.className} · {labels[c.subject] ?? c.subject} · {c.teacherName ?? "담당자 미지정"}{c.reportOptout && <span className="text-muted-foreground">(수업보고서 미발송)</span>}</label>)}</div><p className="mt-2 text-xs text-muted-foreground">한 반을 고르면 같은 과목의 반도 함께 종료합니다. 모든 과목을 고르면 퇴원으로 처리합니다.</p>{busy.length > 0 && <p role="note" className="mt-1 text-xs text-muted-foreground">{[...new Set(busy.map(c => labels[c.subject] ?? c.subject))].join("·")} 반({busy.map(c => c.className).join(", ")})은 진행 중인 퇴원보고서가 있어 여기서 고를 수 없습니다. 그 보고서까지 끝나 남은 반이 없으면 퇴원으로 처리됩니다.</p>}</fieldset>}
        {!noCourses && endGroups.length > 0 && <div role="note" className="border-line space-y-1 rounded-lg border border-dashed px-3 py-2 text-sm">{endGroups.map(g => <p key={g.name}><b>{g.name}</b> 수업 {g.classNames.length}개를 모두 종료합니다 — {g.classNames.join(", ")}</p>)}<p className="text-xs text-muted-foreground">같은 과목의 수업은 하나만 골라도 모두 함께 종료됩니다.{direct ? "" : " 보고서는 과목마다 작성 강사 한 명이 쓰고, 다른 반 담임에게는 작성 요청이 가지 않습니다."}</p></div>}
        {direct ? <DirectFields formRef={reasonForm} future={date > kstToday()} noCourses={noCourses} /> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 text-sm"><p>작성 강사</p><p className="border-line bg-muted/30 rounded-md border px-3 py-2" aria-label="작성 강사">{authorNames.length ? authorNames.join(", ") : <span className="text-muted-foreground">반을 선택하면 정해집니다</span>}</p></div>
            <div className="space-y-1 text-sm"><p>관리자 승인</p>{skipAll
              ? <p className="border-line bg-muted/30 rounded-md border px-3 py-2" aria-label="관리자 승인">생략 — 작성 강사가 과목 관리자</p>
              : <SearchableSelect portal options={staffOptions(managers)} value="" multiValues={selectedManagers} ariaLabel="관리자 승인" placeholder={teacherIds.length ? "해당 과목 관리자 선택" : "반을 먼저 선택"} onValueChange={id => { if (!pending && managers.some(u => u.id === id)) setManagers(toggle(selectedManagers, id)); }} />}</div>
          </div>
          <p className="text-xs text-muted-foreground">{teacherIds.length > 1 ? "과목마다 담당 선생님 한 명이 그 과목의 반을 모두 묶어 보고서를 작성합니다. 다른 반 담임에게는 요청하지 않습니다." : "담당 선생님 한 명이 선택한 반을 모두 묶어 보고서 한 건을 작성합니다. 다른 반 담임에게는 요청하지 않습니다."}</p>
          <ApprovalPlanNote plan={plan} byTeacher={perReport.byTeacher} staff={staff} labels={labels} />
          <p className="text-xs text-muted-foreground">{skipAll ? "보고서에서 환불을 요청하면 데스크 환불 처리(환불완료일자)가 끝난 뒤 처리합니다." : "지정한 관리자가 모두 승인하면 처리합니다. 보고서에서 환불을 요청하면 데스크 환불 처리까지 끝난 뒤 처리합니다."}</p>
          {plan.some(p => !p.skip && !p.candidates.length) && <p className="text-sm text-att-late-ink">선택할 수 있는 해당 과목 관리자가 없습니다. 담당 과목과 승인자 선택을 확인해 주세요.</p>}
          <label className="block space-y-1 text-sm">강사에게 전달할 내용<textarea className={control} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="확인할 내용이나 작성 요청 사유" /></label>
          {courses.length > 0 && eligible.length === 0 && <p className="text-sm text-att-late-ink">선택한 반의 작성 강사를 찾지 못했습니다. 반의 담임 배정을 확인해 주세요.</p>}
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3"><p className="text-xs text-muted-foreground">{summary}</p><div className="flex gap-2"><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>닫기</Button>{direct
        ? <Button disabled={pending || !ready || dateLoading} onClick={submitDirect}>{pending ? "처리 중…" : kind === "withdrawal" ? "바로 퇴원 처리" : "바로 수강종료"}</Button>
        : <Button disabled={pending || !ready || dateLoading || !teacherIds.length || perReport.missing.length > 0} onClick={submit}>{pending ? "요청 중…" : "강사에게 작성 요청"}</Button>}</div></div>
    </DialogContent>
  </Dialog>;
}
