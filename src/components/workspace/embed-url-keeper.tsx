"use client";

import { useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { withEmbed } from "./embed-context";

/**
 * 창 갈래 문서(서버가 embed=1로 그린 크롬 없는 셸)의 주소를 **창 여부와 맞춘다** — 두 방향:
 *  ① 창(iframe) 안인데 주소에서 embed=1이 빠졌으면 **되붙인다**(맨 `<Link>`·`router.push`가 지운 경우).
 *  ② 최상위 문서인데 embed=1이 있으면 **떼고 전체 셸로 다시 연다**(창 링크를 Ctrl/가운데 클릭으로 새 탭에 연 경우 —
 *     안 떼면 새 탭에 사이드바 없는 화면이 뜬다. WindowLink의 '유령 창'도 같은 모양이다).
 * (메뉴·창 이동 전수검사 2026-09-11 `$[6].findings[2]` 근본 수리 + 리뷰 후속.)
 *
 * 왜 ①: 창은 주소의 embed=1로 크롬 없는 셸을 받는다(proxy → x-embed → (shell)/layout embed 갈래). 레이아웃은 소프트 이동에서
 *   다시 그려지지 않아 당장은 멀쩡하지만, 주소에서 embed가 빠진 채 `router.refresh()`·서버 액션 재검증·`location.reload()`가
 *   돌면 **embed 없는 주소**로 공유 레이아웃까지 다시 받아 창 안에 전체 셸이 뜬다.
 * 어떻게 ①: `history.replaceState` — Next는 이걸 라우터와 동기화한다(패치가 `ACTION_RESTORE`를 보내 **canonicalUrl도 embed
 *   주소**가 된다). 계약은 `embed-url-keeper.test.tsx`가 node_modules를 읽어 잠근다.
 *
 * 🔴 **안전망이다 — 자주 도는 이동은 처음부터 embed를 싣는다**(EmbedLink·PeriodNav·HrefSelect·ParamLink·ECS navigate…).
 *    복원은 주소만 바꾸고 라우터 트리·`renderedSearch`는 embed 없는 옛 값이라, 복원 **뒤 첫 refresh·서버 액션 재검증**에서
 *    page 세그먼트 키(`__PAGE__?{…}`, 쿼리를 담는다)가 서버 응답과 어긋나 soft retry가 돈다(라우트 캐시 무효화 + 재요청 +
 *    보이는 링크 재prefetch). 두 번 연달아 어긋나면 Next는 **문서 새로고침**으로 떨어진다(입력 유실 —
 *    ppr-navigations `previousNavigationDidMismatch`). 전체 셸보단 낫지만 싸지 않다.
 * 🔴 `replaceState`의 첫 인자는 **null**이어야 한다 — `__NA`가 든 객체(예: `history.state` 그대로)를 넘기면 Next 패치가
 *    "내부 호출"로 보고 라우터 동기화를 건너뛴다(주소창만 바뀌고 canonicalUrl은 옛 주소 — 다음 렌더에 도로 지워진다).
 * 🔴 `useLayoutEffect`다 — Next는 새 주소를 `useInsertionEffect`(HistoryUpdater)에서 적으므로 이 시점엔 주소가 이미 새 칸이고,
 *    자식들의 `useEffect`보다 먼저 돈다. 복원 액션은 대기 중인 액션을 **버리므로**(app-router-instance: "Navigations
 *    (including back/forward) take priority over any pending actions") 새 화면이 마운트 때 쏘는 서버 액션보다 앞서야 한다.
 * 🔴 창 여부는 **이펙트 안에서 직접** 본다(`isFramed`) — `useInFrame()`은 하이드레이션 첫 렌더에 false(서버 스냅샷)라,
 *    그 값으로 ②를 판정하면 **진짜 창 안에서 embed를 떼 버린다**.
 * ⚠️ 하드 이동(`<a>`·`location.assign`·GET 폼)은 **새 문서를 연다** — 이 부품은 지금 문서만 고치므로 그쪽은 여전히 링크
 *    자신이 embed를 실어야 한다(`EmbedAnchor`·`EmbedHiddenInput`·`withEmbed`, 가드 `embed-hard-nav-wiring.test.ts`).
 * ⚠️ 붙이거나 뗀 뒤엔 조건이 풀려 다시 돌지 않는다(①은 주소에 embed가 생기고, ②는 전체 셸 문서라 이 부품이 없다).
 */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // cross-origin 접근 차단 = iframe 안이라는 뜻(use-in-frame.ts와 같은 보수적 판정).
    return true;
  }
}

/** embed 파라미터만 뗀 같은 주소(쿼리·해시 보존). */
function withoutEmbed(path: string, query: string, hash: string): string {
  const params = new URLSearchParams(query);
  params.delete("embed");
  const rest = params.toString();
  return `${path}${rest ? `?${rest}` : ""}${hash}`;
}

export function EmbedUrlKeeper() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  useLayoutEffect(() => {
    const { pathname: path, search: query, hash } = window.location;
    if (!path.startsWith("/")) return;
    const hasEmbed = new URLSearchParams(query).get("embed") === "1";
    if (!isFramed()) {
      // ② 새 탭에 뜬 창 문서 — 전체 셸로 다시 연다(replace라 셸 없는 칸이 뒤로가기에 안 남는다).
      if (hasEmbed) window.location.replace(withoutEmbed(path, query, hash));
      return;
    }
    if (hasEmbed) return;
    // ① 창 안에서 embed가 빠진 주소 — 되붙인다(null 상태 = Next가 라우터까지 따라온다).
    window.history.replaceState(null, "", withEmbed(`${path}${query}${hash}`));
    // pathname·search는 본문에서 안 읽지만 **주소가 바뀔 때마다 다시 보려고** 의존성에 둔다.
  }, [pathname, search]);
  return null;
}
