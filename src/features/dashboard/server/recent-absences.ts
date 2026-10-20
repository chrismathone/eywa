import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { taughtByColumnReady } from "@/features/attendance/server/taught-by-db";
import { loadScopeFacts } from "@/features/attendance/server/scope-ownership";
import { loadAxisTeacherNames, loadClassAxisRows } from "@/features/attendance/server/teacher-axis-queries";
import { axisDowOf, isSeatSlot, normalizeAxisTime, resolveRecordTaughtBy, slotLiveOn } from "@/features/attendance/teacher-axis";
import { intakeTeacherLabel } from "@/features/attendance/intake/absence-intake";
import { getHomeroomHistoryIndex } from "@/features/classes/server/teacher-as-of-queries";
import { homeroomTeacherOnDate } from "@/features/classes/teacher-as-of";
import type { ScopeClassFacts } from "@/features/attendance/scope-ownership";
import { effectiveAbsentCells } from "../absence-subjects";
import { foldRecentAbsences, type CellTeacher, type RecentAbsenceRow, type RecentAbsences } from "../recent-absences";

type One<T> = T | T[] | null;
type RawRow = Omit<RecentAbsenceRow, "subject" | "student_name" | "class_name"> & {
  student: One<{ name: string | null }>;
  class: One<{ subject: string | null; class_name: string | null }>;
};
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * 운영실 '최근 결석'(원장 2026-10-20) — 어제까지 7일(`recentAbsenceRange`) 결석을 학생별로, 결석마다 **그 수업을 가르친 선생님**과 함께.
 * 세는 규칙은 [recent-absences.ts](../recent-absences.ts) `foldRecentAbsences` 한 벌(0221a와 같은 단위).
 *
 * 🔴 상태로 좁혀 읽지 않는다 — 결석을 출석으로 고친 칸은 최신 행을 봐야 결석이 아니게 된다. 대신 두 단계로 행을 줄인다
 *    (`getAbsenceBreakdown`과 같은 방식): ① 창 안에 결석 행이 한 번이라도 있는 학생만 고르고 ② 그 학생들의 창 안 전 칸을 읽는다
 *    (B2 페이징 · B3 학생 id 청크). 30초 갱신마다 하루 전 칸의 일곱 배를 읽지 않는다.
 * 🔴 담당 = 출결 강사 귀속(teacher-axis.ts 단일 소스): 대신 보강(`taught_by`) → 자리 표식(`seat_label`·`recorded_via`) →
 *    그날 그 교시 담당(슬롯) → 그날 담임(이력 복원). 입력한 사람(`recorded_by`)으로 대신하지 않는다.
 * 강사 범위(`teacherId`)면 그 기간에 그 강사가 가르치는 반(담임 ∪ 교시 담당 — 옛 카드·출석부와 같은 규칙)의 결석만.
 */
