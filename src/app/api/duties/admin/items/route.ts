import { NextResponse } from "next/server";
import { kstToday } from "@/lib/date-kst";
import { getDutyAdminViewer } from "@/features/duties/server/admin-gate";
import { loadDutyCellItems } from "@/features/duties/server/cell-items";
import { DUTY_KIND_KEYS } from "@/features/duties/kinds";
import { adminRange, parseAdminPeriod, periodsOf } from "@/features/duties/view-admin";
import { reportError } from "@/lib/observability/report-error";

/**
 * 학생 표의 칸을 눌렀을 때(GET) — 그 칸이 센 의무들과 실제 기록(완료 시각 · 바로가기). 문·과목 범위는 `/api/duties/admin`과 같다. 주소의 값은 믿지 않는다.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null) => (v && UUID.test(v) ? v : null);

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const period = parseAdminPeriod(q.get("period"));
  const studentId = uuidOrNull(q.get("student"));
  if (!studentId) return NextResponse.json({ error: "학생을 알 수 없습니다" }, { status: 400, headers: NO_STORE });
  const kindRaw = q.get("kind");
  const subjectRaw = q.get("subject");
  try {
    const viewer = await getDutyAdminViewer();
    if (!viewer) return NextResponse.json({ error: "권한이 없습니다" }, { status: 403, headers: NO_STORE });
    const range = adminRange(period, kstToday());
    const items = await loadDutyCellItems(viewer.user.tenantId, range.from, range.to, viewer.scope, periodsOf(period), {
      studentId, kind: kindRaw && (DUTY_KIND_KEYS as readonly string[]).includes(kindRaw) ? kindRaw : null,
      classId: uuidOrNull(q.get("class")), classNone: q.get("class") === "none", owner: uuidOrNull(q.get("owner")), ownerNone: q.get("owner") === "none",
      subject: subjectRaw && subjectRaw !== "none" && /^[a-z0-9_]{1,40}$/.test(subjectRaw) ? subjectRaw : null, subjectNone: subjectRaw === "none",
    });
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.duties.admin.items" });
    return NextResponse.json({ error: "업무 목록을 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
