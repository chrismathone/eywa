import "server-only";
import { MOVABLE_SEATS, SEAT_NAME, type SeatKey } from "../seat";
import { gateSeatWrite } from "./gate";

/**
 * 자리 **이동 계열**(반 묶음 배치 · 교시 선택)의 공통 문 — 자리 게이트 + 랩실 한정 + **공개 PIN 제외**.
 *
 * 🔴 **한 벌이다.** 배치(0254a)와 교시 선택(0255a)은 표가 다르지만 "누가 자리를 옮길 수 있나"는 같은
 *    질문이다 — 두 벌로 만들면 언젠가 한쪽만 조여지고, 그때 화면은 아무 말도 안 한다.
 * 🔴 **게이트는 출결과 같은 문**(`gateSeatWrite`) — 옮길 수 있는 사람과 찍을 수 있는 사람이 갈리면
 *    당번이 자리를 못 고친다.
 * 🔴 **비로그인 공개 PIN(`/seat/:key`)에서는 쓰지 않는다** — 원장이 *"이것도 감사로그에 남아야함"*을
 *    못박았는데 그 화면엔 로그인이 없어 `logAction`이 실행자를 못 읽는다. **남길 수 없는 동작은 열지 않는다.**
 *    ⚠️ 이 파일은 `"use server"`가 아니다([[#119]]) — 게이트가 서버 액션이 되면 화면에서 직접 부를 수 있고
 *    그 응답에 `tenantId`·`userId`가 실린다.
 */
export type SeatMoveGate = { userId: string; tenantId: string; via: "menu" | "duty" };

export async function gateSeatMoveWrite(
  seat: SeatKey,
  date: string,
): Promise<SeatMoveGate | { error: string }> {
  if (!MOVABLE_SEATS.includes(seat)) {
    return { error: `${SEAT_NAME[seat]}은 자리 이동을 쓰지 않습니다` };
  }
  const g = await gateSeatWrite(seat, date);
  if ("error" in g) return g;
  // 🔴 무기명(PIN) 쓰기는 감사로그를 남길 수 없다 — 위 머리 주석.
  if (g.via === "pin" || !g.userId) {
    return { error: "자리 이동은 로그인한 뒤에만 할 수 있습니다 — 출결 체크는 그대로 됩니다" };
  }
  return { userId: g.userId, tenantId: g.tenantId, via: g.via };
}
