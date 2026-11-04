import "server-only";
import { createClient } from "@/lib/supabase/server";
import { type SystemRole } from "@/lib/permissions";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { fetchInChunks } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { studentStatusLabel } from "@/features/students/status/status-labels";
import { classStatusMeta } from "@/features/classes/list-filters";
import { sheetT } from "@/features/teacher-view/i18n";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { listMakeupPoolClassIds } from "@/features/attendance/server/makeup-pool";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import {
  EMPTY_PALETTE_RESULT,
  PALETTE_LIMIT,
  type PaletteHit,
  type PaletteKind,
  type PaletteSearchResult,
} from "../palette";

// 🔴 타입을 여기서 다시 export 하지 않는다 — 클라(팰릿)가 server-only 모듈을 가리키는 습관이 생기고,
//    그러다 값 하나를 함께 가져오는 순간 빌드가 깨진다([[#61]]). 계약은 `../palette` 한 곳에서만 읽는다.

/** PostgREST .or()/ilike 안전화 — 구분자·와일드카드 문자 제거(한글/공백은 보존). */
function sanitize(q: string): string {
  return q.replace(/[%,()*\\]/g, " ").trim();
}

/**
 * 상담을 **학생 이름**으로 찾을 때 `student_id.in.(…)`에 실을 id 상한.
 * 🔴 이 id들은 쿼리스트링에 실린다 — 수백 개를 실으면 URL이 414로 죽는다([[#53]], 원생목록의
 *    `MEMO_MATCH_CAP`과 같은 이유). 상한에 걸리면 조용히 잘리지만 summary 매칭은 그대로라 검색이 죽지는 않는다.
 */
const NAME_MATCH_CAP = 60;

/** 지금 다니는(또는 곧 다닐) 원생 — 팰릿은 이쪽을 먼저 보여 준다. */
const ACTIVE_STUDENT_STATUSES = ["enrolled", "on_hold", "consulted", "prospect"];

type Res<T> = { data: T[] | null; error: { message: string } | null };

/**
 * 조회 실패를 **조용한 "0건"으로 만들지 않는다** — 그 축만 비우고 사유를 남긴다(나머지 축은 산다).
 * 종전엔 네 축 모두 `data ?? []`라, 컬럼 하나가 바뀌어 400이 나도 화면엔 "일치하는 결과가 없습니다"만 떴다([[#54]]·B3).
 */
function rowsOf<T>(axis: string, res: Res<T>): T[] {
  if (res.error) {
    console.error(`[palette] ${axis} 검색 실패: ${res.error.message}`);
    return [];
  }
  return res.data ?? [];
}

/** 상한(PALETTE_LIMIT)에 걸렸는지까지 담은 한 축의 결과. */
type Axis = { hits: PaletteHit[]; more: boolean };

const NO_HITS: Axis = { hits: [], more: false };

/** 한 축이 터져도 팰릿 전체가 500이 되지 않게(fetchInChunks·설정 조회는 일부러 throw 한다). */
async function axisOf(axis: string, run: () => Promise<Axis>): Promise<Axis> {
  try {
    return await run();
  } catch (e) {
    console.error(`[palette] ${axis} 검색 실패:`, e);
    return NO_HITS;
  }
}

/** LIMIT+1로 받아 "더 있다"를 판정하고 상한까지만 돌려준다. */
function cut(hits: PaletteHit[]): Axis {
  return { hits: hits.slice(0, PALETTE_LIMIT), more: hits.length > PALETTE_LIMIT };
}

const byName = <T extends { name?: string | null }>(a: T, b: T) =>
  (a.name ?? "").localeCompare(b.name ?? "", "ko");

type StudentRow = { id: string; name: string; school: string | null; grade: string | null; status: string };

