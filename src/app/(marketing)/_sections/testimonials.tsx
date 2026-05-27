import { TESTIMONIAL_FEATURED, TESTIMONIAL_OTHERS } from "@/data/marketing";

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="bg-background px-16 py-[120px]">
      <div className="mx-auto max-w-[1280px]">
        <div className="max-w-2xl">
          <p className="text-primary font-mono text-[11px] font-bold tracking-wider uppercase">
            03 — 도입 사례
          </p>
          <h2
            className="text-foreground mt-4"
            style={{ fontSize: 52, fontWeight: 800, letterSpacing: "-1.6px", lineHeight: 1.05 }}
          >
            원장님들의 진짜 이야기.
          </h2>
        </div>

        {/* Featured */}
        <article className="bg-card border-line shadow-card relative mt-12 grid grid-cols-1 gap-14 overflow-hidden rounded-3xl border px-14 py-12 lg:grid-cols-[1fr_320px]">
          <span className="bg-primary absolute top-0 bottom-0 left-0 w-1" aria-hidden="true" />

          <div className="pl-3">
            <svg
              width="44"
              height="36"
              viewBox="0 0 44 36"
              fill="none"
              aria-hidden="true"
              className="text-primary"
            >
              <path
                d="M0 36V20C0 9 7 0 18 0v8c-6 0-10 4-10 12h10v16H0zm26 0V20C26 9 33 0 44 0v8c-6 0-10 4-10 12h10v16H26z"
                fill="currentColor"
                opacity="0.18"
              />
            </svg>
            <p
              className="text-foreground mt-5"
              style={{
                fontSize: 26,
                fontWeight: 500,
                lineHeight: 1.5,
                letterSpacing: "-0.4px",
                textWrap: "pretty" as never,
              }}
            >
              {TESTIMONIAL_FEATURED.quote}
            </p>
            <footer className="border-line mt-7 flex items-center justify-between border-t pt-6">
              <div>
                <p className="text-foreground text-[15px] font-bold">
                  {TESTIMONIAL_FEATURED.name}
                </p>
                <p className="text-text-dim mt-0.5 text-[12px]">
                  {TESTIMONIAL_FEATURED.academy} · {TESTIMONIAL_FEATURED.loc}
                </p>
              </div>
              <span className="text-gold text-base">★★★★★</span>
            </footer>
          </div>

          {/* 메트릭 패널 */}
          <aside className="bg-bg-soft border-line rounded-2xl border p-7">
            <p className="text-primary font-mono text-[11px] font-bold tracking-wider uppercase">
              {TESTIMONIAL_FEATURED.metric.label}
            </p>
            <p
              className="tabular text-foreground mt-2"
              style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}
            >
              {TESTIMONIAL_FEATURED.metric.value}
            </p>
            <p className="text-foreground mt-2 text-[13px] font-semibold">
              {TESTIMONIAL_FEATURED.metric.sub}
            </p>
            <p className="text-text-faint mt-1 font-mono text-[11px]">
              {TESTIMONIAL_FEATURED.metric.note}
            </p>
            <ul className="border-line mt-5 space-y-2 border-t pt-4 text-[12px]">
              {TESTIMONIAL_FEATURED.metric.rows.map(([k, v]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className="text-text-dim">{k}</span>
                  <span className="text-foreground num font-bold">{v}</span>
                </li>
              ))}
            </ul>
          </aside>
        </article>

        {/* Others 3 */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {TESTIMONIAL_OTHERS.map((t) => (
            <article
              key={t.name}
              className="bg-card border-line shadow-card flex flex-col gap-4 rounded-2xl border p-7"
            >
              <span className="text-gold text-[15px]">★★★★★</span>
              <p
                className="text-foreground flex-1"
                style={{
                  fontSize: 14.5,
                  fontWeight: 500,
                  lineHeight: 1.6,
                  textWrap: "pretty" as never,
                }}
              >
                {t.quote}
              </p>
              <footer className="border-line border-t pt-4">
                <p className="text-foreground text-[13px] font-bold">{t.name}</p>
                <p className="text-text-dim mt-0.5 text-[12px]">
                  {t.academy} · {t.loc}
                </p>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
