"use client";

import { useEffect, useState } from "react";
import { relativeTimeKo } from "@/lib/relative-time";

/**
 * 상대시간 표시 — **클라이언트 컴포넌트에서 쓸 때**의 정본.
 *
 * ⚠️ 왜 서버가 기준 시각을 넘겨야 하나(2026-07-29 실측 버그): client 컴포넌트가 렌더 중에
 * `relativeTimeKo(iso)`를 부르면 서버는 서버 시각으로, 하이드레이션은 브라우저 시각으로 계산해
 * 분 경계를 넘는 순간 "1분 전" vs "방금 전"이 되어 **하이드레이션 불일치**가 난다(React가 그 트리를
 * 통째로 다시 만든다). 그래서 `nowMs`를 **필수 prop**으로 두고 서버 렌더 시각을 내려받는다 —
 * 서버·클라 첫 렌더가 같은 기준으로 계산되니 불일치가 원천적으로 없다.
 *
 * 마운트 후에는 60초마다 브라우저 시각으로 갱신해 화면을 열어둔 동안 라벨이 늙지 않게 한다.
 * (setState는 타이머 콜백 안에서만 — effect 본문 동기 setState 금지 규칙 준수.)
 *
 * 서버 컴포넌트(RSC)에서는 이 컴포넌트가 필요 없다. 하이드레이션이 없으니 `relativeTimeKo`를 직접 쓸 것.
 */
export function RelativeTime({
  iso,
  nowMs,
}: {
  iso: string | null | undefined;
  /** 서버 렌더 시각(page에서 `Date.now()`). 첫 렌더를 서버와 일치시키는 기준. */
  nowMs: number;
}) {
  const [now, setNow] = useState(nowMs);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return <>{relativeTimeKo(iso, now)}</>;
}
