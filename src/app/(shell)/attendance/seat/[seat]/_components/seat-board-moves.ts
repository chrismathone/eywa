"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  moveSeatStudent,
  resetSeatPlacements,
} from "@/features/attendance/seat/server/placement-actions";
import { clearSeatPeriodChoices } from "@/features/attendance/seat/server/period-actions";
import type { SeatKey } from "@/features/attendance/seat/seat";

/**
 * 자리 **배치**(드래그로 옮긴 자리)의 화면 상태 — 낙관 반영 + 실패 시 원복.
 *
 * 🔴 **출결 저장(`useSeatBoardSaves`)과 다른 훅이다** — 원장 *"클릭으로 출결되는거랑 중복액션되지않게
 *    잘 분리해서"*. 두 축은 서버에서도 표가 다르고(0254a `seat_placements` ↔ `attendance_records`),
 *    화면에서도 상태를 섞지 않는다. 그래서 자리를 옮겨도 이미 찍힌 출결은 그대로 따라간다.
 * 🔑 오버레이는 **덮어쓰기 지도**다: `학생 → 놓인 반` / `null`이면 배치 없음(= 원래 반). 초기화도 이
 *    한 모양으로 표현되므로 서버 줄과 합치는 규칙이 [`mergeSeatPlacements`] 하나로 끝난다.
 * ⚠️ 성공하면 `router.refresh()`로 서버 줄을 다시 받는다 — 그 뒤엔 오버레이와 서버가 같은 말을 한다.
 */
export function useSeatPlacementMoves(seat: SeatKey, date: string, activeStart: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [overlay, setOverlay] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);

  /** 실패하면 그 학생의 오버레이만 걷는다 — 화면에만 남는 배치를 만들지 않는다. */
  const revert = useCallback((studentIds: readonly string[]) => {
    setOverlay((m) => {
      const next = { ...m };
      for (const id of studentIds) delete next[id];
      return next;
    });
  }, []);

  const moveStudent = useCallback(
    (studentId: string, toClassId: string, homeClassId: string) => {
      setError(null);
      // 제 반으로 도로 놓기 = 배치 없음. 서버도 같은 판정으로 줄을 지운다.
      setOverlay((m) => ({ ...m, [studentId]: toClassId === homeClassId ? null : toClassId }));
      startTransition(async () => {
        const res = await moveSeatStudent({ seat, date, slotStart: activeStart, studentId, toClassId });
        if ("error" in res) {
          revert([studentId]);
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [activeStart, date, revert, router, seat],
  );

  /**
   * 초기화 — `classId`가 있으면 그 묶음만, 없으면 그 교시 전체. **서버가 대상을 다시 계산한다**([[#77]]).
   * 화면은 되돌릴 학생 목록을 보내지 않고, 낙관 반영에만 쓴다.
   */
  const resetPlacements = useCallback(
    (studentIds: readonly string[], classId?: string) => {
      if (studentIds.length === 0) return;
      setError(null);
      setOverlay((m) => {
        const next = { ...m };
        for (const id of studentIds) next[id] = null;
        return next;
      });
      startTransition(async () => {
        const res = await resetSeatPlacements({ seat, date, slotStart: activeStart, classId });
        if ("error" in res) {
          revert(studentIds);
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [activeStart, date, revert, router, seat],
  );

  return { overlay, movePending: pending, moveError: error, moveStudent, resetPlacements };
}

/**
 * **교시 지정 해제**(0255a) — 교시 하나만 그리는 보기에서 쓰는 갈래.
 *
 * 🔴 왜 따로 필요한가: '전체' 보기는 바깥(`SeatAllDay`)이 낙관 오버레이까지 들고 있어 제 것을 넘겨준다.
 *    교시 하나 보기엔 그 바깥이 없는데, **해제할 길이 없으면 감춰진 학생을 되돌릴 방법이 사라진다**
 *    (화면엔 아무 표시도 안 남으므로 "왜 이 아이가 없지"로 끝난다).
 * 🔑 낙관 반영을 안 한다 — 서버가 지운 뒤 `router.refresh()`로 서버 줄을 다시 받는다. 해제는 드물고,
 *    여기서 오버레이를 또 만들면 같은 상태가 두 곳에 생긴다.
 */
export function useSeatPeriodClear(seat: SeatKey, date: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const clearClass = useCallback(
    (classId: string) => {
      setError(null);
      startTransition(async () => {
        const res = await clearSeatPeriodChoices({ seat, date, classId });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [date, router, seat],
  );

  return { clearPending: pending, clearError: error, clearClass };
}
