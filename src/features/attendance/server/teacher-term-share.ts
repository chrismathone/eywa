import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { carryFolded, markFolded } from "@/lib/folded-read";
import { kstToday, monthRange } from "@/lib/date-kst";
import { lookupLabSeparateIds } from "@/features/classes/server/lab-separate";
import { toAutoUnitsSchedule } from "../auto-units";
import { consumedUnits, type AttendanceMark } from "../cell-display";
import { rowKey } from "../grid/model";
import { seatShareTakeFor } from "../seat-share-adjust";
import { isJjSeatRow } from "../seat-transfer";
import { axisSlotFromRow } from "../teacher-axis";
import { teacherFourWeekWeights, teacherTermWeights, withTakenSeatUnits, type TermShareWeights } from "../teacher-term-share";
import { loadSeatShareAdjust } from "./seat-share-adjust";

export type TeacherTermScope = {
  teacherId: string;
  /** Only English classes; math keeps its existing registration basis. */
  classIds: readonly string[];
  holidays: readonly string[];
  homeroomSinceByClass?: Readonly<Record<string, string | null>>;
};

type TakenRow = { id: string; class_id: string; student_id: string; session_date: string; slot_start: string | null; seat_label: string | null; recorded_via: string | null; status: string; session_units: number | string | null; recorded_at: string | null };

/**
 * 그 달 이 선생님이 **넘겨받은 JJ실 기록**(JJ실 시수 넘기기 — `taught_by` = 이 선생님)의 원본 행.
 * 교시표가 필요 없는 조회라 다른 재료와 **함께** 읽는다(B4 — 걸러내기만 교시표를 기다린다).
 * 🔴 못 읽으면 빈 목록에 **'못 읽음' 표식**(`markFolded`)을 남긴다 — 화면은 종전 그대로 돈다(넘겨받은 시수만 상한에 안 실린다 ·
 *    금액 열은 전원이 매일 보는 표라 이 조회 하나 때문에 죽지 않게). 그 결과를 **금액**으로 쓰는 명세서는 표식을 보고 산정을 멈춘다
 *    (조용히 낮은 금액으로 발행하지 않는다 — 적대 재리뷰 2026-10-07).
 * ⚠️ 귀속 칸이 아직 없는 스키마([[#95]])는 표식 없이 빈 목록이다 — 넘긴 기록 자체가 있을 수 없다.
 */
async function loadTakenSeatRows(
  db: SupabaseClient, tenantId: string, classIds: readonly string[], teacherId: string, from: string, to: string,
): Promise<TakenRow[]> {
  try {
    return await fetchAllPagedInChunks<TakenRow>([...classIds], (chunk, f, t) => db.from("attendance_records")
      .select("id, class_id, student_id, session_date, slot_start, seat_label, recorded_via, status, session_units, recorded_at")
      .eq("tenant_id", tenantId).in("class_id", chunk).eq("taught_by", teacherId).gte("session_date", from).lte("session_date", to)
      .order("id").range(f, t));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/taught_by/.test(message)) return [];
    console.error("[teacher-term-share] 넘겨받은 JJ실 시수 조회 실패 — 등록 차수 몫은 종전대로 둔다:", message);
    return markFolded([] as TakenRow[], "넘겨받은 JJ실 시수를 읽지 못했습니다");
  }
}

