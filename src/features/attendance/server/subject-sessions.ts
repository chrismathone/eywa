import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { dowsFromKeys, resolveAttendDows } from "@/features/attendance/calendar";
import { resolveTeacherRole, type SubjectSession, type TeacherRole } from "@/features/attendance/teacher-role";

const DOW_ENUM = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * 담임/부담임 정렬을 위한 재료 — 학생별·과목별 **모든 강사의 주당 수업 횟수**.
 *
 * 🔴 왜 별도 쿼리인가: 출석부 매트릭스는 **보는 강사의 반만** 싣는다. 그런데 담임 판정은
 *    *"같은 과목에서 누가 제일 많이 가르치나"*라 **남의 반까지** 알아야 답이 나온다. 내 반만 보고 판정하면
 *    전원이 담임이 되어 정렬이 무의미해진다.
 * ⚠️ 담임·부담임 정렬을 고른 순간에만 부른다 — 평소 출석부에 쿼리 3개를 얹지 않는다(반응속도 1순위).
 * ⚠️ 여기서 세는 건 **주당 수업 횟수**(등원요일 수)다. 분리등원(enrollments.attendance_days)이 있으면
 *    실제 오는 요일만 센다 — 반 요일 전체로 세면 주1회 오는 학생이 주3회로 잡혀 담임이 뒤바뀐다.
 */
export async function getSubjectSessionsByStudent(
  studentIds: string[],
  today: string,
): Promise<Map<string, Map<string, SubjectSession[]>>> {
  const out = new Map<string, Map<string, SubjectSession[]>>();
  if (studentIds.length === 0) return out;
  const supabase = await createClient();

  // 1) 진행 중 수강 — .in()은 청크로(414 방지 #53) + 청크 **안에서도** 페이지네이션(1000행 절단 방지 #54).
  // ⚠️ 학생 1명이 여러 반을 듣기 때문에 100명 청크가 1000행을 넘을 수 있다. 잘리면 그 학생의 수업이
  //    통째로 빠져 담임 판정이 뒤집힌다 → `fetchInChunks`(청크 내 페이징 없음)를 쓰면 안 되는 자리.
  const enrollments = await fetchAllPagedInChunks<{
    student_id: string;
    class_id: string;
    attendance_days: string[] | null;
  }>(studentIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id, attendance_days, id")
      .is("end_date", null)
      .in("student_id", chunk)
      .order("id", { ascending: true }) // OFFSET 페이지가 흔들리지 않게 unique tie-break(헬퍼 규약)
      .range(from, to),
  );
  if (enrollments.length === 0) return out;

  const classIds = [...new Set(enrollments.map((e) => e.class_id))];

  // 2) 반 메타(과목·담당) + 3) 그날 살아있는 수업요일 — 서로 독립이라 병렬(B4).
  const [classes, schedules] = await Promise.all([
    fetchInChunks<{ id: string; subject: string | null; teacher_id: string | null }>(classIds, (chunk) =>
      supabase.from("classes").select("id, subject, teacher_id").in("id", chunk),
    ),
    // ⚠️ `class_schedules`는 운영 이력을 함께 담는다(#88) — 만료된 행까지 세면 끝난 교시가 주당 횟수에
    //    더해져 담임이 뒤바뀐다. 오늘 유효한 행만.
    // ⚠️ 반 하나가 교시를 여러 개 갖는다(영어는 10교시) → 청크가 1000행을 넘을 수 있어 페이징 필수(#54).
    fetchAllPagedInChunks<{ class_id: string; day_of_week: string }>(classIds, (chunk, from, to) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, id")
        .in("class_id", chunk)
        .lte("valid_from", today)
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const classMeta = new Map(classes.map((c) => [c.id, c]));
  const classDows = new Map<string, number[]>();
  for (const s of schedules) {
    const d = DOW_ENUM.indexOf(s.day_of_week as (typeof DOW_ENUM)[number]);
    if (d < 0) continue;
    const cur = classDows.get(s.class_id) ?? [];
    if (!cur.includes(d)) cur.push(d);
    classDows.set(s.class_id, cur);
  }

  for (const e of enrollments) {
    const meta = classMeta.get(e.class_id);
    if (!meta?.subject) continue; // 과목을 모르면 "같은 과목 안에서" 견줄 수 없다 — 지어내지 않고 건너뛴다.
    const dows = resolveAttendDows(e.attendance_days, classDows.get(e.class_id) ?? []);
    // 요일이 하나도 없으면(스케줄 미등록) 0회가 아니라 **1회**로 본다 — 0으로 두면 그 반이 판정에서
    // 통째로 사라져, 스케줄만 안 넣은 반의 담당이 부담임으로 밀린다.
    const sessionsPerWeek = dows.length > 0 ? dows.length : dowsFromKeys(e.attendance_days).length || 1;
    const bySubject = out.get(e.student_id) ?? new Map<string, SubjectSession[]>();
    const list = bySubject.get(meta.subject) ?? [];
    list.push({ teacherId: meta.teacher_id, sessionsPerWeek });
    bySubject.set(meta.subject, list);
    out.set(e.student_id, bySubject);
  }
  return out;
}

/** 조회 결과 → (학생, 과목)에 대한 이 강사의 역할. 자료가 없으면 null(모른다고 담임을 지어내지 않는다). */
export function roleFor(
  sessions: Map<string, Map<string, SubjectSession[]>>,
  studentId: string,
  subject: string | null,
  teacherId: string | null,
): TeacherRole {
  if (!subject || !teacherId) return null;
  const list = sessions.get(studentId)?.get(subject);
  return list ? resolveTeacherRole(list, teacherId) : null;
}
