import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Panel, PlanPill, fmtNum } from "@/components/super-admin/parts";
import { getTenantsPage, getSaaSStats } from "@/features/super-admin/server/queries";

export const metadata = { title: "슈퍼관리자 · 대시보드 — 에이와" };

export default async function SuperAdminDashboardPage() {
  const [stats, { rows: recent }] = await Promise.all([getSaaSStats(), getTenantsPage({}, 1, 5)]);

  return (
    <>
      <PageHeader
        eyebrow="슈퍼관리자"
        title="대시보드"
        description="전체 학원·사용자·학생 규모와 최근 가입한 학원을 봅니다."
        embedLabel="전체 학원 규모"
        stats={
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <BigStat label="활성 학원" value={fmtNum(stats.tenantCount)} unit="개" icon={<EyIcon name="building" size={16} />} tone="primary" />
            <BigStat label="활성 사용자" value={fmtNum(stats.userCount)} unit="명" icon={<EyIcon name="users" size={16} />} tone="blue" />
            <BigStat label="등록 학생" value={fmtNum(stats.studentCount)} unit="명" icon={<EyIcon name="graduationCap" size={16} />} tone="green" />
            <div className="col-span-2 lg:col-span-1">
              <BigStat label="이번 달 청구" value={fmtNum(stats.monthBillingSum)} unit="원" icon={<EyIcon name="receipt" size={16} />} tone="gold" />
            </div>
          </div>
        }
      />

      <Panel
        title="최근 가입한 학원"
        description="가장 최근에 발급한 5곳"
        action={
          <Link href="/super-admin/tenants" className="text-primary text-sm font-bold hover:underline">
            전 지점 운영 보기
          </Link>
        }
        flush
      >
        {recent.length === 0 ? (
          <p className="text-foreground px-4 py-8 text-center text-sm">아직 발급한 학원이 없습니다.</p>
        ) : (
          <ul className="divide-line divide-y">
            {recent.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/super-admin/tenants/${t.id}`} className="text-foreground hover:text-primary text-sm font-bold">
                    {t.name}
                  </Link>
                  <p className="text-foreground truncate font-mono text-xs">{t.slug}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="num text-foreground text-sm">
                    사용자 {fmtNum(t.userCount)} · 학생 {fmtNum(t.studentCount)}
                  </span>
                  <PlanPill plan={t.plan} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
