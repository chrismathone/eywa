import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial } from "@/components/atoms/initial";
import { TESTIMONIAL } from "@/data/marketing";
import { Reveal } from "../_motion/reveal";
import { SectionShell } from "../_ui/section-shell";

export function VoiceSection() {
  const t = TESTIMONIAL;
  return (
    <SectionShell id="voice" pad="lg" containerClassName="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
      {/* 좌 — 인용 */}
      <div>
        <h2 className="sr-only">도입 사례 — 원장님 인터뷰</h2>
        <Reveal variant="up">
          <p className="text-text-faint font-mono text-[11px] font-bold tracking-[0.16em] uppercase">도입 사례</p>
        </Reveal>
        <Reveal variant="blur" delay={60}>
          <p className="ey-serif text-gold mt-4 mb-[-0.35em] select-none text-[clamp(3.5rem,8vw,6rem)] leading-none" aria-hidden="true">
            &ldquo;
          </p>
          <blockquote className="text-foreground text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.28] font-extrabold tracking-[-0.025em] whitespace-pre-line">
            {t.headline}
          </blockquote>
        </Reveal>
        <Reveal variant="up" delay={160}>
          <p className="text-text-dim mt-7 max-w-[34rem] text-[16px] leading-[1.85]">{t.body}</p>
        </Reveal>
      </div>

      {/* 우 — 메타 + 검증 칩 */}
      <Reveal variant="up" delay={140}>
        <div className="bg-bg-soft border-line rounded-2xl border p-7">
          <div className="flex items-center gap-3">
            <Initial name={t.name} color="primary" size="lg" />
            <div>
              <p className="text-foreground text-[15px] font-bold">{t.name}</p>
              <p className="text-text-dim text-[12px]">
                {t.academy} · {t.loc}
              </p>
            </div>
          </div>

          <dl className="border-line mt-6 space-y-2.5 border-t pt-5 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-text-dim">재원생</dt>
              <dd className="num text-foreground font-bold">{t.students}명</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-dim">사용 기간</dt>
              <dd className="text-foreground font-bold">{t.months}개월째</dd>
            </div>
          </dl>

          {/* 증언 속 숫자 = 검증 칩 */}
          <ul className="mt-6 space-y-2.5">
            {t.chips.map((c) => (
              <li key={c.label} className="bg-card border-line flex items-center justify-between rounded-lg border px-3.5 py-2.5">
                <span className="text-text-dim text-[12px]">{c.label}</span>
                <span className="flex items-center gap-1.5 font-mono text-[12px] font-bold">
                  {c.before ? <span className="text-text-faint line-through">{c.before}</span> : null}
                  {c.before ? <EyIcon name="arrowRight" size={12} className="text-text-faint" /> : null}
                  <span className="text-primary">{c.after}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </SectionShell>
  );
}
