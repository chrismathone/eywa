/**
 * ECS 주간 랜딩의 **Shouting 칸** — 순수 집계(Vitest).
 *
 * 원장 2026-08-28: *"EiE반은 그 왼쪽에 샤우팅 체킹을 했나 안했나 확인 바로 가능하게. 영역 구분해서
 * 열 정렬되서 길이에 따라 정렬이 흐트러지지 않게 shouting 구역 따로."* +
 * *"샤우팅도 주단위 체크하면 되겠네 — 한 주 수업이 다 보이는거니까"*.
 *
 * 그래서 분모는 **작성률과 같은 것**(그 주 배정 교시)이다. 두 숫자가 같은 분모를 쓰면 `2/6 · 4/6`이
 * 한 줄에서 바로 비교된다 — 분모가 다르면 나란히 둔 것이 오히려 거짓 대조가 된다.
 *
 * 🔴 **EiE가 아닌 반은 `null`이다**(0이 아니라). 인재원 영어는 원장 지시로 Shouting 자체가 없어
 *    (2026-08-27) `0/6`으로 그리면 *"해야 하는데 안 했다"* 는 거짓말이 된다. 화면은 null이면 칸을
 *    **비워 두되 폭은 그대로 잡아** 열이 안 흐트러지게 한다.
 * ⚠️ 분자는 **배정 교시 안의 체크만** 센다 — 시간표가 바뀌어 스케줄에서 사라진 교시의 옛 체크까지
 *    세면 `7/6` 같은 숫자가 나온다(작성률 `filled`가 `scheduled`로 거르는 것과 같은 규약).
 * ⚠️ 이 값은 **표시 전용**이다. 급여·시수·작성률 어디에도 안 닿는다(Shouting은 0230a 체크 하나뿐).
 */

/** 집계에 필요한 최소 모양 — 서버 타입(`SheetLandingCard`)에 안 묶어 순수하게 테스트된다. */
export type LandingShoutingCount = {
  totalSlots: number;
  /** 그 주 체크된 교시 수. **EiE가 아니면 null**(칸을 비운다 — 위 🔴). */
  shoutingSlots: number | null;
};

export type LandingShoutingSummary = {
  /** Shouting 대상(EiE) 반 수 — 0이면 머리 줄에 이 항목을 아예 안 낸다. */
  classes: number;
  /** 대상 반의 그 주 배정 교시 합. */
  scheduled: number;
  /** 그중 체크된 교시 합. */
  checked: number;
  /** 0~100 정수. 분모가 0이면 0. */
  pct: number;
};

/** 한 반의 안전한 체크 수 — 분모를 넘지 않게 자른다(넘으면 `7/6`이 화면에 뜬다). */
export function shoutingCountOf(card: LandingShoutingCount): number | null {
  if (card.shoutingSlots === null) return null;
  const total = Math.max(0, card.totalSlots);
  return Math.min(Math.max(0, card.shoutingSlots), total);
}

/** 지금 보이는 목록의 Shouting 합 — 머리 줄 한 항목. */
export function summarizeShouting(cards: readonly LandingShoutingCount[]): LandingShoutingSummary {
  let classes = 0;
  let scheduled = 0;
  let checked = 0;
  for (const c of cards) {
    const n = shoutingCountOf(c);
    if (n === null) continue; // EiE가 아닌 반은 분모에도 안 들어간다
    classes += 1;
    scheduled += Math.max(0, c.totalSlots);
    checked += n;
  }
  return {
    classes,
    scheduled,
    checked,
    pct: scheduled > 0 ? Math.round((checked / scheduled) * 100) : 0,
  };
}
