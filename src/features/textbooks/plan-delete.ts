/**
 * **배정 삭제 때 함께 지울 미룸·당김 표식** — 순수(Vitest).
 *
 * 원장 2026-10-19: 배정을 지우고 다시 걸었는데 오전에 눌러 둔 미룸 표식이 남아, 새 배정을 가져오면 11/02가 비고
 * 11/05부터 들어갔다. 표식은 배정이 아니라 **(반, 날짜, 교시) 칸**에 붙어서 배정을 지워도 남는다.
 * 🔴 **다른 배정이 같이 쓰는 칸의 표식은 남긴다** — 같은 교시에 다른 교재(Listening 등)가 걸려 있으면 그 교재의
 *    일정도 그 표식으로 밀려 있다. 지우면 그 교재의 실제 줄은 그대로인데 일정만 되돌아가 둘이 어긋난다.
 * 🔑 칸 판정은 `slot_picks` 그대로 — 요일 없는 옛 값(`"17:20"`)은 모든 요일, 자리(`|1`)는 보지 않는다.
 *    요일·교시를 아예 안 고른 옛 배정(null)은 그 반 모든 칸을 쓰는 것으로 본다.
 */
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import { parseSlotPick } from "./lesson-schedule";

/** 그 배정이 이 칸(날짜·교시)을 쓰나. `picks === null` = 전부. */
export function picksCover(picks: readonly string[] | null, date: string, slot: string): boolean {
  if (picks === null) return true;
  const dow = dowKeyOf(date);
  return picks.some((v) => {
    const p = parseSlotPick(v);
    return !!p && p.start === slot && (p.dow === null || p.dow === dow);
  });
}

/**
 * @param markerKeys 그 반의 표식 칸(`"YYYY-MM-DD|HH:MM"`) — 호출부가 지울 날짜 이후로 이미 좁혔다.
 * @param mine       지우는 배정의 `slot_picks`.
 * @param others     그 반에 남는 다른 배정들의 `slot_picks`.
 */
export function markersToClear(
  markerKeys: readonly string[],
  mine: readonly string[] | null,
  others: readonly (readonly string[] | null)[],
): string[] {
  return markerKeys.filter((k) => {
    const [date, slot] = k.split("|") as [string, string];
    return picksCover(mine, date, slot) && !others.some((o) => picksCover(o, date, slot));
  });
}
