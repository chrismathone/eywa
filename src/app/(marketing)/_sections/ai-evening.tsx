import { EyIcon } from "@/components/icons/eywa-icons";
import { Reveal } from "../_motion/reveal";
import { EditorialPhoto } from "../_ui/photo";
import { SectionShell } from "../_ui/section-shell";
import aiEveningImg from "../_img/ai-evening.webp";

const SUMMARY = [
  "재원 학부모 3건 상담 — 진도 문의·결제일 조정",
  "다음 주 모의고사 일정 확정, 강사 2인 배정",
  "중3 이탈 위험 1건: 김OO — 출석률 하락, 관찰 필요",
];

export function AiEveningSection() {
  return (
    <SectionShell
      id="ai"
      tone="soft"
      bordered
      pad="lg"
      containerClassName="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16"
    >
      {/* 좌 — 텍스트 */}
      <div>
        <Reveal variant="up">
          <p className="text-primary font-mono text-[11px] font-bold tracking-[0.16em] uppercase">AI 분석</p>
        </Reveal>
        <Reveal variant="clip" delay={60}>
          <h2 className="text-foreground mt-4 text-[clamp(1.9rem,4vw,3.1rem)] leading-[1.2] font-extrabold tracking-[-0.025em]">
            상담·회의록을,
            <br />
            AI가 정리해 둡니다.
          </h2>
        </Reveal>
        <Reveal variant="up" delay={140}>
          <p className="text-text-dim mt-6 max-w-[30rem] text-[16px] leading-[1.8]">
            녹음만 해두면 회의록이 요약되고, 등록 상담은 핵심만 추려집니다. 원장님이{" "}
            <span className="text-foreground font-semibold">‘갱신’을 누르기 전까지 결과는 그대로</span> —
            페이지를 열었다고 비용이 새지 않습니다. 필요할 때만, 한 번.
          </p>
        </Reveal>
        <Reveal variant="up" delay={220}>
          <p className="bg-gold-soft text-gold mt-7 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.1em] uppercase">
            <EyIcon name="sparkle" size={13} className="ey-sparkle" />
            Powered by Claude
          </p>
        </Reveal>
      </div>

      {/* 우 — 저녁 책상 사진 위로 AI 카드가 떠 있는 글림프 */}
      <Reveal variant="up" delay={160}>
        <div className="relative">
          <EditorialPhoto
            src={aiEveningImg}
            alt="저녁 시간 학원 사무실 책상 위의 노트북·메모·녹음기"
            aspect="aspect-[3/2]"
            sizes="(min-width: 1024px) 480px, 90vw"
          />
          <div className="bg-card border-line relative z-10 mx-auto -mt-16 w-[92%] overflow-hidden rounded-2xl border p-6 shadow-[0_28px_64px_-26px_rgba(13,17,16,0.4)] sm:-mt-20">
            <div
              className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(184,137,58,0.10), transparent 70%)" }}
              aria-hidden="true"
            />
            <div className="relative flex items-center justify-between">
              <p className="text-gold flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.1em] uppercase">
                <EyIcon name="sparkle" size={14} className="ey-sparkle" />
                AI 회의록 요약
              </p>
              <span className="text-text-faint font-mono text-[11px]">분석 06.16 19:41</span>
            </div>

            <ul className="relative mt-5 space-y-3">
              {SUMMARY.map((line, i) => (
                <Reveal key={line} variant="up" delay={260 + i * 90} className="flex gap-2.5">
                  <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                  <p className="text-foreground text-[14px] leading-relaxed">{line}</p>
                </Reveal>
              ))}
            </ul>

            <div className="border-line relative mt-6 flex items-center justify-between border-t pt-4">
              <span className="text-text-faint text-[12px]">마지막 분석 · 06.16 19:41</span>
              <span className="border-line text-text-dim inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold">
                <EyIcon name="rings" size={13} />
                갱신
              </span>
            </div>
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}
