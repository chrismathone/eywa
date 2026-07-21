/**
 * 강사 원스크린 "월간 발송" 달력 — 순수 계산(달 격자·상태 버킷·날짜 집계). Vitest 강제 대상.
 *
 * 분업: DB(0127a RPC)는 (날짜 × 상태) 집계만, **버킷 판정은 여기**. 상태 문자열의 의미는 화면 배지
 * (`classnoteBadge`)와 같은 규약이어야 하므로 한 곳(앱)에서만 해석한다 — DB에서 접으면 두 규약이 갈라진다.
 *
 * ⚠️ 날짜는 전부 KST 기준 `YYYY-MM-DD` 문자열로만 다룬다. `new Date(ymd)`는 UTC로 파싱돼 KST에서 하루
 * 밀리므로, 요일 계산조차 `Date.UTC`로 만든 값에서 `getUTCDay()`로 읽는다(리포 전역 규약).
 */

/** 0127a RPC 한 행 — 그 날짜에 그 상태인 보고서가 몇 건인지. */
export type SendStatRow = { reportDay: string; statusKey: string; cnt: number };

/**
 * 발송 상태 버킷. `classnoteBadge`의 상태값을 행동 단위로 접은 것.
 * - `sent` 발송 완료 / `pending` 워커 처리 중 / `problem` 사람이 봐야 하는 실패·차단
 * - `excluded` 의도적 제외(결석·과목 설정·오래됨) — 분모에서 빼야 "미발송"이 부풀지 않는다
 * - `unsent` 아직 안 보냄(상태 없음) **및 모르는 상태**
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
  subject_off: "excluded",
  absent: "excluded",
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
  /** 결석·과목 설정 등으로 애초에 안 보내는 건 — 분모에서 뺀다. */
  excluded: number;
  unsent: number;
  /** 발송 대상 = total - excluded. 달력의 분모. */
  target: number;
};

const EMPTY = { total: 0, sent: 0, pending: 0, problem: 0, excluded: 0, unsent: 0 };

/** RPC 행들 → 날짜별 집계. 행이 없는 날은 map에 아예 없다(빈 칸). */
export function summarizeSendDays(rows: readonly SendStatRow[]): Map<string, SendDay> {
  const out = new Map<string, SendDay>();
  for (const r of rows) {
    const cur = out.get(r.reportDay) ?? { date: r.reportDay, ...EMPTY, target: 0 };
    cur[bucketOfStatus(r.statusKey)] += r.cnt;
    cur.total += r.cnt;
    out.set(r.reportDay, cur);
  }
  for (const day of out.values()) day.target = day.total - day.excluded;
  return out;
}

/** "YYYY-MM" → 그 달의 첫날·마지막날(RPC 조회 범위). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // m월 0일 = (m-1)월 말일
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** 달 이동(-1/+1). 연 경계를 넘어간다. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-07" → "2026년 7월". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

/** "YYYY-MM-DD" → "YYYY-MM". */
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

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
