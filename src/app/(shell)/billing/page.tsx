import { AlertTriangle, Wallet } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getBillingSummary,
  getInvoicesForPeriod,
} from "@/features/billing/server/queries";
import { BillingTable } from "./_components/billing-table";

export const metadata = { title: "수납관리 — eywa" };

const KRW = new Intl.NumberFormat("ko-KR");
function won(n: number) {
  return `${KRW.format(n)}원`;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${y}년 ${Number(m)}월`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function BillingPage() {
  await requireAccess("billing");
  const [summary, rows] = await Promise.all([
    getBillingSummary(),
    getInvoicesForPeriod(),
  ]);

  const today = todayIso();
  const overdue = rows.filter(
    (r) =>
      (r.status === "unpaid" || r.status === "partial") &&
      r.dueDate !== null &&
      r.dueDate < today,
  );
  const overdueAmount = overdue.reduce(
    (s, r) => s + (r.amountTotal - r.amountPaid),
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="수납관리"
        description={`${formatPeriod(summary.period)} 청구 ${summary.totalCount}건 · 수납률 ${summary.paymentRate.toFixed(1)}%`}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="이번 달 청구 내역이 없습니다"
          description="시드를 다시 적용하거나 신규 청구서를 생성하세요."
        />
      ) : (
        <>
          <section className="bg-card border-border grid grid-cols-2 gap-4 rounded-lg border p-5 sm:grid-cols-4">
            <Stat label="총 청구액" value={won(summary.totalBilled)} />
            <Stat
              label="수납 완료"
              value={won(summary.totalCollected)}
              highlight="text-chart-2"
              hint={`${summary.paidCount}건`}
            />
            <Stat
              label="미수금"
              value={won(summary.outstanding)}
              highlight="text-chart-4"
              hint={`${summary.unpaidCount + summary.partialCount}건`}
            />
            <Stat
              label="수납률"
              value={`${summary.paymentRate.toFixed(1)}%`}
              highlight="text-chart-1"
            />
          </section>

          {overdue.length > 0 ? (
            <section className="border-chart-4/30 bg-chart-4/5 flex items-start gap-3 rounded-lg border p-4">
              <AlertTriangle className="text-chart-4 mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium">
                  기한 경과 미수금 <span className="num">{overdue.length}</span>건
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  합계 <span className="num">{won(overdueAmount)}</span>. 표에서 체크박스로 선택해 일괄 완납 처리하거나, 행 우측 연필 아이콘으로 개별 수정하세요.
                </p>
              </div>
            </section>
          ) : null}

          <BillingTable rows={rows} />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  hint,
}: {
  label: string;
  value: string;
  highlight?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`text-foreground num text-xl font-semibold ${highlight ?? ""}`}>{value}</p>
      {hint ? <p className="text-muted-foreground num text-xs">{hint}</p> : null}
    </div>
  );
}
