import "server-only";
import { effectiveAbsences, type AbsenceSubjectRow } from "@/features/dashboard/absence-subjects";
import { isPreNotified, summarizeAbsenceReasons, unexplainedAbsences } from "@/features/dashboard/absence-reasons";
import { getAbsenceRiskAnchor, getAbsenceRiskStudents } from "@/features/dashboard/server/queries";
import { getStaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { countOpenTasks } from "@/features/staff-tasks/server/queries";
import type { AbsenceLine, LateTask, TaskBoard } from "./extras-types";

const PERSON_TASKS = 60;
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * 반복 결석 학생의 결석을 반마다 나눈다. 학생을 고르는 판정은 운영실 카드와 같다 — 같은 RPC · 같은 14일 창 ·
 * 같은 세는 단위(`effectiveAbsences`) · 같은 사전 통보 판정. 그래서 학생별 합이 카드 숫자와 같다.
 */
export async function loadAbsenceLines(tenantId: string): Promise<AbsenceLine[]> {
  const supabase = await createClient();
  const [risk, anchor] = await Promise.all([getAbsenceRiskStudents(), getAbsenceRiskAnchor({ supabase, tenantId })]);
  if (!anchor || !risk.length) return [];
  // 과목은 세는 규칙과 상관없어 비워 둔다(반에서 따로 읽는다).
  const rows: AbsenceSubjectRow[] = (await fetchAllPagedInChunks<Omit<AbsenceSubjectRow, "subject">>(risk.map((r) => r.studentId), (chunk, from, to) =>
    supabase.from("attendance_records").select("id, student_id, class_id, session_date, slot_start, status, recorded_at, note").eq("tenant_id", tenantId).in("student_id", chunk)
      .gte("session_date", shift(anchor, -13)).lte("session_date", anchor).order("id", { ascending: true }).range(from, to))).map((row) => ({ ...row, subject: null }));
  const reasons = summarizeAbsenceReasons(rows);
  const flagged = new Map(risk.filter((r) => unexplainedAbsences(r.absences, reasons.get(r.studentId)) >= 3).map((r) => [r.studentId, r]));
  const cells = effectiveAbsences(rows).filter((c) => flagged.has(c.student_id));
  const [classes, students] = await Promise.all([
    fetchInChunks<{ id: string; class_name: string; subject: string | null; teacher_id: string | null }>([...new Set(cells.map((c) => c.class_id))], (chunk) =>
      supabase.from("classes").select("id, class_name, subject, teacher_id").in("id", chunk)),
    fetchInChunks<{ id: string; school: string | null; grade: string | null }>([...flagged.keys()], (chunk) =>
      supabase.from("students").select("id, school, grade").in("id", chunk)),
  ]);
  const teachers = await fetchInChunks<{ id: string; display_name: string | null }>([...new Set(classes.flatMap((c) => (c.teacher_id ? [c.teacher_id] : [])))], (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk));
  const classOf = new Map(classes.map((c) => [c.id, c]));
  const teacherOf = new Map(teachers.map((t) => [t.id, t.display_name?.trim() || "이름 없는 직원"]));
  const gradeOf = new Map(students.map((s) => [s.id, schoolGradeLabel(s.school, s.grade) || null]));
  const lines = new Map<string, AbsenceLine>();
  for (const cell of cells) {
    const key = `${cell.student_id}|${cell.class_id}`;
    const cls = classOf.get(cell.class_id);
    const line = lines.get(key) ?? {
      studentId: cell.student_id, name: flagged.get(cell.student_id)!.studentName, schoolGrade: gradeOf.get(cell.student_id) ?? null,
      classId: cell.class_id, className: cls?.class_name ?? "반 정보 없음", subject: cls?.subject ?? null,
      teacherId: cls?.teacher_id ?? null, teacher: cls?.teacher_id ? teacherOf.get(cls.teacher_id) ?? null : null, dates: [], notified: 0,
    };
    if (isPreNotified(cell)) line.notified += 1;
    else line.dates.push(cell.session_date);
    lines.set(key, line);
  }
  return [...lines.values()];
}

/**
 * 열린 할 일 현황 — 종류별(열린 할 일 행을 받아 센다 · 수백 건) · 담당자별(DB 집계 `staff_task_counts`). 업무 처리 현황을 볼 수 있는
 * 사람에게만 · 지점 보기 중에는 없다(`getStaffTaskViewer`). 목록·상세는 2.0 할 일 라우트를 그대로 읽는다(새로 판정하지 않는다).
 */
export async function loadTaskBoard(): Promise<TaskBoard | null> {
  const viewer = await getStaffTaskViewer();
  if (!viewer?.canMonitor) return null;
  const admin = createAdminClient();
  const tenantId = viewer.user.tenantId;
  const now = Date.now();
  const [rows, byUser] = await Promise.all([
    fetchAllPaged<{ id: string; kind: string; due_at: string | null; title: string; link: string | null }>((from, to) =>
      admin.from("staff_tasks").select("id, kind, due_at, title, link").eq("tenant_id", tenantId).eq("status", "open").order("id").range(from, to)),
    countOpenTasks(tenantId),
  ]);
  const kinds = new Map<string, { kind: string; open: number; late: number }>();
  for (const row of rows) {
    const k = kinds.get(row.kind) ?? { kind: row.kind, open: 0, late: 0 };
    k.open += 1;
    if (row.due_at && Date.parse(row.due_at) < now) k.late += 1;
    kinds.set(row.kind, k);
  }
  // 사람마다 기한 지난 할 일의 종류 — 늦은 할 일의 담당 연결만 읽는다(사람 수는 위 집계 함수가 진실 · 종류는 그 안의 내역).
  const lateRows = rows.filter((r) => r.due_at && Date.parse(r.due_at) < now);
  const lateKind = new Map(lateRows.map((r) => [r.id, r.kind]));
  const lateById = new Map(lateRows.map((r): [string, LateTask] => [r.id, { id: r.id, kind: r.kind, title: r.title, link: r.link, dueAt: r.due_at! }]));
  const [names, links] = await Promise.all([
    fetchInChunks<{ id: string; display_name: string | null }>([...byUser.keys()], (chunk) => admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk)),
    fetchAllPagedInChunks<{ task_id: string; user_id: string }>([...lateKind.keys()], (chunk, from, to) =>
      admin.from("staff_task_assignees").select("task_id, user_id").eq("tenant_id", tenantId).in("task_id", chunk).order("task_id").order("user_id").range(from, to)),
  ]);
  const nameOf = new Map(names.map((u) => [u.id, u.display_name?.trim() || "이름 없는 직원"]));
  const kindsOf = new Map<string, Map<string, number>>();
  const itemsOf = new Map<string, LateTask[]>();
  for (const l of links) {
    const kind = lateKind.get(l.task_id);
    if (!kind) continue;
    const mine = kindsOf.get(l.user_id) ?? new Map<string, number>();
    mine.set(kind, (mine.get(kind) ?? 0) + 1);
    kindsOf.set(l.user_id, mine);
    itemsOf.set(l.user_id, [...(itemsOf.get(l.user_id) ?? []), lateById.get(l.task_id)!]);
  }
  // 사람 상세의 할 일 목록 — 오래 늦은 순으로 사람마다 60건까지(나머지는 할 일 창에서).
  const itemsFor = (id: string) => (itemsOf.get(id) ?? []).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, PERSON_TASKS);
  return {
    kinds: [...kinds.values()].sort((a, b) => b.late - a.late || b.open - a.open),
    people: [...byUser].map(([id, c]) => ({
      id, name: nameOf.get(id) ?? "퇴사한 직원", open: c.open, late: c.late,
      kinds: [...(kindsOf.get(id) ?? new Map<string, number>())].map(([kind, late]) => ({ kind, late })).sort((a, b) => b.late - a.late),
      items: itemsFor(id),
    })).filter((p) => p.open > 0).sort((a, b) => b.late - a.late || b.open - a.open || a.name.localeCompare(b.name, "ko")),
  };
}
