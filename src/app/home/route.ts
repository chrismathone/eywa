import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";

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
 * 세션이 없으면 `/login`으로 — 보호된 페이지와 같은 취급이라 새로 만드는 실패 모드가 없다.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const home = await landingPath(user.systemRole, await getPermMatrix());
  // landingPath가 "/"를 돌려주는 엣지(권한 override로 대시보드가 막힌 역할)에선 랜딩으로 — 루프 없음.
  redirect(home);
}
