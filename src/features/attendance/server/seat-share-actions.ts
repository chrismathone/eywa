"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { monthRange } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { explainDbError } from "@/lib/supabase/db-error";
import { createClient } from "@/lib/supabase/server";
import { buildHolidayMap } from "../calendar";
import {
  parseSeatShareStudents, parseSeatShareUnits, seatShareEmpty, seatShareOnlyShrinks, seatShareOverPlan, seatShareSame,
  type SeatShareAdjust,
} from "../seat-share-adjust";
import { classTeacherIdsInRange } from "../teacher-axis";
import { attendanceSalaryAdminOrNull } from "./salary-rates";
import { loadScopeFacts } from "./scope-ownership";
import { readClassSeatShare, SEAT_SHARE_TABLE, seatShareTableMissing } from "./seat-share-adjust";
import { loadClassTermPlan } from "./teacher-term-share";

/**
 * **자리(JJ실·랩실) 몫을 수업 몫으로 돌리기** — 회차 확정의 '자리 몫' 줄에서 연다(원장 2026-10-07 *"어떤반의 수업/JJ 비율을 19/5를
 * 20/4로 변경할 수 있으면 가장 편할거같은데 · LAB도 마찬가지겠고 · 반별로 한번에 설정도 가능하고, 반 내에서 개별적으로도"*).
 * 규칙 = [`seat-share-adjust.ts`](../seat-share-adjust.ts) · 표 = 0355a `attendance_seat_share_adjust`.
 *
 * 한 반 한 달의 계획 몫(선생님마다 · 자리)과 지금 조정값을 보이고(`loadSeatShareSheet`), 바꾼 선생님들의 값을 **한 번에** 저장한다
 * (`saveSeatShareAdjust` — 선생님마다 반 전체 값 + 따로 정한 학생). 출결 기록은 건드리지 않는다 — 바뀌는 것은 그 선생님의
 * 등록 차수 몫(= 실급여 상한)뿐이다.
 *
 * 🔴 게이트는 화면이 아니라 여기서 다시 본다(#77): 급여 비율을 고칠 수 있는 사람만(이동 없는 판정 `attendanceSalaryAdminOrNull`) ·
 *    받는 선생님은 그 달 그 반을 맡고 있을 때만(지금 담임이거나 그 달 교시 담당) · 학생은 그 달 그 반 수강생만.
 *    단 **줄이거나 지우는 저장**은 이 둘을 면제한다 — 그 달 그 반을 더는 맡지 않는 선생님의 줄 · 명단에서 빠진 학생의 값이
 *    고칠 수 없게 굳어 다른 선생님 몫까지 막는 일이 없게(적대 리뷰 2026-10-07).
 * 🔴 늘리는 저장은 그 달 이 반에서 **수업 몫이 있는 선생님**에게만 — 몫이 없는 선생님의 값은 어느 줄에도 실리지 않는다.
 * 🔴 자리 몫 검사는 선생님 한 명씩이 아니라 **반 전체의 최종 상태**로 본다(`seatShareOverPlan`) — 두 선생님 값을 맞바꾸는 저장이
 *    순서 때문에 거절되지 않게. 쓰기도 한 번에 한다(지울 줄 먼저 → 나머지는 한 문장) — 앞 선생님만 저장되고 멈추는 일이 없다.
 * ⚠️ 급여 숫자가 달라지는 일이라 감사로그를 남긴다(급여 갈래 — 외부 알림으로는 안 나간다). 학생별 값도 앞뒤로 싣는다.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const NO_PERMISSION = "급여 비율을 설정할 수 있는 사람만 자리 몫을 조정할 수 있습니다";
const NOT_READY = "자리 몫을 조정하는 기능이 아직 준비되지 않았습니다. 잠시 후 다시 눌러 주세요";
const SAVE_FAILED = "자리 몫을 저장하지 못했습니다. 잠시 후 다시 눌러 주세요";

type Admin = ReturnType<typeof createAdminClient>;

export type SeatShareSheet = {
  classId: string;
  period: string;
  /** 그 달 자리(JJ실·랩실) 계획 몫 — 달 내내 다닌 학생 기준. */
  seat: number;
  /**
   * 그 달 이 반을 맡은 선생님(담임 먼저) — 계획 몫과 지금 조정값. 조정값이 남아 있는데 그 달 이 반을 더는 맡지 않는 선생님도
   * 싣는다(`assigned: false` — 줄이거나 지울 수만 있다).
   */
  teachers: { id: string; name: string; planned: number; units: number; students: Record<string, number>; assigned: boolean }[];
  /** 그 달 이 반 수강생(이름순) + 값이 남아 있는데 그 달 명단에 없는 학생(`gone` — 줄이거나 지울 수만 있다). */
  students: { id: string; name: string; gone?: boolean }[];
};

