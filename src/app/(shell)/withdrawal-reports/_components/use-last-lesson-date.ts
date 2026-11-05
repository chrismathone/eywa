"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { kstToday } from "@/lib/date-kst";
import { loadLastLessonDate } from "@/features/withdrawal-reports/server/last-lesson-actions";
import type { LastLessonSource } from "@/features/withdrawal-reports/last-lesson";

/**
 * 요청 창의 '마지막 수업일' — 학생·반을 고르면 출결에서 채운다(원장 2026-11-03 · `loadLastLessonDate`). 칸은 그대로 고칠 수 있고,
 * 사람이 고친 값은 **같은 학생 안에서는** 반을 바꿔도 덮지 않는다(학생을 바꾸면 다시 채운다 — 다른 학생의 날짜가 남지 않게).
 * 학생·반이 바뀌는 곳(학생 고르기·반 토글·모드 바꾸기)이 `refresh`를 부른다 — effect가 고른 값을 쫓지 않는다.
 * 늦게 온 옛 응답은 버린다(차례 번호).
 */
export function useLastLessonDate(initial: { studentId: string; enrollmentIds: string[] }) {
  const [first] = useState(initial);
  const [state, setState] = useState<{ date: string; source: LastLessonSource }>(() => ({
    date: kstToday(), source: first.studentId && first.enrollmentIds.length ? "loading" : "today",
  }));
  const manual = useRef(false);
  const seq = useRef(0);
  const run = useCallback((studentId: string, enrollmentIds: string[]) => {
    const mine = ++seq.current;
    const settle = (next: { date: string; source: LastLessonSource }) => { if (mine === seq.current && !manual.current) setState(next); };
    loadLastLessonDate({ studentId, enrollmentIds }).then(
      res => settle("error" in res ? { date: kstToday(), source: "error" } : res.date ? { date: res.date, source: "attendance" } : { date: kstToday(), source: res.denied ? "denied" : "none" }),
      () => settle({ date: kstToday(), source: "error" }),
    );
  }, []);
  // 원생 화면에서 그 학생을 고른 채 열린 창 — 처음 한 번만.
  useEffect(() => { if (first.studentId && first.enrollmentIds.length) run(first.studentId, first.enrollmentIds); }, [first, run]);
  function refresh(studentId: string, enrollmentIds: string[], newStudent: boolean) {
    if (newStudent) manual.current = false;
    if (manual.current) return;
    seq.current++;
    if (!studentId) { setState({ date: kstToday(), source: "today" }); return; }
    if (!enrollmentIds.length) { setState({ date: kstToday(), source: "none" }); return; }
    setState(s => ({ ...s, source: "loading" }));
    run(studentId, enrollmentIds);
  }
  function edit(date: string) {
    manual.current = true;
    seq.current++;
    setState({ date, source: "manual" });
  }
  return { ...state, refresh, edit };
}
