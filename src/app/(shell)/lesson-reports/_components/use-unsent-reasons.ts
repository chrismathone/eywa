"use client";

import { useEffect, useState } from "react";
import type { TipCard } from "@/components/hover-tip/tip";
import { isUnsentListRow } from "@/features/report-admin/unsent-reason";

export const UNSENT_REASONS_ENDPOINT = "/api/lesson-reports/unsent-reasons";

/**
 * 보고서 목록 '미발송' 칸 카드(원장 2026-11-04) — 목록이 바뀔 때 **그 페이지의 미발송 줄만** 따로 읽는다.
 * 목록 첫 페인트를 막지 않는다(카드는 도착하면 붙는다 — 그 전에는 '미발송' 글자만). 실패는 조용히 카드 없이 둔다.
 * 🔴 저절로 도는 조회라 서버 액션이 아니라 GET 라우트 + fetch(gotchas #137).
 */
export function useUnsentReasonCards(
  rows: readonly { id: string; classnoteStatus: string | null; source: string | null }[],
  enabled: boolean,
): Record<string, TipCard> {
  const [cards, setCards] = useState<Record<string, TipCard>>({});
  // 배열은 매 렌더 새 참조 — 미발송 줄 id의 안정 문자열 키로(같은 페이지를 다시 그려도 다시 묻지 않는다).
  const key = enabled
    ? rows
        .filter(isUnsentListRow)
        .map((r) => r.id)
        .sort()
        .join(",")
    : "";
  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    fetch(`${UNSENT_REASONS_ENDPOINT}?ids=${encodeURIComponent(key)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ cards?: Record<string, TipCard> }>) : null))
      .then((body) => {
        if (body?.cards) setCards((prev) => ({ ...prev, ...body.cards }));
      })
      .catch(() => undefined); // 끊김·중단 — '미발송' 글자만 남는다
    return () => ctrl.abort();
  }, [key]);
  return cards;
}
