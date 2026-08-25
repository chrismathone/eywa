"use client";

/**
 * 공개 자리 화면(`/seat/jj`, 비로그인 PIN)이 쓰는 **계획 저장 문**.
 *
 * 영어 시트와 같은 [`PlanWriteApi`](@/features/class-sheets/components/plan-api.ts)를 구현할 뿐이고,
 * 계획 기계·표·블록은 전부 공용 그대로다. 여기서 하는 일은 자리 키(`seat`)를 실어 주는 것뿐 —
 * 게이트(PIN 쿠키·오늘·그 교시 명단)와 저장은 서버가 한다([`jj-plan-actions`](./server/jj-plan-actions.ts)).
 *
 * ⚠️ **반환값은 안정 참조여야 한다** — `SlotPlanBlock`이 `memo`라, 렌더마다 새 객체를 만들면 학생 칸을
 *    한 글자 칠 때마다 나란한 반들의 계획 표가 통째로 다시 그려진다. 호출부에서 `useMemo`로 감쌀 것.
 */
import type { PlanWriteApi } from "@/features/class-sheets/components/plan-api";
import {
  copySeatPlanSlot,
  createSeatPlanLine,
  deleteSeatPlanLine,
  flushSeatPlanPatches,
  moveSeatPlanLine,
} from "./server/jj-plan-actions";
import type { SeatKey } from "./seat";

export function seatPlanApi(seat: SeatKey): PlanWriteApi {
  return {
    flushPatches: (ref, patches) => flushSeatPlanPatches({ seat, ...ref, patches }),
    createLine: (ref, input) => createSeatPlanLine({ seat, ...ref, ...input }),
    moveLine: (ref, input) => moveSeatPlanLine({ seat, ...ref, ...input }),
    deleteLine: (ref, input) => deleteSeatPlanLine({ seat, ...ref, ...input }),
    copySlot: (ref, input) => copySeatPlanSlot({ seat, ...ref, ...input }),
  };
}
