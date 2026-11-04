import { getTeacherLabelMap } from "@/features/timetable/server/queries";
import "server-only";
import { enrolledSubjectCounts } from "../enrollment/enrolled-composition";
import {
  countEnrolledStudents,
  getNotStartedStudentIds,
  getSubjectFilterKeep,
  loadActiveEnrolledEnrollments,
} from "./enrolled-programs";
import { NO_SUBJECT, parseMulti } from "../list-filter-values";
import { isGradeSort, sortByGrade } from "../grade-sort";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { consultParentMatchStudentIds } from "./parent-search";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { attendanceRate, attendedCount } from "@/lib/calc/attendance";
import { invoiceOutstanding } from "@/features/billing/calc";
import { isExamSlot, type ExamSlotKey } from "@/features/grades/exam-slots";
import { isTerm, type Term } from "@/features/grades/term";
import { settingsToPeriodsConfig, enumDayToKo, type DayOfWeek } from "@/features/timetable/lib/periods";
import {
  buildClassSlots,
  filterLabSeparateRows,
  liveScheduleRows,
  roomBookOf,
  type ClassSlot,
  type ScheduleRow,
} from "../lib/class-slots";
// '따로 수업(*LAB)' 재료 — 켠 교시(0271a)·켠 수강(0271b). 둘 다 fail-soft(모르면 안 가른다).
import { loadLabSeparateIds } from "@/features/classes/server/lab-separate";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { getStudentLabSeparateEnrollmentIds } from "@/features/enrollments/server/lab-separate";
import { goalCellKey, goalExamLabel, goalStatus, type GoalStatus } from "@/features/grades/goals";
import { loadGoals } from "@/features/grades/server/goals";
import { gradeMonthReady, gradeNoExamReady, gradesSchemaReady } from "@/features/grades/server/write";
import {
  subjectAxisOf,
  axisHasSubject,
  narrowSubjects,
  narrowTeacherNames,
  type SubjectTeacher,
} from "../scope-axis";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isShareExpired } from "@/features/onescreen/share-expiry";
import { reportSubject } from "@/features/timetable/lib/report-subject";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { describeDbError, logDbError } from "@/lib/supabase/db-error";
import {
  effectiveAttendanceRecords,
  type EffectiveAttendanceRecord,
} from "@/features/attendance/effective-records";
import { canSeeStudentEnrollment } from "./enrollment-gate";
import { canViewStudentDetail } from "./read-scope";
import { isMergedStudent } from "../status/merged";
import { enrollmentHistoryTimeline } from "../enrollment-history";
import { getStudentEnrollmentHistory, loadEnrollmentHistorySeed } from "./enrollment-history";
import { OUTCOME_LABEL, type OutcomeKey } from "@/features/enrollment/server/queries";
import { reasonDisplay } from "@/features/withdrawals/types";
import { groupSchedule, type ScheduleGroup } from "@/features/classes/schedule-periods";
import { enrollmentLastDate, isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";

/** 임포트된 상담/메모 텍스트("[제목]\n본문\n[등록자: 이름]")를 제목·본문·등록자로 분리. */
function parseImportedNote(raw: string | null | undefined): {
  title: string | null;
  body: string | null;
  registrant: string | null;
} {
  if (!raw) return { title: null, body: null, registrant: null };
  let text = raw.trim();
  let registrant: string | null = null;
  const reg = text.match(/\[등록자:\s*([^\]]+)\]\s*$/);
  if (reg) {
    registrant = reg[1].trim();
    text = text.slice(0, reg.index).trim();
  }
  let title: string | null = null;
  const t = text.match(/^\[([^\]]+)\]/);
  if (t) {
    title = t[1].trim();
    text = text.slice(t[0].length).trim();
  }
  return { title, body: text || null, registrant };
}

// enrollments → class(subject·담당 강사) 조인 행 형태(PostgREST는 to-one도 배열로 줄 수 있어 유니온).
type EnrollClass = {
  subject?: string;
  teacher_id?: string | null;
  teacher?: { display_name?: string } | { display_name?: string }[] | null;
};

export type StudentListRow = {
  id: string;
  name: string;
  englishName?: string | null;
  school: string | null;
  grade: string | null;
  status: string;
  teacherNames: string[]; // 과목별 담당 강사(반의 teacher_id) distinct — 과목제라 학생당 단일 담임 없음
  enrolledAt: string | null;
  parentPhone: string | null;
  subjects: string[]; // 수강 중인 과목 unique list
  // 목록 이름 옆 꼬리표('병합됨'·'동기화'·'의심')는 2026-10-14 걷었다(원장) — 그 값들은 여기서 읽지 않는다.
  //   '의심'(dup_suspect)은 학생 상세(getStudentById)와 데이터 정리(findDuplicateStudents — 병합 후보 + 짝 없는 '의심')가 따로 읽는다.
};

/**
 * 정렬 = 열 머리의 오름·내림 화살표(원장 2026-10-14 *"각 필터에 오름차순 내림차순이 있어야지"*). 축은 이름·학년 둘 —
 * 등록일순은 붙일 열이 없어 없앴다(원장 선택 *"등록일 정렬 없앰"*). 방향은 값에 싣는다(저장·주소가 한 값).
 */
export type StudentSort = "grade" | "grade_desc" | "name" | "name_desc";

/**
 * 정렬 → DB 순서. 🔴 학년 정렬의 **최종 순서는 DB가 아니라 `sortByGrade`**(grade-sort.ts)다 — DB는 학년을 글자로 줄 세워
 * `7세 → 고 → 중 → 초`가 된다. 학년 정렬이면 호출부가 id 전건을 받아 JS로 줄 세운다(getStudentsPage·getStudents).
 * 끝에 id를 붙여 같은 값끼리도 순서가 정해진다(쪽 경계에서 학생이 빠지거나 겹치지 않게).
 */
function orderStudents<T extends { order: (col: string, opts: { ascending: boolean }) => T }>(qb: T, sort: StudentSort | undefined): T {
  switch (sort) {
    case "name":
      return qb.order("name", { ascending: true }).order("id", { ascending: true });
    case "name_desc":
      return qb.order("name", { ascending: false }).order("id", { ascending: true });
    default:
      return qb.order("grade", { ascending: true }).order("name", { ascending: true }).order("id", { ascending: true });
  }
}
export type SearchField = "all" | "name" | "school" | "phone" | "address" | "email" | "memo" | "parent";

export type StudentListFilters = {
  status?: string; // "all" | "enrolled" | "consulted" | "on_hold" | "withdrawn"
  /**
   * "all" | "math" | "math,english" | "__none__"(미수강) … — 과목·학년·담임은 **쉼표 다중 값**(원장 2026-09-28, 합집합).
   * 옛 단일 값은 원소 하나짜리 목록이다. 풀이는 `parseMulti`(list-filter-values.ts) 한 곳.
   */
  subject?: string;
  q?: string; // 검색어
  grade?: string; // "all" | "초4" | "중1,중2" | ... (다중)
  teacherId?: string; // "all" | uuid | "uuid,uuid" (담임, 다중)
  excludeNoEnrollment?: boolean; // 활성 수강 없는 학생 제외 (고급)
  sort?: StudentSort; // 정렬 (고급) — 기본 grade
  searchField?: SearchField; // 검색 범위 필드 (고급) — 기본 all
  /**
   * 이 학생들로만 좁힌다(운영실 KPI ↗ `program=`·`first=` — 카드·팝업과 같은 함수가 만든 집합). getStudentsPage 전용.
   * ⚠️ 수백 명이라 `.in("id", …)`에 싣지 않는다 — getStudentsPage가 id 전건을 같은 필터·정렬로 받아 JS로 거른다.
   */
  restrictIds?: ReadonlySet<string> | null;
};

/** getStudentsPage가 students에서 직접 읽는 컬럼(아래 StudentPageRecord와 함께 고칠 것). */
const STUDENT_PAGE_COLUMNS =
  "id, name, english_name, school, grade, status, enrolled_at, parent_phone";

// 검색 필드 → 컬럼 매핑. all은 데스크 응대 빈도 높은 이름·학교·전화·보호자명 묶음.
// 보호자2(s2_0022)도 같은 자리에서 찾는다 — 어머니 번호로 물어도 아버지 번호만 적힌 칸에 막히지 않게(원장 2026-11-04).
const SEARCH_FIELD_COLS: Record<SearchField, string[]> = {
  all: ["name", "english_name", "school", "student_phone", "parent_phone", "parent2_phone", "parent_name", "parent2_name"],
  name: ["name", "english_name"],
  school: ["school"],
  phone: ["student_phone", "parent_phone", "parent2_phone"],
  address: ["address"],
  email: ["email"],
  memo: ["notes"],
  parent: ["parent_name", "parent2_name"],
};

/**
 * 메모 내용으로 걸린 학생을 검색에 함께 태울 때, **URL에 실을 id 상한**.
 * 🔴 상한이 필요한 이유: 이 id들은 `id.in.(…)`로 **쿼리스트링에 실린다** — 예전에 미수강 학생 458명을
 *    그렇게 실었다가 URL 17,943자 → PostgREST가 `content-location`으로 되돌려준 헤더가 Node
 *    `maxHeaderSize`(16384)를 넘겨 `fetch failed`, 그걸 삼켜 **"학생 0명"**이 됐다(위 embed 주석).
 * ⚠️ 상한에 걸리면 조용히 자른다 — 이름·학교·연락처 매칭은 그대로라 검색이 죽지는 않는다.
 */
const MEMO_MATCH_CAP = 200;

/**
 * 검색어와 겹치는 **'검색 허용' 메모**가 달린 학생 id(0250a) — 원장 2026-09-08
 * *"학생 검색시에 '메모 내용'도 검색되도록"* + *"토글 허용된 검색만 검색에 노출되도록"*.
 *
 * 🔴 **허용된 메모만** 본다(`searchable`) — 끈 메모는 검색 결과에 그 학생을 올리지 않는다.
 * ⚠️ 0250a 미적용이면 컬럼이 없어 400이 난다 → **빈 배열**로 떨어뜨린다(검색은 종전대로 돈다,
 *    [[#95]] expand/contract). 에러를 던지면 학생 목록이 통째로 죽는다.
 */
async function memoMatchStudentIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  term: string,
): Promise<string[]> {
  if (!term) return [];
  const { data, error } = await supabase
    .from("student_memos")
    .select("student_id")
    .eq("searchable", true)
    .ilike("content", `%${term}%`)
    .limit(MEMO_MATCH_CAP);
  if (error || !data) return [];
  return [...new Set(data.map((r) => r.student_id as string))];
}

/**
 * 검색어 정리 — 쉼표·괄호는 PostgREST `or()` 구문과 충돌해 공백으로 바꾼다.
 * 🔑 메모 매칭(`memoMatchStudentIds`)도 **같은 값**을 봐야 한다 — 한쪽만 치환하면 같은 검색어가
 *    이름에선 걸리고 메모에선 안 걸린다(또는 그 반대).
 */
function searchTerm(q: string | undefined): string {
  return (q ?? "").trim().replace(/[,()]/g, " ");
}

// 검색어를 선택된 필드(들)에 ilike OR로 적용.
// 🔑 `memoIds`가 있으면 **그 학생들도 결과에 넣는다**(메모 내용 · 콜&상담 학부모 이름 — `extraSearchIds`).
function applySearch<T extends { or: (f: string) => T }>(
  qb: T,
  q: string | undefined,
  field?: SearchField,
  memoIds: string[] = [],
): T {
  const term = searchTerm(q);
  if (!term) return qb;
  const cols = SEARCH_FIELD_COLS[field ?? "all"] ?? SEARCH_FIELD_COLS.all;
  const parts = cols.map((c) => `${c}.ilike.%${term}%`);
  if (memoIds.length > 0) parts.push(`id.in.(${memoIds.join(",")})`);
  return qb.or(parts.join(","));
}

/**
 * 검색 컬럼 밖에서 검색어에 걸린 학생 id — 메모 내용(기본 검색만 · 필드를 콕 집었으면 그 필드만) + 연결된 신규 콜&상담의 학부모 이름(기본·학부모명).
 * 🔴 합쳐서 `MEMO_MATCH_CAP` 안 — 둘 다 `id.in.(…)` 한 줄로 URL에 실린다(상한 주석의 사고).
 */
async function extraSearchIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  q: string | undefined,
  field?: SearchField,
): Promise<string[]> {
  const term = searchTerm(q);
  const f = field ?? "all";
  if (!term || (f !== "all" && f !== "parent")) return [];
  const [memo, parent] = await Promise.all([
    f === "all" ? memoMatchStudentIds(supabase, term) : Promise.resolve([]),
    consultParentMatchStudentIds(supabase, term, MEMO_MATCH_CAP),
  ]);
  return [...new Set([...memo, ...parent])].slice(0, MEMO_MATCH_CAP);
}

