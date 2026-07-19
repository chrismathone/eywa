import { EyIcon } from "@/components/icons/eywa-icons";
import { DAY_NUMBERS, ROI_FOOTNOTE, ROI_PAYOFF, ROI_STEPS } from "@/data/marketing";
import { CountUp } from "../_motion/count-up";
import { Reveal } from "../_motion/reveal";
import { Eyebrow } from "../_ui/eyebrow";
import { SectionShell } from "../_ui/section-shell";

/**
 * OutcomesSection — '효과' 한 섹션 (구 numbers + roi 통합).
 * ① 하루 끝에 저절로 채워지는 운영 숫자 밴드 → ② 괘선으로 가른 하위 블록 '되찾는 시간' ROI 사다리.
 * nav '효과' 앵커 유지를 위해 id는 "roi" 그대로.
 */
export function OutcomesSection() {
  return (
    <SectionShell id="roi" pad="lg">
      {/* ① 채워지는 숫자 */}
      <div className="max-w-[44rem]">
        <Reveal variant="up">
          <Eyebrow time="22:00" label="효과" />
        </Reveal>
        <Reveal variant="clip" delay={60}>
          <h2 className="text-ink mt-4 text-[clamp(1.8rem,3.6vw,2.8rem)] leading-[1.2] font-extrabold tracking-[-0.035em]">
            원장님이 채우지 않아도,
            <br />
            숫자는 <span className="text-primary">채워집니다.</span>
          </h2>
        </Reveal>
        <Reveal variant="up" delay={120}>
          <p className="text-text-dim mt-5 max-w-[34rem] text-[16px] leading-[1.75]">
            하루가 끝날 무렵, 출석률·수납률·상담 완료는 이미 거기에 있습니다. 엑셀도, 단톡방도, 수기 장부도 아닌 —
            그냥, 실제 운영의 결과로.
          </p>
        </Reveal>
      </div>

      <Reveal variant="up" delay={140}>
        <div className="border-line bg-card divide-line mt-10 grid grid-cols-2 divide-x divide-y rounded-[16px] border shadow-[0_1px_2px_rgba(11,16,13,0.04),0_16px_40px_-24px_rgba(11,16,13,0.14)] md:grid-cols-4 md:divide-y-0">
          {DAY_NUMBERS.map((n) => (
            <div key={n.label} className="relative px-6 py-7">
              {n.accent ? (
                <span className="ey-watermark right-3 bottom-2" aria-hidden="true">
                  <EyIcon name="chart" size={34} />
                </span>
              ) : null}
              <div className="flex items-center gap-1.5">
                <p className="text-text-faint font-mono text-[10px] font-bold tracking-[0.12em] uppercase">{n.label}</p>
                {!n.accent ? <EyIcon name="arrowUp" size={12} strokeWidth={2.6} className="text-primary" /> : null}
              </div>
              <p
                className={`num mt-2 text-[clamp(2.2rem,4vw,3.2rem)] leading-none font-extrabold tracking-[-0.035em] ${
                  n.accent ? "text-primary" : "text-ink"
                }`}
              >
                <CountUp value={n.value} decimals={n.decimals} suffix={n.suffix} duration={1300} />
              </p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* ② 되찾는 시간 — ROI 사다리 (괘선으로 가른 하위 블록) */}
      <div className="border-line mt-16 grid gap-10 border-t pt-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <div className="lg:pt-4">
          <Reveal variant="up">
            <Eyebrow label="되찾는 시간" tone="dim" />
          </Reveal>
          <Reveal variant="clip" delay={60}>
            <h3 className="text-ink mt-5 text-[clamp(1.8rem,3.8vw,3rem)] leading-[1.16] font-extrabold tracking-[-0.035em]">
              아낀 시간을,
              <br />
              끝까지 계산해봤습니다.
            </h3>
          </Reveal>
          <Reveal variant="up" delay={140}>
            <p className="text-text-dim mt-6 max-w-[26rem] text-[16px] leading-[1.8]">
              마케팅 문구가 아니라, 30인 학원 기준 실제 환산입니다. 주당 14시간이 1년이면 며칠이 되는지, 정직하게
              적었습니다.
            </p>
          </Reveal>
        </div>

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
                <div className="border-primary/40 border-l-2 pl-5 text-right">
                  <p className="num text-ink text-[clamp(2rem,3.6vw,2.9rem)] leading-none font-extrabold tracking-[-0.035em]">
                    <CountUp value={s.value} group={s.group} duration={1300} />
                  </p>
                  <p className="text-text-dim mt-1 font-mono text-[11px] tracking-[0.06em]">{s.unit}</p>
                </div>
              </div>
            ))}

            {/* 최종 환산 — 감정 통화 (파인 잉크 카드) */}
            <div className="ey-console border-[var(--pine-line)] mt-4 rounded-[16px] border px-6 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_56px_-28px_rgba(11,16,13,0.5)]">
              <p className="text-[var(--mint)] font-mono text-[11px] font-bold tracking-[0.14em] uppercase">
                결국, 돌려받는 것
              </p>
              <p className="text-[var(--pine-text)] mt-2 text-[clamp(2.2rem,4.4vw,3.4rem)] leading-[1.1] font-extrabold tracking-[-0.035em]">
                {ROI_PAYOFF}
              </p>
            </div>

            <p className="text-text-faint mt-4 font-mono text-[10.5px] leading-relaxed">{ROI_FOOTNOTE}</p>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
