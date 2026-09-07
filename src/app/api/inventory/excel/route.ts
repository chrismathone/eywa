import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { getInventoryCategories } from "@/features/inventory/server/category-queries";
import { buildInventoryWorkbook } from "@/features/inventory/server/excel-build";
import { getAssets, getSupplies } from "@/features/inventory/server/queries";

/**
 * 재고관리 엑셀 서식 내려받기 — 현재 자산·소모품이 들어간 xlsx(자산 · 소모품 · 안내 시트).
 * 열람 권한(inventory)만 있으면 받는다(회계 readonly 포함 — 올리는 쪽은 쓰기 게이트가 막는다).
 * 🔴 파일명의 한글은 헤더에 직접 넣지 않는다(B1 — `attachmentFilename`).
 */
export async function GET() {
  await requireAccess("inventory");
  // 서로 독립 — 함께 받는다(B4). 표가 아직 없어도(0242a·0247a 미적용) 빈 서식은 내려준다
  // (분류는 내장 7종으로 폴백하므로 드롭다운·안내 문구가 비지 않는다).
  const [assets, supplies, categories] = await Promise.all([getAssets(), getSupplies(), getInventoryCategories()]);
  const wb = await buildInventoryWorkbook(assets.rows, supplies.rows, categories.rows);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`재고관리_${kstToday()}.xlsx`),
    },
  });
}
