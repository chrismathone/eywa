/**
 * 보기 단위(일간~연간) ↔ 링의 대응 — 순수. "어느 링이 지금 확대된 단위인가"를 링·라벨·요약이 같이 읽는다.
 *
 * 🔴 다른 링을 **흐리게 하지 않는다** — 파스텔 링을 반투명으로 내리면 글자까지 흐려져 연간 맥락을 잃는다.
 *    대신 활성 링만 라벨 알약을 채우고 링 경계에 가는 선을 두른다(정보는 지우지 않고 자리만 가리킨다).
 */
import type { ViewMode } from "./model";

export type RingKey = "quarter" | "year" | "month" | "week" | "day";

export function ringForMode(mode: ViewMode): RingKey {
  switch (mode) {
    case "year":
      return "year";
    case "quarter":
      return "quarter";
    case "month":
      return "month";
    case "week":
      return "week";
    case "day":
      return "day";
  }
}

export function ringActive(ring: RingKey, mode: ViewMode): boolean {
  const active = ringForMode(mode);
  // 분기 보기는 바깥 띠와 열두 달 링을 함께 켠다(분기는 달 셋의 묶음이라 링이 따로 없다).
  if (mode === "quarter") return ring === "quarter" || ring === "year";
  return active === ring;
}

/** 링을 눌렀을 때 넘어갈 보기 단위 — 달 칸을 누르면 월간, 주 칸은 주간, 하루 칸은 일간. */
export const MODE_OF_RING: Record<Exclude<RingKey, "quarter">, ViewMode> = {
  year: "month",
  month: "week",
  week: "day",
  day: "day",
};
