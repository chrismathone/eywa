import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { isStaffInSubjectScope } from "@/features/staff/department/subject-scope";
import type { SourceGraph } from "./graph";
import type { Staff } from "./types";

const STAFF_ROLES = ["master", "admin", "manager", "teacher", "counselor", "accountant"];

/**
 * 통합 지식그래프의 바탕 — 기준일의 수강 관계(학생 → 반 → 담당 강사)와 검토된 업무 문서.
 * aywa-next는 이 바탕을 경영 분석 조회(loadManagement — 청구·회계 포함)에서 받았는데, 그 조회는 main에 아직 없다(경영·회계는 다른 작업).
 * 그래서 청구·회계·지표 없이 **수강 관계만** 여기서 직접 읽는다. 경영 조회가 들어오면 그 그래프를 source로 더하면 된다.
 * 노드 id 규약은 aywa-next 경영 그래프와 같다(`student:` · `class:` · `teacher:` · `work-record:`) — unifyGraphs가 지점 접두를 붙인다.
 */
type EnrollmentRow = { id: string; student_id: string; class_id: string; start_date: string; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null };
type ClassRow = { id: string; class_name: string; teacher_id: string | null; subject: string | null };
type StaffRow = Staff & { subjects: string[] | null; status: string; system_role: string };
type WorkRow = { id: string; author_id: string; version: number; updated_at: string; document: { title: string; date: string; state: string; plan: string; action: string; result: string; next: string } };

/**
 * scope — 원본 화면의 권한을 그대로 따른다(#77 · Claude·Codex 검토): 직원 이름·선택지 = 직원관리(staff) 열람 · 반 = 수업목록(classes) 열람.
 *  · staff=false → 직원 목록은 비고 강사 노드를 만들지 않는다(업무 문서 작성자 이름도 붙이지 않는다).
 *  · staffSubjects = 직원관리의 과목 범위(getViewerStaffScope — null이면 전체). 범위가 있으면 직원 목록과 같은 판정으로 범위 밖 직원을 뺀다(본인은 남긴다).
 *  · classes='none' → 반·수강 관계를 싣지 않는다 · { ids } → 그 반들만(강사 = 수업목록과 같은 범위: 담임 · 교시 담당 · 위임 — knowledgeSourceScope).
 */
