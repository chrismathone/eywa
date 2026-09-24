import { redirect } from "next/navigation";
import { after, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCurrentSuperAdmin } from "@/lib/auth/super-admin";
import { isAdminAuthEmail } from "@/lib/auth/admin-login";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";
import { safeLoginNext } from "@/lib/auth/login-next";
import { pickClientIp, recordLoginEvent } from "@/features/audit/server/login-log";
import { createClient } from "@/lib/supabase/server";

const FRESH_LOGIN_SEC = 120;

/** 세션의 인증 시각(JWT `amr[].timestamp`, 초)이 방금인지 — 판정 재료가 없으면 기록하지 않는다(보수적). */
async function signedInJustNow(): Promise<boolean> {
  try {
    const { data } = await (await createClient()).auth.getClaims();
    const amr = (data?.claims as { amr?: { timestamp?: number }[] } | undefined)?.amr ?? [];
    const latest = Math.max(0, ...amr.map((a) => Number(a?.timestamp) || 0));
    return latest > 0 && Date.now() / 1000 - latest <= FRESH_LOGIN_SEC;
  } catch {
    return false;
  }
}

/**
 * `/home` — **역할·과목에 맞는 홈으로 보내주는 서버측 리다이렉터**. 화면을 그리지 않는다(라우트 핸들러).
 *
 * 🔴 **왜 이게 필요한가 (2026-08-07 실측 버그)**: 로그인 착지 지점은 담당 과목(DB)으로 갈리는데
 * (영어 전담=`/ecs`), 로그인 폼은 클라라 그걸 모른다. 처음엔 로그인 직후 **서버 액션**에 물어봤는데,
 * 그 요청엔 **세션 쿠키가 아직 안 실릴 때가 있다** — `getClaims()`가 빈손으로 돌아와 역할 기반 폴백
 * (`/onescreen`)으로 떨어졌고, 같은 코드가 어떤 때는 `/ecs`로 어떤 때는 `/onescreen`으로 가는
 * **경합**이 됐다(실측: 13:47 성공 / 14:36 폴백).
 *
 * 🔑 고친 방식 = **묻는 시점을 뒤로 미룬다**. 로그인 폼은 목적지를 정하지 않고 여기로 **풀 문서 이동**만
 * 하고, 서버가 그 요청에서 세션을 읽어 착지 지점을 확정한다. 문서 요청 시점엔 쿠키가 이미 실려 있다
 * (같은 타임라인에서 `/onescreen` 문서 요청은 세션을 정상 인식했다). 프록시가 이 경로도 매칭해
 * `updateSession`으로 쿠키를 먼저 정규화하므로 판정이 한 번 더 안정된다.
 *
 * 🔑 **로그인 기록도 여기서**(2026-09-23 전수 점검 M1) — 로그인 폼이 브라우저에서 직접 로그인해서, 기록을
 * 남기던 서버 액션(signIn)은 아무도 안 불렀고 login_events가 한 줄도 안 쌓였다. 폼이 `?login=1`을 붙여
 * 오면 응답 뒤(`after`)에 기록한다 — 로그인 흐름을 막지 않는다. 안전한 `next`가 있으면 그리로 보낸다.
 *
 * 세션이 없으면 `/login`으로 — 보호된 페이지와 같은 취급이라 새로 만드는 실패 모드가 없다.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  // 지점 소속 없이 만든 SaaS 관리자 계정은 public.users 행이 없다.
  // 기존 지점 사용자는 아래의 역할/과목 착지 경로를 그대로 쓴다.
  if (!user) {
    const sa = await getCurrentSuperAdmin();
    if (!sa) redirect("/login");
    redirect(isAdminAuthEmail(sa.email) ? "/admin" : "/super-admin");
  }
  if (isAdminAuthEmail(user.email) && (await getCurrentSuperAdmin())) redirect("/admin");
  const params = request.nextUrl.searchParams;
  // 🔴 `?login=1`만으로 기록하지 않는다(적대적 리뷰) — 새로고침·북마크·남이 보낸 링크마다 로그인 기록이 한 줄씩
  //    쌓여 감사 기록이 흐려진다. JWT의 `amr` 로그인 시각이 **방금(2분 이내)**일 때만 진짜 로그인으로 본다.
  if (params.get("login") === "1" && (await signedInJustNow())) {
    // 신원·ua·ip는 요청 스코프에서 뽑아 넘긴다(after 콜백은 쿠키에 기대지 않는 admin 클라로 기록).
    const uid = user.id;
    const ua = request.headers.get("user-agent");
    const ip = pickClientIp(request.headers);
    after(() => recordLoginEvent(uid, ua, ip));
  }
  const next = safeLoginNext(params.get("next"));
  if (next) redirect(next);
  const home = await landingPath(user.systemRole, await getPermMatrix());
  // landingPath가 "/"를 돌려주는 엣지(권한 override로 대시보드가 막힌 역할)에선 랜딩으로 — 루프 없음.
  redirect(home);
}
