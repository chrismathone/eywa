import Link from "next/link";
import { notFound } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { buttonVariants } from "@/components/ui/button";
import {
  Panel,
  PlanPill,
  fmtDate,
  fmtNum,
} from "@/components/super-admin/parts";
import {
  getTenantDetail,
  getTenantLicenses,
} from "@/features/super-admin/server/queries";
import { UpdateTenantForm } from "./_update-form";
import { LicenseSection } from "./_license-section";
import { AccountsPanel } from "./_accounts-panel";

export const metadata = { title: "슈퍼관리자 · 학원 상세 — aywa" };

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upage?: string }>;
}) {
  const { id } = await params;
  const { upage } = await searchParams;
  const [detail, licenses] = await Promise.all([
    getTenantDetail(id),
    getTenantLicenses(id),
  ]);
  if (!detail) notFound();

  return (
    <>
      <PageHeader
        eyebrow="전 지점 운영"
        title={detail.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              코드 <span className="font-mono">{detail.slug}</span> · 가입{" "}
              <span className="num">{fmtDate(detail.createdAt)}</span>
            </span>
            <PlanPill plan={detail.plan} />
          </span>
        }
        embedLabel={detail.name}
        actions={
          <Link
            href="/super-admin/tenants"
            className={buttonVariants({ variant: "outline" })}
          >
            <EyIcon name="arrowLeft" size={16} strokeWidth={1.8} /> 목록으로
          </Link>
        }
        stats={
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <BigStat
              label="사용자"
              value={fmtNum(detail.users.length)}
              unit="명"
              icon={<EyIcon name="users" size={16} />}
              tone="blue"
            />
            <BigStat
              label="등록 학생"
              value={fmtNum(detail.studentCount)}
              unit="명"
              icon={<EyIcon name="graduationCap" size={16} />}
              tone="green"
            />
            {/* 금액은 길어서 폰 반쪽 칸에선 숫자 중간에서 꺾인다 → 폰에선 한 줄을 통째로. */}
            <div className="col-span-2 lg:col-span-1">
              <BigStat
                label="이번 달 청구"
                value={fmtNum(detail.monthBilling)}
                unit="원"
                sub={`청구서 ${fmtNum(detail.monthInvoiceCount)}건`}
                icon={<EyIcon name="receipt" size={16} />}
                tone="gold"
              />
            </div>
          </div>
        }
      />

      <AccountsPanel
        tenantId={detail.id}
        tenantName={detail.name}
        users={detail.users}
        page={Number(upage) || 1}
      />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Panel
          id="settings"
          title="기본 정보"
          description="학원 이름과 플랜을 고칩니다."
        >
          <UpdateTenantForm
            id={detail.id}
            name={detail.name}
            plan={detail.plan}
          />
        </Panel>
        <LicenseSection
          tenantId={detail.id}
          tenantName={detail.name}
          licenses={licenses}
          enrolledCount={detail.studentCount}
        />
      </div>

      <Panel
        title="지점장 보기"
        description="이 학원의 학생·반·회의 현황을 읽기 전용으로 들여다봅니다. 들어간 기록은 감사 로그에 남습니다."
        action={
          <Link
            href={`/super-admin/tenants/${detail.id}/view`}
            className={buttonVariants({ variant: "outline" })}
          >
            <EyIcon name="search" size={16} strokeWidth={1.8} /> 들여다보기
          </Link>
        }
      />
    </>
  );
}
