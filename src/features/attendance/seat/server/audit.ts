import "server-only";
import { logAction, logActionAtDoor } from "@/features/audit/server/log";
import { SEAT_NAME, type SeatKey } from "../seat";
import type { SeatGateOk } from "./gate";

/**
 * 자리 출석부 쓰기의 감사로그 — **문(門)에 따라 행위자를 고른다**.
 *
 * 🔴 로그인 문(메뉴·담당)은 그 사람(`logAction`), **비로그인 PIN 문**은 `logActionAtDoor` — 로그인된 기기면 그 계정,
 *    아니면 `"랩실 PIN(비로그인)"`. 종전엔 전부 `logAction`이라 PIN 쓰기가 **조용히 한 줄도 안 남았다**(`logAction`은
 *    사용자가 없으면 건너뛴다) — 원장 2026-09-10 *"기능이 추가되거나 변동되는건 모두 감사로그에 남도록"*과 어긋났다.
 * ⚠️ 이 파일은 `"use server"`가 아니다([[#119]]) — 서버 액션 파일이 import하는 헬퍼다.
 */
export async function logSeatAction(
  g: SeatGateOk,
  seat: SeatKey,
  args: Parameters<typeof logAction>[0],
): Promise<void> {
  if (g.via === "pin") {
    await logActionAtDoor({ tenantId: g.tenantId, doorName: `${SEAT_NAME[seat]} PIN(비로그인)` }, args);
    return;
  }
  await logAction(args);
}
