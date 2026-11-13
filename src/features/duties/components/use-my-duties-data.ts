"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DutyPayload, DutyStripSummary, LoadedDuties } from "./my-duties-types";

const REFRESH_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
type Controller = { refresh: () => Promise<void>; list: (date: string) => Promise<void> };

/** 목록을 비우지 않는 갱신. 신호·타이머·돌아오기를 같은 경로로 모으고, 진행 중 신호는 끝에 한 번 반영한다. */
export function useMyDutiesData(initial: DutyStripSummary, open: boolean) {
  const [summary, setSummary] = useState(initial);
  const [loaded, setLoaded] = useState<LoadedDuties | null>(null);
  const [failedDate, setFailedDate] = useState<string | null>(null);
  const dateRef = useRef(initial.date);
  const openRef = useRef(open);
  const control = useRef<Controller | null>(null);
  const refresh = useCallback(() => { void control.current?.refresh(); }, []);
  const retry = useCallback(() => { void control.current?.list(dateRef.current); }, []);

  useEffect(() => {
    let alive = true;
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false, again = false;
    let listFlight: Promise<void> | null = null;
    let listAgain = false, wantedDate = dateRef.current;
    let lastPayload = "";
    const read = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<T>;
    };
    const list = (date: string): Promise<void> => {
      wantedDate = date;
      if (listFlight) { listAgain = true; return listFlight; }
      listFlight = (async () => {
        do {
          listAgain = false;
          const requestedDate = wantedDate;
          try {
            const payload = await read<DutyPayload>(`/api/duties/mine?date=${requestedDate}`);
            if (payload.date !== requestedDate) throw new Error("Unexpected duty date");
            if (alive && requestedDate === dateRef.current) {
              const signature = JSON.stringify(payload);
              const unchanged = signature === lastPayload;
              lastPayload = signature;
              // 같은 자료는 재사용하되 기한 판정 시각은 갱신한다. 반·월간 탭·스크롤의 컴포넌트는 그대로다.
              setLoaded((cur) => ({ payload: unchanged && cur ? cur.payload : payload, at: Date.now() }));
              setFailedDate(null);
            }
          } catch {
            if (alive && requestedDate === dateRef.current) setFailedDate(requestedDate);
          }
        } while (alive && listAgain && openRef.current);
      })().finally(() => { listFlight = null; });
      return listFlight;
    };
    const counts = async () => {
      try {
        const next = await read<Omit<DutyStripSummary, "lang">>("/api/duties/summary");
        if (!alive) return;
        dateRef.current = next.date;
        setSummary((cur) => {
          const updated = { ...next, lang: cur.lang };
          return JSON.stringify(cur) === JSON.stringify(updated) ? cur : updated;
        });
      } catch { /* 마지막으로 확인한 숫자를 유지하고 다음 신호·타이머에 재시도한다. */ }
    };
    const tick = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      if (busy) { again = true; return; }
      busy = true;
      if (timer) { clearTimeout(timer); timer = null; }
      // 두 GET 모두 장부 맞춤을 하므로 숫자 → 목록 순서로 읽는다(동시 요청이 맞춤 잠금에 져 옛 목록을 읽지 않게).
      // 숫자 조회가 실패해도 목록은 갱신한다. 자정에는 숫자가 확정한 새 날짜로 받는다.
      await counts();
      if (alive && openRef.current) await list(dateRef.current);
      busy = false;
      if (!alive) return;
      if (again) { again = false; void tick(); }
      else timer = setTimeout(tick, REFRESH_MS);
    };
    control.current = { refresh: tick, list };
    timer = setTimeout(tick, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      lifetime.abort();
      control.current = null;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    openRef.current = open;
    if (open) void control.current?.list(dateRef.current);
  }, [open]);

  return {
    summary,
    loaded: loaded?.payload.date === summary.date ? loaded : null,
    failed: failedDate === summary.date,
    refresh,
    retry,
  };
}
