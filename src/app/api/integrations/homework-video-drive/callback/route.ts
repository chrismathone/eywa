import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { completeVideoDriveConnection } from "@/features/video-submit/server/oauth/connect";
import { readVideoOAuthConfig, videoOAuthCookie, type VideoOAuthConfig } from "@/features/video-submit/server/oauth/config";
import { videoOAuthDonePath, videoOAuthDoneResponse, type VideoOAuthDoneStatus } from "@/features/video-submit/server/oauth/done-page";
import { OAUTH_STATE_RE, OAUTH_VERIFIER_RE, pkceChallenge, sha256Hex } from "@/features/video-submit/server/oauth/google-flow";

/**
 * 숙제영상 드라이브 — **Google 로그인에서 돌아오는 주소**(Google 콘솔에 등록한 고정 주소).
 *
 * 순서: 쿠키(검증값)·state 모양 → **로그인한 사용자**(시작한 그 사람·그 지점이어야 한다) → 권한·기능 다시 확인 →
 *       시도를 **한 번만** 소비(지점·사용자·state·검증값이 모두 맞을 때만) → 그 다음에야 Google에 코드를 낸다.
 * 🔴 로그인이 풀렸으면 로그인 화면으로 넘기지 않는다 — 이 주소(코드가 든)가 `next=`에 실려 다니지 않게 결과 화면에서 끝낸다.
 * 🔴 끝나면 **깨끗한 주소로 옮긴다**(303) — 코드·state가 주소창·방문 기록·Referer에 남지 않게. 쿠키는 성공·실패와 무관하게 지운다.
 * 🔴 실패는 지금 설정을 건드리지 않는다. 로그에는 단계 이름만 남긴다(코드·state·토큰·계정 없음).
 */
export const dynamic = "force-dynamic";

const CODE_RE = /^[A-Za-z0-9\-._~/%+=]{1,2048}$/;

function finish(config: VideoOAuthConfig, status: VideoOAuthDoneStatus): NextResponse {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: `${config.origin}${videoOAuthDonePath(status)}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  const cookie = videoOAuthCookie(config);
  response.cookies.set(cookie.name, "", { httpOnly: true, secure: cookie.secure, sameSite: "lax", path: cookie.path, maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const config = readVideoOAuthConfig();
  if (!config) return videoOAuthDoneResponse("unavailable", 503);
  const url = new URL(request.url);
  const host = (request.headers.get("host") ?? url.host).toLowerCase();
  if (host !== config.host) return finish(config, "origin");

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const verifier = request.cookies.get(videoOAuthCookie(config).name)?.value ?? "";
  if (!OAUTH_STATE_RE.test(state) || !OAUTH_VERIFIER_RE.test(verifier)) return finish(config, "expired");

  const user = await getCurrentUser();
  if (!user) return finish(config, "session");
  if (!(await canWriteTenant(user.systemRole, "integration_settings")) || !classnoteModuleOn(await getTenantSettings()))
    return finish(config, "forbidden");

  const db = createAdminClient();
  let attempt: { expectedVersion: string | null; oauthClientId: string; intent: "reconnect" | "switch" } | null;
  try {
    // 지점·사용자·state·검증값이 모두 맞는 쓰지 않은 시도만 소비된다 — 다른 사람·다른 브라우저의 요청은 시도를 건드리지 못한다.
    const consumed = await db.rpc("consume_homework_video_drive_oauth_attempt", {
      p_tenant: user.tenantId, p_user: user.id, p_state_hash: sha256Hex(state), p_challenge: pkceChallenge(verifier),
    });
    if (consumed.error) throw new Error("consume");
    attempt = consumed.data as typeof attempt;
  } catch {
    console.error(JSON.stringify({ scope: "videoDrive.oauth.callback", stage: "consume" }));
    return finish(config, "failed");
  }
  if (!attempt || (attempt.intent !== "reconnect" && attempt.intent !== "switch")) return finish(config, "expired");
  if (url.searchParams.get("error")) return finish(config, url.searchParams.get("error") === "access_denied" ? "denied" : "failed");
  // 시작할 때의 앱과 지금 앱이 다르면(그사이 env가 바뀌었다) 코드를 내지 않는다.
  if (attempt.oauthClientId !== config.clientId || !CODE_RE.test(code)) return finish(config, "failed");

  const status = await completeVideoDriveConnection({
    db, config, tenantId: user.tenantId, code, verifier, intent: attempt.intent, expectedVersion: attempt.expectedVersion ?? null,
  });
  return finish(config, status);
}
