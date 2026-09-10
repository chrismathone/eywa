/**
 * **KPI 타일 안 막대** — 숫자 하나로는 안 보이는 "얼마나 남았나"를 한 눈에 보이게 하는 조각(순수·Vitest).
 *
 * 원장 2026-09-10: *"대시보드를 좀 더 시각화 가능한지 검토, 텍스트를 최소한으로 줄이고"* +
 * *"대시보드의 목적은 '관리자'가 각종 메뉴를 들어가거나 일일이 물어보지 않아도 한눈에 오늘 현황을 파악하는것"*.
 *
 * 🔴 **차트 카드를 새로 세우지 않는다**(codex·grok 합의, 원장 승인) — 분포 차트는 "누구를 불러야 하는지"를
 *    안 알려 준다. 대신 **이미 있는 타일 안에 막대 한 줄**을 넣는다. 새 조회 0, 새 라이브러리 0.
 * 🔴 **막대는 이미 화면에 적힌 숫자만 그린다** — 새 사실을 만들지 않는다. 그래서 막대와 부제가 어긋날 수 없다.
 * ⚠️ 값을 모르면(조회 실패) **막대를 그리지 않는다** — 0%짜리 빈 막대는 "하나도 안 됐다"는 거짓 주장이다.
 */

/** 막대 한 조각 — 폭(%)과 의미. `tone`은 화면이 색으로 옮긴다(여기서 클래스를 정하지 않는다). */
export type BarSegment = { key: string; pct: number; tone: "positive" | "caution" | "critical" };

/**
 * 조각들을 **합이 100을 넘지 않게** 다듬는다.
 *
 * 🔴 반올림으로 100을 넘기면 마지막 조각이 줄 밖으로 밀려 **막대가 한 줄 더 생긴다**(칸 높이가 28px라
 *    그 순간 격자가 밀린다). 그래서 넘치는 만큼 **마지막 조각에서** 깎는다.
 * ⚠️ 아주 작은 값(0.4%)도 **최소 2%로 세운다** — 안 그러면 "1건 남았다"가 화면에서 사라진다.
 *    다만 실제 0은 0으로 둔다(없는 것을 있는 것처럼 그리지 않는다).
 */
export function normalizeSegments(raw: readonly BarSegment[]): BarSegment[] {
  const shown = raw
    .filter((s) => s.pct > 0)
    .map((s) => ({ ...s, pct: Math.max(2, Math.round(s.pct)) }));
  let total = shown.reduce((n, s) => n + s.pct, 0);
  for (let i = shown.length - 1; i >= 0 && total > 100; i -= 1) {
    const cut = Math.min(shown[i]!.pct - 2, total - 100);
    if (cut > 0) {
      shown[i]!.pct -= cut;
      total -= cut;
    }
  }
  return shown;
}

/**
 * 출결 입력 진행 — **반 단위**로 센다.
 *
 * 🔴 학생 수(8/59)를 막대로 쓰지 않는다 — 아직 수업 중인 반이 분모에 들어가 아침부터 빨갛다.
 *    원장이 봐야 하는 건 "아직 아무도 안 찍은 반이 몇 개인가"다(타일 주숫자와 같은 축).
 * ⚠️ 시작한 반이 0이면 빈 배열 — 오늘 잴 것이 없는 것과 다 찍은 것은 다르다.
 */
export function attendanceBar(v: { startedClasses: number; unmarkedClasses: number }): BarSegment[] {
  if (v.startedClasses <= 0) return [];
  const done = Math.max(0, v.startedClasses - v.unmarkedClasses);
  const unit = 100 / v.startedClasses;
  return normalizeSegments([
    { key: "recorded", pct: done * unit, tone: "positive" },
    { key: "unmarked", pct: v.unmarkedClasses * unit, tone: "critical" },
  ]);
}

/**
 * 수납 진행 — **건수**로 센다(완납 / 부분납 / 전액 미납).
 *
 * ⚠️ 타일의 주숫자(수납률)는 **금액 기준**이라 이 막대와 **축이 다르다**. 그래서 부제가 `금액 기준`이라고
 *    먼저 말하고, 막대에는 건수 축임을 알 수 있게 툴팁 문자열을 함께 만든다(아래 `paymentBarTitle`).
 * 🔴 축이 다른 두 값을 같은 칸에 두는 것이라, 둘 중 하나라도 라벨을 지우면 화면이 거짓말을 시작한다.
 */
export function paymentBar(v: {
  paidCount: number;
  partialCount: number;
  fullyUnpaidCount: number;
}): BarSegment[] {
  const total = v.paidCount + v.partialCount + v.fullyUnpaidCount;
  if (total <= 0) return [];
  const unit = 100 / total;
  return normalizeSegments([
    { key: "paid", pct: v.paidCount * unit, tone: "positive" },
    { key: "partial", pct: v.partialCount * unit, tone: "caution" },
    { key: "unpaid", pct: v.fullyUnpaidCount * unit, tone: "critical" },
  ]);
}

/** 수납 막대의 마우스 오버 설명 — 막대가 **건수** 축임을 말한다(주숫자는 금액 기준이라). */
export function paymentBarTitle(v: {
  paidCount: number;
  partialCount: number;
  fullyUnpaidCount: number;
}): string {
  const parts = [`완납 ${v.paidCount}건`];
  if (v.partialCount > 0) parts.push(`부분납 ${v.partialCount}건`);
  if (v.fullyUnpaidCount > 0) parts.push(`미납 ${v.fullyUnpaidCount}건`);
  return `건수 기준 — ${parts.join(" · ")}`;
}

/** 출결 막대의 마우스 오버 설명. */
export function attendanceBarTitle(v: { startedClasses: number; unmarkedClasses: number }): string {
  const done = Math.max(0, v.startedClasses - v.unmarkedClasses);
  return `시작한 ${v.startedClasses}개 반 중 ${done}개 입력 · ${v.unmarkedClasses}개 미기록`;
}
