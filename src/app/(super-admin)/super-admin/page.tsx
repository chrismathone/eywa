import { SuperAdminHeader } from "@/components/super-admin/header";
import Link from "next/link";
import { getTenantsPage, getSaaSStats } from "@/features/super-admin/server/queries";
import { Pill } from "@/components/atoms/pill";

export const metadata = { title: "Super Admin · 대시보드 — aywa" };

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default async function SuperAdminDashboardPage() {
  const [stats, { rows: recent }] = await Promise.all([getSaaSStats(), getTenantsPage({}, 1, 5)]);

  return (
    <>
      <SuperAdminHeader title="SaaS 대시보드" breadcrumb={[{ label: "대시보드" }]} />
      <div className="space-y-6 px-7 py-6">
        {/* KPI 4 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="활성 학원" value={fmt(stats.tenantCount)} unit="개" />
          <KpiCard label="활성 사용자" value={fmt(stats.userCount)} unit="명" />
          <KpiCard label="등록 학생" value={fmt(stats.studentCount)} unit="명" />
          <KpiCard label="이번 달 청구 합계" value={fmt(stats.monthBillingSum)} unit="원" />
        </div>

        {/* 최근 가입 학원 */}
        <section className="bg-card border-line shadow-card rounded-2xl border p-5">
          <header className="mb-3 flex items-center justify-between">
            <div>
              <p className="micro">최근 가입</p>
              <h2 className="text-foreground mt-0.5 text-base font-bold">최근 학원 5건</h2>
            </div>
            <Link href="/super-admin/tenants" className="text-primary text-xs font-bold hover:underline">전 지점 운영 보기 →</Link>
          </header>
          {recent.length === 0 ? (
            <p className="text-text-dim py-6 text-center text-sm">아직 학원이 없습니다.</p>
          ) : (
            <ul className="divide-line divide-y">
              {recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <Link href={`/super-admin/tenants/${t.id}`} className="text-foreground hover:text-primary text-sm font-bold">{t.name}</Link>
                    <p className="text-text-dim mt-0.5 font-mono text-xs">{t.slug}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-text-dim text-xs">
                      사용자 {fmt(t.userCount)} · 학생 {fmt(t.studentCount)}
                    </span>
                    <Pill color={t.plan === "free" ? "neutral" : "gold"} soft>
                      {t.plan}
                    </Pill>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function KpiCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-5">
      <p className="text-text-dim font-mono text-xs tracking-wider uppercase">{label}</p>
      <p className="text-foreground mt-2 flex items-baseline gap-1">
        <span className="text-4xl font-bold tabular-nums">{value}</span>
        <span className="text-text-dim text-xs">{unit}</span>
      </p>
    </div>
  );
}
