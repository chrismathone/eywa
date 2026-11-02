import "server-only";
import { sortClassRows } from "../sort-rows";
import { createClient } from "@/lib/supabase/server";
import { readEnglishTrack, type EnglishTrack } from "../english-track";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTeacherReadScope } from "@/lib/auth/teacher-read-scope";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { enrollmentPhaseOn, isEnrollmentOnRosterOn, type EnrollmentPhase } from "@/features/enrollments/eligibility";
import { addDays, kstToday } from "@/lib/date-kst";
import { ASSIGNABLE_TEACHER_ROLES } from "@/lib/permissions";
import type { ClassroomAssignData } from "../lib/classroom-assign";
import { listMakeupPoolClassIds } from "@/features/attendance/server/makeup-pool";
import { canViewClassDetail } from "./class-scope";
import { loadLabSeparateIds } from "./lab-separate";
import { matchesClassKind, type ClassKindFilter } from "../list-filters";

/**
 * "만료되지 않은 스케줄" PostgREST `or` 절 — `valid_to`가 무기한(null)이거나 오늘 이후(**포함**).
 * `class_schedules`는 운영 이력을 함께 담는다(영어 시트 구조 가져오기가 옛 배치를 `valid_to`로 마감하고
 * 새 배치를 넣는다) — injaewon 실측 1,068행 중 480행이 이미 만료다. 시간표 쿼리·`isCurrentSlot`과 같은 경계.
 * ⚠️ 종강 반은 슬롯이 전부 만료라 이 필터를 걸면 요일이 통째로 사라진다 → **운영 중 반을 다루는 곳에만** 쓸 것.
 */
const liveValidTo = (today: string) => `valid_to.is.null,valid_to.gte.${today}`;

/** 운영 요일 + 그 요일의 최초 시작시각(HH:MM). 같은 요일 여러 교시면 가장 이른 시각. */
export type ClassDaySlot = { day: string; start: string | null };

export type ClassListRow = {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomName: string | null;
  isActive: boolean;
  /** 종강일(0059a) — 있으면 종강(운영 종료). is_active=false(폐지)와 구분. */
  closedAt: string | null;
  /** 특강(0133a) 토글값 **그대로**. ⚠️ 판정은 이름 폴백까지 보는 `isSpecialLecture()`로. */
  isSpecial: boolean;
  studentCount: number;
  days: ClassDaySlot[]; // 운영 요일(+시작시각), 요일순 정렬
  /**
   * 위 `days`가 **지금 유효하지 않은 배치**인가(운영 기간이 끝났거나 아직 시작 전).
   * 🔴 `class_schedules`는 운영 이력을 함께 담아서([[#88]]) 전 행을 그냥 그리면 **끝난 교시가 현재처럼**
   *    보인다(실측 2026-08-27: 종료일을 넣어 교시가 전부 만료된 활성 반 7개가 목록에선 월~금 운영 중으로
   *    보였다 — "운영 종료일이 작동 안 한다"의 정체). 유효 행이 하나도 없을 때만 지난 배치를 흐리게 보여
   *    준다(통째로 감추면 요일 칸이 빈다).
   */
  daysStale: boolean;
  notes: string | null;
};

/** 수업목록 정렬 기준 — ijw 패리티(수업명/학생수/강사명). */
/**
 * 정렬 = 열 머리의 오름·내림 화살표(원장 2026-10-14 *"수업목록도 똑같이 바꿔"* — 원생목록과 같은 꼴). 옛 값 셋은 뜻 그대로
 * (`name` = 반 이름 오름차순 · `students` = 학생 많은 순 · `teacher` = 담임 오름차순) — 저장값·옛 링크가 그대로 산다.
 */
export type ClassSort = "name" | "name_desc" | "students" | "students_asc" | "teacher" | "teacher_desc";

/**
 * 수업 상태 필터 — 화면의 '상태' 배지와 **같은 세 갈래**다(page.tsx TableView/CardsView와 한 몸).
 *  · operating(운영) = `is_active` && `closed_at` 없음  · ended(종강) = `is_active` && `closed_at` 있음
 *  · retired(폐지)   = `is_active=false`                · all(전체)  = 안 좁힘
 * ⚠️ 아래 레거시 `active`와 **다른 축**이다 — `active:"active"`는 종강 반까지 포함한다(is_active만 본다).
 *    새 코드는 이쪽(status)을 쓸 것. 실측(2026-08-27 injaewon): 전체 152 = 운영 105 · 종강 5 · 폐지 42.
 */
export type ClassStatusFilter = "all" | "operating" | "ended" | "retired";

export type ClassListFilters = {
  subject?: string; // "all" | "math" | ...
  teacherId?: string; // "all" | uuid
  day?: string; // "all" | "mon" | ... (getClassesList 단일 요일 — 레거시)
  days?: string[]; // 다중 요일(getClassesPage) — 하나라도 포함하면 매칭(ijw 의미)
  q?: string;
  /** @deprecated is_active만 보는 옛 축(종강 반 포함) — 새 코드는 `status`를 쓸 것. */
  active?: "all" | "active" | "closed";
  /** 상태(운영/종강/폐지/전체) — 수업목록 기본값은 화면에서 "operating"으로 넘긴다. */
  status?: ClassStatusFilter;
  /** 구분(정규/특강) — 수업목록 열 머리. 판정은 `matchesClassKind`(= 알약과 같은 `isSpecialLecture`). */
  kind?: ClassKindFilter;
  sort?: ClassSort; // 미지정 시 "name"
};

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type ClassScheduleSlot = {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:MM
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  // 교시별 오버라이드 — null이면 반의 담임/기본 강의실 상속.
  teacherId: string | null;
  classroomId: string | null;
  /** 표시 라벨(시트 원문). 자리(LAB·JJ)는 `teacherId`가 비고 여기에만 있다. */
  slotTeacherLabel: string | null;
  /** LAB '따로 수업(*LAB)' 표식(0271a) — 못 읽었으면 false(`ClassDetail.labSeparateKnown`으로 가른다). */
  labSeparate: boolean;
};

