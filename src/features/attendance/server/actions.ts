"use server";

import { taughtByColumnReady } from "./taught-by-db";
import { anchorCellKey, makeupAnchorDeleteCheck } from "./makeup-anchor-cells";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { notifyIfClassAttendanceComplete } from "./complete-notify";
import { notifyDeskOfAbsences } from "@/features/attendance/live/server/absent-notify";
import { notifyUnmarkedToPresent } from "@/features/attendance/live/server/cross-notify";
import { isUnmarkedToArrival } from "@/features/attendance/live/mark-state";
import {
  assertDeskMayWrite,
  isMissingViaColumn,
  lookupPeriodPhase,
  resolveWriteVia,
  withVia,
  userTaughtClassSet,
} from "@/features/attendance/live/server/write-policy";
import { noteMakeupAgainstAbsence } from "./makeup-note-action";
import { makeupDeadlineError } from "./makeup-deadline-gate";
import { fetchAbsenceCells, pickAbsenceNoteTarget } from "./absence-cell";
import { resolveStaffVia, type RecordedVia } from "@/features/attendance/live/recorded-via";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/auth/tenant-view-shared";
import { explainDbError } from "@/lib/supabase/db-error";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { blockedByCorrectOnly, CORRECT_ONLY_MESSAGE, writeEligibility, type WriteEligibility } from "../write-eligibility";
import { dayRecordIdsByStudent } from "../day-record-ids";
// 담당 반 판정 단일 소스(담당 반 ∪ 그날 위임 반) — classes.teacher_id를 직접 비교하지 말 것(0173a).
import { COUNTABLE_STATUSES, isDefaultUnitsRaw, parseSessionUnits, round1 } from "../session-units";
// 그날 칸 시수 배분(셀·범위 공용) + 강사 전체 보기의 몫 판정(원장 제보 2026-09-11) — 규칙은 순수 모듈, 조회는 server/.
// 강사 보기 저장은 자리(JJ·랩실) 행을 안 쓴다(원장 2026-09-12) — 빼는 곳은 `splitOutSeatRows` 한 곳.
import {
  groupByPlannedUnits,
  planDayCellUnits,
  splitOutSeatRows,
  SCOPE_INVALID_MESSAGE,
  SCOPE_LOAD_FAILED_MESSAGE,
  SCOPE_NOT_TAUGHT_MESSAGE,
  type DayTargetRow,
  type DayUnitsPlan,
} from "../scoped-split";
import {
  buildScopeShare,
  isScopeClassIds,
  isScopeTeacherId,
  scopeInsertSlots,
  scopeTeaches,
  type ScopeShare,
} from "../scope-ownership";
import { loadScopeFacts } from "./scope-ownership";
import { NOT_MINE_MESSAGE } from "../cell-display";
// 빗금 칸 입력(원장 2026-09-14) — 제 몫 0 · 다른 선생님 교시 행에 상태만 옮긴다. 판정·메모 규칙은 순수 모듈 한 곳.
import { planScopedDay, SCOPED_REJECT_MESSAGE, type ScopedRejectReason } from "../ghost-transfer";
import { noteTargetRow, proxyNote, sameNoteRows } from "../proxy-memo";
import { unitsAuditFields, type UnitsAudit } from "../units-audit";
// 수학 자동 시수(원장 2026-09-11) — **새 행**에만, 숫자를 안 고른 저장에만. 규칙·근거는 auto-units.ts.
import { autoUnitsApply, autoUnitsKey, autoUnitsLogFields, newRowUnits } from "../auto-units";
import { resolveAutoUnits } from "./auto-units";
import { hasSaveTarget, pickSaveTargets, type SaveTargets } from "../save-targets";
import {
  absenceMemo,
  appendMemo,
  hasMemoLine,
  makeupMemo,
  unitsAfterMakeup,
} from "@/features/onescreen/makeup-absence-link";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "../edit-window";
// 보강 예약(0264a) — 예약된 학생의 그날 칸은 수강행이 없어도 연다(`hasReservedMakeup`), 시수를 쓰는 출결이 찍히면
// 예약을 이행 처리한다(`completeMakeupReservations`). 둘 다 fail-soft — 표가 없어도 출결 저장은 종전 그대로.
import { hasReservedMakeup, reservedCellKey, reservedCellKeys } from "./makeup-reservation-queries";
import { hasSplitInto, splitIntoKeys } from "@/features/class-splits/server/queries";
import { nativeWriteAllowance, nativeWriteKeys } from "@/features/makeups/server/adapters/gates";
import { completeMakeupReservations, completionKey } from "./makeup-reservation-complete";
import { kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";

const STATUSES = ["present", "absent", "late", "excused", "makeup", "early_leave"] as const;
type Status = (typeof STATUSES)[number];

/** 출결을 쓰는 화면은 셋(출석부·ECS·원스크린) — 한 곳에서 쓰면 나머지도 다시 그린다. */
function revalidateAttendanceSurfaces() {
  revalidatePath("/attendance");
  revalidatePath("/ecs");
  revalidatePath("/onescreen");
}

/**
 * 감사로그 metadata 조각 — **무엇을 찍었는지**를 한 줄로(`{ present: 28, absent: 2 }`).
 * 건별로 N행을 남기지 않기 위한 요약이라, 되짚을 식별자(`studentIds`)와 **짝으로만** 쓴다.
 */
function countByStatus(list: readonly { status: Status }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of list) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/**
 * 소급 입력(지난 날짜) 표식 — 2026-08-18 사고("재원생 7명을 7월 날짜로 소급 퇴원")와 **같은 모양**이라
 * 감사로그에서 눈에 띄어야 한다. 날짜는 metadata에 이미 있지만, 플래그가 있어야 액션 필터·검색으로
 * "소급된 건만" 훑을 수 있다. 없으면 키 자체를 안 넣는다(평시 행을 늘리지 않는다).
 */
function backdatedFlag(dates: readonly string[], today: string): { backdated?: true } {
  return dates.some((d) => d < today) ? { backdated: true } : {};
}

type Sb = Awaited<ReturnType<typeof createClient>>;

/**
 * 출결 쓰기의 DB 오류 → 화면용 한글 이유 + 로그([[#138]]). 예전엔 영문 원문이 출석부 토스트에 그대로 떴다
 * (예: 시수 범위 CHECK `attendance_session_units_range`). 모르는 오류는 일반 문구, 원문은 로그로만.
 */
function attendanceDbWhy(error: unknown, scope: string, op?: "write" | "delete"): string {
  return explainDbError(error, { scope, op, fallback: "출결을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." }).message;
}

/** 0212a 컬럼이 없으면 빼고 재시도 — 출결 저장을 죽이지 않는다(#95).
 *  `scope`(선택) — id 목록에 **소유 술어를 덧건다**(반·학생·날짜). 🔴 클라이언트가 보낸 행 id를 그대로
 *  믿는 경로(saveAttendance 폼)는 반드시 걸 것: id만으로 update하면 폼의 담당 반·7일창 게이트가 판정한
 *  (반·날짜)와 **무관한 행**을 쓸 수 있다(2026-08-17 감사 — 남의 반·석 달 전 행에 상태·시수 기입 가능).
 *  술어가 있으면 낯선 id는 0행에 걸릴 뿐 아무것도 못 쓴다. RLS는 tenant 격리뿐이라 여기가 방어선이다. */
async function updateWithVia(
  supabase: Sb,
  patch: Record<string, unknown>,
  ids: string[],
  scope?: { classId: string; studentId: string; sessionDate: string },
): Promise<{ error: string | null }> {
  const run = async (p: Record<string, unknown>) => {
    let q = supabase.from("attendance_records").update(p).in("id", ids);
    if (scope) {
      q = q
        .eq("class_id", scope.classId)
        .eq("student_id", scope.studentId)
        .eq("session_date", scope.sessionDate);
    }
    return q;
  };
  const { error } = await run(patch);
  if (!error) return { error: null };
  if (!isMissingViaColumn(error.message)) return { error: attendanceDbWhy(error, "attendance.update") };
  const rest = { ...patch };
  delete rest.recorded_via;
  const retry = await run(rest);
  return { error: retry.error ? attendanceDbWhy(retry.error, "attendance.update.retry") : null };
}

async function insertWithVia(
  supabase: Sb,
  row: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("attendance_records").insert(row);
  if (!error) return { error: null };
  if (!isMissingViaColumn(error.message)) return { error: attendanceDbWhy(error, "attendance.insert") };
  const rest = { ...row };
  delete rest.recorded_via;
  const retry = await supabase.from("attendance_records").insert(rest);
  return { error: retry.error ? attendanceDbWhy(retry.error, "attendance.insert.retry") : null };
}

async function insertManyWithVia(
  supabase: Sb,
  rows: Record<string, unknown>[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("attendance_records").insert(rows);
  if (!error) return { error: null };
  if (!isMissingViaColumn(error.message)) return { error: attendanceDbWhy(error, "attendance.insertMany") };
  const retry = await supabase.from("attendance_records").insert(
    rows.map((r) => {
      const rest = { ...r };
      delete rest.recorded_via;
      return rest;
    }),
  );
  return { error: retry.error ? attendanceDbWhy(retry.error, "attendance.insertMany.retry") : null };
}

/**
 * 강사 보기 **빗금 칸 입력**의 쓰기(원장 2026-09-14 *"대신 다른 사람이 출결하면 메모에 남겨."*) — 상태·입력자(`patch`) +
 * 행마다 기존 메모 끝에 `대신 입력: 이름` 한 줄. 시수 키는 없다(호출부 patch에도 없다).
 * 🔴 메모는 **읽은 그 값일 때만** 쓴다(메모 비교 조건 + 쓴 행 id 확인) — 읽고 쓰는 사이 담당 선생님이 사유를 저장하면 그
 *    사유를 덮지 않고, 지금 메모를 다시 읽어 한 번 더 붙인다(적대 리뷰 2026-09-14: 범위 저장은 반마다 기다리는 조회가 있어
 *    틈이 넓다). 두 번 모두 어긋난 행은 쓰지 않고 오류로 알린다 — 남의 기록을 덮는 것보다 다시 치게 하는 것이 낫다.
 * ⚠️ 그 사이 지워진 행(다시 읽어 없음)은 조용히 넘어간다 — 옮길 기록이 없다.
 */
async function writeProxyRows(
  supabase: Sb,
  patch: Record<string, unknown>,
  rows: readonly { id: string; note: string | null }[],
  actorName: string | null | undefined,
): Promise<{ error: string | null; written: number }> {
  let pending = [...rows];
  /** 실제로 쓴 행 수 — 중간에 멈춰도 호출부가 감사로그에 남긴다(적대 재리뷰 2026-09-14). */
  let written = 0;
  for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
    const byOld = new Map<string | null, string[]>();
    for (const r of pending) (byOld.get(r.note) ?? byOld.set(r.note, []).get(r.note)!).push(r.id);
    const missed: string[] = [];
    for (const [old, ids] of byOld) {
      const run = (p: Record<string, unknown>) => {
        const q = supabase.from("attendance_records").update(p).in("id", ids);
        return (old === null ? q.is("note", null) : q.eq("note", old)).select("id");
      };
      const next = { ...patch, note: proxyNote(old, actorName) };
      let res = await run(next);
      if (res.error && isMissingViaColumn(res.error.message)) {
        const rest: Record<string, unknown> = { ...next };
        delete rest.recorded_via;
        res = await run(rest);
      }
      if (res.error) return { error: attendanceDbWhy(res.error, "attendance.proxyWrite"), written };
      const done = new Set(((res.data ?? []) as { id: string }[]).map((d) => d.id));
      written += done.size;
      for (const id of ids) if (!done.has(id)) missed.push(id);
    }
    if (missed.length === 0) return { error: null, written };
    const missedSet = new Set(missed);
    const { data, error } = await supabase.from("attendance_records").select("id, note").in("id", missed);
    if (error) return { error: attendanceDbWhy(error, "attendance.proxyWrite.reread"), written };
    pending = ((data ?? []) as { id: string; note: string | null }[])
      .filter((d) => missedSet.has(d.id))
      .map((d) => ({ id: d.id, note: d.note ?? null }));
  }
  // 두 번 어긋난 행이 남았거나 **한 행도 못 썼으면**(그 사이 전부 지워짐) 성공으로 말하지 않는다 — 옮긴 게 없는데
  // "옮겼습니다"가 뜨면 거짓 안내다.
  return pending.length > 0 || written === 0
    ? { error: SCOPED_REJECT_MESSAGE.stale, written }
    : { error: null, written };
}

export type SaveAttendanceState = { error?: string; saved?: number } | undefined;

/**
 * 출결 쓰기의 판정 재료(담당 반·위임·수강) 조회가 실패했다 — 액션은 던지지 않고 이 문구로 돌려준다.
 * 판정을 `strict`로 바꾼 뒤(조회 실패를 "담당 반 없음"·데스크 입력으로 읽지 않게) 던지게만 두면 일별 폼은 오류 화면으로 넘어가고
 * 출석부 격자는 실패를 모른 채 남는다(4-1 리뷰) — 호출부는 이미 `{ error }`를 보여 준다. 판정은 늘 쓰기 **전**이라 반쯤 저장되지 않는다.
 */
const LOOKUP_FAILED = "담당 반·수강을 확인하지 못해 저장하지 않았습니다 — 잠시 후 다시 시도해 주세요";
async function settle<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch (err) {
    console.error("[attendance] 쓰기 판정 재료 조회 실패 — 저장 안 함:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Save attendance for a single class on a single date. Format:
 *   classId, date, then rows `status:{studentId}=<status>` for each student.
 *   Also accepts `note:{studentId}`, `homeworkRequired:{studentId}`, `homeworkDone:{studentId}`.
 * Empty status = leave alone (no record created).
 */
export async function saveAttendance(
  _prev: SaveAttendanceState,
  formData: FormData,
): Promise<SaveAttendanceState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const classId = String(formData.get("classId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!classId || !date) return { error: "반과 날짜가 필요합니다" };

  type Row = {
    studentId: string;
    status: Status;
    /**
     * 그날 이 학생의 유효 기록 **전부**(교시별 1건씩, 0196a) — 쉼표로 이어 온다.
     * 최근 1건만 고치면 같은 날 다른 교시가 조용히 옛 상태로 남는다("저장했는데 안 바뀐" 칸).
     */
    existingIds: string[];
    /** 폼이 보았던 기록 id(정렬해 이은 글자) — 오래된 화면 판별용. 쓰기에는 안 쓴다. */
    formSeen: string;
    note: string | null;
    /** 화면 이름(오류 문장용 — 표시만) */
    name: string;
    homeworkRequired: boolean;
    homeworkDone: boolean;
    sessionUnits: number | null;
    /** 시수 칸 원문 — ""(빈 칸)이면 '기본'이라 새 행에 수학 자동 시수가 들어간다. "1"은 명시다. */
    rawUnits: string;
  };
  const rows: Row[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status:")) continue;
    const studentId = key.slice("status:".length);
    const status = String(value);
    if (!status) continue;
    if (!STATUSES.includes(status as Status)) continue;
    // 🔴 폼의 `existing:` 값은 **쓰기 대상으로 쓰지 않는다** — 고칠 행은 아래에서 서버가 다시 고른다(결정 #5 ③).
    //    화면이 오래됐는지 가리는 데만 쓴다(`formSeen` — 서버 집합과 다르면 저장 거절).
    const existingIds: string[] = [];
    const formSeen = String(formData.get(`existing:${studentId}`) ?? "").split(",").map((v) => v.trim()).filter(Boolean).sort().join(",");
    const name = String(formData.get(`name:${studentId}`) ?? "").trim();
    const note =
      String(formData.get(`note:${studentId}`) ?? "").trim() || null;
    const homeworkRequired =
      String(formData.get(`homeworkRequired:${studentId}`) ?? "") === "true";
    const homeworkDone =
      String(formData.get(`homeworkDone:${studentId}`) ?? "") === "true";
    // 시수(배수, 0115a) — 빈 값·1 = 기본(null). 잘못된 입력은 행 단위로 즉시 반려.
    const rawUnits = String(formData.get(`units:${studentId}`) ?? "");
    const parsedUnits = parseSessionUnits(rawUnits);
    if (!parsedUnits.ok) {
      return { error: `${name || "학생"} 시수 입력 오류 — ${parsedUnits.error}` };
    }
    rows.push({
      studentId,
      status: status as Status,
      existingIds,
      formSeen,
      note,
      name,
      homeworkRequired,
      homeworkDone,
      sessionUnits: parsedUnits.value,
      rawUnits,
    });
  }

  /**
   * 보강 결석분 연결 — 확인창에서 고른 것만 `makeupLink:{studentId}` = "결석반id|결석일"로 실려 온다.
   *
   * 🔴 이 화면은 **폼 제출 한 번에** 저장하는 모델이라(원스크린·ECS는 고르는 즉시 저장) 연결도 여기서
   *    함께 끝낸다 — 클라가 저장 뒤에 이어서 부르려 해도 이 액션은 `redirect`로 끝나 그 기회가 없다.
   * ⚠️ **이 폼에 실린 학생만** 잇는다 — 폼 값은 클라가 보낸 것이라, 명단 밖 학생 id가 오면 그대로
   *    쓰기 표면이 넓어진다(#77). 담당 반·결석 칸 존재 여부는 연결 액션이 다시 확인한다.
   */
  const rowStudentIds = new Set(rows.map((r) => r.studentId));
  const makeupLinks: { studentId: string; absentClassId: string; absentDate: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("makeupLink:")) continue;
    const studentId = key.slice("makeupLink:".length);
    if (!rowStudentIds.has(studentId)) continue;
    const [absentClassId, absentDate] = String(value).split("|");
    if (!absentClassId || !absentDate || !/^\d{4}-\d{2}-\d{2}$/.test(absentDate)) continue;
    makeupLinks.push({ studentId, absentClassId, absentDate });
  }

  if (rows.length === 0) return { error: "저장할 출결 데이터가 없습니다" };

  // 수정 가능 기간 — 강사(scoped)는 세션일로부터 7일 이내만. 관리자 이상(full)은 제한 없음(원장 2026-07-21).
  // ⚠️ 화면에서만 잠그면 우회할 수 있다(#77) — 쓰기 경로 **양쪽**(이 액션과 setAttendanceCell)에 서버 게이트를 둔다.
  // ⚠️ 기준일은 항상 **KST 오늘**. 서버는 UTC라 new Date()로 재면 한국 새벽에 하루가 밀린다.
  const supabase = await createClient();
  if (!isUuid(classId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "잘못된 반·날짜입니다" };
  if (rows.some((r) => !isUuid(r.studentId))) return { error: "잘못된 학생입니다" };
  const formStudentIds = [...new Set(rows.map((r) => r.studentId))];

  /**
   * 서버가 다시 고르는 사실(결정 #5 ③) — 역할 무관, 강사 조회와 병렬(B4).
   *  · 그날 이 반의 유효 기록(고칠 행) — 폼이 보낸 id가 아니라 서버 조회. 오래된 화면이 "기록 없음"이라 믿어도 새 행을 겹쳐 만들지 않는다.
   *  · 반과 폼의 학생이 **이 지점에** 있는가 — `attendance_records` FK는 지점을 안 묶는다(관리자 저장도 같은 확인).
   */
  const sharedFacts = settle(Promise.all([
    fetchAllPaged<{ id: string; student_id: string; slot_start: string | null }>((from, to) =>
      supabase
        .from("attendance_records")
        .select("id, student_id, slot_start")
        .eq("class_id", classId)
        .eq("session_date", date)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
    supabase.from("classes").select("*", { count: "exact", head: true }).eq("id", classId).eq("tenant_id", user.tenantId),
    fetchInChunks<{ id: string }>(formStudentIds, (chunk) =>
      supabase.from("students").select("id").eq("tenant_id", user.tenantId).in("id", chunk),
    ),
  ]).then(([records, cls, students]) => {
    if (cls.error) throw cls.error;
    return { recordIds: dayRecordIdsByStudent(records), classOk: (cls.count ?? 0) > 0, tenantStudents: new Set(students.map((s) => s.id)) };
  }));

  /** 강사(scoped)의 학생 자격 — 행마다 `writeEligibility`(단건·일괄·범위와 같은 판정 한 벌, 결정 #5). 관리자는 null. */
  let formEligibility: Map<string, WriteEligibility> | null = null;
  let formNativeUnknown: string | null = null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(date, kstToday())) {
      return { error: attendanceLockMessage(date, kstToday()) };
    }
    // ⚠️ 담당 반 강제 — 예전엔 이 액션에 **반 소유 검사가 아예 없었다**(셀 토글 setAttendanceCell에만 있었음).
    // RLS는 tenant 격리뿐이라, 강사가 폼을 직접 POST하면 학원 내 아무 반 출결이나 쓸 수 있었다
    // (2026-07-21 적대검증 미수리분 "출석부 scoped 검증 부재=보안·돈"). 아래 보강 추가로 **임의 학생**까지
    // 폼에 실을 수 있게 되므로, 그 문을 열기 전에 이 게이트를 먼저 닫는다(#77).
    // 담당 반 ∪ 그날 위임받은 반(0173a) ∪ **그 교시 담당**(2026-08-18) — 결근 대체로 그 반을 맡은
    // 강사도, 시간표 슬롯으로 그 교시를 맡은 강사도 출결을 찍어야 한다.
    // 🔴 슬롯을 넣은 이유: 같은 날 출석부의 **읽기** 축이 담임 ∪ 교시 담당으로 넓어졌다(teacher-axis.ts).
    //    읽기만 넓히면 슬롯 담당 강사는 반이 보이는데 저장은 '담당 반이 아닙니다'로 막힌다 —
    //    실제로 걸리는 사람이 있다(실측 2026-08-18: Florence Park = teacher·슬롯 9·담임 0).
    //    읽기 ⊆ 쓰기가 되도록 같은 축을 쓴다(#77: 한 레코드의 모든 표면이 공용 게이트를 통과).
    const scopedFacts = await settle(Promise.all([
      userTaughtClassSet(supabase, user.id, date, true),
      // 그날 이 반 수강 — 세션 날짜 기준(단건 게이트와 같은 뜻). 한 반 명단이라 작지만 whitelist라 페이지로(B2).
      fetchAllPaged<{ student_id: string }>((from, to) =>
        supabase
          .from("enrollments")
          .select("id, student_id")
          .eq("class_id", classId)
          .or(`start_date.is.null,start_date.lte.${date}`)
          .or(`end_date.is.null,end_date.gte.${date}`)
          .order("id")
          .range(from, to),
      ),
      splitIntoKeys([classId], date),
    ]));
    if (!scopedFacts) return { error: LOOKUP_FAILED };
    const [myClassIds, enrolledRows, splitKeys] = scopedFacts;
    if (!myClassIds.has(classId)) return { error: "담당 반이 아닙니다" };
    const early = await sharedFacts;
    if (!early) return { error: LOOKUP_FAILED };
    const enrolledSet = new Set(enrolledRows.map((e) => e.student_id));
    // 보강 예약(fail-soft — 단건·일괄과 같은 문) · native(기간 한 번, 다른 근거가 없는 행만)
    const reservedKeys = await reservedCellKeys(
      user.tenantId,
      rows.filter((r) => !enrolledSet.has(r.studentId)).map((r) => ({ studentId: r.studentId, classId, date })),
    );
    const basis = (r: Row) =>
      enrolledSet.has(r.studentId) ||
      splitKeys.has(`${r.studentId}::${classId}`) ||
      reservedKeys.has(reservedCellKey({ studentId: r.studentId, classId, date }));
    const native = await nativeWriteKeys(
      rows.filter((r) => !basis(r) && r.status !== "makeup").map((r) => ({ studentId: r.studentId, classId, sessionDate: date })),
    );
    formNativeUnknown = native.error;
    formEligibility = new Map(
      rows.map((r) => [
        r.studentId,
        // 즉석 보강 행('+ 보강 추가'로 실은 `makeup`)은 새 행까지 — 학생·반의 지점 실재는 아래 공통 확인이 본다(결정 #5 ②·③).
        r.status === "makeup"
          ? "create"
          : writeEligibility({
              enrolled: enrolledSet.has(r.studentId),
              reserved: reservedKeys.has(reservedCellKey({ studentId: r.studentId, classId, date })),
              splitInto: splitKeys.has(`${r.studentId}::${classId}`),
              native: native.keys.has(`${r.studentId}::${classId}::${date}`),
              hasRecord: (early.recordIds.get(r.studentId)?.length ?? 0) > 0,
            }),
      ]),
    );
  }

  const shared = await sharedFacts;
  if (!shared) return { error: LOOKUP_FAILED };
  if (!shared.classOk) return { error: "반을 찾지 못했습니다" };
  const strangers = rows.filter((r) => !shared.tenantStudents.has(r.studentId));
  if (strangers.length > 0) return { error: `${strangers[0].name || "학생"} — 학생을 찾지 못했습니다` };
  for (const r of rows) r.existingIds = shared.recordIds.get(r.studentId) ?? [];
  // 🔴 화면이 연 뒤 그 학생 기록이 바뀌었으면(다른 화면이 새로 찍음·교시 행이 지워짐) 저장하지 않는다 — 폼의 시수 칸은 연 때의
  //    값이라, 그대로 쓰면 남은 한 행에 그날 합이 들어가거나 자동 시수가 1로 덮인다(4-4 리뷰). 고칠 행은 늘 서버 것이다.
  const stale = rows.find((r) => [...r.existingIds].sort().join(",") !== r.formSeen);
  if (stale) return { error: `${stale.name || "학생"} — 화면을 연 뒤 출결 기록이 바뀌었습니다. 새로 고친 뒤 다시 저장해 주세요` };
  if (formEligibility) {
    for (const r of rows) {
      const e = formEligibility.get(r.studentId) ?? "none";
      const willInsert = r.existingIds.length === 0;
      if (e === "none" || blockedByCorrectOnly(e, willInsert)) {
        // native를 확인하지 못해 근거를 모르는 행이면 그 사유를(정정만인 행은 새 행을 안 만들어 여기 오지 않는다).
        // 근거 없는 학생도 '보강'으로는 넣을 수 있다(즉석 보강) — 그 길을 문장에 적는다.
        return {
          error: `${r.name || "학생"} — ${formNativeUnknown ? "보강 참여를 확인하지 못해 저장하지 않았습니다. 잠시 후 다시 시도해 주세요" : "이 반 수강생이 아니어서 '보강'으로만 기록할 수 있습니다"}`,
        };
      }
    }
  }

  const nowIso = new Date().toISOString();
  const via = await settle(resolveWriteVia(supabase, user.id, classId, date));
  if (!via) return { error: LOOKUP_FAILED };

  // 반별 입력 폼은 월간 출석부 경로 — 데스크 게이트를 걸지 않는다(#103).
  // recorded_via 스탬프만 남긴다. 당일 화면의 제한은 source:"live"인 셀·일괄만.
  const updates = rows.filter((r) => r.existingIds.length > 0);
  const inserts = rows.filter((r) => r.existingIds.length === 0);

  let saved = 0;

  for (const r of updates) {
    // 교시가 여럿인 학생은 그날 **전 교시**를 같은 상태로 고친다(이 화면은 학생당 한 줄 = "그날 전체").
    const multi = r.existingIds.length > 1;
    const patch: Record<string, unknown> = withVia(
      {
        status: r.status,
        note: r.note,
        homework_required: r.homeworkRequired,
        homework_done: r.homeworkDone,
        recorded_by: user.id,
        recorded_at: nowIso,
      },
      via,
    );
    // 🔴 교시가 여럿이면 시수는 **건드리지 않는다** — 화면이 보여 준 값은 그날 **합**이라 그대로 각
    //    교시에 쓰면 교시 수만큼 부풀려진다(2교시 합 2 → 각 2 → 합 4). 교시별 시수는 영어 수업 시트에서.
    if (!multi) patch.session_units = r.sessionUnits;
    // 🔴 scope 유지 — existingIds는 이제 서버가 고른 값이지만(결정 #5 ③), 술어는 이중 안전장치로 둔다
    //    (updateWithVia 주석 참조 — 낯선 id는 0행 no-op).
    const wrote = await updateWithVia(supabase, patch, r.existingIds, {
      classId,
      studentId: r.studentId,
      sessionDate: date,
    });
    if (wrote.error) return { error: wrote.error };
    saved++;
  }

  // 수학 자동 시수 — **새 행** + 시수 칸을 비운 학생만(auto-units.ts). 한 반·한 날짜라 조회는 1회.
  const wantsAuto = (r: Row) => autoUnitsApply({ rawUnits: r.rawUnits, slotStart: null, status: r.status });
  const formAuto = inserts.some(wantsAuto)
    ? ((await resolveAutoUnits(supabase, [{ classId, date }])).get(autoUnitsKey(classId, date)) ?? null)
    : null;
  // 🔴 친 숫자가 먼저 — 원문을 `newRowUnits`가 다시 본다(auto-units.ts). 자동값은 판정을 탄 행에만 넘긴다.
  const formUnitsOf = (r: Row) => newRowUnits(r.rawUnits, r.sessionUnits, wantsAuto(r) ? formAuto : undefined);
  if (inserts.length > 0) {
    const wrote = await insertManyWithVia(
      supabase,
      inserts.map((r) =>
        withVia(
          {
            tenant_id: user.tenantId,
            class_id: classId,
            student_id: r.studentId,
            session_date: date,
            status: r.status,
            note: r.note,
            homework_required: r.homeworkRequired,
            homework_done: r.homeworkDone,
            session_units: formUnitsOf(r).units,
            recorded_by: user.id,
          },
          via,
        ),
      ),
    );
    if (wrote.error) return { error: wrote.error };
    saved += inserts.length;
  }

  /**
   * 결석분 연결 — 출결 저장이 **끝난 뒤**에 잇는다(보강 칸이 있어야 그 칸에 메모가 붙는다).
   * 🔴 실패해도 저장은 되돌리지 않는다 — 출결이 진짜 기록이고 메모는 그 위의 표시다. 대신 몇 건이
   *    못 붙었는지 세어 화면에 밝힌다(조용히 넘기면 "연결한 줄 알았는데 아니었다"가 된다).
   */
  let unlinked = 0;
  let linkError: string | null = null;
  if (makeupLinks.length > 0) {
    const linked = await Promise.all(
      makeupLinks.map((l) =>
        noteMakeupAgainstAbsence({
          studentId: l.studentId,
          makeupClassId: classId,
          makeupDate: date,
          absentClassId: l.absentClassId,
          absentDate: l.absentDate,
        }),
      ),
    );
    // 🔴 **두 실패를 뭉치지 않는다** — "결석을 못 찾음"(대개 선보강)과 "권한·기간·DB 오류"는 사람이 할 일이
    //    다르다. 하나로 합치면 권한 문제인데 강사가 결석을 찾으러 간다(이 기능이 고치려던 증상의 재현).
    for (const r of linked) {
      if ("error" in r) linkError = linkError ?? r.error;
      else if (!r.absenceNoted) unlinked++;
    }
  }

  /**
   * 감사로그 — 반별 폼 저장은 **한 번에 한 반·한 날짜**라 한 줄로 요약한다(학생 수만큼 남기면
   * 감사로그가 출결로 뒤덮여 정작 삭제·소급 줄이 묻힌다).
   * 🔴 `redirect()`는 throw라 **반드시 그 앞에서** 부른다.
   */
  await logAction({
    action: "attendance_save",
    targetType: "attendance",
    metadata: {
      classId,
      date,
      count: saved,
      created: inserts.length,
      updated: updates.length,
      statuses: countByStatus(rows),
      studentIds: rows.map((r) => r.studentId),
      // 수학 자동 시수가 들어간 새 칸(원장 2026-09-11) — 없으면 키도 없다.
      ...autoUnitsLogFields(inserts.map((r) => formUnitsOf(r).auto).filter((v): v is number => typeof v === "number")),
      // 🔴 "몇 건이 붙었나"를 빼서 만들지 않는다 — `unlinked`(결석 칸을 못 찾음)와 `linkError`(권한·DB 실패)는
      //    **서로 다른 실패**라 하나로 빼면 로그가 붙지도 않은 연결을 붙었다고 말한다. 있는 그대로 싣는다.
      ...(makeupLinks.length > 0
        ? {
            makeupRequested: makeupLinks.length,
            makeupUnlinked: unlinked,
            ...(linkError ? { makeupFailed: true } : {}),
          }
        : {}),
      ...backdatedFlag([date], kstToday()),
    },
  });

  // 보강 예약 이행(0264a) — 이 폼이 쓴 칸 중 예약이 걸린 것(반 × 날짜 한 번 조회).
  // `created` = 이번에 새로 만든 행(예약으로만 온 학생의 새 칸은 반 자동 시수가 아니라 예약 시수를 받아야 한다).
  const formCreated = new Set(inserts.map((r) => completionKey({ studentId: r.studentId, classId, date })));
  await completeMakeupReservations(
    { tenantId: user.tenantId },
    rows.map((r) => ({
      studentId: r.studentId,
      classId,
      date,
      status: r.status,
      unitsExplicit: !isDefaultUnitsRaw(r.rawUnits),
      created: formCreated.has(completionKey({ studentId: r.studentId, classId, date })),
    })),
  );

  // G4: 전원 기록 완료 전이 감지 → 담당 강사 벨(백그라운드, 응답 안 막음 — 실패해도 저장 무사).
  after(() =>
    notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date, actorId: user.id }),
  );
  revalidatePath(`/attendance/${date}`);
  revalidatePath(`/attendance/${date}/${classId}`);
  const linkQuery =
    (unlinked > 0 ? `&unlinked=${unlinked}` : "") +
    (linkError ? `&linkError=${encodeURIComponent(linkError)}` : "");
  redirect(`/attendance/${date}?saved=${saved}${linkQuery}`);
}

export type CellResult =
  | {
      ok: true;
      /**
       * `onlyIfEmpty` 요청인데 서버에 이미 기록이 있어 **아무것도 쓰지 않았다** — 현재 진실을 돌려준다.
       * 호출부는 이걸로 화면을 서버 상태에 맞추고 사용자에게 알린다(덮어쓰기 사고 방지, 2026-08-17 감사 P0-1).
       */
      conflict?: { status: string; note: string | null; units: number | string | null };
      /**
       * 이 저장이 **새 행을 만들었고 숫자를 안 골랐다**(수학 자동 시수 대상 판정을 탔다) — 실제로 저장된 시수
       * (null = 1). 키가 있을 때만 호출부가 화면 시수를 이 값으로 맞춘다(원장 2026-09-11, auto-units.ts).
       */
      autoUnits?: number | null;
      /**
       * 강사 보기 **빗금 칸 입력**으로 다른 선생님 교시 행에 **상태만** 옮긴 행 수(원장 2026-09-14) — 키가 있을 때만.
       * 격자는 이 값으로 칠한 값의 성격(빗금 표시 값인가)을 서버와 맞춘다(갈리면 덮개를 벗긴다).
       */
      ghostTransfer?: number;
    }
  | { error: string };

/**
 * 즉석 보강(`allowMakeup`)의 학생·반이 **이 지점에** 있는가(결정 #5 ②). `attendance_records`의 FK는 학생·반 id만 묶고
 * 지점은 안 묶어서, 확인 없이 쓰면 다른 지점 학생을 가리키는 기록이 생길 수 있다. 조회 실패는 throw(호출부 `settle`).
 */
async function instantMakeupTargetsOk(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  studentId: string,
  classId: string,
): Promise<boolean> {
  if (!isUuid(studentId) || !isUuid(classId)) return false;
  const [st, cl] = await Promise.all([
    supabase.from("students").select("*", { count: "exact", head: true }).eq("id", studentId).eq("tenant_id", tenantId),
    supabase.from("classes").select("*", { count: "exact", head: true }).eq("id", classId).eq("tenant_id", tenantId),
  ]);
  if (st.error || cl.error) throw st.error ?? cl.error;
  return (st.count ?? 0) > 0 && (cl.count ?? 0) > 0;
}

/**
 * 매트릭스 인라인 셀 1건 출결 토글 — 페이지 이동 없이 빠르게 찍는다(반응속도 1순위).
 * status=null 이면 해당 셀 기록 삭제(지우기). 기존 record가 있으면 update, 없으면 insert.
 * 상세 입력폼(메모·숙제)은 별도 유지 — 여기선 상태·메모·시수만 다룬다.
 */
export async function setAttendanceCell(input: {
  studentId: string;
  classId: string;
  sessionDate: string;
  status: Status | null;
  note?: string | null; // 전달 시 메모도 갱신(undefined면 기존 메모 유지)
  units?: string; // 전달 시 시수도 갱신(raw 입력 — 서버에서 파싱, ""=기본 1). undefined면 기존 유지.
  /**
   * 교시(0196a, "HH:MM[:SS]") — **넘기면 그 교시 한 칸만** 읽고 쓴다(ECS: 같은 날 4교시·6교시가
   * 서로 다른 기록). 안 넘기면(출석부·원스크린·키오스크) 종전대로 **그날 전체**를 다룬다.
   *
   * ⚠️ 안 넘긴 저장이 교시별 기록을 만난 경우: 그날의 **교시별 유효행을 전부** 같은 상태로 고친다.
   *    (a) 최신 1건만 고치면 같은 날 다른 교시가 조용히 옛 상태로 남아 화면마다 다른 답이 되고,
   *    (b) 새 null 행을 하나 더 만들면 "그날 전체" 1건 + 교시별 N건이 함께 살아 **시수가 이중 계상**된다.
   *    출석부에서 하루를 통째로 바꾸는 건 "그날 수업 전부 그렇다"는 뜻이므로 (전부 고치기)가 맞다.
   */
  slotStart?: string | null;
  /**
   * 화면 교시("HH:MM") — **저장 축과 다를 수 있다**(수학은 saveSlot=null).
   * 데스크 10분 판정·교차 알림이 이 시각을 본다. 안 넘기면 그날 가장 이른 교시.
   */
  periodStart?: string | null;
  /**
   * 메모만 고친다 — 상태·시수는 **읽지도 쓰지도 않는다**.
   * 🔴 이 경로만 7일 편집창을 면제한다(원장 2026-08-06: "메모는 언제든 추가할 수 있어야"). 근거는
   *    메모가 **돈에 안 닿는다**는 것 — 시수·출석률은 그대로라 마감한 급여·청구가 흔들리지 않는다.
   *    담당 반·수강생 게이트는 그대로 받는다(면제는 '기간'뿐이다).
   * ⚠️ 기록이 없는 칸엔 만들지 않는다 — 메모를 붙이려고 없는 출결을 지어내는 게 된다.
   */
  noteOnly?: boolean;
  /** 화면 갱신 생략 — 출석부 시트가 입력이 멎은 뒤 한 번만 새로고침한다(키 입력마다 재조회 방지). */
  quiet?: boolean;
  /**
   * 비파괴 쓰기 — **클라 화면이 "기록 없음"이라 믿고** 만드는 첫 체크에서 켠다(원스크린 알약).
   * 서버에 이미 그날(그 교시) 기록이 있으면 덮지 않고 `conflict`로 현재 상태를 돌려준다.
   * 🔴 이유(2026-08-17 적대 감사 P0-1): 원스크린은 출결을 재폴링하지 않아, 강사가 페이지를 열어 둔 사이
   *    데스크가 찍은 결석이 화면엔 안 보인다. 그 상태에서 발송 게이트가 "출결 입력 필요"를 띄우면
   *    강사의 출석 클릭이 **데스크의 결석을 통보 없이 뒤집는다** — 일괄의 fillEmptyOnly와 같은 의미론의
   *    단건판으로 그 덮어쓰기를 서버에서 끊는다. 화면이 기록을 **보여주고 있는** 상태에서의 변경(정정)은
   *    이 플래그 없이 와서 종전대로 덮는다(그건 의도된 편집이다).
   */
  onlyIfEmpty?: boolean;
  /**
   * `"live"` = 당일 출결 화면. 데스크 게이트(10분 후 미출결만·삭제 금지)를 켠다.
   * 없으면 종전 권한 — 월간 격자·원스크린·시트가 정정·삭제를 그대로 한다.
   * `recorded_via` 스탬프는 이 값과 무관하게 항상 남긴다.
   */
  source?: "live";
  /**
   * **즉석 보강** — '+ 보강 학생 추가'(ECS·원스크린·출석부, `makeup-add-flow.tsx`)만 켠다. 수강행이 없어도 그 반·날짜 칸을 연다.
   * 🔴 상태가 `makeup`인 저장에서만 듣는다(결정 #5 ②) — 그 밖(일반 저장·메모만)에서 오면 **무시**하고 서버 판정대로 간다.
   *    예전엔 어떤 상태든 이 값 하나로 수강 게이트를 넘었다(수업 나누기 칸이 `present`에 실어 보냈다 — 지금은 서버가 표를 본다).
   * 🔴 켜져 오면 서버가 학생·반이 **이 지점에 실재**하는지 확인한다(역할 무관). 담당 반·7일 창은 종전대로(강사).
   * 이미 있는 보강 칸을 고치는 건 이 플래그 없이 기존 기록으로 통과한다(정정만 — `writeEligibility`).
   */
  allowMakeup?: boolean;
  /**
   * **강사 전체 보기의 주인**(원장 제보 2026-09-11 *"새로고침하면 강제로 어떤 숫자로 롤백"*) — 그 보기의 칸은
   * 그 강사 몫 교시의 합만 보여 준다. 넘기면 그날 칸(교시 미지정)에 친 시수를 **그 강사 몫 행에만** 나눈다
   * (자리 JJ·다른 선생님 교시의 시수는 그대로).
   * 🔴 몫은 서버가 DB(반 담임·교시)로 다시 판정한다(`loadScopeFacts`·`ownsAttendanceSlot`) — 클라는 어느 보기인지만 보낸다(#77).
   * ⚠️ 상태·메모·입력자는 **다른 선생님 교시 행엔 종전대로** 가고, **자리(JJ·랩실) 행엔 안 간다**(원장 2026-09-12).
   *    지우기·메모만 저장도 이 값을 쓴다(자리 행을 남긴다). 교시를 지정한 저장(`slotStart`)엔 쓰지 않는다.
   * ⚠️ 그 강사 몫 행이 하나도 없으면(자리 JJ·남의 교시뿐인 칸) · 그 달에 그 반을 안 맡은 강사면 거절한다.
   *    담임 인계일 이전 칸은 판정에 넣지 않는다 — 그 칸은 격자가 막는다(`buildScopeOwner` 주석, 반응속도 1순위).
   */
  scopeTeacherId?: string | null;
  /**
   * 화면이 이 칸을 **빗금 칸 입력**(다른 선생님 교시에 상태만 옮기기, 원장 2026-09-14)으로 알고 보냈다 — 격자 값 `g`.
   * 🔴 표식은 권한이 아니다: 옮길지는 서버가 DB로 판정하고, 판정과 표식이 갈리면 **저장하지 않는다**(`planScopedDay` stale) —
   *    화면이 오래돼 사람이 본 칸과 지금 기록이 다르면 남의 기록(또는 제 기록)을 조용히 덮는다(적대 리뷰 2026-09-14).
   */
  ghostTransfer?: boolean;
}): Promise<CellResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const { studentId, classId, sessionDate, status } = input;
  const noteOnly = input.noteOnly === true;
  const noteProvided = input.note !== undefined;
  const noteVal = (input.note ?? "").trim() || null;
  if (!studentId || !classId || !sessionDate) return { error: "필수 값이 누락되었습니다" };
  if (noteOnly && !noteProvided) return { error: "메모가 없습니다" };
  if (!noteOnly && status !== null && !STATUSES.includes(status)) return { error: "잘못된 상태입니다" };

  const unitsProvided = input.units !== undefined;
  let unitsVal: number | null = null;
  if (unitsProvided) {
    const parsed = parseSessionUnits(input.units);
    if (!parsed.ok) return { error: parsed.error };
    unitsVal = parsed.value;
  }
  // 강사 전체 보기의 주인 — 화면은 users.id(uuid)만 보낸다. 형식이 아니면 화면이 만든 값이 아니다.
  if (input.scopeTeacherId != null && !isScopeTeacherId(input.scopeTeacherId)) {
    return { error: SCOPE_INVALID_MESSAGE };
  }

  const supabase = await createClient();
  /** 즉석 보강 — '+ 보강 학생 추가'의 `makeup` 저장일 때만(결정 #5 ②). 다른 저장의 플래그는 듣지 않는다. */
  const instantMakeup = input.allowMakeup === true && status === "makeup" && !noteOnly;
  // 학생·반이 이 지점에 있는지 — 강사 조회와 겹쳐 돌린다(B4). `settle`로 바로 감싼다(강사 게이트가 먼저 거절해도
  // 거부된 약속이 떠돌지 않게). 실패 = null → 아래에서 LOOKUP_FAILED.
  const makeupTargets = instantMakeup ? settle(instantMakeupTargetsOk(supabase, user.tenantId, studentId, classId)) : null;

  // scoped(강사) 담당 반 강제 — 원스크린 인라인 출결(2단계)이 이 액션을 재사용하면서 서버 검증 추가.
  // RLS는 tenant 격리뿐이라 여기서 막지 않으면 강사가 테넌트 내 아무 반에나 기록 가능(검수 지적).
  // full(관리자 계열·겸직 포함)은 기존대로 전 반. 담당 확인 + 수강생 확인은 독립 조회 → 병렬(B4).
  // ⚠️ 수강생 판정은 **세션 날짜 기준**(start≤date AND (end null OR end≥date)) — 출석부 매트릭스는 그 달 중
  //    수강 종료(반이동·종강)된 학생의 과거 셀도 편집을 허용하므로, end_date IS NULL 고정이면 그 교정과
  //    미래 end_date(퇴원 예정) 재원생의 오늘 출결까지 차단되는 회귀(리뷰 확정). getAttendanceInputRows와 동일 의미.
  /** 학생 자격 등급(결정 #5) — 관리자(full)는 종전대로 제한 없음. 강사(scoped)는 아래에서 정한다. */
  let cellEligibility: WriteEligibility = "create";
  /** native 조회가 실패해 "정정만"으로 내려간 경우의 사유 — 새 행이 필요해 막을 때 이 사유를 보인다. */
  let cellNativeUnknown: string | null = null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    // 🔴 강사 계정은 **자기** 출석부로만 저장한다(원장 2026-09-17 *"남의 출석부를 건드리는건 아니지"*) — 남의 id로 보기를
    //    바꿔 보내면 그 선생님 몫 행을 고치게 된다. 화면(반별·강사 보기)은 늘 본인 id를 싣는다.
    if (input.scopeTeacherId != null && input.scopeTeacherId !== user.id) return { error: SCOPE_INVALID_MESSAGE };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "잘못된 날짜입니다" }; // .or() 보간 안전
    // 7일 지난 출결은 강사가 못 고친다(원장 2026-07-21). 기준일은 항상 KST 오늘.
    // ⚠️ 단 **메모만** 고치는 저장은 면제(2026-08-06) — 시수·상태가 안 움직여 돈에 닿지 않는다.
    if (!noteOnly && !isWithinAttendanceEditWindow(sessionDate, kstToday())) {
      return { error: attendanceLockMessage(sessionDate, kstToday()) };
    }
    const cellFacts = await settle(Promise.all([
      // 담당 반 ∪ 그날 위임받은 반(0173a).
      userTaughtClassSet(supabase, user.id, sessionDate, true),
      supabase
        .from("enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .or(`start_date.is.null,start_date.lte.${sessionDate}`)
        .or(`end_date.is.null,end_date.gte.${sessionDate}`),
      // 보강으로 이미 열어 둔 칸 — 수강 게이트만 보면 ECS·원스크린에서 고칠 수 없다.
      supabase
        .from("attendance_records")
        .select("*", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("session_date", sessionDate),
    ]));
    if (!cellFacts) return { error: LOOKUP_FAILED };
    const [teaching, { count: enrolled }, { count: existing }] = cellFacts;
    if (!teaching.has(classId)) return { error: "담당 반이 아닙니다" };
    const isEnrolled = (enrolled ?? 0) > 0;
    const hasRecord = (existing ?? 0) > 0;
    // 새 행의 근거(보강 예약·수업 나누기·native)는 수강생이 아닐 때만 묻는다(수강생이면 왕복 0). 🔴 기존 기록이 있어도 묻는다 —
    // 기록만으로는 **정정만** 허가된다(결정 #5). 예전엔 기록이 있으면 묻지 않아 예약 학생도 "기록만"으로 분류될 수 있었다.
    // 판정은 서버가 표를 직접 본다(클라 플래그가 아니라, #77).
    let reserved = false;
    let splitInto = false;
    let native = false;
    let nativeUnknown: string | null = null;
    if (!isEnrolled && !instantMakeup) {
      [reserved, splitInto] = await Promise.all([
        hasReservedMakeup(user.tenantId, { studentId, classId, date: sessionDate }),
        hasSplitInto(classId, studentId, sessionDate),
      ]);
      if (!reserved && !splitInto) {
        const n = await nativeWriteAllowance({ studentId, classId, sessionDate });
        // 조회 실패는 새 행이 필요할 때만 막는다 — 기록이 있으면 정정은 native 여부와 무관하다(메모·지우기·상태 정정, 4-2 리뷰).
        if (n.error && !hasRecord) return { error: n.error };
        nativeUnknown = n.error;
        native = n.allow;
      }
    }
    // 즉석 보강은 새 행까지 — 학생·반 실재는 아래 `makeupTargets`가, 담당 반·7일 창은 위가 이미 봤다(결정 #5 ②).
    cellEligibility = instantMakeup
      ? "create"
      : writeEligibility({ enrolled: isEnrolled, reserved, splitInto, native, hasRecord });
    if (cellEligibility === "none") return { error: "이 반 수강생이 아닙니다" };
    cellNativeUnknown = nativeUnknown;
  }
  if (makeupTargets) {
    const ok = await makeupTargets;
    if (ok === null) return { error: LOOKUP_FAILED };
    if (!ok) return { error: "보강할 학생이나 반을 찾지 못했습니다" };
  }

  // 메모만 — 있는 기록의 note만 갈아끼운다. 🔴 **지우기 분기보다 먼저** 온다(status가 null로 와도
  // 기록을 지우면 안 된다). 상태·시수는 patch에 넣지 않는다 = 급여 재료 불변.
  // ⚠️ `recorded_by`/`recorded_at`도 안 건드린다 — 그건 "누가 출결을 찍었나"라 메모 수정으로 덮으면 사실이 바뀐다.
  // 교시 지정(0196a) — 넘어온 값만 그 교시로 좁힌다. `slot`은 아래 세 경로가 공유한다.
  const slot = input.slotStart ?? null;
  const periodStart = input.periodStart ?? slot;
  const via = await settle(resolveWriteVia(supabase, user.id, classId, sessionDate));
  if (!via) return { error: LOOKUP_FAILED };
  /**
   * 강사 전체 보기에서 온 **그날 칸** 저장이면 그 강사 id — 시수를 그 강사 몫 행에만 나누고(원장 제보 2026-09-11),
   * **자리(JJ·랩실) 행은 아예 안 쓴다**(원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."* — 메모만·지우기·쓰기 전부).
   * ⚠️ 교시를 지정한 저장(ECS)엔 뜻이 없다 — 대상이 그 한 교시라 나눌 것도 뺄 것도 없다. 그래서 받지 않는다(종전 그대로).
   */
  const scopeTeacherId = slot === null ? (input.scopeTeacherId ?? null) : null;
  // 판정 재료(반 담임·교시) — 못 읽으면 null(아래 `scopeShareOf`가 저장을 거절한다: 모르는 채로 쓰거나 지우지 않는다).
  const loadCellScopeFacts = () =>
    loadScopeFacts(supabase, [{ classId, date: sessionDate }]).catch((e: unknown) => {
      console.error("[attendance] 강사 보기 판정 재료 조회 실패 — 저장하지 않습니다:", e);
      return null;
    });
  /** 재료 → 판정기(자기 몫·자리·그 밖), 또는 거절 문장 — 세 갈래(메모만·지우기·쓰기)가 같은 문장으로 거절한다. */
  const scopeShareOf = (
    teacherId: string,
    facts: Awaited<ReturnType<typeof loadCellScopeFacts>>,
  ): { share: ScopeShare } | { error: string } => {
    // 🔴 몫을 못 가리면 저장하지 않는다 — 모르는 채로 쓰면 남의 교시로 시수가 새고 자리 행을 덮는 바로 그 버그가 난다.
    if (!facts) return { error: SCOPE_LOAD_FAILED_MESSAGE };
    // 그 달에 이 반을 안 맡은 강사의 보기에서 온 저장 — 화면이 오래됐다(반 배치가 바뀌었다).
    if (!scopeTeaches(facts.get(classId), teacherId, sessionDate)) return { error: SCOPE_NOT_TAUGHT_MESSAGE };
    // ⚠️ **날짜로는 거절하지 않는다** — 보강은 원래 수업 요일이 아닌 날에도 한다(원장 2026-09-17 저녁 *"다른 요일도 보강 등으로
    //    수업할 수 있으니까 숫자 입력가능하게"*). 그 대신 몫(`buildScopeShare`)이 남의 교시·자리 행을 쓰기 대상에서 뺀다.
    return { share: buildScopeShare({ teacherId, facts }) };
  };
  /** 강사 보기 칸의 그날 행(정정 이력 포함, 최근 입력 먼저) + 판정기 — 메모만·지우기 갈래가 쓴다(두 조회 병렬, B4). */
  const loadScopedDay = async (
    teacherId: string,
  ): Promise<{ error: string } | { rows: (DayTargetRow & { note?: string | null })[]; share: ScopeShare }> => {
    // 대신 보강 귀속(0316a) — 칸이 있을 때만(#95). 반 담임 보기 저장이 남의 대신 보강 칸을 제 몫으로 덮지 않게.
    const withTaughtBy = await taughtByColumnReady().catch(() => false);
    const [{ data, error }, facts] = await Promise.all([
      supabase
        .from("attendance_records")
        // recorded_via = 자리 문 표식(0212a) — JJ는 `seat_label`이 없어 이게 유일한 자리 근거일 수 있다.
        // note = 메모만 저장이 **화면이 보여 준 메모의 행**을 고르는 재료(`noteTargetRow`, 적대 재리뷰 2026-09-14).
        .select((withTaughtBy ? "id, slot_start, seat_label, recorded_via, note, taught_by" : "id, slot_start, seat_label, recorded_via, note") as "id, slot_start, seat_label, recorded_via, note")
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("session_date", sessionDate)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false }),
      loadCellScopeFacts(),
    ]);
    // 확인 실패 = 안 쓴다 — 어느 행이 자리인지 모르는 채로 지우거나 메모를 달지 않는다.
    // 🔴 DB 오류 **원문(영문)을 화면에 내보내지 않는다**(CLAUDE.md raw 노출 금지) — 재료 조회 실패와 같은 한글 문장으로.
    //    원문은 서버 로그에만 남긴다.
    if (error) {
      console.error("[attendance] 강사 보기 그날 행 조회 실패 — 저장하지 않습니다:", error.message);
      return { error: SCOPE_LOAD_FAILED_MESSAGE };
    }
    const gate = scopeShareOf(teacherId, facts);
    if ("error" in gate) return gate;
    return { rows: (data ?? []) as (DayTargetRow & { note?: string | null })[], share: gate.share };
  };
  /** 판정기 → "이 행이 자리(JJ·랩실)인가" — `splitOutSeatRows`에 넘긴다. */
  const seatOf = (share: ScopeShare) => (r: DayTargetRow) => share(classId, sessionDate, r) === "seat";
  const ownerOf = (share: ScopeShare) => (r: DayTargetRow) => share(classId, sessionDate, r) === "mine";

  if (noteOnly) {
    let rowId: string | null = null;
    /** 함께 고칠 행(같은 메모 글자 — `sameNoteRows`). 비면 `rowId` 한 행. */
    let rowIds: string[] = [];
    // 강사 보기가 손대지 않고 둔 자리 행 수 — 감사로그(역검수)용.
    let skippedSeatRows = 0;
    if (scopeTeacherId) {
      /**
       * 🔴 강사 보기의 메모(잠긴 칸) — 자리(JJ·랩실) 행에 달지 않는다(원장 2026-09-12). 종전 규약("그날 가장 최근 행")
       *    본인 교시가 있으면 그 교시의 메모만 고친다.
       */
      const day = await loadScopedDay(scopeTeacherId);
      if ("error" in day) return day;
      // 넘겨받은 JJ실 시수가 있는 칸 — 값과 같은 이유로 메모도 고치지 않는다(화면은 그 행의 메모를 칸 메모로 보여 주는데
      // 저장은 자리 행을 건드리지 않아, 고쳐도 옛 메모가 그대로 보이거나 "기록이 없어…"라는 엉뚱한 안내가 나간다).
      if (day.rows.some((r) => day.share.takenSeat?.(classId, sessionDate, r) === true)) return { error: SCOPED_REJECT_MESSAGE.seatTaken };
      const { write, seat } = splitOutSeatRows(day.rows, seatOf(day.share), ownerOf(day.share));
      // 🔴 메모는 **제 교시 행에만** 단다(원장 2026-09-17 *"남의 출석부를 건드리는건 아니지"*) — 제 몫 행이 없으면
      //    (남의 교시·자리 기록뿐) 메모를 달 제 기록이 없다: 아래 "먼저 출결을 입력하세요"로 안내한다.
      const mineRows = write.filter((r) => day.share(classId, sessionDate, r) === "mine");
      // 🔴 고칠 행 = 화면이 그 메모를 보여 준 행(교시별 최신 제 몫 중 사유 있는 메모 우선 — 조회와 같은 규칙).
      //    같은 시각 여러 행이 `대신 입력` 줄을 가지면 가장 최근 1행에 쓸 때 보이는 사유는 그대로이고 그 줄만
      //    지워졌다(적대 재리뷰 2026-09-14). 메모가 하나도 없으면 종전대로 가장 최근 행이다.
      const latest = new Set(pickSaveTargets(mineRows, null).updateIds);
      const candidates = mineRows.filter((r) => latest.has(r.id));
      const chosen = noteTargetRow(candidates);
      rowId = chosen?.id ?? null;
      rowIds = sameNoteRows(candidates, chosen).map((r) => r.id);
      skippedSeatRows = seat.length;
    } else if (slot === null) {
      // 반별 보기의 그날 칸 — 위와 같은 규칙(전 행이 그 반 몫). 교시가 여럿이라 행을 받아 고른다(하루 서너 행).
      const { data: dayRows } = await supabase
        .from("attendance_records")
        .select("id, slot_start, note")
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("session_date", sessionDate)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: false });
      const list = (dayRows ?? []) as { id: string; slot_start: string | null; note: string | null }[];
      const latest = new Set(pickSaveTargets(list, null).updateIds);
      const candidates = list.filter((r) => latest.has(r.id));
      const chosen = noteTargetRow(candidates);
      rowId = chosen?.id ?? null;
      rowIds = sameNoteRows(candidates, chosen).map((r) => r.id);
    } else {
      let q = supabase
        .from("attendance_records")
        .select("id")
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("session_date", sessionDate);
      // 교시 지정 메모(ECS) — 그 교시의 최신 1행(종전 그대로).
      q = q.eq("slot_start", slot);
      const { data: row } = await q
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      rowId = (row?.id as string | undefined) ?? null;
    }
    if (!rowId) return { error: "그날 출결 기록이 없어 메모만 남길 수 없습니다 — 먼저 출결을 입력하세요" };
    const { error } =
      rowIds.length > 1
        ? await supabase.from("attendance_records").update({ note: noteVal }).in("id", rowIds)
        : await supabase.from("attendance_records").update({ note: noteVal }).eq("id", rowId);
    if (error) return { error: attendanceDbWhy(error, "attendance.cell.note") };
    /**
     * 감사로그 — 이 경로만 **7일 편집창을 면제**받는다(원장 2026-08-06). 면제된 문은 언제 열렸는지가
     * 남아야 하므로 상태 변경과 같은 급으로 기록한다.
     * 🔴 메모 **본문은 싣지 않는다** — 결석 사유엔 병원·가정사가 그대로 적힌다. 비웠는지 채웠는지만.
     */
    await logAction({
      action: "attendance_note",
      targetType: "attendance",
      metadata: {
        studentId,
        classId,
        date: sessionDate,
        ...(slot ? { slotStart: slot } : {}),
        cleared: noteVal === null,
        // 강사 전체 보기에서 온 메모 — 자리(JJ·랩실) 행은 후보에서 뺐다(원장 2026-09-12).
        ...(scopeTeacherId ? { scopeTeacherId } : {}),
        ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}),
        ...backdatedFlag([sessionDate], kstToday()),
      },
    });
    if (!input.quiet) revalidateAttendanceSurfaces();
    return { ok: true };
  }

  // 지우기 — 해당 (반·학생·날짜) 기록 삭제. 교시를 넘겼으면 **그 교시만**(다른 교시 기록은 남는다).
  if (status === null) {
    // 당일 출결 화면만 데스크 삭제를 막는다. 월간 격자의 오클릭 되돌리기는 여기로 온다(#103).
    const deskGate = await assertDeskMayWrite({
      supabase,
      via,
      classId,
      date: sessionDate,
      periodStart,
      currentStatus: "present",
      nextStatus: null,
      source: input.source,
    });
    if ("error" in deskGate) return deskGate;
    // 🔴 보강 보고서가 가리키는 반(앵커)의 칸은 지우지 않는다(원장 2026-09-30 *"보고서 반 = 출석부 반"*, 설계 g) — 지우면 보고서는
    //    이 반을 가리키는데 출석부엔 칸이 없어 둘이 갈린다. 반을 바꾸려면 원스크린 '보강 반 바꾸기'(칸도 함께 옮긴다)·'보강 빼기'.
    //    예외 = **학부모에게 발송된** 보강 보고서의 칸은 지운다 · 보고서는 그대로(원장 2026-11-05 — 급여 시수를 바로잡는 길).
    const anchorCheck = await makeupAnchorDeleteCheck(user.tenantId, [{ studentId, classId, date: sessionDate }], { allowSent: true });
    if (anchorCheck.block) return { error: anchorCheck.block };
    // 발송된 보강 보고서의 칸 — 지운 뒤 보강 예약 되돌림을 건너뛰고(예약은 '완료' 그대로), 행을 실제로 지웠을 때만 감사로그에 적는다.
    const keptSentCell = anchorCheck.keptCells.has(anchorCellKey({ studentId, classId, date: sessionDate }));
    let clearedRows = false;
    // 강사 보기가 손대지 않고 남긴 자리(JJ·랩실) 행 수 — 감사로그(역검수)용.
    let skippedSeatRows = 0;
    if (scopeTeacherId) {
      /**
       * 🔴 강사 보기의 지우기 — **자리(JJ·랩실) 행은 남긴다**(원장 2026-09-12). (반·학생·날짜)로 칸을 통째로 지우면
       *    자리 담당이 JJ실에서 찍은 기록까지 사라진다. 그래서 그날 행(정정 이력 포함)을 받아 **자리 아닌 행만** id로 지운다.
       * 본인 교시만 지우므로 다른 교시가 있는 칸도 이 화면에서 지울 수 있다.
       * ⚠️ 제 몫 행이 하나도 없는 칸(빗금 칸)의 지우기는 쓰기와 **같은 판정**(`planScopedDay`)으로 거절한다 — 자리뿐이면
       *    자리 사유, 다른 선생님 교시 기록이면 남의 기록 삭제라서(원장 2026-09-14 기본값 — 입력만 열고 지우기는 막는다).
       */
      const day = await loadScopedDay(scopeTeacherId);
      if ("error" in day) return day;
      const byId = new Map(day.rows.map((r) => [r.id, r]));
      const plan = planScopedDay({
        // 그날 교시별 최신 행 = 화면이 값으로 세는 행(쓰기 갈래와 같은 대상 선정).
        targets: pickSaveTargets(day.rows, null).updateIds.map((id) => byId.get(id)!),
        share: (r) => day.share(classId, sessionDate, r),
        clearing: true,
        taken: (r) => day.share.takenSeat?.(classId, sessionDate, r) === true,
      });
      if (plan.kind === "reject") return { error: SCOPED_REJECT_MESSAGE[plan.reason] };
      // 🔴 지울 제 기록이 없다(남의 교시·자리 기록뿐) — 남의 기록은 지우지 않고, 빈칸을 지운 것이라 조용히 끝낸다(2026-09-17).
      if (plan.kind === "skip") return { ok: true };
      const { write, seat } = splitOutSeatRows(day.rows, seatOf(day.share), ownerOf(day.share));
      skippedSeatRows = seat.length;
      if (write.length > 0) {
        const { error } = await supabase
          .from("attendance_records")
          .delete()
          .in(
            "id",
            write.map((r) => r.id),
          );
        if (error) return { error: attendanceDbWhy(error, "attendance.cell.update") };
        clearedRows = true;
      }
    } else {
      let del = supabase
        .from("attendance_records")
        .delete({ count: "exact" })
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .eq("session_date", sessionDate);
      if (slot !== null) del = del.eq("slot_start", slot);
      const { error, count } = await del;
      if (error) return { error: attendanceDbWhy(error, "attendance.cell.clear", "delete") };
      clearedRows = (count ?? 0) > 0;
    }
    /**
     * 감사로그 — **지우기가 이 파일에서 가장 값진 줄**이다. 출결 행은 스스로 `recorded_by`·`recorded_at`을
     * 담고 있어 "누가 찍었나"는 행만 봐도 되지만, 지우면 그 증거가 행과 **함께** 사라진다(2026-08-18
     * 소급 퇴원 사고가 커진 것과 같은 모양). 여기 남기지 않으면 되짚을 자리가 0이다.
     */
    await logAction({
      action: "attendance_clear",
      targetType: "attendance",
      metadata: {
        studentId,
        classId,
        date: sessionDate,
        ...(slot ? { slotStart: slot } : {}),
        // 강사 전체 보기에서 온 지우기 — 자리(JJ·랩실) 행은 남겼다(원장 2026-09-12).
        ...(scopeTeacherId ? { scopeTeacherId } : {}),
        ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}),
        ...(input.source ? { source: input.source } : {}),
        // 발송된 보강 보고서의 칸을 지웠다 — 보고서는 그대로 두었다(원장 2026-11-05).
        ...(keptSentCell && clearedRows ? { keptSentMakeupReports: 1 } : {}),
        ...backdatedFlag([sessionDate], kstToday()),
      },
    });
    // 보강 예약 되돌림(0264a) — 이행된 예약의 보강일 칸을 지웠으면 예약을 `reserved`로 되돌린다(fail-soft).
    // 🔴 발송된 보강 보고서의 칸은 건너뛴다 — 보강은 했고 보고서도 나갔다. 되돌리면 결석 메모가 '보강 예정'으로 바뀌고 원스크린이
    //    '보강 진행 여부 확인'을 띄워, 그걸 누르면 지운 칸이 다시 생긴다(적대 리뷰 2026-11-05). 예약 연결은 DB가 null로 푼다(on delete set null).
    if (!keptSentCell) {
      await completeMakeupReservations({ tenantId: user.tenantId }, [{ studentId, classId, date: sessionDate, status: null }]);
    }
    if (!input.quiet) revalidateAttendanceSurfaces();
    return { ok: true };
  }

  // 그날(또는 그 교시)의 기록을 훑는다 — append-only라 정정 이력이 함께 나오므로 **교시별 최신 1건**만
  // 유효행으로 고른다(effectiveAttendanceRecords와 같은 규칙: recorded_at 최신, 동률이면 id 큰 쪽).
  // 🔴 교시를 넘겼어도 **"그날 전체"(slot_start null) 행까지 함께** 본다. 두 세대가 공존하기 때문이다
  //    (실측 2026-08-14: 영어도 day-level 20행이 남아 있다). 그 교시만 조회하면 옛 day-level 행을
  //    못 보고 새 행을 INSERT해 **같은 (학생·반·날짜)에 두 행이 살아남는다** — 화면은 교시 우선이라
  //    멀쩡해 보이지만 급여·시수는 두 행을 다 합산해서, 정정이 돈에 반영되지 않거나 이중 계상된다.
  // 그날 기록과 스코프 판정 재료(반 담임·교시)는 서로 독립이라 병렬(B4).
  // 대신 보강 귀속(0316a) — 강사 보기 저장의 몫 판정 재료. 칸이 있을 때만 읽는다(#95).
  const cellTaughtBy = scopeTeacherId ? await taughtByColumnReady().catch(() => false) : false;
  const [{ data: rows }, scopeFacts] = await Promise.all([
    supabase
      .from("attendance_records")
      // seat_label = 자리 시수 행(0208a) · recorded_via = 자리 문 표식(0212a, JJ는 라벨이 없다) —
      // 강사 보기의 몫 판정(`ownsAttendanceSlot`)이 두 표식을 함께 본다.
      .select(
        (cellTaughtBy ? "id, slot_start, seat_label, recorded_via, recorded_at, status, note, session_units, taught_by" : "id, slot_start, seat_label, recorded_via, recorded_at, status, note, session_units") as "id, slot_start, seat_label, recorded_via, recorded_at, status, note, session_units",
      )
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("session_date", sessionDate)
      .order("recorded_at", { ascending: false })
      // id desc = recorded_at 동률 tie-break — 로스터·발송 게이트·effective-records와 같은 규약.
      // 없으면 동시각 중복 행에서 pickSaveTargets의 "처음 만난 행이 최신" 전제가 다른 행을 고른다.
      .order("id", { ascending: false }),
    scopeTeacherId ? loadCellScopeFacts() : null,
  ]);
  // 강사 보기 — 판정기(자기 몫·자리·그 밖)를 세운다. 재료를 못 읽었거나 그 달에 이 반을 안 맡으면 거절한다.
  const gate = scopeTeacherId ? scopeShareOf(scopeTeacherId, scopeFacts) : null;
  if (gate && "error" in gate) return gate;
  const share = gate ? gate.share : null;

  // 대상 선정은 순수 규칙 **한 곳**(pickSaveTargets)이 정한다 — 일괄 저장도 같은 함수를 쓴다.
  // 이미 recorded_at 내림차순이라 "교시마다 처음 만난 행이 최신"이라는 그 함수의 전제를 만족한다.
  const { updateIds, promoteIds } = pickSaveTargets(rows ?? [], slot);
  const rowById = new Map((rows ?? []).map((r) => [r.id as string, r]));
  /** 저장 대상 행의 판정 재료(교시·자리 표식) — 시수 배분과 자리 빼기가 **같은 모양**을 쓴다. */
  const dayTargets: DayTargetRow[] = updateIds.map((id) => ({
    id,
    slot_start: (rowById.get(id)?.slot_start as string | null | undefined) ?? null,
    seat_label: (rowById.get(id)?.seat_label as string | null | undefined) ?? null,
    recorded_via: (rowById.get(id)?.recorded_via as string | null | undefined) ?? null,
    taught_by: ((rowById.get(id) as { taught_by?: string | null } | undefined)?.taught_by as string | null | undefined) ?? null,
  }));
  /**
   * 🔴 강사 보기 저장은 자리(JJ·랩실) 행을 **안 쓴다** — 상태·메모·입력자·시수 전부(원장 2026-09-12).
   * ⚠️ 빗금 칸 거절(noneOwned)은 아래에서 **원래 대상**(`updateIds`)으로 판정한다 — 여기서 먼저 빼 버리면
   *    자리 행만 있는 칸이 "행 없음"이 되어 새 행을 만든다(`splitOutSeatRows` 주석).
   */
  const split = splitOutSeatRows(dayTargets, share ? seatOf(share) : null, share ? ownerOf(share) : null);
  const seatTargets = split.seat;
  /**
   * 🔴 빗금 칸 입력(원장 2026-09-14 *"그냥 그 날의 해당 담당 출석으로 전부 이전시켜. 다른 사람이 대신 찍었어도."*) — 제 몫
   *    행이 없고 다른 선생님 교시 행이 있으면 그 행들에 **상태만** 쓴다(시수 불변 · 메모 끝에 `대신 입력` 한 줄). 자리뿐이면 거절.
   * ⚠️ 판정 대상은 `dayTargets`(교시별 최신 = 화면이 값으로 세는 행). 쓰는 행은 위 `writeTargets`와 **같은 집합**이다
   *    (제 몫이 0이니 자리를 빼고 남는 건 다른 선생님 교시뿐) — 그래서 대상 선정은 종전 그대로 두고 patch만 갈린다.
   * ⚠️ 몫은 서버가 DB로 다시 판정한다(#77) — 화면(`ghostCellKind`)과 갈리면 격자가 응답의 `ghostTransfer`로 덮개를 맞춘다.
   */
  const scopedPlan = share
    ? planScopedDay({
        targets: dayTargets,
        share: (r) => share(classId, sessionDate, r),
        clearing: false,
        ghostIntent: input.ghostTransfer === true,
        taken: (r) => share.takenSeat?.(classId, sessionDate, r) === true,
      })
    : null;
  if (scopedPlan?.kind === "reject") return { error: SCOPED_REJECT_MESSAGE[scopedPlan.reason] };
  const transfer = scopedPlan?.kind === "transfer";
  /**
   * 🔴 제 몫 행이 없는 칸(남의 교시·자리 기록뿐) — 그 행들은 **한 글자도 안 건드리고** 제 교시 행을 새로 만든다(원장 2026-09-17
   *    *"내 출석부에서 고치는건데 남의 출석부를 건드리는건 아니지. 그냥 내 출석부 상에서 자유롭게 숫자 설정만 하는거야."*).
   *    종전엔 자리뿐이면 거절, 남의 기록뿐이면 '화면이 오래됐다'로 거절해 그 칸은 이 보기에서 입력할 수 없었다.
   */
  const createOwn = scopedPlan?.kind === "create";
  const writeTargets = createOwn ? [] : split.write;
  const writeIds = writeTargets.map((r) => r.id);
  // 상태·입력자를 실제로 받는 행 = 자리를 뺀 그날 교시 + 승격 대상. 이전 상태(감사로그·교차 알림)도 이 행에서 읽는다.
  const targetIdSet = new Set(createOwn ? [] : [...writeIds, ...promoteIds]);
  const prevRow = (rows ?? []).find((r) => targetIdSet.has(r.id as string));
  const prevStatus = prevRow?.status ?? null;

  // 비파괴 요청인데 기록이 이미 있다 — 아무것도 쓰지 않고 현재 진실을 돌려준다(위 onlyIfEmpty 주석).
  if (input.onlyIfEmpty && prevRow) {
    return {
      ok: true,
      conflict: {
        status: prevRow.status as string,
        note: (prevRow.note as string | null) ?? null,
        units: (prevRow.session_units as number | string | null) ?? null,
      },
    };
  }

  const deskGate = await assertDeskMayWrite({
    supabase,
    via,
    classId,
    date: sessionDate,
    periodStart,
    currentStatus: prevStatus,
    nextStatus: status,
    source: input.source,
  });
  if ("error" in deskGate) return deskGate;

  const nowIso = new Date().toISOString();
  /**
   * 감사로그 "시수 3 → 1.5"(원장 2026-09-14 *"값을 얼마에서 얼마로 바꿨는지"*) — 값은 아래 저장 분기가
   * **실제로 시수를 정한 행**에서 잰다([`unitsAuditFields`](../units-audit.ts)). 규칙이 셋이라 인라인으로 두지 않았다:
   *   ① 결석 행은 **0**으로 센다(화면 `rollupDay`가 보여 주는 값) ② 합은 0.1로 반올림한다(부동소수 꼬리)
   *   ③ 교시 지정 저장(ECS)의 대상 둘은 "그 교시 + 옛 그날 전체 행" = **같은 한 수업**이라 더하지 않는다.
   * 셋 다 적대 리뷰 2026-09-14가 잡은 것 — 초안은 행 값을 그대로 더해 화면에 없는 숫자를 로그에 남겼다.
   */
  let unitsAudit: UnitsAudit = null;
  // 감사로그용 — 아래 분기가 id 목록을 소비하기 전에 **덮어쓰기였는지**를 굳혀 둔다.
  const overwrote = !createOwn && (updateIds.length > 0 || promoteIds.length > 0);
  // 기록만으로 허가된 학생(정정만)은 새 행을 만들지 않는다 — 다른 교시로 번지지 않게(결정 #5).
  if (blockedByCorrectOnly(cellEligibility, !overwrote)) return { error: cellNativeUnknown ?? CORRECT_ONLY_MESSAGE };
  /** 새 행 + 숫자 안 고른 저장이면 실제로 넣은 시수(null = 1), 아니면 undefined — 수학 자동 시수(auto-units.ts). */
  let insertedAuto: number | null | undefined;
  /** 빗금 칸 입력으로 실제로 상태를 옮긴 행 수 — 응답·감사로그가 계획이 아니라 이 숫자를 쓴다. */
  let ghostWritten = 0;
  /** 강사 보기에서 새로 만든 제 교시 행의 시각(나눠 맡는 날) — 감사로그용. 그날 전체 한 행이면 undefined. */
  let createdSlots: string[] | undefined;
  /** 새 제 교시 행 여러 개에 기본 시수(교시마다 1)를 넣었을 때 칸에 보일 합 — 격자 낙관값을 맞춘다. */
  let createdDefaultTotal: number | undefined;
  /** 나눠 맡는 날이면 새로 만들 제 교시 — 새 행 갈래에서만 쓴다(판정은 받아 둔 재료로, 추가 조회 없음). */
  const ownInsertSlots =
    !overwrote && share && scopeTeacherId ? scopeInsertSlots(scopeFacts?.get(classId), scopeTeacherId, sessionDate) : null;
  if (overwrote) {
    const patch: Record<string, unknown> = withVia(
      { status, recorded_by: user.id, recorded_at: nowIso },
      via,
    );
    if (noteProvided) patch.note = noteVal;
    /**
     * 🔴 **그날 칸(교시 미지정)에 명시한 시수는 그날 합계다**(원장 2026-09-01 확정) — 교시가 여럿이면
     *    같은 값을 교시마다 쓰면 안 된다. 화면 숫자가 교시 **합**이라(`rollupDay`) 교시 수만큼 부풀고,
     *    그 값이 급여·회차 소비로 흘러간다(실측: 3교시 반에 4를 친 칸이 12로 저장·표시).
     *    → 교시별로 **나눠 담아** 합이 정확히 친 숫자가 되게 한다(배분 규칙 = `planDayCellUnits` 한 곳, 범위 저장도 같은 함수).
     * 🔴 **강사 전체 보기에서 온 저장은 그 강사 몫 행에만 나눈다**(원장 제보 2026-09-11 *"새로고침하면 강제로
     *    어떤 숫자로 롤백"*) — 그 보기의 칸은 제 몫 교시의 합만 보여 주는데, 그날 모든 교시(자리 JJ·다른
     *    선생님)에 나누면 다시 읽을 때 숫자가 준다(4 → 2.7). 상태·시수·메모 모두 본인 교시만 받는다.
     * ⚠️ 나누는 건 **그날 칸(slot === null)일 때뿐**이다. 교시를 지정한 저장(ECS)의 대상 2건은
     *    "그 교시 + 옛 day-level 행"이라 **같은 한 수업**이다 — 거기서 나누면 진짜로 반이 된다.
     * 명시한 "1"도 합계 1로 배분한다. 숫자를 입력하지 않은 기본값만 교시별 기본을 쓴다.
     */
    let dayPlan: DayUnitsPlan | null = null;
    // 빗금 칸 입력은 시수 계획이 없다(상태만 — 원장 결정 ①). 나누면 남의 교시 시수를 이 표 몫처럼 덮어쓴다.
    // (제 행을 새로 만드는 칸 `createOwn`은 이 갈래에 오지 않는다 — `overwrote`가 false다.)
    if (slot === null && !transfer) {
      // 판정기는 받아 둔 재료로만 만든다 — 추가 조회 없음(담임 시작일은 안 읽는다, `buildScopeOwner` 주석).
      dayPlan = planDayCellUnits({
        targets: dayTargets,
        owns: share ? (r) => share(classId, sessionDate, r) === "mine" : null,
        unitsVal: unitsProvided ? unitsVal ?? (isDefaultUnitsRaw(input.units) ? null : 1) : undefined,
      });
      if (!dayPlan.ok) {
        // 강사 보기에서 그 강사 몫 행이 없다 = 화면의 빗금 칸 — 격자가 하는 말과 같은 문장으로 거절한다.
        if (dayPlan.reason === "noneOwned") return { error: NOT_MINE_MESSAGE };
        // 교시당 0.1도 안 되게 잘게 쪼개야 하는 값 — 값을 지어내지 않고 사유를 돌려준다.
        return {
          error: `이 날은 교시가 ${dayPlan.slots}개라 시수 ${unitsVal}을(를) 교시별로 나눌 수 없습니다 — 더 큰 값을 넣거나 교시별로 입력해 주세요.`,
        };
      }
    } else if (slot !== null && unitsProvided) {
      // 교시 지정 저장(ECS) — 대상이 같은 한 수업이라 친 값 그대로(종전과 같다).
      // 🔴 `slot !== null`을 명시한다 — 빗금 칸 입력(그날 칸 · 위 갈래를 건너뜀)이 여기로 떨어지면 남의 교시 시수를 덮는다.
      patch.session_units = unitsVal;
    }
    /**
     * 감사로그용 전·후 — **이 저장이 시수를 정한 행**에서만 잰다(위 `unitsAudit` 주석).
     * 🔴 그날 칸 = 배분 계획의 **수신 행**(강사 보기면 그 강사 몫만 — 화면이 세는 집합과 같다).
     * 🔴 교시 지정 저장 = **대표 1행**(대상 둘은 같은 한 수업이라 더하면 2가 된다).
     */
    if (unitsProvided && !transfer) {
      const governed =
        slot === null
          ? dayPlan && dayPlan.ok
            ? [...dayPlan.units.keys()]
            : []
          : // 🔴 교시 지정 저장은 **대상 행 전부**가 같은 값을 받는다(`patch.session_units`) — 대표 1행만 세면
            //    "그 교시 + 옛 그날 전체 행"이 함께 있는 칸에서 격자의 **절반**을 적는다(적대 재리뷰 2026-09-14).
            [...writeIds, ...promoteIds];
      unitsAudit = unitsAuditFields({
        rows: governed.map((id) => ({
          status: String(rowById.get(id)?.status ?? ""),
          units: (rowById.get(id)?.session_units as number | null | undefined) ?? null,
        })),
        status,
        unitsVal: slot === null ? unitsVal ?? (isDefaultUnitsRaw(input.units) ? null : 1) : unitsVal,
        spread: slot === null ? "split" : "each",
      });
    }
    if (promoteIds.length > 0) {
      // 승격(옛 "그날 전체" 행 → 그 교시). 승격 대상만 있을 때만 발생하므로 한 문장으로 끝난다.
      const wrote = await updateWithVia(supabase, { ...patch, slot_start: slot }, promoteIds);
      if (wrote.error) return { error: wrote.error };
    }
    if (writeIds.length > 0 && transfer) {
      /**
       * 🔴 빗금 칸 입력 — 상태·입력자만 쓰고 `session_units`는 patch에 없다(원장 결정 ①). 메모는 행마다 **기존 메모 끝에**
       *    `대신 입력: 이름` 한 줄(③ — `appendMemo`, 두 번 옮겨도 한 줄). 사람이 친 메모가 와도 남의 교시 메모를 덮지 않는다
       *    (빗금 칸 팝오버엔 메모 칸이 없다). 읽고 쓰는 사이 메모가 바뀌면 덮지 않는다(`writeProxyRows` 주석).
       */
      const wrote = await writeProxyRows(
        supabase,
        patch,
        writeIds.map((id) => ({ id, note: (rowById.get(id)?.note as string | null | undefined) ?? null })),
        user.displayName,
      );
      if (wrote.error) {
        // 일부라도 썼으면 감사로그를 남긴다 — 여러 행을 차례로 쓰다 멈춘 흔적은 여기 말고 되짚을 자리가 없다.
        if (wrote.written > 0) {
          await logAction({
            action: "attendance_cell",
            targetType: "attendance",
            metadata: {
              studentId,
              classId,
              date: sessionDate,
              status,
              overwrote: true,
              prevStatus,
              ...(scopeTeacherId ? { scopeTeacherId } : {}),
              ghostTransfer: wrote.written,
              partial: true,
              ...backdatedFlag([sessionDate], kstToday()),
            },
          });
        }
        return { error: wrote.error };
      }
      ghostWritten = wrote.written;
    } else if (writeIds.length > 0) {
      // 같은 시수끼리 한 문장씩(대상이 그날 교시 수라 많아야 서너 건) — 시수를 안 받는 행(남의 교시·시수 안 보냄)은 상태만.
      // ⚠️ 대상은 `writeIds`다(자리 행을 뺀 뒤) — `updateIds`로 쓰면 자리 행이 상태·입력자를 받는다(원장 2026-09-12).
      const groups =
        dayPlan && dayPlan.ok
          ? groupByPlannedUnits(writeIds, dayPlan.units)
          : [{ units: undefined as number | null | undefined, ids: writeIds }];
      for (const g of groups) {
        const wrote = await updateWithVia(
          supabase,
          g.units === undefined ? patch : { ...patch, session_units: g.units },
          g.ids,
        );
        if (wrote.error) return { error: wrote.error };
      }
    }
  } else if (ownInsertSlots) {
    const ownWantsAuto = autoUnitsApply({ rawUnits: input.units, slotStart: null, status });
    const ownAuto = ownWantsAuto ? await resolveAutoUnits(supabase,
      ownInsertSlots.map((slotStart) => ({ classId, date: sessionDate, slotStart }))) : new Map<string, number>();
    /**
     * 🔴 강사 보기 · 그날 교시를 **다른 선생님과 나눠 맡는 날** — "그날 전체" 한 행을 만들면 교시 없는 행은 그날 수업하는
     *    모든 강사의 몫으로 읽혀(`ownsAttendanceSlot`) 남의 출석부에도 같은 숫자가 선다(원장 2026-09-17). 그래서 제 교시마다
     *    한 행씩 만들고 친 숫자는 그 교시들에 합계로 나눈다(`planDayCellUnits` — 있는 행을 고칠 때와 같은 규칙).
     * 숫자를 안 골랐으면 영어 반 기준으로 각 교시의 길이를 환산한다.
     * 🔴 메모는 **새 교시 행 전부에** 단다 — 있는 제 행을 고칠 때(`patch.note`)와 같은 규칙이고, 보강 예약 취소가 "예약이 새로 찍은
     *    결석 칸"을 알아보는 판정(`bare` = 그날 모든 행에 예정 줄)이 한 행에만 있으면 거짓이 돼 결석 0이 남는다(적대 리뷰 2026-09-17).
     */
    const plan = planDayCellUnits({
      targets: ownInsertSlots.map((start, i) => ({ id: `new-${i}`, slot_start: start })),
      owns: null,
      unitsVal: unitsProvided ? unitsVal ?? (isDefaultUnitsRaw(input.units) ? null : 1) : undefined,
    });
    if (!plan.ok) {
      return {
        error: `이 날은 교시가 ${ownInsertSlots.length}개라 시수 ${unitsVal}을(를) 교시별로 나눌 수 없습니다 — 더 큰 값을 넣거나 교시별로 입력해 주세요.`,
      };
    }
    const rows = ownInsertSlots.map((start, i) =>
      withVia(
        {
          tenant_id: user.tenantId,
          class_id: classId,
          student_id: studentId,
          session_date: sessionDate,
          slot_start: start,
          status,
          note: noteProvided ? noteVal : null,
          session_units: ownWantsAuto ? ownAuto.get(autoUnitsKey(classId, sessionDate, start)) ?? null : plan.units.get(`new-${i}`) ?? null,
          recorded_by: user.id,
        },
        via,
      ),
    );
    const wrote = await insertManyWithVia(supabase, rows);
    if (wrote.error) return { error: wrote.error };
    createdSlots = ownInsertSlots;
    // 숫자를 안 고른 저장만(친 1은 합계 1이라 교시마다 0.5다 — 여기 오지 않는다).
    if (ownWantsAuto) {
      createdDefaultTotal = ownInsertSlots.reduce((sum, start) => sum + (ownAuto.get(autoUnitsKey(classId, sessionDate, start)) ?? 1), 0);
    }
  } else {
    // 새 행 + 숫자를 안 고른 저장(원문 없음·공백)만 수업 길이 자동 시수를 받는다(auto-units.ts).
    //    있는 행을 고치는 위 분기는 종전 그대로라 강사가 고친 값·명시한 1을 덮지 않는다.
    //    친 숫자는 `newRowUnits`가 원문을 **다시** 보고 먼저 쓴다(판정 인자 하나가 유일한 방어선이 아니게).
    const lookedUp = autoUnitsApply({ rawUnits: input.units, slotStart: slot, status })
      ? ((await resolveAutoUnits(supabase, [{ classId, date: sessionDate, slotStart: slot }])).get(autoUnitsKey(classId, sessionDate, slot)) ??
        null)
      : undefined;
    const ins = newRowUnits(input.units, unitsVal, lookedUp);
    insertedAuto = ins.auto === undefined ? undefined : ins.units;
    const row = withVia(
      {
        tenant_id: user.tenantId,
        class_id: classId,
        student_id: studentId,
        session_date: sessionDate,
        slot_start: slot,
        status,
        note: noteProvided ? noteVal : null,
        session_units: ins.units,
        recorded_by: user.id,
      },
      via,
    );
    const wrote = await insertWithVia(supabase, row);
    if (wrote.error) return { error: wrote.error };
  }

  /**
   * 감사로그 — 단건 셀 저장. 🔴 값진 쪽은 **정정(덮어쓰기)** 이다: update는 그 행의 `status`·`recorded_by`를
   * 제자리에서 갈아끼우므로 **이전 상태와 이전 입력자가 함께 사라진다**. 새로 연 칸은 행 자체가
   * 실행자를 담지만(`recorded_by`), 덮어쓴 칸은 여기 말고 되짚을 자리가 없다 — 그래서 `prevStatus`를 싣는다.
   */
  await logAction({
    action: "attendance_cell",
    targetType: "attendance",
    metadata: {
      studentId,
      classId,
      date: sessionDate,
      ...(slot ? { slotStart: slot } : {}),
      status,
      ...(overwrote ? { overwrote: true, prevStatus } : { created: true }),
      // 빗금 칸 입력은 친 시수를 쓰지 않으므로 싣지 않는다(실리면 그 값이 저장된 것처럼 읽힌다).
      ...(unitsProvided && !transfer ? { units: unitsVal } : {}),
      // 🔴 **바뀌기 전·후 시수**(원장 2026-09-14) — 값이 실제로 달라졌을 때만(`unitsAuditFields`가 판단).
      //    덮어쓴 칸에만 값이 생긴다(새 칸은 이전 값이 없어 위 분기를 안 탄다).
      //    ⚠️ `nextUnits`는 **칸에 보이는 값**이라 위 `units`(사람이 친 값)와 다를 수 있다(교시마다 기본 = 교시 수).
      ...(unitsAudit ? { prevUnits: unitsAudit.prevUnits, nextUnits: unitsAudit.nextUnits } : {}),
      // 수학 자동 시수가 들어간 새 칸(원장 2026-09-11) — 값이 들어갔을 때만.
      ...(insertedAuto != null ? { autoUnits: insertedAuto } : {}),
      // 강사 전체 보기에서 온 그날 칸 저장 — 시수를 그 강사 몫 교시에만 나눴다(원장 제보 2026-09-11).
      ...(scopeTeacherId ? { scopeTeacherId } : {}),
      // 손대지 않고 둔 자리(JJ·랩실) 행 수(원장 2026-09-12) — 역검수용.
      ...(seatTargets.length > 0 ? { skippedSeatRows: seatTargets.length } : {}),
      // 빗금 칸 입력 — 다른 선생님 교시 행에 상태만 옮긴 행 수(원장 2026-09-14). 그 행 메모의 `대신 입력` 줄과 짝(역검수).
      ...(transfer ? { ghostTransfer: ghostWritten } : {}),
      // 강사 보기가 나눠 맡는 날 새로 만든 제 교시 행의 시각(원장 2026-09-17) — 그날 전체 한 행이면 키가 없다.
      ...(createdSlots ? { createdSlots } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...backdatedFlag([sessionDate], kstToday()),
    },
  });

  // 보강 예약 이행(0264a) — 이 칸에 걸린 예약이 있고 시수를 쓰는 상태가 찍혔으면 `done` + 메모. 예약 없는 칸은
  // 인덱스 조회 한 번뿐이고, 실패는 출결 저장을 되돌리지 않는다(그 모듈이 삼킨다).
  const completed = await completeMakeupReservations({ tenantId: user.tenantId }, [
    {
      studentId,
      classId,
      date: sessionDate,
      status,
      unitsExplicit: unitsProvided && !isDefaultUnitsRaw(input.units),
      created: !overwrote,
    },
  ]);
  // 이행이 시수를 바꿨으면(예약 구간 = 교시당 0.5) 화면 낙관값도 그 값으로 — 낙관 덮개는 서버와 같아져야 벗겨진다(grid/store.ts).
  const completedUnits = completed.get(completionKey({ studentId, classId, date: sessionDate }));
  if (completedUnits !== undefined) insertedAuto = completedUnits;

  // G4: 셀 저장(삽입/갱신)마다 완료 전이 검사 — 삭제 경로는 위에서 조기 반환이라 미발화(기록 제거는 완료가 아님).
  after(() =>
    notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date: sessionDate, actorId: user.id }),
  );
  // 결석이 찍힌 순간 → 데스크 확인 벨(2026-08-14). 결석일 때만, 그리고 dedup은 그쪽이 진다.
  if (status === "absent") {
    after(() =>
      notifyDeskOfAbsences({
        tenantId: user.tenantId,
        actorId: user.id,
        date: sessionDate,
        cells: [{ studentId, classId, slotStart: slot }],
      }),
    );
  }
  if (isUnmarkedToArrival(prevStatus, status)) {
    // '미출결'은 유예 경과 뒤의 빈 칸. 유예 안 찍기는 정상 입력이라 교차 알림을 안 보낸다.
    const phase = await lookupPeriodPhase(supabase, classId, sessionDate, periodStart);
    if (phase === "due" || phase === "ended") {
      after(() =>
        notifyUnmarkedToPresent({
          tenantId: user.tenantId,
          actorId: user.id,
          date: sessionDate,
          via,
          // periodStart = 좌석표 카드의 '지금 교시' — 저장 교시(첫 교시)와 다르면 그 교시 담당도 벨을 받는다.
          cells: [{ studentId, classId, slotStart: slot, periodStart }],
        }),
      );
    }
  }
  if (!input.quiet) revalidateAttendanceSurfaces();
  // 새 행 + 숫자 안 고른 저장이면 실제 저장 시수를 돌려준다 — 화면이 낙관값을 기록에 맞춘다(auto-units.ts).
  // 빗금 칸 입력이면 옮긴 행 수를 돌려준다 — 격자가 칠한 값의 성격을 서버와 맞춘다(grid-context pushCell).
  if (transfer) return { ok: true, ghostTransfer: ghostWritten };
  // 제 교시별로 저장한 시수의 합을 돌려줘 격자가 낙관값을 맞춘다.
  if (createdDefaultTotal !== undefined) return { ok: true, autoUnits: createdDefaultTotal };
  return insertedAuto !== undefined ? { ok: true, autoUnits: insertedAuto } : { ok: true };
}

