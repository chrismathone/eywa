import "server-only";

/**
 * 보강 보고서의 **반(앵커) 칸** — 출석부 쪽 쓰기 한 벌(원장 2026-09-30 *"보고서 반 = 출석부 반은 모든 곳에서 일치"*).
 * 규칙·불변식은 순수부 [`makeup-anchor.ts`](@/features/onescreen/makeup-anchor)에 있다. 여기는 DB만 만진다.
 *
 * 🔴 admin 클라이언트(RLS 우회)라 **모든 조회·쓰기에 `tenant_id` 필터**([[#104]]) — 대신 보강(남의 반 칸)은 강사 권한으로
 *    쓸 수 없어서 admin으로 쓴다. 호출부가 앵커를 `acceptMakeupAnchor`로 먼저 확인한다.
 * 🔴 `taught_by`(0316a)는 칸이 없으면 **귀속만 빼고** 쓴다([[#95]]) — 저장이 죽는 것보다 귀속이 비는 쪽이 낫다(드라이런이 센다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { isDelegationActiveOn } from "@/features/classes/delegation-window";
import { planMakeupCellMove, substituteTaughtBy, type MoveCellRow, type MoveCellsPlan } from "@/features/onescreen/makeup-anchor";
import { completeMakeupReservations, effectGapsOf, type CompletionCell } from "./makeup-reservation-complete";
import { effectNoticeOf, type MakeupEffectNotice } from "@/features/makeups/server/adapters/effects";
import { taughtByColumnReady } from "./taught-by-db";
import { explainDbError } from "@/lib/supabase/db-error";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * 그 강사가 그날 이 반을 **담당**(담임 ∪ 살아 있는 위임)하는가 — 대신 보강 귀속(`substituteTaughtBy`)의 재료.
 * 🔴 `getTeachingClasses`와 같은 뜻(담임 = `classes.teacher_id` · 위임 = `class_delegations`, 판정 `isDelegationActiveOn`).
 *    소유자(보고서 작성 강사)는 저장자와 다를 수 있어(사무실이 대신 저장) 세션 클라이언트가 아니라 admin으로 본다.
 * 조회 실패는 true(= 대신 보강으로 적지 않는다 — 모르면 종전 축 그대로가 안전하다: 남의 몫을 지어내지 않는다).
 */
export async function ownerTeachesClassOn(
  admin: Admin,
  input: { tenantId: string; ownerId: string; classId: string; date: string },
): Promise<boolean> {
  const [{ data: cls, error: cErr }, { data: dels, error: dErr }] = await Promise.all([
    admin.from("classes").select("teacher_id").eq("tenant_id", input.tenantId).eq("id", input.classId).maybeSingle(),
    admin
      .from("class_delegations")
      .select("delegate_user_id, from_date, to_date, revoked_at")
      .eq("tenant_id", input.tenantId)
      .eq("class_id", input.classId)
      .eq("delegate_user_id", input.ownerId)
      .is("revoked_at", null),
  ]);
  if (cErr || dErr) return true;
  if ((cls?.teacher_id as string | null) === input.ownerId) return true;
  return (dels ?? []).some((d) =>
    isDelegationActiveOn(
      { fromDate: d.from_date as string, toDate: d.to_date as string, revokedAt: (d.revoked_at as string | null) ?? null },
      input.date,
    ),
  );
}

/**
 * 앵커 칸을 세우거나 옮긴 뒤의 **보강 예약 이행**. 출결은 이미 저장됐다 — 이행이 남긴 반영 대기·보류와 예외를 버리지 않고
 * 알림으로 돌려준다(예전엔 결과와 예외를 둘 다 버려, 출결 저장 성공이 원장 반영까지 끝난 것처럼 보였다).
 * 🔴 출결을 되돌리지 않고 반영을 다시 보내지도 않는다. 대기·실패는 이행 쪽이 대사·복구 목록에 남긴다.
 */
async function completeAnchorCell(tenantId: string, cell: CompletionCell): Promise<MakeupEffectNotice | null> {
  try {
    return effectNoticeOf(effectGapsOf(await completeMakeupReservations({ tenantId }, [cell])));
  } catch {
    return effectNoticeOf([], true);
  }
}

