import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
import { gradeWriteError } from "@/features/grades/server/access";
import { getGradeSheet } from "@/features/grades/server/queries";
import { examSlotOptions } from "@/features/grades/exam-slots";
import { resolveGradeSelection } from "@/features/grades/selection";
import { axisValueOf } from "@/features/grades/subject-axis";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getUnifiedGrades } from "@/features/grades/unified/server/queries";
import { aggregateBy, averagePercent, KIND_LABEL, scorePercent, schoolGradeLabel, withPreviousScores, type UnifiedRow } from "@/features/grades/unified/model";
import { kstToday } from "@/lib/date-kst";
import { UnifiedLedger } from "./unified-ledger";
import { NewTestForm } from "./new-test-form";
import { ExamsToolbar } from "./exams-toolbar";
import { TrendChart as Trend } from "./trend-chart";
import { ExamCalendar, type ExamDayItem } from "./exam-calendar";

type Params = { from?: string; to?: string; subject?: string; kind?: string; missing?: string; student?: string; cohortClass?: string;
  schoolGroup?: string; gradeGroup?: string; page?: string; tab?: string;
  entry?: string; entryYear?: string; entryTerm?: string; entrySubject?: string; entrySlot?: string; entryClass?: string; entryDate?: string; entryMax?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string | undefined): value is string => {
  if (!value || !ISO.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function daysBefore(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="border-line-faint min-w-0 border-l px-4 first:border-l-0 first:pl-1"><span className="text-xs">{label}</span><strong className="mt-1 block text-2xl font-bold">{value}</strong><small className="text-xs">{note}</small></div>;
}

const TABS = [["overview", "전체 현황"], ["records", "성적 원장"], ["student", "학생 추이"], ["classes", "반별 분석"], ["cohorts", "학교·학년"], ["schedule", "시험 일정"]] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (value: string | undefined): value is Tab => TABS.some(([key]) => key === value);

function SectionHead({ title, description, right }: { title: string; description: string; right?: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-sm">{description}</p></div>{right}</div>;
}

function ScoreText({ row }: { row: UnifiedRow }) {
  return row.score != null && row.maxScore != null ? <span>{row.score} / {row.maxScore}</span> : <span title={row.rawScore ?? ""}>{row.rawScore || "미입력"}</span>;
}

export async function UnifiedDashboard({ searchParams }: { searchParams: Params }) {
  const today = kstToday();
  const to = validDate(searchParams.to) ? searchParams.to : today;
  const proposedFrom = validDate(searchParams.from) ? searchParams.from : daysBefore(to, 180);
  const from = proposedFrom <= to ? proposedFrom : to;
  const kind = searchParams.kind ?? "all";
  const subject = searchParams.subject ?? "all";
  const showMissing = searchParams.missing === "1";
  const entryMode = searchParams.entry === "1";
  const tab: Tab = isTab(searchParams.tab) ? searchParams.tab : entryMode ? "records" : "overview";
  const [data, writeError, settings] = await Promise.all([
    getUnifiedGrades(from, to), gradeWriteError(), getTenantSettings(),
  ]);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const entrySubjects = entryMode ? subjectMaps : null;
  const entrySelection = entrySubjects ? resolveGradeSelection({
    year: searchParams.entryYear, term: searchParams.entryTerm,
    subject: searchParams.entrySubject ?? (data.subjects.includes("math") ? "math" : undefined),
    class: searchParams.entryClass, slot: searchParams.entrySlot, date: searchParams.entryDate, max: searchParams.entryMax,
  }, { subjectOptions: entrySubjects.options, todayIso: today }) : null;
  const sheet = entrySelection ? await getGradeSheet(entrySelection) : null;
  const allRows = withPreviousScores(data.records);
  const filteredRows = allRows.filter((row) => row.date >= from && row.date <= to &&
    (kind === "all" || row.kind === kind) && (subject === "all" || row.subject === subject));
  const rows = filteredRows.filter((row) => showMissing || row.score != null || row.source === "level" || !!row.rawScore);
  const missingCount = filteredRows.filter((row) => row.score == null).length;
  const page = Math.max(1, Math.min(1000, Number(searchParams.page) || 1));
  const pageSize = 50;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const academy = aggregateBy(rows, "academy")[0];
  const classes = aggregateBy(rows, "class");
  const grades = aggregateBy(rows, "grade");
  const schools = aggregateBy(rows, "school");
  const students = [...new Map(rows.map((row) => [row.studentId, row])).values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const selectedStudent = students.find((row) => row.studentId === searchParams.student) ?? students[0];
  const studentRows = selectedStudent ? rows.filter((row) => row.studentId === selectedStudent.studentId) : [];
  const selectedClass = classes.find((row) => row.key === searchParams.cohortClass) ?? classes[0];
  const selectedSchool = schools.find((row) => row.key === searchParams.schoolGroup) ?? schools[0];
  const selectedGrade = grades.find((row) => row.key === searchParams.gradeGroup) ?? grades[0];
  const cohort = new Map<string, { school: string; grade: string; rows: UnifiedRow[] }>();
  for (const row of rows) {
    if (scorePercent(row) == null) continue;
    const school = row.school ?? "학교 미입력";
    const grade = row.grade ?? "학년 미입력";
    const key = `${school}|${grade}`;
    const entry = cohort.get(key) ?? { school, grade, rows: [] };
    entry.rows.push(row);
    cohort.set(key, entry);
  }
  const cohortRows = [...cohort.values()].sort((a, b) => a.school.localeCompare(b.school, "ko") || a.grade.localeCompare(b.grade, "ko"));
  const filteredHref = (patch: Record<string, string>) => {
    const entry = entrySelection ? { entry: "1", entryYear: String(entrySelection.year), entryTerm: String(entrySelection.term),
      entrySubject: axisValueOf(entrySelection), entrySlot: entrySelection.slot, entryClass: entrySelection.classId ?? "", entryDate: entrySelection.date,
      entryMax: String(entrySelection.maxScore) } : {};
    const params = new URLSearchParams({ from, to, subject, kind, missing: showMissing ? "1" : "0", tab });
    for (const [key, value] of Object.entries(entry)) params.set(key, value);
    for (const [key, value] of Object.entries(patch)) params.set(key, value);
    return `/exams?${params.toString()}`;
  };
  const month = to.slice(0, 7);
  const dayCounts = new Map<string, ExamDayItem>();
  for (const row of rows) {
    if (!row.date.startsWith(month)) continue;
    const key = `${row.date}:${row.kind}`;
    const item = dayCounts.get(key) ?? { date: row.date, kind: row.kind, label: KIND_LABEL[row.kind], count: 0,
      href: filteredHref({ tab: "records", from: row.date, to: row.date, kind: row.kind, page: "1" }) };
    item.count += 1;
    dayCounts.set(key, item);
  }
  const calendarItems = [...dayCounts.values()];
  const dayHref = Object.fromEntries(calendarItems.map((item) => [item.date, filteredHref({ tab: "records", from: item.date, to: item.date, kind: "all", page: "1" })]));
  const exportHref = `/api/exams/unified-export?${new URLSearchParams({ from, to, subject, kind, missing: showMissing ? "1" : "0" })}`;

  return <div className="space-y-6 pb-12">
    {/* 시간표처럼 창(임베드)에선 헤더 줄을 접어 탭 줄이 맨 위에 선다. */}
    <div className="compact-chrome:hidden"><PageHeader eyebrow="학생 관리" title="통합 성적관리" /></div>
    <FaceTabs ariaLabel="성적관리 면" active={tab} faces={TABS.map(([key, label]) => ({ key, label, href: filteredHref({ tab: key, page: "1" }) }))} />
    <ExamsToolbar from={from} to={to} subject={subject} kind={kind} missing={showMissing} exportHref={exportHref} entryMode={entryMode}
      entryHref={filteredHref({ entry: entryMode ? "0" : "1", page: "1", tab: "records" })}
      subjectOptions={data.subjects.map((key) => ({ value: key, label: subjectMaps.labelOf(key) }))}
      kindOptions={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />

    {tab === "overview" ? <section id="overview">
      <SectionHead title="전체 현황" description="기간에 포함된 모든 평가 출처를 함께 봅니다." />
      <div className="border-line grid grid-cols-2 border-y py-2 lg:grid-cols-4">
        <Stat label="응시 학생" value={`${students.length}명`} note="중복 학생 제외" />
        <Stat label="평가 평균" value={academy?.average == null ? "—" : `${academy.average}점`} note="만점이 있는 기록만 환산" />
        <Stat label="상승 / 하락" value={`${rows.filter((r) => (r.delta ?? 0) > 0).length} / ${rows.filter((r) => (r.delta ?? 0) < 0).length}`} note="동일 시험 종류의 직전 결과" />
        <Stat label="미입력" value={`${missingCount}건`} note="미입력 표시로 조회" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">학원 통합 추이</h3><p className="mt-1 text-xs">월별 평가 기록 평균 · 100점 환산</p><Trend points={academy?.points ?? []} /></article>
        <article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">먼저 확인할 학생</h3>
          <div className="mt-3 space-y-2">{rows.filter((r) => (r.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 5).map((row) =>
            <Link key={row.key} href={filteredHref({ student: row.studentId, tab: "student" })} className="border-line-faint flex justify-between gap-3 border-b py-2 text-sm"><span>{row.name} · {schoolGradeLabel(row.school, row.grade)}<small className="block text-xs">{KIND_LABEL[row.kind]} · {row.date}</small></span><b className="text-danger">↓{Math.abs(row.delta ?? 0)}{row.deltaUnit === "%p" ? "%p" : ""}</b></Link>)}
            {!rows.some((row) => (row.delta ?? 0) < 0) ? <p className="py-6 text-sm">하락 기록이 없습니다.</p> : null}
          </div>
        </article>
      </div>
    </section> : null}

    {tab === "records" ? <section id="records">
      <SectionHead title="성적 원장" description="기존 기록을 행에서 수정하고, 시험 명단을 열어 새 점수를 입력합니다." right={<span className="text-sm">{rows.length}개 기록</span>} />
      <NewTestForm students={data.students} subjects={data.subjects} date={to} canWrite={!writeError} />
      {sheet && entrySelection && entrySubjects ? <form action="/exams" className="border-line-faint mb-3 flex flex-wrap items-end gap-2 rounded-lg border p-3 text-sm">
        <input type="hidden" name="entry" value="1" /><input type="hidden" name="tab" value="records" /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        <input type="hidden" name="subject" value={subject} /><input type="hidden" name="kind" value={kind} />
        <label className="grid gap-1">년도<input name="entryYear" type="number" min="2000" max="2100" defaultValue={entrySelection.year} className="border-line w-24 rounded-md border bg-background p-2" /></label>
        <label className="grid gap-1">학기<select name="entryTerm" defaultValue={entrySelection.term} className="border-line rounded-md border bg-background p-2"><option value="1">1학기</option><option value="2">2학기</option></select></label>
        <label className="grid gap-1">과목<select name="entrySubject" defaultValue={axisValueOf(entrySelection)} className="border-line rounded-md border bg-background p-2">{entrySubjects.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="grid gap-1">시험<select name="entrySlot" defaultValue={entrySelection.slot} className="border-line rounded-md border bg-background p-2">{examSlotOptions(entrySelection.subject).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="grid gap-1">시험일<input name="entryDate" type="date" defaultValue={entrySelection.date} className="border-line rounded-md border bg-background p-2" /></label>
        <label className="grid gap-1">기본 만점<input name="entryMax" type="number" min="1" max="1000" step="1" defaultValue={entrySelection.maxScore} className="border-line w-24 rounded-md border bg-background p-2" /></label>
        <label className="grid gap-1">반<select name="entryClass" defaultValue={entrySelection.classId ?? ""} className="border-line rounded-md border bg-background p-2"><option value="">전체</option>{sheet.classes.map((item) => <option key={item.id} value={item.id}>{item.className}</option>)}</select></label>
        <button className="bg-primary rounded-md px-4 py-2 font-semibold text-white">명단 보기</button>
      </form> : null}
      <UnifiedLedger rows={pageRows} canWrite={!writeError} sheet={page === 1 ? sheet : null}
        studentClasses={data.studentClasses} consultationDates={data.consultationDates} />
      {writeError ? <p className="text-danger mt-2 text-sm">{writeError}</p> : null}
      {sheet && !sheet.schemaReady ? <p className="text-danger mt-2 text-sm">성적 표 준비(0283a)가 적용되어야 명단 점수를 저장할 수 있습니다.</p> : null}
      <div className="mt-3 flex items-center justify-between text-sm"><p>수업보고서 테스트일은 보고서 날짜와 연결됩니다.</p><div className="flex gap-2">{page > 1 ? <Link href={filteredHref({ page: String(page - 1) })}>이전</Link> : null}{rows.length > page * pageSize ? <Link href={filteredHref({ page: String(page + 1) })}>다음</Link> : null}</div></div>
    </section> : null}

    {tab === "student" ? <section id="student"><SectionHead title="학생 추이" description="학생별 시험과 상담 흐름을 확인합니다." right={selectedStudent ? <form action="/exams"><input type="hidden" name="tab" value="student" /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><input type="hidden" name="subject" value={subject} /><input type="hidden" name="kind" value={kind} /><select name="student" defaultValue={selectedStudent.studentId} className="border-line rounded-lg border bg-background p-2 text-sm">{students.map((row) => <option key={row.studentId} value={row.studentId}>{row.name} · {schoolGradeLabel(row.school, row.grade)}</option>)}</select><button className="border-line ml-2 rounded-lg border px-3 py-2 text-sm">보기</button></form> : null} /><div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]"><article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">{selectedStudent?.name ?? "학생"} 성적 흐름</h3><Trend points={aggregateBy(studentRows, "academy")[0]?.points ?? []} /></article><article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">최근 기록</h3><div className="mt-2 space-y-1">{studentRows.slice(0, 6).map((row) => <div key={row.key} className="border-line-faint flex justify-between gap-3 border-b py-2 text-sm"><span>{row.date} · {KIND_LABEL[row.kind]}</span><b><ScoreText row={row} /></b></div>)}</div></article></div></section> : null}

    {tab === "classes" ? <section id="classes"><SectionHead title="반별 분석" description="두 반을 듣는 학생은 각 반 분석에 포함하고 전체 평균에는 한 번만 셉니다." /><div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]"><article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">반별 평균</h3><div className="mt-2 max-h-72 overflow-auto">{classes.slice(0, 30).map((row) => <Link key={row.key} href={filteredHref({ cohortClass: row.key })} className={`border-line-faint flex justify-between gap-2 border-b py-2 text-sm ${selectedClass?.key === row.key ? "text-primary font-bold" : ""}`}><span className="truncate">{row.label} <small>({row.count}건)</small></span><strong>{row.average ?? "—"}</strong></Link>)}</div></article><article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">{selectedClass?.label ?? "반을 선택해 주세요"}</h3><p className="mt-1 text-sm">{selectedClass?.count ?? 0}건 · 평균 {selectedClass?.average ?? "—"}점</p><Trend points={selectedClass?.points ?? []} /></article></div></section> : null}

    {tab === "cohorts" ? <section id="cohorts">
      <SectionHead title="학교·학년 분석" description="학교와 학년을 각각 고르면 기간별 평균 변화를 확인할 수 있습니다." />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">학교별 추이 · {selectedSchool?.label ?? "—"}</h3>
          <div className="my-2 flex max-h-24 flex-wrap gap-1 overflow-auto">{schools.map((item) => <Link key={item.key} href={filteredHref({ schoolGroup: item.key })}
            className={`rounded-md border px-2 py-1 text-xs ${item.key === selectedSchool?.key ? "border-primary text-primary font-bold" : "border-line"}`}>{item.label}</Link>)}</div>
          <Trend points={selectedSchool?.points ?? []} />
        </article>
        <article className="border-line rounded-xl border p-5"><h3 className="text-base font-bold">학년별 추이 · {selectedGrade?.label ?? "—"}</h3>
          <div className="my-2 flex max-h-24 flex-wrap gap-1 overflow-auto">{grades.map((item) => <Link key={item.key} href={filteredHref({ gradeGroup: item.key })}
            className={`rounded-md border px-2 py-1 text-xs ${item.key === selectedGrade?.key ? "border-primary text-primary font-bold" : "border-line"}`}>{item.label}</Link>)}</div>
          <Trend points={selectedGrade?.points ?? []} />
        </article>
      </div>
      <div className="border-line overflow-x-auto rounded-xl border"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-bg-soft"><tr><th className="px-4 py-3">학교</th><th className="px-4 py-3">학년</th><th className="px-4 py-3">평균</th><th className="px-4 py-3">기록</th><th className="px-4 py-3">추이</th></tr></thead><tbody>{cohortRows.map((entry) => { const avg = averagePercent(entry.rows); const points = aggregateBy(entry.rows, "academy")[0]?.points ?? []; return <tr key={`${entry.school}:${entry.grade}`} className="border-line-faint border-t"><td className="px-4 py-3">{entry.school}</td><td className="px-4 py-3">{entry.grade}</td><td className="px-4 py-3 font-bold">{avg ?? "—"}점</td><td className="px-4 py-3">{entry.rows.length}건</td><td className="px-4 py-3">{points.map((point) => `${point.month.slice(5)}월 ${point.average}`).join(" → ") || "—"}</td></tr>; })}</tbody></table>{cohortRows.length === 0 ? <p className="p-8 text-center">비교할 점수 기록이 없습니다.</p> : null}</div>
    </section> : null}

    {tab === "schedule" ? <section id="schedule"><SectionHead title="시험 일정" description={`${Number(month.slice(5))}월 시험 기록 — 칸을 누르면 그날 성적 원장이 열립니다.`} /><ExamCalendar month={month} today={today} items={calendarItems} dayHref={dayHref} /></section> : null}
  </div>;
}
