/**
 * 지점 기능 라이선스 **판정 규칙**(순수) — 슈퍼관리자 학원 상세 '라이선스' 카드의 켜기·끄기가 실제 동작을 바꾸는 단일 기준.
 *
 * 계기(원장 2026-09-25): *"회의녹음 전사랑 구글시트 연동 … 온오프하면 실제로 배선 따여잇나?"* → 따여 있지 않았다
 * (write-only-orphan — 저장만 되고 읽는 곳 0). 그리고 *"침산은 기존에도 사용중이엿으니 문제없이 계속 사용중이어야함"*.
 *
 * 🔴 **행이 없으면 허용**이다 — 라이선스 카드가 생기기 전부터 쓰던 지점(데모 둘은 행이 아예 없다)이 배선하는 순간
 *    멈추면 안 된다. 막는 것은 **슈퍼관리자가 명시로 끈 것**(`is_active = false`)과 **만료일이 지난 것**뿐.
 * 🔴 조회가 실패해도 허용(fail-open) — 권한 폴백과 같은 원칙([[#60]]): 라이선스 표 하나의 장애가 전 지점의 녹음·AI를
 *    멈추게 두지 않는다. 실패는 로그로만 남긴다.
 * ⚠️ 서버·테스트 공용 순수 모듈 — DB 조회는 [`server.ts`](./server.ts).
 */

/** 켜고 끄는 기능 — 슈퍼관리자 라이선스 카드(`TOGGLE_FEATURES`)와 같은 키. */
export type LicensedFeature = "ai_analysis" | "google_sheets" | "meeting_recording" | "window_mode";

export type LicenseRow = { is_active: boolean; expires_at: string | null } | null;

export function licenseAllows(row: LicenseRow, now: Date = new Date()): boolean {
  if (!row) return true;
  if (!row.is_active) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return false;
  return true;
}

/**
 * **명시로 켠 지점만** 쓰는 기능(기본 꺼짐) — 위 `licenseAllows`의 반대 기본값이다.
 * 외부 앱 연결(오늘 수학)처럼 "이 지점이 계약한 것"만 열어야 하는 기능은 행이 없으면 **꺼짐**이다
 * (행 없음 = 허용으로 두면 새 지점마다 남의 앱 메뉴와 데이터 반출이 저절로 열린다).
 */
export type OptInFeature = "todays_math" | "slack" | "laboratory" | "video_review" | "report_rating" | "consult_rating" | "ecount_accounting";

export function licenseExplicitlyOn(row: LicenseRow, now: Date = new Date()): boolean {
  return row !== null && licenseAllows(row, now);
}

/** 사용자에게 그대로 보여 주고 재시도 횟수에서도 빼는 AI 라이선스 거절 표식. */
export const AI_FEATURE_DISABLED_PREFIX = "AI 기능 꺼짐:";

export function isAiFeatureDisabledMessage(message: string): boolean {
  return message.startsWith(AI_FEATURE_DISABLED_PREFIX);
}

/** 막혔을 때 사용자에게 보이는 한 줄(한글) — 어디서 막혔는지 + 누구에게 물을지. */
export const LICENSE_BLOCKED_MESSAGE: Record<LicensedFeature, string> = {
  meeting_recording: "이 지점은 회의 녹음·전사 기능이 꺼져 있습니다 — 사용하려면 운영사에 문의하세요",
  google_sheets: "이 지점은 구글 시트 연동이 꺼져 있습니다 — 사용하려면 운영사에 문의하세요",
  // "AI 기능 꺼짐:" 머리는 `aiUserMessage`가 알아보고 화면까지 그대로 통과시키는 표식이다(일반 실패 문구로 덮이면
  // 강사가 계속 다시 누른다) — 표식 판정은 위 상수·함수가 단일 소스다.
  // 창 모드는 막는 기능이 아니라 화면 방식이라 이 문구가 화면에 뜰 일은 없다(셸이 조용히 단일창으로 연다).
  window_mode: "이 지점은 창 모드가 꺼져 있습니다",
  ai_analysis: `${AI_FEATURE_DISABLED_PREFIX} 이 지점은 AI 분석 기능이 꺼져 있습니다 — 사용하려면 운영사에 문의하세요`,
};

/** AI 호출에 지점이 없을 때 — 라이선스를 판정할 수 없으니 부르지 않는다(generateJSON). "AI 기능 꺼짐:" 머리라 화면까지 그대로 간다. */
export const AI_TENANT_MISSING_MESSAGE = `${AI_FEATURE_DISABLED_PREFIX} 어느 지점의 요청인지 알 수 없어 AI를 호출하지 않았습니다 — 새로고침 후 다시 시도하세요`;

/**
 * 재원생 좌석 — 좌석 라이선스 행의 `max_seats`가 **숫자로 정해졌고 켜져 있을 때만** 한도가 있다
 * (행 없음·끔·비어 있음 = 제한 없음 — 침산은 max_seats가 비어 있어 제한이 없다).
 * `current`는 이번 변경 **전** 재원생 수(바뀌는 학생 본인은 빼고 센다), `adding`은 이번에 재원이 되는 인원.
 */
export function seatLimitOf(row: { is_active: boolean; max_seats: number | null } | null): number | null {
  if (!row || !row.is_active || row.max_seats === null || row.max_seats === undefined) return null;
  return row.max_seats;
}

export function seatsExceeded(limit: number | null, current: number, adding: number): boolean {
  if (limit === null || adding <= 0) return false;
  return current + adding > limit;
}

export function seatBlockedMessage(limit: number, current: number): string {
  return `재원생 좌석이 다 찼습니다 — 최대 ${limit.toLocaleString("ko-KR")}석 중 ${current.toLocaleString("ko-KR")}명 재원. 좌석을 늘리려면 운영사에 문의하세요`;
}
