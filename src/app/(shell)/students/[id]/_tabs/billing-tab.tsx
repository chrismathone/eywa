import { getStudentInvoices } from "@/features/students/server/queries";

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

export async function BillingTab({ studentId }: { studentId: string }) {
  const invoices = await getStudentInvoices(studentId);

  const totalBilled = invoices.reduce((s, r) => s + r.amountTotal, 0);
  const totalPaid = invoices.reduce((s, r) => s + r.amountPaid, 0);
  const totalDiscount = invoices.reduce((s, r) => s + r.amountDiscount, 0);
  const balance = totalBilled - totalPaid - totalDiscount;

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">수납 내역</h2>
        <p className="text-muted-foreground text-xs">
          청구 <span className="text-foreground num font-medium">{KRW.format(totalBilled)}</span>원
          · 수납{" "}
          <span className="text-chart-2 num font-medium">{KRW.format(totalPaid)}</span>원 · 잔액{" "}
          <span className={`num font-medium ${balance > 0 ? "text-chart-4" : "text-foreground"}`}>
            {KRW.format(balance)}
          </span>
          원
        </p>
      </header>

      {invoices.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">청구 내역이 없습니다</p>
      ) : (
        <div className="bg-card border-border overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-border bg-bg-soft/40 border-b">
              <tr>
                <th className="micro px-4 py-2 text-left">기간</th>
                <th className="micro px-4 py-2 text-right">청구</th>
                <th className="micro px-4 py-2 text-right">할인</th>
                <th className="micro px-4 py-2 text-right">수납</th>
                <th className="micro px-4 py-2 text-right">기한</th>
                <th className="micro px-4 py-2 text-center">상태</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {invoices.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/30">
                  <td className="px-4 py-2 text-xs num">{r.period}</td>
                  <td className="num px-4 py-2 text-right text-xs">{KRW.format(r.amountTotal)}</td>
                  <td className="num px-4 py-2 text-right text-xs text-muted-foreground">
                    {r.amountDiscount > 0 ? KRW.format(r.amountDiscount) : "—"}
                  </td>
                  <td className="num px-4 py-2 text-right text-xs">{KRW.format(r.amountPaid)}</td>
                  <td className="num text-muted-foreground px-4 py-2 text-right text-xs">
                    {r.dueDate ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                        STATUS_COLOR[r.status] ?? ""
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
