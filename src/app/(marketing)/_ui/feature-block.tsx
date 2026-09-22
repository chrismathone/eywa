import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Reveal } from "../_motion/reveal";
import { BrowserFrame } from "./browser-frame";
import { SectionShell } from "./section-shell";

/**
 * FeatureBlock — 기능 소개 공통 (텍스트 + 제품 목업 프레임, 좌우 교대).
 * 경쟁사처럼 "실제 화면을 보여주는" 기능 섹션을 우리 톤으로 통일.
 */
type Props = {
  id: string;
  eyebrow: string;
  title: ReactNode;
  desc: string;
  points: string[];
  url?: string;
  reverse?: boolean;
  tone?: "base" | "soft";
  children: ReactNode;
};

export function FeatureBlock({ id, eyebrow, title, desc, points, url, reverse, tone = "base", children }: Props) {
  return (
    <SectionShell
      id={id}
      tone={tone}
      bordered={tone === "soft"}
      pad="lg"
      containerClassName="grid items-center gap-12 lg:grid-cols-2 lg:gap-16"
    >
      <Reveal variant="up" className={reverse ? "lg:order-2" : undefined}>
        <p className="text-primary font-mono text-[11px] font-bold tracking-[0.16em] uppercase">{eyebrow}</p>
        <h2 className="text-foreground mt-4 text-[clamp(1.8rem,3.6vw,2.8rem)] leading-[1.2] font-extrabold tracking-[-0.025em]">
          {title}
        </h2>
        <p className="text-text-dim mt-5 max-w-[30rem] text-[16px] leading-[1.75]">{desc}</p>
        <ul className="mt-6 space-y-2.5">
          {points.map((p) => (
            <li key={p} className="text-foreground flex items-center gap-2.5 text-[14px] font-medium">
              <span className="bg-primary-soft text-primary flex size-5 shrink-0 items-center justify-center rounded-md">
                <EyIcon name="check" size={13} />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal variant="up" delay={120} className={reverse ? "lg:order-1" : undefined}>
        <BrowserFrame url={url}>{children}</BrowserFrame>
      </Reveal>
    </SectionShell>
  );
}
