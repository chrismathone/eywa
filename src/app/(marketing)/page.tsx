import { CtaSection } from "./_sections/cta";
import { FlowSection } from "./_sections/flow";
import { FooterSection } from "./_sections/footer";
import { HeroSection } from "./_sections/hero";
import { LogoWallSection } from "./_sections/logowall";
import { ManifestoSection } from "./_sections/manifesto";
import { PricingSection } from "./_sections/pricing";
import { TestimonialsSection } from "./_sections/testimonials";

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <FlowSection />
      <LogoWallSection />
      <ManifestoSection />
      <TestimonialsSection />
      <PricingSection />
      <CtaSection />
      <FooterSection />
    </>
  );
}
