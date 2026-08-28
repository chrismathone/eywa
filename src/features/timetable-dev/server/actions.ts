"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { addMonths, hhmm, isPlanMonth, planMonthLabel, type PlanSlot, type PlanSlotInput } from "../types";
import {
  isClassSeedableInMonth,
  isScheduleLiveInMonth,
  planMonthWindow,
} from "../lib/month-window";
import {
  PLAN_SLOT_COLUMNS,
  dedupeLiveSchedules,
  normalizePlanSlotInput,
  toPlanSlot,
  type LiveScheduleRow,
  type PlanSlotRow,
} from "../lib/plan-row";
import { requireTimetablePlanAccess } from "./access";

/**
 * 시간표(개발중) 월별 계획 쓰기 — 전부 `requireTimetablePlanAccess({ write: true })` 뒤(#77).
 *
 * 🔴 **이 파일은 `class_schedules`에 절대 쓰지 않는다**(원장 지시 2026-08-28: *"시간표에는 적용하지말고
 *    시간표(개발중)이라는곳에서만"*). 원본은 시드에서 **읽기만** 한다 — 그 표는 출결·청구·급여·ECS 등
 *    73곳이 함께 읽는 운영 표라, 계획을 그쪽으로 미는 순간 이 기능의 격리가 무너진다(0231a 주석).
 *    "계획을 실제로 적용" 경로는 일부러 없다.
 *
 * 🔴 `timetable_plan_slots`는 RLS 정책 0개 + service_role 전용이라([[#104]]) admin 클라이언트로만 닿는다 →
 *    **모든 select/insert/update/delete에 `tenant_id` 명시 필터**(RLS 우회이므로 빠뜨리면 타 학원 침범).
 * ⚠️ 0231a는 `updated_at` 갱신 트리거를 만들지 않았다 → 쓰기마다 **직접 넣는다**(안 넣으면 월 목록의
 *    '마지막 수정'이 생성 시각에 굳는다).
 */

/** 칸을 몇 개 건드렸는지. 실패는 항상 한글 사유(UI에 raw 코드·에러 원문 노출 금지 규약). */
export type PlanMutationResult = { ok: true; count: number } | { ok: false; error: string };
/** 한 칸 저장 결과 — 저장된 칸을 그대로 돌려준다(화면이 재조회 없이 반영). */
export type PlanSlotResult = { ok: true; slot: PlanSlot } | { ok: false; error: string };

const PLAN_TABLE = "timetable_plan_slots";
/** 시드가 원본에서 읽는 컬럼(임베드 없음 — FK 힌트 함정 [[#94]]을 애초에 만들지 않는다). */
const LIVE_SCHEDULE_COLUMNS = `id, class_id, day_of_week, start_time, end_time, teacher_id,
   classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group,
   valid_from, valid_to`;
const INSERT_CHUNK = 500; // 한 문장이 지나치게 커지지 않게(414는 GET만이라 무관하나 타임아웃·메모리 방어)

type PlanInsertRow = {
  tenant_id: string;
  plan_month: string;
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  teacher_id: string | null;
  classroom_id: string | null;
  slot_teacher_label: string | null;
  slot_room_label: string | null;
  period_label: string | null;
  merge_group: string | null;
  source_schedule_id: string | null;
  updated_at: string;
};

/** 게이트(쓰기) 통과 + admin + 신뢰 tenantId. 실패는 그대로 액션 결과로 되돌린다(throw 안 함). */
async function planWriter(): Promise<
  { ok: true; admin: ReturnType<typeof createAdminClient>; tenantId: string } | { ok: false; error: string }
