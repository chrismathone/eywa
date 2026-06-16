import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial, type InitialColor } from "@/components/atoms/initial";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireAccess } from "@/lib/auth/require-access";
import { assignableRoles, canManageStaff } from "@/lib/auth/role-hierarchy";
import { getStaffList } from "@/features/staff/server/queries";
import { NewStaffTrigger } from "./_components/new-staff-trigger";

export const metadata = { title: "직원관리 — eywa" };

const ROLE_META: Record<string, { label: string; color: PillColor; init: InitialColor }> = {
  master: { label: "원장", color: "danger", init: "danger" },
  admin: { label: "관리자", color: "blue", init: "blue" },
  manager: { label: "매니저", color: "blue", init: "blue" },
  teacher: { label: "강사", color: "primary", init: "primary" },
  counselor: { label: "상담", color: "rose", init: "rose" },
  accountant: { label: "회계", color: "purple", init: "purple" },
  viewer: { label: "참관", color: "neutral", init: "neutral" },
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
  searchParams: Promise<{ invited?: string; role?: RoleKey; status?: StatusKey; q?: string }>;
}) {
  await requireAccess("staff");
  const user = await getCurrentUser();
  const canManage = !!user && canManageStaff(user.systemRole);
  const sp = await searchParams;
  const invited = sp.invited;
  const role: RoleKey = (sp.role as RoleKey) ?? "all";
  const status: StatusKey = (sp.status as StatusKey) ?? "all";
  const q = sp.q ?? "";

  const all = await getStaffList();
  let staff = all;
  if (q) {
    const term = q.toLowerCase();
    staff = staff.filter(
      (s) => s.displayName.toLowerCase().includes(term) || s.email.toLowerCase().includes(term),
    );
  }
  if (role !== "all") staff = staff.filter((s) => s.systemRole === role);
  if (status !== "all") staff = staff.filter((s) => s.status === status);

  const roleCount = (key: string) => all.filter((s) => s.systemRole === key).length;
  const current = { role, status, q };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
        <Stat label="전체" value={all.length} icon="roots" color="primary" />
        <Stat label="원장·관리자" value={roleCount("master") + roleCount("admin")} icon="tree" color="danger" />
        <Stat label="강사" value={roleCount("teacher")} icon="seed" color="primary" />
        <Stat label="상담" value={roleCount("counselor")} icon="wave" color="rose" />
        <Stat label="회계" value={roleCount("accountant")} icon="pollen" color="purple" />
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
                placeholder="이름·이메일"
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
          결과 <span className="text-foreground font-bold">{staff.length}</span>명
        </p>
        {canManage && user ? (
          <NewStaffTrigger assignableRoleOptions={assignableRoles(user.systemRole)} />
        ) : null}
      </div>

      {invited ? (
        <p className="border-primary/30 bg-primary-soft text-primary inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <EyIcon name="check" size={14} />
          <span>{invited} 계정이 생성되었습니다. 임시 비밀번호를 직원에게 안내해주세요.</span>
        </p>
      ) : null}

      {staff.length === 0 ? (
        <EmptyState icon={() => <EyIcon name="roots" size={32} />} title="등록된 직원이 없습니다" />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {staff.map((s) => {
            const role = ROLE_META[s.systemRole] ?? ROLE_META.viewer!;
            const status = STATUS_META[s.status] ?? STATUS_META.active!;
            const isTeacher = s.systemRole === "teacher";
            return (
              <article
                key={s.id}
                className="bg-card border-line shadow-card flex flex-col rounded-2xl border p-5"
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Initial name={s.displayName} color={role.init} size="lg" />
                    <div className="min-w-0">
                      <p className="text-foreground text-[15px] font-bold">{s.displayName}</p>
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

                {canManage ? (
                  <WindowLink
                    href={`/staff/${s.id}/edit`}
                    title={`${s.displayName} 수정`}
                    className="text-text-dim hover:text-foreground mt-3 inline-flex items-center gap-1 self-end text-[11px] transition"
                  >
                    수정 →
                  </WindowLink>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: Parameters<typeof EyIcon>[0]["name"];
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
          <EyIcon name={icon} size={13} />
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
