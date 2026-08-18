/**
 * 카드가 **대표할 교시** 고르기 — 순수 함수(Vitest).
 *
 * 좌석표 칸은 반 × 학생 × 오늘 **하나**다(원장 2026-08-14). 그래서 하루에 방을 옮기는 반도 카드는
 * 한 장인데, 그 한 장이 **첫 교시**에 못박혀 있었다. 좌석표는 층 → 강의실로 묶으므로
 * ([`seating-floors.ts`](./seating-floors.ts)) 카드가 첫 방에 박히면 **그 반이 이후에 쓰는 방은
 * 화면에 존재하지 않는다.**
 *
 * 🔴 실측(2026-08-18 화, 원장 제보): 그 요일 활성 43개 반 중 **20개(47%)가 하루에 강의실을 옮긴다** —
 *    영어는 40분마다 랩실↔강의실을 도는 편성이 표준이다. 그 탓에 15:45에 **본원604·605·606이 통째로**
 *    좌석표에서 빠졌다(605를 쓰는 LS3a·KW2, 606을 쓰는 MEC1-4·PL3가 전부 **다른 방에서 하루를 시작**한다).
 *    같은 순간 교실뷰는 "지금 수업 중 11실"이라 정확히 적고 있었다.
 *
 * 고침은 카드를 쪼개는 게 아니라(쪼개면 같은 학생이 한 화면에 2~3번 나온다 — 위 결정을 뒤집는 일이다)
 * **그 한 장이 대표하는 교시를 첫 교시 → 지금 교시로 옮기는 것**이다.
 *
 * 🔴 **저장 축은 이 규칙과 무관하다.** 여기서 정하는 건 **어디에 그릴지**(방·시각·라벨)뿐이고,
 *    무엇을 쓸지는 [`slot-axis.ts`](./slot-axis.ts)가 그대로 정한다(영어 = 하루 첫 교시).
 *    폴백 교시를 '지금 교시'로 바꾸면 같은 (학생·반·날)에 교시가 다른 행이 둘 생길 수 있고,
 *    그 표는 시수(`session_units`) → 급여에 닿는다 — 화면은 그대로인데 돈만 조용히 달라진다.
 */
import type { NowBand } from "./now-band";
import type { SlotPhase } from "./signals";

/**
 * 대표 교시 판정에 필요한 최소 모양 — 시작시각과 서버가 계산한 두 판정.
 * `band`(`nowBandOf`)만으론 부족하다: 종료 뒤 10분 꼬리(`NOW_TAIL_MIN`)도 '지금'이라,
 * 반이 이미 다음 방으로 옮겨 갔는지는 `phase`(`slotPhase` — `ended` = 종료시각 경과)가 알려 준다.
 */
export type AnchorSlotLike = { slotStart: string; band: NowBand; phase: SlotPhase };

function earliestIndex<T extends AnchorSlotLike>(slots: readonly T[], keep: (slot: T) => boolean): number {
  let best = -1;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (!keep(slot)) continue;
    if (best < 0 || slot.slotStart < slots[best]!.slotStart) best = i;
  }
  return best;
}

function latestIndex<T extends AnchorSlotLike>(slots: readonly T[], keep: (slot: T) => boolean): number {
  let best = -1;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (!keep(slot)) continue;
    // `>=`가 아니라 `>` — 같은 시각이면 앞엣것(입력 순서에 기대지 않는다).
    if (best < 0 || slot.slotStart > slots[best]!.slotStart) best = i;
  }
  return best;
}

/**
 * 그 반의 오늘 교시들 중 **카드가 대표할 교시**의 자리(index). 빈 배열이면 -1.
 *
 * 1. **열려 있고 아직 안 끝난**(`band === "now"` && `phase !== "ended"`) 교시 중 가장 이른 것.
 *    · 연강(시작 10분 전 리드로 앞뒤가 함께 '지금')이면 **앞 교시가 대표** — 그래야 카드 시각이
 *      `spanAdjacentEnd`로 같은 방인 동안 뒤 교시까지 자연히 이어진다.
 *    · ⚠️ band만 보면 안 된다 — 종료 뒤 10분 꼬리도 '지금'이라, 15:40에 606으로 옮긴 반이
 *      15:50까지 랩실(15:00~15:40 교시)에 남는다. 뒤 교시가 이미 시작했으면 반은 거기에 있다.
 * 2. 없는데 '지금' 꼬리만 남았으면(전 '지금' 교시가 종료 직후 10분) 그중 **마지막 것** —
 *    "마지막으로 있었던 방"에서 출결을 마저 손보는 시각이다([`NOW_TAIL_MIN`](./now-band.ts)).
 * 3. 없으면 **아직 시작 안 한 교시**(`upcoming`·`later`) 중 가장 이른 것 — "다음에 그 방에 모인다".
 *    오전에 끝난 교시와 저녁 교시를 함께 가진 반이 오전 방에 남지 않게 한다.
 * 4. 그것도 없으면(전부 끝남) **마지막 교시** — "마지막으로 있었던 방".
 *
 * ⚠️ 지난 날짜 조회(`board.isToday === false`)는 `bandOf`가 전부 `past`를 주므로 늘 규칙 4다 →
 *    그 반의 **마지막 방** 하나로 정해진다. 놓친 날을 메우는 화면이라 그걸로 충분하다.
 * ⚠️ 입력 순서에 기대지 않는다(정렬 여부와 무관하게 `slotStart`로 고른다). 같은 시각이 둘이면 앞엣것.
 */
export function anchorSlotIndex<T extends AnchorSlotLike>(slots: readonly T[]): number {
  if (slots.length === 0) return -1;
  const open = earliestIndex(slots, (s) => s.band === "now" && s.phase !== "ended");
  if (open >= 0) return open;
  const tail = latestIndex(slots, (s) => s.band === "now");
  if (tail >= 0) return tail;
  const next = earliestIndex(slots, (s) => s.band === "upcoming" || s.band === "later");
  if (next >= 0) return next;
  return latestIndex(slots, () => true);
}
