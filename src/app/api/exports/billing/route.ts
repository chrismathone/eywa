import { logExportDownload } from "@/features/exports/server/log-export";
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
    // 🔴 창 판정은 반드시 **그 달 전체**로 해야 한다 — 검색어(q)·분류로 좁힌 집합으로 판정하면,
    //    우연히 그 몇 건만 오래된 경우 살아있는 달이 '동결'로 뒤집혀 결과가 통째로 비어 버린다.
    //    화면은 필터 안 걸린 monthRows로 판정하므로, 여기서 좁힌 집합을 쓰면 "화면과 같은 집합"이 깨진다.
    const [syncState, periodRows] = await Promise.all([
      getMakeeduSyncState("invoices"),
      q || category ? getInvoicesForPeriod({ period }) : Promise.resolve(all),
    ]);
    const outsideSyncWindow = isOutsideSyncWindow({ rows: periodRows, syncedAt: syncState?.syncedAt });
    invoices = invoices.filter((r) =>
      isMissingFromMakeedu({ row: r, syncedAt: syncState?.syncedAt, outsideSyncWindow }),
    );
  }
  const periodLabel = period ?? kstMonth();
  // '기한 경과만'은 화면처럼 **미납 라인만**(청구서 안의 완납 라인은 빼고) 내보낸다.
  const wb = await buildInvoicesWorkbook(invoices, periodLabel, { overdueOnly });
  const buf = await wb.xlsx.writeBuffer();
  await logExportDownload(request, "수납");
  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`수납_${periodLabel}.xlsx`),
    },
  });
}
