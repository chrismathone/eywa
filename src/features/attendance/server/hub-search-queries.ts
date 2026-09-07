import "server-only";
/**
 * 출석부 **허브(진입 전) 학생 검색** 조회 — "이 학생이 누구 반이지"를 강사를 고르기 전에 푼다.
 *
 * 원장 제보 2026-08-20: *"진입하기 전에도 검색가능하도록"*. 종전 허브에는 과목·강사·반 드롭다운뿐이라
 * 학생 이름으로는 아무것도 못 찾았다(시트 안 검색은 **강사를 고른 뒤**에만 있다).
 *
 * 🔴 **권한 판정을 새로 짜지 않는다** — 볼 수 있는 반은 시트(`getMonthlyAttendanceMatrix`)와 **같은 함수**
 *    [`loadVisibleClassAxisRows`](./teacher-axis-queries.ts)가 정한다. 강사(scoped)는 자기가 가르치는
 *    반만 넘어오고, 그 밖의 수강은 순수 조립 함수가 한 번 더 버린다(이중 방어, [[#77]]).
 * 🔴 **매트릭스(무거운 출석 데이터)는 부르지 않는다** — 허브는 요약 화면이다. 필요한 건 이름·반·담당뿐.
 * 🔴 **B2/B3**: `ilike` + **상한**(HUB_SEARCH_LIMIT)으로 좁혀 조회하고, 반 id는 `fetchInChunks`(414 방지).
 *    상한에 걸리면 `truncated`를 실어 화면이 "앞 N건"이라고 **밝힌다**([[#89]] — 잘라놓고 전부인 척 금지).
 * ⚠️ 페이로드에는 **화면이 그리는 값만** 싣는다(이름·학교·학년·반·담당). 연락처·주소는 select에도 없다.
 * ⚠️ 툴바의 **과목 필터는 보지 않는다** — 질문이 "이 학생이 누구 반이지"라 과목으로 좁히면 정작 찾는
 *    아이가 사라진다(권한 범위와 달리 과목은 보기 필터다). 그래서 결과 링크도 `subject`를 안 싣는다 —
 *    옛 과목이 남으면 목적지 강사에게 그 과목 반이 없어 빈 화면이 된다.
 */
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { sheetMonthLabel, sheetT, sheetTf } from "@/features/teacher-view/i18n";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstMonth, kstToday, monthRange } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { dowsFromKeys } from "../calendar";
import {
  HUB_SEARCH_LIMIT,
  buildHubHits,
  hubEnrollmentAsOf,
  hubSearchPattern,
  type HubSearchEnrollment,
  type HubSearchResult,
} from "../hub-search";
import { loadVisibleClassAxisRows } from "./teacher-axis-queries";

type Row = {
  class_id: string;
  student_id: string;
  /** 분리등원 — 비면 반 운영 요일 전부(등원요일 라벨의 절반). */
  attendance_days: string[] | null;
  student:
    | { id?: string; name?: string; school?: string | null; grade?: string | null }
    | { id?: string; name?: string; school?: string | null; grade?: string | null }[]
    | null;
};

// 🔴 이 문구들은 **서버가 만든다** — 그래서 여기서 화면 언어를 읽는다(강사 미니셸이면 영어).
//    쿠키 한 번이고 React 캐시라 왕복이 늘지 않는다.
function emptyResult(where: string, error?: string): HubSearchResult {
  return { hits: [], truncated: false, limit: HUB_SEARCH_LIMIT, where, ...(error ? { error } : {}) };
}

