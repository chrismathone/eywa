import { NextResponse } from "next/server";
import { getMyNotifications } from "@/features/notifications/server/queries";
import { reportError } from "@/lib/observability/report-error";

/**
 * 벨 목록 조회(GET) — 알림 벨이 마운트·이동·포커스·60초 폴링에서 부른다(2026-10-01, gotchas #137).
 *
 * 🔴 **왜 서버 액션이 아니라 라우트인가**: 서버 액션은 Next 라우터의 작업 큐를 지난다. 셸이 마운트하자마자 액션을
 *    부르고 있는 사이에 페이지가 스트림 안에서 redirect(loading.tsx 아래 권한 거부 등)하면, 라우터가 React #310으로
 *    죽어 **영어 기본 오류 화면**("This page couldn't load")이 떴다. 일반 `fetch`는 큐를 안 지나 경합 자체가 없다
 *    (재현: 서버 액션 벨 23/100 · fetch 벨 0/70). 셸에서 저절로(마운트·주기) 도는 조회는 서버 액션으로 만들지 말 것.
 *
 * 인증·격리는 종전 액션과 **같은 함수**(`getMyNotifications` — 세션 사용자 확인 + RLS `recipient_id = auth.uid()`)라
 * 남의 알림·다른 지점 알림이 나올 길이 없다(#77). 로그인 전이면 종전 액션처럼 빈 목록.
 * ⚠️ `/api`는 proxy 매처 밖이다 — 세션 확인은 getCurrentUser(getClaims)가 한다(usage·palette 라우트와 같은 결).
 * 응답은 사람마다 다르므로 캐시 금지(`no-store`). 실패는 500 + 구조화 로그 — 벨은 조용히 지난 목록을 유지한다.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view") === "archived" ? "archived" : "active";
  // 목록 크기는 믿지 않는다 — getMyNotifications 안의 clampNotificationLimit이 20~100으로 맞춘다.
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  try {
    return NextResponse.json(await getMyNotifications(view, limit), { headers: NO_STORE });
  } catch (error) {
    reportError(error, { scope: "api.notifications.list", view });
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
