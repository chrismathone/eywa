import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday, kstMinutesOfDay } from "@/lib/date-kst";
import { recentExitWindow } from "@/features/withdrawals/window";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import {
  dateOfDowInWeek,
  slotLiveOnDate,
  weekBoundsOf,
  weekEndOf,
  weekSundayOf,
  shiftDays,
} from "../lib/week";
import { getTeacherAsOfIndex } from "@/features/classes/server/teacher-as-of-queries";
import {
  getClassNameAsOfIndex,
  getClassNameAsOfIndexWith,
} from "@/features/classes/server/class-name-as-of-queries";
import { resolveClassNameAsOf } from "@/features/classes/class-name-as-of";
import { resolveTeacherAsOf } from "@/features/classes/teacher-as-of";
// 보고서 과목 판정 규칙은 RPC(0150a) SQL에 내장 — 규칙 문서·테스트는 lib/report-subject.ts가 담당(동기 유지).
import { compareStudentLines } from "../lib/student-sort";
import { teachingClassIdsInWeek } from "../lib/teacher-classes";
import { isLabSeparateSlot } from "../lib/lab-separate";
import { loadLabSeparateIds } from "@/features/classes/server/lab-separate";
import { reportError } from "@/lib/observability/report-error";
import { pairScheduledMoves, type ScheduledMoveRow } from "../lib/scheduled-move";
import type { TeacherColorMap } from "../lib/class-grid";
import {
  buildTeacherLabelMap,
  buildTeacherNicknameMap,
  resolveTeacherLabel,
  resolveSlotTeacherLabel,
  resignedTeacherLabels,
  type TeacherLabelMap,
  type TeacherNicknameMap,
} from "../lib/teacher-label";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import {
  enrollmentAttendsOnDay,
  isEnrollmentActiveOn,
  isEnrollmentEndedOn,
} from "@/features/enrollments/eligibility";

/** 오늘(YYYY-MM-DD, 기준일 기본값) — KST 기준(서버 UTC라 새벽 시간대 하루 밀림 방지). */
const todayStr = (): string => kstToday();


/**
 * 세션 없는 호출(cron 자동 시트 반영 등)용 DB 주입 — admin 클라이언트 + **명시 tenant 필터**.
 * 미주입(기본) = 기존 그대로 쿠키 세션 createClient(RLS가 테넌트 격리). 주입 시 이 파일의 각 쿼리에
 * `.eq("tenant_id", …)`가 붙는다(admin은 RLS 우회라 필터 누락 = 교차 테넌트 유출 — edutrix-sync cron 선례).
 */
export type TimetableDb = { supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string };

/**
 * 강사 라벨 → 표시 이름 맵(영문닉네임 → 한글 이름). 규칙·예외는 [`teacher-label.ts`](../lib/teacher-label.ts).
 *
 * ⚠️ 이 맵은 **시간표 슬롯이 만들어지는 지점에서** 적용된다(아래 getScheduleSlots·비수업 블록·라벨 목록).
 * 라벨이 곧 강사뷰 열 식별자라, 화면 컴포넌트마다 따로 바꾸면 수업과 블록이 다른 열로 갈라진다.
 * React `cache` — 한 요청에서 여러 쿼리가 같이 쓴다.
 */
export const getTeacherLabelMap = cache(async (db?: TimetableDb): Promise<TeacherLabelMap> => {
  return buildTeacherLabelMap(await getTeacherNameRows(db));
});

/** 닉네임 보유자 행 — 라벨 맵과 닉네임 맵이 **같은 조회**를 나눠 쓴다(요청당 왕복 1회, B4). */
type TeacherNameRow = { displayName: string | null; englishName: string | null; active: boolean };

async function readTeacherNameRows(db: TimetableDb | undefined, strict: boolean): Promise<TeacherNameRow[]> {
  const supabase = db?.supabase ?? (await createClient());
  let q = supabase.from("users").select("display_name, english_name, status").not("english_name", "is", null);
  if (db) q = q.eq("tenant_id", db.tenantId);
  const { data, error } = await q;
  if (error) {
    // 🔴 화면(시간표·학생 상세·ECS)은 **fail-soft**(감사 E5 리뷰) — 강사 전원이 매일 여는 핫패스라 조회 한 번
    //    실패로 화면 전체가 오류로 넘어가면 안 된다. 원문 라벨로 그리고 로그를 남긴다(열이 둘로 갈릴 수 있음 = 표시만).
    //    쓰기(시트 가져오기)는 strict — 잘못 해석한 라벨을 DB에 남기지 않는다.
    if (strict) throw error;
    console.error("[timetable] 강사 닉네임 조회 실패 — 원문 라벨로 표시", error);
    return [];
  }
  return (data ?? []).map((u) => ({
      displayName: (u.display_name as string | null) ?? null,
      englishName: (u.english_name as string | null) ?? null,
      active: (u.status as string | null) === "active",
  }));
}

const getTeacherNameRows = cache((db?: TimetableDb) => readTeacherNameRows(db, false));

/** 쓰기 경로(시트 가져오기) 전용 — 조회 실패 시 던진다(캐시 없음). */
export async function getTeacherLabelMapStrict(db?: TimetableDb): Promise<TeacherLabelMap> {
  return buildTeacherLabelMap(await readTeacherNameRows(db, true));
}

/**
 * 표시 이름 → 영어 닉네임 맵(**한국인 강사만**) — 통합뷰 담임 줄·강사뷰 강사 헤더가 `한글이름(영어이름)`으로
 * 적을 때 쓴다. 규칙·원어민 판정은 [`teacher-label.ts`](../lib/teacher-label.ts) `buildTeacherNicknameMap`.
 * ⚠️ 이 맵은 **표기 전용**이다 — 슬롯 라벨(열 식별자)엔 절대 적용하지 말 것(강사뷰 열이 쪼개진다).
 */
export const getTeacherNicknameMap = cache(async (db?: TimetableDb): Promise<TeacherNicknameMap> => {
  return buildTeacherNicknameMap(await getTeacherNameRows(db));
});

/**
 * 강사 라벨 → 저장된 색 맵(통합뷰 셀·담임색). display_name·english_name(영문닉네임 슬롯 라벨) 둘 다 키.
 * users(소수·테넌트 RLS)에서 색 있는 행만. 미해결 라벨은 렌더에서 teacherColor 해시 폴백.
 * ⚠️ 라벨을 한글 이름으로 바꿔도 **display_name 키가 이미 있어** 색은 그대로 붙는다(양쪽 키 유지 이유).
 */
export async function getTeacherColorMap(db?: TimetableDb): Promise<TeacherColorMap> {
  const supabase = db?.supabase ?? (await createClient());
  let q = supabase
    .from("users")
    .select("display_name, english_name, bg_color, text_color")
    .not("bg_color", "is", null);
  if (db) q = q.eq("tenant_id", db.tenantId);
  // 실패는 로그만 남기고 해시 색으로 그린다(감사 E5 리뷰 — 시간표 핫패스를 오류 화면으로 무너뜨리지 않는다).
  const { data, error } = await q;
  if (error) {
    console.error("[timetable] 강사 색 조회 실패 — 기본 색으로 표시", error);
    return {};
  }
  const map: TeacherColorMap = {};
  for (const u of data ?? []) {
    if (!u.bg_color) continue;
    const c = { bg: u.bg_color as string, text: (u.text_color as string | null) ?? "#121212" };
    if (u.display_name) map[u.display_name as string] = c;
    if (u.english_name) map[u.english_name as string] = c;
  }
  return map;
}

/**
 * 과목별 강사뷰 강사 라벨(distinct) — owner 과목 운영 '가로줄 제외 강사' 칩 선택지.
 * 라벨 = 자리 → 교시 담당자 FK → 시트 라벨 → 담임(teacher-grid의 teacherOf와 같은 표시값).
 * 활성 반만. RLS 테넌트 격리. distinct/whitelist 용도라 fetchAllPaged(1000행 절단 방지, B2).
 */
