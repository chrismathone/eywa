"use client";

import { MenuGlyph } from "@/components/icons/menu-glyph";
import { ROOM_ORDER, ROOMS, WIN_META, type RoomId, type WinType } from "./rooms";
import type { Win } from "./windows-state";

type Props = {
  wins: Win[];
  front: Win | null;
  onRoom: (room: RoomId) => void;
  onMenu: (type: WinType) => void;
};

/** 건물 안내판 = 메뉴. 방 이름을 누르면 그 방 창을 앞으로, 메뉴 칩을 누르면 그 화면을 연다. */
export function Directory({ wins, front, onRoom, onMenu }: Props) {
  const openType = new Set(wins.filter((w) => !w.min).map((w) => w.type));
  const roomCount = (r: RoomId) => wins.filter((w) => !w.min && WIN_META[w.type].room === r).length;
  const frontRoom = front ? WIN_META[front.type].room : null;
  const chip = (t: WinType) => {
    const isFront = front?.type === t;
    return (
      <button key={t} type="button" className={`dmenu${isFront ? " front" : openType.has(t) ? " open" : ""}`} onClick={() => onMenu(t)}>
        <MenuGlyph name={WIN_META[t].icon} size={15} />{WIN_META[t].label}
      </button>
    );
  };
  return (
    <nav className="directory" aria-label="건물 안내 — 메뉴">
      <div className="dir-head"><strong>건물 안내</strong><span>방을 누르면 창이 열립니다</span></div>
      {ROOM_ORDER.map((r) => {
        const R = ROOMS[r], n = roomCount(r);
        return (
          <div key={r} className={`room${r === frontRoom ? " active" : ""}`}>
            <button type="button" className="room-btn" onClick={() => onRoom(r)}>
              <span className="fl">{R.fl}</span><span className="nm">{R.name}</span>
              {n ? <span className="cnt">창 {n}</span> : null}
            </button>
            <div className="dmenus">{R.menus.map(chip)}</div>
          </div>
        );
      })}
      <div className="dir-foot">{chip("help")}</div>
    </nav>
  );
}
