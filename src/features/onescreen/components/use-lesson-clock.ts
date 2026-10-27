"use client";

import { useEffect, useState } from "react";
import { kstDateTimeLocal } from "@/lib/date-kst";

/**
 * 열린 화면도 수업 종료 후 바뀐다. 학생 목록은 시계 하나를 모든 학생이 나눠 쓴다.
 * ⚠️ 보강 예약 표식(`reserved-makeup-tag.tsx`)은 표식마다 제 시계를 쓴다 — 예약이 있는 줄에서만이라 몇 개뿐이다.
 */
export function useLessonClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setNow(kstDateTimeLocal());
    const timer = window.setInterval(update, 30_000);
    const initial = window.setTimeout(update, 0);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return now;
}
