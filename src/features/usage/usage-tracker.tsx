"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useKeepaliveMode } from "@/components/workspace/shell-mode";
import { useShellHome } from "@/components/workspace/shell-home";
import { routeKeyOf } from "./route-key";
import { startUsageSession, type UsageSession } from "./session";

/**
 * 이용 분석 계측기 — 셸 레이아웃 세 갈래(창·강사 미니셸·풀셸)에 한 번씩 붙는다. 아무것도 그리지 않는다.
 * 결과는 슈퍼관리자 '이용 분석'(`/super-admin/usage`)이 읽는다.
 *
 * ⚠️ `useSearchParams`라 레이아웃이 `<Suspense>`로 감싼다(EmbedUrlKeeper와 같은 자리).
 * ⚠️ 개발 서버에서는 끈다 — `.env.local`이 운영 DB를 가리켜서, 켜 두면 개발자의 화면 확인이 학원 이용 통계에 섞인다.
 *    로컬에서 확인하려면 `NEXT_PUBLIC_USAGE_TRACKING=1`.
 */
const ENABLED = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_USAGE_TRACKING === "1";

export function UsageTracker() {
  const pathname = usePathname();
  // 화면 이름·폴더가 아닌 실제 주소만 계측한다. 관리자뷰/강사뷰 커스텀 이름이 달라도 같은 기능으로 집계.
  const searchParams = useSearchParams();
  // 🔴 이전 화면 유지 방식: 바탕 문서의 주소는 보이는 화면을 따라가지만(주소창 규칙) 그 화면은 **자기 iframe 문서가 따로 센다** —
  //    여기서도 세면 화면 하나가 두 번 잡힌다. 바탕 문서는 늘 첫 화면(바탕)으로 센다(창 모드에서 주소가 바탕에 머무는 것과 같은 결과).
  //    🔴 데스크톱일 때만 — 폰·좁은 폭에선 본문 <main>이 실제 라우트를 그리므로 종전대로 주소를 센다(`useKeepaliveMode`는 폭까지 본다).
  const keepalive = useKeepaliveMode();
  const home = useShellHome();
  const route = keepalive ? routeKeyOf(home, new URLSearchParams()) : routeKeyOf(pathname ?? "/", searchParams);
  const initialRoute = useRef(route);
  const session = useRef<UsageSession | null>(null);

  useEffect(() => {
    if (!ENABLED) return;
    const s = startUsageSession(initialRoute.current);
    session.current = s;
    return () => {
      s.stop();
      session.current = null;
    };
  }, []);

  useEffect(() => {
    session.current?.setRoute(route);
  }, [route]);

  return null;
}
