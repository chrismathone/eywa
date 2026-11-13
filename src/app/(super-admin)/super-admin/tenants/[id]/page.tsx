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
import { protectedAccountIds } from "@/lib/auth/protected-accounts";
import { TenantTabs, parseTenantTab } from "./_tabs";
import { TodaysMathSyncStatus } from "./_todays-math-sync-status";
import { OpenTenantViewButton } from "./_open-view-button";
import { AiModelSection } from "./_ai-model-section";
import { getTenantAiModels } from "@/features/super-admin/server/ai-model-queries";

export const metadata = { title: "슈퍼관리자 · 학원 상세 — 에이와" };

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upage?: string; tab?: string; view?: string }>;
}) {
  const { id } = await params;
  const { upage, tab: rawTab, view: viewNotice } = await searchParams;
  const tab = parseTenantTab(rawTab);
  // 라이선스 표는 그 탭에서만 쓴다 — 다른 탭에선 조회하지 않는다.
  const [detail, licenses, aiModels] = await Promise.all([
    getTenantDetail(id),
    tab === "license" ? getTenantLicenses(id) : null,
    tab === "ai" ? getTenantAiModels(id) : null,
  ]);
  if (!detail) notFound();
  // 보호 계정(슈퍼관리자 명단) — 계정 탭에서 역할·활성 조작을 세우지 않는다(원장 2026-09-30). 막는 건 서버 액션·DB.
  const protection = tab === "accounts" ? await protectedAccountIds(detail.users.map((u) => u.id)) : null;

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
          <div className="flex flex-wrap items-center gap-2">
            {/* 이 지점의 화면을 읽기 전용으로 연다 — 운영 콘솔에서 지점으로 이어지는 입구(원장 2026-10-12). */}
            <OpenTenantViewButton tenantId={detail.id} />
            <Link
              href="/super-admin/tenants"
              className={buttonVariants({ variant: "outline" })}
            >
              <EyIcon name="arrowLeft" size={16} strokeWidth={1.8} /> 목록으로
            </Link>
          </div>
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

      {viewNotice === "unavailable" ? (
        <p className="bg-amber-soft text-amber flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold">
          <EyIcon name="lock" size={16} strokeWidth={1.8} />
          원장 화면을 열지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : null}
      {viewNotice === "ended" ? (
        <p className="bg-amber-soft text-amber flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold">
          <EyIcon name="lock" size={16} strokeWidth={1.8} />
          읽기 전용 보기가 끝나 운영 콘솔로 돌아왔습니다. 다시 보려면 원장 화면 열기를 눌러 주세요.
        </p>
      ) : null}

      <TenantTabs
        tenantId={detail.id}
        active={tab}
        counts={{ accounts: detail.users.length }}
      />

      {tab === "accounts" ? (
        <AccountsPanel
          tenantId={detail.id}
          tenantName={detail.name}
          users={detail.users}
          page={Number(upage) || 1}
          protectedIds={protection ? [...protection.protectedIds] : []}
          protectionUnknown={protection?.lookupFailed ?? false}
        />
      ) : null}

      {/* 이름↔스위치가 한 줄 양 끝이라 넓은 화면에서 멀어지지 않게 폭을 묶는다. */}
      {tab === "license" && licenses ? (
        <div className="space-y-5 lg:max-w-3xl">
          <LicenseSection
            tenantId={detail.id}
            licenses={licenses}
            enrolledCount={detail.studentCount}
          />
          <TodaysMathSyncStatus tenantId={detail.id} />
        </div>
      ) : null}

      {/* AI 모델 — 지점·기능별 모델 고르기(원장 2026-10-19). 이름↔드롭다운이 한 줄 양 끝이라 폭을 묶는다. */}
      {tab === "ai" && aiModels ? (
        <div className="lg:max-w-3xl">
          <AiModelSection tenantId={detail.id} state={aiModels} />
        </div>
      ) : null}

      {tab === "settings" ? (
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
          <Panel
            title="지점장 보기"
            description="이 학원의 화면을 원장이 보는 그대로 읽기 전용으로 엽니다. 저장·발송은 되지 않고, 들어간 기록과 그 안에서 한 내려받기는 감사 로그에 남습니다. 보강관리·전자결재·급여 정책은 이 보기에서 열리지 않습니다. 숫자만 빠르게 보려면 요약 보기를 쓰세요."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <OpenTenantViewButton tenantId={detail.id} variant="outline" />
                <Link
                  href={`/super-admin/tenants/${detail.id}/view`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <EyIcon name="search" size={16} strokeWidth={1.8} /> 요약 보기
                </Link>
              </div>
            }
          />
        </div>
      ) : null}
    </>
  );
}
