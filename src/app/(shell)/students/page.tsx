import { Users } from "@/components/icons/aywa-icon-compat";
import { isModuleEnabled } from "@/lib/modules";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { MergedTag } from "@/components/merged-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { FilterSelect } from "@/components/filter-select";
import { HeaderFilter } from "@/components/header-filter";
import { SearchToggle } from "@/components/search-toggle";
import { EmbedLink } from "@/components/embed-link";
import { ToolbarChip } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import {
  getStudentsPage,
  getEnrolledStatCounts,
  getTeacherOptions,
  getScopedTeacherOptions,
} from "@/features/students/server/queries";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import {
  subjectAxisOf,
  narrowSubjectFilters,
  showSubjectFilter,
  coerceSubjectFilter,
} from "@/features/students/scope-axis";
import { loadStudentListPrefs, saveStudentListPrefs } from "@/features/students/server/list-prefs";
import {
  DEFAULT_STUDENT_LIST_PREFS,
  dashboardExitParams,
  parseSearchField,
  parseStudentSort,
  studentListPrefsFromUrl,
  type StudentListPrefs,
} from "@/features/students/list-prefs";
import { WindowLink } from "@/components/workspace/window-link";
import { PageHeader } from "@/components/page-header";
import { sheetSchoolGrade } from "@/features/teacher-view/school-grade";
import { studentDisplayName } from "@/features/teacher-view/student-name";
import { studentStatusMeta } from "@/features/students/status-labels";
// 강사 미니셸이면 화면 언어를 따른다(원장 2026-09-04 "강사가 접근 가능한 모든 메뉴를 전환").
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { sheetT, sheetTf } from "@/features/teacher-view/i18n";
// 강사 이름도 영어 이름이 있으면 그것으로 — 표는 셸 레이아웃이 이미 읽어 둔 요청 캐시라 왕복 0.
import { getTeacherEnglishNames } from "@/features/teacher-view/server/teacher-names";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { NewStudentTrigger } from "./_components/new-student-trigger";
import { StudentsMoreMenu } from "./_components/students-more-menu";
import { RememberPrefs } from "@/components/remember-prefs";
import { EyIcon } from "@/components/icons/aywa-icons";
import { isValidYmd } from "@/lib/date-kst";
import { parseProgram, programLabel, type Program } from "@/features/students/program";
// 운영실 KPI ↗ 집합 — 엑셀 파일 라우트와 **같은 함수**(파일 행 = 목록 행).
import { restrictIdsFor } from "@/features/students/server/restrict-ids";
import {
  NO_SUBJECT,
  joinMulti,
  levelLabel,
  mixLabel,
  parseLevels,
  parseMixes,
  parseMulti,
  type StudentLevel,
  type StudentMixFilter,
} from "@/features/students/list-filter-values";
import { EnrolledStatCard } from "./_components/enrolled-stat-card";
import { PAGE_TITLE_SUFFIX } from "@/lib/config/site-metadata";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "stu.title")}${PAGE_TITLE_SUFFIX}` };
}

// 상태 — 디폴트(재원)는 파라미터가 없을 때다. "전체"는 명시적 status=all로만(HeaderFilter의 allValue=enrolled가 지운다).
// 문구는 **사전 키**만 든다 — 화면 언어(강사 미니셸)가 영어면 그대로 따라간다.
const STATUS_OPTION_KEYS = [
  { value: "all", key: "stu.filter.all" },
  { value: "consulted", key: "stu.filter.status.consulted" },
  { value: "on_hold", key: "stu.filter.status.onHold" },
  { value: "withdrawn", key: "stu.filter.status.withdrawn" },
] as const;
const SORT_OPTION_KEYS = [
  { value: "name", key: "stu.filter.sort.name" },
  { value: "recent", key: "stu.filter.sort.recent" },
] as const;
const FIELD_OPTION_KEYS = [
  { value: "name", key: "stu.filter.field.name" },
  { value: "school", key: "stu.filter.field.school" },
  { value: "phone", key: "stu.filter.field.phone" },
  { value: "address", key: "stu.filter.field.address" },
  { value: "email", key: "stu.filter.field.email" },
  { value: "memo", key: "stu.filter.field.memo" },
] as const;
const PAGE_SIZE = 50;

/** 운영실 '재원생 구성' 칩 글자 — `초등 · 영어만·동시수강`(학교급·수강 구성 라벨은 list-filter-values 한 곳). */
function compositionChipLabel(levels: readonly StudentLevel[], mixes: readonly StudentMixFilter[]): string {
  return [levels.map(levelLabel).join("·"), mixes.map(mixLabel).join("·")].filter(Boolean).join(" · ");
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    subject?: string;
    q?: string;
    page?: string;
    grade?: string;
    teacher?: string;
    field?: string;
    sort?: string;
    noenr?: string;
    program?: string;
    first?: string;
    /** 운영실 '재원생 구성' 막대 조각 — 학교급(`elem,middle`)·수강 구성(`englishOnly,both`). 칩으로만 푼다. */
    level?: string;
    mix?: string;
    from?: string;
  }>;
}) {
  const user = await requireAccess("students");
  // 학생 생성(새 학생·엑셀 가져오기) = full만 — 강사(scoped)는 열람 전용(원장 지시 2026-08-18).
  // 서버 액션(createStudent·import-actions)도 같은 full 판정이라 UI 숨김은 이중 방어다(#77).
  const canManageStudent = (await accessLevelTenant(user.systemRole, "students")) === "full";
  const sp = await searchParams;
  // 상태 필터 디폴트 = 재원(운영에서 당장 중요한 건 재원생). "전체"는 명시적 status=all로만. 🔴 상태는 저장하지 않는다.
  const status = sp.status ?? "enrolled";
  // 보기 설정은 계정 귀속(users.ui_prefs.students, 원장 2026-08-04) — URL(명시값) → 저장값 → 기본값.
  // 표시 축(원장 2026-08-20) — 강사 스코프면 **담당 과목**으로 축을 좁힌다(관리자·담당 반 0개는 null=종전 동일).
  const [scope, prefsLoaded] = await Promise.all([effectiveTeacherScope({ includeScheduled: true }), loadStudentListPrefs()]);
  // 조회 실패(null)면 기본값으로 그리되 **이번 렌더는 저장하지 않는다** — 기본값을 저장값으로 알고 전체를 보내면 다른 축이 지워진다(리뷰 2026-09-04).
  const prefs = prefsLoaded ?? DEFAULT_STUDENT_LIST_PREFS;
  const axis = subjectAxisOf(scope);
  // 🔴 과목 필터를 감춘 화면(담당 과목 1개)에선 걸려 있던 값을 "전체"로 되돌린다 — 저장된 필터·직접 URL이 남아 있으면
  // 되돌릴 컨트롤이 없는데 행이 조용히 빠진다(축 밖 과목이면 0명 · 축 안 과목이어도 **휴원 학생이 사라진다**).
  const subjectRaw = coerceSubjectFilter(axis, sp.subject ?? prefs.subject);
  const q = sp.q ?? "";
  const gradeRaw = sp.grade ?? prefs.grade;
  const teacherRaw = sp.teacher ?? prefs.teacher;
  const field = parseSearchField(sp.field ?? prefs.field);
  const sort = parseStudentSort(sp.sort ?? prefs.sort);
  // URL은 명시적으로 `noenr=0`도 적는다(저장값을 이기려면 "없음"이 아니라 값이어야 한다).
  const excludeNoEnrollment = (sp.noenr ?? (prefs.noenr ? "1" : "0")) === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  // 운영실 KPI ↗ — 프로그램·첫 수업 집합. 모르는 값·달력에 없는 날짜는 무시(필터 없음, 칩도 없음).
  const program = parseProgram(sp.program);
  const firstDay = isValidYmd(sp.first) ? sp.first : null;
  const levels = parseLevels(sp.level);
  const mixes = parseMixes(sp.mix);
  // from=dashboard = 운영실 링크가 모든 축을 명시값(전체)으로 적은 **들어온 그 화면** — 그 렌더는 보기 설정을 저장하지 않는다
  // (저장하면 사용자가 골라 둔 학년·과목 필터가 운영실 링크 한 번에 지워진다). 필터를 바꾸면 from이 떨어진다(아래 exit·leave).
  const fromDashboard = sp.from === "dashboard";
  const restrictPromise = restrictIdsFor(program, firstDay, { levels, mixes });

  // 담임 필터 선택지 — 강사 스코프에선 **내 학생의 담당 과목 반 담당**만(고르면 결과가 0인 선택지 방지 +
  // 아래 '담당 강사' 열에 실제로 나오는 이름과 일치). 관리자면 종전 학원 전체 목록.
  const teacherOptionsPromise: Promise<{ id: string; displayName: string }[]> = axis
    ? getScopedTeacherOptions().then((r) => r ?? [])
    : getTeacherOptions();
  const settingsPromise = getTenantSettings();
  // 재원 통계는 지금 띄워 두고 맨 끝에 받는다 — 아래 저장값 검증이 기다리는 건 선택지(담임·학원설정) 둘뿐이라 통계까지 묶으면
  // 목록 조회가 통계를 기다린다(재리뷰 2026-09-03, B4). 그 사이 거절돼도 미처리 거절로 새지 않게 표식만 붙인다(값은 끝에서 받는다).
  const statCountsPromise = getEnrolledStatCounts();
  void statCountsPromise.catch(() => undefined);
  const optionsPromise = Promise.all([teacherOptionsPromise, settingsPromise]);
  // 저장값(URL이 아니라 계정 설정에서 온 값)은 **지금 선택지에 있을 때만** 쓴다 — 퇴사한 담임·학원설정에서 지운 학년·흡수된 과목이
  // 보이지 않는 필터로 남아 결과를 0명으로 만들지 않게(리뷰 확정 2026-09-03: 열 머리는 '학년'인데 0명). URL로 고른 값은 그대로
  // 믿는다(그 경우 목록 조회가 설정 조회를 기다리지 않는다, B4).
  let teacherId = teacherRaw;
  let grade = gradeRaw;
  let subject = subjectRaw;
  const fromPrefs = (key: "teacher" | "grade" | "subject") => sp[key] === undefined;
  if (
    (fromPrefs("teacher") && teacherRaw !== "all") ||
    (fromPrefs("grade") && gradeRaw !== "all") ||
    (fromPrefs("subject") && subjectRaw !== "all")
  ) {
    const [teachersEarly, settingsEarly] = await optionsPromise;
    // 다중 선택(원장 2026-09-28)이라 **값마다** 본다 — 선택지 밖 값만 떨어지고 남은 게 없으면 "전체".
    const keepKnown = (raw: string, known: (v: string) => boolean) => joinMulti(parseMulti(raw).filter(known));
    if (fromPrefs("teacher")) teacherId = keepKnown(teacherRaw, (v) => teachersEarly.some((t) => t.id === v));
    if (fromPrefs("grade")) grade = keepKnown(gradeRaw, (v) => settingsEarly.operations.gradeLevels.includes(v));
    if (fromPrefs("subject"))
      subject = keepKnown(subjectRaw, (v) => v === NO_SUBJECT || settingsEarly.operations.subjects.some((s) => s.key === v));
  }
  // 수강 과목 = '미수강'(원장 2026-09-28) — 퇴원 목록에선 뜻이 없어(전원 미수강) 서버가 무시하고 선택지도 안 세운다.
  const wantsNoSubject = status !== "withdrawn" && parseMulti(subject).includes(NO_SUBJECT);

  const [{ rows, total, hiddenNotStarted }, counts, [teachers, settings]] = await Promise.all([
    restrictPromise.then((restrictIds) =>
      getStudentsPage(
        { status, subject, q, grade, teacherId, searchField: field, sort, excludeNoEnrollment, restrictIds },
        page,
        PAGE_SIZE,
      ),
    ),
    statCountsPromise,
    optionsPromise,
  ]);
  const [lang, teacherNames] = await Promise.all([
    getTeacherViewLang(),
    getTeacherEnglishNames(),
  ]);
  const showTeacher = (n: string) => teacherNameFor(n, teacherNames, lang) ?? n;
  const { enrolled, bySubject } = counts;
  // 과목·학년 필터·라벨·색은 학원설정(operations) 단일 소스 — 미등록 값은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects, lang);
  // 강사 스코프면 과목 선택지도 담당 과목만. 고를 게 1개뿐이면 필터 자체를 감춘다(잡음).
  // 맨 끝 '미수강' = 지금 수강 중인 과목이 하나도 없는 학생(운영실 '재원생 구성'의 미수강 막대와 같은 판정). 퇴원 목록엔 안 세운다.
  const subjectOptions = [
    ...narrowSubjectFilters(axis, subjects.filters).filter((f) => f.value !== "all"),
    ...(status !== "withdrawn" ? [{ value: NO_SUBJECT, label: sheetT(lang, "stu.filter.subject.none") }] : []),
  ];
  const statusOptions = STATUS_OPTION_KEYS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }));
  const sortOptions = SORT_OPTION_KEYS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }));
  const hideSubjectFilter = !showSubjectFilter(axis);
  const gradeOptions = settings.operations.gradeLevels.map((g) => ({ value: g, label: sheetSchoolGrade(null, g, lang) }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: showTeacher(t.displayName) }));
  // 담임 필터 — 스코프에서 고를 사람이 나 하나뿐이면 감춘다(전체/나 = 같은 결과).
  // ⚠️ 이미 값이 걸려 있으면 남겨 둔다 — 감추면 "전체"로 되돌릴 길이 없다.
  const hideTeacherFilter = axis !== null && teacherOptions.length <= 1 && teacherId === "all";

  // 저장할 보기 설정 — 저장값과 다르면 클라가 한 번 저장한다(공용 RememberPrefs — 수업목록과 한 벌). 🔴 **사용자가 고른 값(URL) 또는 이미 저장된 값**만 —
  // 위 보정(축 밖 과목 → 전체 · 선택지 밖 담임/학년 → 전체)은 이 화면 한정이라 계정에 쓰지 않는다(리뷰 확정 2026-09-03: 겸직 관리자가
  // 강사뷰·다른 강사 뷰를 열면 보정값이 관리자 본인의 저장 설정을 덮어썼다).
  // 🔑 저장값과 **같은 파서**를 지난다 — `?subject=`(빈 값)처럼 파서가 접는 값을 원문 그대로 두면 저장값과 영영 달라 렌더마다 저장한다.
  //    URL 값이 선택지 밖(옛 링크의 모르는 정렬·검색 범위)이면 보여 주기만 하고 저장값은 유지(리뷰 2026-09-04).
  const current: StudentListPrefs = studentListPrefsFromUrl(sp, prefs);

  /**
   * 목록 링크(쪽 넘김·미수강 토글)가 들고 갈 파라미터 — 기본값과 다르거나 **URL이 명시한** 축은 그대로 적는다.
   * 저장값에서 온 축도 값이 기본값과 다르면 적히므로, 링크를 따라가도 지금 보는 필터가 그대로다.
   * ⚠️ URL이 적은 과목은 **적힌 그대로** 잇는다(위 축 보정값이 아니라) — 보정값을 링크에 실으면 다음 렌더가 그것을 사용자 선택으로
   * 읽어 계정에 저장한다(재리뷰 2026-09-03). **정렬·검색 범위**도 파서가 보정하는 축이라 같이 원값으로 잇는다
   * (재리뷰 2026-09-04). 학년·담임은 URL 값이면 보정하지 않으니 그대로다.
   */
  // 운영실에서 온 화면(from=dashboard)에서 **필터를 바꿀 때** 함께 뗄 파라미터 — from과 바꾸지 않은 운영실 명시 축(D1).
  // 떼인 축은 다음 렌더에서 저장값으로 돌아가 RememberPrefs가 바꾼 축만 저장한다. 운영실에서 온 화면이 아니면 빈 목록.
  const exit = (param: string) => dashboardExitParams(fromDashboard, param);
  const listParams = (
    patch: {
      page?: number;
      noenr?: boolean;
      program?: Program | null;
      first?: string | null;
      /** 운영실 '재원생 구성' 조각(학교급·수강 구성) — null이면 둘 다 푼다(칩 하나). */
      composition?: null;
      leave?: boolean;
      /** 검색어(q)만 뺀다. 저장된 필터·페이지 언어는 그대로 둔다. */
      clearQ?: boolean;
    } = {},
  ) => {
    const params = new URLSearchParams();
    // 🔑 필터를 바꾸는 링크(leave)는 운영실 방문 표식과 운영실이 적은 축을 뗀다(위 exit와 같은 규칙).
    //    쪽 넘김은 필터 변경이 아니라 그대로 운영실 방문으로 남는다(저장 안 함).
    const leaving = fromDashboard && !!patch.leave;
    // 운영실 KPI 집합(프로그램·첫 수업)은 쪽 넘김·토글에도 따라간다(칩으로만 푼다).
    const programParam = patch.program === undefined ? program : patch.program;
    if (programParam) params.set("program", programParam);
    const firstParam = patch.first === undefined ? firstDay : patch.first;
    if (firstParam) params.set("first", firstParam);
    if (patch.composition !== null) {
      if (levels.length > 0) params.set("level", levels.join(","));
      if (mixes.length > 0) params.set("mix", mixes.join(","));
    }
    if (fromDashboard && !leaving) params.set("from", "dashboard");
    if (status !== "enrolled") params.set("status", status);
    if (!leaving) {
      if (sp.subject !== undefined) params.set("subject", sp.subject);
      else if (subject !== DEFAULT_STUDENT_LIST_PREFS.subject) params.set("subject", subject);
      if (grade !== DEFAULT_STUDENT_LIST_PREFS.grade || sp.grade !== undefined) params.set("grade", grade);
      if (teacherId !== DEFAULT_STUDENT_LIST_PREFS.teacher || sp.teacher !== undefined) params.set("teacher", teacherId);
    }
    if (sp.field !== undefined) params.set("field", sp.field);
    else if (field !== DEFAULT_STUDENT_LIST_PREFS.field) params.set("field", field);
    if (sp.sort !== undefined) params.set("sort", sp.sort);
    else if (sort !== DEFAULT_STUDENT_LIST_PREFS.sort) params.set("sort", sort);
    if (patch.noenr !== undefined) params.set("noenr", patch.noenr ? "1" : "0");
    else if (!leaving && (excludeNoEnrollment || sp.noenr !== undefined)) {
      params.set("noenr", excludeNoEnrollment ? "1" : "0");
    }
    if (q && !patch.clearQ) params.set("q", q);
    if (!patch.clearQ && (patch.page ?? 1) > 1) params.set("page", String(patch.page));
    const s = params.toString();
    return s ? `/students?${s}` : "/students";
  };
  const pageHref = (p: number) => listParams({ page: p });
  // 엑셀 API는 저장값을 모른다 — 지금 걸린 값 중 기본값이 아닌 것만 그대로 넘긴다(옛 링크와 같은 모양).
  const exportHref = `/api/exports/students?${new URLSearchParams({
    ...(status !== "all" ? { status } : {}),
    ...(subject !== "all" ? { subject } : {}),
    ...(q ? { q } : {}),
    ...(grade !== "all" ? { grade } : {}),
    ...(teacherId !== "all" ? { teacher: teacherId } : {}),
    ...(field !== "all" ? { field } : {}),
    ...(sort !== "grade" ? { sort } : {}),
    ...(excludeNoEnrollment ? { noenr: "1" } : {}),
    // 운영실 KPI 집합도 넘긴다 — 라우트가 같은 restrictIdsFor로 좁혀 파일 행 = 목록 행.
    ...(program ? { program } : {}),
    ...(firstDay ? { first: firstDay } : {}),
    ...(levels.length > 0 ? { level: levels.join(",") } : {}),
    ...(mixes.length > 0 ? { mix: mixes.join(",") } : {}),
  }).toString()}`;

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {prefsLoaded && !fromDashboard ? (
        <RememberPrefs current={current} saved={prefsLoaded} save={saveStudentListPrefs} />
      ) : null}
      {/* 머리 — 지시서 §10: 상시 버튼은 Primary('새 학생') 하나. 엑셀 버튼은 **검색 줄**(공용 ExcelMenu)
          (원장 2026-09-29 탭 통일). 동기화 배지는 읽기 전용 표식이라 그대로. */}
      <PageHeader
        eyebrow={sheetT(lang, "stu.eyebrow")}
        title={sheetT(lang, "stu.title")}
        description={sheetTf(lang, "stu.desc", {
          n: enrolled,
          basis: sheetT(lang, axis ? "stu.basis.mine" : "stu.basis.settings"),
        })}
        actions={
          <>
            <MakeeduSyncBadge domain="students" />
            {canManageStudent ? <NewStudentTrigger /> : null}
          </>
        }
      />
      {/* 핵심 수치 — 재원 총원 + 과목별 재원생 비중(전체/퇴원은 상태 필터로). 과목이 늘어도 카드 1장 고정.
          재원생 0명 과목은 숨김(미운영 과목 노이즈 방지), 인원 내림차순. */}
      <EnrolledStatCard
        enrolled={enrolled}
        subjects={subjects.options
          .map((s) => ({
            key: s.value,
            label: s.label,
            color: subjects.colorOf(s.value),
            count: bySubject[s.value] ?? 0,
          }))
          .filter((s) => s.count > 0)
          .sort((a, b) => b.count - a.count)}
      />

      {/* 결과 줄 — 숫자 + 토글 하나('미수강 제외', 자주 바꾸는 것 하나만 §10) + 검색(눌러야 나온다, 검색 필드는 열었을 때만).
          필터·정렬은 여기 없다 — 아래 표의 **열 머리**가 필터다(§10 "필터·정렬은 목록 헤더 라벨을 눌러 호출"). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          {sheetT(lang, "stu.count.pre")}
          <span className="text-foreground font-bold">{total}</span>
          {sheetT(lang, "stu.count.post")}
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
          {q ? <span className="ml-1.5">· {sheetTf(lang, "stu.count.q", { q })}</span> : null}
          {/* '실시간 재원생'(원장 2026-09-16) — 아직 한 과목도 시작 안 한 학생은 재원 목록·총원에서 빠진다.
              🔴 **조용히 빼지 않는다**: 왜 빠졌고 어디서 볼 수 있는지 한 마디로 밝힌다
              (검색해도 안 나오는데 이유가 없으면 "학생이 사라졌다"가 된다 — [[#105]]).
              ⚠️ **인원수는 안 적는다** — `hiddenNotStarted`는 이 학생 전체 수라, 과목·학년·검색이 함께
                 걸려 있으면 "N명 제외"가 실제로 빠진 수와 달라진다(숫자가 거짓말하는 자리). */}
          {hiddenNotStarted > 0 ? (
            <span className="text-amber ml-1.5">· {sheetT(lang, "stu.count.notStarted")}</span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* 운영실 KPI ↗가 건 집합 — 칩을 누르면 그 조건만 푼다(나머지 필터는 그대로). */}
          {program ? (
            <ToolbarChip active href={listParams({ program: null, leave: true })}>
              {sheetT(lang, "stu.filter.program")}: {programLabel(program, settings.operations.subjects, isModuleEnabled(settings.modules.disabled, "eie"))}
              <EyIcon name="close" size={12} aria-hidden />
            </ToolbarChip>
          ) : null}
          {levels.length > 0 || mixes.length > 0 ? (
            <ToolbarChip active href={listParams({ composition: null, leave: true })}>
              {sheetT(lang, "stu.filter.composition")}: {compositionChipLabel(levels, mixes)}
              <EyIcon name="close" size={12} aria-hidden />
            </ToolbarChip>
          ) : null}
          {firstDay ? (
            <ToolbarChip active href={listParams({ first: null, leave: true })}>
              {sheetTf(lang, "stu.filter.first", {
                m: Number(firstDay.slice(5, 7)),
                d: Number(firstDay.slice(8, 10)),
              })}
              <EyIcon name="close" size={12} aria-hidden />
            </ToolbarChip>
          ) : null}
          {/* 상태=퇴원에선 숨김 — 퇴원생은 활성 수강이 없어 이 토글이 켜져 있으면 전원이 걸러져
              "검색해도 항상 0명"이 된다(2026-08-18 실사고). 서버(getStudentsPage)도 같은 조건에서 무시. */}
          {/* 수강 과목에 '미수강'을 골랐으면 감춘다 — 둘은 서로 반대라 함께 걸면 늘 0명이고, 서버도 그땐 이 토글을 무시한다. */}
          {status !== "withdrawn" && !wantsNoSubject ? (
            <span data-help="st-unenrolled">
            <ToolbarChip active={excludeNoEnrollment} href={listParams({ noenr: !excludeNoEnrollment, leave: true })}>
              {sheetT(lang, "stu.filter.noEnr")}
            </ToolbarChip>
            </span>
          ) : null}
          <span data-help="st-search">
          <SearchToggle
            key={q}
            placeholder={sheetT(lang, "stu.filter.searchPh")}
            defaultValue={q}
            extra={
              <FilterSelect
                paramName="field"
                clearParams={exit("field")}
                value={field}
                options={FIELD_OPTION_KEYS.map((o) => ({ value: o.value, label: sheetT(lang, o.key) }))}
                allValue="all"
                allLabel={sheetT(lang, "stu.filter.field.all")}
                axisLabel={sheetT(lang, "stu.filter.field")}
                ariaLabel={sheetT(lang, "stu.filter.field")}
                explicitAll
                className="w-auto"
                triggerClassName={TOOLBAR_SELECT}
              />
            }
          />
          </span>
          {/* 엑셀(공용 ExcelMenu) — 검색과 같은 줄(원장 2026-09-29 통일). 가져오기는 full만. */}
          <StudentsMoreMenu exportHref={exportHref} canImport={canManageStudent} />
        </div>
      </div>

      {/* 🔴 표는 결과가 0명이어도 그린다 — 열 머리가 곧 필터라, 표를 치우면 걸린 필터를 되돌릴 컨트롤이 함께 사라진다
          (실브라우저 검증 2026-09-03: 휴원+학년 '7세'로 0명이 되자 학년을 풀 길이 없었고 저장값이라 다음 방문에도 0명이었다).
          빈 상태는 표 본문 안에 선다. */}
      <>
          {/* 표 — 이 메뉴의 최소 창(960)에 맞춘 고정 열(`table-fixed`)이라 창 안에선 가로 스크롤이 없다. 🔴 폰에서도 `overflow-x-auto`
              상자로 싸지 않는다 — overflow-x가 auto면 overflow-y도 auto가 되어 열 머리 팝업(absolute)이 짧은 표 안에서 잘린다(리뷰 2026-09-04;
              폰에선 이 팝업이 유일한 필터다). 폰(최상위 프레임 <768px)은 `.stack-rows`(globals.css)가 열 머리를 필터 칩 줄로, 행을
              [이름 학교·학년 | 상태] / [과목 · 담당 강사 · 연락처] 두 줄 카드로 접는다(2026-09-13 모바일 전수검사 — 그전엔 표 736px가
              본문을 가로로 밀어 상태 뒤 열이 전부 화면 밖이었다). 칸의 자리는 `data-cell`이 정한다. ⚠️ `max-md:min-w-[46rem]`은
              **창(iframe) 안을 위해 남긴다** — 창을 768 아래로 스냅하면 `.stack-rows`가 안 걸리고(창 제외 스코프) 이 min-w가 종전대로 표를
              736px로 지켜 창이 가로로 스크롤한다(`WindowMinSizeNotice`의 "가로 스크롤로" 안내와 일치). 폰에선 `.stack-rows`가 이 값을 덮는다.
              행 = 이름(학교·학년) + 상태 + 과목 + 담당 강사 + 연락처 한 줄, 행 사이 헤어라인(§11). */}
          <div className="stack-rows bg-card shadow-card rounded-2xl">
            <table className="w-full table-fixed text-sm max-md:min-w-[46rem] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
              {/* 열 폭 — 2026-09-08 v5 글자 기준 실측(트리거 라벨 16px, 표 폭 935): 라벨 자리 = 열폭 − th px-3 24 − 크롬 32(px-1 8 + gap-2 8 + 쉐브론 16).
                  상태 18% → 112px ≥ `상태: 예비·상담`(110px) / 담당 강사 20% → 131px ≥ `담당 강사: 이수진`(125px).
                  옛 30/16/20/18/16은 14px 시절 예산(`상태: 예비·상담 ⌄` 128px)이라 v5에서 `truncate`가 발동했다. 늘린 몫은 이름(30→28%, 238px ≥ 이름+학교학년 151px)·과목(20→18%)에서. */}
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[20%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="border-line border-b">
                {/* 열 제목과 값은 같은 축(가운데 — 원장 2026-09-18). 폰 카드(`.stack-rows`)는 globals.css가 전부 왼쪽으로 되돌린다. */}
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold [&>th]:whitespace-nowrap">
                  <th scope="col">
                    <span className="flex flex-wrap items-center justify-center gap-1">
                      {/* 열 이름은 글자로 남긴다 — 필터 둘만 있으면 이 열의 접근성 이름이 "학년 필터 정렬 필터"가 된다(리뷰).
                          ⚠️ 폰(<768px)에선 `.stack-rows`가 이 글자를 감춘다(data-cell="label") — 카드엔 열이 없어 열 이름이 뜻을 잃는다. */}
                      <span className="px-1" data-cell="label">{sheetT(lang, "stu.col.student")}</span>
                      {/* 저장값을 이기려면 "전체"도 URL에 적혀야 한다(explicitAll) — 학년·과목·담임·정렬 넷이 그렇다. */}
                      <span data-help="st-grade" className="inline-flex flex-wrap items-center justify-center gap-1">
                      <HeaderFilter
                        paramName="grade"
                        clearParams={exit("grade")}
                        value={grade}
                        options={gradeOptions}
                        axisLabel={sheetT(lang, "stu.filter.grade")}
                        allValue="all"
                        explicitAll
                        multiple
                      />
                      <HeaderFilter
                        paramName="sort"
                        clearParams={exit("sort")}
                        value={sort}
                        options={sortOptions}
                        axisLabel={sheetT(lang, "stu.filter.sort")}
                        allValue="grade"
                        allLabel={sheetT(lang, "stu.filter.sort.grade")}
                        explicitAll
                        showAll
                      />
                      </span>
                    </span>
                  </th>
                  <th scope="col" data-help="st-status">
                    {/* 기본값(재원)이 휴원·퇴원을 **숨기므로** 값을 항상 적는다(showAll). */}
                    <HeaderFilter
                      paramName="status"
                      clearParams={exit("status")}
                      value={status}
                      options={statusOptions}
                      axisLabel={sheetT(lang, "stu.filter.status")}
                      allValue="enrolled"
                      allLabel={sheetT(lang, "stu.filter.status.enrolled")}
                      showAll
                    />
                  </th>
                  {/* 필터가 없는 갈래(강사 스코프)면 th 자체가 라벨 머리 — span만 감추면 0×0 th가 폰 칩 줄 간격을 먹는다. */}
                  <th scope="col" data-cell={hideSubjectFilter ? "label" : undefined}>
                    {hideSubjectFilter ? (
                      <span className="px-1">{sheetT(lang, "stu.col.subjects")}</span>
                    ) : (
                      <span data-help="st-subject">
                      <HeaderFilter
                        paramName="subject"
                        clearParams={exit("subject")}
                        // 퇴원 목록엔 '미수강' 선택지가 없다 — 저장값에 남아 있어도(서버도 무시한다) '선택지에 없는 값'으로 세우지 않는다.
                        value={status === "withdrawn" ? joinMulti(parseMulti(subject).filter((v) => v !== NO_SUBJECT)) : subject}
                        options={subjectOptions}
                        axisLabel={sheetT(lang, "stu.col.subjects")}
                        allValue="all"
                        explicitAll
                        multiple
                      />
                      </span>
                    )}
                  </th>
                  <th scope="col" data-cell={hideTeacherFilter ? "label" : undefined}>
                    {hideTeacherFilter ? (
                      <span className="px-1">{sheetT(lang, "stu.col.teacher")}</span>
                    ) : (
                      <span data-help="st-teacher">
                      <HeaderFilter
                        paramName="teacher"
                        clearParams={exit("teacher")}
                        value={teacherId}
                        options={teacherOptions}
                        axisLabel={sheetT(lang, "stu.col.teacher")}
                        allValue="all"
                        explicitAll
                        cap={200}
                        multiple
                      />
                      </span>
                    )}
                  </th>
                  {/* 라벨만 있는 머리는 th 자체에 표식 — span만 감추면 0×0 th가 폰 칩 줄의 간격을 먹는다. */}
                  <th scope="col" data-cell="label">
                    <span className="px-1">{sheetT(lang, "stu.col.parentPhone")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4">
                      {/* 설명 문장은 넣지 않는다(§4). 검색어만 0건을 만들면 그 q만 지우고, 저장된 필터는 둔다. */}
                      <EmptyState
                        image={q ? "search" : "students"}
                        icon={() => <Users size={32} strokeWidth={1.8} />}
                        title={sheetT(lang, "stu.empty.title")}
                        action={
                          q ? (
                            <EmbedLink
                              href={listParams({ clearQ: true })}
                              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex rounded-full border px-2.5 py-0.5 text-xs transition"
                            >
                              {sheetT(lang, "att.search.clear")}
                            </EmbedLink>
                          ) : null
                        }
                      />
                    </td>
                  </tr>
                ) : null}
                {rows.map((s) => {
                  const meta = studentStatusMeta(s.status, lang) ?? {
                    label: s.status,
                    color: "neutral" as PillColor,
                  };
                  // 이름 + 학교·학년 압축 라벨("경명여중1")을 **한 줄**에(§11 "한 행 = 이름 + 값") — 두 줄 셀은 행을 키운다.
                  const sg = sheetSchoolGrade(s.school, s.grade, lang);
                  const shownName = studentDisplayName(s.name, s.englishName, lang);
                  return (
                    <tr key={s.id} data-help="st-row" className="hover:bg-bg-soft/50 transition-colors [&>td]:px-3 [&>td]:py-2.5 [&>td]:text-center">
                      <td data-cell="primary">
                        <span className="phone:justify-start flex min-w-0 items-center justify-center gap-1.5">
                          {/* 이름은 1차 식별자라 줄지 않는다(§1 "1차 핵심값 ellipsis 금지") — 좁으면 학교·학년(2차)이 먼저 접힌다. */}
                          <WindowLink
                            href={`/students/${s.id}`}
                            title={shownName}
                            ariaLabel={sheetTf(lang, "stu.rowAria", { name: shownName })}
                            className="text-foreground shrink-0 text-base font-bold whitespace-nowrap hover:underline"
                          >
                            {shownName}
                          </WindowLink>
                          {sg ? <span className="text-text-dim min-w-0 truncate text-sm">{sg}</span> : null}
                          {s.syncNew ? <MakeeduOriginTag /> : null}
                          {s.dupSuspect ? <DupSuspectTag /> : null}
                          {/* 병합된 학생은 집계(퇴원 수·등록 추이)에서만 빠지고 목록에는 남는다 —
                              감추면 데스크가 병합을 확인하거나 되짚을 길이 사라진다(원장 2026-09-13). */}
                          {s.merged ? <MergedTag /> : null}
                          <EditingBadge scope={`student:${s.id}`} />
                        </span>
                      </td>
                      <td data-cell="status">
                        <Pill color={meta.color}>{meta.label}</Pill>
                      </td>
                      <td data-empty={s.subjects.length === 0 ? "true" : undefined}>
                        {s.subjects.length === 0 ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <span className="phone:justify-start flex flex-wrap justify-center gap-1">
                            {s.subjects.map((sub) => (
                              <Pill key={sub} color={subjects.colorOf(sub)}>
                                {subjects.labelOf(sub)}
                              </Pill>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="text-text-dim" data-empty={s.teacherNames.length === 0 ? "true" : undefined}>
                        <span className="block truncate" title={s.teacherNames.map(showTeacher).join(" · ")}>
                          {s.teacherNames.length > 0 ? s.teacherNames.map(showTeacher).join("·") : "—"}
                        </span>
                      </td>
                      {/* 🔴 우측 정렬이 아니다 — 전화번호는 **자릿수를 견주는 수가 아니라 식별자**다(합계도 대소도 없다).
                          오른쪽에 붙여 두면 가운데 있는 열 제목과 이 열만 따로 놀고, 번호가 없는 행의 `—`가
                          표 오른쪽 끝에 홀로 매달린다. 열 제목과 같은 축(가운데 — 원장 2026-09-18)에 둔다.
                          ⚠️ `num`(고정폭 숫자)은 남긴다 — 자릿수가 같아야 번호가 위아래로 줄을 이룬다. */}
                      <td className="text-text-dim num whitespace-nowrap" data-empty={s.parentPhone ? undefined : "true"}>
                        {s.parentPhone ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 ? <Pagination lang={lang} page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
      </>
    </div>
  );
}
