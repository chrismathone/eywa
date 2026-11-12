import { logExportDownload } from "@/features/exports/server/log-export";
import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { currentPeriod } from "@/features/billing/calc";
import { getSessionTermsView } from "@/features/billing/session-terms/server/queries";
import { filterSessionTermRows, shareClassIdsOf } from "@/features/billing/session-terms/term-filter";
import { loadSeatShareSummary } from "@/features/attendance/server/seat-share-summary";
import { attendanceSalaryAdminOrNull } from "@/features/attendance/server/salary-rates";
import { parseMulti } from "@/lib/multi-value";
import { sessionBillingOff } from "@/features/billing/session-terms/server/module-gate";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

/**
 * 회차 확정 엑셀(감사 N2) — 회차 확정 면과 **같은 줄 집합**(filterSessionTermRows 한 벌). 게이트 = 면과 같은 billing +
 * 회차 정산 모듈(꺼진 학원은 면이 없으니 파일도 없다). 무거운 엑셀 빌더는 요청 때만 불러온다(B5).
 */
export async function GET(request: Request) {
  await requireAccess("billing");
  if (await sessionBillingOff()) return new NextResponse("찾을 수 없습니다", { status: 404 });

  const url = new URL(request.url);
  const raw = url.searchParams.get("period") ?? "";
  const period = /^\d{4}-\d{2}$/.test(raw) ? raw : currentPeriod();
  // '몫 조정한 반' 보기 필터는 화면과 같은 재료(자리 몫 줄 조회)로 거른다 — 그 필터가 켜진 주소일 때만 읽는다(B4 · 평소 왕복 불변).
  const only = url.searchParams.get("only") ?? undefined;
  const [view, settings, seatShare] = await Promise.all([
    getSessionTermsView(period),
    getTenantSettings(),
    parseMulti(only).includes("share") ? loadSeatShareSummary(period) : null,
  ]);
  // 🔴 '몫 조정한 반'으로 걸러 달라는 요청인데 재료를 못 읽었으면 파일을 내주지 않는다 — 걸러지지 않은 전체 줄이 조용히 실린다
  //    (화면은 드롭다운이 '전체'로 돌아가 눈에 띄지만 파일에는 표시가 없다 · 적대 리뷰 2026-10-07).
  //    그 필터를 쓸 수 없는 계정(화면에 항목 자체가 없다)이 주소를 지어 부른 것은 종전처럼 필터 없이 읽는다.
  if (parseMulti(only).includes("share") && !seatShare && (await attendanceSalaryAdminOrNull())) {
    return new NextResponse("자리 몫 조정을 읽지 못해 파일을 만들지 못했습니다. 이전 화면으로 돌아가 잠시 후 다시 눌러 주세요", { status: 503 });
  }
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const rows = view.rows.map((r) => ({ ...r, subjectLabel: subjects.labelOf(r.subject) }));
  const { filtered } = filterSessionTermRows(rows, {
    subject: url.searchParams.get("subject") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    only,
    shareClassIds: shareClassIdsOf(seatShare),
    allocation: url.searchParams.get("allocation") ?? undefined,
    confirmation: url.searchParams.get("confirmation") ?? undefined,
  });
  // 화면과 같은 순서 — 과목 → 반 → 학년 → 이름.
  filtered.sort(
    (a, b) =>
      a.subjectLabel.localeCompare(b.subjectLabel) ||
      (a.className ?? "").localeCompare(b.className ?? "", "ko") ||
      (a.studentGrade ?? "").localeCompare(b.studentGrade ?? "", "ko") ||
      a.studentName.localeCompare(b.studentName, "ko"),
  );

  const { buildSessionTermsWorkbook } = await import("@/features/exports/session-terms-excel");
  const wb = await buildSessionTermsWorkbook(filtered, period);
  const buf = await wb.xlsx.writeBuffer();
  await logExportDownload(request, "회차 확정");
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`회차확정_${period}.xlsx`),
    },
  });
}
