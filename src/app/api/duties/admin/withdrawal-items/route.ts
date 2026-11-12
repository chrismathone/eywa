import { NextResponse } from "next/server";
import { kstToday } from "@/lib/date-kst";
import { accessLevelTenant, readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isReadonlyTeacherView, viewAsTeacher } from "@/lib/auth/view-as";
import { clampDutyFrom } from "@/features/duties/server/admin";
import { getDutyAdminViewer } from "@/features/duties/server/admin-gate";
import { loadWithdrawalWriteItems } from "@/features/duties/server/withdrawal-write";
import { adminRange, parseAdminPeriod } from "@/features/duties/view-admin";
import { reportError } from "@/lib/observability/report-error";

/**
 * 퇴원보고서 작성(참고 열) 칸을 눌렀을 때(GET) — 그 선생님의 작성 차례 목록(s2_0067). 문 · 과목 범위는 `/api/duties/admin`과 같다.
 * 🔴 학생 이름이 나가는 목록이라 **퇴원보고서 메뉴 권한**도 본다 — 업무 완성도 권한만으로 누가 퇴원하는지 보이면 안 된다(칸의 숫자는 그대로 보인다).
 */
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const today = kstToday();
  const period = parseAdminPeriod(q.get("period"), today);
  const owner = q.get("owner");
  if (!owner || !UUID.test(owner)) return NextResponse.json({ error: "선생님을 알 수 없습니다" }, { status: 400, headers: NO_STORE });
  const subjectRaw = q.get("subject");
  try {
    const viewer = await getDutyAdminViewer();
    if (!viewer) return NextResponse.json({ error: "권한이 없습니다" }, { status: 403, headers: NO_STORE });
    // 퇴원보고서를 '담당'(자기 보고서)만 보는 사람은 남의 차례 목록(학생 이름)을 받지 않는다 — 평점 열과 같은 함정(리뷰 2026-11-11).
    //   읽기 강사뷰가 '담당'을 지운 경우도 담당으로 본다(`readonlyViewErasedScope`).
    //   강사뷰 대상을 확인하지 못한 요청은 거절한다(권한이 낮춰져 '담당'이 '읽기'로 보인다 — 재리뷰 2026-11-11) · '본인' = 강사뷰면 그 강사(#154).
    const range = adminRange(period, today);
    // 권한 판정과 시작일 맞춤은 서로 독립(B4) — 같이 읽는다.
    const [level, erased, ro, as, effective, from] = await Promise.all([accessLevelTenant(viewer.user.systemRole, "withdrawal_reports"), readonlyViewErasedScope("withdrawal_reports"), isReadonlyTeacherView(), viewAsTeacher(), getCurrentUser({ teacherView: true }), clampDutyFrom(viewer.user.tenantId, range.from)]);
    if (ro && !as) return NextResponse.json({ error: "강사뷰 대상을 확인하지 못했습니다 — 잠시 뒤 새로고침해 주세요" }, { status: 403, headers: NO_STORE });
    const whole = (level === "full" || level === "readonly") && !erased;
    if (level === "none" || (!whole && owner !== (viewer.scope.ownerId ?? effective?.id ?? viewer.user.id))) return NextResponse.json({ error: "퇴원보고서 열람 권한이 필요합니다" }, { status: 403, headers: NO_STORE });
    const items = await loadWithdrawalWriteItems(viewer.user.tenantId, from, range.to, viewer.scope, owner,
      subjectRaw && /^[a-z0-9_]{1,40}$/.test(subjectRaw) ? subjectRaw : null);
    return NextResponse.json({ items, now: new Date().toISOString() }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.duties.admin.withdrawal-items" });
    return NextResponse.json({ error: "퇴원보고서 목록을 불러오지 못했습니다" }, { status: 500, headers: NO_STORE });
  }
}
