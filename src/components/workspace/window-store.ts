"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  bringToFront,
  cascadeNext,
  clampRect,
  layoutSlots,
  resizeRect,
  ROUTE_WINDOW_SIZE,
  snapTarget,
  templateSlots,
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
  /** 스냅/타일 레이아웃 슬롯에 들어가 있음(자유 위치/최대화와 구분). 드래그로 빼면 prevRect로 복원. */
  snapped?: boolean;
  /** 자유(레이아웃 전) 크기 — 스냅/타일/최대화 진입 시 저장, 해제 시 이 크기로 복원. */
  prevRect?: Rect;
};

export const MAX_WINDOWS = 6;
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
  dragLayout: { template: LayoutTemplate; slot: number } | null; // 드래그 중 스냅 레이아웃 바 호버 슬롯
  dragNearTop: boolean; // 드래그 중 포인터가 상단 밴드 → 스냅 레이아웃 바 reveal
  dragBackground: boolean; // 드래그 중 포인터가 배경 드롭 칩 위 → "배경으로 보내기" 하이라이트
  background: WindowParams[]; // 배경 스택(첫=대시보드 기본). 삽입 순서 고정. 미영속, pathname 동기
  activeBackgroundId: string; // 현재 메인 프레임에 보이는 배경 id(=하이라이트). 선택해도 스택 순서는 불변.
  spotlight: boolean; // 스포트라이트 모드(포커스 창 상단 크게, 나머지는 하단 커버 스트립). 런타임.
};
type Actions = {
  setStage: (rect: { left: number; top: number; width: number; height: number }) => void;
  setSnapPreview: (z: SnapZone) => void;
  setDragging: (id: string | null) => void;
  setDragLayout: (v: { template: LayoutTemplate; slot: number } | null) => void;
  setDragNearTop: (v: boolean) => void;
  setDragBackground: (v: boolean) => void;
  applyDragLayout: (id: string, template: LayoutTemplate, slot: number) => void;
  open: (kind: WindowKind, params: WindowParams) => void;
  /** 라우트를 배경 스택 맨 위(보이는 배경)로 — 이미 있으면 이동, 없으면 추가. 캔버스가 pathname서 동기. */
  setBackground: (params: WindowParams) => void;
  /** 이 창을 배경으로 보냄 — 창 제거 + 라우트를 배경 스택 맨 위로(옛 배경은 스택에 남음). */
  swapToBackground: (winId: string) => void;
  /** 배경 탭을 창으로 꺼냄 — 스택서 제거 + 그 라우트 창 열기(스택 항상 ≥1 유지). */
  backgroundToWindow: (id: string) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  setRect: (id: string, rect: Rect) => void;
  resizeBy: (id: string, base: Rect, handle: ResizeHandle, dx: number, dy: number) => void;
  toggleMax: (id: string) => void;
  restoreUnderPointer: (id: string, sx: number, sy: number) => void; // 최대화/스냅 창 드래그 시작 = 복원
  snap: (id: string, zone: Exclude<SnapZone, null>) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  applyLayout: (template: LayoutTemplate) => void; // Snap Assist 레이아웃 선택 → 자동 타일링
  dismissAssist: () => void;
  enterSpotlight: (id?: string) => void; // 스포트라이트 진입(포커스 창 = 상단 큰 창)
  exitSpotlight: () => void;
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
      dragLayout: null,
      dragNearTop: false,
      dragBackground: false,
      background: [{ id: "dashboard", title: "대시보드", href: "/dashboard" }],
      activeBackgroundId: "dashboard",
      spotlight: false,

      setStage: ({ left, top, width, height }) =>
        set({ origin: { left, top }, bounds: { width, height } }),
      setSnapPreview: (z) => set({ snapPreview: z }),
      setDragging: (id) => set({ draggingId: id }),
      setDragLayout: (v) => set({ dragLayout: v }),
      setDragNearTop: (v) => set({ dragNearTop: v }),
      setDragBackground: (v) => set({ dragBackground: v }),
      // 라우트를 "보이는 배경"으로 표시 — 삽입 순서는 고정(재정렬 안 함). 스택에 없으면 끝에 추가.
      // activeBackgroundId만 바뀌므로 탭을 클릭(=pathname 변경)해도 스트립 순서가 흔들리지 않는다.
      setBackground: (params) =>
        set((s) => {
          if (s.activeBackgroundId === params.id && s.background.some((b) => b.id === params.id)) {
            return s;
          }
          const exists = s.background.some((b) => b.id === params.id);
          return {
            activeBackgroundId: params.id,
            background: exists ? s.background : [...s.background, params],
          };
        }),

      // 스냅 레이아웃 바 드롭: 지정 슬롯=드래그 창, 나머지 슬롯=다른 열린 창(order순), 초과=최소화.
      applyDragLayout: (id, template, slot) =>
        set((s) => {
          if (!s.windows[id]) return { dragLayout: null };
          const slots = templateSlots(template, s.bounds);
          const others = s.order.filter((wid) => wid !== id && !s.windows[wid]?.minimized);
          const windows = { ...s.windows };
          let oi = 0;
          slots.forEach((rect, si) => {
            const wid = si === slot ? id : others[oi++];
            if (!wid || !windows[wid]) return;
            const exd = windows[wid];
            const origd = (exd.maximized || exd.snapped) && exd.prevRect ? exd.prevRect : exd.rect;
            windows[wid] = { ...exd, rect, maximized: false, minimized: false, snapped: true, prevRect: origd };
          });
          for (; oi < others.length; oi++) {
            const wid = others[oi];
            if (windows[wid]) windows[wid] = { ...windows[wid], minimized: true };
          }
          return {
            windows,
            order: bringToFront(s.order, id),
            focusedId: id,
            dragLayout: null,
            snapPreview: null,
            snapAssist: null,
          };
        }),

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
          rect: cascadeNext(
            order.length,
            s.bounds,
            kind === "route" ? ROUTE_WINDOW_SIZE[params.id] : undefined,
          ),
          minimized: false,
          maximized: false,
        };
        // 라우트가 배경 스택에 있으면 제거(이제 창이므로) — 스택 최소 1개 유지.
        const removedActive =
          kind === "route" && s.background.length > 1 && s.activeBackgroundId === params.id;
        const bg =
          kind === "route" && s.background.length > 1
            ? s.background.filter((b) => b.id !== params.id)
            : s.background;
        const activeBackgroundId = removedActive
          ? (bg[bg.length - 1]?.id ?? "dashboard")
          : s.activeBackgroundId;
        set({
          windows,
          order: [...order, id],
          focusedId: id,
          snapAssist: null,
          background: bg,
          activeBackgroundId,
        });
      },

      // 이 창을 배경으로 보냄 — 창 제거 + 라우트를 배경 스택 맨 위(보이는 배경)로. 옛 배경은 스택에 남음.
      // (호출부가 router.push로 메인 프레임을 이 라우트로 이동.) focusedId=null → 배경이 메인 뷰.
      swapToBackground: (winId) =>
        set((s) => {
          const w = s.windows[winId];
          if (!w) return s;
          const windows = { ...s.windows };
          delete windows[winId];
          const order = s.order.filter((id) => id !== winId);
          const route = w.params;
          // 삽입 순서 보존: 이미 배경에 있으면 그 자리 유지, 없으면 끝에 추가. 보이는 배경으로 표시.
          const exists = s.background.some((b) => b.id === route.id);
          const background = exists ? s.background : [...s.background, route];
          return { windows, order, focusedId: null, snapAssist: null, background, activeBackgroundId: route.id };
        }),

      // 배경 탭을 창으로 꺼냄 — 스택서 제거 + 그 라우트 창 열기. 스택은 항상 ≥1 유지.
      backgroundToWindow: (id) =>
        set((s) => {
          if (s.background.length <= 1) return s;
          const params = s.background.find((b) => b.id === id);
          if (!params) return s;
          const background = s.background.filter((b) => b.id !== id);
          // 꺼낸 배경이 "보이는 배경"이었으면, 남은 스택의 마지막을 새 보이는 배경으로(호출부가 push).
          const activeBackgroundId =
            s.activeBackgroundId === id ? (background[background.length - 1]?.id ?? "dashboard") : s.activeBackgroundId;
          const winId = windowId("route", params.id);
          let order = s.order;
          const windows = { ...s.windows };
          if (windows[winId]) {
            windows[winId] = { ...windows[winId], minimized: false };
            return { background, activeBackgroundId, windows, order: bringToFront(order, winId), focusedId: winId, snapAssist: null };
          }
          while (order.length >= MAX_WINDOWS) {
            const victim = order.find((wid) => wid !== winId) ?? order[0];
            delete windows[victim];
            order = order.filter((wid) => wid !== victim);
          }
          windows[winId] = {
            id: winId,
            kind: "route",
            params,
            rect: cascadeNext(order.length, s.bounds, ROUTE_WINDOW_SIZE[params.id]),
            minimized: false,
            maximized: false,
          };
          return { background, activeBackgroundId, windows, order: [...order, winId], focusedId: winId, snapAssist: null };
        }),

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
            windows: { ...s.windows, [id]: { ...w, rect: clampRect(rect, s.bounds), maximized: false, snapped: false, prevRect: undefined } },
          };
        }),

      resizeBy: (id, base, handle, dx, dy) =>
        set((s) => {
          const w = s.windows[id];
          if (!w) return s;
          return {
            windows: {
              ...s.windows,
              [id]: { ...w, rect: resizeRect(base, handle, dx, dy, s.bounds), maximized: false, snapped: false },
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
                [id]: { ...w, rect: clampRect(w.prevRect, s.bounds), maximized: false, snapped: false, prevRect: undefined },
              },
            };
          }
          return {
            windows: {
              ...s.windows,
              [id]: { ...w, prevRect: w.snapped && w.prevRect ? w.prevRect : w.rect, rect: snapTarget("max", s.bounds)!, maximized: true, snapped: false },
            },
          };
        }),

      // 최대화/스냅/타일 창 드래그 시작 → Windows식 복원: 자유(이전) 크기로 줄이며 커서(스테이지
      // 로컬 sx,sy) 아래 타이틀바에 오도록 재배치. 이후 드래그가 이 rect에서 이어진다.
      restoreUnderPointer: (id, sx, sy) =>
        set((s) => {
          const w = s.windows[id];
          if (!w || (!w.maximized && !w.snapped)) return s;
          const base = w.prevRect ?? cascadeNext(0, s.bounds);
          const rect = clampRect({ x: sx - base.w / 2, y: sy - 18, w: base.w, h: base.h }, s.bounds);
          return {
            windows: { ...s.windows, [id]: { ...w, rect, maximized: false, snapped: false, prevRect: undefined } },
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
              prevRect: (w.maximized || w.snapped) && w.prevRect ? w.prevRect : w.rect,
              rect: snapTarget(zone, s.bounds)!,
              maximized: zone === "max",
              snapped: zone !== "max",
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
              windows[victim] = { ...vw, prevRect: (vw.maximized || vw.snapped) && vw.prevRect ? vw.prevRect : vw.rect, rect: compRect, maximized: false, snapped: true };
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
            const origl = (w.maximized || w.snapped) && w.prevRect ? w.prevRect : w.rect;
            windows[id] =
              i < slots.length
                ? { ...w, rect: slots[i], maximized: false, minimized: false, snapped: true, prevRect: origl }
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

      // 스포트라이트 진입: 포커스 창(인자 또는 현재 포커스, 없으면 최상단)을 상단 큰 창으로.
      // rect는 변경 안 함(캔버스가 spotlightTop으로 표시) → 해제 시 원위치 복원 불필요.
      enterSpotlight: (id) =>
        set((s) => {
          const open = s.order.filter((wid) => !s.windows[wid]?.minimized);
          if (open.length === 0) return s;
          const focusId =
            id && s.windows[id] && !s.windows[id].minimized
              ? id
              : s.focusedId && open.includes(s.focusedId)
                ? s.focusedId
                : open[open.length - 1];
          return {
            spotlight: true,
            focusedId: focusId,
            order: bringToFront(s.order, focusId),
            snapAssist: null,
            snapPreview: null,
            dragLayout: null,
          };
        }),
      exitSpotlight: () => set({ spotlight: false }),

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
