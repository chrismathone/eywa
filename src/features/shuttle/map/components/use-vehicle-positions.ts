"use client";

import { useEffect, useState } from "react";

import { POLL_EVERY_MS, type VehiclePosition } from "../vehicle-position";

/**
 * 차량 위치를 `POLL_EVERY_MS`(10초)마다 다시 읽는다(0369a).
 * 🔑 실시간 신호(WebSocket)는 터널에서 안 붙는다 — 다시 읽기(폴링)가 어디서나 된다.
 * 🔑 탭이 가려져 있으면 쉬고, 다시 보이면 바로 한 번 읽는다(배터리·호출 절약).
 * ⚠️ 실패하면 직전 값을 그대로 둔다 — 화면에선 "N초 전"이 늘어나다가 '위치 끊김'으로 바뀐다.
 */
export function useVehiclePositions(fetcher: () => Promise<VehiclePosition[]>): { positions: VehiclePosition[]; now: number } {
  const [positions, setPositions] = useState<VehiclePosition[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetcher()
        .then((list) => {
          if (cancelled) return;
          setPositions(list);
          setNow(Date.now());
        })
        .catch(() => {
          if (!cancelled) setNow(Date.now());
        });
    };
    load();
    const timer = window.setInterval(load, POLL_EVERY_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [fetcher]);

  return { positions, now };
}
