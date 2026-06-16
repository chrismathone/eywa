import { EyIcon } from "@/components/icons/eywa-icons";
import { DAY_NUMBERS } from "@/data/marketing";
import { CountUp } from "../_motion/count-up";
import { Reveal } from "../_motion/reveal";
import { SectionShell } from "../_ui/section-shell";

export function DayNumbersSection() {
  return (
    <SectionShell id="numbers" tone="soft" bordered pad="tight">
      <div className="max-w-[42rem]">
        <Reveal variant="up">
          <h2 className="text-foreground text-[clamp(1.7rem,3.4vw,2.6rem)] leading-[1.25] font-extrabold tracking-[-0.02em]">
            원장님이 채우지 않아도,
            <br />
            숫자는 <span className="text-primary">채워집니다.</span>
          </h2>
        </Reveal>
        <Reveal variant="up" delay={80}>
          <p className="text-text-dim mt-5 max-w-[34rem] text-[16px] leading-[1.75]">
            하루가 끝날 무렵, 출석률·수납률·상담 완료는 이미 거기에 있습니다. 엑셀도, 단톡방도, 수기 장부도 아닌 —
            그냥, 실제 운영의 결과로.
          </p>
        </Reveal>
      </div>

      {/* 가로 밴드 — 카드 대신 세로 괘선으로만 구분 */}
      <Reveal variant="up" delay={140}>
        <div className="border-line bg-card divide-line mt-10 grid grid-cols-2 divide-x divide-y rounded-2xl border md:grid-cols-4 md:divide-y-0">
          {DAY_NUMBERS.map((n) => (
            <div key={n.label} className="relative px-6 py-7">
              {n.accent ? (
                <span className="ey-watermark right-3 bottom-2" aria-hidden="true">
                  <EyIcon name="leaf" size={34} />
                </span>
              ) : null}
              <div className="flex items-center gap-1.5">
                <p className="text-text-faint font-mono text-[10px] font-bold tracking-[0.12em] uppercase">
                  {n.label}
                </p>
                {!n.accent ? <EyIcon name="arrowUp" size={12} strokeWidth={2.6} className="text-primary" /> : null}
              </div>
              <p
                className={`num mt-2 text-[clamp(2.2rem,4vw,3.2rem)] leading-none font-extrabold tracking-[-0.03em] ${
                  n.accent ? "text-primary" : "text-foreground"
                }`}
              >
                <CountUp value={n.value} decimals={n.decimals} suffix={n.suffix} duration={1300} />
              </p>
            </div>
          ))}
        </div>
      </Reveal>
    </SectionShell>
  );
}
