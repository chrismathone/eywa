import type { OptInFeature } from "@/lib/license/rule";

/**
 * **연결 앱** — aywa 밖의 우리 앱을 왼쪽 사이드바 '연결 앱' 구역에서 바로 여는 링크 목록.
 *
 * 원장 2026-09-26: *"superadmin에 todays-math 프로젝트와 연결할 수 잇는 토글"* · *"연결되면 eywa 왼쪽에 '연결 앱'
 * 탭이 추가 되고 내부에 '오늘의 수학'메뉴가 생기는 형식"* · *"그냥 하이퍼링크처럼 바로가기하면 될듯"*.
 *
 * - 켜고 끄는 곳 = 슈퍼관리자 학원 상세 '기능·라이선스'(`TOGGLE_FEATURES`, **기본 꺼짐** — 켠 지점에만 선다).
 * - 여는 방법 = **보통 링크**(새 탭). 🔴 플로팅 창(iframe)에 넣지 말 것 — 오늘의 수학의 로그인 쿠키가
 *   `SameSite=Lax`라 다른 사이트 안에선 로그인이 안 되고, 로그인을 이어받는 길(SSO)도 아직 없다.
 *   로그인은 그 앱 계정으로 따로 한다.
 * - 메뉴 판(`menu-hub.ts`)·검색 팰릿·메뉴 구성 편집기에는 넣지 않는다 — 그쪽은 aywa 안의 화면(권한 키·창)만 다룬다.
 *
 * ⚠️ 일반 모듈이다(`"use client"`·`server-only` 금지 — 서버 셸과 클라 사이드바가 함께 읽는다, [[#61]]·[[#81]]).
 */
export type ConnectedApp = {
  feature: OptInFeature;
  label: string;
  href: string;
};

export const CONNECTED_APPS: readonly ConnectedApp[] = [
  { feature: "todays_math", label: "오늘의 수학", href: "https://todays-math.vercel.app" },
];
