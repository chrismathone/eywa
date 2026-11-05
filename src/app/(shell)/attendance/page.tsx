import { redirect } from "next/navigation";
import { Users } from "@/components/icons/aywa-icon-compat";
import { PeriodNav } from "@/components/period-nav";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { HrefSelect } from "@/components/href-select";
import {
  USABLE_SEAT_KEYS,
  SEAT_KEYS,
  SEAT_NAME,
  SEAT_ROOM,
  parseSeatFilterValue,
  seatFilterValue,
} from "@/features/attendance/seat/seat";
import { findMakeupPoolClass } from "@/features/attendance/server/makeup-pool";
import { MAKEUP_POOL_PREFIX } from "@/features/classes/makeup-pool";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { kstMonth, kstToday, monthRange } from "@/lib/date-kst";
import { classTaughtBy, teacherSheetClasses } from "@/features/attendance/teacher-sheet-classes";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getDailyProcessingStatus, getMonthlyAttendanceMatrix, type AttendanceMatrix } from "@/features/attendance/server/queries";
import { getTeacherMoney } from "@/features/attendance/server/teacher-money";
import { getMonthlyClassWorkers } from "@/features/attendance/server/class-worker-queries";
import { classWorkerLabel } from "@/features/attendance/class-worker";
import { getAttendanceClassBilledAmounts, mergeAttendanceClassBilling } from "@/features/attendance/server/class-billing";
import { attendanceNoInvoiceRows } from "@/features/attendance/class-billing";
import { canShowAttendanceActualAmount } from "@/features/attendance/server/actual-amount-access";
import { monthBounds } from "@/features/attendance/enrollment-span";
import { getAttendanceSalaryRates } from "@/features/attendance/server/salary-rates";
import { SalaryRatesButton } from "./_components/salary-rates-button";
import { SalaryVisibleButton } from "./_components/salary-visible-button";
import { UnitsMasterButton } from "./_components/units-master-button";
import { canViewUnitsMaster } from "@/features/attendance/server/units-master";

