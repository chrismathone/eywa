import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";

export type ScheduleSlot = {
  id: string;
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string; // "mon" ~ "sun"
  startTime: string; // "16:00:00"
  endTime: string;
  teacherName: string | null;
  classroomName: string | null;
  studentCount: number;
};

async function fetchSlots(): Promise<ScheduleSlot[]> {
  const supabase = await createClient();
  // 만료된 스케줄(valid_to < 오늘)은 제외. valid_to is null = 무기한 유효.
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("class_schedules")
    .select(
      `id, day_of_week, start_time, end_time, class_id,
       class:class_id (
         id, class_name, subject,
         teacher:teacher_id ( display_name ),
         classroom:classroom_id ( name )
       )`,
    )
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order("start_time");

  if (!data) return [];

  // 활성 enrollment 전건 카운트 — PostgREST 1000행 한도 회피(#54).
  const enrollments = await fetchAllPaged<{ class_id: string }>((from, to) =>
    supabase.from("enrollments").select("class_id").is("end_date", null).range(from, to),
  );

  const counts = new Map<string, number>();
  for (const e of enrollments) {
    counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
  }

  return data.map((r) => {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | {
          id?: string;
          class_name?: string;
          subject?: string;
          teacher?: { display_name?: string } | { display_name?: string }[];
          classroom?: { name?: string } | { name?: string }[];
        }
      | undefined;
    const teacherField = klass?.teacher;
    const teacher = (Array.isArray(teacherField) ? teacherField[0] : teacherField) as
      | { display_name?: string }
      | undefined;
    const roomField = klass?.classroom;
    const room = (Array.isArray(roomField) ? roomField[0] : roomField) as
      | { name?: string }
      | undefined;
    return {
      id: r.id,
      classId: r.class_id,
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      studentCount: counts.get(r.class_id) ?? 0,
    };
  });
}

export async function getWeeklySchedule(): Promise<ScheduleSlot[]> {
  return fetchSlots();
}

export type StudentLine = {
  name: string;
  grade: string | null;
  school: string | null;
  enrollmentId?: string;
  /** 학생 id — 셀에서 클릭 시 학생 상세 창 링크(/students/[id])용. */
  studentId: string;
  /** 셀 섹션 구분: active=재원, hold=대기(enrollment.on_hold), withdrawn=퇴원(end_date 있음). ijw 셀 패턴. */
  status: "active" | "hold" | "withdrawn";
  /** 퇴원일(status=withdrawn). 최신순 정렬·표시용. */
  endDate?: string | null;
  /** 등록 30일 이내 = 신입(셀에서 빨강 강조). ijw의 신입 윈도우 단순 근사(과목별 첫등록 아님). */
  isNew?: boolean;
  /** 타 반에서 이동해 들어온 학생(셀에서 초록 강조). */
  isTransferredIn?: boolean;
  /** 분리등원 요일 — []=전 요일, ['mon','thu']=월목만. 비어있지 않으면 셀에 배지로 표시. */
  attendanceDays?: string[];
};
export type ScheduleSlotWithStudents = ScheduleSlot & { students: StudentLine[] };

/**
 * 시간표 + 각 슬롯의 학생 명단. ijw 시간표 기본뷰/통합뷰의 셀 안에 표시되는
 * 학생 리스트 (이름·학년·학교) 데이터.
 */
type StudentRef = { name?: string; grade?: string | null; school?: string | null };
const refOf = (r: { student: StudentRef | StudentRef[] }): StudentRef | undefined =>
  Array.isArray(r.student) ? r.student[0] : r.student;
/** server-only 모듈이라 new Date() OK(fetchSlots와 동일 패턴). YYYY-MM-DD. */
const dateBefore = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * 시간표 + 각 슬롯의 학생 명단. ijw 시간표 기본뷰/통합뷰의 셀 안에 표시되는 학생 리스트.
 * 재원(active)뿐 아니라 **대기(on_hold)·최근 퇴원(end_date)** 도 포함 — ijw 셀이 보여주던
 * 재원/대기/퇴원 섹션을 복원. 퇴원은 최근 1년·반이동 제외(셀에서 status로 분리 렌더).
 */