export type ClassDetail = {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomId: string | null;
  classroomName: string | null;
  isActive: boolean;
  /** 종강일(0059a) — 있으면 종강. is_active=false(폐지)와 구분. */
  closedAt: string | null;
  /** 특강(0133a) 토글값 **그대로**. ⚠️ "이 반이 특강인가"는 이름 폴백까지 보는 `isSpecialLecture()`로 판정할 것. */
  isSpecial: boolean;
  /** '수업보고서 미발송'(0174a) 토글값. 판정 = `isReportOptout()`(이름 폴백 없음 — 컬럼이 전부다). */
  reportOptout: boolean;
  /** 영어 프로그램 구분(0176a) — 영어 반이 아니거나 미분류면 null. */
  englishTrack: EnglishTrack | null;
  notes: string | null;
  bgColor: string | null;
  // 강사 인수인계 예약(0044a) — pendingTeacherId 있으면 예약 존재.
  pendingTeacherId: string | null;
  pendingTeacherName: string | null;
  pendingTeacherDate: string | null;
  pendingTeacherReason: string | null;
  scheduleSlots: ClassScheduleSlot[];
  /** '따로 수업(*LAB)' 표식을 읽었는가(0271a 미적용·조회 실패면 false — 수정 폼이 토글을 숨긴다). */
  labSeparateKnown: boolean;
  /** **오늘** 명단에 있는 학생 수(휴원 포함, 미래 시작 제외). */
  studentCount: number;
  /** 아직 시작 안 한 수강 수 — 배너가 "N/N부터 합류 N명"으로 보여 준다(숫자를 잃지 않는다). */
  upcomingCount: number;
};

export type ClassStudentRow = {
  englishName?: string | null;
  enrollmentId: string;
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  enrolledAt: string;
  /** 저장된 종료 경계. 일반 종료는 당일까지, 반이동은 전날까지 수강한다. null=무기한. */
  endDate: string | null;
  isTransferred: boolean;
  isTransferredIn: boolean;
  /**
   * 오늘 기준 위치 — `upcoming`(아직 안 옴) · `active` · `leaving`(끝날 날짜가 잡힘).
   * 🔴 화면은 `upcoming`을 **오늘 명단과 섞어 세지 말 것**(그러면 아직 안 온 학생이 재원생이 된다).
   */
  phase: Exclude<EnrollmentPhase, "ended">;
  onHold: boolean;
  /** 분리등원 요일 — []=수업 전 요일 등원, ['mon','thu']=월·목만. */
  attendanceDays: string[];
};

export type ClassAttendanceStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * 목록·카운트용 "오늘 명단에 있는 수강인가" — 상세와 **같은 규약**(eligibility 단일 소스).
 *
 * 🔴 예전엔 `.is("end_date", null)`로 셌다. 그러면 두 방향으로 틀린다:
 *    ① 미래 시작(예약된 합류)이 **오늘 인원에 섞이고** ② 종료일이 잡힌 학생이 아직 다니는데 **빠진다**.
 *    ②는 반이동을 예약하는 순간 생기므로(옛 수강에 미래 종료일이 붙는다) 목록과 상세가 갈렸다.
 */
type EnrollmentCountRow = {
  class_id: string;
  start_date: string | null;
  end_date: string | null;
  is_transferred: boolean | null;
};

function onRosterRow(
  e: { start_date?: string | null; end_date?: string | null; is_transferred?: boolean | null },
  today: string,
): boolean {
  if (!e.start_date) return false;
  return isEnrollmentOnRosterOn(
    {
      startDate: String(e.start_date),
      endDate: e.end_date ? String(e.end_date) : null,
      isTransferred: e.is_transferred ?? false,
    },
    today,
  );
}

/** PostgREST .or()/ilike 안전화 — 구분자·와일드카드 제거(한글/공백 보존). search/queries.ts와 동일. */
function sanitizeTerm(q: string): string {
  return q.replace(/[%,()*\\]/g, " ").trim();
}

/**
 * 반 검색어 → PostgREST `.or()` 조각들. **반이름 · 강사명 · 강의실명**을 함께 본다.
 *
 * 강사·강의실은 classes에 이름이 없고 id만 있으므로, 이름으로 먼저 id를 풀어 `in.(…)`으로 좁힌다
 * (null 강사·null 강의실 반이 안전하게 빠진다).
 *
 * ⚠️ **강의실은 두 곳에 산다** — `classes.classroom_id`(반 기본)와 `class_schedules.classroom_id`
 * (교시별 오버라이드). 실측(injaewon) 반 164개 중 기본 지정 152개, 슬롯 지정 55개이고 그중 **6개는
 * 기본이 비어 슬롯에만** 있다. 반 기본만 보면 그 6개가 검색에서 조용히 사라지므로 둘 다 본다.
 * (교실뷰의 "실효 강의실 = 슬롯 ?? 반 기본"과 같은 관점.)
 *
 * id 목록 크기: 강의실 22개 · 슬롯 지정 반 55개 규모라 `.or()` URL이 안전하다. 테넌트가 커져
 * 수백 단위가 되면 이 방식은 414 위험이 있으니 그때는 별도 조회+교집합으로 바꿀 것([[#53]]).
 */
async function classSearchOrParts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  term: string,
): Promise<string[]> {
  // 강사·강의실 이름 조회는 서로 독립 → 병렬(B4).
  const [teacherRes, roomRes] = await Promise.all([
    supabase.from("users").select("id").ilike("display_name", `%${term}%`),
    supabase.from("classrooms").select("id").ilike("name", `%${term}%`),
  ]);
  const teacherIds = (teacherRes.data ?? []).map((u) => u.id);
  const roomIds = (roomRes.data ?? []).map((r) => r.id);

  const parts = [`class_name.ilike.%${term}%`];
  if (teacherIds.length) parts.push(`teacher_id.in.(${teacherIds.join(",")})`);
  if (roomIds.length) {
    parts.push(`classroom_id.in.(${roomIds.join(",")})`);
    const slotRows = await fetchInChunks<{ class_id: string }>(roomIds, (chunk) =>
      supabase.from("class_schedules").select("class_id").in("classroom_id", chunk),
    );
    const slotClassIds = [...new Set(slotRows.map((s) => s.class_id))];
    if (slotClassIds.length) parts.push(`id.in.(${slotClassIds.join(",")})`);
  }
  return parts;
}

/** class_schedules 행들 → classId별 (요일→최초 시작시각) 맵. */
function buildDaySlots(
  scheds: { class_id: string; day_of_week: string; start_time?: string | null }[] | null,
): Map<string, Map<string, string | null>> {
  const byClass = new Map<string, Map<string, string | null>>();
  for (const s of scheds ?? []) {
    const m = byClass.get(s.class_id) ?? new Map<string, string | null>();
    const start = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = m.get(s.day_of_week);
    if (prev === undefined) m.set(s.day_of_week, start);
    else if (start !== null && (prev === null || start < prev)) m.set(s.day_of_week, start);
    byClass.set(s.class_id, m);
  }
  return byClass;
}

/**
 * 목록 요일 칩의 재료 — **지금 유효한 교시**(valid_from ≤ 오늘 ≤ valid_to)를 우선한다.
 * 유효 행이 하나도 없으면(운영 종료·시작 전) 지난 배치라도 보여주되 `stale`로 표시한다([[#88]]).
 */