export type MakeupLinkResult =
  | { ok: true; units: number; absenceNoted: boolean; alreadyLinked: boolean }
  | { error: string };

/**
 * 보강을 **결석분에 연결**한다 — 원스크린 '보강 추가 → 분리'에서 부른다(원장 2026-08-06, 현재 구글시트
 * 출석부 운영과 같은 모양):
 *
 *   A반을 7/16에 결석 → 7/31에 보강
 *   · 7/16 칸: 결석(0) **그대로** + 메모 "7/31 보강 예정"
 *   · 7/31 칸: 시수 **+1**(미입력=1 기준) + 메모 "7/16 결석분 보강"
 *
 * 🔴 결석 칸의 **상태·시수는 절대 안 바꾼다.** 소급해서 0을 1로 올리면 그 달 출석률·시수가 뒤로 움직인다
 *    (이미 마감한 급여·청구가 어긋난다). 시수는 보강을 실제로 한 날에만 얹는다.
 * 🔴 **멱등** — 보강한 날 칸 메모에 그 줄이 이미 있으면 시수를 또 올리지 않는다(두 번 눌러 급여 과지급 방지).
 * ⚠️ 결석 칸은 **7일 편집창(강사) 제한을 적용하지 않는다.** 보강은 보통 2주 뒤라(원장 예시 15일) 창을
 *    걸면 기능이 실제 케이스에서 거의 안 돈다. 안전한 이유는 **메모만 쓰기 때문** — 상태·시수를 안 건드리니
 *    급여·출석률이 움직이지 않는다. 반대로 **보강한 날 칸은 시수를 바꾸므로 창 제한을 그대로 받는다.**
 * ⚠️ 결석 칸에 기록이 아예 없으면 메모를 남기지 않는다(`absenceNoted:false`) — 없는 결석에 행을 새로
 *    만들면 '결석하지 않은 날의 결석 메모'라는 사실 아닌 기록이 생긴다. 호출부가 그 사실을 알린다.
 */
