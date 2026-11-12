"use server";

import { makeupAnchorDeleteBlock } from "@/features/attendance/server/makeup-anchor-cells";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
// ECS 서버 액션 — 전부 requireEcsClassAccess(write) 공용 게이트(#77) 뒤. class_sheet_*는 deny-RLS라
// admin client(service_role)로만 접근하되, **모든 select/update가 tenant_id + class_id + id 3중 조건**
// (게이트한 반과 변경 행의 결속 — 계획 v2.2 §A). 구조 변경(create/move/delete/copy)은 0157a RPC 위임
// (슬롯 advisory xact 락·재번호 원자성). 출석은 체크(ecs_mark_present_if_absent) + 취소(ecs_clear_present,
// 0169a — plain present만) 두 경로뿐. 결석·지각·시수 편집은 여전히 /attendance 전용(§E 완화판).
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";
// ui_prefs 부분 병합은 **단일 구현**(화면마다 복붙하면 형제 키를 날린다 — CLAUDE.md).
import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { attendanceWindowApplies } from "@/features/attendance/server/edit-window-gate";
import { autoUnitsKey } from "@/features/attendance/auto-units";
import { resolveAutoUnits } from "@/features/attendance/server/auto-units";
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
  DEFAULT_ECS_MONTH_DISPLAY,
  DEFAULT_ECS_MONTH_PERIOD,
  DEFAULT_ECS_MONTH_VIEW,
  DEFAULT_ECS_SHOW_SELF_STUDY,
  normalizeCollapsedRosterGroups,
  normalizeEcsMonthPeriod,
  normalizeEcsMonthView,
  type EcsMonthDisplay,
  type EcsMonthView,
} from "../view-prefs";
import { normalizeEnglishTrackFilter, type EnglishTrackFilter } from "@/features/classes/english-track";
import { normalizePlanText, SKILL_AREA_SLUG_RE } from "../lib/plan-codec";
// 메모 위치키 규약은 칸 편집 감사로그와 **한 벌**(lib/edit-audit.ts) — 저장이 받는 키와 기록이 받는 키가 갈리지 않게.
import { MEMO_KEY_RE } from "../lib/edit-audit";
import { isGoalAreaAllowed } from "../lib/goal-areas";
import { dowKeyOf, HHMM_RE, normalizePeriodStart, YMD_RE } from "../lib/week";
import { requireEcsClassAccess } from "./access";
import { hasReservedMakeup } from "@/features/attendance/server/makeup-reservation-queries";
import { hasSplitInto } from "./split-week";
import { mappedMakeupDeleteBlock, nativeWriteAllowance } from "@/features/makeups/server/adapters/gates";
// 계획 줄 쓰기의 밑바닥 — 공개 자리 PIN 경로도 **같은 함수**를 부른다(문만 다르고 규칙은 한 벌).
import {
  applyPlanPatches,
  copyPlanSlotFromPrevious,
  insertPlanLine,
  relocatePlanLine,
  removePlanLine,
  type PlanCopyResult,
  type PlanLinesResult,
  type PlanPatchesResult,
  type PlanWriteGrant,
} from "./plan-write";
import { mergeTodayOrder, normalizeTodayOrder } from "../today-order";
import { readEcsLandingOrder, readEcsTodayOrder } from "../view-prefs";
import { readonlyTeacherViewError, viewAsTeacher } from "@/lib/auth/view-mode";

type ActionError = { ok: false; error: string };

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

// ── 계획 줄 쓰기 = **문(게이트)만** 여기, 밑바닥은 plan-write.ts ─────────────────
//
// 🔑 실제 구현(줄 번호·시기·CAS 기대값·복사 후 canonical)은 [`plan-write.ts`](./plan-write.ts) 한 벌이다.
//    아래 액션들은 `requireEcsClassAccess(write)`를 지나 `PlanWriteGrant`로 바꿔 넘기는 껍데기일 뿐.
//    같은 표에 들어오는 **다른 문**(비로그인 자리 PIN 화면 `/seat/jj` — 게이트는 PIN 쿠키 + 그날 그 교시
//    명단)도 자기 게이트를 지난 뒤 **같은 밑바닥**을 부른다. 규칙이 두 벌이 되면 같은 표를 서로 다르게 쓴다.

function planGrantOf(access: { tenantId: string; classId: string; user: { id: string } }): PlanWriteGrant {
  return { tenantId: access.tenantId, classId: access.classId, actorId: access.user.id };
}

