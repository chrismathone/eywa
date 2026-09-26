import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { FilterSelect } from "@/components/filter-select";
import { SearchForm } from "@/components/search-form";
import { Pagination } from "@/components/pagination";
import { buttonVariants } from "@/components/ui/button";
import { PlanPill, TABLE_COL_LINES, TH, fmtDate, fmtNum } from "@/components/super-admin/parts";
import { getAllTenants } from "@/features/super-admin/server/queries";
import { parseTenantFilters, selectTenants, tenantPage } from "@/features/super-admin/tenant-operations";

export const metadata = { title: "슈퍼관리자 · 전 지점 운영 — aywa" };

const PAGE_SIZE = 50;

const PLAN_OPTIONS = [
  { value: "free", label: "무료·데모" },
  { value: "paid", label: "유료 계약" },
];
const ACTIVITY_OPTIONS = [
  { value: "students", label: "등록 학생 있음" },
  { value: "empty", label: "등록 학생 없음" },
  { value: "billed", label: "이번 달 청구 있음" },
  { value: "unbilled", label: "이번 달 청구 없음" },
];
const SORT_OPTIONS = [
  { value: "students", label: "등록 학생 많은 순" },
  { value: "billing", label: "청구액 높은 순" },
  { value: "name", label: "학원 이름 순" },
];

export default async function TenantsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseTenantFilters(params);
  const all = await getAllTenants();
  const filtered = selectTenants(all, filters);
  const { rows, page, totalPages, total } = tenantPage(filtered, Number(params.page), PAGE_SIZE);
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.plan !== "all") sp.set("plan", filters.plan);
    if (filters.activity !== "all") sp.set("activity", filters.activity);
    if (filters.sort !== "recent") sp.set("sort", filters.sort);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/super-admin/tenants?${s}` : "/super-admin/tenants";
  };
  const totals = all.reduce(
    (sum, row) => ({
      students: sum.students + row.studentCount,
      classes: sum.classes + row.classCount,
      billing: sum.billing + row.monthBilling,
    }),
    { students: 0, classes: 0, billing: 0 },
  );

  return (
    <>
      <PageHeader
        eyebrow="슈퍼관리자"
        title="전 지점 운영"
        description="지점별 등록 학생·활성 반·이번 달 청구를 비교하고 계정·설정으로 들어갑니다."
        embedLabel="지점별 운영 비교"
        actions={
          <Link href="/super-admin/tenants/new" className={buttonVariants()}>
            <EyIcon name="plus" size={16} strokeWidth={1.8} /> 신규 학원 발급
          </Link>
        }
        stats={
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <BigStat label="전체 학원" value={fmtNum(all.length)} unit="개" icon={<EyIcon name="building" size={16} />} tone="primary" />
            <BigStat label="등록 학생" value={fmtNum(totals.students)} unit="명" icon={<EyIcon name="graduationCap" size={16} />} tone="green" />
            <BigStat label="활성 반" value={fmtNum(totals.classes)} unit="개" icon={<EyIcon name="layers" size={16} />} tone="blue" />
            <div className="col-span-2 lg:col-span-1">
              <BigStat label="이번 달 청구" value={fmtNum(totals.billing)} unit="원" icon={<EyIcon name="receipt" size={16} />} tone="gold" />
            </div>
          </div>
        }
      />

      <Toolbar>
        <SearchForm placeholder="학원 이름 또는 코드" defaultValue={filters.q} className="flex items-center gap-2" />
        <FilterSelect paramName="plan" axisLabel="플랜" value={filters.plan === "all" ? null : filters.plan} options={PLAN_OPTIONS} ariaLabel="플랜 필터" triggerClassName={TOOLBAR_SELECT} />
        <FilterSelect paramName="activity" axisLabel="운영" value={filters.activity === "all" ? null : filters.activity} options={ACTIVITY_OPTIONS} ariaLabel="운영 현황 필터" triggerClassName={TOOLBAR_SELECT} />
        <FilterSelect paramName="sort" axisLabel="정렬" allLabel="최근 가입 순" value={filters.sort === "recent" ? null : filters.sort} options={SORT_OPTIONS} ariaLabel="정렬" triggerClassName={TOOLBAR_SELECT} />
        <span className="num text-foreground ml-auto text-sm">
          {fmtNum(total)} / {fmtNum(all.length)}곳
        </span>
      </Toolbar>

      <section className="bg-card shadow-card stack-rows overflow-hidden rounded-2xl" aria-label="학원별 운영 현황">
        <div className="overflow-x-auto phone:overflow-visible">
          <table className={`w-full min-w-[960px] text-sm ${TABLE_COL_LINES}`}>
            <thead>
              <tr>
                <th scope="col" data-cell="label" className={`${TH} text-left`}>학원</th>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>플랜</th>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>사용자</th>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>등록 학생</th>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>활성 반</th>
                <th scope="col" data-cell="label" className={`${TH} text-right`}>이번 달 청구</th>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>가입일</th>
                <th scope="col" data-cell="label" className={`${TH} text-center`}>바로 가기</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-foreground px-4 py-12 text-center">
                    조건에 맞는 학원이 없습니다. 검색어나 필터를 바꿔 보세요.
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className="hover:bg-muted">
                    <td data-cell="primary" className="px-3 py-2.5">
                      <Link href={`/super-admin/tenants/${t.id}`} className="text-foreground hover:text-primary block truncate font-bold">
                        {t.name}
                      </Link>
                      <span className="text-foreground block truncate font-mono text-xs">{t.slug}</span>
                    </td>
                    <td data-cell="status" className="px-3 py-2.5 text-center">
                      <PlanPill plan={t.plan} />
                    </td>
                    <td className="num px-3 py-2.5 text-center">
                      <span className="hidden phone:inline">사용자 </span>
                      {fmtNum(t.userCount)}
                    </td>
                    <td className="num px-3 py-2.5 text-center font-bold">
                      <span className="hidden font-medium phone:inline">학생 </span>
                      {fmtNum(t.studentCount)}
                    </td>
                    <td className="num px-3 py-2.5 text-center">
                      <span className="hidden phone:inline">반 </span>
                      {fmtNum(t.classCount)}
                    </td>
                    <td className="num px-3 py-2.5 text-right">
                      <span className="font-bold">{fmtNum(t.monthBilling)}원</span>
                      <span className="text-foreground ml-1 text-xs">({fmtNum(t.monthInvoiceCount)}건)</span>
                    </td>
                    <td className="num px-3 py-2.5 text-center whitespace-nowrap">
                      <span className="hidden phone:inline">가입 </span>
                      {fmtDate(t.createdAt)}
                    </td>
                    <td data-cell="wide" className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-3 text-sm font-bold whitespace-nowrap phone:justify-start">
                        <Link href={`/super-admin/tenants/${t.id}`} className="text-primary hover:underline">계정</Link>
                        <Link href={`/super-admin/tenants/${t.id}?tab=license`} className="text-primary hover:underline">기능</Link>
                        <Link href={`/super-admin/tenants/${t.id}?tab=settings`} className="text-primary hover:underline">설정</Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-foreground px-1 text-xs">
        사용자 = 전체 계정 · 등록 학생 = 재원 · 반 = 활성 · 청구 = 이번 달(취소 제외)
      </p>
      <Pagination page={page} totalPages={totalPages} total={total} hrefForPage={pageHref} />
    </>
  );
}
