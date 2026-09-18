/**
 * 월별 출석부 생애주기 표식(신입·퇴원·반이동·종강)을 **어느 날짜 칸에 얹나** — 순수 규칙(Vitest).
 *
 * 원장 2026-09-18: *"나는 양옆의 회색 셀에다가 라벨을 얹고 싶었는데"* · *"양옆에 회색셀이 없으면 따로 표시하지말도록"*.
 *
 * 🔑 회색 칸 = **수강 기간 밖**(그 반 소속이 아닌 날)이면서 **값이 없는** 칸. 호출부가 `isFree(date)`로 준다.
 * - 시작 표식(신입·반이동 들어옴) = 첫 수업일 **바로 왼쪽** 칸. 칸 오른쪽 끝에 붙어 **왼쪽**으로 넘친다.
 * - 끝 표식(퇴원·반이동 나감·종강) = 끝난 뒤 **첫 회색 칸**. 칸 왼쪽 끝에 붙어 **오른쪽**으로 넘친다.
 *   · 반이동 나감은 그날 이미 새 반이라(RPC `옛 end_date = 새 start_date`) 그 날짜 칸이 곧 회색이다.
 *   · 퇴원·종강은 그날까지 다녀서 **다음 날**이 회색이다.
 * 🔴 **값 칸에는 절대 얹지 않는다** — 처음엔 그 날짜 칸 자체에 얹었다가 출결 값("1")을 덮었다.
 * 🔴 표식은 한 칸(28px)보다 넓어 옆 칸으로 넘친다 — 그래서 **넘치는 쪽 칸도 회색**이어야 얹는다.
 *    시작 쪽이 격자 첫 칸에 닿으면 왼쪽은 값 열(차이확인 등)이라 **그리지 않는다**. 끝 쪽이 격자 마지막 칸이면
 *    오른쪽은 고정 출석률 열(z-10)이 덮으므로 괜찮다.
 * 🔴 자리가 없으면 **그리지 않는다**(이름 옆으로 돌려보내지 않는다 — 원장 지시).
 */
import type { LifecycleBadge } from "./enrollment-span";

export type PlacedBadges = {
  badges: LifecycleBadge[];
  /** `end` = 칸 오른쪽 끝에 붙어 왼쪽으로 넘침(시작 표식) · `start` = 왼쪽 끝에 붙어 오른쪽으로 넘침(끝 표식). */
  align: "start" | "end";
};

const START_KINDS: ReadonlySet<LifecycleBadge["kind"]> = new Set(["new", "transferIn"]);

/**
 * @param gridDates 격자에 **실제로 그려진** 날짜(달 채움 칸 제외) — 오름차순.
 * @param isFree 그 날짜 칸이 회색(수강 기간 밖)이고 값이 없는가.
 */
export function placeLifecycleBadges(
  badges: readonly LifecycleBadge[],
  gridDates: readonly string[],
  isFree: (date: string) => boolean,
): Map<string, PlacedBadges> {
  const index = new Map(gridDates.map((d, i) => [d, i]));
  const out = new Map<string, PlacedBadges>();
  const put = (date: string, badge: LifecycleBadge, align: PlacedBadges["align"]) => {
    const cur = out.get(date);
    if (cur) {
      cur.badges.push(badge);
      return;
    }
    out.set(date, { badges: [badge], align });
  };

  for (const b of badges) {
    const i = index.get(b.date);
    if (i === undefined) continue; // 격자 밖(지난 달 등) — 놓을 칸이 없다.
    if (START_KINDS.has(b.kind)) {
      // 왼쪽 칸 + 넘칠 그 왼쪽 칸까지 회색이어야 한다.
      const at = gridDates[i - 1];
      const spill = gridDates[i - 2];
      if (at && spill && isFree(at) && isFree(spill)) put(at, b, "end");
      continue;
    }
    // 끝 표식 — 그 날짜 또는 다음 날 중 **첫 회색 칸**.
    for (const j of [i, i + 1]) {
      const at = gridDates[j];
      if (!at) break;
      if (!isFree(at)) continue;
      const spill = gridDates[j + 1];
      // 넘칠 오른쪽이 회색이거나 격자 끝(고정 출석률 열이 덮는다)일 때만.
      if (spill === undefined || isFree(spill)) put(at, b, "start");
      break;
    }
  }
  return out;
}
