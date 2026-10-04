import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { getVideoDriveSetting } from "@/features/video-submit/server/drive-settings";
import { readVideoOAuthConfig, videoOAuthCookie } from "@/features/video-submit/server/oauth/config";
import { videoOAuthDoneResponse } from "@/features/video-submit/server/oauth/done-page";
import { buildGoogleAuthUrl, newVideoOAuthAttempt } from "@/features/video-submit/server/oauth/google-flow";

/**
 * 숙제영상 드라이브 — **Google 계정 연결 시작**. 학원 설정 화면의 버튼이 새 탭으로 이 주소에 POST한다
 * (창 모드의 iframe 안에서는 Google 화면이 열리지 않는다).
 *
 * 🔴 지점·사용자는 **로그인한 계정에서만** 정한다 — 화면이 보낸 지점·계정 값은 읽지 않는다.
 * 🔴 같은 출처의 POST만 받는다(다른 사이트가 이 계정으로 연결을 시작시키지 못하게) + 정식 주소에서만(쿠키가 돌아오는 주소에 있어야 한다).
 * 🔴 로그인이 없으면 로그인 화면으로 넘기지 않는다 — 결과 화면에서 끝낸다.
 * 한 번의 로그인에 쓰는 난수: state(주소로 오간다) · PKCE 검증값(**httpOnly 쿠키에만**). DB에는 둘의 해시만 간다.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_SECONDS = 600;

export async function POST(request: Request) {
  const config = readVideoOAuthConfig();
  if (!config) return videoOAuthDoneResponse("unavailable", 503);
  const site = request.headers.get("sec-fetch-site");
  const host = (request.headers.get("host") ?? new URL(request.url).host).toLowerCase();
  if (request.headers.get("origin") !== config.origin || host !== config.host || (site !== null && site !== "same-origin"))
    return videoOAuthDoneResponse("origin", 403);

  const user = await getCurrentUser();
  if (!user) return videoOAuthDoneResponse("session", 401);
  if (!(await canWriteTenant(user.systemRole, "integration_settings")) || !classnoteModuleOn(await getTenantSettings()))
    return videoOAuthDoneResponse("forbidden", 403);

  const form = await request.formData().catch(() => null);
  const intent = form?.get("intent");
  const version = String(form?.get("version") ?? "").trim();
  if ((intent !== "reconnect" && intent !== "switch") || (version && !UUID_RE.test(version))) return videoOAuthDoneResponse("failed", 400);

  const db = createAdminClient();
  const attempt = newVideoOAuthAttempt();
  let loginHint: string | null = null;
  try {
    // '다시 연결'은 지금 계정으로 로그인하도록 이끈다(다른 계정으로 로그인해도 돌아와서 거절한다).
    if (intent === "reconnect") loginHint = (await getVideoDriveSetting(user.tenantId, db)).accountEmail;
    const created = await db.rpc("create_homework_video_drive_oauth_attempt", {
      p_tenant: user.tenantId, p_user: user.id, p_state_hash: attempt.stateHash, p_challenge: attempt.challenge,
      p_expected_version: version || null, p_oauth_client_id: config.clientId, p_intent: intent,
    });
    if (created.error) {
      console.error(JSON.stringify({ scope: "videoDrive.oauth.start", code: created.error.code }));
      // 설정이 그사이 바뀌었거나(다른 화면) '다시 연결'할 계정이 없다 — 화면을 새로고침해 다시 시작하게 한다.
      return videoOAuthDoneResponse(created.error.code === "P0001" ? "stale" : "failed", created.error.code === "P0001" ? 409 : 500);
    }
  } catch {
    console.error(JSON.stringify({ scope: "videoDrive.oauth.start", kind: "lookup" }));
    return videoOAuthDoneResponse("failed", 500);
  }

  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: buildGoogleAuthUrl({ config, state: attempt.state, challenge: attempt.challenge, loginHint }),
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    },
  });
  const cookie = videoOAuthCookie(config);
  response.cookies.set(cookie.name, attempt.verifier, { httpOnly: true, secure: cookie.secure, sameSite: "lax", path: cookie.path, maxAge: ATTEMPT_SECONDS });
  return response;
}
