import { deepLinkWindow } from "./deep-link-window";
import { entryUrl, isHomePath, stripEmbedUrl, visibleId } from "./keepalive-url";
import { iframeRegistry } from "./route-window";
import { useWindowStore, windowId } from "./window-store";

/** 주소창 주소(경로+쿼리, 해시 제외). */
export const here = () => window.location.pathname + window.location.search;

/**
 * 그 화면 iframe이 **실제로 지금** 가리키는 주소 — 뒤로가기는 그 iframe의 기록도 함께 되감기므로(합동 세션 기록) 주소 이벤트가 올 때
 * 이미 옮겨져 있다. 뒤로 기록(nav)은 비동기 관찰이라 한 박자 늦다 — 그걸 믿으면 이미 제자리인 화면을 다시 불러온다.
 */
export function liveUrl(id: string): string | null {
  try {
    const loc = iframeRegistry.get(id)?.contentWindow?.location;
    if (!loc || !loc.pathname.startsWith("/")) return null;
    return stripEmbedUrl(loc.pathname + loc.search);
  } catch {
    return null;
  }
}

/**
 * 주소 → 화면: 그 주소의 화면을 보이게 한다. 첫 화면 주소면 전부 숨긴다.
 *  1) **이미 그 주소를 보여 주는 화면**이 있으면 그 화면(메뉴 화면이 안에서 드릴인한 상세 포함) — 창 id를 주소에서 다시 계산하면 메뉴 화면
 *     (`students`)이 드릴인한 `/students/abc`를 `students/abc`로 읽어 보관해 둔 화면 대신 새 화면을 열었다(적대 리뷰 2026-10-01).
 *  2) 없으면 그 주소의 화면(id = `windowIdForHref` — 메뉴·링크·알림·팰릿과 같은 규약)을 연다. 같은 id의 화면이 있으면 그 주소로 옮긴다
 *     (`location.replace` — RouteWindow). 🔴 입력 중·작업 중인 화면은 옮기지 않는다(보이게만 — 옮기면 문서가 다시 불려 입력이 사라진다).
 */
export function followLocation(home: string): void {
  const url = here();
  const path = window.location.pathname;
  const g = useWindowStore.getState();
  const target = isHomePath(path, home) ? null : deepLinkWindow(path, document.title);
  if (!target) {
    if (visibleId(g) !== null) g.showDesktop();
    return;
  }
  const hit = [...g.order].reverse().find((wid) => {
    const w = g.windows[wid];
    return !!w && (liveUrl(wid) ?? entryUrl(w, g.nav[wid])) === url;
  });
  if (hit) {
    if (visibleId(g) !== hit) g.restore(hit);
    return;
  }
  // 화면 id는 다른 입구(메뉴·링크·알림·팰릿·창 모드 딥링크)와 같은 규약(`windowIdForHref` — deepLinkWindow가 쓴다)이다. 메뉴 화면을 상세 주소로
  // 옮기면 숨겨 둔 목록의 필터·스크롤이 날아가고, 같은 상세가 입구마다 다른 화면으로 두 벌 생겼다(적대 리뷰).
  const key = windowId("route", target.id);
  if (g.windows[key] && (g.dirty[key] || g.busy[key])) {
    if (visibleId(g) !== key) g.restore(key);
    return;
  }
  g.open("route", { id: target.id, title: target.title, href: url });
}