/**
 * '미수강 제외'·과목 필터가 students 쿼리에 붙일 **embed 힌트**.
 *
 * 🔴 2026-07-29 수리 — 예전엔 미수강 학생 id를 전부 풀어 `.not("id","in","(…)")`에 넣었다. "미수강은
 * 소수"라는 전제가 깨져(실측 812명 중 **458명**) URL이 17,943자가 됐고, PostgREST가 `content-location`
 * 헤더로 그 쿼리를 되돌려주면서 헤더가 Node `maxHeaderSize`(16384)를 넘겨 `fetch failed` → 그걸
 * `data ?? []`가 삼켜 **8초 뒤 "학생 0명"**. 실패 임계 n=398/399, 3/3 재현.
 *
 * 이제 id를 URL에 싣지 않고 `enrollments!inner` 임베드로 **서버에서 조인 필터**한다.
 * 실데이터 동치 검증(injaewon): 미수강 제외 354 = SQL ground truth 354 · 과목 english 249 = 249,
 * 부모행 중복 없음.
 *
 * ⚠️ 의미 차이를 지킬 것 — '미수강 제외'는 `end_date is null`만 본다(**휴원 on_hold는 '수강 중'**,
 * 반에 적을 뿐이므로). 과목 필터는 기존대로 `on_hold=false`까지 본다. 둘이 함께 걸리면 과목 조건이
 * 더 좁아 결과가 같다(과목 활성 수강자는 반드시 end_date null 수강이 있다).
 */
function enrollmentEmbed(options?: StudentListFilters): {
  select: string;
  subjectFilter: boolean;
  teacherFilter: boolean;
} {
  // '미수강'이 섞이면 과목은 embed가 아니라 JS 판정(getSubjectFilterKeep)으로 건다 — "수강 없음"은 inner join으로 못 잡는다.
  const { real, none } = subjectFilterOf(options);
  const bySubject = real.length > 0 && !none;
  // 🔴 상태=퇴원 + 담당 강사 필터 — 퇴원생은 활성 수강이 없어 getTeacherScope(활성 기반) id 화이트리스트가
  //    전원을 걸러 항상 0명이었다(적대 리뷰 F4). 퇴원에선 같은 embed 조인에 teacher_id 조건을 실어
  //    **이력 포함**으로 매치한다(id 목록 URL 폭발도 없음 — 위 🔴 2026-07-29 수리와 같은 이유).
  const byTeacher = options?.status === "withdrawn" && parseMulti(options?.teacherId).length > 0;
  const classCols = [bySubject ? "subject" : null, byTeacher ? "teacher_id" : null]
    .filter(Boolean)
    .join(", ");
  return {
    select: classCols
      ? `enrollments!inner(id, class:class_id!inner(${classCols}))`
      : "enrollments!inner(id)",
    subjectFilter: bySubject,
    teacherFilter: byTeacher,
  };
}

/**
 * 과목 필터 값 풀이 — 과목 키들 + '미수강' 여부. 🔴 상태=퇴원이면 '미수강'을 무시한다(퇴원생은 정의상 활성 수강이 없어
 * 전원이 '미수강' — '미수강 제외' 토글을 퇴원에서 무시하는 것과 같은 이유). 화면도 퇴원에선 그 선택지를 안 세운다.
 */
function subjectFilterOf(options?: StudentListFilters): { real: string[]; none: boolean; all: string[] } {
  const all = parseMulti(options?.subject);
  const none = all.includes(NO_SUBJECT) && options?.status !== "withdrawn";
  const real = all.filter((s) => s !== NO_SUBJECT);
  return { real, none, all: none ? all : real };
}

/**
 * `getStudentsPage`가 students에서 직접 읽는 컬럼들.
 * ⚠️ select 문자열을 **조건부로 조립**하면(embed 유무) supabase-js의 리터럴 타입 추론이 풀려
 * 행 타입이 `GenericStringError`로 떨어진다 → 여기서 실제 모양을 명시하고 좁힌다.
 * 컬럼을 더 읽게 되면 아래 select 문자열과 **이 타입을 함께** 고칠 것.
 */
type StudentPageRecord = {
  id: string;
  name: string;
  english_name: string | null;
  school: string | null;
  grade: string | null;
  status: string;
  enrolled_at: string | null;
  parent_phone: string | null;
};

export async function getStudentsList(
  options?: StudentListFilters,
  /**
   * `applyTeacherScope` = **화면(/students)과 같은 축**이어야 하는 소비처(엑셀 내보내기)만 켠다 — 강사면
   * 담당 학생으로 좁히고 과목·담당 강사 축도 화면과 같게 줄인다.
   * 🔴 기본값(끔)은 의도적이다: 반 상세 '학생 배정' 후보·발송 콘솔 학생 선택기는 학원 전체가 맞고,
   *    거기서 좁히면 겸직 관리자가 강사뷰에서 남의 학생을 반에 못 넣는다(별개의 결정).
   */
  scopeOptions?: { applyTeacherScope?: boolean },
): Promise<StudentListRow[]> {
  const supabase = await createClient();
  const teacherScope = scopeOptions?.applyTeacherScope ? await effectiveTeacherScope({ includeScheduled: true }) : null;
  if (teacherScope && teacherScope.studentIds.length === 0) return [];
  const axis = subjectAxisOf(teacherScope);
  // ⚠️ 스코프는 **받아온 뒤 JS로** 거른다 — id 수백을 `.in()`으로 URL에 실으면 414 + content-location
  //    헤더 초과로 조용히 "0명"이 된다(임계 n≈398, 이 파일 enrollmentEmbed 주석의 🔴 2026-07-29 사고).
  //    학생 전건은 어차피 아래 fetchAllPaged가 받고 있어 추가 왕복이 없다.
  const scopeIds = teacherScope ? new Set(teacherScope.studentIds) : null;
  // 메모 내용까지 훑는 검색(0250a) — 왕복은 검색어가 있을 때만, 상한 안에서.
  const memoIds = await extraSearchIds(supabase, options?.q, options?.searchField);
  const grades = parseMulti(options?.grade);
  // 학생 전건을 .range()로 페이지네이션 — export·반 상세가 전 학생을 받으므로 1000행 절단 방지.
  const all = await fetchAllPaged((from, to) => {
    let qb = supabase
      .from("students")
      .select(
        `id, name, english_name, school, grade, status, enrolled_at, parent_phone`,
      );
    if (options?.status && options.status !== "all") qb = qb.eq("status", options.status);
    if (grades.length > 0) qb = qb.in("grade", grades);
    // 강사 필터는 아래 in-memory(과목별 담당 강사 기준) — primary_teacher_id 제거로 쿼리단 필터 없음.
    qb = applySearch(qb, options?.q, options?.searchField, memoIds);
    return orderStudents(qb, options?.sort).range(from, to);
  });
  const scoped = scopeIds ? all.filter((r) => scopeIds.has(r.id)) : all;
  // 학년 정렬은 화면 목록과 같은 순서로(grade-sort.ts) — 엑셀 내보내기 행 = 목록 행 순서.
  const data = isGradeSort(options?.sort) ? sortByGrade(scoped, options?.sort === "grade_desc") : scoped;
  if (data.length === 0) return [];

  // 학생별 수강 과목 unique + 과목별 담당 강사(반의 teacher_id). id를 청크로 .in()(414 + error삼킴 방지).
  // 🔴 상태=퇴원이면 이력 포함(활성 조건 없이) — 안 그러면 과목·담당 강사 필터가 퇴원생을 전원 걸러
  //    항상 0명(적대 리뷰 F4, getStudentsPage와 같은 규칙).
  const isWithdrawn = options?.status === "withdrawn";
  // ⚠️ 여기엔 '실시간 재원생' 제외를 걸지 않는다(원장 2026-09-16) — 이 함수는 엑셀 내보내기·반 상세
  //    '학생 배정' 후보·발송 콘솔 선택기가 쓴다. 10월 시작 신입을 감추면 **그 학생을 반에 못 넣는다.**
  //    화면 목록(getStudentsPage)만 카드 숫자와 같은 집합을 본다.
  const studentIds = data.map((r) => r.id);
  const subjectsByStudent = new Map<string, Set<string>>();
  const teachersByStudent = new Map<string, Map<string, string>>(); // student → teacher_id → 이름 (필터용)
  // 표시용 (과목, 담당 강사) 짝 — 강사 스코프에서 '담당 강사' 열을 **담당 과목 반의 담당만**으로 좁히려면
  // 이름만으론 부족하다(어느 과목 반의 담임인지 알아야 남의 과목 담임을 뺀다).
  const teacherPairsByStudent = new Map<string, SubjectTeacher[]>();
  const enrolledSet = new Set<string>(); // 수강 중(end_date null, 휴원 포함) 반이 있는 학생
  {
    const ens = await fetchInChunks<{
      student_id: string;
      on_hold: boolean;
      end_date: string | null;
      class: EnrollClass | EnrollClass[] | null;
    }>(studentIds, (chunk) => {
      const q = supabase
        .from("enrollments")
        .select(
          "student_id, on_hold, end_date, class:class_id ( subject, teacher_id, teacher:teacher_id ( display_name ) )",
        )
        .in("student_id", chunk);
      return isWithdrawn ? q : q.is("end_date", null);
    });

    for (const e of ens) {
      enrolledSet.add(e.student_id); // 휴원 포함 — 반에 적힌 학생
      if (!isWithdrawn && e.on_hold) continue;
      const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as EnrollClass | undefined;
      if (klass?.subject) {
        const set = subjectsByStudent.get(e.student_id) ?? new Set<string>();
        set.add(klass.subject);
        subjectsByStudent.set(e.student_id, set);
      }
      if (klass?.teacher_id) {
        const t = (Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) as
          | { display_name?: string }
          | undefined;
        const tm = teachersByStudent.get(e.student_id) ?? new Map<string, string>();
        tm.set(klass.teacher_id, t?.display_name ?? "");
        teachersByStudent.set(e.student_id, tm);
        const pairs = teacherPairsByStudent.get(e.student_id) ?? [];
        pairs.push({ subject: klass.subject ?? null, name: t?.display_name ?? "" });
        teacherPairsByStudent.set(e.student_id, pairs);
      }
    }
  }

  let rows = data.map(
    (r) =>
      ({
        id: r.id,
        name: r.name,
        englishName: r.english_name ?? null,
        school: r.school,
        grade: r.grade,
        status: r.status,
        teacherNames: narrowTeacherNames(axis, teacherPairsByStudent.get(r.id) ?? []),
        enrolledAt: r.enrolled_at,
        parentPhone: r.parent_phone,
        subjects: narrowSubjects(axis, Array.from(subjectsByStudent.get(r.id) ?? []).sort()),
      }) satisfies StudentListRow,
  );

  // 과목 필터 (in-memory — subjects가 enrollments에서 옴). 여러 과목 = 합집합. '미수강'이 섞이면 화면 목록과
  // **같은 판정**(getSubjectFilterKeep — 운영실 '미수강' 막대와 같은 activeStudentIds)으로 거른다(파일 행 = 목록 행).
  const subjectFilter = subjectFilterOf(options);
  const subjectKeep = subjectFilter.none
    ? await getSubjectFilterKeep(subjectFilter.all, options?.status === "enrolled")
    : null;
  if (subjectKeep) {
    rows = rows.filter((r) => subjectKeep(r.id));
  } else if (subjectFilter.real.length > 0) {
    rows = rows.filter((r) => subjectFilter.real.some((s) => r.subjects.includes(s)));
  }
  // 담당 강사 필터 (in-memory — 그 강사들 반에 수강 중인 학생만, 여러 명 = 합집합)
  const teacherIds = parseMulti(options?.teacherId);
  if (teacherIds.length > 0) {
    rows = rows.filter((r) => teacherIds.some((t) => teachersByStudent.get(r.id)?.has(t)));
  }
  // 미수강 제외 (in-memory — 전건을 이미 받았으므로). 상태=퇴원이면 무시(getStudentsPage와 같은 이유 —
  // 퇴원생은 활성 수강이 없어 전원 걸러져 "항상 0명"이 된다). 수강 과목에 '미수강'을 골랐으면 무시(서로 반대라 늘 0명).
  if (options?.excludeNoEnrollment && options?.status !== "withdrawn" && !subjectFilter.none) {
    rows = rows.filter((r) => enrolledSet.has(r.id));
  }

  return rows;
}

