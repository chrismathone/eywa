/**
 * SectionShell — 랜딩 섹션 공통 셸 (수평 컨테이너 + 배경 톤 + 수직 리듬).
 * 종이가 겹친 듯한 층(base ↔ soft ↔ card)을 교대로 깔아 올라이트 깊이를 만든다.
 */
import type { ReactNode } from "react";

type Tone = "base" | "soft" | "card";
type Pad = "lg" | "tight" | "hero" | "none";

const TONE: Record<Tone, string> = {
  base: "bg-background",
  soft: "bg-bg-soft",
  card: "bg-card",
};

const PAD: Record<Pad, string> = {
  hero: "py-[clamp(56px,9vh,104px)]",
  lg: "py-[clamp(80px,13vh,148px)]",
  tight: "py-[clamp(56px,9vh,104px)]",
  none: "",
};

type Props = {
  children: ReactNode;
  id?: string;
  tone?: Tone;
  pad?: Pad;
  bordered?: boolean;
  className?: string;
  containerClassName?: string;
};

export function SectionShell({
  children,
  id,
  tone = "base",
  pad = "lg",
  bordered = false,
  className,
  containerClassName,
}: Props) {
  return (
    <section
      id={id}
      className={`relative overflow-hidden ${TONE[tone]} ${bordered ? "border-line border-y" : ""} ${className ?? ""}`}
    >
      <div
        className={`mx-auto w-full max-w-[1180px] px-6 sm:px-10 lg:px-16 ${PAD[pad]} ${containerClassName ?? ""}`}
      >
        {children}
      </div>
    </section>
  );
}
