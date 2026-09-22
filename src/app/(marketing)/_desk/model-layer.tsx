"use client";

import Image from "next/image";
import { useState, type CSSProperties, type RefObject } from "react";
import { billTotals, todayProgress } from "./data";
import { HOTSPOTS, ROOM_ORDER, ROOMS, WIN_META, type RoomId } from "./rooms";
import { useDesk } from "./bits";

type Props = {
  modelRef: RefObject<HTMLDivElement | null>;
  openRooms: Set<RoomId>;
  frontRoom: RoomId | null;
  onRoom: (room: RoomId) => void;
};

/** 모형 그림(Blender 렌더) + 방 점 + 점 옆 실시간 배지. 그림과 점은 서버 렌더부터 보인다. */
export function ModelLayer({ modelRef, openRooms, frontRoom, onRoom }: Props) {
  const { data } = useDesk();
  const badge = (r: RoomId) => {
    if (r === "office") return "브리핑 07:00";
    if (r === "classA") { const p = todayProgress(data.att); return `출결 ${p.f}/${p.t}`; }
    if (r === "classB") return `보고서 ${data.os.sent ? 2 : 1}/2`;
    if (r === "desk") { const n = billTotals(data.paid).unpaid.length; return n ? `미납 ${n}건` : "미납 없음"; }
    const left = Object.keys(data.ride).filter((n) => !data.ride[n]).length;
    return left ? `하원 ${left}명 남음` : "하원 모두 탑승";
  };
  // 처음 값과 달라진 배지만 반짝인다(키가 바뀌어 새로 붙은 요소에만 bump — 첫 화면에서 한꺼번에 반짝이지 않게).
  const [initial] = useState(() => new Map(ROOM_ORDER.map((r) => [r, badge(r)])));
  return (
    <div className="model" ref={modelRef}>
      <Image
        className="img"
        src="/landing/academy-model.webp"
        alt="층을 띄워 안이 보이게 만든 3층 학원 모형. 1층 데스크의 상담·수납 창구, 2층 수학·영어 교실, 3층 원장실, 건물 앞 노란 셔틀버스."
        fill
        sizes="(max-width: 760px) 92vw, 44vw"
        preload
      />
      {ROOM_ORDER.map((r) => {
        const R = ROOMS[r], pos = { "--x": `${HOTSPOTS[r][0]}%`, "--y": `${HOTSPOTS[r][1]}%` } as CSSProperties;
        const cls = r === frontRoom ? " front" : openRooms.has(r) ? " open" : "";
        const text = badge(r);
        return [
          <button key={r} type="button" className={`dot${cls}`} style={pos} data-room={r} aria-pressed={openRooms.has(r)}
            aria-label={`${R.fl} ${R.name} — ${R.menus.map((m) => WIN_META[m].label).join(" · ")} 창 열기`} onClick={() => onRoom(r)}>
            {R.fl}<span className="wmark" aria-hidden="true" />
          </button>,
          <span key={`${r}-${text}`} className={`badge${R.side === "l" ? " l" : ""}${text !== initial.get(r) ? " bump" : ""}`} style={pos} aria-hidden="true">{text}</span>,
        ];
      })}
    </div>
  );
}
