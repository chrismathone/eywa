/**
 * 에이와 기록 판정 규칙 한 벌(원장 2026-10-20 '수업을 시작한 등록만' · '2026년 4월부터') — 순수 함수(Vitest).
 * 등록 막대(`record-coverage.ts` → `loadMonthlyChanges`)와 원생 통계 '지난 기록'(`server/history.ts`)이 **같은 판정 결과**를 쓴다
 * (적대 리뷰 2026-10-20: 두 곳이 따로 판정해 같은 화면의 등록 수가 갈렸다).
 */

export const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
};
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const shiftDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** 청구가 지점을 덮기 시작한 달 — 기준 = 3건 · 그 뒤 6개월 중 가장 많은 달의 20% · 창 전체 가장 많은 달의 5% 중 큰 값, 그 달부터 석 달 이어서. */
const COVERAGE_SHARE = 0.2;
const COVERAGE_GLOBAL_SHARE = 0.05;
const COVERAGE_MIN = 3;
const COVERAGE_AHEAD_MONTHS = 6;
const COVERAGE_RUN_MONTHS = 3;
/** 에이와 수강 기록이 갖춰진 달 — 그달 청구 학생 중 수강 시작 기록이 늦게 잡힌 학생이 이 비율 밑 · 판정에 드는 최소 학생 수. */
const TRUST_RATIO = 0.03;
const TRUST_MIN_SAMPLE = 20;
/** 반 수업을 이만큼 넘게 다녔으면 수업을 시작한 것으로 본다(청구·출석이 없는 학생의 근거). */
const CLASS_STARTED_DAYS = 7;

/**
 * 청구가 지점을 덮기 시작한 달 — 기준(3건 · **그 달부터 6개월 중 가장 많은 달의 20%** · 창 전체 가장 많은 달의 5% 중 큰 값)을 넘고, 그 뒤
 * 두 달도(지난달까지만 본다 — 이번 달은 아직 청구 중일 수 있다) 같은 기준을 넘는 첫 달. 청구가 없으면 null.
 *   · 학생이 늘어 온 지점도 시작 달이 뒤로 밀리지 않는다 — 기준의 중심이 '그 뒤 6개월'이라(적대 리뷰 2026-10-20: 창 전체에서 가장 많은 달을
 *     기준으로 하면 지점이 커질수록 시작 달이 밀려 이미 쓴 '지난 기록'이 지워졌다).
 *   · 옛 달 낱장 청구·오타 청구월·몇 건짜리 시범 청구 달(석 달을 못 잇거나 창 전체의 5%에 못 미친다)·한 번 청구하고 멈춘 달로
 *     앞당겨지지 않는다(적대 재리뷰 2026-10-20).
 * `counts`에 없는 달은 0건이다(달마다 건수만 넘기든 0건 달까지 넘기든 결과가 같다).
 */
export function coverageStartFromCounts(counts: ReadonlyMap<string, number>, thisMonth: string): string | null {
  const months = [...counts.keys()].filter((m) => m <= thisMonth).sort();
  const lastComplete = shiftMonth(thisMonth, -1);
  const globalFloor = Math.max(0, ...months.map((m) => counts.get(m) ?? 0)) * COVERAGE_GLOBAL_SHARE;
  for (const m of months) {
    let most = 0;
    for (let i = 0, k = m; i < COVERAGE_AHEAD_MONTHS; i++, k = shiftMonth(k, 1)) most = Math.max(most, counts.get(k) ?? 0);
    const floor = Math.max(COVERAGE_MIN, most * COVERAGE_SHARE, globalFloor);
    let run = true;
    for (let i = 0, k = m; i < COVERAGE_RUN_MONTHS && k <= lastComplete; i++, k = shiftMonth(k, 1)) run &&= (counts.get(k) ?? 0) >= floor;
    if ((counts.get(m) ?? 0) >= floor && run) return m;
  }
  return null;
}

/**
 * 에이와 수강 기록이 갖춰진 첫 달 — 청구가 덮은 달부터, 그달 청구 학생(20명 이상인 달만 판정) 중 **그달 말까지 수강 시작 기록이 없는**
 * (첫 수강 시작이 그 뒤) 학생이 3% 밑인 첫 달. 옮겨 오기 전 학생은 수강 시작일이 옮긴 날로 잡혀 그 전 달 재원생에서 빠진다
 * (실측 침산: 1월 389명 중 50 · 2월 31 · 3월 21 → 4월 4명 = 2026-04). 수강 기록이 아예 없는 학생은 늦게 잡힌 학생으로 세지 않는다.
 *   · 첫 판정 달부터 이미 갖춰져 있으면 **null**(자를 것이 없다 — 처음부터 에이와로 시작한 지점).
 *   · 청구가 창(36개월)보다 먼저 시작돼 처음을 볼 수 없으면(`from` = 창의 첫 달) 그 달(보수적으로 — 그 전은 판정할 수 없다).
 *     🔴 그런 지점은 시작이 창 안에 보이던 때 cron이 적어 둔 확정값(0386a)을 쓴다(`record-coverage.ts`).
 *   · 판정할 달이 없으면 null.
 */