function buildDayView(
  scheds:
    | {
        class_id: string;
        day_of_week: string;
        start_time?: string | null;
        valid_from?: string | null;
        valid_to?: string | null;
      }[]
    | null,
  today: string,
  /** 반 id → 종강일. 종강일이 지난 반은 **종강일 기준**으로 판정한다 — 종강이 배치를 그날로 닫아서(2026-11-02),
   *  오늘 기준이면 유효 행이 0이라 옛 학기 요일까지 합친 흐린 칸이 된다(적대 리뷰 2026-11-02 · [[#88]]). */
  closedAt?: ReadonlyMap<string, string | null>,
): { live: Map<string, Map<string, string | null>>; any: Map<string, Map<string, string | null>> } {
  const rows = scheds ?? [];
  const isLive = (r: { class_id: string; valid_from?: string | null; valid_to?: string | null }) => {
    const closed = closedAt?.get(r.class_id)?.slice(0, 10);
    const day = closed && closed < today ? closed : today;
    const to = r.valid_to ? String(r.valid_to).slice(0, 10) : null;
    if (to && to < day) return false;
    const from = r.valid_from ? String(r.valid_from).slice(0, 10) : null;
    return !(from && from > day);
  };
  return { live: buildDaySlots(rows.filter(isLive)), any: buildDaySlots(rows) };
}

/** (요일→시작시각) 맵 → 요일순 정렬된 ClassDaySlot[]. */
function sortedDaySlots(m: Map<string, string | null> | undefined): ClassDaySlot[] {
  return [...(m?.entries() ?? [])]
    .sort((a, b) => DOW_ORDER.indexOf(a[0]) - DOW_ORDER.indexOf(b[0]))
    .map(([day, start]) => ({ day, start }));
}

export async function getClassesList(options?: ClassListFilters): Promise<ClassListRow[]> {
  const supabase = await createClient();

  let qb = supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, closed_at, is_special, notes, teacher_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .order("class_name");

  if (options?.subject && options.subject !== "all") qb = qb.eq("subject", options.subject);
  if (options?.teacherId && options.teacherId !== "all") qb = qb.eq("teacher_id", options.teacherId);
  if (options?.active === "active") qb = qb.eq("is_active", true);
  if (options?.active === "closed") qb = qb.eq("is_active", false);
  if (options?.q) {
    // 페이지 목록(getClassesPage)과 **같은 검색 범위**(반이름·강사·강의실)로 통일 — 같은 검색어가
    // 화면에 따라 다른 결과를 내지 않게. sanitizeTerm도 여기서만 빠져 있던 것을 맞춘다.
    const term = sanitizeTerm(options.q);
    if (term) qb = qb.or((await classSearchOrParts(supabase, term)).join(","));
  }

  const { data: classes } = await qb;
  if (!classes) return [];

  // 학생 수 카운트 — 표시 중인 반 id로 청크 조회. 전건 fetch는 ~1000행에서 잘려(#54) 학생 수가 과소집계되고,
  // 표시 안 하는 반 enrollment까지 끌어와 낭비된다. getClassesPage와 동일 패턴(fetchInChunks).
  const classIds = classes.map((c) => c.id);
  const counts = new Map<string, number>();
  if (classIds.length > 0) {
    const enrollments = await fetchInChunks<EnrollmentCountRow>(classIds, (chunk) =>
      supabase
        .from("enrollments")
        .select("class_id, start_date, end_date, is_transferred")
        // 🔴 **이미 끝난 수강은 서버에서 자른다**(B2·[[#54]]). 필터를 빼면 전 이력을 끌어와
        //    (실측 1,338행 vs 유효 602행) 100개 반 청크가 1000행 캡에 걸려 **학생 수가 조용히
        //    과소집계**된다. 종료 판정 자체는 아래 onRosterRow가 하므로 여기선 넉넉히 자르기만 한다.
        .or(`end_date.is.null,end_date.gte.${kstToday()}`)
        .in("class_id", chunk),
    );
    const rosterToday = kstToday();
    for (const e of enrollments) {
      if (!onRosterRow(e, rosterToday)) continue;
      counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    }
  }

  /**
   * 요일 + 시작시각 — 청크 **안에서 페이징**한다(`fetchAllPagedInChunks`).
   *
   * 🔴 왜 페이징인가(2026-09-07 실측): `class_schedules`는 운영 이력을 함께 담아 반 하나가 12행씩
   *    갖는다([[#88]]). 청크(100반)가 **1,042행**을 요청했는데 PostgREST는 1,000행에서 **에러 없이
   *    잘랐고**([[#54]]), 꼬리에 걸린 반은 슬롯이 **한 행도 안 와서** 요일 칸이 `—`가 됐다
   *    (원장 제보 *"이 반은 왜 스케줄이 안나와?"* — 중등E_중2 정규 B. 반 상세엔 화·금이 멀쩡히 떴다).
   * ⚠️ **누가 잘리는지는 로그인 세션마다 다르다** — RLS(`tenant_id = auth_tenant_id()`)가 붙으면
   *    실행 계획이 달라져 버려지는 꼬리가 바뀐다(service_role 5반 vs 세션 9반). 그래서 "내 화면엔
   *    멀쩡한데"가 성립한다. 청크 크기를 줄이는 건 답이 아니다 — 이 표는 가져오기마다 자란다.
   */
  let dayView = {
    live: new Map<string, Map<string, string | null>>(),
    any: new Map<string, Map<string, string | null>>(),
  };
  if (classIds.length > 0) {
    const scheds = await fetchAllPagedInChunks<{
      class_id: string;
      day_of_week: string;
      start_time: string | null;
      valid_from: string | null;
      valid_to: string | null;
    }>(classIds, (chunk, from, to) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, valid_from, valid_to")
        .in("class_id", chunk)
        // 🔴 페이지 경계가 흔들리지 않게 **유일 키로 정렬**한다 — 정렬이 없으면 페이지가 겹치거나 빈다.
        .order("id", { ascending: true })
        .range(from, to),
    );
    // 운영 기간이 지난 교시를 현재처럼 그리지 않는다([[#88]]) — 유효 행 우선, 없으면 흐리게.
    dayView = buildDayView(
      scheds,
      kstToday(),
      new Map(classes.map((c) => [c.id, (c as { closed_at?: string | null }).closed_at ?? null])),
    );
  }

  let rows = classes.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
      | { name?: string }
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: c.teacher_id,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      closedAt: (c as { closed_at?: string | null }).closed_at ?? null,
      isSpecial: (c as { is_special?: boolean | null }).is_special ?? false,
      studentCount: counts.get(c.id) ?? 0,
      // 유효 교시가 있으면 그것만, 하나도 없으면 지난 배치를 흐리게(daysStale) — 통째로 감추면 요일 칸이 빈다.
      days: sortedDaySlots(dayView.live.get(c.id) ?? dayView.any.get(c.id)),
      daysStale: !dayView.live.get(c.id) && !!dayView.any.get(c.id),
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  // 요일 필터 (in-memory)
  if (options?.day && options.day !== "all") {
    rows = rows.filter((r) => r.days.some((d) => d.day === options.day));
  }

  return rows;
}

