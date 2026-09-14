"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upsertGoal } from "../server/actions";
import type { MonthGoalMap } from "../lib/goal-match";

/**
 * 월간 목표 편집 상태 + 저장 — **주간 시트와 같은 칸, 같은 저장 경로**(`upsertGoal`).
 *
 * 원장 2026-08-31: *"월간뷰에서도 고칠 수 있게. 서로 배선이 유기적으로 되도록."*
 * 그래서 새 액션을 만들지 않았다 — 월간에서 고치면 주간 시트에 뜨고, 주간에서 고치면 월간에 뜬다.
 *
 * 🔴 **화면이 먼저 바뀐다(낙관적)** — 경고(목표 밖 교재)가 이 값에서 파생되므로 저장을 기다리면
 *    "고쳤는데 여전히 주황"인 순간이 생긴다. 저장 실패는 되돌리고 사유를 한글로 알린다.
 * ⚠️ 저장은 **디바운스 600ms + 언마운트 flush** — 타이핑마다 서버를 때리지 않되, 마지막 글자를
 *    잃지 않는다(초안 자동저장의 "타이핑 유실 0" 규약과 같은 결).
 * ⚠️ 같은 칸을 연달아 고치면 **마지막 값만** 보낸다(LWW) — 큐에 쌓아 순서대로 보내면 느린 왕복이
 *    앞 값으로 덮어쓴다.
 */
export type GoalRole = "homeroom" | "assistant";
export type GoalField = "textbook" | "targetProgress";

const SAVE_DELAY_MS = 600;

