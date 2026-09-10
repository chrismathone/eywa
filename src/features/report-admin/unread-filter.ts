/**
 * **학부모 미확인 판정** — 보고서 목록 필터와 운영실 집계가 공유하는 단일 소스(순수 상수).
 *
 * 🔴 `classnote_read_at IS NULL`은 **"안 읽음"이 아니다.** 매칭 키(`edutrix_share_token`)가 없는 옛
 *    이관분은 워커가 ClassNote 피드와 짝을 못 지어 **동기화 자체가 안 된다** — 그걸 미확인으로 세면
 *    "학부모가 안 봤다"는 거짓 사실이 된다(report-filters.ts `ReportListFilters.read` 주석).
 * 🔴 그래서 미확인 = **발송 성공 + 매칭 가능 + 읽음 기록 없음** 셋을 모두 만족한 행뿐이다.
 * ⚠️ 이 문자열이 두 벌이 되면 목록(“안읽음” 필터)과 운영실 숫자가 조용히 갈린다 — 반드시 여기서만 고칠 것.
 */

/** 매칭 가능(동기화 대상)인가 — PostgREST `.or(...)` 절. native분(source 없음·edutrix 아님)은 항상 가능. */
export const UNREAD_MATCHABLE_OR =
  "edutrix_share_token.not.is.null,source.is.null,source.neq.edutrix_import";

/** 발송이 실제로 성공한 행만 — 실패·회수분은 "학부모가 안 봤다"가 아니라 "안 갔다"이다. */
export const SENT_STATUS_SUCCESS = "success";

/**
 * 학부모가 확인할 시간을 얼마나 준 뒤에 신호로 볼 것인가(시간).
 * 🔴 화면엔 이 상수의 **이름이 아니라 값이 만든 사실**을 적는다([[#121]]) — "48시간 지나도 미확인".
 */
export const UNREAD_GRACE_HOURS = 48;
