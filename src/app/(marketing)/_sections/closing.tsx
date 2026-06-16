import { Reveal } from "../_motion/reveal";
import { CtaButton } from "../_ui/cta-button";
import { DrawUnderline } from "../_ui/draw-underline";
import { SectionShell } from "../_ui/section-shell";

export function ClosingSection() {
  return (
    <SectionShell id="closing" pad="lg" className="text-center">
      <span className="ey-mesh" aria-hidden="true" />

      <div className="relative mx-auto flex max-w-[44rem] flex-col items-center">
        <Reveal variant="up">
          <p className="text-primary font-mono text-[11px] font-bold tracking-[0.16em] uppercase">지금 시작</p>
        </Reveal>

        <Reveal variant="clip" delay={70}>
          <h2 className="text-foreground mt-5 text-[clamp(2.2rem,5vw,4rem)] leading-[1.12] font-extrabold tracking-[-0.03em]">
            더 쉬운 학원 운영,
            <br />
            <DrawUnderline tone="gold">지금 무료로</DrawUnderline> 시작하세요.
          </h2>
        </Reveal>

        <Reveal variant="up" delay={170}>
          <p className="text-text-dim mt-7 max-w-[32rem] text-[17px] leading-[1.8]">
            베타 기간 동안 12개 메뉴 <span className="text-foreground font-semibold">전 기능 무료</span>.
            카드 등록도, 설치도 필요 없습니다. 1분이면 우리 학원 이름으로 시작합니다.
          </p>
        </Reveal>

        <Reveal variant="up" delay={260}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <CtaButton href="/login" size="lg">
              무료로 시작하기
            </CtaButton>
            <a
              href="#pricing"
              className="text-text-dim hover:text-foreground rounded-xl px-4 py-4 text-[15px] font-semibold transition-colors"
            >
              요금 먼저 보기
            </a>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
