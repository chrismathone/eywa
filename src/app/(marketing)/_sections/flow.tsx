import { EyIcon } from "@/components/icons/eywa-icons";
import { FLOW_OUTCOMES } from "@/data/marketing";

export function FlowSection() {
  return (
    <section id="flow" className="bg-bg-soft border-line border-y">
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-20 px-16 py-[120px] lg:grid-cols-[380px_1fr]">
        {/* 좌측 */}
        <div>
          <p className="text-primary font-mono text-[11px] font-bold tracking-wider uppercase">
            01 — 연결
          </p>
          <h2
            className="text-foreground mt-4"
            style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-1.8px", lineHeight: 1.05 }}
          >
            한 번의 액션,
            <br />
            <span className="text-primary">모두에게 흐른다.</span>
          </h2>
          <p
            className="text-text-dim mt-6 max-w-[360px]"
            style={{ fontSize: 16, lineHeight: 1.75 }}
          >
            학생이 학원에 들어선 그 순간, 학부모·강사·원장·회계까지 동시에 연결됩니다. 따로 입력하지 않아도, 따로 알리지 않아도.
          </p>
        </div>

        {/* 우측 — Trigger + Outcomes */}
        <div className="space-y-7">
          {/* Trigger 카드 */}
          <article className="bg-card border-line relative overflow-hidden rounded-2xl border px-7 py-5"
            style={{ boxShadow: "0 16px 36px rgba(26, 95, 60, 0.08)" }}
          >
            <span className="bg-primary absolute top-0 bottom-0 left-0 w-1" aria-hidden="true" />
            <div className="flex items-center gap-3.5 pl-3">
              <span
                className="bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-xl"
                style={{ boxShadow: "0 6px 16px rgba(26, 95, 60, 0.18)" }}
              >
                <EyIcon name="check" size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-primary font-mono text-[11px] font-bold tracking-wider uppercase">
                  오후 4:02 · 트리거
                </p>
                <p
                  className="text-foreground mt-1"
                  style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.3px" }}
                >
                  강민서 학생이 등원했습니다.
                </p>
              </div>
              <span className="bg-primary-soft text-primary shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase">
                1 Event
              </span>
            </div>
          </article>

          {/* 분기 화살표 (SVG) */}
          <svg viewBox="0 0 800 56" className="h-14 w-full" aria-hidden="true">
            {[0.125, 0.375, 0.625, 0.875].map((x, i) => (
              <g key={i}>
                <path
                  d={`M 400 0 Q 400 28 ${x * 800} 28 L ${x * 800} 56`}
                  fill="none"
                  stroke="var(--line-strong)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle
                  cx={x * 800}
                  cy="56"
                  r="3"
                  fill={
                    ["var(--gold)", "var(--primary)", "var(--blue)", "var(--purple)"][i]
                  }
                />
              </g>
            ))}
          </svg>

          {/* Outcomes 4 카드 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW_OUTCOMES.map((o) => {
              const TOP_COLOR = {
                gold: "border-t-gold",
                primary: "border-t-primary",
                blue: "border-t-blue",
                purple: "border-t-purple",
              };
              const TEXT_COLOR = {
                gold: "text-gold",
                primary: "text-primary",
                blue: "text-blue",
                purple: "text-purple",
              };
              return (
                <article
                  key={o.tag}
                  className={`bg-card border-line rounded-xl border border-t-[3px] p-[18px] ${TOP_COLOR[o.color]}`}
                >
                  <p className={`font-mono text-[11px] font-bold uppercase ${TEXT_COLOR[o.color]}`}>
                    {o.tag}
                  </p>
                  <p className="text-foreground mt-2 text-[12px] leading-relaxed">{o.body}</p>
                </article>
              );
            })}
          </div>

          {/* Realtime chip */}
          <div className="border-line bg-card inline-flex items-center gap-2 rounded-xl border px-5 py-3.5">
            <span className="bg-primary size-2 animate-pulse rounded-full" />
            <span className="text-foreground text-[13px] font-semibold">
              0.4초 안에 동기화 완료
            </span>
            <span className="text-text-dim ml-1 font-mono text-[11px]">Supabase Realtime</span>
          </div>
        </div>
      </div>
    </section>
  );
}
