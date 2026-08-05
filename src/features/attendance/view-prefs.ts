/**
 * 출석부 보기 설정 — 계정 귀속(`users.ui_prefs.attendance`).
 *
 * 원장 지시(2026-08-04, 상시): *"모든 뷰 세팅은 계정 귀속"*. localStorage는 **포트까지 포함한 origin
 * 단위**라 "로그인은 그대로인데 설정만 리셋"으로 위장하고, 다른 PC에서 열면 남의 화면처럼 보인다(#90).
 *
 * ⚠️ 일반 모듈이어야 한다 — 서버(초기값)와 클라(토글)가 같이 쓴다. `import "server-only"`를 붙이면
 *    클라 번들에서 런타임 undefined가 되고 타입체크는 통과한다(#61·#81).
 */

/** 한 계정이 접어 둘 수 있는 반의 상한 — 손장난·오염된 값이 무한히 쌓이지 않게. */
const MAX_COLLAPSED = 300;

export type AttendanceViewPrefs = {
  /** 접어 둔 반 id. 강사 전체 보기에서 반 머리행을 눌러 접는다(접기는 **표시**일 뿐 합계는 안 바뀐다). */
  collapsed: string[];
};

export const DEFAULT_ATTENDANCE_PREFS: AttendanceViewPrefs = { collapsed: [] };

/** 저장된 jsonb → 안전한 설정값. 모르는 값은 버린다(설정 한 줄이 화면을 깨뜨리지 않게). */
export function parseAttendanceViewPrefs(raw: unknown): AttendanceViewPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (!Array.isArray(o.collapsed)) return DEFAULT_ATTENDANCE_PREFS;
  const ids = o.collapsed.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64);
  return { collapsed: [...new Set(ids)].slice(0, MAX_COLLAPSED) };
}
