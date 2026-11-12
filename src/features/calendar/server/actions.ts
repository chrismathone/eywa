"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { normalizeCalendarColor } from "../color";
import { googleEventKey } from "../google-import";
import type { CalendarEvent } from "../types";
import { getCalendarEventById } from "./queries";
import { logDbError, explainDbError } from "@/lib/supabase/db-error";

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
/** 한 일정 상한 — 1년을 넘는 구간은 오입력으로 본다(반복도 종료일이 1년 이내). */
const MAX_SPAN_DAYS = 366;

function spanDays(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

// ── 반복 전개(0222a) — 등록 시점 실체화: 규칙을 저장하지 않고 행 N개를 series_id로 묶는다 ──────
const REPEAT_KINDS = ["none", "daily", "weekly", "biweekly", "monthly"] as const;
type RepeatKind = (typeof REPEAT_KINDS)[number];
/** 반복 상한 — 매일×2달이면 60회. 넘으면 오입력으로 보고 거절(행 폭탄 방지). */
const MAX_OCCURRENCES = 60;

/**
 * 반복 시작일 목록(첫 회 포함, until 이하). 매월은 같은 날 — 그 날이 없는 달(29~31일)은
 * 건너뛴다(끝날로 당기면 "매월 31일" 의도가 30일로 변질). 상한 초과 = 한글 에러.
 */
function expandRepeatStarts(
  startDate: string,
  repeat: RepeatKind,
  until: string,
): string[] | { error: string } {
  const starts: string[] = [startDate];
  if (repeat === "none") return starts;
  const overflow = { error: "반복 횟수가 너무 많습니다(최대 60회) — 종료일을 당기세요" };

  if (repeat === "monthly") {
    const [y, m, d] = startDate.split("-").map(Number);
    // until이 1년 이내로 이미 검증됨 — 13개월이면 전부 덮는다.
    for (let k = 1; k <= 13; k += 1) {
      const dt = new Date(Date.UTC(y!, m! - 1 + k, d!));
      if (dt.getUTCDate() !== d) continue; // 그 날이 없는 달 — 건너뜀
      const ymd = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
        dt.getUTCDate(),
      ).padStart(2, "0")}`;
      if (ymd > until) break;
      starts.push(ymd);
      if (starts.length > MAX_OCCURRENCES) return overflow;
    }
    return starts;
  }

  const step = repeat === "daily" ? 1 : repeat === "weekly" ? 7 : 14;
  for (let k = 1; ; k += 1) {
    const ymd = addDaysYmd(startDate, step * k);
    if (ymd > until) break;
    starts.push(ymd);
    if (starts.length > MAX_OCCURRENCES) return overflow;
  }
  return starts;
}

async function requireCalendarWriter() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "calendar"))) {
    return { error: "일정을 등록·수정할 권한이 없습니다" as const };
  }
  return { user };
}

/**
 * 일정 한 건 불러오기(목록·연간 보기에서 행을 눌러 다이얼로그를 열 때, 2026-09-23 전수 점검 N9).
 * 목록 전건에 메모까지 실어 보내지 않으려고 누른 한 건만 읽는다. 게이트 = 캘린더 **열람**(화면과 같은
 * `calendar` 메뉴 — 쓰기 여부는 다이얼로그가 따로 받는다). 원문 오류는 화면에 안 내보낸다.
 */
export async function loadCalendarEvent(
  id: string,
): Promise<{ event: CalendarEvent } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "calendar"))) return { error: "일정을 볼 권한이 없습니다" };
  if (!id || typeof id !== "string") return { error: "일정을 찾을 수 없습니다" };
  try {
    const event = await getCalendarEventById(id);
    return event ? { event } : { error: "일정을 찾을 수 없습니다 — 이미 삭제되었을 수 있습니다" };
  } catch {
    return { error: "일정을 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  }
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
  const color = normalizeCalendarColor(colorRaw);
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

  // 태그(0224a) — 폼에 tagId 필드가 **있을 때만** 반영(#95: 0224a 전 배포의 폼은 태그 목록이
  // 비어 필드 자체를 안 그린다 → tag_id 키를 안 보내 옛 스키마에서도 저장이 산다).
  let tagPatch: { tag_id: string | null } | null = null;
  if (formData.has("tagId")) {
    const tagId = String(formData.get("tagId") ?? "").trim();
    if (tagId) {
      const { data: tagRow, error: tagErr } = await admin
        .from("calendar_tags")
        .select("id")
        .eq("id", tagId)
        .eq("tenant_id", user.tenantId)
        .maybeSingle();
      if (tagErr || !tagRow) {
        logDbError(tagErr, "calendar.saveCalendarEvent");
        return { error: "태그를 찾을 수 없습니다 — 새로고침 후 다시 시도하세요" };
      }
      tagPatch = { tag_id: tagId };
    } else {
      tagPatch = { tag_id: null }; // "태그 없음"으로 해제
    }
  }

  // 반복(생성 전용 — 수정에선 무시: 회차 하나를 고치는 것뿐, 시리즈는 안 건드린다).
  const repeatRaw = String(formData.get("repeat") ?? "none");
  const repeat: RepeatKind = (REPEAT_KINDS as readonly string[]).includes(repeatRaw)
    ? (repeatRaw as RepeatKind)
    : "none";
  let starts: string[] = [startDate];
  if (!id && repeat !== "none") {
    const until = String(formData.get("repeatUntil") ?? "").trim();
    if (!YMD.test(until)) return { error: "반복 종료일을 선택하세요" };
    if (until <= startDate) return { error: "반복 종료일은 시작일 이후여야 합니다" };
    if (spanDays(startDate, until) > MAX_SPAN_DAYS) {
      return { error: "반복은 최대 1년까지입니다 — 종료일을 당기세요" };
    }
    const expanded = expandRepeatStarts(startDate, repeat, until);
    if (!Array.isArray(expanded)) return expanded;
    starts = expanded;
  }
  const repeated = starts.length > 1;

  if (id) {
    const { data, error } = await admin
      .from("calendar_events")
      .update({ ...row, ...(tagPatch ?? {}) })
      .eq("id", id)
      .eq("tenant_id", user.tenantId)
      .select("id")
      .maybeSingle();
    if (error) return { error: explainDbError(error, { scope: "calendar.actions.saveCalendarEvent", fallback: "일정 수정 실패 — 잠시 후 다시 시도해 주세요" }).message };
    if (!data) return { error: "수정할 일정을 찾을 수 없습니다" };
  } else if (repeated) {
    // 반복 = 실체화(0222a) — 회차 전부를 한 번에 insert, series_id 공통.
    const seriesId = crypto.randomUUID();
    const span = spanDays(startDate, endDate);
    const { error } = await admin.from("calendar_events").insert(
      starts.map((s) => ({
        ...row,
        ...(tagPatch ?? {}),
        start_date: s,
        end_date: addDaysYmd(s, span - 1),
        series_id: seriesId,
        tenant_id: user.tenantId,
        created_by: user.id,
      })),
    );
    if (error) {
      if (/series_id/i.test(error.message)) {
        // #95 — 컬럼이 아직 없다(앱이 먼저 배포됨). 단발 등록은 그대로 되니 반복만 안내.
        return { error: "반복 일정은 DB 마이그레이션(0222a) 적용 후 사용할 수 있습니다" };
      }
      const missing = /does not exist|Could not find the table|PGRST205/i.test(error.message);
      return {
        error: missing
          ? "캘린더 표가 아직 준비되지 않았습니다(마이그레이션 0218a 적용 필요)"
          : `일정 등록 실패 — ${error.message}`,
      };
    }
  } else {
    // 단발 — series_id 키를 아예 안 보낸다(0222a 적용 전 배포에서도 등록이 살아야, #95).
    const { error } = await admin.from("calendar_events").insert({
      ...row,
      ...(tagPatch ?? {}),
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
    targetLabel: `${title} (${startDate}${endDate !== startDate ? `~${endDate}` : ""})${
      repeated ? ` ×${starts.length}회` : ""
    }`,
  });
  revalidatePath("/calendar");
  return {
    ok: true,
    notice: id
      ? "일정을 수정했습니다"
      : repeated
        ? `반복 일정 ${starts.length}건을 등록했습니다`
        : "일정을 등록했습니다",
  };
}

/** 지운 행 중 구글에서 온 것의 묘비 키 — 손으로 만든 일정(구글 id 없음)은 빠진다. */
function googleKeysOf(
  rows: { google_calendar_id?: string | null; google_event_id?: string | null }[],
): string[] {
  return rows
    .filter((r) => r.google_calendar_id && r.google_event_id)
    .map((r) => googleEventKey(r.google_calendar_id as string, r.google_event_id as string));
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

  // 반복 전체 삭제 — 같은 시리즈(0222a) 회차 일괄. admin은 RLS 우회라 tenant 필터 필수([[#104]]).
  const scope = String(formData.get("scope") ?? "one");
  const seriesId = String(formData.get("seriesId") ?? "").trim();
  if (scope === "series") {
    if (!seriesId) return { error: "반복 일정 정보를 찾을 수 없습니다" };
    const { data, error } = await admin
      .from("calendar_events")
      .delete()
      .eq("tenant_id", user.tenantId)
      .eq("series_id", seriesId)
      .select("id, title, google_calendar_id, google_event_id");
    if (error) return { error: explainDbError(error, { scope: "calendar.actions.deleteCalendarEvent", fallback: "삭제 실패 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };
    if (!data || data.length === 0) return { error: "삭제할 반복 일정을 찾을 수 없습니다" };

    const keys = googleKeysOf(data);
    await logAction({
      action: "calendar_event_delete",
      targetType: "calendar_event",
      targetLabel: `${data[0]!.title} — 반복 전체 ${data.length}건`,
      ...(keys.length > 0 ? { metadata: { googleEventKeys: keys } } : {}),
    });
    revalidatePath("/calendar");
    return { ok: true, notice: `반복 일정 ${data.length}건을 삭제했습니다` };
  }

  const { data, error } = await admin
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .select("title, start_date, google_calendar_id, google_event_id")
    .maybeSingle();
  if (error) return { error: explainDbError(error, { scope: "calendar.actions.deleteCalendarEvent", fallback: "삭제 실패 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };
  if (!data) return { error: "삭제할 일정을 찾을 수 없습니다" };

  const keys = googleKeysOf([data]);
  await logAction({
    action: "calendar_event_delete",
    targetType: "calendar_event",
    targetLabel: `${data.title} (${data.start_date})`,
    // 구글에서 온 일정이면 묘비 키를 남긴다 — 임포트 크론이 이 키를 보고 다시 넣지 않는다(F15).
    ...(keys.length > 0 ? { metadata: { googleEventKeys: keys } } : {}),
  });
  revalidatePath("/calendar");
  return { ok: true, notice: "일정을 삭제했습니다" };
}

// ── 태그 CRUD(0224a) — 태그는 테넌트 사전, 색은 태그에 한 번만(표시 규칙 = eventDisplayColor) ────
const MAX_TAG_NAME = 30;

/** 태그 등록·수정(id 있으면 수정) — 폼 필드: id?, name, color. */
export async function saveCalendarTag(
  _prev: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const gate = await requireCalendarWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const id = String(formData.get("id") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "태그 이름을 입력하세요" };
  if (name.length > MAX_TAG_NAME) return { error: `태그 이름은 ${MAX_TAG_NAME}자까지입니다` };
  const colorRaw = String(formData.get("color") ?? "primary");
  const color = normalizeCalendarColor(colorRaw);

  const admin = createAdminClient();
  let failure: { message: string } | null = null;
  if (id) {
    const { data, error } = await admin
      .from("calendar_tags")
      .update({ name, color })
      .eq("id", id)
      .eq("tenant_id", user.tenantId)
      .select("id")
      .maybeSingle();
    if (!error && !data) return { error: "수정할 태그를 찾을 수 없습니다" };
    failure = error;
  } else {
    const { error } = await admin
      .from("calendar_tags")
      .insert({ tenant_id: user.tenantId, name, color });
    failure = error;
  }
  if (failure) {
    if (/calendar_tags_name_unique|duplicate key/i.test(failure.message)) {
      return { error: "같은 이름의 태그가 이미 있습니다" };
    }
    if (/does not exist|Could not find the table|PGRST205/i.test(failure.message)) {
      return { error: "태그 표가 아직 준비되지 않았습니다(마이그레이션 0224a 적용 필요)" };
    }
    return { error: `태그 저장 실패 — ${failure.message}` };
  }

  await logAction({
    action: id ? "calendar_tag_update" : "calendar_tag_create",
    targetType: "calendar_tag",
    targetLabel: `${name} (${color})`,
  });
  revalidatePath("/calendar");
  return { ok: true, notice: id ? "태그를 수정했습니다" : "태그를 추가했습니다" };
}

/** 태그 삭제 — 일정은 남고 tag_id만 해제된다(FK on delete set null, 0224a). */
export async function deleteCalendarTag(
  _prev: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const gate = await requireCalendarWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "삭제할 태그를 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_tags")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .select("name")
    .maybeSingle();
  if (error) return { error: explainDbError(error, { scope: "calendar.actions.deleteCalendarTag", fallback: "태그 삭제 실패 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };
  if (!data) return { error: "삭제할 태그를 찾을 수 없습니다" };

  await logAction({
    action: "calendar_tag_delete",
    targetType: "calendar_tag",
    targetLabel: String(data.name),
  });
  revalidatePath("/calendar");
  return { ok: true, notice: "태그를 삭제했습니다 — 일정은 남고 태그만 해제됩니다" };
}
