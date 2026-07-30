import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { getInvoicesForPeriod } from "@/features/billing/server/queries";
import { getMakeeduSyncState } from "@/features/integrations/server/makeedu-sync";
import { isOverdue, isOutsideSyncWindow, isMissingFromMakeedu } from "@/features/billing/sync-window";
import { buildInvoicesWorkbook } from "@/features/exports/invoices-excel";

export async function GET(request: Request) {
  await requireAccess("billing");

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const overdueOnly = url.searchParams.get("overdue") === "1";
  const missingOnly = url.searchParams.get("missing") === "1";

  // ⚠️ 화면과 **같은 집합**을 내보낸다 — 판정은 billing/sync-window.ts 한 곳에서만 온다.
  //    (예전엔 기한 경과 판정이 여기 복제돼 있어 한쪽만 고치면 조용히 어긋났다.)
  const all = await getInvoicesForPeriod({ period, q, category });
  const today = kstToday();
  let invoices = overdueOnly ? all.filter((r) => isOverdue(r, today)) : all;
  if (missingOnly) {
    // 동기화 누락은 그 달이 동기화 창 안일 때만 의미가 있다(동결된 달은 전 행이 미갱신).
    const syncState = await getMakeeduSyncState("invoices");
    const outsideSyncWindow = isOutsideSyncWindow({ rows: all, syncedAt: syncState?.syncedAt });
    invoices = invoices.filter((r) =>
      isMissingFromMakeedu({ row: r, syncedAt: syncState?.syncedAt, outsideSyncWindow }),
    );
  }
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
