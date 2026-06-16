"use client";

/**
 * Reveal — 스크롤 진입 시 등장 모션 래퍼 (랜딩 전용).
 * React state 없이 IntersectionObserver가 DOM에 data-in을 박고, CSS가 전이를 담당
 * (react-hooks/set-state-in-effect 회피 + 가벼움). 모션 비활성/reduced-motion이면 즉시 완성 상태.
 * 모션 단일 기준은 앱과 동일하게 motionDisabled() (use-prefs).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { motionDisabled, prefersReducedMotion } from "@/components/workspace/motion";

type RevealVariant = "up" | "blur" | "clip" | "fade";

type Props = {
  children: ReactNode;
  variant?: RevealVariant;
  delay?: number;
  threshold?: number;
  className?: string;
  /** 시그니처 라인/언더라인처럼 자식이 data-in을 참조해야 할 때 식별용 */
  id?: string;
};

export function Reveal({
  children,
  variant = "up",
  delay = 0,
  threshold = 0.15,
  className,
  id,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (motionDisabled() || prefersReducedMotion()) {
      el.setAttribute("data-in", "true");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.setAttribute("data-in", "true");
            io.disconnect();
            break;
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      id={id}
      data-reveal={variant}
      className={className}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
