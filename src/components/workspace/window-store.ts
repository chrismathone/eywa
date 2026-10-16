"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import {
  bringToFront,
  cascadeNext,
  clampRect,
  layoutSlots,
  rectAtPoint,
  resizeRect,
  routeWindowSize,
  routeMinSize,
  snapTarget,
  templateSlots,
  type Bounds,
  type LayoutTemplate,
  type Rect,
  type ResizeHandle,
  type SnapZone,
} from "./window-geometry";
import type { ShellMode } from "@/lib/license/shell-mode";
import { needsModeReset, planKeepalive, type KeepaliveOpts } from "./keepalive-rules";
import { formInstanceOf, withFormInstance, withoutFormInstance } from "@/lib/recording-resume";

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
 * minimize된 창과 동급 비용이라 상한만 지키면 안전.
 *
 * **4** (2026-07-29, 2에서 상향) — 창 열기의 지배항이 서버가 아니라 **뷰어 PC의 클라 JS 실행**임이
 * 실측으로 확정됐다(CPU 4배 스로틀 시 창 열기 405ms→746ms인데 서버 TTFB는 ~10ms로 불변). warm 재오픈은
 * 그 실행을 통째로 건너뛰므로 상한을 늘린 만큼 그대로 체감이 된다. 12개 메뉴 중 실제로 오가는 건
 * 3~5개라 4면 대부분의 왕복을 덮는다.
 * ⚠️ 대가는 숨은 iframe 최대 4개(메모리). realtime WS는 [connection-demand](../../features/presence/connection-demand.ts)
 *    지연 연결로 presence를 쓰는 창만 잡으므로, 상한을 올려도 WS가 상한만큼 늘지는 않는다.
 */
export const CACHE_MAX = 4;
/**
 * 창 식별 키. primary 인스턴스(instance 없음/0)는 `kind:paramId`(오늘과 동일 — 영속 레이아웃·배경 매핑 보존).
 * 복제본(instance≥1)만 `kind:paramId#n` 접미사를 단다. 기존 호출부는 전부 무인자라 영향 0.
 */
