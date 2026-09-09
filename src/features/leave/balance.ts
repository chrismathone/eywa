/**
 * 연차 **잔여 산식** — 순수 함수 단일 소스.
 *
 * 잔여 = (법정 부여 + 조정합) − 사용 − 결재중
 *
 * 🔑 왜 파일을 따로 파는가: 같은 식을 **세 곳**이 쓴다 — 내 연차 현황 화면(getMyLeaveBalance),
 *    기안 시 잔여 초과 거절(submitLeaveDraft), 관리자 연차 관리 표(getLeaveOverview). 셋이 각자
 *    더하면 언젠가 한 곳만 조정을 빼먹어 "화면엔 18일인데 기안은 15일까지만" 같은 모순이 난다.
 *
 * 🔑 부여는 여전히 **입사일에서 계산**한다([`accrual.ts`](./accrual.ts) — 결정 로그). 여기 조정은 그
 *    계산값을 대체하지 않고 **위에 얹힌다**(이월·특별휴가·중도 정산처럼 법이 아니라 사람이 정하는 몫).
 *
 * ⚠️ 반올림은 **소수 둘째 자리**로 통일한다 — 반반차(0.25)가 있어 `toFixed(1)`이면 0.25가 0.3으로
 *    왜곡된다(request-days.ts의 `formatLeaveDays`와 같은 이유).
 */

import { formatLeaveDays } from "./request-days";

