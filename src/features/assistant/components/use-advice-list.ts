"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdviceListItem } from "../advice-list";

const API = "/api/assistant/advice";
const FETCH_TIMEOUT_MS = 15_000;

export type AdviceListState =
  | { status: "loading"; items: readonly AdviceListItem[] }
  | { status: "ready"; items: readonly AdviceListItem[] }
  | { status: "error"; items: readonly AdviceListItem[]; error: string };

/** 한 번 읽기 — 실패 까닭은 한국어로(브라우저의 영문 연결 오류 `Failed to fetch` 등은 화면에 내지 않는다). */
async function fetchAdvice(): Promise<{ ok: true; items: AdviceListItem[] } | { ok: false; error: string }> {
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(API, { cache: "no-store", signal: timeout.signal });
    const body = (await res.json().catch(() => null)) as { items?: unknown; error?: unknown } | null;
    if (res.ok && Array.isArray(body?.items)) return { ok: true, items: body.items as AdviceListItem[] };
    return { ok: false, error: typeof body?.error === "string" ? body.error : "지난 의견을 읽지 못했습니다" };
  } catch {
    return { ok: false, error: timeout.signal.aborted ? "응답이 없어 지난 의견을 읽지 못했습니다" : "연결이 끊겨 지난 의견을 읽지 못했습니다" };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * '지난 의견' 읽기 — 목록을 열 때 · 판을 다시 열 때(`active`가 다시 참 — 판은 닫아도 붙어 있어 그사이 재측정·새 의견을 놓치지 않게) ·
 * '새로 고침'. 다시 읽다 실패하면 보던 목록은 그대로 두고 까닭만 보인다(지운 대화의 의견은 부르는 쪽이 바로 뺀다).
 * 늦게 온 옛 응답(다시 읽기를 누른 뒤 · 목록을 닫은 뒤)은 버린다.
 */
export function useAdviceList(active: boolean): { state: AdviceListState; reload: () => void; reloading: boolean } {
  const [state, setState] = useState<AdviceListState>({ status: "loading", items: [] });
  const [round, setRound] = useState(0);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void fetchAdvice().then((r) => {
      if (!live) return;
      setState((s) => (r.ok ? { status: "ready", items: r.items } : { status: "error", items: s.items, error: r.error }));
      setReloading(false);
    });
    return () => {
      live = false;
    };
  }, [round, active]);

  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    setRound((n) => n + 1);
  }, [reloading]);

  return { state, reload, reloading };
}
