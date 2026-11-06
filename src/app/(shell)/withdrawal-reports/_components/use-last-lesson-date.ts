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
 * `reload` = '출결에서 다시 불러오기'(원장 2026-11-05 *"잘못해서 날짜를 눌렀을 수도 있으니까. 다시 불러오는 기능"*) — 손으로 고친 값을 버리고
 * 지금 고른 학생·반으로 다시 찾는다. 같은 차례 번호를 쓰므로 그 사이 학생·반을 바꾸거나 다시 고치면 늦게 온 응답은 버려진다.
 * 다시 불러오기가 날짜를 얻지 못하면(권한 없음·기록 없음·오류) 칸의 날짜를 지우지 않는다(`kept`) — 이 날짜가 곧 수강 종료일이다(리뷰 2026-11-06).
 * 출결 권한이 없다는 답을 한 번 받으면 `denied` — 창이 다시 불러오기 단추를 숨긴다.
 */
type Keep = { date: string; manual: boolean };
export function useLastLessonDate(initial: { studentId: string; enrollmentIds: string[] }) {
  const [first] = useState(initial);
  // reloading = 지금 찾는 중인 것이 '다시 불러오기'로 시작했나(단추를 숨기지 않고 꺼 두려고) · kept = 다시 불러오기가 실패해 날짜를 그대로 둠.
  const [state, setState] = useState<{ date: string; source: LastLessonSource; reloading?: boolean; kept?: boolean }>(() => ({
    date: kstToday(), source: !first.studentId ? "today" : first.enrollmentIds.length ? "loading" : "nocourses",
  }));
  const [denied, setDenied] = useState(false);
  const manual = useRef(false);
  const seq = useRef(0);
  // 진행 중인 '다시 불러오기'의 날짜 유지 약속 — 응답이 오기 전에 같은 학생 안에서 반을 바꿔(새 조회) 실패해도 지킨다(리뷰 2026-11-06 2차).
  // 날짜를 얻었거나 · 실패해 되살렸거나 · 손으로 다시 고쳤거나 · 학생을 바꾸면 비운다.
  const keepRef = useRef<Keep | null>(null);
  const run = useCallback((studentId: string, enrollmentIds: string[]) => {
    const mine = ++seq.current;
    const settle = (next: { date: string; source: LastLessonSource }) => {
      if (mine !== seq.current || manual.current) return;
      if (next.source === "denied") setDenied(true);
      const keep = keepRef.current;
      keepRef.current = null;
      // 다시 불러오기가 날짜를 얻지 못했다 — 직전 날짜(손으로 고쳤으면 그 표시도)를 그대로 두고 까닭만 알린다.
      if (keep && next.source !== "attendance") { manual.current = keep.manual; setState({ date: keep.date, source: next.source, kept: true }); return; }
      setState(next);
    };
    loadLastLessonDate({ studentId, enrollmentIds }).then(
      res => settle("error" in res ? { date: kstToday(), source: "error" } : res.date ? { date: res.date, source: "attendance" } : { date: kstToday(), source: res.denied ? "denied" : "none" }),
      () => settle({ date: kstToday(), source: "error" }),
    );
  }, []);
  // 원생 화면에서 그 학생을 고른 채 열린 창 — 처음 한 번만.
  useEffect(() => { if (first.studentId && first.enrollmentIds.length) run(first.studentId, first.enrollmentIds); }, [first, run]);
  function refresh(studentId: string, enrollmentIds: string[], newStudent: boolean, reloading = false) {
    if (newStudent) { manual.current = false; keepRef.current = null; }
    // 손으로 고친 날짜는 반을 바꿔도 덮지 않는다 — 다만 바꾸기 전 반 기준의 '그대로 두었습니다' 안내는 지운다(리뷰 2026-11-06 2차).
    if (manual.current) { setState(s => (s.kept ? { date: s.date, source: "manual" } : s)); return; }
    seq.current++;
    if (!studentId) { setState({ date: kstToday(), source: "today" }); return; }
    // 고른 반이 없다(다니는 반이 없는 학생의 바로 처리 · 반을 모두 끔) — 출결을 찾지 않았다('기록 없음'과 까닭이 다르다 · 창이 반 고르는 중이면 흐린 안내로).
    // 다시 불러오는 중이면 지키기로 한 날짜를 그대로 둔다.
    if (!enrollmentIds.length) {
      if (keepRef.current) { setState({ date: keepRef.current.date, source: "nocourses" }); return; }
      setState({ date: kstToday(), source: "nocourses" }); return;
    }
    const carrying = reloading || keepRef.current !== null;
    setState(s => ({ ...s, source: "loading", reloading: carrying, kept: false }));
    run(studentId, enrollmentIds);
  }
  /** '출결에서 다시 불러오기' — 지금 학생·반으로 다시 찾는다. 날짜를 얻으면 손으로 고친 값을 바꾸고, 못 얻으면 지금 날짜를 그대로 둔다. */
  function reload(studentId: string, enrollmentIds: string[]) {
    keepRef.current = { date: state.date, manual: manual.current };
    manual.current = false;
    refresh(studentId, enrollmentIds, false, true);
  }
  function edit(date: string) {
    manual.current = true;
    keepRef.current = null;
    seq.current++;
    setState({ date, source: "manual" });
  }
  return { ...state, denied, refresh, reload, edit };
}
