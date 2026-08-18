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
import { ECS_TEACHER_ALL, normalizeEcsTeacher } from "../landing-teacher";
import {
  DEFAULT_ECS_ENGLISH_TRACK,
  DEFAULT_ECS_SHOW_SELF_STUDY,
  normalizeCollapsedRosterGroups,
} from "../view-prefs";
import { normalizeEnglishTrackFilter, type EnglishTrackFilter } from "@/features/classes/english-track";
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

/**
 * 내용 복사(`ecs_copy_slot`) — 원본은 **같은 교시(slot_start)의 지난 수업일**, 동작은 **빈 칸만 채우기**.
 *
 * 0183a는 "이 교시보다 앞선 것 중 가장 최근"이라 하루에 여러 교시를 하는 반에서 **같은 날 앞 교시**가
 * 원본으로 잡혔는데, 교시마다 교재가 달라(3교시 Vocab·4교시 Reading…) 엉뚱한 내용이 들어왔다. 0209a가
 * 원본을 같은 교시로 고정하고, 덮어쓰기 대신 **비어 있는 칸만** 채우게 바꿨다(원장 2026-08-14).
 * 학생 기록은 여전히 안 옮긴다.
 *
 * ⚠️ 마이그레이션이 아직 안 돌았으면 PostgREST가 "함수를 못 찾겠다"로 떨어진다([[#95]]). 그때도 **화면은
 *    안 죽고** 이 액션만 실패해야 하므로(호출부는 토스트) 사유를 한글로 바꿔서 돌려준다.
 *    0209a는 **시그니처를 안 바꿨다** — 적용 전이면 옛 동작(직전 교시·덮어쓰기 없음)으로 그냥 돌아간다.
 */
export async function copySlotFromPrevious(input: {
  classId: string;
  planDate: string;
  slotStart: string;
  termMode: "regular" | "exam";
}): Promise<
  | {
      ok: true;
      copied: number;
      /** 원본 날짜 "MM-DD"(같은 교시라 시각은 대상과 동일 — 라벨에 안 싣는다) */
      sourceLabel: string | null;
      /** 20줄 상한에 걸려 못 넣은 원본 줄 수(0209a 이전 함수는 안 돌려줘 0) */
      truncated: number;
      reason: string | null;
      lines: PlanLineDTO[];
    }
  | ActionError
> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.planDate) || !HHMM_RE.test(input.slotStart)) {
    return { ok: false, error: "잘못된 요청입니다(날짜/시각)" };
  }
  if (input.termMode !== "regular" && input.termMode !== "exam") {
    return { ok: false, error: "잘못된 요청입니다(시기)" };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ecs_copy_slot", {
    p_tenant: gate.access.tenantId,
    p_actor: gate.access.user.id,
    p_class: input.classId,
    p_plan_date: input.planDate,
    p_slot_start: input.slotStart,
    p_term_mode: input.termMode,
  });
  if (error) {
    // 스키마 미적용(배포가 SQL보다 앞선 구간) — raw 원문 대신 사람이 읽을 수 있는 안내로.
    if (/could not find|does not exist|schema cache/i.test(error.message)) {
      return { ok: false, error: "이 기능은 아직 준비 중입니다(DB 반영 대기)" };
    }
    return { ok: false, error: `내용 복사에 실패했습니다: ${error.message}` };
  }
  const r = (data ?? {}) as {
    copied?: number;
    truncated?: number;
    reason?: string;
    sourceDate?: string;
    sourceSlot?: string;
    lines?: Record<string, unknown>[];
  };
  return {
    ok: true,
    copied: r.copied ?? 0,
    // 같은 교시에서만 가져오므로 시각은 대상과 늘 같다 — 라벨엔 **날짜만**(붙이면 "08-11 19:20 교시"가
    // 되어 마치 다른 시각에서 온 것처럼 읽힌다). ⚠️ 0209a 적용 전 함수는 다른 시각을 돌려줄 수 있다.
    sourceLabel: r.sourceDate ? r.sourceDate.slice(5) : null,
    truncated: r.truncated ?? 0,
    reason: r.reason ?? null,
    lines: (r.lines ?? []).map(toLineDTO),
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

/**
 * 컬럼이 아직 없어서 난 오류인가 — 0202a(`score`)가 손으로 적용되기 **전에** 앱이 배포돼도
 * 태도·특이사항 저장이 함께 죽지 않게 하려는 판정이다(#95: 배포는 옛 스키마·새 스키마 둘 다에서 돌아야 한다).
 * PostgREST는 스키마 캐시에 없는 컬럼을 `PGRST204`로, Postgres는 `42703`으로 알린다.
 */
function isMissingColumn(err: { code?: string; message?: string } | null, column: string): boolean {
  if (!err) return false;
  if (err.code === "PGRST204" || err.code === "42703") return true;
  return (err.message ?? "").includes(column) && /column|컬럼/i.test(err.message ?? "");
}

/**
 * 마크 한 행의 **자유 입력 칸** — 입력 키 → DB 컬럼. 폼(기본 / JJ)마다 화면에 뜨는 칸이 다르다
 * ([roster-form.ts](../lib/roster-form.ts)).
 *
 * 🔴 **안 넘긴 칸은 건드리지 않는다.** 아래 upsert의 SET 목록에서 빠지므로 지금 값이 그대로 남는다.
 *    그래서 ① JJ 교시에서 듣기 레벨을 고쳐도 그 행의 시험 점수가 안 지워지고 ② 오늘 보드 팝오버
 *    (태도·특이사항만 보낸다)가 다른 칸을 null로 덮지 않는다 — 종전엔 `input.score ?? null`이라
 *    팝오버 저장 한 번에 시험 점수가 조용히 날아갔다(2026-08-13 발견, 실제 피해 0건: score 입력 0행).
 * ⚠️ 칸을 늘리면 여기와 `MARK_TEXT_LABEL`·DB 컬럼·roster-form을 **함께** 늘릴 것.
 */
const MARK_TEXT_COLUMNS = {
  score: "score",
  listeningLevel: "listening_level",
  memorizedWords: "memorized_words",
} as const;
type MarkTextKey = keyof typeof MARK_TEXT_COLUMNS;
/** 에러 문구에 쓰는 이름 — 화면 라벨과 같은 말(raw 컬럼명 노출 금지). */
const MARK_TEXT_LABEL: Record<MarkTextKey, string> = {
  score: "시험 점수",
  listeningLevel: "듣기 레벨",
  memorizedWords: "누적 암기 단어수",
};
const MARK_TEXT_MAXLEN = 30;
const ALL_MARK_TEXT_COLUMNS = Object.values(MARK_TEXT_COLUMNS);

/**
 * 선택 컬럼이 **아직 없어도** 죽지 않게 — 컬럼 부재면 그 컬럼을 빼고 다시 시도한다(#95 expand/contract).
 * ⚠️ PostgREST는 어느 컬럼이 없는지 이름으로 알려주지 않는다(PGRST204) — 그래서 앞에서부터 하나씩 빼며
 *    재시도한다. 한 마이그레이션의 컬럼들은 함께 없거나 함께 있어서 실사용에선 곧바로 수렴한다.
 */
async function runDroppingMissingColumns(
  columns: readonly string[],
  run: (cols: readonly string[]) => PromiseLike<{ error: { code?: string; message?: string } | null }>,
): Promise<{ error: { code?: string; message?: string } | null; dropped: string[] }> {
  let cols = [...columns];
  const dropped: string[] = [];
  for (;;) {
    const { error } = await run(cols);
    if (!error) return { error: null, dropped };
    const missing = cols.find((c) => isMissingColumn(error, c));
    if (!missing) return { error, dropped };
    cols = cols.filter((c) => c !== missing);
    dropped.push(missing);
  }
}

export async function upsertStudentMark(input: {
  classId: string;
  studentId: string;
  markDate: string;
  slotStart: string;
  status: string | null;
  progressNote: string | null;
  /** 시험 점수(0202a) — 자유 입력. `18/20`·`95`처럼 형식이 제각각이라 숫자로 안 굳힌다. */
  score?: string | null;
  /** 듣기 레벨(0206a) — JJ 교시 전용 폼(원장 2026-08-13). 자유 입력. */
  listeningLevel?: string | null;
  /** 누적 암기 단어수(0206a) — JJ 교시 전용 폼. 자유 입력(숫자로 안 굳힌다). */
  memorizedWords?: string | null;
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

  // 넘어온 칸만 담는다(undefined = 이 호출은 그 칸을 안 건드린다).
  const text: Record<string, string | null> = {};
  for (const key of Object.keys(MARK_TEXT_COLUMNS) as MarkTextKey[]) {
    const raw = input[key];
    if (raw === undefined) continue;
    const value = normalizePlanText(raw);
    if ((value?.length ?? 0) > MARK_TEXT_MAXLEN) {
      return { ok: false, error: `${MARK_TEXT_LABEL[key]}은(는) ${MARK_TEXT_MAXLEN}자 이내로 입력하세요` };
    }
    text[MARK_TEXT_COLUMNS[key]] = value;
  }
  // 이 호출이 아는 값이 전부 비었나 — 그렇다고 곧장 지우진 않는다(안 넘긴 칸에 값이 남아 있을 수 있다).
  const looksEmpty =
    status === null && progressNote === null && Object.values(text).every((v) => v === null);

  const admin = createAdminClient();
  const { tenantId, user } = gate.access;

  // mark_date 기준 실수강·등원요일 검증 — 비eligible(historical) 학생 행은 읽기 전용(§F).
  // ⚠️ **비우는 방향은 예외**(기존 규약) — 잘못 찍힌 기록은 수강이 끝난 뒤에도 지울 수 있어야 한다.
  if (!looksEmpty) {
    const elig = await checkStudentEligibleOn(admin, tenantId, input.classId, input.studentId, input.markDate);
    if (!elig.ok) return elig;
  }

  const base = {
    tenant_id: tenantId,
    class_id: input.classId,
    student_id: input.studentId,
    mark_date: input.markDate,
    slot_start: input.slotStart,
    status,
    progress_note: progressNote,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const onConflict = "tenant_id,class_id,student_id,mark_date,slot_start";
  const { error, dropped } = await runDroppingMissingColumns(Object.keys(text), (cols) =>
    admin
      .from("class_sheet_student_marks")
      .upsert({ ...base, ...Object.fromEntries(cols.map((c) => [c, text[c]])) }, { onConflict }),
  );
  if (error) return { ok: false, error: `저장에 실패했습니다: ${error.message}` };
  // 🔴 마이그레이션 미적용 — 그 칸만 못 담을 뿐 태도·특이사항은 예전처럼 저장된다(#95). 대신 값을 실제로
  //    **입력한 경우엔 조용히 버리지 않고** 아직 준비 전임을 그대로 말한다(화면은 롤백된다).
  const lostKey = (Object.keys(MARK_TEXT_COLUMNS) as MarkTextKey[]).find(
    (k) => dropped.includes(MARK_TEXT_COLUMNS[k]) && text[MARK_TEXT_COLUMNS[k]] != null,
  );
  if (lostKey) {
    return { ok: false, error: `'${MARK_TEXT_LABEL[lostKey]}' 칸은 아직 준비 중입니다(관리자에게 문의하세요)` };
  }

  if (looksEmpty) {
    // 빈 행은 남기지 않는다 — 마크가 남으면 그 학생이 명단(로스터 합집합)과 자리 각주 건수에 계속 잡힌다.
    // 🔴 단 **정말로 다 비었을 때만** 지운다: 이 호출이 안 넘긴 칸(다른 폼의 값)이 남아 있으면 조건이
    //    안 맞아 0행이 지워지고 행은 값과 함께 그대로 산다.
    // 청소가 실패해도 사용자에게 알리지 않는다 — 값은 위에서 이미 비워졌고 남는 건 빈 행뿐이다.
    await runDroppingMissingColumns(ALL_MARK_TEXT_COLUMNS, (cols) => {
      let q = admin
        .from("class_sheet_student_marks")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("class_id", input.classId)
        .eq("student_id", input.studentId)
        .eq("mark_date", input.markDate)
        .eq("slot_start", input.slotStart)
        .is("status", null)
        .is("progress_note", null);
      for (const c of cols) q = q.is(c, null);
      return q;
    });
  }
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
  if (eligible) return { ok: true };
  // 보강(수업외) — 수강행은 없지만 그날 출결이 있으면 태도·특이사항도 같은 칸에 쓴다.
  const { count, error: attErr } = await admin
    .from("attendance_records")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .eq("session_date", date);
  if (attErr) return { ok: false, error: `수강 확인에 실패했습니다: ${attErr.message}` };
  if ((count ?? 0) > 0) return { ok: true };
  return { ok: false, error: "그 날짜에 이 반을 수강하지 않는 학생입니다(기록 행은 읽기 전용)" };
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
  /**
   * 그 날의 유닛 자동값(ECS가 출결 생성 시 넣는 값) — 0187a. 저장된 시수가 **기본 1이거나 이 값과 같을
   * 때만** 삭제된다. 안 넘기면 0169a와 동일(기본 1만). 사람이 다른 값으로 고친 기록은 여전히 거절.
   */
  autoUnits?: number | null;
  /**
   * 지울 **교시**(0196a·0197a). null = 옛 "그날 전체" 행(slot_start null)만 — 다른 교시는 안 지운다.
   * ⚠️ 화면이 보여주던 그 행의 실제 값을 그대로 넘겨야 한다(칸의 교시가 아니라). 옛 기록은 첫 교시
   *    칸에 붙어 보이지만 DB 값은 null이라, 칸의 교시를 넘기면 아무것도 안 지워진다.
   */
  slot?: string | null;
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
  const base = {
    p_tenant: tenantId,
    p_actor: user.id,
    p_class: input.classId,
    p_student: input.studentId,
    p_date: input.date,
    // 0187a — ECS가 넣은 자동값 그대로인 시수는 '손 안 댄 기록'으로 보고 취소를 허용한다.
    p_auto_units: input.autoUnits ?? null,
  };
  // 0197a — 그 교시만. null이면 '그날 전체' 행(옛 기록)만 지운다(`is not distinct from`).
  // ⚠️ **옛 스키마에서도 돌아야 한다**([[#95]]): SQL은 사람이 손으로 돌리므로 앱이 먼저 뜰 수 있다.
  //    0197a 적용 전이면 p_slot을 받는 함수가 없어 PostgREST가 PGRST202("함수를 못 찾음")를 낸다 →
  //    그때만 옛 시그니처로 한 번 더 부른다(그 시점 DB엔 교시별 행이 없으니 결과가 같다).
  let { data, error } = await admin.rpc("ecs_clear_present", { ...base, p_slot: input.slot ?? null });
  if (error && /PGRST202|Could not find the function|does not exist/i.test(error.message ?? "")) {
    ({ data, error } = await admin.rpc("ecs_clear_present", base));
  }
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
 * **JJ** 교시 표시/숨김을 본인 계정에 저장 — `users.ui_prefs.ecs.showSpecialRooms`(기본 표시).
 * (저장 키가 옛 이름 그대로인 이유는 [`view-prefs.ts`](../view-prefs.ts) `SELF_STUDY_PREF_KEY` 주석 참조.)
 *
 * ⚠️ 글씨 크기와 달리 **서버가 진실**이다 — 이 값이 그리드와 작성률(`계획 N/M교시`·랜딩 카드)을 함께
 *    정하므로, 저장 후 화면을 다시 그려야 숫자가 맞는다(호출부가 `router.refresh()`).
 * ⚠️ LAB은 이 액션으로 못 켠다(항상 제외 — `hiddenSeatOf`). 되살리는 스위치를 여기 추가하지 말 것.
 */
export async function setMyEcsShowSelfStudy(show: boolean): Promise<{ ok: boolean; error?: string }> {
  if (typeof show !== "boolean") return { ok: false, error: "잘못된 값입니다" };
  return patchMyEcsPrefs({
    showSpecialRooms: show === DEFAULT_ECS_SHOW_SELF_STUDY ? undefined : show,
  });
}

/**
 * 로스터 섹션 접힘(학생 목록·퇴원생 목록)을 본인 계정에 저장 — `users.ui_prefs.ecs.collapsedRosterGroups`.
 *
 * ⚠️ 글씨 크기와 같은 부류다(**클라가 진실**) — 접기는 표시만 바꾸고 작성률·일괄 대상은 안 건드리므로
 *    호출부가 즉시 반영하고 이 저장은 다음 방문용 영속화일 뿐이다(`router.refresh()` 불필요).
 */
export async function setMyEcsCollapsedRosterGroups(
  groups: string[],
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeCollapsedRosterGroups(groups);
  return patchMyEcsPrefs({ collapsedRosterGroups: normalized.length === 0 ? undefined : normalized });
}

/**
 * 랜딩의 프로그램 보기 필터(전체/EiE/인재원 영어)를 본인 계정에 저장 — `users.ui_prefs.ecs.englishTrack`(0176a).
 *
 * ⚠️ 자리(LAB·JJ) 토글과 달리 **작성률 분모를 안 바꾼다** — 목록을 눈으로 좁혀 보는 용도라 각 카드의
 *    `N/M교시`는 그 반 값 그대로다. 그래도 목록 자체가 서버 계산이라 저장 후 화면은 다시 그린다.
 */
export async function setMyEcsEnglishTrack(
  filter: EnglishTrackFilter,
): Promise<{ ok: boolean; error?: string }> {
  if (normalizeEnglishTrackFilter(filter) !== filter) return { ok: false, error: "잘못된 값입니다" };
  return patchMyEcsPrefs({
    englishTrack: filter === DEFAULT_ECS_ENGLISH_TRACK ? undefined : filter,
  });
}

/**
 * 랜딩의 **담임 보기 필터**를 본인 계정에 저장 — `users.ui_prefs.ecs.teacher`(2026-08-11).
 *
 * ⚠️ 프로그램 필터와 같은 부류다(**서버가 목록을 좁혀 내려준다**) → 호출부가 저장 후 `router.refresh()`.
 * ⚠️ 여기선 **모양만** 검증한다(`all`·`none`·uuid). "그 담임이 이 주에 반이 있나"는 저장 시점이 아니라
 *    **읽는 시점**의 질문이라 `getSheetLanding`이 판정한다 — 저장을 그때 막으면 다음 주에 돌아올 필터를
 *    지금 못 고르게 하는 셈이다.
 */
export async function setMyEcsTeacher(value: string): Promise<{ ok: boolean; error?: string }> {
  if (normalizeEcsTeacher(value) !== value) return { ok: false, error: "잘못된 값입니다" };
  return patchMyEcsPrefs({ teacher: value === ECS_TEACHER_ALL ? undefined : value });
}
