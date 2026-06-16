"use client";

/**
 * CountUp — 뷰포트 진입 시 0 → value 카운트업 (tabular 숫자용).
 * SSR/초기엔 최종값을 렌더(노스크립트·SEO 안전), 진입 시에만 0부터 애니메이트.
 * 모션 비활성/reduced-motion이면 최종값 고정. rAF 콜백은 비동기라 set-state-in-effect 규칙 무관.
 */
import { useEffect, useRef, useState } from "react";
import { motionDisabled, prefersReducedMotion } from "@/components/workspace/motion";

type Props = {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  /** 천 단위 콤마 (정수에만) */
  group?: boolean;
  className?: string;
};

function fmt(n: number, decimals: number, group: boolean) {
  if (decimals > 0) return n.toFixed(decimals);
  const r = Math.round(n);
  return group ? r.toLocaleString("ko-KR") : String(r);
}

export function CountUp({
  value,
  decimals = 0,
  duration = 1200,
  prefix = "",
  suffix = "",
  group = false,
  className,
}: Props) {
  const [display, setDisplay] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (motionDisabled() || prefersReducedMotion()) return;
    // 이미 화면 안(상단 above-the-fold)이면 애니메이션 생략 — 최종값→0→카운트업 깜빡임 방지.
    // 화면 밖(아래)일 때만 스크롤로 진입하는 순간 0부터 카운트업.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || started.current) continue;
          started.current = true;
          const t0 = performance.now();
          setDisplay(0);
          const tick = (t: number) => {
            const p = Math.min(1, (t - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            setDisplay(value * eased);
            if (p < 1) requestAnimationFrame(tick);
            else setDisplay(value);
          };
          requestAnimationFrame(tick);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {fmt(display, decimals, group)}
      {suffix}
    </span>
  );
}
