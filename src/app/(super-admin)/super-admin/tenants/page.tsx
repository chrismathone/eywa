import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SuperAdminHeader } from "@/components/super-admin/header";
import { Pill } from "@/components/atoms/pill";
import { getAllTenants } from "@/features/super-admin/server/queries";

export const metadata = { title: "Super Admin · 학원 목록 — eywa" };

const fmt = (n: number) => n.toLocaleString("ko-KR");
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR");

export default async function TenantsListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; plan?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const planFilter = params.plan ?? "all";

  const all = await getAllTenants();
  const filtered = all.filter((t) => {
    if (planFilter !== "all" && t.plan !== planFilter) return false;
    if (q && !t.name.toLowerCase().includes(q) && !t.slug.toLowerCase().includes(q)) return false;
    return true;
  });

  const freeCount = all.filter((t) => t.plan === "free").length;
  const paidCount = all.length - freeCount;

  return (
    <>
      <SuperAdminHeader
        title="학원 목록"
        breadcrumb={[{ label: "학원 목록" }]}
        action={
          <Link
            href="/super-admin/tenants/new"
            className="bg-primary text-primary-foreground shadow-primary-glow inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-bold"
          >
            <EyIcon name="plus" size={12} /> 신규 학원 발급
          </Link>
        }
      />
      <div className="space-y-4 px-7 py-6">
        {/* Stat strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="전체" value={fmt(all.length)} />
          <Stat label="Free" value={fmt(freeCount)} />
          <Stat label="유료" value={fmt(paidCount)} />
          <Stat label="이번 달 신규" value={fmt(thisMonthNew(all))} />
        </div>

        {/* Filter bar */}
        <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
          <form className="flex flex-1 items-center gap-2" action="/super-admin/tenants">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="학원명·slug 검색"
              className="border-line text-foreground flex-1 rounded-sm border bg-transparent px-2.5 py-1.5 text-[12px]"
            />
            <input type="hidden" name="plan" value={planFilter} />
            <button
              type="submit"
              className="border-line text-text-dim hover:text-foreground rounded-sm border px-3 py-1.5 text-[12px] font-semibold"
            >
              검색
            </button>
          </form>
          <div className="flex items-center gap-1">
            <span className="micro mr-1">플랜</span>
            <PlanChip current={planFilter} value="all" label="전체" q={q} />
            <PlanChip current={planFilter} value="free" label="Free" q={q} />
            <PlanChip current={planFilter} value="paid" label="유료" q={q} />
          </div>
        </div>

        {/* Table */}
        <section className="bg-card border-line shadow-card overflow-hidden rounded-md border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-bg-soft text-text-dim border-line border-b">
                <th className="px-4 py-2 text-left font-semibold">학원명</th>
                <th className="px-4 py-2 text-left font-semibold">slug</th>
                <th className="px-4 py-2 text-right font-semibold">사용자</th>
                <th className="px-4 py-2 text-right font-semibold">학생</th>
                <th className="px-4 py-2 text-right font-semibold">이번 달 청구</th>
                <th className="px-4 py-2 text-left font-semibold">플랜</th>
                <th className="px-4 py-2 text-left font-semibold">가입일</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-text-dim px-4 py-10 text-center">
                    조건에 맞는 학원이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-bg-soft">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/super-admin/tenants/${t.id}`}
                        className="text-foreground hover:text-primary font-bold"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="text-text-dim px-4 py-2.5 font-mono text-[11px]">{t.slug}</td>
                    <td className="text-foreground px-4 py-2.5 text-right tabular-nums">
                      {fmt(t.userCount)}
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right tabular-nums">
                      {fmt(t.studentCount)}
                    </td>
                    <td className="text-foreground px-4 py-2.5 text-right tabular-nums">
                      {fmt(t.monthBilling)}원
                    </td>
                    <td className="px-4 py-2.5">
                      <Pill color={t.plan === "free" ? "neutral" : "gold"} soft>
                        {t.plan}
                      </Pill>
                    </td>
                    <td className="text-text-dim px-4 py-2.5">{formatDate(t.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-3.5">
      <p className="text-text-dim font-mono text-[10px] tracking-wider uppercase">{label}</p>
      <p className="text-foreground mt-1 text-[20px] font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function PlanChip({
  current,
  value,
  label,
  q,
}: {
  current: string;
  value: string;
  label: string;
  q: string;
}) {
  const isActive = current === value;
  const href = `/super-admin/tenants?${new URLSearchParams({ q, plan: value }).toString()}`;
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
        isActive
          ? "border-foreground bg-foreground text-background font-medium"
          : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {label}
    </Link>
  );
}

function thisMonthNew(tenants: { createdAt: string }[]) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  return tenants.filter((t) => {
    const d = new Date(t.createdAt);
    return d.getFullYear() === year && d.getMonth() === month;
  }).length;
}
