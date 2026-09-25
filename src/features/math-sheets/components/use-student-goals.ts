"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upsertStudentGoal } from "../server/actions";
import type { StudentGoal, StudentGoalMap } from "../lib/student-goals";
import { windowDirtyMessage } from "@/components/workspace/window-bridge";

/**
 * 학생별 월간 목표 편집 — 낙관 상태 + 디바운스 저장. ECS `useMonthGoals`와 같은 결이되 키가 학생이다.
 *
 * 🔴 **화면 값은 사람이 친 것 그대로** 두고 저장만 미룬다 — 저장 응답으로 되돌리면 타이핑이 튄다.
 * 🔴 저장 실패는 **조용히 넘기지 않는다.** 다만 화면 값은 안 되돌린다(친 것이 사라지면 더 나쁘다) —
 *    대신 "새로고침하면 마지막으로 저장된 값이 보입니다"라고 말해 준다.
 * ⚠️ 부수효과를 `setState` 업데이터 안에서 일으키지 않는다(React 19 `set-state-in-effect`·이중 호출) —
 *    최신 값은 `ref`로 읽는다.
 *
 * ### 새로고침·창 닫기에도 안 날아가게 (원장 2026-09-01 *"새로고침해도 안날아가게"*)
 * 저장은 마지막 타이핑에서 600ms 뒤에 나가므로 **그 사이에 새로고침하면 조용히 사라진다.** 막는 길 셋:
 *  · **언마운트 flush** — 보기 전환·달 이동처럼 컴포넌트가 사라지는 길(ECS와 같은 규약).
 *  · **`beforeunload`** — 새로고침·탭 닫기. 저장이 밀려 있을 때만 확인을 띄운다(평소엔 안 뜬다).
 *  · **창(iframe) 닫기 가드** — 부모에게 `eywa-window-dirty`를 보낸다([[#69]]: iframe의 beforeunload는
 *    부모 탭을 못 막고, winId는 경로로 추측하면 안 된다 — 부모가 `event.source`로 창을 찾는다).
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

  /** 아직 서버에 못 닿은 편집이 있나 — 이때만 이탈을 막는다(평소 새로고침은 그대로 통과). */
  const dirtyRef = useRef(false);
  const publishDirty = useCallback(() => {
    const dirty = timers.current.size > 0 || inflight.current.size > 0;
    if (dirty === dirtyRef.current) return; // 전이 시에만 알린다
    dirtyRef.current = dirty;
    if (typeof window === "undefined" || window.parent === window) return; // 창(iframe) 안에서만
    try {
      window.parent.postMessage(windowDirtyMessage(dirty), window.location.origin);
    } catch {
      /* cross-origin 등 — 무시 */
    }
  }, []);

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
        .finally(() => {
          inflight.current.delete(p);
          publishDirty();
        });
      inflight.current.add(p);
      publishDirty();
      return p;
    },
    [classId, month, publishDirty],
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
      publishDirty();
    },
    [save, publishDirty],
  );

  /** 화면을 떠나기 전에 밀린 저장을 **끝까지** 기다린다(안 기다리면 방금 친 글자가 쓸려 간다). */
  const flushAll = useCallback(async () => {
    const pending = [...timers.current.keys()];
    for (const id of timers.current.values()) clearTimeout(id);
    timers.current.clear();
    await Promise.all([...pending.map((sid) => save(sid)), ...inflight.current]);
    publishDirty();
  }, [save, publishDirty]);

  // 이동 버튼을 안 누르고 화면을 떠나는 길(보기 전환·창 닫기)에서도 마지막 글자를 보낸다.
  // 여기선 기다릴 수 없다 — 그래서 아래 beforeunload 가드가 짝이다.
  useEffect(
    () => () => {
      for (const [sid, id] of [...timers.current]) {
        clearTimeout(id);
        timers.current.delete(sid);
        void save(sid);
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        if (typeof window !== "undefined" && window.parent !== window) {
          try {
            window.parent.postMessage(windowDirtyMessage(false), window.location.origin);
          } catch {
            /* 무시 */
          }
        }
      }
    },
    [save],
  );

  // 🔴 새로고침·탭 닫기 — 디바운스 창(600ms)과 왕복 중인 저장을 잃지 않게 확인을 띄운다.
  //    저장이 밀려 있을 때만 걸리므로 평소 새로고침은 아무것도 안 묻는다.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (timers.current.size === 0 && inflight.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return { goals, setField, flushAll, savedAt, error, dismissError: () => setError(null) };
}
