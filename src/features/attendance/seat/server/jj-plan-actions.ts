"use server";

/**
 * 공개 자리 화면(`/seat/jj`, 비로그인 PIN)의 **진도(수업계획) 쓰기 액션** — 얇은 문 다섯 개.
 *
 * 🔴 **여기에 저장 로직이 없다.** 게이트([`gateSeatPlanWrite`](./jj-plan-public.ts))를 지나면 곧장
 *    영어 시트와 **같은 밑바닥**([`plan-write.ts`](@/features/class-sheets/server/plan-write.ts))으로
 *    흘려보낸다: 셀 = CAS 배치 · 구조 = `ecs_*` RPC · 복사 = `ecs_copy_slot`. 새 RPC·새 표는 0개다.
 *    규칙이 두 벌이 되면 같은 표(`class_sheet_plan_lines`)를 화면마다 다르게 쓰게 된다.
 *
 * 🔴 **날짜·교시가 인자에 딱 한 벌**인 게 중요하다 — 게이트가 본 (날짜, 교시)와 실제로 쓰는 (날짜, 교시)가
 *    갈리면 "오늘 교시로 통과시키고 어제 칸에 쓰기"가 열린다. 그래서 `planDate`/`slotStart`를 그대로
 *    게이트에 넣고, 통과한 뒤엔 **게이트가 돌려준 `scope`만** 쓴다(따로 받는 date 인자를 만들지 말 것).
 * 🔴 **이미 있는 줄을 건드리는 셋(셀·이동·삭제)엔 `scope`를 반드시 넘긴다.** 줄 id는 반에만 묶여 있어서
 *    안 넘기면 그 반의 **지난 날짜 줄**까지 열린다("오늘만"이라는 게이트가 거짓말이 된다).
 *    새로 만들거나 복사하는 둘은 날짜·교시를 직접 써서 이미 좁혀져 있다.
 *
 * ⚠️ 로그인 화면(`/attendance/seat/jj`)은 이 파일을 쓰지 않는다 — 그쪽 문은 ECS 게이트다
 *    (`class-sheets/server/actions.ts`). 두 문을 한 액션으로 합치지 말 것: 자리 권한(아르바이트·viewer)이
 *    영어 시트 권한을 우회하는 뒷문이 된다.
 *
 * 🔴 **여기엔 감사로그(`logAction`)가 없다 — 빠뜨린 게 아니다**(2026-09-09 출결 감사 배선 때 확인).
 *    `logAction`은 실행자를 세션(`getCurrentUser`)에서 읽는데 이 문은 **PIN 전용이라 로그인이 아예 없다**
 *    (`gateSeatPinOnly`는 로그인 상태를 보지도 않는다). 부르면 조용히 no-op이 되어 "감사로그를 달았다"는
 *    거짓 커버리지만 남는다 — 같은 이유로 줄의 `updated_by`도 설계상 null이다(위 게이트 주석).
 *    ⚠️ 이 갈래를 진짜로 남기려면 **감사 도메인에 무기명 actor 경로가 먼저** 필요하다:
 *    `audit_logs`의 insert 정책이 `actor_id = auth.uid()`(0219a)라 admin 클라이언트까지 함께 가야 한다.
 *    그건 이 파일이 아니라 `features/audit`의 결정 사항이다.
 */
import {
  applyPlanPatches,
  copyPlanSlotFromPrevious,
  insertPlanLine,
  relocatePlanLine,
  removePlanLine,
  type PlanCopyResult,
  type PlanLinesResult,
  type PlanPatchesResult,
} from "@/features/class-sheets/server/plan-write";
import type { SeatKey } from "../seat";
import { gateSeatPlanWrite } from "./jj-plan-public";

/** 모든 액션이 공유하는 최소 문맥 — 자리·그 교시 한 칸을 특정한다. */
type SeatSlotRef = {
  seat: SeatKey;
  classId: string;
  /** 대상 날짜(= 게이트가 "오늘인가"를 판정하는 그 날짜). */
  planDate: string;
  /** 대상 교시(= 게이트가 명단을 찾는 그 시각). */
  slotStart: string;
};

export async function flushSeatPlanPatches(
  input: SeatSlotRef & { patches: unknown },
): Promise<PlanPatchesResult> {
  const gate = await gateSeatPlanWrite({
    seat: input.seat,
    date: input.planDate,
    slotStart: input.slotStart,
    classId: input.classId,
  });
  if (!gate.ok) return { ok: false, error: gate.error };
  return applyPlanPatches(gate.grant, input.patches, gate.scope);
}

export async function createSeatPlanLine(
  input: SeatSlotRef & { termMode: "regular" | "exam"; skillArea: string },
): Promise<PlanLinesResult> {
  const gate = await gateSeatPlanWrite({
    seat: input.seat,
    date: input.planDate,
    slotStart: input.slotStart,
    classId: input.classId,
  });
  if (!gate.ok) return { ok: false, error: gate.error };
  return insertPlanLine(gate.grant, {
    ...gate.scope,
    termMode: input.termMode,
    skillArea: input.skillArea,
  });
}

export async function moveSeatPlanLine(
  input: SeatSlotRef & { lineId: string; termMode: "regular" | "exam"; lineNo: number },
): Promise<PlanLinesResult> {
  const gate = await gateSeatPlanWrite({
    seat: input.seat,
    date: input.planDate,
    slotStart: input.slotStart,
    classId: input.classId,
  });
  if (!gate.ok) return { ok: false, error: gate.error };
  // ⚠️ 줄 id가 정말 그 반·그 교시 것인지는 밑바닥(`assertLineInClass`)이 다시 본다 — 명단 통과가 곧 그
  //    줄의 소유를 뜻하지 않는다(다른 반·지난 날짜 줄 id를 실어 보내는 강제 호출).
  return relocatePlanLine(
    gate.grant,
    { lineId: input.lineId, termMode: input.termMode, lineNo: input.lineNo },
    gate.scope,
  );
}

export async function deleteSeatPlanLine(
  input: SeatSlotRef & { lineId: string },
): Promise<PlanLinesResult> {
  const gate = await gateSeatPlanWrite({
    seat: input.seat,
    date: input.planDate,
    slotStart: input.slotStart,
    classId: input.classId,
  });
  if (!gate.ok) return { ok: false, error: gate.error };
  return removePlanLine(gate.grant, { lineId: input.lineId }, gate.scope);
}

/**
 * 「내용 복사(지난 수업)」 — 원장 승인 2026-08-25로 공개 화면에도 연다.
 *
 * 🔵 이 액션만 **오늘 명단 밖의 지난 기록을 읽는다.** 범위를 넓히는 인자는 없다 — RPC가 `p_class`와
 *    `p_slot_start`로 잠가 **같은 반·같은 교시**의 지난 수업일만 원본으로 삼고, 그 둘은 게이트가 통과시킨
 *    바로 그 값이다. 대상은 비어 있는 칸만 채운다(덮어쓰기 없음).
 */
export async function copySeatPlanSlot(
  input: SeatSlotRef & { termMode: "regular" | "exam" },
): Promise<PlanCopyResult> {
  const gate = await gateSeatPlanWrite({
    seat: input.seat,
    date: input.planDate,
    slotStart: input.slotStart,
    classId: input.classId,
  });
  if (!gate.ok) return { ok: false, error: gate.error };
  return copyPlanSlotFromPrevious(gate.grant, { ...gate.scope, termMode: input.termMode });
}
