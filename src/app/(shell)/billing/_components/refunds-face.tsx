import { Plus, ReceiptText } from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/pagination";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getRefundRequests } from "@/features/billing/server/refund-queries";

const PAGE_SIZE = 50;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });

/**
 * 환불 요청서 면(/billing?tab=refunds) — 웹에서 작성한 환불처리요청서 목록. 작성본은 데이터베이스
 * (수납·결제, 사무실 전용 열람)에 저장되고, 여기와 /documents 양쪽에서 같은 행이 보인다. (직원 이력서 패턴)
 */
export async function RefundsFace({ page }: { page: number }) {
  const user = await getCurrentUser();
  const canWrite = !!user && (await canWriteTenant(user.systemRole, "billing"));
  const all = await getRefundRequests();

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) =>
    p > 1 ? `/billing?tab=refunds&page=${p}` : "/billing?tab=refunds";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="micro">
          작성된 환불 요청서 <span className="text-foreground font-bold">{all.length}</span>건
          <span className="text-text-faint ml-2 normal-case">
            · 서식을 웹에서 작성 — 데이터베이스(수납·결제)에 저장되고 A4로 인쇄할 수 있습니다
          </span>
        </p>
        {canWrite ? (
          <Button render={<WindowLink href="/billing/refunds/new" title="환불 요청서 작성" />}>
            <Plus className="size-4" />새 환불 요청서
          </Button>
        ) : null}
      </div>

      {all.length === 0 ? (
        <EmptyState
          icon={() => <ReceiptText size={32} strokeWidth={1.5} />}
          title="작성된 환불 요청서가 없습니다"
          description="'새 환불 요청서'로 종이 서식과 같은 항목을 웹에서 입력하세요 — 인쇄·작성·보관이 한 번에 됩니다."
        />
      ) : (
        <div className="bg-card border-line overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-dim border-line border-b text-left text-xs">
                <th className="px-4 py-2 font-medium">학생</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">수강반</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">환불요청일자</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">총 환불금액</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">작성일</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">작성자</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-line hover:bg-bg-soft/50 border-t transition-colors">
                  <td className="px-4 py-2">
                    <WindowLink
                      href={`/billing/refunds/${r.id}`}
                      title={`환불 요청서 — ${r.name}`}
                      className="text-foreground hover:text-primary inline-flex items-center gap-2 font-medium hover:underline"
                    >
                      <ReceiptText className="text-danger size-4 shrink-0" />
                      {r.name}
                    </WindowLink>
                  </td>
                  <td className="text-text-dim max-w-40 truncate px-3 py-2">{r.className || "—"}</td>
                  <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.requestDate || "—"}</td>
                  <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.totalAmount || "—"}</td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(r.createdAt)}</td>
                  <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.authorName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={all.length} />
    </section>
  );
}
