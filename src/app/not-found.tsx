"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { notFoundTarget } from "@/lib/nav/not-found-target";

/**
 * 없는 주소 전부(엉뚱한 URL · 지운 기록의 상세 · 이 학원에서 끈 기능의 `notFound()`)의 착지 —
 * **그 사람의 홈으로 보낸다**(원장 2026-09-30 *"말도 안되는 페이지 입력하는거 전부 대시보드로 리다이렉트"*).
 *
 * 🔴 **서버 일을 하지 말 것** — 루트 not-found는 매 요청 LayoutRouter에 미리 렌더된다. 여기서 세션·권한
 *    조회나 `headers()`·`redirect()`를 하면 모든 화면·창이 그 비용을 내고 전부 동적 렌더가 된다(B6).
 *    판정은 이 화면이 **실제로 보일 때** 브라우저에서 하고, 목적지 계산은 `/home` 라우트가 맡는다.
 * 창 안이면 `embed=1`을 싣는다 — 주소에서 빠졌어도 iframe이면 창이다([[#133]]).
 */
const BOUNCE_KEY = "eywa-notfound-bounce";

/**
 * 루프 차단 — 홈 자체가 없는 주소(끈 기능 등)면 `/home` → 홈 → 여기 → `/home`으로 돈다.
 * 10초 안에 또 오면 보내지 않고 404 문구. 저장소를 못 쓰면 한 번은 보낸다(최악은 한 번 더 도는 것).
 */
function bouncedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(BOUNCE_KEY)) || 0;
    const now = Date.now();
    sessionStorage.setItem(BOUNCE_KEY, String(now));
    return now - last < 10_000;
  } catch {
    return false;
  }
}

export default function NotFound() {
  const pathname = usePathname();
  const [stay, setStay] = useState(false);

  useEffect(() => {
    const embed = new URLSearchParams(window.location.search).get("embed") === "1" || window.self !== window.top;
    const target = notFoundTarget(pathname, embed);
    if (target && !bouncedRecently()) window.location.replace(target);
    else setStay(true); // eslint-disable-line react-hooks/set-state-in-effect -- 브라우저에서만 판정 가능
  }, [pathname]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      {stay ? (
        <>
          <h1 className="text-xl font-bold">페이지를 찾을 수 없습니다</h1>
          <p className="text-text-dim text-sm">주소가 바뀌었거나 없는 페이지입니다.</p>
        </>
      ) : (
        <p className="text-text-dim text-sm">이동 중…</p>
      )}
    </main>
  );
}
