"use client";

import { useEffect } from "react";

/**
 * 주소 해시가 이 2차 줄을 가리키면(`/dashboard#daily-briefing`) 접힌 `<details>`를 펼치고 그 자리로 스크롤한다.
 * 브라우저의 해시 이동은 `<details>` 안 요소는 자동으로 드러내지만 `<details>` **자체**가 대상이면 펼치지 않는다 —
 * 알림("오늘의 운영 브리핑이 준비됐습니다")이 접힌 줄에 떨어지지 않게(적대적 리뷰 2026-09-03). 해시가 없으면 아무 일도 없다.
 */
export function DetailsHashOpen({ id }: { id: string }) {
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== `#${id}`) return;
      const el = document.getElementById(id);
      if (!(el instanceof HTMLDetailsElement)) return;
      el.open = true;
      el.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [id]);
  return null;
}
