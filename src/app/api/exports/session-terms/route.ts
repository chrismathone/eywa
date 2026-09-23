import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { currentPeriod } from "@/features/billing/calc";
import { getSessionTermsView } from "@/features/billing/session-terms/server/queries";
import { filterSessionTermRows } from "@/features/billing/session-terms/term-filter";
import { sessionBillingOff } from "@/features/billing/session-terms/server/module-gate";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

/**
 * 회차 확정 엑셀(감사 N2) — 회차 확정 면과 **같은 줄 집합**(filterSessionTermRows 한 벌). 게이트 = 면과 같은 billing +
 * 회차 정산 모듈(꺼진 학원은 면이 없으니 파일도 없다). 무거운 엑셀 빌더는 요청 때만 불러온다(B5).
 */
export async function GET(request: Request) {
  await requireAccess("billing");
  if (await sessionBillingOff()) return new NextResponse("이 지점은 회차 정산 기능을 사용하지 않습니다", { status: 404 });

  const url = new URL(request.url);
  const raw = url.searchParams.get("period") ?? "";
  const period = /^\d{4}-\d{2}$/.test(raw) ? raw : currentPeriod();
  const [view, settings] = await Promise.all([getSessionTermsView(period), getTenantSettings()]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const rows = view.rows.map((r) => ({ ...r, subjectLabel: subjects.labelOf(r.subject) }));
  const { filtered } = filterSessionTermRows(rows, {
    subject: url.searchParams.get("subject") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
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
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentFilename(`회차확정_${period}.xlsx`),
    },
  });
}
