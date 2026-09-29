import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { getReservationsInRange } from "@/features/attendance/server/makeup-reservation-queries";
import { getPeriodDefs } from "@/features/periods/server/queries";
import { resolvePeriodWindow } from "@/features/periods/resolve";
import { monthRange } from "../plan";
import { monthRosterKey, monthRosterPairs, type MonthRosterPair } from "../month-roster";

type Db = Awaited<ReturnType<typeof createClient>>;

/** 학생으로 좁혀 읽는 상한 — 넘으면 좁히지 않고 읽어 메모리에서 거른다(B3, 반 id 청크와 함께 URL에 실린다). */
const STUDENT_FILTER_MAX = 100;

/** 그 달 줄 집합에 서는 반의 표시 재료 — 회차 행이 없는 줄은 회차 표의 반 임베드가 없어 여기서 채운다. */
export type MonthRosterClass = {
  id: string;
  className: string;
  subject: string;
  englishTrack: string | null;
  homeroomTeacherName: string | null;
  /** 보이지 않는 '보강' 반(0241a) — 강사당 1개·수강 0. 출석부 강사 전체 보기에만 묶음이 선다. */
  isMakeupPool: boolean;
};

/** 반 하나의 기간 창 — 출석부가 그 반을 그리는 날짜 범위(포함). */
export type MonthRosterWindow = { start: string; end: string; kind: "session" | "month" };

export type MonthRoster = {
  pairs: MonthRosterPair[];
  /** `학생|반` → 쌍. 회차 행이 이 집합 밖이면 '이번 달 수업 없음'. */
  byKey: Map<string, MonthRosterPair>;
  classes: Map<string, MonthRosterClass>;
  /** 반 → 그 달 기간 창(세션이 있으면 세션, 없으면 달력월). */
  windows: Map<string, MonthRosterWindow>;
};

const CLASS_COLS = "id, class_name, subject, english_track, closed_at, is_active, teacher:teacher_id ( display_name )";
/** 청크 크기 — 청크끼리는 병렬이고 청크 안 페이지는 직렬이라, 한 청크가 한 페이지(1,000행)에 들어가게 자른다(실측 9월 출결 5,103행 · 수강 1,427행 / 반 121개). */
const ENROLLMENT_CHUNK = 40;
const RECORD_CHUNK = 20;

type ClassRow = {
  id: string;
  class_name: string;
  subject: string;
  english_track: string | null;
  closed_at: string | null;
  is_active: boolean;
  teacher: { display_name?: string | null } | { display_name?: string | null }[] | null;
};

/**
 * 보이지 않는 '보강' 반(0241a) 행 — 🔴 `is_makeup_pool`을 목록 쿼리에 끼우지 않고 **따로** 읽어 실패하면 빈 배열(#95 · `listMakeupPoolClassIds`와
 * 같은 fail-soft). 반 목록과 **나란히** 읽는다(예전엔 id 목록 → 행 조회가 직렬이었다).
 */
async function loadPoolRows(db: Db, classIds: readonly string[] | null): Promise<ClassRow[]> {
  try {
    let q = db.from("classes").select(CLASS_COLS).eq("is_makeup_pool", true);
    if (classIds) q = q.in("id", [...classIds]);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as unknown as ClassRow[];
  } catch {
    return [];
  }
}