export async function linkMakeupToAbsence(input: {
  studentId: string;
  classId: string;
  /** 결석했던 날(YYYY-MM-DD) — 메모만 붙는다. */
  absentDate: string;
  /**
   * 결석이 난 **반**(생략하면 `classId`와 같은 반) — 원장 2026-08-19: *"반이동으로 인해 반이 이동했는데
   * 이전 수업을 이월해 보강할 수도 있을테니까."* 이월 보강은 **메모를 남길 반(옛 반)** 과
   * **시수를 얹을 반(오늘 보강한 반)** 이 다르다. 하나로 묶으면 옛 반에 시수가 붙거나(급여 귀속이 틀림)
   * 새 반 결석 칸에 남의 메모가 붙는다.
   */
  absentClassId?: string;
  /** 보강을 실제로 한 날(YYYY-MM-DD) — 시수가 여기에 얹힌다. 보통 오늘. */
  makeupDate: string;
  /**
   * 이번 보강의 시수. 🔴 **1 고정이 아니다** — 수학은 **0.5당 1시간**이라 3시간 반의 1회는 1.5다
   * (원장 2026-08-06). 1로 박으면 그 반 급여가 매번 0.5씩 모자란다. 강사가 다이얼로그에서 고른 값.
   */
  addUnits: number;
}): Promise<MakeupLinkResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const { studentId, classId, absentDate, makeupDate, addUnits } = input;
  // 메모가 붙을 반 = 결석이 난 반(미지정이면 같은 반). 시수는 언제나 `classId`(오늘 보강한 반)에 얹는다.
  const absentClassId = input.absentClassId || classId;
  if (!studentId || !classId || !absentDate || !makeupDate) return { error: "필수 값이 누락되었습니다" };
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDate(absentDate) || !isDate(makeupDate)) return { error: "잘못된 날짜입니다" };
  // 🔴 **결석일이 보강일보다 뒤여도 된다**(원장 2026-08-07: *"미래에 결석할 예정으로 미리 수업할 경우"*
  //    — 선보강). 예전엔 `>=`로 막아 그 경우를 아예 넣을 수 없었다. 같은 날만 막는다 — 그건 결석과 보강이
  //    한 칸에서 만나는 것이라 '분리'가 성립하지 않는다(그 경우는 '합침'이 맞다).
  if (absentDate === makeupDate) return { error: "결석한 날과 보강한 날이 같습니다 — 그때는 '합침'을 쓰세요" };
  // 보강 기한(결석한 달의 다음 달 말일, 강사뷰) — 메모 연결과 **같은 문**(makeup-deadline-gate.ts). 시수를 얹기 전에 막는다.
  const deadlineError = await makeupDeadlineError(absentDate, makeupDate);
  if (deadlineError) return { error: deadlineError };
  // 시수는 클라 값을 그대로 믿지 않는다 — 0·음수는 급여를 깎고, 과한 값은 조용한 과지급이 된다.
  if (!Number.isFinite(addUnits) || addUnits <= 0 || addUnits > 24) return { error: "보강 시수가 올바르지 않습니다" };

  const supabase = await createClient();

  // 게이트 — 셀 액션과 같은 규칙(#77: 화면이 아니라 액션이 게이트). 창 제한은 **시수가 바뀌는 보강일에만**.
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(makeupDate, kstToday())) {
      return { error: attendanceLockMessage(makeupDate, kstToday()) };
    }
    const linkFacts = await settle(Promise.all([
      userTaughtClassSet(supabase, user.id, makeupDate, true),
      supabase
        .from("enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .or(`start_date.is.null,start_date.lte.${makeupDate}`)
        .or(`end_date.is.null,end_date.gte.${makeupDate}`),
    ]));
    if (!linkFacts) return { error: LOOKUP_FAILED };
    const [teaching, { count: enrolled }] = linkFacts;
    if (!teaching.has(classId)) return { error: "담당 반이 아닙니다" };
    if (!enrolled) return { error: "이 반 수강생이 아닙니다" };
  }

  const latestCell = (sessionDate: string, cellClassId: string) =>
    supabase
      .from("attendance_records")
      .select("id, status, note, session_units")
      .eq("class_id", cellClassId)
      .eq("student_id", studentId)
      .eq("session_date", sessionDate)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  // 두 칸은 서로 독립 조회 — 직렬 워터폴 금지(B4). 이월 보강이면 **반이 서로 다르다**.
  // 🔴 결석 칸은 **상태로 좁혀** 받는다(absence-cell.ts 공유 규약) — 최신 1건을 그대로 쓰면 ① 그 1건이
  //    출석이어도 "보강 예정" 메모가 붙고 ② 하루 여러 교시를 도는 반에서 결석 칸을 못 찾는다.
  const [absentRes, { data: makeupCell }] = await Promise.all([
    fetchAbsenceCells(supabase, { studentId, classId: absentClassId, date: absentDate }),
    latestCell(makeupDate, classId),
  ]);
  // 🔴 조회 실패는 그대로 알린다(빈 목록으로 삼키면 "결석이 없다"는 거짓 결론이 나간다).
  if (!absentRes.ok) return { error: absentRes.error };
  const absentRows = absentRes.cells;

  const memoOnMakeup = makeupMemo(absentDate, makeupDate);
  // 이미 연결돼 있으면 시수를 또 올리지 않는다 — 메모도 그대로다(appendMemo가 멱등).
  const alreadyLinked = hasMemoLine(makeupCell?.note, memoOnMakeup);
  const units = alreadyLinked
    ? (makeupCell?.session_units ?? 1)
    : unitsAfterMakeup(makeupCell?.session_units, addUnits);

  const nowIso = new Date().toISOString();
  const writes: PromiseLike<{ error: { message: string } | null }>[] = [];

  // ① 결석한 날 — **메모만**, 결석/공결 칸 한 곳에만. 기록이 없으면 아무것도 만들지 않는다.
  const memoOnAbsence = absenceMemo(makeupDate, absentDate);
  const absentTarget = pickAbsenceNoteTarget(absentRows, memoOnAbsence);
  if (absentTarget && !hasMemoLine(absentTarget.note, memoOnAbsence)) {
    writes.push(
      supabase
        .from("attendance_records")
        .update({ note: appendMemo(absentTarget.note, memoOnAbsence) })
        .eq("id", absentTarget.id),
    );
  }

  // ② 보강한 날 — 시수 +1 + 메모. 기록이 없으면 새로 만든다(보강만 하러 온 날).
  if (!alreadyLinked) {
    if (makeupCell?.id) {
      writes.push(
        supabase
          .from("attendance_records")
          .update({
            session_units: units,
            note: appendMemo(makeupCell.note, memoOnMakeup),
            recorded_by: user.id,
            recorded_at: nowIso,
          })
          .eq("id", makeupCell.id),
      );
    } else {
      writes.push(
        supabase.from("attendance_records").insert({
          tenant_id: user.tenantId,
          class_id: classId,
          student_id: studentId,
          session_date: makeupDate,
          // 기록이 없던 날 = 정규를 아직 안 찍었거나 보강만 온 날 → 출석으로 연다(결석을 되쓰는 경로가 아니다).
          status: "present",
          session_units: units,
          note: memoOnMakeup,
          recorded_by: user.id,
        }),
      );
    }
  }

  for (const res of await Promise.all(writes)) {
    if (res.error) return { error: attendanceDbWhy(res.error, "attendance.linkMakeup") };
  }
  /**
   * 감사로그 — 이 액션은 보강한 날 칸의 **시수를 올린다**(급여 재료). 멱등 가드가 깨지면 조용한 과지급이라
   * "누가 언제 몇 시수를 얹었나"가 남아야 한다.
   * ⚠️ 아무것도 안 쓴 호출(이미 연결됨 + 결석 메모도 이미 있음)은 남기지 않는다 — 없는 변경을 기록하지 않는다.
   * 🔴 메모 **본문은 싣지 않는다**(결석 사유가 섞인 칸에 덧붙이는 경로다).
   */
  if (writes.length > 0) {
    await logAction({
      action: "attendance_makeup_link",
      targetType: "attendance",
      metadata: {
        studentId,
        classId,
        ...(absentClassId !== classId ? { absentClassId } : {}),
        absentDate,
        makeupDate,
        addUnits,
        units,
        absenceNoted: !!absentTarget,
        ...(alreadyLinked ? { alreadyLinked: true } : {}),
      },
    });
  }
  // 셀 액션과 같은 계약 — 기록이 늘거나 바뀐 날에만 완료 전이 검사(결석일은 메모만이라 미발화).
  if (!alreadyLinked) {
    after(() =>
      notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date: makeupDate, actorId: user.id }),
    );
  }
  revalidateAttendanceSurfaces();
  // 🔑 "찾았다"와 "이번에 붙였다"를 구분하지 않는다 — 이미 붙어 있던 경우도 연결된 것이 사실이다.
  return { ok: true, units, absenceNoted: !!absentTarget, alreadyLinked };
}

