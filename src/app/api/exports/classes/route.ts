import { NextResponse } from "next/server";
import { kstToday } from "@/lib/date-kst";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { getClassesPage } from "@/features/classes/server/queries";
import { parseClassKind, parseClassSort, parseClassStatus } from "@/features/classes/list-filters";
import { parseClassDays } from "@/features/classes/list-prefs";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { buildClassesWorkbook } from "@/features/exports/classes-excel";

/**
 * 수업목록 엑셀 내보내기(감사 N2) — **화면과 같은 집합**을 같은 조회(`getClassesPage`)로 뽑는다.
 *
 * 🔑 엑셀 API는 계정 보기 설정을 모른다 — 화면이 지금 걸린 값을 그대로 넘기고(`/classes` page `exportHref`),
 *    여기선 화면과 **같은 파서**로 다시 읽는다. 강사 스코프(내 반만)는 `getClassesPage`가 스스로 강제한다(#77).
 * 🔴 파일명은 한글이라 `attachmentFilename`(RFC 5987) 경유 — 헤더에 한글 직접 금지(B1).
 */
export async function GET(request: Request) {
  await requireAccess("classes");
  const url = new URL(request.url);
  const sp = url.searchParams;
  const filters = {
    kind: parseClassKind(sp.get("kind") ?? "all"),
    subject: sp.get("subject") ?? "all",
    teacherId: sp.get("teacher") ?? "all",
    days: parseClassDays(sp.get("days") ?? ""),
    q: sp.get("q") ?? "",
    sort: parseClassSort(sp.get("sort") ?? "name"),
    status: parseClassStatus(sp.get("status")),
  };

  const [{ rows }, settings] = await Promise.all([
    // 한 장에 전부 — 학원 단위 수업은 수백 개 수준이고, 조회가 이미 전건을 받아 메모리에서 나눈다.
    getClassesPage(filters, 1, 100_000),
    getTenantSettings(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const wb = await buildClassesWorkbook(rows, subjects.labelOf);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`수업목록_${kstToday()}.xlsx`),
    },
  });
}
