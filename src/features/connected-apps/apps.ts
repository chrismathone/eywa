import type { OptInFeature } from "@/lib/license/rule";

/**
 * **연결 앱** — aywa 밖의 우리 앱을 왼쪽 사이드바 '연결 앱' 구역에서 바로 여는 링크 목록.
 *
 * 원장 2026-09-26: *"superadmin에 todays-math 프로젝트와 연결할 수 잇는 토글"* · *"연결되면 eywa 왼쪽에 '연결 앱'
 * 탭이 추가 되고 내부에 '오늘의 수학'메뉴가 생기는 형식"* · *"그냥 하이퍼링크처럼 바로가기하면 될듯"*.
 *
 * - 켜고 끄는 곳 = 슈퍼관리자 학원 상세 '기능·라이선스'(`TOGGLE_FEATURES`, **기본 꺼짐** — 켠 지점에만 선다).
 * - 여는 방법 = **보통 링크**(새 탭) → eywa 출발 라우트(`launchPath`)가 자동 로그인 표를 붙여 그 앱으로 보낸다.
 *   🔴 플로팅 창(iframe)에 넣지 말 것 — 오늘의 수학의 로그인 쿠키가 `SameSite=Lax`라 다른 사이트 안에선
 *   로그인이 유지되지 않는다.
 * - 메뉴 판(`menu-hub.ts`)·검색 팰릿·메뉴 구성 편집기에는 넣지 않는다 — 그쪽은 aywa 안의 화면(권한 키·창)만 다룬다.
 *
 * ⚠️ 일반 모듈이다(`"use client"`·`server-only` 금지 — 서버 셸과 클라 사이드바가 함께 읽는다, [[#61]]·[[#81]]).
 */
export type ConnectedApp = {
  feature: OptInFeature;
  label: string;
  /** 그 앱의 첫 주소 — 자동 로그인을 못 할 때(secret 없음) 떨어지는 곳. */
  href: string;
  /**
   * 사이드바가 거는 주소 — eywa의 출발 라우트. 로그인한 사람의 자동 로그인 표를 만들어 그 앱으로 보낸다
   * (원장 2026-09-26 — 같은 이메일 계정이 있을 때만 로그인, 자동 가입 없음). [`sso.ts`](./sso.ts)
   */
  launchPath: string;
  /** 받는 쪽 주소(그 앱 저장소가 구현) — 표를 `?token=`으로 붙인다. */
  ssoPath: string;
  /** 표의 `aud` — 받는 쪽이 자기 이름인지 확인한다. */
  audience: string;
  /**
   * 담당 과목(직원관리 `users.subjects`)이 **전부 이 안에 드는 사람**에겐 세우지 않는다 — 오늘의 수학은 수학 앱이라
   * 지점을 켜도 영어 선생님에겐 안 보인다(원장 2026-09-26). 판정은 `connectedAppVisibleTo` 한 곳.
   */
  hiddenForOnlySubjects?: readonly string[];
};

export const CONNECTED_APPS: readonly ConnectedApp[] = [
  {
    feature: "todays_math",
    label: "오늘의 수학",
    href: "https://todays-math.vercel.app",
    launchPath: "/api/connected-apps/todays-math/launch",
    ssoPath: "/api/sso/eywa",
    audience: "todays-math",
    hiddenForOnlySubjects: ["english"],
  },
];

/**
 * 이 사람(담당 과목)에게 이 앱을 세우나 — **과목 축만**. 지점 스위치는 [`getMyConnectedApps`](./server/visible.ts)가 먼저 본다.
 *
 * - 과목이 비어 있으면(원장·사무·조교처럼 과목 없는 직원) **세운다** — 과목으로 가를 근거가 없다.
 * - 과목이 전부 `hiddenForOnlySubjects` 안이면(영어만) 감춘다. 하나라도 밖이면(수학+영어 겸업) 세운다.
 * ⚠️ 근거는 반 담당(`classes.teacher_id`)·배치가 아니라 **직원관리의 담당 과목**이다 — 자리(JJ·LAB) 강사처럼 맡은 반도
 *    배치도 없는 영어 직원이 침산에 6명이라(실측 2026-09-26) 반으로 가르면(강사 홈 규칙) 그들에게 보인다.
 */
export function connectedAppVisibleTo(app: ConnectedApp, subjects: readonly string[]): boolean {
  const hidden = app.hiddenForOnlySubjects;
  if (!hidden?.length || subjects.length === 0) return true;
  return !subjects.every((s) => hidden.includes(s));
}