/** 한 선생님 앞으로 저장할 값. */
export type SeatShareEntry = { teacherId: string; units: number; students: Record<string, number> };

/** 그 달 그 반 수강생 id — 한 반 한 달이지만 반 이동 이력으로 행이 여럿일 수 있어 페이지로 읽는다(B2). */
async function rosterIds(admin: Admin, tenantId: string, classId: string, from: string, to: string): Promise<string[]> {
  const rows = await fetchAllPaged<{ student_id: string }>((f, t) => admin.from("enrollments").select("student_id")
    .eq("tenant_id", tenantId).eq("class_id", classId).lte("start_date", to).or(`end_date.is.null,end_date.gte.${from}`)
    .order("id", { ascending: true }).range(f, t));
  return [...new Set(rows.map((r) => r.student_id))];
}

export async function loadSeatShareSheet(input: { classId: string; period: string }): Promise<{ ok: true; sheet: SeatShareSheet } | { ok: false; error: string }> {
  const user = await attendanceSalaryAdminOrNull();
  if (!user) return { ok: false, error: NO_PERMISSION };
  if (!input || !UUID.test(String(input.classId)) || !PERIOD.test(String(input.period))) return { ok: false, error: "반을 다시 선택한 뒤 눌러 주세요" };
  const { from, to } = monthRange(input.period);
  const admin = createAdminClient();
  try {
    const supabase = await createClient();
    // 반 판정 재료는 세션 클라이언트로 읽는다(남의 학원 반은 안 보인다 = 지점 확인).
    const [facts, settings, studentIds] = await Promise.all([
      loadScopeFacts(supabase, [{ classId: input.classId, date: from }, { classId: input.classId, date: to }]),
      getTenantSettings(),
      rosterIds(admin, user.tenantId, input.classId, from, to),
    ]);
    const own = facts.get(input.classId);
    if (!own) return { ok: false, error: "이 반을 찾을 수 없습니다" };
    let adjust: Map<string, SeatShareAdjust>;
    try {
      adjust = await readClassSeatShare(admin, user.tenantId, input.classId, input.period);
    } catch (error) {
      if (seatShareTableMissing(error as { code?: string })) return { ok: false, error: NOT_READY };
      throw error;
    }
    const assigned = classTeacherIdsInRange({ homeroomTeacherId: own.homeroomTeacherId, slots: own.slots, from, to });
    const teacherIds = [...new Set([...assigned, ...adjust.keys()])];
    // 값이 남아 있는데 그 달 명단에 없는 학생 — 창에 안 보이면 지울 수도 없다(값은 저장 요청에 계속 실린다).
    const enrolled = new Set(studentIds);
    const goneIds = [...new Set([...adjust.values()].flatMap((value) => Object.keys(value.students)))].filter((id) => !enrolled.has(id));
    const [plan, users, students] = await Promise.all([
      loadClassTermPlan(admin, user.tenantId, input.period, input.classId, Object.keys(buildHolidayMap(settings.operations.holidays))),
      fetchInChunks<{ id: string; display_name: string | null }>(teacherIds, (chunk) => supabase.from("users").select("id, display_name").in("id", chunk)),
      fetchInChunks<{ id: string; name: string }>([...studentIds, ...goneIds], (chunk) => supabase.from("students").select("id, name").in("id", chunk)),
    ]);
    if (!plan) return { ok: false, error: "이 반을 찾을 수 없습니다" };
    const nameOf = new Map(users.map((u) => [u.id, u.display_name ?? "선생님"]));
    const studentName = new Map(students.map((s) => [s.id, s.name]));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ko");
    return {
      ok: true,
      sheet: {
        classId: input.classId,
        period: input.period,
        seat: plan.get("") ?? 0,
        teachers: teacherIds.filter((id) => nameOf.has(id)).map((id) => ({
          id, name: nameOf.get(id)!, planned: plan.get(id) ?? 0, units: adjust.get(id)?.units ?? 0, students: adjust.get(id)?.students ?? {},
          assigned: assigned.includes(id),
        })),
        students: [
          ...studentIds.map((id) => ({ id, name: studentName.get(id) ?? "이름 없음" })).sort(byName),
          ...goneIds.map((id) => ({ id, name: studentName.get(id) ?? "이름 없음", gone: true })).sort(byName),
        ],
      },
    };
  } catch (error) {
    return { ok: false, error: explainDbError(error, { scope: "attendance.seatShare.sheet", fallback: "자리 몫을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요" }).message };
  }
}

