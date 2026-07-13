"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, CircleDollarSign, AlertTriangle } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { invoiceOutstanding, paymentRateOf } from "@/features/billing/calc";
import type { StudentBillingRow } from "@/features/students/server/queries";

const CATEGORY_LABEL: Record<string, string> = {
  tuition: "수업료",
  material: "교재",
  exam: "시험",
  other: "기타",
};
// eywa invoiceStatus → 배지(라벨·색). 미납=unpaid, 부분=partial.
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  paid: { label: "납부완료", cls: "text-chart-2 bg-chart-2/10 border-chart-2/20" },
  partial: { label: "부분납부", cls: "text-amber bg-amber/10 border-amber/20" },
  unpaid: { label: "미납", cls: "text-danger bg-danger/10 border-danger/20" },
  refunded: { label: "환불", cls: "text-text-dim bg-bg-soft border-line" },
  void: { label: "무효", cls: "text-text-faint bg-bg-soft border-line" },
};
const PAGE_SIZES = [10, 20, 50, 100];
const won = (n: number) => n.toLocaleString();
// line_items(항목 내역)가 있으면 그 항목명을 대표 라벨로, 없으면 메모 → category 라벨 순.
const billingName = (r: StudentBillingRow) =>
  r.notes?.trim() ||
  r.lineItems.map((li) => li.description).filter(Boolean).join(", ") ||
  CATEGORY_LABEL[r.category] ||
  "청구";

