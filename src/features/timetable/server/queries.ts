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
  // 셀 단위 라벨(ijw slotTeachers/slotRooms) — 통합뷰 미니그리드. null=반 기본 상속.
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
  // 반 헤더색(ijw bgColor/textColor) — 통합뷰 수업명 헤더. null=과목색 폴백.
  classBgColor: string | null;
  classTextColor: string | null;
};

async function fetchSlots(): Promise<ScheduleSlot[]> {
  const supabase = await createClient();
  // 만료된 스케줄(valid_to < 오늘)은 제외. valid_to is null = 무기한 유효.
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("class_schedules")
    .select(
      `id, day_of_week, start_time, end_time, class_id, slot_teacher_label, slot_room_label,
       class:class_id (
         id, class_name, subject, bg_color, text_color,
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
          bg_color?: string | null;
          text_color?: string | null;
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
      slotTeacherLabel: (r.slot_teacher_label as string | null) ?? null,
      slotRoomLabel: (r.slot_room_label as string | null) ?? null,
      classBgColor: klass?.bg_color ?? null,
      classTextColor: klass?.text_color ?? null,
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
  /** 영문 이름(ijw englishName) — 통합뷰 명단에 "이름 (English)"로 표시. 없으면 미표시. */
  englishName?: string | null;
  /** 학생별 최근 교재(ijw 학생 hover의 교재 줄) — textbook_orders 최신 1건. hover 표시용. */
  latestTextbook?: { name: string; date: string | null } | null;
};
export type ScheduleSlotWithStudents = ScheduleSlot & { students: StudentLine[] };

/**
 * 시간표 + 각 슬롯의 학생 명단. ijw 시간표 기본뷰/통합뷰의 셀 안에 표시되는
 * 학생 리스트 (이름·학년·학교) 데이터.
 */
type StudentRef = { name?: string; grade?: string | null; school?: string | null; english_name?: string | null };
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
          "id, class_id, student_id, start_date, on_hold, is_transferred_in, attendance_days, student:student_id ( name, grade, school, english_name )",
        )
        .in("class_id", chunk)
        .is("end_date", null),
    ),
    fetchInChunks<WithdrawnRow>(classIds, (chunk) =>
      supabase
        .from("enrollments")
        .select("id, class_id, student_id, end_date, student:student_id ( name, grade, school, english_name )")
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
      englishName: s.english_name ?? null,
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
      englishName: s.english_name ?? null,
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

  // 학생별 최근 교재 — ijw 학생 hover의 "교재" 줄. textbook_orders는 학생별이며 delivered_at(없으면 request_date) 최신 1건.
  const studentIds = Array.from(new Set([...byClass.values()].flat().map((l) => l.studentId)));
  if (studentIds.length > 0) {
    type TbRow = { student_id: string; book_name: string | null; delivered_at: string | null; request_date: string | null };
    const tbRows = await fetchInChunks<TbRow>(studentIds, (chunk) =>
      supabase
        .from("textbook_orders")
        .select("student_id, book_name, delivered_at, request_date")
        .in("student_id", chunk),
    );
    const latestTb = new Map<string, { name: string; date: string | null }>();
    for (const r of tbRows) {
      if (!r.book_name) continue;
      const d = (r.delivered_at ?? r.request_date ?? "").slice(0, 10);
      const cur = latestTb.get(r.student_id);
      if (!cur || (cur.date ?? "") < d) latestTb.set(r.student_id, { name: r.book_name, date: d || null });
    }
    for (const list of byClass.values()) {
      for (const l of list) {
        const tb = latestTb.get(l.studentId);
        if (tb) l.latestTextbook = tb;
      }
    }
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
  const supabase = await createClient();
  const now = new Date();
  const todayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()];
  const today = now.toISOString().slice(0, 10);

  // 오늘 요일 스케줄만 — fetchSlots(전 요일 fetch 후 JS 필터)를 SQL 필터로 좁힘(데이터 ~1/7).
  const { data } = await supabase
    .from("class_schedules")
    .select(
      `id, day_of_week, start_time, end_time, class_id,
       class:class_id (
         class_name, subject,
         teacher:teacher_id ( display_name ),
         classroom:classroom_id ( name )
       )`,
    )
    .eq("day_of_week", todayKey)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order("start_time");
  if (!data || data.length === 0) return [];

  // 오늘 반의 활성 enrollment만 카운트 — 전체 enrollment 전건 페이지네이션 대신 오늘 반(classIds)으로 좁힘.
  // classIds는 수십 개라 .in() URL 안전 + range로 1000행 방어(#53/#54).
  const classIds = [...new Set(data.map((r) => r.class_id as string))];
  const enrollments = await fetchAllPaged<{ class_id: string }>((from, to) =>
    supabase
      .from("enrollments")
      .select("class_id")
      .is("end_date", null)
      .in("class_id", classIds)
      .range(from, to),
  );
  const counts = new Map<string, number>();
  for (const e of enrollments) counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const toMins = (hms: string): number => {
    const [h, m] = hms.split(":");
    return Number(h) * 60 + Number(m);
  };

  return data
    .map((r): ScheduleSlot => {
      const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
        | {
            class_name?: string;
            subject?: string;
            teacher?: { display_name?: string } | { display_name?: string }[];
            classroom?: { name?: string } | { name?: string }[];
          }
        | undefined;
      const tf = klass?.teacher;
      const teacher = (Array.isArray(tf) ? tf[0] : tf) as { display_name?: string } | undefined;
      const rf = klass?.classroom;
      const room = (Array.isArray(rf) ? rf[0] : rf) as { name?: string } | undefined;
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
        // 대시보드 오늘 일정은 셀 라벨·색 미사용 — 타입 충족용 null.
        slotTeacherLabel: null,
        slotRoomLabel: null,
        classBgColor: null,
        classTextColor: null,
      };
    })
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