/**
 * Stat 표시용 카운트 — 재원생 수 + 재원생의 과목별 distinct 학생 수(운영 관점: 전체/퇴원 아님).
 * 재원 수는 `count(exact, head)`(행 안 받음). 과목별은 distinct 학생이라 PostgREST count로 불가 →
 * 재원생의 활성 수강(휴원 제외)만 `fetchAllPaged` 전건 수집 후 JS distinct(B2 "전건 필요" 경로).
 * 과목별 수 = status=enrolled ∧ 그 과목 반 활성 수강(end_date null, on_hold false) — 재원+과목 필터 결과와 일치.
 */
export async function getEnrolledStatCounts(): Promise<{
  enrolled: number;
  bySubject: Record<string, number>;
  combinations: { subjects: string[]; value: number }[];
}> {
  const supabase = await createClient();
  // 강사 스코프: Stat 카드도 본인 담당 학생 기준(페이지 목록과 일치). teacher 또는 겸직-강사뷰.
  const teacherScope = await effectiveTeacherScope({ includeScheduled: true });
  if (teacherScope && teacherScope.studentIds.length === 0) return { enrolled: 0, bySubject: {}, combinations: [] };
  // 재원 수(count head)와 활성 수강 전건(요청 캐시 — 운영실 구성과 같은 행)을 병렬로. 과목별 집계는 순수 함수 한 벌 —
  // 표시 축(원장 2026-08-20: 게이지는 **담당 과목만**)도 그 안에서 건다. 운영실은 같은 순수 함수에 직접 받은 행을 넘긴다.
  // '실시간 재원생'(원장 2026-09-16) — 아직 한 과목도 시작 안 한 학생은 총원·과목 모두에서 뺀다.
  const [notStarted, ens] = await Promise.all([
    getNotStartedStudentIds(),
    loadActiveEnrolledEnrollments(),
  ]);
  const enrolled = await countEnrolledStudents(supabase, teacherScope, notStarted);
  return { enrolled, ...enrolledSubjectCounts(ens, teacherScope, kstToday()) };
}

/**
 * 학생목록 페이지용 서버 페이지네이션. 전체 564명을 통째로 가져와 렌더하던 병목 해소
 * (페이지 50행 + 그 페이지 학생의 enrollments만 조회). 과목 필터는 해당 과목 active 수강 학생
 * id를 먼저 풀어 `.in()`으로 좁힌다(in-memory 전체 필터 회피).
 */
export async function getStudentsPage(
  options: StudentListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: StudentListRow[]; total: number; hiddenNotStarted: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // 강사 스코프: teacher(또는 겸직-강사뷰)면 본인 담당 반 학생만(intra-tenant 누수 차단 + 사용성). fail-safe(쿼리가 자체 스코프).
  const teacherScope = await effectiveTeacherScope({ includeScheduled: true });
  const teacherStudentIds = teacherScope?.studentIds ?? null;
  if (teacherStudentIds && teacherStudentIds.length === 0) return { rows: [], total: 0, hiddenNotStarted: 0 };
  // 표시 축(원장 2026-08-20) — 행(누가 보이는지)은 그대로 두고 그 위에 그리는 과목·담당 강사만 좁힌다.
  const axis = subjectAxisOf(teacherScope);

  const isWithdrawn = options?.status === "withdrawn";
  /**
   * 상태=재원 목록에서 **아직 한 과목도 시작 안 한 학생**을 뺀다 — 상단 카드('재원 N명')와 같은 집합이다
   * (원장 2026-09-16 '실시간 재원생'). 🔴 카드만 빼고 목록을 안 빼면 "338명"이라 적어 놓고 339줄이 뜬다
   * (원장이 지적한 바로 그 종류의 불일치).
   * ⚠️ 상태=전체에선 그대로 보인다 — 등록은 확정된 학생이라 데스크가 찾을 수 있어야 한다. 몇 명을
   *    감췄는지는 `hiddenNotStarted`로 돌려주고 화면이 결과 줄에 밝힌다(조용히 빼지 않는다, [[#105]]).
   * 🔴 `getStudentsList`(엑셀·반 배정 후보)엔 걸지 않는다 — 거기서 감추면 그 학생을 반에 못 넣는다.
   */
  const hideNotStarted = options?.status === "enrolled" ? await getNotStartedStudentIds() : null;
  const hiddenCount = hideNotStarted?.size ?? 0;
  // 담당 강사 필터 → 그 강사 반에 수강 중인 학생 id(getTeacherScope 재사용, primary_teacher_id 대체).
  // 퇴원 상태는 id 화이트리스트 대신 embed 조인(teacherFilter)으로 — enrollmentEmbed 주석의 F4 참조.
  // 여러 강사 = 합집합(원장 2026-09-28 다중 선택). 🔴 한 명이면 종전대로 `.in("id")`(담당 학생 수라 URL이 짧다)지만,
  //    여럿을 합치면 수백 명이 될 수 있어 URL에 싣지 않고 아래 restrict 경로(id 전건 → JS)로 건다(#53 414·헤더 초과).
  const teacherIds = parseMulti(options?.teacherId);
  let teacherFilterIds: string[] | null = null;
  let teacherKeep: ReadonlySet<string> | null = null;
  if (teacherIds.length > 0 && !isWithdrawn) {
    const scopes = await Promise.all(teacherIds.map((id) => getTeacherScope(id)));
    const union = [...new Set(scopes.flatMap((s) => s.studentIds))];
    if (union.length === 0) return { rows: [], total: 0, hiddenNotStarted: 0 };
    if (teacherIds.length === 1) teacherFilterIds = union;
    else teacherKeep = new Set(union);
  }

  // 과목·'미수강 제외'는 **id 목록이 아니라 embed 조인**으로 건다(위 enrollmentEmbed 주석의 🔴 참조).
  // 🔴 상태=퇴원에선 '미수강 제외'를 무시한다 — 퇴원생은 정의상 활성 수강이 없어 inner join이 전원을
  //    걸러 "검색해도 항상 0명"이 된다(2026-08-18 실사고: 퇴원 처리된 엄채율이 목록 어디서도 안 보임.
  //    토글이 계정 귀속(ui_prefs)이라 켜둔 채 퇴원 필터로 넘어오면 반드시 재현).
  // 수강 과목에 '미수강'을 골랐으면 '미수강 제외'는 무시한다 — 둘은 서로 반대라 함께 걸면 늘 0명(화면도 그땐 토글을 감춘다).
  const subjectFilter = subjectFilterOf(options);
  const excludeNoEnrollment = !!options?.excludeNoEnrollment && !isWithdrawn && !subjectFilter.none;
  const embed = enrollmentEmbed(options);
  const grades = parseMulti(options?.grade);
  // '미수강'이 섞인 과목 필터 — 운영실 '미수강' 막대와 같은 판정(getSubjectFilterKeep). 아래 restrict 경로(id 전건 → JS)로 건다.
  const subjectKeep = subjectFilter.none
    ? await getSubjectFilterKeep(subjectFilter.all, options?.status === "enrolled")
    : null;
  const needEnrollmentJoin = excludeNoEnrollment || embed.subjectFilter || embed.teacherFilter;
  // 메모 내용까지 훑는 검색(0250a) — 위 전건 조회와 같은 규약.
  const memoIds = await extraSearchIds(supabase, options?.q, options?.searchField);

  // 강사 스코프 ∩ 담당 강사 필터 → id 화이트리스트. 강사 1인의 담당 학생 수라 URL은 짧다.
  let idWhitelist: string[] | null = null;
  for (const list of [teacherStudentIds, teacherFilterIds]) {
    if (!list) continue;
    const s = new Set(list);
    idWhitelist = idWhitelist ? idWhitelist.filter((id) => s.has(id)) : list;
    if (idWhitelist.length === 0) return { rows: [], total: 0, hiddenNotStarted: 0 };
  }

  /** 목록 필터·정렬을 건 students 조회 — 한 페이지(count) 경로와 `restrictIds` 경로(id 전건)가 **같은 것**을 쓴다. */
  const buildQuery = (columns: string, withCount: boolean) => {
    let qb = supabase
      .from("students")
      .select(
        columns + (needEnrollmentJoin ? `, ${embed.select}` : ``),
        withCount ? { count: "exact" } : undefined,
      );
    if (options?.status && options.status !== "all") qb = qb.eq("status", options.status);
    if (hideNotStarted && hideNotStarted.size > 0) {
      qb = qb.not("id", "in", `(${[...hideNotStarted].join(",")})`);
    }
    if (grades.length > 0) qb = qb.in("grade", grades);
    qb = applySearch(qb, options?.q, options?.searchField, memoIds);
    if (needEnrollmentJoin) {
      // 공통: 종료되지 않은 수강. (휴원은 '수강 중'으로 본다 — 과목 필터일 때만 아래에서 더 좁힌다.)
      // 🔴 상태=퇴원에선 활성 조건을 떼고 **이력 포함** 매치 — 퇴원생은 활성 수강이 없어 그대로 걸면
      //    과목/강사 필터가 항상 0명이 된다(적대 리뷰 F4 — noenr만 고치고 남았던 반쪽).
      if (!isWithdrawn) qb = qb.is("enrollments.end_date", null);
      if (embed.subjectFilter) {
        if (!isWithdrawn) qb = qb.eq("enrollments.on_hold", false);
        qb = qb.in("enrollments.class.subject", subjectFilter.real);
      }
      if (embed.teacherFilter) qb = qb.in("enrollments.class.teacher_id", teacherIds);
    }
    if (idWhitelist) qb = qb.in("id", idWhitelist);
    // 정렬 — 필터 적용(.eq/.or/.in/.not) 다음에 .order(이후엔 transform 빌더). 기본 grade.
    return orderStudents(qb, options?.sort);
  };

  let pageData: StudentPageRecord[];
  let total: number;
  const restrictIds = options?.restrictIds ?? null;
  // 운영실 집합(restrictIds)·'미수강' 판정(subjectKeep)·여러 담당 강사(teacherKeep) — 전부 "id 전건 → JS" 경로를 탄다.
  const restrictBy =
    restrictIds || subjectKeep || teacherKeep
      ? {
          has: (id: string) =>
            (!restrictIds || restrictIds.has(id)) &&
            (!subjectKeep || subjectKeep(id)) &&
            (!teacherKeep || teacherKeep.has(id)),
          empty: restrictIds?.size === 0,
        }
      : null;
  // 학년 정렬(기본)도 id 전건 경로를 탄다 — 학년 순서(미취학 → 초 → 중 → 고)는 DB 글자순으로 못 내서 JS로 줄 세운다(grade-sort.ts).
  // 학생 수 규모라 한두 쪽(id·학년·이름만) + 그 쪽 50명 — 종전 한 번 조회보다 한 왕복 더 든다.
  const gradeSort = isGradeSort(options?.sort);
  const restrict = restrictBy ?? (gradeSort ? { has: () => true, empty: false } : null);
  if (restrict) {
    // 🔑 운영실 KPI ↗(`program=`·`first=`)가 넘긴 학생 집합 — 수백 명이라 `.in("id", …)`에 싣지 않는다(URL 414·헤더
    //    초과, 위 enrollmentEmbed 🔴 2026-07-29 사고). 같은 필터·정렬로 **id 전건**을 받아(학생 수 규모 — 한두 쪽,
    //    unique tie-break `id`로 OFFSET 안정화) JS로 거른 뒤 자르고, 그 쪽(≤ pageSize명)만 다시 받는다.
    // 🔑 전건을 목록 칸(STUDENT_PAGE_COLUMNS)까지 **한 번에** 받는다 — 거른 뒤 그 쪽만 다시 받으면 기본 화면(학년순)이
    //    직렬 왕복 하나를 더 낸다(리뷰 2026-10-14). 순서는 orderStudents(끝이 id)라 1000행씩 넘겨도 안정적이다.
    const fetched =
      restrict.empty
        ? []
        : await fetchAllPaged<StudentPageRecord>(
            (f, t) =>
              buildQuery(STUDENT_PAGE_COLUMNS, false).range(f, t) as unknown as PromiseLike<{
                data: StudentPageRecord[] | null;
                error: { message: string } | null;
              }>,
          );
    const matched: StudentPageRecord[] = [];
    const seen = new Set<string>();
    for (const row of gradeSort ? sortByGrade(fetched, options?.sort === "grade_desc") : fetched) {
      const id = row.id;
      if (seen.has(id) || !restrict.has(id)) continue;
      seen.add(id);
      matched.push(row);
    }
    total = matched.length;
    pageData = matched.slice(from, to + 1);
  } else {
    const { data, count, error } = await buildQuery(STUDENT_PAGE_COLUMNS, true).range(from, to);
    // 🔴 `data ?? []`로 삼키지 말 것 — 이 버그가 "8초 뒤 학생 0명"으로 보인 직접 원인이다.
    //    빈 결과와 실패는 화면에서 구분돼야 한다(빈 목록은 사실, 실패는 사실이 아니다).
    if (error) throw new Error(`학생 목록을 불러오지 못했습니다: ${error.message}`);
    pageData = (data ?? []) as unknown as StudentPageRecord[];
    total = count ?? pageData.length;
  }

  const ids = pageData.map((r) => r.id);
  const subjectsByStudent = new Map<string, Set<string>>();
  // (과목, 담당 강사) 짝 — 강사 스코프에서 남의 과목 담임을 빼려면 어느 과목 반의 담임인지가 필요하다.
  const teacherPairsByStudent = new Map<string, SubjectTeacher[]>();
  if (ids.length > 0) {
    // 퇴원 목록의 과목·담당 열은 **이력 기준**(활성 수강이 없으니 활성 조건이면 전부 빈칸) — F4와 같은 축.
    let ensQ = supabase
      .from("enrollments")
      .select(
        "student_id, on_hold, end_date, class:class_id ( subject, teacher_id, teacher:teacher_id ( display_name ) )",
      )
      .in("student_id", ids);
    if (!isWithdrawn) ensQ = ensQ.is("end_date", null);
    const { data: ens } = await ensQ;
    for (const e of (ens ?? []) as { student_id: string; on_hold: boolean; class: EnrollClass | EnrollClass[] | null }[]) {
      if (!isWithdrawn && e.on_hold) continue;
      const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as EnrollClass | undefined;
      if (klass?.subject) {
        const set = subjectsByStudent.get(e.student_id) ?? new Set<string>();
        set.add(klass.subject);
        subjectsByStudent.set(e.student_id, set);
      }
      if (klass?.teacher_id) {
        const t = (Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) as
          | { display_name?: string }
          | undefined;
        if (t?.display_name) {
          const pairs = teacherPairsByStudent.get(e.student_id) ?? [];
          pairs.push({ subject: klass.subject ?? null, name: t.display_name });
          teacherPairsByStudent.set(e.student_id, pairs);
        }
      }
    }
  }

  const rows = pageData.map((r) => {
    return {
      id: r.id,
      name: r.name,
      englishName: r.english_name ?? null,
      school: r.school,
      grade: r.grade,
      status: r.status,
      teacherNames: narrowTeacherNames(axis, teacherPairsByStudent.get(r.id) ?? []),
      enrolledAt: r.enrolled_at,
      parentPhone: r.parent_phone,
      subjects: narrowSubjects(axis, Array.from(subjectsByStudent.get(r.id) ?? []).sort()),
    } satisfies StudentListRow;
  });

  // 🔴 **몇 명을 감췄는지 함께 돌려준다** — 조용히 빠지면 "그 학생이 사라졌다"가 된다([[#105]] ·
  //    2026-08-18 엄채율 실사고와 같은 모양). 화면이 결과 줄에 한 마디로 밝힌다.
  return { rows, total, hiddenNotStarted: hiddenCount };
}