export function BillingView({ invoices }: { invoices: StudentBillingRow[] }) {
  const latestYear = invoices[0]?.period ? Number(invoices[0].period.slice(0, 4)) : new Date().getFullYear();
  const [year, setYear] = useState(latestYear);
  const [statusFilter, setStatusFilter] = useState("all"); // all | paid | pending
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [showStats, setShowStats] = useState(true);
  const [showRecords, setShowRecords] = useState(true);
  const [showOverall, setShowOverall] = useState(true);

  const filtered = useMemo(() => {
    return invoices.filter((r) => {
      if (!r.period.startsWith(String(year))) return false;
      if (statusFilter === "paid") return r.status === "paid";
      if (statusFilter === "pending") return r.status === "unpaid" || r.status === "partial";
      return true;
    });
  }, [invoices, year, statusFilter]);

  const yearStats = useMemo(() => {
    let billed = 0,
      paid = 0,
      unpaid = 0,
      pending = 0;
    for (const r of filtered) {
      billed += r.amountTotal;
      paid += r.amountPaid;
      if (r.status !== "paid") {
        unpaid += invoiceOutstanding(r); // 행 레벨 clamp·refunded/void 제외 — calc.ts 단일 공식
        pending++;
      }
    }
    return { billed, paid, unpaid, pending };
  }, [filtered]);

  const overall = useMemo(() => {
    let billed = 0,
      paid = 0,
      discount = 0,
      paidCount = 0;
    for (const r of invoices) {
      billed += r.amountTotal;
      paid += r.amountPaid;
      discount += r.amountDiscount;
      if (r.status === "paid") paidCount++;
    }
    const net = billed - discount;
    const rate = paymentRateOf(paid, net);
    return { total: invoices.length, paidCount, pendingCount: invoices.length - paidCount, rate };
  }, [invoices]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const setYearReset = (y: number) => {
    setYear(y);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* 헤더: 제목 · 상태필터 · 연도 네비 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex items-center gap-1.5">
          <CircleDollarSign className="text-primary size-4" />
          <h2 className="text-foreground text-sm font-semibold">수납 현황</h2>
        </div>
        <SearchableSelect
          className="ml-auto w-24"
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "전체" },
            { value: "paid", label: "완납" },
            { value: "pending", label: "미납" },
          ]}
          ariaLabel="납부 상태 필터"
        />
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setYearReset(year - 1)} className="hover:bg-bg-soft rounded p-1" aria-label="이전 연도">
            <ChevronLeft className="size-4" />
          </button>
          <span className="num text-foreground min-w-[4rem] text-center text-sm font-medium">{year}년</span>
          <button type="button" onClick={() => setYearReset(year + 1)} className="hover:bg-bg-soft rounded p-1" aria-label="다음 연도">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* 수납 통계 (연도+상태 기준) */}
      <Section title="수납 통계" open={showStats} onToggle={() => setShowStats((s) => !s)}>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="총 청구" value={`${won(yearStats.billed)}원`} cls="bg-blue/5 border-blue/20 text-blue" />
          <StatCard label="납부 완료" value={`${won(yearStats.paid)}원`} cls="bg-chart-2/5 border-chart-2/20 text-chart-2" />
          <StatCard
            label="미납금"
            value={`${won(yearStats.unpaid)}원`}
            sub={yearStats.pending > 0 ? `${yearStats.pending}건` : undefined}
            cls="bg-amber/5 border-amber/20 text-amber"
          />
        </div>
        {yearStats.pending > 0 ? (
          <div className="border-amber/30 bg-amber/10 text-amber mt-2 flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs">
            <AlertTriangle className="size-3.5" />
            미납 건이 {yearStats.pending}건 ({won(yearStats.unpaid)}원) 있습니다.
          </div>
        ) : null}
      </Section>

      {/* 수납 내역 */}
      <Section title="수납 내역" open={showRecords} onToggle={() => setShowRecords((s) => !s)}>
        {filtered.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">{year}년 수납 내역이 없습니다.</div>
        ) : (
          <>
            <div className="border-line overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-bg-soft text-text-dim text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">청구월</th>
                    <th className="px-3 py-2 text-left font-medium">수납명</th>
                    <th className="px-3 py-2 text-right font-medium">청구액</th>
                    <th className="px-3 py-2 text-right font-medium">납부액</th>
                    <th className="px-3 py-2 text-center font-medium">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {paged.map((r) => {
                    const badge = STATUS_BADGE[r.status] ?? { label: r.status, cls: "bg-bg-soft text-text-dim border-line" };
                    return (
                      <tr key={r.id} className="hover:bg-bg-soft/40">
                        <td className="num text-text-dim px-3 py-2 text-xs">{r.period}</td>
                        <td className="text-foreground px-3 py-2" title={billingName(r)}>
                          {r.lineItems.length > 1 ? (
                            // 여러 항목이면 makeedu처럼 항목별로 펼쳐 보여준다(집계로 가려진 내역 복원).
                            <div className="space-y-0.5">
                              {r.lineItems.map((li, i) => (
                                <div key={i} className="flex items-baseline justify-between gap-2">
                                  <span className="truncate">{li.description || "항목"}</span>
                                  <span className="num text-text-faint shrink-0 text-[11px]">{won(li.amount)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="block truncate">{billingName(r)}</span>
                          )}
                        </td>
                        <td className="num px-3 py-2 text-right">{won(r.amountTotal)}</td>
                        <td className="num text-chart-2 px-3 py-2 text-right">{r.amountPaid > 0 ? won(r.amountPaid) : "-"}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block rounded-sm border px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* 페이지네이션 */}
            <div className="text-text-dim mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <SearchableSelect
                  className="w-20"
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                  options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n}개` }))}
                  ariaLabel="페이지당 건수"
                />
                <span>
                  (총 {filtered.length}건 중 {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, filtered.length)}건)
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                  className="border-line hover:bg-bg-soft rounded border px-2 py-1 disabled:opacity-40"
                >
                  이전
                </button>
                <span className="num px-1">
                  {safePage}/{totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="border-line hover:bg-bg-soft rounded border px-2 py-1 disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* 전체 통계 (전 기간) */}
      {invoices.length > 0 ? (
        <Section title="전체 통계" open={showOverall} onToggle={() => setShowOverall((s) => !s)}>
          <div className="bg-bg-soft flex flex-wrap gap-x-5 gap-y-1 rounded-md px-3 py-2.5 text-xs">
            <span>
              총 <b className="text-foreground num">{overall.total}</b>건
            </span>
            <span className="text-chart-2">
              납부 <b className="num">{overall.paidCount}</b>건
            </span>
            <span className="text-amber">
              미납 <b className="num">{overall.pendingCount}</b>건
            </span>
            <span className="text-blue">
              수납률 <b className="num">{overall.rate.toFixed(1)}</b>%
            </span>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <button type="button" onClick={onToggle} className="text-text-dim hover:text-foreground flex items-center gap-1 text-xs font-medium">
        {title}
        <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open ? children : null}
    </div>
  );
}

function StatCard({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls: string }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${cls}`}>
      <p className="text-text-dim text-[11px]">{label}</p>
      <p className="num text-sm font-bold">{value}</p>
      {sub ? <p className="text-[10px] opacity-80">{sub}</p> : null}
    </div>
  );
}
