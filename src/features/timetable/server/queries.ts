import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday, kstMinutesOfDay } from "@/lib/date-kst";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { weekEndOf, weekSundayOf, shiftDays } from "../lib/week";
import { compareStudentLines } from "../lib/student-sort";
import type { TeacherColorMap } from "../lib/class-grid";

/** 오늘(YYYY-MM-DD, 기준일 기본값) — KST 기준(서버 UTC라 새벽 시간대 하루 밀림 방지). */
const todayStr = (): string => kstToday();

/**
 * 세션 없는 호출(cron 자동 시트 반영 등)용 DB 주입 — admin 클라이언트 + **명시 tenant 필터**.
 * 미주입(기본) = 기존 그대로 쿠키 세션 createClient(RLS가 테넌트 격리). 주입 시 이 파일의 각 쿼리에
 * `.eq("tenant_id", …)`가 붙는다(admin은 RLS 우회라 필터 누락 = 교차 테넌트 유출 — edutrix-sync cron 선례).
 */
export type TimetableDb = { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string };

/**
 * 강사 라벨 → 저장된 색 맵(통합뷰 셀·담임색). display_name·english_name(영문닉네임 슬롯 라벨) 둘 다 키.
 * users(소수·테넌트 RLS)에서 색 있는 행만. 미해결 라벨은 렌더에서 teacherColor 해시 폴백.
 */
export async function getTeacherColorMap(db?: TimetableDb): Promise<TeacherColorMap> {
  const supabase = db?.supabase ?? (await createClient());
  let q = supabase
    .from("users")
    .select("display_name, english_name, bg_color, text_color")
    .not("bg_color", "is", null);
  if (db) q = q.eq("tenant_id", db.tenantId);
  const { data } = await q;
  const map: TeacherColorMap = {};
  for (const u of data ?? []) {
    if (!u.bg_color) continue;
    const c = { bg: u.bg_color as string, text: (u.text_color as string | null) ?? "#1a1f1c" };
    if (u.display_name) map[u.display_name as string] = c;
    if (u.english_name) map[u.english_name as string] = c;
  }
  return map;
}

/**
 * 과목별 강사뷰 강사 라벨(distinct) — owner 과목 운영 '가로줄 제외 강사' 칩 선택지.
 * 라벨 = slot_teacher_label ?? 담임 display_name(teacher-grid의 teacherOf와 동일 규약).
 * 활성 반만. RLS 테넌트 격리. distinct/whitelist 용도라 fetchAllPaged(1000행 절단 방지, B2).
 */
export async function getTeacherLabelsBySubject(): Promise<Record<string, string[]>> {
  const supabase = await createClient();
  const rows = await fetchAllPaged<{
    slot_teacher_label: string | null;
    class: unknown;
  }>((from, to) =>
    supabase
      .from("class_schedules")
      .select(
        `slot_teacher_label, class:class_id!inner ( subject, is_active, teacher:teacher_id ( display_name ) )`,
      )
      .eq("class.is_active", true)
      .range(from, to),
  );
  const bySubject = new Map<string, Set<string>>();
  for (const r of rows) {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { subject?: string; teacher?: { display_name?: string } | { display_name?: string }[] }
      | undefined;
    if (!klass?.subject) continue;
    const tField = klass.teacher;
    const teacher = (Array.isArray(tField) ? tField[0] : tField) as { display_name?: string } | undefined;
    const label = r.slot_teacher_label ?? teacher?.display_name ?? null;
    if (!label) continue;
    (bySubject.get(klass.subject) ?? bySubject.set(klass.subject, new Set()).get(klass.subject)!).add(label);
  }
  const out: Record<string, string[]> = {};
  for (const [subj, set] of bySubject) out[subj] = [...set].sort((a, b) => a.localeCompare(b, "ko"));
  return out;
}

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
  // 강사 인수인계 예약(0044a `classes.pending_teacher_id`) — 있으면 셀 배경 틴트 + hover 상세. null=예약 없음.
  pendingHandover: { teacherName: string | null; date: string | null } | null;
};

