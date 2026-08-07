import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { landingPath } from "@/lib/auth/teacher-home";
import { AiEveningSection } from "./_sections/ai-evening";
import { ClosingSection } from "./_sections/closing";
import { FeaturesSection } from "./_sections/features";
import { FooterSection } from "./_sections/footer";
import { HeroSection } from "./_sections/hero";
import { MenuIndexSection } from "./_sections/menu-index";
import { OutcomesSection } from "./_sections/outcomes";
import { PricingSection } from "./_sections/pricing";
import { SignatureSection } from "./_sections/signature";
import { VoiceSection } from "./_sections/voice";
import { WorkspaceSection } from "./_sections/workspace";

export default async function LandingPage() {
  // 로그인 상태면 랜딩 대신 역할 홈으로 즉시 폴백(강사=원스크린 or ECS, 학생=/my-learning, 그 외=/dashboard) —
  // 로그인했는데 랜딩이 떠 '로그아웃된 느낌'을 주는 것 방지. requireAccess와 동일 매트릭스(getPermMatrix)로
  // 계산해, 권한 override로 홈이 '/'가 되는 엣지에선 리다이렉트를 건너뛰어 무한루프를 막는다.
  // 강사 홈은 담당 과목으로 갈린다(영어 전담=ECS, 2026-08-07) — landingPath 단일 소스.
  // ⚠️ getCurrentUser가 쿠키를 읽어 랜딩이 동적 렌더가 된다(로그인 폴백 대가). 무세션은 getClaims 로컬검증만(가벼움).
  const user = await getCurrentUser();
  if (user) {
    const home = await landingPath(user.systemRole, await getPermMatrix());
    if (home !== "/") redirect(home);
  }

  return (
    <>
      <HeroSection />
      <SignatureSection />
      <FeaturesSection />
      <WorkspaceSection />
      <AiEveningSection />
      <OutcomesSection />
      <MenuIndexSection />
      <VoiceSection />
      <PricingSection />
      <ClosingSection />
      <FooterSection />
    </>
  );
}
