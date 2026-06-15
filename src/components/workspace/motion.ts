// Stage Manager 모션 상수/헬퍼.
// 드래그(포인터 추종)는 transition 0(1:1), 스냅/배치/최대화 등 "목표로 점프"하는 순간만
// 이 transition으로 미끄러지듯 글라이드. (floating-window·드래그/리사이즈 훅 공용)
import { usePrefs } from "./use-prefs";

export const WINDOW_TRANSITION =
  "transform 160ms cubic-bezier(0.22,0.61,0.36,1), width 160ms cubic-bezier(0.22,0.61,0.36,1), height 160ms cubic-bezier(0.22,0.61,0.36,1)";

/** 접근성: 모션 최소화 선호 시 글라이드 끔. (캔버스는 클라 전용이라 SSR mismatch 없음) */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** 모션 비활성 — 사용자 설정(창 애니메이션)이 단일 기준. 기본값만 OS '동작 줄이기'를 따름(use-prefs). */
export function motionDisabled() {
  return !usePrefs.getState().animations;
}
