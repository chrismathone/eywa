import "server-only";

/**
 * 보강 보고서의 **반(앵커) 칸** — 출석부 쪽 쓰기 한 벌(원장 2026-09-30 *"보고서 반 = 출석부 반은 모든 곳에서 일치"*).
 * 규칙·불변식은 순수부 [`makeup-anchor.ts`](@/features/onescreen/makeup-anchor)에 있다. 여기는 DB만 만진다.
 *
 * 🔴 admin 클라이언트(RLS 우회)라 **모든 조회·쓰기에 `tenant_id` 필터**([[#104]]) — 대신 보강(남의 반 칸)은 강사 권한으로
 *    쓸 수 없어서 admin으로 쓴다. 호출부가 앵커를 `acceptMakeupAnchor`로 먼저 확인한다.
 * 🔴 `taught_by`(0315a)는 칸이 없으면 **귀속만 빼고** 쓴다([[#95]]) — 저장이 죽는 것보다 귀속이 비는 쪽이 낫다(드라이런이 센다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { isDelegationActiveOn } from "@/features/classes/delegation-window";
import { planMakeupCellMove, substituteTaughtBy, type MoveCellRow, type MoveCellsPlan } from "@/features/onescreen/makeup-anchor";
import { completeMakeupReservations } from "./makeup-reservation-complete";
import { taughtByColumnReady } from "./taught-by-db";

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
}): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
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
  if (error) return { ok: false, error: error.message };
  // 그 반·그날 **보강 예약**이 있으면 이행한다(예약이 영영 reserved로 남지 않게 — 종전 예약 반 분기와 같은 호출).
  await completeMakeupReservations({ tenantId: input.tenantId }, [
    { studentId: input.studentId, classId: input.classId, date: input.date, status: "makeup", unitsExplicit: input.units != null, created: true },
  ]).catch(() => undefined);
  return { ok: true, created: true };
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
}): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
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
  if (error) return { ok: false, error: error.message };
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
  await completeMakeupReservations({ tenantId: input.tenantId }, [
    { studentId: input.studentId, classId: input.toClassId, date: input.date, status: "makeup", unitsExplicit: true, created: false },
  ]).catch(() => undefined);
  return { ok: true, moved: data!.length };
}

/**
 * **이 칸들이 보강 보고서의 반(앵커)인가** — 출석부 쪽에서 그 칸을 지우려 할 때의 게이트(원장 결정 1, 설계 g).
 * 지우면 보고서는 그 반을 가리키는데 출석부엔 칸이 없어 불변식이 깨진다. 막힌 칸이 있으면 한국어 사유를, 없으면 null.
 * 🔴 조회 실패는 **막는다**(fail-closed) — 지우기는 되돌릴 수 없고, 모르고 지우면 보고서가 빈 반을 가리킨다.
 */
export async function makeupAnchorDeleteBlock(
  tenantId: string,
  cells: readonly { studentId: string; classId: string; date: string }[],
): Promise<string | null> {
  if (cells.length === 0) return null;
  const admin = createAdminClient();
  const students = [...new Set(cells.map((c) => c.studentId))];
  const classes = [...new Set(cells.map((c) => c.classId))];
  const dates = [...new Set(cells.map((c) => c.date))];
  const found: { student_id: string; makeup_class_id: string; report_date: string; classnote_status: string | null; classnote_sent_at: string | null }[] = [];
  for (let i = 0; i < students.length; i += 100) {
    const { data, error } = await admin
      .from("lesson_reports")
      .select("student_id, makeup_class_id, report_date, classnote_status, classnote_sent_at")
      .eq("tenant_id", tenantId)
      .eq("makeup", true)
      .is("class_id", null)
      .in("student_id", students.slice(i, i + 100))
      .in("makeup_class_id", classes.slice(0, 100))
      .in("report_date", dates.slice(0, 100));
    if (error) return "보강 보고서를 확인하지 못해 지우지 않았습니다 — 다시 시도해 주세요";
    found.push(...((data ?? []) as typeof found));
  }
  const want = new Set(cells.map((c) => `${c.studentId}|${c.classId}|${c.date}`));
  const hit = found.find((r) => want.has(`${r.student_id}|${r.makeup_class_id}|${r.report_date}`));
  if (!hit) return null;
  return hit.classnote_sent_at || hit.classnote_status === "success"
    ? "이 칸은 학부모에게 발송된 보강 보고서의 반입니다 — 지울 수 없습니다(보고서와 출석부 반이 갈라집니다)"
    : "이 칸은 보강 보고서가 가리키는 반입니다 — 원스크린에서 '보강 빼기'로 보고서와 함께 지우거나, 보강 반을 바꿔 주세요";
}
