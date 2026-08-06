import Link from "next/link";
import { ChevronLeft, ChevronRight, Users } from "@/components/icons/eywa-icon-compat";
import { PhotoCard } from "@/components/atoms/photo-card";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getMonthlyAttendanceMatrix, type AttendanceMatrix } from "@/features/attendance/server/queries";
import { getTeacherMoney } from "@/features/attendance/server/teacher-money";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { ATTENDANCE_EDIT_WINDOW_DAYS } from "@/features/attendance/edit-window";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { loadAttendanceViewPrefs } from "@/features/attendance/server/prefs-actions";
import { buildQuickOpen } from "@/features/attendance/quick-open";
import { countMarks, sumCounts } from "@/features/attendance/grid/totals";
import { isGroupedSort, sortAttendanceRows } from "@/features/attendance/sort-rows";
import { getSubjectSessionsByStudent, roleFor } from "@/features/attendance/server/subject-sessions";
import { AttendanceSortSelect } from "./_components/sort-select";
import { QuickOpenPanel } from "./_components/quick-open-panel";
import { MatrixTable, buildGridSource, type MatrixGroup } from "./_components/matrix-table";
import { GridProvider } from "./_components/grid-context";
import { LiveStats } from "./_components/live-totals";
import { attHref, resolveViewMode, type ViewMode } from "./_components/att-href";

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
    teacher?: string;
    subject?: string;
    mode?: string;
  }>;
}) {
  const user = await requireAccess("attendance");
  const {
    class: classParam,
    month: monthParam,
    teacher: teacherParam,
    subject: subjectParam,
    mode: modeParam,
  } = await searchParams;
  const month = monthParam ?? currentMonthKey();
  // 강사(또는 강사뷰 겸직)인지 — 기본 진입 화면을 가른다. 캐시된 헬퍼라 쿼리가 늘지 않는다.
  const myTeacherId = await effectiveTeacherId();
  /**
   * 기본 보기 — **강사는 자기 전체 출석부로 바로 들어간다**(구 출석부 D:\attendance와 같은 진입:
   * 선생님 계정은 자기 시트가 통째로 열리고 반은 접었다 폈다 한다). 목록에서 자기 반을 하나씩 골라
   * 들어가게 하면 매번 두 번 클릭이고, 반을 옮겨 다니며 출결을 찍는 실제 동선과도 안 맞는다.
   * ⚠️ 반을 명시한 링크(`class=`)와 명시적 `mode=`는 그대로 존중한다. 관리자는 종전대로 선택 허브.
   */
  const requestedMode: ViewMode = resolveViewMode({
    modeParam,
    classParam,
    isTeacher: !!myTeacherId,
  });

  // 반 목록(경량) — classId 없이 부르면 무거운 출석 데이터는 안 불러온다(렉 방지). 과목→강사→반 계층·선택지 도출용.
  // 학원설정·보기설정과는 서로 독립이라 병렬로(B4 — 독립 await는 Promise.all).
  const [base, { operations }, viewPrefs] = await Promise.all([
    getMonthlyAttendanceMatrix(month, null),
    getTenantSettings(),
    loadAttendanceViewPrefs(),
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
  // 강사는 자기 자신이 기본 선택 — 자기 이름을 드롭다운에서 다시 고르게 하지 않는다.
  // (강사 계정의 반 목록은 이미 본인 반으로 좁혀져 있어 선택지도 자기 하나뿐이다.)
  const effectiveTeacher =
    teacherParam && teacherOptions.some((t) => t.value === teacherParam)
      ? teacherParam
      : myTeacherId && teacherOptions.some((t) => t.value === myTeacherId)
        ? myTeacherId
        : null;

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
  // ⚠️ `allClasses`가 아니라 **과목으로 좁힌 목록**에서 고른다 — 안 그러면 과목 칩을 눌러도 전체 보기엔
  //    다른 과목 반이 그대로 남아 필터가 거짓말을 한다(강사가 기본으로 이 화면에 들어오면서 더 잘 보인다).
  const teacherClasses = effectiveTeacher
    ? classesForSubject.filter((c) => c.teacherId === effectiveTeacher)
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
  // ⚠️ 출결 수치는 **격자와 같은 함수**(`countMarks`)로 센다. 화면이 입력 즉시 다시 셀 때 서버 첫 렌더가
  //    다른 식을 쓰면 첫 타이핑에 숫자가 한 번 튄다 — 합계는 `grid/totals.ts` 한 곳만 거친다.
  const statsCount = sumCounts(
    groups.map((g) =>
      sumCounts(
        g.matrix.students.map((s) =>
          countMarks(g.matrix.marks[s.id] ?? {}, g.matrix.units[s.id] ?? {}),
        ),
      ),
    ),
  );
  // 등록 학생만 출결과 무관한 고정값 — 강사 전체 보기는 반 중복을 제거한 실인원.
  const totalStudents =
    mode === "teacher"
      ? new Set(teacherMatrices.flatMap((m) => m.students.map((s) => s.id))).size
      : matrix.stats.totalStudents;

  // 드롭다운 표시값 — 반 선택 시 그 반의 과목·강사를 강제로 채운다(누구 선생님인지 바로 보이게).
  const subjectValue = selectedClass ? selectedClass.subject : effectiveSubject;
  const teacherValue = selectedClass ? selectedClass.teacherId : effectiveTeacher;

  /**
   * 강사(또는 겸직 강사뷰)의 툴바 — **자기 출석부인데 '누구 반?'을 매번 고르게 하지 않는다**(원장 지시 2026-08-06).
   * 답이 늘 '나 / 전체 과목 / 전체 반'인 드롭다운 3개가 툴바 절반을 먹고 있었다.
   * ⚠️ 단 **반 드롭다운은 남긴다** — 오히려 강사의 유일한 반 선택 수단이다(원장 지시 2026-08-06
   *    "반별 → 드롭다운 리스트로"). '전체 반'이 자기 전체 시트, 반을 고르면 그 반. '보기(반별/전체)'
   *    토글은 이 드롭다운과 뜻이 겹치고 사진 허브로 보내기만 해서 강사에겐 감춘다(관리자는 유지 —
   *    관리자에겐 '강사 전체'라는 별개 의미가 있다).
   *    · 과목은 그 강사가 **두 과목 이상**을 맡을 때만(한 과목이면 고를 게 없다).
   */
  const isTeacherView = !!myTeacherId;
  const mySubjectCount = myTeacherId
    ? new Set(allClasses.filter((c) => c.teacherId === myTeacherId).map((c) => c.subject)).size
    : 0;
  const showSubjectFilter = !isTeacherView || mySubjectCount > 1;
  const showTeacherFilter = !isTeacherView;
  const showViewToggle = !isTeacherView;

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  // 출석부는 **언제나 그 달 전체**다(원장 지시 2026-08-06 — '2주' 범위 토글 폐기). 항상 31칸으로 패딩해
  // 28/30일 달도 뒤에 빈 칸(29~31)을 채운다 → 셀 폭과 '출석률' 열 위치가 달마다 안 바뀐다.
  // 패딩은 표시 전용(쿼리/집계 무관). ⚠️ 범위 축소 옵션을 다시 넣지 말 것.
  const visibleDays = padTo31(matrix.days);

  /**
   * 행 정렬(원장 지시 2026-08-06) — 계정 설정이 단일 소스(URL 파라미터 아님, `ui_prefs.attendance.sort`).
   * ⚠️ 정렬은 **서버에서** 확정해 `buildGridSource`와 표에 **같은 배열**로 넘긴다. 표만 다르게 그리면
   *    격자 좌표(방향키·Shift 범위·드래그 채우기)가 화면과 어긋난다(sort-rows.ts 주석).
   */
  const sortKey = viewPrefs.sort;
  const subjectOfClass = new Map(
    (mode === "teacher" ? teacherClasses : selectedClass ? [selectedClass] : []).map((c) => [c.id, c.subject]),
  );
  /**
   * 담임/부담임은 **누구 기준인지**가 있어야 성립한다. 강사(또는 강사 필터)면 그 사람, 관리자가 반만
   * 골랐으면 **그 반의 담당**이 기준이다.
   * ⚠️ 기준을 못 정하면 전원이 판정 불가가 되어 '담임순'이 사실상 가나다순으로 동작한다 — 이름만 있고
   *    하는 일이 없는 거짓 옵션이 된다(적대 리뷰 2026-08-06).
   */
  const roleAnchorTeacher = effectiveTeacher ?? selectedClass?.teacherId ?? null;
  // 담임·부담임 정렬일 때만 남의 반까지 조회한다 — 평소 출석부에 쿼리 3개를 얹지 않는다(반응속도 1순위).
  const roleSessions =
    sortKey === "role" && roleAnchorTeacher && groups.length > 0
      ? await getSubjectSessionsByStudent(
          [...new Set(groups.flatMap((g) => g.matrix.students.map((s) => s.id)))],
          kstToday(),
        )
      : null;
  const orderedRows = sortAttendanceRows(
    groups.flatMap((g) =>
      g.matrix.students.map((s) => ({
        classId: g.classId,
        className: g.className,
        studentId: s.id,
        name: s.name,
        grade: s.grade,
        role: roleSessions
          ? roleFor(roleSessions, s.id, subjectOfClass.get(g.classId) ?? null, roleAnchorTeacher)
          : null,
      })),
    ),
    sortKey,
  );

  // 시트 격자의 좌표·초기값 — 표보다 위(상단 스탯)까지 감싸야 해서 여기서 만든다.
  const gridSource = buildGridSource(groups, visibleDays, orderedRows);

  // 수정 가능 기간 — 강사(scoped)는 KST 오늘 기준 7일 이내만. 관리자 이상(full)은 제한 없음(원장 2026-07-21).
  // ⚠️ 역할을 코드로 나열하지 않고 권한 매트릭스를 읽는다(#58) — 원장이 역할 권한을 조정하면 함께 따라간다.
  // ⚠️ 이건 화면 편의일 뿐 진짜 게이트는 서버 액션이다(#77).
  const scopedAttendance = (await accessLevelTenant(user.systemRole, "attendance")) === "scoped";
  const lockBefore = scopedAttendance
    ? new Date(Date.parse(`${kstToday()}T00:00:00Z`) - (ATTENDANCE_EDIT_WINDOW_DAYS - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10)
    : null;

  /**
   * 안내문 3종 — 예전엔 표 위에 **상시 배너**로 펼쳐져 매일 세로 ~90px을 먹었다(원장 지시 2026-08-06로 접음).
   * 내용·조건은 그대로 두고 툴바의 '안내' 토글 안으로만 옮긴다 — 한 번 읽으면 되는 설명이라 상주시킬 이유가 없고,
   * 잠긴 칸은 셀 툴팁이, 자동판정은 셀 색이 이미 말해 준다.
   */
  const noticeClass = "text-text-dim bg-bg-soft/60 border-line rounded-xl border px-3 py-2 text-xs break-keep";
  const notices =
    groups.length === 0 || totalStudents === 0
      ? []
      : [
          lockBefore ? (
            <p key="lock" className={noticeClass}>
              출결 수정은 <strong className="text-foreground">최근 {ATTENDANCE_EDIT_WINDOW_DAYS}일</strong>
              (오늘 포함 {lockBefore} 이후)만 가능합니다. 그보다 지난 날짜는 잠기며, 수정이 필요하면 관리자에게
              요청하세요.
            </p>
          ) : null,
          // 기록이 하나도 없는 화면은 **왜 비어 있는지**를 말해야 한다 — 빈 표 + "—"만 두면 고장으로 읽힌다.
          // 파생도 안 도는 과목(현재 영어)이 여기 해당한다.
          statsCount.recorded === 0 && !groups.some((g) => g.matrix.derivedActive) ? (
            <p key="empty" className={noticeClass}>
              {/* ⚠️ 강사 전체 보기는 반이 여럿이라 "이 반"이 거짓말이 된다(적대검증) — 모드에 맞춰 주어를 바꾼다. */}
              {mode === "teacher" ? "담당 반에" : "이 반은"} 아직{" "}
              <strong className="text-foreground">출결 기록이 없습니다</strong>. 수업보고서로 자동 표시되는 과목이
              아니라서, 셀을 직접 클릭해 찍은 값만 쌓입니다.
            </p>
          ) : null,
          // 파생 반(수학)은 표가 "누가 찍은 값인지"를 스스로 밝혀야 한다 — 셀 툴팁만으론 안 보인다.
          groups.some((g) => g.matrix.derivedActive) ? (
            <p key="derived" className={noticeClass}>
              수업보고서가 있는 등원일은 <strong className="text-foreground">출석</strong>, 보고서가 없는 등원일은{" "}
              <strong className="text-foreground">결석</strong>으로 자동 표시됩니다. 오늘과 이후 날짜는 아직 판정하지
              않습니다. <strong className="text-foreground">직접 찍은 값이 항상 우선</strong>이며, 셀을 클릭해 언제든
              고칠 수 있습니다.
            </p>
          ) : null,
        ].filter(Boolean);

  const teacherLabel = teacherOptions.find((t) => t.value === effectiveTeacher)?.label;
  // 툴바에 실리는 대상 표기. 자기 출석부를 보는 강사에겐 자기 이름이 노이즈라 반 개수만 남긴다.
  const selectedClassLabel =
    mode === "teacher"
      ? myTeacherId && myTeacherId === effectiveTeacher
        ? `${teacherClasses.length}개 반`
        : `${teacherLabel ?? "강사"} 전체 · ${teacherClasses.length}개 반`
      : effectiveClassId
        ? classOptions.find((o) => o.value === effectiveClassId)?.label
        : undefined;

  return (
    // 🔴 **스크롤은 격자 하나뿐**이다(원장 지시 2026-08-06) — 페이지(<main>)는 안 움직이고 화면 높이에 딱 맞춘 뒤
    // 남는 높이를 격자가 통째로 가져간다(`min-h-0 flex-1`). 이 배치라야 표 헤더 sticky가 성립한다
    // (가로 스크롤 컨테이너가 sticky 기준을 가로채기 때문 — matrix-table.tsx 주석).
    //
    // 🔴 **위에서 먹는 1px = 학생 행 1px**이라 상단 크롬을 툴바 한 줄로 몰았다(원장 지시 2026-08-06
    // "상단 공간낭비 심한 것부터"). 걷어낸 것: PageHeader(셸 탑바가 이미 '…· 출석부'를 찍는 중복 85px),
    // BigStat 카드 4장(→ 툴바 우측 한 줄), 상시 안내문 2개(→ '안내' 토글). 총 ~230px 회수.
    // ⚠️ 여기에 새 줄(배너·설명·요약 카드)을 얹지 말 것 — 그 높이는 전부 학생 행에서 빼 오는 것이다.
    //
    // `pb-3`은 border-box라 총 높이를 늘리지 않는다(늘리면 페이지 스크롤이 되살아난다) — 아래 숨돌릴 여백만 확보.
    //
    // ⚠️ GridProvider가 **툴바까지** 감싼다 — 합계(LiveStats)가 툴바로 올라갔기 때문. 칸을 치면 출석률·결석·
    //    지각이 그 자리에서 따라 움직이려면 툴바가 격자 저장소를 구독해야 한다(DOM은 안 만드는 컨텍스트라 무비용).
    <GridProvider
      rows={gridSource.rows}
      cols={gridSource.cols}
      initial={gridSource.initial}
      lockBefore={lockBefore}
      initialCollapsed={viewPrefs.collapsed}
    >
      <div className="flex h-full min-h-0 flex-col gap-3 pb-3">
      {/* Toolbar — 월/범위/보기(+관리자 필터) 좌측, 살아있는 합계 우측. 이 화면의 유일한 크롬 줄. */}
      <div className="bg-card shadow-card relative flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5">
        {/* 과목 → 강사 → 반 계층 필터(넓→좁). 위를 고르면 아래 선택지가 좁혀지고, 반을 골라야 출석부가 뜬다.
            반 선택 시 과목·강사는 그 반의 값으로 자동 표시(누구 선생님인지 바로 보이게). */}
        {showSubjectFilter ? (
          <>
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
          </>
        ) : null}

        {showTeacherFilter ? (
          <>
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
          </>
        ) : null}

        {/* 반 dropdown — 강사에겐 **반 선택의 유일한 수단**('전체 반' = 자기 전체 시트, 반 = 그 반).
            관리자에게 '전체 반'은 종전대로 반 미선택(=선택 허브, 반 108개를 한 번에 안 여는 렉 방지). */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">반</span>
          {/* cap 상향 — 기본 50이면 이름순 앞을 로마자 영어반이 독점해 목록을 훑을 때 수학반이 7개만
              보였다(gotcha #84). 반 목록은 수백 규모라 전량 렌더가 안전하고, 초과분은 hint 검색으로 도달. */}
          <FilterSelect
            paramName="class"
            value={effectiveClassId}
            options={classOptions}
            ariaLabel="반 필터"
            allLabel={isTeacherView ? "전체 반(내 반 전부)" : "전체 반"}
            cap={300}
          />
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 월 navigator */}
        <div className="flex items-center gap-1.5">
          <Link
            href={attHref({ classId: effectiveClassId, month: prevMonth, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
            aria-label="이전 달"
          >
            <ChevronLeft className="size-3.5" />
          </Link>
          <span className="text-foreground min-w-[90px] text-center text-[13px] font-bold">
            {formatMonth(month)}
          </span>
          <Link
            href={attHref({ classId: effectiveClassId, month: nextMonth, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border"
            aria-label="다음 달"
          >
            <ChevronRight className="size-3.5" />
          </Link>
        </div>

        {/* 보기 토글 — **관리자 전용**. '강사 전체'는 그 강사의 모든 반을 반별로 묶어 한 표에(급여 계산용).
            강사 본인에겐 반 드롭다운과 뜻이 겹쳐(그리고 '반별'이 사진 허브로 보내서) 감춘다. */}
        {showViewToggle ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
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
          </>
        ) : null}

        {/* 정렬 — 계정 귀속 설정(URL 아님). 반별 외엔 반 구분 없이 한 덩어리로 그린다. */}
        {groups.length > 0 ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <div className="flex items-center gap-1.5">
              <span className="micro mr-1">정렬</span>
              <AttendanceSortSelect value={sortKey} />
            </div>
          </>
        ) : null}

        {/* 대상 표기 — PageHeader의 서브라인이 하던 몫(반 이름 / N개 반). 세로 줄 대신 툴바 한 칸으로. */}
        {selectedClassLabel ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <span className="text-text-dim truncate text-xs font-medium">{selectedClassLabel}</span>
          </>
        ) : null}

        {/* 우측 — 살아있는 합계 + 안내 토글. **새 줄을 만들지 않고** 툴바의 남는 가로 여백을 쓴다. */}
        <div className="ml-auto flex items-center gap-3">
          {groups.length > 0 ? <LiveStats totalStudents={totalStudents} fallback={statsCount} /> : null}
          {notices.length > 0 ? (
            // `<details>`라 클라 JS가 없다. 패널은 absolute라 열려도 격자를 밀어내지 않는다(높이 0 유지).
            <details className="[&_summary::-webkit-details-marker]:hidden">
              <summary className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft list-none cursor-pointer rounded-full border px-2.5 py-0.5 text-xs">
                안내 {notices.length}
              </summary>
              <div className="border-line bg-card absolute top-full right-4 z-40 mt-1 w-[min(560px,calc(100vw-3rem))] space-y-2 rounded-2xl border p-3 shadow-lg">
                {notices}
              </div>
            </details>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        // 반 미선택 허브(Editorial 문법 ④+⑤) — 무거운 출석 데이터를 안 불러오는 원칙은 유지하되,
        // 빈 화면 대신 사진 카드 + 반 바로가기 행 목록으로 "진입 허브"가 되게 한다.
        // 허브도 같은 규칙 — 넘치면 이 영역만 스크롤한다(페이지 스크롤을 되살리지 않는다).
        <section className="grid min-h-0 flex-1 gap-4 overflow-auto lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch">
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
            teacherId={effectiveTeacher}
            subjectId={effectiveSubject}
          />
        </section>
      ) : totalStudents === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState
            image="students"
            icon={() => <Users size={32} strokeWidth={1.8} />}
            title={mode === "teacher" ? "이 강사의 반에 등록된 학생이 없습니다" : "이 반에 등록된 학생이 없습니다"}
            description="학생목록에서 등록 후 다시 확인하세요."
          />
        </div>
      ) : (
        // 남은 높이를 전부 격자에 — `min-h-0`이 없으면 flex 아이템의 최소 크기가 콘텐츠(수십 행)라
        // 줄지 않아 화면 밖으로 넘치고 결국 페이지 스크롤이 되살아난다(= 스크롤바 2개).
        // `isolate` — 표 헤더의 높은 z(50/60)를 격자 안에 가둔다. 안 그러면 그 z가 페이지 전역과 겨뤄
        // 툴바 드롭다운·셀 팝오버를 헤더가 덮는다(스택 컨텍스트만 만들 뿐 fixed 탈출은 막지 않는다).
        <div className="isolate min-h-0 flex-1">
          <MatrixTable
            groups={groups}
            days={visibleDays}
            ordered={orderedRows}
            // 반 머리행은 **반별 정렬 + 강사 전체 보기**일 때만. 가나다·학년·담임순은 반 구분을 없앤다.
            showGroups={mode === "teacher" && isGroupedSort(sortKey)}
            money={money}
            lockBefore={lockBefore}
            // 공휴일은 학원설정(operations.holidays)이 단일 소스 — 헤더 빨간 날짜·셀 회색 처리에 동기화.
            holidays={buildHolidayMap(operations.holidays)}
          />
        </div>
      )}
      </div>
    </GridProvider>
  );
}