export type CareFocus = {
  priority: "high" | "medium" | "low";
  area: string;
  recommendation: string;
};

export type StudentDetail = {
  id: string;
  name: string;
  englishName: string | null;
  classnoteName: string | null;
  studentCode: string | null;
  attendanceCode: string | null;
  school: string | null;
  grade: string | null;
  status: string;
  gender: string | null;
  birthDate: string | null;
  nickname: string | null;
  graduationYear: string | null;
  address: string | null;
  zipCode: string | null;
  addressDetail: string | null;
  email: string | null;
  studentPhone: string | null;
  homePhone: string | null;
  otherPhone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentRelation: string | null;
  /** 보호자2(s2_0022) — 원생 수정 화면 '보호자 연락처'의 둘째 줄. */
  parent2Name: string | null;
  parent2Phone: string | null;
  parent2Relation: string | null;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  notes: string | null;
  createdAt: string;
  dupSuspect: boolean; // 동기화 자동 접미사(동명이인 판정) → "확인 필요" 배지
  aiCareSummary: string | null;
  aiCareFocus: CareFocus[] | null;
  aiCareModelVersion: string | null;
  aiCareGeneratedAt: string | null;
};

export type TeacherOption = {
  id: string;
  displayName: string;
  systemRole: string;
  subjects?: string[];
};

export async function getTeacherOptions(): Promise<TeacherOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role, subjects")
    .in("system_role", ["teacher", "counselor", "manager", "admin", "master"])
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    systemRole: r.system_role,
    subjects: Array.isArray(r.subjects) ? r.subjects : [],
  }));
}

/**
 * 학생목록 '담임' 필터의 선택지 — **강사 스코프일 때만** 학원 전체 강사 대신 축에 맞는 강사만 준다.
 *
 * 축(담당 과목)이 아닌 강사를 골라도 '담당 강사' 열엔 그 이름이 이제 안 나온다(narrowTeacherNames) →
 * "왜 이 학생이 걸렸는지" 근거가 화면에 없는 필터가 된다. 그래서 선택지를 **내 학생이 다니는
 * 담당 과목 반의 담당 강사**로 좁힌다(모든 선택지가 결과 ≥1이 되고, 열에 보이는 이름과 일치).
 *
 * 반환 null = 좁히지 않음(관리자·담당 반 0개) → 호출부가 종전 `getTeacherOptions()`를 쓴다.
 * ⚠️ `systemRole`은 안 담는다 — 여긴 반 담당에서 역산한 목록이라 역할을 모른다(모르는 값을 지어내지 않는다).
 */
export async function getScopedTeacherOptions(): Promise<
  { id: string; displayName: string }[] | null
> {
  const teacherScope = await effectiveTeacherScope({ includeScheduled: true });
  const axis = subjectAxisOf(teacherScope);
  if (!teacherScope || !axis) return null;
  if (teacherScope.studentIds.length === 0) return [];
  const supabase = await createClient();
  // 내 학생의 활성 수강 → 반(과목·담당). id 수십~수백이라 청크 분할(B3, 414 + error 삼킴 방지).
  const ens = await fetchInChunks<{
    class: EnrollClass | EnrollClass[] | null;
  }>(teacherScope.studentIds, (chunk) =>
    supabase
      .from("enrollments")
      .select("class:class_id ( subject, teacher_id, teacher:teacher_id ( display_name ) )")
      .is("end_date", null)
      .in("student_id", chunk),
  );
  const byId = new Map<string, string>();
  for (const e of ens) {
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as EnrollClass | undefined;
    if (!klass?.teacher_id) continue;
    if (!axisHasSubject(axis, klass.subject)) continue;
    const t = (Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) as
      | { display_name?: string }
      | undefined;
    if (t?.display_name) byId.set(klass.teacher_id, t.display_name);
  }
  return [...byId]
    .map(([id, displayName]) => ({ id, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
}

export async function getStudentById(id: string): Promise<StudentDetail | null> {
  // 🔴 강사(scoped)는 **담당 학생만** — 목록만 스코프였고 상세는 뚫려 있어 URL 직접 입력으로 학원 전체
  //    학생의 전화·주소·케어까지 열렸다(적대 리뷰 F9). 여기가 상세 페이지·요약 API의 초크포인트(#77).
  if (!(await canViewStudentDetail(id))) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select(
      `id, name, english_name, classnote_name, school, grade, status, student_code, attendance_code,
       gender, birth_date, nickname, graduation_year,
       address, zip_code, address_detail, email, student_phone, home_phone, other_phone,
       enrolled_at, withdrawn_at, created_at, notes, dup_suspect,
       parent_name, parent_phone, parent_relation, parent2_name, parent2_phone, parent2_relation,
       ai_care_summary, ai_care_focus, ai_care_model_version, ai_care_generated_at`,
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    englishName: data.english_name,
    classnoteName: data.classnote_name,
    studentCode: data.student_code,
    attendanceCode: data.attendance_code,
    school: data.school,
    grade: data.grade,
    status: data.status,
    gender: data.gender,
    birthDate: data.birth_date,
    nickname: data.nickname,
    graduationYear: data.graduation_year,
    address: data.address,
    zipCode: data.zip_code,
    addressDetail: data.address_detail,
    email: data.email,
    studentPhone: data.student_phone,
    homePhone: data.home_phone,
    otherPhone: data.other_phone,
    enrolledAt: data.enrolled_at,
    withdrawnAt: data.withdrawn_at,
    notes: data.notes,
    parentName: data.parent_name,
    parentPhone: data.parent_phone,
    parentRelation: data.parent_relation,
    parent2Name: data.parent2_name,
    parent2Phone: data.parent2_phone,
    parent2Relation: data.parent2_relation,
    createdAt: data.created_at,
    dupSuspect: data.dup_suspect === true,
    aiCareSummary: data.ai_care_summary,
    aiCareFocus: Array.isArray(data.ai_care_focus)
      ? (data.ai_care_focus as CareFocus[])
      : null,
    aiCareModelVersion: data.ai_care_model_version,
    aiCareGeneratedAt: data.ai_care_generated_at,
  };
}

export type StudentEnrollment = {
  id: string;
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null; // 이 반(과목)의 담당 강사 — 과목별 담당(단일 담임 대체)
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  /** 반이동으로 끝났는가 — 종료 규약(`isEnrollmentEndedOn`)이 이 값으로 당일 포함/배타를 가른다. */
  isTransferred: boolean;
  /** 특강 반인가(`isSpecialLecture` — 토글 또는 이름) — 끝난 특강은 퇴원관리 '수강종료'로 세지 않는다(상태 전환 창의 과목 종료 판정). */
  isSpecial: boolean;
};

/**
 * 한 학생의 수강 이력 — **요청 캐시**(React `cache`).
 *
 * 🔴 학생 상세 한 번 여는 데 이 함수를 **여러 곳이 각자 부른다**(페이지 본문 · 개요 탭 · 출결 탭 ·
 *    QuickPanel 요약 · 환불 프리필). 캐시가 없으면 같은 학생의 같은 조회가 그 수만큼 왕복한다.
 *    `cache`는 **요청 단위**라 다음 요청엔 새로 읽는다(신선도 손해 0).
 */
export const getStudentEnrollments = cache(async function getStudentEnrollments(
  studentId: string,
): Promise<StudentEnrollment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollments")
    // `is_transferred`는 **종료 규약에 필요하다** — 반이동은 종료일 당일에 이미 새 반 소속이고
    // 일반 종료는 그날까지 재원이라, 이 값 없이는 `isEnrollmentEndedOn`을 정확히 부를 수 없다.
    .select(
      `id, start_date, end_date, on_hold, is_transferred,
       class:class_id ( id, class_name, subject, is_special, teacher:teacher_id ( display_name ) )`,
    )
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });

  // 조회 실패를 "수강 0개"로 위장하지 않는다(B3) — 학생 상세·요약·환불 프리필이 다 이 값을 믿는다.
  if (error) throw new Error(`수강 이력 조회 실패: ${error.message}`);
  if (!data) return [];

  return data.map((r) => {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { id?: string; class_name?: string; subject?: string; is_special?: boolean | null; teacher?: { display_name?: string } | { display_name?: string }[] | null }
      | undefined;
    const teacher = (Array.isArray(klass?.teacher) ? klass?.teacher[0] : klass?.teacher) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      classId: klass?.id ?? "",
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
      teacherName: teacher?.display_name ?? null,
      startDate: r.start_date,
      endDate: r.end_date,
      onHold: r.on_hold,
      isTransferred: (r.is_transferred as boolean | null) ?? false,
      isSpecial: isSpecialLecture({ isSpecial: klass?.is_special, className: klass?.class_name }),
    };
  });
});

// ───────── 수업 탭(ijw CoursesTab 이식) — 스케줄(요일+교시)·강사·인원 포함 ─────────
// 요일 묶음 + 교시 라벨 접기는 [`classes/schedule-periods.ts`](../../classes/schedule-periods.ts)로
// 옮겼다(2026-09-10) — 등록상담 '배정된 반' 카드가 같은 표기를 써야 해서. 여긴 타입만 다시 내보낸다.
export type { ScheduleGroup };
// 개별 슬롯(요일 하나 × 시작시각 하나)의 모양·만드는 규칙은 [`lib/class-slots.ts`](../lib/class-slots.ts)
// (순수, Vitest — 2026-09-11 꺼냄). 여긴 다시 내보낸다.
export type { ClassSlot };
export type StudentClassRow = {
  enrollmentId: string;
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null;
  startDate: string;
  endDate: string | null;
  isTransferred: boolean;
  onHold: boolean;
  schedule: ScheduleGroup[];
  // 등원요일로 필터링된 개별 슬롯(groupSchedule과 동일 필터) — 학생 주간 시간표 그리드 소스.
  slots: ClassSlot[];
  // 분리등원 편집(EditableAttendanceCell)용: 실제 등원 요일(raw, []=전체) + 반 운영 요일(선택지).
  attendanceDays: string[];
  classDays: string[];
};

