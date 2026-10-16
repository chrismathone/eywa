import { TONE_TEXT } from "@/lib/design/semantic-color";
import type { DirMark } from "./parent-month";

/**
 * 월별 달력의 표시 하나 — 기호 + 색(의미색 캐논: 탔음 초록 · 미탑승 주황 · 안 탐 회색 · 변경 보라).
 * 학부모 '월별'과 직원 '학부모 등하원 → 월별'이 같은 한 벌을 쓴다(화면마다 기호·색이 갈리지 않게).
 * ⚠️ 일반 모듈이다 — 서버(범례·직원 표)와 클라(달력 칸)가 함께 읽는다(`"use client"` 파일의 상수는 서버에서 undefined, [[#81]]).
 */
export const MARK: Record<Exclude<DirMark, null>, { glyph: string; label: string; tone: string }> = {
  rode: { glyph: "✓", label: "탔음", tone: TONE_TEXT.positive },
  missed: { glyph: "!", label: "미탑승", tone: TONE_TEXT.caution },
  skip: { glyph: "–", label: "안 탐", tone: TONE_TEXT.inert },
  changed: { glyph: "●", label: "변경", tone: TONE_TEXT.special },
};
