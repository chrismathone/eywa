/**
 * 오늘 등하원 화면의 **보기 설정**(순수 파서) — `users.ui_prefs.shuttleToday`.
 *
 * 규칙: *"모든 뷰 세팅은 계정 귀속 — 당연하지만 항상"*(원장 2026-08-04). 정렬·필터·표시 토글은
 * localStorage가 아니라 DB에 담아 **다른 기기에서도 같은 상태**로 열린다. 셔틀 선생님은 폰과 PC를
 * 오가므로 특히 그렇다.
 *
 * ⚠️ 저장된 값을 그대로 믿지 않는다 — 모르는 값이 오면 조용히 기본값("all")으로 접는다.
 */
import { isDirection } from "./types";
import type { DirectionFilter } from "./today-board";

export type ShuttleTodayPrefs = {
  /** 등하원 보기 — "all" | "in" | "out". */
  direction: DirectionFilter;
};

export const DEFAULT_SHUTTLE_TODAY_PREFS: ShuttleTodayPrefs = { direction: "all" };

/** 저장된 jsonb → 항상 완전한 설정(모르는 값·빠진 키는 기본값). */
export function parseShuttleTodayPrefs(raw: unknown): ShuttleTodayPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_SHUTTLE_TODAY_PREFS;
  const dir = (raw as Record<string, unknown>).direction;
  // "all"도 유효한 저장값이다 — isDirection은 in/out만 참이라 따로 받는다.
  if (dir === "all" || isDirection(dir)) return { direction: dir };
  return DEFAULT_SHUTTLE_TODAY_PREFS;
}