/**
 * 원생 — 이름·학교·연락처(원생/학부모)·학부모 이름.
 *
 * 🔴 **강사(scoped)·강사뷰는 담당 원생만** — 원생목록(getStudentsPage)·상세(canViewStudentDetail)와 같은 축이다.
 *    팰릿만 스코프가 없어서, 담당 8명인 강사가 `/api/search/palette`로 학원 전체 828명(퇴원 462명 포함)의
 *    이름·학교·학년을 훑을 수 있었다([[#77]] — 표면마다 게이트를 다시 쓰면 한쪽만 조여진다).
 * 🔴 **재원 먼저** — 실데이터의 퇴원생이 재원생보다 많아(462 vs 366) 이름순 상위 8이 퇴원생으로 덮였다
 *    (실측 '김' → 상위 8명 중 5명 퇴원). 상태를 부제에 적어 "누구인지"도 함께 말한다.
 */
async function searchStudents(term: string): Promise<Axis> {
  const supabase = await createClient();
  const scope = await effectiveTeacherScope({ includeScheduled: true });
  if (scope && scope.studentIds.length === 0) return NO_HITS;
  const or = [
    `name.ilike.%${term}%`,
    `school.ilike.%${term}%`,
    // 원생 본인 전화도 — 원생목록 기본 검색(SEARCH_FIELD_COLS.all)과 같은 칸을 본다.
    `student_phone.ilike.%${term}%`,
    `parent_phone.ilike.%${term}%`,
    `parent2_phone.ilike.%${term}%`, // 보호자2(s2_0022) — 원생목록 검색과 같은 칸
    `parent_name.ilike.%${term}%`,
    `parent2_name.ilike.%${term}%`,
  ].join(",");

  // ⚠️ 필터(.or/.in/.not)는 transform(.order/.limit)보다 먼저 — supabase-js는 transform 뒤 filter 불가.
  const query = (active: boolean, ids: string[] | null) => {
    let q = supabase.from("students").select("id, name, school, grade, status").or(or);
    q = active
      ? q.in("status", ACTIVE_STUDENT_STATUSES)
      : q.not("status", "in", `(${ACTIVE_STUDENT_STATUSES.join(",")})`);
    if (ids) q = q.in("id", ids);
    return q.order("name", { ascending: true }).limit(PALETTE_LIMIT + 1);
  };
  const take = async (active: boolean): Promise<StudentRow[]> => {
    // 담당 원생 id는 수십 규모지만 학원이 커지면 는다 — 100개 청크로 나눠 URL 414를 피한다(B3).
    if (scope)
      return (
        await fetchInChunks<StudentRow>(scope.studentIds, (chunk) => query(active, chunk))
      ).sort(byName);
    return rowsOf<StudentRow>("원생", await query(active, null));
  };

  // 재원·퇴원은 서로를 안 기다린다(B4). 두 갈래를 이어 붙이면 "재원 먼저, 그 안에서 이름순"이 된다.
  const [active, past] = await Promise.all([take(true), take(false)]);
  return cut(
    [...active, ...past].map((r): PaletteHit => {
      // 재원이면 상태를 안 적는다(기본값을 되뇌면 부제가 길어지기만 한다). raw enum 노출 금지 규약대로 한글 라벨.
      const status = r.status === "enrolled" ? null : studentStatusLabel(r.status);
      const parts = [schoolGradeLabel(r.school, r.grade), status].filter(Boolean);
      return { kind: "student", id: r.id, title: r.name, subtitle: parts.join(" · ") || null };
    }),
  );
}

type ClassRow = { id: string; class_name: string; subject: string | null; is_active: boolean; closed_at: string | null };

/**
 * 수업 — 반 이름 + **과목(한글 라벨)**.
 *
 * 🔴 종전 `subject.ilike.%수학%`은 **영원히 0건**이었다 — DB엔 키(`math`·`english`)로 들어 있어 한글과
 *    한 글자도 안 겹친다(실측 injaewon: subject는 math 105 · english 63뿐). 학원설정 라벨로 키를 되찾아 건다
 *    (운영 enum 단일 소스 규약 — 화면에 '수학'이라 적어 놓고 'math'로만 찾히면 그건 검색이 아니다).
 * 🔴 강사(scoped)는 수업목록(getClassesPage)과 같이 **본인 담당 반만**, 보이지 않는 '보강' 반은 뺀다.
 */
