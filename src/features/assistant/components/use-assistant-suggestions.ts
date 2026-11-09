"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { kstToday } from "@/lib/date-kst";
import {
  FALLBACK_SUGGESTIONS,
  haveKey,
  newSuggestionTexts,
  nextSuggestionCache,
  parseSuggestionCache,
  SUGGESTION_CACHE_KEY,
  type AssistantSuggestion,
  type SuggestionCache,
  type SuggestionsResponse,
} from "@/features/assistant/suggestions";

const API = "/api/assistant/suggestions";
/** '새로 고침' 연타 막기. */
const REFRESH_COOLDOWN_MS = 30_000;
/** 서버 응답을 기다리는 시간 — 넘으면 고정 문장(뼈대가 끝없이 돌지 않게). */
const FETCH_TIMEOUT_MS = 20_000;
const EMPTY: ReadonlySet<string> = new Set();

/**
 * 이 페이지에서 서버가 확인해 준 사람 표(scope) — 같은 사람·같은 날이면 다시 묻지 않고 브라우저 묶음을 바로 쓴다.
 * 🔴 확인 전에는 브라우저 묶음을 보이지 않는다(같은 컴퓨터를 쓰는 다른 사람의 지점 숫자가 비치지 않게).
 */
let confirmedScope: string | null = null;

function readCache(): SuggestionCache | null {
  try {
    return parseSuggestionCache(window.localStorage.getItem(SUGGESTION_CACHE_KEY));
  } catch {
    return null;
  }
}
function writeCache(cache: SuggestionCache) {
  try {
    window.localStorage.setItem(SUGGESTION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 저장 공간이 막혔다 — 다음에 다시 받는다.
  }
}

export type SuggestionsState = {
  status: "loading" | "ready";
  items: readonly AssistantSuggestion[];
  /** NEW 표시를 붙일 글(직전 묶음에 없던 것). */
  fresh: ReadonlySet<string>;
  /** 이 묶음의 한국 날짜(고정 문장이면 null). */
  day: string | null;
  refreshing: boolean;
  /** '새로 고침'을 지금 누를 수 있나(연타 막기). */
  canRefresh: boolean;
  refresh: () => void;
};

/**
 * 첫 화면 추천 질문 — 원장 2026-11-06 *"새 질문은 매일 한번 업데이트 필요할때마다 업데이트해주고"*.
 * 하루 한 번(한국 날짜가 바뀌면) 서버에서 받고, 같은 날은 브라우저 묶음을 쓴다. '새로 고침'은 다시 센다.
 * 🔴 판은 한 번 열면 계속 붙어 있다(keepMounted) — 판을 열 때 정한 `today`가 바뀌면 다시 받는다(어제 묶음이 남지 않게 · 적대 리뷰 2026-11-09).
 * NEW = 묶음이 바뀐 그날, 직전 묶음에 없던 주제(`newSuggestionTexts`). 실패하면 고정 문장(저장하지 않는다 · NEW 없음) — 보던 좋은 묶음은 덮지 않는다.
 */
export function useAssistantSuggestions(enabled: boolean, today: string): SuggestionsState {
  const [state, setState] = useState<{ status: "loading" | "ready"; items: readonly AssistantSuggestion[]; fresh: ReadonlySet<string>; day: string | null }>(() => {
    const cache = typeof window === "undefined" ? null : readCache();
    const day = today || kstToday();
    if (cache && confirmedScope === cache.scope && cache.day === day) {
      return { status: "ready", items: cache.items, fresh: newSuggestionTexts(cache, day), day: cache.day };
    }
    return { status: "loading", items: [], fresh: EMPTY, day: null };
  });
  const [refreshing, setRefreshing] = useState(false);
  /** 판을 열 때 정한 오늘 — 세지 못했을 때 지킬 묶음은 오늘 것뿐(어제 숫자·어제 NEW가 남지 않게 · 재리뷰 2026-11-09). */
  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);
  const [cooling, setCooling] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (refresh: boolean) => {
    const cache = readCache();
    const params = new URLSearchParams();
    if (refresh) params.set("refresh", "1");
    else if (cache) params.set("have", haveKey(cache.scope, cache.day));
    const timeout = new AbortController();
    const timer = window.setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
    try {
      const query = params.toString();
      const res = await fetch(query ? `${API}?${query}` : API, { cache: "no-store", signal: timeout.signal });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as SuggestionsResponse;
      if (typeof body?.scope !== "string" || typeof body.day !== "string") throw new Error("shape");
      confirmedScope = body.scope;
      let next: SuggestionCache | null = null;
      if (Array.isArray(body.items) && body.items.length) {
        if (body.fallback) {
          // 세지 못했다 — 보던 좋은 묶음(오늘 것)은 그대로 둔다.
          if (alive.current) setState((s) => (s.status === "ready" && s.day === todayRef.current ? s : { status: "ready", items: body.items!, fresh: EMPTY, day: null }));
          return;
        }
        next = nextSuggestionCache(cache, body.scope, body.day, body.items);
        // 일부만 센 묶음은 보여 주되 오늘 묶음으로 저장하지 않는다(다음에 열 때 다시 센다).
        if (!body.partial) writeCache(next);
      } else if (cache && cache.scope === body.scope && cache.day === body.day) {
        next = cache;
      }
      if (!next) throw new Error("empty");
      if (alive.current) setState({ status: "ready", items: next.items, fresh: newSuggestionTexts(next, body.day), day: next.day });
    } catch {
      if (alive.current)
        setState((s) => (s.status === "ready" && s.items.length && (s.day === null || s.day === todayRef.current) ? s : { status: "ready", items: FALLBACK_SUGGESTIONS, fresh: EMPTY, day: null }));
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  // 처음 그릴 때 · 판을 다시 열어 날짜가 바뀌었을 때 — 이 페이지에서 확인한 그날 묶음이 있으면 묻지 않는다.
  const shownDay = useRef(state.status === "ready" ? state.day : null);
  useEffect(() => {
    if (!enabled || !today || shownDay.current === today) return;
    shownDay.current = today;
    void load(false);
  }, [enabled, today, load]);

  const refresh = useCallback(() => {
    if (refreshing || cooling) return;
    setRefreshing(true);
    setCooling(true);
    void load(true).finally(() => {
      if (alive.current) setRefreshing(false);
    });
    window.setTimeout(() => {
      if (alive.current) setCooling(false);
    }, REFRESH_COOLDOWN_MS);
  }, [refreshing, cooling, load]);

  return { ...state, refreshing, canRefresh: enabled && !refreshing && !cooling, refresh };
}
