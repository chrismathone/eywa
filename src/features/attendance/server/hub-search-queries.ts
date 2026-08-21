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
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstMonth, monthRange } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  HUB_SEARCH_LIMIT,
  buildHubHits,
  hubSearchPattern,
  type HubSearchEnrollment,
  type HubSearchResult,
} from "../hub-search";
import { loadVisibleClassAxisRows } from "./teacher-axis-queries";

type Row = {
  class_id: string;
  student_id: string;
  student:
    | { id?: string; name?: string; school?: string | null; grade?: string | null }
    | { id?: string; name?: string; school?: string | null; grade?: string | null }[]
    | null;
};

function emptyResult(where: string, error?: string): HubSearchResult {
  return { hits: [], truncated: false, limit: HUB_SEARCH_LIMIT, where, ...(error ? { error } : {}) };
}

export async function loadHubStudentSearch(input: {
  query: string;
  /** 화면이 보고 있는 달(YYYY-MM) — 그 달 출석부에 실제로 뜨는 학생만 찾는다. */
  month: string;
}): Promise<HubSearchResult> {
  const month = /^\d{4}-\d{2}$/.test(input.month) ? input.month : kstMonth();
  const monthLabel = `${Number(month.slice(5, 7))}월`;

  const user = await getCurrentUser();
  if (!user) return emptyResult(`${monthLabel} 출석부`);
  // 화면(page)의 requireAccess("attendance")와 **같은 게이트** — 읽기라 canAccessTenant(readonly 통과).
  if (!(await canAccessTenant(user.systemRole, "attendance"))) return emptyResult(`${monthLabel} 출석부`);

  const viewerTeacherId = await effectiveTeacherId();
  const where = viewerTeacherId ? `${monthLabel} 담당 반` : `${monthLabel} 출석부`;

  const pattern = hubSearchPattern(input.query);
  if (!pattern) return emptyResult(where);

  const range = monthRange(month);
  let classes;
  try {
    classes = await loadVisibleClassAxisRows(range.from, range.to);
  } catch {
    return emptyResult(where, "반 목록을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요");
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
        .select("class_id, student_id, student:student_id!inner ( id, name, school, grade )")
        .in("class_id", chunk)
        // 시트가 학생을 싣는 조건과 같다(그 달과 겹치는 수강 · 휴원 제외) — 결과를 눌렀는데
        // 그 학생이 표에 없으면 검색이 거짓말이 된다.
        .eq("on_hold", false)
        .lte("start_date", range.to)
        .or(`end_date.is.null,end_date.gte.${range.from}`)
        .ilike("student.name", pattern)
        // 청크마다 같은 순서를 받도록 unique 정렬(정렬 자체는 아래 순수 함수가 다시 한다).
        .order("id", { ascending: true })
        // +1 = "더 있다"를 알아내기 위한 한 칸(받아온 길이가 상한을 넘으면 잘렸다는 뜻).
        .limit(HUB_SEARCH_LIMIT + 1),
    );
  } catch {
    return emptyResult(where, "학생을 찾는 중 오류가 났습니다 — 잠시 후 다시 시도해 주세요");
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
    });
  }

  const { hits, truncated } = buildHubHits({
    query: input.query,
    enrollments,
    classes: classes.map((c) => ({
      id: c.id,
      className: c.className,
      teacherId: c.teacherId,
      teacherName: c.teacherName,
    })),
    schoolGradeOf: (school, grade) => schoolGradeLabel(school, grade),
    viewerTeacherId,
    limit: HUB_SEARCH_LIMIT,
    // 🔴 **거른 뒤가 아니라 받아온 원본**으로 판정한다 — 필터가 줄인 길이로 보면 "더 있는데 없다"가 된다.
    more: rows.length > HUB_SEARCH_LIMIT,
  });
  return { hits, truncated, limit: HUB_SEARCH_LIMIT, where };
}
