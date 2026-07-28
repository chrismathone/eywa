import Link from "next/link";
import { Users, Wallet, CalendarClock } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { BigStat } from "@/components/atoms/big-stat";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageStaff, ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import { getStaffList, type StaffRow } from "@/features/staff/server/queries";
import { getSuperAdminIds, displayRoleFor } from "@/lib/auth/super-admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { EMPLOYMENT_TYPES } from "@/features/staff/resume";
import { Pagination } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { FaceTabs, type Face } from "@/components/face-tabs";
import { NewStaffTrigger } from "./_components/new-staff-trigger";
import { PAYROLL_ENABLED } from "@/features/payroll/config";
import { ResumesFace } from "./_components/resumes-face";

export const metadata = { title: "직원관리 — eywa" };

const PAGE_SIZE = 50;

const ROLE_META: Record<string, { label: string; color: PillColor }> = {
  master: { label: "원장", color: "danger" },
  admin: { label: "관리자", color: "blue" },
  manager: { label: "매니저", color: "blue" },
  teacher: { label: "강사", color: "primary" },
  counselor: { label: "상담", color: "rose" },
  accountant: { label: "회계", color: "purple" },
  viewer: { label: "참관", color: "neutral" },
};

const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  active: { label: "재직", color: "primary" },
  inactive: { label: "퇴사", color: "neutral" },
  pending: { label: "대기", color: "amber" },
};

type RoleKey =
  | "all"
  | "master"
  | "admin"
  | "manager"
  | "teacher"
  | "counselor"
  | "accountant";
type StatusKey = "all" | "active" | "inactive" | "pending";

const ROLE_FILTERS: { key: RoleKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "master", label: "원장" },
  { key: "admin", label: "관리자" },
  { key: "manager", label: "매니저" },
  { key: "teacher", label: "강사" },
  { key: "counselor", label: "상담" },
  { key: "accountant", label: "회계" },
];

const STATUS_FILTERS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "active", label: "재직" },
  { key: "inactive", label: "퇴사" },
  { key: "pending", label: "대기" },
];

// 정렬 선택(원장 요청 2026-07-28) — 검색과 별개로 목록 정렬 축을 고른다. 기본 = 역할순(권한 위계).
type SortKey = "role" | "name" | "dept" | "emp" | "hire";
const SORT_FILTERS: { key: SortKey; label: string }[] = [
  { key: "role", label: "역할순" },
  { key: "name", label: "이름순" },
  { key: "dept", label: "부서순" },
  { key: "emp", label: "근무형태순" },
  { key: "hire", label: "입사일순" },
];

function buildStaffHref(p: { role: RoleKey; status: StatusKey; q: string; sort: SortKey }): string {
  const sp = new URLSearchParams();
  if (p.role !== "all") sp.set("role", p.role);
  if (p.status !== "all") sp.set("status", p.status);
  if (p.q) sp.set("q", p.q);
  if (p.sort !== "role") sp.set("sort", p.sort);
  const s = sp.toString();
  return s ? `/staff?${s}` : "/staff";
}

