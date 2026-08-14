"use server";

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
} from "@/features/attendance/live/server/write-policy";
import type { RecordedVia } from "@/features/attendance/live/recorded-via";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
// 담당 반 판정 단일 소스(담당 반 ∪ 그날 위임 반) — classes.teacher_id를 직접 비교하지 말 것(0173a).
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { parseSessionUnits } from "../session-units";
import { hasSaveTarget, pickSaveTargets, type SaveTargets } from "../save-targets";
import {
  absenceMemo,
  appendMemo,
  hasMemoLine,
  makeupMemo,
  unitsAfterMakeup,
} from "@/features/onescreen/makeup-absence-link";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "../edit-window";
import { kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";

const STATUSES = ["present", "absent", "late", "excused", "makeup", "early_leave"] as const;
type Status = (typeof STATUSES)[number];

type Sb = Awaited<ReturnType<typeof createClient>>;

/** 0212a 컬럼이 없으면 빼고 재시도 — 출결 저장을 죽이지 않는다(#95). */
async function updateWithVia(
  supabase: Sb,
  patch: Record<string, unknown>,
  ids: string[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("attendance_records").update(patch).in("id", ids);
  if (!error) return { error: null };
  if (!isMissingViaColumn(error.message)) return { error: error.message };
  const rest = { ...patch };
  delete rest.recorded_via;
  const retry = await supabase.from("attendance_records").update(rest).in("id", ids);
  return { error: retry.error?.message ?? null };
}

async function insertWithVia(
  supabase: Sb,
  row: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("attendance_records").insert(row);
  if (!error) return { error: null };
  if (!isMissingViaColumn(error.message)) return { error: error.message };
  const rest = { ...row };
  delete rest.recorded_via;
  const retry = await supabase.from("attendance_records").insert(rest);
  return { error: retry.error?.message ?? null };
}

async function insertManyWithVia(
  supabase: Sb,
  rows: Record<string, unknown>[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("attendance_records").insert(rows);
  if (!error) return { error: null };
  if (!isMissingViaColumn(error.message)) return { error: error.message };
  const retry = await supabase.from("attendance_records").insert(
    rows.map((r) => {
      const rest = { ...r };
      delete rest.recorded_via;
      return rest;
    }),
  );
  return { error: retry.error?.message ?? null };
}

export type SaveAttendanceState = { error?: string; saved?: number } | undefined;

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
  const user = await getCurrentUser();
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
    note: string | null;
    homeworkRequired: boolean;
    homeworkDone: boolean;
    sessionUnits: number | null;
  };
  const rows: Row[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status:")) continue;
    const studentId = key.slice("status:".length);
    const status = String(value);
    if (!status) continue;
    if (!STATUSES.includes(status as Status)) continue;
    const existingIds = String(formData.get(`existing:${studentId}`) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const note =
      String(formData.get(`note:${studentId}`) ?? "").trim() || null;
    const homeworkRequired =
      String(formData.get(`homeworkRequired:${studentId}`) ?? "") === "true";
    const homeworkDone =
      String(formData.get(`homeworkDone:${studentId}`) ?? "") === "true";
    // 시수(배수, 0115a) — 빈 값·1 = 기본(null). 잘못된 입력은 행 단위로 즉시 반려.
    const parsedUnits = parseSessionUnits(String(formData.get(`units:${studentId}`) ?? ""));
    if (!parsedUnits.ok) {
      const name = String(formData.get(`name:${studentId}`) ?? "").trim();
      return { error: `${name || "학생"} 시수 입력 오류 — ${parsedUnits.error}` };
    }
    rows.push({
      studentId,
      status: status as Status,
      existingIds,
      note,
      homeworkRequired,
      homeworkDone,
      sessionUnits: parsedUnits.value,
    });
  }

  if (rows.length === 0) return { error: "저장할 출결 데이터가 없습니다" };

  // 수정 가능 기간 — 강사(scoped)는 세션일로부터 7일 이내만. 관리자 이상(full)은 제한 없음(원장 2026-07-21).
  // ⚠️ 화면에서만 잠그면 우회할 수 있다(#77) — 쓰기 경로 **양쪽**(이 액션과 setAttendanceCell)에 서버 게이트를 둔다.
  // ⚠️ 기준일은 항상 **KST 오늘**. 서버는 UTC라 new Date()로 재면 한국 새벽에 하루가 밀린다.
  const supabase = await createClient();

  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(date, kstToday())) {
      return { error: attendanceLockMessage(date, kstToday()) };
    }
    // ⚠️ 담당 반 강제 — 예전엔 이 액션에 **반 소유 검사가 아예 없었다**(셀 토글 setAttendanceCell에만 있었음).
    // RLS는 tenant 격리뿐이라, 강사가 폼을 직접 POST하면 학원 내 아무 반 출결이나 쓸 수 있었다
    // (2026-07-21 적대검증 미수리분 "출석부 scoped 검증 부재=보안·돈"). 아래 보강 추가로 **임의 학생**까지
    // 폼에 실을 수 있게 되므로, 그 문을 열기 전에 이 게이트를 먼저 닫는다(#77).
    // 담당 반 ∪ 그날 위임받은 반(0173a) — 결근 대체로 그 반을 맡은 강사는 출결도 찍어야 한다.
    const { all: myClassIds } = await getTeachingClassIds(supabase, user.id, date);
    if (!myClassIds.includes(classId)) return { error: "담당 반이 아닙니다" };
  }

  const nowIso = new Date().toISOString();
  const via = await resolveWriteVia(supabase, user.id, classId, date);

  // Split into updates (existing row) and inserts (new)
  // 데스크는 미출결(새 칸)만 — 이미 찍힌 행을 이 폼으로 덮지 않는다.
  const updates = via === "desk" ? [] : rows.filter((r) => r.existingIds.length > 0);
  const inserts = rows.filter((r) => r.existingIds.length === 0);
  if (via === "desk" && inserts.length === 0) {
    return { error: "이미 입력된 출결은 데스크가 덮을 수 없습니다 — 미출결 칸만 처리할 수 있습니다" };
  }

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
    const wrote = await updateWithVia(supabase, patch, r.existingIds);
    if (wrote.error) return { error: wrote.error };
    saved++;
  }

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
            session_units: r.sessionUnits,
            recorded_by: user.id,
          },
          via,
        ),
      ),
    );
    if (wrote.error) return { error: wrote.error };
    saved += inserts.length;
  }

  // G4: 전원 기록 완료 전이 감지 → 담당 강사 벨(백그라운드, 응답 안 막음 — 실패해도 저장 무사).
  after(() =>
    notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date, actorId: user.id }),
  );
  revalidatePath(`/attendance/${date}`);
  revalidatePath(`/attendance/${date}/${classId}`);
  redirect(`/attendance/${date}?saved=${saved}`);
}

