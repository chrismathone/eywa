// 수업 규칙 프로필 — 첫 학원(침산)의 운영 규칙과 새 학원(일반판)의 중립 규칙을 가르는 **단일 소스**.
// 원장 2026-09-22 방향 B(*"'침산'은 그대로 두고 … 새로 시작하는 지점만 일반화"*).
//
// 🔴 프리셋 값을 읽는 곳은 preset.ts와 여기뿐이다(가드 preset-guard.test.ts). 화면·서버 코드는 `lessonProfileOf(settings)`의
//    **풀린 값**만 본다 — "if 침산" 분기가 화면마다 번지면 두 경로를 영영 못 합친다.
// 🔴 침산 프로필 = 이 작업 전 코드의 상수 그대로다(과목 키 `math` 자동 시수 · 수업보고서 파생 출결). 바꾸지 말 것 —
//    돈(시수·급여·회차)에 닿는다. 새 학원은 끈다: 시수는 기본값 1, 출결은 손으로 찍은 것만.
import type { TenantSettings } from "./settings-types";

export type LessonProfile = {
  /** 수업 길이로 시수를 자동 계산(침산: 수학 교시당 0.5)하는가. 끄면 새 출결 칸의 시수는 기본값(1)이다. */
  autoUnits: boolean;
};

const CHINSAN_PROFILE: LessonProfile = { autoUnits: true };
const GENERIC_PROFILE: LessonProfile = { autoUnits: false };

export function lessonProfileOf(settings: Pick<TenantSettings, "preset">): LessonProfile {
  return settings.preset === "generic" ? GENERIC_PROFILE : CHINSAN_PROFILE;
}
