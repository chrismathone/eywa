"use client";

import { useEffect, useReducer, useSyncExternalStore, type RefObject } from "react";
import { ROOMS, WIN_META, type RoomId, type WinType } from "./rooms";
import { EMPTY_WINS, frontOf, winsReducer } from "./windows-state";

/** 폰 폭(모형 아래 창 한 번에 하나) — CSS의 같은 경계(760px)와 맞춘다. */
export const MOBILE_QUERY = "(max-width: 760px)";
const subscribeMobile = (cb: () => void) => {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * 모형 작업 공간의 창 관리. 캔버스·모형 크기는 ResizeObserver 콜백이 리듀서로 넘기고(첫 측정·폰 전환·폭 변화 판단은
 * 리듀서 한 곳), 여기는 조작 이름만 붙인다.
 */
export function useDeskWindows(canvasRef: RefObject<HTMLDivElement | null>, modelRef: RefObject<HTMLDivElement | null>) {
  const [state, dispatch] = useReducer(winsReducer, EMPTY_WINS);
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);

  useEffect(() => {
    const canvas = canvasRef.current, model = modelRef.current;
    if (!canvas || !model) return;
    const measure = () => {
      const c = canvas.getBoundingClientRect(), m = model.getBoundingClientRect();
      if (!c.width) return;
      dispatch({
        t: "measure",
        mobile: window.matchMedia(MOBILE_QUERY).matches,
        geo: { W: canvas.clientWidth, H: canvas.clientHeight, model: { x: m.left - c.left, y: m.top - c.top, w: m.width, h: m.height } },
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    ro.observe(model);
    return () => ro.disconnect();
  }, [canvasRef, modelRef]);

  const open = (type: WinType, arg: string | null = null) => dispatch({ t: "open", type, arg });
  const openMenu = (type: WinType) => {
    const att = type === "att" ? state.wins.filter((w) => w.type === "att").sort((a, b) => b.z - a.z)[0] : undefined;
    if (att) dispatch({ t: "focus", id: att.id });
    else open(type);
  };
  const openRoom = (room: RoomId) => {
    const mine = state.wins.filter((w) => WIN_META[w.type].room === room).sort((a, b) => a.z - b.z);
    if (mine.length) dispatch({ t: "raiseMany", ids: mine.map((w) => w.id) });
    else open(ROOMS[room].menus[0]);
  };
  return { state, dispatch, mobile, front: frontOf(state), open, openMenu, openRoom };
}
