import { EyIcon } from "@/components/icons/aywa-icons";
import { Reveal } from "../_motion/reveal";
import { CtaButton } from "../_ui/cta-button";
import { ProductShowcase } from "../_ui/product-showcase";
import { SectionShell } from "../_ui/section-shell";

export function HeroSection() {
  return (
    <SectionShell
      id="hero"
      pad="hero"
      containerClassName="grid items-center gap-14 lg:grid-cols-[0.94fr_1.06fr] lg:gap-16"
    >
      <span className="ey-mesh" aria-hidden="true" />

      {/* 좌 — 구체적 가치 + CTA */}
      <div className="relative">
        <Reveal variant="up">
          <p className="border-line bg-card text-text-dim inline-flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-3 text-[12px] font-semibold shadow-[0_1px_2px_rgba(29,29,31,0.04)]">
            <span className="bg-primary size-1.5 animate-pulse rounded-full motion-reduce:animate-none" aria-hidden="true" />
            출결 · 수납 · 상담 · 학부모 알림 올인원
          </p>
        </Reveal>

        <Reveal variant="clip" delay={80}>
          <h1 className="text-ink mt-6 text-[clamp(2.5rem,5.3vw,4.7rem)] leading-[1.06] font-extrabold tracking-[-0.04em]">
            흩어진 학원 운영을
            <br />
            <span className="text-primary">한 화면으로</span> 모았습니다.
          </h1>
        </Reveal>

        <Reveal variant="up" delay={180}>
          <p className="text-text-dim mt-7 max-w-[31rem] text-[17px] leading-[1.75]">
            학생이 등원하면 학부모 알림·출석부·원장 화면·수강료가{" "}
            <span className="text-foreground font-semibold">동시에</span> 처리됩니다. 매일 수십 번 여는 화면이라,
            누구보다 빠르고 깔끔하게 만들었습니다.
          </p>
        </Reveal>

        <Reveal variant="up" delay={260}>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <CtaButton href="/login" size="md">
              무료로 시작하기
            </CtaButton>
            <a
              href="#signature"
              className="border-line bg-card text-foreground hover:border-line-strong inline-flex items-center gap-1.5 rounded-full border px-5 py-3.5 text-[14.5px] font-semibold transition-colors"
            >
              기능 둘러보기
              <EyIcon name="arrowDown" size={15} className="text-text-faint" />
            </a>
          </div>
        </Reveal>

        <Reveal variant="up" delay={340}>
          <p className="text-text-faint border-line mt-9 border-t pt-5 font-mono text-[11px] tracking-[0.12em] uppercase">
            BETA · 베타 기간 전 기능 무료 · 카드 등록 없음 · 1분 설치
          </p>
        </Reveal>
      </div>

      {/* 우 — 제품 쇼케이스 (주역) */}
      <Reveal variant="up" delay={220} className="relative lg:pl-4">
        <ProductShowcase />
      </Reveal>
    </SectionShell>
  );
}
