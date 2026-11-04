"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { useMemo, useState, useTransition } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ToolbarButton } from "@/components/toolbar";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { examSlotLabel, examSlotOptions, examSlotsFor } from "@/features/grades/exam-slots";
import { AREA_KEYS, slotHasAreas } from "@/features/grades/area-scores";
import { saveGradeScores } from "@/features/grades/server/actions";
import { createUnifiedGrade } from "@/features/grades/unified/server/create-action";
import { loadSchoolRoster, type SchoolRoster } from "@/features/grades/unified/server/entry-actions";
import { KIND_LABEL, schoolGradeLabel } from "@/features/grades/unified/model";
import { prefillFromTodaysMath } from "@/features/grades/todays-math-monthly";
import { EntryGrid, type EntryGridRow, type EntryResult } from "./entry-grid";
import { AreaEntryGrid, draftFromSaved, draftHasValue, type AreaDraft, type AreaGridRow } from "./area-entry-grid";
import { saveAreaRoster, schoolRowsOf } from "./area-entry-save";
import { SchoolGradeFields } from "./school-grade-fields";

type Option = { value: string; label: string };
type Student = { id: string; name: string; school: string | null; grade: string | null };
export type EntryClass = { id: string; name: string; subject: string; studentIds: string[] };
type EntryKind = "daily" | "check" | "admission" | "other" | "school" | "monthly";
const FIELD = `${CONTROL_H} ${CONTROL_LABEL} border-line bg-background rounded-lg border px-2`;
const LABEL = "grid gap-1 text-sm";

/**
 * **성적 입력** 창(원장 2026-09-23) — 1행 = 모든 시험에 공통(시험·과목·반·시험일·만점), 2행 = 고른 시험에만 필요한 것
 * (수업 시험: 학생 추가 / 내신: 년도·학기·내신 종류 / 월말평가: 년도·학기). 명단을 세우고 점수만 Enter로 쭉 친다.
 * 내신은 학교 시험이라 1행의 **반 자리에 학교·학년**을 세운다(원장 2026-09-24) — 월말평가는 학원 시험이라 반 그대로.
 * 저장 경로는 **새로 만들지 않았다**: 수업 시험 = `createUnifiedGrade`(한 명씩), 내신·월말 = `saveGradeScores`(명단 일괄).
 */