/** 그날 그 학생·그 반의 출결 행 전부(정정 이력 포함) — 옮기기·확인 재료. 실패는 throw. */
async function dayRows(admin: Admin, tenantId: string, classId: string, studentId: string, date: string): Promise<MoveCellRow[]> {
  const { data, error } = await admin
    .from("attendance_records")
    .select("id, class_id, status, slot_start, recorded_at")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .eq("session_date", date);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    classId: r.class_id as string,
    status: r.status as string,
    slotStart: (r.slot_start as string | null) ?? null,
    recordedAt: r.recorded_at as string,
  }));
}

/**
 * **앵커 반에 보강 칸을 세운다**(없을 때만). 이미 그 반에 그 학생 칸이 있으면 손대지 않는다(사람 손이 이긴다 — 시수·상태 보존).
 * @param taughtBy 대신 보강 귀속(`substituteTaughtBy`) — null이면 종전 축.
 * @param units 확인창에서 고른 시수(1이면 비워 둔다 = 기본 1) — 없으면 기본.
 */
export async function ensureMakeupAnchorCell(input: {
  tenantId: string;
  studentId: string;
  date: string;
  classId: string;
  recordedBy: string | null;
  taughtBy: string | null;
  units?: number | null;
  /** 새로 세울 때 붙일 메모(결석분 연결 — `makeupMemo`). 있는 칸엔 안 붙인다. */
  note?: string | null;
}): Promise<{ ok: true; created: boolean; makeupEffect?: MakeupEffectNotice } | { ok: false; error: string }> {
  const admin = createAdminClient();
  let existing: MoveCellRow[];
  try {
    existing = await dayRows(admin, input.tenantId, input.classId, input.studentId, input.date);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (existing.length > 0) return { ok: true, created: false };
  const withTaughtBy = !!input.taughtBy && (await taughtByColumnReady(admin, { fresh: true }));
  const { error } = await admin.from("attendance_records").insert({
    tenant_id: input.tenantId,
    class_id: input.classId,
    student_id: input.studentId,
    session_date: input.date,
    status: "makeup",
    recorded_by: input.recordedBy,
    ...(input.units && input.units !== 1 ? { session_units: input.units } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(withTaughtBy ? { taught_by: input.taughtBy } : {}),
  });
  if (error) return { ok: false, error: explainDbError(error, { scope: "attendance.makeup-anchor-cells.ensureMakeupAnchorCell", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // 그 반·그날 **보강 예약**이 있으면 이행한다(예약이 영영 reserved로 남지 않게 — 종전 예약 반 분기와 같은 호출).
  const makeupEffect = await completeAnchorCell(input.tenantId, {
    studentId: input.studentId, classId: input.classId, date: input.date, status: "makeup", unitsExplicit: input.units != null, created: true,
  });
  return { ok: true, created: true, ...(makeupEffect ? { makeupEffect } : {}) };
}

/**
 * 보강 반을 옮길 때의 **칸 이동 계획**(읽기만) — 쓰기 전에 막힐지 먼저 안다(보고서를 먼저 바꾸고 칸에서 막히면 둘이 갈린다).
 * @param fromClassId 옛 자리(옛 앵커 반 또는 보이지 않는 보강 반). null이면 옮길 게 없다.
 */
export async function planAnchorMove(input: {
  tenantId: string;
  studentId: string;
  date: string;
  fromClassId: string | null;
  fromIsPool: boolean;
  toClassId: string;
}): Promise<MoveCellsPlan> {
  if (!input.fromClassId || input.fromClassId === input.toClassId) return { kind: "none" };
  const admin = createAdminClient();
  const [fromRows, toRows] = await Promise.all([
    dayRows(admin, input.tenantId, input.fromClassId, input.studentId, input.date),
    dayRows(admin, input.tenantId, input.toClassId, input.studentId, input.date),
  ]);
  return planMakeupCellMove({ fromRows, toRows, fromIsPool: input.fromIsPool });
}

/**
 * 계획대로 칸을 옮긴다 — 행 id 전부의 반만 바꾼다(시수·메모·입력자·정정 이력 보존) + 대신 보강 귀속을 새 반 기준으로 다시 적는다.
 * 🔴 조건부(원래 반 그대로일 때만) — 그새 누가 옮겼으면 0행이라 오류로 돌려준다.
 */
export async function applyAnchorMove(input: {
  tenantId: string;
  ids: readonly string[];
  fromClassId: string;
  toClassId: string;
  studentId: string;
  date: string;
  taughtBy: string | null;
  /** 보강 소유 강사 — 일부만 옮겨졌을 때 옛 반 기준 귀속을 다시 적는 재료(없으면 귀속은 비운다). */
  ownerId?: string | null;
}): Promise<{ ok: true; moved: number; makeupEffect?: MakeupEffectNotice } | { ok: false; error: string }> {
  if (input.ids.length === 0) return { ok: true, moved: 0 };
  const admin = createAdminClient();
  const withTaughtBy = await taughtByColumnReady(admin, { fresh: true });
  const { data, error } = await admin
    .from("attendance_records")
    .update({ class_id: input.toClassId, ...(withTaughtBy ? { taught_by: input.taughtBy } : {}) })
    .eq("tenant_id", input.tenantId)
    .eq("class_id", input.fromClassId)
    .in("id", [...input.ids])
    .select("id");
  if (error) return { ok: false, error: explainDbError(error, { scope: "attendance.makeup-anchor-cells.applyAnchorMove", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if ((data ?? []).length !== input.ids.length) {
    /**
     * 🔴 **일부만 옮겨졌다**(계획을 세운 뒤 그 사이 누가 한 행을 고쳤다) — 한 문장이라도 맞은 행은 이미 새 반에 있다.
     *    그대로 오류만 돌려주면 호출부가 보고서의 반을 되돌려도 **칸 일부가 새 반에 남아** 보고서 반 ≠ 출석부 반이 된다(적대 리뷰 2026-09-30).
     *    옮긴 행만 옛 반으로 되돌린다(귀속도 옛 반 기준 — 보고서 저장 훅이 그 반에 적었을 값과 같게).
     */
    const movedIds = (data ?? []).map((r) => r.id as string);
    if (movedIds.length) {
      const back = withTaughtBy
        ? substituteTaughtBy(
            input.ownerId ?? null,
            input.ownerId
              ? await ownerTeachesClassOn(admin, { tenantId: input.tenantId, ownerId: input.ownerId, classId: input.fromClassId, date: input.date })
              : true,
          )
        : null;
      const { error: backErr } = await admin
        .from("attendance_records")
        .update({ class_id: input.fromClassId, ...(withTaughtBy ? { taught_by: back } : {}) })
        .eq("tenant_id", input.tenantId)
        .eq("class_id", input.toClassId)
        .in("id", movedIds);
      if (backErr) console.error("[makeup-anchor] 일부 옮긴 칸 되돌리기 실패 — 드라이런(makeup-class-drift)이 셉니다", backErr.message);
    }
    return { ok: false, error: "출석부 칸이 그새 바뀌었습니다 — 새로고침 뒤 다시 시도해 주세요" };
  }
  const makeupEffect = await completeAnchorCell(input.tenantId, {
    studentId: input.studentId, classId: input.toClassId, date: input.date, status: "makeup", unitsExplicit: true, created: false,
  });
  return { ok: true, moved: data!.length, ...(makeupEffect ? { makeupEffect } : {}) };
}

/**
 * **이 칸들이 보강 보고서의 반(앵커)인가** — 출석부 쪽에서 그 칸을 지우려 할 때의 게이트(원장 결정 1, 설계 g).
 * 지우면 보고서는 그 반을 가리키는데 출석부엔 칸이 없어 불변식이 깨진다. 막힌 칸이 있으면 한국어 사유를, 없으면 null.
 * 🔴 조회 실패는 **막는다**(fail-closed) — 지우기는 되돌릴 수 없고, 모르고 지우면 보고서가 빈 반을 가리킨다.
 * ECS 보강 빼기가 쓴다(발송된 보고서의 칸도 막는다). 출석부 지우기는 아래 `makeupAnchorDeleteCheck`(발송분은 지운다).
 */
export async function makeupAnchorDeleteBlock(
  tenantId: string,
  cells: readonly { studentId: string; classId: string; date: string }[],
): Promise<string | null> {
  return (await makeupAnchorDeleteCheck(tenantId, cells, { allowSent: false })).block;
}

/** 출석부 칸 하나의 열쇠 — `makeupAnchorDeleteCheck`의 `keptCells`와 호출부가 같은 모양으로 맞춘다. */
export const anchorCellKey = (c: { studentId: string; classId: string; date: string }) => `${c.studentId}|${c.classId}|${c.date}`;

/** 진행 중이거나 학부모에게 게시됐을 수 있는 발송 상태 — '성공'은 따로(허용) · 상태 없음과 게시 전에 멈춘 상태는 '보내기 전'. */
const UNSETTLED_STATUSES: ReadonlySet<string> = new Set(["queued", "processing", "failed", "recall_requested", "recalling", "recall_failed", "recalled"]);

/** 발송 상태가 애매한 보강 보고서(발송 대기·실패·회수 등)의 칸 — 지우지도, '보강 빼기'를 권하지도 않는다(학부모가 받았을 수 있다). */
export const ANCHOR_UNSETTLED_MESSAGE =
  "이 칸은 발송 상태를 먼저 확인해야 하는 보강 보고서(발송 대기·실패·회수 등)의 반입니다 — 지우지 않았습니다. 수업보고서 발송 목록에서 상태를 확인해 주세요(다시 보내 성공하면 지울 수 있습니다)";

/**
 * 출석부 칸·범위 지우기(`setAttendanceCell`·`setAttendanceRange` — 월별·반별·강사 보기·원스크린 출결 지우기)의 게이트 — 위와 같은 조회에
 * 하나를 더한다: **학부모에게 발송된(발송 상태 '성공') 보강 보고서의 칸은 지운다 · 보고서는 그대로 둔다**(원장 2026-11-05 *"보고서 나간것도
 * 출석부에서는 그냥 지울 수 있게 해줘야겠는데. 왜냐면 급여 계산할때 시수 햇갈릴 수 있어서 수정은 해주고 보고서는 그냥 그대로 두게"*).
 * - 허용은 **'성공'만**이다 — 원스크린이 편집을 잠그는 상태와 같아서, 보고서를 다시 저장해 칸이 되살아나는 길이 없다. 발송 대기·실패·회수처럼
 *   애매한 상태는 막고 '보강 빼기'도 권하지 않는다(학부모가 이미 받은 보고서를 지우게 된다 — 적대 리뷰 2026-11-05).
 * - 보내기 전 보고서의 칸은 종전대로 막는다(보고서를 저장할 때 칸을 다시 세워 지운 것이 되살아난다 — 원스크린 '보강 빼기'가 보고서와 함께 지운다).
 * - `keptCells` = 지우기를 허용한 발송분 칸의 열쇠(`anchorCellKey`). 호출부는 이 칸들의 **보강 예약 되돌림을 건너뛴다**(예약은 '완료' 그대로 —
 *   보강은 실제로 했고 보고서도 나갔다. 되돌리면 결석 메모가 '보강 예정'으로 바뀌고 원스크린이 '보강 진행 여부 확인'을 띄워, 그걸 누르면 칸이
 *   다시 생긴다). 감사로그의 수는 실제로 행을 지운 칸에서 다시 센다.
 */
export async function makeupAnchorDeleteCheck(
  tenantId: string,
  cells: readonly { studentId: string; classId: string; date: string }[],
  options: { allowSent: boolean },
): Promise<{ block: string | null; keptSent: number; keptCells: ReadonlySet<string> }> {
  const none = new Set<string>();
  if (cells.length === 0) return { block: null, keptSent: 0, keptCells: none };
  const admin = createAdminClient();
  const students = [...new Set(cells.map((c) => c.studentId))];
  const classes = [...new Set(cells.map((c) => c.classId))];
  const dates = [...new Set(cells.map((c) => c.date))];
  // 조회는 반·날짜를 100개씩만 싣는다 — 넘으면 다 확인하지 못하니 막는다(fail-closed · 범위 상한 300칸이라 실제로는 거의 없다).
  if (classes.length > 100 || dates.length > 100) {
    return { block: "범위가 너무 넓어 보강 보고서를 다 확인하지 못했습니다 — 범위를 나눠 지워 주세요", keptSent: 0, keptCells: none };
  }
  const found: {
    student_id: string; makeup_class_id: string; report_date: string;
    classnote_status: string | null; classnote_sent_at: string | null; classnote_read_at?: string | null;
  }[] = [];
  for (let i = 0; i < students.length; i += 100) {
    const { data, error } = await admin
      .from("lesson_reports")
      .select("student_id, makeup_class_id, report_date, classnote_status, classnote_sent_at, classnote_read_at")
      .eq("tenant_id", tenantId)
      .eq("makeup", true)
      .is("class_id", null)
      .in("student_id", students.slice(i, i + 100))
      .in("makeup_class_id", classes.slice(0, 100))
      .in("report_date", dates.slice(0, 100));
    if (error) return { block: "보강 보고서를 확인하지 못해 지우지 않았습니다 — 다시 시도해 주세요", keptSent: 0, keptCells: none };
    found.push(...((data ?? []) as typeof found));
  }
  const want = new Set(cells.map(anchorCellKey));
  const keyOf = (r: (typeof found)[number]) => anchorCellKey({ studentId: r.student_id, classId: r.makeup_class_id, date: r.report_date });
  const hits = found.filter((r) => want.has(keyOf(r)));
  // 학부모에게 보이는 발송 = '성공'(원스크린 저장 잠금과 같은 상태). 애매 = 발송 시각이 남았거나 진행 중·게시됐을 수 있는 상태
  // (대기·처리 중·실패(일부 게시·응답 없음도 실패로 남는다)·회수 계열). 나머지(상태 없음 · 게시 전에 멈춘 이름 충돌·공유 차단·기한 지남)는 보내기 전.
  const live = (r: (typeof found)[number]) => r.classnote_status === "success";
  // 재발급으로 상태가 지워졌어도 학부모가 읽은 흔적이 남았으면 애매로 본다(원스크린 '보강 빼기'의 발송 판정과 같은 결 — makeup-remove-plan.ts).
  const unsettled = (r: (typeof found)[number]) =>
    !live(r) && (!!r.classnote_sent_at || UNSETTLED_STATUSES.has(r.classnote_status ?? "") || (!r.classnote_status && !!r.classnote_read_at));
  const unsent = (r: (typeof found)[number]) => !live(r) && !unsettled(r);
  // 하나라도 걸리면 범위 지우기는 통째로 막는다 — 어느 칸이 묶였는지 격자에서 알 수 없다. 애매한 상태를 먼저 말한다('보강 빼기'를 권하지 않게).
  if (hits.some(unsettled)) return { block: ANCHOR_UNSETTLED_MESSAGE, keptSent: 0, keptCells: none };
  if (hits.some(unsent)) {
    return { block: "이 칸은 보강 보고서가 가리키는 반입니다 — 원스크린에서 '보강 빼기'로 보고서와 함께 지우거나, 보강 반을 바꿔 주세요", keptSent: 0, keptCells: none };
  }
  if (hits.length === 0) return { block: null, keptSent: 0, keptCells: none };
  if (!options.allowSent) {
    // ECS '보강 빼기' — 보고서까지 빼는 길이라 발송분은 여기서 막는다. 시수만 빼는 길은 출석부 지우기(위 설명).
    return {
      block: "이 칸은 학부모에게 발송된 보강 보고서의 반입니다 — 여기서는 뺄 수 없습니다(시수만 빼려면 출석부에서 그 칸을 지우세요 · 보고서는 그대로 둡니다)",
      keptSent: 0,
      keptCells: none,
    };
  }
  // 발송된 보고서의 칸 — 칸(시수)만 지우고 보고서는 그대로 둔다. 같은 칸을 가리키는 보고서가 둘이어도 칸은 하나로 센다.
  const keptCells = new Set(hits.map(keyOf));
  return { block: null, keptSent: keptCells.size, keptCells };
}