/** 0.25(반반차) 해상도를 보존하는 반올림 — 부동소수 누적 오차(0.1+0.2)를 여기서 끊는다. */
export function roundDays(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 조정 행 한 줄(화면·집계 공용). `days`는 +부여 / −차감. */
export type LeaveAdjustmentRow = {
  id: string;
  days: number;
  reason: string;
  createdAt: string;
  /** 기록한 관리자 이름. 계정이 지워졌거나 조회 실패면 null(모르면 지어내지 않는다). */
  createdByName: string | null;
};

/** 한 줄이 어느 구간의 것인지 판정할 때 쓰는 창(저장 시점의 연차 구간). */
export type LeaveRowPeriod = { periodStart: string; periodEnd: string };
/** 판정 대상 구간(accrual.ts `LeavePeriod`의 두 필드만). */
export type PeriodWindow = { start: string; end: string };

const DAY_MS = 86_400_000;

function toUtcMs(ymd: string): number | null {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 저장된 창의 **중앙 날짜**. 구간 귀속 판정의 기준점(아래 주석 참조). */
export function periodMidpoint(row: LeaveRowPeriod): string | null {
  const a = toUtcMs(row.periodStart);
  const b = toUtcMs(row.periodEnd);
  if (a === null || b === null || b < a) return null;
  return fromUtcMs(a + Math.floor((b - a) / DAY_MS / 2) * DAY_MS);
}

/**
 * 이 줄(조정·휴가 문서)이 **그 구간의 것인가** — 저장된 창의 **중앙 날짜가 그 구간 안에 들면** 그렇다.
 *
 * 🔴 시작일 **일치**로 보면 안 된다: 직원관리에서 입사일을 정정하면 구간 경계가 통째로 밀려 이미 적어 둔
 *    조정이 어느 구간에도 안 붙고(화면에서 사라지고, 사라졌으니 지울 수도 없다), 같은 이유로 휴가 문서의
 *    '사용'이 0으로 리셋돼 **이미 쓴 연차를 한 번 더** 쓸 수 있다.
 * 🔴 "창이 구간 시작일을 품는가"로도 안 된다(2026-09-08 1차 수정안, 적대 리뷰에서 반증): 입사일을
 *    **앞으로** 당겨 정정하면 그 줄이 올해 구간에서 사라질 뿐 아니라 **다음 해 구간에 유령으로 붙는다**
 *    (내년 잔여가 조용히 줄어든다). 방향에 따라 답이 달라지는 규칙은 규칙이 아니다.
 * 🔑 중앙 날짜는 정정 **방향을 가리지 않고**(앞으로·뒤로 모두 그 해 구간에 붙는다), 구간끼리 겹치지
 *    않으므로 한 줄이 두 구간에 붙는 일이 **원리적으로 불가능**하다(중복 계산 없음). 입사일이 안 바뀌면
 *    자기 구간에 그대로 붙어 종전과 같다.
 * ⚠️ **완전하지는 않다**: 입사일을 **반년 이상 뒤로** 정정하면 중앙 날짜가 새 입사일보다 앞서 어느 구간에도
 *    안 들어 그 줄이 다시 안 보인다(실측 sweep: +7~+11개월 구간에서만). 시작일 일치(종전)는 **어떤**
 *    정정에서도 그랬으니 실패 폭이 좁아진 것이고, 무엇보다 **틀린 숫자를 만들지는 않는다**(위 1차 수정안은
 *    만들었다). 더 줄이려면 구간 키를 날짜가 아니라 근속 연차(yearIndex)로 바꿔야 한다 — 별건.
 * ⚠️ 창을 못 읽으면(형식 오류) **시작일 일치로 보수적 폴백** — 모르는 것을 넓게 잡아 남의 구간에
 *    섞지 않는다.
 */
export function leaveRowMatchesPeriod(row: LeaveRowPeriod, period: PeriodWindow): boolean {
  const mid = periodMidpoint(row);
  if (mid === null) return row.periodStart === period.start;
  return period.start <= mid && mid <= period.end;
}

/** 조정 한 줄의 상한(일) — DB check(±100)와 같은 값. 화면 미리보기와 서버가 함께 읽는다. */
export const MAX_LEAVE_DELTA = 100;
/** 조정 **결과 총 부여**의 상한(일) — 가감을 여러 번 쌓아 넘기지 못하게 결과에도 건다. */
export const MAX_LEAVE_TOTAL = 100;

/** 조정 합계. 행이 없으면 0 — "조정 없음"과 "표가 아직 없음"은 여기서 구분하지 않는다(호출부 몫). */
export function sumAdjustments(rows: readonly { days: number }[]): number {
  return roundDays(rows.reduce((acc, r) => acc + (Number.isFinite(r.days) ? r.days : 0), 0));
}

/** 총 부여 = 법정 부여 + 조정합. 음수 부여는 뜻이 없어 0에서 멈춘다. */
export function grantedTotal(legalGranted: number, adjustment: number): number {
  return Math.max(0, roundDays(legalGranted + adjustment));
}

/** 잔여 = 총 부여 − 사용 − 결재중(0 미만은 0). 결재중을 미리 빼야 같은 연차를 두 번 올리지 못한다. */
export function remainingDays(args: { granted: number; used: number; pending: number }): number {
  return Math.max(0, roundDays(args.granted - args.used - args.pending));
}

/**
 * "총 부여를 N일로" 입력 → 실제로 적을 **가감 값**. 화면은 총 일수를 받고 DB엔 차이만 쌓는다
 * (0252a: 덮어쓰기가 아니라 행 누적 — 왜 바뀌었는지가 남는다).
 */
export function deltaForTotal(targetTotal: number, currentTotal: number): number {
  return roundDays(targetTotal - currentTotal);
}

/**
 * 가감 표기 — `+3일` / `−1.5일`. 부호를 앞에 붙여야 "3일 차감"인지 "3일 부여"인지 한눈에 갈린다.
 * ⚠️ 음수 부호는 하이픈(-)이 아니라 **빼기표(−)** — 좁은 칸에서 하이픈은 글자 사이 줄표로 읽힌다.
 */
export function formatSignedDays(days: number): string {
  const v = roundDays(days);
  if (v === 0) return formatLeaveDays(0);
  return `${v > 0 ? "+" : "−"}${formatLeaveDays(Math.abs(v))}`;
}
