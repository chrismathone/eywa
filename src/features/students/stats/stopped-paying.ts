/**
 * '지난 기록' **청구가 끊긴 학생**(원장 2026-10-21 *"다음 후보 계속 진행. 끝까지"* — 리뷰 후보 '메이크에듀 퇴원 기록'). 메이크에듀 퇴원일은
 * 2025년부터만 남아 있다(2024-03-18 하루에 이관 일괄 퇴원 4,014명 · 그 전은 거의 없음) — 2020년부터 보려면 **청구로** 센다.
 * 그달 수업료 청구가 살아 있고 **다음 두 달 청구가 없는** 학생 = 그달을 끝으로 그만둔 학생('실제 신규' — 등록 뒤 청구 — 와 짝). 순수 함수(Vitest).
 * ⚠️ 청구 기준이라 두 달 연속 청구가 없던 학생(휴원·방학 뒤 돌아온 학생 · 청구 누락)도 든다 — 그래서 '퇴원'이 아니라 이 이름이다(Codex 협의
 *    2026-10-21) · 마지막 청구달에 센다 · 다음 두 달이 **다 끝나지 않은** 달(`lastJudged` 뒤)은 셀 수 없어 칸을 비운다.
 * 2026-10-28: 메이크에듀 2025-05 전 EiE 수업료는 기록 **안**에 있었다 — '교재' 구분 줄('ROOKIES (LE) 월수목 Aaron' · 메모 '수강료')로
 *    청구됐다(원장 정정 · 다시 센 메이크에듀 줄은 EiE 칸을 2020-01부터 싣는다 — EiE 수업은 2021-07에 처음 나오고 그 전은 0 — `scripts/_makeedu/rebuild-history-monthly.mts`).
 */
const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * `paid` = 학생 → 수업료 청구가 살아 있는 달(YYYY-MM) 집합. 돌려주는 값 = 달 → 그달을 끝으로 청구가 끊긴 학생 수.
 * `months` 중 `lastJudged`(그 뒤 두 달이 다 지난 마지막 달) 이하만 싣는다 — 그 뒤 달은 아직 모른다.
 */
export function stoppedPayingByMonth(
  paid: ReadonlyMap<string, ReadonlySet<string>>,
  months: readonly string[],
  lastJudged: string,
  /**
   * 건너뛴 달(청구가 비정상으로 적어 비운 달 — 원장 2026-10-28 *"이상할정도로 적은달은 건너뛰는게 차라리 나음"*). 그달은 셈하지 않고(칸을 비운다),
   * '다음 두 달'도 그 달을 넘어 **자료가 있는 다음 두 달**로 본다 — 빈 달 때문에 학생이 끊긴 것으로 세지 않게.
   */
  skip: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of months) if (m <= lastJudged && !skip.has(m)) out.set(m, 0);
  const nextTwo = (m: string): [string, string] => {
    const found: string[] = [];
    for (let k = 1; found.length < 2 && k <= 24; k++) if (!skip.has(shift(m, k))) found.push(shift(m, k));
    return [found[0] ?? shift(m, 1), found[1] ?? shift(m, 2)];
  };
  for (const set of paid.values()) {
    for (const m of set) {
      if (!out.has(m)) continue;
      const [a, b] = nextTwo(m);
      if (!set.has(a) && !set.has(b)) out.set(m, out.get(m)! + 1);
    }
  }
  return out;
}

/**
 * 그 뒤 두 달이 **다 끝난** 마지막 달 — 이번 달(`thisMonth`)의 세 달 전. 이번 달은 아직 진행 중이라(청구가 더 나올 수 있다) 판정 창에 넣지 않는다
 * (Codex 협의 2026-10-21 — 10월 21일엔 7월까지).
 */
export function lastJudgedMonth(thisMonth: string): string {
  return shift(thisMonth, -3);
}
