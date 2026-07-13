import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Receipt, BadgePercent, CircleDollarSign, Percent, ReceiptText } from "lucide-react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { kstToday } from "@/lib/date-kst";
import { Pill } from "@/components/atoms/pill";
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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
    <div className="space-y-4">
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Link
            href={buildHref({ period: prevPeriod, q, sort, desc })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
            aria-label="이전 달"
          >
            ◀
          </Link>
          <span className="text-foreground min-w-[90px] text-center text-[13px] font-bold">
            {formatPeriod(period)}
          </span>
          <Link
            href={buildHref({ period: nextPeriod, q, sort, desc })}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-sm border"
            aria-label="다음 달"
          >
            ▶
          </Link>
        </div>

        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
          {periods.slice(0, 6).map((p) => (
            <Link
              key={p}
              href={buildHref({ period: p, q, sort, desc })}
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
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
      </div>

      <div className="flex items-center justify-between">
        <p className="text-text-dim text-xs">
          {formatPeriod(period)} 청구 {summary.totalCount}건 · 수납률{" "}
          <span className="num text-foreground font-semibold">{summary.paymentRate.toFixed(1)}%</span>
          {q ? <span className="ml-2">· &ldquo;{q}&rdquo; 검색 결과 {total}건</span> : null}
          {totalPages > 1 ? (
            <span className="ml-2">
              · {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2">
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
          <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
            <KpiCard label="총 청구액" value={won(summary.totalBilled)} icon={Receipt} color="primary" hint={`${summary.totalCount}건`} />
            <KpiCard label="할인 합계" value={won(summary.totalDiscount)} icon={BadgePercent} color="amber" />
            <KpiCard label="수납 완료" value={won(summary.totalCollected)} icon="check" color="primary" hint={`${summary.paidCount}건`} />
            <KpiCard label="미수금" value={won(summary.outstanding)} icon={CircleDollarSign} color="danger" hint={`부분 ${summary.partialCount} · 미수 ${summary.unpaidCount}건`} />
            <KpiCard label="수납률" value={`${summary.paymentRate.toFixed(1)}%`} icon={Percent} color="gold" />
          </section>

          <section className="bg-card border-line shadow-card rounded-md border p-5">
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-foreground text-sm font-bold">수납 진행률</h2>
              <span className="text-text-dim font-mono text-[11px]">
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
            <section className="bg-danger-soft border-danger/30 flex items-start gap-3 rounded-md border p-4">
              <span className="bg-danger/15 text-danger flex size-9 shrink-0 items-center justify-center rounded-sm">
                <CircleDollarSign size={18} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Pill color="danger" soft={false}>긴급</Pill>
                  <p className="text-foreground text-sm font-bold">
                    기한 경과 미수금 <span className="num">{overdue.length}</span>건
                  </p>
                </div>
                <p className="text-text-dim mt-1 text-xs">
                  합계 <span className="num text-foreground font-semibold">{won(overdueAmount)}</span>
                </p>
              </div>
            </section>
          ) : null}

          <BillingTable rows={rows} sort={sort} desc={desc} period={period} q={q} />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon | "check";
  color: "primary" | "gold" | "danger" | "amber";
  hint?: string;
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    gold: "bg-gold-soft text-gold",
    danger: "bg-danger-soft text-danger",
    amber: "bg-amber-soft text-amber",
  } as const;
  const GLOW = {
    primary: "bg-primary/10",
    gold: "bg-gold/10",
    danger: "bg-danger/10",
    amber: "bg-amber/10",
  } as const;
  return (
    <article className="bg-card border-line shadow-card relative overflow-hidden rounded-md border p-5">
      <span className={`pointer-events-none absolute -top-8 -right-8 size-[100px] rounded-pill blur-md ${GLOW[color]}`} aria-hidden="true" />
      <header className="relative flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          {Icon === "check" ? <EyIcon name="check" size={14} /> : <Icon size={14} strokeWidth={2} />}
        </span>
      </header>
      <p className="tabular text-foreground num relative mt-3 text-[18px] leading-tight">{value}</p>
      {hint ? (
        <p className="text-text-dim num border-line relative mt-3 border-t pt-3 text-[11px]">{hint}</p>
      ) : (
        <div className="relative mt-3 h-[24px]" />
      )}
    </article>
  );
}
