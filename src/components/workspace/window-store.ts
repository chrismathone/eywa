"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  bringToFront,
  cascadeNext,
  clampRect,
  resizeRect,
  snapTarget,
  type Bounds,
  type Rect,
  type ResizeHandle,
  type SnapZone,
} from "./window-geometry";

export type WindowKind = "student"; // Phase 1: 학생 요약만
export type WindowParams = { id: string; title: string; subtitle?: string };
export type Win = {
  id: string;
  kind: WindowKind;
  params: WindowParams;
  rect: Rect;
  minimized: boolean;
  maximized: boolean;
  prevRect?: Rect;
};

export const MAX_WINDOWS = 3;
export function windowId(kind: WindowKind, paramId: string) {
  return `${kind}:${paramId}`;
}

type State = {
  owner: string | null;
  windows: Record<string, Win>;
  order: string[]; // back→front, 마지막 = 최상단
  focusedId: string | null;
  bounds: Bounds; // 런타임(미영속) 캔버스 크기
  snapPreview: SnapZone; // 드래그 중 스냅 미리보기(미영속)
};
type Actions = {
  setBounds: (b: Bounds) => void;
  setSnapPreview: (z: SnapZone) => void;
  open: (kind: WindowKind, params: WindowParams) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  setRect: (id: string, rect: Rect) => void;
  resizeBy: (id: string, base: Rect, handle: ResizeHandle, dx: number, dy: number) => void;
  toggleMax: (id: string) => void;
  snap: (id: string, zone: Exclude<SnapZone, null>) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  adoptOwner: (owner: string) => void;
};

export const useWindowStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      owner: null,
      windows: {},
      order: [],
      focusedId: null,
      bounds: { width: 1280, height: 720 },
      snapPreview: null,

      setBounds: (b) => set({ bounds: b }),
      setSnapPreview: (z) => set({ snapPreview: z }),

      open: (kind, params) => {
        const id = windowId(kind, params.id);
        const s = get();
        if (s.windows[id]) {
          get().restore(id);
          return;
        }
        let order = s.order;
        const windows = { ...s.windows };
        while (order.length >= MAX_WINDOWS) {
          const victim = order.find((wid) => wid !== s.focusedId) ?? order[0];
          delete windows[victim];
          order = order.filter((wid) => wid !== victim);
        }
        windows[id] = {
          id,
          kind,
          params,
          rect: cascadeNext(order.length, s.bounds),
          minimized: false,
          maximized: false,
        };
        set({ windows, order: [...order, id], focusedId: id });
      },

      close: (id) =>
        set((s) => {
          const windows = { ...s.windows };
          delete windows[id];
          const order = s.order.filter((w) => w !== id);
          return {
            windows,
            order,
            focusedId: s.focusedId === id ? (order[order.length - 1] ?? null) : s.focusedId,
          };
        }),

      focus: (id) =>
        set((s) => (s.windows[id] ? { order: bringToFront(s.order, id), focusedId: id } : s)),

      setRect: (id, rect) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          return {
            windows: { ...s.windows, [id]: { ...w, rect: clampRect(rect, s.bounds), maximized: false } },
          };
        }),

      resizeBy: (id, base, handle, dx, dy) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          return {
            windows: {
              ...s.windows,
              [id]: { ...w, rect: resizeRect(base, handle, dx, dy, s.bounds), maximized: false },
            },
          };
        }),

      toggleMax: (id) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          if (w.maximized && w.prevRect) {
            return {
              windows: {
                ...s.windows,
                [id]: { ...w, rect: clampRect(w.prevRect, s.bounds), maximized: false, prevRect: undefined },
              },
            };
          }
          return {
            windows: {
              ...s.windows,
              [id]: { ...w, prevRect: w.rect, rect: snapTarget("max", s.bounds)!, maximized: true },
            },
          };
        }),

      snap: (id, zone) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          return {
            windows: {
              ...s.windows,
              [id]: {
                ...w,
                prevRect: w.maximized ? w.prevRect : w.rect,
                rect: snapTarget(zone, s.bounds)!,
                maximized: zone === "max",
              },
            },
          };
        }),

      minimize: (id) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          const rest = s.order.filter((x) => x !== id);
          return {
            windows: { ...s.windows, [id]: { ...w, minimized: true } },
            focusedId: rest[rest.length - 1] ?? null,
          };
        }),

      restore: (id) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          return {
            windows: { ...s.windows, [id]: { ...w, minimized: false } },
            order: bringToFront(s.order, id),
            focusedId: id,
          };
        }),

      // 복원 직후 호출: 다른 계정/테넌트 레이아웃이면 초기화(메타 누수 방지), 같으면 viewport clamp.
      adoptOwner: (owner) =>
        set((s) => {
          if (s.owner && s.owner !== owner) {
            return { owner, windows: {}, order: [], focusedId: null };
          }
          const windows: Record<string, Win> = {};
          for (const [id, w] of Object.entries(s.windows)) {
            windows[id] = {
              ...w,
              rect: clampRect(w.maximized ? snapTarget("max", s.bounds)! : w.rect, s.bounds),
            };
          }
          return { owner, windows };
        }),
    }),
    {
      name: "eywa-workspace",
      skipHydration: true, // 마운트 후 수동 rehydrate (SSR mismatch 회피)
      partialize: (s) => ({
        owner: s.owner,
        windows: s.windows,
        order: s.order,
        focusedId: s.focusedId,
      }),
    },
  ),
);
