"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWindowStore } from "./window-store";

/**
 * 창을 닫는 **단일 경로** — 스토어 `close` + (라우트 창이면) 배경 `router.refresh()`.
 *
 * 창(iframe)과 배경은 **별도 문서**라([[#55]]) 창 안에서 한 저장/삭제가 배경 목록에 저절로 반영되지
 * 않는다. 그래서 "닫기"는 언제나 배경 새로고침과 한 쌍이다 — 창 자체 ✕(FloatingWindow)와 하단 독 칩의
 * ✕·가운데클릭(WindowSwitcher)이 같은 이 함수를 부른다. 예전엔 독이 스토어 `close`를 직접 불러
 * 새로고침을 건너뛰었다(창에서 고친 이름이 배경 목록엔 옛 값으로 남았다).
 *
 * ⚠️ **미저장(dirty)·잠금(busy) 가드는 여기 없다** — 호출부가 먼저 판단한다. 창은 자기 위에 확인
 * 오버레이를 띄우고, 독은 그 창을 복원해 사용자가 창의 ✕로 확인을 보게 한다(독엔 그 창의 문맥이 없다).
 */
export function useCloseWindow(): (id: string) => void {
  const close = useWindowStore((s) => s.close);
  const router = useRouter();
  return useCallback(
    (id: string) => {
      // kind는 닫기 **전에** 읽는다(닫은 뒤엔 파괴돼 사라질 수 있다).
      const kind = useWindowStore.getState().windows[id]?.kind;
      close(id);
      if (kind === "route") router.refresh();
    },
    [close, router],
  );
}
