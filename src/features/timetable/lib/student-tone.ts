/**
 * 학생 한 줄의 **또렷한(vivid) 서식** — 시간표와 월별 출석부가 **같은 값**을 쓴다(원장 2026-09-18
 * *"학생 리스트 시간표와 동일한 서식으로 신입생 빨강 배경 흰글씨, 퇴원생 검은배경 흰글씨 같은것"*).
 *
 * 🔴 **일반 모듈**이다(`"use client"` 아님) — 출석부 행은 서버 컴포넌트라 클라 모듈의 상수를 import하면 런타임
 *    `undefined`가 된다([[#81]]). 그래서 색 문자열을 여기로 빼고 시간표(`timetable-color.ts`)도 이걸 읽는다.
 * ⚠️ Tailwind는 소스에 **적힌 글자 그대로** 스캔한다 — 값을 조립하지 말 것(에러 없이 색이 안 붙는다).
 * ⚠️ 색 값의 출처: 신입 = 의미색 danger · 전입 민트·31~60일 연빨강 = 원장이 준 스프레드시트 표준색(2026-09-07) ·
 *    퇴원 = 진한 회색(잉크 80%) + 흰 글씨(2026-07-13 사용자 지정).
 */
export const VIVID_STUDENT_TONE = {
  new: "bg-danger font-bold text-white",
  transferIn: "bg-[#bbf7d0] font-bold text-[#14512b]",
  recent: "bg-[#f4cccc] text-[#7f1d1d] font-bold",
  withdrawn: "bg-ink/80! font-bold text-white",
} as const;

export type StudentToneKind = keyof typeof VIVID_STUDENT_TONE;

/**
 * **고정(sticky) 칸용** 같은 서식 — 퇴원의 `bg-ink/80`은 반투명이라, 가로로 스크롤하면 고정된 칸 뒤로 지나가는
 * 날짜 칸이 비친다([[#74]]). 시간표 학생 줄은 고정 칸이 아니라 괜찮았다. 여기선 흰 바탕 위의 **같은 합성색**을
 * 불투명으로 쓴다(`--ink` #121212 × 80% + 흰색 × 20% = #414141).
 * ⚠️ `--ink`를 바꾸면 이 값도 다시 계산할 것. 나머지 셋은 원래 불투명이라 그대로다.
 */
export const VIVID_STUDENT_TONE_STICKY: Record<StudentToneKind, string> = {
  ...VIVID_STUDENT_TONE,
  withdrawn: "bg-[#414141] font-bold text-white",
};

/** 등록 31~60일 줄 배경(모드 무관) — 시간표 mid·pastel도 같은 값을 쓴다. */
export const RECENT_ROW_CLASS = "bg-[#f4cccc] text-[#7f1d1d]"; // light red 1 (대비 6.9:1)

/** 신입·전입 창(일) — 시간표 조회(`newCutoff`)와 같은 값. */
export const NEW_STUDENT_DAYS = 30;
/** 등록 31~60일(신입 다음 단계) 창. */
export const RECENT_STUDENT_DAYS = 60;