/**
 * **그 달 (학생 × 반) 줄 집합**을 테넌트 전체로 한 번에 읽는다 — 회차 확정 화면·계획 갱신·행 생성 액션이 **같은 함수**를 쓴다.
 *
 * 반 축 = 월별 출석부와 같다: `is_active` 반 중 종강일이 월초보다 앞서지 않는 반(`loadClassAxisRows`의 규약) + 보이지 않는 '보강' 반
 * (출석부 강사 전체 보기가 `allowClassId`로 붙이는 그 반). 🔴 비활성·종강 반의 옛 회차 행은 여기 없으므로 '이번 달 수업 없음'으로 남는다.
 * 🔑 **기간 창 = 출석부 기본 보기와 같은 창**(원장 요구 "출석부 행 개수 = 회차 확정 행 개수" — 원장이 보는 출석부는 세션 보기다):
 *    반의 과목에 그 달 세션이 있으면 세션 창, 없으면 달력월(`resolvePeriodWindow` — 출석부 `getPeriodWindow({ subjectKey })`와 같은 해석).
 *    보강 반은 출석부가 달력월로 그리므로 달력월. ⚠️ 출석부 보기를 '달력월'로 바꾼 사람의 화면과는 경계 며칠이 다를 수 있다.
 * 🔴 B2/B3 — 수강·기록은 반 id 청크 × 페이징(`fetchAllPagedInChunks`, unique order). 예약은 `getReservationsInRange`(fail-soft, #95 —
 *    표가 없으면 예약 없음으로 떨어진다). 세션 클라이언트(RLS 테넌트 격리·`billing` 읽기 권한).
 * ⚠️ `studentIds`를 주면 그 학생의 줄만 · `classIds`를 주면 그 반만 세운다(반 일괄 확정 — 쌍은 반마다 독립이라 결과가 같다).
 */
