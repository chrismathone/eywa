import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { PRICING_PLANS } from "@/data/marketing";

export function PricingSection() {
  return (
    <section id="pricing" className="bg-bg-soft border-line border-y px-16 py-[120px]">
      <div className="mx-auto max-w-[1280px]">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-primary font-mono text-[11px] font-bold tracking-wider uppercase">
              04 — 요금
            </p>
            <h2
              className="text-foreground mt-4"
              style={{ fontSize: 48, fontWeight: 800, letterSpacing: "-1.6px", lineHeight: 1.05 }}
            >
              정식 출시까지,
              <br />
              모든 플랜은 <span className="text-gold">베타</span>.
            </h2>
          </div>
          {/* Beta Notice */}
          <aside className="bg-gold-soft max-w-[320px] rounded-xl border border-gold/30 p-[18px]">
            <p className="text-gold flex items-center gap-1.5 font-mono text-[11px] font-extrabold tracking-wider uppercase">
              <span className="bg-gold size-2 rounded-full" />
              Beta Notice
            </p>
            <p className="text-foreground mt-2 text-[13px] font-medium leading-relaxed">
              현재 EYWA는 베타 운영 중입니다.
              <br />
              정식 출시 후 가격이 변동될 수 있습니다.
            </p>
          </aside>
        </div>

        {/* 3 플랜 */}
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {PRICING_PLANS.map((plan) => (
            <article
              key={plan.name}
              className={`bg-card relative overflow-hidden rounded-xl px-7 py-8 ${
                plan.highlight
                  ? "border-2 border-primary shadow-primary-deep"
                  : "border-line shadow-card border"
              }`}
            >
              {plan.highlight ? (
                <span
                  className="bg-primary/10 pointer-events-none absolute -top-10 -right-10 size-[160px] rounded-full blur-xl"
                  aria-hidden="true"
                />
              ) : null}

              <header className="relative flex items-center justify-between">
                <h3 className="text-foreground text-[18px] font-extrabold">{plan.name}</h3>
                {plan.highlight ? (
                  <span className="bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 text-[10px] font-extrabold">
                    가장 인기
                  </span>
                ) : null}
              </header>
              <p className="text-text-dim relative mt-1 text-[13px]">{plan.sub}</p>

              {/* 베타 가격 */}
              <div className="relative mt-7">
                <span className="bg-gold-soft text-gold inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-extrabold uppercase">
                  <span className="bg-gold size-1.5 rounded-full" />
                  Beta
                </span>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="tabular text-foreground text-[40px] font-extrabold leading-none">
                    무료
                  </span>
                  <span className="text-text-dim text-[13px]">· 베타 기간</span>
                </p>
                <p className="text-text-faint mt-1.5 text-[11px]">
                  정식 출시 후 가격이 변동될 수 있습니다.
                </p>
              </div>

              {/* CTA 버튼 */}
              <Link
                href="/login"
                className={`relative mt-6 block w-full rounded-xl px-5 py-3 text-center text-[13px] font-bold transition ${
                  plan.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary-hover shadow-primary-glow"
                    : "border-line-strong bg-card text-foreground hover:bg-bg-soft border"
                }`}
              >
                베타 신청하기
              </Link>

              {/* 기능 리스트 */}
              <ul className="border-line relative mt-6 space-y-2.5 border-t pt-5">
                {plan.features.map((feat) => (
                  <li key={feat} className="text-foreground flex items-center gap-2 text-[13px]">
                    <span className="text-primary inline-flex size-4 shrink-0 items-center justify-center">
                      <EyIcon name="check" size={14} />
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
