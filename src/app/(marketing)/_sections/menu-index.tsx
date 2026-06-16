import { EyIcon } from "@/components/icons/eywa-icons";
import { MENU_EXCLUDED, MENU_INDEX } from "@/data/marketing";
import { Reveal } from "../_motion/reveal";
import { SectionShell } from "../_ui/section-shell";

export function MenuIndexSection() {
  return (
    <SectionShell id="menus" tone="soft" bordered pad="lg">
      <div className="max-w-[44rem]">
        <Reveal variant="up">
          <p className="text-text-faint font-mono text-[11px] font-bold tracking-[0.16em] uppercase">
            12 메뉴 · 한 장의 운영 명세서
          </p>
        </Reveal>
        <Reveal variant="clip" delay={60}>
          <h2 className="text-foreground mt-5 text-[clamp(2rem,4.2vw,3.3rem)] leading-[1.18] font-extrabold tracking-[-0.025em]">
            하루를 움직이는
            <br />
            열두 개의 도구.
          </h2>
        </Reveal>
        <Reveal variant="up" delay={140}>
          <p className="text-text-dim mt-6 max-w-[34rem] text-[16px] leading-[1.8]">
            화려한 기능 나열이 아니라, 원장님이 실제로 손이 가는 순서 그대로 놓았습니다.
            43개 탭으로 무너진 프로그램을 쓰던 원장님이라면, 이 절제가 곧 속도라는 걸 아실 겁니다.
          </p>
        </Reveal>
      </div>

      {/* 점선 리더 목차 */}
      <Reveal variant="up" delay={120} className="mt-10">
        <ul className="bg-card border-line rounded-2xl border px-3 py-3 sm:px-5 sm:py-4">
          {MENU_INDEX.map((m, i) => {
            const showGroup = i === 0 || MENU_INDEX[i - 1].group !== m.group;
            return (
              <li key={m.no}>
                {showGroup ? (
                  <p className="text-text-faint px-3 pt-4 pb-1.5 font-mono text-[10px] font-bold tracking-[0.16em] uppercase first:pt-1">
                    {m.group}
                  </p>
                ) : null}
                <div className="ey-row group flex items-baseline gap-3 rounded-lg px-3 py-3">
                  <span className="text-text-faint w-6 shrink-0 font-mono text-[12px] font-bold">{m.no}</span>
                  <span className="bg-primary-soft text-primary flex size-7 shrink-0 translate-y-[2px] items-center justify-center rounded-md transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <EyIcon name={m.icon} size={15} />
                  </span>
                  <span className="text-foreground flex shrink-0 items-center gap-1.5 text-[15px] font-bold">
                    {m.name}
                    {m.core ? (
                      <>
                        <span className="bg-gold size-1.5 rounded-full" aria-hidden="true" />
                        <span className="sr-only">핵심 메뉴</span>
                      </>
                    ) : null}
                  </span>
                  <span className="border-line mx-2 mb-1 min-w-6 flex-1 self-end border-b border-dotted" aria-hidden="true" />
                  <span className="text-text-dim hidden shrink-0 text-[13px] md:block">{m.desc}</span>
                  {m.time ? (
                    <span className="text-text-faint w-12 shrink-0 text-right font-mono text-[11px]">{m.time}</span>
                  ) : (
                    <span className="w-12 shrink-0" aria-hidden="true" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Reveal>

      {/* 합계 + 뺀 것도 자랑 */}
      <Reveal variant="up" delay={80} className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-foreground font-mono text-[12px] font-bold tracking-[0.08em]">
            TOTAL — 12 메뉴 <span className="text-text-faint">/ 0개의 군더더기</span>
          </p>
          <p className="text-text-faint flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase">의도적으로 뺐습니다</span>
            {MENU_EXCLUDED.map((t) => (
              <span key={t} className="text-text-faint line-through">
                {t}
              </span>
            ))}
          </p>
        </div>
      </Reveal>
    </SectionShell>
  );
}