async function fetchSlots(referenceDate: string, db?: TimetableDb): Promise<ScheduleSlot[]> {
  const supabase = db?.supabase ?? (await createClient());
  const weekEnd = weekEndOf(referenceDate);
  // 그 주 시점에 유효한 스케줄만: valid_from ≤ 그 주 일요일(미래 시작 스케줄 제외) + valid_to ≥ 기준일(만료 제외).
  // ⚠️ valid_from 상한은 weekEnd(ref+6 롤링 창)가 아니라 weekSundayOf(그 주 실제 끝) — 롤링 창이면
  // 과거 주(ref=일요일) 조회에 다음 주 시작 스케줄이 새어 스케줄 전환(temporal cutover) 시 중복 표시된다.
  // 폐지(is_active=false)된 반은 `!inner` 조인 + class.is_active 필터로 전체 주에서 제외.
  // 종강(class.closed_at)된 반은 종강일 이후 주에서만 제외(이전 주엔 수강이력으로 표시) — JS에서 거른다.
  let slotQuery = supabase
    .from("class_schedules")
    .select(
      `id, day_of_week, start_time, end_time, class_id, slot_teacher_label, slot_room_label,
       class:class_id!inner (
         id, class_name, subject, bg_color, text_color, is_active, closed_at,
         pending_teacher_id, pending_teacher_date,
         teacher:teacher_id ( display_name ),
         pendingTeacher:pending_teacher_id ( display_name ),
         classroom:classroom_id ( name )
       )`,
    )
    .eq("class.is_active", true)
    .lte("valid_from", weekSundayOf(referenceDate))
    .or(`valid_to.is.null,valid_to.gte.${referenceDate}`)
    .order("start_time");
  if (db) slotQuery = slotQuery.eq("tenant_id", db.tenantId); // admin(cron) 경로 — RLS 우회라 명시 격리
  const { data } = await slotQuery;

  if (!data) return [];

  // 종강 반: closed_at < 기준일이면 그 주엔 이미 종강 → 제외(closed_at ≥ 기준일인 과거 주엔 표시).
  const visible = data.filter((r) => {
    const k = (Array.isArray(r.class) ? r.class[0] : r.class) as { closed_at?: string | null } | undefined;
    const closedAt = k?.closed_at ?? null;
    return !closedAt || closedAt >= referenceDate;
  });

  // as-of-week 재원 카운트 — 그 주 끝(weekEnd)까지 시작했고 그 주 끝에 아직 안 끝난 enrollment.
  // (정확한 재원/대기/퇴원 분류는 getWeeklyScheduleWithStudents. 여기선 셀 헤더 카운트용 근사.) #54 페이지네이션.
  const enrollments = await fetchAllPaged<{ class_id: string }>((from, to) => {
    let q = supabase
      .from("enrollments")
      .select("class_id")
      .lte("start_date", weekEnd)
      .or(`end_date.is.null,end_date.gt.${weekEnd}`);
    if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
    return q.range(from, to);
  });

  const counts = new Map<string, number>();
  for (const e of enrollments) {
    counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
  }

  return visible.map((r) => {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | {
          id?: string;
          class_name?: string;
          subject?: string;
          bg_color?: string | null;
          text_color?: string | null;
          pending_teacher_id?: string | null;
          pending_teacher_date?: string | null;
          teacher?: { display_name?: string } | { display_name?: string }[];
          pendingTeacher?: { display_name?: string } | { display_name?: string }[];
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
    const pendingField = klass?.pendingTeacher;
    const pending = (Array.isArray(pendingField) ? pendingField[0] : pendingField) as
      | { display_name?: string }
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
      pendingHandover: klass?.pending_teacher_id
        ? { teacherName: pending?.display_name ?? null, date: (klass?.pending_teacher_date as string | null) ?? null }
        : null,
    };
  });
}

export async function getWeeklySchedule(): Promise<ScheduleSlot[]> {
  return fetchSlots(todayStr());
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
  /** 수강 시작일(YYYY-MM-DD). ijw 익스포터의 30/60일 신입색·정렬 가중치 계산용(재원/대기만). */
  enrollmentDate?: string | null;
  /** 타 반에서 이동해 들어온 학생(셀에서 초록 강조). */
  isTransferredIn?: boolean;
  /** 분리등원 요일 — []=전 요일, ['mon','thu']=월목만. 비어있지 않으면 셀에 배지로 표시. */
  attendanceDays?: string[];
  /** 영문 이름(ijw englishName) — 통합뷰 명단에 "이름 (English)"로 표시. 없으면 미표시. */
  englishName?: string | null;
  /** 학생별 최근 교재(ijw 학생 hover의 교재 줄) — textbook_orders 최신 1건. hover 표시용. */
  latestTextbook?: { name: string; date: string | null } | null;
  /** 학생별 최근 진도(ijw 학생 hover의 "[진도]" 줄) — lesson_reports 최신 1건. */
  latestReport?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
};
export type ScheduleSlotWithStudents = ScheduleSlot & { students: StudentLine[] };