/**
 * 수업목록 Stat 카드용 경량 집계 — head:true 카운트만(행 fetch 없이, 전건 enrollment 절단도 회피).
 * totalSeats = end_date null 활성 수강 총합.
 *
 * ⚠️ `active`("운영 중" 카드)는 **종강 반을 뺀다**(is_active && closed_at is null) — 목록 기본 필터
 * (status=operating)와 같은 판정이어야 "운영 중 110개"인데 목록은 105개인 어긋남이 안 생긴다
 * (2026-08-27 실측: 종강 5개가 카드에만 섞여 있었다).
 */
export async function getClassesStats(): Promise<{ total: number; active: number; totalSeats: number }> {
  const supabase = await createClient();
  /**
   * 🔴 **보이지 않는 '보강' 반(0241a)은 여기서도 뺀다** — 목록은 이미 빼는데(getClassesPage) 카드만 세면
   *    "전체 반 167"인데 상태 '전체'로 본 목록은 164개다(실측 2026-09-07: 강사당 1개씩 3개, 재리뷰 2026-09-04).
   * ⚠️ 컬럼 이름을 이 쿼리에 끼워 넣지 않는다 — id 목록을 따로 받아 뺀다(0241a 미적용이면 400, [[#95]]).
   *    조회 실패는 빈 배열이라 fail-open(옛 숫자 그대로, 화면은 산다).
   */
  // 강사 스코프(teacher·겸직 강사뷰면 본인 담당 반·그 반 수강만 — 목록과 일치)와 보강 반 id는
  // 서로 안 기다린다(B4) — 둘 다 아래 쿼리를 만드는 재료다.
  const [tId, poolIds] = await Promise.all([effectiveTeacherId(), listMakeupPoolClassIds()]);
  const scope = tId ? await getTeacherReadScope(tId) : null;
  if (scope && scope.classIds.length === 0) return { total: 0, active: 0, totalSeats: 0 };
  const classBase = () => {
    let q = supabase.from("classes").select("*", { count: "exact", head: true });
    if (scope) q = q.in("id", scope.classIds);
    if (poolIds.length > 0) q = q.not("id", "in", `(${poolIds.join(",")})`);
    return q;
  };
  // 🔴 `is("end_date", null)`만 보면 두 방향으로 틀린다(2026-08-29): 반이동을 예약하면 **아직 다니는**
  //    학생에게 미래 종료일이 붙어 빠지고, 예약된 합류(미래 시작)는 오늘 수에 섞인다.
  //    ⚠️ 여기는 집계라 행을 받지 않는다(B2 — `count:exact head:true`) → `is_transferred`를 행마다 볼 수
  //    없어 목록·상세의 `onRosterRow`와 **완전히 같지는 않다**: 전출 종료일이 '오늘'인 행 하나가 더
  //    세어질 수 있다(전출은 당일 배타). 총합 지표의 오차 1 vs 전건 fetch를 견준 선택이다.
  const seatToday = kstToday();
  let seatsQuery = supabase
    .from("enrollments")
    .select("*", { count: "exact", head: true })
    .lte("start_date", seatToday)
    .or(`end_date.is.null,end_date.gte.${seatToday}`);
  if (tId) {
    const { classIds } = await getTeacherReadScope(tId);
    if (classIds.length === 0) return { total: 0, active: 0, totalSeats: 0 };
    seatsQuery = seatsQuery.in("class_id", classIds);
  }
  const [total, active, seats] = await Promise.all([
    classBase(),
    classBase().eq("is_active", true).is("closed_at", null),
    seatsQuery,
  ]);
  for (const result of [total, active, seats]) {
    if (result.error) throw new Error(`수업 집계 실패: ${result.error.message}`);
  }
  return { total: total.count ?? 0, active: active.count ?? 0, totalSeats: seats.count ?? 0 };
}


/**
 * 수업목록 — 모집단이 작아(학원 단위 수업 ~수백) 매칭 전건을 가져와 메모리에서 정렬·페이지네이션한다.
 * 학생수·강사명 정렬은 파생/조인 필드라 PostgREST 부모행 order로 표현 불가 → 전건 후 메모리 정렬이 정답.
 * subject/teacher/q는 SQL, 요일(다중)은 class_schedules에서 "선택 요일 중 하나라도" 가진 수업 id로 먼저 좁힌다.
 * 학생수·요일 enrich는 매칭 수업 id를 청크로 조회(414/1000행 절단 회피, lib/supabase/batch).
 */