export async function saveSeatShareAdjust(input: {
  classId: string; period: string; teachers: SeatShareEntry[];
}): Promise<{ ok: boolean; error?: string; teacherId?: string }> {
  const user = await attendanceSalaryAdminOrNull();
  if (!user) return { ok: false, error: NO_PERMISSION };
  if (!input || !UUID.test(String(input.classId)) || !PERIOD.test(String(input.period)) || !Array.isArray(input.teachers)
    || input.teachers.length === 0 || input.teachers.length > 50
    || input.teachers.some((t) => !t || !UUID.test(String(t.teacherId)))
    || new Set(input.teachers.map((t) => t.teacherId)).size !== input.teachers.length) {
    return { ok: false, error: "반과 선생님을 다시 선택한 뒤 저장해 주세요" };
  }
  const wanted: { teacherId: string; next: SeatShareAdjust }[] = [];
  for (const t of input.teachers) {
    const units = parseSeatShareUnits(t.units);
    const students = parseSeatShareStudents(t.students);
    if (units === null || students === null) return { ok: false, error: "시수는 0 이상 0.5 단위로 적어 주세요", teacherId: t.teacherId };
    wanted.push({ teacherId: t.teacherId, next: { units, students } });
  }
  const { from, to } = monthRange(input.period);
  const admin = createAdminClient();
  try {
    const [facts, roster, settings] = await Promise.all([
      loadScopeFacts(await createClient(), [{ classId: input.classId, date: from }, { classId: input.classId, date: to }]),
      rosterIds(admin, user.tenantId, input.classId, from, to),
      getTenantSettings(),
    ]);
    const own = facts.get(input.classId);
    if (!own) return { ok: false, error: "이 반을 찾을 수 없습니다" };
    let saved: Map<string, SeatShareAdjust>;
    try {
      saved = await readClassSeatShare(admin, user.tenantId, input.classId, input.period);
    } catch (error) {
      if (seatShareTableMissing(error as { code?: string })) return { ok: false, error: NOT_READY };
      throw error;
    }
    const assigned = new Set(classTeacherIdsInRange({ homeroomTeacherId: own.homeroomTeacherId, slots: own.slots, from, to }));
    const enrolled = new Set(roster);
    const changed = wanted.map((w) => ({ ...w, before: saved.get(w.teacherId) ?? null })).filter((w) => !seatShareSame(w.before, w.next));
    if (changed.length === 0) return { ok: false, error: "바뀐 값이 없습니다" };
    for (const { teacherId, before, next } of changed) {
      // 받는 선생님은 그 달 이 반을 맡고 있어야 한다(창의 선택지와 같은 판정 — 요청을 지어 보내도 여기서 걸린다).
      // 더는 맡지 않는 선생님의 남은 값은 줄이거나 지울 수만 있다.
      if (!assigned.has(teacherId) && !(before && seatShareOnlyShrinks(before, next))) {
        return { ok: false, error: "이 반을 맡은 선생님에게만 돌릴 수 있습니다", teacherId };
      }
      // 학생은 그 달 이 반 수강생만. 명단에서 빠진 학생의 남은 값은 그대로 두거나 줄일 수만 있다(새로 적거나 늘릴 수 없다).
      const stale = Object.entries(next.students).some(([id, units]) =>
        !enrolled.has(id) && !(before && Object.hasOwn(before.students, id) && units <= before.students[id]!));
      if (stale) return { ok: false, error: "그 달 이 반 수강생만 따로 정할 수 있습니다", teacherId };
    }
    // 늘리는 저장이 하나라도 있으면 그 달 계획 몫을 읽어 두 가지를 본다. 줄이기만 하는 저장은 계획 몫을 읽지도 않는다
    // (시간표가 바뀌어 이미 넘은 값 · 수업 몫이 없어진 선생님의 값을 고칠 수 있어야 한다).
    const grows = changed.filter((c) => !seatShareOnlyShrinks(c.before, c.next));
    if (grows.length > 0) {
      const plan = await loadClassTermPlan(admin, user.tenantId, input.period, input.classId, Object.keys(buildHolidayMap(settings.operations.holidays)));
      // 🔴 그 달 이 반에서 수업 몫이 없는 선생님에게는 못 돌린다 — 그 값은 어느 학생 줄에도 실리지 않는데(`seatShareTakeFor`가 건너뛴다)
      //    저장은 되고 요약 줄에도 떠서, 돌린 줄 알게 되고 다른 선생님 몫까지 막는다(적대 재리뷰 2026-10-07).
      const idle = grows.find((c) => !((plan?.get(c.teacherId) ?? 0) > 0));
      if (idle) return { ok: false, error: "이 달 이 반에서 수업 몫이 없는 선생님에게는 돌릴 수 없습니다", teacherId: idle.teacherId };
      // 🔴 자리 몫보다 많이는 못 돌린다 — 같은 반의 선생님들이 가져가는 값(선생님마다 가장 큰 값)의 합이 그 달 자리 계획 몫을 넘으면
      //    막는다. 반 전체의 **최종 상태**로 본다(맞바꾸기는 합이 그대로라 통과 · 지금보다 늘지 않으면 넘은 상태에서도 통과).
      const after = new Map(saved);
      for (const { teacherId, next } of changed) after.set(teacherId, next);
      const seat = plan?.get("") ?? 0;
      if (seatShareOverPlan(seat, saved.values(), after.values())) {
        return { ok: false, error: seat > 0 ? `이 달 자리 몫 ${seat}시수보다 많이 돌릴 수 없습니다` : "이 달 이 반에는 돌릴 자리 몫이 없습니다" };
      }
    }
    const scope = { tenant_id: user.tenantId, class_id: input.classId, period: input.period };
    const failed = (error: { code?: string | null; message?: string | null }) => seatShareTableMissing(error)
      ? { ok: false, error: NOT_READY }
      : { ok: false, error: explainDbError(error, { scope: "attendance.seatShare.save", fallback: SAVE_FAILED, context: { classId: input.classId } }).message };
    const logged = (rows: typeof changed) => Promise.all(rows.map(({ teacherId, before, next }) => logAction({
      action: "payroll_seat_share_set",
      targetType: "attendance",
      targetLabel: `${input.period} 자리 몫 조정`,
      metadata: {
        classId: input.classId, period: input.period, userId: teacherId,
        units: next.units, students: Object.keys(next.students).length, studentUnits: next.students,
        before: { units: before?.units ?? 0, students: Object.keys(before?.students ?? {}).length, studentUnits: before?.students ?? {} },
      },
    })));
    // 지울 줄을 먼저 지운다(합이 줄어드는 쪽이라 뒤 문장이 실패해도 자리 몫을 넘은 상태가 남지 않는다) → 나머지는 한 문장으로.
    // 감사로그는 문장이 성공할 때마다 그 줄들 것을 남긴다 — 뒤 문장이 실패해도 이미 지운 줄이 기록 없이 사라지지 않게.
    const removed = changed.filter((c) => seatShareEmpty(c.next));
    if (removed.length > 0) {
      const { error } = await admin.from(SEAT_SHARE_TABLE).delete().match(scope).in("teacher_id", removed.map((c) => c.teacherId));
      if (error) return failed(error);
      await logged(removed);
    }
    const kept = changed.filter((c) => !seatShareEmpty(c.next));
    if (kept.length > 0) {
      const stamp = new Date().toISOString();
      const { error } = await admin.from(SEAT_SHARE_TABLE).upsert(
        kept.map((c) => ({ ...scope, teacher_id: c.teacherId, units: c.next.units, student_units: c.next.students, updated_at: stamp, updated_by: user.id })),
        { onConflict: "tenant_id,class_id,period,teacher_id" });
      if (error) {
        // 지운 줄은 이미 반영됐다 — 화면이 그 사실을 다시 읽게 한다.
        if (removed.length > 0) { revalidatePath("/billing"); revalidatePath("/attendance"); }
        return failed(error);
      }
      await logged(kept);
    }
    revalidatePath("/billing");
    revalidatePath("/attendance");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explainDbError(error, { scope: "attendance.seatShare.save", fallback: SAVE_FAILED }).message };
  }
}
