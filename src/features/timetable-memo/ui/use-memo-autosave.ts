"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { windowDirtyMessage } from "@/components/workspace/window-bridge";
import type { SheetDoc } from "../doc";
import { packSheet, type PackedSheet } from "../pack";
import { saveMemoSheet } from "../server/actions";
import { rememberSaved, trackFlight } from "./memo-cache";

/**
 * 자동 저장 — 고친 뒤 잠깐(0.9초) 멈추면 문서를 통째로 보낸다(구글 시트처럼 저장 버튼이 없다). Ctrl+S는 바로.
 * 🔴 저장 중에 또 고치면 끝난 뒤 한 번 더 보낸다(겹쳐 보내지 않는다 — 앞 요청의 version으로 뒤 요청을 보내야 한다).
 * 🔴 다른 사람이 먼저 저장했으면(version 불일치) **멈추고 묻는다** — 내 것으로 덮을지, 그 판을 불러올지.
 * 저장 전·중이면 창 닫기(부모 창 시스템)·새로고침에 미저장 경고를 건다.
 */

export type SaveState =
  | { kind: "saved"; at: string | null }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; version: number; packed: PackedSheet; updatedAt: string | null };

const DEBOUNCE_MS = 900;
/** 서버 액션 본문 상한(Next 기본 1MB)보다 조금 아래(바이트 — 한글은 글자당 3바이트). 침산 판은 약 10만 바이트. */
const MAX_PAYLOAD_BYTES = 900_000;

function publishDirty(dirty: boolean) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage(windowDirtyMessage(dirty), window.location.origin);
  } catch {
    /* 부모가 다른 출처면 무시 */
  }
}

export function useMemoAutosave(opts: {
  subject: string;
  /** 이 탭 안 '마지막 저장 판' 기억 자리(지점×과목 — memo-cache.ts). */
  cacheKey: string;
  enabled: boolean;
  initialVersion: number;
  initialUpdatedAt: string | null;
  /** 앞 화면이 보내던 저장(memo-cache `startingSheet`) — 있으면 끝날 때까지 저장을 잠근다. */
  initialFlight: Promise<number | null> | null;
  getDoc: () => SheetDoc;
}) {
  const { subject, cacheKey, enabled, getDoc } = opts;
  const version = useRef(opts.initialVersion);
  const [state, setState] = useState<SaveState>({ kind: "saved", at: opts.initialUpdatedAt });
  const dirty = useRef(false);
  const inflight = useRef(false);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const flush = useCallback(async () => {
    clearTimer();
    if (!enabled || blocked.current || inflight.current || !dirty.current) return;
    dirty.current = false;
    inflight.current = true;
    setState({ kind: "saving" });
    let res: Awaited<ReturnType<typeof saveMemoSheet>>;
    const sent = getDoc();
    const packed = packSheet(sent);
    if (new TextEncoder().encode(JSON.stringify(packed)).length > MAX_PAYLOAD_BYTES) {
      // 서버 액션 본문 상한(1MB)에 걸리면 "연결 확인"으로 위장한다 — 보내기 전에 이유를 말한다.
      res = { ok: false, error: "시트가 너무 커서 저장하지 못했습니다. 쓰지 않는 행·열이나 긴 글을 줄여 주세요." };
    } else {
      const base = version.current;
      const call = saveMemoSheet({ subject, packed, baseVersion: base }).catch(
        (): Awaited<ReturnType<typeof saveMemoSheet>> => ({ ok: false, error: "저장하지 못했습니다. 인터넷 연결을 확인해 주세요." }),
      );
      // 이 화면이 내려가도(주·뷰 이동) 요청은 끝까지 간다 — 그사이 돌아오면 새 화면이 이 판에서 시작한다(memo-cache.ts).
      trackFlight(cacheKey, { doc: sent, base, done: call.then((r) => (r.ok ? r.version : null)) });
      res = await call;
    }
    inflight.current = false;
    if (res.ok) {
      version.current = res.version;
      rememberSaved(cacheKey, { doc: sent, version: res.version, updatedAt: res.savedAt });
      if (dirty.current) {
        setState({ kind: "pending" });
        void flushRef.current();
      } else {
        setState({ kind: "saved", at: res.savedAt });
        publishDirty(false);
      }
      return;
    }
    dirty.current = true;
    if (res.conflict) {
      blocked.current = true;
      setState({ kind: "conflict", version: res.version, packed: res.packed, updatedAt: res.updatedAt });
    } else {
      setState({ kind: "error", message: res.error });
    }
  }, [enabled, subject, cacheKey, getDoc]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // 앞 화면이 보내던 저장이 아직 안 끝났으면, 끝날 때까지 저장을 잠그고 결과로 version을 맞춘다
  // (안 그러면 같은 version으로 한 번 더 보내 내 저장끼리 충돌한다). 실패했으면 그 판을 다시 보낸다.
  const initialFlight = opts.initialFlight;
  const flightBase = opts.initialVersion;
  useEffect(() => {
    if (!initialFlight) return;
    blocked.current = true;
    let alive = true;
    void initialFlight.then((v) => {
      if (!alive) return;
      blocked.current = false;
      if (v !== null && version.current === flightBase) version.current = v;
      else if (v === null) dirty.current = true;
      if (dirty.current) void flushRef.current();
    });
    return () => {
      alive = false;
    };
  }, [initialFlight, flightBase]);

  const markDirty = useCallback(() => {
    if (!enabled) return;
    dirty.current = true;
    publishDirty(true);
    if (blocked.current) return;
    setState((s) => (s.kind === "saving" ? s : { kind: "pending" }));
    clearTimer();
    timer.current = setTimeout(() => void flushRef.current(), DEBOUNCE_MS);
  }, [enabled]);

  /** 충돌 — 내 판으로 그 위에 저장(남의 저장을 덮는다는 것을 사람이 고른 뒤). */
  const keepMine = useCallback((latestVersion: number) => {
    version.current = latestVersion;
    blocked.current = false;
    dirty.current = true;
    void flushRef.current();
  }, []);

  /** 충돌 — 그 판을 받아들인다(내 고친 것은 버린다). 호출부가 문서를 갈아끼운다. */
  const takeTheirs = useCallback((latestVersion: number, updatedAt: string | null, doc: SheetDoc) => {
    version.current = latestVersion;
    blocked.current = false;
    dirty.current = false;
    rememberSaved(cacheKey, { doc, version: latestVersion, updatedAt });
    setState({ kind: "saved", at: updatedAt });
    publishDirty(false);
  }, [cacheKey]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current && !inflight.current) return;
      void flushRef.current();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // 화면을 떠나는 순간(주·뷰 이동) 남은 변경은 바로 보낸다 — 요청은 문서가 살아 있는 한 끝까지 간다.
      if (dirty.current) void flushRef.current();
      publishDirty(false);
    };
  }, []);

  return { state, markDirty, flush, keepMine, takeTheirs };
}
