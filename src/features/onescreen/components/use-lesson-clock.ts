"use client";

import { useEffect, useState } from "react";
import { kstDateTimeLocal } from "@/lib/date-kst";

/** 열린 화면도 수업 종료 후 바뀐다. 모든 학생이 하나의 시계만 공유한다. */
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
