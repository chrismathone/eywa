import { Reveal } from "../_motion/reveal";
import { CtaButton } from "../_ui/cta-button";
import { DrawUnderline } from "../_ui/draw-underline";
import { Eyebrow } from "../_ui/eyebrow";
import { SectionShell } from "../_ui/section-shell";

export function ClosingSection() {
  return (
    <SectionShell id="closing" tone="dark" pad="lg" className="text-center">
      <div className="relative mx-auto flex max-w-[44rem] flex-col items-center">
        <Reveal variant="up">
          <Eyebrow time="내일 08:30" label="지금 시작" tone="azure" className="justify-center" />
        </Reveal>

        <Reveal variant="clip" delay={70}>
          <h2 className="text-[var(--deep-text)] mt-5 text-[clamp(2.2rem,5vw,4rem)] leading-[1.12] font-extrabold tracking-[-0.04em]">
            더 쉬운 학원 운영,
            <br />
            <DrawUnderline tone="azure">지금 무료로</DrawUnderline> 시작하세요.
          </h2>
        </Reveal>

        <Reveal variant="up" delay={170}>
          <p className="text-[var(--deep-dim)] mt-7 max-w-[32rem] text-[17px] leading-[1.8]">
            베타 기간 동안 12개 메뉴 <span className="text-[var(--deep-text)] font-semibold">전 기능 무료</span>.
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
              className="text-[var(--deep-dim)] hover:text-[var(--deep-text)] rounded-full px-4 py-4 text-[15px] font-semibold transition-colors"
            >
              요금 먼저 보기
            </a>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