/** `class_schedules` 조회 행 — 슬롯 FK(교시 담당·강의실)와 시트 라벨을 함께 싣는다. */
type ScheduleDbRow = {
  id: string;
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_to: string | null;
  slot_room_label: string | null;
  classroom_id: string | null;
  teacher_id: string | null;
  slot_teacher_label: string | null;
};

export async function getStudentClassesDetail(studentId: string): Promise<StudentClassRow[]> {
  const supabase = await createClient();
  const { data: ens } = await supabase
    .from("enrollments")
    .select(
      `id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days,
       class:class_id ( class_name, subject, teacher:teacher_id ( display_name ), classroom:classroom_id ( name ) )`,
    )
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });
  if (!ens || ens.length === 0) return [];

  const classIds = [...new Set(ens.map((e) => e.class_id))];

  // 🔴 서로 독립인 네 조회를 한 번에(B4) — 배치 · 등록 강의실 · 강사 라벨 맵 · 학원설정(뒤 둘은 React cache).
  // ① 반별 배치(valid_from/valid_to 포함). ⚠️ class_schedules는 운영 이력을 함께 담아(#88) 반 몇 개로도 행이
  //    쌓인다 → id 목록 × 이력 표 = `fetchAllPagedInChunks`(청크 **안에서** 1,000행 침묵 절단 방지, B2 —
  //    수업목록이 그렇게 반의 요일을 통째로 잃었다). 교시 담당(FK)·라벨과 **강의실 FK**를 함께 읽는다 —
  //    없으면 칸마다 반 담임이 반복되고(교시마다 다른 선생님이 안 보인다) 시트 라벨 `606`이 그대로 적힌다.
  // ② 등록 강의실 전건(테넌트 RLS, 보관된 방 포함) — FK → 이름(`본원606`), FK 없는 맨숫자 라벨 → 등록 이름
  //    정정의 근거(좌석표·ECS와 같은 규약 · 목록은 whitelist라 무페이징 금지). ⚠️ 표시 전용이라 실패해도 탭은
  //    산다(라벨·반 기본 강의실로 떨어진다).
  // ③·④ '따로 수업(*LAB)' 재료 — 켠 교시 id(0271a)와 이 원생의 켠 수강 id(0271b). 둘 다 **따로·fail-soft**로 읽는다
  //    ([[#95]]: 위 뿌리 select에 칸을 끼우면 칸 없는 DB에서 이 탭이 통째로 죽는다). 하나라도 모르면 안 가른다.
  const [scheds, roomRows, labelMap, settings, labSlotIds, labFlaggedEnrollments] = await Promise.all([
    fetchAllPagedInChunks<ScheduleDbRow>(classIds, (chunk, from, to) =>
      supabase
        .from("class_schedules")
        .select(
          "id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, slot_room_label, classroom_id, teacher_id, slot_teacher_label",
        )
        .in("class_id", chunk)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{ id: string; name: string }>((from, to) =>
      supabase.from("classrooms").select("id, name").order("id").range(from, to),
    ).catch((err: unknown) => {
      console.error("[students] 강의실 목록 조회 실패 — 슬롯 라벨·반 기본 강의실로 표시", err);
      return [] as { id: string; name: string }[];
    }),
    getTeacherLabelMap(),
    // 교시 라벨은 테넌트 설정(과목별 override 포함) 기준.
    getTenantSettings(),
    loadLabSeparateIds(supabase, { kind: "classes", classIds }),
    getStudentLabSeparateEnrollmentIds(studentId),
  ]);
  const rooms = roomBookOf(roomRows);

  const schedByClass = new Map<string, ScheduleRow[]>();
  for (const s of scheds) {
    const arr = schedByClass.get(s.class_id) ?? [];
    arr.push({
      day: s.day_of_week as DayOfWeek,
      startTime: String(s.start_time).slice(0, 5),
      endTime: String(s.end_time).slice(0, 5),
      validFrom: s.valid_from ? String(s.valid_from).slice(0, 10) : null,
      validTo: s.valid_to ? String(s.valid_to).slice(0, 10) : null,
      roomId: s.classroom_id ?? null,
      roomLabel: s.slot_room_label ?? null,
      teacherId: s.teacher_id ?? null,
      teacherLabel: s.slot_teacher_label ?? null,
      ...(labSlotIds?.has(String(s.id)) ? { labSeparate: true } : {}),
    });
    schedByClass.set(s.class_id, arr);
  }

  // 🔴 반별 현재 인원(`studentCount`)은 **걷어냈다**(2026-09-03) — 반 개수만큼 카운트 쿼리를 돌고도
  //    화면에 한 번도 안 그려지고 있었다. 이 함수는 학생 상세가 한 요청에서 여러 번 부르므로
  //    그 왕복이 그대로 곱해졌다. 반 인원이 필요한 화면(수업 탭 배정 다이얼로그·반 이동)은
  //    `getClassesList()`가 주는 값을 쓴다 — 거기가 이미 단일 소스다.

  // 교시 담당 이름 — 라벨 없이 슬롯 FK만 있는 교시의 계정 이름(해석 규칙은 class-slots `buildClassSlots`).
  // 배치를 받아야 id를 알므로 여기만 진짜 의존 await.
  const slotTeacherIds = [...new Set(scheds.map((s) => s.teacher_id).filter((v): v is string => !!v))];
  const slotTeacherNames = new Map<string, string>();
  if (slotTeacherIds.length > 0) {
    const rows = await fetchInChunks<{ id: string; display_name: string | null }>(slotTeacherIds, (chunk) =>
      supabase.from("users").select("id, display_name").in("id", chunk),
    ).catch(() => []);
    for (const u of rows) if (u.display_name) slotTeacherNames.set(u.id, u.display_name);
  }

  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const today = kstToday();

  return ens.map((e) => {
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | {
          class_name?: string;
          subject?: string;
          teacher?: { display_name?: string } | { display_name?: string }[];
          classroom?: { name?: string } | { name?: string }[];
        }
      | undefined;
    const teacher = klass
      ? ((Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) as { display_name?: string } | undefined)
      : undefined;
    // 반 기본 강의실(classes.classroom_id) — 슬롯에 강의실 FK·라벨이 **둘 다** 없을 때 상속(수학 반 전부).
    const defaultRoom =
      ((Array.isArray(klass?.classroom) ? klass?.classroom[0] : klass?.classroom) as { name?: string } | undefined)
        ?.name ?? null;
    // 과목 키를 그대로 전달(string) — 커스텀 키(subject_1 등)도 과목별 교시표로 해석되고,
    // 미지의 키는 weekdayTableFor가 전역 평일표로 폴백(옛 'math 강제 coerce'와 동일 결과).
    const subject = klass?.subject ?? "other";
    const attDays = (Array.isArray(e.attendance_days) ? e.attendance_days : []) as string[];
    const attKo = attDays.map((d) => enumDayToKo(d as DayOfWeek));
    // 유효 슬롯만(#88 — 규칙은 class-slots `liveScheduleRows`). 기준일 = 수강 중이면 오늘,
    // 지난 수강이면 **그 수강의 마지막 날**(당시 스케줄이 사실 — 오늘 기준이면 종강 반은 전멸한다).
    const endYmd = enrollmentLastDate(e.end_date ? String(e.end_date).slice(0, 10) : null, !!e.is_transferred);
    const refDate = endYmd && endYmd < today ? endYmd : today;
    // *LAB 배정으로 자리 교시를 가른다 — 켠 원생은 *LAB만, 끈 원생은 일반 LAB만(원장 2026-09-18).
    //    🔴 재료를 하나라도 모르면 `null`을 넘겨 **한 줄도 빼지 않는다**(수업이 사라지는 쪽으로 틀리지 않는다).
    //    격자·텍스트 요약이 **같은 행 목록**을 쓰므로 두 표기가 갈리지 않는다.
    const labFlagged = labSlotIds && labFlaggedEnrollments ? labFlaggedEnrollments.has(String(e.id)) : null;
    const liveSlots = liveScheduleRows(schedByClass.get(e.class_id) ?? [], refDate);
    const rawSlots = filterLabSeparateRows(liveSlots, labFlagged);
    // 반 운영 요일(분리등원 선택지) = 이 반 **유효** 스케줄의 distinct 요일(요일순 — 만료 요일 금지).
    // 🔴 *LAB 가르기 **전** 목록으로 센다 — 이건 "이 반이 도는 요일"이라 한 원생의 배정으로 줄면
    //    그 요일을 등원 요일로 고를 수 없게 된다(그 반은 그날 여전히 돈다).
    const classDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].filter((d) => liveSlots.some((s) => s.day === d));
    // 등원요일 필터(분리등원)·교시 라벨·교시 담당·자리·강의실 = class-slots `buildClassSlots`
    // (텍스트 요약 groupSchedule과 같은 등원 요일 필터 · 강의실은 좌석표·ECS와 같은 FK 우선 규칙).
    const slots: ClassSlot[] = buildClassSlots(rawSlots, {
      subject,
      attendanceDaysKo: attKo,
      periodsConfig,
      classRoomName: defaultRoom,
      rooms,
      labelMap,
      userNameById: slotTeacherNames,
    });
    return {
      enrollmentId: e.id,
      classId: e.class_id,
      className: klass?.class_name ?? "?",
      subject,
      teacherName: teacher?.display_name ?? null,
      startDate: e.start_date,
      endDate: e.end_date,
      isTransferred: !!e.is_transferred,
      onHold: e.on_hold,
      schedule: groupSchedule(rawSlots, subject, attKo, periodsConfig),
      slots,
      attendanceDays: attDays,
      classDays,
    } satisfies StudentClassRow;
  });
}

export type AttendanceWindowStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

export async function getStudentAttendanceStats(
  studentId: string,
  days = 30,
): Promise<AttendanceWindowStats> {
  const supabase = await createClient();
  // 🔴 창의 기준은 **KST 오늘**이고 비교 대상도 날짜 컬럼(`session_date`)이다 — `new Date()`로
  //    잡으면 서버가 UTC라 한국 새벽(00~09시)에 창이 하루 밀려 출석률이 어제 것으로 보인다.
  const startYmd = addDays(kstToday(), -days);

  /**
   * 🔴 `attendance_records`는 **정정을 새 행으로 남기는 append-only 표**다 — 그대로 세면 한 번
   *    고친 출결이 **두 번** 잡힌다(분모도 늘고, 되돌린 옛 상태까지 함께 센다). 실제로 이 창의
   *    "최근 30일 출석률"이 개요·QuickPanel에서 그렇게 부풀고 있었다.
   *    접는 규약은 앱 공용 단일 소스 `effectiveAttendanceRecords`(학생·반·수업일·**교시**가 같은 행
   *    중 recorded_at 최신 하나) — 그래서 select에 그 키 컬럼들을 함께 싣는다.
   * ⚠️ `slot_start`를 빼면 같은 날 두 교시가 한 칸으로 접혀 한 교시가 조용히 사라진다.
   */
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, student_id, class_id, session_date, slot_start, status, recorded_at")
    .eq("student_id", studentId)
    .gte("session_date", startYmd);
  if (error) throw new Error(`출결 통계 조회 실패: ${error.message}`);

  const rows = effectiveAttendanceRecords(
    (data ?? []) as (EffectiveAttendanceRecord & { status: string })[],
  );
  const total = rows.length;
  const present = rows.filter((r) => r.status === "present").length;
  const late = rows.filter((r) => r.status === "late").length;
  return {
    total,
    present,
    absent: rows.filter((r) => r.status === "absent").length,
    late,
    excused: rows.filter((r) => r.status === "excused").length,
    rate: attendanceRate(attendedCount({ present, late }), total),
  };
}

// ────────────────────── 7탭 데이터 ──────────────────────

export type StudentBillingLineItem = { description: string; amount: number };
export type StudentBillingRow = {
  id: string;
  period: string;
  category: string; // tuition/material/exam/other
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
  // makeedu는 (학생×월×항목) 라인 단위지만 aywa는 (학생×월) 1행으로 집계 → 항목 내역은 line_items에 보존.
  // 화면에서 "수업료" 대신 실제 항목명(강의명 등)을 펼쳐 보여주기 위해 함께 반환.
  lineItems: StudentBillingLineItem[];
};

