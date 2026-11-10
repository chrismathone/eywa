import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
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
type ClassRow = { id: string; class_name: string; teacher_id: string | null };
type WorkRow = { id: string; author_id: string; version: number; updated_at: string; document: { title: string; date: string; state: string; plan: string; action: string; result: string; next: string } };

export async function loadCoreGraph(tenant: string, asOf: string, studentIds: Set<string>, includeWork: boolean) {
  const db = createAdminClient();
  const [enrollments, classes, staff, work] = await Promise.all([
    fetchAllPaged<EnrollmentRow>((a, b) => db.from("enrollments").select("id,student_id,class_id,start_date,end_date,on_hold,is_transferred").eq("tenant_id", tenant).lte("start_date", asOf).or(`end_date.is.null,end_date.gte.${asOf}`).order("id").range(a, b)),
    fetchAllPaged<ClassRow>((a, b) => db.from("classes").select("id,class_name,teacher_id").eq("tenant_id", tenant).order("id").range(a, b)),
    fetchAllPaged<Staff>((a, b) => db.from("users").select("id,display_name").eq("tenant_id", tenant).eq("status", "active").in("system_role", STAFF_ROLES).order("id").range(a, b)),
    // 남의 업무 문서 본문은 업무 작성센터 검토함을 읽을 수 있을 때만 싣는다(그 화면과 같은 문 — #77).
    !includeWork ? Promise.resolve<WorkRow[]>([]) : fetchAllPaged<WorkRow>((a, b) => db.from("academy_work_records").select("id,author_id,version,updated_at,document").eq("tenant_id", tenant).in("document->>state", ["submitted", "reviewed"]).lte("document->>date", asOf).order("id").range(a, b)),
  ]);
  // end_date.gte는 미리 거르는 것일 뿐 — 반이동(반열림)·휴원은 종료 규약 한 곳으로 판정한다(#125).
  const active = enrollments.filter(e => studentIds.has(e.student_id) && isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: !!e.on_hold, isTransferred: !!e.is_transferred }, asOf));
  const classMap = new Map(classes.map(c => [c.id, c])), staffMap = new Map(staff.map(u => [u.id, u.display_name]));
  const nodes: SourceGraph["nodes"] = [], edges: SourceGraph["edges"] = [], seen = new Set<string>();
  const node = (n: SourceGraph["nodes"][number]) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
  for (const e of active) {
    const c = classMap.get(e.class_id);
    if (!c) continue;
    node({ id: `student:${e.student_id}`, type: "Student", label: e.student_id, source: "에이와 원생", href: `/students/${e.student_id}` });
    node({ id: `class:${c.id}`, type: "Class", label: c.class_name, source: "에이와 반", href: "/classes" });
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
  return { graph: { nodes, edges } as SourceGraph, activeStudents: new Set(active.map(e => e.student_id)), staff, activeEnrollments: active.length, workRecords: work.length };
}
