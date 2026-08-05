/**
 * 추세선 눈금 자동 조정 — 기간이 길어져도 점 개수가 안 늘어나게 월→분기→연으로 묶는다.
 *
 * 🔴 원장 2026-08-05: *"빡빡해질 수록 더 간격을 넓히는 말그대로 전체 추세선이 될 수 있게.
 * 스마트하게 전체에서는 구현하도록."* — 전체 기간을 월별로 그리면 지금도 44점이고 해마다 12점씩
 * 늘어난다. 3년 뒤엔 80점이 되어 선이 톱니처럼 보인다. **점 수를 상한에 묶는 게 유일한 해법**이다.
 *
 * ⚠️ 묶을 때 **비율을 평균 내지 않는다** — 분기 전환율은 "그 분기 등록 합 ÷ 상담 합"이다.
 * 월별 전환율 3개를 평균 내면 상담이 1건인 달이 100건인 달과 같은 무게를 갖는다(작은 달이 전체를
 * 흔든다). 합을 먼저 내고 그다음 나눈다.
 */

export type TrendPoint = {
  /** 원본 월 키(YYYY-MM) 중 그 묶음의 첫 달 — 정렬·키에 쓴다. */
  key: string;
  label: string;
  total: number;
  enrolled: number;
  /** 등록 전환율(%). 분모 0이면 null — 0%로 그리면 "다 놓쳤다"로 읽힌다. */
  rate: number | null;
};

export type TrendGranularity = "month" | "quarter" | "year";

/** 화면에 두고 싶은 점 개수 상한. 넘으면 한 단계 굵게 묶는다. */
const MAX_POINTS = 26;

export function pickGranularity(monthCount: number): TrendGranularity {
  if (monthCount <= MAX_POINTS) return "month";
  if (monthCount <= MAX_POINTS * 3) return "quarter"; // 분기로 묶으면 1/3
  return "year";
}

type MonthLike = { month: string; total: number; enrolled: number };

/**
 * 월별 데이터를 지정 단위로 묶는다.
 * @param labelYearOnJan 월 단위일 때 1월에만 연도를 표시할지(전체 기간 축이 `1월…12월` 반복이라
 *   어느 해인지 알 수 없던 문제 — 해가 바뀌는 지점만 표시한다).
 */
export function bucketTrend(
  months: MonthLike[],
  granularity: TrendGranularity,
  labelYearOnJan = false,
): TrendPoint[] {
  const acc = new Map<string, { key: string; label: string; total: number; enrolled: number }>();
  for (const m of months) {
    const y = m.month.slice(0, 4);
    const mo = Number(m.month.slice(5, 7));
    let bucketKey: string;
    let label: string;
    if (granularity === "year") {
      bucketKey = y;
      label = `${y.slice(2)}년`;
    } else if (granularity === "quarter") {
      const q = Math.floor((mo - 1) / 3) + 1;
      bucketKey = `${y}-Q${q}`;
      // 1분기에만 연도를 붙여 해 경계를 보이게 한다.
      label = q === 1 ? `${y.slice(2)}년 1Q` : `${q}Q`;
    } else {
      bucketKey = m.month;
      label = labelYearOnJan ? (mo === 1 ? `${y.slice(2)}년` : "") : `${mo}월`;
    }
    const cur = acc.get(bucketKey);
    if (cur) {
      cur.total += m.total;
      cur.enrolled += m.enrolled;
    } else {
      acc.set(bucketKey, { key: bucketKey, label, total: m.total, enrolled: m.enrolled });
    }
  }
  return [...acc.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((b) => ({
      ...b,
      // 🔴 합을 먼저 내고 나눈다(위 주석) — 월별 비율의 평균이 아니다.
      rate: b.total > 0 ? Math.round((b.enrolled / b.total) * 100) : null,
    }));
}