/** 일괄로 찍을 수 있는 상태 — 인라인 pill과 같은 3종. 조퇴·공결·보강은 출석부 전용(축약 되쓰기 방지). */
const BULK_STATUSES = ["present", "late", "absent"] as const;
/** 한 번에 처리할 셀 상한 — 표뷰 한 화면(수십 행)을 넉넉히 덮으면서 폭주 요청을 막는 안전선. */
const BULK_CELL_LIMIT = 300;

export type BulkCellResult =
  | {
      ok: true;
      /** `created` = 이번에 **새로 만들어진** 행(시수 등 insert 전용 값이 실린 칸) — 클라 낙관 반영이
       *  화면과 DB가 갈리지 않게 구분한다(갱신된 칸은 기존 시수가 보존되므로 시수를 되그리면 안 된다). */
      applied: { studentId: string; classId: string; created?: boolean; autoUnits?: number }[];
      blocked: number;
    }
  | { error: string };

/**
 * 여러 (학생·반)의 같은 날짜 출결을 **한 번의 왕복으로** 기록한다 — 원스크린 표뷰 '일괄 입력'용.
 *
 * ⚠️ 셀 단위 `setAttendanceCell`을 N번 부르지 않는 이유는 속도다(반 하나가 30~40행 = 왕복 40번).
 *    대신 **게이트는 그대로 통과해야 한다**(#77 — 화면이 아니라 액션이 게이트):
 *    권한 → 강사(scoped)면 수정 가능 기간 → 담당 반 → 그 날짜 기준 수강생. 셀 액션과 같은 규칙을
 *    같은 순서로, 다만 행마다가 아니라 **집합 단위 조회 1회씩**으로 검사한다(B3 청크 · B4 병렬).
 *
 * ⚠️ 게이트에 걸린 셀은 **전체를 실패시키지 않고 건너뛴다**(`blocked`) — 강사가 담당하지 않는 반이
 *    한 줄 섞였다고 나머지 30명 기록이 통째로 날아가면 안 된다. 다만 권한·기간처럼 **요청 전체에
 *    해당하는 사유**는 조기 반환으로 분명히 알린다(조용한 0건 금지).
 *
 * ⚠️ 상태 삭제(null)는 지원하지 않는다 — 일괄 삭제는 되돌릴 수 없고 메모·시수까지 함께 지운다.
 *    지우기는 출석부에서만(인라인 pill과 같은 계약).
 */