export async function getWeeklyScheduleWithStudents(): Promise<ScheduleSlotWithStudents[]> {
  const slots = await fetchSlots();
  if (slots.length === 0) return [];

  const classIds = Array.from(new Set(slots.map((s) => s.classId)));
  const supabase = await createClient();

  const newCutoff = dateBefore(30); // 신입 판정 — 등록 30일 이내
  // 퇴원 표시 윈도우 — 최근 1년. ijw도 셀당 표시 캡으로 최근 몇 명만 보였고, fetchInChunks
  // 1000행/청크 한도(#53)도 보호(전체 이력은 반 상세에서). 반이동(is_transferred)은 새 반 전입으로 보이므로 제외.
  const withdrawnCutoff = dateBefore(365);

  // class_id를 청크로 나눠 조회 — 대량 .in()의 HTTP 414 + 1000행 절단 회피(#53).
  type ActiveRow = {
    id: string;
    class_id: string;
    student_id: string;
    start_date: string | null;
    on_hold: boolean | null;
    is_transferred_in: boolean | null;
    attendance_days: string[] | null;
    student: StudentRef | StudentRef[];
  };
  type WithdrawnRow = {
    id: string;
    class_id: string;
    student_id: string;
    end_date: string | null;
    student: StudentRef | StudentRef[];
  };

  // 재원+대기(end_date null) · 최근 퇴원(end_date 있음, 반이동 아님)을 병렬로.
  const [activeRows, withdrawnRows] = await Promise.all([
    fetchInChunks<ActiveRow>(classIds, (chunk) =>
      supabase
        .from("enrollments")
        .select(
          "id, class_id, student_id, start_date, on_hold, is_transferred_in, attendance_days, student:student_id ( name, grade, school )",
        )
        .in("class_id", chunk)
        .is("end_date", null),
    ),
    fetchInChunks<WithdrawnRow>(classIds, (chunk) =>
      supabase
        .from("enrollments")
        .select("id, class_id, student_id, end_date, student:student_id ( name, grade, school )")
        .in("class_id", chunk)
        .not("end_date", "is", null)
        .eq("is_transferred", false)
        .gte("end_date", withdrawnCutoff)
        .order("end_date", { ascending: false }),
    ),
  ]);

  const byClass = new Map<string, StudentLine[]>();
  const seen = new Set<string>(); // `${class_id}:${student_id}` — 재원/대기 우선, 같은 반 재등록 시 퇴원 중복 제외
  const push = (classId: string, line: StudentLine) => {
    const list = byClass.get(classId) ?? [];
    list.push(line);
    byClass.set(classId, list);
  };

  for (const r of activeRows) {
    const s = refOf(r);
    if (!s?.name) continue;
    seen.add(`${r.class_id}:${r.student_id}`);
    push(r.class_id, {
      name: s.name,
      grade: s.grade ?? null,
      school: s.school ?? null,
      enrollmentId: r.id,
      studentId: r.student_id,
      status: r.on_hold ? "hold" : "active",
      // 날짜 문자열(YYYY-MM-DD) 사전식 비교 — start_date >= cutoff면 30일 이내.
      isNew: r.start_date != null && r.start_date >= newCutoff,
      isTransferredIn: r.is_transferred_in === true,
      attendanceDays: r.attendance_days ?? [],
    });
  }
  for (const r of withdrawnRows) {
    const key = `${r.class_id}:${r.student_id}`;
    if (seen.has(key)) continue; // 같은 반에 재등록(재원/대기)이 있으면 퇴원으로 보지 않음
    seen.add(key);
    const s = refOf(r);
    if (!s?.name) continue;
    push(r.class_id, {
      name: s.name,
      grade: s.grade ?? null,
      school: s.school ?? null,
      enrollmentId: r.id,
      studentId: r.student_id,
      status: "withdrawn",
      endDate: r.end_date,
    });
  }

  // 셀 표시 순서: 재원 → 대기 → 퇴원. 재원 안에서는 신입 > 반이동(전입) > 기존(그룹 내 가나다),
  // 퇴원은 최신순, 대기는 가나다.
  const rank = (l: StudentLine) => (l.status === "active" ? 0 : l.status === "hold" ? 1 : 2);
  const activeSubRank = (l: StudentLine) => (l.isNew ? 0 : l.isTransferredIn ? 1 : 2);
  for (const list of byClass.values()) {
    list.sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.status === "active" && activeSubRank(a) !== activeSubRank(b)) {
        return activeSubRank(a) - activeSubRank(b);
      }
      if (a.status === "withdrawn") return (b.endDate ?? "").localeCompare(a.endDate ?? "");
      return a.name.localeCompare(b.name, "ko");
    });
  }

  return slots.map((s) => ({ ...s, students: byClass.get(s.classId) ?? [] }));
}

const DOW_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export type TodaySlot = ScheduleSlot & { status: "done" | "ongoing" | "upcoming" };

export async function getTodaySchedule(): Promise<TodaySlot[]> {
  const all = await fetchSlots();
  const now = new Date();
  const todayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()];
  const todaysSlots = all.filter((s) => s.dayOfWeek === todayKey);
  if (todaysSlots.length === 0) return [];

  const hh = now.getHours();
  const mm = now.getMinutes();
  const nowMins = hh * 60 + mm;

  function toMins(hms: string): number {
    const [h, m] = hms.split(":");
    return Number(h) * 60 + Number(m);
  }

  return todaysSlots
    .slice()
    .sort((a, b) => toMins(a.startTime) - toMins(b.startTime))
    .map((s) => {
      const start = toMins(s.startTime);
      const end = toMins(s.endTime);
      let status: TodaySlot["status"] = "upcoming";
      if (nowMins >= end) status = "done";
      else if (nowMins >= start) status = "ongoing";
      return { ...s, status };
    });
}

export function dayOfWeekIndex(key: string): number {
  return DOW_INDEX[key] ?? 7;
}
