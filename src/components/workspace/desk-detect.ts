/**
 * **데스크톱 셸 판정의 두 번째 근거 — 실제 마우스 움직임**(원장 2026-10-16 *"여전하네. 대시보드가 여전히 상단이야"* ·
 * *"화면을 아무리 축소해도 대시보드가 상단임"*).
 *
 * 10-15에 '마우스'를 `any-pointer: fine`(마우스·터치패드가 **하나라도**)으로 넓혔는데도 원장 갤럭시북(터치 모니터)은 그대로였다 —
 * 화면을 줄여(= CSS 폭이 커져도) 안 바뀌었으니 폭이 아니라 **브라우저가 마우스·터치패드를 아예 없다고 보고**한 것이다. 브라우저 보고에
 * 기대는 판정은 이 기기에서 더 넓힐 데가 없다 → **움직임으로 확인한다**: 터치패드·마우스로 포인터를 움직이면 `pointermove`의
 * `pointerType`이 `"mouse"`다(손가락 = `"touch"` · S펜 = `"pen"` — 손가락·펜만 쓰는 폰·태블릿은 켜지지 않는다).
 * 🔑 **브라우저가 마우스를 정상으로 보고하는 동안의 움직임은 기억하지 않는다**(적대적 리뷰 2026-10-16) — 정상 데스크톱이 기억해 두면
 *    나중에 그 기기가 '마우스 없음'이 되는 순간(Surface 키보드 분리 · 크롬북 태블릿 모드 · 트랙패드를 뗀 태블릿 가로 화면) 넓기만 하면
 *    영영 데스크톱 셸이 된다. 기억하는 것은 '마우스 없음'이라 보고되는데 마우스가 움직인 기기뿐이다. 그래도 트랙패드·마우스를 붙인
 *    태블릿을 그 브라우저가 '마우스 없음'으로 보고하면 켜진다(그 순간엔 실제로 마우스가 있다).
 *
 * 🔑 한 번 보면 이 브라우저에 기억한다(localStorage — 사람이 아니라 **기기의 성질**이라 계정 귀속 규약의 예외다: 같은 원장이 폰으로
 *    들어오면 폰은 모바일이어야 한다). 다음부터는 아래 스크립트가 **첫 페인트 전에** 표시를 붙여 열 때부터 데스크톱 셸이다.
 * 🔑 정상 기기는 손대지 않는다 — CSS의 미디어쿼리 판정(`desk`·모바일 절)은 그대로 살고, 이 표시는 **그 위에 덧붙는 갈래**다.
 *    스크립트가 안 돌면 표시가 없어 종전과 똑같다.
 *
 * 표시(문서 `<html>`):
 *  · `data-mouse` = 브라우저는 '마우스 없음'이라 보고하지만 이 브라우저에서 마우스 움직임을 본 적 있다.
 *  · `data-desk`  = 데스크톱 셸이다 = 폭 ≥ 1240 그리고 (`any-pointer: fine` 또는 `data-mouse`). 정상 데스크톱에서도 켜진다(미디어쿼리와 같은 값).
 *  · `data-print` = 인쇄하는 동안(`beforeprint`~`afterprint`). CSS는 이때 위 두 표시를 **무시**한다 — 인쇄물은 종전 미디어쿼리
 *    판정 그대로(인쇄 폭은 1240보다 좁아 모바일 절이 걸린다. 표시를 따르면 정상 데스크톱의 인쇄물까지 바뀐다 — 적대적 리뷰 2026-10-16).
 *    ⚠️ 그동안 터치 모니터 PC의 화면(인쇄 창 뒤)도 종전 모바일 배치로 잠깐 돌아간다 — JS 판정(`useIsDesktop`)은 그대로 둔다(창 엔진을
 *    내렸다 올리지 않게). 정상 데스크톱 화면은 미디어쿼리 갈래가 그대로라 안 바뀐다.
 * 🔑 React가 `<html>`을 다시 만들면(루트 하이드레이션 복구 · 오류 화면에서 '다시 시도') 속성을 전부 지운다 — 표시가 지워지면 바로 다시
 *    붙인다(MutationObserver · 값이 다를 때만 바꾸니 되돌기만 하고 끝난다 · 적대적 리뷰 2026-10-16).
 * 소비처: globals.css `desk`·`no-mouse`·`compact-chrome` 변형 · 툴바 레일 모바일 절 · 최대화 · period-nav · mobile-scroll-row ·
 *   staff-rows 모듈 · `useIsDesktop`(바뀌면 `DESK_CHANGE_EVENT`). 가드 = desktop-breakpoint.test.ts · desk-detect.test.ts.
 * ⚠️ 이 파일은 `"use client"`가 아니다 — 서버 루트 레이아웃이 상수를 읽는다(`"use client"` 모듈 상수는 서버에서 undefined, [[#81]]).
 */

