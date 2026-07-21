import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, UserCheck, Users, UserX } from "@/components/icons/eywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { PhotoCard } from "@/components/atoms/photo-card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { kstMonth } from "@/lib/date-kst";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  getMonthlyAttendanceMatrix,
  type AttendanceMatrix,
  type AttendanceStatus,
} from "@/features/attendance/server/queries";
import { COUNTABLE_STATUSES, formatSessionUnits } from "@/features/attendance/session-units";
import { buildHolidayMap, formatDows } from "@/features/attendance/calendar";
import { STATUS_TEXT, cellDisplay } from "@/features/attendance/cell-display";
import { buildQuickOpen } from "@/features/attendance/quick-open";
import { AttendanceCell } from "./_components/attendance-cell";
import { QuickOpenPanel } from "./_components/quick-open-panel";
import { attHref, type RangeKey } from "./_components/att-href";

export const metadata = { title: "출석부 — eywa" };

function currentMonthKey(): string {
  return kstMonth();
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y}년 ${Number(m)}월`;
}

// 월 보기를 항상 31칸으로 — 그 달 실제 일수 뒤에 placeholder 빈 칸을 채운다(예: 28일 달은 29~31 빈 칸).
// 컬럼 수를 31로 고정해 셀 폭과 '출석률' 열 위치가 달마다 일정해지게 한다.
function padTo31(days: AttendanceMatrix["days"]): AttendanceMatrix["days"] {
  if (days.length >= 31) return days;
  const out = [...days];
  for (let n = days.length + 1; n <= 31; n++) {
    out.push({ date: `pad-${n}`, day: n, dow: -1, label: "", isWeekend: false, isToday: false, placeholder: true });
  }
  return out;
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; month?: string; range?: string; teacher?: string; subject?: string }>;
}) {
  await requireAccess("attendance");
  const {
    class: classParam,
    month: monthParam,
    range: rangeParam,
    teacher: teacherParam,
    subject: subjectParam,
  } = await searchParams;
  const month = monthParam ?? currentMonthKey();
  const range: RangeKey = rangeParam === "2w" ? "2w" : "month";

  // 반 목록(경량) — classId 없이 부르면 무거운 출석 데이터는 안 불러온다(렉 방지). 과목→강사→반 계층·선택지 도출용.
  // 학원설정과는 서로 독립이라 병렬로(B4 — 독립 await는 Promise.all).
  const [base, { operations }] = await Promise.all([
    getMonthlyAttendanceMatrix(month, null),
    getTenantSettings(),
  ]);
  const allClasses = base.classes; // { id, className, subject, teacherId, teacherName }
  const subjectMaps = buildSubjectMaps(operations.subjects);

  // ── 과목 → 강사 → 반 계층(넓→좁). 위를 고르면 아래 선택지가 좁혀지는 cascade. ──
  // 과목(가장 큰 필터) 선택지 = 반에 실제 존재하는 과목(설정 순서 + 미등록 키는 라벨 폴백으로 뒤에).
  const presentSubjects = new Set(allClasses.map((c) => c.subject).filter(Boolean));
  const subjectOptions = [
    ...subjectMaps.options.filter((o) => presentSubjects.has(o.value)),
    ...[...presentSubjects]
      .filter((s) => !subjectMaps.options.some((o) => o.value === s))
      .map((s) => ({ value: s, label: subjectMaps.labelOf(s) })),
  ];
  const effectiveSubject = subjectParam && presentSubjects.has(subjectParam) ? subjectParam : null;

  // 강사 선택지 = (선택 과목의) 반 담임 distinct. 퇴직 담임은 반이 살아있는 한 유지하되
  // "(퇴직)"을 붙여 뒤로 정렬(재직자와 혼동 방지 — 담임 재배정이 끝나면 자연히 사라짐).
  const classesForSubject = effectiveSubject
    ? allClasses.filter((c) => c.subject === effectiveSubject)
    : allClasses;
  const teacherOptions = Array.from(
    new Map(
      classesForSubject
        .filter((c) => c.teacherId && c.teacherName)
        .map((c) => [
          c.teacherId as string,
          { name: c.teacherName as string, retired: !c.teacherActive },
        ]),
    ),
  )
    .map(([value, t]) => ({ value, label: t.retired ? `${t.name} (퇴직)` : t.name, retired: t.retired }))
    .sort((a, b) => Number(a.retired) - Number(b.retired) || a.label.localeCompare(b.label, "ko"))
    .map(({ value, label }) => ({ value, label }));
  const effectiveTeacher =
    teacherParam && teacherOptions.some((t) => t.value === teacherParam) ? teacherParam : null;

  // 반 선택지 = 과목 + 강사로 좁힌 반. ⚠️ 첫 반 자동선택 안 함 — 반 미선택 = 안내문구(렉 방지 + '전체' 정상 동작).
  const classesForFilters = classesForSubject.filter(
    (c) => !effectiveTeacher || c.teacherId === effectiveTeacher,
  );
  // ⚠️ hint를 반드시 넣는다(gotcha #84 후속): 옛 옵션은 `{value, label}`뿐이라 드롭다운 검색이 반 이름만
  // 매칭했는데, 수학반 이름엔 '수학'이 없어("고등M 고1 BS4A") **"수학"으로 검색해도 0건**이었다.
  // 이 드롭다운은 '바로 열기' 패널이 안내하는 탈출구라 여기서 막히면 갈 곳이 없다. hint는 검색 대상이자
  // 부가표시(SearchableSelect가 label·hint 양쪽을 매칭).
  const classOptions = classesForFilters.map((c) => ({
    value: c.id,
    label: c.className,
    hint: [subjectMaps.labelOf(c.subject), c.teacherName].filter(Boolean).join(" · "),
  }));
  const effectiveClassId =
    classParam && classesForFilters.some((c) => c.id === classParam) ? classParam : null;

  const selectedClass = effectiveClassId
    ? allClasses.find((c) => c.id === effectiveClassId) ?? null
    : null;
  // 매트릭스(무거운 출석 데이터)는 반을 골랐을 때만 로드. 미선택이면 base(빈 매트릭스) 재사용.
  const matrix = effectiveClassId ? await getMonthlyAttendanceMatrix(month, effectiveClassId) : base;

  // 드롭다운 표시값 — 반 선택 시 그 반의 과목·강사를 강제로 채운다(누구 선생님인지 바로 보이게).
  const subjectValue = selectedClass ? selectedClass.subject : effectiveSubject;
  const teacherValue = selectedClass ? selectedClass.teacherId : effectiveTeacher;

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  // 2주 보기는 가로 컬럼을 줄이려 마지막 14일만 노출(출석률은 전체 기록 기준 유지).
  // 월 보기는 **항상 31칸**으로 패딩 — 28/30일 달도 뒤에 빈 칸(29~31)을 채워 컬럼 수를 일정하게 한다.
  // 그래야 셀 폭과 '출석률' 열 위치가 달마다 안 바뀐다(빈 칸은 여백). 패딩은 표시 전용(쿼리/집계 무관).
  const visibleDays = range === "2w" ? matrix.days.slice(-14) : padTo31(matrix.days);

  const selectedClassLabel = effectiveClassId
    ? classOptions.find((o) => o.value === effectiveClassId)?.label
    : undefined;

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브. 선택 반·월이 서브로 요약된다. */}
      <PageHeader
        eyebrow="출결 관리"
        title="출석부"
        description={
          selectedClassLabel
            ? `${formatMonth(month)} · ${selectedClassLabel}`
            : "과목·선생님·반을 선택하면 그 반의 출석부가 열립니다"
        }
      />
      {/* Toolbar */}
      <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        {/* 과목 → 강사 → 반 계층 필터(넓→좁). 위를 고르면 아래 선택지가 좁혀지고, 반을 골라야 출석부가 뜬다.
            반 선택 시 과목·강사는 그 반의 값으로 자동 표시(누구 선생님인지 바로 보이게). */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">과목</span>
          <FilterSelect
            paramName="subject"
            value={subjectValue}
            options={subjectOptions}
            ariaLabel="과목 필터"
            allLabel="전체 과목"
          />
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />

        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">강사</span>
          <FilterSelect
            paramName="teacher"
            value={teacherValue}
            options={teacherOptions}
            ariaLabel="강사 필터"
            allLabel="전체 강사"
          />
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 반 dropdown — '전체 반'은 반 미선택(안내문구) */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">반</span>
          {/* cap 상향 — 기본 50이면 이름순 앞을 로마자 영어반이 독점해 목록을 훑을 때 수학반이 7개만
              보였다(gotcha #84). 반 목록은 수백 규모라 전량 렌더가 안전하고, 초과분은 hint 검색으로 도달. */}
          <FilterSelect
            paramName="class"
            value={effectiveClassId}
            options={classOptions}
            ariaLabel="반 필터"
            allLabel="전체 반"
            cap={300}
          />
        </div>

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 월 navigator */}
        <div className="flex items-center gap-1.5">
          <Link
            href={attHref({ classId: effectiveClassId, month: prevMonth, range, teacherId: effectiveTeacher, subjectId: effectiveSubject })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
            aria-label="이전 달"
          >
            <ChevronLeft className="size-3.5" />
          </Link>
          <span className="text-foreground min-w-[90px] text-center text-[13px] font-bold">
            {formatMonth(month)}
          </span>
          <Link
            href={attHref({ classId: effectiveClassId, month: nextMonth, range, teacherId: effectiveTeacher, subjectId: effectiveSubject })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
            aria-label="다음 달"
          >
            <ChevronRight className="size-3.5" />
          </Link>
        </div>

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 범위 토글 — 가로 컬럼 수 축소 */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">범위</span>
          {([
            ["month", "한 달"],
            ["2w", "2주"],
          ] as const).map(([key, label]) => (
            <Link
              key={key}
              href={attHref({ classId: effectiveClassId, month, range: key, teacherId: effectiveTeacher, subjectId: effectiveSubject })}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                range === key
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

      </div>

      {!effectiveClassId ? (
        // 반 미선택 허브(Editorial 문법 ④+⑤) — 무거운 출석 데이터를 안 불러오는 원칙은 유지하되,
        // 빈 화면 대신 사진 카드 + 반 바로가기 행 목록으로 "진입 허브"가 되게 한다.
        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch">
          <PhotoCard
            src="/photos/attendance-empty.webp"
            alt=""
            caption="한 반을 선택하면 출석부가 열립니다"
            sub="전체 반은 학생이 많아 한 번에 표시하지 않아요"
            aspect="3/2"
            sizes="(max-width: 1024px) 100vw, 40vw"
            className="h-full"
          />
          {/* ⚠️ 과목별 섹션 + 과목당 상한. 옛 코드는 `classesForFilters.slice(0, 8)`이었는데 반 목록이
              class_name 오름차순이라 로마자 영어반이 한글 수학반보다 항상 앞서 **수학반이 하나도 안 떴다**.
              그룹핑·상한은 `buildQuickOpen` 순수함수(Vitest)로 고정 — 어떤 과목도 0이 되지 않는다. */}
          <QuickOpenPanel
            {...buildQuickOpen(classesForFilters, subjectOptions)}
            colorOf={subjectMaps.colorOf}
            month={month}
            range={range}
            teacherId={effectiveTeacher}
            subjectId={effectiveSubject}
          />
        </section>
      ) : (
        <>
          {/* Stat 4 — 반을 선택했을 때만 */}
          <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <BigStat label="등록 학생" value={matrix.stats.totalStudents} unit="명" tone="primary" icon={<Users size={16} strokeWidth={1.8} />} />
            <BigStat
              label="출석률"
              value={matrix.stats.presentRate}
              unit="%"
              tone={
                matrix.stats.presentRate >= 90
                  ? "primary"
                  : matrix.stats.presentRate >= 80
                    ? "amber"
                    : "danger"
              }
              icon={<UserCheck size={16} strokeWidth={1.8} />}
            />
            <BigStat label="결석" value={matrix.stats.absentCount} unit="회" tone="danger" icon={<UserX size={16} strokeWidth={1.8} />} />
            <BigStat label="지각" value={matrix.stats.lateCount} unit="회" tone="amber" icon={<Clock size={16} strokeWidth={1.8} />} />
          </section>

          {matrix.students.length === 0 ? (
            <EmptyState
              image="students"
              icon={() => <Users size={32} strokeWidth={1.8} />}
              title="이 반에 등록된 학생이 없습니다"
              description="학생목록에서 등록 후 다시 확인하세요."
            />
          ) : (
            <>
              {/* 파생 반(수학)은 표가 "누가 찍은 값인지"를 스스로 밝혀야 한다 — 셀 툴팁만으론 안 보인다. */}
              {matrix.derivedActive ? (
                <p className="text-text-dim bg-bg-soft/60 border-line rounded-2xl border px-4 py-2.5 text-xs break-keep">
                  수업보고서가 있는 등원일은 <strong className="text-foreground">출석</strong>, 보고서가 없는 등원일은{" "}
                  <strong className="text-foreground">결석</strong>으로 자동 표시됩니다. 오늘과 이후 날짜는 아직
                  판정하지 않습니다. <strong className="text-foreground">직접 찍은 값이 항상 우선</strong>이며, 셀을
                  클릭해 언제든 고칠 수 있습니다.
                </p>
              ) : null}
              <MatrixTable
                matrix={matrix}
                days={visibleDays}
                selectedClassId={effectiveClassId}
                // 공휴일은 학원설정(operations.holidays)이 단일 소스 — 헤더 빨간 날짜·셀 회색 처리에 동기화.
                holidays={buildHolidayMap(operations.holidays)}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────── 매트릭스 테이블 ───────────────────

function MatrixTable({
  matrix,
  days,
  selectedClassId,
  holidays,
}: {
  matrix: AttendanceMatrix;
  days: AttendanceMatrix["days"];
  selectedClassId: string;
  /** "YYYY-MM-DD" → 휴일명(학원설정). 헤더는 빨간 날짜 + 툴팁, 본문은 회색(수업 없음). */
  holidays: Record<string, string>;
}) {
  const classDows = new Set(matrix.classDows);
  return (
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="bg-bg-soft border-line sticky left-0 z-10 border-b border-r px-3 py-2 text-left whitespace-nowrap">
              <span className="micro">이름</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-2 py-2 text-left whitespace-nowrap">
              <span className="micro">학년</span>
            </th>
            <th className="bg-bg-soft border-line border-b border-r px-2 py-2 text-left whitespace-nowrap">
              <span className="micro">학교</span>
            </th>
            {days.map((d) => {
              // 그 달에 없는 날 — 빈 여백(번호·요일 없음). 폭은 다른 날 칸과 동일(min-w)로 고정.
              if (d.placeholder) {
                return <th key={d.date} className="border-line bg-bg-soft/30 min-w-[34px] border-b border-r" aria-hidden />;
              }
              const holiday = holidays[d.date];
              const isClassDay = classDows.has(d.dow) && !holiday;
              // 배경 = 오늘 > 수업요일(브랜드 틴트) > 주말 > 평일. 글자색 = 일요일·공휴일이면 빨강(달력 관행).
              const bg = d.isToday
                ? "bg-primary"
                : isClassDay
                  ? "bg-primary-soft"
                  : d.isWeekend || holiday
                    ? "bg-bg-soft/70"
                    : "bg-bg-soft";
              const fg = d.isToday
                ? "text-primary-foreground"
                : holiday || d.dow === 0
                  ? "text-danger"
                  : isClassDay
                    ? "text-foreground"
                    : d.isWeekend
                      ? "text-text-faint"
                      : "text-text-dim";
              return (
                <th
                  key={d.date}
                  title={holiday ?? undefined}
                  className={`border-line num min-w-[34px] border-b border-r px-1 py-2 text-center text-[10px] ${bg} ${fg}`}
                >
                  <div className="font-bold">{d.day}</div>
                  <div className="opacity-70">{d.label}</div>
                </th>
              );
            })}
            {/* 시수 합 — 소비 상태(출석·지각·조퇴·보강) 셀의 배수 합(기본 1). 구 출석부 '합계' 관행. */}
            <th className="bg-bg-soft border-line sticky right-[64px] z-10 w-[52px] min-w-[52px] border-b border-l px-2 py-2 text-right whitespace-nowrap">
              <span className="micro">시수</span>
            </th>
            <th className="bg-bg-soft border-line sticky right-0 z-10 w-[64px] min-w-[64px] border-b px-2 py-2 text-right whitespace-nowrap">
              <span className="micro">출석률</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.students.map((s) => {
            const studentMarks = matrix.marks[s.id] ?? {};
            const studentUnits = matrix.units[s.id] ?? {};
            const recorded = Object.values(studentMarks);
            const present = recorded.filter((x) => x === "present").length;
            // 시수 합 = 소비 상태 셀의 배수 합(배수 미입력 = 1). 0.1 단위 반올림(부동소수 방어).
            const unitsTotal =
              Math.round(
                Object.entries(studentMarks)
                  .filter(([, st]) => COUNTABLE_STATUSES.has(st))
                  .reduce((sum, [date]) => sum + (studentUnits[date] ?? 1), 0) * 10,
              ) / 10;
            const rate =
              recorded.length > 0 ? Math.round((present / recorded.length) * 100) : null;
            const rateColor =
              rate === null
                ? "text-text-faint"
                : rate >= 90
                  ? "text-primary"
                  : rate >= 80
                    ? "text-amber"
                    : "text-danger";
            const attendDows = new Set(s.attendDows);
            const attendLabel = formatDows(s.attendDows);
            return (
              <tr key={s.id} className="hover:bg-bg-soft/40">
                {/* 이름 + 등원요일 — 같은 반이라도 학생마다 오는 요일이 다르다(분리등원). */}
                <td className="border-line text-foreground sticky left-0 z-10 border-b border-r bg-card px-3 py-2 text-[12px] font-bold whitespace-nowrap">
                  {s.name}
                  {attendLabel ? (
                    <span className="text-text-faint ml-1.5 text-[10px] font-medium">{attendLabel}</span>
                  ) : null}
                </td>
                <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px] whitespace-nowrap">
                  {s.grade ?? "—"}
                </td>
                <td className="border-line text-text-dim border-b border-r px-2 py-2 text-[11px] whitespace-nowrap">
                  {s.school ?? "—"}
                </td>
                {days.map((d) => {
                  // 그 달에 없는 날(placeholder) — 빈 칸(입력 불가). 폭은 다른 칸과 동일(min-w)로 고정.
                  if (d.placeholder) {
                    return (
                      <td key={d.date} className="border-line bg-bg-soft/20 min-w-[34px] border-b border-r" aria-hidden />
                    );
                  }
                  const mark = (studentMarks[d.date] as AttendanceStatus | undefined) ?? null;
                  const holiday = holidays[d.date];
                  // 등원요일 = 그 학생이 실제로 오는 날(분리등원 반영) — 공휴일은 휴원이라 제외.
                  const attend = attendDows.has(d.dow) && !holiday;
                  // 배경(음영·틴트)은 셀을 꽉 채우는 AttendanceCell 버튼이 그린다 — td는 relative 무대만
                  // 제공한다(고정 크기 칩에 배경을 주면 셀을 못 채운다, gotcha #66).
                  return (
                    <td
                      key={d.date}
                      className="border-line relative min-w-[34px] border-b border-r p-0 text-center align-middle"
                    >
                      <AttendanceCell
                        studentId={s.id}
                        classId={selectedClassId}
                        sessionDate={d.date}
                        initialStatus={mark}
                        note={matrix.notes[s.id]?.[d.date] ?? null}
                        initialUnits={studentUnits[d.date] ?? null}
                        attendDay={attend}
                        muted={!!holiday || (!attend && d.isWeekend)}
                        derived={!!matrix.derived[s.id]?.[d.date]}
                      />
                    </td>
                  );
                })}
                <td className="border-line text-foreground sticky right-[64px] z-10 w-[52px] min-w-[52px] border-b border-l bg-card px-2 py-2 text-right num text-[12px] whitespace-nowrap">
                  {unitsTotal > 0 ? formatSessionUnits(unitsTotal) : "—"}
                </td>
                <td
                  className={`border-line sticky right-0 z-10 w-[64px] min-w-[64px] border-b bg-card px-2 py-2 text-right num text-[12px] font-bold whitespace-nowrap ${rateColor}`}
                >
                  {rate === null ? "—" : `${rate}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            {/* 범례 1행: 좌측 요약 노트 + 우측(ml-auto) 범례 Pill 가로 나열(좁으면 가로 스크롤, 줄바꿈 X) */}
            <td
              colSpan={days.length + 5}
              className="bg-bg-soft border-line border-t px-3 py-2"
            >
              <div className="flex items-center gap-2 overflow-x-auto text-[11px] [&>*]:shrink-0 [&_*]:whitespace-nowrap">
                <span className="text-text-faint text-[11px]">
                  총 {matrix.stats.totalRecords}회 기록 · 셀 클릭 시 즉시 변경 (출석·지각·조퇴·보강 = 시수, 결석 = 0)
                </span>
                <span className="micro ml-auto">범례</span>
                {/* 범례 칩은 셀과 **같은 함수**로 그린다 — 색·숫자가 실제 셀과 어긋날 수 없게. */}
                {(["present", "late", "early_leave", "makeup", "absent"] as AttendanceStatus[]).map((s) => {
                  const chip = cellDisplay(s, null);
                  return (
                    <span key={s} className="text-text-dim inline-flex items-center gap-1">
                      <span
                        className={`inline-flex size-5 items-center justify-center rounded-sm text-[10px] font-bold ${chip.className}`}
                      >
                        {chip.text}
                      </span>
                      {STATUS_TEXT[s]}
                    </span>
                  );
                })}
                <span className="text-text-dim inline-flex items-center gap-1">
                  <span className="bg-primary-softer border-line inline-block size-5 rounded-sm border" />
                  등원요일
                </span>
                <span className="text-text-dim inline-flex items-center gap-1">
                  <span className="bg-bg-soft/50 border-line inline-block size-5 rounded-sm border" />
                  휴일·수업없음
                </span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </DragScrollArea>
  );
}