/** 계획 행 필드 patch 배치(필드 단위 CAS) — 구현·규약은 `applyPlanPatches`. */
export async function flushSheetPatches(
  classId: string,
  rawPatches: unknown,
): Promise<PlanPatchesResult> {
  const gate = await requireEcsClassAccess(classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  return applyPlanPatches(planGrantOf(gate.access), rawPatches);
}

export async function createPlanLine(input: {
  classId: string;
  planDate: string;
  slotStart: string;
  termMode: "regular" | "exam";
  skillArea: string;
}): Promise<PlanLinesResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  return insertPlanLine(planGrantOf(gate.access), input);
}

export async function movePlanLine(input: {
  classId: string;
  lineId: string;
  termMode: "regular" | "exam";
  lineNo: number;
}): Promise<PlanLinesResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  return relocatePlanLine(planGrantOf(gate.access), input);
}

export async function deletePlanLine(input: {
  classId: string;
  lineId: string;
}): Promise<PlanLinesResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  return removePlanLine(planGrantOf(gate.access), input);
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
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.copyWeekFromPrevious", fallback: "지난주 복사에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const r = (data ?? {}) as { copied?: number; goalsCopied?: number; skippedSlots?: string[]; unmapped?: string[] };
  // 감사로그 — admin RPC라 행에 남는 흔적이 없다. 한 번 누름 = 한 줄 요약(교시 복사 `ecs_plan_copy`와 같은 결),
  // 실제로 채운 것이 있을 때만(아무것도 안 옮겨졌으면 변동이 아니다).
  if ((r.copied ?? 0) > 0 || (r.goalsCopied ?? 0) > 0) {
    await logAction({
      action: "ecs_week_copy",
      targetType: "class_sheet",
      targetLabel: gate.access.className,
      metadata: {
        classId: input.classId,
        fromMonday: from,
        weekStart: to,
        copied: r.copied ?? 0,
        goalsCopied: r.goalsCopied ?? 0,
        skippedSlots: r.skippedSlots?.length ?? 0,
        unmapped: r.unmapped?.length ?? 0,
      },
    });
  }
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
}): Promise<PlanCopyResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  return copyPlanSlotFromPrevious(planGrantOf(gate.access), input);
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
  if (!SKILL_AREA_SLUG_RE.test(input.skillArea)) return { ok: false, error: "잘못된 요청입니다(영역)" };
  // 🔴 모양만이 아니라 **이 반의 목표 행**인가(#77) — 화면이 그리는 목록과 같은 함수(EiE = 달력 칸,
  //    그 외 = 학원설정 영역). 모양만 보면 EiE 반에 `vocab`이, 인재원 반에 `in_class`가 주소만으로 들어간다.
  if (!isGoalAreaAllowed(gate.access.englishTrack, gate.access.skillAreas, input.skillArea)) {
    return { ok: false, error: "이 반의 목표 항목이 아닙니다(반 구분이 바뀌었으면 새로고침하세요)" };
  }
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
    if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.upsertGoal", fallback: "저장에 실패했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };
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
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.upsertGoal", fallback: "저장에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
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
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.upsertStudentMark", fallback: "저장에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
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

/**
 * 주간 메모 저장(LWW) — 타이핑 디바운스마다 불린다.
 * 🔴 여기서 감사로그를 남기지 않는다(목표·학생 기록도 같다) — 칸을 떠날 때 한 줄은 `commitSheetEdits`의 몫이다
 *    (원장 결정 2026-09-14). 여기서 남기면 한 번 적는 메모가 수십 줄이 된다.
 */
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
    if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.saveMemo", fallback: "저장에 실패했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };
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
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.saveMemo", fallback: "저장에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

/**
 * 교시 체크 'Shouting' 저장(0230a) — **EiE 반 전용**.
 *
 * 원장 지시(2026-08-27): *"EiE는 샤우팅 체크박스로 변경 · 각 반이 샤우팅 했는지 체크"*,
 * *"인재원 영어는 샤우팅 그냥 삭제"*. 그래서 서버도 **EiE가 아니면 거절**한다 — 화면 조건은 게이트가
 * 아니고([[#77]]), 인재원 영어 반에 체크가 쌓이면 나중에 집계가 거짓이 된다.
 *
 * 저장은 체크(true)일 때만 행을 만들고 **해제하면 행을 지운다**(메모와 같은 규약) — "없음 = 안 함"이라
 * false 행을 남길 이유가 없다.
 * ⚠️ 0230a 적용 전에는 표가 없어 실패한다 — 그 사실을 **한글로 말한다**(조용한 무저장 금지).
 */
