import "server-only";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { enrollmentLastDate, isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { getActiveDelegationsForClasses } from "@/features/classes/server/delegation";
import { activeOn, sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { describeTeacherAssignments, type LiveRelation } from "@/features/students/ontology/live-relations";
import { readSection, type LiveContext } from "./live-context";

type ClassRow = { id: string; class_name: string; subject: string; teacher_id: string | null; is_makeup_pool: boolean; closed_at: string | null };
type Enrollment = { id: string; class_id: string; start_date: string; end_date: string | null; is_transferred: boolean; on_hold: boolean };
type Slot = { id: string; class_id: string; teacher_id: string | null; valid_from: string | null; valid_to: string | null };

export function readLiveEnrollments(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=classes`;
  return readSection("classes", "현재 수강·담당자", href, async () => {
    const enrolled = await fetchAllPaged<Enrollment>((a, b) => c.db.from("enrollments")
      .select("id, class_id, start_date, end_date, is_transferred, on_hold").eq("tenant_id", c.tenant).eq("student_id", c.studentId)
      .lte("start_date", c.today).or(`end_date.is.null,end_date.gte.${c.today}`).order("id").range(a, b));
    const current = enrolled.filter((e) => isEnrollmentOnRosterOn({ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred }, c.today));
    const ids = [...new Set(current.map((e) => e.class_id))];
    const [classes, schedules, delegated] = await Promise.all([
      fetchAllPagedInChunks<ClassRow>(ids, (chunk, a, b) => c.db.from("classes").select("id, class_name, subject, teacher_id, is_makeup_pool, closed_at")
        .eq("tenant_id", c.tenant).in("id", chunk).order("id").range(a, b)),
      fetchAllPagedInChunks<Slot>(ids, (chunk, a, b) => c.db.from("class_schedules").select("id, class_id, teacher_id, valid_from, valid_to")
        .eq("tenant_id", c.tenant).in("class_id", chunk).or(`valid_to.is.null,valid_to.gte.${c.today}`).order("id").range(a, b)),
      getActiveDelegationsForClasses(c.db, c.tenant, ids, c.today),
    ]);
    const teacherIds = [...new Set([...classes.map((r) => r.teacher_id), ...schedules.map((r) => r.teacher_id), ...delegated.map((r) => r.delegateUserId)].filter((id): id is string => !!id))];
    const people = await fetchAllPagedInChunks<{ id: string; display_name: string }>(teacherIds, (chunk, a, b) => c.db.from("users")
      .select("id, display_name").eq("tenant_id", c.tenant).in("id", chunk).order("id").range(a, b));
    const names = new Map(people.map((p) => [p.id, p.display_name]));
    const visible = classes.filter((r) => !r.is_makeup_pool && (!r.closed_at || r.closed_at >= c.today));
    const items = visible.map((r): LiveItem => {
      const enrollments = current.filter((e) => e.class_id === r.id);
      const slots = schedules.filter((s) => s.class_id === r.id && activeOn(c.today, s.valid_from, s.valid_to));
      const delegation = delegated.filter((d) => d.classId === r.id);
      const evidence = (source: string, id: string) => [{ source, id, studentId: c.studentId, href }];
      const base = { tenantId: c.tenant, asOf: c.today, version: "student-live-v1" as const };
      const relations: LiveRelation[] = enrollments.map((e) => ({ ...base, kind: "enrolledIn", from: { kind: "student", id: c.studentId }, to: { kind: "class", id: r.id },
        period: { from: e.start_date, through: enrollmentLastDate(e.end_date, e.is_transferred) }, evidence: evidence("enrollments", e.id) }));
      const from = { kind: "class" as const, id: r.id };
      if (r.teacher_id) relations.push({ ...base, kind: "homeroom", from, to: { kind: "teacher", id: r.teacher_id }, period: null, evidence: evidence("classes", r.id) });
      for (const slot of slots) if (slot.teacher_id) relations.push({ ...base, kind: "scheduledTeacher", from, to: { kind: "teacher", id: slot.teacher_id },
        period: slot.valid_from ? { from: slot.valid_from, through: slot.valid_to } : null, evidence: evidence("class_schedules", slot.id) });
      for (const d of delegation) relations.push({ ...base, kind: "delegatedTeacher", from, to: { kind: "teacher", id: d.delegateUserId },
        period: { from: d.fromDate, through: d.toDate }, evidence: evidence("class_delegations", d.id ?? "") });
      return { id: r.id, title: `${r.class_name}${enrollments.every((e) => e.on_hold) ? " · 휴원" : ""}`, detail: describeTeacherAssignments(relations, names), relations, subject: r.subject,
        evidence: enrollments.map((e) => ({ source: "enrollments", id: e.id, studentId: c.studentId, href })) };
    });
    const result = sectionResult("classes", "현재 수강·담당자", href, items, items.length);
    return classes.length < ids.length || classes.some((r) => !r.is_makeup_pool && r.closed_at && r.closed_at < c.today)
      ? { ...result, state: "partial" as const, note: "일부 반 정보나 종강한 반의 수강 종료 기록을 확인해야 합니다." } : result;
  });
}
