import { EyIcon } from "@/components/icons/eywa-icons";
import { TESTIMONIAL } from "@/data/marketing";
import { Reveal } from "../_motion/reveal";
import { EditorialPhoto } from "../_ui/photo";
import { Eyebrow } from "../_ui/eyebrow";
import { SectionShell } from "../_ui/section-shell";
import directorDeskImg from "../_img/director-desk.webp";

export function VoiceSection() {
  const t = TESTIMONIAL;
  return (
    <SectionShell id="voice" pad="lg" containerClassName="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
      {/* 좌 — 인용 */}
      <div>
        <h2 className="sr-only">도입 사례 — 원장님 인터뷰</h2>
        <Reveal variant="up">
          <Eyebrow label={`도입 사례 · ${t.months}개월차 인터뷰`} tone="dim" />
        </Reveal>
        <Reveal variant="blur" delay={60}>
          <span className="bg-primary mt-7 block h-1 w-12 rounded-full" aria-hidden="true" />
          <blockquote className="text-ink mt-6 text-[clamp(2rem,4.4vw,3.4rem)] leading-[1.26] font-extrabold tracking-[-0.035em] whitespace-pre-line">
            {t.headline}
          </blockquote>
        </Reveal>
        <Reveal variant="up" delay={160}>
          <p className="text-text-dim mt-7 max-w-[34rem] text-[16px] leading-[1.85]">{t.body}</p>
        </Reveal>
      </div>

      {/* 우 — 환경 사진 + 메타 + 검증 칩 (둥근 프사 대신 원장실 풍경) */}
      <Reveal variant="up" delay={140}>
        <div className="bg-card border-line overflow-hidden rounded-[16px] border shadow-[0_1px_2px_rgba(29,29,31,0.04),0_20px_48px_-26px_rgba(29,29,31,0.18)]">
          <EditorialPhoto
            src={directorDeskImg}
            alt="아침 햇살이 드는 원장실 책상 위 노트북에 띄운 Eywa 운영실"
            aspect="aspect-[16/10]"
            bare
            sizes="(min-width: 1024px) 420px, 90vw"
            className="border-line border-b"
          />
          <div className="p-7">
            <div>
              <p className="text-foreground text-[15px] font-bold">{t.name}</p>
              <p className="text-text-dim text-[12px]">
                {t.academy} · {t.loc}
              </p>
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
                <li key={c.label} className="bg-bg-soft flex items-center justify-between rounded-[10px] px-3.5 py-2.5">
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
        </div>
      </Reveal>
    </SectionShell>
  );
}