export function useMonthGoals(input: {
  classId: string;
  /** 그 달 1일(`class_sheet_goals.period_start`) — 액션이 다시 정규화하지만 여기서도 맞춰 보낸다. */
  periodStart: string;
  initial: { homeroom: MonthGoalMap; assistant: MonthGoalMap };
}) {
  const { classId, periodStart, initial } = input;
  const [goals, setGoals] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, { role: GoalRole; skillArea: string }>());
  /** 이미 떠난 저장 — `flushAll`이 이것까지 기다린다(디바운스가 먼저 발화한 저장도 도착한 뒤에 움직이게). */
  const inflight = useRef(new Set<Promise<void>>());
  /** 저장 실패 시 되돌릴 값 — 낙관적 반영 직전의 스냅샷. */
  const lastSaved = useRef(initial);
  /**
   * 키(역할·영역)별 **입력 세대** — 칠 때마다 1씩 오른다. 저장이 실패했을 때 그 저장이 떠난 뒤 세대가 바뀌었으면
   * (새로 친 값이 있으면) 되돌리지 않는다. 타이머 대기 중인 입력과 이미 떠난 다음 저장을 한 번에 가른다.
   */
  const editGen = useRef(new Map<string, number>());
  /**
   * 지금 화면의 값 — `setGoals` **updater 안에서 저장을 예약하지 않으려고** 따로 든다.
   * (updater는 StrictMode에서 두 번 불릴 수 있어 그 안에 부수효과를 두면 저장이 두 번 나간다.)
   */
  const goalsRef = useRef(initial);

  // ⚠️ 서버 값이 바뀌면(달 이동·반 전환) **페이지가 컴포넌트를 새로 세운다**(`key={classId:month}`) —
  //    effect로 state를 덮어쓰면 React 19가 막는 캐스케이딩 렌더가 되고([[#25]]), 무엇보다 타이핑 중에
  //    서버 값이 도착하면 사람이 치던 글자가 사라진다.

  const flushKey = useCallback(
    (key: string, role: GoalRole, skillArea: string, next: MonthGoalMap): Promise<void> => {
      const cell = next[skillArea] ?? { textbook: null, targetProgress: null };
      const sentGen = editGen.current.get(key) ?? 0;
      const job: Promise<void> = upsertGoal({
        classId,
        scope: "month",
        periodStart,
        role,
        skillArea,
        textbook: cell.textbook,
        targetProgress: cell.targetProgress,
      })
        .then((res) => {
          if (res.ok) {
            lastSaved.current = { ...lastSaved.current, [role]: { ...lastSaved.current[role], [skillArea]: cell } };
            setSavedAt(Date.now());
            setError(null);
            return;
          }
          // 실패는 되돌린다 — 화면에만 남은 목표는 경고 판정을 조용히 뒤집는다.
          // ⚠️ 입력칸은 `defaultValue`(비컨트롤드)라 글자는 그대로 남는다 — 되돌아가는 건 **판정에 쓰는 값**이다.
          //    (컨트롤드로 바꾸면 저장 왕복마다 커서가 튄다.)
          setError(res.error);
          // 🔴 이 저장이 떠난 뒤 같은 키에 새로 친 값이 있으면(세대가 바뀜) **되돌리지 않는다** — 되돌리면 그 새 값까지
          //    지워지고, 뒤따르는 타이머·flush가 **옛 값**을 보내 화면엔 '저장됨'이 뜬다(재리뷰 2026-09-14).
          //    새 값의 저장이 곧 나가고, 그것도 실패하면 그때 되돌린다.
          if ((editGen.current.get(key) ?? 0) !== sentGen) return;
          const reverted = lastSaved.current[role][skillArea] ?? { textbook: null, targetProgress: null };
          goalsRef.current = {
            ...goalsRef.current,
            [role]: { ...goalsRef.current[role], [skillArea]: reverted },
          };
          setGoals(goalsRef.current);
        })
        .catch((e: unknown) => {
          // 액션은 {ok:false}로 실패를 알리지만 **네트워크가 끊기면 reject**된다 — 안 잡으면
          // unhandled rejection이 되고, 이 Promise에 이동을 매단 화면이 영영 안 움직인다.
          setError(e instanceof Error ? e.message : "네트워크 오류로 저장하지 못했습니다");
        })
        .finally(() => {
          // 🔴 저장 중에 같은 키(역할·영역)에 새 입력이 들어와 **타이머가 다시 섰으면** 그 대기분은 지우지 않는다 —
          //    지우면 flushAll이 타이머만 끄고 대상이 없어 건너뛰어, 뒤에 친 칸(예: 교재명 뒤 목표 진도)이
          //    화면엔 '저장됨'인 채 서버에 영영 안 간다(리뷰 2026-09-14).
          if (!timers.current.has(key)) pending.current.delete(key);
          inflight.current.delete(job);
        });
      inflight.current.add(job);
      return job;
    },
    [classId, periodStart],
  );

  const setField = useCallback(
    (role: GoalRole, skillArea: string, field: GoalField, value: string) => {
      const key = `${role}|${skillArea}`;
      editGen.current.set(key, (editGen.current.get(key) ?? 0) + 1);
      const cur = goalsRef.current;
      const cell = cur[role][skillArea] ?? { textbook: null, targetProgress: null };
      const trimmed = value.trim() === "" ? null : value;
      const nextRole: MonthGoalMap = { ...cur[role], [skillArea]: { ...cell, [field]: trimmed } };
      const next = { ...cur, [role]: nextRole };
      goalsRef.current = next;
      setGoals(next);
      // 디바운스 — 같은 칸의 앞선 예약은 취소하고 마지막 값만 보낸다.
      const timer = timers.current.get(key);
      if (timer) clearTimeout(timer);
      pending.current.set(key, { role, skillArea });
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          flushKey(key, role, skillArea, goalsRef.current[role]);
        }, SAVE_DELAY_MS),
      );
    },
    [flushKey],
  );

  /**
   * 창을 닫거나 달·반을 옮길 때 — 예약된 저장을 지금 보낸다(마지막 글자 유실 방지).
   * 🔴 **Promise를 돌려준다** — 호출부가 `await` 한 뒤 이동해야 한다. 안 기다리고 이동하면
   *    컴포넌트가 언마운트되며 방금 친 글자가 서버에 닿지 못한 채 사라진다.
   * 🔑 **이미 떠난 저장까지** 기다린다 — 디바운스가 먼저 발화해 왕복 중인 저장을 두고 움직이면, 화면을 다시
   *    읽거나 칸 편집 감사로그가 DB를 읽을 때 아직 도착 전 값을 본다.
   */
  const flushAll = useCallback((): Promise<void> => {
    for (const [key, timer] of [...timers.current]) {
      clearTimeout(timer);
      // 끈 타이머는 대상이 없어도 지운다 — 남겨 두면 위 finally가 "대기 중"으로 읽어 대기분을 영영 못 지운다.
      timers.current.delete(key);
      const target = pending.current.get(key);
      if (!target) continue;
      flushKey(key, target.role, target.skillArea, goalsRef.current[target.role]);
    }
    return Promise.all([...inflight.current]).then(() => undefined);
  }, [flushKey]);

  // 언마운트 시에도 한 번 — 사람이 이동 버튼을 안 누르고 창을 닫는 길이 있다(여기선 기다릴 수 없다).
  useEffect(() => () => void flushAll(), [flushAll]);

  return { goals, setField, flushAll, error, savedAt, dismissError: () => setError(null) };
}
