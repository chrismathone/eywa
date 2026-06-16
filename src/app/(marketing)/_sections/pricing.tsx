import { EyIcon } from "@/components/icons/eywa-icons";
import { PRICING_PLANS } from "@/data/marketing";
import { Reveal } from "../_motion/reveal";
import { CtaButton } from "../_ui/cta-button";
import { DrawUnderline } from "../_ui/draw-underline";
import { SectionShell } from "../_ui/section-shell";

export function PricingSection() {
  return (
    <SectionShell id="pricing" tone="soft" bordered pad="lg" containerClassName="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
      {/* 좌 — 선언 */}
      <div className="lg:pt-2">
        <Reveal variant="up">
          <p className="text-text-faint font-mono text-[11px] font-bold tracking-[0.16em] uppercase">요금</p>
        </Reveal>
        <Reveal variant="clip" delay={60}>
          <h2 className="text-foreground mt-5 text-[clamp(2.1rem,4.6vw,3.6rem)] leading-[1.15] font-extrabold tracking-[-0.025em]">
            지금은, 베타.
            <br />
            그래서 <DrawUnderline tone="gold">무료</DrawUnderline>입니다.
            <span className="ey-cursor" aria-hidden="true" />
          </h2>
        </Reveal>
        <Reveal variant="up" delay={140}>
          <p className="text-text-dim mt-6 max-w-[26rem] text-[16px] leading-[1.8]">
            스타터·프로·엔터프라이즈 세 가지 요금을 준비하고 있지만, 베타 기간 동안은 모든 기능을 비용 없이.
            정식 출시 후에도, 베타 기간에 합류한 학원에는 그때의 요금을 그대로 지켜드립니다.
          </p>
        </Reveal>
        <Reveal variant="up" delay={220}>
          <CtaButton href="/login" size="md" className="mt-8">
            베타 신청하기
          </CtaButton>
        </Reveal>
      </div>

      {/* 우 — 플랜 세로 스택 (가격이 압박 안 되게) */}
      <Reveal variant="up" delay={120}>
        <div className="space-y-3">
          {PRICING_PLANS.map((plan) => (
            <article
              key={plan.name}
              className={`ey-lift bg-card relative rounded-2xl border p-6 ${
                plan.highlight ? "border-primary shadow-[0_16px_40px_-20px_rgba(26,95,60,0.3)]" : "border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-foreground text-[17px] font-extrabold">{plan.name}</h3>
                    {plan.highlight ? (
                      <span className="bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-[10px] font-extrabold">
                        추천
                      </span>
                    ) : null}
                  </div>
                  <p className="text-text-dim mt-1 text-[13px]">{plan.sub}</p>
                </div>
                <div className="text-right">
                  <p className="text-foreground text-[22px] font-extrabold">
                    무료
                    <span className="bg-gold-soft text-gold ml-1.5 rounded px-1.5 py-0.5 align-middle font-mono text-[9px] font-bold tracking-[0.08em]">
                      BETA
                    </span>
                  </p>
                  <p className="text-text-faint mt-0.5 font-mono text-[10px]">되찾는 {plan.roi}</p>
                </div>
              </div>

              <ul className="border-line mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-4">
                {plan.features.map((f) => (
                  <li key={f} className="text-text-dim flex items-center gap-1.5 text-[13px]">
                    <EyIcon name="check" size={13} className="text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Reveal>
    </SectionShell>
  );
}
