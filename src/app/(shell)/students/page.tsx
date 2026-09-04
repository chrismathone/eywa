import { Users } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { DupSuspectTag } from "@/components/dup-suspect-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import {
  getStudentsPage,
  getEnrolledStatCounts,
  getTeacherOptions,
  getScopedTeacherOptions,
  type StudentSort,
  type SearchField,
} from "@/features/students/server/queries";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import {
  subjectAxisOf,
  narrowSubjectFilters,
  showSubjectFilter,
  coerceSubjectFilter,
} from "@/features/students/scope-axis";
import { WindowLink } from "@/components/workspace/window-link";
import { PageHeader } from "@/components/page-header";
import { schoolGradeLabel } from "@/lib/format/school-grade";
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
import { StudentImportDialog } from "./_components/student-import-dialog";
import { StudentFilterBar } from "./_components/student-filter-bar";
import { EnrolledStatCard } from "./_components/enrolled-stat-card";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "stu.title")} — eywa` };
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
  }>;
}) {
  const user = await requireAccess("students");
  // 학생 생성(새 학생·엑셀 가져오기) = full만 — 강사(scoped)는 열람 전용(원장 지시 2026-08-18).
  // 서버 액션(createStudent·import-actions)도 같은 full 판정이라 UI 숨김은 이중 방어다(#77).
  const canManageStudent = (await accessLevelTenant(user.systemRole, "students")) === "full";
  const sp = await searchParams;
  // 상태 필터 디폴트 = 재원(운영에서 당장 중요한 건 재원생). "전체"는 명시적 status=all로만.
  const status = sp.status ?? "enrolled";
  // 표시 축(원장 2026-08-20) — 강사 스코프면 **담당 과목**으로 축을 좁힌다(관리자·담당 반 0개는 null=종전 동일).
  // ⚠️ 좁히는 건 축(게이지·배지·담당 강사·선택지)뿐. 누가 보이는지(getTeacherScope)는 안 건드린다.
  const axis = subjectAxisOf(await effectiveTeacherScope());
  // 🔴 과목 필터를 감춘 화면(담당 과목 1개)에선 걸려 있던 값을 "전체"로 되돌린다 — 저장된 필터
  // (localStorage 복원·직접 URL)가 남아 있으면 되돌릴 컨트롤이 없는데 행이 조용히 빠진다
  // (축 밖 과목이면 0명 · 축 안 과목이어도 on_hold=false 조건 때문에 **휴원 학생이 사라진다**).
  const subject = coerceSubjectFilter(axis, sp.subject);
  const q = sp.q ?? "";
  // 고급 필터
  const grade = sp.grade ?? "all";
  const teacherId = sp.teacher ?? "all";
  const field = (sp.field ?? "all") as SearchField;
  const sort = (sp.sort === "name" || sp.sort === "recent" ? sp.sort : "grade") as StudentSort;
  const excludeNoEnrollment = sp.noenr === "1";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  // 담임 필터 선택지 — 강사 스코프에선 **내 학생의 담당 과목 반 담당**만(고르면 결과가 0인 선택지 방지 +
  // 아래 '담당 강사' 열에 실제로 나오는 이름과 일치). 관리자면 종전 학원 전체 목록.
  // 두 갈래의 반환 타입이 달라(스코프본엔 systemRole이 없다) 여기서 공통 모양으로 좁혀 둔다.
  const teacherOptionsPromise: Promise<{ id: string; displayName: string }[]> = axis
    ? getScopedTeacherOptions().then((r) => r ?? [])
    : getTeacherOptions();

  const [{ rows, total }, counts, teachers, settings] = await Promise.all([
    getStudentsPage(
      { status, subject, q, grade, teacherId, searchField: field, sort, excludeNoEnrollment },
      page,
      PAGE_SIZE,
    ),
    getEnrolledStatCounts(),
    teacherOptionsPromise,
    getTenantSettings(),
  ]);
  const [lang, teacherNames] = await Promise.all([
    getTeacherViewLang(),
    getTeacherEnglishNames(),
  ]);
  const showTeacher = (n: string) => teacherNameFor(n, teacherNames, lang) ?? n;
  const { enrolled, bySubject } = counts;
  // 과목·학년 필터·라벨·색은 학원설정(operations) 단일 소스 — 미등록 값은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 강사 스코프면 과목 선택지도 담당 과목만. 고를 게 1개뿐이면 필터 자체를 감춘다(잡음).
  // 🔴 과목 **라벨**은 학원설정 단일 소스라 그대로 — 언어를 타는 건 우리가 붙인 '전체'뿐이다.
  const subjectFilters = narrowSubjectFilters(axis, subjects.filters).map((f) =>
    f.value === "all" ? { ...f, label: sheetT(lang, "stu.filter.all") } : f,
  );
  const hideSubjectFilter = !showSubjectFilter(axis);
  const gradeFilters = [
    { value: "all", label: sheetT(lang, "stu.filter.all") },
    ...settings.operations.gradeLevels.map((g) => ({ value: g, label: g })),
  ];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: showTeacher(t.displayName) }));
  // 담임 필터 — 스코프에서 고를 사람이 나 하나뿐이면 감춘다(전체/나 = 같은 결과).
  // ⚠️ 이미 값이 걸려 있으면(옛 localStorage 복원 등) 남겨 둔다 — 감추면 "전체"로 되돌릴 길이 없다.
  const hideTeacherFilter = axis !== null && teacherOptions.length <= 1 && teacherId === "all";
  // 검색폼·페이지·export가 보존해야 할 고급 파라미터(기본값이 아닌 것만)
  const advParams: Record<string, string> = {
    ...(grade !== "all" ? { grade } : {}),
    ...(teacherId !== "all" ? { teacher: teacherId } : {}),
    ...(field !== "all" ? { field } : {}),
    ...(sort !== "grade" ? { sort } : {}),
    ...(excludeNoEnrollment ? { noenr: "1" } : {}),
  };

  const filterState = {
    status,
    subject,
    grade,
    teacher: teacherId,
    field,
    sort,
    noenr: excludeNoEnrollment,
    q,
  };
  // 페이지 이동 링크 — 현재 필터(고급 포함) 유지 + page 지정 (필터 변경은 page 미포함이라 자동 1페이지)
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    // 디폴트(재원)만 생략 — "전체"는 status=all을 명시해야 유지된다(무param=재원).
    if (status !== "enrolled") params.set("status", status);
    if (subject !== "all") params.set("subject", subject);
    if (q) params.set("q", q);
    for (const [k, v] of Object.entries(advParams)) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/students?${s}` : "/students";
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브 + 우측 액션(엑셀·가져오기·신규) */}
      <PageHeader
        eyebrow={sheetT(lang, "stu.eyebrow")}
        title={sheetT(lang, "stu.title")}
        description={sheetTf(lang, "stu.desc", {
          n: enrolled,
          basis: sheetT(lang, axis ? "stu.basis.mine" : "stu.basis.settings"),
        })}
        actions={
          <>
            {/* ⚠️ 동기화 배지도 이 행 안에 — 따로 두면 배지 하나가 한 줄을 통째로 먹는다(우측 텅 빔). */}
            <MakeeduSyncBadge domain="students" />
            <Button
              variant="outline"
              render={
                <a
                  href={`/api/exports/students?${new URLSearchParams({
                    ...(status !== "all" ? { status } : {}),
                    ...(subject !== "all" ? { subject } : {}),
                    ...(q ? { q } : {}),
                    ...advParams,
                  }).toString()}`}
                />
              }
            >
              <EyIcon name="arrowDown" size={13} />
              {sheetT(lang, "stu.excel")}
            </Button>
            {canManageStudent ? <StudentImportDialog /> : null}
            {canManageStudent ? <NewStudentTrigger /> : null}
          </>
        }
      />
      {/* 히어로 카드 — 재원 총원 + 과목별 재원생 비중(전체/퇴원은 상태 필터로). 과목이 늘어도 카드 1장 고정.
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

      {/* 필터바 — 전부 드롭다운(칩 나열 X) 한 줄, 좁은 창에선 2줄. 수업목록 ClassFilterBar와 동일 패러다임. */}
      <StudentFilterBar
        current={filterState}
        teachers={teacherOptions}
        subjectFilters={subjectFilters}
        gradeFilters={gradeFilters}
        hideSubjectFilter={hideSubjectFilter}
        hideTeacherFilter={hideTeacherFilter}
      />

      {/* 결과 카운트 — 액션은 PageHeader 우측으로 이동(문법 ①), 여기는 맥락 라인만 */}
      <p className="text-text-dim px-1 text-[13px]">
        {sheetT(lang, "stu.count.pre")}
        <span className="text-foreground font-bold">{total}</span>
        {sheetT(lang, "stu.count.post")}
        {totalPages > 1 ? (
          <span className="ml-2">{sheetTf(lang, "stu.count.pages", { page, total: totalPages })}</span>
        ) : null}
        {q ? <span className="ml-2">{sheetTf(lang, "stu.count.q", { q })}</span> : null}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          image={q ? "search" : "students"}
          icon={() => <Users size={32} strokeWidth={1.8} />}
          title={sheetT(lang, "stu.empty.title")}
          description={sheetT(lang, "stu.empty.desc")}
        />
      ) : (
        <>
        <div className="bg-card shadow-card overflow-x-auto rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-5 py-3 text-left">{sheetT(lang, "stu.col.student")}</th>
                <th className="micro px-5 py-3 text-left">{sheetT(lang, "stu.col.status")}</th>
                <th className="micro px-5 py-3 text-left">{sheetT(lang, "stu.col.subjects")}</th>
                <th className="micro px-5 py-3 text-left">{sheetT(lang, "stu.col.teacher")}</th>
                <th className="micro px-5 py-3 text-right">
                  {sheetT(lang, "stu.col.parentPhone")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((s) => {
                const meta = studentStatusMeta(s.status, lang) ?? {
                  label: s.status,
                  color: "neutral" as PillColor,
                };
                // 구조화 행(문법 ⑤) — 이름 bold + 학교·학년 압축 라벨("경명여중1") dim 서브라인
                const sg = schoolGradeLabel(s.school, s.grade);
                return (
                  <tr key={s.id} className="hover:bg-bg-soft/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5">
                        <WindowLink
                          href={`/students/${s.id}`}
                          title={s.name}
                          ariaLabel={sheetTf(lang, "stu.rowAria", { name: s.name })}
                          className="text-foreground text-[13.5px] font-bold hover:underline"
                        >
                          {s.name}
                        </WindowLink>
                        {s.syncNew ? <MakeeduOriginTag /> : null}
                        {s.dupSuspect ? <DupSuspectTag /> : null}
                        <EditingBadge scope={`student:${s.id}`} />
                      </span>
                      <span className="text-text-dim mt-0.5 block text-[12px]">{sg || "—"}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <Pill color={meta.color}>{meta.label}</Pill>
                    </td>
                    <td className="px-5 py-3.5">
                      {s.subjects.length === 0 ? (
                        <span className="text-text-faint text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.subjects.map((sub) => (
                            <Pill key={sub} color={subjects.colorOf(sub)}>
                              {subjects.labelOf(sub)}
                            </Pill>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="text-text-dim px-5 py-3.5 text-xs">
                      {s.teacherNames.length > 0
                        ? s.teacherNames.map(showTeacher).join("·")
                        : "—"}
                    </td>
                    <td className="text-text-dim num px-5 py-3.5 text-right text-xs">
                      {s.parentPhone ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}

