import { ROI_FOOTNOTE, ROI_PAYOFF, ROI_STEPS } from "@/data/marketing";
import { CountUp } from "../_motion/count-up";
import { Reveal } from "../_motion/reveal";
import { SectionShell } from "../_ui/section-shell";

export function RoiSection() {
  return (
    <SectionShell id="roi" pad="lg" containerClassName="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
      {/* 좌 — 선언 */}
      <div className="lg:pt-4">
        <Reveal variant="up">
          <p className="text-text-faint font-mono text-[11px] font-bold tracking-[0.16em] uppercase">
            되찾는 시간
          </p>
        </Reveal>
        <Reveal variant="clip" delay={60}>
          <h2 className="text-foreground mt-5 text-[clamp(2rem,4.2vw,3.4rem)] leading-[1.18] font-extrabold tracking-[-0.025em]">
            아낀 시간을,
            <br />
            끝까지 계산해봤습니다.
          </h2>
        </Reveal>
        <Reveal variant="up" delay={140}>
          <p className="text-text-dim mt-6 max-w-[26rem] text-[16px] leading-[1.8]">
            마케팅 문구가 아니라, 30인 학원 기준 실제 환산입니다. 주당 14시간이 1년이면 며칠이 되는지,
            정직하게 적었습니다.
          </p>
        </Reveal>
      </div>

      {/* 우 — 계산 사다리 (회계장부 열) */}
      <Reveal variant="up" delay={120}>
        <div>
          {ROI_STEPS.map((s) => (
            <div
              key={s.step}
              className="border-line grid grid-cols-[1fr_auto] items-baseline gap-5 border-t py-6 first:border-t-0"
            >
              <div>
                <span className="text-text-faint font-mono text-[11px] font-bold tracking-[0.1em]">{s.step}</span>
                <p className="text-foreground mt-1.5 text-[15px] font-medium">{s.equation}</p>
                {s.note ? <p className="text-text-faint mt-0.5 text-[12px]">{s.note}</p> : null}
              </div>
              <div className="border-gold/35 border-l-2 pl-5 text-right">
                <p className="num text-foreground text-[clamp(2rem,3.6vw,2.9rem)] leading-none font-extrabold tracking-[-0.03em]">
                  <CountUp value={s.value} group={s.group} duration={1300} />
                </p>
                <p className="text-text-dim mt-1 font-mono text-[11px] tracking-[0.06em]">{s.unit}</p>
              </div>
            </div>
          ))}

          {/* 최종 환산 — 감정 통화 */}
          <div className="border-gold/35 bg-gold-soft mt-3 rounded-2xl border px-6 py-7">
            <p className="text-gold font-mono text-[11px] font-bold tracking-[0.14em] uppercase">결국, 돌려받는 것</p>
            <p className="text-foreground mt-2 text-[clamp(2.2rem,4.4vw,3.4rem)] leading-[1.1] font-extrabold tracking-[-0.03em]">
              {ROI_PAYOFF}
            </p>
          </div>

          <p className="text-text-faint mt-4 font-mono text-[10.5px] leading-relaxed">{ROI_FOOTNOTE}</p>
        </div>
      </Reveal>
    </SectionShell>
  );
}
