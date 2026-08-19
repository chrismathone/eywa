/**
 * 강사 원스크린 "월간 발송" 달력 — 순수 계산(달 격자·상태 버킷·날짜 집계). Vitest 강제 대상.
 *
 * 분업: DB(0127a RPC)는 (날짜 × 상태) 집계만, **버킷 판정은 여기**. 상태 문자열의 의미는 화면 배지
 * (`classnoteBadge`)와 같은 규약이어야 하므로 한 곳(앱)에서만 해석한다 — DB에서 접으면 두 규약이 갈라진다.
 *
 * ⚠️ 날짜는 전부 KST 기준 `YYYY-MM-DD` 문자열로만 다룬다. `new Date(ymd)`는 UTC로 파싱돼 KST에서 하루
 * 밀리므로, 요일 계산조차 `Date.UTC`로 만든 값에서 `getUTCDay()`로 읽는다(리포 전역 규약).
 */

/**
 * 0128a RPC 한 행 — 그 날짜·그 상태·그 대상여부인 보고서가 몇 건인지.
 * `sendable` = 발송 콘솔과 **같은 게이트**(이관분·취소·과목 opt-in·기한)를 통과한 행인가.
 */
export type SendStatRow = { reportDay: string; statusKey: string; sendable: boolean; cnt: number };

/**
 * 발송 상태 버킷. `classnoteBadge`의 상태값을 행동 단위로 접은 것.
 * - `sent` 발송 완료 / `pending` 워커 처리 중 / `problem` 사람이 봐야 하는 실패·차단
 * - `excluded` DB에 남는 제외 상태(`too_old`) — 분모에서 뺀다
 * - `unsent` 아직 안 보냄(상태 없음) **및 모르는 상태**
 *
 * ⚠️ **`absent`·`subject_off`는 DB에 저장되지 않는다**(서버 액션이 반환만 하고 컬럼은 null로 둔다).
 * 그래서 그 두 값을 여기 매핑해 둬도 실데이터에선 절대 안 걸린다 — "결석은 분모에서 빠진다"고 믿으면
 * 화면이 거짓말한다(적대 검증 2026-07-21 확정). 발송 대상 판정은 **버킷이 아니라 RPC의 `sendable`**이
 * 담당한다. 결석만은 규칙이 앱(getAbsenceBlockedKeys)에 있어 SQL로 옮기지 않았고, 그래서 결석분은
 * `unsent`에 남는다 — 화면이 그 사실을 밝힌다(과대 주장 금지).
 */
export type SendBucket = "sent" | "pending" | "problem" | "excluded" | "unsent";

const BUCKET: Record<string, SendBucket> = {
  success: "sent",
  queued: "pending",
  processing: "pending",
  failed: "problem",
  revoked: "problem",
  name_conflict: "problem",
  blocked_shared: "problem",
  too_old: "excluded",
  // ⚠️ 아래 셋은 **DB에 저장되지 않는 반환 전용 상태**라 실데이터에선 도달하지 않는다. 남겨 둔 이유는
  // 혹시 향후 컬럼에 기록되도록 바뀌면 즉시 올바르게 분류되게 하기 위함이며, 이 표에 의존해
  // "결석은 분모에서 빠진다"고 주장하면 안 된다(그 역할은 RPC의 sendable).
  subject_off: "excluded",
  absent: "excluded",
  report_optout: "excluded",
};

/**
 * 상태 → 버킷. 표에 없는 값(빈 문자열=미발송 포함)은 **`unsent`**.
 * ⚠️ 모르는 상태를 `problem`(빨강)으로 몰지 않는 이유: 나중에 무해한 상태가 추가되면 달력이 거짓 경보를
 * 띄운다. 반대로 `sent`로 몰면 "보냈다"는 거짓말이 된다 — `unsent`가 유일하게 항상 참인 답이다.
 */
export function bucketOfStatus(statusKey: string | null | undefined): SendBucket {
  return BUCKET[statusKey ?? ""] ?? "unsent";
}

/** 하루치 집계. `target`(발송 대상)과 `sent`가 달력에 보이는 두 숫자. */
export type SendDay = {
  date: string;
  /** 그날 작성된 보고서 총 건수(제외분 포함). */
  total: number;
  sent: number;
  pending: number;
  problem: number;
  /** DB에 제외 상태(too_old)로 남은 건. */
  excluded: number;
  unsent: number;
  /**
   * **지금 발송 버튼을 누르면 실제로 나가는 건 수**(미발송 중 발송 콘솔 게이트를 통과하는 것).
   * ⚠️ 미발송 전부가 아니다 — 옛 Edutrix 이관분은 안 나갔어도 eywa가 보낼 수 없다.
   */
  actionable: number;
  /** 분모 = 그날 작성분 중 제외 상태(too_old 기록)를 뺀 것. 즉 "학부모에게 나갔어야 할 건". */
  target: number;
};

