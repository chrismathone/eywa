import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/pagination";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getRefundRequests, type RefundListRow } from "@/features/billing/server/refund-queries";

const PAGE_SIZE = 50;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });

// ── 월 스테퍼(지출 패널과 동일 패턴, "YYYY-MM") ──
function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${y}년 ${Number(m)}월`;
}
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// 환불의 '월' = 환불처리일자(YYYY-MM-DD) 우선, 미입력이면 작성일 기준(월 필터에서 숨김 방지).
function monthOf(r: RefundListRow): string {
  return /^\d{4}-\d{2}-\d{2}/.test(r.requestDate) ? r.requestDate.slice(0, 7) : r.createdAt.slice(0, 7);
}

/**
 * 환불 요청서 면(/billing?tab=refunds) — 웹에서 작성한 환불처리요청서 목록. 작성본은 데이터베이스
 * (수납·결제, 사무실 전용 열람)에 저장되고, 여기와 /documents 양쪽에서 같은 행이 보인다. (직원 이력서 패턴)
 *
 * 월별 필터(지출 패널과 동일 ◀ 년월 ▶ 스테퍼) — 환불처리일자 기준(미입력이면 작성월). 기본 표시월은
 * 가장 최근 데이터 월(첫 로드에 빈 달 방지). 데이터 없으면 이번 달.
 */
export async function RefundsFace({ sp }: { sp: { page?: string; period?: string } }) {
  const user = await getCurrentUser();
  const canWrite = !!user && (await canWriteTenant(user.systemRole, "billing"));
  const all = await getRefundRequests();

  const monthsWithData = [...new Set(all.map(monthOf))].sort().reverse();
  const defaultPeriod = monthsWithData[0] ?? currentPeriod();
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : defaultPeriod;

  const monthRows = all.filter((r) => monthOf(r) === period);
  const totalPages = Math.max(1, Math.ceil(monthRows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), totalPages);
  const rows = monthRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const monthHref = (per: string) =>
    `/billing?${new URLSearchParams({ tab: "refunds", period: per }).toString()}`;
  const pageHref = (p: number) => {
    const q = new URLSearchParams({ tab: "refunds", period });
    if (p > 1) q.set("page", String(p));
    return `/billing?${q.toString()}`;
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="micro">
          <span className="text-foreground font-bold">{formatPeriod(period)}</span> 환불 요청서{" "}
          <span className="text-foreground font-bold">{monthRows.length}</span>건
          <span className="text-text-faint ml-2 normal-case">
            · 전체 {all.length}건 · 환불처리일자 기준(미입력 시 작성월)
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
        <>
          {/* 월 navigator (지출 패널과 동일 스타일) */}
          <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
            <div className="flex items-center gap-1.5">
              <Link
                href={monthHref(shiftPeriod(period, -1))}
                className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
                aria-label="이전 달"
              >
                ◀
              </Link>
              <span className="text-foreground min-w-[90px] text-center text-[13px] font-bold">
                {formatPeriod(period)}
              </span>
              <Link
                href={monthHref(shiftPeriod(period, 1))}
                className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
                aria-label="다음 달"
              >
                ▶
              </Link>
            </div>
            <span className="text-text-faint ml-auto font-mono text-[10px]">
              환불 기록 {monthsWithData.length}개월
            </span>
          </div>

          {monthRows.length === 0 ? (
            <div className="bg-card border-line text-text-dim rounded-md border px-4 py-10 text-center text-sm">
              {formatPeriod(period)}에 작성된 환불 요청서가 없습니다.
            </div>
          ) : (
            <>
              <div className="bg-card border-line overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-text-dim border-line border-b text-left text-xs">
                      <th className="px-4 py-2 font-medium">학생</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">수강반</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">환불처리일자</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">환불완료일자</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">총 환불금액</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">작성일</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">담당자</th>
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
                        {/* '환불처리일자'·'담당자'는 헤더만 리네임 — 데이터는 기존 그대로(서식 환불요청일자·작성자). 사용자 지시. */}
                        <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.requestDate || "—"}</td>
                        <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.completedDate || "—"}</td>
                        <td className="text-text-dim num px-3 py-2 whitespace-nowrap">{r.totalAmount || "—"}</td>
                        <td className="text-text-dim px-3 py-2 whitespace-nowrap">{dateLabel(r.createdAt)}</td>
                        <td className="text-text-dim px-3 py-2 whitespace-nowrap">{r.authorName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} total={monthRows.length} />
            </>
          )}
        </>
      )}
    </section>
  );
}
