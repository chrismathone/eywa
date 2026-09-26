import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { CONNECTED_APPS } from "@/features/connected-apps/apps";
import { signSsoToken, usableSsoSecret } from "@/features/connected-apps/sso";

/**
 * 사이드바 '연결 앱 → 오늘의 수학'의 출발점 — 로그인한 사람의 자동 로그인 표를 붙여 오늘의 수학으로 보낸다(302).
 *
 * 원장 2026-09-26 — 표의 신원은 **eywa 사용자 id(`sub`)**. 받는 쪽은 그 id가 연결된 오늘의 수학 계정에만 로그인시키고,
 * 처음이면 오늘의 수학 비밀번호로 한 번 로그인해 연결한다(자동 가입 없음, 이메일은 표시용 — [`sso.ts`](@/features/connected-apps/sso.ts)).
 * - 비로그인 → eywa 로그인 화면.
 * - 학생 계정 → 표 없이 오늘의 수학 첫 화면(학생은 오늘의 수학 원장 계정과 연결할 일이 없다 — 연결 시도 자체를 안 연다).
 * - 이 지점이 꺼져 있으면(슈퍼관리자 스위치) → 운영실. 링크가 안 보이는 지점이 주소를 쳐도 표를 받지 못한다.
 * - `EYWA_SSO_SECRET`이 없거나 짧으면 → 표 없이 오늘의 수학 첫 화면(평소 로그인). 기능이 조용히 꺼질 뿐 막히지 않는다.
 * 🔴 표는 주소에 실리므로 캐시·리퍼러에 남기지 않는다(no-store · no-referrer). 수명은 60초(`sso.ts`).
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(req: Request) {
  const app = CONNECTED_APPS.find((a) => a.feature === "todays_math")!;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), { headers: HEADERS });
  if (!(await isFeatureOptedIn(user.tenantId, app.feature))) {
    return NextResponse.redirect(new URL("/dashboard", req.url), { headers: HEADERS });
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
