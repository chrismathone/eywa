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
import {
  getStudentsPage,
  getEnrolledStatCounts,
  getTeacherOptions,
  type StudentSort,
  type SearchField,
} from "@/features/students/server/queries";
import { WindowLink } from "@/components/workspace/window-link";
import { PageHeader } from "@/components/page-header";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { NewStudentTrigger } from "./_components/new-student-trigger";
import { StudentImportDialog } from "./_components/student-import-dialog";
import { StudentFilterBar } from "./_components/student-filter-bar";
import { EnrolledStatCard } from "./_components/enrolled-stat-card";

export const metadata = { title: "학생목록 — eywa" };

const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  prospect: { label: "예비", color: "amber" },
  consulted: { label: "상담완료", color: "blue" },
  enrolled: { label: "재원", color: "primary" },
  on_hold: { label: "휴원", color: "amber" },
  withdrawn: { label: "퇴원", color: "neutral" },
};

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
  await requireAccess("students");
  const sp = await searchParams;
  // 상태 필터 디폴트 = 재원(운영에서 당장 중요한 건 재원생). "전체"는 명시적 status=all로만.
  const status = sp.status ?? "enrolled";
  const subject = sp.subject ?? "all";
  const q = sp.q ?? "";
  // 고급 필터
  const grade = sp.grade ?? "all";
  const teacherId = sp.teacher ?? "all";
  const field = (sp.field ?? "all") as SearchField;
  const sort = (sp.sort === "name" || sp.sort === "recent" ? sp.sort : "grade") as StudentSort;
  const excludeNoEnrollment = sp.noenr === "1";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, counts, teachers, settings] = await Promise.all([
    getStudentsPage(
      { status, subject, q, grade, teacherId, searchField: field, sort, excludeNoEnrollment },
      page,
      PAGE_SIZE,
    ),
    getEnrolledStatCounts(),
    getTeacherOptions(),
    getTenantSettings(),
  ]);
  const { enrolled, bySubject } = counts;
  // 과목·학년 필터·라벨·색은 학원설정(operations) 단일 소스 — 미등록 값은 드롭다운에 안 뜸.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const gradeFilters = [
    { value: "all", label: "전체" },
    ...settings.operations.gradeLevels.map((g) => ({ value: g, label: g })),
  ];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.displayName }));
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
        eyebrow="학생 관리"
        title="학생목록"
        description={`재원 ${enrolled}명 · 학원설정 과목 기준`}
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
              엑셀 내보내기
            </Button>
            <StudentImportDialog />
            <NewStudentTrigger />
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
        subjectFilters={subjects.filters}
        gradeFilters={gradeFilters}
      />

      {/* 결과 카운트 — 액션은 PageHeader 우측으로 이동(문법 ①), 여기는 맥락 라인만 */}
      <p className="text-text-dim px-1 text-[13px]">
        결과 <span className="text-foreground font-bold">{total}</span>명
        {totalPages > 1 ? <span className="ml-2">{page}/{totalPages} 페이지</span> : null}
        {q ? <span className="ml-2">&ldquo;{q}&rdquo; 검색</span> : null}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          image={q ? "search" : "students"}
          icon={() => <Users size={32} strokeWidth={1.8} />}
          title="결과 없음"
          description="검색어/필터를 조정해보세요."
        />
      ) : (
        <>
        <div className="bg-card shadow-card overflow-x-auto rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-5 py-3 text-left">학생</th>
                <th className="micro px-5 py-3 text-left">상태</th>
                <th className="micro px-5 py-3 text-left">수강 과목</th>
                <th className="micro px-5 py-3 text-left">담당 강사</th>
                <th className="micro px-5 py-3 text-right">학부모 연락처</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((s) => {
                const meta = STATUS_META[s.status] ?? { label: s.status, color: "neutral" as PillColor };
                // 구조화 행(문법 ⑤) — 이름 bold + 학교·학년 압축 라벨("경명여중1") dim 서브라인
                const sg = schoolGradeLabel(s.school, s.grade);
                return (
                  <tr key={s.id} className="hover:bg-bg-soft/50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5">
                        <WindowLink
                          href={`/students/${s.id}`}
                          title={s.name}
                          ariaLabel={`${s.name} 학생 정보`}
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
                      {s.teacherNames.length > 0 ? s.teacherNames.join("·") : "—"}
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