export async function setAttendanceBulk(input: {
  sessionDate: string;
  status: (typeof BULK_STATUSES)[number];
  cells: { studentId: string; classId: string }[];
  /**
   * true면 그 날짜에 기록이 **하나라도 있는** (학생·반)은 덮지 않고 건너뛴다(`blocked`로 집계) —
   * "빈 칸만 채우기"의 **서버 강제**. 클라 필터에만 맡기면 화면이 낡았을 때(딴 곳에서 방금 찍은 결석)
   * 기존 기록이 조용히 '출석'으로 뒤집힌다(적대 리뷰 2026-08-11 — ECS 오늘 보드 일괄이 이 모드를 쓴다).
   * 기존 행을 절대 update하지 않으므로 교시별(0196a) 행이 섞인 날에도 부분 갱신·시수 이중 계상이 없다.
   */
  fillEmptyOnly?: boolean;
  /**
   * 교시(0196a, "HH:MM") — **넘기면 그 교시 칸만** 읽고 쓴다. 안 넘기면 종전대로 "그날 전체"(slot null).
   *
   * 🔴 당일 출결 화면(2026-08-14)이 교시별로 그리기 때문에 필요하다. 이걸 안 넘기고 일괄 출석을 하면
   *    같은 반이 하루 두 번 만나는 날(영어에 흔하다) **1교시에 누른 '전원 출석'이 2교시까지 출석으로
   *    보인다** — 2교시에 안 온 학생이 데스크 큐에서 조용히 사라진다.
   * ⚠️ `fillEmptyOnly`의 "이미 기록 있음" 판정도 함께 좁혀진다(그 교시에 기록이 있는지). 안 그러면
   *    1교시를 찍은 순간 2교시가 통째로 blocked가 되어 영원히 못 찍는다.
   */
  slotStart?: string | null;
  /** 화면 교시 — 데스크 10분 판정용. 저장 축(`slotStart`)과 다를 수 있다. */
  periodStart?: string | null;
  /** `"live"` = 당일 출결 화면의 일괄. 없으면 데스크 게이트 없음(원스크린·시트). */
  source?: "live";
  /**
   * 수업타임(시수) — **이번 일괄로 새로 만들어지는 행에만** 쓴다(2026-08-17 감사 P0-2 부분 대응).
   * 🔴 기존 행은 절대 안 건드린다 — 일괄의 "기존 note·시수 보존" 계약 유지(위 fillEmptyOnly 주석).
   *    시수는 급여 재료라(tier-rows: null=1), 3시간 반(규약 1.5)을 일괄 출석으로 찍으면 새 행이
   *    조용히 1.0으로 계상되던 것을 강사가 값을 **직접 골라** 막을 수 있게 한다. 미입력=종전(null).
   */
  units?: string;
}): Promise<BulkCellResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const { sessionDate, status } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "잘못된 날짜입니다" };
  if (!BULK_STATUSES.includes(status)) return { error: "잘못된 상태입니다" };

  // 시수(선택) — 셀 저장과 같은 파서(쉼표 소수점 허용·1은 null 정규화). 결석엔 시수가 무의미하지만
  // 값이 와도 해가 없다(소비처가 결석 행 시수를 안 읽는다) — 클라가 이미 출석·지각에서만 보낸다.
  const bulkUnitsProvided = input.units !== undefined && String(input.units).trim() !== "";
  let bulkUnitsVal: number | null = null;
  if (bulkUnitsProvided) {
    const parsed = parseSessionUnits(input.units);
    if (!parsed.ok) return { error: parsed.error };
    bulkUnitsVal = parsed.value;
  }

  // 같은 (학생·반)이 두 번 오면 한 번만 — 출결 원장은 그 조합에 한 칸이다.
  const seen = new Set<string>();
  const cells: { studentId: string; classId: string }[] = [];
  for (const c of input.cells) {
    if (!c?.studentId || !c?.classId) continue;
    const k = `${c.studentId}::${c.classId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ studentId: c.studentId, classId: c.classId });
  }
  if (cells.length === 0) return { error: "기록할 대상이 없습니다" };
  if (cells.length > BULK_CELL_LIMIT)
    return { error: `한 번에 ${BULK_CELL_LIMIT}건까지만 기록할 수 있습니다 — 범위를 좁혀 주세요` };

  const supabase = await createClient();
  let allowed = cells;

  /** 강사 일괄에서 **정정만** 허가된 칸(학생::반) — 기존 행을 읽은 뒤 고칠 대상이 없으면 뺀다(결정 #5). 관리자는 null. */
  let bulkCorrectOnly: Set<string> | null = null;
  /** native 조회 실패 사유 — 그 때문에 정정 후보로 내려간 칸이 새 행이 필요해 빠지면 이 사유로 막는다(새 행만 막고 정정은 그대로). */
  let bulkNativeUnknown: string | null = null;
  // 강사(scoped) — 셀 액션과 같은 3중 게이트를 집합 단위로. full(관리자 계열)은 기존대로 전 반.
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(sessionDate, kstToday())) {
      return { error: attendanceLockMessage(sessionDate, kstToday()) };
    }
    const classIds = [...new Set(cells.map((c) => c.classId))];
    const studentIds = [...new Set(cells.map((c) => c.studentId))];
    // ⚠️ 수강 판정은 **세션 날짜 기준**(셀 액션과 동일 의미) — 반이동·종강 학생의 그날 기록을 막지 않는다.
    const bulkFacts = await settle(Promise.all([
      // 담당 반 ∪ 그날 위임받은 반(0173a) — 셀 액션과 **같은 소스**여야 일괄이 개별과 다른 말을 하지 않는다.
      userTaughtClassSet(supabase, user.id, sessionDate, true),
      // 청크 안에서도 1000행에서 잘릴 수 있다(B2) — 페이지까지 나눈다(수정 계획 P1-A).
      fetchAllPagedInChunks<{ class_id: string; student_id: string }>(studentIds, (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select("id, class_id, student_id")
          .in("class_id", classIds)
          .in("student_id", chunk)
          .or(`start_date.is.null,start_date.lte.${sessionDate}`)
          .or(`end_date.is.null,end_date.gte.${sessionDate}`)
          .order("id")
          .range(from, to),
      ),
    ]));
    if (!bulkFacts) return { error: LOOKUP_FAILED };
    const [teaching, enrolled] = bulkFacts;
    const ownSet = teaching;
    const enrolledSet = new Set(enrolled.map((e) => `${e.student_id}::${e.class_id}`));
    // 🔴 보강 예약된 학생(0264a)은 수강행이 없어도 그날 그 반에 오기로 한 사람 — 단건 게이트(`hasReservedMakeup`)와 같은
    //    문으로 연다(적대 리뷰 2026-09-14: 오늘 출결 보드의 '전원 출석'이 예약 학생만 조용히 버리고 예약이 영영 남았다).
    //    수강생은 묻지 않는다(왕복은 비수강 칸이 있을 때 한 번).
    const reservedKeys = await reservedCellKeys(
      user.tenantId,
      cells
        .filter((c) => !enrolledSet.has(`${c.studentId}::${c.classId}`))
        .map((c) => ({ studentId: c.studentId, classId: c.classId, date: sessionDate })),
    );
    // 수업 나누기(0351a)로 그날 들어오는 학생도 같은 문으로(단건 게이트 `hasSplitInto`와 같은 판정).
    const splitKeys = await splitIntoKeys(classIds, sessionDate);
    const keyOf = (c: { studentId: string; classId: string }) => `${c.studentId}::${c.classId}`;
    const taught = cells.filter((c) => ownSet.has(c.classId));
    const basis = (c: { studentId: string; classId: string }) =>
      enrolledSet.has(keyOf(c)) ||
      splitKeys.has(keyOf(c)) ||
      reservedKeys.has(reservedCellKey({ studentId: c.studentId, classId: c.classId, date: sessionDate }));
    // native 보강 참여 — 다른 근거가 없는 칸만, **한 번에** 묻는다(칸마다 왕복 금지).
    const nativeAsk = taught.filter((c) => !basis(c));
    const native = await nativeWriteKeys(nativeAsk.map((c) => ({ studentId: c.studentId, classId: c.classId, sessionDate })));
    bulkNativeUnknown = native.error;
    // 등급은 판정 한 벌(writeEligibility)로 — 기록 유무는 아직 모르니 "있다"고 보고 정정 후보로 싣는다(아래에서 고칠 대상이 없으면 뺀다).
    bulkCorrectOnly = new Set(
      taught
        .filter((c) => writeEligibility({
          enrolled: enrolledSet.has(keyOf(c)),
          reserved: reservedKeys.has(reservedCellKey({ studentId: c.studentId, classId: c.classId, date: sessionDate })),
          splitInto: splitKeys.has(keyOf(c)),
          native: native.keys.has(`${keyOf(c)}::${sessionDate}`),
          hasRecord: true,
        }) !== "create")
        .map(keyOf),
    );
    allowed = taught;
    if (allowed.length === 0) return { error: "담당 반 수강생이 아니어서 기록할 수 없습니다" };
  }

  const classIds = [...new Set(allowed.map((c) => c.classId))];
  const studentIds = [...new Set(allowed.map((c) => c.studentId))];
  const slot = input.slotStart?.trim() || null;
  const periodStart = input.periodStart?.trim() || slot;
  if (slot && !/^\d{2}:\d{2}(:\d{2})?$/.test(slot)) return { error: "잘못된 교시입니다" };
  // 기존 기록 — 셀 액션과 같은 "가장 최근 1건" 규약(그 날짜에 행이 여러 개일 수 있다).
  // 교시를 넘겼으면 **그 교시 행만** 본다(다른 교시 기록을 이 교시의 답으로 오인하지 않는다).
  const existingRows = await fetchInChunks<{
    id: string;
    class_id: string;
    student_id: string;
    recorded_at: string | null;
  }>(studentIds, (chunk) =>
    supabase
      .from("attendance_records")
      .select("id, class_id, student_id, recorded_at, slot_start")
      .eq("session_date", sessionDate)
      .in("class_id", classIds)
      .in("student_id", chunk)
      // 🔴 교시를 넘겨도 **그날 전체(slot null) 행까지** 본다 — 아래에서 좁힌다. 조회에서 이미 잘라내면
      //    옛 day-level 행을 못 보고 새 행을 만들어 한 칸에 두 행이 살아남는다(정정이 돈에 안 닿는다).
      .order("recorded_at", { ascending: false })
      // id desc = 동률 tie-break(셀 액션·로스터와 같은 규약 — pickSaveTargets 전제 보호).
      .order("id", { ascending: false }),
  );
  // 칸(학생::반)마다 **셀 저장과 같은 규칙**으로 대상을 고른다(pickSaveTargets 단일 소스).
  // 청크는 학생 단위라 한 칸의 행은 모두 같은 청크에 있고, 각 청크가 recorded_at 내림차순이라
  // "교시마다 처음 만난 행이 최신"이라는 전제가 여기서도 성립한다.
  const rowsByKey = new Map<string, { id: string; slot_start?: string | null }[]>();
  for (const r of existingRows) {
    const k = `${r.student_id}::${r.class_id}`;
    const list = rowsByKey.get(k);
    if (list) list.push(r);
    else rowsByKey.set(k, [r]);
  }
  const targetsByKey = new Map<string, SaveTargets>();
  for (const [k, list] of rowsByKey) {
    const targets = pickSaveTargets(list, slot);
    if (hasSaveTarget(targets)) targetsByKey.set(k, targets);
  }
  // 정정만 허가된 칸 — 이 교시에 고칠 행이 없으면 새 행을 만들게 되니 뺀다(결정 #5 · 단건과 같은 규칙).
  if (bulkCorrectOnly) {
    const correctOnly = bulkCorrectOnly;
    const dropped = allowed.filter((c) => blockedByCorrectOnly(
      correctOnly.has(`${c.studentId}::${c.classId}`) ? "correct" : "create",
      !targetsByKey.has(`${c.studentId}::${c.classId}`),
    ));
    // native를 확인하지 못해 새 행 칸을 못 열었다 — 요청 전체를 저장하지 않는다(결정 #5). 정정만인 칸은 영향 없음.
    if (dropped.length > 0 && bulkNativeUnknown) return { error: bulkNativeUnknown };
    const droppedSet = new Set(dropped);
    allowed = allowed.filter((c) => !droppedSet.has(c));
    if (allowed.length === 0) return { error: "담당 반 수강생이 아니어서 기록할 수 없습니다" };
  }
  // 정정만으로 빠진 반에는 입력자 판정·완료 검사를 돌리지 않는다(빠진 반의 조회 실패가 요청을 막지 않게, 4-2 리뷰).
  const writeClassIds = [...new Set(allowed.map((c) => c.classId))];

  // '빈 칸만' 모드 — 기존 기록이 있는 셀은 **여기서**(서버) 걸러 절대 update 경로를 안 탄다.
  // 이 필터가 클라에 있으면 낡은 탭이 남의 결석을 덮는다(위 fillEmptyOnly 주석). blocked로 집계돼
  // 호출부가 "건너뛴 N명"을 사용자에게 밝힌다(조용한 스킵 금지).
  if (input.fillEmptyOnly) {
    allowed = allowed.filter((c) => !targetsByKey.has(`${c.studentId}::${c.classId}`));
    if (allowed.length === 0) return { ok: true, applied: [], blocked: cells.length };
  }

  const nowIso = new Date().toISOString();
  // 반마다 주체(강사/데스크)를 한 번만 판정 — 같은 요청에 여러 반이 섞일 수 있다.
  const viaByClass = new Map<string, RecordedVia>();
  for (const classId of writeClassIds) {
    const via = await settle(resolveWriteVia(supabase, user.id, classId, sessionDate));
    if (!via) return { error: LOOKUP_FAILED };
    viaByClass.set(classId, via);
  }

  // 데스크 게이트 — 당일 출결 화면만. 이미 찍힌 칸·유예 안 칸은 건너뛴다(blocked).
  if (input.source === "live") {
    const deskGateByClass = new Map<string, { error: string } | { ok: true }>();
    const open: typeof allowed = [];
    for (const c of allowed) {
      const via = viaByClass.get(c.classId) ?? "desk";
      const current = targetsByKey.has(`${c.studentId}::${c.classId}`) ? "present" : null;
      const cacheKey = `${c.classId}|${current ?? ""}`;
      let gate = deskGateByClass.get(cacheKey);
      if (!gate) {
        gate = await assertDeskMayWrite({
          supabase,
          via,
          classId: c.classId,
          date: sessionDate,
          periodStart,
          currentStatus: current,
          nextStatus: status,
          source: "live",
        });
        deskGateByClass.set(cacheKey, gate);
      }
      if ("error" in gate) continue;
      open.push(c);
    }
    allowed = open;
  }

  const inserts = allowed.filter((c) => !targetsByKey.has(`${c.studentId}::${c.classId}`));

  // 갱신 대상을 주체×(그대로/승격)로 나눈다. pickSaveTargets가 돈 규칙을 정한다.
  const CHUNK = 100;
  const byVia = new Map<RecordedVia, { updateIds: string[]; promoteIds: string[] }>();
  for (const c of allowed) {
    const targets = targetsByKey.get(`${c.studentId}::${c.classId}`);
    if (!targets) continue;
    const via = viaByClass.get(c.classId) ?? "teacher";
    const bucket = byVia.get(via) ?? byVia.set(via, { updateIds: [], promoteIds: [] }).get(via)!;
    bucket.updateIds.push(...targets.updateIds);
    bucket.promoteIds.push(...targets.promoteIds);
  }
  for (const [via, bucket] of byVia) {
    for (let i = 0; i < bucket.updateIds.length; i += CHUNK) {
      const wrote = await updateWithVia(
        supabase,
        withVia({ status, recorded_by: user.id, recorded_at: nowIso }, via),
        bucket.updateIds.slice(i, i + CHUNK),
      );
      if (wrote.error) return { error: wrote.error };
    }
    for (let i = 0; i < bucket.promoteIds.length; i += CHUNK) {
      const wrote = await updateWithVia(
        supabase,
        withVia({ status, recorded_by: user.id, recorded_at: nowIso, slot_start: slot }, via),
        bucket.promoteIds.slice(i, i + CHUNK),
      );
      if (wrote.error) return { error: wrote.error };
    }
  }
  // 수학 자동 시수 — 이번에 **새로 만드는** 칸 + 시수를 안 고른 일괄만(auto-units.ts). 갱신 대상은 위에서 끝났다.
  const bulkWantsAuto = inserts.length > 0 && autoUnitsApply({ rawUnits: input.units, slotStart: slot, status });
  const bulkAuto = bulkWantsAuto
    ? await resolveAutoUnits(supabase, inserts.map((c) => ({ classId: c.classId, date: sessionDate, slotStart: slot })))
    : new Map<string, number>();
  // 🔴 친 숫자가 먼저 — `newRowUnits`가 원문을 다시 본다(auto-units.ts). 새 행·응답·감사로그가 이 한 값을 쓴다.
  const bulkUnitsOf = (c: { classId: string }) =>
    newRowUnits(
      input.units,
      bulkUnitsVal,
      bulkWantsAuto ? (bulkAuto.get(autoUnitsKey(c.classId, sessionDate, slot)) ?? null) : undefined,
    );
  if (inserts.length > 0) {
    const rows = inserts.map((c) =>
      withVia(
        {
          tenant_id: user.tenantId,
          class_id: c.classId,
          student_id: c.studentId,
          session_date: sessionDate,
          status,
          recorded_by: user.id,
          // 교시 미지정이면 종전대로 null("그날 전체") — 기존 호출부의 저장 모양이 바뀌지 않는다.
          ...(slot ? { slot_start: slot } : {}),
          // 수업타임(시수) — **새 행에만**(update 패치엔 절대 안 넣는다 — 기존 시수 보존 계약).
          // 친 숫자 → 그대로 · 안 골랐으면 수학 자동 시수 · 그 외 null(= 1, 컬럼 기본값과 같다).
          session_units: bulkUnitsOf(c).units,
        },
        viaByClass.get(c.classId) ?? "teacher",
      ),
    );
    const wrote = await insertManyWithVia(supabase, rows);
    if (wrote.error) return { error: wrote.error };
  }

  /**
   * 감사로그 — 일괄은 **한 줄로 요약**한다(300칸을 300행으로 남기면 감사로그가 못 읽는 물건이 된다).
   * 대신 되짚을 식별자(`studentIds`·`classIds`·`date`)를 함께 담아 "무엇이 바뀌었나"를 복원할 수 있게.
   * ⚠️ 게이트에 걸려 한 칸도 안 쓴 요청은 남기지 않는다(`allowed`가 비면 write가 0건이다).
   */
  if (allowed.length > 0) {
    const wroteClassIds = [...new Set(allowed.map((c) => c.classId))];
    await logAction({
      action: "attendance_bulk",
      targetType: "attendance",
      metadata: {
        // 반이 하나면 '대상' 열이 반 이름으로 읽힌다(auditTargetName) — 여럿이면 지어내지 않고 목록만.
        ...(wroteClassIds.length === 1 ? { classId: wroteClassIds[0] } : {}),
        classIds: wroteClassIds,
        date: sessionDate,
        status,
        count: allowed.length,
        created: inserts.length,
        blocked: cells.length - allowed.length,
        studentIds: [...new Set(allowed.map((c) => c.studentId))],
        ...(slot ? { slotStart: slot } : {}),
        ...(input.fillEmptyOnly ? { fillEmptyOnly: true } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(bulkUnitsProvided ? { units: bulkUnitsVal } : {}),
        // 수학 자동 시수가 들어간 새 칸(원장 2026-09-11) — 없으면 키도 없다.
        ...autoUnitsLogFields(inserts.map((c) => bulkUnitsOf(c).auto).filter((v): v is number => typeof v === "number")),
        ...backdatedFlag([sessionDate], kstToday()),
      },
    });
  }

  // 보강 예약 이행(0264a) — 일괄로 쓴 칸 중 예약이 걸린 것((반·날짜)마다 한 번 조회). `created` = 이번에 새로 만든 행.
  const bulkCreated = new Set(inserts.map((c) => completionKey({ studentId: c.studentId, classId: c.classId, date: sessionDate })));
  await completeMakeupReservations(
    { tenantId: user.tenantId },
    allowed.map((c) => ({
      studentId: c.studentId,
      classId: c.classId,
      date: sessionDate,
      status,
      unitsExplicit: bulkUnitsProvided,
      created: bulkCreated.has(completionKey({ studentId: c.studentId, classId: c.classId, date: sessionDate })),
    })),
  );

  // G4: 반마다 '전원 기록 완료' 전이 검사(셀 액션과 동일) — 백그라운드라 응답을 막지 않는다.
  after(async () => {
    for (const classId of writeClassIds) {
      await notifyIfClassAttendanceComplete({
        tenantId: user.tenantId,
        classId,
        date: sessionDate,
        actorId: user.id,
      });
    }
  });
  // 일괄로 결석을 찍는 경우(예: 휴강 처리)도 데스크가 알아야 한다 — 같은 dedup을 타 중복 벨은 없다.
  if (status === "absent" && allowed.length > 0) {
    after(() =>
      notifyDeskOfAbsences({
        tenantId: user.tenantId,
        actorId: user.id,
        date: sessionDate,
        cells: allowed.map((c) => ({ ...c, slotStart: slot })),
      }),
    );
  }
  // 일괄 '전원 출석'이 미출결→출결이면 교차 알림. 주체별로 나눠 보낸다.
  if (isUnmarkedToArrival(null, status) && inserts.length > 0) {
    const phaseByClass = new Map<string, Awaited<ReturnType<typeof lookupPeriodPhase>>>();
    const byVia = new Map<RecordedVia, typeof inserts>();
    for (const c of inserts) {
      let phase = phaseByClass.get(c.classId);
      if (!phase) {
        phase = await lookupPeriodPhase(supabase, c.classId, sessionDate, periodStart);
        phaseByClass.set(c.classId, phase);
      }
      if (phase !== "due" && phase !== "ended") continue;
      const via = viaByClass.get(c.classId) ?? "teacher";
      (byVia.get(via) ?? byVia.set(via, []).get(via)!).push(c);
    }
    if (byVia.size > 0) {
      after(async () => {
        for (const [via, group] of byVia) {
          await notifyUnmarkedToPresent({
            tenantId: user.tenantId,
            actorId: user.id,
            date: sessionDate,
            via,
            cells: group.map((c) => ({ ...c, slotStart: slot, periodStart })),
          });
        }
      });
    }
  }
  revalidateAttendanceSurfaces();
  const createdKeys = new Set(inserts.map((c) => `${c.studentId}::${c.classId}`));
  return {
    ok: true,
    // 새 칸에 수학 자동 시수가 들어갔으면 그 값도 — 호출부가 화면 시수를 기록과 같게 맞춘다(갱신 칸엔 안 붙는다).
    applied: allowed.map((c) => {
      const created = createdKeys.has(`${c.studentId}::${c.classId}`);
      const autoUnits = created ? bulkUnitsOf(c).auto : undefined;
      return { ...c, created, ...(typeof autoUnits === "number" ? { autoUnits } : {}) };
    }),
    blocked: cells.length - allowed.length,
  };
}

export type RangeCell = { studentId: string; classId: string; sessionDate: string };
export type RangeResult =
  | {
      ok: true;
      applied: number;
      blocked: number;
      /**
       * 숫자를 안 고른 채우기로 **새로 만든** 칸의 실제 저장 시수(null = 1) — 수학 자동 시수(auto-units.ts).
       * 격자가 낙관값을 기록에 맞춘다(조회 실패로 자동값이 안 들어간 칸까지). 해당 칸이 없으면 키가 없다.
       */
      autoUnits?: { studentId: string; classId: string; sessionDate: string; units: number | null }[];
      /**
       * 강사 보기 **빗금 칸 입력**으로 다른 선생님 교시 행에 상태만 옮긴 칸(원장 2026-09-14) — 격자가 칠한 값의 성격을
       * 서버와 맞춘다(갈린 칸은 덮개를 벗긴다). 해당 칸이 없으면 키가 없다.
       */
      ghostCells?: RangeCell[];
    }
  | { error: string };

/** '전원 기록 완료' 전이 검사를 돌릴 (반×날짜) 조합 상한 — 넘으면 건너뛴다(아래 주석). */
const NOTIFY_PAIR_LIMIT = 40;

/**
 * 출석부 시트의 **범위 채우기·지우기** — 드래그 채우기, Ctrl+Enter, 범위 Delete가 이 액션 하나를 쓴다.
 *
 * `setAttendanceBulk`와 다른 점은 **날짜가 칸마다 다르다**는 것뿐이다(시트 범위는 가로로도 끌린다).
 * 게이트는 셀 액션·일괄 액션과 **같은 규칙을 같은 순서로** 통과한다(#77 — 화면이 아니라 액션이 게이트):
 *   권한 → (강사면) 수정 가능 기간 → 담당 반 → 그 **날짜 기준** 수강생.
 *
 * ⚠️ 기간·담당·수강에 걸린 칸은 **그 칸만 건너뛴다**(`blocked`). 범위 한 귀퉁이가 8일 전이라고
 *    나머지 수십 칸이 통째로 날아가면 안 된다. 권한처럼 요청 전체에 해당하는 사유만 조기 반환한다.
 * ⚠️ 지우기(status=null)는 그 칸의 기록을 **전부** 지운다 — 셀 액션의 '지우기'와 같은 계약.
 */
export async function setAttendanceRange(input: {
  /**
   * 칸 목록. `ghost` = 화면이 그 칸을 **빗금 칸 입력**으로 알고 보냈다(`setAttendanceCell`의 `ghostTransfer`와 같은 뜻 —
   * 서버 판정과 갈리면 그 칸만 건너뛴다).
   */
  cells: (RangeCell & { ghost?: boolean })[];
  status: Status | null;
  /** 전달 시 시수도 갱신(raw — ""=기본 1). status=null이면 무시. */
  units?: string;
  /**
   * 화면 갱신을 이 액션이 하지 않는다 — 시트가 **입력이 멎은 뒤 한 번** 직접 새로고침한다.
   * ⚠️ 켜지 않으면 칸을 칠 때마다 그 달 매트릭스를 통째로 다시 조회한다(수십 번 = 화면이 긴다).
   */
  quiet?: boolean;
  /**
   * **강사 전체 보기의 주인**(원장 제보 2026-09-11) — `setAttendanceCell`의 같은 필드와 같은 뜻: 시수를 그 강사 몫
   * 행에만 나눈다(자리 JJ·다른 선생님 교시의 시수는 그대로). 몫은 서버가 DB로 다시 판정한다(#77).
   * ⚠️ **자리(JJ·랩실) 행은 상태·입력자·지우기까지 아예 안 건드린다**(원장 2026-09-12) — 채우기와 지우기 둘 다.
   */
  scopeTeacherId?: string | null;
  /**
   * 스코프를 적용할 반 — 강사 전체 보기에서도 **보강 묶음**(0241a)은 스코프 없이 그려지므로 반 단위로 가른다.
   * 생략하면 범위의 모든 반에 적용한다.
   */
  scopeClassIds?: string[];
}): Promise<RangeResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const { status } = input;
  if (status !== null && !STATUSES.includes(status)) return { error: "잘못된 상태입니다" };

  const unitsProvided = input.units !== undefined;
  let unitsVal: number | null = null;
  if (unitsProvided) {
    const parsed = parseSessionUnits(input.units);
    if (!parsed.ok) return { error: parsed.error };
    unitsVal = parsed.value;
  }
  // 강사 전체 보기의 주인 — 형식이 아니면 화면이 만든 값이 아니다(셀 저장과 같은 검사).
  const scopeTeacherId = input.scopeTeacherId ?? null;
  if (scopeTeacherId !== null && !isScopeTeacherId(scopeTeacherId)) return { error: SCOPE_INVALID_MESSAGE };
  // 스코프 반 목록도 형식을 본다 — 배열이 아니면(Set·문자열 등) 아래 `new Set(...)`가 조용히 딴 뜻이 되거나 던진다.
  if (input.scopeClassIds != null && !isScopeClassIds(input.scopeClassIds)) return { error: SCOPE_INVALID_MESSAGE };

  // 같은 (학생·반·날짜)가 두 번 오면 한 번만 — 출결 원장은 그 조합에 한 칸이다.
  const seen = new Set<string>();
  /** 화면이 빗금 칸 입력으로 알고 보낸 칸(키 = 학생::반::날짜) — `planScopedDay` ghostIntent. */
  const ghostIntentKeys = new Set<string>();
  const cells: RangeCell[] = [];
  for (const c of input.cells ?? []) {
    if (!c?.studentId || !c?.classId || !/^\d{4}-\d{2}-\d{2}$/.test(c.sessionDate ?? "")) continue;
    const k = `${c.studentId}::${c.classId}::${c.sessionDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ studentId: c.studentId, classId: c.classId, sessionDate: c.sessionDate });
    if (c.ghost === true) ghostIntentKeys.add(k);
  }
  if (cells.length === 0) return { error: "기록할 대상이 없습니다" };
  if (cells.length > BULK_CELL_LIMIT)
    return { error: `한 번에 ${BULK_CELL_LIMIT}칸까지만 채울 수 있습니다 — 범위를 좁혀 주세요` };

  const supabase = await createClient();
  const classIds = [...new Set(cells.map((c) => c.classId))];
  const studentIds = [...new Set(cells.map((c) => c.studentId))];
  const dates = [...new Set(cells.map((c) => c.sessionDate))];
  let allowed = cells;
  /** 강사 범위에서 **정정만** 허가된 칸(학생::반::날짜) — 기존 행을 읽은 뒤 고칠 행이 없으면 뺀다(결정 #5). 관리자는 null. */
  let rangeCorrectOnly: Set<string> | null = null;
  /** native 조회 실패 사유 — 새 행이 필요한 칸이 그 때문에 빠지면 이 사유로 막는다. */
  let rangeNativeUnknown: string | null = null;
  /** 날짜 → 그날 담당 반(위임 포함) — 강사 게이트가 읽은 것을 입력자 표식(`recorded_via`)이 다시 쓴다(날짜별 · 4-5). */
  const rangeTeachingByDate = new Map<string, Set<string>>();

  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    // 🔴 강사 계정은 자기 출석부로만 저장한다(셀 저장과 같은 판정, 원장 2026-09-17).
    if (scopeTeacherId !== null && scopeTeacherId !== user.id) return { error: SCOPE_INVALID_MESSAGE };
    const today = kstToday();
    // 담당 반은 **날짜마다** 다를 수 있다(그날 위임, 0173a) → 날짜별로 병렬 조회(B4).
    // 수강 여부는 기간이라 한 번에 받아 칸마다 JS로 판정한다(날짜별 쿼리 반복 금지).
    const rangeFacts = await settle(Promise.all([
      Promise.all(
        dates.map(async (d) => [d, await userTaughtClassSet(supabase, user.id, d, true)] as const),
      ),
      // 수강 이력 전부(날짜 거름 없음)라 청크 안에서도 1000행을 넘을 수 있다(B2) — 페이지까지 나눈다(수정 계획 P1-A).
      fetchAllPagedInChunks<{ class_id: string; student_id: string; start_date: string | null; end_date: string | null }>(
        studentIds,
        (chunk, from, to) =>
          supabase
            .from("enrollments")
            .select("id, class_id, student_id, start_date, end_date")
            .in("class_id", classIds)
            .in("student_id", chunk)
            .order("id")
            .range(from, to),
      ),
    ]));
    if (!rangeFacts) return { error: LOOKUP_FAILED };
    const [teachingByDate, enrollments] = rangeFacts;
    const teaching = new Map(teachingByDate);
    for (const [d, set] of teachingByDate) rangeTeachingByDate.set(d, set);
    const spans = new Map<string, { start: string | null; end: string | null }[]>();
    for (const e of enrollments) {
      const k = `${e.student_id}::${e.class_id}`;
      const list = spans.get(k) ?? [];
      list.push({ start: e.start_date, end: e.end_date });
      spans.set(k, list);
    }
    // 수강 판정은 **그 칸의 날짜 기준** — 반이동·종강 학생의 그날 기록을 막지 않는다(셀 액션과 동일 의미).
    const enrolledOn = (c: RangeCell) =>
      (spans.get(`${c.studentId}::${c.classId}`) ?? []).some(
        (s) => (!s.start || s.start <= c.sessionDate) && (!s.end || s.end >= c.sessionDate),
      );
    // 🔴 보강 예약된 학생(0264a)은 수강행이 없어도 그날 그 반의 칸 — 단건·일괄 게이트와 같은 문(적대 리뷰 2026-09-14).
    const reservedKeys = await reservedCellKeys(
      user.tenantId,
      cells.filter((c) => !enrolledOn(c)).map((c) => ({ studentId: c.studentId, classId: c.classId, date: c.sessionDate })),
    );
    // 수업 나누기(0351a) — 날짜마다 다르다(단건·일괄과 같은 판정 · 예전엔 범위만 빠져 있었다).
    const splitByDate = new Map(
      await Promise.all(dates.map(async (d) => [d, await splitIntoKeys(classIds, d)] as const)),
    );
    const rkey = (c: RangeCell) => `${c.studentId}::${c.classId}::${c.sessionDate}`;
    const basis = (c: RangeCell) =>
      enrolledOn(c) ||
      (splitByDate.get(c.sessionDate)?.has(`${c.studentId}::${c.classId}`) ?? false) ||
      reservedKeys.has(reservedCellKey({ studentId: c.studentId, classId: c.classId, date: c.sessionDate }));
    const inScope = cells.filter(
      (c) => isWithinAttendanceEditWindow(c.sessionDate, today) && (teaching.get(c.sessionDate)?.has(c.classId) ?? false),
    );
    // native 보강 참여 — 다른 근거가 없는 칸만, **한 번에**(기간 조회) 묻는다(칸마다 왕복 금지).
    const native = await nativeWriteKeys(inScope.filter((c) => !basis(c)));
    rangeNativeUnknown = native.error;
    // 등급은 판정 한 벌(writeEligibility)로 — 기록 유무는 아직 모르니 "있다"고 보고 정정 후보로 싣는다(아래에서 고칠 행이 없으면 뺀다).
    rangeCorrectOnly = new Set(
      inScope
        .filter((c) => writeEligibility({
          enrolled: enrolledOn(c),
          reserved: reservedKeys.has(reservedCellKey({ studentId: c.studentId, classId: c.classId, date: c.sessionDate })),
          splitInto: splitByDate.get(c.sessionDate)?.has(`${c.studentId}::${c.classId}`) ?? false,
          native: native.keys.has(rkey(c)),
          hasRecord: true,
        }) !== "create")
        .map(rkey),
    );
    allowed = inScope;
    if (allowed.length === 0) {
      // 조용한 0건 금지 — 가장 흔한 사유(기간)를 그대로 말해 준다.
      const late = cells.find((c) => !isWithinAttendanceEditWindow(c.sessionDate, today));
      return { error: late ? attendanceLockMessage(late.sessionDate, today) : "담당 반 수강생이 아니어서 기록할 수 없습니다" };
    }
  }

  /**
   * 🔴 강사 전체 보기에서 온 범위(원장 제보 2026-09-11) — 시수는 **그 강사 몫 행에만** 나눈다(셀 저장과 같은
   *    `planDayCellUnits`). 몫은 서버가 DB로 다시 판정한다(`loadScopeFacts`·`ownsAttendanceSlot`, #77).
   * ⚠️ 그 달에 그 반을 안 맡은 강사의 칸 · 그 강사 몫 행이 하나도 없는 칸(강사 보기의 빗금 칸)은 **그 칸만**
   *    건너뛴다(범위 규약 — 한 칸 때문에 전부 거절하지 않는다). 전부 걸리면 사유를 말한다.
   * ⚠️ 판정 재료는 **걸러진 칸**(`allowed`)에서 뽑아 아래 기존 기록 조회와 같은 `Promise.all`로 받는다(B4 — 직렬 왕복
   *    금지). 🔴 **지우기(status=null)에도 받는다**(원장 2026-09-12) — 자리(JJ·랩실) 행을 남기려면 어느 행이 자리인지
   *    알아야 한다. 종전엔 "나눌 시수가 없다"는 이유로 안 받아서 범위 지우기가 자리 기록까지 지웠다.
   */
  const scopedClassSet = scopeTeacherId ? new Set(input.scopeClassIds ?? classIds) : null;
  const isScoped = (c: RangeCell) => !!scopedClassSet?.has(c.classId);
  const scopedForFacts = allowed.filter(isScoped);

  const wanted = new Set(allowed.map((c) => `${c.studentId}::${c.classId}::${c.sessionDate}`));
  // 기존 기록 — (학생×반×날짜) 교차곱으로 받아 **정확한 칸만** JS로 골라낸다(칸마다 쿼리 금지).
  // 🔴 반드시 **페이지네이션**할 것: 교차곱이라 300칸 범위도 수천 행을 부를 수 있고, 그냥 청크만 하면
  //    PostgREST가 1000행에서 **조용히 자른다**(#54). 잘리면 있는 행을 못 찾아 update 대신 insert →
  //    같은 (학생·반·날짜)에 중복 출결이 쌓인다(시수·급여의 재료가 오염된다).
  //    페이지가 흔들리지 않도록 order에 unique tie-break(id)를 함께 건다.
  // 대신 보강 귀속(0316a) — 강사 보기 범위 저장의 몫 판정 재료. 칸이 있을 때만(#95).
  const rangeTaughtBy = scopedForFacts.length > 0 ? await taughtByColumnReady().catch(() => false) : false;
  const [existingRows, scopeFacts] = await Promise.all([
    fetchAllPagedInChunks<{
      id: string;
      class_id: string;
      student_id: string;
      session_date: string;
      slot_start: string | null;
      /** 자리 시수 행 표식(0208a) — 강사 보기의 몫 판정(`ownsAttendanceSlot`)이 본다. */
      seat_label: string | null;
      /** 자리 문 표식(0212a) — JJ는 `seat_label`이 없어 이게 유일한 자리 근거일 수 있다(리뷰 2026-09-12). */
      recorded_via: string | null;
      recorded_at: string | null;
      /** 감사로그 "시수 … → …"용 — 이 저장이 덮어쓰는 칸의 **이전 값**은 여기 말고 되짚을 자리가 없다. */
      status: string;
      session_units: number | null;
      /** 빗금 칸 입력(원장 2026-09-14)이 기존 메모 끝에 `대신 입력` 한 줄을 붙인다 — 덮지 않으려면 지금 메모가 필요하다. */
      note: string | null;
      /** 대신 보강 귀속 강사(0316a) — 강사 보기 몫 판정 재료. 칸이 없으면 안 읽는다. */
      taught_by?: string | null;
    }>(studentIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        // ⚠️ **한 줄로 둘 것** — 구조 가드(`scoped-split-wiring.test.ts`)가 이 줄에서 자리 표식(seat_label)을 확인한다.
        .select((rangeTaughtBy ? "id, class_id, student_id, session_date, slot_start, seat_label, recorded_via, recorded_at, status, session_units, note, taught_by" : "id, class_id, student_id, session_date, slot_start, seat_label, recorded_via, recorded_at, status, session_units, note") as "id, class_id, student_id, session_date, slot_start, seat_label, recorded_via, recorded_at, status, session_units, note")
        .in("session_date", dates)
        .in("class_id", classIds)
        .in("student_id", chunk)
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    scopedForFacts.length > 0
      ? loadScopeFacts(
          supabase,
          scopedForFacts.map((c) => ({ classId: c.classId, date: c.sessionDate })),
        ).catch((e: unknown) => {
          console.error("[attendance] 강사 보기 판정 재료 조회 실패 — 저장하지 않습니다:", e);
          return null;
        })
      : null,
  ]);
  const mine = existingRows.filter((r) => wanted.has(`${r.student_id}::${r.class_id}::${r.session_date}`));
  const CHUNK = 100;

  /**
   * 칸(학생·반·날짜)마다 **교시별 최신 1행**. 청크별 desc 정렬이라 각 (칸,교시)의 첫 행이 최신이다
   * (`pickSaveTargets`의 교시 미지정 가지와 **같은 규칙** — 출석부 한 칸 = 그날 하나의 사실).
   * 🔴 종전엔 칸당 **한 행**만 고쳐서, 교시가 여럿인 날은 나머지 교시가 옛 상태·옛 시수로 남았다
   *    (범위로 결석을 되돌려도 한 교시만 돌아오는 꼴). 단건 저장·반별 폼과 규칙을 맞춘다.
   * ⚠️ 지우기 갈래도 이 대상 선정을 쓴다(빗금 칸 판정) — 그래서 두 갈래보다 **앞**에 온다.
   */
  const cellKeyOf = (c: RangeCell) => `${c.studentId}::${c.classId}::${c.sessionDate}`;
  /** 행 id → 저장 전 상태·시수(감사로그 "시수 … → …"). 위 조회가 이미 실어 온 값이라 추가 왕복이 없다. */
  const rowFactsById = new Map<string, { status: string; units: number | null }>(
    mine.map((r) => [r.id, { status: r.status, units: r.session_units }]),
  );
  const cellSlotRows = new Map<string, DayTargetRow[]>();
  const seenSlot = new Set<string>();
  for (const r of mine) {
    const k = `${r.student_id}::${r.class_id}::${r.session_date}`;
    const slotKey = `${k}::${r.slot_start ? String(r.slot_start).slice(0, 5) : "DAY"}`;
    if (seenSlot.has(slotKey)) continue;
    seenSlot.add(slotKey);
    (cellSlotRows.get(k) ?? cellSlotRows.set(k, []).get(k)!).push({
      id: r.id,
      slot_start: r.slot_start,
      seat_label: r.seat_label,
      recorded_via: r.recorded_via,
      taught_by: r.taught_by ?? null,
    });
  }

  // 강사 전체 보기에서 온 범위 — 판정 재료(`scopeFacts`)는 위 기존 기록 조회와 함께 받아 두었다(B4).
  let scopeShare: ScopeShare | null = null;
  let notTaught = 0;
  let noneOwned = 0;
  if (scopeTeacherId && scopedForFacts.length > 0) {
    // 🔴 몫을 못 가리면 저장하지 않는다 — 스코프 없이 나누면 남의 교시로 시수가 새는 바로 그 버그가 난다.
    if (!scopeFacts) return { error: SCOPE_LOAD_FAILED_MESSAGE };
    const facts = scopeFacts;
    const before = allowed.length;
    allowed = allowed.filter(
      (c) => !isScoped(c) || scopeTeaches(facts.get(c.classId), scopeTeacherId, c.sessionDate),
    );
    notTaught = before - allowed.length;
    // ⚠️ 날짜로는 거르지 않는다(셀 저장과 같은 규약, 원장 2026-09-17 저녁) — 보강은 원래 수업 요일 밖에도 있다.
    // 판정기는 받아 둔 재료로만 만든다 — 추가 조회 없음(담임 시작일은 안 읽는다, `buildScopeOwner` 주석).
    scopeShare = buildScopeShare({ teacherId: scopeTeacherId, facts });
  }
  /** 칸마다 몫 판정 — 스코프 밖 칸(반별 보기·보강 묶음)은 null이라 종전과 같은 답이다. */
  const ownerOf = (c: RangeCell): ((row: DayTargetRow) => boolean) | null => {
    const s = isScoped(c) ? scopeShare : null;
    return s ? (r) => s(c.classId, c.sessionDate, r) === "mine" : null;
  };
  /** 칸마다 자리(JJ·랩실) 판정 — 강사 보기의 채우기·지우기는 그 행을 안 건드린다(원장 2026-09-12). */
  const seatOf = (c: RangeCell): ((row: DayTargetRow) => boolean) | null => {
    const s = isScoped(c) ? scopeShare : null;
    return s ? (r) => s(c.classId, c.sessionDate, r) === "seat" : null;
  };
  /**
   * 빗금 칸(제 몫 행 0) 판정 — 셀 저장과 **같은 함수**(`planScopedDay`, 원장 2026-09-14). 스코프 밖 칸은 null(종전 경로).
   * 자리뿐 = 거절 · 다른 선생님 교시 기록 = 채우기는 상태만 옮기기, 지우기는 거절.
   */
  const scopedPlanOf = (c: RangeCell, clearing: boolean) => {
    const s = isScoped(c) ? scopeShare : null;
    if (!s) return null;
    return planScopedDay({
      targets: cellSlotRows.get(cellKeyOf(c)) ?? [],
      share: (r) => s(c.classId, c.sessionDate, r),
      clearing,
      ghostIntent: ghostIntentKeys.has(cellKeyOf(c)),
      taken: (r) => s.takenSeat?.(c.classId, c.sessionDate, r) === true,
    });
  };
  /** 거절 사유별 칸 수 — 전부 걸렸을 때 격자가 그 칸에 하는 말과 같은 문장을 고른다. */
  const rejected: Record<ScopedRejectReason, number> = { seatOnly: 0, stale: 0, seatTaken: 0 };
  const rejectMessage = () => SCOPED_REJECT_MESSAGE[rejected.stale > 0 ? "stale" : rejected.seatTaken > 0 ? "seatTaken" : "seatOnly"];
  /** 행 id → 저장 전 메모 — 빗금 칸 입력이 기존 메모 끝에 `대신 입력` 한 줄을 붙인다(추가 왕복 없음). */
  const noteById = new Map(mine.map((r) => [r.id, r.note]));

  // 지우기 — 그 칸의 기록을 전부(정정 이력 포함) 삭제. 셀 액션의 '지우기'와 같은 계약.
  if (status === null) {
    // 🔴 보강 보고서가 가리키는 반(앵커)의 칸이 섞여 있으면 **범위 전체를** 지우지 않는다(셀 지우기와 같은 게이트, 설계 g) —
    //    일부만 지우고 "몇 칸 빠졌다"고 하면 어느 칸이 보고서에 묶였는지 격자에서 알 수 없다.
    //    예외도 셀 지우기와 같다 — 학부모에게 발송된 보강 보고서의 칸은 지우고 보고서는 그대로 둔다(원장 2026-11-05).
    const anchorCheck = await makeupAnchorDeleteCheck(
      user.tenantId,
      allowed.map((c) => ({ studentId: c.studentId, classId: c.classId, date: c.sessionDate })),
      { allowSent: true },
    );
    if (anchorCheck.block) return { error: anchorCheck.block };
    /**
     * 🔴 강사 보기의 지우기는 **자리(JJ·랩실) 행을 남긴다**(원장 2026-09-12) — 그 행은 자리 출석부(JJ실)의 진실이다.
     *    본인 교시만 삭제한다. 빗금 칸은 채우기와 같은 문장으로 건너뛴다.
     * ⚠️ 이력 행까지 지우므로 대상은 `cellSlotRows`(교시별 최신)가 아니라 **그 칸의 모든 행**이다.
     */
    const rowsByCell = new Map<string, typeof mine>();
    for (const r of mine) {
      const k = `${r.student_id}::${r.class_id}::${r.session_date}`;
      (rowsByCell.get(k) ?? rowsByCell.set(k, []).get(k)!).push(r);
    }
    const ids: string[] = [];
    let skippedSeatRows = 0;
    /** 행을 실제로 지우는 칸(`anchorCellKey`) — 감사로그의 '발송된 보강 보고서는 그대로 둔 칸' 수를 여기서 센다(건너뛴 칸·빈칸 제외). */
    const clearedCells = new Set<string>();
    const anchorKeyOf = (c: (typeof allowed)[number]) => anchorCellKey({ studentId: c.studentId, classId: c.classId, date: c.sessionDate });
    allowed = allowed.filter((c) => {
      const plan = scopedPlanOf(c, true);
      if (plan?.kind === "reject") {
        noneOwned += 1;
        rejected[plan.reason] += 1;
        return false;
      }
      // 🔴 지울 제 기록이 없는 칸(남의 교시·자리 기록뿐) — 남의 기록은 지우지 않는다. 빈칸을 지운 것이라 적용 칸으로 센다(2026-09-17).
      if (plan?.kind === "skip") return true;
      const { write, seat } = splitOutSeatRows(rowsByCell.get(cellKeyOf(c)) ?? [], seatOf(c), ownerOf(c));
      for (const r of write) ids.push(r.id);
      if (write.length > 0) clearedCells.add(anchorKeyOf(c));
      skippedSeatRows += seat.length;
      return true;
    });
    const keptSentCleared = [...clearedCells].filter((k) => anchorCheck.keptCells.has(k)).length;
    if (allowed.length === 0 && notTaught + noneOwned > 0) {
      // 조용한 0건 금지 — 격자가 그 칸에 하는 말과 같은 문장으로 알린다(채우기 갈래와 같은 규약).
      return { error: notTaught > 0 ? SCOPE_NOT_TAUGHT_MESSAGE : rejectMessage() };
    }
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase.from("attendance_records").delete().in("id", ids.slice(i, i + CHUNK));
      if (error) return { error: attendanceDbWhy(error, "attendance.range.clear", "delete") };
    }
    /**
     * 감사로그 — **범위 지우기**. 단건 지우기와 같은 이유로 이 파일에서 가장 값진 줄이고, 규모까지 크다
     * (한 번에 최대 300칸 + 그 칸의 정정 이력 행까지 통째로 사라진다). 지워진 행은 `recorded_by`를
     * 데리고 가므로 여기 말고는 되짚을 자리가 0이다.
     */
    if (ids.length > 0) {
      // 🔴 위쪽 `classIds`/`studentIds`는 **거르기 전(cells) 목록**이다 — 실제로 지운 칸(`allowed`)에서 다시 뽑는다.
      const wroteClassIds = [...new Set(allowed.map((c) => c.classId))];
      await logAction({
        action: "attendance_range_clear",
        targetType: "attendance",
        metadata: {
          ...(wroteClassIds.length === 1 ? { classId: wroteClassIds[0] } : {}),
          classIds: wroteClassIds,
          dates: [...new Set(allowed.map((c) => c.sessionDate))].sort(),
          count: allowed.length,
          rows: ids.length,
          blocked: cells.length - allowed.length,
          studentIds: [...new Set(allowed.map((c) => c.studentId))],
          // 강사 전체 보기에서 온 지우기 — 자리(JJ·랩실) 행은 남겼다(원장 2026-09-12).
          ...(scopeTeacherId ? { scopeTeacherId } : {}),
          ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}),
          // 발송된 보강 보고서의 칸을 지웠다 — 보고서는 그대로 두었다(원장 2026-11-05). 실제로 행을 지운 칸만 센다.
          ...(keptSentCleared > 0 ? { keptSentMakeupReports: keptSentCleared } : {}),
          ...backdatedFlag(allowed.map((c) => c.sessionDate), kstToday()),
        },
      });
    }
    // 보강 예약 되돌림(0264a) — 범위로 지운 칸 중 이행된 예약이 있으면 `reserved`로 되돌린다(fail-soft).
    // 🔴 발송된 보강 보고서의 칸은 뺀다(셀 지우기와 같은 이유 — 되돌리면 '보강 진행 여부 확인'을 눌러 칸이 다시 생긴다).
    await completeMakeupReservations(
      { tenantId: user.tenantId },
      allowed
        .filter((c) => !anchorCheck.keptCells.has(anchorKeyOf(c)))
        .map((c) => ({ studentId: c.studentId, classId: c.classId, date: c.sessionDate, status: null })),
    );
    revalidateAttendanceSurfaces();
    return { ok: true, applied: allowed.length, blocked: cells.length - allowed.length };
  }

  // 칸마다 시수 배분 계획 — 스코프 밖 칸(반별 보기·보강 묶음)은 owns=null이라 종전과 같은 답이다.
  const plans = new Map<string, DayUnitsPlan>();
  /** 빗금 칸 입력 — 다른 선생님 교시 행에 **상태만** 옮길 칸(원장 2026-09-14). 시수 계획이 없다(결정 ①). */
  const transferCells = new Set<string>();
  /** 제 몫 행이 없는 칸 — 남의 교시·자리 행은 두고 제 행을 새로 만든다(셀 저장 `createOwn`과 같은 규칙, 원장 2026-09-17). */
  const createCells = new Set<string>();
  allowed = allowed.filter((c) => {
    const k = cellKeyOf(c);
    const targets = cellSlotRows.get(k);
    // 판정이 새 칸보다 **먼저** — 빗금 칸으로 알고 보낸 칸의 기록이 그 사이 사라졌으면 새 행(제 몫·시수)을 만들지 않는다
    // (stale, 셀 저장과 같은 규칙 — 적대 재리뷰 2026-09-14). 스코프 밖 칸은 null이라 종전대로 새 칸이다.
    const scoped = scopedPlanOf(c, false);
    if (scoped?.kind === "reject") {
      noneOwned += 1;
      rejected[scoped.reason] += 1;
      return false;
    }
    if (!targets) return true; // 새 칸 — 아래 insert(나눌 행이 없다)
    if (scoped?.kind === "create") {
      createCells.add(k);
      return true;
    }
    if (scoped?.kind === "transfer") {
      transferCells.add(k);
      return true;
    }
    const plan = planDayCellUnits({
      targets,
      owns: ownerOf(c),
      unitsVal: unitsProvided ? unitsVal ?? (isDefaultUnitsRaw(input.units) ? null : 1) : undefined,
    });
    if (!plan.ok && plan.reason === "noneOwned") {
      noneOwned += 1;
      return false;
    }
    plans.set(k, plan);
    return true;
  });
  // 정정만 허가된 칸 — 고칠 행이 없거나(새 칸) 제 몫 행을 새로 만들 칸이면 뺀다(결정 #5 · 단건·일괄과 같은 규칙).
  let correctOnlyDropped = 0;
  if (rangeCorrectOnly) {
    const correctOnly = rangeCorrectOnly;
    const before = allowed.length;
    allowed = allowed.filter((c) => {
      const k = cellKeyOf(c);
      return !blockedByCorrectOnly(correctOnly.has(k) ? "correct" : "create", !cellSlotRows.has(k) || createCells.has(k));
    });
    correctOnlyDropped = before - allowed.length;
    // native를 확인하지 못해 새 행 칸을 못 열었다 — 요청 전체를 저장하지 않는다(결정 #5). 정정만인 칸은 영향 없음.
    if (correctOnlyDropped > 0 && rangeNativeUnknown) return { error: rangeNativeUnknown };
  }
  if (allowed.length === 0 && correctOnlyDropped > 0 && notTaught + noneOwned === 0) {
    return { error: CORRECT_ONLY_MESSAGE };
  }
  if (allowed.length === 0 && notTaught + noneOwned > 0) {
    // 조용한 0건 금지 — 격자가 그 칸에 하는 말과 같은 문장으로 알린다.
    return { error: notTaught > 0 ? SCOPE_NOT_TAUGHT_MESSAGE : rejectMessage() };
  }

  const nowIso = new Date().toISOString();
  /**
   * 칸마다 **쓰는 행** — 자리(JJ·랩실) 행은 뺀다(원장 2026-09-12, `splitOutSeatRows`). 스코프 밖 칸은 전부(종전).
   * ⚠️ 빗금 칸 거절은 위 `plans`가 이미 했다 — 여기서 빼는 건 "쓰지 않을 행"뿐이다.
   */
  const writeIdsOf = new Map<string, string[]>();
  let skippedSeatRows = 0;
  for (const c of allowed) {
    const k = cellKeyOf(c);
    const targets = cellSlotRows.get(k);
    if (!targets || createCells.has(k)) continue;
    const { write, seat } = splitOutSeatRows(targets, seatOf(c), ownerOf(c));
    writeIdsOf.set(
      k,
      write.map((r) => r.id),
    );
    skippedSeatRows += seat.length;
  }
  const updateIds = allowed.flatMap((c) => writeIdsOf.get(cellKeyOf(c)) ?? []);
  const inserts = allowed.filter((c) => !cellSlotRows.has(cellKeyOf(c)) || createCells.has(cellKeyOf(c)));

  // 입력자 표식은 **칸의 날짜마다** — 예전엔 첫 날짜(`dates[0]`) 하나로 모든 날을 찍어, 위임·담임 인계가 걸친 범위에서
  // 다른 날 칸이 데스크/강사로 잘못 남았다(수정 계획 P1-A 4-5). 판정은 `resolveWriteVia`와 같다(그날 담당 반이면 teacher).
  // 걸러진 칸의 날짜만 — 강사 게이트가 이미 읽은 날은 다시 묻지 않는다(관리자는 여기서 날짜별 병렬 한 번, B4).
  const viaDatesToLoad = [...new Set(allowed.map((c) => c.sessionDate))].filter((d) => !rangeTeachingByDate.has(d));
  if (viaDatesToLoad.length > 0) {
    const loaded = await settle(
      Promise.all(viaDatesToLoad.map(async (d) => [d, await userTaughtClassSet(supabase, user.id, d, true)] as const)),
    );
    if (!loaded) return { error: LOOKUP_FAILED };
    for (const [d, set] of loaded) rangeTeachingByDate.set(d, set);
  }
  const rangeViaOf = (c: RangeCell): RecordedVia =>
    resolveStaffVia(rangeTeachingByDate.get(c.sessionDate)?.has(c.classId) === true);

  /** 빗금 칸 입력으로 실제로 상태를 옮긴 행 수 — 감사로그가 계획이 아니라 이 숫자를 쓴다(중간에 멈춰도). */
  let proxyWritten = 0;
  if (updateIds.length > 0) {
    /**
     * 🔴 명시한 시수는 **그날 합계**다(원장 2026-09-01 확정) — 교시가 여럿인 칸은 나눠 담는다.
     *    단건 저장(setAttendanceCell)과 **같은 규칙**(`planDayCellUnits`)이어야 타이핑과 붙여넣기가 다른 숫자를 남기지 않는다.
     * 명시한 1은 합계 1이고, 숫자를 입력하지 않은 기본값만 교시별 기본이다.
     * ⚠️ 교시당 0.1도 안 되게 쪼개야 하는 칸(`indivisible`)은 **시수만 건드리지 않는다**(상태는 넣는다) — 범위 작업은
     *    수십 칸을 한 번에 다루므로 한 칸 때문에 전부 거절하면 더 나쁘다. 값을 지어내지도 않는다.
     * ⚠️ 강사 보기에서 온 칸의 **남의 교시 행**(자리 JJ·다른 선생님)도 시수를 그대로 두고 상태만 받는다.
     * 기준이 행마다 달라 (via, 시수)로 묶어 배치한다 — 칸이 많아도 문장 수는 몇 개다.
     */
    const byKey = new Map<string, { via: RecordedVia; units: number | null | undefined; ids: string[] }>();
    /** 빗금 칸 입력 행 — 반의 쓰기 문(via)마다 모아 메모 비교 조건으로 쓴다(`writeProxyRows`, 원장 2026-09-14). */
    const proxyByVia = new Map<RecordedVia, { id: string; note: string | null }[]>();
    for (const c of allowed) {
      const k = cellKeyOf(c);
      // 자리(JJ·랩실) 행을 뺀 대상 — `cellSlotRows`를 그대로 쓰면 자리 행이 상태·입력자를 받는다(원장 2026-09-12).
      const ids = writeIdsOf.get(k) ?? [];
      if (ids.length === 0) continue;
      // 범위 채우기는 월간 격자 전용 — 데스크 게이트를 걸지 않는다(오클릭 결석을 여기서 되돌린다).
      const via = rangeViaOf(c);
      const plan = plans.get(k);
      const moving = transferCells.has(k);
      ids.forEach((id) => {
        if (moving) {
          // 🔴 빗금 칸 입력 — 시수 묶음에 넣지 않는다(상태만). 메모는 아래 `writeProxyRows`가 붙인다.
          (proxyByVia.get(via) ?? proxyByVia.set(via, []).get(via)!).push({ id, note: noteById.get(id) ?? null });
          return;
        }
        // 계획에 없는 행 = 시수 그대로(시수를 안 보낸 채우기 · 못 나눈 칸 · 남의 교시 행).
        const units = plan?.ok && plan.units.has(id) ? (plan.units.get(id) as number | null) : undefined;
        const key = `${via}::${units === undefined ? "keep" : String(units)}`;
        (byKey.get(key) ?? byKey.set(key, { via, units, ids: [] }).get(key)!).ids.push(id);
      });
    }
    for (const { via, units, ids } of byKey.values()) {
      const patch: Record<string, unknown> = withVia(
        { status, recorded_by: user.id, recorded_at: nowIso },
        via,
      );
      if (units !== undefined) patch.session_units = units;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const wrote = await updateWithVia(supabase, patch, ids.slice(i, i + CHUNK));
        if (wrote.error) return { error: wrote.error };
      }
    }
    for (const [via, rows] of proxyByVia) {
      // 🔴 빗금 칸 입력 — 상태·입력자만(시수 키 없음) + 기존 메모 끝에 `대신 입력` 한 줄(셀 저장과 같은 함수, 원장 2026-09-14).
      const patch: Record<string, unknown> = withVia({ status, recorded_by: user.id, recorded_at: nowIso }, via);
      for (let i = 0; i < rows.length; i += CHUNK) {
        const wrote = await writeProxyRows(supabase, patch, rows.slice(i, i + CHUNK), user.displayName);
        proxyWritten += wrote.written;
        if (wrote.error) {
          // 앞 청크까지 옮긴 행이 있으면 감사로그를 남기고 멈춘다(셀 저장과 같은 이유).
          if (proxyWritten > 0) {
            await logAction({
              action: "attendance_range",
              targetType: "attendance",
              metadata: {
                classIds: [...new Set(allowed.map((c) => c.classId))],
                dates: [...new Set(allowed.map((c) => c.sessionDate))].sort(),
                status,
                ...(scopeTeacherId ? { scopeTeacherId } : {}),
                ghostTransfer: proxyWritten,
                partial: true,
                ...backdatedFlag(allowed.map((c) => c.sessionDate), kstToday()),
              },
            });
          }
          return { error: wrote.error };
        }
      }
    }
  }
  // 수학 자동 시수 — **새 칸** + 시수를 안 고른 채우기만(auto-units.ts). 날짜가 칸마다 달라 (반,날짜)로 찾는다.
  // 범위의 각 칸은 하루 합이며, 나눠 맡는 날은 아래에서 제 교시별로 조회한다.
  const rangeWantsAuto = inserts.length > 0 && autoUnitsApply({ rawUnits: input.units, slotStart: null, status });
  const rangeAuto = rangeWantsAuto
    ? await resolveAutoUnits(supabase, inserts.flatMap((c) => {
      const slots = isScoped(c) && scopeTeacherId ? scopeInsertSlots(scopeFacts?.get(c.classId), scopeTeacherId, c.sessionDate) : null;
      return slots ? slots.map((slotStart) => ({ classId: c.classId, date: c.sessionDate, slotStart })) : [{ classId: c.classId, date: c.sessionDate }];
    }))
    : new Map<string, number>();
  // 🔴 친 숫자가 먼저 — `newRowUnits`가 원문을 다시 본다(auto-units.ts). 새 행·응답·감사로그가 이 한 값을 쓴다.
  const rangeUnitsOf = (c: RangeCell) =>
    newRowUnits(
      input.units,
      unitsVal,
      rangeWantsAuto ? (rangeAuto.get(autoUnitsKey(c.classId, c.sessionDate)) ?? null) : undefined,
    );
  /**
   * 새 행 — 칸마다 한 행("그날 전체"), 단 강사 보기 칸이 **다른 선생님과 나눠 맡는 날**이면 제 교시마다 한 행
   * (셀 저장과 같은 규칙 `scopeInsertSlots`, 원장 2026-09-17 — 그날 전체 행은 남의 출석부에도 같은 숫자로 선다).
   * 친 숫자는 그 교시들에 합계로 나누고, 못 나누는 값(`indivisible`)은 범위 규약대로 시수를 비운다(교시마다 기본).
   */
  const insertRows: Record<string, unknown>[] = [];
  let rangeCreatedSlotRows = 0;
  /** 칸 → 제 교시별로 새로 저장한 시수의 합. */
  const slotUnitsByCell = new Map<string, number>();
  for (const c of inserts) {
    const via = rangeViaOf(c);
    const base = {
      tenant_id: user.tenantId,
      class_id: c.classId,
      student_id: c.studentId,
      session_date: c.sessionDate,
      status,
      recorded_by: user.id,
    };
    const slots =
      isScoped(c) && scopeTeacherId ? scopeInsertSlots(scopeFacts?.get(c.classId), scopeTeacherId, c.sessionDate) : null;
    if (!slots) {
      insertRows.push(withVia({ ...base, session_units: rangeUnitsOf(c).units }, via));
      continue;
    }
    const plan = planDayCellUnits({
      targets: slots.map((start, i) => ({ id: `new-${i}`, slot_start: start })),
      owns: null,
      unitsVal: unitsProvided ? unitsVal ?? (isDefaultUnitsRaw(input.units) ? null : 1) : undefined,
    });
    let slotUnits = 0;
    slots.forEach((start, i) => {
      const units = rangeWantsAuto ? rangeAuto.get(autoUnitsKey(c.classId, c.sessionDate, start)) ?? null : plan.ok ? (plan.units.get(`new-${i}`) ?? null) : null;
      slotUnits += units ?? 1;
      insertRows.push(withVia({ ...base, slot_start: start, session_units: units }, via));
      rangeCreatedSlotRows += 1;
    });
    slotUnitsByCell.set(cellKeyOf(c), slotUnits);
  }
  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const wrote = await insertManyWithVia(supabase, insertRows.slice(i, i + CHUNK));
    if (wrote.error) return { error: wrote.error };
  }

  /**
   * 감사로그 — 범위 채우기도 **한 줄 요약**(일괄과 같은 규약). 다른 점은 날짜가 칸마다 다르다는 것뿐이라
   * `dates`를 함께 싣는다. 범위는 가로로도 끌리므로 **지난 날짜가 섞이기 쉬운 경로**다(소급 표식이 특히 유효).
   */
  const rangeClassIds = [...new Set(allowed.map((c) => c.classId))];
  /**
   * 감사로그 "시수 3칸 6 → 4.5" — 범위는 칸이 여럿이라 **시수가 실제로 바뀐 칸**만 세고 그 칸들의 합을 적는다.
   * 🔴 새로 만든 칸은 빠진다(이전 값이 없어 '정정'이 아니다 — 건수는 `created`가 이미 말한다).
   * 🔴 칸마다 재는 집합은 셀 저장과 **같은 규칙**(배분 계획의 수신 행)이다 — 갈리면 같은 일이 경로마다
   *    다른 숫자를 남긴다. ⚠️ 재료가 빠진 칸은 건너뛴다(값을 지어내지 않는다).
   */
  let unitsChangedCells = 0;
  let prevUnitsSum = 0;
  let nextUnitsSum = 0;
  if (unitsProvided) {
    for (const c of allowed) {
      const plan = plans.get(cellKeyOf(c));
      if (!plan?.ok) continue;
      const cellRows = [...plan.units.keys()].map((id) => rowFactsById.get(id));
      if (cellRows.some((r) => !r)) continue;
      const changed = unitsAuditFields({
        rows: cellRows as { status: string; units: number | null }[],
        status,
        unitsVal: unitsVal ?? (isDefaultUnitsRaw(input.units) ? null : 1),
        // 범위는 그날 칸만 다룬다(교시 지정이 없다) — 셀 저장의 그날 칸 갈래와 같은 규약.
        spread: "split",
      });
      if (!changed) continue;
      unitsChangedCells += 1;
      prevUnitsSum = round1(prevUnitsSum + changed.prevUnits);
      nextUnitsSum = round1(nextUnitsSum + changed.nextUnits);
    }
  }
  await logAction({
    action: "attendance_range",
    targetType: "attendance",
    metadata: {
      ...(rangeClassIds.length === 1 ? { classId: rangeClassIds[0] } : {}),
      classIds: rangeClassIds,
      dates: [...new Set(allowed.map((c) => c.sessionDate))].sort(),
      status,
      count: allowed.length,
      created: inserts.length,
      // 강사 보기가 나눠 맡는 날 제 교시로 새로 만든 행 수(원장 2026-09-17) — 없으면 키도 없다.
      ...(rangeCreatedSlotRows > 0 ? { createdSlotRows: rangeCreatedSlotRows } : {}),
      blocked: cells.length - allowed.length,
      studentIds: [...new Set(allowed.map((c) => c.studentId))],
      // 친 시수는 **시수를 받는 칸이 있었을 때만** — 빗금 칸 입력뿐이면 저장 안 된 숫자가 로그에 남는다(적대 리뷰 2026-09-14).
      ...(unitsProvided && allowed.some((c) => !transferCells.has(cellKeyOf(c))) ? { units: unitsVal } : {}),
      // 🔴 **바뀌기 전·후 시수**(원장 2026-09-14) — 바뀐 칸이 있을 때만. 칸이 여럿이라 칸 수를 함께 적는다.
      ...(unitsChangedCells > 0
        ? { prevUnits: prevUnitsSum, nextUnits: nextUnitsSum, unitsChangedCells }
        : {}),
      // 강사 전체 보기에서 온 채우기 — 시수를 그 강사 몫 교시에만 나눴다(원장 제보 2026-09-11).
      ...(scopeTeacherId ? { scopeTeacherId } : {}),
      // 손대지 않고 둔 자리(JJ·랩실) 행 수(원장 2026-09-12) — 역검수용.
      ...(skippedSeatRows > 0 ? { skippedSeatRows } : {}),
      // 빗금 칸 입력 — 다른 선생님 교시 행에 상태만 옮긴 **행** 수(원장 2026-09-14). 셀 저장 로그와 같은 키·같은 단위.
      ...(proxyWritten > 0 ? { ghostTransfer: proxyWritten } : {}),
      // 수학 자동 시수가 들어간 새 칸(원장 2026-09-11) — 없으면 키도 없다.
      ...autoUnitsLogFields(
        inserts
          .filter((c) => !slotUnitsByCell.has(cellKeyOf(c)))
          .map((c) => rangeUnitsOf(c).auto)
          .filter((v): v is number => typeof v === "number"),
      ),
      ...backdatedFlag(allowed.map((c) => c.sessionDate), kstToday()),
    },
  });

  // 보강 예약 이행(0264a) — 범위로 쓴 칸 중 예약이 걸린 것((반·날짜)마다 한 번 조회). `created` = 이번에 새로 만든 행.
  const rangeCreated = new Set(inserts.map((c) => completionKey({ studentId: c.studentId, classId: c.classId, date: c.sessionDate })));
  await completeMakeupReservations(
    { tenantId: user.tenantId },
    allowed.map((c) => ({
      studentId: c.studentId,
      classId: c.classId,
      date: c.sessionDate,
      status,
      unitsExplicit: unitsProvided && !isDefaultUnitsRaw(input.units),
      created: rangeCreated.has(completionKey({ studentId: c.studentId, classId: c.classId, date: c.sessionDate })),
    })),
  );

  // G4: (반·날짜) 조합마다 '전원 기록 완료' 전이 검사 — 셀·일괄 액션과 동일. 백그라운드라 응답을 안 막는다.
  // ⚠️ 조합 수 상한: 한 달치를 통째로 끌면 (반×날짜)가 수백이 되어 백그라운드가 그만큼 쿼리를 돈다.
  //    넘치면 검사를 건너뛴다 — 알림 하나 못 보내는 것보다 서버를 붙잡는 게 나쁘다(다음 셀 저장 때 다시 걸린다).
  const pairs = [...new Set(allowed.map((c) => `${c.classId}::${c.sessionDate}`))];
  if (pairs.length <= NOTIFY_PAIR_LIMIT) {
    after(async () => {
      for (const p of pairs) {
        const [classId, date] = p.split("::");
        if (classId && date) {
          await notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date, actorId: user.id });
        }
      }
    });
  }
  if (!input.quiet) revalidateAttendanceSurfaces();
  return {
    ok: true,
    applied: allowed.length,
    blocked: cells.length - allowed.length,
    // 빗금 칸 입력으로 상태만 옮긴 칸 — 격자가 칠한 값의 성격을 서버와 맞춘다(grid-context writeMany).
    ...(transferCells.size > 0 ? { ghostCells: allowed.filter((c) => transferCells.has(cellKeyOf(c))) } : {}),
    // 상태만 바꾼 기존 칸도 실제 합계를 돌려준다. 결석 칸의 숨겨진 시수는 화면 값(0)으로 알 수 없다.
    ...(!unitsProvided || rangeWantsAuto
      ? {
          autoUnits: [
            ...(!unitsProvided ? allowed.flatMap((c) => {
              const key = cellKeyOf(c);
              const ids = writeIdsOf.get(key);
              if (!ids?.length || transferCells.has(key)) return [];
              const total = COUNTABLE_STATUSES.has(status)
                ? round1(ids.reduce((sum, id) => sum + (rowFactsById.get(id)?.units ?? 1), 0))
                : 0;
              return [{ studentId: c.studentId, classId: c.classId, sessionDate: c.sessionDate, units: total === 0 || total === 1 ? null : total }];
            }) : []),
            ...(rangeWantsAuto ? inserts.flatMap((c) => {
            // 🔴 제 교시로 새로 만든 칸 — 교시마다 기본(1)이라 칸 값은 행 수다(1은 null로 접는다). 그날 전체 한 행 기준
            //    `rangeUnitsOf`로 답하면 격자가 1로 굳어 새로고침 전까지 합계가 틀린다(적대 리뷰 2026-09-17).
            const n = slotUnitsByCell.get(cellKeyOf(c));
            if (n !== undefined) {
              return [{ studentId: c.studentId, classId: c.classId, sessionDate: c.sessionDate, units: n === 1 ? null : n }];
            }
            const ins = rangeUnitsOf(c);
            // 저장값 그대로(자동 판정을 탄 칸만) — 화면이 이 값으로 낙관값을 맞춘다.
            return ins.auto === undefined
              ? []
              : [{ studentId: c.studentId, classId: c.classId, sessionDate: c.sessionDate, units: ins.units }];
            }) : []),
          ],
        }
      : {}),
  };
}

