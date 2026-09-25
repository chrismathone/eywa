/**
 * 창 신호(use-window-signals.ts)의 순수 판정들 — Vitest로 잠근다.
 */
import { useWindowStore, type Win } from "./window-store";

/** 이만큼 넘게 숨어 있던 창은 신호가 없어도 다시 보일 때 새로고침한다(다른 직원의 변경은 신호로 안 온다). */
export const STALE_AFTER_MS = 10 * 60 * 1000;
/** 이만큼 지나도 첫 화면이 안 그려지면 '다시 시도'를 보인다. */
export const SLOW_LOAD_MS = 12_000;
/** 여러 창이 한꺼번에 다시 보일 때(최대화 해제·앨범 나가기) 새로고침 사이 간격 — 위 창부터(B6 stagger와 같은 결). */
export const REFRESH_STAGGER_MS = 250;

type Layout = { windows: Record<string, Win>; order: string[]; spotlight: boolean; spotlightRaised: string[] };

/**
 * 이 창이 지금 **눈에 안 보이는가** — 최소화·보관(BL3, 둘 다 minimized)·앨범에서 안 올라온 창·**최대화 창 뒤에
 * 가려진 창**. 창 틀(FloatingWindow)이 창을 감추는 규칙과 같은 축이다.
 */
export function isWindowHidden(s: Layout, id: string): boolean {
  const w = s.windows[id];
  if (!w || w.minimized) return true;
  if (s.spotlight) return !s.spotlightRaised.includes(id);
  const i = s.order.indexOf(id);
  if (i < 0) return true;
  for (let j = i + 1; j < s.order.length; j++) {
    const o = s.windows[s.order[j]!];
    if (o && o.maximized && !o.minimized) return true;
  }
  return false;
}

/** 새로고침 순번 — 맨 위 창이 0. 여러 창이 한꺼번에 드러날 때 위에서부터 차례로 돌게 한다. */
export function refreshRank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i < 0 ? 0 : order.length - 1 - i;
}

/**
 * 창 문서가 **새 문서로 첫 화면을 그렸는가** — 창용 셸의 본문(`main.embed-main`)이 도착했으면 그 안에 페이지(또는
 * 라우트의 `loading.tsx` 스켈레톤)가 이미 있다(본문은 페이지가 준비되거나 Suspense 경계가 생길 때만 흘러온다).
 * 🔴 `shown`(마지막으로 보여 준 문서)은 **로딩 상태와 무관하게** 제외한다 — 아직 이미지·폰트를 받는 중인 옛 문서를
 *    새 문서로 오인하면 ⟳ 직후 덮개가 바로 걷혀 옛 화면이 눌린다(리뷰 2026-09-25).
 */
export function hasPainted(doc: Document | null, shown: Document | null): boolean {
  if (!doc || doc === shown) return false;
  return !!doc.querySelector("main.embed-main");
}

/** 창별 "미저장 표식을 올린 문서" — 표식은 문서의 것이다. 약한 참조라 닫힌 창의 옛 문서를 붙들지 않는다. */
const dirtyOwner = new Map<string, WeakRef<Document>>();

/**
 * 창 문서가 미저장 표식을 올렸다/내렸다 — 그때 창에 붙어 있던 문서를 주인으로 적는다(workspace-canvas가 메시지를 받을 때).
 * 내리면 주인도 지운다.
 */
export function noteDirtyOwner(winId: string, doc: Document | null): void {
  if (doc) dirtyOwner.set(winId, new WeakRef(doc));
  else dirtyOwner.delete(winId);
}

/**
 * 새 문서가 떴다(첫 페인트·load) — 그 창의 미저장 표식이 **다른(떠난) 문서의 것**이면 내린다. 옛 문서는 하드 이동에서
 * 언마운트 정리를 못 돌려 표식이 남는다.
 * 🔴 **지금 문서가 올린 표식은 절대 안 내린다** — 덮개를 첫 페인트에 걷거나 덮개 없이 창 안에서 하드 이동하면
 *    `load`(이미지·폰트까지 기다림) 전에 입력이 시작된다. 미저장 가드는 **바뀔 때만** 알리므로 지우면 다시 안 온다
 *    (✕가 확인 없이 닫혔다 — 리뷰 2026-09-25). 예전 "문서당 한 번" 규칙은 덮개 없는 이동을 못 막았다(원장 2026-09-25 "남은 빈틈").
 * 주인을 모르는 표식(주인을 적지 못함 — 접근 불가 등)은 떠난 문서의 것으로 보고 내린다(종전 동작).
 */
export function clearDirtyForNewDocument(winId: string, doc: Document | null): void {
  const owner = dirtyOwner.get(winId)?.deref();
  if (doc && owner === doc) return;
  dirtyOwner.delete(winId);
  useWindowStore.getState().setWindowDirty(winId, false);
}

function isEditable(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/**
 * 앞으로 온 창에 키보드 초점을 옮겨도 되나 — 사용자가 다른 곳에 **쓰고 있거나** 열린 메뉴·팰릿·이 창의 틀(✕·Esc가
 * 거기서 산다)에 있으면 안 된다. 다른 창 iframe 안에서 입력 중이어도 안 된다.
 */
export function mayTakeFocus(active: Element | null, frame: HTMLIFrameElement, body: Element | null): boolean {
  if (!active || active === body) return true;
  if (active === frame) return false;
  if (isEditable(active)) return false;
  if (frame.closest("[data-window-id]")?.contains(active)) return false;
  if (active.closest("[role=menu],[role=listbox],[role=dialog]:not([data-window-dialog])")) return false;
  if (active.tagName === "IFRAME") {
    try {
      if (isEditable((active as HTMLIFrameElement).contentDocument?.activeElement)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
