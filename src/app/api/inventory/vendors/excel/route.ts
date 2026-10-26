import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { getVendors } from "@/features/inventory/server/queries";
import { canViewVendorsNow } from "@/features/inventory/server/vendor-gate";
import { buildVendorWorkbook } from "@/features/inventory/server/vendor-excel-build";
import { VENDOR_DENIED_MSG } from "@/features/inventory/vendor-access";

/**
 * 업체리스트 엑셀 내려받기 — 지금 업체가 들어간 xlsx(업체리스트 · 안내 시트). 이 파일을 고쳐 다시 올리면 그대로 반영된다.
 * 🔴 게이트는 화면과 같다 — 재고관리 열람 **그리고** 업체리스트 지정([[#77]] — 탭만 감추면 주소로 연락처가 샌다).
 * 🔴 파일명의 한글은 헤더에 직접 넣지 않는다(B1 — `attachmentFilename`).
 */
export async function GET() {
  await requireAccess("inventory");
  if (!(await canViewVendorsNow())) return NextResponse.json({ error: VENDOR_DENIED_MSG }, { status: 403 });
  // 표가 아직 없어도(0448a 미적용) 빈 서식은 내려준다 — 업체를 처음 넣는 데 쓰는 파일이기도 하다.
  const vendors = await getVendors();
  const wb = await buildVendorWorkbook(vendors.rows);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`업체리스트_${kstToday()}.xlsx`),
    },
  });
}
