import { FLOW_NODES } from "@/data/marketing";
import { CountUp } from "../_motion/count-up";
import { Reveal } from "../_motion/reveal";
import { SectionShell } from "../_ui/section-shell";

const ENDPOINT_X = [100, 300, 500, 700];
const STROKE: Record<string, string> = {
  rose: "var(--rose)",
  blue: "var(--blue)",
  primary: "var(--primary)",
  gold: "var(--gold)",
};
const CARD_ACCENT: Record<string, string> = {
  rose: "text-rose",
  blue: "text-blue",
  primary: "text-primary",
  gold: "text-gold",
};
const CARD_BAR: Record<string, string> = {
  rose: "bg-rose",
  blue: "bg-blue",
  primary: "bg-primary",
  gold: "bg-gold",
};

export function SignatureSection() {
  return (
    <SectionShell id="signature" tone="soft" bordered pad="lg">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[42rem]">
          <Reveal variant="up">
            <p className="text-primary font-mono text-[11px] font-bold tracking-[0.16em] uppercase">자동 연동</p>
          </Reveal>
          <Reveal variant="clip" delay={60}>
            <h2 className="text-foreground mt-4 text-[clamp(1.9rem,4vw,3.1rem)] leading-[1.2] font-extrabold tracking-[-0.025em]">
              출석 체크 한 번이면,
              <br />
              <span className="text-primary">네 곳이 자동으로.</span>
            </h2>
          </Reveal>
        </div>
        <Reveal variant="up" delay={120}>
          <p className="text-text-dim max-w-[24rem] text-[16px] leading-[1.75]">
            학생이 등원해 체크되는 순간 — 학부모 알림, 강사 출석부, 원장 대시보드, 수강료 차감이{" "}
            <span className="text-foreground font-semibold">0.4초</span> 만에 동시에. 원장님이 따로 입력할 일이 없습니다.
          </p>
        </Reveal>
      </div>

      {/* 다이어그램 — Reveal 래퍼가 data-in을 박으면 라인이 그려지고 카드가 도착 */}
      <Reveal variant="fade" delay={80} threshold={0.3} className="mt-14">
        {/* 트리거 */}
        <div className="flex justify-center">
          <div className="bg-card border-line inline-flex items-center gap-2.5 rounded-full border px-4 py-2 shadow-[0_8px_24px_-12px_rgba(13,17,16,0.18)]">
            <span className="bg-primary-soft text-primary flex size-6 items-center justify-center rounded-md text-[11px] font-bold">
              강
            </span>
            <span className="text-foreground text-[13px] font-semibold">강OO 학생이 등원했습니다</span>
            <span className="text-text-faint font-mono text-[11px]">16:02</span>
          </div>
        </div>

        {/* 분기선 (데스크톱) — pathLength=100으로 반응형 정확 드로잉 */}
        <svg
          viewBox="0 0 800 64"
          className="mx-auto mt-2 hidden h-16 w-full max-w-[860px] lg:block"
          fill="none"
          aria-hidden="true"
        >
          {FLOW_NODES.map((n, i) => (
            <g key={n.actor}>
              <path
                d={`M 400 0 Q 400 34 ${ENDPOINT_X[i]} 34 L ${ENDPOINT_X[i]} 64`}
                className="ey-draw"
                pathLength={100}
                stroke={STROKE[n.color]}
                strokeWidth={1.5}
                strokeLinecap="round"
                style={{ transitionDelay: `${i * 120}ms` }}
              />
              <circle cx={ENDPOINT_X[i]} cy={64} r={3} fill={STROKE[n.color]} className="ey-arrive" style={{ transitionDelay: `${i * 120 + 360}ms` }} />
            </g>
          ))}
        </svg>

        {/* 결과 카드 4 */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW_NODES.map((n, i) => (
            <article
              key={n.actor}
              className="ey-arrive bg-card border-line relative overflow-hidden rounded-xl border p-4"
              style={{ transitionDelay: `${i * 120 + 280}ms` }}
            >
              <span className={`absolute inset-x-0 top-0 h-[3px] ${CARD_BAR[n.color]}`} aria-hidden="true" />
              <div className="flex items-center justify-between">
                <p className={`font-mono text-[10px] font-bold tracking-[0.1em] uppercase ${CARD_ACCENT[n.color]}`}>
                  → {n.actor}
                </p>
                <span className={`font-mono text-[11px] font-bold ${CARD_ACCENT[n.color]}`}>{n.arrive}</span>
              </div>
              <p className="text-foreground mt-2.5 text-[14px] font-bold">{n.title}</p>
              <p className="text-text-dim mt-1 text-[12px] leading-relaxed">{n.detail}</p>
            </article>
          ))}
        </div>

        {/* 0.41초 — 동시성을 숫자로 못박음 */}
        <div className="mt-9 flex flex-col items-center">
          <p className="num text-foreground text-[clamp(3rem,7vw,5rem)] leading-none font-extrabold tracking-[-0.04em]">
            <CountUp value={0.4} decimals={1} duration={1100} />
            <span className="text-primary ey-serif text-[0.5em] align-baseline">s</span>
          </p>
          <p className="text-text-faint mt-3 font-mono text-[11px] tracking-[0.14em] uppercase">
            4 events · 1 action · 0 입력
          </p>
        </div>
      </Reveal>
    </SectionShell>
  );
}
