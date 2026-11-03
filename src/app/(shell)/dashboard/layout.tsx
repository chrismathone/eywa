import type { ReactNode } from "react";
import { requireAccess } from "@/lib/auth/require-access";

/**
 * 대시보드 권한 게이트 — **loading.tsx(Suspense) 앞**에서 막는다(2026-10-01, gotchas #137).
 *
 * 왜 페이지가 아니라 여기인가: 같은 폴더의 `loading.tsx`가 페이지를 Suspense로 감싸므로, 페이지(`loadOverview`
 * 안의 `requireAccess`)에서 거부하면 응답이 **이미 흐르기 시작한 뒤**에 redirect가 난다. 그러면 Next가
 * `<meta http-equiv="refresh">`를 끼워 넣고 브라우저가 그 이동을 하드 이동으로 처리하는데, 같은 순간 셸이 서버
 * 액션을 부르고 있으면 Next 라우터가 React #310으로 죽어 **영어 기본 오류 화면**("This page couldn't load")이
 * 떴다(대시보드 권한이 없는 직원이 `/dashboard`를 새로 열 때 — 북마크·새로고침·로그인 `next`·뷰 전환).
 * 레이아웃은 Suspense 바깥이라 여기서의 redirect는 문서 요청에 **HTTP 307**로 나간다(스트림 안 redirect 없음).
 *
 * 하위(`announcements`·`briefing`)는 원래 전부 dashboard 권한을 요구하므로 동작이 바뀌지 않는다.
 * 권한 있는 사람은 그대로 통과 — 조회는 셸 레이아웃과 같은 요청 캐시(getCurrentUser·getUserPermMatrix)를 쓴다.
 * 🔴 페이지 쪽 게이트(`loadOverview`의 requireAccess)는 지우지 말 것 — 서버 액션(`refreshOverview`)도 그 함수를 탄다.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireAccess("dashboard");
  return children;
}
