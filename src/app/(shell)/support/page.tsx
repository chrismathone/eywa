import { FaceTabs } from "@/components/face-tabs";
import { FilterSelect } from "@/components/filter-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SearchToggle } from "@/components/search-toggle";
import { SupportNoticeTable } from "@/components/support/notice-table";
import { SupportRequestTable } from "@/components/support/request-table";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { buttonVariants } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteSupportRequest } from "@/features/support/access";
import { resolveSupportTab, supportFaces, SUPPORT_PATH, type SupportTab } from "@/features/support/faces";
import { getSupportNoticesPage, getSupportRequestsPage } from "@/features/support/server/queries";
import { isSupportStatus, SUPPORT_STATUS_OPTIONS, type SupportStatus } from "@/features/support/types";
import { SupportEmpty, SupportNotReady } from "@/components/support/list-states";

type Sp = { tab?: string; q?: string; status?: string; page?: string; embed?: string };

const PAGE_SIZE = 20;
const TITLE_SUFFIX: Record<SupportTab, string> = { notices: "", requests: " · 개선요청" };

// 면마다 문서 제목을 달리해 창 타이틀바가 "고객센터 · 개선요청"으로 갱신된다. 접두는 사이드바 라벨과 같다.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const tab = resolveSupportTab((await searchParams).tab);
  return { title: `고객센터${TITLE_SUFFIX[tab]} — 에이와` };
}

/**
 * 고객센터 — makeedu 고객센터(공지사항 · 개선요청)를 옮긴 화면(원장 2026-09-28). 지점이 aywa 운영자에게 요청하고,
 * 운영자(슈퍼관리자)가 `/super-admin/support`에서 처리상태·예정일·답변을 채운다.
 */
export default async function SupportPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const [user, sp] = await Promise.all([requireAccess("support"), searchParams]);
  const tab = resolveSupportTab(sp.tab);
  const q = (sp.q ?? "").trim();
  const status = isSupportStatus(sp.status) ? sp.status : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const embed = sp.embed === "1";

  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (tab !== "notices") params.set("tab", tab);
    if (q) params.set("q", q);
    if (status && tab === "requests") params.set("status", status);
    if (p > 1) params.set("page", String(p));
    if (embed) params.set("embed", "1");
    const s = params.toString();
    return s ? `${SUPPORT_PATH}?${s}` : SUPPORT_PATH;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="지원"
        title="고객센터"
        description="에이와 운영팀의 공지를 보고, 바라는 점을 개선요청으로 남깁니다."
      />
      <FaceTabs faces={supportFaces()} active={tab} ariaLabel="고객센터 면" />
      {tab === "notices" ? (
        <NoticesFace q={q} page={page} pageHref={pageHref} />
      ) : (
        <RequestsFace
          q={q}
          status={status}
          page={page}
          pageHref={pageHref}
          canWrite={await canWriteSupportRequest(user.systemRole)}
        />
      )}
    </div>
  );
}

async function NoticesFace({ q, page, pageHref }: { q: string; page: number; pageHref: (p: number) => string }) {
  const list = await getSupportNoticesPage({ q: q || undefined, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE;
  return (
    <>
      <Toolbar>
        <SearchToggle placeholder="제목 · 내용 검색" defaultValue={q} />
        {list.ready ? <span className="num text-foreground ml-auto text-sm">총 {list.total}건</span> : null}
      </Toolbar>
      {!list.ready ? (
        <SupportNotReady error={list.error} />
      ) : list.rows.length === 0 ? (
        <SupportEmpty text={q ? `‘${q}’에 걸리는 공지가 없습니다.` : "아직 공지가 없습니다."} />
      ) : (
        <SupportNoticeTable
          rows={list.rows}
          hrefFor={(id) => `/support/notices/${id}`}
          normalTotal={list.total - list.pinnedTotal}
          normalOffset={Math.max(0, from - list.pinnedTotal)}
        />
      )}
      {list.ready ? <Pagination page={page} totalPages={totalPages} total={list.total} hrefForPage={pageHref} /> : null}
    </>
  );
}

async function RequestsFace({
  q,
  status,
  page,
  pageHref,
  canWrite,
}: {
  q: string;
  status: SupportStatus | null;
  page: number;
  pageHref: (p: number) => string;
  canWrite: boolean;
}) {
  const list = await getSupportRequestsPage({ q: q || undefined, status, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const filtered = Boolean(q || status);
  return (
    <>
      <Toolbar>
        <FilterSelect
          paramName="status"
          axisLabel="처리상태"
          value={status}
          options={SUPPORT_STATUS_OPTIONS}
          ariaLabel="처리상태 필터"
          triggerClassName={TOOLBAR_SELECT}
        />
        <SearchToggle placeholder="제목 · 내용 검색" defaultValue={q} />
        <div className="ml-auto flex items-center gap-3">
          {list.ready ? <span className="num text-foreground text-sm">총 {list.total}건</span> : null}
          {canWrite && list.ready ? (
            <WindowLink href="/support/requests/new" className={buttonVariants()}>
              글쓰기
            </WindowLink>
          ) : null}
        </div>
      </Toolbar>
      {!list.ready ? (
        <SupportNotReady error={list.error} />
      ) : list.rows.length === 0 ? (
        <SupportEmpty
          text={filtered ? "조건에 맞는 개선요청이 없습니다." : "아직 개선요청이 없습니다. 바라는 점을 글쓰기로 남겨 주세요."}
        />
      ) : (
        <SupportRequestTable rows={list.rows} hrefFor={(id) => `/support/requests/${id}`} />
      )}
      {list.ready ? <Pagination page={page} totalPages={totalPages} total={list.total} hrefForPage={pageHref} /> : null}
    </>
  );
}
