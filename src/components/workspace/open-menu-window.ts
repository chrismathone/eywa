import { useWindowStore, windowId } from "./window-store";
import { withEmbed } from "./embed-context";
import { iframeRegistry } from "./route-window";

/**
 * **메뉴에서 화면을 여는 단일 경로** — 사이드바 줄(`RailItem`)과 메뉴 판(`HubGrid`)이 같은 규칙을 쓴다.
 *
 * 계기(원장 2026-09-10): *"회의록을 작성 완료하고 분석 끝난 상태에서 다시 메뉴에서 회의록을 누르면
 * 기존 화면이 유지됨. 초기 목록 화면이 아니고"* + *"회의록 뿐만 아니라 다른 메뉴도 그런 버그 있는지 확인해야함."*
 *
 * 🔴 **원인은 리셋 규칙이 한쪽에만 있었던 것이다.** "이미 보고 있는 메뉴를 다시 누르면 첫 화면으로"는
 *    `RailItem`(사이드바 줄)에만 있었고, 메뉴 판은 `store.open()`만 불렀다. `open()`은 **이미 열린 창이면
 *    포커스만** 하고, 드릴인은 창 iframe 안에서 일어나 `w.params.href`가 루트(`/meetings`) 그대로라
 *    `hrefChanged`가 false → **아무 데도 안 간다**. 그래서 상세 화면에 그대로 머문다.
 *    사이드바에서 바로 열리는 메뉴는 `direct` 업무군(운영실·캘린더)과 '자주 방문한 메뉴'뿐이고,
 *    나머지는 **전부 메뉴 판을 거치므로** 같은 증상이었다(업무군 7개 안의 목적지 전부).
 *
 * 🔴 판정을 **두 곳에 적지 않는다** — 갈리면 같은 메뉴가 사이드바에서 누를 때와 메뉴 판에서 누를 때
 *    다르게 동작한다. 그래서 이 함수 하나만 부른다.
 *
 * ⚠️ **이미 최상단일 때만 첫 화면으로 되돌린다**(`RailItem`이 쓰던 규칙 그대로). 안 그러면 다른 창을 보다가
 *    메뉴로 돌아올 때마다 보고 있던 자리를 잃는다 — 되돌리기는 "지금 보고 있는 것을 처음으로"라는 뜻이어야 한다.
 * ⚠️ **최소화된 창은 최상단이 아니다** — 되돌려 봤자 화면에 안 보이므로 먼저 복원·포커스한다(그다음 클릭이 리셋).
 * ⚠️ 이미 루트면 `homeNav`가 null을 돌려 **아무 일도 안 한다**(불필요한 리로드·깜빡임 방지).
 *
 * 🔴 **되돌리기는 같은 주소를 다시 눌렀을 때만이다** (원장 2026-09-11 캡처: 수업 메뉴 판 '도구 > 오늘 출결'을
 *    눌렀는데 월별 출석부가 떴다). 메뉴 판의 면(오늘 출결·설정 11면·수납 면·셔틀 면)은 창 id가 **부모 메뉴 키**라
 *    부모와 같은 창을 쓴다 — 창이 같다고 목적지가 같은 게 아니다. 창만 보고 `homeNav`(창 **자신의** 첫 화면)로
 *    되돌리면 부모 창이 맨 앞일 때 면 버튼이 무시되거나 부모 첫 화면으로 가고, 거꾸로 면을 한 번 연 창은 첫 화면이
 *    면으로 바뀌어 부모 버튼으로 못 돌아간다(알림 링크의 필터 주소가 메뉴 창을 연 경우도 같은 모양).
 *    주소가 다르면 `open()`이 그 주소로 보낸다(`hrefChanged` → RouteWindow가 iframe src를 바꾼다).
 *
 * 🔴 데스크톱 + 창(window) 표현일 때만 부를 것 — 모바일 `router.push`와 배경(desktop) 표현은 호출부가
 *    먼저 가른다(그쪽은 창이 없어 되돌릴 대상 자체가 없다).
 */
export function openMenuWindow(params: { id: string; title: string; href: string }): void {
  const store = useWindowStore.getState();
  const winId = windowId("route", params.id);
  const win = store.windows[winId];
  if (win && !win.minimized && store.focusedId === winId && win.params.href === params.href) {
    const target = store.homeNav(winId);
    if (target) iframeRegistry.get(winId)?.contentWindow?.location.replace(withEmbed(target));
    return;
  }
  store.open("route", params);
}
