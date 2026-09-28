import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { SupportRequestTable } from "@/components/support/request-table";
import { FilterSelect } from "@/components/filter-select";
import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { SupportNotReady } from "@/components/support/list-states";
import {
  getAllSupportRequestsPage,
  getSupportStatusCounts,
  getSupportTenantOptions,
} from "@/features/support/server/admin-queries";
import { isSupportStatus, SUPPORT_STATUSES, SUPPORT_STATUS_META, type SupportStatus } from "@/features/support/types";
import { fmtNum } from "@/components/super-admin/parts";
import { SupportAdminTabs } from "./_tabs";

export const metadata = { title: "슈퍼관리자 · 고객센터 — 에이와" };

const PAGE_SIZE = 30;

/**
 * 전 지점 개선요청 — 지점 화면(`/support?tab=requests`)에 쌓인 요청을 모아 처리한다.
 * 처리상태 칩에 건수를 붙여 "지금 손댈 것(접수·내용확인·처리중)"이 한눈에 보이게.
 */
export default async function SupportAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; tenant?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status: SupportStatus | null = isSupportStatus(sp.status) ? sp.status : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const tenants = await getSupportTenantOptions();
  // 모르는 지점 id(지워진 지점·손으로 고친 주소)는 필터로 쓰지 않는다 — '전 지점'으로.
  const tenantId = tenants.some((t) => t.value === sp.tenant) ? (sp.tenant as string) : null;
  const [list, counts] = await Promise.all([
    getAllSupportRequestsPage({ q: q || undefined, status, tenantId, page, pageSize: PAGE_SIZE }),
    getSupportStatusCounts(tenantId),
  ]);
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const hrefWith = (next: { status?: SupportStatus | null; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (tenantId) params.set("tenant", tenantId);
    const st = next.status === undefined ? status : next.status;
    if (st) params.set("status", st);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const s = params.toString();
    return s ? `/super-admin/support?${s}` : "/super-admin/support";
  };
  const open = counts ? counts.received + counts.checking + counts.in_progress : null;
  // 문구와 건수가 같은 범위를 말하게 — 지점을 골랐으면 그 지점 이름으로.
  const scope = tenantId ? (tenants.find((t) => t.value === tenantId)?.label ?? "이 지점") : "전 지점";

  return (
    <>
      <PageHeader
        eyebrow="슈퍼관리자"
        title="고객센터"
        description={
          open === null ? `${scope}의 개선요청을 처리합니다.` : `${scope}의 개선요청을 처리합니다 · 처리할 요청 ${fmtNum(open)}건`
        }
      />
      <Toolbar>
        <SupportAdminTabs active="requests" />
        <FilterSelect
          paramName="tenant"
          axisLabel="지점"
          allLabel="전 지점"
          value={tenantId}
          options={tenants}
          ariaLabel="지점 필터"
          triggerClassName={TOOLBAR_SELECT}
        />
        <ToolbarSegment label="처리상태" wrap>
          <ToolbarSegmentItem active={status === null} href={hrefWith({ status: null })}>
            전체
          </ToolbarSegmentItem>
          {SUPPORT_STATUSES.map((s) => (
            <ToolbarSegmentItem key={s} active={status === s} href={hrefWith({ status: s })}>
              {SUPPORT_STATUS_META[s].label}
              {counts ? ` ${fmtNum(counts[s])}` : ""}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
        <SearchToggle placeholder="제목 · 내용 검색" defaultValue={q} />
        {list.ready ? <span className="num text-foreground ml-auto text-sm">{fmtNum(list.total)}건</span> : null}
      </Toolbar>
      {!list.ready ? (
        <SupportNotReady error={list.error} />
      ) : list.rows.length === 0 ? (
        <p className="bg-card shadow-card text-foreground rounded-2xl p-5 text-sm">
          {q || status || tenantId ? "조건에 맞는 개선요청이 없습니다." : "아직 들어온 개선요청이 없습니다."}
        </p>
      ) : (
        <SupportRequestTable
          rows={list.rows}
          hrefFor={(id) => `/super-admin/support/${id}`}
          showTenant
          windowed={false}
        />
      )}
      {list.ready ? (
        <Pagination page={page} totalPages={totalPages} total={list.total} hrefForPage={(p) => hrefWith({ page: p })} />
      ) : null}
    </>
  );
}
