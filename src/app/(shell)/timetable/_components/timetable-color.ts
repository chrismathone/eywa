"use client";

// 시간표 기본뷰 셀 색 강도(개인 설정 vivid/mid/pastel) → 헤더·학생행 스타일 단일 소스.
// class-cell/hapban-cell(클라 컴포넌트)이 useTimetableColorMode()로 읽어 적용. 반 지정색(classBgColor)은
// 항상 존중(모드 무관, 호출부에서 분기). 과목색 폴백만 모드별 강도로 바꾼다.
import type { CSSProperties } from "react";
import type { PillColor } from "@/components/atoms/pill";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { usePrefs, type TimetableColorMode } from "@/components/workspace/use-prefs";

// PillColor → globals.css 색 변수(color-mix 기준). subjects.ts 팔레트와 1:1. neutral은 회색이라 그대로 폴백.
const COLOR_VAR: Record<PillColor, string> = {
  primary: "--primary",
  gold: "--gold",
  blue: "--blue",
  purple: "--purple",
  rose: "--rose",
  amber: "--amber",
  danger: "--danger",
  neutral: "--text-dim",
};

export function useTimetableColorMode(): TimetableColorMode {
  return usePrefs((s) => s.timetableColor);
}

/**
 * 퇴원생 행 tone(시간표 전 뷰 공용) — 취소선 대신 **진한 회색 배경 + 흰색 글씨**(사용자 지정 2026-07-13).
 * 퇴원은 글자가 흰색이라, 색 강도 모드는 **흰 글자의 진하기(불투명도)+굵기**로 표현(사용자 요청):
 * vivid=또렷한 흰색 볼드, mid=약간 옅은 흰색, pastel=가장 옅은 흰색. 배경(진회색)은 고정 — 글자 가독성 보장.
 * bg는 important(`!`) — 공용 StudentRow의 `hover:bg-bg-soft`가 어두운 배경을 밝게 덮어 흰 글자가 사라지던 것 차단.
 */
export function withdrawnTone(mode: TimetableColorMode): string {
  if (mode === "pastel") return "bg-ink/80! font-medium text-white/65";
  if (mode === "mid") return "bg-ink/80! font-semibold text-white/85";
  return "bg-ink/80! font-bold text-white"; // vivid = 가장 또렷
}

/**
 * 반이름 헤더의 과목색 폴백 스타일(반 지정색 없을 때) — 모드별 강도.
 * - pastel: 기존 soft 토큰 클래스(≈12% 알파 + 풀채도 글자).
 * - mid/vivid: 과목 CSS 변수를 color-mix로 밝게 채우고(26%/46%) 글자는 진한 동일색(52% black) — 시트처럼 또렷.
 */
export function subjectHeaderStyle(
  mode: TimetableColorMode,
  color: PillColor,
): { className: string; style?: CSSProperties } {
  if (mode === "pastel") return { className: SUBJECT_SOFT[color] };
  const v = `var(${COLOR_VAR[color]})`;
  const bg = mode === "vivid" ? 46 : 26;
  return {
    className: "",
    style: {
      background: `color-mix(in srgb, ${v} ${bg}%, white)`,
      color: `color-mix(in srgb, ${v} 52%, black)`,
    },
  };
}

/**
 * 재원 학생 한 줄 tone(신입/전입/일반) — 모드별 강도. 퇴원·대기는 호출부에서 별도 처리(무영향).
 * ⚠️ 전입을 신입보다 먼저 검사(반이동은 isNew도 true라 순서 중요 — studentRowTone과 동일 규칙).
 * - vivid: 신입=빨강 채움+흰 글자, 전입=민트 채움+진초록(시트 export 색 그대로).
 * - mid: 신입/전입 15% 채움 + 진한 글자.
 * - pastel: 기존 soft 채움.
 */
export function timetableStudentTone(
  mode: TimetableColorMode,
  s: { isNew?: boolean; isTransferredIn?: boolean },
): string {
  if (mode === "vivid") {
    // vivid = 이름을 semibold로 확실히 굵게(사용자 요청 "더 쨍하게"). 신입=빨강 채움, 전입=민트 채움.
    if (s.isTransferredIn) return "bg-[#bbf7d0] font-semibold text-[#14512b]";
    if (s.isNew) return "bg-danger font-semibold text-white";
    return "font-semibold text-foreground";
  }
  if (mode === "mid") {
    if (s.isTransferredIn) return "bg-primary/15 font-medium text-primary";
    if (s.isNew) return "bg-danger/15 font-medium text-danger";
    return "text-foreground";
  }
  if (s.isTransferredIn) return "bg-primary-soft text-primary";
  if (s.isNew) return "bg-danger-soft text-danger";
  return "text-foreground";
}