export async function getTeacherLabelsBySubject(): Promise<Record<string, string[]>> {
  const supabase = await createClient();
  // 선택지도 화면(강사뷰 열)과 **같은 해석**을 거쳐야 한다 — 칩은 "Hannah"인데 열은 "이현이"면 못 고른다.
  const labelMap = await getTeacherLabelMap();
  const rows = await fetchAllPaged<{
    slot_teacher_label: string | null;
    slotTeacher?: { display_name?: string } | { display_name?: string }[] | null;
    class: unknown;
  }>((from, to) =>
    supabase
      .from("class_schedules")
      .select(
        `slot_teacher_label, slotTeacher:teacher_id ( display_name ), class:class_id!inner ( subject, is_active, teacher:teacher_id ( display_name ) )`,
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
    const label = resolveSlotTeacherLabel(r.slot_teacher_label, r.slotTeacher, labelMap)
      ?? resolveTeacherLabel(teacher?.display_name ?? null, labelMap);
    if (!label) continue;
    (bySubject.get(klass.subject) ?? bySubject.set(klass.subject, new Set()).get(klass.subject)!).add(label);
  }
  const out: Record<string, string[]> = {};
  for (const [subj, set] of bySubject) out[subj] = [...set].sort((a, b) => a.localeCompare(b, "ko"));
  return out;
}

export type ScheduleSlot = {
  editorNote?: string; editorLocked?: boolean;
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
  /** LAB '따로 수업(*LAB)' 표식(0271a) — **켜진 LAB 교시에만** true가 실린다(없으면 꺼짐). 표시 전용. */
  labSeparate?: true;
  slotRoomLabel: string | null;
  // 강의실 FK(교실뷰 버킷팅) — 실효 강의실 = slotRoomId ?? classRoomId(overlap-detect와 같은 우선순위).
  // 표시 이름은 classroomName/slotRoomLabel이 계속 담당(라벨은 시트 원문이라 FK 이름과 다를 수 있다).
  slotRoomId: string | null;
  classRoomId: string | null;
  // 반 헤더색(ijw bgColor/textColor) — 통합뷰 수업명 헤더. null=과목색 폴백.
  classBgColor: string | null;
  classTextColor: string | null;
  // 강사 인수인계 예약(0044a `classes.pending_teacher_id`) — 있으면 셀 배경 틴트 + hover 상세. null=예약 없음.
  pendingHandover: { teacherName: string | null; date: string | null } | null;
  // 정규/특강 구분(0133a) — 판정 단일소스 isSpecialLecture(컬럼 우선, 없으면 반 이름 폴백).
  // 화면은 이 boolean만 쓴다(이름 매칭 재구현 금지 — 급여와 판정이 갈리면 시간표엔 특강인데 급여엔 아닌 반이 생긴다).
  isSpecialLecture: boolean;
  /**
   * 영어 프로그램 구분(0176a `classes.english_track`) — 통합뷰 '프로그램' 보기 필터의 근거. 비영어 반은 null.
   * 🔴 **컬럼이 유일한 진실**(반 이름으로 추측 금지 — 이름을 고치면 분류가 조용히 뒤집힌다).
   * ⚠️ 보기 필터일 뿐이라 명단·집계·돈에 안 닿는다([`english-track.ts`](../../classes/english-track.ts)).
   */
  englishTrack: string | null;
  /**
   * 이 칸의 날짜에 **예약된 이름 변경이 이미 적용돼 있으면** 그 전 이름(=오늘 이름). 없으면 undefined.
   * 🔴 `className`은 그때 **불릴 이름**이다 — 미래 주를 열었을 때 오늘 이름이 뜨면 "그 반이 그대로구나"로
   *    읽힌다(원장 2026-08-29). 화면은 이 값으로 "9/1부터 바뀐 이름"임을 밝힌다.
   */
  classNameBefore?: string;
  /** 그 이름이 되는 날(`YYYY-MM-DD`). `classNameBefore`와 짝이다. */
  classNameChangeDate?: string;
  /**
   * 비수업 블록(감독·준비·회의·연차·쉬는 시간, 0138a)이면 그 종류. 수업 슬롯은 항상 undefined.
   * ⚠️ **강사뷰 렌더 전용** — 반이 아니라서 classId가 없고, 학생·수강·청구·급여 어디에도 안 걸린다.
   * 다른 뷰·집계는 이 값이 있는 항목을 세지 말 것(수업 수가 부풀어 보인다).
   */
  blockKind?: "supervise" | "prep" | "break" | "meeting" | "leave" | "other";
};

type SlotClassRef = {
  id?: string;
  class_name?: string;
  subject?: string;
  bg_color?: string | null;
  text_color?: string | null;
  is_active?: boolean | null;
  closed_at?: string | null;
  is_special?: boolean | null;
  english_track?: string | null;
  pending_teacher_id?: string | null;
  pending_teacher_date?: string | null;
  classroom_id?: string | null;
  teacher?: { display_name?: string } | { display_name?: string }[];
  pendingTeacher?: { display_name?: string } | { display_name?: string }[];
  classroom?: { name?: string } | { name?: string }[];
};
type SlotRow = {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  class_id: string;
  slot_teacher_label: string | null;
  slotTeacher?: { display_name?: string } | { display_name?: string }[] | null;
  slot_room_label: string | null;
  classroom_id: string | null;
  class?: SlotClassRef | SlotClassRef[];
};

async function fetchSlots(
  referenceDate: string,
  db?: TimetableDb,
  opts?: {
    /**
     * 셀 헤더용 근사 카운트 쿼리(enrollment 전건)를 생략 — getWeeklyScheduleWithStudents 경로 전용.
     * 그 경로는 바로 뒤에 **정확한 로스터**를 어차피 조회하므로 같은 데이터를 두 번 당길 이유가 없다
     * (2026-07-27 성능: 매 렌더 −1 왕복·−600행). studentCount는 그쪽에서 로스터 재원 수로 다시 채운다.
     * ⚠️ 생략하면 studentCount=0으로 나가니, 이 옵션은 **직후에 카운트를 재기입하는 호출부만** 쓸 것.
     */
    skipCounts?: boolean;
    /**
     * 미래 주 칸을 **그 주에 불릴 반 이름**으로 그린다(예약된 이름 변경 반영, 원장 2026-08-29).
     *
     * 🔴 **기본값 false = 사람이 보는 화면만 켠다.** 시트·엑셀은 반 이름이 곧 **매칭 키**라서, 아직
     *    DB에 없는 이름(9/1부터 쓸 `PL1a`)이 적히면 그 시트를 되읽는 **구조 가져오기가 그 반을 "DB에
     *    없는 이름"으로 버리고 배치를 통째로 마감한다**(master-cutover의 `--rename` 주석과 같은 함정).
     *    새 소비처는 기본값(꺼짐)을 그대로 두고, 사람이 읽는 화면일 때만 켤 것.
     */
    futureNames?: boolean;
  },
): Promise<ScheduleSlot[]> {
  const supabase = db?.supabase ?? (await createClient());
  const weekEnd = weekEndOf(referenceDate);
  const scheduleWeek = weekBoundsOf(referenceDate);
  // 그 주와 하루라도 겹치는 스케줄만: valid_from ≤ 일요일 + valid_to ≥ 월요일.
  // 🔴 valid_to를 기준일과 비교하면 목요일 조회에서 수요일에 끝난 행을 먼저 버린다. 그러면 화요일 칸은
  // 옛 행도 새 행도 남지 않는다. 주 전체 겹침을 가져온 뒤 아래 slotLiveOnDate가 각 요일 날짜로 하나만 고른다.
  // 폐지(is_active=false)된 반은 `!inner` 조인 + class.is_active 필터로 전체 주에서 제외.
  // 종강(class.closed_at)된 반은 종강일 이후 주에서만 제외(이전 주엔 수강이력으로 표시) — JS에서 거른다.
  // ⚠️ 무페이징 select 금지(B2) — 이 쿼리는 시간표 화면의 **뿌리**라, 1000행에서 조용히 잘리면 반이
  // 통째로 화면에서 사라진다. 익스포터 쪽 쌍둥이 쿼리와 동일하게 fetchAllPaged + id unique tie-break.
  // 🔴 라벨맵·스케줄·카운트는 서로 독립 → Promise.all(B4, 2026-07-27 성능 — 직렬이면 왕복이 합산된다).
  //    라벨맵은 강사 라벨 해석의 단일 지점(원장 2026-07-27) — 여기서 한글 이름으로 바꿔 내보내면
  //    기본뷰·통합뷰·강사뷰·hover가 전부 따라온다(컴포넌트별 해석 금지 — 열 식별자가 쪼개진다).
  const [labelMap, data, enrollments, labSeparateIds] = await Promise.all([
    getTeacherLabelMap(db),
    fetchAllPaged<SlotRow>((from, to) => {
      let q = supabase
        .from("class_schedules")
        .select(
          `id, day_of_week, start_time, end_time, class_id, slot_teacher_label, slot_room_label, classroom_id,
       valid_from, valid_to, slotTeacher:teacher_id ( display_name ),
       class:class_id!inner (
         id, class_name, subject, bg_color, text_color, is_active, closed_at, is_special, english_track,
         pending_teacher_id, pending_teacher_date, classroom_id,
         teacher:teacher_id ( display_name ),
         pendingTeacher:pending_teacher_id ( display_name ),
         classroom:classroom_id ( name )
       )`,
        )
        .eq("class.is_active", true)
        .lte("valid_from", scheduleWeek.end)
        .or(`valid_to.is.null,valid_to.gte.${scheduleWeek.start}`);
      if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — RLS 우회라 명시 격리
      return q.order("start_time").order("id").range(from, to);
    }),
    // as-of-week 재원 카운트 — 그 주 끝(weekEnd)까지 시작했고 그 주 끝에 아직 안 끝난 enrollment.
    // (정확한 재원/대기/퇴원 분류는 getWeeklyScheduleWithStudents. 여기선 셀 헤더 카운트용 근사.) #54 페이지네이션.
    opts?.skipCounts
      ? Promise.resolve([] as { class_id: string }[])
      : fetchAllPaged<{ class_id: string }>((from, to) => {
          let q = supabase
            .from("enrollments")
            .select("class_id")
            .lte("start_date", weekEnd)
            .or(`end_date.is.null,end_date.gt.${weekEnd}`);
          if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
          // order 없는 .range()는 OFFSET 페이지가 흔들려 행이 중복·누락될 수 있다(카운트가 틀어짐) → id tie-break.
          return q.order("id").range(from, to);
        }),
    // LAB '따로 수업(*LAB)' 표식(0271a) — 🔴 **위 뿌리 조회에 컬럼을 끼우지 않는다**([[#95]]: 전원이 매일 여는
    //    시간표다). 켜진 행 id만 따로·fail-soft로 받는다(null = 모름 → 표식 없이 그린다).
    loadLabSeparateIds(supabase, { kind: "window", from: scheduleWeek.start, to: scheduleWeek.end, ...(db ? { tenantId: db.tenantId } : {}) }),
  ]);

  // 종강 반: closed_at < 기준일이면 그 주엔 이미 종강 → 제외(closed_at ≥ 기준일인 과거 주엔 표시).
  // + 🔴 **날짜 단위 유효 판정**(2026-08-04): 위 SQL 필터는 "그 주와 겹치는 행"까지 넉넉히 가져온다.
  //   담당·강의실이 바뀐 주에는 옛 행(어제까지)과 새 행(오늘부터)이 **둘 다** 그 주와 겹쳐 같은 칸이
  //   두 번 그려진다. 요일 칸의 **실제 날짜**로 다시 걸러 그날 살아 있던 배치 하나만 남긴다
  //   (월·화는 옛 담당, 수요일부터 새 담당 — 실제로 일어난 그대로).
  const visible = data.filter((r) => {
    const k = (Array.isArray(r.class) ? r.class[0] : r.class) as { closed_at?: string | null } | undefined;
    const closedAt = k?.closed_at ?? null;
    if (closedAt && closedAt < referenceDate) return false;
    return slotLiveOnDate(
      {
        dayOfWeek: r.day_of_week as string,
        validFrom: (r as { valid_from?: string | null }).valid_from ?? null,
        validTo: (r as { valid_to?: string | null }).valid_to ?? null,
      },
      referenceDate,
    );
  });

  const counts = new Map<string, number>();
  for (const e of enrollments) {
    counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
  }

  // 🔴 지난 주를 볼 때는 **그때 담임**으로 되살린다(원장 2026-08-04 "이전주차가 되면 이전담임이 나오는걸로").
  //    담임은 반 단위 속성이라 시간 축이 없어서, 그냥 두면 지난 주에도 현재 담임이 나온다(활성 반 62개는
  //    슬롯에 담당이 아예 없어 슬롯 분할로도 안 잡힌다). 인수인계 로그(사실) → 그 달 보고서 작성자(추정) 순.
  //    ⚠️ 이번 주·미래는 현재 담임이 정답이라 **조회 자체를 안 한다**(왕복 0).
  const asOfIndex = weekSundayOf(referenceDate) < todayStr() ? await getTeacherAsOfIndex() : null;
  // 🔴 **미래 주는 그 주의 반 이름으로 그린다**(원장 2026-08-29: *"선생님들이 미래조회시에 지금 반으로
  //    보면 착각할 수 있을거같은데"*). 담임 되살리기(위)의 거울상 — 그쪽은 지난 주를 기록으로, 이쪽은
  //    다음 주를 예약으로. ⚠️ 지난 주엔 예약이 닿지 않으므로 **조회 자체를 안 한다**(왕복 0).
  // 🔴 게이트는 담임(위)과 **정확히 대칭**이어야 한다 — `weekSundayOf`(그 주의 일요일)를 쓴다.
  //    ⚠️ `weekEndOf`는 주의 끝이 아니라 **ref+6 롤링 창**이라(week.ts 주석) 지난 주에서도 오늘을
  //    넘겨 참이 된다 = 예약이 닿지도 않는 과거 주에서 조회를 한 번 더 하게 된다.
  const nameIndex =
    opts?.futureNames && weekSundayOf(referenceDate) >= todayStr()
      ? db
        ? await getClassNameAsOfIndexWith(db.supabase, db.tenantId)
        : await getClassNameAsOfIndex()
      : null;

  return visible.map((r) => {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | {
          id?: string;
          class_name?: string;
          subject?: string;
          bg_color?: string | null;
          text_color?: string | null;
          is_special?: boolean | null;
          english_track?: string | null;
          pending_teacher_id?: string | null;
          pending_teacher_date?: string | null;
          classroom_id?: string | null;
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
      // 조인 미스(스케줄이 가리키는 반이 삭제됨) 폴백. ⚠️ 화면에 그대로 나가는 값이라 "?" 같은 기호 대신
      // 사람이 읽는 한글로(UI에 raw 값 노출 금지 규약). subject는 어떤 과목 칩과도 안 맞아 필터 뷰에선
      // 자연히 빠지고, 여기 라벨은 전체 뷰에서 셀 제목으로 보인다.
      ...(() => {
        // 셀 날짜 기준 — 주 중간에 적용일이 끼면 그 요일부터 새 이름이다(주 단위로 뭉뚱그리지 않는다).
        const d = nameIndex ? dateOfDowInWeek(referenceDate, r.day_of_week as string) : null;
        const renamed =
          nameIndex && d
            ? resolveClassNameAsOf(nameIndex, r.class_id as string, d, klass?.class_name ?? null)
            : null;
        return renamed
          ? { className: renamed.name, classNameBefore: renamed.before, classNameChangeDate: renamed.date }
          : { className: klass?.class_name ?? "(삭제된 반)" };
      })(),
      subject: klass?.subject ?? "",
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      ...(() => {
        // 셀 날짜 기준으로 그때 담임을 찾는다(주 단위가 아니라 날짜 — 주 중간 교체도 요일마다 갈린다).
        const cellDate = asOfIndex ? dateOfDowInWeek(referenceDate, r.day_of_week as string) : null;
        const asOf =
          asOfIndex && cellDate ? resolveTeacherAsOf(asOfIndex, r.class_id as string, cellDate) : null;
        return {
          teacherName: asOf
            ? resolveTeacherLabel(asOf.name, labelMap)
            : resolveTeacherLabel(teacher?.display_name ?? null, labelMap),
          ...(asOf?.inferred ? { teacherInferred: true } : {}),
        };
      })(),
      classroomName: room?.name ?? null,
      studentCount: counts.get(r.class_id) ?? 0,
      slotTeacherLabel: resolveSlotTeacherLabel(r.slot_teacher_label, r.slotTeacher, labelMap),
      // 켜진 교시에만 싣는다(시간표 페이로드는 전원이 매일 받는다 — 모든 슬롯에 false를 얹지 않는다).
      ...(isLabSeparateSlot((r.slot_teacher_label as string | null) ?? null, labSeparateIds?.has(String(r.id)))
        ? { labSeparate: true as const }
        : {}),
      slotRoomLabel: (r.slot_room_label as string | null) ?? null,
      slotRoomId: (r.classroom_id as string | null) ?? null,
      classRoomId: (klass?.classroom_id as string | null) ?? null,
      classBgColor: klass?.bg_color ?? null,
      classTextColor: klass?.text_color ?? null,
      pendingHandover: klass?.pending_teacher_id
        ? {
            teacherName: resolveTeacherLabel(pending?.display_name ?? null, labelMap),
            date: (klass?.pending_teacher_date as string | null) ?? null,
          }
        : null,
      // 판정 단일소스 — 컬럼(0133a) 우선, 없으면 반 이름 폴백. 급여 autoSalaryGroup과 이름 규칙을 공유한다.
      isSpecialLecture: isSpecialLecture({
        isSpecial: (klass?.is_special as boolean | null) ?? null,
        className: (klass?.class_name as string | null) ?? null,
      }),
      englishTrack: (klass?.english_track as string | null) ?? null,
    };
  });
}

export async function getWeeklySchedule(): Promise<ScheduleSlot[]> {
  return fetchSlots(todayStr());
}

/** Read-only practice snapshot: week placements without report/roster payloads. RLS stays enabled. */
export async function getScheduleSlotsForWeek(referenceDate: string): Promise<ScheduleSlot[]> {
  return fetchSlots(referenceDate, undefined, { skipCounts: true, futureNames: true });
}

import type { TimetableReservedLine } from "@/features/attendance/makeup-reservation";
import type { TimetableSplitLine } from "@/features/class-splits/lines";

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
  /** 등록 31~60일(신입 빨강 다음 단계) — 신입과 상호배타. */
  isRecent?: boolean;
  /** 수강 시작일(YYYY-MM-DD). ijw 익스포터의 30/60일 신입색·정렬 가중치 계산용(재원/대기만). */
  enrollmentDate?: string | null;
  /** 타 반에서 이동해 들어온 학생(셀에서 초록 강조). */
  isTransferredIn?: boolean;
  /**
   * **예약된 반 이동**(이미 저장돼 그날 저절로 일어날 것) — 원장 2026-09-09 *"연보라색 계열로 '이동 대기'"*.
   *
   * 🔴 저장 **전**의 큐(브라우저에만 있는 것)와 다르다 — 이건 DB에 들어 있고 '취소'로 사라지지 않는다.
   *    화면은 색을 같게(연보라) 두되 **문구로 가른다**([`moveWaitTitle`](../lib/move-note.ts)).
   * ⚠️ 상대 반 이름은 **화면에 뜬 반 안에서만** 찾는다 — 못 찾으면 null(모르는 것을 지어내지 않는다).
   */
  movingOut?: { on: string; className: string | null };
  /** 이 반으로 **들어올** 예정(그때까지는 대기) — `movingOut`의 반대쪽. */
  movingIn?: { on: string; className: string | null };
  /** 분리등원 요일 — []=전 요일, ['mon','thu']=월목만. 비어있지 않으면 셀에 배지로 표시. */
  attendanceDays?: string[];
  /** 영문 이름(ijw englishName) — 통합뷰 명단에 "이름 (English)"로 표시. 없으면 미표시. */
  englishName?: string | null;
  /**
   * 학생별 최근 교재 — **`latestReport`와 같은 수업보고서 행**에서 뽑는다(0089a `lesson_reports.textbook`).
   * 학부모에게 나가는 수업보고서의 '교재'와 항상 같은 값 = 화면·발송물 불일치 없음.
   */
  latestTextbook?: { name: string; date: string | null } | null;
  /** 학생별 최근 진도(ijw 학생 hover의 "[진도]" 줄) — lesson_reports 최신 1건. */
  latestReport?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
  /**
   * 자리(랩실) **교시 고정**(0255a `seat_period_pins`) 표식 문구 — 있으면 이름을 파란 밑줄 이탤릭으로
   * 그리고 이 문장이 툴팁이 된다(`랩실 교시 고정 · 목 16:20`). 판정·서식은
   * [`seat-pin-mark.ts`](../lib/seat-pin-mark.ts) 단일 소스 — 화면에서 다시 만들지 말 것.
   */
  seatPinNote?: string;
  /** LAB '따로 수업(*LAB)' 배정(0271b) — 이름을 LAB 파랑 + 이탤릭으로. 판정 = lab-separate.ts `applyLabSeparateMarks`. */
  labSeparate?: true;
};
export type ScheduleSlotWithStudents = ScheduleSlot & {
  students: StudentLine[];
  /**
   * 그 요일 칸 날짜의 **보강 예약**(0264a, 표시 전용 — `attachReservedLines`가 기본뷰 직전에만 얹는다).
   * 🔴 `students`에 섞지 않는다(인원·드래그·엑셀·이동 판정이 그 배열을 센다).
   */
  reserved?: TimetableReservedLine[];
  /**
   * 그 요일 칸의 **수업 나누기**(0351a, 표시 전용 — `attachSplitLines`가 기본뷰 직전에만 얹는다).
   * 🔴 `students`에 섞지 않는다(위 `reserved`와 같은 이유 — 나눔은 수강이 아니다).
   */
  splits?: TimetableSplitLine[];
};

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
/**
 * 학생 id 목록 → 짧고 **안정적인** 캐시 키 조각. 300개 uuid를 그대로 키에 넣으면 키가 11KB가 되고,
 * 순서만 달라도 다른 키가 되어 적중률이 떨어진다 → 정렬 후 djb2 해시.
 * (해시 충돌은 캐시 오적중을 뜻하므로 길이도 함께 넣어 충돌 확률을 더 낮춘다.)
 */
