import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Users } from "@/components/icons/eywa-icon-compat";
import {
  USABLE_SEAT_KEYS,
  SEAT_KEYS,
  SEAT_NAME,
  SEAT_ROOM,
  parseSeatFilterValue,
  seatFilterValue,
} from "@/features/attendance/seat/seat";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getDailyProcessingStatus, getMonthlyAttendanceMatrix, type AttendanceMatrix } from "@/features/attendance/server/queries";
import { getTeacherMoney } from "@/features/attendance/server/teacher-money";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { ATTENDANCE_EDIT_WINDOW_DAYS } from "@/features/attendance/edit-window";
import { accessLevelTenant, canManageTenant } from "@/lib/auth/perm-matrix";
import { AbsenceIntakeButton } from "./_components/absence-intake-button";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
// 출결 강사 귀속 축 단일 소스 — 담임(classes.teacher_id)만 보면 교시 담당 강사가 자기 수업을 못 본다.
import { classTeacherRole, type ClassTeacherRole } from "@/features/attendance/teacher-axis";
import { loadAttendanceViewPrefs } from "@/features/attendance/server/prefs-actions";
import { PeriodModeToggle } from "./_components/period-mode-toggle";
import { countMarks, sumCounts } from "@/features/attendance/grid/totals";
import { isGroupedSort, sortAttendanceRows } from "@/features/attendance/sort-rows";
import { getSubjectSessionsByStudent, roleFor } from "@/features/attendance/server/subject-sessions";
import { AttendanceSortSelect } from "./_components/sort-select";
import { HideRetiredToggle } from "./_components/hide-retired-toggle";
import { AttendanceHub, type HubTeacher } from "./_components/attendance-hub";
import { MatrixTable, buildGridSource, type MatrixGroup } from "./_components/matrix-table";
import { GridProvider } from "./_components/grid-context";
import { AttendanceSearchBox, AttendanceSearchProvider } from "./_components/search-context";
import { rowKey } from "@/features/attendance/grid/model";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { CollapseAllChip } from "./_components/class-group";
import { LiveStats } from "./_components/live-totals";
import { attHref, resolveViewMode, type ViewMode } from "./_components/att-href";
import { PayslipWindowButton } from "./_components/payslip-window-button";
import { canViewPayslipNow } from "@/features/payroll/server/payslip-gate";

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
  return [...out.values()];
}

/** 이 반이 그 강사의 출석부에 들어가는가(담임이든 교시 담당이든). */
function classTaughtBy(c: AttendanceMatrix["classes"][number], teacherId: string): boolean {
  return (
    classTeacherRole({
      homeroomTeacherId: c.teacherId,
      slotTeacherIds: c.slotTeachers.map((t) => t.id),
      teacherId,
    }) !== null
  );
}

