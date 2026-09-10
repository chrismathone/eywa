/**
 * **구성 막대**(가로) — "우리 학원이 지금 어떤 모양인가"를 메뉴에 안 들어가고 보는 조각(순수·Vitest).
 *
 * 원장 2026-09-10: 참고 이미지(HR 대시보드)를 **두 번** 제시 → *"디자인을 너무 무시한거 아냐? 전혀
 * 디자인 안맞네"* + *"이 공간낭비 어쩔꺼야"*. 그 레퍼런스의 뼈대는 **위 KPI 칩 줄 + 아래 차트 격자**이고,
 * 첫 차트가 `Headcount by Dept`(부서별 인원 가로 막대)다. 학원에서 그에 대응하는 것이 **학년별 재원생**이다.
 *
 * 🔴 **라이브러리를 쓰지 않는다** — 이 화면은 바탕화면이라 차트 청크를 기다리면 안 된다(B5).
 *    가로 막대는 폭 %를 가진 div 몇 개다.
 * 🔴 **도넛·파이가 아니다** — 길이는 눈으로 비교되지만 각도는 안 된다(그래서 앞선 자문도 도넛을 뺐다).
 * ⚠️ **학년 라벨은 학원설정이 단일 소스**다 — 여기서는 이미 라벨이 된 문자열만 받는다(코드에 학년을 적지 않는다).
 */

/** 막대 한 줄 — 이미 라벨이 된 이름과 값. */
export type CompositionRow = { label: string; value: number };

/** 화면에 그릴 줄 — 폭(%)이 계산되어 있다. */
export type CompositionBar = { label: string; value: number; pct: number };

/**
 * 값이 큰 순으로 정렬하고 **가장 큰 값을 100%로** 잡아 폭을 낸다.
 *
 * 🔴 합계 대비 비율이 아니라 **최댓값 대비**다 — 학년이 12개면 합계 대비는 전부 8% 근처라 막대가
 *    다 똑같아 보인다(비교가 목적인데 비교가 안 된다). 최댓값 기준이면 길이 차이가 그대로 읽힌다.
 * ⚠️ 그래서 **막대 옆에 실제 수를 반드시 적는다**(호출부) — 폭만으로는 "몇 명인가"를 알 수 없다.
 * ⚠️ 값이 0인 줄은 **버리지 않는다** — "그 학년이 0명"은 사실이고, 감추면 학년이 사라진 것처럼 보인다.
 *    다만 폭은 0이라 이름과 숫자만 남는다.
 * 🔴 상한(`limit`)을 두되 **잘린 만큼을 호출부가 말할 수 있게** 전체 길이를 함께 돌려준다 — 상한 걸린
 *    배열의 길이를 건수로 쓰면 34명이 영원히 "30"이 된다([[#89]]).
 */
export function toCompositionBars(
  rows: readonly CompositionRow[],
  limit = 8,
): { bars: CompositionBar[]; total: number; hiddenCount: number; hiddenValue: number } {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "ko"));
  const max = sorted.reduce((n, r) => Math.max(n, r.value), 0);
  const shown = sorted.slice(0, limit);
  const hidden = sorted.slice(limit);
  return {
    bars: shown.map((r) => ({
      label: r.label,
      value: r.value,
      pct: max > 0 ? Math.round((r.value / max) * 100) : 0,
    })),
    total: sorted.reduce((n, r) => n + r.value, 0),
    hiddenCount: hidden.length,
    hiddenValue: hidden.reduce((n, r) => n + r.value, 0),
  };
}

/**
 * 라벨별로 센다 — 라벨이 비면 **"미지정"**으로 모은다.
 * 🔴 빈 값을 버리지 않는다 — 학년이 안 적힌 학생이 있다는 사실 자체가 데스크가 고쳐야 할 일이다
 *    (버리면 합계가 재원생 수와 안 맞아 "왜 다르지"가 된다).
 */
export const UNSET_LABEL = "미지정";

export function countByLabel(values: readonly (string | null | undefined)[]): CompositionRow[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = (v ?? "").trim() || UNSET_LABEL;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}