export async function getClassesPage(
  options: ClassListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: ClassListRow[]; total: number }> {
  const supabase = await createClient();
  const sort: ClassSort = options.sort ?? "name";

  // 강사 스코프: teacher(또는 겸직-강사뷰)면 본인 담당 반만(옵션 teacherId 무시하고 강제).
  const forcedTeacherId = await effectiveTeacherId();

  // 요일(다중) 필터 — 선택 요일 중 하나라도 운영하는 수업 id로 좁힘(ijw "하나라도 포함" 의미).
  let dayClassIds: string[] | null = null;
  const days = (options.days ?? []).filter(Boolean);
  if (days.length > 0) {
    // 🔴 **무페이징 select 금지**(B2) — 이 결과는 whitelist라, 1000행에서 잘리면 **에러 없이 반이 사라진다**.
    //    실측 2026-09-04: `class_schedules` 1,356행에 평일 요일당 200~285행이라 **요일을 4개 이상 고르면**
    //    조합이 1,000을 넘어(월화수목 1,012) 일부 반이 목록에서 조용히 빠졌다(적대적 재리뷰).
    //    옛 필터바는 한 번에 하나씩 고르는 모양이라 잘 안 밟혔고, 열 머리 다중 선택이 그 길을 열었다.
    const scheds = await fetchAllPaged<{ class_id: string }>((from, to) =>
      supabase
        .from("class_schedules")
        .select("class_id")
        .in("day_of_week", days)
        // 페이지 경계가 흔들리지 않게 결정적 정렬(같은 값이 두 페이지에 걸치지 않도록 id tie-break).
        .order("class_id")
        .order("id")
        .range(from, to),
    );
    dayClassIds = [...new Set(scheds.map((s) => s.class_id))];
    if (dayClassIds.length === 0) return { rows: [], total: 0 };
  }

  let qb = supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, closed_at, is_special, notes, teacher_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .order("class_name");
  if (options.subject && options.subject !== "all") qb = qb.eq("subject", options.subject);
  if (forcedTeacherId) {
    const scope = await getTeacherReadScope(forcedTeacherId);
    if (scope.classIds.length === 0) return { rows: [], total: 0 };
    qb = qb.in("id", scope.classIds);
  } else if (options.teacherId && options.teacherId !== "all") {
    qb = qb.eq("teacher_id", options.teacherId);
  }
  if (options.active === "active") qb = qb.eq("is_active", true);
  if (options.active === "closed") qb = qb.eq("is_active", false);
  // 상태(운영/종강/폐지) — 화면 배지와 같은 판정. `closed_at`은 종강일이라 **있으면 종강**이다.
  if (options.status === "operating") qb = qb.eq("is_active", true).is("closed_at", null);
  if (options.status === "ended") qb = qb.eq("is_active", true).not("closed_at", "is", null);
  if (options.status === "retired") qb = qb.eq("is_active", false);
  if (options.q) {
    const term = sanitizeTerm(options.q);
    if (term) {
      // 반이름 OR 강사명 OR 강의실명 — 단일 소스(classSearchOrParts).
      qb = qb.or((await classSearchOrParts(supabase, term)).join(","));
    }
  }
  if (dayClassIds) qb = qb.in("id", dayClassIds);

  const { data: classes, error } = await qb;
  if (error) throw new Error(`getClassesPage: ${error.message}`);
  /**
   * 🔴 **보이지 않는 '보강' 반은 목록에서 뺀다**(0241a). 그 반은 `is_active=false`라 기본(운영) 목록엔
   *    애초에 안 들어오지만, **'폐지'·'전체'를 고르면 보인다** — 원장 지시가 *"어디에서도 확인할 수 없는"*
   *    이라 그 한 곳을 여기서 막는다.
   * ⚠️ 쿼리 필터가 아니라 **뺄 id를 따로 받아 거른다** — 0241a 미적용일 때 컬럼 이름이 select·필터에
   *    들어가면 PostgREST 400으로 이 화면이 통째로 죽는다([[#95]]). 조회 실패는 빈 배열이라 fail-open.
   */
  const poolIds = new Set(await listMakeupPoolClassIds());
  // 구분(정규/특강) — 이름 폴백이 있어 SQL로 옮기지 않는다(`isSpecialLecture` 한 벌, 알약과 같은 판정). 전건을 이미 받아
  // 메모리에서 정렬·페이지를 나누는 조회라 여기서 거르면 총수·쪽수가 같이 맞고, 뒤의 수강·교시 조회도 그만큼 준다.
  const kind = options.kind ?? "all";
  const matched = (classes ?? []).filter(
    (c) =>
      !poolIds.has(c.id as string) &&
      matchesClassKind(kind, {
        isSpecial: (c as { is_special?: boolean | null }).is_special,
        className: c.class_name as string,
      }),
  );
  const classIds = matched.map((c) => c.id);

  // 학생수·요일 — 매칭 수업 id를 청크로 조회(전건 .in() 414 회피). 요일은 청크 **안에서도 페이징**한다 —
  // 이유는 위 getClassesList의 같은 조회 주석(1,042행 요청 → 1,000행 침묵 절단 → 요일 칸 `—`).
  const counts = new Map<string, number>();
  let dayView = {
    live: new Map<string, Map<string, string | null>>(),
    any: new Map<string, Map<string, string | null>>(),
  };
  if (classIds.length > 0) {
    const [enrollments, scheds] = await Promise.all([
      fetchInChunks<EnrollmentCountRow>(classIds, (chunk) =>
        supabase
        .from("enrollments")
        .select("class_id, start_date, end_date, is_transferred")
        // 🔴 **이미 끝난 수강은 서버에서 자른다**(B2·[[#54]]). 필터를 빼면 전 이력을 끌어와
        //    (실측 1,338행 vs 유효 602행) 100개 반 청크가 1000행 캡에 걸려 **학생 수가 조용히
        //    과소집계**된다. 종료 판정 자체는 아래 onRosterRow가 하므로 여기선 넉넉히 자르기만 한다.
        .or(`end_date.is.null,end_date.gte.${kstToday()}`)
        .in("class_id", chunk),
      ),
      fetchAllPagedInChunks<{
        class_id: string;
        day_of_week: string;
        start_time: string | null;
        valid_from: string | null;
        valid_to: string | null;
      }>(classIds, (chunk, from, to) =>
        supabase
          .from("class_schedules")
          .select("class_id, day_of_week, start_time, valid_from, valid_to")
          .in("class_id", chunk)
          // 🔴 페이지 경계가 흔들리지 않게 **유일 키로 정렬**(위 getClassesList와 같은 규약).
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const rosterToday = kstToday();
    for (const e of enrollments) {
      if (!onRosterRow(e, rosterToday)) continue;
      counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    }
    // 운영 기간이 지난 교시를 현재처럼 그리지 않는다([[#88]]).
    dayView = buildDayView(
      scheds,
      kstToday(),
      new Map(matched.map((c) => [c.id, (c as { closed_at?: string | null }).closed_at ?? null])),
    );
  }

  const rows = matched.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
      | { name?: string }
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: c.teacher_id,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      closedAt: (c as { closed_at?: string | null }).closed_at ?? null,
      isSpecial: (c as { is_special?: boolean | null }).is_special ?? false,
      studentCount: counts.get(c.id) ?? 0,
      // 유효 교시가 있으면 그것만, 하나도 없으면 지난 배치를 흐리게(daysStale) — 통째로 감추면 요일 칸이 빈다.
      days: sortedDaySlots(dayView.live.get(c.id) ?? dayView.any.get(c.id)),
      daysStale: !dayView.live.get(c.id) && !!dayView.any.get(c.id),
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  /**
   * 🔴 요일 필터는 **화면의 요일 칩과 같은 집합**으로 다시 좁힌다 — 위 whitelist는 `class_schedules`의
   *    만료 행까지 매칭해서, 끝난 토요일 배치 하나 때문에 지금은 금요일만 도는 반이 `요일: 토`에 섰다
   *    (실측 2026-09-07: **활성 반 2개** — `고등E_고1 특별 S`(칩 금)·`고등E_고2 심화`(칩 수·금)가 토에 걸렸다).
   *    칩은 유효 배치가 있으면 그것만 그리므로(`buildDayView`), 판정을 그 값 하나로 모은다([[#88]]).
   * ⚠️ 어긋남이 이만큼 작은 건 칩에 **폴백**이 있어서다 — 유효 배치가 하나도 없는 반(종강·미시작)은 지난 배치를
   *    그대로 그리므로(`daysStale`) 그 반은 여전히 그 요일로 걸린다. 그건 거짓이 아니라 "흐리게 보여 주는 사실"이다.
   * ⚠️ whitelist는 상위집합이라(칩 요일 ⊆ 전체 배치 요일) 이 필터로 **빠지는 반은 없다** — 좁히는 건
   *    "그 요일에 지금 안 도는 반"뿐이다. whitelist 자체는 남긴다(`classes` 조회를 미리 좁혀 준다).
   */
  const dayRows = days.length > 0 ? rows.filter((r) => r.days.some((d) => days.includes(d.day))) : rows;

  sortClassRows(dayRows, sort);

  const total = dayRows.length;
  const from = (page - 1) * pageSize;
  return { rows: dayRows.slice(from, from + pageSize), total };
}

/**
 * 담임 **배정** 선택지 — 반을 맡을 수 있는 재직자(새 반·반 수정·강사 인수인계 공용).
 *
 * ⚠️ 화이트리스트가 좁히는 건 **재직 여부**(`status=active`)다 — 퇴직자가 '새 반 담임' 후보로 뜨는 걸
 *    막는 게 목적. **역할로 좁히는 게 아니다.** 여기서 `admin`(관리자)이 빠져 있어 실제로 반을 맡고 있는
 *    관리자 3명이 배정·인수인계 드롭다운에서 통째로 사라졌다(2026-08-03 원장 제보 "강사 인수인계에
 *    허은진이 없음" — 실측 김민주 3반·정유진 2반·허은진 1반 = 활성 6반, 전부 admin/active).
 *    역할 목록은 [`ASSIGNABLE_TEACHER_ROLES`](../../../lib/permissions.ts) 단일 소스 — 여기 새로 적지 말 것.
 *
 * ⚠️ 역할을 더 좁히고 싶어지면 **화면에서 안 보이는 것과 데이터에서 없는 것은 다르다**는 걸 먼저 볼 것 —
 *    담임은 이미 데이터에 있고, 후보에서 빼도 그 반은 그대로다. 대신 그 반을 수정하면 컨트롤드 select가
 *    빈 칸이 되어 저장 한 번에 담임이 NULL로 지워진다(반 수정 페이지의 '현재 담임 고정' 참조).
 */
export async function getClassTeacherOptions(): Promise<
  { id: string; name: string; subjects: string[]; bgColor: string | null; textColor: string | null }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    // bg_color·text_color = 강사 퍼스널 색(0054a) — 반 수정 '주간 스케줄' 격자가 강사 칸을 이 색으로 칠한다(원장 2026-09-18).
    .select("id, display_name, system_role, subjects, bg_color, text_color")
    .in("system_role", [...ASSIGNABLE_TEACHER_ROLES])
    .eq("status", "active")
    .order("display_name");
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.display_name,
    subjects: u.subjects ?? [],
    bgColor: u.bg_color ?? null,
    textColor: u.text_color ?? null,
  }));
}

