/**
 * 출석부 보기 설정 — 계정 귀속(`users.ui_prefs.attendance`).
 *
 * 원장 지시(2026-08-04, 상시): *"모든 뷰 세팅은 계정 귀속"*. localStorage는 **포트까지 포함한 origin
 * 단위**라 "로그인은 그대로인데 설정만 리셋"으로 위장하고, 다른 PC에서 열면 남의 화면처럼 보인다(#90).
 *
 * ⚠️ 일반 모듈이어야 한다 — 서버(초기값)와 클라(토글)가 같이 쓴다. `import "server-only"`를 붙이면
 *    클라 번들에서 런타임 undefined가 되고 타입체크는 통과한다(#61·#81).
 */

import { parseAttendanceSortKey, type AttendanceSortKey } from "./sort-rows";

/** 한 계정이 접어 둘 수 있는 반의 상한 — 손장난·오염된 값이 무한히 쌓이지 않게. */
const MAX_COLLAPSED = 300;

export type AttendanceViewPrefs = {
  /** 접어 둔 반 id. 강사 전체 보기에서 반 머리행을 눌러 접는다(접기는 **표시**일 뿐 합계는 안 바뀐다). */
  collapsed: string[];
  /** 행 정렬 기준(반별·가나다·학년·담임순). 반별 외엔 반 구분 없이 한 덩어리로 그린다. */
  sort: AttendanceSortKey;
  /**
   * 날짜축을 무엇으로 그릴지 — 세션 기간(0189a) / 달력월.
   * 기본은 세션이고, 그 과목·달에 세션이 정의돼 있지 않으면 **자동으로 달력월**로 떨어진다.
   * ⚠️ 이건 **표시 렌즈일 뿐**이다. 청구·시수검증·급여는 이 설정을 읽지 않는다(저장되는 진실은 하나).
   */
  periodMode: PeriodMode;
  /**
   * 퇴직 담임을 **강사 선택지·요약 허브에서 감춘다**(원장 2026-08-14 "퇴직자 출석부 숨기기").
   * 기본 켜짐 — 매일 여는 화면에서 안 쓰는 이름이 목록 절반을 먹고 있었다.
   *
   * ⚠️ 감추는 건 **강사 축**뿐이다. 그 반 자체는 반 드롭다운에 그대로 남는다 — 담임이 퇴직해도
   *    재원생은 계속 다니므로 반을 감추면 출석을 찍을 길이 사라진다(page.tsx의 기존 주석과 같은 이유).
   * ⚠️ 감춘 인원은 **숫자로 알린다**(칩에 "퇴직 N"). 조용히 사라지면 "강사가 없어졌다"가 된다.
   */
  hideRetired: boolean;
};

export type PeriodMode = "session" | "month";

export const DEFAULT_ATTENDANCE_PREFS: AttendanceViewPrefs = {
  collapsed: [],
  sort: "class",
  periodMode: "session",
  hideRetired: true,
};

export function parsePeriodMode(raw: unknown): PeriodMode {
  return raw === "month" ? "month" : "session";
}

/**
 * 저장된 jsonb → 안전한 설정값. 모르는 값은 버린다(설정 한 줄이 화면을 깨뜨리지 않게).
 * ⚠️ 필드를 추가할 때 **`collapsed`가 깨졌다고 통째로 기본값을 돌려주면 안 된다** — 정렬만 저장된 계정의
 *    정렬이 조용히 사라진다. 필드마다 독립으로 흡수한다.
 */
export function parseAttendanceViewPrefs(raw: unknown): AttendanceViewPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ids = Array.isArray(o.collapsed)
    ? o.collapsed.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64)
    : [];
  return {
    collapsed: [...new Set(ids)].slice(0, MAX_COLLAPSED),
    sort: parseAttendanceSortKey(o.sort),
    periodMode: parsePeriodMode(o.periodMode),
    // 저장된 적 없으면(undefined) 기본 켜짐. 명시적으로 false를 저장한 계정만 퇴직자를 본다.
    hideRetired: o.hideRetired === false ? false : true,
  };
}