export async function setSlotShouting(input: {
  classId: string;
  date: string;
  slotStart: string;
  value: boolean;
}): Promise<{ ok: true } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.access.englishTrack !== "eie") {
    return { ok: false, error: "Shouting 체크는 EiE 반에서만 사용합니다" };
  }
  if (!YMD_RE.test(input.date) || !HHMM_RE.test(input.slotStart)) {
    return { ok: false, error: "잘못된 요청입니다(날짜·교시)" };
  }

  const admin = createAdminClient();
  const { tenantId, user } = gate.access;
  // 표가 아직 없을 때(마이그레이션 0230a 미적용) PostgREST 원문을 그대로 띄우지 않는다 — 화면에 영문
  // 기술 원문을 내보내지 않는 규칙. 원인을 한글로 말하고 무엇을 해야 하는지 알린다.
  const saveError = (e: { code?: string; message: string }) =>
    e.code === "42P01" || e.code === "PGRST205"
      ? "Shouting 체크 기능이 아직 준비되지 않았습니다(DB 갱신 필요) — 관리자에게 알려주세요"
      : explainDbError(e, { scope: "class-sheets.shouting", fallback: "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." }).message;
  if (!input.value) {
    const { data: removed, error } = await admin
      .from("class_sheet_slot_flags")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("flag_date", input.date)
      .eq("slot_start", input.slotStart)
      .select("id");
    if (error) return { ok: false, error: saveError(error) };
    // 감사로그 — 실제로 지운 행이 있을 때만(이미 해제된 칸을 다시 보낸 것은 변동이 아니다).
    if ((removed ?? []).length > 0) logShoutingToggle(gate.access, input, false);
    return { ok: true };
  }
  // 이미 체크된 칸인가 — 감사로그의 "변동" 판정용(쓰기는 종전 그대로 upsert). 조회가 실패하면 **남기는 쪽**으로
  // 기운다(변동을 놓치는 것보다 한 줄 더 남는 게 낫다).
  const { data: existed } = await admin
    .from("class_sheet_slot_flags")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("class_id", input.classId)
    .eq("flag_date", input.date)
    .eq("slot_start", input.slotStart)
    .maybeSingle();
  const { error } = await admin.from("class_sheet_slot_flags").upsert(
    {
      tenant_id: tenantId,
      class_id: input.classId,
      flag_date: input.date,
      slot_start: input.slotStart,
      shouting: true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    // ⚠️ 유니크가 **부분 인덱스가 아니라서** 이 추론이 성립한다([[#113]]).
    { onConflict: "tenant_id,class_id,flag_date,slot_start" },
  );
  if (error) return { ok: false, error: saveError(error) };
  if (!existed) logShoutingToggle(gate.access, input, true);
  return { ok: true };
}

/**
 * Shouting 체크 감사로그 — 누름 한 번이 곧 결심이라 **저장 액션이 직접** 한 줄 남긴다(칸 글쓰기처럼 칸을
 * 떠날 때 모으지 않는다). 주간 시트에선 LWW 디바운스가 연타를 마지막 값으로 접는다.
 * 응답을 붙잡지 않게 `after`로 미룬다(클라의 서버 액션 호출은 순차라 기록이 다음 저장을 밀면 안 된다).
 */