export type CellResult = { ok: true } | { error: string };

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
}): Promise<CellResult> {
  const user = await getCurrentUser();
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

  const supabase = await createClient();

  // scoped(강사) 담당 반 강제 — 원스크린 인라인 출결(2단계)이 이 액션을 재사용하면서 서버 검증 추가.
  // RLS는 tenant 격리뿐이라 여기서 막지 않으면 강사가 테넌트 내 아무 반에나 기록 가능(검수 지적).
  // full(관리자 계열·겸직 포함)은 기존대로 전 반. 담당 확인 + 수강생 확인은 독립 조회 → 병렬(B4).
  // ⚠️ 수강생 판정은 **세션 날짜 기준**(start≤date AND (end null OR end≥date)) — 출석부 매트릭스는 그 달 중
  //    수강 종료(반이동·종강)된 학생의 과거 셀도 편집을 허용하므로, end_date IS NULL 고정이면 그 교정과
  //    미래 end_date(퇴원 예정) 재원생의 오늘 출결까지 차단되는 회귀(리뷰 확정). getAttendanceInputRows와 동일 의미.
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "잘못된 날짜입니다" }; // .or() 보간 안전
    // 7일 지난 출결은 강사가 못 고친다(원장 2026-07-21). 기준일은 항상 KST 오늘.
    // ⚠️ 단 **메모만** 고치는 저장은 면제(2026-08-06) — 시수·상태가 안 움직여 돈에 닿지 않는다.
    if (!noteOnly && !isWithinAttendanceEditWindow(sessionDate, kstToday())) {
      return { error: attendanceLockMessage(sessionDate, kstToday()) };
    }
    const [teaching, { count: enrolled }] = await Promise.all([
      // 담당 반 ∪ 그날 위임받은 반(0173a).
      getTeachingClassIds(supabase, user.id, sessionDate),
      supabase
        .from("enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .or(`start_date.is.null,start_date.lte.${sessionDate}`)
        .or(`end_date.is.null,end_date.gte.${sessionDate}`),
    ]);
    if (!teaching.all.includes(classId)) return { error: "담당 반이 아닙니다" };
    if (!enrolled) return { error: "이 반 수강생이 아닙니다" };
  }

  // 메모만 — 있는 기록의 note만 갈아끼운다. 🔴 **지우기 분기보다 먼저** 온다(status가 null로 와도
  // 기록을 지우면 안 된다). 상태·시수는 patch에 넣지 않는다 = 급여 재료 불변.
  // ⚠️ `recorded_by`/`recorded_at`도 안 건드린다 — 그건 "누가 출결을 찍었나"라 메모 수정으로 덮으면 사실이 바뀐다.
  // 교시 지정(0196a) — 넘어온 값만 그 교시로 좁힌다. `slot`은 아래 세 경로가 공유한다.
  const slot = input.slotStart ?? null;
  const periodStart = input.periodStart ?? slot;
  const via = await resolveWriteVia(supabase, user.id, classId, sessionDate);

  if (noteOnly) {
    let q = supabase
      .from("attendance_records")
      .select("id")
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("session_date", sessionDate);
    if (slot !== null) q = q.eq("slot_start", slot);
    const { data: row } = await q
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row?.id) return { error: "그날 출결 기록이 없어 메모만 남길 수 없습니다 — 먼저 출결을 입력하세요" };
    const { error } = await supabase.from("attendance_records").update({ note: noteVal }).eq("id", row.id);
    if (error) return { error: error.message };
    if (!input.quiet) revalidatePath("/attendance");
    return { ok: true };
  }

  // 지우기 — 해당 (반·학생·날짜) 기록 삭제. 교시를 넘겼으면 **그 교시만**(다른 교시 기록은 남는다).
  if (status === null) {
    if (via === "desk") {
      return { error: "데스크는 미출결 칸만 입력할 수 있습니다 — 이미 있는 기록을 지울 수 없습니다" };
    }
    let del = supabase
      .from("attendance_records")
      .delete()
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("session_date", sessionDate);
    if (slot !== null) del = del.eq("slot_start", slot);
    const { error } = await del;
    if (error) return { error: error.message };
    if (!input.quiet) revalidatePath("/attendance");
    return { ok: true };
  }

  // 그날(또는 그 교시)의 기록을 훑는다 — append-only라 정정 이력이 함께 나오므로 **교시별 최신 1건**만
  // 유효행으로 고른다(effectiveAttendanceRecords와 같은 규칙: recorded_at 최신, 동률이면 id 큰 쪽).
  // 🔴 교시를 넘겼어도 **"그날 전체"(slot_start null) 행까지 함께** 본다. 두 세대가 공존하기 때문이다
  //    (실측 2026-08-14: 영어도 day-level 20행이 남아 있다). 그 교시만 조회하면 옛 day-level 행을
  //    못 보고 새 행을 INSERT해 **같은 (학생·반·날짜)에 두 행이 살아남는다** — 화면은 교시 우선이라
  //    멀쩡해 보이지만 급여·시수는 두 행을 다 합산해서, 정정이 돈에 반영되지 않거나 이중 계상된다.
  const { data: rows } = await supabase
    .from("attendance_records")
    .select("id, slot_start, recorded_at, status")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .eq("session_date", sessionDate)
    .order("recorded_at", { ascending: false });

  // 대상 선정은 순수 규칙 **한 곳**(pickSaveTargets)이 정한다 — 일괄 저장도 같은 함수를 쓴다.
  // 이미 recorded_at 내림차순이라 "교시마다 처음 만난 행이 최신"이라는 그 함수의 전제를 만족한다.
  const { updateIds, promoteIds } = pickSaveTargets(rows ?? [], slot);
  const targetIdSet = new Set([...updateIds, ...promoteIds]);
  const prevStatus =
    (rows ?? []).find((r) => targetIdSet.has(r.id as string))?.status ?? null;

  const deskGate = await assertDeskMayWrite({
    supabase,
    via,
    classId,
    date: sessionDate,
    periodStart,
    currentStatus: prevStatus,
    nextStatus: status,
  });
  if ("error" in deskGate) return deskGate;

  const nowIso = new Date().toISOString();
  if (updateIds.length > 0 || promoteIds.length > 0) {
    const patch: Record<string, unknown> = withVia(
      { status, recorded_by: user.id, recorded_at: nowIso },
      via,
    );
    if (noteProvided) patch.note = noteVal;
    if (unitsProvided) patch.session_units = unitsVal;
    if (promoteIds.length > 0) {
      // 승격(옛 "그날 전체" 행 → 그 교시). 승격 대상만 있을 때만 발생하므로 한 문장으로 끝난다.
      const wrote = await updateWithVia(supabase, { ...patch, slot_start: slot }, promoteIds);
      if (wrote.error) return { error: wrote.error };
    }
    if (updateIds.length > 0) {
      const wrote = await updateWithVia(supabase, patch, updateIds);
      if (wrote.error) return { error: wrote.error };
    }
  } else {
    const row = withVia(
      {
        tenant_id: user.tenantId,
        class_id: classId,
        student_id: studentId,
        session_date: sessionDate,
        slot_start: slot,
        status,
        note: noteProvided ? noteVal : null,
        session_units: unitsProvided ? unitsVal : null,
        recorded_by: user.id,
      },
      via,
    );
    const wrote = await insertWithVia(supabase, row);
    if (wrote.error) return { error: wrote.error };
  }

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
          cells: [{ studentId, classId, slotStart: slot }],
        }),
      );
    }
  }
  if (!input.quiet) revalidatePath("/attendance");
  return { ok: true };
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
  /** 보강을 실제로 한 날(YYYY-MM-DD) — 시수가 여기에 얹힌다. 보통 오늘. */
  makeupDate: string;
  /**
   * 이번 보강의 시수. 🔴 **1 고정이 아니다** — 수학은 **0.5당 1시간**이라 3시간 반의 1회는 1.5다
   * (원장 2026-08-06). 1로 박으면 그 반 급여가 매번 0.5씩 모자란다. 강사가 다이얼로그에서 고른 값.
   */
  addUnits: number;
}): Promise<MakeupLinkResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const { studentId, classId, absentDate, makeupDate, addUnits } = input;
  if (!studentId || !classId || !absentDate || !makeupDate) return { error: "필수 값이 누락되었습니다" };
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDate(absentDate) || !isDate(makeupDate)) return { error: "잘못된 날짜입니다" };
  // 🔴 **결석일이 보강일보다 뒤여도 된다**(원장 2026-08-07: *"미래에 결석할 예정으로 미리 수업할 경우"*
  //    — 선보강). 예전엔 `>=`로 막아 그 경우를 아예 넣을 수 없었다. 같은 날만 막는다 — 그건 결석과 보강이
  //    한 칸에서 만나는 것이라 '분리'가 성립하지 않는다(그 경우는 '합침'이 맞다).
  if (absentDate === makeupDate) return { error: "결석한 날과 보강한 날이 같습니다 — 그때는 '합침'을 쓰세요" };
  // 시수는 클라 값을 그대로 믿지 않는다 — 0·음수는 급여를 깎고, 과한 값은 조용한 과지급이 된다.
  if (!Number.isFinite(addUnits) || addUnits <= 0 || addUnits > 24) return { error: "보강 시수가 올바르지 않습니다" };

  const supabase = await createClient();

  // 게이트 — 셀 액션과 같은 규칙(#77: 화면이 아니라 액션이 게이트). 창 제한은 **시수가 바뀌는 보강일에만**.
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(makeupDate, kstToday())) {
      return { error: attendanceLockMessage(makeupDate, kstToday()) };
    }
    const [teaching, { count: enrolled }] = await Promise.all([
      getTeachingClassIds(supabase, user.id, makeupDate),
      supabase
        .from("enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .or(`start_date.is.null,start_date.lte.${makeupDate}`)
        .or(`end_date.is.null,end_date.gte.${makeupDate}`),
    ]);
    if (!teaching.all.includes(classId)) return { error: "담당 반이 아닙니다" };
    if (!enrolled) return { error: "이 반 수강생이 아닙니다" };
  }

  const latestCell = (sessionDate: string) =>
    supabase
      .from("attendance_records")
      .select("id, status, note, session_units")
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("session_date", sessionDate)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  // 두 칸은 서로 독립 조회 — 직렬 워터폴 금지(B4).
  const [{ data: absentCell }, { data: makeupCell }] = await Promise.all([
    latestCell(absentDate),
    latestCell(makeupDate),
  ]);

  const memoOnMakeup = makeupMemo(absentDate, makeupDate);
  // 이미 연결돼 있으면 시수를 또 올리지 않는다 — 메모도 그대로다(appendMemo가 멱등).
  const alreadyLinked = hasMemoLine(makeupCell?.note, memoOnMakeup);
  const units = alreadyLinked
    ? (makeupCell?.session_units ?? 1)
    : unitsAfterMakeup(makeupCell?.session_units, addUnits);

  const nowIso = new Date().toISOString();
  const writes: PromiseLike<{ error: { message: string } | null }>[] = [];

  // ① 결석한 날 — **메모만**. 기록이 없으면 아무것도 만들지 않는다.
  if (absentCell?.id) {
    writes.push(
      supabase
        .from("attendance_records")
        .update({ note: appendMemo(absentCell.note, absenceMemo(makeupDate, absentDate)) })
        .eq("id", absentCell.id),
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
    if (res.error) return { error: res.error.message };
  }
  // 셀 액션과 같은 계약 — 기록이 늘거나 바뀐 날에만 완료 전이 검사(결석일은 메모만이라 미발화).
  if (!alreadyLinked) {
    after(() =>
      notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date: makeupDate, actorId: user.id }),
    );
  }
  revalidatePath("/attendance");
  return { ok: true, units, absenceNoted: !!absentCell?.id, alreadyLinked };
}