function studentIdsKey(ids: readonly string[]): string {
  let h = 5381;
  for (const id of [...ids].sort()) {
    for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  }
  return `${ids.length}-${h.toString(36)}`;
}

/**
 * 시간표 hover용 '최근 보고서' 캐시본(테넌트별 60초). 호출부 주석 참조 —
 * ⚠️ admin 클라이언트라 RLS를 안 탄다. **호출부가 이미 스코프를 정한 학생 id만** 넘기므로 조회 범위가
 *    넓어지지는 않지만, tenant는 반드시 명시한다(교차 테넌트 차단).
 */
function latestReportsCached(tenantId: string, studentIds: string[]): Promise<unknown[]> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("timetable_latest_reports", {
        p_student_ids: studentIds,
        p_tenant: tenantId,
      });
      // ?? [] 삼킴 금지(B3) — 실패는 화면을 조용히 비우지 말고 위로 던진다.
      if (error) throw new Error(`timetable_latest_reports RPC 실패: ${error.message}`);
      return (data ?? []) as unknown[];
    },
    ["timetable-latest-reports", tenantId, studentIdsKey(studentIds)],
    { revalidate: 60 },
  )();
}

/**
 * 강사 스코프 시간표 재료 — 담임 반(전역 `getTeacherScope`, 불변) + 내가 교시 담당(FK)인 배치 행 id(그 주 앞뒤로 넉넉히).
 * 어느 반이 서는지는 [`teachingClassIdsInWeek`](../lib/teacher-classes.ts)가 그 주 슬롯과 겹쳐 정한다.
 * 🔴 교시 담당 조회가 실패하면 **담임 반만**(종전 동작) — 넓히는 쪽 실패로 화면이 죽지 않게, 좁은 쪽으로 떨어진다.
 */
