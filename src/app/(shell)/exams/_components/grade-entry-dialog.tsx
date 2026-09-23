"use client";

import { useMemo, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ToolbarButton } from "@/components/toolbar";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { examSlotOptions } from "@/features/grades/exam-slots";
import { saveGradeScores } from "@/features/grades/server/actions";
import { createUnifiedGrade } from "@/features/grades/unified/server/create-action";
import { loadSchoolRoster, type SchoolRoster } from "@/features/grades/unified/server/entry-actions";
import { KIND_LABEL, schoolGradeLabel, type UnifiedKind } from "@/features/grades/unified/model";
import { kindChip } from "@/features/grades/unified/kind-color";
import { EntryGrid, type EntryGridRow, type EntryResult } from "./entry-grid";

type Option = { value: string; label: string };
type Student = { id: string; name: string; school: string | null; grade: string | null };
export type EntryClass = { id: string; name: string; subject: string; studentIds: string[] };
type EntryKind = "daily" | "check" | "admission" | "other" | "school";
const KINDS: { key: EntryKind; label: string; chip: UnifiedKind }[] = [
  { key: "daily", label: KIND_LABEL.daily, chip: "daily" }, { key: "check", label: KIND_LABEL.check, chip: "check" },
  { key: "admission", label: KIND_LABEL.admission, chip: "admission" }, { key: "other", label: KIND_LABEL.other, chip: "other" },
  { key: "school", label: "내신·월말평가", chip: "school" },
];
const FIELD = `${CONTROL_H} ${CONTROL_LABEL} border-line bg-background rounded-lg border px-2`;

/**
 * **성적 입력** 창(원장 2026-09-23 "입력폼을 새로 만들고 성적 입력 버튼으로") — 옛 두 폼(한 명 추가 · 학교 시험 명단)을 하나로.
 * 시험 종류를 고르고 → 반(또는 학생 추가)으로 명단을 세우고 → 점수만 쭉 친다.
 * 저장 경로는 **새로 만들지 않았다**: 수업 시험 = `createUnifiedGrade`(한 명씩), 학교·월말 = `saveGradeScores`(명단 일괄).
 */
