"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  bringToFront,
  cascadeNext,
  clampRect,
  layoutSlots,
  rectAtPoint,
  resizeRect,
  routeWindowSize,
  snapTarget,
  templateSlots,
  type Bounds,
  type LayoutTemplate,
  type Rect,
  type ResizeHandle,
  type SnapZone,
} from "./window-geometry";

export type WindowKind = "student" | "route"; // student=요약 peek, route=메뉴 풀화면(iframe)
export type WindowParams = {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  /** /X/new 같은 "생성 폼" 창 — iframe이 초기 href 경로를 벗어나면(=제출 성공 후 redirect/push)
   *  RouteWindow가 창을 자동으로 닫고 배경을 새로고침한다(우측 패널 닫기+목록 갱신 대체). */
  autoClose?: boolean;
  /** 이 창을 연 소스 창 id(플로팅 창=iframe 안의 "새 X" 버튼이 부모 브리지로 열었을 때만). autoClose로 닫힐 때
   *  최상위 router.refresh()는 배경만 갱신하고 소스 리스트 창(별도 iframe)은 stale로 남으므로, 그 창도 reload. */
  spawnedBy?: string;
};
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
/**
 * BL3 — 닫은 라우트 창을 파괴하지 않고 iframe을 살려두는 warm 풀 상한(재오픈 즉시화).
 * 초과 시 가장 오래 전에 닫힌 warm 창을 실제 파괴(메모리·백그라운드 타이머·realtime WS 가드).
 * minimize된 창과 동급 비용이라 상한만 지키면 안전. 2 = 최근 닫은 2개까지 즉시 재오픈.
 */
export const CACHE_MAX = 2;
/**
 * 창 식별 키. primary 인스턴스(instance 없음/0)는 `kind:paramId`(오늘과 동일 — 영속 레이아웃·배경 매핑 보존).
 * 복제본(instance≥1)만 `kind:paramId#n` 접미사를 단다. 기존 호출부는 전부 무인자라 영향 0.
 */
export function windowId(kind: WindowKind, paramId: string, instance?: number) {
  return instance ? `${kind}:${paramId}#${instance}` : `${kind}:${paramId}`;
}
const LEGACY_DASHBOARD_WINDOW_ID = windowId("route", "dashboard");

/** 옛 구현에서 `/dashboard`를 iframe 창으로 저장한 흔적(기본 창·복제본·비정상 id)을 찾는다. */
function isLegacyDashboardWindow(id: string, win?: Win) {
  if (baseWindowId(id) === LEGACY_DASHBOARD_WINDOW_ID) return true;
  if (!win || win.kind !== "route") return false;
  const hrefPath = win.params.href?.split("?")[0].split("#")[0];
  return win.params.id === "dashboard" || hrefPath === "/dashboard";
}
/** 복제본 창인지 — id에 #n 접미사가 있으면 복제(2번째+ 인스턴스). */
export function isDuplicate(winId: string) {
  return winId.includes("#");
}
/**
 * 복제 인스턴스 그룹핑용 base 창 id(= `kind:paramId`, # 앞). **instance 번호 스캔에만** 쓰고
 * params.id로는 절대 쓰지 말 것(params.id는 `students` 류 base 라우트 id라 kind 접두가 없다).
 */
export function baseWindowId(winId: string) {
  return winId.split("#")[0];
}
/** 복제본이면 제목에 (2)·(3) 등 인스턴스 번호를 붙여 창 선택 UI(타이틀바·스위처·스포트라이트)에서 구분. */
export function instanceLabel(winId: string, title: string) {
  const i = winId.indexOf("#");
  return i === -1 ? title : `${title} (${Number(winId.slice(i + 1)) + 1})`;
}

/** embed=1 파라미터를 제거한 정규화 URL — homeNav의 "이미 첫 화면(루트)인가" 비교용
 *  (창 iframe URL엔 항상 embed=1이 붙어 있어 raw 루트 href와 그대로 비교하면 안 맞는다). */