/** 일괄로 찍을 수 있는 상태 — 인라인 pill과 같은 3종. 조퇴·공결·보강은 출석부 전용(축약 되쓰기 방지). */
const BULK_STATUSES = ["present", "late", "absent"] as const;
/** 한 번에 처리할 셀 상한 — 표뷰 한 화면(수십 행)을 넉넉히 덮으면서 폭주 요청을 막는 안전선. */
const BULK_CELL_LIMIT = 300;

export type BulkCellResult =
  | { ok: true; applied: { studentId: string; classId: string }[]; blocked: number }
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
}): Promise<BulkCellResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const { sessionDate, status } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "잘못된 날짜입니다" };
  if (!BULK_STATUSES.includes(status)) return { error: "잘못된 상태입니다" };

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

  // 강사(scoped) — 셀 액션과 같은 3중 게이트를 집합 단위로. full(관리자 계열)은 기존대로 전 반.
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(sessionDate, kstToday())) {
      return { error: attendanceLockMessage(sessionDate, kstToday()) };
    }
    const classIds = [...new Set(cells.map((c) => c.classId))];
    const studentIds = [...new Set(cells.map((c) => c.studentId))];
    // ⚠️ 수강 판정은 **세션 날짜 기준**(셀 액션과 동일 의미) — 반이동·종강 학생의 그날 기록을 막지 않는다.
    const [teaching, enrolled] = await Promise.all([
      // 담당 반 ∪ 그날 위임받은 반(0173a) — 셀 액션과 **같은 소스**여야 일괄이 개별과 다른 말을 하지 않는다.
      getTeachingClassIds(supabase, user.id, sessionDate),
      fetchInChunks<{ class_id: string; student_id: string }>(studentIds, (chunk) =>
        supabase
          .from("enrollments")
          .select("class_id, student_id")
          .in("class_id", classIds)
          .in("student_id", chunk)
          .or(`start_date.is.null,start_date.lte.${sessionDate}`)
          .or(`end_date.is.null,end_date.gte.${sessionDate}`),
      ),
    ]);
    const ownSet = new Set(teaching.all);
    const enrolledSet = new Set(enrolled.map((e) => `${e.student_id}::${e.class_id}`));
    allowed = cells.filter(
      (c) => ownSet.has(c.classId) && enrolledSet.has(`${c.studentId}::${c.classId}`),
    );
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
      .order("recorded_at", { ascending: false }),
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
  for (const classId of classIds) {
    viaByClass.set(classId, await resolveWriteVia(supabase, user.id, classId, sessionDate));
  }

  // 데스크 게이트 — 이미 찍힌 칸·유예 안 칸은 건너뛴다(blocked). 요청 전체를 실패시키지 않는다.
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
      });
      deskGateByClass.set(cacheKey, gate);
    }
    if ("error" in gate) continue;
    open.push(c);
  }
  allowed = open;

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
        },
        viaByClass.get(c.classId) ?? "teacher",
      ),
    );
    const wrote = await insertManyWithVia(supabase, rows);
    if (wrote.error) return { error: wrote.error };
  }

  // G4: 반마다 '전원 기록 완료' 전이 검사(셀 액션과 동일) — 백그라운드라 응답을 막지 않는다.
  after(async () => {
    for (const classId of classIds) {
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
            cells: group.map((c) => ({ ...c, slotStart: slot })),
          });
        }
      });
    }
  }
  revalidatePath("/attendance");
  return { ok: true, applied: allowed, blocked: cells.length - allowed.length };
}