import { buildHolidayMap } from "@/features/attendance/calendar";
import { attendanceUnitSuffix } from "@/features/attendance/unit-suffix";
import { ATTENDANCE_EDIT_WINDOW_DAYS } from "@/features/attendance/edit-window";
import { accessLevelTenant, canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { AbsenceIntakeButton } from "./_components/absence-intake-button";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
// 출결 강사 귀속 축 단일 소스 — 담임(classes.teacher_id)만 보면 교시 담당 강사가 자기 수업을 못 본다.
import { getHomeroomSinceIndex } from "@/features/classes/server/teacher-as-of-queries";
import { homeroomSinceOf } from "@/features/classes/teacher-as-of";
import { loadAttendanceViewPrefs } from "@/features/attendance/server/prefs-actions";
import { PeriodModeToggle } from "./_components/period-mode-toggle";
import { countMarks, sumCounts } from "@/features/attendance/grid/totals";
import { isGroupedSort, sortAttendanceRows } from "@/features/attendance/sort-rows";
import { getSubjectSessionsByStudent, roleFor } from "@/features/attendance/server/subject-sessions";
import { AttendanceSortSelect } from "./_components/sort-select";
import { HideRetiredToggle } from "./_components/hide-retired-toggle";
import { AttendanceHub, type HubHoliday, type HubTeacher } from "./_components/attendance-hub";
// 휴원일 판정(학원설정 휴일 목록만)과 그날 실제 입력 — 오늘 출결·운영실과 같은 두 함수.
import { holidayNameOrNull } from "@/features/attendance/server/holiday";
import { getHolidayDayActivity } from "@/features/attendance/server/holiday-activity";
import { holidayActivityCounts } from "@/features/attendance/holiday-activity";
import { reportError } from "@/lib/observability/report-error";
import { MatrixTable, buildGridSource, type MatrixGroup } from "./_components/matrix-table";
import { AttendanceLegend } from "./_components/attendance-legend";
import { GridProvider } from "./_components/grid-context";
import { AttendanceScopeProvider } from "./_components/scope-context";
import { AttendanceSearchProvider, AttendanceSearchToggle } from "./_components/search-context";
import { HubStudentSearch } from "./_components/hub-student-search";
import { readSearchSeed } from "./_components/att-search-seed";
import { loadHubStudentSearch } from "@/features/attendance/server/hub-search-queries";
import { rowKey } from "@/features/attendance/grid/model";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { CollapseAllChip } from "./_components/class-group";
import { LiveStats } from "./_components/live-totals";
import { attHref, resolveViewMode, type ViewMode } from "./_components/att-href";
import { PayslipWindowButton } from "./_components/payslip-window-button";
import { ClassMonthPrintButton } from "./_components/class-month-print-button";
import { canViewPayslipNow } from "@/features/payroll/server/payslip-gate";
// 강사 미니셸이면 화면 언어를 따른다(원장 2026-09-04 "강사가 접근 가능한 모든 메뉴를 전환").
// 🔴 이름 축은 각각의 단일 소스를 통과시킨다 — 반 `classNameFor` · 정렬 `attendanceSortLabelOf`.
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import {
  sheetMonthLabel,
  sheetT,
  sheetTf,
  type SheetLang,
} from "@/features/teacher-view/i18n";
import { classNameFor } from "@/features/teacher-view/class-name";
import { periodWindowLabel } from "@/features/periods/window-label";
import { attendanceLabelOf } from "@/features/class-sheets/lib/attendance-label";
import { PAGE_TITLE_SUFFIX } from "@/lib/config/site-metadata";
import { loadSubstituteCells } from "@/features/attendance/server/substitute-cells";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { SubstituteCellsNote } from "./_components/substitute-cells-note";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "att.title")}${PAGE_TITLE_SUFFIX}` };
}

function currentMonthKey(): string {
  return kstMonth();
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(month: string, lang: SheetLang = "ko"): string {
  const [y, m] = month.split("-");
  return sheetMonthLabel(month, `${y}년 ${Number(m)}월`, lang);
}

/** "2026-08-10" → "8/10" — 반 머리행 칩처럼 좁은 자리용(연도는 그 표가 이미 말한다). */
function dayLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
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

/**
 * 이 반을 그 달에 가르치는 사람들 — **담임 ∪ 교시 담당**(축 단일 소스, 2026-08-18).
 * 종전엔 담임뿐이라 교시 담당 강사의 출석부가 통째로 비어 있었다(Florence Park = 담임 0반·교시 5반).
 */
function classTeachers(c: AttendanceMatrix["classes"][number]): { id: string; name: string; active: boolean }[] {
  const out = new Map<string, { id: string; name: string; active: boolean }>();
  if (c.teacherId && c.teacherName) {
    out.set(c.teacherId, { id: c.teacherId, name: c.teacherName, active: c.teacherActive });
  }
  for (const t of c.slotTeachers) if (!out.has(t.id)) out.set(t.id, t);
  for (const t of c.historicalTeachers ?? []) if (!out.has(t.id)) out.set(t.id, t);
  return [...out.values()];
}


/**
 * 요약 허브(강사 미선택)의 강사 목록 — 강사별 반 수·과목·**오늘 입력 현황**.
 * 오늘 현황은 getDailyProcessingStatus(일별 처리 현황과 같은 소스) 한 번 — 허브가 뜰 때만 부른다.
 * ⚠️ 그 조회는 테넌트 전체(오늘 수업 반)라, 화면의 과목 필터로 좁힌 `classes`에 든 반만 집계에 넣는다.
 * 오늘 예정·입력은 강사 출석부와 같은 교시 담당 기준. 남의 교시 기록을 담임 카드에 합산하지 않는다.
 */
async function buildHubTeachers(
  classes: AttendanceMatrix["classes"],
  subjectOrder: { value: string; label: string }[],
): Promise<HubTeacher[]> {
  const today = await getDailyProcessingStatus(kstToday());
  const teachersOfClass = new Map(classes.map((c) => [c.id, classTeachers(c)]));
  const order = subjectOrder.map((s) => s.value);

  type Acc = HubTeacher & { subjectSet: Set<string> };
  const byTeacher = new Map<string, Acc>();
  for (const c of classes) {
    for (const t of teachersOfClass.get(c.id) ?? []) {
      const cur =
        byTeacher.get(t.id) ??
        ({
          id: t.id,
          name: t.name,
          retired: !t.active,
          classCount: 0,
          subjects: [],
          today: null,
          subjectSet: new Set<string>(),
        } as Acc);
      cur.classCount++;
      if (c.subject) cur.subjectSet.add(c.subject);
      byTeacher.set(t.id, cur);
    }
  }
  for (const r of today) {
    for (const t of teachersOfClass.get(r.classId) ?? []) {
      const acc = byTeacher.get(t.id);
      if (!acc) continue;
      const own = r.byTeacher?.find((count) => count.teacherId === t.id);
      if (!own || own.expected === 0) continue;
      const cur = acc.today ?? { classes: 0, doneClasses: 0, expected: 0, recorded: 0 };
      cur.classes++;
      cur.expected += own.expected;
      cur.recorded += own.recorded;
      if (own.recorded >= own.expected) cur.doneClasses++;
      acc.today = cur;
    }
  }
  return [...byTeacher.values()]
    .map(({ subjectSet, ...t }) => ({
      ...t,
      // 과목 순서 = 학원설정 순서(subjectOrder). 설정에 없는 키는 뒤에.
      subjects: [...subjectSet].sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
      }),
    }))
    .sort((a, b) => Number(a.retired) - Number(b.retired) || a.name.localeCompare(b.name, "ko"));
}

/**
 * 요약 허브의 **휴원일 줄** — 오늘이 학원설정 휴일이면 그 이름과 "실제로 입력된 것"(학생 수·반 수·보강 예약 건수).
 *
 * 🔴 휴원일엔 처리 현황(`getDailyProcessingStatus`)이 비어서 예정 인원·완료 수가 없다. 그 자리에 분모 없이 입력된 사실만
 *    적는다 — "5/22명"·"완료 0개 반"·100% 같은 표기는 쉬는 날에 맞지 않는다(오늘 출결은 같은 날 통째로 비어 있다).
 * 🔴 숫자는 오늘 출결 휴원일 화면·운영실과 **같은 조회**(`getHolidayDayActivity`)다 — 강사(겸직 강사뷰 포함)는 자기 반만,
 *    과목 칩을 골랐으면 그 과목 반만 센다(이 화면이 보여 주는 반 범위와 같게).
 * ⚠️ 조회 실패는 `activity: null`로 내려가 "불러오지 못했습니다"로 적힌다(0명으로 접지 않는다). 휴일 판정 실패는
 *    평일로 본다(처리 현황과 같은 fail-soft — 두 판정이 갈리지 않게 같은 함수).
 */
async function loadHubHoliday(subject: string | null): Promise<HubHoliday | null> {
  const today = kstToday();
  const name = await holidayNameOrNull(today);
  if (!name) return null;
  const activity = await getHolidayDayActivity(today, false, subject)
    .then(holidayActivityCounts)
    .catch((error: unknown) => {
      reportError(error, { scope: "attendance.hub.holidayActivity", date: today });
      return null;
    });
  return { name, activity };
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
    /**
     * 학생 검색 **씨앗**(2026-08-20) — 허브에서 학생을 눌러 들어오면 그 학생 줄만 남은 채 열린다.
     * ⚠️ 저장이 아니다(ui_prefs에 안 남는다). 화면에서 검색어를 바꾸면 주소창에서 따라 바뀌고,
     *    비우면 떨어진다([att-search-seed.ts](./_components/att-search-seed.ts)).
     */
    q?: string;
  }>;
}) {
  const user = await requireAccess("attendance");
  /**
   * 화면 주인 — 강사뷰(다른 강사 뷰)면 검증된 대상 강사, 아니면 `user`(실제 계정)와 같다.
   * 🔴 원장 전용 금액(정산액)·급여명세서 버튼은 **이 사람의 역할·명단**으로 판정한다 — 실제 계정(원장)으로 보면
   *    강사 X의 출석부에 X가 볼 수 없는 정산액·명세서 버튼이 섰다(2026-11-05 강사뷰 신원 점검).
   */
  const viewer = (await getCurrentUser({ teacherView: true })) ?? user;
  const {
    class: classParam,
    month: monthParam,
    teacher: teacherParam,
    subject: subjectParam,
    mode: modeParam,
    q: qParam,
  } = await searchParams;
  // 씨앗은 한 곳에서 정리한다(앞뒤 공백·길이) — 화면·링크·주소창이 같은 문자열을 본다.
  const searchSeed = readSearchSeed(qParam);
  // 강사 드롭다운에서 자리(랩실·JJ실)를 고르면 자리 화면으로 보낸다 — 같은 강사 축의 다른 갈래라
  // 메뉴를 새로 열지 않고 화면만 바꾼다(원장 2026-08-14 "따로 빼지말고").
  const seatPick = parseSeatFilterValue(teacherParam);
  if (seatPick) redirect(`/attendance/seat/${seatPick}`);

  const month = monthParam ?? currentMonthKey();
  // 강사(또는 강사뷰 겸직)인지 — 기본 진입 화면을 가른다. 캐시된 헬퍼라 쿼리가 늘지 않는다.
  const myTeacherId = await effectiveTeacherId();
  // 보기 모드 판정(resolveViewMode)은 **검증된 반**(effectiveClassId)이 나온 뒤에 한다 — 아래 참조.

  // 반 목록(경량) — classId 없이 부르면 무거운 출석 데이터는 안 불러온다(렉 방지). 과목→강사→반 계층·선택지 도출용.
  // 학원설정·보기설정과는 서로 독립이라 병렬로(B4 — 독립 await는 Promise.all).
  const [base, tenantSettings, viewPrefs] = await Promise.all([
    getMonthlyAttendanceMatrix(month, null),
    getTenantSettings(),
    loadAttendanceViewPrefs(),
  ]);
  const { operations } = tenantSettings;
  // 꺼진 기능(모듈)의 칸·버튼은 이 화면에 없다(원장 2026-09-30 "꺼지면 있었는지조차 모르게") —
  // 자리 출석부(허브 카드·자리 선택) · 급여(실급여·단가·급여명세서) · 회차 정산(확정 회차·단가 칸) · EiE(범례 문구).
  const seatOn = isModuleEnabled(tenantSettings.modules.disabled, "seat_attendance");
  const payrollOn = isModuleEnabled(tenantSettings.modules.disabled, "payroll");
  const sessionBillingOn = isModuleEnabled(tenantSettings.modules.disabled, "session_billing");
  const eieOn = isModuleEnabled(tenantSettings.modules.disabled, "eie");
  const allClasses = base.classes; // { id, className, subject, teacherId, teacherName }
  // 특강 토글(0133a) — 표식 규칙이 반마다 읽는다. 목록 쪽 타입엔 없어 반 목록 원본에서 되짚는다.
  const matrixClassById = new Map(base.classes.map((c) => [c.id, c]));
  const subjectMaps = buildSubjectMaps(operations.subjects);

  // ── 과목 → 강사 → 반 계층(넓→좁). 위를 고르면 아래 선택지가 좁혀지는 cascade. ──
  // 과목(가장 큰 필터) 선택지 = 반에 실제 존재하는 과목(설정 순서 + 미등록 키는 라벨 폴백으로 뒤에).
  const lang = await getTeacherViewLang();
  const presentSubjects = new Set(allClasses.map((c) => c.subject).filter(Boolean));
  const subjectOptions = [
    ...subjectMaps.options.filter((o) => presentSubjects.has(o.value)),
    ...[...presentSubjects]
      .filter((s) => !subjectMaps.options.some((o) => o.value === s))
      .map((s) => ({ value: s, label: subjectMaps.labelOf(s) })),
  ];
  const effectiveSubject = subjectParam && presentSubjects.has(subjectParam) ? subjectParam : null;

  // 강사 선택지 = (선택 과목의) 반을 **실제로 가르치는 사람** distinct — 담임 ∪ 교시 담당(2026-08-18).
  // 종전엔 담임뿐이라 교시 담당만 하는 강사는 드롭다운에 이름조차 없었다(그 사람 출석부로 갈 길이 없었다).
  // 퇴직 강사는 반이 살아있는 한 유지하되 "(퇴직)"을 붙여 뒤로 정렬(재직자와 혼동 방지).
  const classesForSubject = effectiveSubject
    ? allClasses.filter((c) => c.subject === effectiveSubject)
    : allClasses;
  const allTeacherOptions = Array.from(
    new Map(
      classesForSubject
        .flatMap((c) => classTeachers(c))
        .map((t) => [t.id, { name: t.name, retired: !t.active }]),
    ),
  )
    .map(([value, t]) => ({
      value,
      label: t.retired ? sheetTf(lang, "att.teacher.retiredName", { name: t.name }) : t.name,
      retired: t.retired,
    }))
    .sort((a, b) => Number(a.retired) - Number(b.retired) || a.label.localeCompare(b.label, "ko"));
  /**
   * 퇴직 담임 숨김(원장 2026-08-14) — **강사 축에서만** 감춘다. 그 반은 반 드롭다운에 그대로 남는다
   * (담임이 퇴직해도 재원생은 계속 다니므로 반까지 감추면 출석을 찍을 길이 사라진다).
   * ⚠️ **이미 고른 강사는 감추지 않는다** — URL에 남은 선택이 목록에서 사라지면 화면이 요약 허브로
   *    튕겨 "방금 보던 출석부가 없어졌다"가 된다.
   */
  const retiredCount = allTeacherOptions.filter((t) => t.retired).length;
  /**
   * 강사 드롭다운 = **선생님 → 자리(랩실·JJ실) → 퇴직 선생님** 세 갈래(원장 2026-08-14:
   * *"따로 빼지말고 퇴직처럼 구분해서 그 아래 LAB실 JJ실"*).
   * 자리는 메뉴가 아니라 **강사 축의 한 갈래**다 — 사이드바 항목은 그래서 없앴다(navigation.ts 주석).
   * 값은 uuid와 안 겹치는 `seat:` 접두사를 태우고, 고르면 아래에서 자리 화면으로 보낸다.
   * ⚠️ 과목 필터가 영어가 아닐 땐 자리를 숨긴다 — 자리는 영어관 운영이라 수학 화면에 뜨면 노이즈다.
   */
  const showSeats = seatOn && (!effectiveSubject || effectiveSubject === "english");
  const seatOptions = showSeats
    ? SEAT_KEYS.map((k) => ({
        value: seatFilterValue(k),
        label: `${SEAT_NAME[k]} ${SEAT_ROOM[k]}`,
        hint: sheetT(lang, "att.seat.hint"),
      }))
    : [];
  const teacherOptions = [
    ...allTeacherOptions
      .filter((t) => !t.retired)
      .map(({ value, label }) => ({ value, label })),
    ...seatOptions,
    ...allTeacherOptions
      // ⚠️ 이미 고른 강사는 숨김이어도 남긴다 — 목록에서 사라지면 보던 출석부가 허브로 튕긴다.
      .filter((t) => t.retired && (!viewPrefs.hideRetired || t.value === teacherParam))
      .map(({ value, label }) => ({ value, label, hint: sheetT(lang, "att.retired") })),
  ];
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
    (c) => !effectiveTeacher || classTaughtBy(c, effectiveTeacher),
  );
  // ⚠️ hint를 반드시 넣는다(gotcha #84 후속): 옛 옵션은 `{value, label}`뿐이라 드롭다운 검색이 반 이름만
  // 매칭했는데, 수학반 이름엔 '수학'이 없어("고등M 고1 BS4A") **"수학"으로 검색해도 0건**이었다.
  // 이 드롭다운은 '바로 열기' 패널이 안내하는 탈출구라 여기서 막히면 갈 곳이 없다. hint는 검색 대상이자
  // 부가표시(SearchableSelect가 label·hint 양쪽을 매칭).
  // 🔴 반 이름은 표기만 옮긴다(`classNameFor` 단일 소스) — **값은 id**라 매칭·URL은 안 바뀐다.
  const classOptions = classesForFilters.map((c) => ({
    value: c.id,
    label: classNameFor(c.className, lang),
    hint: [subjectMaps.labelOf(c.subject), c.teacherName].filter(Boolean).join(" · "),
  }));
  const effectiveClassId =
    classParam && classesForFilters.some((c) => c.id === classParam) ? classParam : null;

  const selectedClass = effectiveClassId
    ? allClasses.find((c) => c.id === effectiveClassId) ?? null
    : null;

  /**
   * 기본 보기 — **모두 강사 전체가 기본**(원장 2026-08-10 "디폴트를 강사전체"), 반을 골랐을 때만 반별.
   * · 강사: 자기 전체 시트로 바로(2026-08-06, 반 선택은 반 드롭다운 하나).
   * · 관리자: 강사 드롭다운에서 고르면 바로 그 강사 전체 출석부. 강사 미선택이면 아래 mode 폴백이
   *   요약 허브(반별)로 되돌린다. 명시적 '반별'(mode=class)은 존중.
   * 🔴 raw `classParam`이 아니라 **검증된 반**(effectiveClassId)을 넘긴다 — 강사를 바꾸면 이전 강사의
   *    반이 URL에 남는데(FilterSelect는 다른 param 보존), 그 죽은 값으로 반별에 갇히면 안 된다.
   *    (2026-08-10 버그 제보: mode=teacher가 남아 반 선택이 안 먹히던 것도 이 재배선으로 함께 해소 —
   *    이제 반이 정해지면 mode보다 반이 이긴다.)
   */
  const requestedMode: ViewMode = resolveViewMode({
    modeParam,
    classParam: effectiveClassId ?? undefined,
    isTeacher: !!myTeacherId,
  });

  // ── 보기 모드 ──
  // class(기본) = 반 하나. teacher = 그 강사의 모든 반을 반별 그룹으로 한 표에(급여 계산용, 구 출석부 관행).
  // ⚠️ 강사 전체 보기라도 **반별 보기와 같은 쿼리**(getMonthlyAttendanceMatrix)를 반마다 부른다 —
  //    급여에 쓰는 숫자라 두 화면이 다른 계산을 하면 안 된다(파생 규칙·시수 합 전부 한 소스).
  //    반 수만큼 병렬 호출이라 '전체 반'(108개)이 아니라 **한 강사분**(실측 최대 10반)일 때만 허용한다.
  // ⚠️ `allClasses`가 아니라 **과목으로 좁힌 목록**에서 고른다 — 안 그러면 과목 칩을 눌러도 전체 보기엔
  //    다른 과목 반이 그대로 남아 필터가 거짓말을 한다(강사가 기본으로 이 화면에 들어오면서 더 잘 보인다).
  // 🔴 **담임 반이 아니라 "그 강사가 가르치는 반"**(담임 ∪ 교시 담당, 2026-08-18 원장 제보 수정).
  //    영어는 한 반의 교시를 여러 강사가 나눠 맡아서, 담임으로만 묶으면 실제로 출결을 찍은 강사의
  //    출석부엔 그 반이 없고 담임 출석부에만 있다("담임 출결로 인정"으로 보이던 것의 정체).
  // 🔑 판정은 [`teacher-sheet-classes.ts`](@/features/attendance/teacher-sheet-classes) 한 벌 — 프리랜서 명세서가 같은 목록으로
  //    그 강사 출석부를 조립한다(화면 합계와 명세서 금액이 갈리지 않게).
  const taughtClasses = effectiveTeacher
    ? classesForSubject.filter((c) => classTaughtBy(c, effectiveTeacher))
    : [];
  // 보기 모드는 **가르치는 반이 있는가**로 정한다(종전 그대로) — 아래에서 그 달 표에 설 반을 더 거르더라도 강사 보기는 유지한다
  // (그 달 반이 전부 빠진 강사도 보강 묶음·대신 보강 목록은 이 보기에서만 보인다).
  const mode: ViewMode = requestedMode === "teacher" && taughtClasses.length > 0 ? "teacher" : "class";
  /**
   * 강사 계정의 **반별 보기**도 그 강사 출석부다(원장 2026-09-17 *"내 출석부에서 고치는건데 남의 출석부를 건드리는건
   * 아니지. 그냥 내 출석부 상에서 자유롭게 숫자 설정만 하는거야."*) — 반 하나를 골라도 강사 전체 보기와 **같은 렌즈**
   * (그 강사가 맡은 교시의 기록만)로 그리고, 저장도 같은 판정을 지난다(`attendanceScope`). 그전엔 반별 보기로 바꾸면
   * 그 렌즈가 없어 남의 교시 기록(ECS 입력 포함)을 그날 칸 저장으로 덮을 수 있었다.
   * ⚠️ 입력은 **모든 날짜**에 열려 있다(원장 2026-09-17 저녁 — 보강). 수업요일은 색으로만 갈린다(`ownDates`).
   * ⚠️ 관리자가 강사 드롭다운으로 고른 반별 보기는 해당 없다(`myTeacherId`는 로그인한 강사 본인뿐 — 관리자는 반 전체).
   */
  const classScopeTeacher =
    mode === "class" && myTeacherId && selectedClass && classTaughtBy(selectedClass, myTeacherId) ? myTeacherId : null;
  /**
   * **담임이 되기 전 기록**을 그 강사 표에서 뺀다(원장 제보 2026-08-19: *"김주현 선생님이 출결한것도
   * 아닌데 보이는것도 같이 수정해야겠네."*). `classes.teacher_id`는 현재 담임이라 시간 축이 없어서,
   * 인계(8/10·8/14) 이전에 **전임이 넣은** 기록까지 새 담임 출석부에 잡혔다.
   *
   * 🔴 **담임 폴백으로 잡힌 반만** 대상이다 — 교시 담당(`slot`)·겸임(`both`)은 그 사람이 실제로 그날
   *    그 교시를 가르쳤으므로 가리면 안 된다(그게 이 화면이 2026-08-18에 넓어진 이유다).
   * 🔴 근거(인수인계·담임 변경 감사로그)가 없으면 `null` → **아무것도 숨기지 않는다**(폴백이 안전벨트).
   * ⚠️ 반별 보기·급여 별지에는 넘기지 않는다 — 반 관점에선 그 기록이 맞고, 돈 축은 담임 그대로다.
   */
  const homeroomSinceIdx =
    (mode === "teacher" && effectiveTeacher) || classScopeTeacher ? await getHomeroomSinceIndex() : null;
  /**
   * 강사 전체 보기의 **반 목록** — 역할(담임 / 교시 담당) · 담임 시작일 · 표에 설 반을 한 번에 정한다(`teacherSheetClasses`).
   *
   * 🔴 **그 달이 끝난 뒤에 담임이 된 반은 표에 세우지 않는다**(원장 2026-10-06, 9월 표에 `10/6부터 담임` 반이 선 캡처:
   *    *"10/6부터 담임인데 왜 벌써 출석부에 나오는거야? … 월내에 포함되지 않는 수업은 출석부에서 미표시하도록"*).
   *    그 달엔 그 사람 칸이 하나도 없는데(담임 전 날짜는 이미 뺀다) 반 줄·청구액·등록 차수만 서서 차이확인이 전부 빨강이었다.
   *    담임 폴백 반만 해당하고(교시 담당·그 달의 이전 담임은 그대로), 인수인계 기록이 없으면 아무것도 빼지 않는다.
   * 🔴 **표시만 거른다** — 아래 티어 정산액(`money`)의 반 범위는 종전 그대로 현재 담임 반 전부다(`moneyClasses`, 명세서·정산 면과
   *    같은 집합이라야 금액이 맞는다). 표에 없는 반의 시수가 정산액에 들어 있으면 `moneyNote`가 그 사실을 적는다.
   */
  const sheetScope = teacherSheetClasses({
    classes: classesForSubject,
    teacherId: effectiveTeacher,
    window: monthRange(month),
    sinceIdx: homeroomSinceIdx,
  });
  const teacherRoles = sheetScope.roles;
  const sinceByClass = sheetScope.sinceByClass;
  const teacherClasses = sheetScope.classes;
  /** 표에서 뺀 반(그 달 뒤에 담임이 된 반) — 표시는 안 하지만 티어 정산액의 반 범위에는 종전대로 남는다. */
  const laterClasses = taughtClasses.filter((c) => !teacherClasses.includes(c));
  const teacherMatrices =
    mode === "teacher"
      // ⚠️ 강사 전체 보기는 여러 반을 **한 표**에 그리는데 세션은 과목별이라 반마다 기간이 다를 수 있다.
      //    첫 반의 날짜축으로 나머지를 그리면 엉뚱한 칸에 출결이 찍히므로 1단계는 달력월로 고정한다
      //    (화면 라벨에 그 사실을 적는다 — 조용히 다르게 보이면 안 된다).
      // 🔴 네 번째 인자 = **이 표의 주인**. 넘기지 않으면 칸 숫자가 그날 모든 교시의 합이라, 한 교시만
      //    가르친 강사의 출석부에 남의 교시까지 잡힌다(원장 제보 2026-08-18: 8/10 김근호가 이다교 선생님
      //    출석부에 3 — 실제 이다교 몫은 1). 귀속 판정은 resolveTaughtBy 단일 소스가 한다.
      ? await Promise.all(
          teacherClasses.map((c) =>
            getMonthlyAttendanceMatrix(month, c.id, "month", effectiveTeacher, sinceByClass.get(c.id) ?? null),
          ),
        )
      : [];
  // 표에서 뺀 반의 명단 — 티어 정산액(원장 전용)이 종전과 같은 학생 집합을 보게 하는 재료일 뿐이다(그리지 않는다). 대부분 0개.
  const laterMatrices =
    mode === "teacher" && viewer.systemRole === "master" && payrollOn
      ? await Promise.all(
          laterClasses.map((c) =>
            getMonthlyAttendanceMatrix(month, c.id, "month", effectiveTeacher, sinceByClass.get(c.id) ?? null),
          ),
        )
      : [];
  /**
   * 학생 전체 청구·납입 및 급여 정산은 **원장 전용**. 강사에게도 보이는 반별 청구액은 아래 별도 조회다.
   *
   * 🔴 **금액·정산액의 축은 담임 그대로다**(2026-08-18에 표시 축만 넓혔다). 위 `teacherClasses`가
   *    교시 담당 반까지 품게 됐으므로 여기서 다시 담임 반만 걸러낸다 — 안 걸러내면 남의 반 학생 청구서가
   *    이 강사 합계에 얹혀 급여 재료가 부풀고, 시트 대조로 맞춰 둔 프리랜서 4인 금액이 어긋난다
   *    (`teaching-scope-single-source.test.ts`가 적어 둔 "돈은 담임을 따라간다"와 같은 규약).
   *    교시 담당 몫을 실제로 나누려면 `invoice_teacher_splits`/티어를 교시 축으로 확장해야 하고,
   *    그건 골든마스터를 건드리는 별건이다 — 화면은 그 사실을 아래 `moneyNote`로 밝힌다.
   */
  const homeroomClasses = effectiveTeacher
    ? teacherClasses
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.teacherId === effectiveTeacher)
    : [];
  /**
   * 티어 정산액의 반 범위 = **현재 담임인 반 전부**(종전 그대로 — 표에서 뺀 반 포함, 가르치는 반 목록의 원래 순서).
   * 🔴 순서를 바꾸지 말 것 — 정산은 줄의 소수 합을 내림하므로 순서가 달라지면 정수 경계에서 1원이 갈릴 수 있다.
   */
  const matrixByClass = new Map<string, AttendanceMatrix>([
    ...teacherClasses.map((c, i) => [c.id, teacherMatrices[i]!] as const),
    ...laterClasses.flatMap((c, i) => (laterMatrices[i] ? [[c.id, laterMatrices[i]!] as const] : [])),
  ]);
  const moneyClasses = effectiveTeacher
    ? taughtClasses.filter((c) => c.teacherId === effectiveTeacher && matrixByClass.has(c.id))
    : [];
  const money =
    mode === "teacher" && viewer.systemRole === "master" && effectiveTeacher && payrollOn
      ? await getTeacherMoney(
          month,
          effectiveTeacher,
          [...new Set(moneyClasses.flatMap((c) => matrixByClass.get(c.id)!.students.map((s) => s.id)))],
          moneyClasses.map((c) => c.id), // 티어 정산(0199a) — 시수·티어를 이 반들에서 읽는다
        )
      : null;
  const slotOnlyCount = teacherClasses.length - homeroomClasses.length;
  /**
   * 🔴 정산액에 든 **표에 없는 반**의 시수 — 다른 반 대신 보강(원장 결정 3, `taught_by` 0316a). 칸은 학생의 반에 있어 이 격자엔 없고
   *    표 아래 읽기 전용 목록(`SubstituteCellsNote`)으로 보인다. 말없이 정산액만 커지면 화면 시수와 금액이 갈려 보인다(적대 리뷰 2026-09-30).
   */
  const shownClassIds = new Set(teacherClasses.map((c) => c.id));
  const laterClassIds = new Set(laterClasses.map((c) => c.id));
  const unitsByMoneyClass =
    money?.tierSettlement.status === "ready" ? Object.entries(money.tierSettlement.unitsByClass ?? {}) : [];
  // 표에 없는 반의 정산 시수 — 대신 보강(남의 반)과 '그 달 뒤에 담임이 된 반'을 가른다(같은 문구로 묶으면 거짓 설명이 된다).
  const outsideUnits = unitsByMoneyClass.reduce((s, [cid, u]) => (shownClassIds.has(cid) || laterClassIds.has(cid) ? s : s + u), 0);
  const laterUnits = unitsByMoneyClass.reduce((s, [cid, u]) => (laterClassIds.has(cid) ? s + u : s), 0);
  // 청구·납입 합계의 범위 안내 — 합계 줄에 늘 선다.
  const moneyNote = money && slotOnlyCount > 0 ? sheetTf(lang, "att.moneyNote", { n: moneyClasses.length, m: slotOnlyCount }) : null;
  /**
   * 티어 **정산액**에 든 표 밖 시수 안내 — 정산액을 그릴 때만 선다(`settlementNote`, 합계 줄이 `showLegacySettlement`로 가린다).
   * 🔴 프리랜서 표(실수업액·실급여 열)는 정산액을 감추고 명세서도 출석부 실급여로 낸다 — 거기에 "정산액에 …시수가 들어 있습니다"를
   *    띄우면 그 사람 명세서와 **반대 사실**을 말한다(적대 리뷰 2026-10-06: 그 달 뒤에 받은 반·대신 보강은 실급여에 없다).
   */
  const settlementNote =
    [
      money && outsideUnits > 0 ? sheetTf(lang, "att.moneyNote.substitute", { units: formatSessionUnits(outsideUnits) }) : null,
      money && laterUnits > 0 ? sheetTf(lang, "att.moneyNote.later", { n: laterClasses.length, units: formatSessionUnits(laterUnits) }) : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;
  // 매트릭스(무거운 출석 데이터)는 반을 골랐을 때만 로드. 미선택이면 base(빈 매트릭스) 재사용.
  const matrix =
    mode === "teacher"
      ? teacherMatrices[0] ?? base
      : effectiveClassId
        ? await getMonthlyAttendanceMatrix(
            month,
            effectiveClassId,
            viewPrefs.periodMode,
            // 강사 계정이면 그 강사 렌즈(`classScopeTeacher`) — 담임 폴백 반은 담임이 되기 전 날을 뺀다(강사 전체 보기와 같은 규칙).
            classScopeTeacher,
            classScopeTeacher && homeroomSinceIdx && teacherRoles.get(effectiveClassId) === "homeroom"
              ? homeroomSinceOf(homeroomSinceIdx, effectiveClassId, classScopeTeacher)
              : null,
          )
        : base;

  /**
   * 반 머리행 끝의 **"누가 수업했나"** — 담임이 아니라 그 달 실제 담당(원장 2026-09-07).
   * 실측 근거: 수학은 그 달 보고서 작성자가 반마다 1명(9월 55/55·7월 58/58·8월 60중 1개만 2명)이라
   * 사실상 확정이고, 영어는 보고서를 aywa에 안 써서 출결 기록자로 떨어진다(반마다 2~4명 → `외 N명`).
   * ⚠️ 근거가 없는 반(그 달 보고서·출결이 둘 다 없음)은 **안 적는다** — 실측 9월 수학 활성 반 22개.
   */
  const workerClassIds = (
    mode === "teacher" ? teacherClasses.map((c) => c.id) : effectiveClassId ? [effectiveClassId] : []
  ).filter(Boolean);
  /**
   * 청구 조회에 넘기는 **담당 반**의 학생×반 — 청구액·등록 차수·「단가」·청구서 상태가 **같은 목록**에서 나온다.
   * 보강 묶음(`makeupGroup`, 아래)의 줄은 따로 읽어 합친다(`loadMakeupPool` → `billingRoster`).
   */
  const homeBillingRoster =
    mode === "teacher"
      ? teacherClasses.map((c, i) => ({ classId: c.id, studentIds: teacherMatrices[i]!.students.map((s) => s.id) }))
      : effectiveClassId
        ? [{ classId: effectiveClassId, studentIds: matrix.students.map((s) => s.id) }]
        : [];
  /**
   * 보이지 않는 '보강' 반 — 찾기 → 명단(격자) → 그 명단의 청구 판정을 **한 사슬**로 묶어 담당 반 조회와 **나란히** 돌린다(B4).
   * 🔑 보강 반의 청구는 명단이 정해진 뒤에야 물을 수 있어 **두 번째 조회**다. 담당 반 청구 조회를 이 사슬 뒤로 미루지 않으려고
   *    따로 뒀다(출석부는 강사 전원이 매일 여는 화면이다).
   * 🔑 청구 판정을 받는 이유(2026-09-18): 회차 확정 화면은 보강 반 줄도 세우고 확정·'청구서 없음'까지 판정한다(`loadMonthRoster`).
   *    여기서 빼 두면 그 줄은 확정한 뒤에도 '미확정', 청구서가 없어도 `—`가 아니라 '미확정'으로 남았다.
   * ⚠️ 반별 보기·보강 반이 없는 강사·명단이 빈 보강 반은 청구 조회를 **하지 않는다**(종전과 같은 왕복 수).
   * 🔴 `allowClassIds`엔 **여기서 스스로 푼** id(`findMakeupPoolClass(user.tenantId, effectiveTeacher)`)만 넘긴다 — 쿼리 문자열·폼 값
   *    같은 클라 입력으로 채우지 말 것(강사 축 밖 반의 청구액을 읽는 뒷문이 된다). 서버도 보강 반인지 DB로 다시 확인한다.
   * 묶음을 그리는 규약은 아래 `makeupGroup` 주석.
   */
  const loadMakeupPool = async () => {
    const makeupPoolClassId =
      mode === "teacher" && effectiveTeacher ? await findMakeupPoolClass(user.tenantId, effectiveTeacher) : null;
    const poolMatrix = makeupPoolClassId
      ? await getMonthlyAttendanceMatrix(month, makeupPoolClassId, "month", null, null, makeupPoolClassId)
      : null;
    if (!makeupPoolClassId || !poolMatrix || poolMatrix.students.length === 0) {
      return { classId: makeupPoolClassId, matrix: poolMatrix, roster: null, billing: null };
    }
    const roster = { classId: makeupPoolClassId, studentIds: poolMatrix.students.map((s) => s.id) };
    const billing = await getAttendanceClassBilledAmounts(month, [roster], { allowClassIds: [makeupPoolClassId] });
    return { classId: makeupPoolClassId, matrix: poolMatrix, roster, billing };
  };
  /**
   * 반별 보기의 표가 **달력월**을 그리고 있나 — 실급여는 이럴 때만 싣는다.
   * 🔴 청구액·등록 차수·확정 단가·명세서는 전부 달력월이다. 반별 보기의 기본 축은 세션이고 세션은 달을 넘길 수 있어
   *    (실측: 수학 9월 = 9/1~10/1), 세션 창의 시수로 계산하면 같은 달 실급여가 강사 전체 보기·명세서와 다른 숫자로 선다.
   *    급여로 읽는 숫자가 화면마다 다르면 안 되므로 창이 달과 같을 때만 싣고, 아니면 값을 안 보내고 안내 한 줄을 세운다.
   */
  const monthSpan = monthBounds(month);
  const classAxisIsMonth = matrix.window.start === monthSpan.first && matrix.window.end === monthSpan.last;
  const [workers, homeBilling, makeupPool, showActualAmountRaw, salaryConfigRaw, substituteCells] = await Promise.all([
    getMonthlyClassWorkers(user.tenantId, month, workerClassIds),
    getAttendanceClassBilledAmounts(month, homeBillingRoster, {
      teacherScope: (mode === "teacher" ? effectiveTeacher : classScopeTeacher) ? {
        teacherId: (mode === "teacher" ? effectiveTeacher : classScopeTeacher)!,
        classIds: classesForSubject.filter((c) => attendanceUnitSuffix(c.subject, operations.subjects) === "U").map((c) => c.id),
        holidays: Object.keys(buildHolidayMap(operations.holidays)),
        homeroomSinceByClass: mode === "teacher" ? Object.fromEntries(sinceByClass) : effectiveClassId && classScopeTeacher && homeroomSinceIdx
          ? { [effectiveClassId]: homeroomSinceOf(homeroomSinceIdx, effectiveClassId, classScopeTeacher) } : {},
      } : undefined,
    }),
    loadMakeupPool(),
    canShowAttendanceActualAmount(mode === "teacher" ? effectiveTeacher : classScopeTeacher ?? classesForSubject.find((c) => c.id === effectiveClassId)?.teacherId ?? null),
    // 🔴 선생님 본인의 **반별 보기**(`classScopeTeacher` — 반 하나를 골라 본 제 출석부)에서도 읽는다. 강사 전체 보기에서만 읽으면
    //    스위치를 켜 줘도 반을 골라 보는 선생님에겐 실급여 열이 안 선다(원장 제보 2026-10-07 *"체크했는데 실제 강사들이 실급여 열이
    //    안보인다고"*). 관리자가 반을 골라 본 화면은 `classScopeTeacher`가 null이라 종전 그대로다(비율 설정·스위치는 강사 전체 보기에서).
    //    단 표에 싣는 것은 창이 달력월일 때만이다(`classAxisIsMonth` — 세션 축이면 숫자가 명세서와 갈린다).
    getAttendanceSalaryRates(mode === "teacher" ? effectiveTeacher : classScopeTeacher, month),
    // 다른 반 대신 보강 칸(읽기 전용 목록) — 강사 보기만. 격자에 선 반은 빼고 읽는다(그 칸은 격자가 보여 준다). 대부분 0행.
    mode === "teacher" && effectiveTeacher
      ? loadSubstituteCells({ tenantId: user.tenantId, teacherId: effectiveTeacher, month, excludeClassIds: teacherClasses.map((c) => c.id) })
      : Promise.resolve([]),
  ]);
  // 급여 기능이 꺼진 학원 = 실급여 열·단가 버튼·토글 없음(조회는 이미 끝났지만 값을 버린다 — 표시 전용).
  const showActualAmount = payrollOn && showActualAmountRaw;
  const salaryConfigAny = payrollOn ? salaryConfigRaw : null;
  /** 반별 보기 + 세션 축 = 실급여 값을 싣지 않는다(위 `classAxisIsMonth`). 스위치가 켜져 있으면 왜 안 보이는지 한 줄로 말한다. */
  const salaryAxisOff = mode === "class" && !classAxisIsMonth;
  const salaryConfig = salaryAxisOff ? null : salaryConfigAny;
  const salaryAxisNotice = salaryAxisOff && !!salaryConfigAny?.visible && showActualAmount;
  /** 청구 판정을 받은 **모든** 학생×반(담당 반 + 명단이 있는 보강 반) — `—` 줄 판정과 표의 청구 칸이 같은 목록·같은 판정을 본다. */
  const billingRoster = makeupPool.roster ? [...homeBillingRoster, makeupPool.roster] : homeBillingRoster;
  const classBilledAmounts = makeupPool.billing
    ? mergeAttendanceClassBilling(homeBilling, makeupPool.billing)
    : homeBilling;
  /**
   * '미확정' 대신 `—`로 적을 줄 — 그 달 청구서가 없거나 취소된 학생의 줄(원장 2026-09-18 선택). 청구서는 있는데 회차 행만 없는
   * 줄은 종전 '미확정'(회차 확정에서 만들 수 있다). 판정 = 순수 `attendanceNoInvoiceRows`(회차 확정 화면과 같은 갈래).
   */
  const noInvoiceRows = attendanceNoInvoiceRows(billingRoster, classBilledAmounts.invoiceStateByStudent);
  const workerOf = (classId: string) => {
    const w = workers.get(classId) ?? null;
    return { workerLabel: classWorkerLabel(w, lang), workerSource: w?.source ?? null };
  };

  const groups: MatrixGroup[] =
    mode === "teacher"
      ? teacherClasses.map((c, i) => ({
          classId: c.id,
          className: classNameFor(c.className, lang),
          subjectLabel: subjectMaps.labelOf(c.subject),
          // 차수 단위(영어 U · 수학 T) · 특강 여부 — 겸직 강사의 표엔 두 과목 반이 섞여 서므로 **반마다** 정한다.
          unitSuffix: attendanceUnitSuffix(c.subject, operations.subjects),
          isSpecial: matrixClassById.get(c.id)?.isSpecial ?? false,
          matrix: teacherMatrices[i]!,
          // 담임이 아닌 반이 왜 여기 있는지 밝힌다 — 라벨이 없으면 "남의 반이 왜 뜨지"가 된다.
          // ⚠️ 담임인 반엔 안 붙인다(`both` 포함) — 영어는 담임이 자기 반 교시도 맡는 게 보통이라
          //    거기까지 붙이면 거의 모든 반에 배지가 달려 정작 남의 반 표식이 안 보인다.
          roleLabel: teacherRoles.get(c.id) === "slot" ? sheetT(lang, "att.role.slot")
            : c.teacherId !== effectiveTeacher && c.historicalTeachers?.some((t) => t.id === effectiveTeacher)
              ? sheetT(lang, "att.role.former") : null,
          ...workerOf(c.id),
          // 담임 시작일 — 그 이전 칸이 왜 값에서 빠졌는지 반 머리행에서 밝힌다(빗금만 있으면 "왜 비었지").
          sinceLabel: sinceByClass.get(c.id)
            ? sheetTf(lang, "att.since", { date: dayLabel(sinceByClass.get(c.id)!) })
            : null,
        }))
      : effectiveClassId && selectedClass
        ? [
            {
              classId: effectiveClassId,
              className: classNameFor(selectedClass.className, lang),
              subjectLabel: subjectMaps.labelOf(selectedClass.subject),
              unitSuffix: attendanceUnitSuffix(selectedClass.subject, operations.subjects),
              isSpecial: matrixClassById.get(effectiveClassId)?.isSpecial ?? false,
              matrix,
              ...workerOf(effectiveClassId),
            },
          ]
        : [];

  /**
   * **보이지 않는 '보강' 반**을 이 강사의 출석부에 한 묶음으로 붙인다(0241a).
   *
   * 🔑 여기서 하는 일은 **반 하나를 목록에 더하는 것뿐**이다 — 명단·칸·시수·수정·게이트는 전부
   *    평소 쓰는 `getMonthlyAttendanceMatrix`가 그대로 처리한다(보강 학생은 수강행이 없어도
   *    `makeupStudentIds`가 이미 명단에 올린다). 그래서 이 화면에 특별한 코드가 없다.
   * 🔴 이 반은 `is_active=false`라 위 `teacherClasses`(활성만)에는 **절대 안 들어온다** — 그게
   *    "어디에도 안 보이게" 하는 장치다. 출석부만 이렇게 **일부러** 불러온다.
   * ⚠️ 보강을 한 적 없는 강사는 반 자체가 없어(lazy 생성) 묶음도 안 선다 — 정상이다.
   * ⚠️ 반별 보기(mode !== "teacher")엔 안 붙인다. 그 화면은 고른 반의 책이라 남의 보강이 낄 자리가 아니다.
   * 🔗 조회(반 찾기·명단·청구 판정)는 위 `loadMakeupPool`이 담당 반 청구 조회와 나란히 한다 — 청구액·등록 차수·`—` 줄도
   *    담당 반과 같은 판정을 받는다(2026-09-18, 회차 확정 화면이 이 줄을 확정·'청구서 없음'으로 판정하므로).
   */
  const makeupGroup: MatrixGroup | null =
    makeupPool.classId && makeupPool.matrix && makeupPool.matrix.students.length > 0
      ? {
          classId: makeupPool.classId,
          // 🔴 이 묶음 이름은 반 이름이 아니라 **출결 상태 '보강'과 같은 낱말**이다 —
          //    그래서 반 이름 표기표가 아니라 출결 라벨 단일 소스를 읽는다(두 화면이 같은 말을 쓴다).
          className: attendanceLabelOf("makeup", lang) ?? MAKEUP_POOL_PREFIX,
          // 과목 라벨은 비운다 — 이 묶음은 한 과목이 아니다(그 강사가 한 보강 전부가 여기 모인다).
          subjectLabel: "",
          matrix: makeupPool.matrix,
        }
      : null;

  /**
   * 이 화면의 **모든** 묶음 = 담당 반 + 보강 반. 아래 스탯·정렬·격자·검색·빈화면 판정이 **전부**
   * 이 배열 하나를 본다.
   *
   * 🔴 예전엔 보강 묶음을 표(JSX)에만 붙였다 — 그래서 행은 서는데 **칸이 통째로 비고**(격자 초기값을
   *    만드는 `buildGridSource`가 그 묶음을 몰랐다) 시수가 0으로 나왔고, 학생 검색도 못 찾았다
   *    (원장 제보 2026-09-02: *"이윤 9/1 왜 0개?"*). 표에 넣을 목록과 값·좌표를 만드는 목록이
   *    갈리면 화면이 **행만 있고 값이 없는** 거짓 상태가 된다 — 하나로 묶어 둘 것.
   */
  const allGroups = makeupGroup ? [...groups, makeupGroup] : groups;

  // 상단 스탯 — 강사 전체 보기는 반들을 합산(학생은 반 중복을 제거한 실인원).
  // ⚠️ 출결 수치는 **격자와 같은 함수**(`countMarks`)로 센다. 화면이 입력 즉시 다시 셀 때 서버 첫 렌더가
  //    다른 식을 쓰면 첫 타이핑에 숫자가 한 번 튄다 — 합계는 `grid/totals.ts` 한 곳만 거친다.
  const statsCount = sumCounts(
    allGroups.map((g) =>
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
  /**
   * 표에 세울 줄이 하나도 없나 — 담당 반 학생 0명 **이고** 보강 묶음도 없을 때만.
   * 🔴 `totalStudents`만 보면 담당 반이 전부 표에서 빠진 강사(그 달 뒤에 담임이 된 반뿐 · 학생 없는 반뿐)의 보강 묶음이
   *    빈 화면에 가려진다 — 그 줄의 실급여는 명세서에 들어가므로 화면과 명세서가 갈린다(적대 리뷰 2026-10-06).
   */
  const sheetEmpty = totalStudents === 0 && !makeupGroup;
  /**
   * 요약 허브(강사·반 미선택)를 그리나 — 묶음이 하나도 없고 **강사 보기가 아닐 때만**.
   * 🔴 강사 보기인데 표에 설 반이 0개일 수 있다(가르치는 반이 전부 조회 달 뒤에 담임이 된 반 · 보강 묶음도 없음). 묶음 수만 보면
   *    강사 드롭다운엔 이름이 찍혀 있는데 본문은 '강사 미선택' 요약이 된다 — 그 보기는 빈 상태 + 대신 보강 목록으로 보낸다(재리뷰 2026-10-06).
   */
  const hubShown = allGroups.length === 0 && mode !== "teacher";

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
  // 반 머리행(=접기)이 있는 보기인가 — 표와 툴바가 **같은 값**을 봐야 한다(한쪽만 그리면 접어 놓고
  // 펼칠 버튼이 없거나, 접을 게 없는데 버튼만 선다).
  const showGroups = mode === "teacher" && isGroupedSort(sortKey);
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
    sortKey === "role" && roleAnchorTeacher && allGroups.length > 0
      ? await getSubjectSessionsByStudent(
          [...new Set(allGroups.flatMap((g) => g.matrix.students.map((s) => s.id)))],
          kstToday(),
        )
      : null;
  const orderedRows = sortAttendanceRows(
    allGroups.flatMap((g) =>
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

  // 급여명세서 버튼 노출 — 게이트가 async(super_admin 조회)라 JSX 밖에서 한 번 계산한다.
  // ⚠️ 강사 전체 보기일 때만 물어본다 — 그 외에는 버튼 자체가 없어 왕복이 아깝다.
  const canOpenPayslip =
    mode === "teacher" && !!effectiveTeacher ? await canViewPayslipNow(viewer) : false;

  // 결석 통보 접수(2026-08-19) — 남의 반 칸까지 한 번에 만드는 조작이라 **사무실(full)만**.
  // ⚠️ 화면 조건은 게이트가 아니다(#77) — 서버 액션이 같은 판정을 다시 한다.
  const canIntakeAbsence = await canManageTenant(user.systemRole, "attendance");
  /**
   * 🔴 상단은 **툴바 한 줄 + (표가 있으면) 표 위 한 줄**이다(원장 2026-09-21 *"상단에 굳이 2열로 두지말고
   * 하나의 열로 공간 확보"*, 2026-09-30 *"상단 여백 최소화"*).
   * 실측(1,990px 창): 왼쪽 묶음과 오른쪽 도구가 한 줄을 넘어 도구가 통째로 둘째 줄로 떨어졌다.
   * · 표가 서 있을 때 — 도구·칸 안내는 표 위 줄(범례 줄).
   * · 허브(강사 미선택) — 도구는 요약 줄 오른쪽. 툴바에 두면 왼쪽이 빈 둘째 줄이 된다.
   * · 빈 반 — 요약 줄도 표 위 줄도 없으므로 툴바에 둔다(버튼이 사라지면 안 된다).
   */
  const gridShown = allGroups.length > 0 && !sheetEmpty;
  // 전체 영어 시수 도구는 강사·반을 고르기 전 요약 화면에서 연다.
  const showUnitsMaster = hubShown && canViewUnitsMaster(user.systemRole, myTeacherId);
  // 결석 통보 접수 — 데스크가 학부모 전화를 받는 자리(원장 2026-08-19). 당일 출결 화면에도 같은 버튼.
  // 급여명세서 — 이 화면의 금액을 그대로 쓰는 문서라 **여기**가 진입점이다: 프리랜서는 이 표의 실급여 합계(2026-10-06),
  // 그 밖은 합계 줄의 '정산액'(수납관리 강사 정산 면도 같은 계산 — 명세서 열람 명단에게 거기서도 명세서 버튼이 선다).
  // 원장 + 강사 전체 보기일 때만.
  // 반별 A4 인쇄(감사 N1) — 반을 골라 표가 서 있을 때만. 화면과 같은 표를 찍도록 날짜축·강사 렌즈를 싣는다.
  const printClass = mode === "class" && effectiveClassId && selectedClass && matrix.students.length > 0 ? selectedClass : null;
  const sheetTools =
    showUnitsMaster || canIntakeAbsence || (canOpenPayslip && effectiveTeacher) || printClass ? (
      <>
        {printClass ? (
          <ClassMonthPrintButton
            classId={printClass.id}
            className={printClass.className}
            month={month}
            periodMode={viewPrefs.periodMode}
            lens={classScopeTeacher}
            since={
              classScopeTeacher && homeroomSinceIdx && teacherRoles.get(printClass.id) === "homeroom"
                ? homeroomSinceOf(homeroomSinceIdx, printClass.id, classScopeTeacher)
                : null
            }
          />
        ) : null}
        {showUnitsMaster ? <UnitsMasterButton month={month} subject={effectiveSubject} /> : null}
        {canIntakeAbsence ? <AbsenceIntakeButton today={kstToday()} /> : null}
        {canOpenPayslip && effectiveTeacher ? (
          <PayslipWindowButton teacherId={effectiveTeacher} period={month} subjectFiltered={!!effectiveSubject} />
        ) : null}
      </>
    ) : null;
  // 🔴 이 칸 안내는 **접히면 안 된다** — 강사 전체 보기는 칸 숫자를 그 선생님 교시로 좁혀 그리므로
  // (한 달 시수가 서너 배 줄어드는 강사가 여럿이다) 같은 반이 반별 보기와 다른 숫자를 낸다.
  // ⚠️ 주석에 실측 숫자를 박지 말 것 — 라이브 데이터라 며칠 만에 늙는다. '안내'는 `<details>`라
  // 기본 화면에선 안 보인다(적대적 리뷰 2026-08-18). 사유 전문은 툴팁·안내가 잇는다.
  // 표가 서면 범례 줄 맨 앞(칸의 뜻을 말하는 자리라 범례와 같은 줄이 맞다), 아니면 툴바.
  const scopeChip =
    (mode === "teacher" || classScopeTeacher) && allGroups.length > 0 ? (
      <span
        className="border-line text-text-dim shrink-0 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap"
        title={sheetT(lang, isTeacherView ? "att.scopeChip.titleOwn" : "att.scopeChip.title")}
      >
        {sheetT(lang, "att.scopeChip")}
      </span>
    ) : null;

  /**
   * 허브(강사 미선택)로 열렸는데 **씨앗이 이미 있으면** 첫 렌더에 결과까지 준다 — 입력칸에 이름만
   * 떠 있고 목록이 비어 있으면 "검색이 안 먹는다"로 읽힌다.
   * ⚠️ 씨앗이 없으면 조회 자체를 하지 않는다(허브는 요약 화면 — 평소 진입 비용 0).
   * ⚠️ 게이트·스코프 판정은 조회 본체가 한다(클라 액션과 **같은 함수**, #77).
   */
  const hubSearchSeeded =
    hubShown && searchSeed ? await loadHubStudentSearch({ query: searchSeed, month }) : null;

  // 시트 격자의 좌표·초기값 — 표보다 위(상단 스탯)까지 감싸야 해서 여기서 만든다.
  const gridSource = buildGridSource(allGroups, visibleDays, orderedRows);

  /**
   * 강사 전체 보기의 주인 — 저장이 **그 강사 몫 교시에만** 시수를 나누게 서버에 알린다(원장 제보 2026-09-11:
   * *"새로고침하면 강제로 어떤 숫자로 롤백"*). 칸 값이 `effectiveTeacher` 스코프로 계산된 반(`teacherMatrices`)만
   * 싣는다 — 보강 묶음(`makeupPool.matrix`)은 스코프 없이 그려지므로 넣지 않는다(화면과 저장이 같은 판정을 쓰게).
   * ⚠️ 클라가 보내는 건 "어느 보기인가"뿐이다 — 몫은 서버가 DB로 다시 판정한다(#77).
   */
  const attendanceScope =
    mode === "teacher" && effectiveTeacher
      ? { teacherId: effectiveTeacher, classIds: teacherClasses.map((c) => c.id) }
      : classScopeTeacher && effectiveClassId
        ? { teacherId: classScopeTeacher, classIds: [effectiveClassId] }
        : null;

  /**
   * 학생 검색(원장 2026-08-19)이 볼 재료 — **화면에 이미 그려진 값만**(이름·학교·학년 + 붙여 쓴 압축 표기).
   * 🔴 조회를 새로 붙이지 않는다: 강사는 담당 반만 보는데 검색이 학원 전체를 뒤지면 그 범위가 뚫린다([[#77]]).
   */
  const searchRows = allGroups.flatMap((g) =>
    g.matrix.students.map((s) => ({
      row: rowKey(g.classId, s.id),
      studentId: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      schoolGrade: schoolGradeLabel(s.school, s.grade) || null,
    })),
  );

  // 수정 가능 기간 — 강사(scoped)는 KST 오늘 기준 7일 이내만. 관리자 이상(full)은 제한 없음(원장 2026-07-21).
  // ⚠️ 역할을 코드로 나열하지 않고 권한 매트릭스를 읽는다(#58) — 원장이 역할 권한을 조정하면 함께 따라간다.
  // ⚠️ 이건 화면 편의일 뿐 진짜 게이트는 서버 액션이다(#77).
  const scopedAttendance = (await accessLevelTenant(user.systemRole, "attendance")) === "scoped";
  // 🔴 읽기 권한(회계·뷰어 등)은 칸 전부를 잠근다 — 판정은 칸 저장 액션(setAttendanceCell·setAttendanceRange)의 게이트와
  //    **같은 함수**다. 7일 창(lockBefore)은 강사만이라, 이게 없으면 읽기 권한이 칸을 치고 저장 순간에야 거절됐다(원장 2026-11-05).
  const attendanceReadOnly = !(await canWriteTenant(user.systemRole, "attendance"));
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
    allGroups.length === 0 || sheetEmpty
      ? []
      : [
          lockBefore ? (
            <p key="lock" className={noticeClass}>
              {sheetT(lang, "att.notice.lock.a")}
              <strong className="text-foreground">
                {sheetTf(lang, "att.notice.lock.b", { n: ATTENDANCE_EDIT_WINDOW_DAYS })}
              </strong>
              {sheetTf(lang, "att.notice.lock.c", { date: lockBefore })}
            </p>
          ) : null,
          // 스위치는 켜져 있는데 세션 축이라 실급여를 안 실은 화면 — "켜 줬는데 안 보인다"로 읽히지 않게 이유를 말한다.
          salaryAxisNotice ? (
            <p key="salaryAxis" className={noticeClass}>
              {sheetT(lang, "att.notice.salaryAxis")}
            </p>
          ) : null,
          // 🔴 같은 반이 반별 보기와 강사 전체 보기에서 **다른 숫자**를 낸다 — 그 사실을 화면이 먼저
          //    말해야 한다(조용히 다르면 "출결이 사라졌다"로 읽힌다). 근거는 교시 귀속(resolveTaughtBy).
          mode === "teacher" || classScopeTeacher ? (
            <p key="scope" className={noticeClass}>
              {sheetT(lang, "att.notice.scope.a")}
              <strong className="text-foreground">{sheetT(lang, "att.notice.scope.b")}</strong>
              {/* 강사 계정엔 "반 전체는 반별 보기에서"가 거짓이다 — 그 계정의 반별 보기도 같은 렌즈다(`classScopeTeacher`). */}
              {isTeacherView ? (
                sheetT(lang, "att.notice.scope.cOwn")
              ) : (
                <>
                  {sheetT(lang, "att.notice.scope.c")}
                  <strong className="text-foreground">{sheetT(lang, "att.notice.scope.d")}</strong>
                  {sheetT(lang, "att.notice.scope.e")}
                </>
              )}
            </p>
          ) : null,
          // 기록이 하나도 없는 화면은 **왜 비어 있는지**를 말해야 한다 — 빈 표 + "—"만 두면 고장으로 읽힌다.
          // 파생도 안 도는 과목(현재 영어)이 여기 해당한다.
          statsCount.recorded === 0 && !allGroups.some((g) => g.matrix.derivedActive) ? (
            <p key="empty" className={noticeClass}>
              {/* ⚠️ 강사 전체 보기는 반이 여럿이라 "이 반"이 거짓말이 된다(적대검증) — 모드에 맞춰 주어를 바꾼다. */}
              {/* ⚠️ 강사 전체 보기의 '없음'은 **선생님 몫 기준**이다 — 남의 교시·자리 기록은 이 보기에 안 보일 뿐
                  반에는 있을 수 있어(2026-09-17부터 빗금도 없다) 그냥 "기록이 없다"고 하면 반별 보기와 서로를 부정한다. */}
              {sheetT(
                lang,
                mode === "teacher" ? "att.notice.empty.teacherPre" : "att.notice.empty.classPre",
              )}
              <strong className="text-foreground">
                {sheetT(
                  lang,
                  mode === "teacher"
                    ? "att.notice.empty.teacherBold"
                    : "att.notice.empty.classBold",
                )}
              </strong>
              {sheetT(lang, "att.notice.empty.c")}
            </p>
          ) : null,
          // 파생 반(수학)은 표가 "누가 찍은 값인지"를 스스로 밝혀야 한다 — 셀 툴팁만으론 안 보인다.
          allGroups.some((g) => g.matrix.derivedActive) ? (
            <p key="derived" className={noticeClass}>
              {/* 🔴 '출석'·'결석'은 앱 전역 출결 라벨 단일 소스를 그대로 부른다(이 문단에만 적으면 갈린다). */}
              {sheetT(lang, "att.notice.derived.a")}
              <strong className="text-foreground">{attendanceLabelOf("present", lang)}</strong>
              {sheetT(lang, "att.notice.derived.b")}
              <strong className="text-foreground">{attendanceLabelOf("absent", lang)}</strong>
              {sheetT(lang, "att.notice.derived.c")}
              <strong className="text-foreground">{sheetT(lang, "att.notice.derived.d")}</strong>
              {sheetT(lang, "att.notice.derived.e")}
            </p>
          ) : null,
        ].filter(Boolean);

  const teacherLabel = teacherOptions.find((t) => t.value === effectiveTeacher)?.label;
  // 툴바에 실리는 대상 표기. 자기 출석부를 보는 강사에겐 자기 이름이 노이즈라 반 개수만 남긴다.
  const selectedClassLabel =
    mode === "teacher"
      ? myTeacherId && myTeacherId === effectiveTeacher
        ? sheetTf(lang, "att.nClasses", { n: teacherClasses.length })
        : sheetTf(lang, "att.teacherAll", {
            name: teacherLabel ?? sheetT(lang, "att.teacherFallback"),
            n: teacherClasses.length,
          })
      : effectiveClassId
        ? classOptions.find((o) => o.value === effectiveClassId)?.label
        : undefined;

  // 요약 허브(강사·반 미선택)에서만 도는 조회 둘 — 강사별 오늘 현황과 휴원일 줄. 서로 독립이라 함께(B4).
  const [hubTeachers, hubHoliday] =
    hubShown
      ? await Promise.all([buildHubTeachers(classesForFilters, subjectOptions), loadHubHoliday(effectiveSubject)])
      : [[] as HubTeacher[], null];

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
    // 하단 도구 줄·여백 없이 남는 높이를 모두 표에 준다.
    //
    // ⚠️ GridProvider가 **툴바까지** 감싼다 — 합계(LiveStats)가 툴바로 올라갔기 때문. 칸을 치면 출석률·결석·
    //    지각이 그 자리에서 따라 움직이려면 툴바가 격자 저장소를 구독해야 한다(DOM은 안 만드는 컨텍스트라 무비용).
    // 🔴 검색 공급자가 **격자보다 바깥**이다 — 격자가 "안 걸린 행"을 좌표에서 빼야 키보드 이동·범위 선택이
    // 안 보이는 칸으로 새지 않는다(search-context.tsx / grid-context.tsx `visibleRows`).
    <AttendanceSearchProvider rows={searchRows} initialQuery={searchSeed}>
    <AttendanceScopeProvider scope={attendanceScope}>
    <GridProvider
      rows={gridSource.rows}
      cols={gridSource.cols}
      initial={gridSource.initial}
      notMine={gridSource.notMine}
      slotCounts={gridSource.slotCounts}
      lockBefore={lockBefore}
      readOnly={attendanceReadOnly}
      initialCollapsed={viewPrefs.collapsed}
      autoUnits={gridSource.autoUnits}
    >
      <div className="attendance-page flex h-full min-h-0 flex-col gap-1">
      {/* Toolbar — 월/범위/보기(+관리자 필터) 좌측, 살아있는 합계 우측. 이 화면의 유일한 크롬 줄. */}
      {/* 🔴 툴바를 감싸던 카드 껍데기를 뺐다(원장 2026-09-01) — 아래 격자가 자기 테두리를 갖고
          있어 선이 이중으로 겹쳐 보였다. `relative`는 남긴다(우측 '안내' 패널의 기준 상자).
          지시서 §10(2026-09-04, 12단계): 축 이름은 `micro` 소라벨이 아니라 드롭다운 안의 `축: 값`(과목·강사·반·기간·보기·정렬),
          보기(반별/강사 전체)는 링크형 드롭다운(HrefSelect — 주소를 attHref가 만든다), 검색은 토글. 구분선은 뺐다(다른 화면과 같은 gap). */}
      <div className="relative flex shrink-0 flex-wrap items-center gap-2.5 px-1 py-1">
        {/* 과목 → 강사 → 반 계층 필터(넓→좁). 위를 고르면 아래 선택지가 좁혀지고, 반을 골라야 출석부가 뜬다.
            반 선택 시 과목·강사는 그 반의 값으로 자동 표시(누구 선생님인지 바로 보이게). 전체(=미선택)면 축 이름만 선다. */}
        <span data-help="att-filters" className="inline-flex flex-wrap items-center gap-2.5">
        {showSubjectFilter ? (
          <FilterSelect
            paramName="subject"
            value={subjectValue}
            options={subjectOptions}
            axisLabel={sheetT(lang, "att.filter.subject")}
            ariaLabel={sheetT(lang, "att.filter.subjectAria")}
            allLabel={sheetT(lang, "att.filter.subjectAll")}
            prefixOnlyFor=""
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
        ) : null}

        {showTeacherFilter ? (
          <>
            <FilterSelect
              paramName="teacher"
              value={teacherValue}
              options={teacherOptions}
              axisLabel={sheetT(lang, "att.filter.teacher")}
              ariaLabel={sheetT(lang, "att.filter.teacherAria")}
              allLabel={sheetT(lang, "att.filter.teacherAll")}
              prefixOnlyFor=""
              className="w-auto"
              triggerClassName={TOOLBAR_SELECT}
            />
            {/* 퇴직 담임 숨김 — 감춘 인원을 칩에 적어 "강사가 없어졌다"로 읽히지 않게 한다. */}
            {retiredCount > 0 || !viewPrefs.hideRetired ? (
              <HideRetiredToggle hidden={viewPrefs.hideRetired} count={retiredCount} />
            ) : null}
          </>
        ) : null}

        {/* 반 dropdown — 강사에겐 **반 선택의 유일한 수단**('전체' = 자기 전체 시트, 반 = 그 반).
            관리자에게 '전체'는 종전대로 반 미선택(=선택 허브, 반 108개를 한 번에 안 여는 렉 방지).
            cap 상향 — 기본 50이면 이름순 앞을 로마자 영어반이 독점해 목록을 훑을 때 수학반이 7개만
            보였다(gotcha #84). 반 목록은 수백 규모라 전량 렌더가 안전하고, 초과분은 hint 검색으로 도달.
            반을 고르면 그 반의 시트가 아래를 채운다 = "지금 어느 반을 보고 있나"의 자리라 형광 표기
            (원장 2026-08-18 "수업에 들어가서 세부 내용을 보는 곳에 전부 적용"). 옆 과목·강사 필터는
            목록을 좁힐 뿐이라 **켜지 않는다** — 노란 게 둘이 되면 첫째가 안 보인다.
            ⚠️ "전체"일 땐 저절로 평범한 모양으로 돌아간다(FilterSelect가 고른 값에만 켠다). */}
        <FilterSelect
          paramName="class"
          value={effectiveClassId}
          options={classOptions}
          axisLabel={sheetT(lang, "att.filter.class")}
          ariaLabel={sheetT(lang, "att.filter.classAria")}
          allLabel={sheetT(lang, isTeacherView ? "att.filter.classAllMine" : "att.filter.classAll")}
          cap={300}
          className="w-auto"
          triggerClassName={TOOLBAR_SELECT}
          marker
        />
        </span>

        {/* 월 이동 — 앱 전역 단일 소스 PeriodNav(원장 2026-09-01 "출결 날짜 이동도 바꿔줘").
            🔑 종전엔 라벨이 그냥 글자라 **이번 달로 돌아갈 길이 없었다**(◀를 누른 만큼 ▶를 눌러야 했다).
               이제 라벨을 누르면 이번 달로 오고, 다른 달을 보는 중이면 과거/미래 조회 배지가 선다. */}
        <span data-help="att-month">
        <PeriodNav
          label={formatMonth(month, lang)}
          prevHref={attHref({ classId: effectiveClassId, month: prevMonth, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
          nextHref={attHref({ classId: effectiveClassId, month: nextMonth, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
          currentHref={attHref({ classId: effectiveClassId, month: currentMonthKey(), teacherId: effectiveTeacher, subjectId: effectiveSubject, mode })}
          relation={month === currentMonthKey() ? "current" : month < currentMonthKey() ? "past" : "future"}
          prevAriaLabel={sheetT(lang, "att.nav.prev")}
          nextAriaLabel={sheetT(lang, "att.nav.next")}
          currentTitle={sheetT(lang, "att.nav.current")}
        />
        </span>

        {/* 날짜축(세션/월) — 같은 줄에 붙인다. ⚠️ 새 줄을 얹지 말 것(그 높이는 학생 행에서 빼 온다). */}
        <span data-help="att-filters">
        <PeriodModeToggle
          mode={viewPrefs.periodMode}
          windowLabel={periodWindowLabel(matrix.window, lang)}
          disabledReason={
            mode === "teacher"
              ? sheetT(lang, "att.period.disabledTeacher")
              : !effectiveClassId
                ? sheetT(lang, "att.period.disabledNoClass")
                : undefined
          }
        />
        </span>

        {/* 보기 — **관리자 전용**. '강사 전체'는 그 강사의 모든 반을 반별로 묶어 한 표에(급여 계산용).
            강사 본인에겐 반 드롭다운과 뜻이 겹쳐(그리고 '반별'이 사진 허브로 보내서) 감춘다. 주소는 attHref가 만든다. */}
        {showViewToggle ? (
          effectiveTeacher ? (
            <span data-help="att-view">
            <HrefSelect
              axisLabel={sheetT(lang, "att.view")}
              ariaLabel={sheetT(lang, "att.view")}
              value={mode}
              options={[
                {
                  value: "class",
                  label: sheetT(lang, "att.view.class"),
                  href: attHref({ classId: effectiveClassId, month, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode: "class" }),
                },
                {
                  value: "teacher",
                  label: sheetT(lang, "att.view.teacher"),
                  href: attHref({ classId: null, month, teacherId: effectiveTeacher, subjectId: effectiveSubject, mode: "teacher" }),
                },
              ]}
            />
            </span>
          ) : (
            <span className="text-text-faint text-xs">{sheetT(lang, "att.view.pickTeacher")}</span>
          )
        ) : null}

        {/* 정렬 — 계정 귀속 설정(URL 아님). 반별 외엔 반 구분 없이 한 덩어리로 그린다. */}
        {allGroups.length > 0 ? (
          <>
            <AttendanceSortSelect value={sortKey} />
            {/* 반 머리행이 있는 보기에서만 — 이름 칸의 작은 화살표와 같은 동작을 글자로 한 번 더 낸다
                (아이콘만 있으면 있는 줄 모른다). 접힌 수까지 적어 "몇 개가 숨었는지"를 감추지 않는다. */}
            {showGroups ? <CollapseAllChip classIds={allGroups.map((g) => g.classId)} /> : null}
            {/* 학생 검색(원장 2026-08-19) — **클라 필터**라 서버 왕복 0, 친 즉시 표가 좁아진다. 토글(§10) — 검색어(허브 씨앗 포함)가
                걸려 있으면 펼친 채. 안 걸린 행은 감추는 게 아니라 안 그린다(격자 좌표도 함께 좁아져 방향키가 새지 않는다).
                검색어는 저장하지 않는다 — 다음 방문에 필터가 걸린 채 열리면 "출석부가 비었다"로 읽힌다. */}
            <span data-help="att-search" className="inline-flex flex-wrap items-center gap-2.5">
              <AttendanceSearchToggle />
            </span>
            {/* 엑셀 가져오기(출결) — 검색과 같은 줄(원장 2026-09-29 버튼 통일). 결석 통보 접수와 같은 게이트(full). */}
            {canIntakeAbsence ? <ExcelMenu importKind="attendance" /> : null}
          </>
        ) : (
          <>
            {/* 진입 **전** 학생 검색(원장 2026-08-20) — 강사를 고르기 전에 "이 학생이 누구 반이지"를 푼다.
                결과를 누르면 그 강사 출석부가 **검색어를 들고** 열린다. 시트 검색과 자리가 겹치지 않도록
                같은 칸에 둔다(둘 중 하나만 뜬다 = URL 씨앗을 적는 주인도 하나). */}
            <HubStudentSearch month={month} initialQuery={searchSeed} initialResult={hubSearchSeeded} />
            {/* 반을 고르기 전·빈 달에도 엑셀 가져오기는 선다(같은 게이트 — 검색 줄). */}
            {canIntakeAbsence ? <ExcelMenu importKind="attendance" /> : null}
          </>
        )}

        {/* 대상 표기 — PageHeader의 서브라인이 하던 몫(반 이름 / N개 반). 세로 줄 대신 툴바 한 칸으로. */}
        {selectedClassLabel ? (
          <span className="text-text-dim truncate text-xs font-medium">{selectedClassLabel}</span>
        ) : null}

        {/* 우측 — 살아있는 합계 + 안내 토글. **새 줄을 만들지 않고** 툴바의 남는 가로 여백을 쓴다. */}
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-3 [&>button]:shrink-0">
          {/* 도구·칸 안내 — 표는 표 위 줄, 허브는 요약 줄. 빈 반만 여기(위 `gridShown` 주석). */}
          {!gridShown && !hubShown ? sheetTools : null}
          {!gridShown ? scopeChip : null}
          {allGroups.length > 0 ? <LiveStats totalStudents={totalStudents} fallback={statsCount} /> : null}
          {notices.length > 0 ? (
            // `<details>`라 클라 JS가 없다. 패널은 absolute라 열려도 격자를 밀어내지 않는다(높이 0 유지).
            <details className="[&_summary::-webkit-details-marker]:hidden">
              <summary className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF} list-none cursor-pointer`}>
                {sheetTf(lang, "att.notices", { n: notices.length })}
              </summary>
              <div className="border-line bg-card absolute top-full right-1 z-40 mt-1 w-[min(560px,calc(100vw-3rem))] space-y-2 rounded-2xl border p-3 shadow-lg">
                {notices}
              </div>
            </details>
          ) : null}
        </div>
      </div>

      {hubShown ? (
        // 강사 미선택 허브 = **출석부 요약**(원장 2026-08-10). 무거운 매트릭스는 여전히 안 불러온다.
        // 강사를 고르면 바로 그 강사 전체 출석부(기본 보기 = 강사 전체, resolveViewMode).
        <AttendanceHub
          tools={sheetTools}
          // 허브 카드도 같은 렌즈를 쓴다 — 드롭다운에선 감췄는데 카드로는 보이면 설정이 거짓말이 된다.
          teachers={hubTeachers.filter((t) => !viewPrefs.hideRetired || !t.retired)}
          holiday={hubHoliday}
          // 자리 묶음 = 드롭다운과 같은 순서·같은 조건(과목이 영어일 때만). 목록이 두 곳에서 달라 보이면 안 된다.
          seats={
            showSeats
              ? SEAT_KEYS.map((k) => ({
                  key: k,
                  name: SEAT_NAME[k],
                  room: SEAT_ROOM[k],
                  href: `/attendance/seat/${k}`,
                  monthHref: `/attendance/seat/${k}/month?month=${month}`,
                  open: (USABLE_SEAT_KEYS as readonly string[]).includes(k),
                }))
              : []
          }
          month={month}
          lang={lang}
          subjectId={effectiveSubject}
          colorOf={subjectMaps.colorOf}
          labelOf={subjectMaps.labelOf}
          todayLabel={
            // 오늘 날짜 표기도 화면 언어를 따른다 — 시각대는 언제나 KST(앱 전역 규약).
            new Intl.DateTimeFormat(lang === "en" ? "en-US" : "ko-KR", {
              timeZone: "Asia/Seoul",
              month: "long",
              day: "numeric",
              weekday: "short",
            }).format(new Date())
          }
        />
      ) : sheetEmpty ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState
            image="students"
            icon={() => <Users size={32} strokeWidth={1.8} />}
            title={sheetT(
              lang,
              mode === "teacher" ? "att.empty.teacher" : "att.empty.class",
            )}
            description={sheetT(lang, "att.empty.desc")}
          />
          {/* 표가 비어도 대신 보강 목록은 선다 — 이 보기에서만 보이는 칸이다(강사 보기가 아니면 빈 목록이라 아무것도 안 그린다). */}
          <SubstituteCellsNote cells={substituteCells} lang={lang} />
        </div>
      ) : (
        // 남은 높이를 전부 격자에 — `min-h-0`이 없으면 flex 아이템의 최소 크기가 콘텐츠(수십 행)라
        // 줄지 않아 화면 밖으로 넘치고 결국 페이지 스크롤이 되살아난다(= 스크롤바 2개).
        // `isolate` — 표 헤더의 높은 z(50/60)를 격자 안에 가둔다. 안 그러면 그 z가 페이지 전역과 겨뤄
        // 툴바 드롭다운·셀 팝오버를 헤더가 덮는다(스택 컨텍스트만 만들 뿐 fixed 탈출은 막지 않는다).
        <div className="isolate flex min-h-0 flex-1 flex-col">
          {/* 🔴 표 위 한 줄 = **범례**(원장 2026-09-14 *"범례 가장 위로"* · *"이 사이 빈공간"*).
              여기엔 원래 '학원 휴일 9/24 추석 연휴 · …' 이름 줄이 있었는데(2026-09-07) 원장이 같은 날
              *"휴일 표시 제거"*로 걷어냈다. 휴일은 이제 **셀 색(붉은 계열) + 헤더 빨간 날짜 + 날짜 툴팁**으로
              읽히고, 그 색의 뜻은 이 범례가 말한다(`att.legend.holiday`).
              🔴 휴일 이름 줄을 되살리지 말 것 — 되살리려면 원장 확인이 먼저다.
              오늘 칩은 격자에 **오늘 열이 있을 때만**(지난·다음 달엔 남색 머리가 없다) — 표와 같은 `visibleDays`로 판정. */}
          <MatrixTable
            groups={allGroups}
            days={visibleDays}
            ordered={orderedRows}
            // 반 머리행은 **반별 정렬 + 강사 전체 보기**일 때만. 가나다·학년·담임순은 반 구분을 없앤다.
            showGroups={showGroups}
            classBilledAmounts={classBilledAmounts.billed}
            carryMarksByRow={sessionBillingOn ? classBilledAmounts.carryMarks : {}}
            showActualAmount={showActualAmount}
            // 🔴 실급여 열은 **이 선생님의 이 달 '합계 및 실급여 보여주기'가 켜져 있을 때만**(선생님 × 달 스위치 0352a·0353a, 원장 2026-10-07)
            //    — 꺼 두면 급여 값을 아예 싣지 않는다(화면에서 감추는 게 아니라 서버가 안 보낸다).
            //    관리자 화면과 선생님 본인 화면이 **같은 스위치**를 본다(`getAttendanceSalaryRates`의 두 문).
            salaryRates={salaryConfig?.visible ? salaryConfig.rates : undefined}
            salaryView={!!salaryConfig?.manage}
            optionsLeading={
              <>
                {scopeChip}
                <AttendanceLegend
                  lang={lang}
                  showToday={visibleDays.some((d) => d.isToday)}
                  showMathUnits={allGroups.some((g) => g.unitSuffix === "T")}
                  showEnglishUnits={allGroups.some((g) => g.unitSuffix === "U")}
                  eieOn={eieOn}
                />
              </>
            }
            optionsTools={sheetTools}
            optionsExtra={salaryConfig?.manage ? <>
              {salaryConfig.canEdit ? <SalaryRatesButton teacherId={salaryConfig.teacherId} month={month}
                teacherName={allTeacherOptions.find((t) => t.value === salaryConfig.teacherId)?.label ?? ""}
                rates={salaryConfig.rates} mixed={salaryConfig.mixed} classes={teacherClasses.map((c) => ({ id: c.id, name: c.className }))} /> : null}
              {/* '합계 및 실급여 보여주기'(원장 2026-09-21 *"관리자 출석부 우측에 토글"* → 2026-10-07 선생님별 스위치) — 열이 설 수 있는
                  보기(관리자 + 프리랜서 강사 전체 보기)에서만. 🔴 계정 귀속 보기 설정이 아니다 — 켜면 그 선생님 본인 화면에도 보인다. */}
              {/* 혼합 계약인데 용역 학년을 안 골랐다 — 실급여를 싣지 않는다(명세서도 산정하지 않는 금액). 스위치 대신 까닭. */}
              {showActualAmount && salaryConfig.needsLevels ? <span className="text-danger text-xs break-keep">{sheetT(lang, "att.actualSalary.needsLevels")}</span>
                : showActualAmount ? <SalaryVisibleButton key={`${salaryConfig.teacherId}:${month}`} teacherId={salaryConfig.teacherId} month={month} checked={salaryConfig.visible} canEdit={salaryConfig.canEdit} /> : null}
            </> : undefined}
            termSessionsByRow={sessionBillingOn ? classBilledAmounts.confirmedSessions : {}}
            confirmedPricesByRow={sessionBillingOn ? classBilledAmounts.confirmedPrices : {}}
            priceConfirmedRows={sessionBillingOn ? classBilledAmounts.priceConfirmed : []}
            noInvoiceRows={noInvoiceRows}
            money={money}
            moneyNote={moneyNote}
            settlementNote={settlementNote}
            lang={lang}
            lockBefore={lockBefore}
            // 공휴일은 학원설정(operations.holidays)이 단일 소스 — 헤더 빨간 날짜·셀 회색 처리에 동기화.
            holidays={buildHolidayMap(operations.holidays)}
          />
          {/* 다른 반 대신 보강(읽기 전용) — 정산엔 들었는데 이 격자엔 없는 칸을 밝힌다(원장 결정 3). 없으면 아무것도 안 그린다. */}
          <SubstituteCellsNote cells={substituteCells} lang={lang} />
        </div>
      )}
      </div>
    </GridProvider>
    </AttendanceScopeProvider>
    </AttendanceSearchProvider>
  );
}