/**
 * 수업목록 **강사 필터** 선택지 — 배정 가능한 사람(위 `getClassTeacherOptions`) **∪ 실제로 담임인 사람**.
 *
 * 왜 배정용과 갈라놨나(2026-07-22 원장 제보 "수업목록에서 왜 허은진이 필터에 없지?"):
 *   배정용은 **재직자**(`status=active`)로 좁혀야 한다 — 안 그러면 **퇴직자가 '새 반 담임' 후보로 뜬다**.
 *   그런데 필터는 정반대 질문이다: "이 목록에 실제로 있는 담임이 누구냐". 배정용을 그대로 필터에 쓰면
 *   **퇴직 처리됐거나 역할이 다른 담임의 반이 필터에서 통째로 사라진다**
 *   (실측 4명·12반: 김민주 7 · 김태건 viewer 2 · 신명진 manager/inactive 2 · 허은진 1).
 *
 * 🔴 그때 고친 건 **필터 한 쪽뿐**이었다. 같은 뿌리(배정용 화이트리스트에 `admin` 누락)가 배정·인수인계
 *    드롭다운에 그대로 살아 있어서, 정확히 6주 뒤 같은 사람으로 같은 제보가 다시 왔다
 *    (2026-08-03 "강사 인수인계에 허은진이 없음"). **한 화면에서 증상을 지웠다고 원인이 사라진 게 아니다** —
 *    같은 값을 읽는 형제 표면(필터·배정·인수인계·새 반)을 함께 확인할 것.
 *
 * ⚠️ 이 함수는 **필터 전용**이다. 담임 배정·변경 드롭다운에 쓰지 말 것(퇴직자가 후보로 샌다).
 */
export async function getClassTeacherFilterOptions(): Promise<
  { id: string; name: string; subjects: string[] }[]
