"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CELL_MEMO_EVENT, cellMemoChannel, isCellMemoPayload, newMemoSenderId } from "../live-channel";
import type { CellMemo } from "../rules";

/**
 * 그 주 칸 메모 — 시간표가 뜬 **뒤** GET으로 따로 읽는다(첫 그림을 막지 않는다, B7).
 *
 * 🔑 다른 사람 화면 반영 = broadcast "바뀌었다" 신호 → 다시 읽기(셔틀 실시간과 같은 결 · 내용은 신호에 안 싣는다).
 *    신호가 안 붙어도(실시간 연결 실패) 창 포커스·화면 복귀 때 다시 읽는다.
 * 🔴 **주가 바뀌면 그 주 것만** — 늦게 온 지난 주 응답은 버린다(다른 날짜 메모가 섞이지 않게).
 * 🔴 내가 방금 저장한 것보다 **먼저 출발한** 응답은 버리고 다시 읽는다 — 안 그러면 방금 단 메모가 잠깐 사라졌다 돌아온다.
 * ⚠️ 실패는 조용히 접는다 — 메모가 안 떠도 시간표는 그대로여야 한다.
 */

export type WeekMemosStatus = "loading" | "ok" | "unavailable";
type Load = { week: string; status: "ok" | "unavailable"; memos: CellMemo[] };

const EMPTY: CellMemo[] = [];
/** 신호가 몰아쳐도 다시 읽기는 이 간격으로 한 번. */
const COALESCE_MS = 400;

export function useWeekMemos({ tenantId, subject, weekMonday }: { tenantId: string; subject: string; weekMonday: string }) {
  const [load, setLoad] = useState<Load | null>(null);
  const [senderId] = useState(() => newMemoSenderId());
  const seq = useRef(0);
  const localAt = useRef(0);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const subscribed = useRef(false);

  /** 그 주 메모를 읽는다 — 상태는 건드리지 않고 결과만 돌려준다(버릴 응답이면 null). */
  const fetchWeek = useCallback(async (): Promise<Load | null> => {
    // 내가 방금 저장한 것보다 먼저 출발한 응답은 버리고 다시 읽는다(몇 번까지만).
    for (let attempt = 0; attempt < 3; attempt++) {
      const mySeq = ++seq.current;
      const startedAt = Date.now();
      try {
        const res = await fetch(`/api/timetable/cell-memos?subject=${encodeURIComponent(subject)}&week=${weekMonday}`, {
          cache: "no-store",
        });
        if (mySeq !== seq.current) return null;
        if (res.status === 401 || res.status === 403) return { week: weekMonday, status: "unavailable", memos: [] };
        if (!res.ok) return null; // 일시 오류 — 지난 목록을 유지한다
        const json = (await res.json()) as { status?: string; memos?: CellMemo[] };
        if (mySeq !== seq.current) return null;
        if (startedAt < localAt.current) continue;
        return json.status === "ok" && Array.isArray(json.memos)
          ? { week: weekMonday, status: "ok", memos: json.memos }
          : { week: weekMonday, status: "unavailable", memos: [] };
      } catch {
        return null; // 연결 실패 — 지난 목록 유지
      }
    }
    return null;
  }, [subject, weekMonday]);
  const refetch = useCallback(() => {
    void fetchWeek().then((next) => {
      if (next) setLoad(next);
    });
  }, [fetchWeek]);

  useEffect(() => {
    refetch();
    const onFocus = () => refetch();
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

  useEffect(() => {
    if (!tenantId) return;
    let timer: number | null = null;
    const supabase = createClient();
    const channel = supabase.channel(cellMemoChannel(tenantId, subject, weekMonday), { config: { broadcast: { self: false } } });
    channelRef.current = channel;
    channel.on("broadcast", { event: CELL_MEMO_EVENT }, (message) => {
      const p = (message as { payload?: unknown }).payload;
      if (!isCellMemoPayload(p) || p.sender === senderId) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        refetch();
      }, COALESCE_MS);
    });
    channel.subscribe((status) => {
      subscribed.current = status === "SUBSCRIBED";
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      subscribed.current = false;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [tenantId, subject, weekMonday, senderId, refetch]);

  /** 내 저장이 성공한 뒤 — 화면에 바로 반영하고 같은 주를 보는 다른 화면을 깨운다. */
  const applyLocal = useCallback(
    (week: string, update: (memos: CellMemo[]) => CellMemo[]) => {
      localAt.current = Date.now();
      setLoad((cur) => (cur && cur.week === week ? { ...cur, memos: update(cur.memos) } : cur));
      const channel = channelRef.current;
      if (!channel || !subscribed.current) return;
      void channel
        .send({ type: "broadcast", event: CELL_MEMO_EVENT, payload: { sender: senderId, at: Date.now() } })
        .catch(() => {});
    },
    [senderId],
  );

  const current = load && load.week === weekMonday ? load : null;
  return {
    status: (current?.status ?? "loading") as WeekMemosStatus,
    memos: current?.memos ?? EMPTY,
    applyLocal,
  };
}

/** 같은 id면 갈아끼우고, 없으면 더한다. */
export function upsertMemo(list: CellMemo[], memo: CellMemo): CellMemo[] {
  return list.some((m) => m.id === memo.id) ? list.map((m) => (m.id === memo.id ? memo : m)) : [...list, memo];
}
