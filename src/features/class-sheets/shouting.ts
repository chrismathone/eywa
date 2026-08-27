/**
 * ECS 교시 체크 'Shouting' — 키 규약(순수).
 *
 * 원장 지시(2026-08-27): *"EiE는 샤우팅 체크박스로 변경 · 각 반이 샤우팅 했는지 체크"* /
 * *"인재원 영어는 샤우팅 그냥 삭제"*. 그래서 이 값은 **EiE 반에서만** 화면에 뜨고,
 * 수업계획 '구분'(skillAreas)에는 넣지 않는다(줄이 아니라 그 교시의 예/아니오다).
 *
 * 저장 앵커는 계획 줄과 **같다** — (반, 날짜, 교시 시각). 그래서 키도 같은 모양으로 쓴다.
 */
export const shoutingKey = (date: string, slotStart: string): string =>
  `${date}|${String(slotStart).slice(0, 5)}`;

/** 저장된 행들 → 화면이 쓰는 맵(체크된 것만 담는다 — 없는 키 = 안 함). */
export function shoutingMapOf(
  rows: readonly { flag_date: string; slot_start: string; shouting: boolean | null }[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const r of rows) {
    if (r.shouting) out[shoutingKey(String(r.flag_date).slice(0, 10), String(r.slot_start))] = true;
  }
  return out;
}