export async function getStudentInvoices(studentId: string): Promise<StudentBillingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, period, category, amount_total, amount_paid, amount_discount, status, due_date, paid_at, notes, line_items",
    )
    .eq("student_id", studentId)
    .order("period", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    period: r.period,
    category: r.category,
    amountTotal: Number(r.amount_total),
    amountPaid: Number(r.amount_paid),
    amountDiscount: Number(r.amount_discount),
    status: r.status,
    dueDate: r.due_date,
    paidAt: r.paid_at,
    notes: r.notes,
    lineItems: Array.isArray(r.line_items)
      ? (r.line_items as { description?: string; name?: string; amount?: number }[]).map((li) => ({
          description: String(li.description ?? li.name ?? "").trim(),
          amount: Number(li.amount ?? 0),
        }))
      : [],
  }));
}

export type StudentGradeRow = {
  id: string;
  examName: string;
  subject: string;
  score: number | null;
  maxScore: number | null;
  takenOn: string;
  notes: string | null;
  /** 학기 축(0283a). 적용 전이거나 옛 자유 입력 행이면 전부 null — 그때는 시험명만 읽는다. */
  schoolYear: number | null;
  term: Term | null;
  examSlot: ExamSlotKey | null;
};

const BASE_GRADE_COLS = "id, exam_name, subject, score, max_score, taken_on, notes";

export async function getStudentGrades(studentId: string): Promise<StudentGradeRow[]> {
  const supabase = await createClient();
  const rowsOf = (cols: string) =>
    supabase
      .from("student_grades")
      .select(cols)
      .eq("student_id", studentId)
      .order("taken_on", { ascending: false });

  // 🔴 새 컬럼(0283a)을 select에 넣으면 **적용 전에는 PostgREST 400**이라 성적 탭이 통째로 죽는다([[#95]] —
  //    eywa는 SQL을 손으로 적용하므로 배포와 적용 사이에 항상 간격이 있다). 한 번 시도하고, 실패하면
  //    옛 모양으로 되읽는다(그 창에선 `2026년 2학기 · 중간고사` 라벨만 안 보이고 나머지는 그대로).
  const withTerm = await rowsOf(`${BASE_GRADE_COLS}, school_year, term, exam_slot`);
  const data = (withTerm.error ? (await rowsOf(BASE_GRADE_COLS)).data : withTerm.data) as
    | {
        id: string;
        exam_name: string;
        subject: string;
        score: string | number | null;
        max_score: string | number | null;
        taken_on: string;
        notes: string | null;
        school_year?: number | null;
        term?: number | null;
        exam_slot?: string | null;
      }[]
    | null;
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    examName: r.exam_name,
    subject: r.subject,
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    takenOn: r.taken_on,
    notes: r.notes,
    schoolYear: r.school_year ?? null,
    term: isTerm(r.term) ? r.term : null,
    examSlot: isExamSlot(r.exam_slot) ? r.exam_slot : null,
  }));
}

// === 수업 진도/보고서(lesson_reports) — 학생 상세 '진도' 탭(ijw StudentDetail ProgressTab 이식) ===
export type LessonReportRow = {
  id: string;
  reportDate: string;
  progress: string | null;
  examInfo: string | null;
  homeworkScore: string | null;
  teacherName: string | null;
  classnoteStatus: string | null; // ClassNote 발송 상태(queued/processing/success/failed/too_old, null=미발송)
  linkStatus: "active" | "revoked" | "expired"; // 학부모 공유 링크 상태(P2a)
  viewCount: number; // 학부모 열람 수(share_link_views)
  /**
   * 과목 키 — `reportSubject()` 단일 소스(보고서 subject → 반의 과목 → 레거시 이관분=math).
   * 🔴 2026-07-29 감사: 이 값이 **select조차 안 돼 있어** 화면이 과목을 표시할 방법이 없었다.
   * 영어 강사가 학생을 열면 수학 진도 12줄이 그 학생의 '수업 진도'로 보였다(발송상태·열람수 배지까지 달고).
   */
  subject: string;
};

/** 진도 탭 한 쪽 크기(원장 2026-09-18 *"전체 페이지네이션해서 10건씩"*) — 목록 표준(50)의 명시 예외. */
export const STUDENT_REPORTS_PAGE_SIZE = 10;

/**
 * 학생 수업보고서 **한 쪽**(최신순) + 전체 건수 — 발송상태·링크상태·열람수(P2a/P3).
 * 원장 2026-09-18: *"'최근 12'건이 아니고 전체 페이지네이션해서 10건씩 넘기도록 해. 날짜 조회 가능하도록 필터 기능도"*.
 *
 * 🔴 건수는 `count: "exact"`로 **행을 받지 않고** 센다(B2) · 🔴 정렬에 `id`를 덧붙인다 — 같은 날 보고서가 여럿이면
 *    날짜만으론 순서가 흔들려 쪽을 넘길 때 한 줄이 두 쪽에 서거나 사라진다.
 * ⚠️ 날짜 필터는 **보고서 날짜**(`report_date`) 기준이고 양 끝을 포함한다. 형식이 어긋난 값은 무시한다.
 */
export async function getStudentLessonReportsPage(
  studentId: string,
  opts: { page?: number; pageSize?: number; from?: string | null; to?: string | null } = {},
): Promise<{ rows: LessonReportRow[]; total: number }> {
  const pageSize = opts.pageSize ?? STUDENT_REPORTS_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = opts.from && iso.test(opts.from) ? opts.from : null;
  const to = opts.to && iso.test(opts.to) ? opts.to : null;
  const supabase = await createClient();
  let q = supabase
    .from("lesson_reports")
    .select(
      "id, report_date, progress, exam_info, homework_score, teacher_name, classnote_status, revoked_at, subject, class_id",
      { count: "exact" },
    )
    .eq("student_id", studentId);
  if (from) q = q.gte("report_date", from);
  if (to) q = q.lte("report_date", to);
  const start = (page - 1) * pageSize;
  const { data, count } = await q
    .order("report_date", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + pageSize - 1);
  const total = count ?? 0;
  if (!data || data.length === 0) return { rows: [], total };

  // 학부모 열람 수(share_link_views) — 이 보고서 id들로 조회 후 JS 집계(roster와 동일 패턴, RLS 테넌트 격리).
  // 반 과목 — 보고서 subject가 비어도 반이 있으면 그 반의 과목이 진실(reportSubject 2순위). 한 쪽(10건)뿐이라 가볍다.
  // 서로 독립이라 병렬(B4).
  const ids = data.map((r) => r.id);
  const classIds = [...new Set(data.map((r) => r.class_id).filter(Boolean))] as string[];
  const [viewRows, classRows] = await Promise.all([
    fetchInChunks<{ lesson_report_id: string }>(ids, (chunk) =>
      supabase.from("share_link_views").select("lesson_report_id").in("lesson_report_id", chunk),
    ),
    classIds.length
      ? fetchInChunks<{ id: string; subject: string | null }>(classIds, (chunk) =>
          supabase.from("classes").select("id, subject").in("id", chunk),
        )
      : Promise.resolve([] as { id: string; subject: string | null }[]),
  ]);
  const classSubjectById = new Map(classRows.map((c) => [c.id, c.subject]));
  const viewCountById = new Map<string, number>();
  for (const v of viewRows)
    viewCountById.set(v.lesson_report_id, (viewCountById.get(v.lesson_report_id) ?? 0) + 1);

  const rows: LessonReportRow[] = data.map((r) => ({
    id: r.id,
    reportDate: r.report_date,
    progress: r.progress,
    examInfo: r.exam_info,
    homeworkScore: r.homework_score,
    teacherName: r.teacher_name,
    classnoteStatus: r.classnote_status,
    linkStatus: r.revoked_at ? "revoked" : isShareExpired(r.report_date) ? "expired" : "active",
    viewCount: viewCountById.get(r.id) ?? 0,
    subject: reportSubject({
      subject: r.subject,
      classSubject: r.class_id ? classSubjectById.get(r.class_id) : null,
    }),
  }));
  return { rows, total };
}

// === 성적 목표설정(grade_goals) — 실제 점수와 매칭해 달성 여부 산출 ===
export type GradeGoalRow = {
  id: string;
  examId: string | null;
  /** 축이 있는 목표는 `2026년 2학기 · 중간고사`(칸에서 다시 만든 라벨), 옛 목표는 적힌 이름 그대로. */
  examName: string;
  subject: string;
  targetScore: number;
  maxScore: number | null;
  reason: string | null;
  createdAt: string;
  // 읽기 시점 산출(denormalize 안 함)
  actualScore: number | null;
  actualMaxScore: number | null;
  /** 달성률 집계용(달성 true · 미달 false · 그 밖 null). 화면 표시는 `status`. */
  achieved: boolean | null;
  status: GoalStatus;
  /** 성적 칸 키(`goalCellKey`) — 옛 이름 매칭 목표는 null. 기록 행에 목표를 붙일 때 쓴다. */
  cellKey: string | null;
};

/**
 * 학생의 시험 목표 + 실제 점수 대비 상태(원장 2026-09-24, codex 합의).
 * 🔑 축이 있는 목표 = 성적 칸(과목·년도·학기·시험·월) **정확 일치**, 옛 목표만 `시험명 + 과목` 이름 매칭 폴백.
 * 🔴 축이 채워진 목표는 이름 폴백을 절대 안 탄다(같은 이름의 다른 해 성적에 붙는다).
 */
export async function getStudentGradeGoals(studentId: string): Promise<GradeGoalRow[]> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return [];
  const supabase = await createClient();
  const [goals, schemaReady, monthReady, noExamReady] = await Promise.all([
    loadGoals(user.tenantId, [studentId]), gradesSchemaReady(), gradeMonthReady(), gradeNoExamReady(),
  ]);
  if (!goals.length) return [];
  const cols = `exam_name, subject, score, max_score${schemaReady ? ", school_year, term, exam_slot" : ""}${monthReady ? ", exam_month" : ""}${noExamReady ? ", no_exam" : ""}`;
  const { data, error } = await supabase.from("student_grades").select(cols).eq("tenant_id", user.tenantId).eq("student_id", studentId);
  if (error) throw new Error(`성적 조회 실패: ${error.message}`);
  type Cell = { score: number | null; max: number | null; noExam: boolean };
  const byCell = new Map<string, Cell>();
  const byName = new Map<string, Cell>();
  for (const g of (data ?? []) as unknown as {
    exam_name: string; subject: string; score: string | null; max_score: string | null;
    school_year?: number | null; term?: number | null; exam_slot?: string | null; exam_month?: number | null; no_exam?: boolean | null;
  }[]) {
    const cell = { score: g.score == null ? null : Number(g.score), max: g.max_score == null ? null : Number(g.max_score), noExam: g.no_exam === true };
    if (g.school_year != null && g.term != null && g.exam_slot) {
      byCell.set(goalCellKey({ subject: g.subject, year: g.school_year, term: g.term, slot: g.exam_slot, month: g.exam_month ?? 0 }), cell);
    }
    byName.set(`${g.exam_name}__${g.subject}`, cell);
  }
  return goals.map((g) => {
    const cellKey = g.axis ? goalCellKey({ subject: g.subject, ...g.axis }) : null;
    const cell = (cellKey ? byCell.get(cellKey) : byName.get(`${g.examName}__${g.subject}`)) ?? null;
    const status = goalStatus({ target: g.target, max: g.max }, cell);
    return {
      id: g.id, examId: null, examName: g.axis ? goalExamLabel(g.axis) : g.examName, subject: g.subject,
      targetScore: g.target, maxScore: g.max, reason: g.reason, createdAt: g.createdAt,
      actualScore: cell?.score ?? null, actualMaxScore: cell?.max ?? null,
      achieved: status === "achieved" ? true : status === "missed" ? false : null, status, cellKey,
    };
  });
}

// === 성적 코멘트(grade_comments) — 학습 피드백 ===
export type GradeCommentRow = {
  id: string;
  category: string;
  subject: string | null;
  content: string;
  period: string;
  sharedWithParent: boolean;
  authorName: string | null;
  createdAt: string;
};

export async function getStudentGradeComments(studentId: string): Promise<GradeCommentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grade_comments")
    .select(
      `id, category, subject, content, period, shared_with_parent, created_at,
       author:author_id ( display_name )`,
    )
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const author = (Array.isArray(r.author) ? r.author[0] : r.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      category: r.category,
      subject: r.subject,
      content: r.content,
      period: r.period,
      sharedWithParent: r.shared_with_parent,
      authorName: author?.display_name ?? null,
      createdAt: r.created_at,
    };
  });
}

