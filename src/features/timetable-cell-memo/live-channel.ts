/**
 * 칸 메모 **실시간 반영** 규약 — 순수 모듈. 셔틀 실시간([`live-channel.ts`](../shuttle/live/live-channel.ts))과 같은 결이다.
 *
 * 🔑 broadcast를 쓴다(`postgres_changes` 아님) — 메모 표는 정책 0개(서버 키만)라 postgres_changes가 브라우저로
 *    오지 않고, broadcast는 DB 설정이 0이다(수정중 presence가 같은 WebSocket을 쓴다).
 * 🔴 **payload에 메모 내용을 싣지 않는다**(public 채널 전제) — "바뀌었다"는 신호만 보내고, 받는 쪽이
 *    자기 권한으로 다시 읽는다(GET `/api/timetable/cell-memos` — 같은 문 `memoSheetAccess`).
 * 🔑 채널을 **주까지 갈라 둔다** — 메모는 날짜 칸에만 서니, 다른 주를 보는 화면을 깨울 이유가 없다.
 */

export const CELL_MEMO_EVENT = "cell-memo-changed";

export function cellMemoChannel(tenantId: string, subject: string, weekMonday: string): string {
  return `timetable-cell-memo:${tenantId}:${subject}:${weekMonday}`;
}

export type CellMemoPayload = { sender: string; at: number };

/** 낯선 모양이 와도 화면이 죽지 않게 — 채널은 누구나 아무거나 보낼 수 있는 자리다. */
export function isCellMemoPayload(v: unknown): v is CellMemoPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.sender === "string" && typeof p.at === "number";
}

/** 탭(화면)마다 하나 — 내가 보낸 신호로 나를 다시 읽지 않게. */
export function newMemoSenderId(random: () => number = Math.random): string {
  return `m${Math.floor(random() * 1e9).toString(36)}${Date.now().toString(36)}`;
}
