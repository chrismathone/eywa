import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import { SuperAdminHeader } from "@/components/super-admin/header";
import { Pill } from "@/components/atoms/pill";
import { Pagination } from "@/components/pagination";
import { getAllTenants } from "@/features/super-admin/server/queries";
import { parseTenantFilters, selectTenants, tenantPage } from "@/features/super-admin/tenant-operations";

export const metadata = { title: "Super Admin · 전 지점 운영 — aywa" };

const PAGE_SIZE = 50;
const fmt = (n: number) => n.toLocaleString("ko-KR");
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

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
      <SuperAdminHeader
        title="전 지점 운영"
        breadcrumb={[{ label: "전 지점 운영" }]}
        action={
          <Link href="/super-admin/tenants/new" className="bg-primary text-primary-foreground shadow-primary-glow inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold">
            <EyIcon name="plus" size={12} /> 신규 학원 발급
          </Link>
        }
      />
      <div className="space-y-5 px-7 py-6">
        <div>
          <h2 className="text-foreground text-lg font-bold">전체 학원 운영 현황</h2>
          <p className="text-text-dim mt-1 text-xs">등록 학생, 활성 반, 이번 달 청구를 지점별로 비교하고 계정·설정으로 이동하세요.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat label="전체 학원" value={fmt(all.length)} unit="개" />
          <Stat label="등록 학생" value={fmt(totals.students)} unit="명" />
          <Stat label="활성 반" value={fmt(totals.classes)} unit="개" />
          <Stat label="이번 달 청구" value={fmt(totals.billing)} unit="원" />
        </div>
        <form action="/super-admin/tenants" className="bg-card border-line shadow-card flex flex-wrap items-end gap-3 rounded-xl border p-4">
          <label className="min-w-52 flex-[2]">
            <span className="text-text-dim mb-1 block text-xs font-bold">학원 검색</span>
            <input type="search" name="q" defaultValue={filters.q} maxLength={100} placeholder="학원명 또는 slug" className="border-line text-foreground w-full rounded-md border bg-transparent px-3 py-2 text-sm" />
          </label>
          <FilterSelect label="플랜" name="plan" value={filters.plan} options={[["all", "전체"], ["free", "Free"], ["paid", "유료"]]} />
          <FilterSelect label="운영 현황" name="activity" value={filters.activity} options={[["all", "전체"], ["students", "등록 학생 있음"], ["empty", "등록 학생 없음"], ["billed", "이번 달 청구서 있음"], ["unbilled", "이번 달 청구서 없음"]]} />
          <FilterSelect label="정렬" name="sort" value={filters.sort} options={[["recent", "최근 가입"], ["students", "등록 학생 많은 순"], ["billing", "청구액 높은 순"], ["name", "학원명 순"]]} />
          <button type="submit" className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-bold">적용</button>
          <Link href="/super-admin/tenants" className="border-line text-text-dim hover:text-foreground rounded-md border px-4 py-2 text-sm">초기화</Link>
        </form>
        <section className="bg-card border-line shadow-card overflow-hidden rounded-xl border" aria-label="학원별 운영 현황">
          <div className="border-line flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h3 className="text-foreground text-sm font-bold">학원별 비교 <span className="text-text-dim font-normal">{fmt(total)} / {fmt(all.length)}개</span></h3>
            <p className="text-text-dim text-xs">사용자: 전체 계정 · 학생: enrolled · 반: 활성 · 청구: 이번 달 void 제외</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="bg-bg-soft text-text-dim border-line border-b text-xs">
                  <th scope="col" className="px-4 py-3 text-left font-bold">학원</th>
                  <th scope="col" className="px-3 py-3 text-left font-bold">플랜</th>
                  <th scope="col" className="px-3 py-3 text-right font-bold">사용자</th>
                  <th scope="col" className="px-3 py-3 text-right font-bold">등록 학생</th>
                  <th scope="col" className="px-3 py-3 text-right font-bold">활성 반</th>
                  <th scope="col" className="px-3 py-3 text-right font-bold">이번 달 청구</th>
                  <th scope="col" className="px-3 py-3 text-left font-bold">가입일</th>
                  <th scope="col" className="px-4 py-3 text-right font-bold">관리</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="text-text-dim px-4 py-12 text-center">조건에 맞는 학원이 없습니다. 검색어나 필터를 바꿔 보세요.</td></tr>
                ) : rows.map((t) => (
                  <tr key={t.id} className="hover:bg-bg-soft">
                    <td className="px-4 py-3">
                      <Link href={`/super-admin/tenants/${t.id}`} className="text-foreground hover:text-primary font-bold">{t.name}</Link>
                      <span className="text-text-dim mt-0.5 block font-mono text-xs">{t.slug}</span>
                    </td>
                    <td className="px-3 py-3"><Pill color={t.plan === "free" ? "neutral" : "gold"} soft>{t.plan}</Pill></td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(t.userCount)}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums">{fmt(t.studentCount)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(t.classCount)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="block font-bold">{fmt(t.monthBilling)}원</span>
                      <span className="text-text-dim text-xs">{fmt(t.monthInvoiceCount)}건</span>
                    </td>
                    <td className="text-text-dim px-3 py-3 text-xs whitespace-nowrap">{formatDate(t.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap text-xs font-bold">
                        <Link href={`/super-admin/tenants/${t.id}`} className="text-primary hover:underline">상세</Link>
                        <Link href={`/super-admin/tenants/${t.id}#accounts`} className="text-text-dim hover:text-foreground">계정</Link>
                        <Link href={`/super-admin/tenants/${t.id}#settings`} className="text-text-dim hover:text-foreground">설정</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <Pagination page={page} totalPages={totalPages} total={total} hrefForPage={pageHref} />
      </div>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="bg-card border-line shadow-card rounded-xl border p-4">
    <p className="text-text-dim text-xs font-bold">{label}</p>
    <p className="text-foreground mt-2 text-2xl font-bold tabular-nums">{value}<span className="text-text-dim ml-1 text-xs font-normal">{unit}</span></p>
  </div>;
}

function FilterSelect({ label, name, value, options }: { label: string; name: string; value: string; options: [string, string][] }) {
  return <label className="min-w-32 flex-1">
    <span className="text-text-dim mb-1 block text-xs font-bold">{label}</span>
    <select name={name} defaultValue={value} className="border-line text-foreground bg-card w-full rounded-md border px-3 py-2 text-sm">
      {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select>
  </label>;
}