export type LevelTestRow = {
  id: string;
  testType: string; // placement/promotion/diagnostic
  subject: string;
  testedOn: string;
  level: string | null;
  subscores: Record<string, number> | null;
  notes: string | null;
};

export async function getStudentLevelTests(studentId: string): Promise<LevelTestRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("level_tests")
    .select("id, test_type, subject, tested_on, level, subscores, notes")
    .eq("student_id", studentId)
    .order("tested_on", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    testType: r.test_type,
    subject: r.subject,
    testedOn: r.tested_on,
    level: r.level,
    subscores: (r.subscores as Record<string, number> | null) ?? null,
    notes: r.notes,
  }));
}

export type StudentMemoRow = {
  id: string;
  category: string;
  content: string;
  pinned: boolean;
  /** 학생 검색에서 이 메모 내용도 매칭 대상으로 쓸지(0250a) — 작성·수정 폼의 '검색 허용' 토글. */
  searchable: boolean;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
};

export async function getStudentMemos(studentId: string): Promise<StudentMemoRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_memos")
    .select(
      `id, category, content, pinned, searchable, created_at, created_by,
       author:created_by ( display_name )`,
    )
    .eq("student_id", studentId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const a = (Array.isArray(r.author) ? r.author[0] : r.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      category: r.category,
      content: r.content,
      pinned: r.pinned ?? false,
      // 0250a 이전 행은 컬럼이 없어 undefined — 그때는 '허용'으로 본다(마이그레이션 기본값과 같다).
      searchable: r.searchable ?? true,
      createdAt: r.created_at,
      createdBy: r.created_by,
      createdByName: a?.display_name ?? null,
    };
  });
}

export type StudentConsultationRow = {
  id: string;
  consultedAt: string;
  category: string | null;
  subject: string | null;
  audience: string | null;
  summary: string;
  followUpAction: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
  counselorName: string | null;
};

export async function getStudentConsultationHistory(
  studentId: string,
): Promise<StudentConsultationRow[]> {
  const supabase = await createClient();
  // 강사 스코프: 학생 상세의 상담 탭도 **본인이 등록한 상담**만 — 남이 쓴 상담 미노출(상담 목록/상세와 동일 불변식).
  const tId = await effectiveTeacherId();
  // ⚠️ filter(.eq)는 transform(.order)보다 먼저 — supabase-js는 transform 뒤 filter 불가.
  let qb = supabase
    .from("student_consultations")
    .select(
      `id, consulted_at, category, subject, audience, summary,
       follow_up_action, follow_up_date, follow_up_done,
       counselor:counselor_id ( display_name )`,
    )
    .eq("student_id", studentId);
  if (tId) qb = qb.eq("counselor_id", tId);
  const { data } = await qb.order("consulted_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const c = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      consultedAt: r.consulted_at,
      category: r.category,
      subject: r.subject,
      audience: r.audience,
      summary: visibleConsultationSummary(r.summary),
      followUpAction: r.follow_up_action,
      followUpDate: r.follow_up_date,
      followUpDone: r.follow_up_done,
      counselorName: c?.display_name ?? null,
    };
  });
}

export type StudentEnrollmentConsultRow = {
  id: string;
  date: string | null;
  subject: string | null;
  outcome: string | null;
  request: string | null;
  careerGoal: string | null;
  followUp: string | null;
};

/**
 * 학생에 연결된 **등록상담(입학 상담)** — 학생 상세 상담 탭 상단에 [입학 상담] 라벨로 고정 노출.
 * 학생당 1~3건. RLS로 테넌트 자동 격리 + 호출부(page)가 enrollment 접근권한으로 게이트(민감정보).
 * ⚠️ 이건 enrollment_consultations(입학상담) — student_consultations(재원생 상담)와 별개 테이블.
 * 🔴 조회 실패를 빈 목록으로 삼키지 않는다(2026-10-23 Codex 검토) — 실제 0건 · 준비 안 됨(컬럼·표 없음) · 조회 실패를
 *    모양으로 가르고, 화면(원생 상세 상담 탭 · 퇴원 상세 '콜&상담' 카드)이 셋을 다른 문장으로 적는다.
 */
export type StudentEnrollmentConsults =
  | { status: "ok"; rows: StudentEnrollmentConsultRow[] }
  | { status: "not_ready" }
  | { status: "error" };

export async function getStudentEnrollmentConsultations(
  studentId: string,
): Promise<StudentEnrollmentConsults> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollment_consultations")
    .select(
      "id, consulted_at, consultation_date, created_at, subject, outcome, parent_request, career_goal, follow_up_content",
    )
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (error) {
    logDbError(error, "students.enrollment-consultations", { studentId });
    return { status: describeDbError(error, { fallback: "" }).kind === "schema" ? "not_ready" : "error" };
  }
  return { status: "ok", rows: (data ?? []).map((r) => ({
    id: r.id,
    date: r.consulted_at ?? r.consultation_date ?? r.created_at ?? null,
    subject: r.subject,
    outcome: r.outcome,
    request: r.parent_request,
    careerGoal: r.career_goal,
    followUp: r.follow_up_content,
  })) };
}

export type StudentAttendanceDay = {
  date: string;
  status: string;
  className: string;
};

export async function getStudentAttendanceCalendar(
  studentId: string,
  days = 60,
): Promise<StudentAttendanceDay[]> {
  const supabase = await createClient();
  // 🔴 창의 기준은 **KST 오늘**이고 비교 대상도 날짜 컬럼(`session_date`)이다 — `new Date()`로
  //    잡으면 서버가 UTC라 한국 새벽(00~09시)에 창이 하루 밀려 출석률이 어제 것으로 보인다.
  const startYmd = addDays(kstToday(), -days);
  const { data } = await supabase
    .from("attendance_records")
    .select(`session_date, status, class:class_id ( class_name )`)
    .eq("student_id", studentId)
    .gte("session_date", startYmd)
    .order("session_date", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const c = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { class_name?: string }
      | undefined;
    return {
      date: r.session_date,
      status: r.status,
      className: c?.class_name ?? "?",
    };
  });
}

// ───────── 출결 탭(ijw AttendanceTab 이식) — 월 달력/리스트 두 뷰용 전건 ─────────
export type StudentAttendanceFull = {
  date: string; // YYYY-MM-DD
  status: string; // present|absent|late|excused|makeup|early_leave
  className: string;
  classId: string;
  note: string | null;
  /** classes.subject 내부 키. 라벨은 소비처가 buildSubjectMaps/useSubjectMaps로. */
  subject: string;
  /** 0196a 교시. null = 그날 전체(옛 기록). */
  slotStart: string | null;
  /** 0208a 자리(LAB/JJ). 학생 출결로는 정상 기록 — 감추지 않는다. */
  seatLabel: string | null;
  /**
   * 그날 그 반의 **수업보고서를 쓴 사람**(원장 2026-09-07 *"출결 뒤에 보고서 발송자"* · *"수학의 경우"*).
   * 🔴 담임이 아니다 — 월별 출석부 담당자 라벨과 **같은 축**(보고서 작성자)이다.
   * 🔴 **반이 적힌 보고서만** 읽는다(`class_id`) — 영어는 aywa에 보고서를 안 써서 자연히 빈다.
   *    edutrix 이관분은 반이 비어 있어(17,806건) 여기서도 빈다: 날짜만 보고 아무 행에나 붙이면
   *    수학 강사 이름이 영어 칸에 앉는다. 그 구간은 반 백필로 채우는 것이 정공법이다.
   */
  reporter: string | null;
};

