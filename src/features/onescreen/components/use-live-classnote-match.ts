"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CnMatchMap } from "../classnote-match";
import {
  CN_LIVE_BOOST_FOR_MS,
  CN_LIVE_MIN_GAP_MS,
  cnLiveDelay,
  cnLiveUrl,
  type CnLiveResponse,
} from "../classnote-match-live";

/**
 * C.N 아이콘 지도를 **새로고침 없이** 최신으로 유지한다(원장 2026-11-04 — 규칙·주기는 classnote-match-live.ts).
 *
 *  · 화면이 보일 때만 묻는다 — 창(iframe)이 숨으면 부모가 `visibilityState`를 덮어 준다(frame-visibility.ts). 다시 보이면 바로 한 번.
 *  · 버전이 같으면 아무것도 안 바꾼다(같은 값으로 리렌더하지 않는다). 다르면 지도만 갈아 끼운다 — 입력 중인 초안·스크롤은 그대로.
 *  · 실패(네트워크·500·로그인 풀림)는 조용히 지난 값을 유지하고 다음 주기에 다시 묻는다.
 *  · 페이지가 새 지도를 내려 주면(prop이 바뀌면) 그게 이긴다 — 갱신 결과는 그 prop을 바탕으로 받은 것만 쓴다.
 *  · `boost()` = 발송이 막혀 서버가 그 반 동기화를 요청한 직후 — 5분 동안 짧은 주기로 본다.
 */
export function useLiveClassnoteMatch(
  initial: CnMatchMap | undefined,
  opts: { enabled: boolean; date: string; classIds: readonly string[] },
): { map: CnMatchMap | undefined; boost: () => void } {
  const [live, setLive] = useState<{ base: CnMatchMap | undefined; map: CnMatchMap } | null>(null);
  const map = live && live.base === initial ? live.map : initial;
  // 주기 콜백이 최신 prop·지도를 읽게 — ref 쓰기는 render가 아니라 effect에서(react-hooks/refs).
  const latest = useRef({ initial, map });
  useEffect(() => {
    latest.current = { initial, map };
  });
  const boostUntil = useRef(0);
  const reschedule = useRef<(() => void) | null>(null);
  // 배열은 매 렌더 새 참조 — 안정 문자열 키로(이펙트가 매번 재시작하면 주기가 초기화된다).
  const key = [...new Set(opts.classIds)].sort().join(",");
  const { enabled, date } = opts;

  useEffect(() => {
    if (!enabled || !key) return;
    const classIds = key.split(",");
    let cancelled = false;
    let timer: number | undefined;
    let inFlight: AbortController | null = null;
    let lastRun = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      if (!cancelled) timer = window.setTimeout(() => void run(), cnLiveDelay(Date.now(), boostUntil.current));
    };
    const run = async () => {
      if (cancelled || inFlight) return;
      // 안 보이는 동안은 묻지 않는다 — 다시 보일 때 visibilitychange가 깨운다.
      if (document.visibilityState === "hidden") return;
      lastRun = Date.now();
      const base = latest.current.initial;
      const known = latest.current.map?.version;
      const ctrl = new AbortController();
      inFlight = ctrl;
      try {
        const res = await fetch(cnLiveUrl({ date, classIds, known }), {
          cache: "no-store",
          credentials: "same-origin",
          signal: ctrl.signal,
        });
        if (res.ok) {
          const body = (await res.json()) as CnLiveResponse;
          if (!cancelled && body.map && body.version && body.version !== known) setLive({ base, map: body.map });
        }
      } catch {
        // 네트워크 끊김·중단 — 화면은 지난 값 그대로, 다음 주기에 다시.
      } finally {
        if (inFlight === ctrl) inFlight = null;
      }
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastRun < CN_LIVE_MIN_GAP_MS) return schedule();
      window.clearTimeout(timer);
      void run();
    };

    reschedule.current = () => {
      if (!inFlight) schedule(); // 도는 중이면 끝나면서 짧은 주기로 다시 잡는다
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      reschedule.current = null;
      window.clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, date, key]);

  const boost = useCallback(() => {
    boostUntil.current = Date.now() + CN_LIVE_BOOST_FOR_MS;
    reschedule.current?.();
  }, []);

  return { map, boost };
}
