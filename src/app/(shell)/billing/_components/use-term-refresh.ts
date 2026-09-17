"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** 저장 응답을 먼저 그린다. 배분 재조회는 별도 전환에서 실행하며 연속 클릭은 묶는다. */
export function useTermRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; router.refresh(); }, 200);
  };
}
