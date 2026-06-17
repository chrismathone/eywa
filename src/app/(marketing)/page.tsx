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

export default function LandingPage() {
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