/**
 * 보강(수업외) 학생 검색 — 출석 입력 화면 '+ 보강 학생 추가' 피커.
 *
 * 원스크린의 같은 이름 액션과 **의도적으로 분리**했다: 이 표면은 출결(=시수·급여 재료)을 쓰므로
 * 자기 게이트를 자기가 통과해야 한다(#77 — 화면이 아니라 액션이 게이트). 강사(scoped)는 담당 반일 때만
 * 검색할 수 있어, 남의 반 화면을 억지로 열어 학원 전체 명단을 훑는 경로를 막는다.
 * 퇴원생은 제외(보강 대상이 아님), 최대 20건.
 */
export async function searchMakeupStudents(
  classId: string,
  query: string,
  /** 보고 있는 수업일 — 그날 담당·위임인지로 검색을 연다. 없으면 오늘. */
  onDate?: string,
): Promise<{ id: string; name: string; label: string; englishName: string | null; school: string | null; grade: string | null }[]> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return [];
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return [];
  const q = query.trim().replace(/[,()]/g, " ").trim();
  if (!q || !classId) return [];
  const supabase = await createClient();
  const when = onDate && /^\d{4}-\d{2}-\d{2}$/.test(onDate) ? onDate : kstToday();
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    // 검색은 쓰기가 아니다 — 조회 실패는 "결과 없음"으로 닫힌다(strict면 던져 화면 검색이 멈춘다 · 4-1 리뷰).
    const myClassIds = await userTaughtClassSet(supabase, user.id, when);
    if (!myClassIds.has(classId)) return [];
  }
  const { data } = await supabase
    .from("students")
    .select("id, name, english_name, grade, school")
    .neq("status", "withdrawn")
    .or(`name.ilike.%${q}%,english_name.ilike.%${q}%`)
    .order("name", { ascending: true })
    .limit(20);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    englishName: s.english_name ?? null,
    school: s.school ?? null,
    grade: s.grade ?? null,
    label: schoolGradeLabel(s.school ?? null, s.grade ?? null),
  }));
}