function stripEmbed(url: string) {
  const [path, query] = url.split("?");
  if (!query) return path;
  const params = new URLSearchParams(query);
  params.delete("embed");
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
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

/**
 * 스테이지(bounds) 변경 시 창들을 새 영역에 재배치 — 사이드바 펼침/접힘·리사이즈나 브라우저
 * 리사이즈로 콘텐츠 영역이 바뀌면 호출. 최대화=새 전체, 스냅/타일=분수 비율 유지하도록 비례
 * 재배치, 자유 창=크기 유지하고 안으로 clamp. (origin/bounds만 갱신하던 setStage가 "최대치"를
 * 사이드바 너비에 못 맞추던 문제 해소.)
 */
function reflowWindows(
  windows: Record<string, Win>,
  oldB: Bounds,
  newB: Bounds,
): Record<string, Win> {
  const sx = oldB.width > 0 ? newB.width / oldB.width : 1;
  const sy = oldB.height > 0 ? newB.height / oldB.height : 1;
  const out: Record<string, Win> = {};
  for (const [id, w] of Object.entries(windows)) {
    if (w.maximized) {
      out[id] = { ...w, rect: snapTarget("max", newB)! };
    } else if (w.snapped) {
      const scaled = { x: w.rect.x * sx, y: w.rect.y * sy, w: w.rect.w * sx, h: w.rect.h * sy };
      out[id] = { ...w, rect: clampRect(scaled, newB) };
    } else {
      out[id] = { ...w, rect: clampRect(w.rect, newB) };
    }
  }
  return out;
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
  spotlight: boolean; // 스포트라이트 모드(올라온 창 상단 타일, 나머지는 하단 커버 스트립). 런타임.
  spotlightRaised: string[]; // 스포트라이트에서 상단에 타일된 창들(최대 3). 진입 시 [포커스창]. 런타임.
  // 라우트 창의 iframe 현재 문서 제목/뒤로가능 여부(런타임, 미영속). RouteWindow가 iframe title·path를
  // 관찰해 갱신 → 타이틀바가 서브뷰 드릴인을 반영하고 크롬 뒤로(←) 버튼을 띄운다(인페이지 백 대체).
  live: Record<string, { title: string; canBack: boolean }>;
  // 창별 URL 스택(미영속) — same-origin iframe들이 공유하는 joint session history 대신 창마다 독립
  // 스택을 들고 뒤로(←)를 그 창의 iframe만 직접 이동시킨다(다른 창이 되감기는 #버그 방지).
  nav: Record<string, string[]>;
  // 창별 새로고침 nonce(런타임, 미영속) — 타이틀바 새로고침 버튼이 bump하면 RouteWindow가 그 창 iframe만
  // 현재 URL로 reload(전체 F5 대신 = 셸·다른 창 재실행 없이 그 창 콘텐츠만 빠르게 갱신).
  reloadNonce: Record<string, number>;
  // 창별 미저장 변경 여부(런타임, 미영속) — 창 본문 iframe의 폼이 useUnsavedGuard로 부모에 postMessage하면
  // workspace-canvas가 iframe→win.id 매칭 후 세팅. FloatingWindow가 닫기(X)·Esc에서 확인을 띄우는 데 쓴다.
  dirty: Record<string, boolean>;
  // BL3 warm 풀(런타임, 미영속) — 닫혔지만 iframe을 hidden으로 살려둔 라우트 창 id들(LRU, 끝=최근).
  // windows엔 minimized:true로 남아 마운트 유지되고 order에선 빠져 모든 창 UI에서 사라진다(닫힌 것처럼).
  // 같은 메뉴 재오픈 시 재렌더 없이 즉시 표시. 상한 CACHE_MAX 초과분은 close()가 실제 파괴.
  cached: string[];
};

function omitWindowArtifacts<T>(source: Record<string, T>, removed: Set<string>) {
  if (removed.size === 0) return source;
  return Object.fromEntries(Object.entries(source).filter(([id]) => !removed.has(id))) as Record<
    string,
    T
  >;
}

/** 영속본을 포함한 모든 창 상태 맵에서 옛 dashboard iframe 흔적을 원자적으로 제거한다. */
function withoutLegacyDashboardWindows(s: State) {
  const removed = new Set<string>();
  const candidates = new Set([
    ...Object.keys(s.windows),
    ...s.order,
    ...s.cached,
    ...Object.keys(s.live),
    ...Object.keys(s.nav),
    ...Object.keys(s.reloadNonce),
    ...Object.keys(s.dirty),
    ...s.spotlightRaised,
    ...(s.focusedId ? [s.focusedId] : []),
  ]);
  for (const id of candidates) {
    if (isLegacyDashboardWindow(id, s.windows[id])) removed.add(id);
  }
  const spotlightRaised = s.spotlightRaised.filter((id) => !removed.has(id));
  return {
    windows: omitWindowArtifacts(s.windows, removed),
    order: s.order.filter((id) => !removed.has(id)),
    focusedId: s.focusedId && !removed.has(s.focusedId) ? s.focusedId : null,
    live: omitWindowArtifacts(s.live, removed),
    nav: omitWindowArtifacts(s.nav, removed),
    reloadNonce: omitWindowArtifacts(s.reloadNonce, removed),
    dirty: omitWindowArtifacts(s.dirty, removed),
    cached: s.cached.filter((id) => !removed.has(id)),
    spotlightRaised,
    spotlight: s.spotlight && spotlightRaised.length > 0,
  };
}

type Actions = {
  setStage: (rect: { left: number; top: number; width: number; height: number }) => void;
  setSnapPreview: (z: SnapZone) => void;
  setDragging: (id: string | null) => void;
  setDragLayout: (v: { template: LayoutTemplate; slot: number } | null) => void;
  setDragNearTop: (v: boolean) => void;
  /** RouteWindow가 iframe 제목·현재 URL 변화를 보고 → 타이틀바 제목 + 창별 nav 스택/canBack 갱신. */
  observeIframe: (id: string, v: { title: string; url: string }) => void;
  /** 그 창의 nav 스택을 한 단계 pop하고 이동할 이전 URL을 반환(없으면 null). 뒤로(←) 버튼이 호출. */
  backNav: (id: string) => string | null;
  /** 이미 최상단(포커스)인 라우트 창을 다시 클릭했을 때 그 창을 "첫 화면"(메뉴 루트 href)으로 리셋 —
   *  nav 스택을 루트만 남기고 canBack=false로 되돌리고, 이동할 루트 URL을 반환한다(이미 루트면 null=무동작).
   *  호출부(레일)가 반환 URL로 그 창 iframe만 location.replace(뒤로 버튼과 동일 패턴, joint history 회피). */
  homeNav: (id: string) => string | null;
  /** 그 창의 iframe만 새로고침(전체 F5 대신) — nonce를 bump하면 RouteWindow가 현재 URL을 reload. */
  reloadWindow: (id: string) => void;
  /** 창 본문 폼의 미저장 변경 여부 세팅(workspace-canvas가 iframe postMessage 수신 시 호출). */
  setWindowDirty: (id: string, dirty: boolean) => void;
  applyDragLayout: (id: string, template: LayoutTemplate, slot: number) => void;
  /** anchor(뷰포트 좌표)를 주면 그 커서 위치에서 창이 뜬다(없으면 cascade). 링크 클릭이 전달. */
  open: (kind: WindowKind, params: WindowParams, anchor?: { x: number; y: number }) => void;
  /** 탭/링크 shift+클릭 — 기존 창을 포커스하지 않고 **새 인스턴스**로 연다(primary 비었으면 primary, 아니면 #n). */
  openNewInstance: (kind: WindowKind, params: WindowParams, anchor?: { x: number; y: number }) => void;
  /** 라우트 창을 같은 화면(현재 URL/제목)으로 한 벌 더 띄운다 — 복제본(#n, window-only). */
  duplicate: (winId: string) => void;
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
  enterSpotlight: (id?: string) => void; // 스포트라이트 진입(포커스 창 = 상단 타일)
  exitSpotlight: () => void;
  raiseToSpotlight: (id: string) => void; // 스트립 카드 → 상단으로 올림(최대 3, 초과 시 가장 오래된 것 내림)
  lowerFromSpotlight: (id: string) => void; // 상단 타일 창 → 스트립으로 내림(마지막 1개는 유지)
  /** `/dashboard` main을 전면에 보이도록 모든 일반 창을 최소화하고 옛 dashboard iframe은 제거한다. */
  showDesktop: () => void;
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
      spotlight: false,
      spotlightRaised: [],
      live: {},
      nav: {},
      reloadNonce: {},
      dirty: {},
      cached: [],

      setStage: ({ left, top, width, height }) =>
        set((s) => {
          if (
            s.bounds.width === width &&
            s.bounds.height === height &&
            s.origin.left === left &&
            s.origin.top === top
          ) {
            return s; // 변화 없음 — 불필요한 재배치/리렌더 방지
          }
          const newBounds = { width, height };
          return {
            origin: { left, top },
            bounds: newBounds,
            windows: reflowWindows(s.windows, s.bounds, newBounds),
          };
        }),
      setSnapPreview: (z) => set({ snapPreview: z }),
      setDragging: (id) => set({ draggingId: id }),
      setDragLayout: (v) => set({ dragLayout: v }),
      setDragNearTop: (v) => set({ dragNearTop: v }),
      // iframe 관찰값(제목·URL)을 받아 제목 + 창별 URL 스택을 갱신. pathname이 바뀌면(드릴인) push,
      // query만 바뀌면(예: billing ?tab=) top을 replace해 뒤로 단계로 안 센다. canBack = 스택 깊이>1.
      observeIframe: (id, { title, url }) =>
        set((s) => {
          const stack = s.nav[id] ?? [];
          const top = stack[stack.length - 1];
          let nextStack = stack;
          if (top !== url) {
            if (top === undefined) nextStack = [url];
            else if (top.split("?")[0] === url.split("?")[0]) nextStack = [...stack.slice(0, -1), url];
            else nextStack = [...stack, url];
          }
          const canBack = nextStack.length > 1;
          const cur = s.live[id];
          if (cur && cur.title === title && cur.canBack === canBack && nextStack === stack) return s;
          return {
            nav: nextStack === stack ? s.nav : { ...s.nav, [id]: nextStack },
            live: { ...s.live, [id]: { title, canBack } },
          };
        }),

      backNav: (id) => {
        const s = get();
        const stack = s.nav[id] ?? [];
        if (stack.length <= 1) return null;
        const nextStack = stack.slice(0, -1);
        const target = nextStack[nextStack.length - 1];
        set({
          nav: { ...s.nav, [id]: nextStack },
          live: {
            ...s.live,
            [id]: { title: s.live[id]?.title ?? "", canBack: nextStack.length > 1 },
          },
        });
        return target;
      },

      homeNav: (id) => {
        const s = get();
        const w = s.windows[id];
        if (!w || !w.params.href) return null;
        const home = w.params.href;
        const stack = s.nav[id] ?? [];
        const top = stack[stack.length - 1];
        // 이미 첫 화면(루트)이고 드릴인 이력도 없으면 무동작 — 불필요한 리로드/깜빡임 방지.
        if (stack.length <= 1 && (!top || stripEmbed(top) === stripEmbed(home))) return null;
        set({
          nav: { ...s.nav, [id]: [home] },
          live: { ...s.live, [id]: { title: s.live[id]?.title ?? w.params.title, canBack: false } },
        });
        return home;
      },
      reloadWindow: (id) =>
        set((s) => ({ reloadNonce: { ...s.reloadNonce, [id]: (s.reloadNonce[id] ?? 0) + 1 } })),

      setWindowDirty: (id, dirty) =>
        set((s) => {
          if ((s.dirty[id] ?? false) === dirty) return s; // 변화 없으면 리렌더 없음
          const next = { ...s.dirty };
          if (dirty) next[id] = true;
          else delete next[id];
          return { dirty: next };
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

      open: (kind, params, anchor) => {
        const id = windowId(kind, params.id);
        const s = get();
        if (s.windows[id]) {
          // 이미 열린 창: 복원+포커스. 단 컨텍스트 링크가 다른 href(같은 라우트의 다른 탭/서브뷰)면
          // 그 경로로 이동(href 갱신 → RouteWindow가 iframe src를 바꿔 네비게이트). #56 연장.
          set((st) => {
            const w = st.windows[id];
            if (!w) return st;
            const nextHref = params.href ?? w.params.href;
            const hrefChanged = nextHref !== w.params.href;
            return {
              windows: {
                ...st.windows,
                [id]: {
                  ...w,
                  minimized: false,
                  params: hrefChanged
                    ? { ...w.params, href: nextHref, title: params.title ?? w.params.title }
                    : w.params,
                },
              },
              order: bringToFront(st.order, id),
              focusedId: id,
              // BL3 — warm 풀에서 꺼냄(가시화된 창이 LRU에 남아 evict당하는 것 차단).
              cached: st.cached.filter((x) => x !== id),
              snapAssist: null,
            };
          });
          return;
        }
        let order = s.order;
        const windows = { ...s.windows };
        while (order.length >= MAX_WINDOWS) {
          const victim = order.find((wid) => wid !== s.focusedId) ?? order[0];
          delete windows[victim];
          order = order.filter((wid) => wid !== victim);
        }
        const size = kind === "route" ? routeWindowSize(params.id) : undefined;
        // anchor(클릭 지점) 있으면 커서 위치에서, 없으면 cascade. 스테이지 로컬 = 뷰포트 − origin.
        const rect = anchor
          ? rectAtPoint(anchor.x - s.origin.left, anchor.y - s.origin.top, s.bounds, size)
          : cascadeNext(order.length, s.bounds, size);
        windows[id] = {
          id,
          kind,
          params,
          rect,
          minimized: false,
          maximized: false,
        };
        set({
          windows,
          order: [...order, id],
          focusedId: id,
          snapAssist: null,
        });
      },

      // 탭/링크 shift+클릭 — 기존 창을 포커스(open)하지 않고 항상 새 인스턴스를 연다. primary가 비었으면
      // primary, 이미 있으면 다음 빈 #n. 반복 shift+클릭 = 듀얼/멀티 창.
      openNewInstance: (kind, params, anchor) =>
        set((s) => {
          const primary = windowId(kind, params.id);
          let targetId = primary;
          if (s.windows[primary]) {
            let n = 1;
            while (s.windows[`${primary}#${n}`]) n += 1;
            targetId = `${primary}#${n}`;
          }
          let order = s.order;
          const windows = { ...s.windows };
          while (order.length >= MAX_WINDOWS) {
            const victim = order.find((id) => id !== s.focusedId && id !== targetId) ?? order[0];
            delete windows[victim];
            order = order.filter((id) => id !== victim);
          }
          const size = kind === "route" ? routeWindowSize(params.id) : undefined;
          const rect = anchor
            ? rectAtPoint(anchor.x - s.origin.left, anchor.y - s.origin.top, s.bounds, size)
            : cascadeNext(order.length, s.bounds, size);
          windows[targetId] = { id: targetId, kind, params, rect, minimized: false, maximized: false };
          return {
            windows,
            order: [...order, targetId],
            focusedId: targetId,
            snapAssist: null,
          };
        }),

      // 라우트 창 복제 — 같은 화면(현재 URL·제목)으로 한 벌 더. primary id는 손대지 않고 #n 접미사 복제본 생성.
      // params.id(base 라우트)는 원본 보존(크기·아이콘 매핑), 화면은 nav 현재 URL·live 제목을 따라간다
      // (win.params.href는 최초 URL이라 상세→수정 드릴인 후 복제 시 최초 상세가 열리는 버그 회피).
      duplicate: (winId) =>
        set((s) => {
          const w = s.windows[winId];
          if (!w || w.kind !== "route") return s;
          const base = baseWindowId(winId); // "route:students" — instance 스캔 전용(params.id 아님)
          let n = 1;
          while (s.windows[`${base}#${n}`]) n += 1; // 닫힌 번호 재사용
          const newId = `${base}#${n}`;
          const stack = s.nav[winId] ?? [];
          const currentHref = stack[stack.length - 1] ?? w.params.href;
          const currentTitle = s.live[winId]?.title ?? w.params.title;
          let order = s.order;
          const windows = { ...s.windows };
          // 자리 확보 시 원본(winId)·포커스·새 창은 축출 대상에서 제외(원본 보호).
          while (order.length >= MAX_WINDOWS) {
            const victim =
              order.find((id) => id !== winId && id !== s.focusedId && id !== newId) ??
              order.find((id) => id !== winId) ??
              order[0];
            delete windows[victim];
            order = order.filter((id) => id !== victim);
          }
          windows[newId] = {
            id: newId,
            kind: "route",
            params: { ...w.params, href: currentHref, title: currentTitle },
            rect: cascadeNext(order.length, s.bounds, routeWindowSize(w.params.id)),
            minimized: false,
            maximized: false,
          };
          return { windows, order: [...order, newId], focusedId: newId, snapAssist: null };
        }),

      close: (id) =>
        set((s) => {
          const w = s.windows[id];
          const order = s.order.filter((wid) => wid !== id);
          // 스포트라이트 상단에서도 제거 — 비면 스포트라이트 해제(상단 빈 화면 방지).
          const raised = s.spotlightRaised.filter((x) => x !== id);
          const focusedId = s.focusedId === id ? (order[order.length - 1] ?? null) : s.focusedId;
          const spotlight = s.spotlight && raised.length === 0 ? false : s.spotlight;
          // BL3 — 라우트 창(비복제·비생성폼·비더티)은 파괴 대신 iframe을 살려 hidden 보존(재오픈 즉시).
          //   minimized:true + order 제거 = 모든 창 UI에서 닫힌 것처럼 사라지되 마운트는 유지.
          //   live/nav는 남겨 재오픈 시 제목·뒤로 스택이 즉시 복원. dirty만 정리.
          // (학생 요약·복제본·생성폼·더티 창은 아래 완전 파괴 — 폼 초안을 warm 보존하지 않는다.)
          const cacheable =
            !!w && w.kind === "route" && !isDuplicate(id) && !w.params.autoClose && !s.dirty[id];
          if (cacheable) {
            const windows = { ...s.windows, [id]: { ...w, minimized: true, maximized: false, snapped: false } };
            let cached = [...s.cached.filter((x) => x !== id), id]; // LRU — 최근이 끝
            const live = { ...s.live };
            const nav = { ...s.nav };
            const dirty = { ...s.dirty };
            delete dirty[id];
            // 상한 초과 → 가장 오래된 warm 창 실제 파괴(메모리 가드).
            while (cached.length > CACHE_MAX) {
              const victim = cached[0]!;
              cached = cached.slice(1);
              delete windows[victim];
              delete live[victim];
              delete nav[victim];
              delete dirty[victim];
            }
            return { windows, order, cached, live, nav, dirty, focusedId, spotlightRaised: raised, spotlight, snapAssist: null };
          }
          // 비캐시 대상 = 기존대로 완전 파괴.
          const windows = { ...s.windows };
          delete windows[id];
          const live = { ...s.live };
          delete live[id];
          const nav = { ...s.nav };
          delete nav[id];
          const dirty = { ...s.dirty };
          delete dirty[id];
          return { windows, order, live, nav, dirty, focusedId, spotlightRaised: raised, spotlight, snapAssist: null };
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
          // 최소화된 창은 스포트라이트 상단에서 제거 — 비면 해제.
          const raised = s.spotlightRaised.filter((x) => x !== id);
          return {
            windows: { ...s.windows, [id]: { ...w, minimized: true } },
            focusedId: rest[rest.length - 1] ?? null,
            spotlightRaised: raised,
            spotlight: s.spotlight && raised.length === 0 ? false : s.spotlight,
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
            cached: s.cached.filter((x) => x !== id), // BL3 방어 — 가시화 시 warm 풀에서 제거
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
            spotlightRaised: [focusId],
            focusedId: focusId,
            order: bringToFront(s.order, focusId),
            snapAssist: null,
            snapPreview: null,
            dragLayout: null,
          };
        }),
      exitSpotlight: () => set({ spotlight: false, spotlightRaised: [] }),

      // 스트립 카드 클릭 → 상단으로 올림. 이미 올라와 있으면 포커스만. 3개 초과면 가장 오래된 것 내림(FIFO).
      raiseToSpotlight: (id) =>
        set((s) => {
          if (!s.spotlight || !s.windows[id] || s.windows[id].minimized) return s;
          if (s.spotlightRaised.includes(id)) {
            return { focusedId: id, order: bringToFront(s.order, id) };
          }
          let raised = [...s.spotlightRaised, id];
          if (raised.length > 3) raised = raised.slice(raised.length - 3);
          return { spotlightRaised: raised, focusedId: id, order: bringToFront(s.order, id) };
        }),

      // 상단 타일 창 → 스트립으로 내림. 마지막 1개는 못 내림(상단이 비어 빈 화면이 되는 것 방지).
      lowerFromSpotlight: (id) =>
        set((s) => {
          if (!s.spotlight) return s;
          const raised = s.spotlightRaised.filter((x) => x !== id);
          if (raised.length === 0) return s;
          const focusedId = s.focusedId === id ? raised[raised.length - 1]! : s.focusedId;
          return { spotlightRaised: raised, focusedId, order: bringToFront(s.order, focusedId!) };
        }),

      // 오늘(`/dashboard`)은 iframe 창이 아니라 셸 main 자체인 데스크톱 작업면이다. 다른 창은 상태·폼을
      // 보존한 채 최소화하고, 예전 버전이 만든 dashboard 창/복제본/warm 캐시는 완전 제거해 숨은 중복
      // 데이터 요청이 다시 살아나지 않게 한다.
      showDesktop: () =>
        set((s) => {
          const cleaned = withoutLegacyDashboardWindows(s);
          const windows = Object.fromEntries(
            Object.entries(cleaned.windows).map(([id, w]) => [
              id,
              w.minimized ? w : { ...w, minimized: true },
            ]),
          );
          return {
            ...cleaned,
            windows,
            focusedId: null,
            spotlight: false,
            spotlightRaised: [],
            snapPreview: null,
            snapAssist: null,
            draggingId: null,
            dragLayout: null,
            dragNearTop: false,
          };
        }),

      // 복원 직후 호출: 다른 계정/테넌트 레이아웃이면 초기화(메타 누수 방지), 같으면 옛 dashboard
      // iframe을 제거하고 viewport clamp. 이 정리는 영속 마이그레이션 역할도 해 숨은 중복 fetch를 막는다.
      adoptOwner: (owner) =>
        set((s) => {
          if (s.owner && s.owner !== owner) {
            return {
              owner,
              windows: {},
              order: [],
              focusedId: null,
              cached: [],
              live: {},
              nav: {},
              reloadNonce: {},
              dirty: {},
              spotlight: false,
              spotlightRaised: [],
            };
          }
          const cleaned = withoutLegacyDashboardWindows(s);
          const windows: Record<string, Win> = {};
          for (const [id, w] of Object.entries(cleaned.windows)) {
            windows[id] = {
              ...w,
              rect: clampRect(w.maximized ? snapTarget("max", s.bounds)! : w.rect, s.bounds),
            };
          }
          return { ...cleaned, owner, windows };
        }),
    }),
    {
      name: "eywa-workspace",
      skipHydration: true, // 마운트 후 수동 rehydrate (SSR mismatch 회피)
      // autoClose(생성폼 /X/new) 창은 영속 제외 — 미제출로 떠난 빈 생성폼 창이 다음 세션에 부활하던 잔존
      // 방지(자동 닫힘은 초기경로에선 발화 안 함). 일반 라우트/학생 창의 영속은 그대로.
      partialize: (s) => {
        // autoClose(생성폼) + BL3 cached(닫혀 hidden 보존된 warm 창)는 영속 제외 — cached를 저장하면
        // 다음 세션에 order 밖 hidden iframe이 유령 부활(콜드 로드)해 stagger·성능을 깬다.
        const cachedSet = new Set(s.cached);
        const persisted = Object.fromEntries(
          Object.entries(s.windows).filter(
            ([id, w]) =>
              !w.params.autoClose && !cachedSet.has(id) && !isLegacyDashboardWindow(id, w),
          ),
        );
        return {
          owner: s.owner,
          windows: persisted,
          order: s.order.filter((id) => persisted[id]),
          focusedId: s.focusedId && persisted[s.focusedId] ? s.focusedId : null,
        };
      },
    },
  ),
);

// ⚠️ skipHydration이라 수동 rehydrate 필요. 컴포넌트 effect에서 호출하면 그보다 먼저 도는 다른 effect
// (setStage 등)의 set이 **빈 초기상태를 persist에 써버려 영속된 창을 파괴**한다(새로고침 시 창 전멸).
// 그래서 모듈 로드 시점(클라이언트, 어떤 set·effect보다 먼저)에 rehydrate해 영속본을 가장 먼저 적재한다.
// (서버에선 window 없음 → 미실행 → SSR은 빈 상태로 렌더, 클라 첫 렌더도 빈 상태라 hydration mismatch 없음.)
if (typeof window !== "undefined") {
  void useWindowStore.persist.rehydrate();
}