/**
 * 요약 허브(강사 미선택)의 강사 목록 — 강사별 반 수·과목·**오늘 입력 현황**.
 * 오늘 현황은 getDailyProcessingStatus(일별 처리 현황과 같은 소스) 한 번 — 허브가 뜰 때만 부른다.
 * ⚠️ 그 조회는 테넌트 전체(오늘 수업 반)라, 화면의 과목 필터로 좁힌 `classes`에 든 반만 집계에 넣는다.
 * ⚠️ 오늘 현황은 **반 단위**라 교시 담당이 여럿인 반은 그 사람들에게 같은 반이 각각 한 번씩 세어진다
 *    (반을 교시로 쪼개 세면 담임 화면의 종전 숫자가 흔들린다 — 여기선 "내가 오늘 볼 반"이 맞다).
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
      const cur = acc.today ?? { classes: 0, doneClasses: 0, expected: 0, recorded: 0 };
      cur.classes++;
      cur.expected += r.expected;
      cur.recorded += r.recorded;
      if (r.expected > 0 && r.unprocessed === 0) cur.doneClasses++;
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
    .map(([value, t]) => ({ value, label: t.retired ? `${t.name} (퇴직)` : t.name, retired: t.retired }))
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
  const showSeats = !effectiveSubject || effectiveSubject === "english";
  const seatOptions = showSeats
    ? SEAT_KEYS.map((k) => ({
        value: seatFilterValue(k),
        label: `${SEAT_NAME[k]} ${SEAT_ROOM[k]}`,
        hint: "자리 · 여러 반 동시 입실",
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
      .map(({ value, label }) => ({ value, label, hint: "퇴직" })),
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
  const teacherClasses = effectiveTeacher
    ? classesForSubject.filter((c) => classTaughtBy(c, effectiveTeacher))
    : [];
  // 반별 역할 표식(담임 / 교시 담당) — 반 머리행에 붙어 "왜 이 반이 여기 있나"를 밝힌다.
  const teacherRoles = new Map<string, ClassTeacherRole | null>(
    teacherClasses.map((c) => [
      c.id,
      effectiveTeacher
        ? classTeacherRole({
            homeroomTeacherId: c.teacherId,
            slotTeacherIds: c.slotTeachers.map((t) => t.id),
            teacherId: effectiveTeacher,
          })
        : null,
    ]),
  );
  const mode: ViewMode = requestedMode === "teacher" && teacherClasses.length > 0 ? "teacher" : "class";
  const teacherMatrices =
    mode === "teacher"
      // ⚠️ 강사 전체 보기는 여러 반을 **한 표**에 그리는데 세션은 과목별이라 반마다 기간이 다를 수 있다.
      //    첫 반의 날짜축으로 나머지를 그리면 엉뚱한 칸에 출결이 찍히므로 1단계는 달력월로 고정한다
      //    (화면 라벨에 그 사실을 적는다 — 조용히 다르게 보이면 안 된다).
      // 🔴 네 번째 인자 = **이 표의 주인**. 넘기지 않으면 칸 숫자가 그날 모든 교시의 합이라, 한 교시만
      //    가르친 강사의 출석부에 남의 교시까지 잡힌다(원장 제보 2026-08-18: 8/10 김근호가 이다교 선생님
      //    출석부에 3 — 실제 이다교 몫은 1). 귀속 판정은 resolveTaughtBy 단일 소스가 한다.
      ? await Promise.all(
          teacherClasses.map((c) => getMonthlyAttendanceMatrix(month, c.id, "month", effectiveTeacher)),
        )
      : [];
  /**
   * 금액 열은 **원장 전용**(급여 PII 규율) — 강사가 자기 학생들의 청구·납입을 보게 하지 않는다.
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
  const money =
    mode === "teacher" && user.systemRole === "master" && effectiveTeacher
      ? await getTeacherMoney(
          month,
          effectiveTeacher,
          [...new Set(homeroomClasses.flatMap(({ i }) => teacherMatrices[i]!.students.map((s) => s.id)))],
          homeroomClasses.map(({ c }) => c.id), // 티어 정산(0199a) — 시수·티어를 이 반들에서 읽는다
        )
      : null;
  const slotOnlyCount = teacherClasses.length - homeroomClasses.length;
  const moneyNote =
    money && slotOnlyCount > 0
      ? `금액·정산액은 담임 반 ${homeroomClasses.length}개 기준 — 교시 담당 ${slotOnlyCount}개 반은 빠져 있습니다`
      : null;
  // 매트릭스(무거운 출석 데이터)는 반을 골랐을 때만 로드. 미선택이면 base(빈 매트릭스) 재사용.
  const matrix =
    mode === "teacher"
      ? teacherMatrices[0] ?? base
      : effectiveClassId
        ? await getMonthlyAttendanceMatrix(month, effectiveClassId, viewPrefs.periodMode)
        : base;

  const groups: MatrixGroup[] =
    mode === "teacher"
      ? teacherClasses.map((c, i) => ({
          classId: c.id,
          className: c.className,
          subjectLabel: subjectMaps.labelOf(c.subject),
          matrix: teacherMatrices[i]!,
          // 담임이 아닌 반이 왜 여기 있는지 밝힌다 — 라벨이 없으면 "남의 반이 왜 뜨지"가 된다.
          // ⚠️ 담임인 반엔 안 붙인다(`both` 포함) — 영어는 담임이 자기 반 교시도 맡는 게 보통이라
          //    거기까지 붙이면 거의 모든 반에 배지가 달려 정작 남의 반 표식이 안 보인다.
          roleLabel: teacherRoles.get(c.id) === "slot" ? "교시 담당" : null,
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

  // 급여명세서 버튼 노출 — 게이트가 async(super_admin 조회)라 JSX 밖에서 한 번 계산한다.
  // ⚠️ 강사 전체 보기일 때만 물어본다 — 그 외에는 버튼 자체가 없어 왕복이 아깝다.
  const canOpenPayslip =
    mode === "teacher" && !!effectiveTeacher ? await canViewPayslipNow(user) : false;

  // 결석 통보 접수(2026-08-19) — 남의 반 칸까지 한 번에 만드는 조작이라 **사무실(full)만**.
  // ⚠️ 화면 조건은 게이트가 아니다(#77) — 서버 액션이 같은 판정을 다시 한다.
  const canIntakeAbsence = await canManageTenant(user.systemRole, "attendance");

  // 시트 격자의 좌표·초기값 — 표보다 위(상단 스탯)까지 감싸야 해서 여기서 만든다.
  const gridSource = buildGridSource(groups, visibleDays, orderedRows);

  /**
   * 학생 검색(원장 2026-08-19)이 볼 재료 — **화면에 이미 그려진 값만**(이름·학교·학년 + 붙여 쓴 압축 표기).
   * 🔴 조회를 새로 붙이지 않는다: 강사는 담당 반만 보는데 검색이 학원 전체를 뒤지면 그 범위가 뚫린다([[#77]]).
   */
  const searchRows = groups.flatMap((g) =>
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
          // 🔴 같은 반이 반별 보기와 강사 전체 보기에서 **다른 숫자**를 낸다 — 그 사실을 화면이 먼저
          //    말해야 한다(조용히 다르면 "출결이 사라졌다"로 읽힌다). 근거는 교시 귀속(resolveTaughtBy).
          mode === "teacher" ? (
            <p key="scope" className={noticeClass}>
              칸 숫자는 <strong className="text-foreground">이 선생님이 맡은 교시</strong>만 셉니다. 같은 반이라도
              다른 선생님 교시와 자리(JJ·랩)는 빗금으로만 표시되고 시수·출석률에는 들어가지 않습니다 — 반 전체
              숫자는 <strong className="text-foreground">반별 보기</strong>에서 봅니다.
            </p>
          ) : null,
          // 기록이 하나도 없는 화면은 **왜 비어 있는지**를 말해야 한다 — 빈 표 + "—"만 두면 고장으로 읽힌다.
          // 파생도 안 도는 과목(현재 영어)이 여기 해당한다.
          statsCount.recorded === 0 && !groups.some((g) => g.matrix.derivedActive) ? (
            <p key="empty" className={noticeClass}>
              {/* ⚠️ 강사 전체 보기는 반이 여럿이라 "이 반"이 거짓말이 된다(적대검증) — 모드에 맞춰 주어를 바꾼다. */}
              {/* ⚠️ 강사 전체 보기의 '없음'은 **선생님 몫 기준**이다 — 남의 교시·자리 기록은 빗금으로
                  화면에 보이는데 여기서 그냥 "기록이 없다"고 하면 두 문장이 서로를 부정한다. */}
              {mode === "teacher" ? "담당 반에 아직 " : "이 반은 아직 "}
              <strong className="text-foreground">
                {mode === "teacher" ? "선생님 몫으로 잡힌 출결 기록이 없습니다" : "출결 기록이 없습니다"}
              </strong>
              . 수업보고서로 자동 표시되는 과목이 아니라서, 셀을 직접 클릭해 찍은 값만 쌓입니다.
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
    // 🔴 검색 공급자가 **격자보다 바깥**이다 — 격자가 "안 걸린 행"을 좌표에서 빼야 키보드 이동·범위 선택이
    // 안 보이는 칸으로 새지 않는다(search-context.tsx / grid-context.tsx `visibleRows`).
    <AttendanceSearchProvider rows={searchRows}>
    <GridProvider
      rows={gridSource.rows}
      cols={gridSource.cols}
      initial={gridSource.initial}
      notMine={gridSource.notMine}
      alsoWrites={gridSource.alsoWrites}
      slotCounts={gridSource.slotCounts}
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
              {/* 퇴직 담임 숨김 — 감춘 인원을 칩에 적어 "강사가 없어졌다"로 읽히지 않게 한다. */}
              {retiredCount > 0 || !viewPrefs.hideRetired ? (
                <HideRetiredToggle hidden={viewPrefs.hideRetired} count={retiredCount} />
              ) : null}
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
            // 반을 고르면 그 반의 시트가 아래를 채운다 = "지금 어느 반을 보고 있나"의 자리라 형광 표기
            // (원장 2026-08-18 "수업에 들어가서 세부 내용을 보는 곳에 전부 적용"). 옆 과목·강사 필터는
            // 목록을 좁힐 뿐이라 **켜지 않는다** — 노란 게 둘이 되면 첫째가 안 보인다.
            // ⚠️ "전체 반"일 땐 저절로 평범한 모양으로 돌아간다(FilterSelect가 고른 값에만 켠다).
            marker
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

        {/* 날짜축(세션/월) — 같은 줄에 붙인다. ⚠️ 새 줄을 얹지 말 것(그 높이는 학생 행에서 빼 온다). */}
        <PeriodModeToggle
          mode={viewPrefs.periodMode}
          windowLabel={matrix.window.label}
          disabledReason={
            mode === "teacher"
              ? "강사 전체 보기는 반마다 세션이 달라 달력월로 표시합니다"
              : !effectiveClassId
                ? "반을 고르면 세션으로 볼 수 있습니다"
                : undefined
          }
        />

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
                        ? "border-primary bg-primary text-primary-foreground font-medium"
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
              {/* 반 머리행이 있는 보기에서만 — 이름 칸의 작은 화살표와 같은 동작을 글자로 한 번 더 낸다
                  (아이콘만 있으면 있는 줄 모른다). 접힌 수까지 적어 "몇 개가 숨었는지"를 감추지 않는다. */}
              {showGroups ? <CollapseAllChip classIds={groups.map((g) => g.classId)} /> : null}
            </div>
            <span className="bg-line h-4 w-px" aria-hidden />
            {/* 학생 검색(원장 2026-08-19) — **클라 필터**라 서버 왕복 0, 친 즉시 표가 좁아진다.
                안 걸린 행은 감추는 게 아니라 안 그린다(격자 좌표도 함께 좁아져 방향키가 새지 않는다).
                검색어는 저장하지 않는다 — 다음 방문에 필터가 걸린 채 열리면 "출석부가 비었다"로 읽힌다. */}
            <AttendanceSearchBox />
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
          {/* 결석 통보 접수 — 데스크가 학부모 전화를 받는 자리(원장 2026-08-19). 당일 출결 화면에도 같은 버튼. */}
          {canIntakeAbsence ? <AbsenceIntakeButton today={kstToday()} /> : null}
          {/* 급여명세서 — 이 화면의 '정산액'을 그대로 쓰는 문서라 **여기**가 진입점이다(수납관리 강사 정산
              면은 invoice_teacher_splits가 비어 있어 표 자체가 안 그려진다). 원장 + 강사 전체 보기일 때만. */}
          {canOpenPayslip && effectiveTeacher ? (
            <PayslipWindowButton teacherId={effectiveTeacher} period={month} subjectFiltered={!!effectiveSubject} />
          ) : null}
          {/* 🔴 이 한 줄은 **접히면 안 된다** — 강사 전체 보기는 칸 숫자를 그 선생님 교시로 좁혀 그리므로
              (한 달 시수가 서너 배 줄어드는 강사가 여럿이다) 같은 반이 반별 보기와 다른 숫자를 낸다.
              ⚠️ 주석에 실측 숫자를 박지 말 것 — 라이브 데이터라 며칠 만에 늙는다. 아래 '안내'는 `<details>`라
              기본 화면에선 안 보인다(적대적 리뷰 2026-08-18). 사유 전문은 툴팁·안내가 잇는다. */}
          {mode === "teacher" && groups.length > 0 ? (
            <span
              className="border-line text-text-dim rounded-full border px-2.5 py-0.5 text-xs"
              title="칸 숫자는 이 선생님이 맡은 교시만 셉니다. 다른 선생님 교시와 자리(JJ·랩)는 빗금으로만 표시되고 시수·출석률에는 들어가지 않습니다 — 반 전체 숫자는 반별 보기에서 봅니다."
            >
              칸 = 이 선생님 교시
            </span>
          ) : null}
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
        // 강사 미선택 허브 = **출석부 요약**(원장 2026-08-10). 무거운 매트릭스는 여전히 안 불러온다.
        // 강사를 고르면 바로 그 강사 전체 출석부(기본 보기 = 강사 전체, resolveViewMode).
        <AttendanceHub
          // 허브 카드도 같은 렌즈를 쓴다 — 드롭다운에선 감췄는데 카드로는 보이면 설정이 거짓말이 된다.
          teachers={(await buildHubTeachers(classesForFilters, subjectOptions)).filter(
            (t) => !viewPrefs.hideRetired || !t.retired,
          )}
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
          subjectId={effectiveSubject}
          colorOf={subjectMaps.colorOf}
          labelOf={subjectMaps.labelOf}
          todayLabel={new Intl.DateTimeFormat("ko-KR", {
            timeZone: "Asia/Seoul",
            month: "long",
            day: "numeric",
            weekday: "short",
          }).format(new Date())}
        />
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
            showGroups={showGroups}
            money={money}
            moneyNote={moneyNote}
            lockBefore={lockBefore}
            // 공휴일은 학원설정(operations.holidays)이 단일 소스 — 헤더 빨간 날짜·셀 회색 처리에 동기화.
            holidays={buildHolidayMap(operations.holidays)}
          />
        </div>
      )}
      </div>
    </GridProvider>
    </AttendanceSearchProvider>
  );
}
