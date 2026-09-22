import type { RoomId } from "./rooms";

/**
 * 페이지(서버 컴포넌트)의 버튼 → 모형 작업 공간(클라이언트) 사이 신호. 헤드라인 '데스크·원장실'과 역할 카드의
 * '모형에서 열기'가 이 이벤트로 방을 연다. 작업 공간은 열린 방 목록을 되돌려 보내 버튼이 눌린 표시를 한다.
 */
export const OPEN_ROOM_EVENT = "aywa-desk:open-room";
export const ROOMS_EVENT = "aywa-desk:rooms";
export type OpenRoomDetail = { room: RoomId };
export type RoomsDetail = { open: RoomId[] };