/** includeNames = 직원관리 권한이 없어도 이름을 읽는다(가릴 이름을 알기 위해 — 화면에는 내보내지 않는다). */
export type CoreScope = { includeWork: boolean; staff: boolean; staffSubjects: readonly string[] | null; classes: "all" | "none" | { ids: readonly string[] }; userId: string; includeNames?: boolean };
export async function loadCoreGraph(tenant: string, asOf: string, studentIds: Set<string>, scope: CoreScope) {
  const db = createAdminClient();
  const classIds = typeof scope.classes === "object" ? [...scope.classes.ids] : null;
  const enrollmentCols = "id,student_id,class_id,start_date,end_date,on_hold,is_transferred";
  const [enrollments, classes, staffRows, work] = await Promise.all([
    scope.classes === "none" ? Promise.resolve<EnrollmentRow[]>([])
      : classIds ? fetchAllPagedInChunks<EnrollmentRow>(classIds, (chunk, a, b) => db.from("enrollments").select(enrollmentCols).eq("tenant_id", tenant).in("class_id", chunk).lte("start_date", asOf).or(`end_date.is.null,end_date.gte.${asOf}`).order("id").range(a, b))
      : fetchAllPaged<EnrollmentRow>((a, b) => db.from("enrollments").select(enrollmentCols).eq("tenant_id", tenant).lte("start_date", asOf).or(`end_date.is.null,end_date.gte.${asOf}`).order("id").range(a, b)),
    scope.classes === "none" ? Promise.resolve<ClassRow[]>([])
      : classIds ? fetchAllPagedInChunks<ClassRow>(classIds, (chunk, a, b) => db.from("classes").select("id,class_name,teacher_id,subject").eq("tenant_id", tenant).in("id", chunk).order("id").range(a, b))
      : fetchAllPaged<ClassRow>((a, b) => db.from("classes").select("id,class_name,teacher_id,subject").eq("tenant_id", tenant).order("id").range(a, b)),
    // 직원 이름은 전부 읽되(퇴사자 포함 — 글 속 이름을 가리려면 볼 수 없는 직원의 이름을 알아야 한다) 화면에는 볼 수 있는 직원만 내보낸다.
    !scope.staff && !scope.includeNames ? Promise.resolve<StaffRow[]>([]) : fetchAllPaged<StaffRow>((a, b) => db.from("users").select("id,display_name,subjects,status,system_role").eq("tenant_id", tenant).neq("system_role", "student").order("id").range(a, b)),
    // 남의 업무 문서 본문은 업무 작성센터 검토함을 읽을 수 있을 때만 싣는다(그 화면과 같은 문 — #77).
    !scope.includeWork ? Promise.resolve<WorkRow[]>([]) : fetchAllPaged<WorkRow>((a, b) => db.from("academy_work_records").select("id,author_id,version,updated_at,document").eq("tenant_id", tenant).in("document->>state", ["submitted", "reviewed"]).lte("document->>date", asOf).order("id").range(a, b)),
  ]);
  // 선택지·노드로 내보내는 직원 = 직원관리 권한 + 재직 + 직원 역할 + 과목 범위(본인은 남긴다) — 직원 목록과 같은 판정.
  const staff: Staff[] = !scope.staff ? [] : staffRows.filter(u => u.status === "active" && STAFF_ROLES.includes(u.system_role) && (u.id === scope.userId || isStaffInSubjectScope(scope.staffSubjects, u.subjects))).map(({ id, display_name }) => ({ id, display_name }));
  // 볼 수 없는 직원의 이름(서버 안에서만 쓴다 — 글 속 이름 가리기 · staff-mask.ts). 볼 수 있는 직원·본인과 이름이 같으면 가리지 않는다.
  const shownNames = new Set([...staff.map(u => u.display_name), ...staffRows.filter(u => u.id === scope.userId).map(u => u.display_name)]);
  const hiddenStaffNames = [...new Set(staffRows.filter(u => u.id !== scope.userId && !staff.some(v => v.id === u.id) && !shownNames.has(u.display_name)).map(u => u.display_name))];
  const classMap = new Map(classes.map(c => [c.id, c])), staffMap = new Map(staff.map(u => [u.id, u.display_name]));
  // end_date.gte는 미리 거르는 것일 뿐 — 반이동(반열림)·휴원은 종료 규약 한 곳으로 판정한다(#125).
  // 🔴 허용된 반(classMap)의 수강만 센다 — '내 담당 반'이면 다른 반 수강이 건수·재원 판정에 섞이지 않게(그래프와 집계가 같은 배열을 쓴다).
  const active = enrollments.filter(e => classMap.has(e.class_id) && studentIds.has(e.student_id) && isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: !!e.on_hold, isTransferred: !!e.is_transferred }, asOf));
  const nodes: SourceGraph["nodes"] = [], edges: SourceGraph["edges"] = [], seen = new Set<string>();
  const node = (n: SourceGraph["nodes"][number]) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
  for (const e of active) {
    const c = classMap.get(e.class_id)!;
    node({ id: `student:${e.student_id}`, type: "Student", label: e.student_id, source: "에이와 원생", href: `/students/${e.student_id}` });
    node({ id: `class:${c.id}`, type: "Class", label: c.class_name, source: "에이와 반", href: "/classes", attributes: c.subject ? { subject: c.subject } : undefined }); // 과목 = 판의 과목 묶음(kg-net-groups.ts)
    edges.push({ from: `student:${e.student_id}`, relation: "enrolled_in", to: `class:${c.id}`, basis: `enrollments:${e.id}; ${e.start_date}~${e.end_date ?? "진행"}; 기준 ${asOf}` });
  }
  for (const c of classMap.values()) {
    if (!seen.has(`class:${c.id}`) || !c.teacher_id || !staffMap.has(c.teacher_id)) continue;
    node({ id: `teacher:${c.teacher_id}`, type: "Instructor", label: staffMap.get(c.teacher_id)!, source: "에이와 직원" });
    edges.push({ from: `class:${c.id}`, relation: "currently_taught_by", to: `teacher:${c.teacher_id}`, basis: "현재 반 담당자. 과거 강사 평가에 소급 적용하지 않음" });
  }
  for (const r of work) {
    const id = `work-record:${r.id}`, author = `staff:${r.author_id}`;
    node({ id: author, type: "Staff", label: staffMap.get(r.author_id) ?? "작성 담당자", source: "로그인 계정" });
    node({ id, type: "WorkRecord", label: r.document.title, source: "에이와 직접 작성", href: `/work-records?record=${r.id}`, state: r.document.state, period: r.document.date, detail: `계획: ${r.document.plan}\n실행: ${r.document.action}\n결과: ${r.document.result}\n후속: ${r.document.next}` });
    edges.push({ from: author, relation: "authored", to: id, basis: `작성 버전 ${r.version}; 검토 요청·확인된 문서만 포함` });
  }
  // 화면에 내보내는 직원의 담당 과목 키(판의 과목 묶음 — kg-net-groups.ts). 볼 수 없는 직원은 싣지 않는다.
  const staffSubjects: Record<string, string[]> = Object.fromEntries(staffRows.filter(u => staff.some(v => v.id === u.id)).map(u => [u.id, u.subjects ?? []]));
  return { graph: { nodes, edges } as SourceGraph, staffSubjects, activeStudents: new Set(active.map(e => e.student_id)), staff, hiddenStaffNames, activeEnrollments: active.length, workRecords: work.length };
}
