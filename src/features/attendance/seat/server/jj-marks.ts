import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { hhmm } from "../seat";
import type { SeatClassRoster } from "./queries";

export type SeatJjMark = {
  attitude: string | null;
  listeningLevel: string | null;
  memorizedWords: string | null;
  progressNote: string | null;
};

function markKey(classId: string, studentId: string, slot: string): string {
  return `${classId}|${studentId}|${hhmm(slot)}`;
}

/**
 * 그 날·그 교시 JJ 칸(듣기·단어). deny-RLS라 **admin + tenantId**(#104).
 *
 * 공개 PIN(`/seat/jj`) 화면도 부른다(2026-08-19) — 그 화면이 칸을 그리는데 저장값을 안 보여주면
 * 담당자가 이미 적힌 값을 빈 칸으로 보고 다시 적는다. 범위는 **호출부가 넘긴 그 교시 명단**뿐이라
 * 화이트리스트 밖으로 넓어지지 않는다(학생 이름·칸 값 외에 직원 신상은 여기서 안 읽는다).
 */
export async function attachJjMarks(
  rosters: SeatClassRoster[],
  tenantId: string,
  date: string,
  slotStart: string,
): Promise<SeatClassRoster[]> {
  const classIds = [...new Set(rosters.map((r) => r.classId))];
  if (classIds.length === 0) return rosters;
  const slot = hhmm(slotStart);
  const admin = createAdminClient();
  let rows: {
    class_id: string;
    student_id: string;
    slot_start: string;
    status?: string | null;
    progress_note?: string | null;
    listening_level?: string | null;
    memorized_words?: string | null;
  }[];
  try {
    rows = await fetchInChunks(classIds, (chunk) =>
      admin
        .from("class_sheet_student_marks")
        // ⚠️ `status`는 **태도**다(출결이 아니다 — 출결은 attendance_records).
        .select("class_id, student_id, slot_start, status, progress_note, listening_level, memorized_words")
        .eq("tenant_id", tenantId)
        .eq("mark_date", date)
        .in("class_id", chunk),
    );
  } catch (e) {
    // #95 — 칸 컬럼이 아직 없어도 출결 화면은 살아야 한다.
    reportError(e, { scope: "attendance.seat.jj-marks", tenantId, date, slot });
    return rosters;
  }
  const byKey = new Map<string, SeatJjMark>();
  for (const r of rows) {
    if (hhmm(r.slot_start) !== slot) continue;
    byKey.set(markKey(r.class_id, r.student_id, slot), {
      attitude: r.status ?? null,
      listeningLevel: r.listening_level ?? null,
      memorizedWords: r.memorized_words ?? null,
      progressNote: r.progress_note ?? null,
    });
  }
  return rosters.map((roster) => ({
    ...roster,
    students: roster.students.map((s) => {
      const mark = byKey.get(markKey(roster.classId, s.id, slot));
      return {
        ...s,
        attitude: mark?.attitude ?? null,
        listeningLevel: mark?.listeningLevel ?? null,
        memorizedWords: mark?.memorizedWords ?? null,
        progressNote: mark?.progressNote ?? null,
      };
    }),
  }));
}
