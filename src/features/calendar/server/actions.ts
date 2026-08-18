"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { isEventColor } from "../types";

/**
 * 캘린더 쓰기 — 일정 등록·수정·삭제. 게이트는 화면과 같은 `canWriteTenant("calendar")`(사무실 full,
 * 강사·상담·회계는 readonly라 여기서 거절 — #77). 쓰기는 service_role 전용(RLS는 읽기만, 0218a).
 * ⚠️ admin은 RLS 우회 — 모든 쿼리에 tenant_id 명시([[#104]]).
 */

export type CalendarActionState = { ok?: true; error?: string; notice?: string } | undefined;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TITLE = 120;
const MAX_MEMO = 2000;
/** 한 일정 상한 — 1년을 넘는 구간은 오입력으로 본다(반복 일정은 별도 개념 — v1 범위 밖). */
const MAX_SPAN_DAYS = 366;

function spanDays(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

async function requireCalendarWriter() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "calendar"))) {
    return { error: "일정을 등록·수정할 권한이 없습니다" as const };
  }
  return { user };
}

/** 등록·수정 공용(id 있으면 수정) — 폼 필드: id?, title, startDate, endDate, startTime?, endTime?, color, memo. */
export async function saveCalendarEvent(
  _prev: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const gate = await requireCalendarWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const id = String(formData.get("id") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "일정 제목을 입력하세요" };
  if (title.length > MAX_TITLE) return { error: `제목은 ${MAX_TITLE}자까지입니다` };

  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim() || startDate;
  if (!YMD.test(startDate) || !YMD.test(endDate)) return { error: "날짜를 선택하세요" };
  if (endDate < startDate) return { error: "종료일이 시작일보다 앞섭니다" };
  if (spanDays(startDate, endDate) > MAX_SPAN_DAYS) {
    return { error: "한 일정은 최대 1년까지입니다 — 나눠서 등록하세요" };
  }

  // 시간은 선택 — 형식이 틀리면 조용히 버리지 않고 알린다(입력한 값이 사라지는 게 더 나쁘다).
  const startTimeRaw = String(formData.get("startTime") ?? "").trim();
  const endTimeRaw = String(formData.get("endTime") ?? "").trim();
  if (startTimeRaw && !HM.test(startTimeRaw)) return { error: "시작 시간 형식이 올바르지 않습니다(HH:MM)" };
  if (endTimeRaw && !HM.test(endTimeRaw)) return { error: "종료 시간 형식이 올바르지 않습니다(HH:MM)" };
  if (endTimeRaw && !startTimeRaw) return { error: "종료 시간만 있을 수 없습니다 — 시작 시간을 입력하세요" };
  if (startTimeRaw && endTimeRaw && startDate === endDate && endTimeRaw <= startTimeRaw) {
    return { error: "종료 시간이 시작 시간보다 빠릅니다" };
  }

  const colorRaw = String(formData.get("color") ?? "primary");
  const color = isEventColor(colorRaw) ? colorRaw : "primary";
  const memo = String(formData.get("memo") ?? "").trim().slice(0, MAX_MEMO) || null;

  const admin = createAdminClient();
  const row = {
    title,
    memo,
    start_date: startDate,
    end_date: endDate,
    start_time: startTimeRaw || null,
    end_time: endTimeRaw || null,
    color,
  };

  if (id) {
    const { data, error } = await admin
      .from("calendar_events")
      .update(row)
      .eq("id", id)
      .eq("tenant_id", user.tenantId)
      .select("id")
      .maybeSingle();
    if (error) return { error: `일정 수정 실패 — ${error.message}` };
    if (!data) return { error: "수정할 일정을 찾을 수 없습니다" };
  } else {
    const { error } = await admin.from("calendar_events").insert({
      ...row,
      tenant_id: user.tenantId,
      created_by: user.id,
    });
    if (error) {
      const missing = /does not exist|Could not find the table|PGRST205/i.test(error.message);
      return {
        error: missing
          ? "캘린더 표가 아직 준비되지 않았습니다(마이그레이션 0218a 적용 필요)"
          : `일정 등록 실패 — ${error.message}`,
      };
    }
  }

  await logAction({
    action: id ? "calendar_event_update" : "calendar_event_create",
    targetType: "calendar_event",
    targetLabel: `${title} (${startDate}${endDate !== startDate ? `~${endDate}` : ""})`,
  });
  revalidatePath("/calendar");
  return { ok: true, notice: id ? "일정을 수정했습니다" : "일정을 등록했습니다" };
}

export async function deleteCalendarEvent(
  _prev: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const gate = await requireCalendarWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "삭제할 일정을 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .select("title, start_date")
    .maybeSingle();
  if (error) return { error: `삭제 실패 — ${error.message}` };
  if (!data) return { error: "삭제할 일정을 찾을 수 없습니다" };

  await logAction({
    action: "calendar_event_delete",
    targetType: "calendar_event",
    targetLabel: `${data.title} (${data.start_date})`,
  });
  revalidatePath("/calendar");
  return { ok: true, notice: "일정을 삭제했습니다" };
}
