/**
 * 최근 4주 **주별 등록/퇴원** — 순수 집계(IO 없음, Vitest).
 *
 * 설계서 §3의 둘째 차트: *"학원이 늘고 있나 줄고 있나"*. 상단 타일은 **수준**(지금 몇 명)을 말하고
 * 이 막대는 **방향**(늘고 있나)을 말한다 — 둘은 다른 질문이라 하나로 합칠 수 없다.
 *
 * 🔴 **등록 처리일과 수강 시작일을 섞지 않는다**(§8-5) — 여기서 세는 것은 `students.enrolled_at`
 *    (원장이 "이번 달 몇 명 들어왔나"로 읽는 값)이고, 수업이 언제 시작하는지(enrollments.start_date)와는
 *    다른 사실이다. 섞으면 이 차트와 학생목록이 다른 학원처럼 보인다.
 * 🔴 **주 경계는 앱 전역과 같은 월요일**이다 — 시간표·시트가 전부 월요일 시작이라 여기만 일요일로
 *    시작하면 같은 날이 다른 주에 들어간다.
 */

import { addDays, weekdayIndexOf } from "@/lib/date-kst";

export type WeeklyChangeBucket = {
  /** 그 주 월요일(YYYY-MM-DD). */
  monday: string;
  /** 표시용 짧은 라벨 — `9/1`. */
  label: string;
  enrolled: number;
  withdrawn: number;
};

/** 그 날짜가 속한 주의 월요일. */
export function mondayOf(ymd: string): string {
  // `weekdayIndexOf`는 0=일 … 6=토(앱 전역 규약) → 월요일까지 며칠 뒤로 갈지 계산한다.
  const dow = weekdayIndexOf(ymd);
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(ymd, -back);
}

/**
 * 최근 `weeks`주(이번 주 포함)의 주별 등록·퇴원 수.
 *
 * ⚠️ 창 **밖** 날짜는 버린다 — 조회가 넉넉히 가져와도 여기서 잘라야 막대 수가 흔들리지 않는다.
 * ⚠️ 빈 주도 **0으로 세운다**(막대가 사라지면 "그 주가 없었다"로 읽힌다).
 */
export function buildWeeklyChange(
  input: {
    /** 등록 처리일 목록(YYYY-MM-DD). */
    enrolledOn: readonly string[];
    /** 퇴원 처리일 목록(YYYY-MM-DD). */
    withdrawnOn: readonly string[];
  },
  today: string,
  weeks = 4,
): WeeklyChangeBucket[] {
  const thisMonday = mondayOf(today);
  const buckets = new Map<string, WeeklyChangeBucket>();
  for (let i = weeks - 1; i >= 0; i--) {
    const monday = addDays(thisMonday, -7 * i);
    const [, m, d] = monday.split("-");
    buckets.set(monday, { monday, label: `${Number(m)}/${Number(d)}`, enrolled: 0, withdrawn: 0 });
  }
  const add = (ymd: string, key: "enrolled" | "withdrawn") => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;
    const b = buckets.get(mondayOf(ymd));
    if (b) b[key] += 1; // 창 밖이면 버린다
  };
  for (const d of input.enrolledOn) add(d, "enrolled");
  for (const d of input.withdrawnOn) add(d, "withdrawn");
  return [...buckets.values()];
}

/** 창의 시작(가장 이른 월요일) — 조회 범위를 이 값 하나로 정해 화면과 쿼리가 안 갈리게 한다. */
export function weeklyChangeStart(today: string, weeks = 4): string {
  return addDays(mondayOf(today), -7 * (weeks - 1));
}
