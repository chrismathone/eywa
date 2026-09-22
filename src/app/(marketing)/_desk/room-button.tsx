"use client";

import { useEffect, useState, type ReactNode } from "react";
import { OPEN_ROOM_EVENT, ROOMS_EVENT, type OpenRoomDetail, type RoomsDetail } from "./room-events";
import type { RoomId } from "./rooms";

/** 모형 작업 공간의 방을 여는 버튼(헤드라인·역할 카드). 누르면 작업 공간으로 스크롤한다. */
export function RoomButton({ room, className, children }: { room: RoomId; className?: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const onRooms = (e: Event) => setOn((e as CustomEvent<RoomsDetail>).detail.open.includes(room));
    window.addEventListener(ROOMS_EVENT, onRooms);
    return () => window.removeEventListener(ROOMS_EVENT, onRooms);
  }, [room]);
  const click = () => {
    window.dispatchEvent(new CustomEvent<OpenRoomDetail>(OPEN_ROOM_EVENT, { detail: { room } }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    document.getElementById("desk")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: mobile ? "start" : "center" });
  };
  return <button type="button" className={`${className ?? ""}${on ? " on" : ""}`} aria-pressed={on} onClick={click}>{children}</button>;
}