> {
  const supabase = await createClient();
  const [assignable, assignedRows] = await Promise.all([
    getClassTeacherOptions(),
    // 활성 반의 실제 담임 id + 그 반 과목 — 역할·재직상태 무관(데이터에 있는 그대로).
    // ⚠️ 결과를 distinct·whitelist로 쓰므로 **무페이징 select 금지**(B2: PostgREST 1000행 silent 절단).
    //    잘리면 담임이 또 조용히 사라진다 — 이 함수가 고치려던 바로 그 증상이다.
    fetchAllPaged<{ teacher_id: string; subject: string }>((from, to) =>
      supabase
        .from("classes")
        .select("teacher_id, subject")
        .eq("is_active", true)
        .not("teacher_id", "is", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  // 담임 → 실제로 맡고 있는 반의 과목 집합.
  const taught = new Map<string, Set<string>>();
  for (const r of assignedRows) {
    const id = r.teacher_id;
    (taught.get(id) ?? taught.set(id, new Set()).get(id)!).add(r.subject);
  }
  const known = new Set(assignable.map((t) => t.id));
  const missing = [...taught.keys()].filter((id) => !known.has(id));
  // 화이트리스트 밖 담임만 보강 조회(대개 0~5명이지만 id가 수십 될 수 있어 청크 — B3).
  const extra = missing.length
    ? await fetchInChunks<{ id: string; display_name: string; subjects: string[] | null }>(
        missing,
        (chunk) => supabase.from("users").select("id, display_name, subjects").in("id", chunk),
      )
    : [];
  // ⚠️ 과목은 `users.subjects` **∪ 실제 담당반 과목**. 필터바가 과목 선택 시 이 목록으로 강사를 다시
  //    좁히는데(teacherTeaches), users.subjects가 비었거나 어긋난 담임은 그 순간 또 사라진다 — 같은 결함의
  //    반복이라 여기서 막는다(프로필 값이 아니라 **실제로 맡은 반**이 진실).
  const withTaught = (id: string, subjects: string[]) => [...new Set([...subjects, ...(taught.get(id) ?? [])])];
  return [
    ...assignable.map((t) => ({ ...t, subjects: withTaught(t.id, t.subjects) })),
    ...extra.map((u) => ({
      id: u.id,
      name: u.display_name,
      subjects: withTaught(u.id, u.subjects ?? []),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function getClassDetail(id: string): Promise<ClassDetail | null> {
  // 🔴 상세 열람 스코프의 **유일한 초크포인트** — 반 상세 페이지와 반 수정 페이지가 여기로 모인다
  //    (표면마다 다시 쓰면 한쪽만 조여진다, [[#77]]). 강사(scoped)는 담임 ∪ 교시 담당 ∪ 임시 위임뿐.
  //    종전엔 스코프가 없어 강사가 주소만 알면 학원 전체 반의 명단·메모·출결을 열 수 있었다.
  if (!(await canViewClassDetail(id))) return null;
  const supabase = await createClient();
  const today = kstToday();
  const { data: c } = await supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, closed_at, is_special, report_optout, english_track, notes, bg_color,
       teacher_id, classroom_id,
       pending_teacher_id, pending_teacher_date, pending_teacher_reason,
       teacher:teacher_id ( display_name ),
       pending_teacher:pending_teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .eq("id", id)
    .single();

  if (!c) return null;

  // 독립 두 쿼리 병렬(2 round-trip → 1).
  // ⚠️ 재원생 수는 `count:exact head:true`로 못 센다 — 전출 배타 판정(isEnrollmentEndedOn)이 행마다
  // `is_transferred`를 봐야 해서다. 대신 **한 반의 현재·미래 수강만** 좁게 받아 센다(집계용 전건 아님).
  // `is null`만 세던 옛 코드는 오늘이 마지막 날인 학생을 빠뜨려 `수강 중인 학생` 목록과 갈렸다.
  const [{ data: schedules }, { data: enrollRows }, labSeparateIds] = await Promise.all([
    supabase
      .from("class_schedules")
      .select(
        "id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label",
      )
      .eq("class_id", id)
      .order("day_of_week")
      .order("start_time"),
    supabase
      .from("enrollments")
      .select("start_date, end_date, is_transferred")
      .eq("class_id", id)
      .or(`end_date.is.null,end_date.gte.${today}`),
    // '따로 수업(*LAB)' 표식(0271a) — **따로 fail-soft로**. 위 교시 조회에 컬럼을 끼우면 0271a 전엔 오류가
    // 삼켜져 수정 폼이 빈 격자로 열리고, 그대로 저장하면 그 반의 교시가 전부 마감된다([[#95]]).
    loadLabSeparateIds(supabase, { kind: "class", classId: id }),
  ]);
  // 🔴 시작일도 봐야 한다(2026-08-29): 미래 시작 수강이 이미 DB에 있어서(실측 28건) 종료만 보면
  //    **9/1부터 올 학생이 오늘 재원생 수에 섞인다**. 판정은 enrollmentPhaseOn 단일 소스.
  //    예정분은 따로 세어 배너가 "9/1부터 합류 N명"으로 보여 준다(숫자를 잃지 않는다).
  const phases = (enrollRows ?? []).map((e) =>
    enrollmentPhaseOn(
      {
        startDate: String(e.start_date),
        endDate: (e.end_date as string | null) ?? null,
        isTransferred: (e.is_transferred as boolean | null) ?? false,
      },
      today,
    ),
  );
  const studentCount = phases.filter((p) => p === "active" || p === "leaving").length;
  const upcomingCount = phases.filter((p) => p === "upcoming").length;

  const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
    | { display_name?: string }
    | undefined;
  const pendingTeacher = (Array.isArray(c.pending_teacher) ? c.pending_teacher[0] : c.pending_teacher) as
    | { display_name?: string }
    | undefined;
  const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
    | { name?: string }
    | undefined;

  return {
    id: c.id,
    className: c.class_name,
    subject: c.subject,
    teacherId: c.teacher_id,
    teacherName: teacher?.display_name ?? null,
    classroomId: c.classroom_id,
    classroomName: room?.name ?? null,
    isActive: c.is_active,
    closedAt: (c as { closed_at?: string | null }).closed_at ?? null,
    isSpecial: (c as { is_special?: boolean | null }).is_special ?? false,
    reportOptout: (c as { report_optout?: boolean | null }).report_optout ?? false,
    // 영어 프로그램 구분(0176a) — 미분류(null)는 폼에서 기본값으로 떨어진다(english-track.ts).
    englishTrack: readEnglishTrack(c as { english_track?: string | null }),
    notes: c.notes,
    bgColor: (c as { bg_color?: string | null }).bg_color ?? null,
    pendingTeacherId: (c as { pending_teacher_id?: string | null }).pending_teacher_id ?? null,
    pendingTeacherName: pendingTeacher?.display_name ?? null,
    pendingTeacherDate: (c as { pending_teacher_date?: string | null }).pending_teacher_date ?? null,
    pendingTeacherReason:
      (c as { pending_teacher_reason?: string | null }).pending_teacher_reason ?? null,
    scheduleSlots: (schedules ?? []).map((s) => ({
      id: s.id,
      dayOfWeek: s.day_of_week as DayOfWeek,
      startTime: String(s.start_time).slice(0, 5),
      endTime: String(s.end_time).slice(0, 5),
      validFrom: s.valid_from,
      validTo: s.valid_to,
      teacherId: (s.teacher_id as string | null) ?? null,
      classroomId: (s.classroom_id as string | null) ?? null,
      // 자리(LAB·JJ)는 teacher_id가 비고 이 라벨에만 있다 — 폼이 드롭다운을 그 자리로 열려면 필요.
      slotTeacherLabel: (s.slot_teacher_label as string | null) ?? null,
      labSeparate: labSeparateIds?.has(String(s.id)) ?? false,
    })),
    /**
     * 표식을 읽었는가 — false면 수정 폼이 토글을 **숨기고 값을 안 보낸다**(서버가 기존 값을 승계).
     * 모른 채로 "꺼짐"을 보내면 멀쩡히 켜 둔 표식이 저장 한 번에 꺼진다.
     */
    labSeparateKnown: labSeparateIds !== null,
    studentCount,
    upcomingCount,
  };
}

/**
 * 이 반에 **오늘 기준 아직 수강 중인** 학생.
 *
 * ⚠️ `end_date is null`로 자르지 말 것 — 종료 규약은 [isEnrollmentEndedOn](../../enrollments/eligibility.ts)
 * 단일 소스이고, **일반 종료는 종료일 당일까지 재원**(반이동만 당일 배타)이다. `is null`만 보면
 * *오늘이 마지막 날인 학생*이 통째로 사라진다 — 실측(2026-08-04) `중등M 개별 JJ3M`은 시간표 셀에
 * 5명이 뜨는데 반 상세는 "활성 재원생이 없습니다"였다(5명 전부 `end_date=오늘`, 전출 아님).
 * 개별(JJ·BS) 반은 하루짜리 수강이 정상이라 이 갭이 그대로 "학생 0명"으로 보인다.
 */
export async function getClassStudents(classId: string): Promise<ClassStudentRow[]> {
  const supabase = await createClient();
  const today = kstToday();
  const { data } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, end_date, on_hold, is_transferred, is_transferred_in, attendance_days,
       student:student_id ( id, name, english_name, grade, school )`,
    )
    .eq("class_id", classId)
    // 종료일 당일도 재원이라 `>= today`까지 받아 두고, 전출 배타 판정은 아래 단일 소스에 맡긴다.
    // (한 반의 현재·미래 수강만이라 행이 적다 — 집계용 전건 fetch가 아니다.)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order("start_date", { ascending: false });

  if (!data) return [];

  return data
    .map((e): ClassStudentRow | null => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string; name: string; english_name: string | null; grade: string | null; school: string | null }
        | undefined;
      if (!s) return null;
      const endDate = (e.end_date as string | null) ?? null;
      const isTransferred = (e.is_transferred as boolean | null) ?? false;
      // 반이동(전출)은 종료일 당일에 이미 새 반 소속 — 그날 이 반 명단에 남기면 두 반에 겹쳐 뜬다.
      // 🔴 시작일도 본다(2026-08-29): 미래 시작 수강이 이미 DB에 있어(실측 28건) 종료만 보면
      //    **아직 안 온 학생이 오늘 명단에 선다**. 예정분은 `phase`로 표시해 화면이 구분해 보여 준다.
      const phase = enrollmentPhaseOn({ startDate: String(e.start_date), endDate, isTransferred }, today);
      if (phase === "ended") return null;
      return {
        phase,
        enrollmentId: e.id,
        studentId: s.id,
        name: s.name,
        englishName: s.english_name ?? null,
        grade: s.grade,
        school: s.school,
        enrolledAt: e.start_date,
        endDate,
        isTransferred,
        isTransferredIn: !!e.is_transferred_in,
        onHold: e.on_hold,
        attendanceDays: (e.attendance_days as string[] | null) ?? [],
      } satisfies ClassStudentRow;
    })
    .filter((r): r is ClassStudentRow => r !== null);
}

/**
 * 강의실 자동배정 입력 — 활성 반(슬롯·학생수·현재 강의실) + 전체 강의실.
 * 학생수·슬롯은 매칭 반 id를 청크 조회(전건 .in() 414 / 1000행 절단 회피, #53·#54).
 * 순수 배정 알고리즘([../lib/classroom-assign])이 이 데이터로 미리보기를 만든다.
 */
export async function getClassroomAssignmentData(): Promise<ClassroomAssignData> {
  const supabase = await createClient();
  const [{ data: cls }, { data: rooms }] = await Promise.all([
    supabase
      .from("classes")
      .select("id, class_name, subject, classroom_id")
      .eq("is_active", true)
      .order("class_name"),
    // 자동배정은 **새로 방을 고르는** 기능 → 보관(숨김)된 강의실은 후보에서 뺀다(0182a).
    supabase.from("classrooms").select("id, name, capacity").is("archived_at", null).order("name"),
  ]);

  const classes = cls ?? [];
  const classIds = classes.map((c) => c.id);
  const counts = new Map<string, number>();
  const slotsByClass = new Map<string, { day: string; start: string; end: string }[]>();

  if (classIds.length > 0) {
    const [enrollments, scheds] = await Promise.all([
      fetchInChunks<EnrollmentCountRow>(classIds, (chunk) =>
        supabase
        .from("enrollments")
        .select("class_id, start_date, end_date, is_transferred")
        // 🔴 **이미 끝난 수강은 서버에서 자른다**(B2·[[#54]]). 필터를 빼면 전 이력을 끌어와
        //    (실측 1,338행 vs 유효 602행) 100개 반 청크가 1000행 캡에 걸려 **학생 수가 조용히
        //    과소집계**된다. 종료 판정 자체는 아래 onRosterRow가 하므로 여기선 넉넉히 자르기만 한다.
        .or(`end_date.is.null,end_date.gte.${kstToday()}`)
        .in("class_id", chunk),
      ),
      fetchInChunks<{
        class_id: string;
        day_of_week: string;
        start_time: string;
        end_time: string;
      }>(classIds, (chunk) =>
        supabase
          .from("class_schedules")
          .select("class_id, day_of_week, start_time, end_time")
          .in("class_id", chunk)
          // ⚠️ 만료 슬롯 제외(실측 1,068행 중 480행이 지난 배치). 안 거르면 자동배정이 이제 안 하는
          // 3~7월 교시를 "그 시간에 수업 중"으로 보고 **없는 강의실 충돌**을 만든다.
          // 시작 전(valid_from 미래) 슬롯은 남긴다 — 곧 자리가 필요하니 배정 계획에 들어가야 한다.
          .or(liveValidTo(kstToday())),
      ),
    ]);
    const rosterToday = kstToday();
    for (const e of enrollments) {
      if (!onRosterRow(e, rosterToday)) continue;
      counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    }
    for (const s of scheds) {
      const arr = slotsByClass.get(s.class_id) ?? [];
      arr.push({
        day: s.day_of_week,
        start: String(s.start_time).slice(0, 5),
        end: String(s.end_time).slice(0, 5),
      });
      slotsByClass.set(s.class_id, arr);
    }
  }

  return {
    classes: classes.map((c) => ({
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      studentCount: counts.get(c.id) ?? 0,
      currentRoomId: c.classroom_id ?? null,
      slots: slotsByClass.get(c.id) ?? [],
    })),
    rooms: (rooms ?? []).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
  };
}

export async function getClassAttendanceStats(
  classId: string,
  days = 30,
): Promise<ClassAttendanceStats> {
  const supabase = await createClient();
  // 🔴 날짜 컬럼(`session_date`)과 비교하는 값이라 **KST 오늘**에서 센다 — UTC로 뽑으면 한국 새벽에
  //    창이 하루 밀려 출결 집계가 화면과 어긋난다.
  const since = addDays(kstToday(), -days);

  const rawRows = await fetchAllPaged<{
    id: string;
    student_id: string;
    class_id: string;
    session_date: string;
    slot_start: string | null;
    recorded_at: string;
    status: string;
  }>((from, to) =>
    supabase
      .from("attendance_records")
      .select("id, student_id, class_id, session_date, slot_start, recorded_at, status")
      .eq("class_id", classId)
      .gte("session_date", since)
      .order("id")
      .range(from, to),
  );
  // 🔴 정정 줄은 최신 하나만 — 원본 줄을 세면 고친 칸이 분자·분모에 두 번 들어갔다(점검 2026-09-28).
  const rows = effectiveAttendanceRecords(rawRows);
  const total = rows.length;
  const present = rows.filter((r) => r.status === "present").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const late = rows.filter((r) => r.status === "late").length;
  const excused = rows.filter((r) => r.status === "excused").length;
  return {
    total,
    present,
    absent,
    late,
    excused,
    rate: attendanceRate(attendedCount({ present, late }), total),
  };
}