export type RangeCell = { studentId: string; classId: string; sessionDate: string };
export type RangeResult = { ok: true; applied: number; blocked: number } | { error: string };

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
  cells: RangeCell[];
  status: Status | null;
  /** 전달 시 시수도 갱신(raw — ""=기본 1). status=null이면 무시. */
  units?: string;
  /**
   * 화면 갱신을 이 액션이 하지 않는다 — 시트가 **입력이 멎은 뒤 한 번** 직접 새로고침한다.
   * ⚠️ 켜지 않으면 칸을 칠 때마다 그 달 매트릭스를 통째로 다시 조회한다(수십 번 = 화면이 긴다).
   */
  quiet?: boolean;
}): Promise<RangeResult> {
  const user = await getCurrentUser();
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

  // 같은 (학생·반·날짜)가 두 번 오면 한 번만 — 출결 원장은 그 조합에 한 칸이다.
  const seen = new Set<string>();
  const cells: RangeCell[] = [];
  for (const c of input.cells ?? []) {
    if (!c?.studentId || !c?.classId || !/^\d{4}-\d{2}-\d{2}$/.test(c.sessionDate ?? "")) continue;
    const k = `${c.studentId}::${c.classId}::${c.sessionDate}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ studentId: c.studentId, classId: c.classId, sessionDate: c.sessionDate });
  }
  if (cells.length === 0) return { error: "기록할 대상이 없습니다" };
  if (cells.length > BULK_CELL_LIMIT)
    return { error: `한 번에 ${BULK_CELL_LIMIT}칸까지만 채울 수 있습니다 — 범위를 좁혀 주세요` };

  const supabase = await createClient();
  const classIds = [...new Set(cells.map((c) => c.classId))];
  const studentIds = [...new Set(cells.map((c) => c.studentId))];
  const dates = [...new Set(cells.map((c) => c.sessionDate))];
  let allowed = cells;

  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const today = kstToday();
    // 담당 반은 **날짜마다** 다를 수 있다(그날 위임, 0173a) → 날짜별로 병렬 조회(B4).
    // 수강 여부는 기간이라 한 번에 받아 칸마다 JS로 판정한다(날짜별 쿼리 반복 금지).
    const [teachingByDate, enrollments] = await Promise.all([
      Promise.all(
        dates.map(async (d) => [d, new Set((await getTeachingClassIds(supabase, user.id, d)).all)] as const),
      ),
      fetchInChunks<{ class_id: string; student_id: string; start_date: string | null; end_date: string | null }>(
        studentIds,
        (chunk) =>
          supabase
            .from("enrollments")
            .select("class_id, student_id, start_date, end_date")
            .in("class_id", classIds)
            .in("student_id", chunk),
      ),
    ]);
    const teaching = new Map(teachingByDate);
    const spans = new Map<string, { start: string | null; end: string | null }[]>();
    for (const e of enrollments) {
      const k = `${e.student_id}::${e.class_id}`;
      const list = spans.get(k) ?? [];
      list.push({ start: e.start_date, end: e.end_date });
      spans.set(k, list);
    }
    allowed = cells.filter((c) => {
      if (!isWithinAttendanceEditWindow(c.sessionDate, today)) return false;
      if (!teaching.get(c.sessionDate)?.has(c.classId)) return false;
      // 수강 판정은 **그 칸의 날짜 기준** — 반이동·종강 학생의 그날 기록을 막지 않는다(셀 액션과 동일 의미).
      return (spans.get(`${c.studentId}::${c.classId}`) ?? []).some(
        (s) => (!s.start || s.start <= c.sessionDate) && (!s.end || s.end >= c.sessionDate),
      );
    });
    if (allowed.length === 0) {
      // 조용한 0건 금지 — 가장 흔한 사유(기간)를 그대로 말해 준다.
      const late = cells.find((c) => !isWithinAttendanceEditWindow(c.sessionDate, today));
      return { error: late ? attendanceLockMessage(late.sessionDate, today) : "담당 반 수강생이 아니어서 기록할 수 없습니다" };
    }
  }

  const wanted = new Set(allowed.map((c) => `${c.studentId}::${c.classId}::${c.sessionDate}`));
  // 기존 기록 — (학생×반×날짜) 교차곱으로 받아 **정확한 칸만** JS로 골라낸다(칸마다 쿼리 금지).
  // 🔴 반드시 **페이지네이션**할 것: 교차곱이라 300칸 범위도 수천 행을 부를 수 있고, 그냥 청크만 하면
  //    PostgREST가 1000행에서 **조용히 자른다**(#54). 잘리면 있는 행을 못 찾아 update 대신 insert →
  //    같은 (학생·반·날짜)에 중복 출결이 쌓인다(시수·급여의 재료가 오염된다).
  //    페이지가 흔들리지 않도록 order에 unique tie-break(id)를 함께 건다.
  const existingRows = await fetchAllPagedInChunks<{
    id: string;
    class_id: string;
    student_id: string;
    session_date: string;
    recorded_at: string | null;
  }>(studentIds, (chunk, from, to) =>
    supabase
      .from("attendance_records")
      .select("id, class_id, student_id, session_date, recorded_at")
      .in("session_date", dates)
      .in("class_id", classIds)
      .in("student_id", chunk)
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const mine = existingRows.filter((r) => wanted.has(`${r.student_id}::${r.class_id}::${r.session_date}`));
  const CHUNK = 100;

  // 지우기 — 그 칸의 기록을 전부(정정 이력 포함) 삭제. 셀 액션의 '지우기'와 같은 계약.
  if (status === null) {
    const ids = mine.map((r) => r.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase.from("attendance_records").delete().in("id", ids.slice(i, i + CHUNK));
      if (error) return { error: error.message };
    }
    revalidatePath("/attendance");
    return { ok: true, applied: allowed.length, blocked: cells.length - allowed.length };
  }

  const latestId = new Map<string, string>();
  for (const r of mine) {
    const k = `${r.student_id}::${r.class_id}::${r.session_date}`;
    if (!latestId.has(k)) latestId.set(k, r.id); // 청크별 desc 정렬 → 각 조합의 첫 행이 최신
  }
  const nowIso = new Date().toISOString();
  const updateIds = allowed
    .map((c) => latestId.get(`${c.studentId}::${c.classId}::${c.sessionDate}`))
    .filter((id): id is string => !!id);
  const inserts = allowed.filter((c) => !latestId.has(`${c.studentId}::${c.classId}::${c.sessionDate}`));

  const rangeViaByClass = new Map<string, RecordedVia>();
  for (const classId of classIds) {
    rangeViaByClass.set(classId, await resolveWriteVia(supabase, user.id, classId, dates[0] ?? kstToday()));
  }

  if (updateIds.length > 0) {
    const byVia = new Map<RecordedVia, string[]>();
    for (const c of allowed) {
      const id = latestId.get(`${c.studentId}::${c.classId}::${c.sessionDate}`);
      if (!id) continue;
      const via = rangeViaByClass.get(c.classId) ?? "teacher";
      if (via === "desk") continue; // 데스크는 이미 찍힌 칸을 덮지 않는다
      (byVia.get(via) ?? byVia.set(via, []).get(via)!).push(id);
    }
    for (const [via, ids] of byVia) {
      const patch: Record<string, unknown> = withVia(
        { status, recorded_by: user.id, recorded_at: nowIso },
        via,
      );
      if (unitsProvided) patch.session_units = unitsVal;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const wrote = await updateWithVia(supabase, patch, ids.slice(i, i + CHUNK));
        if (wrote.error) return { error: wrote.error };
      }
    }
  }
  if (inserts.length > 0) {
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const wrote = await insertManyWithVia(
        supabase,
        inserts.slice(i, i + CHUNK).map((c) =>
          withVia(
            {
              tenant_id: user.tenantId,
              class_id: c.classId,
              student_id: c.studentId,
              session_date: c.sessionDate,
              status,
              session_units: unitsProvided ? unitsVal : null,
              recorded_by: user.id,
            },
            rangeViaByClass.get(c.classId) ?? "teacher",
          ),
        ),
      );
      if (wrote.error) return { error: wrote.error };
    }
  }

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
  if (!input.quiet) revalidatePath("/attendance");
  return { ok: true, applied: allowed.length, blocked: cells.length - allowed.length };
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
): Promise<{ id: string; name: string; label: string }[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return [];
  const q = query.trim();
  if (!q || !classId) return [];
  const supabase = await createClient();
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const { all: myClassIds } = await getTeachingClassIds(supabase, user.id);
    if (!myClassIds.includes(classId)) return [];
  }
  const { data } = await supabase
    .from("students")
    .select("id, name, grade, school")
    .neq("status", "withdrawn")
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(20);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    label: schoolGradeLabel(s.school ?? null, s.grade ?? null),
  }));
}