async function searchClasses(term: string): Promise<Axis> {
  const supabase = await createClient();
  // 셋은 서로를 안 기다린다(B4) — 전부 아래 쿼리를 만드는 재료다.
  const [settings, tId, poolIds] = await Promise.all([
    getTenantSettings(),
    effectiveTeacherId(),
    listMakeupPoolClassIds(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const lower = term.toLowerCase();
  const keys = subjects.options.filter((o) => o.label.toLowerCase().includes(lower)).map((o) => o.value);
  const parts = [`class_name.ilike.%${term}%`, `subject.ilike.%${term}%`];
  if (keys.length > 0) parts.push(`subject.in.(${keys.join(",")})`);

  let q = supabase
    .from("classes")
    .select("id, class_name, subject, is_active, closed_at")
    .or(parts.join(","));
  if (tId) {
    const scope = await effectiveTeacherScope({ includeScheduled: true });
    if (!scope || scope.classIds.length === 0) return NO_HITS;
    q = q.in("id", scope.classIds);
  }
  // ⚠️ 컬럼 이름(`is_makeup_pool`)을 이 쿼리에 끼워 넣지 않는다 — 0241a 미적용이면 400으로 화면이 죽는다([[#95]]).
  if (poolIds.length > 0) q = q.not("id", "in", `(${poolIds.join(",")})`);
  // 운영 중인 반 먼저 — 실데이터 168개 중 47개가 종강·폐지라, 안 그러면 끝난 반이 상위 8을 먹는다.
  const rows = rowsOf<ClassRow>(
    "수업",
    await q
      .order("is_active", { ascending: false })
      .order("closed_at", { ascending: true, nullsFirst: true })
      .order("class_name", { ascending: true })
      .limit(PALETTE_LIMIT + 1),
  );

  return cut(
    rows.map((r): PaletteHit => {
      const status = classStatusMeta({ isActive: r.is_active, closedAt: r.closed_at });
      // 수업목록 기본 필터는 종강·폐지를 아예 감춘다 — 팰릿엔 남기되 무엇인지 적는다(라벨은 그 화면과 같은 사전).
      const parts = [
        r.subject ? subjects.labelOf(r.subject) : null,
        r.is_active && !r.closed_at ? null : sheetT("ko", status.key),
      ].filter(Boolean);
      return { kind: "class", id: r.id, title: r.class_name, subtitle: parts.join(" · ") || null };
    }),
  );
}

type ConsultationRow = {
  id: string;
  summary: string | null;
  student?: { name?: string } | { name?: string }[] | null;
};

/**
 * 재원생 상담 — 상담 **내용(summary)** + **학생 이름**.
 *
 * 🔴 이름 매칭이 없던 게 이 축의 가장 큰 구멍이었다: 결과 제목이 `{학생명} 상담`인데 정작 이름은 매칭
 *    대상이 아니라, 실측 1,799건 중 이름으로 찾히는 건 **24건(1.3%)** 뿐이었다(추이수 23건 → 0건).
 *    "상담 검색"이라 적어 놓고 사실상 안 도는 축이었다.
 * 🔴 강사 스코프는 그대로 — 강사(또는 강사뷰)는 **본인이 등록한 상담(counselor_id=나)** 만 본다(목록·상세와 같은 불변식).
 * 🔑 `student:student_id(...)`의 `student_id`는 **컬럼 이름 힌트**라 FK가 늘어도 모호해지지 않는다([[#94]]).
 */
async function searchConsultations(term: string): Promise<Axis> {
  const supabase = await createClient();
  const tId = await effectiveTeacherId();
  // 이름 → 학생 id(상한 안에서). 결과가 아니라 **필터 재료**라 스코프 밖 학생이 섞여도 노출되는 건 없다
  // (아래 counselor_id 게이트가 남의 상담을 막는다).
  const named = rowsOf<{ id: string }>(
    "상담(학생 이름)",
    await supabase.from("students").select("id").ilike("name", `%${term}%`).limit(NAME_MATCH_CAP),
  );
  const parts = [`summary.ilike.%${term}%`];
  if (named.length > 0) parts.push(`student_id.in.(${named.map((r) => r.id).join(",")})`);

  // ⚠️ filter(.eq)는 transform(.order/.limit)보다 먼저 — supabase-js는 transform 뒤 filter 불가.
  let qb = supabase
    .from("student_consultations")
    .select("id, summary, consulted_at, student:student_id ( name )")
    .or(parts.join(","));
  if (tId) qb = qb.eq("counselor_id", tId);
  const rows = rowsOf<ConsultationRow>(
    "상담",
    await qb.order("consulted_at", { ascending: false }).limit(PALETTE_LIMIT + 1),
  );

  return cut(
    rows.map((r): PaletteHit => {
      const s = (Array.isArray(r.student) ? r.student[0] : r.student) as { name?: string } | undefined;
      return {
        kind: "consultation",
        id: r.id,
        title: s?.name ? `${s.name} 상담` : "상담",
        subtitle: r.summary ? visibleConsultationSummary(String(r.summary)).slice(0, 40) : null,
      };
    }),
  );
}

type EnrollmentRow = { id: string; prospect_name: string | null; prospect_school: string | null };

/** 등록상담 — 학생·학부모 이름 + **학부모 요청 원문(parent_request)**. */
async function searchEnrollment(term: string): Promise<Axis> {
  const supabase = await createClient();
  const rows = rowsOf<EnrollmentRow>(
    "신규 콜&상담",
    await supabase
      .from("enrollment_consultations")
      .select("id, prospect_name, prospect_school")
      .or(`prospect_name.ilike.%${term}%,parent_name.ilike.%${term}%,parent_request.ilike.%${term}%`)
      // 정렬이 없으면 같은 검색어가 열 때마다 다른 8건을 준다(상한이 있는 목록에 임의 순서는 곧 임의 결과다).
      .order("consulted_at", { ascending: false })
      .limit(PALETTE_LIMIT + 1),
  );
  return cut(
    rows.map(
      (r): PaletteHit => ({
        kind: "enrollment",
        id: r.id,
        title: r.prospect_name ?? "신규 콜&상담",
        subtitle: r.prospect_school ?? "신규 콜&상담",
      }),
    ),
  );
}

/**
 * 커맨드 팰릿 데이터 검색 — 접근 권한 있는 메뉴만 병렬 검색. 결과는 원생→수업→상담→등록상담 순.
 * RLS(auth_tenant_id())가 **테넌트**를 격리하고, 테넌트 **안**의 강사 스코프는 각 축이 직접 건다
 * (RLS는 역할을 안 본다 — students·classes 정책은 tenant_id 하나뿐이다).
 */
export async function searchPalette(q: string, role: SystemRole): Promise<PaletteSearchResult> {
  const term = sanitize(q);
  if (term.length < 2) return EMPTY_PALETTE_RESULT;
  // 게이트 4개도 서로를 안 기다린다(B4 — 종전엔 await가 줄지어 있었다).
  const [canStudents, canClasses, canConsultations, canEnrollment] = await Promise.all([
    canAccessTenant(role, "students"),
    canAccessTenant(role, "classes"),
    canAccessTenant(role, "consultations"),
    canAccessTenant(role, "enrollment"),
  ]);
  const [students, classes, consultations, enrollment] = await Promise.all([
    canStudents ? axisOf("원생", () => searchStudents(term)) : NO_HITS,
    canClasses ? axisOf("수업", () => searchClasses(term)) : NO_HITS,
    canConsultations ? axisOf("상담", () => searchConsultations(term)) : NO_HITS,
    canEnrollment ? axisOf("신규 콜&상담", () => searchEnrollment(term)) : NO_HITS,
  ]);
  const axes: [PaletteKind, Axis][] = [
    ["student", students],
    ["class", classes],
    ["consultation", consultations],
    ["enrollment", enrollment],
  ];
  return {
    hits: axes.flatMap(([, a]) => a.hits),
    more: axes.filter(([, a]) => a.more).map(([kind]) => kind),
  };
}
