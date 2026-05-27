import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
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

  // 진행률 스트립 비율
  const total = summary.totalBilled || 1;
  const paidPct = (summary.totalCollected / total) * 100;
  const partialPct = Math.max(
    0,
    (rows.filter((r) => r.status === "partial").reduce((s, r) => s + (r.amountTotal - r.amountPaid), 0) / total) * 100,
  );
  const unpaidPct = Math.max(0, 100 - paidPct - partialPct);

  return (
    <div className="space-y-5">
      <p className="text-text-dim text-xs">
        {formatPeriod(summary.period)} 청구 {summary.totalCount}건 · 수납률{" "}
        <span className="num text-foreground font-semibold">
          {summary.paymentRate.toFixed(1)}%
        </span>
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="pollen" size={32} />}
          title="이번 달 청구 내역이 없습니다"
          description="시드를 다시 적용하거나 신규 청구서를 생성하세요."
        />
      ) : (
        <>
          {/* Stat 4 카드 */}
          <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <KpiCard
              label="총 청구액"
              value={won(summary.totalBilled)}
              icon="pollen"
              color="primary"
              hint={`${summary.totalCount}건`}
            />
            <KpiCard
              label="수납 완료"
              value={won(summary.totalCollected)}
              icon="check"
              color="primary"
              hint={`${summary.paidCount}건`}
            />
            <KpiCard
              label="미수금"
              value={won(summary.outstanding)}
              icon="falling"
              color="danger"
              hint={`${summary.unpaidCount + summary.partialCount}건`}
            />
            <KpiCard
              label="수납률"
              value={`${summary.paymentRate.toFixed(1)}%`}
              icon="rings"
              color="gold"
            />
          </section>

          {/* 진행률 스트립 */}
          <section className="bg-card border-line shadow-card rounded-2xl border p-5">
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-foreground text-sm font-bold">수납 진행률</h2>
              <span className="text-text-dim font-mono text-[11px]">
                완납 {paidPct.toFixed(1)}% · 부분 {partialPct.toFixed(1)}% · 미수{" "}
                {unpaidPct.toFixed(1)}%
              </span>
            </header>
            <div className="bg-bg-soft flex h-2.5 overflow-hidden rounded-full">
              <span
                className="bg-primary block h-full"
                style={{ width: `${paidPct}%` }}
              />
              <span
                className="bg-amber block h-full"
                style={{ width: `${partialPct}%` }}
              />
              <span
                className="bg-danger block h-full"
                style={{ width: `${unpaidPct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="text-text-dim flex items-center gap-1.5">
                <span className="bg-primary size-2 rounded-full" />
                완납 {summary.paidCount}건
              </span>
              <span className="text-text-dim flex items-center gap-1.5">
                <span className="bg-amber size-2 rounded-full" />
                부분 {summary.partialCount}건
              </span>
              <span className="text-text-dim flex items-center gap-1.5">
                <span className="bg-danger size-2 rounded-full" />
                미수 {summary.unpaidCount}건
              </span>
            </div>
          </section>

          {/* 기한 경과 카드 */}
          {overdue.length > 0 ? (
            <section className="bg-danger-soft border-danger/30 flex items-start gap-3 rounded-2xl border p-4">
              <span className="bg-danger/15 text-danger flex size-9 shrink-0 items-center justify-center rounded-md">
                <EyIcon name="falling" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Pill color="danger" soft={false}>긴급</Pill>
                  <p className="text-foreground text-sm font-bold">
                    기한 경과 미수금 <span className="num">{overdue.length}</span>건
                  </p>
                </div>
                <p className="text-text-dim mt-1 text-xs">
                  합계 <span className="num text-foreground font-semibold">{won(overdueAmount)}</span>.{" "}
                  표에서 체크박스로 선택해 일괄 완납 처리하거나, 행 우측 아이콘으로 개별 수정하세요.
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

function KpiCard({
  label,
  value,
  icon,
  color,
  hint,
}: {
  label: string;
  value: string;
  icon: Parameters<typeof EyIcon>[0]["name"];
  color: "primary" | "gold" | "danger";
  hint?: string;
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    gold: "bg-gold-soft text-gold",
    danger: "bg-danger-soft text-danger",
  } as const;
  const GLOW = {
    primary: "bg-primary/10",
    gold: "bg-gold/10",
    danger: "bg-danger/10",
  } as const;
  return (
    <article className="bg-card border-line shadow-card relative overflow-hidden rounded-2xl border p-5">
      <span
        className={`pointer-events-none absolute -top-8 -right-8 size-[100px] rounded-full blur-md ${GLOW[color]}`}
        aria-hidden="true"
      />
      <header className="relative flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <EyIcon name={icon} size={14} />
        </span>
      </header>
      <p className="tabular text-foreground num relative mt-3 text-[20px] leading-tight">
        {value}
      </p>
      {hint ? (
        <p className="text-text-dim num border-line relative mt-3 border-t pt-3 text-[11px]">
          {hint}
        </p>
      ) : (
        <div className="relative mt-3 h-[24px]" />
      )}
    </article>
  );
}