/** 넘겨받은 JJ실 기록 → 줄(반 × 학생)마다 시수 합. 교시마다 가장 최근 행 하나(정정 이력은 최신이 그 칸의 값이다). */
function sumTakenSeatUnits(
  rows: readonly TakenRow[],
  slotsOf: (classId: string) => readonly Parameters<typeof isJjSeatRow>[1][number][],
): Map<string, number> {
  const out = new Map<string, number>();
  const latest = new Map<string, TakenRow>();
  for (const r of [...rows].sort((x, y) => (y.recorded_at ?? "").localeCompare(x.recorded_at ?? "") || y.id.localeCompare(x.id))) {
    const key = `${r.class_id}|${r.student_id}|${r.session_date}|${r.slot_start ?? ""}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  for (const r of latest.values()) {
    if (!isJjSeatRow({ slotStart: r.slot_start, seatLabel: r.seat_label, recordedVia: r.recorded_via }, slotsOf(r.class_id), r.session_date)) continue;
    const raw = r.session_units === null || r.session_units === undefined ? null : Number(r.session_units);
    const units = consumedUnits(r.status as AttendanceMark, raw !== null && Number.isFinite(raw) ? raw : null);
    if (units > 0) out.set(rowKey(r.class_id, r.student_id), (out.get(rowKey(r.class_id, r.student_id)) ?? 0) + units);
  }
  return out;
}

/** Called only after attendance visibility has restricted the roster. Read in bulk, within the tenant. */
export async function loadTeacherTermWeights(
  db: SupabaseClient,
  tenantId: string,
  month: string,
  roster: readonly { classId: string; studentIds: readonly string[] }[],
  scope: TeacherTermScope,
): Promise<Map<string, TermShareWeights>> {
  const classes = roster.filter((c) => scope.classIds.includes(c.classId));
  const ids = classes.map((c) => c.classId);
  if (!ids.length) return new Map();
  const { from, to } = monthRange(month);
  type ScheduleRow = Parameters<typeof toAutoUnitsSchedule>[0] & { id: string; class_id: string; teacher_id: string | null };
  type EnrollmentRow = { class_id: string; student_id: string; start_date: string; end_date: string | null; is_transferred: boolean; attendance_days: string[] | null };
  const [meta, schedules, enrollments, separate, takenRows, shareAdjust] = await Promise.all([
    fetchAllPagedInChunks<{ id: string; class_name: string; teacher_id: string | null; english_track: string | null }>(ids, (chunk, f, t) => db.from("classes")
      .select("id, class_name, teacher_id, english_track").eq("tenant_id", tenantId).in("id", chunk).order("id").range(f, t)),
    fetchAllPagedInChunks<ScheduleRow>(ids, (chunk, f, t) => db.from("class_schedules")
      .select("id, class_id, day_of_week, start_time, end_time, teacher_id, slot_teacher_label, valid_from, valid_to")
      .eq("tenant_id", tenantId).in("class_id", chunk).lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`).order("id").range(f, t)),
    fetchAllPagedInChunks<EnrollmentRow>(ids, (chunk, f, t) => db.from("enrollments")
      .select("class_id, student_id, start_date, end_date, is_transferred, attendance_days")
      .eq("tenant_id", tenantId).in("class_id", chunk).lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`).order("id").range(f, t)),
    lookupLabSeparateIds(db, { kind: "window", from, to, tenantId, classIds: ids }),
    loadTakenSeatRows(db, tenantId, ids, scope.teacherId, from, to),
    // 반 × 달 '자리 몫 → 수업 몫' 조정값(0355a, 원장 2026-10-07 *"19/5를 20/4로"*) — 그 반 선생님 전부(줄마다 차례로 나눠 갖는다).
    loadSeatShareAdjust(db, tenantId, ids, month),
  ]);
  if (typeof separate === "string") throw new Error("등록 차수 배분을 위한 LAB 시간표를 확인하지 못했습니다");
  // JJ실 시수 넘기기 — 넘겨받은 시수만큼 방 몫을 그 선생님 몫으로 옮긴다(등록 차수 = 실급여 상한이 수업 차수와 함께 는다).
  const axisByClass = new Map(ids.map((id) => [id, schedules.filter((s) => s.class_id === id).map((s) => axisSlotFromRow({
    day_of_week: String(s.day_of_week), start_time: s.start_time ?? null, teacher_id: s.teacher_id, slot_teacher_label: s.slot_teacher_label ?? null,
    valid_from: String(s.valid_from), valid_to: s.valid_to ?? null,
  }))] as const));
  const taken = sumTakenSeatUnits(takenRows, (classId) => axisByClass.get(classId) ?? []);
  const holidays = new Set(scope.holidays);
  const today = kstToday();
  const referenceDate = today < from ? from : today > to ? to : today;
  const result = new Map<string, TermShareWeights>();
  for (const cls of classes) {
    const info = meta.find((c) => c.id === cls.classId);
    const slots = schedules.filter((s) => s.class_id === cls.classId).map((s) => ({ ...toAutoUnitsSchedule(s), teacherId: s.teacher_id, labSeparate: separate.ids.has(s.id) }));
    const fourWeekWeights = info?.english_track === "eie" ? teacherFourWeekWeights({
      referenceDate, schedules: slots, homeroomTeacherId: info.teacher_id, className: info.class_name ?? "",
    }) : null;
    for (const studentId of cls.studentIds) {
      const key = rowKey(cls.classId, studentId);
      const planned = fourWeekWeights ?? teacherTermWeights({
        month, schedules: slots, homeroomTeacherId: info?.teacher_id ?? null, englishTrack: info?.english_track ?? null, className: info?.class_name ?? "",
        holidays, scopeTeacherId: scope.teacherId, homeroomSince: scope.homeroomSinceByClass?.[cls.classId],
        // Hold has no historical start/end. A present-day hold must not erase a confirmed month's shares.
        enrollments: enrollments.filter((e) => e.class_id === cls.classId && e.student_id === studentId).map((e) => ({
          startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred, attendanceDays: e.attendance_days,
        })),
      });
      // 자리 몫에서 이 선생님 몫으로 돌리는 시수 = 넘겨받은 자리 기록 + 그 달 그 반의 조정값 가운데 이 줄에서 제 차례에 가져가는 만큼
      // (같은 반 선생님들이 그 줄의 자리 몫을 id 순으로 나눠 갖는다 — 합이 자리 몫을 넘지 않는다). 자리 계획 몫까지만 옮겨진다.
      result.set(key, withTakenSeatUnits(planned, scope.teacherId,
        (taken.get(key) ?? 0) + seatShareTakeFor(shareAdjust.get(cls.classId), scope.teacherId, studentId, planned)));
    }
  }
  // 넘겨받은 기록·조정값을 못 읽었으면 그 사실을 결과에 실어 보낸다 — 청구 조회가 `degraded`로 올리고 명세서가 멈춘다.
  return carryFolded(shareAdjust, carryFolded(takenRows, result));
}

/**
 * 반 하나의 **그 달 계획 몫**(달 내내 다닌 학생 기준 · 조정과 넘겨받은 시수는 얹지 않는다) — 자리 몫 조정 창이
 * "수업 19 / 자리 5"를 보이는 재료다. 위 `loadTeacherTermWeights`와 **같은 함수**로 센다(창의 숫자와 출석부 몫이 갈리지 않게).
 * 키 = 선생님 id, `""` = 자리(JJ실·랩실) 몫.
 */
export async function loadClassTermPlan(
  db: SupabaseClient, tenantId: string, month: string, classId: string, holidayDates: readonly string[],
): Promise<TermShareWeights | null> {
  const { from, to } = monthRange(month);
  type ScheduleRow = Parameters<typeof toAutoUnitsSchedule>[0] & { id: string; class_id: string; teacher_id: string | null };
  const [meta, schedules, separate] = await Promise.all([
    db.from("classes").select("id, class_name, teacher_id, english_track").eq("tenant_id", tenantId).eq("id", classId).maybeSingle(),
    fetchAllPagedInChunks<ScheduleRow>([classId], (chunk, f, t) => db.from("class_schedules")
      .select("id, class_id, day_of_week, start_time, end_time, teacher_id, slot_teacher_label, valid_from, valid_to")
      .eq("tenant_id", tenantId).in("class_id", chunk).lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`).order("id").range(f, t)),
    lookupLabSeparateIds(db, { kind: "window", from, to, tenantId, classIds: [classId] }),
  ]);
  if (meta.error) throw meta.error;
  const info = meta.data as { id: string; class_name: string | null; teacher_id: string | null; english_track: string | null } | null;
  if (!info) return null;
  if (typeof separate === "string") throw new Error("등록 차수 배분을 위한 LAB 시간표를 확인하지 못했습니다");
  const slots = schedules.map((s) => ({ ...toAutoUnitsSchedule(s), teacherId: s.teacher_id, labSeparate: separate.ids.has(s.id) }));
  if (info.english_track === "eie") {
    const today = kstToday();
    return teacherFourWeekWeights({
      referenceDate: today < from ? from : today > to ? to : today, schedules: slots, homeroomTeacherId: info.teacher_id, className: info.class_name ?? "",
    });
  }
  return teacherTermWeights({
    month, schedules: slots, homeroomTeacherId: info.teacher_id, englishTrack: info.english_track, className: info.class_name ?? "",
    holidays: new Set(holidayDates), scopeTeacherId: info.teacher_id ?? "",
    enrollments: [{ startDate: from, endDate: null, isTransferred: false, attendanceDays: null }],
  });
}
