import "server-only";

/**
 * 보강이 메울 **결석 칸 찾기** — 메모를 붙이는 두 경로(`noteMakeupAgainstAbsence`,
 * `linkMakeupToAbsence`)가 공유한다. 화면마다 다시 짜면 한쪽만 고쳐지고 다른 쪽이 조용히 남는다.
 *
 * 🔴 **정정 이력을 먼저 걷어낸다.** `attendance_records`는 정정을 새 행으로 남기는 append-only 표라
 *    (`effective-records.ts`), 이 저장소의 모든 읽기 경로가 (학생·반·날짜·교시)별 최신 1건으로 접는다.
 *    상태로만 좁히고 이 축약을 건너뛰면 **이미 출석으로 정정된 죽은 결석 행**을 집어 거기에 메모를 붙이고
 *    "결석 칸에 메모" 성공이라고 답하게 된다(그 메모는 어느 화면에도 안 뜬다 — 전부 effective로 걸러진다).
 * 🔴 그래서 **status는 SQL이 아니라 effective 뒤에** 건다. 순서를 뒤집으면 위 함정으로 되돌아간다.
 * ⚠️ 그러면서도 상태로 좁히는 이유: 한 반이 하루 여러 교시를 도는 곳(영어는 활성 반-요일 115개가 **전부**
 *    2~4교시)에서 "최신 1건"만 보면 그 1건이 다른 교시의 **출석**이라 결석을 눈앞에 두고 못 찾는다([[#112]]).
 * ⚠️ 교시가 여럿이어도 붙이는 칸은 **하나**다 — 보강 1회가 결석 3교시를 다 메운 것처럼 보이면 안 된다.
 */

import { createClient } from "@/lib/supabase/server";
import { effectiveAttendanceRecords } from "../effective-records";
import { hasMemoLine } from "@/features/onescreen/makeup-absence-link";
import { explainDbError } from "@/lib/supabase/db-error";

type Sb = Awaited<ReturnType<typeof createClient>>;

/** 메모를 붙일 수 있는 결석 칸(필요한 것만). */
export type AbsenceCell = { id: string; note: string | null };

/** 결석 칸 조회 결과 — 실패를 **빈 목록으로 위장하지 않는다**(그게 이 기능이 고치려던 증상이다). */
export type AbsenceCellsResult = { ok: true; cells: AbsenceCell[] } | { ok: false; error: string };

/** 결석/공결 = 보강이 메울 수 있는 상태. */
const ABSENT = new Set(["absent", "excused"]);

/**
 * 그날 그 반 그 학생의 **유효한 결석/공결 칸** — 최근에 기록된 것부터.
 *
 * ⚠️ 정렬이 `recorded_at` 내림차순인 이유는 취향이 아니다: 반별 출석부 폼이 그날 note를 **가장 최근 행에서
 *    읽어 그날 전 교시에 되쓴다**(`attendance/server/queries.ts`·`saveAttendance`). 대상 칸을 그 행과
 *    맞춰 두지 않으면, 나중에 누가 그 날짜 출석부를 저장하는 순간 붙여 둔 보강 메모가 조용히 지워진다.
 */
export async function fetchAbsenceCells(
  supabase: Sb,
  args: { studentId: string; classId: string; date: string },
): Promise<AbsenceCellsResult> {
  // 🔴 status를 SQL에 걸지 않는다 — 정정 이력을 접으려면 그날 그 칸의 **모든 행**이 필요하다.
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, note, status, slot_start, recorded_at, student_id, class_id, session_date")
    .eq("class_id", args.classId)
    .eq("student_id", args.studentId)
    .eq("session_date", args.date);
  if (error) {
    // 🔴 조용히 빈 목록으로 두지 않는다 — 그러면 "그날 결석 기록이 없다"는 **거짓 결론**이 나오고,
    //    이 기능이 고치려던 바로 그 증상(연결이 안 됐는데 이유를 모름)으로 돌아간다.
    console.error("[absence-cell] 결석 칸 조회 실패", error.message);
    return { ok: false, error: explainDbError(error, { scope: "attendance.absence-cell.fetchAbsenceCells", fallback: "결석 기록을 읽지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  }
  const rows = (data ?? []) as {
    id: string;
    note: string | null;
    status: string;
    slot_start: string | null;
    recorded_at: string;
    student_id: string;
    class_id: string;
    session_date: string;
  }[];
  const live = effectiveAttendanceRecords(rows);
  return {
    ok: true,
    cells: live
      .filter((r) => ABSENT.has(r.status))
      .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id.localeCompare(a.id)))
      .map((r) => ({ id: r.id, note: r.note ?? null })),
  };
}

/** 그 칸에 이미 **어떤** 보강 연결이 적혀 있는가 — `absenceMemo()`가 남기는 "7/16 보강 예정·완료" 형태. */
const MADE_UP_RE = /\d{1,2}\/\d{1,2}\s*보강\s*(예정|완료)/;

/**
 * 이 연결을 적을 칸 하나 — 우선순위가 셋이다.
 *  ① **이미 이 줄이 적힌 칸**(멱등 — 두 번 눌러도 다른 교시에 같은 줄이 늘지 않는다)
 *  ② 아직 **어떤 보강도 안 적힌** 칸 중 최신 — 결석 2교시를 두 번에 나눠 보강하면 서로 다른 칸에 간다
 *     (여기가 없으면 두 보강이 같은 칸에 쌓여 "한 교시를 두 번 보강"처럼 보인다)
 *  ③ 그래도 없으면 최신 칸
 * 결석 칸이 아예 없으면 null(선보강 — 없는 칸을 만들지 않는다).
 */
export function pickAbsenceNoteTarget(rows: readonly AbsenceCell[], memo: string): AbsenceCell | null {
  return (
    rows.find((r) => hasMemoLine(r.note, memo)) ??
    rows.find((r) => !MADE_UP_RE.test(r.note ?? "")) ??
    rows[0] ??
    null
  );
}
