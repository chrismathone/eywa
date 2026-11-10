import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import type { TenantSettings } from "@/features/owner/settings-types";
import { counselByClassTeacher } from "@/features/owner/subjects";
import { buildCounselDuty } from "@/features/consultations/homeroom-duty";
import { isHomeroomConsultClass } from "@/features/consultations/homeroom-model";
import { CLASS_COLUMNS, ENROLLMENT_COLUMNS, SCHEDULE_COLUMNS } from "@/features/teacher-portfolio/server/churn-source";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "@/features/teacher-portfolio/model/types";
import { loadCheckRows, loadEnrollmentSubjects } from "@/features/newcomers/server/cohort";
import { buildSubjectAnchors, indexChecks } from "@/features/newcomers/subject-rows";
import { newcomerWindowStart } from "@/features/newcomers/onboarding-items";
import { gradeKind } from "@/features/grades/unified/server/normalize";
import { buildCounselDuties, buildExamDuties, buildNewcomerDuties, type CounselPair } from "../model/monthly";
import { writeDrafts } from "./sync";

type ClassRow = SnapshotClass & { math_learning_track: string | null };
type EnrollRow = Omit<SnapshotEnrollment, "start_date" | "on_hold" | "is_transferred" | "is_transferred_in"> & { start_date: string | null; on_hold: boolean | null; is_transferred: boolean | null; is_transferred_in: boolean | null };

/**
 * 월간·건별 의무 맞춤(지점 × 오늘) — 월 학부모 상담(이번 달) · 신규생 정착 콜. 상담 의무 판정은 원생상담 통계·강사평가와 **같은 함수**(`buildCounselDuty`).
 * 오늘 기준 의무 쌍(지금 담임)으로 이번 달 분모를 만든다 — 달 중에 담임이 바뀌면 열쇠가 바뀌고 옛 열쇠는 rekey 정리된다(일간과 같은 규칙).
 * 🔴 관리 키라 모든 조회에 tenant_id(#104). 체크 표를 못 읽으면(미적용·실패) 신규생 몫만 건너뛰고 상담은 맞춘다.
 */
