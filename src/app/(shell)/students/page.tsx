import { UserCheck, UserMinus, UserPlus, Users, type LucideIcon } from "lucide-react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getStudentsPage,
  getStudentStatusCounts,
  getTeacherOptions,
  type StudentSort,
  type SearchField,
} from "@/features/students/server/queries";
import { WindowLink } from "@/components/workspace/window-link";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { NewStudentTrigger } from "./_components/new-student-trigger";
import { StudentImportDialog } from "./_components/student-import-dialog";
import { StudentFilterBar } from "./_components/student-filter-bar";

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
  const status = sp.status ?? "all";
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
    getStudentStatusCounts(),
    getTeacherOptions(),
    getTenantSettings(),
  ]);
  const { all, enrolled, prospect, withdrawn } = counts;
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
    if (status !== "all") params.set("status", status);
    if (subject !== "all") params.set("subject", subject);
    if (q) params.set("q", q);
    for (const [k, v] of Object.entries(advParams)) params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/students?${s}` : "/students";
  };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체" value={all} unit="명" color="primary" icon={Users} />
        <Stat label="재원" value={enrolled} unit="명" color="primary" icon={UserCheck} />
        <Stat label="예비·상담" value={prospect} unit="명" color="gold" icon={UserPlus} />
        <Stat label="퇴원" value={withdrawn} unit="명" color="neutral" icon={UserMinus} />
      </section>

      {/* 필터바 — 전부 드롭다운(칩 나열 X) 한 줄, 좁은 창에선 2줄. 수업목록 ClassFilterBar와 동일 패러다임. */}
      <StudentFilterBar
        current={filterState}
        teachers={teacherOptions}
        subjectFilters={subjects.filters}
        gradeFilters={gradeFilters}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>명
          {totalPages > 1 ? <span className="text-text-dim ml-2">{page}/{totalPages} 페이지</span> : null}
          {q ? <span className="text-text-dim ml-2">&ldquo;{q}&rdquo; 검색</span> : null}
        </p>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={() => <Users size={32} strokeWidth={1.5} />}
          title="결과 없음"
          description="검색어/필터를 조정해보세요."
        />
      ) : (
        <>
        <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-5 py-3 text-left">학생</th>
                <th className="micro px-5 py-3 text-left">학년</th>
                <th className="micro px-5 py-3 text-left">학교</th>
                <th className="micro px-5 py-3 text-left">상태</th>
                <th className="micro px-5 py-3 text-left">수강 과목</th>
                <th className="micro px-5 py-3 text-left">담임</th>
                <th className="micro px-5 py-3 text-right">학부모 연락처</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((s) => {
                const meta = STATUS_META[s.status] ?? { label: s.status, color: "neutral" as PillColor };
                return (
                  <tr key={s.id} className="hover:bg-bg-soft/50 transition-colors">
                    <td className="px-5 py-3">
                      <WindowLink
                        href={`/students/${s.id}`}
                        title={s.name}
                        ariaLabel={`${s.name} 학생 정보`}
                        className="text-foreground text-[13px] font-bold hover:underline"
                      >
                        {s.name}
                      </WindowLink>
                    </td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.grade ?? "—"}</td>
                    <td className="text-text-dim px-5 py-3 text-xs">{s.school ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Pill color={meta.color}>{meta.label}</Pill>
                    </td>
                    <td className="px-5 py-3">
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
                    <td className="text-text-dim px-5 py-3 text-xs">
                      {s.primaryTeacherName ?? "—"}
                    </td>
                    <td className="text-text-dim num px-5 py-3 text-right text-xs">
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

function Stat({
  label,
  value,
  unit,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  unit: string;
  color: "primary" | "gold" | "blue" | "neutral";
  icon: LucideIcon;
}) {
  const ICON_BG: Record<typeof color, string> = {
    primary: "bg-primary-soft text-primary",
    gold: "bg-gold-soft text-gold",
    blue: "bg-blue-soft text-blue",
    neutral: "bg-bg-soft text-text-dim",
  };
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={2} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}