export async function loadHubStudentSearch(input: {
  query: string;
  /** 화면이 보고 있는 달(YYYY-MM) — 그 달에 **수강 중인** 학생만 찾는다(지난 수업 제외). */
  month: string;
}): Promise<HubSearchResult> {
  const month = /^\d{4}-\d{2}$/.test(input.month) ? input.month : kstMonth();
  const lang = await getTeacherViewLang();
  // 한국어는 짧게(`8월`), 영어는 앱 전역 월 표기(`August 2026`) — 문장 안에 들어가는 조각이다.
  const monthLabel = sheetMonthLabel(month, `${Number(month.slice(5, 7))}월`, lang);

  const plainScope = sheetTf(lang, "att.search.scope.plain", { month: monthLabel });
  const user = await getCurrentUser();
  if (!user) return emptyResult(plainScope);
  // 화면(page)의 requireAccess("attendance")와 **같은 게이트** — 읽기라 canAccessTenant(readonly 통과).
  if (!(await canAccessTenant(user.systemRole, "attendance"))) return emptyResult(plainScope);

  const viewerTeacherId = await effectiveTeacherId();
  // 🔑 0건 문구가 말할 **찾은 범위** — '수강 중'으로 좁혔다는 사실을 문구가 밝힌다(보이지 않는 필터 금지).
  const where = sheetTf(
    lang,
    viewerTeacherId ? "att.search.scope.mine" : "att.search.scope.all",
    { month: monthLabel },
  );

  const pattern = hubSearchPattern(input.query);
  if (!pattern) return emptyResult(where);

  const range = monthRange(month);
  // 수강이 '지금' 열려 있는지 잴 하루 — 보고 있는 달 안으로 접은 오늘(규칙은 순수 함수 한 곳).
  const asOf = hubEnrollmentAsOf(kstToday(), range.from, range.to);
  let classes;
  try {
    classes = await loadVisibleClassAxisRows(range.from, range.to);
  } catch {
    return emptyResult(where, sheetT(lang, "att.search.err.classes"));
  }
  const classIds = classes.map((c) => c.id);
  if (classIds.length === 0) return emptyResult(where);

  const supabase = await createClient();
  let rows: Row[];
  try {
    rows = await fetchInChunks<Row>(classIds, (chunk) =>
      supabase
        .from("enrollments")
        // ⚠️ `student:student_id!inner` — 임베드 컬럼으로 거르려면 inner join이어야 하고, FK는 컬럼으로
        //    명시한다([[#94]] — 힌트 없는 임베드는 남이 FK를 하나 더한 날 화면째 죽는다).
        .select("class_id, student_id, attendance_days, student:student_id!inner ( id, name, school, grade )")
        .in("class_id", chunk)
        // 🔴 **현재 수강 중인 반만**(원장 2026-08-24 *"지나간 수업은 검색할 필요 없음"*).
        //    종전엔 "그 달과 겹치는 수강"이라 8/4에 끝난 반도 8월과 겹쳐 통과했고, 최하림 검색이
        //    5줄(그중 2줄이 지난 수업)로 떴다. 이제 기준일 하루로 재서 학생 상세의 '수강 중인 수업'과
        //    같은 뜻이 된다(배정 예정·지난 수업은 빠진다).
        // ⚠️ 트레이드오프: 그 달 시트에는 있는데 검색에는 안 뜨는 줄이 생긴다(그 달 안에 끝난 수강).
        //    지난 달을 열었을 땐 기준일이 그 달로 접히므로(`hubEnrollmentAsOf`) 그때 다니던 반은 그대로 뜬다.
        .eq("on_hold", false)
        .lte("start_date", asOf)
        .or(`end_date.is.null,end_date.gte.${asOf}`)
        .ilike("student.name", pattern)
        // 청크마다 같은 순서를 받도록 unique 정렬(정렬 자체는 아래 순수 함수가 다시 한다).
        .order("id", { ascending: true })
        // +1 = "더 있다"를 알아내기 위한 한 칸(받아온 길이가 상한을 넘으면 잘렸다는 뜻).
        .limit(HUB_SEARCH_LIMIT + 1),
    );
  } catch {
    return emptyResult(where, sheetT(lang, "att.search.err.students"));
  }

  const enrollments: HubSearchEnrollment[] = [];
  for (const r of rows) {
    const s = (Array.isArray(r.student) ? r.student[0] : r.student) ?? null;
    if (!s?.id || !s.name) continue; // 이름이 없으면 화면에 그릴 게 없다(uuid 노출 금지)
    enrollments.push({
      classId: r.class_id,
      studentId: s.id,
      studentName: s.name,
      school: s.school ?? null,
      grade: s.grade ?? null,
      attendanceDays: r.attendance_days ?? null,
    });
  }

  // 매치된 반의 **그 달 살아있는 수업요일** — 등원요일 라벨의 나머지 절반.
  //
  // ⚠️ 여기서만 왕복이 하나 는다. 반이 정해진 **뒤**라 위 조회와 못 묶는다(진짜 의존이라 B4 위반 아님)
  //    — 대신 **매치가 0건이면 아예 안 부른다**(검색어가 없으면 애초에 여기까지 못 온다).
  // 🔴 `loadSlotAxisByClass`를 재사용하지 않는다 — 그건 `teacher_id IS NOT NULL`만 읽어서
  //    자리(LAB·JJ) 슬롯이 통째로 빠진다(그 반 학생의 요일이 조용히 사라진다).
  // 🔴 유효구간 필터는 매트릭스와 **같다** — 빼면 끝난 배치의 요일이 섞인다([[#88]]:
  //    `class_schedules`는 운영 이력을 함께 담는다).
  // 🔴 `.in()`은 청크(B3) + 페이징(B2) — 반 하나가 교시를 여럿 갖는다(영어는 10교시)라
  //    청크 하나가 1000행을 넘을 수 있고, 그러면 요일이 **조용히** 절단된다([[#54]]).
  const matchedClassIds = [...new Set(enrollments.map((e) => e.classId))];
  const classDows = new Map<string, number[]>();
  if (matchedClassIds.length > 0) {
    try {
      const slots = await fetchAllPagedInChunks<{ class_id: string; day_of_week: string }>(
        matchedClassIds,
        (chunk, from, to) =>
          supabase
            .from("class_schedules")
            .select("class_id, day_of_week, id")
            .in("class_id", chunk)
            .lte("valid_from", range.to)
            .or(`valid_to.is.null,valid_to.gte.${range.from}`)
            // OFFSET 페이지가 흔들리지 않게 unique tie-break(헬퍼 규약).
            .order("id", { ascending: true })
            .range(from, to),
      );
      const keysByClass = new Map<string, string[]>();
      for (const s of slots) {
        const list = keysByClass.get(s.class_id) ?? [];
        list.push(s.day_of_week);
        keysByClass.set(s.class_id, list);
      }
      // 요일 판정은 시트와 **같은 단일 소스**(dowsFromKeys) — 모르는 키는 여기서 버려진다.
      for (const [id, keys] of keysByClass) classDows.set(id, dowsFromKeys(keys));
    } catch {
      // 🔴 요일만 비게 두고 **검색 결과 자체는 살린다** — 이름으로 반을 찾는 것이 본업이다.
    }
  }

  const { hits, truncated } = buildHubHits({
    query: input.query,
    enrollments,
    classes: classes.map((c) => ({
      id: c.id,
      className: c.className,
      // 과목 그룹 머리글의 재료 — `ClassAxisRow`에 이미 실려 있다(조회 추가 0).
      subject: c.subject,
      teacherId: c.teacherId,
      teacherName: c.teacherName,
    })),
    schoolGradeOf: (school, grade) => schoolGradeLabel(school, grade),
    classDows,
    viewerTeacherId,
    limit: HUB_SEARCH_LIMIT,
    // 🔴 **거른 뒤가 아니라 받아온 원본**으로 판정한다 — 필터가 줄인 길이로 보면 "더 있는데 없다"가 된다.
    more: rows.length > HUB_SEARCH_LIMIT,
  });
  return { hits, truncated, limit: HUB_SEARCH_LIMIT, where };
}
