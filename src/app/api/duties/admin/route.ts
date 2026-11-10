import { NextResponse } from "next/server";
import { kstToday } from "@/lib/date-kst";
import { getDutyAdminViewer } from "@/features/duties/server/admin-gate";
import { loadDutyAdmin } from "@/features/duties/server/admin";
import { adminRange, parseAdminPeriod, periodsOf } from "@/features/duties/view-admin";
import { reportError } from "@/lib/observability/report-error";
import { flushDuties } from "@/features/duties/server/live-sync";

/**
 * 업무 완성도 관리자 화면 재료(GET) — 기간을 바꿀 때와 **보일 때 60초마다** 다시 받는다(강사 홈 '내 업무'와 같은 결 · 셸 자동 호출은 서버 액션 금지 #137).
 * 문 = 페이지와 같은 권한 키(`duties`) + 과목 범위. 사람마다 다른 응답이라 캐시 금지.
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const today = kstToday();
  const period = parseAdminPeriod(new URL(request.url).searchParams.get("period"), today);
  try {
    const viewer = await getDutyAdminViewer();
    if (!viewer) return NextResponse.json({ error: "권한이 없습니다" }, { status: 403, headers: NO_STORE });
    await flushDuties(viewer.user.tenantId); // 방금 저장한 것을 먼저 장부에 맞춘다(s2_0051)
    const range = adminRange(period, today);
    const data = await loadDutyAdmin(viewer.user.tenantId, range.from, range.to, viewer.scope, periodsOf(period));
    return NextResponse.json({ period, today, now: new Date().toISOString(), range, data }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.duties.admin" });
    return NextResponse.json({ error: "업무 완성도를 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
