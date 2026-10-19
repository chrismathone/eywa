"use client";

/**
 * 수업계획 줄이 **어느 문으로 저장될지**만 고르는 얇은 인터페이스.
 *
 * 🔑 기계(`usePlanHandlers`)·표(`PlanTable`)·블록(`SlotPlanBlock`)은 한 벌이고, 갈리는 건 게이트뿐이다:
 *   · 로그인(영어 시트·로그인 자리 출석부) = `ECS_PLAN_API` → `requireEcsClassAccess`
 *   · 비로그인 공개 자리 화면(`/seat/jj`) = [`seatPlanApi`](@/features/attendance/seat/seat-plan-api.ts)
 *     → 자리 PIN 쿠키 + 오늘 + 그 교시 명단
 *   두 문 뒤의 밑바닥(CAS·`ecs_*` RPC·`ecs_copy_slot`)은 같은 함수다.
 *
 * 🔴 새 문을 만들 땐 **이 타입만 구현**할 것 — 계획 저장 로직을 화면 쪽에 다시 적으면 같은 표를 서로 다른
 *    규칙(줄 번호·시기·CAS 기대값)으로 쓰게 된다.
 * ⚠️ `moveLine`·`deleteLine`이 `planDate`/`slotStart`를 함께 받는 건 ECS엔 필요 없지만 **PIN 문의
 *    게이트가 그 (날짜, 교시)로 명단을 찾기 때문**이다. 인자를 빼지 말 것.
 */
import {
  copySlotFromPrevious,
  createPlanLine,
  deletePlanLine,
  flushSheetPatches,
  movePlanLine,
} from "../server/actions";
import { commitSheetEdits } from "../server/edit-audit-actions";
import type { SheetEdit } from "../lib/edit-audit";
import type { PlanCopyResult, PlanLinesResult, PlanPatchesResult } from "../server/plan-write";

/** 계획 줄 한 칸을 특정하는 문맥 — 모든 호출이 **같은 (날짜, 교시)** 한 벌만 싣는다. */
export type PlanSlotRef = { classId: string; planDate: string; slotStart: string };

import {
  setLessonShift,
  type LessonShiftKind,
  type LessonShiftResult,
} from "@/features/textbooks/server/plan-actions";
import { getSlotPlanCompare, type SlotCompareResult } from "@/features/textbooks/server/compare-actions";
import { undoLessonShift, type ShiftUndoResult } from "@/features/textbooks/server/shift-undo-actions";
import type { ShiftUndoToken } from "@/features/textbooks/shift-undo";

export type PlanWriteApi = {
  flushPatches: (ref: PlanSlotRef, patches: unknown) => Promise<PlanPatchesResult>;
  createLine: (ref: PlanSlotRef, input: { termMode: "regular" | "exam"; skillArea: string }) => Promise<PlanLinesResult>;
  moveLine: (
    ref: PlanSlotRef,
    input: { lineId: string; termMode: "regular" | "exam"; lineNo: number },
  ) => Promise<PlanLinesResult>;
  deleteLine: (ref: PlanSlotRef, input: { lineId: string }) => Promise<PlanLinesResult>;
  copySlot: (ref: PlanSlotRef, input: { termMode: "regular" | "exam" }) => Promise<PlanCopyResult>;
  /**
   * **계획 비교**(원장 2026-09-28) — 그 칸의 원래 월간계획 ↔ 실제를 모달로 견준다(읽기 전용).
   * ⚠️ **선택**이다 — 비로그인 자리 PIN 화면(`/seat/jj`)은 세션이 없어 교재 배정을 읽을 수 없다.
   *    문이 이 메서드를 안 내면 표가 버튼을 아예 안 그린다(없는 기능을 회색으로 보여 주지 않는다).
   * 🔴 옛 **[월간계획 가져오기](교시 한 칸)는 없앴다**(원장 2026-09-28 *"한주씩 가져오는건 필요없음"*) —
   *    가져오기는 월간 화면의 [월간계획 전체 가져오기] 하나뿐이다.
   */
  comparePlan?: (ref: PlanSlotRef) => Promise<SlotCompareResult>;
  /**
   * **회차 미루기·당기기**(0282a) — 그 칸에서 차수를 건너뛸지/버릴지. `comparePlan`과 같은 이유로 선택이다.
   */
  setShift?: (ref: PlanSlotRef, kind: LessonShiftKind | null) => Promise<LessonShiftResult>;
  /** 미루기·당기기 **되돌리기**(원장 2026-10-19) — `setShift`가 돌려준 기록을 그대로 돌려보낸다. 짝이라 함께 낸다. */
  undoShift?: (classId: string, token: ShiftUndoToken) => Promise<ShiftUndoResult>;
  /**
   * 계획 **칸 값** 감사로그 — 칸을 떠날 때 한 줄(원장 결정 2026-09-14). 저장과 **같은 문**을 지난다.
   * ⚠️ 없으면 그 문의 계획 칸은 기록되지 않는다(가드 `edit-audit-wiring.test.ts`가 두 문 모두 구현했는지 본다).
   */
  commitEdits?: (ref: PlanSlotRef, edits: SheetEdit[]) => Promise<unknown>;
};

/** 로그인 경로(영어 시트·로그인 자리 출석부) 기본 문 — 게이트는 `requireEcsClassAccess(write)`. */
export const ECS_PLAN_API: PlanWriteApi = {
  flushPatches: (ref, patches) => flushSheetPatches(ref.classId, patches),
  createLine: (ref, input) =>
    createPlanLine({
      classId: ref.classId,
      planDate: ref.planDate,
      slotStart: ref.slotStart,
      termMode: input.termMode,
      skillArea: input.skillArea,
    }),
  moveLine: (ref, input) =>
    movePlanLine({ classId: ref.classId, lineId: input.lineId, termMode: input.termMode, lineNo: input.lineNo }),
  deleteLine: (ref, input) => deletePlanLine({ classId: ref.classId, lineId: input.lineId }),
  copySlot: (ref, input) =>
    copySlotFromPrevious({
      classId: ref.classId,
      planDate: ref.planDate,
      slotStart: ref.slotStart,
      termMode: input.termMode,
    }),
  comparePlan: (ref) =>
    getSlotPlanCompare({ classId: ref.classId, date: ref.planDate, slotStart: ref.slotStart }),
  setShift: (ref, kind) =>
    setLessonShift({ classId: ref.classId, date: ref.planDate, slotStart: ref.slotStart, kind }),
  undoShift: (classId, token) => undoLessonShift({ classId, token }),
  commitEdits: (ref, edits) => commitSheetEdits({ classId: ref.classId, edits }),
};
