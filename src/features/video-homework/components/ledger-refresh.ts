"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * 장부를 서버 값으로 다시 받는다 — **스크롤은 그대로**(원장 2026-10-14 *"영상 배정하면 즉시 반영되서 그런가 가장 위로 스크롤이 올라가버리는데"*).
 * 원인 = 장부가 필터·기간을 주소에 적는다(`history.replaceState`, video-homework-management.tsx). 라우터가 들고 있는 페이지 키는 처음 연
 * 주소 그대로라, 그 뒤의 `router.refresh()`나 `revalidatePath`를 부른 액션의 갱신이 장부를 **새 페이지로** 다시 만들고 그 사이 높이가 줄어
 * 스크롤이 위로 끌려간다(배포본 실측: refresh 하나로 1200 → 20 · 장부 재생성 · 서버 요청 14건).
 * 지금 주소로 replace + `scroll: false`는 키를 주소에 맞추며 다시 받는다(실측 1200 → 1200 · 재생성 없음 · 요청 1건 — 문서 화면
 * folder-navigation.tsx와 같은 길). 액션 뒤에 부르면 Next는 아직 화면에 적용 전인 액션 결과를 버리고(이동이 우선) 키가 맞춰진 뒤
 * 한 번 더 새로고침한다 — 이 새로고침은 스크롤하지 않는다.
 * 🔴 그래서 **액션을 await한 바로 다음에** 부를 것 — 사이에 await가 끼면 액션 결과(기본 스크롤)가 먼저 적용돼 다시 튈 수 있다.
 *    부른 컴포넌트가 이미 내려갔어도 부른다(반려 중 칸 편집 창을 닫은 경우 — 건너뛰면 액션 결과가 그대로 적용돼 튄다, 재리뷰 2026-10-14).
 * 창 안이면 주소의 `embed=1`이 그대로 실린다([[#133]]). 장부의 새로고침(영상 배정 · 반려 · 숙제 출제·취소 · 미확인 뒤 남은 칸)은 전부 이 함수로.
 * 장부를 떠난 뒤(주소가 다른 화면) 끝난 저장이면 부르지 않는다 — 옮겨 간 화면을 다시 받지 않게. ⚠️ 남은 틈: 단일 화면에서 메뉴 이동이
 * 확정되기 전에 저장이 끝나면 이 이동이 그 메뉴 이동을 대신한다(이동끼리는 나중 것이 이긴다) — 메뉴를 다시 누르면 된다.
 */
export function useLedgerRefresh(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    if (pathname && window.location.pathname !== pathname) return;
    router.replace(`${window.location.pathname}${window.location.search}`, { scroll: false });
  }, [router, pathname]);
}
