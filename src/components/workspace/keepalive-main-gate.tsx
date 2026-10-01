"use client";

import { Activity, type ReactNode } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { isHomePath, renderedPathOf } from "./keepalive-url";
import { useKeepaliveMode } from "./shell-mode";
import { useShellHome } from "./shell-home";

/**
 * 이전 화면 유지 방식의 **바탕(<main>) 본문 문** — 바탕이 첫 화면이 아닌 화면을 그리고 있으면(= 그 화면의 사본) React
 * `<Activity mode="hidden">`으로 잠재운다(효과 = 폴링·실시간 구독·리다이렉트 처리가 멈춘다).
 *
 * 왜(적대 리뷰): 이 방식은 주소가 늘 보이는 화면이라 **모든 새로고침이 딥링크**다 — 서버가 그 화면을 바탕에 한 번, iframe에 한 번 그리고,
 * 바탕 사본은 덮인 채 폴링·구독을 계속 돌렸다(B6). 이 방식의 데스크톱에서 바탕이 보여 줄 것은 첫 화면뿐이라 사본은 한 번도 보일 일이 없다 —
 * 첫 화면으로 갈 때 라우터가 첫 화면으로 갈아 끼운다(`use-keepalive-follow`). 그래서 사본은 **다시 깨우지 않는다**(깨우면 그 순간 효과·마운트
 * 액션이 한 번 더 돈다 — 재리뷰).
 * 🔴 **첫 화면(운영실·`/menu`)은 잠재우지 않는다** — 숨기면(`display:none`) 셸 <main>의 스크롤이 0으로 잘려 뒤로가기로 돌아온 운영실이 맨
 *    위에 와 있었다(재리뷰). 첫 화면이 덮여 있는 동안 도는 비용은 창 모드와 같다.
 * 🔴 셸 레이아웃이 **이 방식일 때만** 감싼다(창 모드·단일 화면의 바탕은 한 글자도 안 바뀐다). 폭이 좁아 이 방식이 꺼지면(모바일 셸) 보인다 —
 *    본문이 유일한 화면이고, 주소의 화면으로 다시 받는다. 서버·하이드레이션 첫 렌더는 늘 보임이다(데스크톱 판정의 서버 스냅샷 = 아님).
 */
export function KeepaliveMainGate({ children }: { children: ReactNode }) {
  const active = useKeepaliveMode();
  const home = useShellHome();
  const rendered = renderedPathOf(useSelectedLayoutSegments());
  return <Activity mode={active && !isHomePath(rendered, home) ? "hidden" : "visible"}>{children}</Activity>;
}