function logShoutingToggle(
  access: { classId: string; className: string },
  input: { date: string; slotStart: string },
  checked: boolean,
): void {
  after(() =>
    logAction({
      action: "ecs_shouting_toggle",
      targetType: "class_sheet",
      targetLabel: access.className,
      metadata: { classId: access.classId, date: input.date, slotStart: input.slotStart.slice(0, 5), checked },
    }),
  );
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
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.checkStudentEligibleOn", fallback: "수강 확인에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
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
  if (attErr) return { ok: false, error: explainDbError(attErr, { scope: "class-sheets.actions.checkStudentEligibleOn", fallback: "수강 확인에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if ((count ?? 0) > 0) return { ok: true };
  // 보강 **예약**(0264a)된 학생 — 출결이 아직 없어도 그날 이 반에 오기로 한 사람(오늘 보드가 미리 세운다). 출결 게이트와 같은 문.
  if (await hasReservedMakeup(tenantId, { studentId, classId, date })) return { ok: true };
  // 수업 나누기(0351a)로 그날 이 반에 오는 학생 — 수강행 없이 그 시간 출결·태도를 이 반에서 받는다(조회 실패 = 불허).
  if (await hasSplitInto(classId, studentId, date)) return { ok: true };
  const native = await nativeWriteAllowance({ studentId, classId, sessionDate: date });
  if (native.error) return { ok: false, error: native.error };
  if (native.allow) return { ok: true };
  return { ok: false, error: "그 날짜에 이 반을 수강하지 않는 학생입니다(기록 행은 읽기 전용)" };
}

/**
 * 보강(수업외) 명단에서 뺀다 — '+ 보강 학생 추가'의 반대.
 * 수강생 출결을 지우면 안 되므로 **그날 실수강이면 거절**한다(출석 폴백 없는 수강 판정).
 * 출결·시트 태도 기록을 함께 지워야 다음 조회에 행이 안 남는다(마크만 있으면 '기록' 섹션).
 */
export async function removeMakeupAttendee(input: {
  classId: string;
  studentId: string;
  date: string;
}): Promise<{ ok: true } | ActionError> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.date) || !input.studentId) return { ok: false, error: "잘못된 요청입니다" };
  const { user, tenantId } = gate.access;
  if (!(await canWriteTenant(user.systemRole, "attendance"))) {
    return { ok: false, error: "출석 입력 권한이 없습니다" };
  }
  if ((await attendanceWindowApplies(user.systemRole)) && !isWithinAttendanceEditWindow(input.date, kstToday())) {
    return { ok: false, error: attendanceLockMessage(input.date, kstToday()) };
  }

  const admin = createAdminClient();
  const { data: enrs, error: enrErr } = await admin
    .from("enrollments")
    .select("start_date, end_date, on_hold, is_transferred, attendance_days, students!inner(withdrawn_at)")
    .eq("tenant_id", tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId);
  if (enrErr) return { ok: false, error: explainDbError(enrErr, { scope: "class-sheets.actions.removeMakeupAttendee", fallback: "수강 확인에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const dow = dowKeyOf(input.date);
  const enrolled = (enrs ?? []).some((e) => {
    const withdrawnAt = (e.students as unknown as { withdrawn_at: string | null } | null)?.withdrawn_at ?? null;
    if (withdrawnAt && withdrawnAt < input.date) return false;
    if (
      !isEnrollmentActiveOn(
        {
          startDate: e.start_date as string,
          endDate: (e.end_date as string | null) ?? null,
          onHold: e.on_hold as boolean,
          isTransferred: (e.is_transferred as boolean | null) ?? undefined,
        },
        input.date,
      )
    ) {
      return false;
    }
    return enrollmentAttendsOnDay(e.attendance_days as string[] | null, dow);
  });
  if (enrolled) {
    return { ok: false, error: "이 반 수강생입니다 — 보강 명단에서 빼는 대상이 아닙니다" };
  }

  const { count, error: attErr } = await admin
    .from("attendance_records")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .eq("session_date", input.date);
  if (attErr) return { ok: false, error: explainDbError(attErr, { scope: "class-sheets.actions.removeMakeupAttendee", fallback: "출결 확인에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if ((count ?? 0) === 0) return { ok: false, error: "보강 출결 기록이 없습니다" };
  // 🔴 보강 보고서가 가리키는 반(앵커)의 칸은 여기서 빼지 않는다(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 원스크린 '보강 빼기'가
  //    보고서와 칸을 함께 지운다. 여기서 칸만 지우면 보고서는 이 반을 가리키는데 출석부엔 칸이 없다.
  const anchoredBlock = await makeupAnchorDeleteBlock(tenantId, [{ studentId: input.studentId, classId: input.classId, date: input.date }]);
  if (anchoredBlock) return { ok: false, error: anchoredBlock };
  const mappedBlock = await mappedMakeupDeleteBlock({ studentId: input.studentId, classId: input.classId, date: input.date });
  if (mappedBlock) return { ok: false, error: mappedBlock };

  const { error: delAtt } = await admin
    .from("attendance_records")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .eq("session_date", input.date);
  if (delAtt) return { ok: false, error: `보강을 빼지 못했습니다: ${delAtt.message}` };

  const { error: delMarks } = await admin
    .from("class_sheet_student_marks")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .eq("mark_date", input.date);
  if (delMarks) return { ok: false, error: `보강을 뺐지만 태도 기록이 남았습니다: ${delMarks.message}` };

  // 감사로그 — 기록을 지우는 동작이라 누가 뺐는지가 유일한 근거다(원스크린 '보강 빼기'와 같은 키 · 보고서는 안 지운다).
  // 학생 이름은 뷰어가 metadata.studentId로 풀어 '대상' 열에 보여준다(조회 0회).
  await logAction({
    action: "makeup_remove",
    targetType: "student",
    metadata: {
      studentId: input.studentId,
      classId: input.classId,
      date: input.date,
      attendanceRemoved: true,
      attendanceRows: count ?? 0,
      via: "ecs",
    },
  });

  revalidatePath("/ecs");
  revalidatePath("/attendance");
  revalidatePath("/onescreen");
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
  if ((await attendanceWindowApplies(user.systemRole)) && !isWithinAttendanceEditWindow(input.date, today)) {
    return { ok: false, error: attendanceLockMessage(input.date, today) };
  }
  const admin = createAdminClient();
  // 학생-반-날짜 결속 — 화면(entry.eligible)은 게이트가 아니다. 잘못 만든 행은 시수·정산에도 들어간다
  // (취소는 clearPresentAttendance로 가능해졌지만, 그건 '내가 방금 찍은 것'을 되돌리는 경로다).
  // 감사로그 판정용 count — RPC는 (지점·반·학생·날짜)에 기록이 없을 때만 넣는다. 같은 조건으로 먼저 세어 둔다(자격 확인과 함께).
  const [elig, { count: before }] = await Promise.all([
    checkStudentEligibleOn(admin, tenantId, input.classId, input.studentId, input.date),
    admin
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("student_id", input.studentId)
      .eq("session_date", input.date),
  ]);
  if (!elig.ok) return elig;
  const { data, error } = await admin.rpc("ecs_mark_present_if_absent", {
    p_tenant: tenantId,
    p_actor: user.id,
    p_class: input.classId,
    p_student: input.studentId,
    p_date: input.date,
  });
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.markPresentIfAbsent", fallback: "출석 저장에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const rows = (data ?? []) as { status: string; recorded_at: string; id: string; recorded_by?: string | null }[];
  // 감사로그 — DB 트리거(0084a)는 service_role 호출이라 actor가 비어 있다. "누가 찍었는지"는 여기서 남긴다.
  // RPC는 기록이 없을 때만 넣으므로(있으면 no-op) **이번에 새로 만든 때만**: 부르기 전엔 0행 → 지금 내 것 하나.
  //    (세지 못했으면 null — 남기지 않는다. 사이에 다른 사람이 먼저 넣었으면 그 행은 내 것이 아니라 걸러진다.)
  const only = rows.length === 1 ? rows[0] : null;
  if (before === 0 && only && only.recorded_by === user.id) {
    await logAction({
      action: "ecs_attendance_mark",
      targetType: "attendance",
      metadata: { classId: input.classId, studentId: input.studentId, date: input.date, status: only.status },
    });
  }
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
   * 옛 교시 미지정 기록의 일별 자동값(0187a). 교시를 지정하면 클라이언트 값 대신 서버가 자동 시수를 조회한다.
   * 저장된 시수가 기본 1이거나 자동값과 같을 때만 삭제된다. 다른 수동값은 여전히 거절한다.
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
  if ((await attendanceWindowApplies(user.systemRole)) && !isWithinAttendanceEditWindow(input.date, today)) {
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
    p_auto_units: input.slot
      ? (await resolveAutoUnits(admin, [{ classId: input.classId, date: input.date, slotStart: input.slot }], { tenantId }))
        .get(autoUnitsKey(input.classId, input.date, input.slot)) ?? null
      : input.autoUnits ?? null,
  };
  // 0197a — 그 교시만. null이면 '그날 전체' 행(옛 기록)만 지운다(`is not distinct from`).
  // ⚠️ **옛 스키마에서도 돌아야 한다**([[#95]]): SQL은 사람이 손으로 돌리므로 앱이 먼저 뜰 수 있다.
  //    0197a 적용 전이면 p_slot을 받는 함수가 없어 PostgREST가 PGRST202("함수를 못 찾음")를 낸다 →
  //    그때만 옛 시그니처로 한 번 더 부른다(그 시점 DB엔 교시별 행이 없으니 결과가 같다).
  let { data, error } = await admin.rpc("ecs_clear_present", { ...base, p_slot: input.slot ?? null });
  if (error && /PGRST202|Could not find the function|does not exist/i.test(error.message ?? "")) {
    ({ data, error } = await admin.rpc("ecs_clear_present", base));
  }
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.clearPresentAttendance", fallback: "출석 취소에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
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
  return patchMyUiPrefs("ecs", patch);
}

/**
 * '다른 강사 뷰'(전체 포함)의 반 순서 저장 거절 문구 — 화면은 그 뷰에서 손잡이를 아예 안 만든다(ecs/page.tsx
 * `canReorder = viewAs === null`). 서버도 같은 판정으로 막는다(2026-11-05 강사뷰 신원 점검):
 * 순서는 화면 주인(그 강사)의 반 목록에 묶인 값이라 읽기는 그 강사 것인데(today.ts·queries.ts `orderOwner`),
 * 저장(`patchMyUiPrefs`)은 실제 계정에 간다 — 열어 두면 그 강사의 순서를 바탕으로 만든 목록이 **보는 사람의 순서를 덮었다**.
 */
const OTHER_TEACHER_ORDER_ERROR = "다른 선생님 화면의 반 순서는 그 선생님 계정에서만 바꿀 수 있습니다";

/**
 * 오늘 면 **반 순서**를 본인 계정에 저장 — `users.ui_prefs.ecs.todayOrder`(원장 2026-09-05 드래그&드롭).
 *
 * 인자는 **오늘 화면에 보이는 반의 새 순서**다. 저장 전에 오늘 안 보인 옛 저장분을 뒤에 붙여
 * 다른 날의 순서를 지우지 않는다([`mergeTodayOrder`](../today-order.ts) — 규약·정규화 단일 소스).
 * ⚠️ `revalidatePath` 없음: 순서는 클라 state가 즉시 반영하고 이 저장은 **다음 방문용 영속화**다
 *    (글씨 크기와 같은 규약 — 새로고침을 강요하면 끌자마자 화면이 깜빡인다).
 */
export async function setMyEcsTodayOrder(visibleOrder: string[]): Promise<{ ok: boolean; error?: string }> {
  // 🔴 **화면에서만 잠그지 않는다**([[#77]]) — '다른 강사 뷰'는 손잡이를 안 그리지만, 액션은 여전히
  //    부를 수 있다. 그 뷰는 열람 전용이라 여기서도 거절한다(원장 2026-09-05).
  const readonlyErr = await readonlyTeacherViewError();
  if (readonlyErr) return { ok: false, error: readonlyErr };
  if (await viewAsTeacher()) return { ok: false, error: OTHER_TEACHER_ORDER_ERROR };
  const next = normalizeTodayOrder(visibleOrder);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("ui_prefs").eq("id", user.id).maybeSingle();
  const saved = readEcsTodayOrder(data?.ui_prefs);
  const merged = mergeTodayOrder(saved, next);
  return patchMyEcsPrefs({ todayOrder: merged.length > 0 ? merged : undefined });
}

/**
 * 주간 랜딩 목록의 **반 순서**를 본인 계정에 저장 — `users.ui_prefs.ecs.landingOrder`(2026-09-05).
 * 인자는 **끌어서 바꾼 그 묶음의 새 순서**이고, 나머지(다른 묶음·다른 주에만 뜨는 반)는 서버가 뒤에 붙인다.
 * 🔴 오늘 면(`todayOrder`)과 다른 키 — 이유는 [`view-prefs`](../view-prefs.ts) `readEcsLandingOrder` 주석.
 */
export async function setMyEcsLandingOrder(visibleOrder: string[]): Promise<{ ok: boolean; error?: string }> {
  // 🔴 **화면에서만 잠그지 않는다**([[#77]]) — '다른 강사 뷰'는 손잡이를 안 그리지만, 액션은 여전히
  //    부를 수 있다. 그 뷰는 열람 전용이라 여기서도 거절한다(원장 2026-09-05).
  const readonlyErr = await readonlyTeacherViewError();
  if (readonlyErr) return { ok: false, error: readonlyErr };
  if (await viewAsTeacher()) return { ok: false, error: OTHER_TEACHER_ORDER_ERROR };
  const next = normalizeTodayOrder(visibleOrder);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("ui_prefs").eq("id", user.id).maybeSingle();
  const merged = mergeTodayOrder(readEcsLandingOrder(data?.ui_prefs), next);
  return patchMyEcsPrefs({ landingOrder: merged.length > 0 ? merged : undefined });
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

/**
 * 월간 뷰의 **보기**(달력/진도표)를 본인 계정에 저장 — `users.ui_prefs.ecs.monthView`(2026-08-31).
 *
 * ⚠️ 글씨 크기와 같은 부류다(**클라가 진실**) — 두 보기는 같은 자료를 다르게 그린 것뿐이라 전환에
 *    재조회가 없다. 이 저장은 다음 방문용 영속화일 뿐이라 `router.refresh()`가 필요 없다.
 */
export async function setMyEcsMonthView(view: string): Promise<{ ok: boolean; error?: string }> {
  if (normalizeEcsMonthView(view) !== view) return { ok: false, error: "잘못된 값입니다" };
  return patchMyEcsPrefs({ monthView: view === DEFAULT_ECS_MONTH_VIEW ? undefined : view });
}

/**
 * EiE 월간 계획서의 **기간 축**(달력월 / 세션)을 계정에 저장 — `users.ui_prefs.ecs.monthPeriod`.
 * ⚠️ 표시 렌즈라 게이트가 필요 없다(자기 계정의 보기 설정만 바꾼다). 기본값과 같으면 키를 지운다.
 */
export async function setMyEcsMonthPeriod(period: string): Promise<{ ok: boolean; error?: string }> {
  const safe = normalizeEcsMonthPeriod(period);
  if (!safe) return { ok: false, error: "잘못된 값입니다" };
  return patchMyEcsPrefs({ monthPeriod: safe === DEFAULT_ECS_MONTH_PERIOD ? undefined : safe });
}

/**
 * 월간 뷰의 **표시 토글**(과제·자리 교시)을 보기별로 저장 — `users.ui_prefs.ecs.monthDisplay.{cal,rail}`.
 *
 * ⚠️ 보기마다 따로 담는 이유는 [`view-prefs.ts`](../view-prefs.ts) `DEFAULT_ECS_MONTH_DISPLAY` 주석 참조
 *    (한 벌로 묶으면 한쪽에서 켠 것이 다른 쪽을 망친다).
 * ⚠️ 기본값과 같으면 키를 지운다 — 나중에 기본값을 바꿨을 때 옛 계정만 옛 기본에 묶이지 않게.
 */
export async function setMyEcsMonthDisplay(
  view: string,
  display: EcsMonthDisplay,
): Promise<{ ok: boolean; error?: string }> {
  if (normalizeEcsMonthView(view) !== view) return { ok: false, error: "잘못된 값입니다" };
  if (
    typeof display?.homework !== "boolean" ||
    typeof display?.seat !== "boolean" ||
    typeof display?.actual !== "boolean"
  ) {
    return { ok: false, error: "잘못된 값입니다" };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("ui_prefs").eq("id", user.id).maybeSingle();
  const prefs = (data?.ui_prefs ?? {}) as Record<string, unknown>;
  const ecs = { ...((prefs.ecs as Record<string, unknown>) ?? {}) };
  const stored = { ...((ecs.monthDisplay as Record<string, unknown>) ?? {}) };
  const fallback = DEFAULT_ECS_MONTH_DISPLAY[view as EcsMonthView];
  // ⚠️ **세 칸을 다** 비교한다 — 하나라도 빠뜨리면 그 칸만 기본값과 달라진 계정에서 저장이 조용히 지워진다.
  if (
    display.homework === fallback.homework &&
    display.seat === fallback.seat &&
    display.actual === fallback.actual
  ) {
    delete stored[view];
  } else stored[view] = display;
  // ecs 안의 monthDisplay 키만 고친다 — ecs의 다른 키·다른 화면은 DB가 보존한다(남은 키가 없으면 ecs도 지운다).
  const { error } = await writeUiPrefsNs(
    admin,
    { userId: user.id, tenantId: user.tenantId },
    "ecs",
    Object.keys(stored).length === 0 ? { unset: ["monthDisplay"] } : { set: { monthDisplay: stored } },
  );
  if (error) return { ok: false, error: explainDbError(error, { scope: "class-sheets.actions.setMyEcsMonthDisplay", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}
