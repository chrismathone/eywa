"use server";

// ECS 서버 액션 — 전부 requireEcsClassAccess(write) 공용 게이트(#77) 뒤. class_sheet_*는 deny-RLS라
// admin client(service_role)로만 접근하되, **모든 select/update가 tenant_id + class_id + id 3중 조건**
// (게이트한 반과 변경 행의 결속 — 계획 v2.2 §A). 구조 변경(create/move/delete/copy)은 0157a RPC 위임
// (슬롯 advisory xact 락·재번호 원자성). 출석은 체크(ecs_mark_present_if_absent) + 취소(ecs_clear_present,
// 0169a — plain present만) 두 경로뿐. 결석·지각·시수 편집은 여전히 /attendance 전용(§E 완화판).
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { mondayOf, shiftDays } from "@/features/timetable/lib/week";
import {
  attendanceLockMessage,
  isWithinAttendanceEditWindow,
} from "@/features/attendance/edit-window";
import { isEnrollmentActiveOn, enrollmentAttendsOnDay } from "@/features/enrollments/eligibility";
import { logAction } from "@/features/audit/server/log";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEFAULT_ECS_FONT_SIZE, ECS_FONT_SIZES, type EcsFontSize } from "../font-size";
import { DEFAULT_ECS_SHOW_SPECIAL_ROOMS } from "../view-prefs";
import { normalizePlanText } from "../lib/plan-codec";
import { validatePatchBatch, type PatchResult } from "../lib/save-keys";
import { dowKeyOf, HHMM_RE, normalizePeriodStart, YMD_RE } from "../lib/week";
import { requireEcsClassAccess } from "./access";

type ActionError = { ok: false; error: string };

const SLUG_RE = /^[a-z0-9_]{1,24}$/;

export type PlanLineDTO = {
  id: string;
  planDate: string;
  slotStart: string;
  termMode: "regular" | "exam";
  skillArea: string;
  lineNo: number;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
  updatedAt: string;
};

