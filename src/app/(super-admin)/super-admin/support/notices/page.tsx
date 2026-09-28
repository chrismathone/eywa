import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SupportNotReady } from "@/components/support/list-states";
import { SupportNoticeTable } from "@/components/support/notice-table";
import { Toolbar } from "@/components/toolbar";
import { buttonVariants } from "@/components/ui/button";
import { fmtNum } from "@/components/super-admin/parts";
import { getSupportNoticesPage } from "@/features/support/server/queries";
import { SupportAdminTabs } from "../_tabs";

export const metadata = { title: "슈퍼관리자 · 공지사항 — 에이와" };

const PAGE_SIZE = 30;

/** 전 지점 공지사항 — 여기서 쓴 공지가 모든 지점의 고객센터 '공지사항' 면에 그대로 뜬다. */
export default async function SupportNoticesAdminPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const list = await getSupportNoticesPage({ page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE;
  return (
    <>
      <PageHeader
        eyebrow="슈퍼관리자"
        title="고객센터"
        description="여기서 쓴 공지는 모든 지점의 고객센터 공지사항에 뜹니다."
        actions={
          list.ready ? (
            <Link href="/super-admin/support/notices/new" className={buttonVariants()}>
              새 공지
            </Link>
          ) : null
        }
      />
      <Toolbar>
        <SupportAdminTabs active="notices" />
        {list.ready ? <span className="num text-foreground ml-auto text-sm">{fmtNum(list.total)}건</span> : null}
      </Toolbar>
      {!list.ready ? (
        <SupportNotReady error={list.error} />
      ) : list.rows.length === 0 ? (
        <p className="bg-card shadow-card text-foreground rounded-2xl p-5 text-sm">아직 공지가 없습니다.</p>
      ) : (
        <SupportNoticeTable
          rows={list.rows}
          hrefFor={(id) => `/super-admin/support/notices/${id}`}
          normalTotal={list.total - list.pinnedTotal}
          normalOffset={Math.max(0, from - list.pinnedTotal)}
          windowed={false}
        />
      )}
      {list.ready ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={list.total}
          hrefForPage={(p) => (p > 1 ? `/super-admin/support/notices?page=${p}` : "/super-admin/support/notices")}
        />
      ) : null}
    </>
  );
}
