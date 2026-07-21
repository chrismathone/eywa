import Link from "next/link";
import { ChevronLeft, ChevronRight, Clock, UserCheck, Users, UserX } from "@/components/icons/eywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { PhotoCard } from "@/components/atoms/photo-card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { kstMonth } from "@/lib/date-kst";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getMonthlyAttendanceMatrix, type AttendanceMatrix } from "@/features/attendance/server/queries";
import { getTeacherMoney } from "@/features/attendance/server/teacher-money";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { buildQuickOpen } from "@/features/attendance/quick-open";
import { QuickOpenPanel } from "./_components/quick-open-panel";
import { MatrixTable, type MatrixGroup } from "./_components/matrix-table";
import { attHref, type RangeKey, type ViewMode } from "./_components/att-href";

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
  searchParams: Promise<{
    class?: string;
    month?: string;
    range?: string;
    teacher?: string;
    subject?: string;
    mode?: string;
  }>;
}) {
  const user = await requireAccess("attendance");
  const {
    class: classParam,
    month: monthParam,
    range: rangeParam,
    teacher: teacherParam,
    subject: subjectParam,
    mode: modeParam,
  } = await searchParams;
  const month = monthParam ?? currentMonthKey();
  const range: RangeKey = rangeParam === "2w" ? "2w" : "month";
  const requestedMode: ViewMode = modeParam === "teacher" ? "teacher" : "class";

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

  // ── 보기 모드 ──
  // class(기본) = 반 하나. teacher = 그 강사의 모든 반을 반별 그룹으로 한 표에(급여 계산용, 구 출석부 관행).
  // ⚠️ 강사 전체 보기라도 **반별 보기와 같은 쿼리**(getMonthlyAttendanceMatrix)를 반마다 부른다 —
  //    급여에 쓰는 숫자라 두 화면이 다른 계산을 하면 안 된다(파생 규칙·시수 합 전부 한 소스).
  //    반 수만큼 병렬 호출이라 '전체 반'(108개)이 아니라 **한 강사분**(실측 최대 10반)일 때만 허용한다.
  const teacherClasses = effectiveTeacher
    ? allClasses.filter((c) => c.teacherId === effectiveTeacher)
    : [];
  const mode: ViewMode = requestedMode === "teacher" && teacherClasses.length > 0 ? "teacher" : "class";
  const teacherMatrices =
    mode === "teacher"
      ? await Promise.all(teacherClasses.map((c) => getMonthlyAttendanceMatrix(month, c.id)))
      : [];
  // 금액 열은 **원장 전용**(급여 PII 규율) — 강사가 자기 학생들의 청구·납입을 보게 하지 않는다.
  const money =
    mode === "teacher" && user.systemRole === "master" && effectiveTeacher
      ? await getTeacherMoney(
          month,
          effectiveTeacher,
          [...new Set(teacherMatrices.flatMap((m) => m.students.map((s) => s.id)))],
        )
      : null;
  // 매트릭스(무거운 출석 데이터)는 반을 골랐을 때만 로드. 미선택이면 base(빈 매트릭스) 재사용.
  const matrix =
    mode === "teacher"
      ? teacherMatrices[0] ?? base
      : effectiveClassId
        ? await getMonthlyAttendanceMatrix(month, effectiveClassId)
        : base;

  const groups: MatrixGroup[] =
    mode === "teacher"
      ? teacherClasses.map((c, i) => ({
          classId: c.id,
          className: c.className,
          subjectLabel: subjectMaps.labelOf(c.subject),
          matrix: teacherMatrices[i]!,
        }))
      : effectiveClassId && selectedClass
        ? [
            {
              classId: effectiveClassId,
              className: selectedClass.className,
              subjectLabel: subjectMaps.labelOf(selectedClass.subject),
              matrix,
            },
          ]
        : [];

  // 상단 스탯 — 강사 전체 보기는 반들을 합산(학생은 반 중복을 제거한 실인원).
  const stats =
    mode === "teacher"
      ? (() => {
          const ids = new Set(teacherMatrices.flatMap((m) => m.students.map((s) => s.id)));
          const sum = (pick: (s: AttendanceMatrix["stats"]) => number) =>
            teacherMatrices.reduce((acc, m) => acc + pick(m.stats), 0);
          const total = sum((s) => s.totalRecords);
          const present = sum((s) => s.presentCount);
          return {
            totalStudents: ids.size,
            presentRate: total > 0 ? Math.round((present / total) * 1000) / 10 : 0,
            absentCount: sum((s) => s.absentCount),
            lateCount: sum((s) => s.lateCount),
          };
        })()
      : matrix.stats;

  // 드롭다운 표시값 — 반 선택 시 그 반의 과목·강사를 강제로 채운다(누구 선생님인지 바로 보이게).
  const subjectValue = selectedClass ? selectedClass.subject : effectiveSubject;
  const teacherValue = selectedClass ? selectedClass.teacherId : effectiveTeacher;

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  // 2주 보기는 가로 컬럼을 줄이려 마지막 14일만 노출(출석률은 전체 기록 기준 유지).
  // 월 보기는 **항상 31칸**으로 패딩 — 28/30일 달도 뒤에 빈 칸(29~31)을 채워 컬럼 수를 일정하게 한다.
  // 그래야 셀 폭과 '출석률' 열 위치가 달마다 안 바뀐다(빈 칸은 여백). 패딩은 표시 전용(쿼리/집계 무관).
  const visibleDays = range === "2w" ? matrix.days.slice(-14) : padTo31(matrix.days);

  const teacherLabel = teacherOptions.find((t) => t.value === effectiveTeacher)?.label;
  const selectedClassLabel =
    mode === "teacher"
      ? `${teacherLabel ?? "강사"} 전체 · ${teacherClasses.length}개 반`
      : effectiveClassId
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
              href={attHref({ classId: effectiveClassId, month, range: key, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
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

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 보기 토글 — '강사 전체'는 그 강사의 모든 반을 반별로 묶어 한 표에(급여 계산용).
            강사 미선택이면 성립하지 않으므로 안내만 띄운다(렉 방지: '전체 반'은 여전히 안 연다). */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">보기</span>
          {effectiveTeacher ? (
            ([
              ["class", "반별"],
              ["teacher", "강사 전체"],
            ] as const).map(([key, label]) => (
              <Link
                key={key}
                href={attHref({
                  classId: key === "teacher" ? null : effectiveClassId,
                  month,
                  range,
                  teacherId: effectiveTeacher,
                  subjectId: effectiveSubject,
                  mode: key,
                })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  mode === key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {label}
              </Link>
            ))
          ) : (
            <span className="text-text-faint text-xs">강사를 고르면 전체 보기</span>
          )}
        </div>

      </div>

      {groups.length === 0 ? (
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
          {/* Stat 4 — 반(또는 강사 전체)을 열었을 때만 */}
          <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <BigStat label="등록 학생" value={stats.totalStudents} unit="명" tone="primary" icon={<Users size={16} strokeWidth={1.8} />} />
            <BigStat
              label="출석률"
              value={stats.presentRate}
              unit="%"
              tone={stats.presentRate >= 90 ? "primary" : stats.presentRate >= 80 ? "amber" : "danger"}
              icon={<UserCheck size={16} strokeWidth={1.8} />}
            />
            <BigStat label="결석" value={stats.absentCount} unit="회" tone="danger" icon={<UserX size={16} strokeWidth={1.8} />} />
            <BigStat label="지각" value={stats.lateCount} unit="회" tone="amber" icon={<Clock size={16} strokeWidth={1.8} />} />
          </section>

          {stats.totalStudents === 0 ? (
            <EmptyState
              image="students"
              icon={() => <Users size={32} strokeWidth={1.8} />}
              title={mode === "teacher" ? "이 강사의 반에 등록된 학생이 없습니다" : "이 반에 등록된 학생이 없습니다"}
              description="학생목록에서 등록 후 다시 확인하세요."
            />
          ) : (
            <>
              {/* 파생 반(수학)은 표가 "누가 찍은 값인지"를 스스로 밝혀야 한다 — 셀 툴팁만으론 안 보인다. */}
              {groups.some((g) => g.matrix.derivedActive) ? (
                <p className="text-text-dim bg-bg-soft/60 border-line rounded-2xl border px-4 py-2.5 text-xs break-keep">
                  수업보고서가 있는 등원일은 <strong className="text-foreground">출석</strong>, 보고서가 없는 등원일은{" "}
                  <strong className="text-foreground">결석</strong>으로 자동 표시됩니다. 오늘과 이후 날짜는 아직
                  판정하지 않습니다. <strong className="text-foreground">직접 찍은 값이 항상 우선</strong>이며, 셀을
                  클릭해 언제든 고칠 수 있습니다.
                </p>
              ) : null}
              <MatrixTable
                groups={groups}
                days={visibleDays}
                showGroups={mode === "teacher"}
                money={money}
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
