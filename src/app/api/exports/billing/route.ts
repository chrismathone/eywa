import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { getInvoicesForPeriod } from "@/features/billing/server/queries";
import { buildInvoicesWorkbook } from "@/features/exports/invoices-excel";

export async function GET(request: Request) {
  await requireAccess("billing");

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const overdueOnly = url.searchParams.get("overdue") === "1";

  const all = await getInvoicesForPeriod({ period, q, category });
  // 화면의 '기한 경과만' 필터와 같은 집합을 내보낸다(billing-content.tsx isOverdue와 동일 판정).
  const today = kstToday();
  const invoices = overdueOnly
    ? all.filter(
        (r) => (r.status === "unpaid" || r.status === "partial") && r.dueDate !== null && r.dueDate < today,
      )
    : all;
  const periodLabel = period ?? kstMonth();
  const wb = await buildInvoicesWorkbook(invoices, periodLabel);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`수납_${periodLabel}.xlsx`),
    },
  });
}
