"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  bringToFront,
  cascadeNext,
  clampRect,
  layoutSlots,
  resizeRect,
  snapTarget,
  type Bounds,
  type LayoutTemplate,
  type Rect,
  type ResizeHandle,
  type SnapZone,
} from "./window-geometry";

export type WindowKind = "student" | "route"; // student=요약 peek, route=메뉴 풀화면(iframe)
export type WindowParams = { id: string; title: string; subtitle?: string; href?: string };
/** 절반 스냅 직후 반대편 half를 채울 창을 고르게 하는 Snap Assist 상태(런타임). */
export type SnapAssist = { half: "left" | "right"; originId: string };
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

/** 두 사각형이 (반올림 오차 내) 거의 같은지 — 스마트 코너 스냅의 "절반 차지 창" 판정용. */
function rectsClose(a: Rect, b: Rect, tol = 6) {
  return (
    Math.abs(a.x - b.x) <= tol &&
    Math.abs(a.y - b.y) <= tol &&
    Math.abs(a.w - b.w) <= tol &&
    Math.abs(a.h - b.h) <= tol
  );
}

// 코너 → 같은 쪽(left/right)과 같은 쪽 반대 1/4(complement)
const CORNER_SIDE: Record<"tl" | "tr" | "bl" | "br", "left" | "right"> = {
  tl: "left",
  bl: "left",
  tr: "right",
  br: "right",
};
const CORNER_COMPLEMENT: Record<"tl" | "tr" | "bl" | "br", "tl" | "tr" | "bl" | "br"> = {
  tl: "bl",
  bl: "tl",
  tr: "br",
  br: "tr",
};

type State = {
  owner: string | null;
  windows: Record<string, Win>;
  order: string[]; // back→front, 마지막 = 최상단
  focusedId: string | null;
  bounds: Bounds; // 런타임(미영속) 스테이지(콘텐츠 영역) 크기
  origin: { left: number; top: number }; // 스테이지 좌상단의 뷰포트 오프셋(레일/헤더 제외)
  snapPreview: SnapZone; // 드래그 중 스냅 미리보기(미영속)
  snapAssist: SnapAssist | null; // 절반 스냅 후 반대편 채우기 제안(미영속)
  draggingId: string | null; // 드래그/리사이즈 중인 창(iframe 숨겨 부드럽게, 미영속)
};
type Actions = {
  setStage: (rect: { left: number; top: number; width: number; height: number }) => void;
  setSnapPreview: (z: SnapZone) => void;
  setDragging: (id: string | null) => void;
  open: (kind: WindowKind, params: WindowParams) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  setRect: (id: string, rect: Rect) => void;
  resizeBy: (id: string, base: Rect, handle: ResizeHandle, dx: number, dy: number) => void;
  toggleMax: (id: string) => void;
  unmaximizeUnderPointer: (id: string, sx: number, sy: number) => void; // 최대화 창 드래그 시작 = 복원
  snap: (id: string, zone: Exclude<SnapZone, null>) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  applyLayout: (template: LayoutTemplate) => void; // Snap Assist 레이아웃 선택 → 자동 타일링
  dismissAssist: () => void;
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
      origin: { left: 0, top: 0 },
      snapPreview: null,
      snapAssist: null,
      draggingId: null,

      setStage: ({ left, top, width, height }) =>
        set({ origin: { left, top }, bounds: { width, height } }),
      setSnapPreview: (z) => set({ snapPreview: z }),
      setDragging: (id) => set({ draggingId: id }),

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
        set({ windows, order: [...order, id], focusedId: id, snapAssist: null });
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
            snapAssist: null,
          };
        }),

      focus: (id) =>
        set((s) =>
          s.windows[id] ? { order: bringToFront(s.order, id), focusedId: id, snapAssist: null } : s,
        ),

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

      // 최대화 창 드래그 시작 → Windows식 복원: 이전 크기로 줄이며 커서(스테이지 로컬 sx,sy)
      // 아래 타이틀바에 오도록 재배치. 이후 드래그가 이 rect에서 이어진다.
      unmaximizeUnderPointer: (id, sx, sy) =>
        set((s) => {
          const w = s.windows[id];
          if (!w || !w.maximized) return s;
          const base = w.prevRect ?? cascadeNext(0, s.bounds);
          const rect = clampRect({ x: sx - base.w / 2, y: sy - 18, w: base.w, h: base.h }, s.bounds);
          return {
            windows: { ...s.windows, [id]: { ...w, rect, maximized: false, prevRect: undefined } },
          };
        }),

      snap: (id, zone) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          const windows = {
            ...s.windows,
            [id]: {
              ...w,
              prevRect: w.maximized ? w.prevRect : w.rect,
              rect: snapTarget(zone, s.bounds)!,
              maximized: zone === "max",
            },
          };
          // 스마트 코너 스냅(Windows식): 모서리로 스냅 시, 같은 쪽 절반을 통째 차지한 창이
          // 있으면 반대 1/4로 강등 → 1:1 분할 상태에서 새 창을 우상/우하로 끌면 왼1·오른2 완성.
          if (zone === "tl" || zone === "tr" || zone === "bl" || zone === "br") {
            const side = CORNER_SIDE[zone];
            const halfRect = snapTarget(side, s.bounds)!;
            const compRect = snapTarget(CORNER_COMPLEMENT[zone], s.bounds)!;
            const victim = s.order.find(
              (wid) => wid !== id && !s.windows[wid]?.minimized && rectsClose(s.windows[wid].rect, halfRect),
            );
            if (victim) {
              const vw = s.windows[victim];
              windows[victim] = { ...vw, prevRect: vw.rect, rect: compRect, maximized: false };
            }
          }
          // 절반 스냅 + 다른 열린(비최소화) 창 있으면 반대편 채우기 제안(Snap Assist)
          let snapAssist: SnapAssist | null = null;
          if (zone === "left" || zone === "right") {
            const hasOther = s.order.some((wid) => wid !== id && !s.windows[wid]?.minimized);
            if (hasOther) snapAssist = { half: zone === "left" ? "right" : "left", originId: id };
          }
          return { windows, snapAssist };
        }),

      minimize: (id) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          const rest = s.order.filter((x) => x !== id);
          return {
            windows: { ...s.windows, [id]: { ...w, minimized: true } },
            focusedId: rest[rest.length - 1] ?? null,
            snapAssist: null,
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
            snapAssist: null,
          };
        }),

      // Snap Assist 레이아웃 클릭 → 열린 창들을 슬롯에 자동 배치(앵커=슬롯0, 앵커측에).
      // 슬롯보다 많은 창은 최소화(스위처로 보내 화면 정리).
      applyLayout: (template) =>
        set((s) => {
          const assist = s.snapAssist;
          if (!assist) return { snapAssist: null };
          const anchorSide = assist.half === "right" ? "left" : "right";
          const slots = layoutSlots(template, s.bounds, anchorSide);
          const others = s.order.filter(
            (id) => id !== assist.originId && !s.windows[id]?.minimized,
          );
          const ordered = [assist.originId, ...others].filter((id) => s.windows[id]);
          const windows = { ...s.windows };
          ordered.forEach((id, i) => {
            const w = windows[id];
            if (!w) return;
            windows[id] =
              i < slots.length
                ? { ...w, rect: slots[i], maximized: false, minimized: false, prevRect: undefined }
                : { ...w, minimized: true };
          });
          return {
            windows,
            order: bringToFront(s.order, assist.originId),
            focusedId: assist.originId,
            snapAssist: null,
          };
        }),

      dismissAssist: () => set({ snapAssist: null }),

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
