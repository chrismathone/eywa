"use client";

import type { Dispatch, PointerEvent as RPointerEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { ROOMS, WIN_META, winSub, winTitle } from "./rooms";
import { WinBody } from "./win-body";
import type { Win, WinAction } from "./windows-state";

type DragOps = {
  down: (e: RPointerEvent<HTMLElement>, w: Win, mode: "move" | "resize") => void;
  move: (e: RPointerEvent<HTMLElement>, w: Win) => void;
  up: (e: RPointerEvent<HTMLElement>) => void;
};
type Props = { win: Win; front: boolean; snapping: boolean; drag: DragOps; dispatch: Dispatch<WinAction> };

/** 떠 있는 창 한 장 — 제목줄(끌기·두 번 눌러 최대화)·접기/최대화/닫기·오른쪽 아래 모서리(크기). */
export function WinFrame({ win, front, snapping, drag, dispatch }: Props) {
  const meta = WIN_META[win.type], room = meta.room ? ROOMS[meta.room] : null, title = winTitle(win.type);
  const cls = ["win", front && "focus front", win.max && "max", snapping && "snapping"].filter(Boolean).join(" ");
  return (
    <section
      className={cls}
      hidden={win.min}
      aria-label={`${title} 창`}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDown={() => { if (!front) dispatch({ t: "focus", id: win.id }); }}
    >
      <div
        className="tb"
        onPointerDown={(e) => drag.down(e, win, "move")}
        onPointerMove={(e) => drag.move(e, win)}
        onPointerUp={drag.up}
        onPointerCancel={drag.up}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest(".ctl")) dispatch({ t: "max", id: win.id }); }}
      >
        <MenuGlyph name={meta.icon} size={17} />
        {room ? <span className="rm">{room.fl} {room.name}</span> : null}
        <span className="ttl"><b>{title}</b><span>{winSub(win.type, win.arg)}</span></span>
        <span className="ctl">
          <button type="button" className="mn" aria-label="접기" title="접기" onClick={() => dispatch({ t: "min", id: win.id, on: true })}><EyIcon name="minus" size={12} /></button>
          <button type="button" className="mx" aria-label="최대화" title="최대화" onClick={() => dispatch({ t: "max", id: win.id })}><EyIcon name="square" size={11} /></button>
          <button type="button" className="x" aria-label="닫기" title="닫기" onClick={() => dispatch({ t: "close", id: win.id })}><EyIcon name="close" size={12} /></button>
        </span>
      </div>
      <div className="wb"><WinBody type={win.type} arg={win.arg} /></div>
      <span
        className="grip"
        aria-hidden="true"
        onPointerDown={(e) => drag.down(e, win, "resize")}
        onPointerMove={(e) => drag.move(e, win)}
        onPointerUp={drag.up}
        onPointerCancel={drag.up}
      />
    </section>
  );
}
