import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";
import { LandingClosing } from "./_scroll/closing";
import { FlagshipHero, FlagshipShowroom } from "./_scroll/flagship";
import { FlagshipCompare } from "./_scroll/flagship-compare";
import { LandingMotion } from "./_scroll/landing-motion";
import { MenuGrid } from "./_scroll/menu-grid";
import { SceneAssistant } from "./_scroll/scene-assistant";
import { SceneAttendance } from "./_scroll/scene-attendance";
import { SceneConsult } from "./_scroll/scene-consult";
import { SceneWindows } from "./_scroll/scene-windows";

/**
 * 공개 랜딩 = 애플식 긴 스크롤(원장 2026-09-22 *"스크롤 내려갈 때마다 뭔가 하나씩 등장"* · *"학원 매니지먼트 홈페이지답게"*).
 * 화면은 전부 서버가 그리고 연출은 `LandingMotion`이 클래스만 붙인다. 화면 속 이름·숫자는 모두 예시다.
 * 문구는 codex·Claude 두 갈래 + 웹검색 검증 + grok 검토를 거쳐 원장이 확인했다(*"멘트는 잘 가다듬어 진것 같아"*).
 * 되돌리는 방법 = docs/landing-rollback.md.
 */
export default async function LandingPage() {
  // 로그인 상태면 랜딩 대신 역할 홈으로(강사=원스크린 or ECS, 학생=/my-learning, 그 외=/dashboard) — landingPath 단일 소스.
  // 권한 override로 홈이 '/'가 되는 엣지에선 리다이렉트를 건너뛰어 무한루프를 막는다.
  const user = await getCurrentUser();
  if (user) {
    // 개인 예외까지 얹은 사용자 유효 매트릭스 — 페이지 게이트와 같은 판정이라 착지했다가 튕기지 않는다(gotchas #137).
    const home = await landingPath(user.systemRole, await getUserPermMatrix());
    if (home !== "/") redirect(home);
  }

  return (
    <>
      <FlagshipHero />
      <FlagshipShowroom />
      <SceneWindows />
      <SceneConsult />
      <SceneAssistant />
      <MenuGrid />
      <SceneAttendance />
      <FlagshipCompare />
      <LandingClosing />
      <LandingMotion />
    </>
  );
}