/**
 * 시간표 + 각 슬롯의 학생 명단. ijw 시간표 기본뷰/통합뷰의 셀 안에 표시되는
 * 학생 리스트 (이름·학년·학교) 데이터.
 */
type StudentRef = {
  name?: string;
  grade?: string | null;
  school?: string | null;
  english_name?: string | null;
  /** 퇴원이 enrollment.end_date 없이 students.withdrawn_at로만 기록된 경우의 시점 재구성용. */
  status?: string | null;
  withdrawn_at?: string | null;
};
const refOf = (r: { student: StudentRef | StudentRef[] }): StudentRef | undefined =>
  Array.isArray(r.student) ? r.student[0] : r.student;

/**
 * 시간표 + 각 슬롯의 학생 명단. ijw 시간표 기본뷰/통합뷰의 셀 안에 표시되는 학생 리스트.
 * 재원(active)뿐 아니라 **대기(on_hold)·최근 퇴원(end_date)** 도 포함 — ijw 셀이 보여주던
 * 재원/대기/퇴원 섹션을 복원. 퇴원은 최근 1달(30일)·반이동 제외(셀에서 status로 분리 렌더).
 */
export async function getWeeklyScheduleWithStudents(
  // db = 세션 없는 호출(cron) 주입 — teacherId 스코핑은 세션 전제(getTeacherScope)라 db와 병용 불가.
  opts?: { referenceDate?: string; teacherId?: string; subject?: string; db?: TimetableDb },
): Promise<ScheduleSlotWithStudents[]> {
  // 주차 기준일(미지정=오늘) 기준으로 그 시점의 반 명단을 재구성 — ijw 시간표 주간 이동(타임머신).
  const referenceDate = opts?.referenceDate ?? todayStr();
  const teacherId = opts?.teacherId;
  const subject = opts?.subject;
  const db = opts?.db;
  const weekEnd = weekEndOf(referenceDate); // 재구성 윈도우 끝(ref+6, ijw useSubjectClassStudents)
  const newCutoff = shiftDays(referenceDate, -30); // 신입: 기준일 30일 이내 시작
  const withdrawnFloor = shiftDays(referenceDate, -30); // 퇴원 표시 윈도우: 기준일 1달(30일) 전까지(클러터 캡, 2026-07-14 원장 1년→1달)

  let slots = await fetchSlots(referenceDate, db);
  // 과목 스코핑(선택) — 한 과목만 필요한 호출부(과목별 익스포터 등)는 classIds를 먼저 좁혀
  // 무거운 학생/수강/진도 조회량을 줄인다(전 과목 로딩 방지, B2). 필터 후 빈 결과는 아래 조기반환.
  if (subject) slots = slots.filter((s) => s.subject === subject);
  // 강사 스코핑(intra-tenant PII) — teacher면 본인 담당 반만. 안 하면 강사가 /timetable 직타 시
  // 전 학생 명단(이름·학교·학년·진도)이 노출된다. RLS는 테넌트만 격리하므로 앱레벨에서 좁힌다.
  if (teacherId) {
    const { classIds: scoped } = await getTeacherScope(teacherId);
    if (scoped.length === 0) return [];
    const allow = new Set(scoped);
    slots = slots.filter((s) => allow.has(s.classId));
  }
  if (slots.length === 0) return [];

  const classIds = Array.from(new Set(slots.map((s) => s.classId)));
  const supabase = db?.supabase ?? (await createClient());

  // 그 주 시점(referenceDate/weekEnd) 명단 재구성 — ijw useSubjectClassStudents 이식.
  // 반별 enrollment를 청크로 한 번에(대량 .in() 414·1000행 절단 회피 #53): 현재 열린(end_date null) +
  // 최근 종료(end_date>=withdrawnFloor), 그 주 끝까지 시작한 것(start<=weekEnd)만.
  // 학생 status/withdrawn_at도 조인 — 퇴원이 enrollment.end_date 없이 students.withdrawn_at로만 기록된 경우까지 잡기 위함.
  type Row = {
    id: string;
    class_id: string;
    student_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean | null;
    is_transferred: boolean | null;
    is_transferred_in: boolean | null;
    attendance_days: string[] | null;
    student: StudentRef | StudentRef[];
  };
  const rows = await fetchInChunks<Row>(classIds, (chunk) => {
    let q = supabase
      .from("enrollments")
      .select(
        "id, class_id, student_id, start_date, end_date, on_hold, is_transferred, is_transferred_in, attendance_days, student:student_id ( name, grade, school, english_name, status, withdrawn_at )",
      )
      .in("class_id", chunk)
      .lte("start_date", weekEnd)
      .or(`end_date.is.null,end_date.gte.${withdrawnFloor}`);
    if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
    return q;
  });

  // (class_id:student_id) → 표시할 한 줄. 같은 반 다중 수강기록(재등록 등)은 재원>대기>퇴원 우선, 같으면 최신 시작.
  const statusRank = (st: StudentLine["status"]) => (st === "active" ? 0 : st === "hold" ? 1 : 2);
  const chosen = new Map<string, StudentLine>();
  for (const r of rows) {
    const s = refOf(r);
    if (!s?.name) continue;
    const start = r.start_date;
    const stuWithdraw = s.status === "withdrawn" ? (s.withdrawn_at ?? null) : null;
    // 이 반 실효 종료일 = enrollment.end_date(반 이탈)와 학생 퇴원일 중 이른 것.
    const effectiveEnd =
      [r.end_date, stuWithdraw].filter((x): x is string => !!x).sort()[0] ?? null;
    // ⚠️ "종료됨"은 **기준일(referenceDate) 시점** 기준 — 롤링 창 끝(weekEnd=ref+6)이 아니다.
    // weekEnd로 판정하면 기준일엔 재원 중인데 앞으로 6일 안에 끝나는(특히 반이동 전출 예정) 학생이
    // 조기에 "퇴원/전출"로 숨겨져 시간표에서 사라진다(이동일 전인데 옛 반에서 증발). daterange [start,end)라
    // end<=referenceDate면 기준일엔 이미 비활성 = 종료. (weekEnd는 아래 fetch의 '예정 학생' look-ahead 전용.)
    const hasEnded = effectiveEnd != null && effectiveEnd <= referenceDate;

    // 반이동 전출(이 반 종료 + is_transferred): 새 반에서 보이므로 옛 반엔 표시 안 함.
    if (hasEnded && r.is_transferred) continue;
    // 윈도우 밖(오래된) 퇴원은 표시 안 함(클러터 캡).
    if (hasEnded && effectiveEnd! < withdrawnFloor) continue;

    const isScheduled = start > referenceDate; // 미래 시작 = 아직 안 들어옴(배정 예정)
    const status: StudentLine["status"] = hasEnded
      ? "withdrawn"
      : isScheduled || r.on_hold
        ? "hold"
        : "active";

    const line: StudentLine = {
      name: s.name,
      grade: s.grade ?? null,
      school: s.school ?? null,
      enrollmentId: r.id,
      studentId: r.student_id,
      status,
      endDate: status === "withdrawn" ? effectiveEnd : undefined,
      // 반이동 학생은 새 enrollment라 start_date가 최근이라 isNew 조건에도 걸리지만, "신입"이 아니라
      // "전입(반이동)"으로만 분류한다(전입 우선·상호배타) — 신입·전입 동시 배지/정렬 어긋남 방지(사용자 지적).
      // 전입 배지도 신입과 동일한 30일 창(2026-07-13 사용자 결정) — 이동 30일 뒤엔 일반 재원으로 표시.
      isTransferredIn: status !== "withdrawn" && r.is_transferred_in === true && start >= newCutoff,
      isNew: status !== "withdrawn" && start >= newCutoff && r.is_transferred_in !== true,
      enrollmentDate: start,
      attendanceDays: r.attendance_days ?? [],
      englishName: s.english_name ?? null,
    };

    const key = `${r.class_id}:${r.student_id}`;
    const prev = chosen.get(key);
    if (
      !prev ||
      statusRank(status) < statusRank(prev.status) ||
      (statusRank(status) === statusRank(prev.status) &&
        (line.enrollmentDate ?? "") > (prev.enrollmentDate ?? ""))
    ) {
      chosen.set(key, line);
    }
  }

  // 퇴원 줄 정제(2026-07-13 사용자 결정): 퇴원생 = **그 과목 수강이 하나도 안 남은 학생**.
  // 같은 과목에 살아있는(기준일 시점 미종료) 수강이 하나라도 있으면 — 다른 반 재원·대기, 반이동/재등록
  // 포함 — 옛 반 퇴원 줄에 올리지 않는다(is_transferred 플래그 없는 이동·부분 종료의 "퇴원" 오표시 제거).
  // 보이는 슬롯 밖(다른 강사 반·시간표 미배정 반)의 수강까지 잡아야 해서 퇴원 후보 학생만 별도 경량 조회(B3 청크).
  {
    const withdrawnEntries = [...chosen].filter(([, l]) => l.status === "withdrawn");
    if (withdrawnEntries.length > 0) {
      const wStudentIds = Array.from(new Set(withdrawnEntries.map(([, l]) => l.studentId)));
      type AliveRow = {
        student_id: string;
        class: { subject: string | null } | { subject: string | null }[] | null;
        student: { status: string | null; withdrawn_at: string | null } | { status: string | null; withdrawn_at: string | null }[] | null;
      };
      const aliveRows = await fetchInChunks<AliveRow>(wStudentIds, (chunk) => {
        let q = supabase
          .from("enrollments")
          .select("student_id, class:class_id ( subject ), student:student_id ( status, withdrawn_at )")
          .in("student_id", chunk)
          .or(`end_date.is.null,end_date.gt.${referenceDate}`); // daterange [start,end) — end>ref = 기준일 시점 수강 유지
        if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
        return q;
      });
      const subjectOfClass = new Map(slots.map((s) => [s.classId, s.subject]));
      const aliveSubj = new Set<string>(); // `${subject}:${studentId}`
      for (const r of aliveRows) {
        const st = Array.isArray(r.student) ? r.student[0] : r.student;
        // 학생 단위 퇴원(withdrawn_at ≤ 기준일)은 열린 수강 행도 실효 종료로 본다(위 effectiveEnd와 동일 규칙).
        if (st?.status === "withdrawn" && st.withdrawn_at && st.withdrawn_at <= referenceDate) continue;
        const cls = Array.isArray(r.class) ? r.class[0] : r.class;
        if (cls?.subject) aliveSubj.add(`${cls.subject}:${r.student_id}`);
      }
      for (const [key, line] of withdrawnEntries) {
        const classId = key.slice(0, key.indexOf(":"));
        const subj = subjectOfClass.get(classId);
        if (subj && aliveSubj.has(`${subj}:${line.studentId}`)) chosen.delete(key);
      }
    }
  }

  const byClass = new Map<string, StudentLine[]>();
  for (const [key, line] of chosen) {
    const classId = key.slice(0, key.indexOf(":")); // uuid엔 ':' 없음 → 안전
    const list = byClass.get(classId) ?? [];
    list.push(line);
    byClass.set(classId, list);
  }

  // 셀 표시 순서: 재원 → 대기 → 퇴원(상세 규칙·단일 소스 = lib/student-sort.ts, 합반 통합 명단과 공유).
  for (const list of byClass.values()) {
    list.sort(compareStudentLines);
  }

  // 학생별 최근 교재 — ijw 학생 hover의 "교재" 줄. textbook_orders는 학생별이며 request_date 최신 1건.
  // (delivered_at은 폐기 컬럼이라 미사용 — 최근일 기준 = request_date.)
  const studentIds = Array.from(new Set([...byClass.values()].flat().map((l) => l.studentId)));
  if (studentIds.length > 0) {
    type TbRow = { student_id: string; book_name: string | null; request_date: string | null };
    // 학생별 최근 진도 — ijw 학생 hover의 "[진도]" 줄. lesson_reports 최신(report_date desc) 1건.
    type RepRow = {
      student_id: string;
      report_date: string;
      progress: string | null;
      exam_info: string | null;
      homework_score: string | null;
      teacher_name: string | null;
    };
    // 교재·진도는 둘 다 studentIds에만 의존하는 독립 조회 → 병렬(직렬이면 두 청크 wave가 합산됨).
    const [tbRows, repRows] = await Promise.all([
      fetchInChunks<TbRow>(studentIds, (chunk) => {
        let q = supabase
          .from("textbook_orders")
          .select("student_id, book_name, request_date")
          .in("student_id", chunk);
        if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
        return q;
      }),
      fetchInChunks<RepRow>(studentIds, (chunk) => {
        let q = supabase
          .from("lesson_reports")
          .select("student_id, report_date, progress, exam_info, homework_score, teacher_name")
          .in("student_id", chunk)
          .not("progress", "is", null) // hover는 진도 있는 최신 1건(상세 '진도' 탭은 전건)
          .order("report_date", { ascending: false });
        if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
        return q;
      }),
    ]);
    const latestTb = new Map<string, { name: string; date: string | null }>();
    for (const r of tbRows) {
      if (!r.book_name) continue;
      const d = (r.request_date ?? "").slice(0, 10);
      const cur = latestTb.get(r.student_id);
      if (!cur || (cur.date ?? "") < d) latestTb.set(r.student_id, { name: r.book_name, date: d || null });
    }
    for (const list of byClass.values()) {
      for (const l of list) {
        const tb = latestTb.get(l.studentId);
        if (tb) l.latestTextbook = tb;
      }
    }
    const latestRep = new Map<string, StudentLine["latestReport"]>();
    for (const r of repRows) {
      if (latestRep.has(r.student_id)) continue; // 이미 최신(정렬 desc) 저장됨
      latestRep.set(r.student_id, {
        date: r.report_date,
        progress: r.progress,
        examInfo: r.exam_info,
        homeworkScore: r.homework_score,
        teacherName: r.teacher_name,
      });
    }
    for (const list of byClass.values()) {
      for (const l of list) {
        const rep = latestRep.get(l.studentId);
        if (rep) l.latestReport = rep;
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
  const today = kstToday();
  // KST 날짜를 UTC 자정으로 파싱해 요일 도출 — 서버 UTC에서 now.getDay()는 새벽 시간대에 어제 요일이 된다.
  const todayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${today}T00:00:00Z`).getUTCDay()
  ];

  // 오늘 요일 스케줄만 — fetchSlots(전 요일 fetch 후 JS 필터)를 SQL 필터로 좁힘(데이터 ~1/7).
  // 폐지(is_active=false)·미래 시작·만료 스케줄 제외 + 종강(closed_at<오늘)은 JS에서 제외(시간표와 일관).
  const { data } = await supabase
    .from("class_schedules")
    .select(
      `id, day_of_week, start_time, end_time, class_id,
       class:class_id!inner (
         class_name, subject, is_active, closed_at,
         teacher:teacher_id ( display_name ),
         classroom:classroom_id ( name )
       )`,
    )
    .eq("day_of_week", todayKey)
    .eq("class.is_active", true)
    .lte("valid_from", today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order("start_time");
  if (!data || data.length === 0) return [];

  // 종강 반(closed_at < 오늘)은 오늘 일정에서 제외.
  const visible = data.filter((r) => {
    const k = (Array.isArray(r.class) ? r.class[0] : r.class) as { closed_at?: string | null } | undefined;
    const closedAt = k?.closed_at ?? null;
    return !closedAt || closedAt >= today;
  });
  if (visible.length === 0) return [];

  // 오늘 반의 활성 enrollment만 카운트 — 전체 enrollment 전건 페이지네이션 대신 오늘 반(classIds)으로 좁힘.
  // classIds는 수십 개라 .in() URL 안전 + range로 1000행 방어(#53/#54).
  const classIds = [...new Set(visible.map((r) => r.class_id as string))];
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

  const nowMins = kstMinutesOfDay();
  const toMins = (hms: string): number => {
    const [h, m] = hms.split(":");
    return Number(h) * 60 + Number(m);
  };

  return visible
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
        // 대시보드 오늘 일정은 셀 라벨·색·인수인계 미사용 — 타입 충족용 null.
        slotTeacherLabel: null,
        slotRoomLabel: null,
        classBgColor: null,
        classTextColor: null,
        pendingHandover: null,
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
