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

/** 순수 함수 짝이 읽는 보고서 칸 — PostgREST 절과 같은 넷. */
export type UnreadJudgeRow = {
  classnote_status: string | null;
  classnote_read_at: string | null;
  classnote_sent_at: string | null;
  edutrix_share_token: string | null;
  source: string | null;
};

/**
 * 위 판정의 **순수 함수 짝** — 행을 이미 받은 집계(운영실 '강사별 업무 현황'의 학부모 미확인 행)가 쓴다.
 * `judgeable` = 판정할 수 있는 발송(발송 성공 + 매칭 가능 + 유예 지남) · `unread` = 그중 읽음 기록 없음.
 * 🔴 위 PostgREST 절(`UNREAD_MATCHABLE_OR` · 성공 상태 · 유예)과 **함께** 고칠 것 — 테스트(teacher-work-extras.test.ts)는 절 문자열과 이 함수의
 *    사례를 함께 고정할 뿐이라, 절을 바꾸면 이 함수도 손으로 맞춰야 한다. 같은 집합 = `getUnreadReports`(학습·학부모 보고 카드 — 유예 있음).
 * ⚠️ 시각은 문자열로 비교하지 않는다(DB는 `+00:00`, 기준은 `Z` — 모양이 달라 문자열 비교가 틀린다).
 */
export function judgeUnreadReport(r: UnreadJudgeRow, cutoffMs: number): { judgeable: boolean; unread: boolean } {
  const matchable = r.edutrix_share_token != null || r.source == null || r.source !== "edutrix_import";
  const sentAt = r.classnote_sent_at ? Date.parse(r.classnote_sent_at) : Number.NaN;
  const judgeable = r.classnote_status === SENT_STATUS_SUCCESS && matchable && Number.isFinite(sentAt) && sentAt < cutoffMs;
  return { judgeable, unread: judgeable && r.classnote_read_at == null };
}