export function windowId(kind: WindowKind, paramId: string, instance?: number) {
  return instance ? `${kind}:${paramId}#${instance}` : `${kind}:${paramId}`;
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

/** embed=1 파라미터와 해시를 뗀 정규화 URL — homeNav·되살리기의 "이미 첫 화면(루트)인가" 비교용
 *  (창 iframe URL엔 항상 embed=1이 붙어 있어 raw 루트 href와 그대로 비교하면 안 맞는다).
 *  🔴 해시도 뗀다 — 해시만 다른 주소는 같은 문서다. 다르다고 보면 '첫 화면으로' 옮기는데, 해시만 다른 이동은 새 문서
 *     로드가 없어 스켈레톤이 영영 안 걷혔다(재리뷰 2026-09-11). 뒤로 기록은 경로+쿼리만 적는다(해시 없음). */
function stripEmbed(url: string) {
  const [path, query] = (url.split("#", 1)[0] ?? url).split("?");
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
  /**
   * 이 영속본이 어느 지점 방식(창 모드/단일 화면(이전 화면 유지)/단일 화면)으로 쌓였나(영속). 방식이 바뀌면 `adoptOwner`가 전부 닫고
   * 빈 상태로 시작한다(원장 2026-10-01). null = 이 기능 이전의 영속본(= 창 모드로 읽는다 — keepalive-rules `needsModeReset`).
   */
  shellMode: ShellMode | null;
  /** 그 방식의 판(영속) — 방식 행이 마지막으로 바뀐 시각. 방식이 같아도 판이 다르면(바꿨다 되돌림) 초기화한다(`needsModeReset`). */
  shellEpoch: string | null;
  /** 이전 화면 유지 방식 — 화면별 마지막 사용 시각(영속, ms). 숨은 화면의 2시간 만료 기준. 창 모드에선 비어 있다. */
  lastUsed: Record<string, number>;
  /** 이전 화면 유지 방식 — 지난 판정 때 보이던 화면(런타임). 보이는 화면이 바뀐 순간을 '사용 시각'으로 찍는 데 쓴다. */
  kaVisible: string | null;
  /** 이전 화면 유지 방식 — 지금 보이는 화면 앞에 보이던 화면(런타임, null = 첫 화면). 보이던 화면이 닫히면 여기로 돌아간다. */
  kaBack: string | null;
  /**
   * 이 문서가 **지금 이전 화면 유지 방식으로 그려지고 있나**(런타임 — 캔버스가 렌더된 방식에서 맞춘다). 복제 금지·사용 도장 같은 규칙은 영속본의
   * `shellMode`가 아니라 이것을 본다: 라이선스 조회 실패로 이 요청만 창 모드로 그려질 땐 영속본은 그대로라 규칙이 섞였다(적대 리뷰).
   */
  kaActive: boolean;
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
  // 창별 "끊기면 유실" 잠금(런타임, 미영속) — 녹음 등이 그 창 안에서 진행 중. 창 본문(use-recording-lock)이 부모에게
  // postMessage하면 RouteWindow가 **자기 iframe이 보낸 것만** 받아 여기에 싣는다(경로로 추측한 id는 드릴인에서 없는
  // 창을 가리켜 쓰지 않는다 — 전수검사 2026-09-11). **닫기 게이트의 단일 소스** — 창 자체 X(FloatingWindow)·하단 독
  // 칩의 ✕(WindowSwitcher)·창 개수 한도의 축출(makeRoom)이 같은 값을 본다(구독을 화면마다 따로 두면 늦게 마운트된
  // 화면이 진행 중인 잠금을 못 받아 그쪽으로만 닫혀 버린다).
  busy: Record<string, boolean>;
  // 창 크롬이 **미저장 창**을 옮길 때(← · 메뉴의 첫 화면)의 이동 의도(런타임, 미영속). 미저장 창은 떠나기 확인에서
  // '머무르기'를 고를 수 있어, 기록을 먼저 바꾸면 기록과 화면이 어긋난다 — 새 문서가 그 주소로 실제로 뜰 때
  // observeIframe이 소비한다(리뷰 2026-09-11). 깨끗한 창은 확인이 안 뜨니 종전대로 바로 바꾼다.
  pendingNav: Record<string, { url: string; stack: string[] }>;
  // '첫 화면으로' 표식(런타임, 미영속) — 보관(닫힌) 창을 첫 화면 주소로 되살렸는데 문서가 첫 화면이 아니면 open()이 올린다.
  // RouteWindow가 스켈레톤을 띄우고 그 창 iframe만 첫 화면으로 옮긴다(어느 입구로 되살려도 같게 — 판정은 스토어 한 곳).
  homeNonce: Record<string, number>;
  // BL3 warm 풀(런타임, 미영속) — 닫혔지만 iframe을 hidden으로 살려둔 라우트 창 id들(LRU, 끝=최근).
  // windows엔 minimized:true로 남아 마운트 유지되고 order에선 빠져 모든 창 UI에서 사라진다(닫힌 것처럼).
  // 같은 메뉴 재오픈 시 재렌더 없이 즉시 표시. 상한 CACHE_MAX 초과분은 close()가 실제 파괴.
  cached: string[];
};

/** 스포트라이트(앨범) 상단에 올라오는 창 수 상한 — 넘치면 가장 오래 올라와 있던 것부터 내린다(FIFO). */
const SPOTLIGHT_MAX = 3;

/** 스포트라이트 상단 목록에 id를 올린 결과 — 이미 있으면 그대로(참조 불변), 넘치면 가장 오래된 것부터 내린다. */
function raiseInto(raised: string[], id: string): string[] {
  if (raised.includes(id)) return raised;
  const next = [...raised, id];
  return next.length > SPOTLIGHT_MAX ? next.slice(next.length - SPOTLIGHT_MAX) : next;
}

/** 창 하나를 **완전히** 없앨 때 함께 바뀌는 상태 조각 — close()의 파괴·보관 상한·창 개수 한도의 축출이 공유한다. */
type Slice = Pick<
  State,
  | "windows"
  | "order"
  | "cached"
  | "focusedId"
  | "spotlight"
  | "spotlightRaised"
  | "live"
  | "nav"
  | "dirty"
  | "busy"
  | "reloadNonce"
  | "pendingNav"
  | "homeNonce"
  | "lastUsed"
>;

function sliceOf(s: State): Slice {
  return {
    windows: s.windows,
    order: s.order,
    cached: s.cached,
    focusedId: s.focusedId,
    spotlight: s.spotlight,
    spotlightRaised: s.spotlightRaised,
    live: s.live,
    nav: s.nav,
    dirty: s.dirty,
    busy: s.busy,
    reloadNonce: s.reloadNonce,
    pendingNav: s.pendingNav,
    homeNonce: s.homeNonce,
    lastUsed: s.lastUsed,
  };
}

/** 맵에서 한 키를 뺀 새 맵 — 없으면 그대로(참조 불변 = 그 맵을 구독하는 화면이 다시 안 그려진다). */
function omitKey<T>(m: Record<string, T>, id: string): Record<string, T> {
  if (!(id in m)) return m;
  const next = { ...m };
  delete next[id];
  return next;
}

/**
 * 창 하나를 **완전히** 없앤다 — 창과 그 흔적(제목·뒤로 기록·미저장·잠금·새로고침 표식·스포트라이트 자리)을 **함께**.
 * 🔴 흔적만 남으면 같은 id로 다시 연 창이 그걸 물려받는다: 옛 상세로 가는 ←가 서고, 잠금(busy)이 남으면 닫기(✕)·Esc가
 *    영영 안 풀린다(해제 신호를 보낼 옛 iframe이 없다). 창 개수 한도의 축출이 `windows`만 지우던 것이 그 결함이었다
 *    (전수검사 2026-09-11) — 그래서 close()·보관 상한·축출이 이 함수 하나를 쓴다.
 */
function withoutWindow(s: Slice, id: string): Slice {
  const order = s.order.includes(id) ? s.order.filter((x) => x !== id) : s.order;
  const spotlightRaised = s.spotlightRaised.includes(id)
    ? s.spotlightRaised.filter((x) => x !== id)
    : s.spotlightRaised;
  return {
    windows: omitKey(s.windows, id),
    order,
    cached: s.cached.includes(id) ? s.cached.filter((x) => x !== id) : s.cached,
    focusedId: s.focusedId === id ? (order[order.length - 1] ?? null) : s.focusedId,
    spotlightRaised,
    // 스포트라이트 상단이 비면 해제 — 상단 빈 화면 방지.
    spotlight: s.spotlight && spotlightRaised.length > 0,
    live: omitKey(s.live, id),
    nav: omitKey(s.nav, id),
    dirty: omitKey(s.dirty, id),
    busy: omitKey(s.busy, id),
    reloadNonce: omitKey(s.reloadNonce, id),
    pendingNav: omitKey(s.pendingNav, id),
    homeNonce: omitKey(s.homeNonce, id),
    lastUsed: omitKey(s.lastUsed, id),
  };
}

/**
 * 녹음 중인 창을 다른 화면으로 옮기려 했을 때의 안내 — 옮기면 녹음이 끊긴다(✕·⟳·←도 같은 이유로 잠겨 있다).
 * 같은 id라 연달아 눌러도 한 장만 뜬다.
 */
function warnWindowBusy(title: string) {
  toast.warning(`${title} — 녹음 중이라 화면을 옮기지 않았습니다. 녹음을 정지한 뒤 다시 눌러 주세요`, {
    id: "window-busy-move",
  });
}

/** 주소의 경로 부분(쿼리·해시 제외) — "같은 화면인가"(뒤로 기록·이동 의도)를 가를 때 쓴다. */
function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

/**
 * 새 창 자리를 만든다 — 창이 `MAX_WINDOWS`개면 **뒤에 있는 창부터** 밀어낸다. 밀어낼 창이 없으면 null(열지 않는다).
 * 🔴 미저장(dirty)·작업 중(busy — 녹음 등) 창은 **밀어내지 않는다**. 예전엔 창 7번째를 열면 가장 뒤 창이 확인 없이
 *    사라졌다 — 작성 중인 글도, 녹음 중인 iframe도 함께(전수검사 2026-09-11). 확인 UI는 그 창 위에 있어 여기서 물을
 *    수도 없다(독의 닫기와 같은 판단) — 그러니 건드리지 않고, 밀어낼 창이 없으면 새 창 쪽을 멈춘다.
 * `keep` = 밀어내면 안 되는 창(지금 보는 창·복제 원본·새로 열 창).
 */
function makeRoom(s: State, keep: readonly (string | null)[]): Slice | null {
  let room = sliceOf(s);
  while (room.order.length >= MAX_WINDOWS) {
    const { order, dirty, busy } = room;
    const victim = order.find((id) => !keep.includes(id) && !dirty[id] && !busy[id]);
    if (!victim) return null;
    room = withoutWindow(room, victim);
  }
  return room;
}

/** 창 개수 한도에 막혀 새 창을 못 열었을 때의 안내 — 같은 id라 연달아 눌러도 한 장만 뜬다. */
function warnWindowLimit() {
  toast.warning("창이 너무 많습니다 — 창을 하나 닫은 뒤 다시 열어 주세요", {
    id: "window-limit",
    description: `창은 ${MAX_WINDOWS}개까지 열립니다. 저장하지 않은 내용이 있거나 녹음 중인 창은 자동으로 닫지 않습니다.`,
  });
}

type Actions = {
  setStage: (rect: { left: number; top: number; width: number; height: number }) => void;
  setSnapPreview: (z: SnapZone) => void;
  setDragging: (id: string | null) => void;
  setDragLayout: (v: { template: LayoutTemplate; slot: number } | null) => void;
  setDragNearTop: (v: boolean) => void;
  /**
   * RouteWindow가 iframe 제목·현재 URL 변화를 보고 → 타이틀바 제목 + 창별 nav 스택/canBack 갱신.
   * `reset` = 메뉴가 창의 첫 화면(`params.href`)을 바꾼 뒤 **새 문서의 첫 로드** — 스택을 그 주소 하나로 다시 시작한다.
   */
  /** `load` = 새 문서의 첫 로드 보고(RouteWindow onLoad) — 미저장 창의 이동 의도(`pendingNav`)는 이 보고에서만 소비된다. */
  observeIframe: (id: string, v: { title: string; url: string; reset?: boolean; load?: boolean }) => void;
  /** 그 창의 nav 스택을 한 단계 pop하고 이동할 이전 URL을 반환(없으면 null). 뒤로(←) 버튼이 호출.
   *  녹음 중이면 null(옮기지 않는다). 미저장 창은 기록을 바로 바꾸지 않고 의도(`pendingNav`)만 남긴다 — 새 문서가 뜰 때 바꾼다. */
  backNav: (id: string) => string | null;
  /** 이미 최상단(포커스)인 라우트 창을 다시 클릭했을 때 그 창을 "첫 화면"(메뉴 루트 href)으로 리셋 —
   *  nav 스택을 루트만 남기고 canBack=false로 되돌리고, 이동할 루트 URL을 반환한다(이미 루트면 null=무동작).
   *  호출부(레일)가 반환 URL로 그 창 iframe만 location.replace(뒤로 버튼과 동일 패턴, joint history 회피).
   *  녹음 중이면 null + 안내(옮기지 않는다). 미저장 창은 ←와 같이 의도만 남긴다(떠나기 확인에서 '머무르기'면 그대로). */
  homeNav: (id: string) => string | null;
  /** 그 창의 iframe만 새로고침(전체 F5 대신) — nonce를 bump하면 RouteWindow가 현재 URL을 reload. */
  reloadWindow: (id: string) => void;
  /** 창 본문 폼의 미저장 변경 여부 세팅(workspace-canvas가 iframe postMessage 수신 시 호출). */
  setWindowDirty: (id: string, dirty: boolean) => void;
  /** 창의 "끊기면 유실" 잠금 세팅(RouteWindow가 자기 iframe의 잠금 신호를 받을 때 호출 — use-recording-lock). */
  setWindowBusy: (id: string, busy: boolean) => void;
  applyDragLayout: (id: string, template: LayoutTemplate, slot: number) => void;
  /**
   * anchor(뷰포트 좌표)를 주면 그 커서 위치에서 창이 뜬다(없으면 cascade). 링크 클릭이 전달.
   * 창을 보였으면 true. 창 개수 한도에 막혀(밀어낼 수 있는 창이 없음 — 전부 미저장·녹음 중) 못 열었으면 false
   * — 이유 안내는 스토어가 띄우니 호출부는 "창이 떴다"를 전제로 한 후속 동작만 건너뛰면 된다.
   */
  open: (kind: WindowKind, params: WindowParams, anchor?: { x: number; y: number }) => boolean;
  /**
   * 탭/링크 shift+클릭 — 기존 창을 포커스하지 않고 **새 인스턴스**로 연다(primary 비었으면 primary, 아니면 #n). 반환값은 open과 같다.
   * 이전 화면 유지 방식엔 한 벌 더가 없다(그 화면을 연다) — `form`은 `openForm`의 예외(녹음 중 작성 화면의 새 작성 창)만 쓴다:
   * 이전 화면 유지에서도 열고, 보관된 원본을 되살리지 않는다(되살리면 그 창의 첫 화면 주소가 새 작성 화면으로 바뀐다).
   */
  openNewInstance: (kind: WindowKind, params: WindowParams, anchor?: { x: number; y: number }, opts?: { form?: boolean }) => boolean;
  /**
   * "새 X" 작성 폼 창(`useOpenFormWindow`) — 녹음이 걸리지 않은 같은 작성 창이 있으면 그 창(종전 `open`과 같다). 그 메뉴의
   * 작성 창이 **전부 녹음 중**이면 새 작성 창을 `form=<id>`로 한 벌 더 연다(원장 2026-10-16 "창이 그냥 여러개 열리면").
   * 이전 화면 유지 방식도 이때만 한 벌 더(2026-10-01 '복제 없음'의 예외 — 녹음 중 작성 화면만).
   */
  openForm: (kind: WindowKind, params: WindowParams, anchor?: { x: number; y: number }) => boolean;
  /** 라우트 창을 같은 화면(현재 URL/제목)으로 한 벌 더 띄운다 — 복제본(#n, window-only). 반환값은 open과 같다. */
  duplicate: (winId: string) => boolean;
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
  /**
   * 복원 직후 호출 — 다른 계정이면, 그리고 `mode`가 주어졌는데 영속본의 방식·판과 다르면(`needsModeReset`) 전부 닫고 빈 상태로 시작한다.
   * 방식은 문서를 열 때 한 번 정해진다(`ShellModeProvider`가 고정) — 그래서 이 판정은 페이지를 새로 연 때만 의미가 있다(입력·녹음 표식은
   * 런타임이라 그때 남은 것이 없다). `mode` 생략 = 종전 동작(계정만 본다 — 방식을 모를 때도 이 길).
   */
  adoptOwner: (owner: string, mode?: ShellMode, epoch?: string | null) => void;
  /**
   * 이전 화면 유지 방식의 한 번 판정 — 보이는 화면은 하나(나머지 숨김) · 개수 상한 · 2시간 만료 · 닫힌 보관분 폐기 · 사용 시각 도장.
   * 규칙은 순수 함수(`planKeepalive`)가 정하고 여기선 그 결과를 적용만 한다. **멱등**이어야 한다(바뀔 게 없으면 상태를 안 건드린다 —
   * 구독 루프가 끝난다).
   */
  applyKeepalive: (now: number, opts?: KeepaliveOpts) => void;
};

export const useWindowStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      owner: null,
      shellMode: null,
      shellEpoch: null,
      lastUsed: {},
      kaVisible: null,
      kaBack: null,
      kaActive: false,
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
      busy: {},
      pendingNav: {},
      homeNonce: {},
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
      observeIframe: (id, { title, url, reset, load }) =>
        set((s) => {
          // 없는 창의 보고는 버린다 — 닫힌(파괴된) 창의 늦은 보고가 지운 흔적(제목·뒤로 기록)을 되살리면, 같은 id로 다시 연
          // 창이 그 기록을 물려받는다(옛 상세로 가는 ← — 리뷰 2026-09-11).
          if (!s.windows[id]) return s;
          const stack = s.nav[id] ?? [];
          const top = stack[stack.length - 1];
          const pend = s.pendingNav[id];
          let pendingNav = s.pendingNav;
          let nextStack = stack;
          // ⚠️ **새 문서의 첫 로드 보고**(`load`)에서만 소비한다 — 같은 문서의 보고(제목 변경 등)는 경로가 같아도 '도착'이
          //    아니다. 지금 문서가 첫 화면과 경로가 같고 쿼리만 다르면 '머무르기' 뒤 그 보고가 의도를 먹어 기록이 사라졌다
          //    (재리뷰 2026-09-11).
          if (pend && load && pathOf(url) === pathOf(pend.url)) {
            // 창 크롬(← · 첫 화면)이 미저장 창을 옮기려던 곳에 새 문서가 실제로 떴다 — 이제 기록을 바꾼다(실제 주소로).
            nextStack = [...pend.stack.slice(0, -1), url];
            pendingNav = omitKey(s.pendingNav, id);
          } else {
            // '머무르기' 뒤 창 안에서 다른 곳으로 갔으면 의도는 끝났다. 지금 문서(맨 위)의 보고는 의도를 지우지 않는다.
            if (pend && url !== top) pendingNav = omitKey(s.pendingNav, id);
            // 🔴 메뉴가 창의 첫 화면을 바꿨으면(open-menu-window → `open()` hrefChanged — 면 전환·필터 주소)
            //    새 문서의 첫 보고에서 스택을 새로 시작한다. 안 그러면 첫 화면에 ←가 서고(#56), 같은 면을 다시
            //    누르면 `homeNav`가 스택 깊이를 보고 불필요하게 다시 불러오며, 오갈 때마다 스택이 쌓인다(리뷰 2026-09-11).
            if (reset) {
              if (!(stack.length === 1 && top === url)) nextStack = [url];
            } else if (top !== url) {
              if (top === undefined) nextStack = [url];
              else if (pathOf(top) === pathOf(url)) nextStack = [...stack.slice(0, -1), url];
              else nextStack = [...stack, url];
            }
          }
          const canBack = nextStack.length > 1;
          const cur = s.live[id];
          if (
            cur &&
            cur.title === title &&
            cur.canBack === canBack &&
            nextStack === stack &&
            pendingNav === s.pendingNav
          ) {
            return s;
          }
          return {
            nav: nextStack === stack ? s.nav : { ...s.nav, [id]: nextStack },
            live: { ...s.live, [id]: { title, canBack } },
            pendingNav,
          };
        }),

      backNav: (id) => {
        const s = get();
        // 녹음 중이면 옮기지 않는다 — ←는 화면에서도 잠겨 있다(FloatingWindow). 여기는 마지막 문.
        if (s.busy[id]) return null;
        const stack = s.nav[id] ?? [];
        if (stack.length <= 1) return null;
        const nextStack = stack.slice(0, -1);
        const target = nextStack[nextStack.length - 1];
        // 🔴 미저장 창은 떠나기 확인이 뜬다 — '머무르기'면 문서가 그대로라 기록을 먼저 바꾸면 ←·기록이 화면과 어긋난다
        //    (리뷰 2026-09-11). 의도만 남기고 새 문서가 그 주소로 실제로 뜰 때 바꾼다(observeIframe).
        if (s.dirty[id]) {
          set({ pendingNav: { ...s.pendingNav, [id]: { url: target, stack: nextStack } } });
          return target;
        }
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
        // 🔴 녹음 중이면 첫 화면으로 옮기지 않는다 — 옮기면 녹음이 끊긴다(리뷰 2026-09-11). 왜 안 갔는지 알린다.
        if (s.busy[id]) {
          warnWindowBusy(w.params.title);
          return null;
        }
        // 미저장 창 — ←와 같은 이유로 기록은 새 문서가 뜰 때 바꾼다(옮기는 동안 떠나기 확인이 글을 지킨다).
        if (s.dirty[id]) {
          set({ pendingNav: { ...s.pendingNav, [id]: { url: home, stack: [home] } } });
          return home;
        }
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
      setWindowBusy: (id, busy) =>
        set((s) => {
          // 없는 창의 잠금은 버린다 — 닫힌 창의 늦은 신호가 잠금을 되살리면 같은 id로 다시 연 창의 닫기가 막힌다.
          if (!s.windows[id]) return s;
          if ((s.busy[id] ?? false) === busy) return s; // 변화 없으면 리렌더 없음
          const next = { ...s.busy };
          if (busy) next[id] = true;
          else delete next[id];
          return { busy: next };
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
        const w = s.windows[id];
        if (w) {
          // 이미 열린 창: 복원+포커스. 단 컨텍스트 링크가 다른 href(같은 라우트의 다른 탭/서브뷰)면
          // 그 경로로 이동(href 갱신 → RouteWindow가 iframe src를 바꿔 네비게이트). #56 연장.
          const moveTo = params.href !== undefined && params.href !== w.params.href ? params.href : null;
          // 🔴 녹음 중인 창은 다른 화면으로 옮기지 않는다 — 옮기면 녹음이 끊긴다(✕·⟳·←도 같은 이유로 잠겨 있다). 앞으로만.
          const moving = moveTo !== null && !s.busy[id] ? moveTo : null;
          if (moveTo !== null && moving === null) warnWindowBusy(w.params.title);
          // 🔴 보관(닫힌) 창은 창 개수에 다시 들어온다 — 한도를 지킨다(미저장·녹음 중 창은 안 밀어낸다). 자리가 없으면 거절.
          //    (리뷰 2026-09-11: 한도를 우회해 7개가 되고, 다음 새 창 하나가 창 둘을 한꺼번에 밀어냈다.)
          let room: Slice = sliceOf(s);
          if (!s.order.includes(id)) {
            const r = makeRoom(s, [s.focusedId, id]);
            if (!r) {
              warnWindowLimit();
              return false;
            }
            room = r;
          }
          let { nav, live, homeNonce, pendingNav } = room;
          if (moving) {
            // 다른 화면으로 옮긴다 — 새 문서가 뜰 때까지 옛 ←가 살아 있으면 눌러서 고른 화면을 취소하게 된다(리뷰 2026-09-11).
            // 기록을 즉시 그 주소 하나로(새 문서의 첫 로드가 실제 주소로 다시 시작한다 — RouteWindow reset-on-load).
            nav = { ...nav, [id]: [moving] };
            live = { ...live, [id]: { title: params.title ?? w.params.title, canBack: false } };
            pendingNav = omitKey(pendingNav, id);
          } else if (s.cached.includes(id) && w.params.href) {
            // 🔴 닫았던 창을 그 창의 첫 화면 주소로 다시 연다 — 어느 입구든(메뉴·창 링크·알림·인쇄) 첫 화면으로
            //    (원장 결정 2026-09-11, 09-10 "메뉴 누르면 초기 목록"과 같은 결 — 규칙이 메뉴 입구에만 있으면 갈린다).
            const home = w.params.href;
            const stack = nav[id] ?? [];
            const top = stack[stack.length - 1];
            if (!top || stripEmbed(top) === stripEmbed(home)) {
              // 첫 화면에서 닫았다 — 다시 불러오지 않고 즉시(보관의 속도 이점). 기록만 첫 화면 하나로 줄인다.
              if (top && stack.length > 1) nav = { ...nav, [id]: [top] };
              const cur = live[id];
              if (cur?.canBack) live = { ...live, [id]: { ...cur, canBack: false } };
            } else {
              // 문서는 RouteWindow가 옮긴다(스켈레톤 + 그 창 iframe만) — 기록을 첫 화면으로 두고 표식만 올린다.
              nav = { ...nav, [id]: [home] };
              live = { ...live, [id]: { title: w.params.title, canBack: false } };
              homeNonce = { ...homeNonce, [id]: (homeNonce[id] ?? 0) + 1 };
            }
          }
          set({
            ...room,
            windows: {
              ...room.windows,
              [id]: {
                ...w,
                minimized: false,
                params: moving ? { ...w.params, href: moving, title: params.title ?? w.params.title } : w.params,
              },
            },
            order: bringToFront(room.order, id),
            focusedId: id,
            // BL3 — warm 풀에서 꺼냄(가시화된 창이 LRU에 남아 evict당하는 것 차단).
            cached: room.cached.filter((x) => x !== id),
            nav,
            live,
            homeNonce,
            pendingNav,
            // 스포트라이트(앨범) 중이면 위로 올린다 — 포커스만 받고 가려진(opacity 0·클릭 불가) 창이 되지 않게
            // (전수검사 2026-09-11 — 사이드바·메뉴 판·팰릿·알림 전부 이 경로다).
            spotlight: s.spotlight,
            spotlightRaised: s.spotlight ? raiseInto(room.spotlightRaised, id) : room.spotlightRaised,
            snapAssist: null,
          });
          return true;
        }
        // 창 개수 한도 — 미저장·녹음 중 창은 밀어내지 않는다. 밀어낼 창이 없으면 열지 않고 알린다.
        const room = makeRoom(s, [s.focusedId]);
        if (!room) {
          warnWindowLimit();
          return false;
        }
        const size = kind === "route" ? routeWindowSize(params.id) : undefined;
        // anchor(클릭 지점) 있으면 커서 위치에서, 없으면 cascade. 스테이지 로컬 = 뷰포트 − origin.
        const rect = anchor
          ? rectAtPoint(anchor.x - s.origin.left, anchor.y - s.origin.top, s.bounds, size)
          : cascadeNext(room.order.length, s.bounds, size);
        set({
          ...room,
          windows: { ...room.windows, [id]: { id, kind, params, rect, minimized: false, maximized: false } },
          order: [...room.order, id],
          focusedId: id,
          // 밀려난 창이 앨범 위의 마지막 창이었어도 앨범은 그대로다 — 새 창이 그 자리에 올라온다.
          spotlight: s.spotlight,
          spotlightRaised: s.spotlight ? raiseInto(room.spotlightRaised, id) : room.spotlightRaised,
          snapAssist: null,
        });
        return true;
      },

      // 탭/링크 shift+클릭 — 기존 창을 포커스(open)하지 않고 항상 새 인스턴스를 연다. primary가 비었으면
      // primary, 이미 있으면 다음 빈 #n. 반복 shift+클릭 = 듀얼/멀티 창.
      openNewInstance: (kind, params, anchor, opts) => {
        const s = get();
        // 이전 화면 유지 방식엔 '같은 화면 한 벌 더'(듀얼 창)가 없다 — Shift+클릭도 그 화면을 연다(복제 금지, 원장 2026-10-01).
        // 예외는 녹음 중 작성 화면 하나뿐(openForm).
        if (s.kaActive && !opts?.form) return get().open(kind, params, anchor);
        const primary = windowId(kind, params.id);
        // 원본이 보관(닫힘) 중이면 새 번호 대신 원본을 되살린다 — 숨은 원본을 두고 '(2)'가 뜨던 것(리뷰 2026-09-11).
        // 되살리기는 open()이 한다(창 개수 한도·첫 화면 규칙 포함). 새 작성 창(openForm)은 늘 새 번호다.
        if (s.cached.includes(primary) && !opts?.form) return get().open(kind, params, anchor);
        let targetId = primary;
        if (s.windows[primary]) {
          let n = 1;
          while (s.windows[`${primary}#${n}`]) n += 1;
          targetId = `${primary}#${n}`;
        }
        const room = makeRoom(s, [s.focusedId, targetId]);
        if (!room) {
          warnWindowLimit();
          return false;
        }
        const size = kind === "route" ? routeWindowSize(params.id) : undefined;
        const rect = anchor
          ? rectAtPoint(anchor.x - s.origin.left, anchor.y - s.origin.top, s.bounds, size)
          : cascadeNext(room.order.length, s.bounds, size);
        set({
          ...room,
          windows: { ...room.windows, [targetId]: { id: targetId, kind, params, rect, minimized: false, maximized: false } },
          order: [...room.order, targetId],
          focusedId: targetId,
          spotlight: s.spotlight,
          spotlightRaised: s.spotlight ? raiseInto(room.spotlightRaised, targetId) : room.spotlightRaised,
          snapAssist: null,
        });
        return true;
      },

      openForm: (kind, params, anchor) => {
        const s = get();
        const base = windowId(kind, params.id);
        const family = Object.keys(s.windows).filter((id) => baseWindowId(id) === base && !s.cached.includes(id));
        const free = family.filter((id) => !s.busy[id]);
        const want = params.href;
        // 같은 화면(작성 화면 표식 `form`만 다르다)이면 그 창을 앞으로. 다른 화면(학생을 고른 '상담 기록 +')이면 입력 중이
        // 아닌 창만 그 주소로 옮긴다 — 입력 중인 창을 옮기면 쓰던 것이 사라진다(재리뷰 2026-10-16). 둘 다 없으면 새 작성 창.
        const same = (id: string) => want === undefined || withoutFormInstance(s.windows[id].params.href ?? "") === withoutFormInstance(want);
        const target = free.find(same) ?? free.find((id) => !s.dirty[id]);
        if (!family.length || target === base) return get().open(kind, params, anchor);
        if (target) {
          const w = s.windows[target];
          if (want !== undefined && !same(target)) {
            // 🔴 그 창의 표식은 그대로 — 떼면 녹음 중인 첫 작성 화면과 같은 임시 저장 칸을 쓰게 된다.
            const formId = formInstanceOf(w.params.href ?? "");
            const href = formId ? withFormInstance(want, formId) : want;
            const title = params.title ?? w.params.title;
            set({
              windows: { ...s.windows, [target]: { ...w, params: { ...w.params, href, title } } },
              nav: { ...s.nav, [target]: [href] },
              live: { ...s.live, [target]: { title, canBack: false } },
              pendingNav: omitKey(s.pendingNav, target),
            });
          }
          get().restore(target);
          return true;
        }
        // 전부 녹음 중 — 새 작성 창. 임시 저장 칸도 따로 쓰도록 `form=<id>`를 단다(recording-resume.ts).
        const href = params.href ? withFormInstance(params.href) : params.href;
        return get().openNewInstance(kind, { ...params, href }, anchor, { form: true });
      },

      // 라우트 창 복제 — 같은 화면(현재 URL·제목)으로 한 벌 더. primary id는 손대지 않고 #n 접미사 복제본 생성.
      // params.id(base 라우트)는 원본 보존(크기·아이콘 매핑), 화면은 nav 현재 URL·live 제목을 따라간다
      // (win.params.href는 최초 URL이라 상세→수정 드릴인 후 복제 시 최초 상세가 열리는 버그 회피).
      duplicate: (winId) => {
        const s = get();
        const w = s.windows[winId];
        if (!w || w.kind !== "route" || s.kaActive) return false;
        const base = baseWindowId(winId); // "route:students" — instance 스캔 전용(params.id 아님)
        let n = 1;
        while (s.windows[`${base}#${n}`]) n += 1; // 닫힌 번호 재사용
        const newId = `${base}#${n}`;
        const stack = s.nav[winId] ?? [];
        const currentHref = stack[stack.length - 1] ?? w.params.href;
        const currentTitle = s.live[winId]?.title ?? w.params.title;
        // 자리 확보 시 원본(winId)·포커스·새 창은 밀어내지 않는다(원본 보호) — 미저장·녹음 중 창도(makeRoom).
        const room = makeRoom(s, [winId, s.focusedId, newId]);
        if (!room) {
          warnWindowLimit();
          return false;
        }
        set({
          ...room,
          windows: {
            ...room.windows,
            [newId]: {
              id: newId,
              kind: "route",
              params: { ...w.params, href: currentHref, title: currentTitle },
              rect: cascadeNext(room.order.length, s.bounds, routeWindowSize(w.params.id)),
              minimized: false,
              maximized: false,
            },
          },
          order: [...room.order, newId],
          focusedId: newId,
          spotlight: s.spotlight,
          spotlightRaised: s.spotlight ? raiseInto(room.spotlightRaised, newId) : room.spotlightRaised,
          snapAssist: null,
        });
        return true;
      },

      close: (id) =>
        set((s) => {
          const w = s.windows[id];
          const cacheable =
            !!w && w.kind === "route" && !isDuplicate(id) && !w.params.autoClose && !s.dirty[id];
          // 학생 요약·복제본·생성폼·더티 창 = 완전 파괴(폼 초안을 warm 보존하지 않는다). 흔적까지 한 함수로.
          if (!cacheable) return { ...withoutWindow(sliceOf(s), id), snapAssist: null };
          // BL3 — 라우트 창(비복제·비생성폼·비더티)은 파괴 대신 iframe을 살려 hidden 보존(재오픈 즉시).
          //   minimized:true + order 제거 = 모든 창 UI에서 닫힌 것처럼 사라지되 마운트는 유지.
          //   live/nav는 남겨 둔다 — 첫 화면에서 닫은 창은 다시 열 때 제목이 즉시 복원된다. 다시 열면(어느 입구든)
          //   스토어 open()이 첫 화면으로 되돌린다(닫기 전 상세가 그대로 뜨던 것, 전수검사·리뷰 2026-09-11).
          const order = s.order.filter((wid) => wid !== id);
          // 스포트라이트 상단에서도 제거 — 비면 스포트라이트 해제(상단 빈 화면 방지).
          const spotlightRaised = s.spotlightRaised.filter((x) => x !== id);
          let next: Slice = {
            ...sliceOf(s),
            windows: { ...s.windows, [id]: { ...w, minimized: true, maximized: false, snapped: false } },
            order,
            cached: [...s.cached.filter((x) => x !== id), id], // LRU — 최근이 끝
            focusedId: s.focusedId === id ? (order[order.length - 1] ?? null) : s.focusedId,
            spotlightRaised,
            spotlight: s.spotlight && spotlightRaised.length > 0,
            dirty: omitKey(s.dirty, id),
            // ⚠️ 잠금 표식도 함께 버린다 — 닫힌 창의 busy가 남으면 **같은 id로 다시 열었을 때** 영문 모르게
            //    닫기가 막힌다(신호를 쏘던 iframe은 이미 없어 해제 신호도 안 온다).
            busy: omitKey(s.busy, id),
            // 이동 의도도 버린다 — 되살린 창이 옛 의도를 물려받지 않게. ⚠️ homeNonce는 **남긴다**: RouteWindow가 마운트된
            // 채 보관되므로, 지우면 선택값이 0으로 바뀌어 표식이 새로 올라온 것처럼 보고 첫 화면으로 옮긴다(reloadNonce와 같은 이유).
            pendingNav: omitKey(s.pendingNav, id),
          };
          // 상한 초과 → 가장 오래된 warm 창 실제 파괴(메모리 가드).
          while (next.cached.length > CACHE_MAX) next = withoutWindow(next, next.cached[0]!);
          return { ...next, snapAssist: null };
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
              // 라우트 창은 **창이 지금 보는 화면**의 최소 크기에서 멈춘다(원장 2026-09-03 · 전수검사 2026-09-11) —
              // 포인터 리사이즈와 같은 바닥(routeMinSize).
              [id]: {
                ...w,
                rect: resizeRect(base, handle, dx, dy, s.bounds, routeMinSize(w, s.nav[id])),
                maximized: false,
                snapped: false,
              },
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
            // 스포트라이트 중이면 위로 올린다(open()과 같은 규칙) — 포커스만 받고 가려지지 않게.
            spotlightRaised: s.spotlight ? raiseInto(s.spotlightRaised, id) : s.spotlightRaised,
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
          // 올리는 규칙은 창을 열 때(open·openNewInstance·restore)와 한 벌 — raiseInto.
          return { spotlightRaised: raiseInto(s.spotlightRaised, id), focusedId: id, order: bringToFront(s.order, id) };
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

      // 배경(메뉴 화면)을 보인다 — 열린 창은 **상태·폼을 보존한 채 최소화**한다(닫지 않는다).
      // ⚠️ 2026-09-07부터 운영실도 다른 메뉴와 같은 창이다(원장 지시) — 옛 'dashboard 창은 지운다' 정리를
      //    남겨 두면 원장이 연 운영실 창이 다음 showDesktop에 조용히 사라진다.
      showDesktop: () =>
        set((s) => {
          const windows = Object.fromEntries(
            Object.entries(s.windows).map(([id, w]) => [
              id,
              w.minimized ? w : { ...w, minimized: true },
            ]),
          );
          return {
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
      adoptOwner: (owner, mode, epoch = null) =>
        set((s) => {
          const ownerChanged = !!s.owner && s.owner !== owner;
          // 방식이 바뀐 영속본(창 모드 ↔ 이전 화면 유지 ↔ 단일 화면 · 같은 방식이라도 판이 다름)도 **전부 닫고 빈 상태로** — 어느
          // 방향이든(원장 2026-10-01). 🔴 같은 방식·같은 판의 새로고침은 그대로 복원한다(이 가지가 아님).
          const modeChanged =
            mode !== undefined && needsModeReset({ mode: s.shellMode, epoch: s.shellEpoch }, { mode, epoch });
          const shellMode = mode ?? s.shellMode;
          const shellEpoch = mode !== undefined ? (epoch ?? s.shellEpoch) : s.shellEpoch;
          if (ownerChanged || modeChanged) {
            return {
              owner,
              shellMode,
              shellEpoch,
              lastUsed: {},
              kaVisible: null,
              kaBack: null,
              windows: {},
              order: [],
              focusedId: null,
              cached: [],
              live: {},
              nav: {},
              reloadNonce: {},
              dirty: {},
              busy: {},
              pendingNav: {},
              homeNonce: {},
              spotlight: false,
              spotlightRaised: [],
            };
          }
          const windows: Record<string, Win> = {};
          for (const [id, w] of Object.entries(s.windows)) {
            windows[id] = {
              ...w,
              rect: clampRect(w.maximized ? snapTarget("max", s.bounds)! : w.rect, s.bounds),
            };
          }
          return { owner, windows, shellMode, shellEpoch };
        }),

      applyKeepalive: (now, opts) =>
        set((s) => {
          const plan = planKeepalive(
            {
              windows: s.windows,
              focusedId: s.focusedId,
              cached: s.cached,
              dirty: s.dirty,
              busy: s.busy,
              lastUsed: s.lastUsed,
              spotlight: s.spotlight,
              prevVisible: s.kaVisible,
              back: s.kaBack,
            },
            now,
            opts,
          );
          if (!plan.changed) return s;
          // 파괴는 흔적(제목·뒤로 기록·미저장·잠금·사용 시각)까지 한 함수로 — close()·상한 축출과 같은 길.
          let room = sliceOf(s);
          for (const id of plan.discard) room = withoutWindow(room, id);
          const windows = { ...room.windows };
          const hidden = new Set(plan.hide);
          for (const id of Object.keys(windows)) {
            const w = windows[id]!;
            if (id === plan.show) windows[id] = { ...w, minimized: false };
            else if (hidden.has(id)) windows[id] = { ...w, minimized: true };
          }
          return {
            ...room,
            windows,
            // 보이던 화면이 닫히거나 버려졌으면 열기 전에 보이던 화면(없으면 첫 화면)으로 — withoutWindow가 고른 '다음 창'은 숨은 화면이다.
            focusedId: plan.focus !== undefined ? plan.focus : room.focusedId,
            lastUsed: plan.lastUsed,
            kaVisible: plan.visible,
            kaBack: plan.back,
            ...(plan.spotlightOff ? { spotlight: false, spotlightRaised: [] } : {}),
            ...(plan.discard.length > 0 ? { snapAssist: null } : {}),
          };
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
            ([id, w]) => !w.params.autoClose && !cachedSet.has(id),
          ),
        );
        return {
          owner: s.owner,
          shellMode: s.shellMode,
          shellEpoch: s.shellEpoch,
          windows: persisted,
          order: s.order.filter((id) => persisted[id]),
          focusedId: s.focusedId && persisted[s.focusedId] ? s.focusedId : null,
          // 사용 시각은 남아 있는 화면 것만 — 2시간 만료가 브라우저를 껐다 켜도 같은 기준이어야 한다.
          lastUsed: Object.fromEntries(Object.entries(s.lastUsed).filter(([id]) => persisted[id])),
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