export async function loadMonthRoster(
  db: Db,
  period: string,
  options: { studentIds?: readonly string[]; classIds?: readonly string[] } = {},
): Promise<MonthRoster> {
  const range = monthRange(period);
  const empty: MonthRoster = { pairs: [], byKey: new Map(), classes: new Map(), windows: new Map() };
  if (!range) return empty;
  const studentIds = options.studentIds ? [...new Set(options.studentIds)] : null;
  if (studentIds && studentIds.length === 0) return empty;
  const onlyClasses = options.classIds ? [...new Set(options.classIds)] : null;
  if (onlyClasses && onlyClasses.length === 0) return empty;
  // 🔴 B3 — 반 id 청크에 학생 id까지 `.in()`으로 얹으면 URL이 두 배로 길어진다. 학생이 많으면(선택 확정 수백 명) 좁히지 않고
  //    그 달 전체를 읽은 뒤 메모리에서 거른다(결과는 같고 왕복만 는다).
  const narrow = studentIds && studentIds.length <= STUDENT_FILTER_MAX ? studentIds : null;
  const wanted = studentIds ? new Set(studentIds) : null;

  const [classRows, poolRows, defs] = await Promise.all([
    onlyClasses
      ? fetchAllPagedInChunks<ClassRow>(onlyClasses, (chunk, from, to) => db.from("classes").select(CLASS_COLS).in("id", chunk).order("id").range(from, to))
      : fetchAllPaged<ClassRow>((from, to) => db.from("classes").select(CLASS_COLS).eq("is_active", true).order("id").range(from, to)),
    loadPoolRows(db, onlyClasses),
    getPeriodDefs(Number(period.slice(0, 4))),
  ]);
  const poolSet = new Set(poolRows.map((c) => c.id));
  // 종강한 반은 그 뒤 달에서 뺀다(그 반이 돌던 달엔 남긴다) — 출석부 반 축과 같은 규약. 보강 반은 늘 비활성이라 따로 붙인다.
  const live = classRows.filter((c) => !poolSet.has(c.id) && c.is_active && (!c.closed_at || c.closed_at >= range.start));
  const classes = new Map<string, MonthRosterClass>();
  const windows = new Map<string, MonthRosterWindow>();
  for (const c of [...live, ...poolRows]) {
    const teacher = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
    const isMakeupPool = poolSet.has(c.id);
    classes.set(c.id, {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      englishTrack: c.english_track ?? null,
      homeroomTeacherName: teacher?.display_name ?? null,
      isMakeupPool,
    });
    const w = isMakeupPool
      ? { kind: "month" as const, start: range.start, end: range.end }
      : resolvePeriodWindow({ period, subjectKey: c.subject, defs, mode: "session" });
    windows.set(c.id, { kind: w.kind, start: w.start, end: w.end });
  }
  const classIds = [...classes.keys()];
  if (classIds.length === 0) return empty;
  // 조회 범위 = 모든 반의 창 ∪ 달력월 — 줄 멤버십은 창으로, 실제 시수는 달력월로 거른다(한 번 읽어 두 용도로).
  const starts = [range.start, ...[...windows.values()].map((w) => w.start)].sort();
  const ends = [range.end, ...[...windows.values()].map((w) => w.end)].sort();
  const minStart = starts[0]!;
  const maxEnd = ends[ends.length - 1]!;

  // ⚠️ 학생 좁히기를 제네릭 헬퍼로 감싸면 supabase 빌더 타입이 재귀 인스턴스화돼 tsc가 TS2589로 멈춘다 — 조건을 그 자리에 쓴다.
  const [enrollments, rawRecords, reservations] = await Promise.all([
    fetchAllPagedInChunks<{ student_id: string; class_id: string; start_date: string; end_date: string | null; on_hold: boolean }>(
      classIds,
      (chunk, from, to) => {
        let q = db.from("enrollments").select("student_id, class_id, start_date, end_date, on_hold").in("class_id", chunk).lte("start_date", maxEnd);
        if (narrow) q = q.in("student_id", narrow);
        return q.order("id").range(from, to);
      },
      ENROLLMENT_CHUNK,
    ),
    fetchAllPagedInChunks<{ id: string; student_id: string; class_id: string; session_date: string; slot_start: string | null; status: string; session_units: number | null; recorded_at: string }>(
      classIds,
      (chunk, from, to) => {
        let q = db
          .from("attendance_records")
          .select("id, student_id, class_id, session_date, slot_start, status, session_units, recorded_at")
          .in("class_id", chunk)
          .gte("session_date", minStart)
          .lte("session_date", maxEnd);
        if (narrow) q = q.in("student_id", narrow);
        return q.order("id").range(from, to);
      },
      RECORD_CHUNK,
    ),
    getReservationsInRange(minStart, maxEnd, classIds),
  ]);
  // 🔴 정정 줄은 **기록 시각 순 최신 하나**만 — 공용 `effectiveAttendanceRecords`(0267a RPC·급여와 같은 규칙).
  //    예전엔 id 순 마지막 줄을 골라(id는 UUID라 사실상 무작위) 정정 전 값이 '실 시수'로 나올 수 있었다(점검 2026-09-28).
  const records = effectiveAttendanceRecords(rawRecords);

  // 반마다 제 창 안으로 거른다 — 출석부가 그 반을 그릴 때 받는 행과 같게(수강 `start_date ≤ 창 끝` · 기록·예약은 창 안).
  const inWindow = (classId: string, date: string) => {
    const w = windows.get(classId);
    return !!w && date >= w.start && date <= w.end;
  };
  const keep = <T extends { student_id: string }>(rows: T[]) => (wanted ? rows.filter((r) => wanted.has(r.student_id)) : rows);
  const toRecord = (r: (typeof records)[number]) => ({
    studentId: r.student_id,
    classId: r.class_id,
    sessionDate: r.session_date,
    slotStart: r.slot_start,
    status: r.status,
    sessionUnits: r.session_units === null ? null : Number(r.session_units),
  });
  const pairs = monthRosterPairs({
    from: (classId) => windows.get(classId)?.start ?? range.start,
    enrollments: keep(enrollments)
      .filter((e) => {
        const w = windows.get(e.class_id);
        return !!w && e.start_date <= w.end;
      })
      .map((e) => ({ studentId: e.student_id, classId: e.class_id, startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold === true })),
    records: keep(records)
      .filter((r) => inWindow(r.class_id, r.session_date))
      .map(toRecord),
    // 🔑 실제 시수는 **달력월**(소비 RPC 0267a·계획과 같은 청구 축) — 창과 섞으면 행이 생기는 순간 같은 줄의 시수가 바뀐다.
    unitRecords: keep(records)
      .filter((r) => r.session_date >= range.start && r.session_date <= range.end)
      .map(toRecord),
    reservations: reservations
      .filter((v) => (!wanted || wanted.has(v.studentId)) && inWindow(v.classId, v.makeupDate))
      .map((v) => ({ studentId: v.studentId, classId: v.classId })),
  });
  return { pairs, byKey: new Map(pairs.map((p) => [monthRosterKey(p.studentId, p.classId), p])), classes, windows };
}
