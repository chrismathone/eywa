import "server-only";
import { addDays } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { foldedReason } from "@/lib/folded-read";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { getHomeroomHistoryIndex } from "@/features/classes/server/teacher-as-of-queries";
import { historyWindowStart } from "@/features/classes/teacher-as-of";
import { ontologyAttendanceAxis } from "@/features/students/ontology/attendance-axis";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, unavailableSection, type LiveContext } from "./live-context";

type RecordRow = { id: string; student_id: string; class_id: string; session_date: string; recorded_at: string; status: string; slot_start: string | null; taught_by: string | null; seat_label: string | null; recorded_via: string | null };
type ClassRow = { id: string; class_name: string; teacher_id: string | null };
type Slot = { class_id: string; day_of_week: string; start_time: string | null; teacher_id: string | null; slot_teacher_label: string | null; valid_from: string; valid_to: string | null };
const statusLabels: Record<string, string> = { present: "출석", absent: "결석", late: "지각", makeup: "보강", early_leave: "조퇴", excused: "인정 결석" };

export function readLiveAttendance(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=attendance`, from = addDays(c.today, -89);
  if (!c.attendance) return Promise.resolve(unavailableSection("attendance", "최근 90일 출결", href, "forbidden"));
  return readSection("attendance", "최근 90일 출결", href, async () => {
    const records = effectiveAttendanceRecords(await fetchAllPaged<RecordRow>((a, b) => c.db.from("attendance_records")
      .select("id, student_id, class_id, session_date, recorded_at, status, slot_start, taught_by, seat_label, recorded_via")
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId).gte("session_date", from).lte("session_date", c.today)
      .order("session_date", { ascending: false }).order("id").range(a, b)));
    const recent = records.sort((a, b) => b.session_date.localeCompare(a.session_date) || b.id.localeCompare(a.id)).slice(0, 5);
    const classIds = [...new Set(recent.map((r) => r.class_id))];
    const [classes, schedules, history] = await Promise.all([
      fetchAllPagedInChunks<ClassRow>(classIds, (ids, a, b) => c.db.from("classes").select("id, class_name, teacher_id").eq("tenant_id", c.tenant).in("id", ids).order("id").range(a, b)),
      fetchAllPagedInChunks<Slot>(classIds, (ids, a, b) => c.db.from("class_schedules").select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
        .eq("tenant_id", c.tenant).in("class_id", ids).lte("valid_from", c.today).or(`valid_to.is.null,valid_to.gte.${from}`).order("id").range(a, b)),
      getHomeroomHistoryIndex(),
    ]);
    const axes = new Map(recent.map((r) => [r.id, ontologyAttendanceAxis({ date: r.session_date, today: c.today, historyFrom: historyWindowStart(c.today),
      currentTeacher: classes.find((cl) => cl.id === r.class_id)?.teacher_id ?? null, history: foldedReason(history) ? [] : history.get(r.class_id) ?? [],
      slots: schedules.filter((s) => s.class_id === r.class_id).map((s) => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, teacherId: s.teacher_id, slotTeacherLabel: s.slot_teacher_label, validFrom: s.valid_from, validTo: s.valid_to })),
      taughtBy: r.taught_by, slotStart: r.slot_start, seatLabel: r.seat_label, recordedVia: r.recorded_via })]));
    const teacherIds = [...new Set([...axes.values()].flatMap((a) => a.teacherId ? [a.teacherId] : []))];
    const teachers = await fetchAllPagedInChunks<{ id: string; display_name: string }>(teacherIds, (ids, a, b) => c.db.from("users")
      .select("id, display_name").eq("tenant_id", c.tenant).in("id", ids).order("id").range(a, b));
    const items = recent.map((r): LiveItem => {
      const axis = axes.get(r.id)!, name = teachers.find((t) => t.id === axis.teacherId)?.display_name;
      const teacher = axis.source === "seat" ? "자리 수업" : name ? `${axis.source === "substitute" ? "기록상 귀속" : axis.source === "homeroom" ? "담임 기준" : "시간표 기준"}: ${name}` : "담당자 확인 필요";
      return { id: r.id, date: r.session_date, title: `${statusLabels[r.status] ?? "상태 확인 필요"} · ${classes.find((cl) => cl.id === r.class_id)?.class_name ?? "반 확인 필요"}`,
        detail: `${r.slot_start?.slice(0, 5) ?? "교시 기록 없음"} · ${teacher}`,
        evidence: [{ source: "attendance_records", id: r.id, studentId: c.studentId, href }] };
    });
    return { ...sectionResult("attendance", "최근 90일 출결", href, items, records.length), state: foldedReason(history) ? "partial" as const : "ready" as const,
      note: `${from}–${c.today} · 정정된 출결은 최신 기록 한 건으로 셉니다. 출결 입력자와 수업 귀속을 구분합니다.` };
  });
}
