import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { DOW_KEYS, dowIndexOf, resolveAttendDows } from "@/features/attendance/calendar";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { groupByStart, hhmm, SEAT_DB_LABEL, type SeatKey, type SeatPeriod, type SeatSlot } from "../seat";

export type SeatStudent = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 그 교시에 저장된 상태. null = 미체크(= 기록 없음, **결석이 아니다**). */
  status: "present" | "absent" | "late" | null;
  /** 누가 찍었나(표시용). 기록이 없으면 null. */
  recordedBy: string | null;
  /** 자리에서 찍힌 기록인가 — 반 출석부에서 찍힌 기록과 구분해 보여준다(시수 귀속이 다르다). */
  fromSeat: boolean;
};

export type SeatClassRoster = {
  classId: string;
  className: string;
  /** "HH:MM" — 같은 교시라도 반마다 다를 수 있다. */
  end: string;
  students: SeatStudent[];
};

export type SeatDay = {
  date: string;
  /** 교시(시작시각 오름차순). 그 날 자리 수업이 없으면 빈 배열. */
  periods: SeatPeriod[];
  /** 교시 start("HH:MM") → 반별 명단. */
  rosterByPeriod: Record<string, SeatClassRoster[]>;
};

/**
 * 자리(랩실·JJ실) 하루치 명단 — **그 날짜에 유효한** 슬롯만 읽는다.
 *
 * 🔴 `class_schedules`는 운영 이력을 함께 담는다(만료 행 다수). "현재 유효"로 고정 필터하면 **지난
 *    날짜를 열었을 때 그 날의 배치가 아니라 오늘 배치가 나온다** — 출결을 엉뚱한 반에 찍게 된다.
 * 🔴 묶는 키는 **자리 라벨**이지 방 이름이 아니다. JJ실은 방 표기가 `305`·`본원305`로 갈려 있어
 *    (실측 각 23행) 방 이름으로 묶으면 한 방이 두 개로 쪼개진다.
 * ⚠️ 라벨 원문은 `이주희`·`랩실` 같은 별칭도 쓰인다 → 문자열 비교 대신 `specialSlotLabel`(단일 소스)로
 *    판정한다. 그래서 쿼리는 라벨이 있는 그 요일 슬롯을 받아 JS에서 거른다(한 요일치라 수십~백 행).
 */
export async function getSeatDay(seat: SeatKey, date: string): Promise<SeatDay> {
  const supabase = await createClient();
  const dowKey = DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const wantLabel = SEAT_DB_LABEL[seat];

  const { data: rawSlots } = await supabase
    .from("class_schedules")
    .select("class_id, start_time, end_time, slot_teacher_label")
    .eq("day_of_week", dowKey)
    .not("slot_teacher_label", "is", null)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);

  const seatRows = (rawSlots ?? []).filter((r) => specialSlotLabel(r.slot_teacher_label) === wantLabel);
  if (seatRows.length === 0) return { date, periods: [], rosterByPeriod: {} };

  const classIds = [...new Set(seatRows.map((r) => r.class_id as string))];

  // 반 이름 · 수강생 · 그날 출결 — 서로 독립이라 병렬(B4). id 수십 개까지 갈 수 있어 청크 헬퍼(B3).
  const [classes, enrollments, records] = await Promise.all([
    fetchInChunks<{ id: string; class_name: string }>(classIds, (chunk) =>
      supabase.from("classes").select("id, class_name").in("id", chunk),
    ),
    // ⚠️ PostgREST 임베드는 타입상 **배열**로 온다(실제로는 1건) — 아래에서 첫 원소로 접는다.
    fetchInChunks<{
      class_id: string;
      attendance_days: string[] | null;
      student: { id: string; name: string; school: string | null; grade: string | null }[];
    }>(classIds, (chunk) =>
      supabase
        .from("enrollments")
        .select("class_id, attendance_days, student:student_id ( id, name, school, grade )")
        .in("class_id", chunk)
        .not("on_hold", "is", true)
        .lte("start_date", date)
        .or(`end_date.is.null,end_date.gte.${date}`),
    ),
    fetchInChunks<{
      id: string;
      class_id: string;
      student_id: string;
      session_date: string;
      slot_start: string | null;
      status: "present" | "absent" | "late";
      seat_label: string | null;
      recorded_at: string;
      recorder: { display_name: string | null }[];
    }>(classIds, (chunk) =>
      supabase
        .from("attendance_records")
        .select(
          "id, class_id, student_id, session_date, slot_start, status, seat_label, recorded_at, recorder:recorded_by ( display_name )",
        )
        .in("class_id", chunk)
        .eq("session_date", date),
    ),
  ]);

  const nameById = new Map(classes.map((c) => [c.id, c.class_name]));
  const slots: SeatSlot[] = seatRows.map((r) => ({
    classId: r.class_id as string,
    className: nameById.get(r.class_id as string) ?? "(이름 없는 반)",
    start: r.start_time as string,
    end: r.end_time as string,
  }));
  const periods = groupByStart(slots);

  // 반별 그 요일 수업요일 — 분리등원(attendance_days)이 있는 학생은 그날 오는 학생만 명단에 올린다.
  const classDows = new Map<string, number[]>();
  for (const r of seatRows) {
    const list = classDows.get(r.class_id as string) ?? [];
    const i = dowIndexOf(dowKey);
    if (i >= 0 && !list.includes(i)) list.push(i);
    classDows.set(r.class_id as string, list);
  }
  const todayIdx = dowIndexOf(dowKey);

  type Enrolled = { id: string; name: string; school: string | null; grade: string | null };
  const studentsByClass = new Map<string, Enrolled[]>();
  for (const e of enrollments) {
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) as Enrolled | null | undefined;
    if (!s) continue;
    const dows = resolveAttendDows(e.attendance_days, classDows.get(e.class_id) ?? []);
    if (dows.length > 0 && !dows.includes(todayIdx)) continue;
    const list = studentsByClass.get(e.class_id) ?? [];
    if (!list.some((x) => x.id === s.id)) list.push(s); // 재등록으로 행이 여럿이어도 한 번만
    studentsByClass.set(e.class_id, list);
  }

  // 교시별 유효행(정정 이력에서 최신 1건) — 교시가 키에 들어가야 같은 날 두 교시가 안 뭉갠다.
  const effective = effectiveAttendanceRecords(records);
  const recByKey = new Map<string, (typeof records)[number]>();
  for (const r of effective) recByKey.set(`${r.class_id}|${r.student_id}|${hhmm(r.slot_start)}`, r);

  const rosterByPeriod: Record<string, SeatClassRoster[]> = {};
  for (const p of periods) {
    rosterByPeriod[p.start] = p.slots.map((slot) => ({
      classId: slot.classId,
      className: slot.className,
      end: hhmm(slot.end),
      students: (studentsByClass.get(slot.classId) ?? [])
        .map((s) => {
          const rec = recByKey.get(`${slot.classId}|${s.id}|${p.start}`);
          const recorder = Array.isArray(rec?.recorder) ? rec?.recorder[0] : rec?.recorder;
          return {
            id: s.id,
            name: s.name,
            school: s.school,
            grade: s.grade,
            status: rec?.status ?? null,
            recordedBy: recorder?.display_name ?? null,
            fromSeat: !!rec?.seat_label,
          };
        })
        .sort((a, b) => (a.grade ?? "").localeCompare(b.grade ?? "", "ko") || a.name.localeCompare(b.name, "ko")),
    }));
  }

  return { date, periods, rosterByPeriod };
}
