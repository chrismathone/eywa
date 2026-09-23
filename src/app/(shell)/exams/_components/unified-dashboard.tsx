import { PageHeader } from "@/components/page-header";
import { FaceTabs } from "@/components/face-tabs";
import { gradeWriteError } from "@/features/grades/server/access";
import { getGradeSheet } from "@/features/grades/server/queries";
import { resolveGradeSelection } from "@/features/grades/selection";
import { axisValueOf } from "@/features/grades/subject-axis";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getUnifiedGrades } from "@/features/grades/unified/server/queries";
import { aggregateBy, KIND_LABEL, withPreviousScores, type UnifiedRow } from "@/features/grades/unified/model";
import { kstToday } from "@/lib/date-kst";
import { UnifiedLedger } from "./unified-ledger";
import { NewTestForm } from "./new-test-form";
import { ExamsToolbar } from "./exams-toolbar";
import { type ExamDayItem } from "./exam-calendar";
import { OverviewTab } from "./overview-tab";
import { RecordsPager } from "./records-tab";
import { EntryPicker } from "./entry-picker";
import { StudentTab } from "./student-tab";
import { ClassesTab } from "./classes-tab";
import { CohortsTab } from "./cohorts-tab";
import { ScheduleTab } from "./schedule-tab";

type Params = { from?: string; to?: string; subject?: string; kind?: string; missing?: string; student?: string; cohortClass?: string;
  schoolGroup?: string; gradeGroup?: string; page?: string; tab?: string; q?: string; month?: string;
  entry?: string; entryYear?: string; entryTerm?: string; entrySubject?: string; entrySlot?: string; entryClass?: string; entryDate?: string; entryMax?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string | undefined): value is string => {
  if (!value || !ISO.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const TABS = [["overview", "전체 현황"], ["records", "성적 원장"], ["student", "학생 추이"], ["classes", "반별 분석"], ["cohorts", "학교·학년"], ["schedule", "시험 일정"]] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (value: string | undefined): value is Tab => TABS.some(([key]) => key === value);
const PAGE_SIZE = 50;

function daysBefore(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}
/** 점수가 비어 있고 원문도 없는 기록(레벨테스트는 점수 대신 레벨이라 제외). */
const isBlank = (row: UnifiedRow) => row.score == null && row.source !== "level" && !row.rawScore;

/**
 * 통합 성적관리 — 여섯 면(`?tab=`)을 나누는 틀. 숫자는 전부 여기서 한 번 거른 `rows`에서 나온다
 * (면마다 따로 거르면 같은 기간·필터인데 면마다 건수가 달라진다). 면 그리기는 각 `*-tab.tsx`.
 */
export async function UnifiedDashboard({ searchParams }: { searchParams: Params }) {
  const today = kstToday();
  const to = validDate(searchParams.to) ? searchParams.to : today;
  const proposedFrom = validDate(searchParams.from) ? searchParams.from : daysBefore(to, 180);
  const from = proposedFrom <= to ? proposedFrom : to;
  const kind = searchParams.kind ?? "all";
  const subject = searchParams.subject ?? "all";
  const showMissing = searchParams.missing === "1";
  const q = (searchParams.q ?? "").trim();
  const entryMode = searchParams.entry === "1";
  const tab: Tab = isTab(searchParams.tab) ? searchParams.tab : entryMode ? "records" : "overview";
  // 시험 일정 면은 필터 기간과 따로 달을 넘긴다 — 그 달이 기간 밖이어도 비지 않게 조회 범위를 넓힌다.
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : to.slice(0, 7);
  const fetchFrom = tab === "schedule" && `${month}-01` < from ? `${month}-01` : from;
  const fetchTo = tab === "schedule" && monthEnd(month) > to ? monthEnd(month) : to;
  const [data, writeError, settings] = await Promise.all([getUnifiedGrades(fetchFrom, fetchTo), gradeWriteError(), getTenantSettings()]);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const entrySelection = entryMode ? resolveGradeSelection({
    year: searchParams.entryYear, term: searchParams.entryTerm,
    subject: searchParams.entrySubject ?? (data.subjects.includes("math") ? "math" : undefined),
    class: searchParams.entryClass, slot: searchParams.entrySlot, date: searchParams.entryDate, max: searchParams.entryMax,
  }, { subjectOptions: subjectMaps.options, todayIso: today }) : null;
  const sheet = entrySelection && tab === "records" ? await getGradeSheet(entrySelection) : null;

  const matches = (row: UnifiedRow) =>
    (kind === "all" || row.kind === kind) && (subject === "all" || row.subject === subject) && (!q || row.name.includes(q));
  const allRows = withPreviousScores(data.records).filter(matches);
  const filteredRows = allRows.filter((row) => row.date >= from && row.date <= to);
  const rows = filteredRows.filter((row) => showMissing || !isBlank(row));
  const missingCount = filteredRows.filter(isBlank).length;
  // 필터를 좁혀 마지막 페이지가 줄면 "101–40건" 같은 빈 화면이 된다 — 마지막 페이지로 당긴다.
  const page = Math.max(1, Math.min(Math.ceil(rows.length / PAGE_SIZE) || 1, Number(searchParams.page) || 1));

  const entryParams: Record<string, string> = entrySelection ? { entry: "1", entryYear: String(entrySelection.year), entryTerm: String(entrySelection.term),
    entrySubject: axisValueOf(entrySelection), entrySlot: entrySelection.slot, entryClass: entrySelection.classId ?? "", entryDate: entrySelection.date,
    entryMax: String(entrySelection.maxScore) } : {};
  const base: Record<string, string> = { from, to, subject, kind, missing: showMissing ? "1" : "0", tab, ...(q ? { q } : {}), ...entryParams };
  const href = (patch: Record<string, string>) => `/exams?${new URLSearchParams({ ...base, ...patch }).toString()}`;
  const exportHref = `/api/exams/unified-export?${new URLSearchParams({ from, to, subject, kind, missing: showMissing ? "1" : "0" })}`;

  const students = [...new Map(rows.map((row) => [row.studentId, row])).values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const selectedStudent = students.find((row) => row.studentId === searchParams.student) ?? students[0];
  const classes = aggregateBy(rows, "class");
  const schools = aggregateBy(rows, "school");
  const grades = aggregateBy(rows, "grade");

  const dayCounts = new Map<string, ExamDayItem>();
  for (const row of tab === "schedule" ? allRows : []) {
    if (!row.date.startsWith(month) || (!showMissing && isBlank(row))) continue;
    const key = `${row.date}:${row.kind}`;
    const item = dayCounts.get(key) ?? { date: row.date, kind: row.kind, label: KIND_LABEL[row.kind], count: 0,
      href: href({ tab: "records", from: row.date, to: row.date, kind: row.kind, page: "1" }) };
    item.count += 1;
    dayCounts.set(key, item);
  }
  const calendarItems = [...dayCounts.values()];
  const dayHref = Object.fromEntries(calendarItems.map((item) => [item.date, href({ tab: "records", from: item.date, to: item.date, kind: "all", page: "1" })]));

  return <div className="space-y-5 pb-12">
    {/* 시간표처럼 창(임베드)에선 헤더 줄을 접어 탭 줄이 맨 위에 선다. */}
    <div className="compact-chrome:hidden"><PageHeader eyebrow="학생 관리" title="통합 성적관리" /></div>
    <FaceTabs ariaLabel="성적관리 면" active={tab} faces={TABS.map(([key, label]) => ({ key, label, href: href({ tab: key, page: "1" }) }))} />
    <ExamsToolbar from={from} to={to} subject={subject} kind={kind} missing={showMissing} q={q} exportHref={exportHref} entryMode={entryMode}
      entryHref={href({ entry: entryMode ? "0" : "1", page: "1", tab: "records" })}
      subjectOptions={data.subjects.map((key) => ({ value: key, label: subjectMaps.labelOf(key) }))}
      kindOptions={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />

    {tab === "overview" ? <OverviewTab rows={rows} studentCount={students.length} academy={aggregateBy(rows, "academy")[0]} missingCount={missingCount} href={href} /> : null}

    {tab === "records" ? <div className="space-y-3">
      {sheet && entrySelection ? <EntryPicker selection={entrySelection} sheet={sheet} subjectOptions={subjectMaps.options}
        keep={{ from, to, subject, kind, ...(q ? { q } : {}) }} /> : null}
      <NewTestForm students={data.students} subjects={data.subjects.map((key) => ({ value: key, label: subjectMaps.labelOf(key) }))} date={to} canWrite={!writeError} />
      <RecordsPager page={page} pageSize={PAGE_SIZE} total={rows.length} href={href} note={showMissing ? "미입력 포함" : undefined} />
      <UnifiedLedger rows={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)} canWrite={!writeError} sheet={page === 1 ? sheet : null}
        studentClasses={data.studentClasses} consultationDates={data.consultationDates} />
      {writeError ? <p className="text-danger text-sm">{writeError}</p> : null}
      {sheet && !sheet.schemaReady ? <p className="text-danger text-sm">성적 표 준비(0283a)가 적용되어야 명단 점수를 저장할 수 있습니다.</p> : null}
      <RecordsPager page={page} pageSize={PAGE_SIZE} total={rows.length} href={href} note="수업보고서 테스트일은 보고서 날짜와 연결됩니다" />
    </div> : null}

    {tab === "student" ? <StudentTab students={students} selected={selectedStudent} href={href}
      rows={selectedStudent ? rows.filter((row) => row.studentId === selectedStudent.studentId) : []} /> : null}
    {tab === "classes" ? <ClassesTab classes={classes} rows={rows} href={href}
      selected={classes.find((row) => row.key === searchParams.cohortClass) ?? classes[0]} /> : null}
    {tab === "cohorts" ? <CohortsTab rows={rows} schools={schools} grades={grades} href={href}
      selectedSchool={schools.find((row) => row.key === searchParams.schoolGroup) ?? schools[0]}
      selectedGrade={grades.find((row) => row.key === searchParams.gradeGroup) ?? grades[0]} /> : null}
    {tab === "schedule" ? <ScheduleTab month={month} today={today} items={calendarItems} dayHref={dayHref} href={href} /> : null}
  </div>;
}
