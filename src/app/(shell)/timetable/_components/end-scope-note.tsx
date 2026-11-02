"use client";

import { useEffect, useState } from "react";
import { endScopeText, endScopeViaReport, fetchEndScope, type EndScopeResult } from "@/features/timetable/lib/end-scope-text";

/**
 * 수강 종료 확인 팝업의 한 줄 — 이걸 끝내면 **이 반만 종강인지 / 그 과목 수강종료인지 / 퇴원인지** 사실대로 말한다
 * (원장 2026-09-14). 기본뷰 Delete 팝업과 통합뷰 '퇴원 칸' 드롭 팝업이 **같은 부품**을 쓴다(두 벌이면 문구가 갈린다).
 *
 * 날짜를 바꾸면 다시 묻는다(통합뷰는 종료일을 고른다 — 날짜에 따라 계속 다니는 반이 달라진다).
 * 늦게 온 옛 날짜의 답은 버린다(`key` 비교).
 * ⚠️ 입력이 멈춘 뒤 한 번만 묻는다(200ms) — 크롬 날짜 입력은 연도를 칠 때마다 `0002-…`·`0020-…`·`2026-…`로 바뀌어
 *    그대로 물으면 요청이 서너 번 나간다.
 */
const ASK_DEBOUNCE_MS = 200;

export function EndScopeNote({ enrollmentId, date }: { enrollmentId: string; date: string }) {
  const key = `${enrollmentId}|${date}`;
  const [answer, setAnswer] = useState<{ key: string; result: EndScopeResult | null } | null>(null);

  useEffect(() => {
    if (!enrollmentId || !date) return;
    let alive = true;
    const timer = setTimeout(() => {
      void fetchEndScope(enrollmentId, date).then((result) => {
        if (alive) setAnswer({ key, result });
      });
    }, ASK_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enrollmentId, date, key]);

  if (!date) return null;
  const settled = answer && answer.key === key ? answer : null;
  // 서버가 막는 종료(학생의 마지막 반 · 그 과목의 마지막 반)는 빨간 글씨 — 확인을 눌러도 퇴원보고서로 보낸다.
  const lastClass = endScopeViaReport(settled?.result ?? null);
  return (
    <p className={`mt-2 text-xs ${lastClass ? "text-danger" : "text-text-dim"}`} aria-live="polite">
      {settled ? endScopeText(settled.result) : "다른 반 수강을 확인하는 중…"}
    </p>
  );
}
