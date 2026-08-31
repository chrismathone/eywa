"use client";

import { useCallback, useRef, useState } from "react";
import { upsertStudentGoal } from "../server/actions";
import type { StudentGoal, StudentGoalMap } from "../lib/student-goals";

/**
 * 학생별 월간 목표 편집 — 낙관 상태 + 디바운스 저장. ECS `useMonthGoals`와 같은 결이되 키가 학생이다.
 *
 * 🔴 **화면 값은 사람이 친 것 그대로** 두고 저장만 미룬다 — 저장 응답으로 되돌리면 타이핑이 튄다.
 * 🔴 저장 실패는 **조용히 넘기지 않는다.** 다만 화면 값은 안 되돌린다(친 것이 사라지면 더 나쁘다) —
 *    대신 "새로고침하면 마지막으로 저장된 값이 보입니다"라고 말해 준다.
 * ⚠️ 부수효과를 `setState` 업데이터 안에서 일으키지 않는다(React 19 `set-state-in-effect`·이중 호출) —
 *    최신 값은 `ref`로 읽는다.
 */
const DEBOUNCE_MS = 600;

export type GoalField = "textbook" | "targetProgress";

export function useStudentGoals({
  classId,
  month,
  initial,
}: {
  classId: string;
  month: string;
  initial: StudentGoalMap;
}) {
  const [goals, setGoals] = useState<StudentGoalMap>(initial);
  const goalsRef = useRef<StudentGoalMap>(initial);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Set<Promise<unknown>>());
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    (studentId: string) => {
      const goal = goalsRef.current[studentId] ?? { textbook: null, targetProgress: null };
      const p = upsertStudentGoal({
        classId,
        studentId,
        month,
        textbook: goal.textbook,
        targetProgress: goal.targetProgress,
      })
        .then((res) => {
          if (res.ok) setSavedAt(Date.now());
          else setError(res.error);
        })
        .catch(() => setError("저장에 실패했습니다"))
        .finally(() => inflight.current.delete(p));
      inflight.current.add(p);
      return p;
    },
    [classId, month],
  );

  const setField = useCallback(
    (studentId: string, field: GoalField, value: string) => {
      const prev: StudentGoal = goalsRef.current[studentId] ?? { textbook: null, targetProgress: null };
      const next: StudentGoal = { ...prev, [field]: value === "" ? null : value };
      goalsRef.current = { ...goalsRef.current, [studentId]: next };
      setGoals(goalsRef.current);
      setError(null);

      const old = timers.current.get(studentId);
      if (old) clearTimeout(old);
      timers.current.set(
        studentId,
        setTimeout(() => {
          timers.current.delete(studentId);
          void save(studentId);
        }, DEBOUNCE_MS),
      );
    },
    [save],
  );

  /** 화면을 떠나기 전에 밀린 저장을 **끝까지** 기다린다(안 기다리면 방금 친 글자가 쓸려 간다). */
  const flushAll = useCallback(async () => {
    const pending = [...timers.current.keys()];
    for (const id of timers.current.values()) clearTimeout(id);
    timers.current.clear();
    await Promise.all([...pending.map((sid) => save(sid)), ...inflight.current]);
  }, [save]);

  return { goals, setField, flushAll, savedAt, error, dismissError: () => setError(null) };
}
