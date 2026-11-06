import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { getActivePopupsOrThrow } from "@/features/notices/server/queries";
import { reportError } from "@/lib/observability/report-error";

/**
 * 지금 떠야 할 공지 팝업(GET) — 열려 있는 셸의 팝업 레이어가 60초마다·화면으로 돌아올 때 다시 묻는다(2026-10-14).
 *
 * 원장 *"팝업공지를 '강사' 대상으로 작성하면 시간대가 맞으면 그 즉시 강사 창에 팝업되나"* — 종전엔 셸 레이아웃이 그릴 때
 * 한 번만 받아서, 이미 열린 강사 화면에는 새로고침 전까지 안 떴다.
 *
 * 🔴 **서버 액션이 아니라 라우트**다 — 셸에서 저절로(주기) 도는 조회가 서버 액션이면 라우터 작업 큐와 경합해 Next 기본 오류
 *    화면이 뜬다([[#137]], 벨 `/api/notifications`와 같은 결 · 가드 `shell-autocall-server-actions.test.ts`).
 * 판정은 셸 레이아웃과 **같은 판정**(`getActivePopupsOrThrow` — 역할 대상·노출 기간·계정의 '다시 보지 않기')이라 두 길이
 * 다른 답을 낼 수 없다. 사람마다 다르므로 캐시 금지. 🔴 **빈 목록은 '정말 없음'일 때만** — 로그인을 못 읽었으면 401,
 * 조회 실패는 500이다(빈 목록으로 답하면 레이어가 카드를 내렸다가 다음 조회에 X로 닫은 카드까지 다시 띄운다). 레이어는
 * 200이 아니면 보던 목록을 그대로 둔다.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
    // 대상 역할 = '다른 강사 뷰'면 그 강사 역할, '다시 보지 않기' = 보는 사람 본인(셸 레이아웃과 같은 판정 — 대신 닫아 준 공지가
    // 그 강사 화면에서 사라지면 안 된다).
    const viewAs = await viewAsTeacher();
    const popups = await getActivePopupsOrThrow(viewAs?.systemRole ?? user.systemRole, user.tenantId, user.id);
    return NextResponse.json({ popups }, { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.notice-popups.list" });
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
