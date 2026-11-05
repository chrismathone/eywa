import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { CONNECTED_APPS } from "@/features/connected-apps/apps";
import { getMyConnectedApps } from "@/features/connected-apps/server/visible";
import { signSsoToken, usableSsoSecret } from "@/features/connected-apps/sso";
import { sourceBindingForTenant, sourceControl, syncErrorResponse } from "@/features/integrations/todays-math/sync-server";

/**
 * 사이드바 '연결 앱 → 오늘 수학'의 출발점 — 로그인한 사람의 자동 로그인 표를 붙여 오늘 수학으로 보낸다(302).
 *
 * 활성 v2 binding의 연동 대상은 서비스의 state/PKCE 시작 경로로 보낸다. 연동 대상이 아니면 대상 로그인 화면으로 보낸다.
 * binding 미설정 때는 기존 v1 연결을 유지한다. shadow는 대상 첫 화면으로 보내며, 관리 대상의 v1 우회는 대상에서 차단한다.
 * v1 표의 신원은 eywa 사용자 id(`sub`)이며 이메일만으로 계정을 연결하지 않는다.
 * - 비로그인 → eywa 로그인 화면.
 * - 이 사람에게 링크가 안 서면 → 그 사람의 홈(`/home`). 판정은 메뉴와 같은 `getMyConnectedApps` — 지점이 꺼져 있거나,
 *   학원 설정 '연결 앱 권한'에서 그 역할이 없음이거나(2026-11-05), 담당 과목이 영어뿐이면 주소를 쳐도 표를 받지 못한다.
 * - 학생 계정 → 표 없이 오늘 수학 첫 화면(학생은 오늘 수학 원장 계정과 연결할 일이 없다 — 연결 시도 자체를 안 연다).
 *   ⚠️ 지금은 학생 칸이 '없음'으로 고정이라(권한 표의 학생 열은 잠김) 위 줄에서 먼저 `/home`으로 간다 — 이 갈래는 방어로 남긴다.
 * - v1 `EYWA_SSO_SECRET`이 없거나 짧으면 → 표 없이 오늘 수학 첫 화면. v2 설정/제어 오류는 거절한다.
 * 코드와 v1 표는 캐시·리퍼러에 남기지 않는다(no-store · no-referrer). 수명은 60초.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(req: Request) {
  const app = CONNECTED_APPS.find((a) => a.feature === "todays_math")!;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), { headers: HEADERS });
  if (!(await getMyConnectedApps()).some((a) => a.feature === app.feature)) {
    return NextResponse.redirect(new URL("/home", req.url), { headers: HEADERS });
  }
  if (user.systemRole !== "student") {
    try {
      const binding = sourceBindingForTenant(user.tenantId);
      if (binding) {
        const control = await sourceControl(binding, user.id);
        if (control.mode === "active") {
          if (control.healthy && control.enabled && !control.users.some((entry) => entry.id === user.id && entry.eligible)) {
            return NextResponse.redirect(new URL("/login?eywa=not-linked", binding.targetBaseUrl), { headers: HEADERS });
          }
          // Target creates the browser's state/PKCE cookie before source authorization.
          const target = new URL("/api/sso/eywa/v2/start", binding.targetBaseUrl);
          target.searchParams.set("bindingId", binding.bindingId);
          return NextResponse.redirect(target, { headers: HEADERS });
        }
        return NextResponse.redirect(new URL(binding.targetBaseUrl), { headers: HEADERS });
      }
    } catch (error) { return syncErrorResponse(error); }
  }
  const secret = usableSsoSecret(process.env.EYWA_SSO_SECRET);
  if (!secret || user.systemRole === "student") return NextResponse.redirect(app.href, { headers: HEADERS });

  const token = signSsoToken(
    { aud: app.audience, sub: user.id, email: user.email, name: user.displayName, tenantId: user.tenantId },
    secret,
  );
  const target = new URL(app.ssoPath, app.href);
  target.searchParams.set("token", token);
  return NextResponse.redirect(target, { headers: HEADERS });
}
