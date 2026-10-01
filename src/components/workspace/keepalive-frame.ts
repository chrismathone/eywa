/**
 * 이전 화면 유지 방식의 **화면(iframe 문서) 쪽 상수** — 서버(레이아웃)·클라(브리지)가 함께 쓴다(`"use client"` 금지 — 서버가 import 한다, [[#61]]).
 */

/** 사이드바 폭만큼의 왼쪽 안쪽 여백을 담는 CSS 변수 — 창 문서의 바깥 껍데기(`[data-keepalive-root]`)에 단다. 값이 없으면 0. */
export const KEEPALIVE_RAIL_VAR = "--keepalive-rail";
/** 바깥 껍데기 표식 — 인라인 스크립트·브리지가 이 요소에 변수를 싣는다. */
export const KEEPALIVE_ROOT_ATTR = "data-keepalive-root";
/**
 * 화면 문서의 `<html>` 표식 — 브리지가 **하이드레이션 뒤에** 단다(변수 `--keepalive-rail`도 같이). body로 포털되는 고정 위치 레이어
 * (다이얼로그·가운데 정렬 덮개)는 껍데기 밖이라 껍데기의 변수를 못 물려받는다 — globals.css가 이 표식으로 그 레이어를 사이드바 밖으로 비킨다.
 */
export const KEEPALIVE_FRAME_ATTR = "data-keepalive-frame";

/** 화면 안 입력(클릭·키·스크롤)을 부모에 알리는 메시지 — 2시간 만료의 '사용 중' 신호(workspace-canvas가 받는다). */
export const KEEPALIVE_ACTIVITY_MESSAGE = "eywa-activity";

/** 화면 최대화 상태 동기화 메시지 셋(부모 PageMaximizeRoot ↔ 창 문서). */
export const PAGE_MAXIMIZE_SET_MESSAGE = "eywa-page-maximize-set"; // 창 → 부모: 눌렀다
export const PAGE_MAXIMIZE_STATE_MESSAGE = "eywa-page-maximize-state"; // 부모 → 창: 지금 상태
export const PAGE_MAXIMIZE_QUERY_MESSAGE = "eywa-page-maximize-query"; // 창 → 부모: 지금 상태를 알려 달라

/**
 * 첫 페인트 전에 사이드바 폭을 변수에 싣는 인라인 스크립트(문서 파싱 중 실행 — 하이드레이션을 기다리면 본문이 한 번 왼쪽으로 쏠렸다 밀린다).
 * 부모 문서가 없거나(직접 열림) 사이드바가 없으면 0. 같은 출처라 부모 DOM을 읽을 수 있다.
 * 🔴 **`<html>`이 아니라 이 스크립트를 품은 바깥 껍데기 div에 싣는다**(`document.currentScript.parentElement`) — 루트 `<html>`에 속성을 먼저 달면
 *    React가 "서버 HTML과 속성이 다르다"는 하이드레이션 경고를 낸다(실측). 껍데기 div는 `suppressHydrationWarning`이라 이 한 속성만 허용된다.
 */
export const KEEPALIVE_RAIL_SCRIPT = `try{var a=parent.document.querySelector('[data-shell-sidebar]');document.currentScript.parentElement.style.setProperty('${KEEPALIVE_RAIL_VAR}',(a?a.getBoundingClientRect().width:0)+'px')}catch(e){}`;

/**
 * 이전 화면 유지 화면의 `<main>` — **단일 화면의 셸 `<main>`과 같은 클래스**다(`embed-main`이 아니다): `.embed-main`이 붙으면 페이지 머리글이
 * 창용 한 줄로 접히고 폰 배치·좁은 폭 규칙이 달라진다. 🔴 `embed-main`을 붙이지 말 것(겉모습이 단일 화면과 달라진다).
 * `hasPainted`(첫 페인트 판정)는 이 클래스도 본문 도착으로 읽는다. 높이는 창 문서 전체(`h-screen`)다.
 */
export const KEEPALIVE_MAIN_CLASS =
  "keepalive-main relative bg-background text-foreground h-screen overflow-auto px-3 pt-2 pb-8 desk:px-6 desk:pt-5 lg:pb-10 [scrollbar-gutter:stable]";