function toLineDTO(row: Record<string, unknown>): PlanLineDTO {
  return {
    id: row.id as string,
    planDate: row.plan_date as string,
    slotStart: (row.slot_start as string).slice(0, 5),
    termMode: row.term_mode as "regular" | "exam",
    skillArea: row.skill_area as string,
    lineNo: Number(row.line_no),
    textbook: (row.textbook as string | null) ?? null,
    pageRange: (row.page_range as string | null) ?? null,
    progress: (row.progress as string | null) ?? null,
    homework: (row.homework as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

// ── 필드 CAS 배치 저장 ────────────────────────────────────────────────────────

/**
 * 계획 행 필드 patch 배치 — 필드 단위 CAS(`<field> is not distinct from expected`일 때만 갱신).
 * · 배치에 **다른 반 행이 섞이면 전체 거부**(mixed-class 금지) — lineId 소속을 서버에서 조회해 검증.
 * · 0행 갱신 시: 행 없음=gone / 서버값==newValue=already_applied(응답 유실 재전송) / 그 외=conflict+서버값.
 * · 값은 normalizePlanText(trim, ""→NULL) codec을 서버에서도 강제(클라와 동일 정의).
 */
export async function flushSheetPatches(
  classId: string,
  rawPatches: unknown,
): Promise<{ ok: true; results: PatchResult[] } | ActionError> {
  const gate = await requireEcsClassAccess(classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = validatePatchBatch(rawPatches);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const patches = parsed.patches;
  const { tenantId, user } = gate.access;
  const admin = createAdminClient();

  // 배치의 모든 행이 게이트한 반 소속인지 — 하나라도 아니면 전체 거부(§A). 대량 .in은 청크(B3).
  const lineIds = [...new Set(patches.map((p) => p.lineId))];
  let ownRows: { id: string; class_id: string }[];
  try {
    ownRows = await fetchInChunks<{ id: string; class_id: string }>(lineIds, (chunk) =>
      admin.from("class_sheet_plan_lines").select("id, class_id").eq("tenant_id", tenantId).in("id", chunk),
    );
  } catch (e) {
    return { ok: false, error: `저장 준비에 실패했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
  const foundIds = new Set(ownRows.map((r) => r.id));
  if (ownRows.some((r) => r.class_id !== classId)) {
    return { ok: false, error: "다른 반의 행이 섞여 있어 저장을 거부했습니다" };
  }

  const results: PatchResult[] = [];
  for (const p of patches) {
    if (!foundIds.has(p.lineId)) {
      results.push({ saveKey: p.saveKey, status: "gone", clientRev: p.clientRev });
      continue;
    }
    const expected = normalizePlanText(p.expectedValue);
    const newValue = normalizePlanText(p.newValue);
    if (p.field === "skill_area" && (newValue === null || !SLUG_RE.test(newValue))) {
      results.push({ saveKey: p.saveKey, status: "error", clientRev: p.clientRev, error: "영역 값이 올바르지 않습니다" });
      continue;
    }
    let update = admin
      .from("class_sheet_plan_lines")
      .update({ [p.field]: newValue, updated_by: user.id })
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("id", p.lineId);
    update = expected === null ? update.is(p.field, null) : update.eq(p.field, expected);
    const { data: updated, error: upErr } = await update.select("id");
    if (upErr) {
      results.push({ saveKey: p.saveKey, status: "error", clientRev: p.clientRev, error: upErr.message });
      continue;
    }
    if ((updated ?? []).length > 0) {
      results.push({ saveKey: p.saveKey, status: "applied", clientRev: p.clientRev });
      continue;
    }
    // 0행 — 현재값 조회로 3분기
    const { data: cur } = await admin
      .from("class_sheet_plan_lines")
      .select(p.field)
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("id", p.lineId)
      .maybeSingle();
    if (!cur) {
      results.push({ saveKey: p.saveKey, status: "gone", clientRev: p.clientRev });
      continue;
    }
    const serverValue = normalizePlanText((cur as Record<string, string | null>)[p.field]);
    if (serverValue === newValue) {
      results.push({ saveKey: p.saveKey, status: "already_applied", clientRev: p.clientRev });
    } else {
      results.push({ saveKey: p.saveKey, status: "conflict", clientRev: p.clientRev, serverValue });
    }
  }
  return { ok: true, results };
}

// ── 구조 변경(RPC 위임) ──────────────────────────────────────────────────────

async function rpcSlotLines(
  rpc: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; lines: PlanLineDTO[] } | ActionError> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(rpc, args);
  if (error) {
    if (error.message.includes("ECS_MAX_LINES")) return { ok: false, error: "한 교시에 담을 수 있는 줄 수(20)를 넘었습니다" };
    return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
  }
  return { ok: true, lines: ((data ?? []) as Record<string, unknown>[]).map(toLineDTO) };
}

export async function createPlanLine(input: {
  classId: string;
  planDate: string;
  slotStart: string;
  termMode: "regular" | "exam";
  skillArea: string;
}): Promise<{ ok: true; lines: PlanLineDTO[] } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.planDate) || !HHMM_RE.test(input.slotStart)) {
    return { ok: false, error: "잘못된 요청입니다(날짜/시각)" };
  }
  if (input.termMode !== "regular" && input.termMode !== "exam") {
    return { ok: false, error: "잘못된 요청입니다(시기)" };
  }
  if (!SLUG_RE.test(input.skillArea)) return { ok: false, error: "잘못된 요청입니다(영역)" };
  return rpcSlotLines("ecs_create_plan_line", {
    p_tenant: gate.access.tenantId,
    p_actor: gate.access.user.id,
    p_class: input.classId,
    p_plan_date: input.planDate,
    p_slot_start: input.slotStart,
    p_term_mode: input.termMode,
    p_skill_area: input.skillArea,
  });
}

/** 이동 대상 행이 게이트한 반 소속인지 확인(§A — 실제 행의 class를 서버에서 조회 후 그 class로 게이트). */
async function assertLineInClass(
  tenantId: string,
  classId: string,
  lineId: string,
): Promise<{ ok: true } | { ok: false; code: "gone" | "foreign"; error: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("class_sheet_plan_lines")
    .select("id, class_id")
    .eq("tenant_id", tenantId)
    .eq("id", lineId)
    .maybeSingle();
  if (!data) return { ok: false, code: "gone", error: "행을 찾을 수 없습니다(다른 사용자가 삭제했을 수 있음)" };
  if (data.class_id !== classId) return { ok: false, code: "foreign", error: "다른 반의 행입니다" };
  return { ok: true };
}

export async function movePlanLine(input: {
  classId: string;
  lineId: string;
  termMode: "regular" | "exam";
  lineNo: number;
}): Promise<{ ok: true; lines: PlanLineDTO[] } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (input.termMode !== "regular" && input.termMode !== "exam") {
    return { ok: false, error: "잘못된 요청입니다(시기)" };
  }
  const own = await assertLineInClass(gate.access.tenantId, input.classId, input.lineId);
  if (!own.ok) return own;
  return rpcSlotLines("ecs_move_plan_line", {
    p_tenant: gate.access.tenantId,
    p_actor: gate.access.user.id,
    p_line_id: input.lineId,
    p_term_mode: input.termMode,
    p_line_no: Math.max(1, Math.min(20, Math.round(input.lineNo))),
  });
}

export async function deletePlanLine(input: {
  classId: string;
  lineId: string;
}): Promise<{ ok: true; lines: PlanLineDTO[] } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const own = await assertLineInClass(gate.access.tenantId, input.classId, input.lineId);
  if (!own.ok) {
    // 이미 삭제된 행(gone)이면 멱등 성공으로 취급(클라 재조회 유도) — 다른 반(foreign)만 하드 거부
    if (own.code === "foreign") return { ok: false, error: own.error };
    return { ok: true, lines: [] };
  }
  return rpcSlotLines("ecs_delete_plan_line", {
    p_tenant: gate.access.tenantId,
    p_line_id: input.lineId,
  });
}

export async function copyWeekFromPrevious(input: {
  classId: string;
  weekMonday: string;
}): Promise<
  | { ok: true; copied: number; goalsCopied: number; skippedSlots: string[]; unmapped: string[] }
  | ActionError
> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.weekMonday)) return { ok: false, error: "잘못된 요청입니다(주차)" };
  const to = mondayOf(input.weekMonday);
  const from = shiftDays(to, -7);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ecs_copy_week", {
    p_tenant: gate.access.tenantId,
    p_actor: gate.access.user.id,
    p_class: input.classId,
    p_from_monday: from,
    p_to_monday: to,
  });
  if (error) return { ok: false, error: `지난주 복사에 실패했습니다: ${error.message}` };
  const r = (data ?? {}) as { copied?: number; goalsCopied?: number; skippedSlots?: string[]; unmapped?: string[] };
  return {
    ok: true,
    copied: r.copied ?? 0,
    goalsCopied: r.goalsCopied ?? 0,
    skippedSlots: r.skippedSlots ?? [],
    unmapped: r.unmapped ?? [],
  };
}

// ── 목표·마크·메모 (명시적 LWW — 계획 v2.2 §C) ───────────────────────────────

export async function upsertGoal(input: {
  classId: string;
  scope: "month" | "week";
  periodStart: string;
  role: "homeroom" | "assistant";
  skillArea: string;
  textbook: string | null;
  targetProgress: string | null;
}): Promise<{ ok: true } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (input.scope !== "month" && input.scope !== "week") return { ok: false, error: "잘못된 요청입니다(기간)" };
  if (input.role !== "homeroom" && input.role !== "assistant") return { ok: false, error: "잘못된 요청입니다(역할)" };
  if (!YMD_RE.test(input.periodStart)) return { ok: false, error: "잘못된 요청입니다(기간 시작일)" };
  if (!SLUG_RE.test(input.skillArea)) return { ok: false, error: "잘못된 요청입니다(영역)" };
  const periodStart = normalizePeriodStart(input.scope, input.periodStart);
  const textbook = normalizePlanText(input.textbook);
  const targetProgress = normalizePlanText(input.targetProgress);
  if ((textbook?.length ?? 0) > 500 || (targetProgress?.length ?? 0) > 500) {
    return { ok: false, error: "입력이 너무 깁니다(500자 이내)" };
  }
  const admin = createAdminClient();
  const { tenantId, user } = gate.access;
  if (textbook === null && targetProgress === null) {
    const { error } = await admin
      .from("class_sheet_goals")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("scope", input.scope)
      .eq("period_start", periodStart)
      .eq("role", input.role)
      .eq("skill_area", input.skillArea);
    if (error) return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
    return { ok: true };
  }
  const { error } = await admin.from("class_sheet_goals").upsert(
    {
      tenant_id: tenantId,
      class_id: input.classId,
      scope: input.scope,
      period_start: periodStart,
      role: input.role,
      skill_area: input.skillArea,
      textbook,
      target_progress: targetProgress,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,class_id,scope,period_start,role,skill_area" },
  );
  if (error) return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
  return { ok: true };
}

export async function upsertStudentMark(input: {
  classId: string;
  studentId: string;
  markDate: string;
  slotStart: string;
  status: string | null;
  progressNote: string | null;
}): Promise<{ ok: true } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.markDate) || !HHMM_RE.test(input.slotStart)) {
    return { ok: false, error: "잘못된 요청입니다(날짜/시각)" };
  }
  const status = normalizePlanText(input.status);
  const progressNote = normalizePlanText(input.progressNote);
  if ((status?.length ?? 0) > 50) return { ok: false, error: "상태는 50자 이내로 입력하세요" };
  if ((progressNote?.length ?? 0) > 500) return { ok: false, error: "입력이 너무 깁니다(500자 이내)" };

  const admin = createAdminClient();
  const { tenantId, user } = gate.access;

  if (status === null && progressNote === null) {
    const { error } = await admin
      .from("class_sheet_student_marks")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("student_id", input.studentId)
      .eq("mark_date", input.markDate)
      .eq("slot_start", input.slotStart);
    if (error) return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
    return { ok: true };
  }

  // mark_date 기준 실수강·등원요일 검증 — 비eligible(historical) 학생 행은 읽기 전용(§F)
  const elig = await checkStudentEligibleOn(admin, tenantId, input.classId, input.studentId, input.markDate);
  if (!elig.ok) return elig;

  const { error } = await admin.from("class_sheet_student_marks").upsert(
    {
      tenant_id: tenantId,
      class_id: input.classId,
      student_id: input.studentId,
      mark_date: input.markDate,
      slot_start: input.slotStart,
      status,
      progress_note: progressNote,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,class_id,student_id,mark_date,slot_start" },
  );
  if (error) return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
  return { ok: true };
}

const MEMO_KEY_RE = /^(week|panel|day:\d{4}-\d{2}-\d{2}|slot:\d{4}-\d{2}-\d{2}:\d{2}:\d{2})$/;

export async function saveMemo(input: {
  classId: string;
  weekStart: string;
  memoKey: string;
  body: string;
}): Promise<{ ok: true } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.weekStart)) return { ok: false, error: "잘못된 요청입니다(주차)" };
  const weekStart = mondayOf(input.weekStart);
  if (!MEMO_KEY_RE.test(input.memoKey)) return { ok: false, error: "잘못된 요청입니다(메모 위치)" };
  // 위치키에 박힌 날짜가 그 주(월~일) 범위인지 — DB CHECK와 같은 규약을 액션에서도 검증
  const embedded = /(\d{4}-\d{2}-\d{2})/.exec(input.memoKey)?.[1];
  if (embedded && (embedded < weekStart || embedded > shiftDays(weekStart, 6))) {
    return { ok: false, error: "잘못된 요청입니다(메모 날짜가 주 범위 밖)" };
  }
  const body = input.body.trim();
  if (body.length > 2000) return { ok: false, error: "메모는 2000자 이내로 입력하세요" };

  const admin = createAdminClient();
  const { tenantId, user } = gate.access;
  if (body === "") {
    const { error } = await admin
      .from("class_sheet_memos")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("week_start", weekStart)
      .eq("memo_key", input.memoKey);
    if (error) return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
    return { ok: true };
  }
  const { error } = await admin.from("class_sheet_memos").upsert(
    {
      tenant_id: tenantId,
      class_id: input.classId,
      week_start: weekStart,
      memo_key: input.memoKey,
      body,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,class_id,week_start,memo_key" },
  );
  if (error) return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
  return { ok: true };
}

/**
 * (학생,반,날짜) 실수강 검증 — **쓰기 전 공용 게이트**(§F "기록 행은 읽기 전용").
 * 화면은 `entry.eligible`로 컨트롤을 감추지만 서버 액션은 공개 엔드포인트라 화면 조건은 게이트가 아니다(#77).
 * 마크 저장과 **출석 생성이 같은 판정**을 쓴다 — 한쪽만 검사하면 되돌리기 어려운 쪽(출석 행)이 뚫린다.
 */
async function checkStudentEligibleOn(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  classId: string,
  studentId: string,
  date: string,
): Promise<{ ok: true } | ActionError> {
  const { data: enrs, error } = await admin
    .from("enrollments")
    .select("start_date, end_date, on_hold, is_transferred, attendance_days, students!inner(withdrawn_at)")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("student_id", studentId);
  if (error) return { ok: false, error: `수강 확인에 실패했습니다: ${error.message}` };
  const dow = dowKeyOf(date);
  const eligible = (enrs ?? []).some((e) => {
    const withdrawnAt = (e.students as unknown as { withdrawn_at: string | null } | null)?.withdrawn_at ?? null;
    if (withdrawnAt && withdrawnAt < date) return false;
    if (
      !isEnrollmentActiveOn(
        {
          startDate: e.start_date as string,
          endDate: (e.end_date as string | null) ?? null,
          onHold: e.on_hold as boolean,
          isTransferred: (e.is_transferred as boolean | null) ?? undefined,
        },
        date,
      )
    ) {
      return false;
    }
    return enrollmentAttendsOnDay(e.attendance_days as string[] | null, dow);
  });
  if (!eligible) {
    return { ok: false, error: "그 날짜에 이 반을 수강하지 않는 학생입니다(기록 행은 읽기 전용)" };
  }
  return { ok: true };
}

// ── 출석(비파괴) ─────────────────────────────────────────────────────────────

/**
 * ECS 출석 체크 — 허용되는 유일한 조작 = "기록 없음 → present"(0157a RPC, 원자).
 * 어떤 기록이든 이미 있으면 no-op + canonical 상태 반환(absent/메모/시수 절대 불변).
 * 권한 = **기존 attendance 계약**: canWriteTenant("attendance") + 강사는 날짜별 7일 편집창
 * + **(학생,반,날짜) 실수강 검증**(checkStudentEligibleOn — 마크 저장과 같은 판정).
 *
 * ⚠️ 반 소유 범위: ECS 게이트는 `classes.teacher_id`(반담당) **∪ `class_schedules.teacher_id`(부담임)**
 * 이다(원장 승인 2026-07-29 부담임 확장). 즉 이 액션은 /attendance의 '반담당만' 규칙보다 **넓다** —
 * 실제로 그 교시를 가르치는 강사가 ECS에서 출석을 찍는 게 이 기능의 취지라 의도된 범위다.
 * 대신 학생 결속을 서버에서 검증해 "아무 학생에게나 출석 행 생성"은 닫는다(적대검증 2026-07-29).
 */
export async function markPresentIfAbsent(input: {
  classId: string;
  studentId: string;
  date: string;
}): Promise<{ ok: true; status: string } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.date)) return { ok: false, error: "잘못된 요청입니다(날짜)" };
  const { user, tenantId } = gate.access;
  if (!(await canWriteTenant(user.systemRole, "attendance"))) {
    return { ok: false, error: "출석 입력 권한이 없습니다" };
  }
  const today = kstToday();
  if (user.systemRole === "teacher" && !isWithinAttendanceEditWindow(input.date, today)) {
    return { ok: false, error: attendanceLockMessage(input.date, today) };
  }
  const admin = createAdminClient();
  // 학생-반-날짜 결속 — 화면(entry.eligible)은 게이트가 아니다. 잘못 만든 행은 시수·정산에도 들어간다
  // (취소는 clearPresentAttendance로 가능해졌지만, 그건 '내가 방금 찍은 것'을 되돌리는 경로다).
  const elig = await checkStudentEligibleOn(admin, tenantId, input.classId, input.studentId, input.date);
  if (!elig.ok) return elig;
  const { data, error } = await admin.rpc("ecs_mark_present_if_absent", {
    p_tenant: tenantId,
    p_actor: user.id,
    p_class: input.classId,
    p_student: input.studentId,
    p_date: input.date,
  });
  if (error) return { ok: false, error: `출석 저장에 실패했습니다: ${error.message}` };
  const rows = (data ?? []) as { status: string; recorded_at: string; id: string }[];
  // canonical = effective(최신 recorded_at, tie는 id) — RPC가 그 날짜 전 행을 돌려준다
  const eff = rows.reduce<{ status: string; recorded_at: string; id: string } | null>((acc, r) => {
    if (!acc) return r;
    if (r.recorded_at > acc.recorded_at) return r;
    if (r.recorded_at === acc.recorded_at && r.id > acc.id) return r;
    return acc;
  }, null);
  return { ok: true, status: eff?.status ?? "present" };
}

/**
 * ECS 출석 **취소** — 같은 체크를 다시 눌러 되돌린다(원장 지시 2026-07-31, 0169a).
 *
 * 게이트는 체크와 **똑같다**(권한 · 강사 7일 창 · 반 접근). 다른 점은 두 가지다:
 *  · 🔴 **plain present만 지운다** — 그 (반·학생·날짜)의 모든 행이 present + 메모 없음 + 시수 기본일 때만.
 *    결석/지각/공결이거나 출석부에서 사유·시수가 붙은 기록이면 RPC가 `blocked:'rich'`로 거부하고,
 *    화면은 "출석부에서 수정하세요"로 안내한다(그쪽 값은 시수 검증·급여 분배가 읽는 사람 입력이다).
 *  · 수강 자격(checkStudentEligibleOn)은 **묻지 않는다** — 지우는 행위엔 "없던 기록을 만든다"는 위험이
 *    없고, 오히려 자격이 끝난 뒤(반 이동 직후 등) 잘못 찍힌 기록을 못 지우게 막는 게 해롭다.
 *    행 결속은 RPC의 tenant+class+student+date 조건이 담당한다.
 */
export async function clearPresentAttendance(input: {
  classId: string;
  studentId: string;
  date: string;
}): Promise<{ ok: true; cleared: number } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.date)) return { ok: false, error: "잘못된 요청입니다(날짜)" };
  const { user, tenantId } = gate.access;
  if (!(await canWriteTenant(user.systemRole, "attendance"))) {
    return { ok: false, error: "출석 입력 권한이 없습니다" };
  }
  const today = kstToday();
  if (user.systemRole === "teacher" && !isWithinAttendanceEditWindow(input.date, today)) {
    return { ok: false, error: attendanceLockMessage(input.date, today) };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ecs_clear_present", {
    p_tenant: tenantId,
    p_actor: user.id,
    p_class: input.classId,
    p_student: input.studentId,
    p_date: input.date,
  });
  if (error) return { ok: false, error: `출석 취소에 실패했습니다: ${error.message}` };
  const res = (data ?? {}) as { cleared?: number; blocked?: string | null };
  if (res.blocked === "rich") {
    return {
      ok: false,
      error: "결석·지각이거나 출석부에서 사유·시수를 적어 둔 기록입니다 — 출석부에서 수정하세요",
    };
  }
  // 감사로그 — DB 트리거(0084a)는 service_role 호출이라 actor가 비어 있다. "누가 지웠는지"는 여기서 남긴다.
  if ((res.cleared ?? 0) > 0) {
    const { data: stu } = await admin
      .from("students")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("id", input.studentId)
      .maybeSingle();
    await logAction({
      action: "ecs_attendance_clear",
      targetType: "attendance",
      targetLabel: stu?.name ?? null,
      metadata: { classId: input.classId, date: input.date, rows: res.cleared },
    });
  }
  return { ok: true, cleared: res.cleared ?? 0 };
}

/**
 * `users.ui_prefs.ecs`의 키 몇 개를 **본인 계정**에 부분 저장 — ECS 보기 설정 공용 경로.
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스라 **`ecs` 키만 갈아끼우고 형제 키(onescreen·timetable)는 보존**한다.
 * ⚠️ 값이 `undefined`면 그 키를 **지운다** — 기본값은 저장하지 않아 빈 값이 쌓이지 않게.
 * ⚠️ 반 게이트(requireEcsClassAccess)가 아니라 **로그인만** 본다 — 내 계정의 표시 취향이라 반과 무관하다.
 * 🔴 병합 로직을 설정마다 복붙하지 말 것 — 두 벌이 되면 한쪽만 고쳐 형제 키를 날리는 사고가 난다.
 */
async function patchMyEcsPrefs(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const ns =
    raw.ecs && typeof raw.ecs === "object" && !Array.isArray(raw.ecs)
      ? { ...(raw.ecs as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete ns[key];
    else ns[key] = value;
  }

  const merged = { ...raw };
  if (Object.keys(ns).length === 0) delete merged.ecs;
  else merged.ecs = ns;

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: merged })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * ECS '글씨 크기'를 본인 계정에 저장 — `users.ui_prefs.ecs.fontSize`(원스크린과 같은 규약).
 * ⚠️ `revalidatePath` 없음: 크기는 클라 state가 즉시 반영하고 이 저장은 다음 방문용 영속화일 뿐이다.
 */
export async function setMyEcsFontSize(size: EcsFontSize): Promise<{ ok: boolean; error?: string }> {
  if (!(ECS_FONT_SIZES as readonly string[]).includes(size)) {
    return { ok: false, error: "잘못된 글씨 크기입니다" };
  }
  return patchMyEcsPrefs({ fontSize: size === DEFAULT_ECS_FONT_SIZE ? undefined : size });
}

/**
 * 자리(LAB·JJ) 교시 표시/숨김을 본인 계정에 저장 — `users.ui_prefs.ecs.showSpecialRooms`(기본 표시).
 *
 * ⚠️ 글씨 크기와 달리 **서버가 진실**이다 — 이 값이 그리드와 작성률(`계획 N/M교시`·랜딩 카드)을 함께
 *    정하므로, 저장 후 화면을 다시 그려야 숫자가 맞는다(호출부가 `router.refresh()`).
 */
export async function setMyEcsShowSpecialRooms(show: boolean): Promise<{ ok: boolean; error?: string }> {
  if (typeof show !== "boolean") return { ok: false, error: "잘못된 값입니다" };
  return patchMyEcsPrefs({
    showSpecialRooms: show === DEFAULT_ECS_SHOW_SPECIAL_ROOMS ? undefined : show,
  });
}