export async function getScopedRecentAbsences(range: { from: string; to: string }, teacherId: string | null): Promise<RecentAbsences> {
  const supabase = await createClient();
  // 담임 이력은 다른 조회와 무관하다 — 처음부터 함께 띄운다(B4). 실패하면 그날 담임 대신 지금 담임으로(담당 표시만 영향).
  const historyPromise = getHomeroomHistoryIndex().catch((error: unknown) => {
    console.error("[dashboard/recent-absences/history]", error);
    return null;
  });
  const [withTaughtBy, classRows, absentRows] = await Promise.all([
    taughtByColumnReady().catch(() => false),
    teacherId ? loadClassAxisRows(range.from, range.to) : Promise.resolve(null),
    fetchAllPaged<{ id: string; student_id: string }>((from, to) =>
      supabase
        .from("attendance_records")
        .select("id, student_id")
        .eq("status", "absent")
        .gte("session_date", range.from)
        .lte("session_date", range.to)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const studentIds = [...new Set(absentRows.map((r) => r.student_id))];
  if (studentIds.length === 0) return { from: range.from, to: range.to, students: [] };

  // taught_by(0316a)는 칸이 있을 때만 싣는다 — 옛 스키마에서 select하면 42703으로 카드 전체가 죽는다([[#95]]).
  // 문자열 리터럴 둘 중 하나로 고른다(쿼리 문자열이 `string`이면 supabase-js가 행 모양을 못 읽는다 — 출석부 queries.ts와 같은 수).
  const columns = (withTaughtBy
    ? "id, student_id, class_id, session_date, slot_start, status, recorded_at, note, seat_label, recorded_via, taught_by, student:student_id ( name ), class:class_id ( subject, class_name )"
    : "id, student_id, class_id, session_date, slot_start, status, recorded_at, note, seat_label, recorded_via, student:student_id ( name ), class:class_id ( subject, class_name )") as "id, student_id, class_id, session_date, slot_start, status, recorded_at, note, seat_label, recorded_via, student:student_id ( name ), class:class_id ( subject, class_name )";
  const raw = (await fetchAllPagedInChunks<RawRow>(studentIds, (chunk, from, to) =>
    supabase
      .from("attendance_records")
      .select(columns)
      .in("student_id", chunk)
      .gte("session_date", range.from)
      .lte("session_date", range.to)
      .order("id", { ascending: true })
      .range(from, to),
  )) as RawRow[];
  const allowed = teacherId && classRows ? new Set(classRows.filter((c) => c.taughtBy.includes(teacherId)).map((c) => c.id)) : null;
  const rows: RecentAbsenceRow[] = raw
    .filter((r) => !allowed || allowed.has(r.class_id))
    .map(({ student, class: cls, ...r }) => ({
      ...r,
      student_name: one(student)?.name ?? null,
      class_name: one(cls)?.class_name ?? null,
      subject: one(cls)?.subject ?? null,
    }));

  const cells = effectiveAbsentCells(rows).filter((c) => c.session_date >= range.from && c.session_date <= range.to);
  // 🔴 담당 판정이 실패해도 결석 숫자는 보인다(담당 표시만 '담당 모름') — 일시 오류 한 번에 카드 전체가 '조회 실패'가 되지 않게(리뷰 2026-10-20).
  const teacherOf = await teacherResolver(supabase, cells, historyPromise).catch((error: unknown) => {
    console.error("[dashboard/recent-absences/teachers]", error);
    return () => null;
  });
  return foldRecentAbsences(rows, range, teacherOf);
}

/** 결석 칸 → 담당 표시. 재료(반 담임·교시 담당·그날 담임·이름)를 한 번에 읽고 칸마다 `attribute`로 푼다. */
async function teacherResolver(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cells: readonly RecentAbsenceRow[],
  historyPromise: Promise<Awaited<ReturnType<typeof getHomeroomHistoryIndex>> | null>,
): Promise<(cell: RecentAbsenceRow) => CellTeacher | null> {
  const [facts, history] = await Promise.all([
    loadScopeFacts(supabase as unknown as SupabaseClient, cells.map((c) => ({ classId: c.class_id, date: c.session_date }))),
    historyPromise,
  ]);
  const axes = new Map(cells.map((c) => [c.id, attribute(c, facts.get(c.class_id), history?.get(c.class_id))]));
  const names = await loadAxisTeacherNames([...new Set([...axes.values()].map((a) => a.teacherId).filter((v): v is string => !!v))]);
  return (cell) => {
    const a = axes.get(cell.id);
    if (!a) return null;
    const name = a.teacherId ? (names.get(a.teacherId)?.name ?? null) : null;
    return { label: intakeTeacherLabel({ source: a.source, teacherName: name, seatLabel: a.seatLabel }) };
  };
}

type CellAxis = { teacherId: string | null; source: "slot" | "homeroom" | "seat" | "ambiguous" | "none"; seatLabel: string | null };

/** 결석 칸 하나의 담당 — 대신 보강 → 자리 표식 → 슬롯·그날 담임(`resolveRecordTaughtBy`). 표시 문구는 호출부가 `intakeTeacherLabel`로. */
function attribute(cell: RecentAbsenceRow, facts: ScopeClassFacts | undefined, history: Parameters<typeof homeroomTeacherOnDate>[0]): CellAxis {
  if (cell.taught_by) return { teacherId: cell.taught_by, source: "slot", seatLabel: null };
  if (cell.seat_label?.trim()) return { teacherId: null, source: "seat", seatLabel: cell.seat_label.trim() };
  const slots = facts?.slots ?? [];
  if (cell.recorded_via === "seat") return { teacherId: null, source: "seat", seatLabel: seatLabelOf(slots, cell) };
  const homeroomTeacherId = homeroomTeacherOnDate(history, facts?.homeroomTeacherId ?? null, cell.session_date);
  const axis = resolveRecordTaughtBy({ taughtBy: null, homeroomTeacherId, slots, date: cell.session_date, slotStart: cell.slot_start });
  const source = axis.source === "substitute" ? "slot" : axis.source;
  return { teacherId: axis.teacherId, source, seatLabel: source === "seat" ? seatLabelOf(slots, cell) : null };
}

/** 자리 교시의 방 이름(LAB·JJ) — 그날 그 교시의 자리 슬롯 표기. 없으면 null('자리 수업'으로 접힌다). */
function seatLabelOf(slots: ScopeClassFacts["slots"], cell: RecentAbsenceRow): string | null {
  const dow = axisDowOf(cell.session_date);
  const start = normalizeAxisTime(cell.slot_start);
  const seat = slots.find(
    (s) => isSeatSlot(s) && s.dayOfWeek === dow && slotLiveOn(s, cell.session_date) && (start == null || normalizeAxisTime(s.startTime) === start),
  );
  return seat?.slotTeacherLabel?.trim() || null;
}
