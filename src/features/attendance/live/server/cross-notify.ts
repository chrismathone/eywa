import "server-only";
/**
 * 미출결 → 출결 교차 알림. 쓰기 시점에만 발화(배치 불필요).
 *
 * · 데스크가 바꿨으면 → **그 칸의 그날 그 교시 담당 + 반 담임**(원장 결정 2026-09-14, `attendanceNoticeRecipients`)
 * · 강사가 바꿨으면 → `users.desk_attendance_optin` 켠 계정
 *
 * 규약: dedup bucket = 상태 전이(`날짜|교시`), 신규분만 발송, admin 조회에 tenant 필터.
 * best-effort — 실패해도 출결 저장을 막지 않는다.
 * ⚠️ 인앱 벨만. 휴대폰 푸시 확대는 원장 결정 사항.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { notifyUsers } from "@/features/notifications/server/notify";
import { getTestStudentIds } from "@/features/students/server/test-students";
import { addDays, kstToday } from "@/lib/date-kst";
import {
  attendanceNoticeRecipients,
  axisDowOf,
  axisSlotFromRow,
  type AxisSlot,
  type AxisSlotRow,
} from "@/features/attendance/teacher-axis";
import { crossNotifyDirection } from "../mark-state";
import { collectStudentNames, formatAttendanceNotifyNames } from "../notify-names";
import type { RecordedVia } from "../recorded-via";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPE = "attendance_unmarked_to_present" as const;

type NotifyCell = {
  studentId: string;
  classId: string;
  /** 저장 교시 — dedup bucket의 교시다. */
  slotStart?: string | null;
  /** 지금 교시(좌석표 카드의 대표 교시) — 저장 교시와 다르면 그 교시 담당도 받는다. dedup엔 안 쓴다. */
  periodStart?: string | null;
};

const cellKey = (date: string, c: NotifyCell) => `${c.studentId}|${date}|${c.slotStart ?? ""}`;

export async function notifyUnmarkedToPresent(input: {
  tenantId: string;
  actorId: string | null;
  date: string;
  via: RecordedVia;
  cells: NotifyCell[];
}): Promise<void> {
  const { tenantId, actorId, date, via, cells } = input;
  const direction = crossNotifyDirection(via);
  if (!direction || !YMD.test(date) || cells.length === 0) return;
  try {
    const today = kstToday();
    if (date > today || date < addDays(today, -1)) return;

    const admin = createAdminClient();
    // 🔴 테스트 학생(`students.is_test` — 발송 시험용 '학원이')은 알리지 않는다(원장 2026-09-13).
    //    **dedup 앞에서** 뺀다 — 뒤에서 빼면 그 칸의 dedup만 소모돼 나중에 진짜 알림이 막힌다.
    //    묶음 본문이라 그 학생만 빠지고 같은 저장의 실학생 알림은 그대로 나간다.
    // ⚠️ 두 규칙의 순서(2026-09-14 병합 — 테스트 학생 차단 + 교시 담당 좁히기): **테스트 학생 빼기 → 칸마다
    //    수신자 정하기 → dedup**. 아래 수신자 계산·데스크 방향 목록·dedup이 전부 `liveCells`(와 그 부분집합
    //    `routed`)만 봐야 테스트 학생 칸이 어느 경로로도 새지 않는다 — `cells`를 넘기면 수신자 경로로 샌다.
    const testStudentIds = await getTestStudentIds(admin, tenantId);
    const liveCells = cells.filter((c) => !testStudentIds.has(c.studentId));
    if (liveCells.length === 0) return;

    // 받을 사람 → 그 사람이 받을 칸. 강사 방향은 **칸마다** 수신자가 다르다(교시마다 담당이 다른 영어).
    const targets: Map<string, NotifyCell[]> =
      direction === "to_teacher"
        ? await loadClassTeachersByCell(admin, tenantId, date, liveCells, actorId)
        : new Map((await loadDeskOptin(admin, tenantId, actorId)).map((id) => [id, liveCells]));
    if (targets.size === 0) return;

    // 수신자 확인이 dedup보다 먼저(기존 규약) — 받을 사람이 없는 칸의 bucket을 태우면 "보냈다"가 거짓이 된다.
    const routedKeys = new Set([...targets.values()].flatMap((list) => list.map((c) => cellKey(date, c))));
    const routed = liveCells.filter((c) => routedKeys.has(cellKey(date, c)));
    if (routed.length === 0) return;

    const { data: fresh, error: dedupError } = await admin
      .from("notification_events")
      .upsert(
        routed.map((c) => ({
          tenant_id: tenantId,
          event_type: EVENT_TYPE,
          subject_key: c.studentId,
          bucket: `${date}|${c.slotStart ?? ""}`,
          seeded: false,
        })),
        { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true },
      )
      .select("subject_key, bucket");
    if (dedupError) throw dedupError;
    if (!fresh?.length) return;

    const freshKeys = new Set(fresh.map((f) => `${f.subject_key}|${f.bucket}`));
    const freshCells = routed.filter((c) => freshKeys.has(cellKey(date, c)));
    if (freshCells.length === 0) return;
    const freshIds = [...new Set(freshCells.map((c) => c.studentId))];
    // 100에서 자르면 뒤 이름이 벨에서 사라진다(B3). 청크로 전건.
    const students = await fetchInChunks<{ id: string; name: string }>(freshIds, (chunk) =>
      admin.from("students").select("id, name").eq("tenant_id", tenantId).in("id", chunk),
    );
    const nameById = new Map(students.map((s) => [s.id, s.name]));
    const { names, missing } = collectStudentNames(freshIds, nameById);
    if (missing > 0) {
      reportError(new Error(`cross-notify names incomplete: ${names.length}/${freshIds.length}`), {
        scope: "attendance.crossNotify.names",
        expected: freshIds.length,
        resolved: names.length,
        missing,
      });
    }

    const link =
      direction === "to_teacher"
        ? date === today
          ? "/attendance/live"
          : `/attendance/live?date=${date}`
        : date === today
          ? "/attendance/live?tab=seating"
          : `/attendance/live?tab=seating&date=${date}`;

    // 본문의 학생 명단도 **그 사람이 받을 칸만** — 남의 교시 학생 이름을 벨에 실어 보낼 이유가 없다([[#86]]).
    const messages = [...targets.entries()].flatMap(([recipientId, list]) => {
      const mineIds = [
        ...new Set(list.filter((c) => freshKeys.has(cellKey(date, c))).map((c) => c.studentId)),
      ];
      if (mineIds.length === 0) return [];
      const { names: mineNames } = collectStudentNames(mineIds, nameById);
      const { who, listedLabel } = formatAttendanceNotifyNames(mineNames, mineIds.length);
      return [
        {
          tenantId,
          recipientId,
          type: EVENT_TYPE,
          title:
            direction === "to_teacher" ? `데스크가 출석 처리 — ${who}` : `강사가 뒤늦게 출석 처리 — ${who}`,
          body:
            direction === "to_teacher"
              ? `${date} 미출결이던 ${listedLabel} 학생을 데스크에서 출석으로 입력했습니다.`
              : `${date} 미출결이던 ${listedLabel} 학생을 강사가 출석으로 입력했습니다.`,
          link,
          actorId,
        },
      ];
    });
    if (messages.length === 0) return;
    await notifyUsers(messages);
  } catch (e) {
    reportError(e, { scope: "attendance.crossNotify", tenantId, date, via });
  }
}

