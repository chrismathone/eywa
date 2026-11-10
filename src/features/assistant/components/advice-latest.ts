"use client";

import { useSyncExternalStore } from "react";
import type { AdviceView } from "../advice";

/**
 * 이 화면(문서)에서 마지막으로 저장한 의견 처리 상태 — 대화 안 카드와 '지난 의견' 모음이 **같이 구독**한다.
 * 다른 대화에 갔다 오면 대화 상태(보고서)는 처음 받은 값이라 '처리 전'이 다시 보이고, 누르면 같은 사람인데 409가 났다(적대 리뷰 2026-11-09) —
 * 그래서 저장 값을 문서 하나에 모아 두었는데, 마운트 때 한 번만 읽으면 감춰 둔 채 살아 있는 대화 카드가 '지난 의견'에서 처리한 값을 몰랐다
 * (리뷰 2026-11-10). 이제는 바뀔 때마다 알린다. 서버가 더 새 값을 주면(다른 탭에서 처리 · 다시 열기) 그쪽을 쓴다(`newerAdvice`).
 */
const latest = new Map<string, AdviceView>();
const listeners = new Set<() => void>();
let version = 0;

/** 처리 시각(DB 시계)이 더 새 쪽. */
export const newerAdvice = (a: AdviceView, b: AdviceView | null | undefined): AdviceView => (b && b.statusAt > a.statusAt ? b : a);

/** 저장 응답을 남기고 구독자에게 알린다(더 옛 값이면 무시). */
export function rememberAdvice(view: AdviceView): void {
  const cur = latest.get(view.id);
  if (cur && cur.statusAt >= view.statusAt) return;
  latest.set(view.id, view);
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 이 의견의 화면 저장 값(없으면 null) — 바뀌면 다시 그린다. */
export function useLatestAdvice(id: string): AdviceView | null {
  return useSyncExternalStore(
    subscribe,
    () => latest.get(id) ?? null,
    () => null,
  );
}

/** 어느 의견이든 저장되면 바뀌는 번호 — 여러 의견을 한꺼번에 읽는 쪽('지난 의견' 현황)이 다시 그리게. */
export function useAdviceVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

/** 받은 값과 화면 저장 값 중 더 새 것(`useAdviceVersion`으로 다시 그리는 쪽에서 쓴다). */
export const currentAdvice = (received: AdviceView): AdviceView => newerAdvice(received, latest.get(received.id));
