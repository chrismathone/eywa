"use client";

import { useEffect, useRef } from "react";
import { useInFrame } from "./use-in-frame";

/**
 * 페이지 헤더 컴팩트 마커(.embed-main) 자가치유 — HideInFrame의 헤더판.
 * 임베드 라우트는 layout 임베드 분기의 <main class="embed-main">이 마커를 주지만, 드릴인·하이드레이션 전
 * 클릭 등으로 embed 파라미터가 떨어진 **하드 내비**가 창(iframe) 안에서 풀 셸을 렌더하면 마커가 없어
 * PageHeader가 풀 헤더로 돌아온다. 물리 프레임(useInFrame)이면 가장 가까운 <main>에 마커를 다시 붙인다.
 * 최상위 프레임(직접 방문·모바일)은 no-op — 풀 헤더가 정답. React는 main의 className prop이 불변이라
 * 이 외부 부착 클래스를 reconcile로 되돌리지 않는다(HideInFrame과 같은 "물리 프레임 판정" 계열).
 */
export function EmbedMainMarker() {
  const ref = useRef<HTMLSpanElement>(null);
  const framed = useInFrame();
  useEffect(() => {
    if (!framed) return;
    ref.current?.closest("main")?.classList.add("embed-main");
  }, [framed]);
  return <span ref={ref} hidden />;
}