export function GradeEntryDialog({ canWrite, today, subjects, axisSubjects, students, classes, initialOpen }: {
  canWrite: boolean; today: string; subjects: Option[]; axisSubjects: Option[]; students: Student[]; classes: EntryClass[];
  /** 옛 입력 주소(`/exams/input?…` → `entry=1`)로 들어오면 학교·월말 시험으로 열린 채 시작한다. */
  initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<EntryKind>(initialOpen ? "school" : "daily");
  const [subject, setSubject] = useState(subjects[0]?.value ?? "");
  const [axis, setAxis] = useState(axisSubjects[0]?.value ?? "");
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(today);
  const [max, setMax] = useState("100");
  const [year, setYear] = useState(today.slice(0, 4));
  const [term, setTerm] = useState(Number(today.slice(5, 7)) >= 8 || Number(today.slice(5, 7)) <= 1 ? "2" : "1");
  const [slot, setSlot] = useState("");
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, EntryResult>>({});
  const [roster, setRoster] = useState<SchoolRoster | null>(null);
  // 반 목록은 명단을 비워도 남긴다 — 반을 고르는 순간 명단이 비워지는데 그때 목록까지 사라지면 고를 수 없다.
  const [schoolClasses, setSchoolClasses] = useState<SchoolRoster["classes"]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const school = kind === "school";
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const subjectClasses = classes.filter((c) => c.subject === subject);
  const slotOptions = examSlotOptions(axis.split(":")[0] ?? "");

  // 조건이 바뀌면 이미 친 점수·결과·명단을 비운다 — 다른 시험의 점수가 새 명단에 남아 잘못 저장되지 않게.
  const resetWork = () => { setScores({}); setResults({}); setRoster(null); setNotice(null); };
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); resetWork(); };

  const quickRows: EntryGridRow[] = useMemo(() => {
    const cls = classes.find((c) => c.id === classId);
    const ids = [...new Set([...(cls?.studentIds ?? []), ...extraIds])];
    return ids.map((id) => byId.get(id)).filter((s): s is Student => !!s).sort((a, b) => a.name.localeCompare(b.name, "ko"))
      .map((s) => ({ studentId: s.id, name: s.name, school: s.school, grade: s.grade, className: cls?.studentIds.includes(s.id) ? cls.name : "추가한 학생" }));
  }, [classes, classId, extraIds, byId]);
  const schoolRows: EntryGridRow[] = (roster?.rows ?? []).map((r) => ({ studentId: r.studentId, name: r.name, school: r.school, grade: r.grade,
    className: r.className, existing: r.score, lockedReason: r.withdrawn ? "퇴원" : !r.applies ? "해당 없는 시험" : null }));
  const rows = school ? schoolRows : quickRows;
  const maxNum = school ? roster?.selection.maxScore ?? Number(max) : Number(max);
  const filled = rows.filter((r) => !r.lockedReason && (scores[r.studentId] ?? "") !== "");

  const loadRoster = () => start(async () => {
    resetWork();
    const res = await loadSchoolRoster({ year, term, subject: axis, classId, slot, date, max });
    if ("error" in res) { setNotice({ ok: false, text: res.error }); return; }
    setRoster(res.roster);
    setSchoolClasses(res.roster.classes);
    setSlot(res.roster.selection.slot);
    setScores(Object.fromEntries(res.roster.rows.filter((r) => r.score != null).map((r) => [r.studentId, String(r.score)])));
  });

  const save = () => start(async () => {
    setNotice(null);
    if (school && roster) {
      const touched = roster.rows.filter((r) => r.applies && !r.withdrawn && (scores[r.studentId] ?? "") !== (r.score == null ? "" : String(r.score)));
      if (!touched.length) { setNotice({ ok: true, text: "바뀐 점수가 없습니다" }); return; }
      const fd = new FormData();
      const sel = roster.selection;
      fd.set("year", String(sel.year)); fd.set("term", String(sel.term)); fd.set("subject", sel.subject); fd.set("class", sel.classId);
      fd.set("slot", sel.slot); fd.set("date", sel.date); fd.set("max", String(sel.maxScore));
      fd.set("entries", JSON.stringify(touched.map((r) => {
        const v = scores[r.studentId] ?? "";
        return { studentId: r.studentId, score: v === "" ? null : Number(v), noExam: v === "" ? r.noExam : false, noExamReason: v === "" ? r.noExamReason : null };
      })));
      const res = await saveGradeScores(undefined, fd);
      if (res?.error) { setNotice({ ok: false, text: res.error }); return; }
      setResults(Object.fromEntries(touched.map((r) => [r.studentId, { ok: true } as const])));
      setNotice({ ok: true, text: `${res?.saved ?? touched.length}명 저장했습니다` });
      return;
    }
    const next: Record<string, EntryResult> = {};
    for (const row of filled) {
      if (results[row.studentId]?.ok) continue; // 이미 저장한 줄은 다시 보내지 않는다(중복 기록 방지)
      const fd = new FormData();
      fd.set("studentId", row.studentId); fd.set("subject", subject); fd.set("kind", kind); fd.set("date", date);
      fd.set("score", scores[row.studentId] ?? ""); fd.set("maxScore", max);
      const res = await createUnifiedGrade(undefined, fd);
      next[row.studentId] = res?.error ? { ok: false, error: res.error } : { ok: true };
      setResults((prev) => ({ ...prev, [row.studentId]: next[row.studentId]! }));
    }
    const failed = Object.values(next).filter((r) => !r.ok).length;
    setNotice({ ok: failed === 0, text: failed ? `${Object.keys(next).length - failed}명 저장 · ${failed}명 실패(줄에 사유)` : `${Object.keys(next).length}명 저장했습니다` });
  });

  return <>
    <ToolbarButton variant="primary" disabled={!canWrite} onClick={() => setOpen(true)} title={canWrite ? undefined : "성적을 입력할 권한이 없습니다"}>성적 입력</ToolbarButton>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>성적 입력</DialogTitle>
          <DialogDescription>시험을 고르고 명단을 세운 뒤 점수만 차례로 치세요. Enter를 누르면 다음 학생으로 내려갑니다.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-1.5">{KINDS.map((k) => { const chip = kindChip(k.chip); const on = k.key === kind;
          return <button key={k.key} type="button" onClick={() => { setKind(k.key); resetWork(); }} aria-pressed={on} style={on ? chip.style : undefined}
            className={`rounded-full px-3 py-1 text-sm font-semibold transition ${on ? `${chip.className} ring-2 ring-current` : "border-line text-text-dim hover:bg-bg-soft border"}`}>{k.label}</button>; })}</div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          {school ? <>
            <label className="grid gap-1">과목<select value={axis} onChange={(e) => { change(setAxis)(e.target.value); setSlot(""); setClassId(""); }} className={FIELD}>{axisSubjects.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label className="grid gap-1">년도<input type="number" min="2000" max="2100" value={year} onChange={(e) => change(setYear)(e.target.value)} className={`${FIELD} w-24`} /></label>
            <label className="grid gap-1">학기<select value={term} onChange={(e) => change(setTerm)(e.target.value)} className={FIELD}><option value="1">1학기</option><option value="2">2학기</option></select></label>
            <label className="grid gap-1">시험<select value={slot || slotOptions[0]?.value} onChange={(e) => change(setSlot)(e.target.value)} className={FIELD}>{slotOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label className="grid gap-1">반<select value={classId} onChange={(e) => change(setClassId)(e.target.value)} className={FIELD}><option value="">전체</option>{schoolClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </> : <>
            <label className="grid gap-1">과목<select value={subject} onChange={(e) => { change(setSubject)(e.target.value); setClassId(""); setExtraIds([]); }} className={FIELD}>{subjects.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            <label className="grid gap-1">반<select value={classId} onChange={(e) => change(setClassId)(e.target.value)} className={FIELD}><option value="">반 선택</option>{subjectClasses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.studentIds.length})</option>)}</select></label>
          </>}
          <label className="grid gap-1">시험일<input type="date" value={date} onChange={(e) => change(setDate)(e.target.value)} className={FIELD} /></label>
          <label className="grid gap-1">만점<input type="number" min="1" max="1000" value={max} onChange={(e) => change(setMax)(e.target.value)} className={`${FIELD} w-20`} /></label>
          {school ? <button type="button" onClick={loadRoster} title={schoolClasses.length ? undefined : "처음엔 전체 명단을 불러오고, 그다음 반을 고를 수 있습니다"} disabled={pending} className={`${FIELD} bg-primary text-primary-foreground border-primary font-semibold`}>{pending && !roster ? "불러오는 중" : "명단 불러오기"}</button>
            : <div className="grid gap-1">학생 추가<SearchableSelect value="" placeholder="이름 검색" cap={30} ariaLabel="학생 추가"
              onValueChange={(id) => id && setExtraIds((prev) => prev.includes(id) ? prev : [...prev, id])}
              options={students.map((s) => ({ value: s.id, label: s.name, hint: schoolGradeLabel(s.school, s.grade) }))} /></div>}
        </div>
        {school && roster?.notice ? <p className="text-danger text-sm">{roster.notice}</p> : null}
        {school && !roster ? <p className="text-text-dim py-8 text-center text-sm">조건을 고르고 [명단 불러오기]를 누르면 그 학기 명단이 섭니다. 이미 있는 점수는 채워져 나옵니다.</p>
          : <EntryGrid rows={rows} scores={scores} max={maxNum} results={results} disabled={pending}
            onScore={(id, v) => { setScores((prev) => ({ ...prev, [id]: v })); setResults((prev) => { const { [id]: _drop, ...rest } = prev; void _drop; return rest; }); }}
            onRemove={school ? undefined : (id) => setExtraIds((prev) => prev.filter((x) => x !== id))} />}
        <DialogFooter className="items-center">
          {notice ? <p role={notice.ok ? "status" : "alert"} className={`mr-auto text-sm font-semibold ${notice.ok ? "text-green" : "text-danger"}`}>{notice.text}</p>
            : <p className="text-text-dim mr-auto text-sm">점수 친 학생 {filled.length}명 / {rows.filter((r) => !r.lockedReason).length}명</p>}
          <ToolbarButton onClick={() => setOpen(false)}>닫기</ToolbarButton>
          <ToolbarButton variant="primary" onClick={save} disabled={pending || !canWrite || (school ? !roster?.ready : filled.length === 0)}>{pending ? "저장 중" : "저장"}</ToolbarButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