async function loadTeacherTimetableScope(
  teacherId: string,
  from: string,
  to: string,
  db?: TimetableDb,
): Promise<{ homeroomClassIds: string[]; mySlotIds: string[] }> {
  const supabase = db?.supabase ?? (await createClient());
  const [{ classIds }, mySlotIds] = await Promise.all([
    getTeacherScope(teacherId),
    fetchAllPaged<{ id: string }>((a, b) => {
      let q = supabase
        .from("class_schedules")
        .select("id")
        .eq("teacher_id", teacherId)
        .lte("valid_from", to)
        .or(`valid_to.is.null,valid_to.gte.${from}`);
      if (db) q = q.eq("tenant_id", db.tenantId); // admin 경로 — RLS 우회라 명시 격리
      return q.order("id").range(a, b);
    }).then(
      (rows) => rows.map((r) => r.id),
      (e: unknown) => {
        // ⚠️ 담임 반이 없는 강사(원어민)는 이 실패 하나로 시간표가 통째로 빈다 — "배정 없음"과 화면에서 구별되지 않으니
        //    로그만은 반드시 남긴다(scope로 grep, 리뷰 2026-09-17).
        reportError(e, { scope: "timetable.teacherScope.taughtSlots", teacherId });
        return [] as string[];
      },
    ),
  ]);
  return { homeroomClassIds: classIds, mySlotIds };
}

