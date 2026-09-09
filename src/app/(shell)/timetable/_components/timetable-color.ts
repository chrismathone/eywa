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
  green: "--green",
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
  if (mode === "mid") return "bg-ink/80! font-bold text-white/85";
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
 * 원장이 색 견본으로 직접 준 두 색(2026-09-07) — 스프레드시트 표준색을 그대로 옮긴 것이라 토큰이 아니다.
 * 🔴 **모든 뷰가 이 상수를 쓴다**(기본뷰·통합뷰·합반·강사뷰) — 뷰마다 색을 적으면 같은 학생이 화면마다 달라진다.
 * ⚠️ 값을 조립하지 말 것: Tailwind는 소스에 **적힌 글자 그대로**를 스캔해서 `bg-[#a4c2f4]`가 문자열로 없으면
 *    클래스가 생성되지 않고 **에러 없이 색이 안 붙는다**.
 * 🔴 글씨는 흰색이 아니라 진한 잉크다 — 원장 지시는 *"대비맞춰서 … 왠만하면 흰색"*인데 이 두 배경에서 흰 글씨는
 *    각각 1.8:1·1.1:1(WCAG 하한 4.5)로 **안 읽힌다**. 대비가 먼저라 잉크로 두고, 흰 글씨를 쓰려면 배경을 더
 *    진한 파랑으로 바꾸는 별도 결정이 필요하다.
 */
/**
 * @deprecated 섹션 **배경**으로 쓰지 말 것 — 2026-09-08부터 대기는 퇴원처럼 **사람에게 붙는 칩**이다(`holdTone`).
 * 남겨 둔 이유는 색 값의 출처를 한 곳에 두기 위해서다(원장이 준 스프레드시트 표준색).
 */
export const HOLD_SECTION_CLASS = "bg-[#a4c2f4] text-ink"; // 대기 = light cornflower blue 1 (대비 9.5:1)

/**
 * 대기 학생 한 줄 tone — **퇴원과 같은 모양**(원장 2026-09-08: *"대기 셀 색상이 아니고 퇴원생처럼 저렇게 해줘야지"*).
 *
 * 🔴 종전엔 `HOLD_SECTION_CLASS`를 **섹션 배경**으로 깔아서, 대기 학생이 0명인 반까지 파란 띠가 통째로 그어졌다
 *    (스샷: 열두 칸 중 아홉이 `-` 하나만 든 파란 칸). 색은 **사람에게 붙는 표시**여야지 빈 칸을 칠하는 게 아니다.
 * 🔑 색 값은 원장이 준 그대로(`bg-[#a4c2f4]`) — 뜻이 바뀐 게 아니라 붙는 자리가 바뀐 것이다.
 * ⚠️ 글자는 흰색이 아니라 잉크다 — 이 배경에서 흰 글씨는 1.8:1로 안 읽힌다(위 상수 주석과 같은 이유).
 * ⚠️ Tailwind는 소스에 **적힌 글자 그대로** 스캔한다 — 색 값을 조립하지 말 것(에러 없이 색이 안 붙는다).
 */
export function holdTone(mode: TimetableColorMode): string {
  if (mode === "pastel") return "bg-[#a4c2f4]/70 text-ink font-medium";
  if (mode === "mid") return "bg-[#a4c2f4]/85 text-ink font-medium";
  return "bg-[#a4c2f4] text-ink font-bold"; // vivid = 가장 또렷
}
export const RECENT_ROW_CLASS = "bg-[#f4cccc] text-[#7f1d1d]"; // 등록 31~60일 = light red 1 (대비 6.9:1)

/**
 * 재원 학생 한 줄 tone(신입/전입/일반) — 모드별 강도. 퇴원·대기는 호출부에서 별도 처리(무영향).
 * ⚠️ 전입을 신입보다 먼저 검사(반이동은 isNew도 true라 순서 중요 — studentRowTone과 동일 규칙).
 * - vivid: 신입=빨강 채움+흰 글자, 전입=민트 채움+진초록(시트 export 색 그대로).
 * - mid: 신입/전입 15% 채움 + 진한 글자.
 * - pastel: 기존 soft 채움.
 */
export function timetableStudentTone(
  mode: TimetableColorMode,
  s: { isNew?: boolean; isRecent?: boolean; isTransferredIn?: boolean },
): string {
  if (mode === "vivid") {
    // vivid = 이름을 bold로 확실히 굵게(사용자 요청 "더 쨍하게"). 신입=빨강 채움, 전입=민트 채움.
    if (s.isTransferredIn) return "bg-[#bbf7d0] font-bold text-[#14512b]";
    if (s.isNew) return "bg-danger font-bold text-white";
    if (s.isRecent) return `${RECENT_ROW_CLASS} font-bold`;
    return "font-bold text-foreground";
  }
  if (mode === "mid") {
    if (s.isTransferredIn) return "bg-primary/15 font-medium text-primary";
    if (s.isNew) return "bg-danger/15 font-medium text-danger";
    if (s.isRecent) return RECENT_ROW_CLASS;
    return "text-foreground";
  }
  if (s.isTransferredIn) return "bg-primary-soft text-primary";
  if (s.isNew) return "bg-danger-soft text-danger";
  if (s.isRecent) return RECENT_ROW_CLASS;
  return "text-foreground";
}
