"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 가로로 넓은 표 안에서 **보이는 폭에 맞춰 접히는** 왼쪽 고정 줄 — 월별 출석부 합계 줄이 쓴다.
 *
 * 🔴 왜 필요한가(적대적 재리뷰 2026-09-14): 합계 줄은 `<td colSpan>` 안의 `sticky left-0 w-fit flex-wrap`이다.
 *    `w-fit`은 **화면 폭이 아니라 표 전체 폭**(날짜 칸 + 금액 = 1,270~1,406px) 안에서 커지므로 `flex-wrap`이
 *    접힐 일이 없다. 그래서 합계 뒤에 조작 안내를 붙이자(원장 *"한행으로. 2행은 1행 우측 끝으로"*) 덩어리가
 *    612px로 길어졌고, 폰(375px)에서 표를 오른쪽 끝까지 밀면 sticky가 td 경계에 밀려 **합계가 화면 밖(-224px)으로
 *    나갔다**. 덩어리 최대 폭을 **스크롤 영역의 보이는 폭**으로 묶으면 모자랄 때 둘째 줄로 접히고, 폭이 늘 보이는
 *    폭 이하라 끝까지 밀어도 왼쪽에 붙어 있다.
 * ⚠️ `@container` + `100cqi`로 풀지 않은 이유: 공용 `DragScrollArea`(여러 화면)에 컨테이너를 걸어야 하고, 컨테이너
 *    지정은 격납(containment)을 동반해 그 안의 고정 위치 팝오버 좌표계를 흔들 수 있다([[#98]]과 같은 계열).
 *    여기서는 이 줄만 자기 스크롤 조상의 폭을 재서 쓴다.
 * ⚠️ 첫 렌더(서버·하이드레이션)엔 제한이 없다 — 종전과 같은 모양이라 하이드레이션 불일치가 없고, 잰 뒤에 접힌다.
 */
export function StickyFitRow({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxWidth, setMaxWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 가장 가까운 가로 스크롤 조상 = 사람이 실제로 보는 폭(DragScrollArea의 스크롤 상자).
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowX)) {
      scroller = scroller.parentElement;
    }
    // jsdom(테스트)·아주 옛 브라우저엔 ResizeObserver가 없다 — 그땐 제한 없이 종전 모양 그대로 둔다.
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const target = scroller;
    const observer = new ResizeObserver(() => setMaxWidth(target.clientWidth));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`sticky left-0 flex w-fit flex-wrap items-center ${className}`}
      style={maxWidth ? { maxWidth } : undefined}
    >
      {children}
    </div>
  );
}
