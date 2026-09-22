"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/public-site/brand-mark";
import { DeskCtx, type DeskCtxValue } from "./bits";
import { Dock, MobileTabs, SnapGhost, Wires } from "./desk-parts";
import { Directory } from "./directory";
import { ModelLayer } from "./model-layer";
import { OPEN_ROOM_EVENT, ROOMS_EVENT, type OpenRoomDetail, type RoomsDetail } from "./room-events";
import { HOTSPOTS, WIN_META, winSub, winTitle, type RoomId, type WinType } from "./rooms";
import { useDeskData, type SparkFn } from "./use-desk-data";
import { useDeskWindows } from "./use-desk-windows";
import { useWinDrag } from "./use-win-drag";
import { WinFrame } from "./win-frame";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 공개 랜딩의 '모형 속 작업 공간'(원장 선택 2026-09-22, 섞기 3+5). 학원 모형이 바탕화면이고, 방 점·건물 안내판을 누르면
 * 진짜로 끌고 붙이고 접는 AYWA 창이 모형 옆 하늘에 뜬다. 숫자는 예시 학원 한 벌에서 계산돼 창끼리 이어진다.
 */
export function Desk() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  // 층 사이로 숫자가 올라간다: 노란 불빛이 그 방 점에서 원장실 점으로 날아가고, 도착하면 운영실 숫자가 반짝인다.
  const spark = useCallback<SparkFn>((from, to, done) => {
    const el = modelRef.current;
    const arrive = () => {
      const dot = el?.querySelector<HTMLElement>(`.dot[data-room="${to}"]`);
      if (dot) { dot.classList.remove("got"); void dot.offsetWidth; dot.classList.add("got"); }
      done();
    };
    if (!el || typeof el.animate !== "function" || reduced()) { arrive(); return; }
    const W = el.clientWidth, H = el.clientHeight;
    const a = { x: (HOTSPOTS[from][0] / 100) * W, y: (HOTSPOTS[from][1] / 100) * H };
    const b = { x: (HOTSPOTS[to][0] / 100) * W, y: (HOTSPOTS[to][1] / 100) * H };
    const mx = (a.x + b.x) / 2 + (a.x < b.x ? -40 : 40), my = Math.min(a.y, b.y) - 30;
    const s = document.createElement("i");
    s.className = "spark";
    el.appendChild(s);
    const an = s.animate([
      { transform: `translate(${a.x}px,${a.y}px) scale(.5)`, opacity: 0 },
      { transform: `translate(${(a.x + mx) / 2}px,${(a.y + my) / 2}px) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${mx}px,${my}px) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${b.x}px,${b.y}px) scale(.7)`, opacity: 1 },
    ], { duration: 760, easing: "cubic-bezier(.45,0,.2,1)" });
    an.onfinish = () => { s.remove(); arrive(); };
  }, []);

  const { data, act } = useDeskData(spark);
  const { state, dispatch, mobile, front, openMenu, openRoom } = useDeskWindows(canvasRef, modelRef);
  const [hint, setHint] = useState(true);
  const touch = useCallback(() => { setHint(false); dispatch({ t: "touch" }); }, [dispatch]);
  const drag = useWinDrag(state, dispatch, touch);

  // 폰에선 창이 모형 아래라, 사람이 연 창이 보이게 탭 줄까지 내려 준다(처음 배치 때는 안 움직인다).
  const reveal = useCallback(() => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    requestAnimationFrame(() => canvasRef.current?.querySelector(".m-tabs")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }));
  }, []);
  const onRoom = (r: RoomId) => { setHint(false); openRoom(r); reveal(); };
  const onMenu = (t: WinType) => { setHint(false); openMenu(t); reveal(); };
  const openStudent = useCallback((n: string) => { setHint(false); dispatch({ t: "open", type: "stu", arg: n }); reveal(); }, [dispatch, reveal]);
  const openAtt = useCallback((k: string, d: number) => { setHint(false); dispatch({ t: "open", type: "att", arg: `${k}@${d}` }); reveal(); }, [dispatch, reveal]);
  const ctx = useMemo<DeskCtxValue>(() => ({ data, act, openStudent, openAtt }), [data, act, openStudent, openAtt]);

  // 페이지의 '데스크·원장실' 버튼과 역할 카드 → 방 열기. 열린 방 목록은 버튼 눌림 표시용으로 되돌려 보낸다.
  const openRoomRef = useRef(openRoom);
  useEffect(() => { openRoomRef.current = openRoom; });
  useEffect(() => {
    const h = (e: Event) => { setHint(false); openRoomRef.current((e as CustomEvent<OpenRoomDetail>).detail.room); };
    window.addEventListener(OPEN_ROOM_EVENT, h);
    return () => window.removeEventListener(OPEN_ROOM_EVENT, h);
  }, []);
  const openRooms = useMemo(() => new Set(state.wins.flatMap((w) => (!w.min && WIN_META[w.type].room ? [WIN_META[w.type].room!] : []))), [state.wins]);
  const roomsKey = [...openRooms].sort().join(",");
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<RoomsDetail>(ROOMS_EVENT, { detail: { open: (roomsKey ? roomsKey.split(",") : []) as RoomId[] } }));
  }, [roomsKey]);

  const visible = state.wins.filter((w) => !w.min).length;
  const att = state.wins.find((w) => w.id === "att:m2a@1");
  const frontRoom = front ? WIN_META[front.type].room : null;
  return (
    <DeskCtx.Provider value={ctx}>
      <div className="ws" id="desk" role="region" aria-label="AYWA 모형 작업 공간 예시 — 직접 조작할 수 있습니다">
        <div className="ws-bar">
          <span className="wmk"><BrandMark size={20} />AYWA<span>예시 학원 · 원생 12명</span></span>
          <span className="crumb">{front ? <><b>{winTitle(front.type)}</b> · {winSub(front.type, front.arg)} <span className="muted">· 창 {visible}개</span></> : <span className="muted">열린 창 없음 — 모형 전체가 보입니다</span>}</span>
          <span className="sp" />
          <button type="button" className="tool" onClick={() => { setHint(false); dispatch({ t: "tile" }); }}>창 정렬</button>
          <button type="button" className="tool opt" onClick={() => { setHint(false); dispatch({ t: "fold" }); }}>모두 접기</button>
          <button type="button" className="tool" onClick={() => { setHint(true); dispatch({ t: "reset" }); }}>처음 모습</button>
          <span className="clock">9월 22일 (화) 16:40</span>
          <span className="tag-ex">예시 화면</span>
        </div>
        <Directory wins={state.wins} front={front} onRoom={onRoom} onMenu={onMenu} />
        <div className="ws-canvas" ref={canvasRef} onPointerDownCapture={() => { if (!state.touched) dispatch({ t: "touch" }); }}>
          <ModelLayer modelRef={modelRef} openRooms={openRooms} frontRoom={frontRoom} onRoom={onRoom} />
          <MobileTabs wins={state.wins} frontId={front?.id ?? null} dispatch={dispatch} />
          <Wires wins={state.wins} geo={state.geo} frontId={front?.id ?? null} />
          <SnapGhost rect={drag.ghost} />
          {state.wins.map((w) => <WinFrame key={w.id} win={w} front={w.id === front?.id} snapping={drag.snapping === w.id} drag={drag} dispatch={dispatch} />)}
          {!mobile ? <Dock wins={state.wins} dispatch={dispatch} /> : null}
          {state.laid && !visible ? (
            <div className="ws-empty"><span>열린 창이 없습니다. 모형의 점을 눌러 보세요.</span><button type="button" onClick={() => dispatch({ t: "reset" })}>처음 모습으로</button></div>
          ) : null}
          {hint && !mobile && att && !att.min ? <div className="hint" style={{ left: att.x + 20, top: Math.max(4, att.y - 40) }}>제목줄을 잡고 끌어 보세요</div> : null}
        </div>
      </div>
      <div className="ws-foot">
        <span className="dk"><span className="k">끌기</span>제목줄을 잡아 옮기고, 좌우 끝에 놓으면 반쪽으로 붙습니다.</span>
        <span className="mb"><span className="k">누르기</span>모형의 점이나 건물 안내판을 누르면 모형 바로 아래에 그 방의 창이 열립니다.</span>
        <span><span className="k">연결</span>출석부 칸을 누르면 원장실 운영실과 시간표 숫자가 같이 바뀝니다.</span>
        <span className="legend"><span><i />창 닫힌 방</span><span><i className="o" />창 열린 방</span><span><i className="f" />지금 보는 방</span></span>
        <span className="plq">이름과 숫자는 모두 예시입니다</span>
      </div>
    </DeskCtx.Provider>
  );
}
