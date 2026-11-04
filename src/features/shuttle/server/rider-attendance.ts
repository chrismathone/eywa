import "server-only";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { buildRiderAttendance, type AttendanceRow, type RiderAttendance, type ScheduleRow } from "../today/rider-attendance";
import { isShuttleAdmin } from "./access";
import { dayCodeForDate } from "./queries";

/**
 * 오늘 등하원 하원 줄의 **그날 출석**(사용자 2026-10-30 — 관리자 뷰). 판정·문구는 순수 `buildRiderAttendance`.
 *
 * 🔒 **셔틀 관리자만**(`isShuttleAdmin` — 노선 지도와 같은 문) — 그 밖엔 빈 결과다. 페이지도 같은 판정으로 부른다([[#77]]).
 * 🔴 **읽기만** — 출석부에 아무것도 쓰지 않는다(셔틀이 출석에 영향을 주지 않는다).
 * ⚠️ admin 클라이언트라 **`tenant_id` 필터를 반드시** 건다([[#104]]). 실패해도 화면은 산다(출석 줄만 안 보인다).
 */
export async function getRiderAttendance(date: string, studentIds: readonly string[]): Promise<Record<string, RiderAttendance[]>> {
  const ids = [...new Set(studentIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const user = await getCurrentUser();
  if (!user || !(await isShuttleAdmin())) return {};
  const admin = createAdminClient();
  const tenantId = user.tenantId;
  try {
    const records = await fetchInChunks<AttendanceRow>(ids, (chunk) =>
      admin
        .from("attendance_records")
        .select("id, student_id, class_id, session_date, slot_start, status, recorded_by, recorded_via, seat_label, access_method, recorded_at")
        .eq("tenant_id", tenantId)
        .eq("session_date", date)
        .in("student_id", chunk),
    );
    if (records.length === 0) return {};
    const classIds = [...new Set(records.map((r) => r.class_id))];
    const userIds = [...new Set(records.map((r) => r.recorded_by).filter((x): x is string => !!x))];
    const day = dayCodeForDate(date);
    const [classes, users, slots] = await Promise.all([
      fetchInChunks<{ id: string; class_name: string }>(classIds, (chunk) =>
        admin.from("classes").select("id, class_name").eq("tenant_id", tenantId).in("id", chunk),
      ),
      fetchInChunks<{ id: string; display_name: string }>(userIds, (chunk) =>
        admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk),
      ),
      // 그날 그 반 교시 — 이력 행이 섞인 표라([[#88]]) 그날 유효한 행만(valid_to = 마지막 날 포함).
      fetchInChunks<{ class_id: string; start_time: string; end_time: string; classroom_id: string | null; slot_room_label: string | null }>(
        classIds,
        (chunk) =>
          admin
            .from("class_schedules")
            .select("class_id, start_time, end_time, classroom_id, slot_room_label")
            .eq("tenant_id", tenantId)
            .eq("day_of_week", day)
            .lte("valid_from", date)
            .or(`valid_to.is.null,valid_to.gte.${date}`)
            .in("class_id", chunk),
      ),
    ]);
    const roomIds = [...new Set(slots.map((s) => s.classroom_id).filter((x): x is string => !!x))];
    const rooms = await fetchInChunks<{ id: string; name: string }>(roomIds, (chunk) =>
      admin.from("classrooms").select("id, name").eq("tenant_id", tenantId).in("id", chunk),
    );
    const roomName = new Map(rooms.map((r) => [r.id, r.name]));
    const schedulesOf = new Map<string, ScheduleRow[]>();
    for (const s of slots) {
      const list = schedulesOf.get(s.class_id) ?? [];
      // 같은 시각 행이 둘이면(합반 등) 하나만.
      if (!list.some((x) => x.start_time === s.start_time)) {
        list.push({ class_id: s.class_id, start_time: s.start_time, end_time: s.end_time, room: (s.classroom_id && roomName.get(s.classroom_id)) || s.slot_room_label });
      }
      schedulesOf.set(s.class_id, list);
    }
    return buildRiderAttendance(
      records,
      new Map(classes.map((c) => [c.id, c.class_name])),
      new Map(users.map((u) => [u.id, u.display_name])),
      schedulesOf,
    );
  } catch (e) {
    reportError(e, { where: "getRiderAttendance" });
    return {};
  }
}
