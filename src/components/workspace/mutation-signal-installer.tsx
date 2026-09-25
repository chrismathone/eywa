"use client";

import { useEffect } from "react";
import { installMutationDetector } from "@/lib/realtime/mutation-signal";

/**
 * 이 문서(배경·창·다른 탭)의 저장 성공을 "바뀜" 신호로 방송하게 한다 — 숨어 있던 창이 다시 보일 때 새로고침할지의
 * 근거([mutation-signal](../../lib/realtime/mutation-signal.ts)). 루트 프로바이더에 한 번 둔다(창=iframe도 루트 레이아웃을 탄다).
 */
export function MutationSignalInstaller() {
  useEffect(() => {
    installMutationDetector();
  }, []);
  return null;
}