export async function syncMonthlyDuties(tenantId: string, today: string, settings: TenantSettings): Promise<{ counsel: number; exam: number; newcomer: number; skipped?: string }> {
  const admin = createAdminClient();
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const classes = await fetchAllPaged<ClassRow>((from, to) =>
    admin.from("classes").select(`${CLASS_COLUMNS}, math_learning_track`).eq("tenant_id", tenantId).eq("is_active", true)
      .or(`closed_at.is.null,closed_at.gte.${today}`).order("id").range(from, to));
  const eligible = classes.filter((c) => isHomeroomConsultClass({ isSpecial: c.is_special ?? null, className: c.class_name, learningTrack: c.math_learning_track }));
  const ids = eligible.map((c) => c.id);
  if (!ids.length) return { counsel: 0, exam: 0, newcomer: 0 };
  const [enrollRows, schedules, teachers] = await Promise.all([
    fetchAllPagedInChunks<EnrollRow>(ids, (chunk, from, to) =>
      admin.from("enrollments").select(ENROLLMENT_COLUMNS).eq("tenant_id", tenantId).in("class_id", chunk).or(`end_date.is.null,end_date.gte.${monthStart}`).order("id").range(from, to)),
    fetchAllPagedInChunks<SnapshotSchedule>(ids, (chunk, from, to) =>
      admin.from("class_schedules").select(SCHEDULE_COLUMNS).eq("tenant_id", tenantId).in("class_id", chunk).lte("valid_from", today).or(`valid_to.is.null,valid_to.gte.${monthStart}`).order("id").range(from, to)),
    fetchInChunks<{ id: string; status: string | null }>([...new Set(eligible.flatMap((c) => c.teacher_id ? [c.teacher_id] : []))], (chunk) =>
      admin.from("users").select("id,status").eq("tenant_id", tenantId).in("id", chunk)),
  ]);
  const allHomerooms = new Set(settings.operations.subjects.filter(counselByClassTeacher).map((s) => s.key));
  const isDuty = buildCounselDuty({
    classes: eligible, schedules,
    enrollments: enrollRows.map((e) => ({ ...e, start_date: e.start_date ?? "0000-01-01", on_hold: !!e.on_hold, is_transferred: !!e.is_transferred, is_transferred_in: !!e.is_transferred_in })),
    owner: (c) => c.teacher_id, allHomerooms: (s) => allHomerooms.has(s),
    teacherIds: eligible.flatMap((c) => (c.teacher_id ? [c.teacher_id] : [])), from: monthStart, end: today,
  });
  const isLive = (e: EnrollRow) => !e.on_hold && (!e.start_date || e.start_date <= today) && (!e.end_date || e.end_date > today || (e.end_date === today && !e.is_transferred));
  const classOf = new Map(eligible.map((c) => [c.id, c]));
  const pairs: CounselPair[] = [];
  for (const e of enrollRows) {
    const c = classOf.get(e.class_id);
    if (!c?.teacher_id || !isLive(e) || !isDuty(c.teacher_id, e.student_id, e.class_id, today)) continue;
    pairs.push({ teacherId: c.teacher_id, studentId: e.student_id, classId: c.id, subject: c.subject });
  }
  // 월말평가 명단 = 담임 반 명단(상담 의무 판정과 무관 — 포트폴리오 `rosterOf`와 같은 결).
  const rosterPairs: CounselPair[] = [];
  for (const e of enrollRows) {
    const c = classOf.get(e.class_id);
    if (c?.teacher_id && isLive(e)) rosterPairs.push({ teacherId: c.teacher_id, studentId: e.student_id, classId: c.id, subject: c.subject });
  }
  const prevMonthStart = (() => { const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)); return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`; })();
  const studentIds = [...new Set([...pairs, ...rosterPairs].map((p) => p.studentId))];
  const [students, consults, grades] = await Promise.all([
    fetchInChunks<{ id: string; is_test: boolean | null; status: string | null }>(studentIds, (chunk) => admin.from("students").select("id,is_test,status").eq("tenant_id", tenantId).in("id", chunk)),
    fetchAllPagedInChunks<{ student_id: string; counselor_id: string | null; consulted_at: string }>(studentIds, (chunk, from, to) =>
      admin.from("student_consultations").select("student_id,counselor_id,consulted_at").eq("tenant_id", tenantId).in("student_id", chunk)
        .gte("consulted_at", `${monthStart}T00:00:00+09:00`).order("id").range(from, to)),
    fetchAllPaged<{ student_id: string; subject: string; exam_slot: string | null; exam_name: string; taken_on: string; no_exam: boolean | null; created_at: string | null }>((from, to) =>
      admin.from("student_grades").select("student_id,subject,exam_slot,exam_name,taken_on,no_exam,created_at").eq("tenant_id", tenantId).gte("taken_on", prevMonthStart).order("id").range(from, to)),
  ]);
  const counted = new Set(students.filter((s) => !s.is_test && s.status === "enrolled").map((s) => s.id));
  const inactive = new Set(teachers.filter((t) => t.status === "inactive").map((t) => t.id));
  const counselDrafts = buildCounselDuties({ month, pairs: pairs.filter((p) => counted.has(p.studentId)),
    consults: consults.map((c) => ({ studentId: c.student_id, counselorId: c.counselor_id, consultedAt: c.consulted_at })), inactiveTeacherIds: inactive });
  await writeDrafts(tenantId, counselDrafts, { rekey: true });
  const examDrafts = buildExamDuties({ month, pairs: rosterPairs.filter((p) => counted.has(p.studentId)), inactiveTeacherIds: inactive,
    records: grades.filter((g) => !g.no_exam && gradeKind(g.exam_slot, g.exam_name) === "monthly").map((g) => ({ studentId: g.student_id, subject: g.subject, takenOn: g.taken_on, createdAt: g.created_at })) });
  await writeDrafts(tenantId, examDrafts, { rekey: true, cyclesOf: { exam_monthly: [month] } });

  // ── 신규생 정착 콜 — 신규생 탭·운영실 신호와 같은 재료(cohort.ts).
  const scope = <T,>(q: T): T => (q as unknown as { eq(c: string, v: string): T }).eq("tenant_id", tenantId);
  const newcomers = await fetchAllPaged<{ id: string; enrolled_at: string | null; is_test: boolean | null }>((from, to) =>
    admin.from("students").select("id,enrolled_at,is_test").eq("tenant_id", tenantId).in("status", ["enrolled", "on_hold"]).gte("enrolled_at", newcomerWindowStart(today)).order("id").range(from, to));
  const nIds = newcomers.filter((s) => !s.is_test && s.enrolled_at).map((s) => s.id);
  if (!nIds.length) { await writeDrafts(tenantId, [], { rekey: false, cyclesOf: { newcomer_call: [] } }); return { counsel: counselDrafts.length, exam: examDrafts.length, newcomer: 0 }; }
  const [subjectsOf, checksResult] = await Promise.all([loadEnrollmentSubjects(admin, nIds, scope), loadCheckRows(admin, nIds, scope)]);
  if (!checksResult.ok) return { counsel: counselDrafts.length, exam: examDrafts.length, newcomer: 0, skipped: "checks_unavailable" };
  const { bySubject, earliest } = buildSubjectAnchors(subjectsOf, today);
  const ownerOf = (studentId: string, subject: string | null) =>
    pairs.find((p) => p.studentId === studentId && (!subject || p.subject === subject) && !inactive.has(p.teacherId))?.teacherId ?? null;
  const newcomerDrafts = buildNewcomerDuties({ today, checks: indexChecks(checksResult.rows), ownerOf,
    students: newcomers.filter((s) => nIds.includes(s.id)).map((s) => ({ id: s.id, enrolledOn: String(s.enrolled_at).slice(0, 10), subjects: bySubject.get(s.id) ?? new Map(), earliest: earliest.get(s.id) ?? null })) });
  await writeDrafts(tenantId, newcomerDrafts, { rekey: false, cyclesOf: { newcomer_call: [] } });
  return { counsel: counselDrafts.length, exam: examDrafts.length, newcomer: newcomerDrafts.length };
}
