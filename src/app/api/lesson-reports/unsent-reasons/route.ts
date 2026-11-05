import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { loadUnsentReasonCards, UNSENT_REASON_MAX } from "@/features/report-admin/server/unsent-reasons";
import { reportError } from "@/lib/observability/report-error";

/**
 * 보고서 목록 '미발송' 칸 카드(GET) — 원장 2026-11-04 *"이런 미발송건에 대해서도 이유를 자세히 볼 수 있게 마우스오버 등으로"*.
 * 목록이 그려진 **뒤에** 그 페이지의 미발송 줄 id만 실어 부른다 — 목록 첫 페인트를 막지 않는다(B7).
 *
 * 게이트 = 목록 조회(`listReports`)와 같다(로그인 + 보고서 관리 읽기). 조회는 사용자 클라이언트(RLS — 그 지점 행만).
 * 🔴 저절로(목록이 바뀔 때) 도는 조회라 서버 액션이 아니라 GET 라우트 + fetch(gotchas #137 — 벨과 같은 결).
 * 사람마다 다른 응답이라 캐시 금지. 실패는 500 + 구조화 로그 — 화면은 카드 없이 '미발송'만 그대로 둔다.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  // 주소의 값은 믿지 않는다 — 보고서 id 모양·개수 상한.
  const raw = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim());
  const ids = [...new Set(raw.filter((id) => UUID.test(id)))].slice(0, UNSENT_REASON_MAX);
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ cards: {} }, { status: 401, headers: NO_STORE });
    if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) {
      return NextResponse.json({ cards: {} }, { status: 403, headers: NO_STORE });
    }
    return NextResponse.json({ cards: await loadUnsentReasonCards(user.tenantId, ids) }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.lesson-reports.unsent-reasons" });
    return NextResponse.json({ cards: {} }, { status: 500, headers: NO_STORE });
  }
}
