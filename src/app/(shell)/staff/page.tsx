import Link from "next/link";
import { Users, UserCog, GraduationCap, MessageCircle, Calculator, Wallet, CalendarClock, type LucideIcon } from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageStaff, ROLE_HIERARCHY } from "@/lib/auth/role-hierarchy";
import { getStaffList } from "@/features/staff/server/queries";
import { getSuperAdminIds, displayRoleFor } from "@/lib/auth/super-admin";
import { Pagination } from "@/components/pagination";
import { NewStaffTrigger } from "./_components/new-staff-trigger";

export const metadata = { title: "직원관리 — eywa" };

const PAGE_SIZE = 50;

const ROLE_META: Record<string, { label: string; color: PillColor }> = {
  master: { label: "owner", color: "danger" },
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
  { key: "master", label: "owner" },
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

function buildStaffHref(p: { role: RoleKey; status: StatusKey; q: string }): string {
  const sp = new URLSearchParams();
  if (p.role !== "all") sp.set("role", p.role);
  if (p.status !== "all") sp.set("status", p.status);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/staff?${s}` : "/staff";
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{
    invited?: string;
    role?: RoleKey;
    status?: StatusKey;
    q?: string;
    page?: string;
  }>;
}) {
  await requireAccess("staff");
  const user = await getCurrentUser();
  const canManage = !!user && canManageStaff(user.systemRole);
  const sp = await searchParams;
  const invited = sp.invited;
  const role: RoleKey = (sp.role as RoleKey) ?? "all";
  const status: StatusKey = (sp.status as StatusKey) ?? "all";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  // super_admin(숨은 총괄)은 학원 화면에서 '관리자'로 위장 표시(실제 role/접근 불변, displayRoleFor).
  const [rawAll, superAdminIds] = await Promise.all([getStaffList(), getSuperAdminIds()]);
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

  const roleCount = (key: string) => all.filter((s) => s.systemRole === key).length;
  const current = { role, status, q };

  // 역할 분포 Stat은 전체(all) 기준 — 목록만 50명으로 슬라이스(billing 메모리 페이지네이션).
  const total = staff.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStaff = staff.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (role !== "all") params.set("role", role);
    if (status !== "all") params.set("status", status);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/staff?${s}` : "/staff";
  };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
        <Stat label="전체" value={all.length} icon={Users} color="primary" />
        <Stat label="원장·관리자" value={roleCount("master") + roleCount("admin")} icon={UserCog} color="danger" />
        <Stat label="강사" value={roleCount("teacher")} icon={GraduationCap} color="primary" />
        <Stat label="상담" value={roleCount("counselor")} icon={MessageCircle} color="rose" />
        <Stat label="회계" value={roleCount("accountant")} icon={Calculator} color="purple" />
      </section>

      {/* Filter bar */}
      <div className="bg-card border-line shadow-card space-y-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">역할</span>
            {ROLE_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildStaffHref({ ...current, role: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
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
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  status === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <form action="/staff" method="get" className="ml-auto flex items-center gap-2">
            {role !== "all" ? <input type="hidden" name="role" value={role} /> : null}
            {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="이름·이메일·연락처"
                className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              검색
            </Button>
          </form>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>명
          {totalPages > 1 ? (
            <span className="text-text-faint ml-2 normal-case">
              · {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          {user?.systemRole === "master" ? (
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
        <EmptyState icon={() => <Users size={32} strokeWidth={1.5} />} title="등록된 직원이 없습니다" />
      ) : (
        <>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {pageStaff.map((s) => {
            const role = ROLE_META[s.systemRole] ?? ROLE_META.viewer!;
            const status = STATUS_META[s.status] ?? STATUS_META.active!;
            const isTeacher = s.systemRole === "teacher";
            const cardClass = "bg-card border-line shadow-card flex flex-col rounded-2xl border p-5";
            const body = (
              <>
                <header className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-foreground flex items-center gap-1.5 text-[15px] font-bold">
                        {s.displayName}
                        <EditingBadge scope={`staff:${s.id}`} />
                      </p>
                      <p className="text-text-dim num mt-0.5 truncate text-[11px]">{s.email}</p>
                    </div>
                  </div>
                  <Pill color={role.color}>{role.label}</Pill>
                </header>

                {isTeacher ? (
                  <div className="border-line mt-4 grid grid-cols-3 gap-3 border-t pt-4">
                    <Mini label="담당 반" value={s.classesCount} unit="개" />
                    <Mini label="담당 학생" value={s.primaryStudentsCount} unit="명" />
                    <Mini label="상태" value={status.label} />
                  </div>
                ) : (
                  <div className="border-line text-text-dim mt-4 border-t pt-4 text-[12px]">
                    {status.label} · {s.classesCount > 0 ? `반 ${s.classesCount}개` : "반 없음"}
                  </div>
                )}
              </>
            );
            // 카드 전체 클릭 → 직원 상세(읽기전용 뷰 + 탭). 관리 권한은 상세 안에서 분기.
            return (
              <WindowLink
                key={s.id}
                href={`/staff/${s.id}`}
                title={s.displayName}
                ariaLabel={`${s.displayName} 상세`}
                className={`${cardClass} group hover:border-primary/40 hover:shadow-modal cursor-pointer transition`}
              >
                {body}
              </WindowLink>
            );
          })}
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
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: "primary" | "blue" | "rose" | "danger" | "purple";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    rose: "bg-rose-soft text-rose",
    danger: "bg-danger-soft text-danger",
    purple: "bg-purple-soft text-purple",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro truncate">{label}</p>
        <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={2} />
        </span>
      </header>
      <p className="tabular text-foreground mt-2 text-[28px] leading-none">{value}</p>
    </div>
  );
}

function Mini({ label, value, unit }: { label: string; value: number | string; unit?: string }) {
  return (
    <div>
      <p className="micro text-[9px]">{label}</p>
      <p className="tabular text-foreground mt-1 text-base">
        {value}
        {unit ? <span className="text-text-dim ml-0.5 text-[11px]">{unit}</span> : null}
      </p>
    </div>
  );
}
