
import { SheetText } from "@/features/teacher-view/interface-label";
import { buildAttendanceClassOptions } from "@/features/students/attendance-tab";
import {
  getStudentAttendanceFull,
  getStudentEnrollments,
} from "@/features/students/server/queries";
import { getStudentUpcomingReservations } from "@/features/attendance/server/makeup-reservation-queries";
import { RESERVED_BADGE_CLASS, RESERVED_CELL_LABEL, reservationSpanLabel } from "@/features/attendance/makeup-reservation";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { shortDate } from "@/features/onescreen/makeup-absence-link";
import { AttendanceView } from "./attendance-view";

/** 출결 탭 — 전건을 받아 클라에서 월 달력/리스트·월 네비·과목/반 필터·통계. 위에 **앞으로의 보강 예약**(0264a)을 한 줄씩. */
export async function AttendanceTab({ studentId }: { studentId: string }) {
  const today = kstToday();
  const [records, enrollments, upcoming] = await Promise.all([
    getStudentAttendanceFull(studentId),
    getStudentEnrollments(studentId),
    // fail-soft — 표가 없거나 실패하면 빈 목록(출결 탭은 종전 그대로).
    getStudentUpcomingReservations(studentId, today),
  ]);
  const classes = buildAttendanceClassOptions(enrollments, today);
  // 예약의 반 이름 — 수강 목록에 없는 반(옛 반·수강 종료 뒤 보강)일 수 있어 따로 읽는다.
  let classNameById = new Map<string, string>();
  if (upcoming.length > 0) {
    const supabase = await createClient();
    const rows = await fetchInChunks<{ id: string; class_name: string }>(
      [...new Set(upcoming.map((r) => r.classId))],
      (chunk) => supabase.from("classes").select("id, class_name").in("id", chunk),
    ).catch(() => [] as { id: string; class_name: string }[]);
    classNameById = new Map(rows.map((r) => [r.id, r.class_name]));
  }

  return (
    <>
      {upcoming.length > 0 ? (
        <section className="border-line bg-card mb-3 rounded-2xl border px-4 py-3" aria-label="앞으로의 보강 예약">
          <h3 className="text-foreground text-sm font-bold">
            {RESERVED_CELL_LABEL}
            <span className="text-text-dim num ml-1.5 font-normal">{upcoming.length}<SheetText value={"건"} /></span>
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {upcoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className={`rounded-full px-1.5 py-0.5 font-bold ${RESERVED_BADGE_CLASS}`}>
                  {reservationSpanLabel(r)}
                </span>
                <span className="text-foreground">{classNameById.get(r.classId) ?? "—"}</span>
                <span className="text-text-dim">{shortDate(r.absenceDate)} <SheetText value={"결석분"} /></span>
                {r.note ? <span className="text-text-dim break-keep">· {r.note}</span> : null}
              </li>
            ))}
          </ul>
          <p className="text-text-faint mt-1.5 text-xs break-keep">
            <SheetText value={"보강일에 출석부에서 출결을 찍으면 예약은 자동으로 이행 처리됩니다. 취소는 출석부의 예약 칸에서."} /></p>
        </section>
      ) : null}
      <AttendanceView records={records} classes={classes} />
    </>
  );
}
