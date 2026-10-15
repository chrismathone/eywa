"use client";

import { useSyncExternalStore } from "react";

import { kstMinutesOfDay, kstTimeOf } from "@/lib/date-kst";

type KstNow = { minutes: number; hhmm: string };

// 분이 바뀔 때만 새 객체 — useSyncExternalStore는 같은 값이면 같은 참조를 요구한다.
let cache: { minute: number; value: KstNow } | null = null;

function snapshot(): KstNow {
  const minute = Math.floor(Date.now() / 60_000);
  if (cache?.minute !== minute) {
    const now = new Date();
    cache = { minute, value: { minutes: kstMinutesOfDay(now), hhmm: kstTimeOf(now) ?? "" } };
  }
  return cache.value;
}

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 15_000);
  return () => clearInterval(id);
}

/**
 * 지금 KST(분 단위). 🔑 서버 렌더에선 null — 서버(UTC)와 브라우저 시각이 달라 첫 화면이 어긋나지 않게,
 * 시각은 브라우저에서만 채운다. 학부모 '출발 10분 전 마감' 안내가 이 값으로 움직인다(판정은 서버가 다시 한다).
 */
export function useKstNow(): KstNow | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** "현재 14:35" — 날짜 옆에 붙는 시계. */
export function KstClock({ className = "" }: { className?: string }) {
  const now = useKstNow();
  if (!now) return null;
  return <span className={`num ${className}`}>현재 {now.hhmm}</span>;
}