> {
  const gate = await requireTimetablePlanAccess({ write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  return { ok: true, admin: createAdminClient(), tenantId: gate.access.tenantId };
}

/** 그 달에 이미 칸이 있는지 — 행을 받지 않고 센다(B2). */
async function countMonth(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  month: string,
): Promise<number> {
  const { count, error } = await admin
    .from(PLAN_TABLE)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("plan_month", month);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function deleteMonth(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  month: string,
): Promise<number> {
  const { data, error } = await admin
    .from(PLAN_TABLE)
    .delete()
    .eq("tenant_id", tenantId)
    .eq("plan_month", month)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** 큰 배열을 나눠 INSERT(독립 문장이라 병렬 — B4). 실패 하나면 전체를 실패로 올린다(부분 반영을 숨기지 않는다). */
async function insertChunked(
  admin: ReturnType<typeof createAdminClient>,
  rows: PlanInsertRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const chunks: PlanInsertRow[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) chunks.push(rows.slice(i, i + INSERT_CHUNK));
  const results = await Promise.all(chunks.map((c) => admin.from(PLAN_TABLE).insert(c).select("id")));
  let inserted = 0;
  for (const r of results) {
    if (r.error) throw new Error(r.error.message);
    inserted += r.data?.length ?? 0;
  }
  return inserted;
}

/** 이미 계획이 있는 달에 덮어쓸지 — 기본은 **안전한 쪽**(거절). */
type OverwriteOpt = { overwrite?: boolean };

function guardMonth(month: string, label = "달"): string | null {
  return isPlanMonth(month) ? null : `${label} 형식이 올바르지 않습니다(예: 2026-09)`;
}

// ── ① 현재 시간표에서 그 달 계획 만들기 ────────────────────────────────────────

/**
 * 현재 `class_schedules`에서 **그 달에 유효한 슬롯을 복사**해 계획을 만든다(원본은 손대지 않는다).
 *
 * 유효 판정은 청구가 쓰는 것과 같은 규약 — `valid_from <= 말일 AND (valid_to is null OR valid_to >= 1일)`.
 * 경계 규칙은 순수 함수 [`isScheduleLiveInMonth`](../lib/month-window.ts) 한 곳에 있고, SQL 필터와 JS
 * 재확인이 **같은 창(`planMonthWindow`)**에서 나온다.
 *
 * **멱등**: 이미 그 달에 칸이 있으면 기본적으로 **거절**한다(덮어쓰면 사람이 손으로 고친 계획이 통째로
 * 날아간다 — 되돌릴 문이 없다). 다시 뜨려면 화면이 `overwrite: true`를 명시적으로 넘겨야 하고, 그 경우
 * 기존 달을 지우고 새로 넣는다(감사로그에 replaced 수가 남는다).
 */
export async function seedPlanFromLive(
  month: string,
  opts: OverwriteOpt = {},
): Promise<PlanMutationResult> {
  const bad = guardMonth(month);
  if (bad) return { ok: false, error: bad };
  const w = planMonthWindow(month);
  if (!w) return { ok: false, error: "달 형식이 올바르지 않습니다(예: 2026-09)" };

  const writer = await planWriter();
  if (!writer.ok) return writer;
  const { admin, tenantId } = writer;

  try {
    const existing = await countMonth(admin, tenantId, month);
    if (existing > 0 && !opts.overwrite) {
      return {
        ok: false,
        error: `${planMonthLabel(month)} 계획이 이미 있습니다(${existing}칸). 새로 뜨려면 기존 계획을 지우고 다시 만들어 주세요.`,
      };
    }

    // 반 목록과 원본 슬롯은 서로 의존하지 않는다 → 병렬(B4). 둘 다 페이지네이션(B2).
    // admin이라 RLS를 우회하므로 **양쪽 다 tenant_id 명시 필터**.
    const [classes, schedules] = await Promise.all([
      fetchAllPaged<{ id: string; is_active: boolean | null; closed_at: string | null }>((from, to) =>
        admin
          .from("classes")
          .select("id, is_active, closed_at")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      ),
      fetchAllPaged<LiveScheduleRow>((from, to) =>
        admin
          .from("class_schedules")
          // ⚠️ 단일 템플릿 리터럴 — `+`로 이으면 리터럴 타입이 풀려 반환이 GenericStringError가 된다.
          .select(LIVE_SCHEDULE_COLUMNS)
          .eq("tenant_id", tenantId)
          .lte("valid_from", w.last)
          .or(`valid_to.is.null,valid_to.gte.${w.first}`)
          .order("id")
          .range(from, to),
      ),
    ]);

    // 폐지·그 달 전에 종강한 반은 제외(본 시간표와 같은 규칙).
    const seedable = new Set(
      classes
        .filter((c) => isClassSeedableInMonth({ isActive: c.is_active, closedAt: c.closed_at }, month))
        .map((c) => c.id),
    );

    const live = schedules.filter(
      (s) =>
        seedable.has(s.class_id) &&
        // SQL이 이미 좁혔지만 같은 순수 규칙으로 한 번 더 — 경계 하루가 갈리지 않게(단일 소스 확인).
        isScheduleLiveInMonth({ validFrom: s.valid_from, validTo: s.valid_to }, month),
    );

    // 🔴 한 칸에 이력 두 줄이 겹칠 수 있다(#88) → 유니크 제약이 터지기 전에 최신 배치 한 줄만 남긴다.
    const rows: PlanInsertRow[] = dedupeLiveSchedules(live).map((s) => ({
      tenant_id: tenantId,
      plan_month: month,
      class_id: s.class_id,
      day_of_week: s.day_of_week,
      start_time: hhmm(s.start_time),
      end_time: hhmm(s.end_time),
      teacher_id: s.teacher_id ?? null,
      classroom_id: s.classroom_id ?? null,
      slot_teacher_label: s.slot_teacher_label ?? null,
      slot_room_label: s.slot_room_label ?? null,
      period_label: s.period_label ?? null,
      merge_group: s.merge_group ?? null,
      source_schedule_id: s.id, // 되짚기용 — 원본이 나중에 마감돼도 계획은 남는다(FK 없음)
      updated_at: new Date().toISOString(),
    }));

    if (rows.length === 0) {
      return { ok: false, error: `${planMonthLabel(month)}에 유효한 시간표 칸이 없습니다` };
    }

    // ⚠️ 지우고-넣기는 원자적이지 않다(트랜잭션 RPC가 0231a에 없다) — 중간에 실패하면 그 달이 비어 버린다.
    //    그래서 **넣을 것이 있는지 먼저 확인한 뒤에** 지운다(rows.length === 0 조기 반환이 바로 위에 있는 이유).
    //    남는 위험은 INSERT 자체의 실패뿐이고, 그때는 같은 버튼을 다시 눌러 복구된다(원본은 그대로다).
    const replaced = existing > 0 ? await deleteMonth(admin, tenantId, month) : 0;
    const inserted = await insertChunked(admin, rows);

    await logAction({
      action: "timetable_plan_seed",
      targetType: "timetable_plan",
      targetLabel: planMonthLabel(month),
      metadata: { month, inserted, replaced, source: "class_schedules" },
    });
    revalidatePath("/timetable-dev");
    return { ok: true, count: inserted };
  } catch (e) {
    return { ok: false, error: `계획을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── ② 달 복사(다음달·다다음달 만들기) ──────────────────────────────────────────

/**
 * 이미 만들어 둔 달을 다른 달로 통째 복사한다. 다음달·다다음달 만들기의 밑바닥.
 * 대상 달을 안 주면 `addMonths(from, 1)`(계약의 단일 소스 — 월 넘김을 화면마다 새로 짜지 않는다).
 * 멱등 규칙은 시드와 같다(대상에 칸이 있으면 기본 거절).
 *
 * `source_schedule_id`는 **그대로 옮긴다** — 계획→계획 복사라도 그 칸이 원래 어느 실제 슬롯에서 왔는지가
 * 되짚기의 유일한 실마리다(복사했다고 끊으면 3개월 뒤엔 출처를 알 수 없다).
 */
export async function copyPlanMonth(
  from: string,
  to: string = addMonths(from, 1),
  opts: OverwriteOpt = {},
): Promise<PlanMutationResult> {
  const badFrom = guardMonth(from, "복사할 달");
  if (badFrom) return { ok: false, error: badFrom };
  const badTo = guardMonth(to, "만들 달");
  if (badTo) return { ok: false, error: badTo };
  if (from === to) return { ok: false, error: "같은 달로는 복사할 수 없습니다" };

  const writer = await planWriter();
  if (!writer.ok) return writer;
  const { admin, tenantId } = writer;

  try {
    const [source, existing] = await Promise.all([
      fetchAllPaged<PlanSlotRow>((f, t) =>
        admin
          .from(PLAN_TABLE)
          .select(PLAN_SLOT_COLUMNS)
          .eq("tenant_id", tenantId)
          .eq("plan_month", from)
          .order("id")
          .range(f, t),
      ),
      countMonth(admin, tenantId, to),
    ]);

    if (source.length === 0) {
      return { ok: false, error: `${planMonthLabel(from)} 계획이 비어 있어 복사할 것이 없습니다` };
    }
    if (existing > 0 && !opts.overwrite) {
      return {
        ok: false,
        error: `${planMonthLabel(to)} 계획이 이미 있습니다(${existing}칸). 새로 만들려면 기존 계획을 지우고 다시 시도해 주세요.`,
      };
    }

    const now = new Date().toISOString();
    const rows: PlanInsertRow[] = source.map((s) => ({
      tenant_id: tenantId,
      plan_month: to,
      class_id: s.class_id,
      day_of_week: s.day_of_week,
      start_time: hhmm(s.start_time),
      end_time: hhmm(s.end_time),
      teacher_id: s.teacher_id ?? null,
      classroom_id: s.classroom_id ?? null,
      slot_teacher_label: s.slot_teacher_label ?? null,
      slot_room_label: s.slot_room_label ?? null,
      period_label: s.period_label ?? null,
      merge_group: s.merge_group ?? null,
      source_schedule_id: s.source_schedule_id ?? null,
      updated_at: now,
    }));

    const replaced = existing > 0 ? await deleteMonth(admin, tenantId, to) : 0;
    const inserted = await insertChunked(admin, rows);

    await logAction({
      action: "timetable_plan_copy",
      targetType: "timetable_plan",
      targetLabel: `${planMonthLabel(from)} → ${planMonthLabel(to)}`,
      metadata: { from, to, inserted, replaced },
    });
    revalidatePath("/timetable-dev");
    return { ok: true, count: inserted };
  } catch (e) {
    return { ok: false, error: `계획을 복사하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── ③ 달 삭제 ────────────────────────────────────────────────────────────────

/** 그 달 계획을 통째로 지운다(원본 시간표는 그대로). 감사로그에 지운 칸 수를 남긴다. */
export async function deletePlanMonth(month: string): Promise<PlanMutationResult> {
  const bad = guardMonth(month);
  if (bad) return { ok: false, error: bad };

  const writer = await planWriter();
  if (!writer.ok) return writer;
  const { admin, tenantId } = writer;

  try {
    const deleted = await deleteMonth(admin, tenantId, month);
    if (deleted === 0) return { ok: false, error: `${planMonthLabel(month)} 계획이 없습니다` };

    await logAction({
      action: "timetable_plan_month_delete",
      targetType: "timetable_plan",
      targetLabel: planMonthLabel(month),
      metadata: { month, deleted },
    });
    revalidatePath("/timetable-dev");
    return { ok: true, count: deleted };
  } catch (e) {
    return { ok: false, error: `계획을 지우지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ── ④ 칸 하나 저장 / 삭제 ─────────────────────────────────────────────────────

/**
 * 계획 칸 하나를 만들거나 고친다.
 * 앵커는 `(tenant, month, class, day, start)` — 같은 앵커면 갱신, 없으면 생성(0231a의 **온전한** 유니크
 * 제약이라 `on conflict` 추론이 된다. 부분 인덱스였다면 42P10으로 전건 실패했을 것 — [[#113]]).
 *
 * ⚠️ 시작시각을 옮기는 편집은 여기서 "다른 칸 생성"이 된다(앵커가 바뀌므로) — 화면이 옛 칸을
 *    `deletePlanSlot`으로 지워야 한다. 액션을 하나로 뭉치지 않은 이유는 이동/복제 의도를 서버가 못 가리기 때문.
 */
export async function upsertPlanSlot(month: string, input: PlanSlotInput): Promise<PlanSlotResult> {
  const bad = guardMonth(month);
  if (bad) return { ok: false, error: bad };
  const parsed = normalizePlanSlotInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;

  const writer = await planWriter();
  if (!writer.ok) return writer;
  const { admin, tenantId } = writer;

  try {
    // admin은 RLS를 우회하므로 **참조 대상이 내 학원 것인지 앱이 직접 확인**한다.
    // 반은 FK가 (tenant_id, class_id) 복합이라 DB도 막지만, 에러 원문 대신 한글 사유를 주려고 먼저 본다.
    // 강사·강의실 FK는 tenant를 안 보므로 이 확인이 **유일한 방어**다. 셋은 서로 독립 → 병렬(B4).
    const [cls, teacher, room] = await Promise.all([
      admin
        .from("classes")
        .select("id, class_name")
        .eq("tenant_id", tenantId)
        .eq("id", v.classId)
        .maybeSingle(),
      v.teacherId
        ? admin.from("users").select("id").eq("tenant_id", tenantId).eq("id", v.teacherId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      v.classroomId
        ? admin
            .from("classrooms")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("id", v.classroomId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (!cls.data) return { ok: false, error: "반을 찾을 수 없습니다" };
    if (v.teacherId && !teacher.data) return { ok: false, error: "강사를 찾을 수 없습니다" };
    if (v.classroomId && !room.data) return { ok: false, error: "강의실을 찾을 수 없습니다" };

    const { data, error } = await admin
      .from(PLAN_TABLE)
      .upsert(
        {
          tenant_id: tenantId,
          plan_month: month,
          class_id: v.classId,
          day_of_week: v.dayOfWeek,
          start_time: v.startTime,
          end_time: v.endTime,
          teacher_id: v.teacherId,
          classroom_id: v.classroomId,
          slot_teacher_label: v.slotTeacherLabel,
          slot_room_label: v.slotRoomLabel,
          period_label: v.periodLabel,
          merge_group: v.mergeGroup,
          source_schedule_id: v.sourceScheduleId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,plan_month,class_id,day_of_week,start_time" },
      )
      .select(PLAN_SLOT_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    const slot = data ? toPlanSlot(data as PlanSlotRow) : null;
    if (!slot) return { ok: false, error: "저장한 칸을 다시 읽지 못했습니다" };

    await logAction({
      action: "timetable_plan_slot_upsert",
      targetType: "timetable_plan_slot",
      targetLabel: `${planMonthLabel(month)} ${cls.data.class_name}`,
      metadata: {
        month,
        classId: v.classId,
        dayOfWeek: v.dayOfWeek,
        startTime: v.startTime,
        endTime: v.endTime,
      },
    });
    revalidatePath("/timetable-dev");
    return { ok: true, slot };
  } catch (e) {
    return { ok: false, error: `칸을 저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 계획 칸 하나를 지운다. 없는 id는 "지웠다"고 하지 않는다(0행이면 실패로 알린다). */
export async function deletePlanSlot(id: string): Promise<PlanMutationResult> {
  if (!id) return { ok: false, error: "칸 ID가 없습니다" };

  const writer = await planWriter();
  if (!writer.ok) return writer;
  const { admin, tenantId } = writer;

  try {
    const { data, error } = await admin
      .from(PLAN_TABLE)
      .delete()
      .eq("tenant_id", tenantId) // 🔴 admin = RLS 우회 — 이 줄이 타 학원 칸 삭제를 막는 유일한 방어
      .eq("id", id)
      .select("id, plan_month");
    if (error) throw new Error(error.message);
    const removed = data?.[0];
    if (!removed) return { ok: false, error: "칸을 찾을 수 없습니다" };

    await logAction({
      action: "timetable_plan_slot_delete",
      targetType: "timetable_plan_slot",
      targetLabel: planMonthLabel(removed.plan_month),
      metadata: { month: removed.plan_month, slotId: id },
    });
    revalidatePath("/timetable-dev");
    return { ok: true, count: 1 };
  } catch (e) {
    return { ok: false, error: `칸을 지우지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}
