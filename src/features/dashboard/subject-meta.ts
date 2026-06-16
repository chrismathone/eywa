import type { EywaIconName } from "@/components/icons/eywa-icons";

/**
 * 과목별 색/아이콘 메타 + 시간 헬퍼. (구 today-timeline.tsx에서 추출 — 커맨드센터
 * now-cockpit이 재사용.) 순수 상수·함수만, 'use client'/'server-only' 무관.
 */
export type SubjectColor = "primary" | "blue" | "rose" | "amber" | "purple";

export const SUBJECT_META: Record<
  string,
  { color: SubjectColor; icon: EywaIconName; label: string }
> = {
  math: { color: "primary", icon: "leaf", label: "수학" },
  english: { color: "blue", icon: "leaf", label: "영어" },
  korean: { color: "rose", icon: "leaf", label: "국어" },
  science: { color: "purple", icon: "leaf", label: "과학" },
};

export const FALLBACK_META = {
  color: "primary" as SubjectColor,
  icon: "leaf" as EywaIconName,
  label: "수업",
};

export const COLOR_BORDER: Record<SubjectColor, string> = {
  primary: "border-primary bg-primary-softer",
  blue: "border-blue bg-blue-soft",
  rose: "border-rose bg-rose-soft",
  amber: "border-amber bg-amber-soft",
  purple: "border-purple bg-purple-soft",
};

export const COLOR_ICON_BG: Record<SubjectColor, string> = {
  primary: "bg-primary-soft text-primary",
  blue: "bg-blue-soft text-blue",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  purple: "bg-purple-soft text-purple",
};

export function shortTime(t: string) {
  return t.slice(0, 5);
}

export function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":");
  const [eh, em] = end.split(":");
  return Number(eh) * 60 + Number(em) - (Number(sh) * 60 + Number(sm));
}
