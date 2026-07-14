import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { notFound } from "next/navigation";
import { SuperAdminHeader } from "@/components/super-admin/header";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { getTenantDetail, getTenantLicenses } from "@/features/super-admin/server/queries";
import { Pagination } from "@/components/pagination";
import { UpdateTenantForm } from "./_update-form";
import { LicenseSection } from "./_license-section";
import { UserActions } from "./_user-actions";

export const metadata = { title: "Super Admin · 학원 상세 — eywa" };

const USERS_PAGE_SIZE = 50;

const fmt = (n: number) => n.toLocaleString("ko-KR");
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

const ROLE_COLOR: Record<string, PillColor> = {
  master: "primary",
  admin: "blue",
  manager: "purple",
  teacher: "gold",
  counselor: "rose",
  accountant: "amber",
  viewer: "neutral",
};

const ROLE_LABEL: Record<string, string> = {
  master: "원장",
  admin: "관리자",
  manager: "매니저",
  teacher: "강사",
  counselor: "상담",
  accountant: "회계",
  viewer: "뷰어",
};

const STATUS_LABEL: Record<string, string> = {
  active: "활성",
  inactive: "비활성",
  pending: "대기",
};

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upage?: string }>;
}) {
  const { id } = await params;
  const { upage } = await searchParams;
  const detail = await getTenantDetail(id);
  if (!detail) notFound();
  const licenses = await getTenantLicenses(id);

  const roleCount = detail.users.reduce<Record<string, number>>((acc, u) => {
    acc[u.systemRole] = (acc[u.systemRole] ?? 0) + 1;
    return acc;
  }, {});

  // 사용자(직원)는 보통 소수지만 대형 테넌트 대비 50명씩 페이지네이션(<=50이면 Pagination 자동 숨김).
  const userPage = Math.max(1, Number(upage) || 1);
  const userTotalPages = Math.max(1, Math.ceil(detail.users.length / USERS_PAGE_SIZE));
  const pageUsers = detail.users.slice((userPage - 1) * USERS_PAGE_SIZE, userPage * USERS_PAGE_SIZE);
  const userPageHref = (p: number) =>
    p > 1 ? `/super-admin/tenants/${id}?upage=${p}` : `/super-admin/tenants/${id}`;

  return (
    <>
      <SuperAdminHeader
        title={detail.name}
        breadcrumb={[{ label: "학원 목록" }, { label: detail.name }]}
        action={
          <Link
            href="/super-admin/tenants"
            className="border-line text-text-dim hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[12px] font-semibold"
          >
            <EyIcon name="arrowLeft" size={14} />
            목록
          </Link>
        }
      />
      <div className="space-y-5 px-7 py-6">
        {/* 헤더 카드 */}
        <section className="bg-card border-line shadow-card rounded-2xl border p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-foreground text-[18px] font-extrabold">{detail.name}</h2>
                <p className="text-text-dim font-mono text-[11px]">
                  {detail.slug} · 가입 {formatDate(detail.createdAt)}
                </p>
              </div>
            </div>
            <Pill color={detail.plan === "free" ? "neutral" : "gold"} soft>
              {detail.plan}
            </Pill>
          </div>
        </section>

        {/* KPI 3 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="사용자" value={fmt(detail.users.length)} unit="명" />
          <Kpi label="재원 학생" value={fmt(detail.studentCount)} unit="명" />
          <Kpi label="이번 달 청구" value={fmt(detail.monthBilling)} unit={`원 · ${detail.monthInvoiceCount}건`} />
        </div>

        {/* 역할별 분포 */}
        <section className="bg-card border-line shadow-card rounded-2xl border p-5">
          <header className="mb-3">
            <p className="micro">사용자</p>
            <h3 className="text-foreground mt-0.5 text-[15px] font-bold">역할별 분포</h3>
          </header>
          {Object.keys(roleCount).length === 0 ? (
            <p className="text-text-dim text-[12px]">사용자 없음</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(roleCount).map(([role, count]) => (
                <Pill key={role} color={ROLE_COLOR[role] ?? "neutral"} soft>
                  {role} · {count}
                </Pill>
              ))}
            </div>
          )}
        </section>

        {/* 사용자 목록 */}
        <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
          <header className="border-line border-b px-5 py-3">
            <p className="micro">계정</p>
            <h3 className="text-foreground mt-0.5 text-[15px] font-bold">사용자 목록 ({detail.users.length})</h3>
          </header>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-bg-soft text-text-dim border-line border-b">
                <th className="px-4 py-2 text-left font-semibold">이름</th>
                <th className="px-4 py-2 text-left font-semibold">이메일</th>
                <th className="px-4 py-2 text-left font-semibold">역할</th>
                <th className="px-4 py-2 text-left font-semibold">상태</th>
                <th className="px-4 py-2 text-right font-semibold">관리</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {pageUsers.map((u) => (
                <tr key={u.id}>
                  <td className="text-foreground px-4 py-2.5 font-bold whitespace-nowrap">{u.displayName}</td>
                  <td className="text-text-dim px-4 py-2.5 font-mono text-[11px]">{u.email}</td>
                  <td className="px-4 py-2.5">
                    <Pill color={ROLE_COLOR[u.systemRole] ?? "neutral"} soft>
                      {ROLE_LABEL[u.systemRole] ?? u.systemRole}
                    </Pill>
                  </td>
                  <td className="text-text-dim px-4 py-2.5">{STATUS_LABEL[u.status] ?? u.status}</td>
                  <td className="px-4 py-2.5">
                    <UserActions
                      userId={u.id}
                      tenantId={detail.id}
                      tenantName={detail.name}
                      currentRole={u.systemRole}
                      status={u.status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {userTotalPages > 1 ? (
            <div className="border-line border-t px-4 py-3">
              <Pagination page={userPage} totalPages={userTotalPages} hrefForPage={userPageHref} />
            </div>
          ) : null}
        </section>

        {/* 학원 정보 수정 */}
        <section className="bg-card border-line shadow-card rounded-2xl border p-5">
          <header className="mb-3">
            <p className="micro">학원 정보 수정</p>
            <h3 className="text-foreground mt-0.5 text-[15px] font-bold">기본 정보</h3>
          </header>
          <UpdateTenantForm id={detail.id} name={detail.name} plan={detail.plan} />
        </section>

        {/* 라이선스·좌석 */}
        <LicenseSection tenantId={detail.id} tenantName={detail.name} licenses={licenses} />

        {/* 지점장 보기 (read-only 미러) */}
        <section className="bg-card border-line shadow-card flex items-center justify-between rounded-2xl border p-5">
          <div>
            <p className="text-foreground text-[13px] font-bold">지점장 보기</p>
            <p className="text-text-dim mt-1 text-[11px]">
              해당 학원의 현황(학생·반·회의)을 읽기 전용으로 들여다봅니다. 진입 기록은 감사 로그에 남습니다.
            </p>
          </div>
          <Link
            href={`/super-admin/tenants/${detail.id}/view`}
            className="bg-gold text-ink inline-flex shrink-0 items-center gap-1.5 rounded-md px-3.5 py-2 text-[12px] font-bold"
          >
            <EyIcon name="search" size={13} /> 들여다보기
          </Link>
        </section>
      </div>
    </>
  );
}

function Kpi({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-card border-line shadow-card rounded-md border p-4">
      <p className="text-text-dim font-mono text-[11px] tracking-wider uppercase">{label}</p>
      <p className="text-foreground mt-1.5 flex items-baseline gap-1">
        <span className="text-[26px] font-extrabold tabular-nums">{value}</span>
        <span className="text-text-dim text-[11px]">{unit}</span>
      </p>
    </div>
  );
}
