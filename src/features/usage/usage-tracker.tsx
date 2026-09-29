"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
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
  const route = routeKeyOf(pathname ?? "/", searchParams);
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
