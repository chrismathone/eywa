import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { hhmm } from "../seat";
import type { SeatClassRoster } from "./queries";

export type SeatJjMark = {
  listeningLevel: string | null;
  memorizedWords: string | null;
};

function markKey(classId: string, studentId: string, slot: string): string {
  return `${classId}|${studentId}|${hhmm(slot)}`;
}

/**
 * 그 날·그 교시 JJ 칸(듣기·단어). deny-RLS라 **admin + tenantId**(#104).
 * 공개 PIN 경로에서는 부르지 말 것 — 로그인 JJ실 출석부 전용.
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
    listening_level?: string | null;
    memorized_words?: string | null;
  }[];
  try {
    rows = await fetchInChunks(classIds, (chunk) =>
      admin
        .from("class_sheet_student_marks")
        .select("class_id, student_id, slot_start, listening_level, memorized_words")
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
      listeningLevel: r.listening_level ?? null,
      memorizedWords: r.memorized_words ?? null,
    });
  }
  return rosters.map((roster) => ({
    ...roster,
    students: roster.students.map((s) => {
      const mark = byKey.get(markKey(roster.classId, s.id, slot));
      return {
        ...s,
        listeningLevel: mark?.listeningLevel ?? null,
        memorizedWords: mark?.memorizedWords ?? null,
      };
    }),
  }));
}