export function GradeEntryDialog({ canWrite, today, subjects, students, classes, initialOpen, classNamesOf }: {
  canWrite: boolean; today: string; subjects: Option[]; students: Student[]; classes: EntryClass[];
  /** `학생id|과목` → 그 과목 지금 다니는 반 전부(성적 현황 '반' 열과 같은 값). 없으면 명단이 준 반 하나로. */
  classNamesOf: Record<string, string>;
  /** 옛 입력 주소(`/exams/input?…` → `entry=1`)로 들어오면 내신으로 열린 채 시작한다. */
  initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [kind, setKind] = useState<EntryKind>(initialOpen ? "school" : "daily");
  const [subject, setSubject] = useState(subjects[0]?.value ?? "");
  const [classId, setClassId] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [gradeName, setGradeName] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [date, setDate] = useState(today);
  const [max, setMax] = useState("100");
  const [year, setYear] = useState(today.slice(0, 4));
  const [term, setTerm] = useState(Number(today.slice(5, 7)) >= 8 || Number(today.slice(5, 7)) <= 1 ? "2" : "1");
  const [slot, setSlot] = useState("");
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [areaDraft, setAreaDraft] = useState<Record<string, AreaDraft>>({});
  const [results, setResults] = useState<Record<string, EntryResult>>({});
  const [roster, setRoster] = useState<SchoolRoster | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  // 과목 값은 영어 트랙까지 든 축(`english:eie`) — 반·수업 시험은 과목 키만 본다.
  const baseSubject = subject.split(":")[0] ?? "";
  const hasMonthly = examSlotsFor(baseSubject).includes("monthly");
  const schoolSlots = examSlotOptions(baseSubject).filter((o) => o.value !== "monthly");
  const kinds: Option[] = [
    ...(["daily", "check", "admission", "other"] as const).map((k) => ({ value: k, label: KIND_LABEL[k] })),
    { value: "school", label: "내신" }, ...(hasMonthly ? [{ value: "monthly", label: examSlotLabel(baseSubject, "monthly") }] : []),
  ];
  const school = kind === "school" || kind === "monthly";
  const areaMode = kind === "monthly" && slotHasAreas(baseSubject, "monthly");
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const subjectClasses = classes.filter((c) => c.subject === baseSubject);
  const subjectStudents = useMemo(() => [...new Set(subjectClasses.flatMap((c) => c.studentIds))].map((id) => byId.get(id)).filter((s): s is Student => !!s),
    [subjectClasses, byId]);

  // 조건이 바뀌면 이미 친 점수·결과·명단을 비운다 — 다른 시험의 점수가 새 명단에 남아 잘못 저장되지 않게.
  const resetWork = () => { setScores({}); setAreaDraft({}); setResults({}); setRoster(null); setNotice(null); };
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); resetWork(); };

  const quickRows: EntryGridRow[] = useMemo(() => {
    const cls = classes.find((c) => c.id === classId);
    const ids = [...new Set([...(cls?.studentIds ?? []), ...extraIds])];
    return ids.map((id) => byId.get(id)).filter((s): s is Student => !!s).sort((a, b) => a.name.localeCompare(b.name, "ko"))
      .map((s) => ({ studentId: s.id, name: s.name, school: s.school, grade: s.grade, className: classNamesOf[`${s.id}|${baseSubject}`] ?? (cls?.studentIds.includes(s.id) ? cls.name : "추가한 학생") }));
  }, [classes, classId, extraIds, byId, classNamesOf, baseSubject]);
  const schoolRows = schoolRowsOf(roster, classNamesOf, baseSubject);
  const rows = school ? schoolRows : quickRows;
  const maxNum = school ? roster?.selection.maxScore ?? Number(max) : Number(max);
  const filled = rows.filter((r) => !r.lockedReason && (areaMode ? draftHasValue(areaDraft[r.studentId]) : (scores[r.studentId] ?? "") !== ""));
  // 미입력만 보기 — 기준은 **저장된 값**(내신·월말) / 저장 결과(수업 시험)다. 치는 중인 칸으로 거르면 Enter를 누르는 순간 줄이 사라진다.
  const shownRows = onlyMissing ? rows.filter((r) => !r.lockedReason && (school ? r.existing == null : !results[r.studentId]?.ok)) : rows;

  const loadRoster = () => start(async () => {
    resetWork();
    const res = await loadSchoolRoster({ year, term, subject, date, max: areaMode ? String(Number(max) * AREA_KEYS.length) : max,
      ...(kind === "school" ? { classId: "", school: schoolName, grade: gradeName } : { classId }),
      slot: kind === "monthly" ? "monthly" : slot || schoolSlots[0]?.value });
    if ("error" in res) { setNotice({ ok: false, text: res.error }); return; }
    setRoster(res.roster);
    if (areaMode) { setAreaDraft(Object.fromEntries(res.roster.rows.map((r) => [r.studentId, draftFromSaved(r.score, r.areas)]))); return; }
    // 오늘 수학 월말평가가 있으면 빈 칸에 바로 채운다(단추 없음 · 저장은 사람이) — 만점이 다르면 채우지 않고 알린다.
    const pre = prefillFromTodaysMath(res.roster.ready ? res.roster.todaysMath : null, res.roster.rows,
      Object.fromEntries(res.roster.rows.filter((r) => r.score != null).map((r) => [r.studentId, String(r.score)])), res.roster.selection.maxScore);
    setScores(pre.scores);
    const filledN = Object.keys(pre.fill).length;
    if (filledN || pre.maxMismatch) setNotice({ ok: true, text: [filledN ? `오늘 수학 월말평가 ${filledN}명을 빈 칸에 채웠습니다 · 확인 후 저장하세요` : "",
      pre.maxMismatch ? `만점이 달라 못 채운 ${pre.maxMismatch}명(오늘 수학 ${pre.otherMax ?? "?"}점 만점)` : ""].filter(Boolean).join(" · ") });
  });

  const save = () => start(async () => {
    setNotice(null);
    if (areaMode && roster) { const res = await saveAreaRoster(roster, schoolRows, areaDraft); if (res.roster) { setRoster(res.roster); setResults(res.results); } setNotice(res.notice); return; }
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
      // 저장한 값을 명단의 '저장된 값'으로 올린다 — 안 올리면 미입력만 보기에 방금 친 학생이 남고, 다시 저장하면 같은 줄이 또 나간다.
      const savedScore = new Map(touched.map((r) => { const v = scores[r.studentId] ?? ""; return [r.studentId, v === "" ? null : Number(v)] as const; }));
      setRoster({ ...roster, rows: roster.rows.map((r) => savedScore.has(r.studentId) ? { ...r, score: savedScore.get(r.studentId) ?? null } : r) });
      setNotice({ ok: true, text: `${res?.saved ?? touched.length}명 저장했습니다` });
      return;
    }
    const next: Record<string, EntryResult> = {};
    for (const row of filled) {
      if (results[row.studentId]?.ok) continue; // 이미 저장한 줄은 다시 보내지 않는다(중복 기록 방지)
      const fd = new FormData();
      fd.set("studentId", row.studentId); fd.set("subject", baseSubject); fd.set("kind", kind); fd.set("date", date);
      fd.set("score", scores[row.studentId] ?? ""); fd.set("maxScore", max);
      const res = await createUnifiedGrade(undefined, fd);
      next[row.studentId] = res?.error ? { ok: false, error: res.error } : { ok: true };
      setResults((prev) => ({ ...prev, [row.studentId]: next[row.studentId]! }));
    }
    const failed = Object.values(next).filter((r) => !r.ok).length;
    setNotice({ ok: failed === 0, text: failed ? `${Object.keys(next).length - failed}명 저장 · ${failed}명 실패(줄에 사유)` : `${Object.keys(next).length}명 저장했습니다` });
  });

  const loadButton = <button type="button" onClick={loadRoster} disabled={pending} className={`${FIELD} bg-primary text-primary-foreground border-primary font-semibold`}>
    <SheetText value={pending && !roster ? "불러오는 중" : "명단 불러오기"} /></button>;
  const termFields = <>
    <label className={LABEL}><SheetText value={"년도"} /><input type="number" min="2000" max="2100" value={year} onChange={(e) => change(setYear)(e.target.value)} className={`${FIELD} w-24`} /></label>
    <label className={LABEL}><SheetText value={"학기"} /><select value={term} onChange={(e) => change(setTerm)(e.target.value)} className={FIELD}><option value="1"><SheetText value={"1학기"} /></option><option value="2"><SheetText value={"2학기"} /></option></select></label>
  </>;

  return <>
    <ToolbarButton variant="primary" disabled={!canWrite} onClick={() => setOpen(true)} title={canWrite ? undefined : "성적을 입력할 권한이 없습니다"}><SheetText value={"성적 입력"} /></ToolbarButton>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle><SheetText value={"성적 입력"} /></DialogTitle>
          <DialogDescription><SheetText value={"시험을 고르고 명단을 세운 뒤 점수만 차례로 치세요. Enter를 누르면 다음 학생으로 내려갑니다."} /></DialogDescription></DialogHeader>
        {/* 1행 — 모든 시험에 공통 */}
        <div className="flex flex-wrap items-end gap-2">
          <label className={LABEL}><SheetText value={"시험"} /><select value={kind} onChange={(e) => change(setKind)(e.target.value as EntryKind)} className={`${FIELD} font-semibold`}>
            {kinds.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label className={LABEL}><SheetText value={"과목"} /><select value={subject} onChange={(e) => {
            const next = e.target.value;
            change(setSubject)(next); setClassId(""); setSchoolName(""); setGradeName(""); setExtraIds([]); setSlot("");
            if (kind === "monthly" && !examSlotsFor(next.split(":")[0] ?? "").includes("monthly")) setKind("school");
          }} className={FIELD}>{subjects.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          {kind === "school" ? <SchoolGradeFields students={subjectStudents} school={schoolName} grade={gradeName} fieldClass={FIELD} labelClass={LABEL}
            onSchool={(v) => { change(setSchoolName)(v); setGradeName(""); }} onGrade={(v) => change(setGradeName)(v)} />
          : <div className={LABEL}><SheetText value={"반"} /><SearchableSelect value={classId} placeholder={school ? "전체" : "반 검색"} searchPlaceholder="반 이름" requireQuery cap={50} ariaLabel="반"
            className="w-60" triggerClassName={FIELD} onValueChange={(id) => change(setClassId)(id)}
            options={[...(school ? [{ value: "", label: "전체" }] : []), ...subjectClasses.map((c) => ({ value: c.id, label: c.name, hint: `${c.studentIds.length}명` }))]} /></div>}
          <label className={LABEL}><SheetText value={"시험일"} /><input type="date" value={date} onChange={(e) => change(setDate)(e.target.value)} className={FIELD} /></label>
          <label className={LABEL}><SheetText value={areaMode ? "영역 만점" : "만점"} /><input type="number" min="1" max="1000" value={max} onChange={(e) => change(setMax)(e.target.value)} className={`${FIELD} w-20`} /></label>
        </div>
        {/* 2행 — 고른 시험에만 필요한 것 */}
        <div className="bg-bg-soft flex flex-wrap items-end gap-2 rounded-xl p-3">
          {kind === "school" ? <>{termFields}
            <label className={LABEL}><SheetText value={"내신 종류"} /><select value={slot || schoolSlots[0]?.value} onChange={(e) => change(setSlot)(e.target.value)} className={FIELD}>
              {schoolSlots.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>{loadButton}</>
            : kind === "monthly" ? <>{termFields}
              <p className="text-sm font-semibold">{Number(date.slice(5, 7))}<SheetText value={"월 "} />{examSlotLabel(baseSubject, "monthly")}{" "}<span className="text-text-dim font-normal"><SheetText value={"(월은 시험일에서)"} /></span></p>{loadButton}</>
            : <div className={LABEL}><SheetText value={"학생 추가"} /><SearchableSelect value="" placeholder="이름 검색" searchPlaceholder="학생 이름" requireQuery cap={30} ariaLabel="학생 추가" className="w-48" triggerClassName={FIELD}
              onValueChange={(id) => id && setExtraIds((prev) => prev.includes(id) ? prev : [...prev, id])}
              options={students.map((s) => ({ value: s.id, label: s.name, hint: schoolGradeLabel(s.school, s.grade) }))} /></div>}
        </div>
        {school && roster?.notice ? <p className="text-danger text-sm">{roster.notice}</p> : null}
        {school && !roster ? <p className="text-text-dim py-8 text-center text-sm"><SheetText value={"조건을 고르고 [명단 불러오기]를 누르면 그 학기 명단이 섭니다. 이미 있는 점수는 채워져 나옵니다."} /></p>
          : areaMode ? <AreaEntryGrid rows={shownRows as AreaGridRow[]} draft={areaDraft} areaMax={maxNum / AREA_KEYS.length} results={results} disabled={pending}
            emptyText={onlyMissing && rows.length ? "미입력 학생이 없습니다." : "조건에 맞는 학생이 없습니다."}
            onArea={(id, k, v) => { setAreaDraft((prev) => ({ ...prev, [id]: { ...prev[id], [k]: v } })); setResults((prev) => { const { [id]: _drop, ...rest } = prev; void _drop; return rest; }); }} />
          : <EntryGrid rows={shownRows} scores={scores} max={maxNum} results={results} disabled={pending}
            emptyText={onlyMissing && rows.length ? "미입력 학생이 없습니다." : school ? "조건에 맞는 학생이 없습니다." : undefined}
            onScore={(id, v) => { setScores((prev) => ({ ...prev, [id]: v })); setResults((prev) => { const { [id]: _drop, ...rest } = prev; void _drop; return rest; }); }}
            onRemove={school ? undefined : (id) => setExtraIds((prev) => prev.filter((x) => x !== id))} />}
        <DialogFooter className="items-center">
          {notice ? <p role={notice.ok ? "status" : "alert"} className={`mr-auto text-sm font-semibold ${notice.ok ? "text-green" : "text-danger"}`}>{notice.text}</p>
            : <p className="text-text-dim mr-auto text-sm"><SheetText value={"점수 친 학생 "} />{filled.length}<SheetText value={"명 / "} />{rows.filter((r) => !r.lockedReason).length}<SheetText value={"명"} /></p>}
          <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /><SheetText value={"미입력만 보기"} /></label>
          <ToolbarButton onClick={() => setOpen(false)}><SheetText value={"닫기"} /></ToolbarButton>
          <ToolbarButton variant="primary" onClick={save} disabled={pending || !canWrite || (school ? !roster?.ready : filled.length === 0)}><SheetText value={pending ? "저장 중" : "저장"} /></ToolbarButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
