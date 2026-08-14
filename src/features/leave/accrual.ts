/**
 * 연차 부여 — **근로기준법 60조를 그대로 옮긴 순수 함수**(원장 지시 2026-08-14: *"연차 생성기준은
 * 법정 기준따라서 자동적으로 반영"*). 입사일 하나만 있으면 개인별 연차가 **계산으로** 나온다.
 *
 * 🔑 왜 표가 아니라 계산인가: 연차를 행으로 적립해 두면 **매달 도는 배치**가 필요하고, 배치가 한 번
 *    빠지거나 입사일이 나중에 정정되면 그 사람 연차만 조용히 틀린다. 입사일에서 도출하면 언제 조회해도
 *    같은 답이고, 입사일을 고치는 순간 소급해서 맞아떨어진다(부여 이력을 따로 관리할 필요가 없다).
 *    ⚠️ 대신 **이월·특별휴가·중도입사 정산 같은 수기 조정은 표현하지 못한다** — 필요해지면 조정 행
 *    (leave_adjustments)을 더해 `granted + 조정`으로 확장할 것. 지금은 조정 개념이 없다.
 *
 * 법정 규칙(원장 요구사항과 일치):
 *   · 입사 1년 미만  = 1개월 개근마다 1일, **최대 11일**(입사일 기준 월 단위 응당일)
 *   · 1년 이상 3년 미만 = 15일 (입사일 기준 1년 단위 구간마다 새로 부여)
 *   · 3년 이상        = 2년마다 +1일, **최대 25일**  → `15 + floor((n-1)/2)`
 *     (n=1·2 → 15 / n=3·4 → 16 / n=5 → 17 … n=21 → 25에서 상한)
 *
 * ⚠️ 날짜 산술은 전부 **UTC 고정**이라 서버 타임존과 무관하게 결정적이다(문자열 YYYY-MM-DD 입출력).
 *    "오늘"이 필요한 호출부는 `kstToday()`를 넘긴다 — 이 파일은 시계를 직접 읽지 않는다(테스트 가능).
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type Ymd = { y: number; m: number; d: number };

function parse(ymd: string): Ymd | null {
  if (!YMD.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 그 달의 마지막 날(윤년 반영). */
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * n개월 뒤 **응당일**(말일 보정). 1/31 + 1개월 = 2/28(윤년 2/29), 2/29 + 12개월 = 2/28.
 * 월 단위 연차 적립·입사 응당일 계산의 단일 소스.
 */
export function addMonths(ymd: string, n: number): string {
  const p = parse(ymd);
  if (!p) return ymd;
  const total = (p.y * 12 + (p.m - 1)) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return fmt(y, m, Math.min(p.d, lastDayOfMonth(y, m)));
}

/** n년 뒤 응당일 — 개월 산술과 **같은 규칙**을 쓴다(2/29 → 2/28). */
export function addYears(ymd: string, n: number): string {
  return addMonths(ymd, n * 12);
}

/** 하루 전(YYYY-MM-DD). 연차 구간의 끝(다음 구간 시작 −1일)에 쓴다. */
export function dayBefore(ymd: string): string {
  const p = parse(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d - 1));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * `from`부터 `to`까지 **채운 개월 수**(응당일 도달 기준). 입사 3/15 → 4/15에 1개월, 4/14는 0개월.
 * 응당일 보정 때문에 나눗셈으로 어림잡으면 말일 입사자가 하루씩 어긋나 — 어림값에서 시작해 실제
 * 응당일과 대조하며 보정한다(루프는 최대 1~2회).
 */
export function completedMonths(from: string, to: string): number {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b || to < from) return 0;
  let n = (b.y - a.y) * 12 + (b.m - a.m);
  while (n > 0 && addMonths(from, n) > to) n -= 1;
  while (addMonths(from, n + 1) <= to) n += 1;
  return Math.max(0, n);
}

/** 근속 n년차(1년 이상)의 법정 연차 일수 — 15일에서 시작해 2년마다 +1일, 25일 상한. */
export function annualGrantFor(yearIndex: number): number {
  if (yearIndex < 1) return 0;
  return Math.min(25, 15 + Math.floor((yearIndex - 1) / 2));
}

export type LeavePeriod = {
  /** 근속 구간 번호. 0 = 입사 1년 미만(월 단위 적립), 1 = 1년차(15일), 3 = 3년차(16일) … */
  yearIndex: number;
  /** 이 연차를 쓸 수 있는 구간(둘 다 포함). 예: 2026-08-16 ~ 2027-08-15 */
  start: string;
  end: string;
  /** 이 구간에 부여된 연차 일수(1년 미만은 기준일까지 채운 개월 수, 최대 11). */
  granted: number;
  /** 1년 미만 = 월 단위로 늘어나는 구간인가(화면 문구가 갈린다). */
  monthly: boolean;
  /** 1년 미만일 때 채운 개월 수(= granted). 그 외 null. */
  monthsWorked: number | null;
  /** 화면용 한글 라벨 — "입사 1년 미만" / "3년차". raw 값을 그대로 내보내지 않기 위한 단일 소스. */
  label: string;
};

/**
 * `targetDate`가 속한 연차 구간과 그 시점의 부여 일수.
 *
 * @param hireDate  입사일(users.hire_date). 없으면 null — 호출부가 "입사일 미등록"으로 안내한다.
 * @param targetDate 판정할 날짜(휴가 시작일 또는 오늘).
 * @param today     오늘. **1년 미만 적립을 어느 시점까지 인정할지**를 정한다 —
 *                  기준일 = clamp(max(오늘, targetDate), 구간 시작, 구간 끝).
 *                  · 앞당겨 신청(미래 날짜) = 그 날 기준으로 쌓일 연차까지 인정(그 날엔 실제로 있다).
 *                  · 지난 구간 조회 = 구간 끝 기준(이미 끝난 구간은 만액 적립).
 */
export function resolveLeavePeriod(
  hireDate: string | null | undefined,
  targetDate: string,
  today: string = targetDate,
): LeavePeriod | null {
  if (!hireDate || !parse(hireDate) || !parse(targetDate)) return null;

  // 입사 전 날짜 — 첫 구간을 0일로 돌려준다(입사 예정자 화면이 빈손이 되지 않게).
  const effective = targetDate < hireDate ? hireDate : targetDate;
  const yearIndex = Math.floor(completedMonths(hireDate, effective) / 12);
  const start = addYears(hireDate, yearIndex);
  const end = dayBefore(addYears(hireDate, yearIndex + 1));

  const later = today > targetDate ? today : targetDate;
  const ref = later < start ? start : later > end ? end : later;

  if (yearIndex === 0) {
    const months = targetDate < hireDate ? 0 : Math.min(11, completedMonths(hireDate, ref));
    return {
      yearIndex,
      start,
      end,
      granted: months,
      monthly: true,
      monthsWorked: months,
      label: "입사 1년 미만",
    };
  }
  return {
    yearIndex,
    start,
    end,
    granted: annualGrantFor(yearIndex),
    monthly: false,
    monthsWorked: null,
    label: `${yearIndex}년차`,
  };
}

/** 구간 표기 — "2026-08-16 ~ 2027-08-15". 화면·결재 문서가 같은 문자열을 쓰도록 여기 한 곳. */
export function leavePeriodLabel(p: LeavePeriod): string {
  return `${p.start} ~ ${p.end}`;
}