const EMPTY = { total: 0, sent: 0, pending: 0, problem: 0, excluded: 0, unsent: 0, actionable: 0 };

/**
 * RPC 행들 → 날짜별 집계.
 *
 * ⚠️ 이 함수는 **두 가지 다른 질문**에 답한다. 섞으면 화면이 거짓말한다(적대 검증 + 실데이터로 두 번 교정).
 *  ① "학부모에게 나갔나?" = `sent`/`target` — **출처와 무관한 역사적 사실**. eywa 보고서 17,350건 중
 *     17,335건(99.9%)이 Edutrix 이관분이라, 이관분을 빼면 달력이 전 강사 "0/0"이 되어 기능이 죽는다.
 *     이관분 `success`는 실제로 학부모에게 나간 건이므로 발송으로 세는 게 참이다.
 *  ② "지금 내가 보낼 게 남았나?" = `actionable` — **발송 콘솔과 같은 게이트**(RPC `sendable`)를 통과한
 *     미발송분만. 이관분·과목 설정 밖·기한 초과는 안 나갔어도 **누를 수 없으므로** 여기서 빠진다.
 *     이걸 `target`에 섞으면 강사가 영원히 못 채우는 거짓 미발송이 된다(#77 "할 수 없는 일 재촉 금지").
 */
export function summarizeSendDays(rows: readonly SendStatRow[]): Map<string, SendDay> {
  const out = new Map<string, SendDay>();
  for (const r of rows) {
    const cur = out.get(r.reportDay) ?? { date: r.reportDay, ...EMPTY, target: 0 };
    const bucket = bucketOfStatus(r.statusKey);
    cur.total += r.cnt;
    cur[bucket] += r.cnt; // ① 역사적 사실 — 출처 무관
    if (r.sendable && bucket === "unsent") cur.actionable += r.cnt; // ② 지금 누를 수 있는 것만
    out.set(r.reportDay, cur);
  }
  // 분모는 더해서 만든다(빼기 아님) — 각 항의 출처가 분명해 sent > target 같은 모순이 구조적으로 불가능.
  for (const day of out.values()) day.target = day.sent + day.pending + day.problem + day.unsent;
  return out;
}

// 달 산술(monthRange·shiftMonth·monthLabel·monthOf)은 `@/lib/date-kst` 단일 소스 — 수업보고서 목록의
// 월 단위 조회 범위와 **같은 구현**을 쓴다. 여기선 그대로 재수출해 기존 import 경로를 깨지 않는다.
export { monthLabel, monthOf, monthRange, shiftMonth } from "@/lib/date-kst";
// ⚠️ `export ... from`은 로컬 바인딩을 만들지 않는다 — 아래 monthGrid가 쓰려면 별도 import가 필요하다.
import { monthRange } from "@/lib/date-kst";

/**
 * 달력 격자 — 일요일 시작 주 배열. 그 달이 아닌 칸은 `null`(빈 칸)이라 앞뒤 달 날짜가 새어 들지 않는다.
 * 항상 완전한 주 단위로 끝난다(마지막 줄이 잘리지 않게).
 */
export function monthGrid(month: string): (string | null)[][] {
  const { to } = monthRange(month);
  const [y, m] = month.split("-").map(Number);
  const lastDay = Number(to.slice(8));
  const firstDow = new Date(Date.UTC(y!, m! - 1, 1)).getUTCDay(); // 0=일
  const cells: (string | null)[] = Array<string | null>(firstDow).fill(null);
  for (let d = 1; d <= lastDay; d += 1) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * 달을 열었을 때 기본으로 펼칠 날짜 — **자료가 있는 날 중 가장 최근**. 하나도 없으면 null(빈 달).
 * `preferred`(대개 오늘)에 자료가 있으면 그 날을 우선한다.
 * ⚠️ 빈 날을 기본 선택하면 "이 달에 쓴 게 없다"처럼 보인다 — 달력을 여는 즉시 뭔가 보여야 한다.
 */
export function defaultSelectedDay(days: Map<string, SendDay>, preferred?: string): string | null {
  if (preferred && days.has(preferred)) return preferred;
  let best: string | null = null;
  for (const date of days.keys()) if (!best || date > best) best = date;
  return best;
}
