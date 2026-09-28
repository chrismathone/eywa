"use server";

/**
 * **교시 한 칸의 계획 비교** — 주간 시트·달력의 [계획 비교] 모달이 여는 순간 읽는다(원장 2026-09-28
 * *"주간, 달력에서 해당 수업의 진도와 원래 월간계획을 바로 비교할 수 있는 기능"*).
 *
 * 🔑 **열 때 읽는다**(주간 시트 페이로드에 싣지 않는다) — 주간 시트는 영어 강사 전원이 매일 여는 화면이라
 *    교재 배정·차수표 조회를 첫 페인트에 얹지 않는다(반응속도 1순위, B7). 한 칸이라 조회는 가볍다.
 * 🔑 판정은 [`compareCell`](../plan-compare.ts) 단일 소스 — 현황 페이지와 같은 답을 낸다.
 * 🔴 읽기 게이트는 그 반의 ECS 열람(`requireEcsClassAccess`) — 서버 액션은 공개 엔드포인트다([[#77]]).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import { compareCell, type CellCompare } from "../plan-compare";
import type { PlannedLine } from "../plan-expand";
import { getClassPlannedLines } from "./month-plan";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^[0-2]\d:[0-5]\d$/;

export type SlotCompareActual = {
  skillArea: string;
  textbook: string | null;
  progress: string | null;
  homework: string | null;
};

export type SlotCompareResult =
  | {
      ok: true;
      /** 원래 계획(미루기 미반영) — 비교 기준. */
      baseline: PlannedLine[];
      /** 일정(미루기 반영) — 원래 계획과 다를 때만 모달이 "미루기로 바뀐 일정"을 따로 보인다. */
      scheduled: PlannedLine[];
      actual: SlotCompareActual[];
      compare: CellCompare;
      shift: "skip" | "advance" | null;
    }
  | { ok: false; error: string };

export async function getSlotPlanCompare(input: {
  classId: string;
  date: string;
  slotStart: string;
}): Promise<SlotCompareResult> {
  if (!YMD_RE.test(input.date)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const slot = String(input.slotStart).slice(0, 5);
  if (!HHMM_RE.test(slot)) return { ok: false, error: "교시가 올바르지 않습니다" };
  const gate = await requireEcsClassAccess(input.classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { tenantId, subject } = gate.access;

  const [planned, actualRes] = await Promise.all([
    getClassPlannedLines({ tenantId, subject, classId: input.classId, from: input.date, to: input.date }),
    // `class_sheet_*`는 RLS 정책이 0개라 admin + tenant 필터([[#104]]).
    createAdminClient()
      .from("class_sheet_plan_lines")
      .select("skill_area, textbook, progress, homework, line_no")
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("plan_date", input.date)
      .eq("slot_start", slot)
      // 배정은 평시 축뿐이다 — 내신 줄은 견주지 않는다(비교하면 늘 '다름'이 된다).
      .eq("term_mode", "regular")
      .order("line_no", { ascending: true })
      .range(0, 99),
  ]);
  if (planned.status === "missing-table") {
    return { ok: false, error: "교재 배정 준비가 아직 적용되지 않았습니다" };
  }
  if (planned.status !== "ok") return { ok: false, error: "월간계획을 읽지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  if (actualRes.error) return { ok: false, error: "실제 수업계획을 읽지 못했습니다" };

  const key = `${input.date}|${slot}`;
  const baseline = planned.baselineByCell[key] ?? [];
  const actual: SlotCompareActual[] = (actualRes.data ?? []).map((r) => ({
    skillArea: String(r.skill_area),
    textbook: (r.textbook as string | null) ?? null,
    progress: (r.progress as string | null) ?? null,
    homework: (r.homework as string | null) ?? null,
  }));
  return {
    ok: true,
    baseline,
    scheduled: planned.byCell[key] ?? [],
    actual,
    compare: compareCell({
      baseline,
      actual,
      lessonIndex: planned.lessonIndex,
      isFuture: input.date > kstToday(),
    }),
    shift: planned.shiftByCell[key] ?? null,
  };
}