/** 정렬 비교기 — null(미입력)은 항상 뒤로, 동률은 이름 가나다순. */
function sortStaff(rows: StaffRow[], sort: SortKey): StaffRow[] {
  const byName = (a: StaffRow, b: StaffRow) => a.displayName.localeCompare(b.displayName, "ko");
  const nullsLast = (a: string | null, b: string | null) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, "ko");
  };
  const sorted = [...rows];
  switch (sort) {
    case "name":
      return sorted.sort(byName);
    case "dept":
      return sorted.sort((a, b) => nullsLast(a.department, b.department) || byName(a, b));
    case "emp":
      return sorted.sort((a, b) => nullsLast(a.employmentType, b.employmentType) || byName(a, b));
    case "hire":
      // 최근 입사가 위(신입 파악 용도), 미입력은 뒤.
      return sorted.sort((a, b) => {
        if (!a.hireDate && !b.hireDate) return byName(a, b);
        if (!a.hireDate) return 1;
        if (!b.hireDate) return -1;
        return b.hireDate.localeCompare(a.hireDate) || byName(a, b);
      });
    default:
      return sorted; // role — getStaffList + 위장 role 재정렬이 이미 역할순
  }
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{
    invited?: string;
    tab?: string;
    role?: RoleKey;
    status?: StatusKey;
    q?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  await requireAccess("staff");
  const user = await getCurrentUser();
  const canManage = !!user && canManageStaff(user.systemRole);
  const sp = await searchParams;

  // 면 전환(FaceTabs) — 직원 목록 / 직원 이력서(웹 작성 서식 → 데이터베이스 저장).
  const FACES: Face[] = [
    { key: "list", label: "직원 목록", href: "/staff" },
    { key: "resumes", label: "직원 이력서", href: "/staff?tab=resumes" },
  ];
  if (sp.tab === "resumes") {
    return (
      <div className="space-y-5">
        {/* Editorial 문법 ① — eyebrow→헤드라인→서브 */}
        <PageHeader
          eyebrow="운영"
          title="직원관리"
          description="웹 서식으로 작성하는 직원 이력서"
        />
        <FaceTabs faces={FACES} active="resumes" ariaLabel="직원관리 면" />
        <ResumesFace page={Math.max(1, Number(sp.page) || 1)} />
      </div>
    );
  }

  const invited = sp.invited;
  const role: RoleKey = (sp.role as RoleKey) ?? "all";
  const status: StatusKey = (sp.status as StatusKey) ?? "all";
  const q = sp.q ?? "";
  const sort: SortKey = SORT_FILTERS.some((f) => f.key === sp.sort) ? (sp.sort as SortKey) : "role";
  const page = Math.max(1, Number(sp.page) || 1);

  // super_admin(숨은 총괄)은 학원 화면에서 '관리자'로 위장 표시(실제 role/접근 불변, displayRoleFor).
  // 과목 라벨·색은 학원설정 단일 소스(buildSubjectMaps) — 하드코딩 금지 규칙.
  const [rawAll, superAdminIds, settings] = await Promise.all([
    getStaffList(),
    getSuperAdminIds(),
    getTenantSettings(),
  ]);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const all = rawAll
    .map((s) => ({
      ...s,
      systemRole: displayRoleFor(s.id, s.systemRole, superAdminIds),
    }))
    // 배지뿐 아니라 정렬도 위장 role 기준으로 — 안 그러면 super_admin이 실제 role(master)로
    // 맨 위(owner 위)에 뜨는데 배지는 '관리자'라 어긋난다(위장 role로 재정렬 → admin 그룹 이름순).
    .sort(
      (a, b) =>
        ROLE_HIERARCHY[a.systemRole] - ROLE_HIERARCHY[b.systemRole] ||
        a.displayName.localeCompare(b.displayName, "ko"),
    );
  let staff = all;
  if (q) {
    const term = q.toLowerCase();
    staff = staff.filter(
      (s) =>
        s.displayName.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        (s.phone ?? "").toLowerCase().includes(term),
    );
  }
  if (role !== "all") staff = staff.filter((s) => s.systemRole === role);
  if (status !== "all") staff = staff.filter((s) => s.status === status);
  staff = sortStaff(staff, sort);

  // 대시보드(원장 요청 2026-07-28): 전직원 수 · 근무형태별 · 과목별 — 전체(all, 재직+대기) 기준.
  const empCount = (t: string) => all.filter((s) => s.employmentType === t).length;
  const empUnset = all.filter((s) => !s.employmentType).length;
  const subjectStats = subjectMaps.options
    .map((o) => ({
      key: o.value,
      label: o.label,
      color: subjectMaps.colorOf(o.value),
      count: all.filter((s) => s.subjects.includes(o.value)).length,
    }))
    .filter((s) => s.count > 0);
  const current = { role, status, q, sort };

  // 역할 분포 Stat은 전체(all) 기준 — 목록만 50명으로 슬라이스(billing 메모리 페이지네이션).
  const total = staff.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStaff = staff.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (status !== "all") params.set("status", status);
    if (q) params.set("q", q);
    if (sort !== "role") params.set("sort", sort);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/staff?${s}` : "/staff";
  };

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브 */}
      <PageHeader
        eyebrow="운영"
        title="직원관리"
        description="직원 계정·역할과 담당 현황을 관리합니다"
      />
      <FaceTabs faces={FACES} active="list" ariaLabel="직원관리 면" />

      {/* 직원 대시보드(원장 요청 2026-07-28) — 전직원 수 · 근무형태별 · 과목별 */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <BigStat label="전직원" value={all.length} unit="명" tone="primary" icon={<Users size={16} strokeWidth={1.8} />} />
        {EMPLOYMENT_TYPES.map((t) => (
          <BigStat key={t} label={t} value={empCount(t)} unit="명" tone="neutral" />
        ))}
      </section>
      {subjectStats.length > 0 ? (
        <section className="bg-card shadow-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3">
          <span className="micro">과목별</span>
          {subjectStats.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[13px]">
              <Pill color={s.color}>{s.label}</Pill>
              <span className="num text-foreground font-bold">{s.count}</span>
              <span className="text-text-dim text-[11px]">명</span>
            </span>
          ))}
          {empUnset > 0 ? (
            <span className="text-text-faint ml-auto text-[11.5px]">근무형태 미입력 {empUnset}명</span>
          ) : null}
        </section>
      ) : null}

      {/* Filter bar */}
      <div className="bg-card shadow-card space-y-3 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">역할</span>
            {ROLE_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildStaffHref({ ...current, role: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  role === f.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <span className="bg-line h-4 w-px" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">상태</span>
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildStaffHref({ ...current, status: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  status === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <span className="bg-line h-4 w-px" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">정렬</span>
            {SORT_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildStaffHref({ ...current, sort: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  sort === f.key
                    ? "border-primary bg-primary-soft text-primary font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <SearchForm
            placeholder="이름·이메일·연락처"
            defaultValue={q}
            resetParams={["invited", "tab"]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>명
          {totalPages > 1 ? (
            <span className="text-text-faint ml-2 normal-case">
              · {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {PAYROLL_ENABLED && user?.systemRole === "master" ? (
            <Button variant="outline" render={<WindowLink href="/staff/payroll" title="월별 급여" />}>
              <Wallet className="size-4" />
              월별 급여
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="outline" render={<WindowLink href="/staff/leaves" title="휴가 관리" />}>
              <CalendarClock className="size-4" />
              휴가 관리
            </Button>
          ) : null}
          {canManage && user ? (
            <NewStaffTrigger />
          ) : null}
        </div>
      </div>

      {invited ? (
        <p className="border-primary/30 bg-primary-soft text-primary inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <EyIcon name="check" size={14} />
          <span>{invited} 계정이 생성되었습니다. 임시 비밀번호를 직원에게 안내해주세요.</span>
        </p>
      ) : null}

      {total === 0 ? (
        <EmptyState image="staff" icon={() => <Users size={32} strokeWidth={1.8} />} title="등록된 직원이 없습니다" />
      ) : (
        <>
          {/* list(테이블) 형식 — 원장 지시 2026-07-28(카드 그리드에서 전환). 좁은 창은 가로 스크롤. */}
          <div className="bg-card shadow-card overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="border-line text-text-dim border-b text-left text-[11.5px]">
                  <th className="px-4 py-2.5 font-medium">이름</th>
                  <th className="px-3 py-2.5 font-medium">역할</th>
                  <th className="px-3 py-2.5 font-medium">부서</th>
                  <th className="px-3 py-2.5 font-medium">근무형태</th>
                  <th className="px-3 py-2.5 font-medium">직급</th>
                  <th className="px-3 py-2.5 font-medium">과목</th>
                  <th className="px-3 py-2.5 font-medium">입사일</th>
                  <th className="px-3 py-2.5 text-right font-medium">담당 반</th>
                  <th className="px-3 py-2.5 text-right font-medium">담당 학생</th>
                  <th className="px-3 py-2.5 font-medium">상태</th>
                  <th className="px-3 py-2.5 font-medium">
                    <span className="sr-only">직원 상세</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageStaff.map((s) => {
                  const roleMeta = ROLE_META[s.systemRole] ?? ROLE_META.viewer!;
                  const statusMeta = STATUS_META[s.status] ?? STATUS_META.active!;
                  return (
                    <tr key={s.id} className="border-line/60 hover:bg-bg-soft/50 border-b last:border-0 transition">
                      <td className="px-4 py-2.5">
                        {/* 이름 클릭 → 이력서 뷰(원장 지시 2026-07-28 — 수정·삭제도 거기서). 이력서가 없으면
                            직원 정보가 미리 채워진 새 이력서 폼으로. 아바타 금지 — 사람 표시는 이름 텍스트만. */}
                        <WindowLink
                          href={s.resumeId ? `/staff/resumes/${s.resumeId}` : `/staff/resumes/new?staff=${s.id}`}
                          title={`${s.displayName} 이력서`}
                          ariaLabel={`${s.displayName} 이력서`}
                          className="group inline-flex items-center gap-1.5"
                        >
                          <span className="text-foreground font-bold group-hover:underline">{s.displayName}</span>
                          <EditingBadge scope={`staff:${s.id}`} />
                        </WindowLink>
                        <p className="text-text-dim num mt-0.5 truncate text-[11px]">
                          {/* 플레이스홀더(@imported.local)는 미설정으로 표시 — raw 노출 금지. */}
                          {s.email.toLowerCase().endsWith("@imported.local") ? "이메일 미설정" : s.email}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Pill color={roleMeta.color}>{roleMeta.label}</Pill>
                      </td>
                      <td className="text-foreground px-3 py-2.5 whitespace-nowrap">{s.department ?? "—"}</td>
                      <td className="text-foreground px-3 py-2.5 whitespace-nowrap">{s.employmentType ?? "—"}</td>
                      <td className="text-foreground px-3 py-2.5 whitespace-nowrap">{s.jobTitle ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {s.subjects.length > 0
                            ? s.subjects.map((k) => (
                                <Pill key={k} color={subjectMaps.colorOf(k)}>
                                  {subjectMaps.labelOf(k)}
                                </Pill>
                              ))
                            : "—"}
                        </span>
                      </td>
                      <td className="num text-text-dim px-3 py-2.5 whitespace-nowrap">{s.hireDate ?? "—"}</td>
                      <td className="num text-foreground px-3 py-2.5 text-right">
                        {s.classesCount > 0 ? s.classesCount : "—"}
                      </td>
                      <td className="num text-foreground px-3 py-2.5 text-right">
                        {s.primaryStudentsCount > 0 ? s.primaryStudentsCount : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Pill color={statusMeta.color}>{statusMeta.label}</Pill>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {/* 계정·근무일정 등 운영 정보는 기존 직원 상세로 — 이력서와 별도 진입점 유지. */}
                        <WindowLink
                          href={`/staff/${s.id}`}
                          title={s.displayName}
                          ariaLabel={`${s.displayName} 직원 상세`}
                          className="border-line text-text-dim hover:text-foreground hover:border-primary/40 inline-flex items-center rounded-md border px-2 py-0.5 text-[11.5px] transition"
                        >
                          상세
                        </WindowLink>
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
