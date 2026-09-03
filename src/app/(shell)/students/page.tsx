import { Users } from "@/components/icons/eywa-icon-compat";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { FilterSelect } from "@/components/filter-select";
import { HeaderFilter } from "@/components/header-filter";
import { SearchToggle } from "@/components/search-toggle";
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
  parseSearchField,
  parseStudentSort,
  type StudentListPrefs,
} from "@/features/students/list-prefs";
import { WindowLink } from "@/components/workspace/window-link";
import { PageHeader } from "@/components/page-header";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { studentStatusMeta } from "@/features/students/status-labels";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { NewStudentTrigger } from "./_components/new-student-trigger";
import { StudentsMoreMenu } from "./_components/students-more-menu";
import { RememberPrefs } from "@/components/remember-prefs";
import { EnrolledStatCard } from "./_components/enrolled-stat-card";

export const metadata = { title: "학생목록 — eywa" };

// 상태 — 디폴트(재원)는 파라미터가 없을 때다. "전체"는 명시적 status=all로만(HeaderFilter의 allValue=enrolled가 지운다).
const STATUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "consulted", label: "예비·상담" },
  { value: "on_hold", label: "휴원" },
  { value: "withdrawn", label: "퇴원" },
];
const SORT_OPTIONS = [
  { value: "name", label: "이름순" },
  { value: "recent", label: "등록일순" },
];
const FIELD_OPTIONS = [
  { value: "name", label: "이름" },
  { value: "school", label: "학교" },
  { value: "phone", label: "전화번호" },
  { value: "address", label: "주소" },
  { value: "email", label: "이메일" },
  { value: "memo", label: "메모" },
];
const PAGE_SIZE = 50;

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
  const [scope, prefs] = await Promise.all([effectiveTeacherScope(), loadStudentListPrefs()]);
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
    if (fromPrefs("teacher") && !teachersEarly.some((t) => t.id === teacherRaw)) teacherId = "all";
    if (fromPrefs("grade") && !settingsEarly.operations.gradeLevels.includes(gradeRaw)) grade = "all";
    if (fromPrefs("subject") && !settingsEarly.operations.subjects.some((s) => s.key === subjectRaw)) subject = "all";
  }

  const [{ rows, total }, counts, [teachers, settings]] = await Promise.all([
    getStudentsPage(
      { status, subject, q, grade, teacherId, searchField: field, sort, excludeNoEnrollment },
      page,
      PAGE_SIZE,
    ),
    statCountsPromise,
    optionsPromise,
  ]);
  const { enrolled, bySubject } = counts;
  // 과목·학년 필터·라벨·색은 학원설정(operations) 단일 소스 — 미등록 값은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 강사 스코프면 과목 선택지도 담당 과목만. 고를 게 1개뿐이면 필터 자체를 감춘다(잡음).
  const subjectOptions = narrowSubjectFilters(axis, subjects.filters).filter((f) => f.value !== "all");
  const hideSubjectFilter = !showSubjectFilter(axis);
  const gradeOptions = settings.operations.gradeLevels.map((g) => ({ value: g, label: g }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.displayName }));
  // 담임 필터 — 스코프에서 고를 사람이 나 하나뿐이면 감춘다(전체/나 = 같은 결과).
  // ⚠️ 이미 값이 걸려 있으면 남겨 둔다 — 감추면 "전체"로 되돌릴 길이 없다.
  const hideTeacherFilter = axis !== null && teacherOptions.length <= 1 && teacherId === "all";

  // 저장할 보기 설정 — 저장값과 다르면 클라가 한 번 저장한다(공용 RememberPrefs — 수업목록과 한 벌). 🔴 **사용자가 고른 값(URL) 또는 이미 저장된 값**만 —
  // 위 보정(축 밖 과목 → 전체 · 선택지 밖 담임/학년 → 전체)은 이 화면 한정이라 계정에 쓰지 않는다(리뷰 확정 2026-09-03: 겸직 관리자가
  // 강사뷰·다른 강사 뷰를 열면 보정값이 관리자 본인의 저장 설정을 덮어썼다).
  const current: StudentListPrefs = {
    subject: sp.subject ?? prefs.subject,
    grade: sp.grade ?? prefs.grade,
    teacher: sp.teacher ?? prefs.teacher,
    field,
    sort,
    noenr: excludeNoEnrollment,
  };

  /**
   * 목록 링크(쪽 넘김·미수강 토글)가 들고 갈 파라미터 — 기본값과 다르거나 **URL이 명시한** 축은 그대로 적는다.
   * 저장값에서 온 축도 값이 기본값과 다르면 적히므로, 링크를 따라가도 지금 보는 필터가 그대로다.
   * ⚠️ URL이 적은 과목은 **적힌 그대로** 잇는다(위 축 보정값이 아니라) — 보정값을 링크에 실으면 다음 렌더가 그것을 사용자 선택으로
   * 읽어 계정에 저장한다(재리뷰 2026-09-03). 학년·담임은 URL 값이면 보정하지 않으니 그대로다.
   */
  const listParams = (patch: { page?: number; noenr?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (status !== "enrolled") params.set("status", status);
    if (sp.subject !== undefined) params.set("subject", sp.subject);
    else if (subject !== DEFAULT_STUDENT_LIST_PREFS.subject) params.set("subject", subject);
    if (grade !== DEFAULT_STUDENT_LIST_PREFS.grade || sp.grade !== undefined) params.set("grade", grade);
    if (teacherId !== DEFAULT_STUDENT_LIST_PREFS.teacher || sp.teacher !== undefined) params.set("teacher", teacherId);
    if (field !== DEFAULT_STUDENT_LIST_PREFS.field || sp.field !== undefined) params.set("field", field);
    if (sort !== DEFAULT_STUDENT_LIST_PREFS.sort || sp.sort !== undefined) params.set("sort", sort);
    const noenr = patch.noenr ?? excludeNoEnrollment;
    if (noenr || sp.noenr !== undefined || patch.noenr !== undefined) params.set("noenr", noenr ? "1" : "0");
    if (q) params.set("q", q);
    if ((patch.page ?? 1) > 1) params.set("page", String(patch.page));
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
  }).toString()}`;

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      <RememberPrefs current={current} saved={prefs} save={saveStudentListPrefs} />
      {/* 머리 — 지시서 §10: 상시 버튼은 Primary('새 학생') 하나 + 텍스트 Secondary('엑셀' 메뉴) 하나. 내보내기·가져오기는
          그 메뉴(2차)로 내렸다. 동기화 배지는 읽기 전용 표식이라 그대로. */}
      <PageHeader
        eyebrow="학생 관리"
        title="학생목록"
        description={`재원 ${enrolled}명${axis ? " · 담당 과목 기준" : ""}`}
        actions={
          <>
            <MakeeduSyncBadge domain="students" />
            <StudentsMoreMenu exportHref={exportHref} canImport={canManageStudent} />
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
          결과 <span className="text-foreground font-bold">{total}</span>명
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
          {q ? <span className="ml-1.5">· &ldquo;{q}&rdquo; 검색</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* 상태=퇴원에선 숨김 — 퇴원생은 활성 수강이 없어 이 토글이 켜져 있으면 전원이 걸러져
              "검색해도 항상 0명"이 된다(2026-08-18 실사고). 서버(getStudentsPage)도 같은 조건에서 무시. */}
          {status !== "withdrawn" ? (
            <ToolbarChip active={excludeNoEnrollment} href={listParams({ noenr: !excludeNoEnrollment })}>
              미수강 제외
            </ToolbarChip>
          ) : null}
          <SearchToggle
            placeholder="이름·학교·연락처"
            defaultValue={q}
            extra={
              <FilterSelect
                paramName="field"
                value={field}
                options={FIELD_OPTIONS}
                allValue="all"
                allLabel="전체"
                axisLabel="검색 범위"
                ariaLabel="검색 범위"
                explicitAll
                className="w-auto"
                triggerClassName={TOOLBAR_SELECT}
              />
            }
          />
        </div>
      </div>

      {/* 🔴 표는 결과가 0명이어도 그린다 — 열 머리가 곧 필터라, 표를 치우면 걸린 필터를 되돌릴 컨트롤이 함께 사라진다
          (실브라우저 검증 2026-09-03: 휴원+학년 '7세'로 0명이 되자 학년을 풀 길이 없었고 저장값이라 다음 방문에도 0명이었다).
          빈 상태는 표 본문 안에 선다. */}
      <>
          {/* 표 — 이 메뉴의 최소 창(960)에 맞춘 고정 열(`table-fixed`)이라 창 안에선 가로 스크롤이 없다(열 머리 팝업이
              잘리지 않게 `overflow`를 걸지 않는다 — HeaderFilter 주석). 폰(768px 미만)만 가로 스크롤.
              행 = 이름(학교·학년) + 상태 + 과목 + 담당 강사 + 연락처 한 줄, 행 사이 헤어라인(§11). */}
          <div className="bg-card shadow-card rounded-2xl max-md:overflow-x-auto">
            <table className="w-full table-fixed text-sm max-md:min-w-[46rem]">
              {/* 열 폭 — 최소 창(958)에서 상태 머리 `상태: 예비·상담 ⌄`(128px)가 들어가는 16%(153−24). 이름 열 287px = 이름·학교학년·표식. */}
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[16%]" />
                <col className="w-[20%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="border-line border-b">
                {/* 열 제목은 가운데(데이터 표 규약 2026-08-05) — 본문 값은 좌측 그대로. */}
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold [&>th]:whitespace-nowrap">
                  <th scope="col">
                    <span className="flex flex-wrap items-center justify-center gap-1">
                      {/* 열 이름은 글자로 남긴다 — 필터 둘만 있으면 이 열의 접근성 이름이 "학년 필터 정렬 필터"가 된다(리뷰). */}
                      <span className="px-1">학생</span>
                      {/* 저장값을 이기려면 "전체"도 URL에 적혀야 한다(explicitAll) — 학년·과목·담임·정렬 넷이 그렇다. */}
                      <HeaderFilter
                        paramName="grade"
                        value={grade}
                        options={gradeOptions}
                        axisLabel="학년"
                        allValue="all"
                        explicitAll
                      />
                      <HeaderFilter
                        paramName="sort"
                        value={sort}
                        options={SORT_OPTIONS}
                        axisLabel="정렬"
                        allValue="grade"
                        allLabel="학년순"
                        explicitAll
                        showAll
                      />
                    </span>
                  </th>
                  <th scope="col">
                    {/* 기본값(재원)이 휴원·퇴원을 **숨기므로** 값을 항상 적는다(showAll). */}
                    <HeaderFilter
                      paramName="status"
                      value={status}
                      options={STATUS_OPTIONS}
                      axisLabel="상태"
                      allValue="enrolled"
                      allLabel="재원"
                      showAll
                    />
                  </th>
                  <th scope="col">
                    {hideSubjectFilter ? (
                      <span className="px-1">수강 과목</span>
                    ) : (
                      <HeaderFilter
                        paramName="subject"
                        value={subject}
                        options={subjectOptions}
                        axisLabel="수강 과목"
                        allValue="all"
                        explicitAll
                      />
                    )}
                  </th>
                  <th scope="col">
                    {hideTeacherFilter ? (
                      <span className="px-1">담당 강사</span>
                    ) : (
                      <HeaderFilter
                        paramName="teacher"
                        value={teacherId}
                        options={teacherOptions}
                        axisLabel="담당 강사"
                        allValue="all"
                        explicitAll
                        cap={200}
                      />
                    )}
                  </th>
                  <th scope="col">
                    <span className="px-1">학부모 연락처</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4">
                      {/* 설명 문장 없이 제목만(§4) — 되돌릴 필터는 바로 위 열 머리에 보인다. */}
                      <EmptyState
                        image={q ? "search" : "students"}
                        icon={() => <Users size={32} strokeWidth={1.8} />}
                        title="결과 없음"
                      />
                    </td>
                  </tr>
                ) : null}
                {rows.map((s) => {
                  const meta = studentStatusMeta(s.status) ?? {
                    label: s.status,
                    color: "neutral" as PillColor,
                  };
                  // 이름 + 학교·학년 압축 라벨("경명여중1")을 **한 줄**에(§11 "한 행 = 이름 + 값") — 두 줄 셀은 행을 키운다.
                  const sg = schoolGradeLabel(s.school, s.grade);
                  return (
                    <tr key={s.id} className="hover:bg-bg-soft/50 transition-colors [&>td]:px-3 [&>td]:py-2.5">
                      <td>
                        <span className="flex min-w-0 items-center gap-1.5">
                          {/* 이름은 1차 식별자라 줄지 않는다(§1 "1차 핵심값 ellipsis 금지") — 좁으면 학교·학년(2차)이 먼저 접힌다. */}
                          <WindowLink
                            href={`/students/${s.id}`}
                            title={s.name}
                            ariaLabel={`${s.name} 학생 정보`}
                            className="text-foreground shrink-0 text-base font-bold whitespace-nowrap hover:underline"
                          >
                            {s.name}
                          </WindowLink>
                          {sg ? <span className="text-text-dim min-w-0 truncate text-sm">{sg}</span> : null}
                          {s.syncNew ? <MakeeduOriginTag /> : null}
                          {s.dupSuspect ? <DupSuspectTag /> : null}
                          <EditingBadge scope={`student:${s.id}`} />
                        </span>
                      </td>
                      <td>
                        <Pill color={meta.color}>{meta.label}</Pill>
                      </td>
                      <td>
                        {s.subjects.length === 0 ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {s.subjects.map((sub) => (
                              <Pill key={sub} color={subjects.colorOf(sub)}>
                                {subjects.labelOf(sub)}
                              </Pill>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="text-text-dim">
                        <span className="block truncate" title={s.teacherNames.join(" · ")}>
                          {s.teacherNames.length > 0 ? s.teacherNames.join("·") : "—"}
                        </span>
                      </td>
                      <td className="text-text-dim num text-right whitespace-nowrap">{s.parentPhone ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 0 ? <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} /> : null}
      </>
    </div>
  );
}
