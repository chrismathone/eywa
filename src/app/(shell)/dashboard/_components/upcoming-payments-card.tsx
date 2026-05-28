import Link from "next/link";
import { Wallet } from "lucide-react";
import type { UpcomingPayment } from "@/features/dashboard/server/queries";

const KRW = new Intl.NumberFormat("ko-KR");

export function UpcomingPaymentsCard({ items }: { items: UpcomingPayment[] }) {
  const total = items.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="bg-card border-border rounded-md border">
      <header className="border-border flex items-center justify-between border-b px-5 py-3">
        <div className="inline-flex items-center gap-2">
          <Wallet className="text-chart-3 size-4" />
          <h2 className="text-foreground text-sm font-semibold">이번 주 결제 예정</h2>
        </div>
        <p className="text-muted-foreground num text-xs">
          {items.length}건 · {KRW.format(total)}원
        </p>
      </header>
      {items.length === 0 ? (
        <p className="text-muted-foreground px-5 py-8 text-center text-sm">
          7일 내 결제 예정 없음
        </p>
      ) : (
        <ul className="divide-border max-h-72 divide-y overflow-auto">
          {items.slice(0, 8).map((r) => (
            <li key={r.studentId + r.dueDate} className="flex items-center justify-between px-5 py-2.5">
              <Link
                href={`/students/${r.studentId}?tab=billing`}
                className="text-foreground text-sm font-medium hover:underline"
              >
                {r.studentName}
              </Link>
              <div className="text-right">
                <p className="num text-foreground text-sm font-semibold">{KRW.format(r.amount)}원</p>
                <p className="text-muted-foreground num text-[10px]">
                  {r.dueDate} (D-{r.daysUntilDue})
                </p>
              </div>
            </li>
          ))}
          {items.length > 8 ? (
            <li className="text-muted-foreground px-5 py-2 text-center text-xs">
              외 {items.length - 8}건
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
