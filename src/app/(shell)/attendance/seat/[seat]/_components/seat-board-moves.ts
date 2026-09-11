"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetSeatPlacements } from "@/features/attendance/seat/server/placement-actions";
import type { SeatKey } from "@/features/attendance/seat/seat";
import type { SeatPeriodMove, SeatPeriodPin } from "@/features/attendance/seat/period-choice";

/**
 * 자리 **배치**(0254a — 드래그로 옮겨 둔 자리)의 화면 상태 — [초기화]의 낙관 반영 + 실패 시 원복.
 *
 * 🔴 **배치를 새로 만드는 드래그는 없다** — 원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의
 *    수업임. 같은 시간대의 수업으로 옮기고 싶은게 아니야."* 드래그의 뜻은 다른 시간 하나다(`SeatAllDay`·
 *    [`drop-verdict.ts`](@/features/attendance/seat/drop-verdict.ts)). 남은 것은 **이미 있는 줄의 표시와 [초기화]**뿐이다
 *    (둘을 지우면 옮겨 둔 자리가 되돌릴 길 없는 고아가 된다).
 * 🔴 **출결 저장(`useSeatBoardSaves`)과 다른 훅이다** — 두 축은 서버에서도 표가 다르다(0254a `seat_placements` ↔
 *    `attendance_records`). 그래서 [초기화]를 눌러도 이미 찍힌 출결은 그대로 따라간다.
 * 🔑 오버레이는 **덮어쓰기 지도**다: `학생 → null`(배치 없음 = 원래 반). 서버 줄과 합치는 규칙은 [`mergeSeatPlacements`] 하나.
 * ⚠️ 성공하면 `router.refresh()`로 서버 줄을 다시 받는다 — 그 뒤엔 오버레이와 서버가 같은 말을 한다.
 */
export function useSeatPlacementMoves(seat: SeatKey, date: string, activeStart: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [overlay, setOverlay] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);

  /** 실패하면 그 학생의 오버레이만 걷는다 — 화면에만 남는 상태를 만들지 않는다. */
  const revert = useCallback((studentIds: readonly string[]) => {
    setOverlay((m) => {
      const next = { ...m };
      for (const id of studentIds) delete next[id];
      return next;
    });
  }, []);

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

  return { overlay, movePending: pending, moveError: error, resetPlacements };
}

type ChoiceOverlay = Record<string, string | null>;

/**
 * 교시 선택(0255a)의 **낙관 반영 지도** — `반id|학생id` → 교시(`null` = 지정 없음 = 제 교시). `SeatAllDay`가 쓴다.
 *
 * 🔴 **서버 줄(`moves`·`pins`)이 새로 오면 비운다** — 왕복을 기다리는 동안만 필요한 값이다. 성공 뒤에도 남겨 두면 다른
 *    창·기기가 그 지정을 풀어도 이 화면만 옛 교시를 붙들어, 그 학생이 어디에도 안 보이는데 일괄 버튼(서버 명단)은 그
 *    학생까지 찍는다(적대 리뷰 2026-09-11). RSC가 새로 오면 두 배열은 새 참조라 그걸로 가른다.
 * 🔑 렌더 중에 이전 값과 비교해 되돌린다(React 문서 "prop이 바뀌면 state 조정") — effect로 하면 한 프레임 거짓 명단이
 *    그려지고 `set-state-in-effect`에 걸린다([[#25]]).
 * ⚠️ 왕복 중에 다른 새 줄이 먼저 오면 그 카드는 잠깐 제자리로 돌아간다 — 그 이동의 새 줄이 오면 다시 선다(거짓 명단보다 낫다).
 */
export function useSeatChoiceOverlay(moves: readonly SeatPeriodMove[], pins: readonly SeatPeriodPin[]) {
  const [overlay, setOverlay] = useState<ChoiceOverlay>({});
  const [base, setBase] = useState({ moves, pins });
  if (base.moves !== moves || base.pins !== pins) {
    setBase({ moves, pins });
    setOverlay({});
  }
  return [overlay, setOverlay] as const;
}