export async function getWeeklyScheduleWithStudents(
  // db = 세션 없는 호출(cron) 주입 — teacherId 스코핑은 세션 전제(getTeacherScope)라 db와 병용 불가.
  // ⚠️ 함께 넘기면 담임 반(세션 조회)은 비고 교시 담당 반(db 조회)만 선다 — 지금 둘을 함께 넘기는 호출부는 없다.
  opts?: {
    referenceDate?: string;
    teacherId?: string;
    subject?: string;
    db?: TimetableDb;
    /** 사람이 읽는 화면만 켠다 — 시트·엑셀은 이름이 매칭 키다(fetchSlots 주석). */
    futureNames?: boolean;
  },
): Promise<ScheduleSlotWithStudents[]> {
  // 주차 기준일(미지정=오늘) 기준으로 그 시점의 반 명단을 재구성 — ijw 시간표 주간 이동(타임머신).
  const referenceDate = opts?.referenceDate ?? todayStr();
  const teacherId = opts?.teacherId;
  const subject = opts?.subject;
  const db = opts?.db;
  const weekEnd = weekEndOf(referenceDate); // 재구성 윈도우 끝(ref+6, ijw useSubjectClassStudents)
  const newCutoff = shiftDays(referenceDate, -30); // 신입: 기준일 30일 이내 시작
  // 준신입: 30일 초과 60일 이내(원장 2026-09-07) — 신입 빨강이 꺼진 뒤에도 두 달째까지는  한눈에 보이게 한 단계 옅은 색을 준다. 경계는 `[newCutoff, ...]`(신입)와 겹치지 않는다.
  const recentCutoff = shiftDays(referenceDate, -60);
  // 퇴원 표시 윈도우: 기준일 30일 전까지(클러터 캡, 2026-07-14 원장 1년→1달). 🔴 퇴원관리 '최근 30일'과 **같은 함수**
  // (`recentExitWindow`) — 상단 '퇴원' 숫자와 퇴원관리 숫자가 같은 창을 쓴다(원장 2026-09-28 *"같은 배선을 따야"*).
  const withdrawnFloor = recentExitWindow(referenceDate).from;

  // skipCounts — 이 함수는 바로 아래에서 정확한 로스터를 조회하므로 근사 카운트 쿼리(전 enrollment)를
  // 생략하고, 반환 직전에 로스터 재원 수로 studentCount를 다시 채운다(같은 데이터 2회 조회 제거).
  // 강사 스코프 재료는 슬롯과 독립이라 함께 띄운다(B4 — 강사 화면만 도는 왕복).
  const [weekSlots, teacherScope] = await Promise.all([
    fetchSlots(referenceDate, db, { skipCounts: true, futureNames: opts?.futureNames }),
    teacherId ? loadTeacherTimetableScope(teacherId, shiftDays(referenceDate, -7), shiftDays(weekEnd, 7), db) : Promise.resolve(null),
  ]);
  let slots = weekSlots;
  // 과목 스코핑(선택) — 한 과목만 필요한 호출부(과목별 익스포터 등)는 classIds를 먼저 좁혀
  // 무거운 학생/수강/진도 조회량을 줄인다(전 과목 로딩 방지, B2). 필터 후 빈 결과는 아래 조기반환.
  if (subject) slots = slots.filter((s) => s.subject === subject);
  // 강사 스코핑(intra-tenant PII) — teacher면 **담임 반 ∪ 그 주에 교시 하나라도 맡은 반**만(원장 2026-09-17
  // *"'담당'뿐만 아니라 '내가 수업하는 수업' 모두"*). 안 하면 강사가 /timetable 직타 시 전 학생 명단(이름·학교·
  // 학년·진도)이 노출된다. RLS는 테넌트만 격리하므로 앱레벨에서 좁힌다.
  if (teacherScope) {
    const allow = teachingClassIdsInWeek(slots, teacherScope.homeroomClassIds, teacherScope.mySlotIds);
    if (allow.size === 0) return [];
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
  // ⚠️ fetchAllPagedInChunks 필수(fetchInChunks 아님) — fetchInChunks는 414만 막고 **청크 안에서는
  // 페이지네이션을 안 한다**. 100반/청크 × 반당 수~수십 수강이면 한 청크가 PostgREST 기본 1000행 캡을
  // 넘겨 **에러 없이 잘리고 셀에서 학생이 조용히 사라진다**(B2, 2026-07-17 적대 감사). id 정렬 = OFFSET
  // 페이지가 흔들리지 않게 하는 unique tie-break.
  const rows = await fetchAllPagedInChunks<Row>(classIds, (chunk, from, to) => {
    let q = supabase
      .from("enrollments")
      .select(
        "id, class_id, student_id, start_date, end_date, on_hold, is_transferred, is_transferred_in, attendance_days, student:student_id ( name, grade, school, english_name, status, withdrawn_at )",
      )
      .in("class_id", chunk)
      .lte("start_date", weekEnd)
      .or(`end_date.is.null,end_date.gte.${withdrawnFloor}`);
    if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
    return q.order("id").range(from, to);
  });

  /**
   * **예약된 반 이동** 짝짓기 — 이미 저장돼 그날 저절로 일어날 이동(원장 2026-09-09 '이동 대기').
   * 🔴 새 컬럼·새 표 없이 두 수강 행(`old.end_date === new.start_date`)을 한 사건으로 잇는 것뿐이다.
   */
  const toMoveRow = (r: {
    id: string;
    class_id: string;
    student_id: string;
    start_date: string;
    end_date: string | null;
    is_transferred: boolean | null;
    is_transferred_in: boolean | null;
  }): ScheduledMoveRow => ({
    id: r.id,
    classId: r.class_id,
    studentId: r.student_id,
    startDate: r.start_date,
    endDate: r.end_date,
    isTransferred: r.is_transferred === true,
    isTransferredIn: r.is_transferred_in === true,
  });
  const classNameById = new Map(slots.map((s) => [s.classId, s.className]));
  let scheduledMoves = pairScheduledMoves(rows.map(toMoveRow), referenceDate);
  /**
   * 🔴 **짝이 조회 창 밖일 때만** 한 번 더 묻는다 — 도착 수강은 `start_date`가 미래라
   *    위 명단 쿼리(`start_date <= weekEnd`)에 안 걸린다. 즉 "9/20에 옮김"을 이번 주에서 보면
   *    출발 줄만 있고 **어느 반으로 가는지가 없다** — 원장이 툴팁에 요구한 바로 그 정보다.
   * ⚠️ 대개 0건이라 왕복이 아예 안 생긴다(예약된 이동이 있을 때만 한 번). 화면 밖 반이라 이름은
   *    임베드로 함께 받는다(`enrollments → classes`는 FK가 하나라 힌트가 필요 없다, [[#94]]).
   */
  const unmated = new Set<string>();
  for (const m of [...scheduledMoves.out.values(), ...scheduledMoves.in.values()])
    if (!m.otherClassId) unmated.add(m.on);
  const unmatedStudents = [
    ...new Set(
      rows
        .filter(
          (r) =>
            (r.is_transferred && r.end_date && unmated.has(r.end_date)) ||
            (r.is_transferred_in && unmated.has(r.start_date)),
        )
        .map((r) => r.student_id),
    ),
  ];
  if (unmatedStudents.length > 0) {
    type MateRow = {
      id: string;
      class_id: string;
      student_id: string;
      start_date: string;
      end_date: string | null;
      is_transferred: boolean | null;
      is_transferred_in: boolean | null;
      class: { class_name?: string | null } | { class_name?: string | null }[] | null;
    };
    const mates = await fetchAllPagedInChunks<MateRow>(unmatedStudents, (chunk, from, to) => {
      let q = supabase
        .from("enrollments")
        .select(
          "id, class_id, student_id, start_date, end_date, is_transferred, is_transferred_in, class:class_id ( class_name )",
        )
        .in("student_id", chunk);
      if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
      return q.order("id").range(from, to);
    }).catch(() => [] as MateRow[]); // 이름을 못 받아도 날짜는 말할 수 있다(조회 실패가 줄을 지우면 안 된다)
    if (mates.length > 0) {
      const byId = new Map(rows.map((r) => [r.id, toMoveRow(r)]));
      for (const m of mates) {
        if (!byId.has(m.id)) byId.set(m.id, toMoveRow(m));
        const k = Array.isArray(m.class) ? m.class[0] : m.class;
        if (k?.class_name && !classNameById.has(m.class_id)) classNameById.set(m.class_id, k.class_name);
      }
      // ⚠️ 합집합으로 **다시** 짝짓는다 — 한 학생이 같은 날 두 과목을 옮기면 그제야 모호해지는데,
      //    그건 손실이 아니라 사실이다(엉뚱한 반 이름을 적는 것보다 안 적는 편이 맞다).
      scheduledMoves = pairScheduledMoves([...byId.values()], referenceDate);
    }
  }
  const scheduledSide = (
    side: "out" | "in",
    enrollmentId: string,
  ): { on: string; className: string | null } | undefined => {
    const hit = (side === "out" ? scheduledMoves.out : scheduledMoves.in).get(enrollmentId);
    if (!hit) return undefined;
    return { on: hit.on, className: hit.otherClassId ? (classNameById.get(hit.otherClassId) ?? null) : null };
  };

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
    // 조기에 "퇴원/전출"로 숨겨져 시간표에서 사라진다(이동일 전인데 옛 반에서 증발).
    // ⚠️ 종료일 포함/배타 규약은 **[isEnrollmentEndedOn](src/features/enrollments/eligibility.ts) 단일 소스**.
    //    옛 코드는 여기서 `end <= ref`로 따로 구현해 일반 종료를 하루 일찍 퇴원 처리했다(적대 감사 M6 —
    //    같은 날 getTodaySchedule은 재원, 주간뷰는 퇴원). 학생 단위 퇴원(withdrawn_at)은 enrollment 종료와
    //    별개 개념이라 아래 aliveRows 정제와 같은 규약(<=)을 유지한다.
    const endedByWithdrawal = stuWithdraw != null && stuWithdraw <= referenceDate;
    const hasEnded =
      isEnrollmentEndedOn(r.end_date, referenceDate, r.is_transferred ?? false) || endedByWithdrawal;

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
      // 🔴 신입과 **상호배타**(start < newCutoff) — 겹치면 두 색이 한 줄에서 다툰다. 전입은 여기서도 제외.
      isRecent:
        status !== "withdrawn" && start >= recentCutoff && start < newCutoff && r.is_transferred_in !== true,
      enrollmentDate: start,
      attendanceDays: r.attendance_days ?? [],
      englishName: s.english_name ?? null,
      // 🔴 퇴원 줄엔 안 붙인다 — 이미 끝난 기록에 "곧 옮겨 갑니다"는 거짓이다.
      movingOut: status === "withdrawn" ? undefined : scheduledSide("out", r.id),
      movingIn: status === "withdrawn" ? undefined : scheduledSide("in", r.id),
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
        end_date: string | null;
        is_transferred: boolean | null;
        class: { subject: string | null } | { subject: string | null }[] | null;
        student: { status: string | null; withdrawn_at: string | null } | { status: string | null; withdrawn_at: string | null }[] | null;
      };
      // 청크당 1000행 캡 방어(위 rows와 동일 이유) — 한 학생이 여러 수강을 갖는 1:N이라 잘릴 수 있다.
      // ⚠️ `start_date ≤ 기준일` 하한 필수 — 없으면 **아직 시작 안 한 미래 수강**이 "살아있는 수강"으로 잡혀
      // 진짜 퇴원생의 퇴원 줄이 지워진다(강사뷰에선 그 반이 slots 밖이라 학생이 아예 증발, 적대 감사 M7).
      // end_date 필터는 두 규약(전출 배타/일반 포함)의 **상위집합**으로 넓게 받고 판정은 아래 JS에서 정확히.
      const aliveRows = await fetchAllPagedInChunks<AliveRow>(wStudentIds, (chunk, from, to) => {
        let q = supabase
          .from("enrollments")
          .select(
            "student_id, end_date, is_transferred, class:class_id ( subject ), student:student_id ( status, withdrawn_at )",
          )
          .in("student_id", chunk)
          .lte("start_date", referenceDate)
          .or(`end_date.is.null,end_date.gte.${referenceDate}`);
        if (db) q = q.eq("tenant_id", db.tenantId); // admin(cron) 경로 — 명시 격리
        return q.order("id").range(from, to);
      });
      const subjectOfClass = new Map(slots.map((s) => [s.classId, s.subject]));
      const aliveSubj = new Set<string>(); // `${subject}:${studentId}`
      for (const r of aliveRows) {
        // 기준일 시점 실제 생존 판정 — 위 hasEnded와 **같은 단일 소스**(전출=반열림 배타 / 일반=종료일 포함).
        if (isEnrollmentEndedOn(r.end_date, referenceDate, r.is_transferred ?? false)) continue;
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

  // 학생별 최근 교재·진도 — 둘 다 **같은 수업보고서 1건**에서 뽑는다(2026-07-21 원장 지시 "완전히 연동").
  // ⚠️ 과거엔 교재만 `textbook_orders`(교재요청서)에서 왔는데, 그건 **구매 신청 이력**이라 수업에서 쓰는
  // 교재명과 사실상 항상 다르다(실측: 둘 다 있는 148명 중 **147명 불일치**. 김하나 = 요청서 "초6-2 발전
  // 2권(22개정)" vs 보고서 "강아 6-2-1"). 같은 hover 카드 안에서 교재와 진도의 출처·날짜가 갈라져,
  // 학부모가 받는 수업보고서와도 어긋났다. 교재요청서는 /textbook-requests(주문·납부 관리)로 남는다.
  const studentIds = Array.from(new Set([...byClass.values()].flat().map((l) => l.studentId)));
  if (studentIds.length > 0) {
    type RepRow = {
      bucket: string; // 'class:<uuid>' | 'subject:<key>'
      student_id: string;
      class_id: string | null;
      report_date: string;
      progress: string | null;
      exam_info: string | null;
      homework_score: string | null;
      teacher_name: string | null;
      textbook: string | null;
      subject: string | null;
    };
    // 🔴 최신 1건 집계는 **RPC**(0150a `timetable_latest_reports`) — 예전엔 학생 399명의 보고서
    //    **전 이력 13,233행(3.2MB)** 을 매 렌더 끌어와 JS로 '첫 행 승리' 집계했다(직렬 왕복 ~14회,
    //    시간표 전체 응답의 지배 비용). RPC는 (학생×반)·(학생×과목) 최신 1건씩 ~336행(87KB)만 돌려준다.
    //    dedup 규칙(report_date desc, id desc)·과목 판정(reportSubject)은 RPC SQL과 **동일** —
    //    규칙 문서·테스트는 lib/report-subject.ts가 계속 담당(양쪽 동기 유지 주석 참조).
    // ⚠️ 학생 배열은 300명씩 청크 — PostgREST max-rows(~1000)가 RPC 결과에도 걸리므로, 전교생이
    //    한 번에 가면 union 결과가 조용히 잘릴 수 있다(청크당 최대 ~600행으로 안전 마진).
    const repRows: RepRow[] = [];
    const CHUNK = 300;
    const chunks: string[][] = [];
    for (let i = 0; i < studentIds.length; i += CHUNK) chunks.push(studentIds.slice(i, i + CHUNK));
    // 🔴 **테넌트 단위 60초 캐시**(2026-08-13 계측) — 이 RPC는 59일 3,976회·평균 **379ms**로 시간표
    //    응답의 지배 항목이었다. 정밀 측정상 비싼 건 쿼리 자체가 아니라 **콜드 연결의 첫 실행**이라
    //    (같은 연결 두 번째 호출은 5ms) 조여서 줄일 수 없고, **호출 자체를 없애야** 준다. 시간표는 창으로
    //    반복해서 열리고 창마다 셸+페이지가 다시 도는 구조라 캐시 적중률이 높다.
    // ⚠️ 이 값은 hover에 뜨는 **최근 보고서 요약**이다 — 60초 늦어도 해가 없다(수업 배치는 캐시 대상 아님).
    // ⚠️ 캐시 안엔 쿠키가 없어 admin 클라이언트를 쓰므로 **tenant를 명시**해 격리한다(키에도 넣는다).
    //    세션 경로에서 tenantId를 못 구하면(비로그인 등) 캐시 없이 기존 RLS 경로로 간다.
    // ⚠️ cron(db 주입)은 캐시를 **타지 않는다** — 하루 한 번 도는 배치가 60초 전 값을 보면 안 되고,
    //    호출 횟수도 적어 캐시 이득이 없다. 캐시는 사람이 창을 여는 세션 경로만.
    const cacheTenantId = db ? null : ((await getCurrentUser())?.tenantId ?? null);
    const results = await Promise.all(
      chunks.map((chunk) =>
        cacheTenantId
          ? latestReportsCached(cacheTenantId, chunk)
          : supabase
              .rpc("timetable_latest_reports", { p_student_ids: chunk, p_tenant: db?.tenantId ?? null })
              .then(({ data, error }) => {
                if (error) throw new Error(`timetable_latest_reports RPC 실패: ${error.message}`);
                return (data ?? []) as RepRow[];
              }),
      ),
    );
    for (const rows of results) repRows.push(...(rows as RepRow[]));
    // 🔴 **그 수업의** 최신 보고서를 먼저 본다(0134a). 예전엔 학생 단위 최신 1건이라, 같은 학생이
    //    정규 수학 + 수학 특강을 들으면 두 슬롯의 hover가 **똑같은 진도·교재**를 보여줬다(둘 중 하나는 거짓).
    //    반 매칭이 없으면(이관분·관리자 작성분 = class_id NULL) 학생×과목 최신으로 폴백한다.
    const keyOf = (studentId: string, classId: string) => `${studentId}::${classId}`;
    const byStudentClass = new Map<string, RepRow>();
    // 🔴 학생 단위 폴백은 **과목별로** 나눈다(원장 2026-07-27 "영어 시간표에 수학 관련 내용이 나오지
    //    않게 / 수학 시간표에서만 수학 내용이 호버링되게"). 과목 버킷 키는 RPC가 판정해 내려준다
    //    (판정 규칙 = lib/report-subject.ts와 동일: 보고서 subject → 반 subject → 레거시 'math').
    const byStudentSubject = new Map<string, RepRow>();
    for (const r of repRows) {
      if (r.bucket.startsWith("class:")) byStudentClass.set(keyOf(r.student_id, r.bucket.slice(6)), r);
      else if (r.bucket.startsWith("subject:")) byStudentSubject.set(`${r.student_id}::${r.bucket.slice(8)}`, r);
    }
    // 🔴 특강 슬롯은 **학생 단위 폴백을 쓰지 않는다**(원장 2026-07-23 "정규와 특강을 분리시켜").
    //    폴백은 이관분(class_id NULL)을 살리려는 장치인데 이관분은 전부 정규다 → 특강 슬롯에 쓰면
    //    100% 정규 수업의 진도·교재가 뜬다. 정규 슬롯의 폴백은 그대로 유지(없애면 hover가 전부 빈다).
    //    ⚠️ 특강 첫 수업 슬롯의 hover가 비는 건 정상 — 남의 수업 진도를 보여주는 것보다 낫다.
    const specialClassIds = new Set(slots.filter((s) => s.isSpecialLecture).map((s) => s.classId));
    const subjectOfClass = new Map(slots.map((s) => [s.classId, s.subject]));
    for (const [classId, list] of byClass) {
      const special = specialClassIds.has(classId);
      const slotSubject = subjectOfClass.get(classId) ?? "";
      for (const l of list) {
        const r = special
          ? byStudentClass.get(keyOf(l.studentId, classId))
          : (byStudentClass.get(keyOf(l.studentId, classId)) ??
            byStudentSubject.get(`${l.studentId}::${slotSubject}`));
        if (!r) continue;
        l.latestReport = {
          date: r.report_date,
          progress: r.progress,
          examInfo: r.exam_info,
          homeworkScore: r.homework_score,
          teacherName: r.teacher_name,
        };
        // 교재는 진도와 **같은 행**에서만 — 다른 행에서 끌어오면 카드 안에서 날짜가 또 갈라진다.
        const book = (r.textbook ?? "").trim();
        if (book) l.latestTextbook = { name: book, date: r.report_date };
      }
    }
  }

  // studentCount 재기입 — fetchSlots를 skipCounts로 불렀으므로(근사 카운트 쿼리 생략) 로스터의
  // 재원(active) 수로 채운다. 근사치보다 오히려 정확하다(옛 카운트는 대기 포함·주말 경계 근사).
  return slots.map((s) => {
    const roster = byClass.get(s.classId) ?? [];
    return { ...s, students: roster, studentCount: roster.filter((l) => l.status === "active").length };
  });
}

export type TodaySlot = ScheduleSlot & { status: "done" | "ongoing" | "upcoming"; studentIds?: string[] };

export async function getTodaySchedule(options?: { includeStudentIds?: boolean }): Promise<TodaySlot[]> {
  const supabase = await createClient();
  const today = kstToday();
  // KST 날짜를 UTC 자정으로 파싱해 요일 도출 — 서버 UTC에서 now.getDay()는 새벽 시간대에 어제 요일이 된다.
  const todayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${today}T00:00:00Z`).getUTCDay()
  ];

  // 오늘 요일 스케줄만 — fetchSlots(전 요일 fetch 후 JS 필터)를 SQL 필터로 좁힘(데이터 ~1/7).
  // 폐지(is_active=false)·미래 시작·만료 스케줄 제외 + 종강(closed_at<오늘)은 JS에서 제외(시간표와 일관).
  const { data, error } = await supabase
    .from("class_schedules")
    .select(
      `id, day_of_week, start_time, end_time, class_id, classroom_id, slot_teacher_label, slot_room_label,
       slotTeacher:teacher_id ( display_name ),
       slotRoom:classroom_id ( name ),
       class:class_id!inner (
         class_name, subject, is_active, closed_at, classroom_id,
         teacher:teacher_id ( display_name ),
         classroom:classroom_id ( name )
       )`,
    )
    .eq("day_of_week", todayKey)
    .eq("class.is_active", true)
    .lte("valid_from", today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order("start_time");
  if (error) throw new Error(`today schedule: ${error.message}`);
  if (!data || data.length === 0) return [];

  // 종강 반(closed_at < 오늘)은 오늘 일정에서 제외.
  const visible = data.filter((r) => {
    const k = (Array.isArray(r.class) ? r.class[0] : r.class) as { closed_at?: string | null } | undefined;
    const closedAt = k?.closed_at ?? null;
    return !closedAt || closedAt >= today;
  });
  if (visible.length === 0) return [];

  // 오늘 반의 활성 enrollment만 카운트 — 전체 enrollment 전건 대신 오늘 반(classIds)으로 좁힘.
  // ⚠️ raw `.in(classIds)`는 반이 많은 날 URL이 414로 터진다(#53) — 학원이 커지면 "수십 개" 가정이
  // 깨지므로 청크 분할 + 청크 안 페이지네이션(fetchAllPagedInChunks)으로 둘 다 방어한다(적대 감사 LOW).
  const classIds = [...new Set(visible.map((r) => r.class_id as string))];
  const enrollments = await fetchAllPagedInChunks<{
    id: string;
    class_id: string;
    student_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
  }>(classIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select("id, class_id, student_id, start_date, end_date, on_hold, is_transferred, attendance_days")
      .lte("start_date", today)
      .in("class_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const studentsByClass = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    if (
      !isEnrollmentActiveOn(
        {
          startDate: enrollment.start_date,
          endDate: enrollment.end_date,
          onHold: enrollment.on_hold,
          isTransferred: enrollment.is_transferred === true,
        },
        today,
      ) ||
      !enrollmentAttendsOnDay(enrollment.attendance_days, todayKey)
    ) {
      continue;
    }
    const students = studentsByClass.get(enrollment.class_id) ?? new Set<string>();
    students.add(enrollment.student_id);
    studentsByClass.set(enrollment.class_id, students);
  }
  const counts = new Map([...studentsByClass].map(([classId, students]) => [classId, students.size]));

  const nowMins = kstMinutesOfDay();
  const toMins = (hms: string): number => {
    const [h, m] = hms.split(":");
    return Number(h) * 60 + Number(m);
  };

  return visible
    .map((r): Omit<TodaySlot, "status"> => {
      const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
        | {
            class_name?: string;
            subject?: string;
            classroom_id?: string | null;
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
        // 현재 수업은 반 담임·기본 교실보다 해당 교시의 담당·교실을 우선한다.
        teacherName: resolveSlotTeacherLabel(r.slot_teacher_label, r.slotTeacher)
          ?? teacher?.display_name ?? null,
        classroomName: (Array.isArray(r.slotRoom) ? r.slotRoom[0] : r.slotRoom)?.name
          ?? r.slot_room_label ?? room?.name ?? null,
        studentCount: counts.get(r.class_id) ?? 0,
        ...(options?.includeStudentIds ? { studentIds: [...(studentsByClass.get(r.class_id) ?? [])].sort() } : {}),
        // 슬롯 강사 라벨 — 작성률(getWeeklyWritingRates)이 반 담당 없는 반의 귀속 폴백으로 사용.
        // 색·인수인계는 대시보드 오늘 일정 미사용 — 타입 충족용 null 유지.
        slotTeacherLabel: resolveSlotTeacherLabel(r.slot_teacher_label, r.slotTeacher),
        slotRoomLabel: (r.slot_room_label as string | null) ?? null,
        slotRoomId: (r.classroom_id as string | null) ?? null,
        classRoomId: klass?.classroom_id ?? null,
        classBgColor: null,
        classTextColor: null,
        pendingHandover: null,
        // 대시보드 '오늘 일정'은 정규/특강을 가르지 않지만 타입 계약상 채운다(이름 폴백만으로 충분).
        isSpecialLecture: isSpecialLecture({ isSpecial: null, className: klass?.class_name ?? null }),
        // 프로그램 구분은 시간표 화면의 보기 필터 전용 — 여긴 안 읽으므로 조회도 안 한다(컬럼 추가 X).
        englishTrack: null,
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

/** 퇴사자 표기 — 실패하면 빈 집합(걸러 내지 않고 종전대로 그린다 · 시간표 핫패스 fail-soft). */
async function loadResignedLabels(supabase: Awaited<ReturnType<typeof createClient>>): Promise<Set<string>> {
  const { data, error } = await supabase.from("users").select("display_name, english_name, status");
  if (error) {
    console.error("[timetable] 퇴사자 조회 실패 — 근무 블록을 거르지 않고 표시", error);
    return new Set();
  }
  return resignedTeacherLabels((data ?? []).map((u) => ({
    displayName: (u.display_name as string | null) ?? null,
    englishName: (u.english_name as string | null) ?? null,
    status: (u.status as string | null) ?? null,
  })));
}

/**
 * 강사 시간표의 **비수업 블록**(감독·준비·회의·연차·쉬는 시간, 0138a) — 강사뷰 렌더 전용.
 *
 * 왜 있는가: 영어 마스터 시트의 강사별 탭은 **강사의 하루 전체**를 그린다. 수업 칸 사이의 'JJ'(감독)·
 * '쉬는 시간'·'교수부미팅' 같은 칸이 aywa엔 담을 곳이 없어 통째로 버려졌고, 그래서 감독이 15칸인
 * 강사의 시간표가 텅 비어 보였다(2026-07-22 Dom). 반으로 만들면 그 강사가 남의 반 담당이 되어
 * 로스터·보고서·급여까지 오염되므로 **반이 아닌 별도 테이블**로 담는다.
 *
 * ⚠️ 반환 항목은 `blockKind`가 채워진 **가짜 슬롯**이다 — classId/className이 실재하지 않는다.
 *    강사뷰 격자 계산에 그대로 태우려고 모양만 맞춘 것이니, **다른 화면·집계에 넘기지 말 것.**
 */
export async function getTeacherScheduleBlocks(
  subject: string,
  referenceDate: string,
  /**
   * 강사 스코프 — 넘기면 **그 강사 본인 블록만**. 수업 슬롯은 이미 teacherId로 좁혀지는데(intra-tenant
   * PII 격리) 블록만 전체를 가져오면, 강사 화면에 **남의 연차·회의·감독 일정**이 뜨고 스코프가 지운
   * 강사 컬럼까지 되살아난다(적대검증 2026-07-22 확정). 관리자(=undefined)는 전체.
   */
  teacherId?: string,
): Promise<ScheduleSlotWithStudents[]> {
  const supabase = await createClient();
  // 라벨이 표시 앵커라 id만으로는 못 좁힌다 — 그 사람의 표기(display_name·english_name)까지 함께 본다.
  let labels: string[] = [];
  if (teacherId) {
    const { data: me } = await supabase
      .from("users")
      .select("display_name, english_name")
      .eq("id", teacherId)
      .maybeSingle();
    labels = [me?.display_name, me?.english_name].filter((x): x is string => !!x);
    // 이름을 못 찾으면 **아무것도 보여주지 않는다**(전체 노출로 폴백하면 격리가 뚫린다).
    if (labels.length === 0) return [];
  }
  const [rows, resigned] = await Promise.all([fetchAllPaged<{
    id: string;
    teacher_label: string;
    day_of_week: string;
    start_time: string;
    end_time: string;
    kind: string;
    label: string;
  }>((from, to) => {
    let q = supabase
      .from("teacher_schedule_blocks")
      .select("id, teacher_label, day_of_week, start_time, end_time, kind, label")
      .eq("subject", subject)
      .lte("valid_from", referenceDate)
      .or(`valid_to.is.null,valid_to.gte.${referenceDate}`);
    if (labels.length > 0) q = q.in("teacher_label", labels);
    return q.order("id").range(from, to);
  }), loadResignedLabels(supabase)]);
  // ⚠️ 조회 필터(labels)는 DB 원본 라벨로 두고, **내보내는 라벨만** 해석한다 — 안 그러면 블록이
  //    'Hannah' 열, 수업이 '이현이' 열로 갈라져 강사뷰에 같은 사람의 컬럼이 두 개 생긴다.
  const labelMap = await getTeacherLabelMap();
  // 퇴사자의 블록은 그리지 않는다 — 블록은 시트 라벨로 저장돼 퇴사해도 기간이 안 닫히고, 그대로 두면
  // 수업이 하나도 없는 퇴사자 열이 강사뷰에 남는다(원장 2026-11-04). 원문·해석 라벨 둘 다 본다.
  const live = resigned.size === 0
    ? rows
    : rows.filter((r) => !resigned.has(r.teacher_label.trim()) && !resigned.has(resolveTeacherLabel(r.teacher_label, labelMap) ?? ""));
  return live.map((r) => ({
    id: `block:${r.id}`,
    classId: "",
    // 블록 라벨은 자유 문자열이지만 감독(supervise) 블록은 **감독 대상 강사 이름**이 들어온다
    // (실데이터: teacher_label=Dom/Daniella/Hannah, label='JJ' = "JJ 감독"). 그것도 같은 표기로 읽혀야
    // 하므로 통과시킨다 — '쉬는 시간'·'연차사용' 같은 비-이름 라벨은 맵에 없어 그대로 지나간다.
    className: resolveTeacherLabel(r.label, labelMap) ?? r.label,
    subject,
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime: r.end_time,
    teacherName: resolveTeacherLabel(r.teacher_label, labelMap),
    classroomName: null,
    studentCount: 0,
    slotTeacherLabel: resolveTeacherLabel(r.teacher_label, labelMap),
    slotRoomLabel: null,
    slotRoomId: null,
    classRoomId: null,
    classBgColor: null,
    classTextColor: null,
    pendingHandover: null,
    isSpecialLecture: false,
    // 비수업 블록은 반이 아니라 프로그램 구분도 없다 — 필터가 이 항목을 지우지 않게 null(=인재원 쪽 통과).
    englishTrack: null,
    blockKind: r.kind as NonNullable<ScheduleSlot["blockKind"]>,
    students: [],
  }));
}

/**
 * 강의실 목록(교실뷰 컬럼 축) — 이름순. 학원당 수십 실 수준의 소형 참조 테이블이라 무페이징
 * (owner 강의실 관리·자동배정 데이터 조회와 동일 관례). error는 삼키지 않는다(`?? []` 금지).
 */
export type ClassroomLite = { id: string; name: string; capacity: number | null };
/**
 * ⚠️ 보관(숨김)된 강의실(0182a)은 **배정이 남아 있으면 계속 보여준다** — 여긴 선택지가 아니라 **지도**다.
 *    숨겼다고 열을 지우면 그 방에서 도는 수업이 화면에서 통째로 사라진다(숨김의 뜻은 "새로 배정 못 함"이지
 *    "지금 하는 수업을 감춘다"가 아니다). 참조가 0건인 보관 방만 열에서 뺀다(빈 열 = 노이즈).
 */
export async function getClassroomsLite(): Promise<ClassroomLite[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classrooms")
    .select("id, name, capacity, archived_at")
    .order("name");
  if (error) throw error;
  const rows = data ?? [];
  const archivedIds = rows.filter((r) => r.archived_at != null).map((r) => r.id as string);
  const used = new Set<string>();
  if (archivedIds.length) {
    // 소수(보관 방)만 대상이라 단일 `.in()`으로 충분(414 위험 없음). 독립 조회라 병렬(B4).
    const [cls, slots] = await Promise.all([
      supabase.from("classes").select("classroom_id").in("classroom_id", archivedIds),
      supabase.from("class_schedules").select("classroom_id").in("classroom_id", archivedIds),
    ]);
    // 🔴 오류를 삼키지 않는다(감사 E5) — 삼키면 "참조 0건"으로 읽혀 보관 방의 수업 열이 통째로 빠진다.
    if (cls.error) throw cls.error;
    if (slots.error) throw slots.error;
    for (const r of [...(cls.data ?? []), ...(slots.data ?? [])]) {
      const id = r.classroom_id as string | null;
      if (id) used.add(id);
    }
  }
  return rows
    .filter((r) => r.archived_at == null || used.has(r.id as string))
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      capacity: (r.capacity as number | null) ?? null,
    }));
}
