"use client";

import type { ReactNode } from "react";
import { useInFrame } from "./use-in-frame";

/**
 * 셸 크롬(사이드바·헤더·모바일 내비) 사전 차단기 — iframe(플로팅 창) 안에서 렌더되면 children을
 * 숨긴다. 임베드 라우트는 보통 ?embed=1로 크롬리스지만, 드릴인 중 embed 파라미터가 떨어지면(서버액션
 * redirect·router.push·일반 Link) 풀 셸이 창 안에 떠 **메뉴탭이 이중**으로 보일 수 있다. URL이 아닌
 * "물리적 프레임 여부"로 판정해 그 경로 전부를 막는다. 최상위 프레임에선 그대로 통과(no-op).
 */
export function HideInFrame({ children }: { children: ReactNode }) {
  return useInFrame() ? null : <>{children}</>;
}
