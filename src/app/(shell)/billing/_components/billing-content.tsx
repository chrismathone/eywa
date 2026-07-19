import Link from "next/link";
import { Receipt, BadgePercent, CircleDollarSign, Percent, ReceiptText } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { BigStat } from "@/components/atoms/big-stat";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  getAvailablePeriods,
  getInvoicesForPeriod,
  summarizeInvoices,
  type SortKey,
} from "@/features/billing/server/queries";
import { invoiceOutstanding } from "@/features/billing/calc";
import { getStudentOptions } from "@/features/billing/server/textbook-queries";
import { SearchForm } from "@/components/search-form";
import { BillingTable } from "./billing-table";
import { CreateInvoiceTrigger } from "./create-invoice-dialog";
import { Pagination } from "@/components/pagination";

const KRW = new Intl.NumberFormat("ko-KR");
function won(n: number) {
  return `${KRW.format(n)}원`;
}
function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${y}년 ${Number(m)}월`;
}
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function todayIso(): string {
  return kstToday();
}
function currentPeriod(): string {
  return kstMonth();
}

type Sp = { period?: string; q?: string; sort?: SortKey; desc?: string; page?: string };

export async function BillingContent({ sp }: { sp: Sp }) {
  const period = sp.period ?? currentPeriod();
  const q = sp.q ?? "";
  const sort: SortKey = (sp.sort as SortKey) ?? "status";
  const desc = sp.desc === "1";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const [monthRows, periods, students] = await Promise.all([
    getInvoicesForPeriod({ period, sort, desc }),
    getAvailablePeriods(),
    getStudentOptions(),
  ]);

  const summary = summarizeInvoices(monthRows, period);

  const term = q.trim().toLowerCase();
  const filtered = term
    ? monthRows.filter(
        (r) =>
          r.studentName.toLowerCase().includes(term) ||
          r.lineItems.some((li) => li.description.toLowerCase().includes(term)),
      )
    : monthRows;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const today = todayIso();
  const overdue = filtered.filter(
    (r) =>
      (r.status === "unpaid" || r.status === "partial") &&
      r.dueDate !== null &&
      r.dueDate < today,
  );
  // 미수금은 실청구(청구−할인) 기준 — calc.ts 행 레벨 단일 공식(음수는 0).
  const overdueAmount = overdue.reduce((s, r) => s + invoiceOutstanding(r), 0);

  const prevPeriod = shiftPeriod(period, -1);
  const nextPeriod = shiftPeriod(period, 1);

  // 진행률 바도 실청구(청구−할인) 기준 — 완납 학생이 할인폭만큼 미수 밴드로 새지 않게.
  const netBase = summary.totalBilled - summary.totalDiscount || 1;
  const paidPct = Math.min((summary.totalCollected / netBase) * 100, 100);
  const partialPct = Math.max(
    0,
    (monthRows
      .filter((r) => r.status === "partial")
      .reduce((s, r) => s + invoiceOutstanding(r), 0) /
      netBase) *
      100,
  );
  const unpaidPct = Math.max(0, 100 - paidPct - partialPct);

  const buildHref = (opts: { period: string; q: string; sort: SortKey; desc: boolean }): string => {
    const params = new URLSearchParams();
    if (opts.period !== currentPeriod()) params.set("period", opts.period);
    if (opts.q) params.set("q", opts.q);
    if (opts.sort !== "status") params.set("sort", opts.sort);
    if (opts.desc) params.set("desc", "1");
    const s = params.toString();
    return s ? `/billing?${s}` : "/billing";
  };
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (period !== currentPeriod()) params.set("period", period);
    if (q) params.set("q", q);
    if (sort !== "status") params.set("sort", sort);
    if (desc) params.set("desc", "1");
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/billing?${s}` : "/billing";
  };

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→월 헤드라인→서브(청구·수납률 승격). 월 네비게이션은 actions 슬롯. */}
      <PageHeader
        eyebrow="수납 현황"
        title={formatPeriod(period)}
        description={`청구 ${summary.totalCount}건 · 수납률 ${summary.paymentRate.toFixed(1)}%${
          q ? ` · “${q}” 검색 결과 ${total}건` : ""
        }${totalPages > 1 ? ` · ${page}/${totalPages} 페이지` : ""}`}
        actions={
          <>
            <Link
              href={buildHref({ period: prevPeriod, q, sort, desc })}
              className="border-line hover:bg-bg-soft inline-flex size-8 items-center justify-center rounded-full border"
              aria-label="이전 달"
            >
              <EyIcon name="chevronLeft" size={14} />
            </Link>
            <Link
              href={buildHref({ period: nextPeriod, q, sort, desc })}
              className="border-line hover:bg-bg-soft inline-flex size-8 items-center justify-center rounded-full border"
              aria-label="다음 달"
            >
              <EyIcon name="chevronRight" size={14} />
            </Link>
          </>
        }
      />

      {/* 툴바 — 최근 월 알약 칩 + 검색 + 액션(신규 청구·엑셀) */}
      <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
          {periods.slice(0, 6).map((p) => (
            <Link
              key={p}
              href={buildHref({ period: p, q, sort, desc })}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                p === period
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {formatPeriod(p)}
            </Link>
          ))}
        </div>

        <SearchForm placeholder="학생명·항목" defaultValue={q} inputWidth="w-36" />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <CreateInvoiceTrigger students={students} defaultPeriod={period} variant="outline" />
          <Button
            variant="outline"
            render={
              <a
                href={`/api/exports/billing?${new URLSearchParams({ period, ...(q ? { q } : {}) }).toString()}`}
              />
            }
          >
            <EyIcon name="arrowDown" size={13} />
            엑셀 내보내기
          </Button>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          image={q ? "search" : "billing"}
          icon={() => <ReceiptText size={32} strokeWidth={1.5} />}
          title={q ? "검색 결과 없음" : "이 달 청구 내역이 없습니다"}
          description={q ? "검색어를 조정해보세요." : "월을 이동하거나 신규 청구서를 생성하세요."}
        />
      ) : (
        <>
          {/* KPI 5종 — Editorial 문법 ②(BigStat). 금액은 num tabular + "원" 단위 분리, 미수금만 danger 강조. */}
          <section className="grid grid-cols-2 gap-3.5 md:grid-cols-3 2xl:grid-cols-5">
            <BigStat
              label="총 청구액"
              value={KRW.format(summary.totalBilled)}
              unit="원"
              tone="primary"
              icon={<Receipt size={16} strokeWidth={2} />}
              sub={`${summary.totalCount}건`}
            />
            <BigStat
              label="할인 합계"
              value={KRW.format(summary.totalDiscount)}
              unit="원"
              tone="amber"
              icon={<BadgePercent size={16} strokeWidth={2} />}
            />
            <BigStat
              label="수납 완료"
              value={KRW.format(summary.totalCollected)}
              unit="원"
              tone="primary"
              icon={<EyIcon name="check" size={16} />}
              sub={`${summary.paidCount}건`}
            />
            <BigStat
              label="미수금"
              value={KRW.format(summary.outstanding)}
              unit="원"
              tone="danger"
              valueClass="text-danger"
              icon={<CircleDollarSign size={16} strokeWidth={2} />}
              sub={`부분 ${summary.partialCount} · 미수 ${summary.unpaidCount}건`}
            />
            <BigStat
              label="수납률"
              value={summary.paymentRate.toFixed(1)}
              unit="%"
              tone="gold"
              icon={<Percent size={16} strokeWidth={2} />}
            />
          </section>

          <section className="bg-card shadow-card rounded-2xl p-5">
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-foreground text-sm font-bold">수납 진행률</h2>
              <span className="text-text-dim num text-[12px]">
                완납 {paidPct.toFixed(1)}% · 부분 {partialPct.toFixed(1)}% · 미수 {unpaidPct.toFixed(1)}%
              </span>
            </header>
            <div className="bg-bg-soft flex h-2.5 overflow-hidden rounded-pill">
              <span className="bg-primary block h-full" style={{ width: `${paidPct}%` }} />
              <span className="bg-amber block h-full" style={{ width: `${partialPct}%` }} />
              <span className="bg-danger block h-full" style={{ width: `${unpaidPct}%` }} />
            </div>
          </section>

          {overdue.length > 0 ? (
            /* 기한 경과 배너 — 굵은 건수+금액 위계 + 우측 '목록 보기'(납부기한 순 정렬로 이동) */
            <section className="bg-danger-soft flex flex-wrap items-center gap-4 rounded-2xl p-5">
              <span className="bg-danger/15 text-danger flex size-10 shrink-0 items-center justify-center rounded-xl">
                <CircleDollarSign size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-[13px] font-bold">기한 경과 미수금</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="num text-danger text-[24px] font-extrabold leading-none">
                    {overdue.length}
                  </span>
                  <span className="text-text-dim text-[12px]">건</span>
                  <span className="num text-foreground text-[17px] font-bold">{won(overdueAmount)}</span>
                </p>
              </div>
              <Link
                href={buildHref({ period, q, sort: "due_date", desc: false })}
                className="border-danger/40 text-danger hover:bg-danger/10 shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition"
              >
                목록 보기
              </Link>
            </section>
          ) : null}

          <BillingTable rows={rows} sort={sort} desc={desc} period={period} q={q} />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
