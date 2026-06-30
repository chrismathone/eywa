"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// 공지 팝업 dismiss 영속(브라우저 localStorage "eywa-notice-dismiss") — 일반 사이트 팝업광고와 동일한
// "오늘 하루/7일간/다시 보지 않기"를 계정이 아니라 기기 단위로 기억. 팝업이 수정(updatedAt 변경)되면
// 옛 dismiss는 무시하고 다시 노출한다.
export type DismissMode = "today" | "week" | "forever";
type Entry = { until: number | "forever"; v: string }; // until=epoch ms, v=updatedAt 버전

type State = {
  dismissed: Record<string, Entry>;
  dismiss: (id: string, mode: DismissMode, version: string) => void;
};

const DAY = 86_400_000;

export const useNoticeDismiss = create<State>()(
  persist(
    (set) => ({
      dismissed: {},
      dismiss: (id, mode, version) =>
        set((s) => {
          const until =
            mode === "forever" ? "forever" : Date.now() + (mode === "week" ? 7 * DAY : DAY);
          return { dismissed: { ...s.dismissed, [id]: { until, v: version } } };
        }),
    }),
    { name: "eywa-notice-dismiss", skipHydration: true },
  ),
);

// 모듈 로드 시점 rehydrate(클라) — window-store와 동일 패턴(#65: effect보다 먼저 복원).
if (typeof window !== "undefined") void useNoticeDismiss.persist.rehydrate();

/** dismiss 엔트리가 아직 유효한가(=숨겨야 하는가). 버전(updatedAt)이 바뀌면 무시(수정 시 재노출). */
export function isHidden(entry: Entry | undefined, version: string): boolean {
  if (!entry) return false;
  if (entry.v !== version) return false; // 팝업이 수정됨 → 다시 보여줌
  if (entry.until === "forever") return true;
  return entry.until > Date.now();
}