/**
 * 데스크 → 강사 방향 수신자 — **칸마다** 그날 그 교시 담당 ∪ 반 담임(원장 결정 2026-09-14).
 *
 * 🔴 반의 슬롯 담당을 요일·교시·유효기간 없이 모으지 말 것 — 끝난 배치 이력·다른 요일·다른 교시 강사에게까지
 *    벨이 갔다(실측 2026-09-14: 활성 반 120개 중 31개 반·연인원 75명). 판정은 `attendanceNoticeRecipients`
 *    한 벌이고 '출결 입력 요청'(actions.ts)도 같은 함수를 부른다. 가시성 합집합(`classTeacherIdsInRange`)과는
 *    일부러 다른 규칙이다.
 * ⚠️ SQL은 그날·그 요일로 좁히기만 하고 최종 판정은 순수 함수가 한다(조건이 두 벌이면 갈라진다).
 * ⚠️ `class_schedules`는 이력을 함께 담는 표라 청크 안에서도 1000행에 잘릴 수 있다 → 청크 × 페이징(B2).
 * ⚠️ 조회 실패는 throw — 호출부 catch가 reportError로 남긴다(삼키면 "받을 사람 없음"으로 위장한다).
 */
async function loadClassTeachersByCell(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  date: string,
  cells: readonly NotifyCell[],
  actorId: string | null,
): Promise<Map<string, NotifyCell[]>> {
  const dow = axisDowOf(date);
  if (!dow) return new Map();
  const classIds = [...new Set(cells.map((c) => c.classId))];
  const [klasses, slotRows] = await Promise.all([
    fetchInChunks<{ id: string; teacher_id: string | null }>(classIds, (chunk) =>
      admin.from("classes").select("id, teacher_id").eq("tenant_id", tenantId).in("id", chunk),
    ),
    fetchAllPagedInChunks<AxisSlotRow & { class_id: string }>(classIds, (chunk, from, to) =>
      admin
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .eq("day_of_week", dow)
        .lte("valid_from", date)
        .or(`valid_to.is.null,valid_to.gte.${date}`)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const homeroomByClass = new Map(klasses.map((k) => [k.id, k.teacher_id]));
  const slotsByClass = new Map<string, AxisSlot[]>();
  for (const r of slotRows) {
    (slotsByClass.get(r.class_id) ?? slotsByClass.set(r.class_id, []).get(r.class_id)!).push(axisSlotFromRow(r));
  }
  const out = new Map<string, NotifyCell[]>();
  for (const cell of cells) {
    // 이 학원 반이 아니면(조회에 안 걸림) 받을 사람을 지어내지 않는다.
    if (!homeroomByClass.has(cell.classId)) continue;
    const recipients = attendanceNoticeRecipients({
      homeroomTeacherId: homeroomByClass.get(cell.classId) ?? null,
      slots: slotsByClass.get(cell.classId) ?? [],
      date,
      slotStart: cell.slotStart ?? null,
      periodStart: cell.periodStart ?? null,
      excludeId: actorId,
    });
    for (const id of recipients) (out.get(id) ?? out.set(id, []).get(id)!).push(cell);
  }
  return out;
}

/** '출결 데스크 알림' 켠 계정(0212a) — 교차 알림과 '데스크 확인 요청'이 같은 수신자 축을 쓴다. */
export async function loadDeskOptin(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  actorId: string | null,
): Promise<string[]> {
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .eq("desk_attendance_optin", true);
  if (error) {
    // 0212a 미적용 — 받을 사람이 없는 것과 같다. 출결 저장은 살린다(#95).
    if (/desk_attendance_optin/i.test(error.message)) return [];
    throw error;
  }
  return (data ?? []).map((r) => r.id as string).filter((id) => id !== actorId);
}