/**
 * 데스크톱 셸의 최소 화면 폭 — 원장 2026-09-28 "대시보드 기준으로 전체 적용"(globals.css `desk` 변형 주석).
 * 🔴 CSS 쪽(`desk`·`compact-chrome`·`.toolbar-rail`·period-nav)과 같은 값이어야 한다(가드 desktop-breakpoint.test.ts).
 */
export const DESKTOP_MIN_WIDTH = 1240;

/** 마우스 움직임을 본 적 있는 브라우저 표시(localStorage 키). */
export const DESK_MOUSE_KEY = "aywa.mouse-seen";

/** `data-desk`가 바뀌었을 때 window에 보내는 이벤트 — `useIsDesktop`이 듣는다. */
export const DESK_CHANGE_EVENT = "aywa:desk-change";

/**
 * 루트 레이아웃 `<head>`에 인라인으로 넣는 스크립트 — 본문보다 먼저 돌아 **첫 페인트 전에** 표시를 붙인다(번쩍임 없음).
 * 폭·마우스 보고가 바뀌면(창 크기·장치 연결) 다시 판정하고, 아직 못 본 브라우저는 첫 마우스 움직임을 기다린다.
 * 실패해도 조용히 끝난다(표시가 없으면 종전 판정 그대로).
 */
export function deskDetectScript(): string {
  return [
    "(function(){try{",
    "var d=document.documentElement,K=" + JSON.stringify(DESK_MOUSE_KEY) + ",E=" + JSON.stringify(DESK_CHANGE_EVENT) + ";",
    'var fine=matchMedia("(any-pointer: fine)"),wide=matchMedia("(min-width: ' + DESKTOP_MIN_WIDTH + 'px)");',
    'var seen=false;try{seen=localStorage.getItem(K)==="1"}catch(e){}',
    "function apply(){",
    'var m=seen&&!fine.matches;if(m!==d.hasAttribute("data-mouse"))d.toggleAttribute("data-mouse",m);',
    'var desk=wide.matches&&(fine.matches||m);if(desk!==d.hasAttribute("data-desk")){d.toggleAttribute("data-desk",desk);dispatchEvent(new Event(E))}',
    "}",
    "apply();",
    'var on=function(q){if(q.addEventListener)q.addEventListener("change",apply);else if(q.addListener)q.addListener(apply)};on(wide);on(fine);',
    // 지워지면 다시 붙인다(React가 <html>을 다시 만들 때) — 걸러 보는 속성은 두 표시뿐이라 data-print·React 속성엔 안 돈다.
    'if(window.MutationObserver)new MutationObserver(apply).observe(d,{attributes:true,attributeFilter:["data-desk","data-mouse"]});',
    'addEventListener("beforeprint",function(){d.setAttribute("data-print","")});addEventListener("afterprint",function(){d.removeAttribute("data-print")});',
    // 브라우저가 마우스를 정상으로 보고하는 동안은 기억하지 않는다(fine.matches) — 리스너는 남아 '마우스 없음'이 된 뒤의 움직임을 기다린다.
    'if(!seen)addEventListener("pointermove",function f(e){if(e.pointerType!=="mouse"||fine.matches)return;seen=true;try{localStorage.setItem(K,"1")}catch(_){}removeEventListener("pointermove",f);apply()},{passive:true});',
    "}catch(e){}})();",
  ].join("");
}