export function trustedFrom(
  bills: readonly { student_id: string; period: string }[],
  firstStart: ReadonlyMap<string, string>,
  from: string,
  thisMonth: string,
  windowStart: string,
): string | null {
  const byMonth = new Map<string, Set<string>>();
  for (const b of bills) if (b.period >= from && b.period <= thisMonth) byMonth.set(b.period, (byMonth.get(b.period) ?? new Set()).add(b.student_id));
  let judged = 0;
  for (let m = from; m <= thisMonth; m = shiftMonth(m, 1)) {
    const ids = byMonth.get(m);
    if (!ids || ids.size < TRUST_MIN_SAMPLE) continue;
    const end = lastDay(m);
    const late = [...ids].filter((id) => (firstStart.get(id) ?? "") > end).length;
    judged++;
    if (late < ids.size * TRUST_RATIO) return judged === 1 ? (from === windowStart ? from : null) : m;
  }
  return null;
}

/** 반 수강 한 줄 — 시작일과 종료일(없으면 다니는 중). */
export type ClassSpan = { start: string; end: string | null };

/** 등록한 달 직전 두 달 안에 청구가 살아 있었나 — 그런 등록은 등록일만 고쳐진 재원생이다(아래 `startedRegistration`의 첫 판정). */
export function billedBeforeRegistration(reg: { id: string; enrolledAt: string }, billMonths: ReadonlyMap<string, readonly string[]>): boolean {
  const month = reg.enrolledAt.slice(0, 7);
  return (billMonths.get(reg.id) ?? []).some((m) => m >= shiftMonth(month, -2) && m < month);
}

/** 수업을 시작했다는 근거 — 학생마다 살아 있는 수업료 청구 달 · 출석한 날(정정 뒤 최신 기록) · 반 수강(휴원 수강은 넣지 않는다). */
export type StartEvidence = {
  billMonths: ReadonlyMap<string, readonly string[]>;
  attendedOn: ReadonlyMap<string, readonly string[]>;
  classSpans: ReadonlyMap<string, readonly ClassSpan[]>;
};

/**
 * 이 등록이 **수업을 시작한 등록**인가(원장 2026-10-20 *"신규원생이 그냥 등록상담만 했는데 등록했을 수도 있음"* → '수업을 시작한 등록만') —
 * 등록한 날 이후의 근거 하나가 있으면 시작한 것: 살아 있는 수업료 청구(등록한 달 이후 · 이번 달까지) · 출석(출석·지각·조퇴·보강) ·
 * 등록한 뒤 시작해 **실제로 일주일 넘게 다닌** 반 수강(시작부터 종료일·오늘 중 이른 날까지 — 청구·출석이 없어도 반에서 몇 주 다닌 학생,
 * 적대 리뷰 실측 3명). 🔴 시작 전에 취소된 수강(종료일 = 시작일)·며칠 만에 끝난 수강은 근거가 아니다(적대 재리뷰 2026-10-20).
 * 🔴 등록한 달 직전 두 달 안에 청구가 살아 있던 학생은 **등록일만 고쳐진 재원생**이라 새로 온 학생이 아니다(실측: 1월부터 매달 낸 학생이
 *    6월 등록으로 다시 적힘). 오래 쉬었다 돌아온 학생(직전 두 달 청구 없음)은 다시 등록한 것이다.
 */
export function startedRegistration(reg: { id: string; enrolledAt: string }, ev: StartEvidence, today: string): boolean {
  return registrationStartedOn(reg, ev, today) !== null;
}

/**
 * 수업 시작을 확인할 수 있는 첫날. 청구는 월 해상도라 등록일보다 앞선 날짜를 만들지 않는다.
 * D7의 추가 과목·재등록은 과목별 근거를 전달하고 allowExisting=true로 판정한다.
 * 기존 신규 등록 지표의 직전 두 달 제외 규칙은 기본값으로 보존한다.
 */
export function registrationStartedOn(reg: { id: string; enrolledAt: string }, ev: StartEvidence, today: string,
  allowExisting = false): string | null {
  if (reg.enrolledAt > today || (!allowExisting && billedBeforeRegistration(reg, ev.billMonths))) return null;
  const month = reg.enrolledAt.slice(0, 7);
  const dates: string[] = [];
  for (const m of ev.billMonths.get(reg.id) ?? []) {
    if (m >= month && m <= today.slice(0, 7)) dates.push(m === month ? reg.enrolledAt : `${m}-01`);
  }
  for (const day of ev.attendedOn.get(reg.id) ?? []) if (day >= reg.enrolledAt && day <= today) dates.push(day);
  for (const c of ev.classSpans.get(reg.id) ?? []) {
    if (c.start < reg.enrolledAt) continue;
    const confirmed = shiftDays(c.start, CLASS_STARTED_DAYS);
    const until = c.end && c.end < today ? c.end : today;
    if (confirmed <= until) dates.push(confirmed);
  }
  return dates.sort()[0] ?? null;
}


/** 학생마다 값을 모은다(근거 표 만들기). */
export function groupBy<T, V = string>(rows: readonly T[], key: (r: T) => string, value: (r: T) => V): Map<string, V[]> {
  const out = new Map<string, V[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(value(r));
    else out.set(k, [value(r)]);
  }
  return out;
}