/** 학생 전 출결 기록(월 네비·달력/리스트 뷰·과목/반 필터를 클라에서 처리하도록 전건 반환). */
export async function getStudentAttendanceFull(studentId: string): Promise<StudentAttendanceFull[]> {
  const supabase = await createClient();
  // 🔴 둘은 서로를 안 쓴다 — 순서대로 await하면 왕복이 합산된다(B4).
  const [data, reports] = await Promise.all([
    fetchAllPaged<{
    id: string;
    student_id: string;
    session_date: string;
    status: string;
    note: string | null;
    class_id: string;
    slot_start: string | null;
    seat_label: string | null;
    recorded_at: string;
    class: { class_name?: string; subject?: string } | { class_name?: string; subject?: string }[] | null;
  }>((from, to) =>
    supabase
      .from("attendance_records")
      .select(
        `id, student_id, session_date, status, note, class_id, slot_start, seat_label, recorded_at, class:class_id ( class_name, subject )`,
      )
      .eq("student_id", studentId)
      .order("session_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
    ),
    /**
     * 그 학생의 수업보고서 작성자를 (날짜, 반)으로 붙인다 — 위 `reporter` 주석의 규약.
     * ⚠️ 전건이 1000행을 넘을 수 있어(이관분 포함) `fetchAllPaged`(B2). 임베드가 없어 FK 힌트 불요(#94).
     * 🔴 **정렬을 반드시 걸 것** — `.range()` 페이지네이션은 순서가 정해져야 페이지가 안 겹치고 안 빠진다
     *    (덤으로 아래 "먼저 온 것을 남긴다"가 결정론이 된다 — 안 그러면 새로고침마다 이름이 바뀔 수 있다).
     */
    fetchAllPaged<{
      report_date: string;
      class_id: string | null;
      teacher_name: string | null;
    }>((from, to) =>
      supabase
        .from("lesson_reports")
        .select("report_date, class_id, teacher_name")
        .eq("student_id", studentId)
        .not("class_id", "is", null)
        .order("report_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ).catch(() => []),
  ]);
  const reporterMap = new Map<string, string>();
  for (const rp of reports) {
    const name = rp.teacher_name?.trim();
    if (!name || !rp.class_id) continue;
    const key = `${rp.report_date}|${rp.class_id}`;
    // 같은 칸에 보고서가 둘이면 먼저 온 것을 남긴다(둘 다 적으면 배지가 넘친다).
    if (!reporterMap.has(key)) reporterMap.set(key, name);
  }
  const reporterOf = (date: string, classId: string) => reporterMap.get(`${date}|${classId}`) ?? null;

  // append-only 정정 행을 전부 그리면 같은 교시가 두 번 나온다 — 최신만.
  return effectiveAttendanceRecords(data).map((r) => {
    const c = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { class_name?: string; subject?: string }
      | undefined;
    return {
      date: r.session_date,
      status: r.status,
      className: c?.class_name ?? "?",
      classId: r.class_id,
      note: r.note,
      subject: c?.subject ?? "",
      slotStart: r.slot_start,
      seatLabel: r.seat_label,
      reporter: reporterOf(r.session_date, r.class_id),
    } satisfies StudentAttendanceFull;
  });
}

// 등록상담 → 학생 timeline ↔ 학생상담 + 메모 + enrollment 변경 통합
export type TimelineEvent = {
  id?: string;
  date: string; // ISO date
  kind:
    | "enrollment_start"
    | "enrollment_end"
    | "enrollment_transfer"
    | "enrollment_schedule"
    | "enrollment_change"
    | "enrollment_delete"
    | "consultation"
    | "memo"
    | "status_change"
    | "grade"
    | "textbook"
    | "enrollment_consultation";
  title: string;
  description?: string | null;
  registrant?: string | null; // 등록자·변경 처리자
  recordedAt?: string; // 변경 처리 시각. 수강 적용일과 구분해 KST로 표시한다.
};

type EnrollConsultRow = {
  consulted_at: string;
  outcome: string | null;
  subject: string | null;
  parent_request: string | null;
};

export async function getStudentTimeline(studentId: string): Promise<TimelineEvent[]> {
  const supabase = await createClient();

  // 강사 스코프: 타임라인의 상담 이벤트도 **본인이 등록한 상담**만(남이 쓴 상담 내용 미노출, 상담 목록/상세와 동일).
  const tId = await effectiveTeacherId();
  // 입학(등록)상담 노출은 상담탭과 **같은 게이트 함수**로 판정한다(#77). 게이트를 여기서 직접 걸어야
  // 새 호출부(비서 툴 등)가 빼먹어도 새지 않는다 — 호출부에 맡기면 그게 곧 우회 구멍이다.
  const user = await getCurrentUser({ teacherView: true });
  const canSeeEnrollment = user
    ? await canSeeStudentEnrollment(user.systemRole, studentId)
    : false;
  let consultQuery = supabase
    .from("student_consultations")
    .select(`consulted_at, category, summary`)
    .eq("student_id", studentId);
  if (tId) consultQuery = consultQuery.eq("counselor_id", tId);

  const [
    { data: enrollments },
    { data: consultations },
    { data: memos },
    { data: grades },
    { data: textbooks },
    { data: student },
    { data: enrollConsults },
    historySeed,
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select(`id, class_id, start_date, end_date, is_transferred, withdrawal_reason, class:class_id ( class_name, subject )`)
      .eq("student_id", studentId),
    consultQuery,
    supabase
      .from("student_memos")
      .select(`created_at, category, content`)
      .eq("student_id", studentId),
    supabase
      .from("student_grades")
      .select(`taken_on, exam_name, subject, score, max_score`)
      .eq("student_id", studentId),
    // 교재 신청 이력(2026-07-21 원장 지시) — 시간표 hover의 '교재'가 수업보고서로 넘어가면서
    // 교재요청서는 **이력**으로 자리를 옮겼다. 학생별로 보면 학습 진행이 그대로 드러난다
    // (실측 김하나: 초5-2 1권→2권→3권→초6-1 1권→2권→초6-2 1권→2권, 2월~7월).
    // ⚠️ 금액은 싣지 않는다 — 교재비는 수납 권한 영역이라 타임라인으로 새면 게이트 우회(#77).
    supabase
      .from("textbook_orders")
      .select(`book_name, book_detail, request_date, created_at, registered_at, ordered_at, paid_at`)
      .eq("student_id", studentId),
    // 상태 변경(2026-07-21) — 전용 이력 테이블이 없어 students의 두 날짜 컬럼에서 **파생**한다.
    // ⚠️ 그래서 만들 수 있는 건 '재원 시작'·'퇴원' 둘뿐 — 휴원(on_hold)은 타임스탬프가 없어 못 만든다.
    // (전 이력이 필요해지면 status 전이 로그 테이블이 선행돼야 한다.)
    supabase
      .from("students")
      .select(`enrolled_at, withdrawn_at, withdrawal_metadata, notes`)
      .eq("id", studentId)
      .maybeSingle(),
    // 입학(등록)상담 — 재원 전 첫 접점. 게이트 없으면 아예 조회하지 않는다.
    canSeeEnrollment
      ? supabase
          .from("enrollment_consultations")
          .select(`consulted_at, outcome, subject, parent_request`)
          .eq("student_id", studentId)
      : Promise.resolve({ data: [] as EnrollConsultRow[] }),
    // 수강 변경 이력의 1차 조회 — 수강 행과 무관해 위 조회들과 나란히 돌린다(B4).
    // 강사 범위(강사 · 강사 뷰)에서는 읽지 않는다: 변경 로그는 강사에게 열람 권한이 없어 어차피 0행이고,
    // 강사 뷰는 강사가 보는 화면과 같아야 한다(위 상담 스코프와 같은 축 `tId`).
    tId ? Promise.resolve(null) : loadEnrollmentHistorySeed(studentId),
  ]);

  const events: TimelineEvent[] = [];

  const timelineEnrollments = (enrollments ?? []).map((e) => {
    const c = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { class_name?: string; subject?: string }
      | undefined;
    return {
      id: e.id,
      classId: e.class_id,
      className: c?.class_name ?? "—",
      subject: c?.subject ?? null,
      startDate: e.start_date,
      endDate: e.end_date,
      isTransferred: !!e.is_transferred,
      reason: e.withdrawal_reason,
    };
  });
  const history = await getStudentEnrollmentHistory(historySeed, timelineEnrollments);
  events.push(...enrollmentHistoryTimeline({ studentId, enrollments: timelineEnrollments, ...history }));

  // category 코드 → 한글. 임포트 데이터엔 audience 값("parent")이 섞여 있어, 매핑 안 되는 코드는 접미사 생략.
  const CONSULT_CATEGORY_LABEL: Record<string, string> = {
    general: "일반",
    academic: "학습/성적",
    emotional: "정서/심리",
    career: "진로",
    social: "교우관계",
    other: "기타",
  };
  for (const c of consultations ?? []) {
    const catLabel = c.category ? CONSULT_CATEGORY_LABEL[c.category] : null;
    const p = parseImportedNote(visibleConsultationSummary(c.summary));
    events.push({
      date: String(c.consulted_at).slice(0, 10),
      kind: "consultation",
      title: p.title ?? (catLabel ? `상담 — ${catLabel}` : "상담 기록"),
      description: p.body,
      registrant: p.registrant,
    });
  }

  for (const m of memos ?? []) {
    const p = parseImportedNote(m.content);
    events.push({
      date: String(m.created_at).slice(0, 10),
      kind: "memo",
      title: p.title ?? (m.category ? `특이사항 — ${m.category}` : "특이사항"),
      description: p.body,
      registrant: p.registrant,
    });
  }

  const subjectMaps = buildSubjectMaps((await getTenantSettings()).operations.subjects);
  for (const g of grades ?? []) {
    events.push({
      date: g.taken_on,
      kind: "grade",
      title: `${subjectMaps.labelOf(g.subject)} — ${g.exam_name}`,
      description:
        g.score == null
          ? null
          : g.max_score
            ? `${g.score} / ${g.max_score}점`
            : `${g.score}점`,
    });
  }

  for (const t of textbooks ?? []) {
    // 진행 = ijw식 3개 독립 체크(등록·납부·주문). raw enum 대신 완료된 단계만 한글로.
    const done = [
      t.registered_at ? "등록" : null,
      t.paid_at ? "납부" : null,
      t.ordered_at ? "주문" : null,
    ].filter(Boolean) as string[];
    events.push({
      date: String(t.request_date ?? t.created_at ?? "").slice(0, 10),
      kind: "textbook",
      title: t.book_name,
      description: [t.book_detail, done.length === 3 ? "처리 완료" : done.length ? `${done.join("·")} 완료` : "처리 대기"]
        .filter(Boolean)
        .join(" · "),
    });
  }

  // 상태 변경 — students의 두 날짜에서 파생(위 select 주석 참조). 휴원은 소스가 없어 못 만든다.
  if (student?.enrolled_at) {
    events.push({ date: String(student.enrolled_at).slice(0, 10), kind: "status_change", title: "재원 시작" });
  }
  if (student?.withdrawn_at && !isMergedStudent(student.notes)) {
    // 사유는 reasonDisplay — 표준 코드는 한글로, "반 이동" 같은 자유 텍스트는 그대로(reasonLabel은 '기타'로 뭉갠다).
    const md = student.withdrawal_metadata as { reason?: string | null; memo?: string | null } | null;
    // 퇴원일이 오늘 뒤면 **퇴원 예약**이다(원장 2026-09-28 "퇴원당일전까지 재원") — 일어난 일처럼 '퇴원'이라 적지 않는다.
    const wDate = String(student.withdrawn_at).slice(0, 10);
    events.push({
      date: wDate,
      kind: "status_change",
      title: wDate > kstToday() ? "퇴원 예정" : "퇴원",
      description: [reasonDisplay(md?.reason), md?.memo].filter(Boolean).join(" · ") || null,
    });
  }

  for (const ec of (enrollConsults ?? []) as EnrollConsultRow[]) {
    const outcome = ec.outcome ? OUTCOME_LABEL[ec.outcome as OutcomeKey] : null;
    // makeedu 목록 동기화가 채우는 안내 sentinel("ℹ️ …")은 상담 내용이 아니라 노이즈라 본문에서 뺀다.
    const body = ec.parent_request?.startsWith("ℹ️") ? null : ec.parent_request;
    events.push({
      date: String(ec.consulted_at).slice(0, 10),
      kind: "enrollment_consultation",
      title: [ec.subject ? subjectMaps.labelOf(ec.subject) : null, "입학 상담"].filter(Boolean).join(" "),
      description: [outcome, body].filter(Boolean).join(" · ") || null,
    });
  }

  // 최신 → 과거 정렬
  events.sort((a, b) => b.date.localeCompare(a.date) || (b.recordedAt ?? "").localeCompare(a.recordedAt ?? ""));
  return events;
}

// ────────────────────── QuickPanel 경량 요약 ──────────────────────

export type StudentSummary = {
  id: string;
  name: string;
  englishName?: string | null;
  school: string | null;
  grade: string | null;
  status: string;
  teacherNames: string[]; // 과목별 담당 강사 distinct(단일 담임 대체)
  attendance: {
    rate: number;
    total: number;
    present: number;
    absent: number;
    late: number;
  };
  enrollments: { className: string; subject: string; teacherName: string | null; onHold: boolean }[];
  /**
   * 🔴 **수납 읽기 권한이 없으면 `null`**([[#77]]) — 이 요약은 `students` 게이트만 지나는 표면
   * (QuickPanel API·창 오버레이·비서 툴)에서 쓰이는데, 미납·연체·청구월은 **수납(billing) 사실**이다.
   * 게이트를 화면에서만 걸면 API를 직접 부르면 그대로 나온다 — 그래서 **값을 만들지 않는다.**
   * ⚠️ 0으로 채우지 말 것: 0은 "완납"이라는 사실 주장이라 권한 없는 사람에게 거짓을 말하게 된다.
   */
  billing: {
    unpaidCount: number;
    overdueCount: number;
    latestPeriod: string | null;
    latestStatus: string | null;
  } | null;
};

/**
 * 학생 QuickPanel(우측 오버레이)용 경량 요약. 기존 server-only 쿼리들을
 * Promise.all로 합쳐 한 번에 반환. 리스트 로드엔 영향 없고(클릭 시 on-demand),
 * route handler(/api/students/[id]/summary)에서 호출된다.
 */
export async function getStudentSummary(studentId: string): Promise<StudentSummary | null> {
  // 🔴 수납 블록은 **billing 읽기 권한이 있을 때만** 만든다([[#77]]) — 이 요약의 호출부는 전부
  //    `students` 게이트만 지난다(QuickPanel API·창 오버레이·비서 툴). 조회 자체를 안 하므로
  //    권한 없는 사람의 응답엔 미납 사실이 애초에 담기지 않는다(왕복도 하나 준다).
  const user = await getCurrentUser({ teacherView: true });
  const canReadBilling = user
    ? (await accessLevelTenant(user.systemRole, "billing")) !== "none"
    : false;
  const [detail, attendance, enrollments, invoices] = await Promise.all([
    getStudentById(studentId),
    getStudentAttendanceStats(studentId, 30),
    getStudentEnrollments(studentId),
    canReadBilling ? getStudentInvoices(studentId) : Promise.resolve([]),
  ]);
  if (!detail) return null;

  const today = kstToday();
  /** 오늘 명단에 있는 수강인가 — 시작 전(예약)도, 이미 끝난 것도 아니다. 판정은 eligibility 단일 소스. */
  const onRoster = (e: StudentEnrollment) =>
    isEnrollmentOnRosterOn(
      { startDate: e.startDate, endDate: e.endDate, isTransferred: e.isTransferred },
      today,
    );
  // 미납 판정은 수납 단일 공식(invoiceOutstanding — paid/void/refunded 제외)으로. status!=="paid" 재구현은
  // void(makeedu 무효)·refunded까지 미납으로 세어 실데이터에서 미납 건수가 부풀었다(2026-07-17 적대 리뷰 확정).
  const unpaid = invoices.filter((i) => invoiceOutstanding(i) > 0);
  const overdue = unpaid.filter((i) => i.dueDate != null && i.dueDate < today);
  const latest = invoices[0] ?? null; // period desc 정렬이라 [0]이 최신

  return {
    id: detail.id,
    name: detail.name,
    englishName: detail.englishName,
    school: detail.school,
    grade: detail.grade,
    status: detail.status,
    teacherNames: [
      // 🔴 `endDate == null`로 자르지 않는다(2026-08-29) — 반이동을 예약하면 **지금 다니는 반**에
      //    미래 종료일이 붙어 그 반 강사가 요약에서 사라진다(그리고 아직 시작도 안 한 반의 강사가 뜬다).
      ...new Set(
        enrollments
          .filter((e) => onRoster(e) && e.teacherName)
          .map((e) => e.teacherName as string),
      ),
    ].sort(),
    attendance: {
      rate: attendance.rate,
      total: attendance.total,
      present: attendance.present,
      absent: attendance.absent,
      late: attendance.late,
    },
    enrollments: enrollments
      .filter(onRoster)
      .map((e) => ({ className: e.className, subject: e.subject, teacherName: e.teacherName, onHold: e.onHold })),
    // 수납 읽기 권한이 있을 때만 실는다(위 타입 주석 — 권한 없으면 null, 0이 아니다).
    billing: canReadBilling
      ? {
          unpaidCount: unpaid.length,
          overdueCount: overdue.length,
          latestPeriod: latest?.period ?? null,
          latestStatus: latest?.status ?? null,
        }
      : null,
  };
}
