import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { getInvoicesForPeriod } from "@/features/billing/server/queries";
import { buildInvoicesWorkbook } from "@/features/exports/invoices-excel";

export async function GET(request: Request) {
  await requireAccess("billing");

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;

  const invoices = await getInvoicesForPeriod({ period, q, category });
  const periodLabel = period ?? new Date().toISOString().slice(0, 7);
  const wb = await buildInvoicesWorkbook(invoices, periodLabel);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="수납_${periodLabel}.xlsx"`,
    },
  });
}
