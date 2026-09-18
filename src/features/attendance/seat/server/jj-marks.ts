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
 * 그 날 JJ 칸 전부를 `반|학생|교시` 키로 — **교시는 가리지 않는다**(하루 한 번 읽고 교시별로 나누는 재료).
 * ⚠️ 실패는 **null**(예외 아님) — #95: 칸 컬럼이 아직 없어도 출결 화면은 살아야 한다.
 */
async function fetchJjMarksOfDay(
  classIds: readonly string[],
  tenantId: string,
  date: string,
  scopeSlot: string,
): Promise<Map<string, SeatJjMark> | null> {
  const unique = [...new Set(classIds)];
  if (unique.length === 0) return new Map();
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
    rows = await fetchInChunks(unique, (chunk) =>
      admin
        .from("class_sheet_student_marks")
        // ⚠️ `status`는 **태도**다(출결이 아니다 — 출결은 attendance_records).
        .select("class_id, student_id, slot_start, status, progress_note, listening_level, memorized_words")
        .eq("tenant_id", tenantId)
        .eq("mark_date", date)
        .in("class_id", chunk),
    );
  } catch (e) {
    reportError(e, { scope: "attendance.seat.jj-marks", tenantId, date, slot: scopeSlot });
    return null;
  }
  const byKey = new Map<string, SeatJjMark>();
  for (const r of rows) {
    byKey.set(markKey(r.class_id, r.student_id, r.slot_start), {
      attitude: r.status ?? null,
      listeningLevel: r.listening_level ?? null,
      memorizedWords: r.memorized_words ?? null,
      progressNote: r.progress_note ?? null,
    });
  }
  return byKey;
}

/** 한 교시 명단에 그 교시 칸을 얹는다 — 칸이 없으면 네 값 모두 null(빈 칸으로 그린다). */
function withMarks(
  rosters: SeatClassRoster[],
  byKey: ReadonlyMap<string, SeatJjMark>,
  slot: string,
): SeatClassRoster[] {
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
  const byKey = await fetchJjMarksOfDay(
    rosters.map((r) => r.classId),
    tenantId,
    date,
    hhmm(slotStart),
  );
  // 실패면 명단 그대로(칸 없이) — 종전과 같은 폴백.
  return byKey ? withMarks(rosters, byKey, slotStart) : rosters;
}

/**
 * **'전체' 보기**(JJ실, 원장 2026-09-18 *"펼치기"*) — 그날 모든 교시 명단에 JJ 칸을 얹는다.
 *
 * 🔑 **조회는 하루 한 번**이다(B6) — 교시마다 `attachJjMarks`를 부르면 교시 수만큼 왕복이 는다. 원래도
 *    `mark_date`로 하루치를 읽고 교시는 JS에서 걸렀으니, 한 번 읽어 교시별로 나누기만 한다.
 * 🔴 교시 키는 **호출부의 교시 시작시각 그대로**다 — 명단 키(`rosterByPeriod`)와 같은 값이어야 화면이 짝을 찾는다.
 */
export async function attachJjMarksForPeriods(
  rostersByStart: Readonly<Record<string, SeatClassRoster[]>>,
  tenantId: string,
  date: string,
): Promise<Record<string, SeatClassRoster[]>> {
  const starts = Object.keys(rostersByStart);
  const byKey = await fetchJjMarksOfDay(
    starts.flatMap((start) => (rostersByStart[start] ?? []).map((r) => r.classId)),
    tenantId,
    date,
    "all",
  );
  const out: Record<string, SeatClassRoster[]> = {};
  for (const start of starts) {
    const rosters = rostersByStart[start] ?? [];
    out[start] = byKey ? withMarks(rosters, byKey, start) : rosters;
  }
  return out;
}
