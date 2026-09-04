"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { movedEndTime, toMinutes } from "../lib/class-move";

/**
 * 반 배치(한 칸)를 **다른 요일·교시로 옮긴다** — 시간표에서 반 이름 머리를 끌어 놓았을 때의 저장 경로.
 *
 * 🔴 **덮어쓰지 않고 갈아 끼운다**(0087a 구조 가져오기·`planSlotArchives`와 같은 temporal 규약):
 *    옛 행은 `valid_to = 적용일 − 1`로 **마감**하고 새 행을 `valid_from = 적용일`로 넣는다. 그래야
 *    **이미 찍힌 출결이 고아가 되지 않는다** — 출결은 `attendance_records.slot_start`로 그 시각에 매달려
 *    있어서([[#126]]), 행을 제자리에서 고치면 지난 기록이 사라진 교시를 가리킨다.
 * 🔴 **적용일 이후에 이미 찍힌 출결이 있으면 거절**한다 — 그 기록은 옛 시각에 매달려 있는데 그날부터
 *    배치가 바뀌면 고아가 된다. 사람이 그 기록을 먼저 정리해야 한다(조용히 옮기지 않는다).
 * 🔴 **길이는 유지**한다(`movedEndTime`) — 목적지 교시가 40분이어도 60분 수업은 60분이다(시수·급여).
 * 🔴 게이트는 `canManageTenant("classes")` — `canWriteTenant`는 scoped 강사도 통과한다(page.tsx와 같은 게이트, #77).
 */
export type MoveClassSlotResult = { ok: true; newSlotId: string } | { ok: false; error: string };

export async function moveClassSlot(input: {
  slotId: string;
  toDay: string;
  /** `HH:MM(:SS)` — 목적지 교시의 시작시각. 끝시각은 원래 길이로 계산한다. */
  toStart: string;
  /** 적용일(YYYY-MM-DD). 미지정 = 오늘(KST). 과거는 거절한다(소급하면 지난 출결이 어긋난다). */
  effectiveDate?: string;
}): Promise<MoveClassSlotResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes"))) {
    return { ok: false, error: "시간표를 편집할 권한이 없습니다" };
  }
  const today = kstToday();
  const effective = (input.effectiveDate ?? today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) return { ok: false, error: "적용일이 올바르지 않습니다" };
  if (effective < today) {
    return { ok: false, error: "지난 날짜로는 옮길 수 없습니다 — 오늘 이후로 정해 주세요" };
  }

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("class_schedules")
    .select(
      "id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group",
    )
    .eq("id", input.slotId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: "배치를 읽지 못했습니다. 잠시 후 다시 시도해 주세요" };
  if (!row) return { ok: false, error: "옮길 배치를 찾지 못했습니다(이미 바뀌었을 수 있습니다)" };
  if (row.valid_to && String(row.valid_to).slice(0, 10) < effective) {
    return { ok: false, error: "이미 끝난 배치입니다 — 화면을 새로 고친 뒤 다시 시도해 주세요" };
  }

  const fromStart = String(row.start_time);
  const toStart = input.toStart.length === 5 ? `${input.toStart}:00` : input.toStart;
  const toEnd = movedEndTime({ startTime: fromStart, endTime: String(row.end_time) }, toStart);
  if (toMinutes(toEnd) <= toMinutes(toStart)) {
    return { ok: false, error: "수업 길이를 계산하지 못했습니다" };
  }
  if (row.day_of_week === input.toDay && fromStart.slice(0, 5) === toStart.slice(0, 5)) {
    return { ok: false, error: "같은 자리입니다" };
  }

  // 🔴 적용일 이후 그 칸으로 이미 찍힌 출결 — 옮기면 그 기록이 사라진 교시에 매달린다([[#126]]).
  const { count: stuck, error: attErr } = await admin
    .from("attendance_records")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("class_id", row.class_id)
    .gte("date", effective)
    .eq("slot_start", fromStart);
  if (attErr) return { ok: false, error: "출결 기록을 확인하지 못해 중단했습니다" };
  if ((stuck ?? 0) > 0) {
    return {
      ok: false,
      error: `적용일 이후에 이 교시로 찍힌 출결이 ${stuck}건 있습니다 — 그 기록을 먼저 정리한 뒤 옮겨 주세요`,
    };
  }

  // 감사로그에 적을 반 이름(없어도 저장은 진행 — 로그는 본 작업을 막지 않는다).
  const { data: klass } = await admin
    .from("classes")
    .select("class_name")
    .eq("id", row.class_id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const className = klass?.class_name ?? null;

  const validFrom = row.valid_from ? String(row.valid_from).slice(0, 10) : null;
  // 새 행 — 라벨·강사·강의실·묶음은 그대로 승계한다(폼이 안 보내는 값을 잃지 않는 `preserveScheduleFields`와 같은 결).
  const insert = {
    tenant_id: row.tenant_id,
    class_id: row.class_id,
    day_of_week: input.toDay,
    start_time: toStart,
    end_time: toEnd,
    valid_from: effective,
    valid_to: row.valid_to,
    teacher_id: row.teacher_id,
    classroom_id: row.classroom_id,
    slot_teacher_label: row.slot_teacher_label,
    slot_room_label: row.slot_room_label,
    // 교시 이름은 시각을 따라가지 못하므로 버린다(옛 `3교시` 라벨이 새 시각에 남으면 거짓이 된다).
    period_label: null,
    merge_group: row.merge_group,
  };
  const { data: created, error: insErr } = await admin
    .from("class_schedules")
    .insert(insert)
    .select("id")
    .single();
  if (insErr || !created) return { ok: false, error: "새 배치를 넣지 못했습니다. 잠시 후 다시 시도해 주세요" };

  // 옛 행 — 적용일 전에 시작했으면 **마감**, 적용일에 시작했으면(=아직 하루도 안 산 행) 지운다.
  const cutoff = shiftDay(effective, -1);
  const closing =
    validFrom && validFrom < effective
      ? admin.from("class_schedules").update({ valid_to: cutoff }).eq("id", row.id).eq("tenant_id", user.tenantId)
      : admin.from("class_schedules").delete().eq("id", row.id).eq("tenant_id", user.tenantId);
  const { error: closeErr } = await closing;
  if (closeErr) {
    // 새 행만 남으면 같은 칸이 두 번 그려진다 — 되돌린다(트랜잭션이 없어 best-effort, updateClass와 같은 방식).
    await admin.from("class_schedules").delete().eq("id", created.id).eq("tenant_id", user.tenantId);
    return { ok: false, error: "옛 배치를 마감하지 못해 되돌렸습니다. 잠시 후 다시 시도해 주세요" };
  }

  await logAction({
    action: "class_schedule_move",
    targetType: "class",
    targetLabel: className ?? undefined,
    metadata: {
      classId: row.class_id,
      slotId: row.id,
      newSlotId: created.id,
      from: { day: row.day_of_week, start: fromStart, end: String(row.end_time) },
      to: { day: input.toDay, start: toStart, end: toEnd },
      effectiveDate: effective,
    },
  });
  revalidatePath("/timetable");
  return { ok: true, newSlotId: created.id };
}

/** `YYYY-MM-DD` ± 일수(UTC 결정적 — KST 날짜 문자열 산술의 앱 관례). */
function shiftDay(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + delta);
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
