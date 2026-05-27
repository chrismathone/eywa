import { Wallet } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getBillingSummary,
  getInvoicesForPeriod,
  type InvoiceRow,
} from "@/features/billing/server/queries";

export const metadata = { title: "수납관리 — eywa" };

const STATUS_LABEL: Record<string, string> = {
  paid: "완납",
  partial: "부분",
  unpaid: "미수",
  refunded: "환불",
  void: "취소",
};

const STATUS_COLOR: Record<string, string> = {
  paid: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  partial: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  unpaid: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  refunded: "text-muted-foreground bg-muted border-border",
  void: "text-muted-foreground bg-muted border-border",
};

const KRW = new Intl.NumberFormat("ko-KR");
function won(n: number) {
  return `${KRW.format(n)}원`;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${y}년 ${Number(m)}월`;
}

export default async function BillingPage() {
  await requireAccess("billing");
  const [summary, rows] = await Promise.all([
    getBillingSummary(),
    getInvoicesForPeriod(),
  ]);

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
            <Stat
              label="총 청구액"
              value={won(summary.totalBilled)}
              num={false}
            />
            <Stat
              label="수납 완료"
              value={won(summary.totalCollected)}
              highlight="text-chart-2"
              num={false}
              hint={`${summary.paidCount}건`}
            />
            <Stat
              label="미수금"
              value={won(summary.outstanding)}
              highlight="text-chart-4"
              num={false}
              hint={`${summary.unpaidCount + summary.partialCount}건`}
            />
            <Stat
              label="수납률"
              value={`${summary.paymentRate.toFixed(1)}%`}
              highlight="text-chart-1"
            />
          </section>

          <div className="bg-card border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-border text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="eyebrow px-5 py-3 font-normal">학년</th>
                  <th className="eyebrow px-5 py-3 font-normal">이름</th>
                  <th className="eyebrow px-5 py-3 font-normal">항목</th>
                  <th className="eyebrow num px-5 py-3 text-right font-normal">청구액</th>
                  <th className="eyebrow num px-5 py-3 text-right font-normal">수납액</th>
                  <th className="eyebrow px-5 py-3 font-normal">상태</th>
                  <th className="eyebrow num px-5 py-3 text-right font-normal">기한 · 결제일</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((r) => (
                  <Row key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
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
  num = true,
}: {
  label: string;
  value: string;
  highlight?: string;
  hint?: string;
  num?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p
        className={`text-foreground text-xl font-semibold ${num ? "num" : "num"} ${highlight ?? ""}`}
      >
        {value}
      </p>
      {hint ? <p className="text-muted-foreground num text-xs">{hint}</p> : null}
    </div>
  );
}

function Row({ row: r }: { row: InvoiceRow }) {
  const description = r.lineItems[0]?.description ?? "—";
  const settledAt = r.paidAt ? new Date(r.paidAt).toLocaleDateString("ko-KR") : null;

  return (
    <tr className="hover:bg-accent/40 transition-colors">
      <td className="text-muted-foreground px-5 py-3">{r.studentGrade ?? "—"}</td>
      <td className="px-5 py-3">
        <Link
          href={`/students/${r.studentId}`}
          className="text-foreground font-medium hover:underline"
        >
          {r.studentName}
        </Link>
      </td>
      <td className="text-muted-foreground px-5 py-3 text-xs">{description}</td>
      <td className="text-foreground num px-5 py-3 text-right">{won(r.amountTotal)}</td>
      <td className="num px-5 py-3 text-right">
        <span
          className={r.amountPaid === r.amountTotal ? "text-chart-2" : "text-muted-foreground"}
        >
          {won(r.amountPaid)}
        </span>
      </td>
      <td className="px-5 py-3">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
            STATUS_COLOR[r.status] ?? "bg-muted text-muted-foreground border-border"
          }`}
        >
          {STATUS_LABEL[r.status] ?? r.status}
        </span>
      </td>
      <td className="num px-5 py-3 text-right text-xs">
        {settledAt ? (
          <span className="text-muted-foreground">{settledAt}</span>
        ) : (
          <span className="text-muted-foreground">기한 {r.dueDate ?? "—"}</span>
        )}
      </td>
    </tr>
  );
}
