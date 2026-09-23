import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { kstMonth } from "@/lib/date-kst";
import { getExpensesForMonth } from "@/features/billing/server/expense-queries";
import { filterExpensesForView, normalizeExpenseCategoryFilter } from "@/features/billing/expense-search";

/**
 * 지출 엑셀(감사 N2) — 수납관리 '지출' 면과 **같은 집합**(월 · 분류 · 검색어). 게이트 = 그 면과 같은 billing.
 * 무거운 엑셀 빌더는 요청 때만 불러온다(B5).
 */
export async function GET(request: Request) {
  await requireAccess("billing");
  const url = new URL(request.url);
  const raw = url.searchParams.get("period") ?? "";
  const period = /^\d{4}-\d{2}$/.test(raw) ? raw : kstMonth();
  const cat = normalizeExpenseCategoryFilter(url.searchParams.get("cat"));
  const q = (url.searchParams.get("q") ?? "").trim();

  const rows = filterExpensesForView(await getExpensesForMonth(period), cat, q);
  const { buildExpensesWorkbook } = await import("@/features/exports/expenses-excel");
  const wb = await buildExpensesWorkbook(rows, period);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // B1 — 한글 파일명은 attachmentFilename 경유(헤더에 비ASCII 직접 금지).
      "Content-Disposition": attachmentFilename(`지출_${period}.xlsx`),
    },
  });
}
