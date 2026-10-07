"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { monthRange } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { explainDbError } from "@/lib/supabase/db-error";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceMark } from "../cell-display";
import { scopeTeaches, type ScopeClassFacts } from "../scope-ownership";
import { planSeatGive, seatGiveCells, type SeatGiveChange, type SeatGiveRecord } from "../seat-give";
import { classTeacherIdsInRange } from "../teacher-axis";
import { attendanceSalaryAdminOrNull } from "./salary-rates";
import { loadScopeFacts } from "./scope-ownership";
import { taughtByColumnReady } from "./taught-by-db";

/**
 * **JJ실 시수를 선생님에게 주기** — 회차 확정의 JJ실 줄에서 연다(원장 2026-10-07 *"회차 확정에 JJ반이 생기면 거기서 주면 그냥 쉽게
 * 해결할 수 있는것 같은데?"* → 선택: JJ 줄 + 날짜 골라 주기 · 다른 입구는 없앤다). 규칙 = [`seat-give.ts`](../seat-give.ts).
 *
 * 한 반 한 달의 JJ실 기록을 날짜 × 학생으로 펴 보이고(`loadSeatGiveSheet`), 고른 칸의 귀속(`attendance_records.taught_by`, 0316a)만
 * 고친다(`saveSeatGives`) — 출결 상태·시수·메모는 건드리지 않는다. 그 기록은 그 선생님 출석부의 시수가 되고 등록 차수 몫(실급여
 * 상한)이 함께 옮겨지며 JJ실 월간 출석부의 시수 합계에서는 빠진다.
 *
 * 🔴 게이트는 화면이 아니라 여기서 다시 본다(#77): 급여 비율을 고칠 수 있는 사람만('다른 강사 뷰'는 열람 전용이라 거절 ·
 *    이동 없는 판정 `attendanceSalaryAdminOrNull` — 액션은 홈으로 보내지 않고 `{ ok: false }`를 돌려준다) ·
 *    받는 선생님은 그 달 그 반을 맡고 있을 때만(`scopeTeaches` — 지금 담임이거나 그 달 교시 담당) · JJ실 기록만(랩실 제외).
 * ⚠️ 급여 숫자가 달라지는 일이라 감사로그를 남긴다(급여 갈래 — 외부 알림으로는 안 나간다).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
/** 한 번에 받는 칸 수 — 한 반(수십 명) × 한 달 JJ 날짜를 넉넉히 덮는다. */
const MAX_CHANGES = 3000;

type RecordRow = {
  id: string; student_id: string; session_date: string; slot_start: string | null; seat_label: string | null; recorded_via: string | null;
  taught_by: string | null; status: AttendanceMark; session_units: number | string | null; recorded_at: string | null;
};
type Admin = ReturnType<typeof createAdminClient>;

const NO_PERMISSION = "급여 비율을 설정할 수 있는 사람만 JJ실 시수를 줄 수 있습니다";
const NOT_READY = "시수를 주는 기능이 아직 준비되지 않았습니다. 잠시 후 다시 눌러 주세요";

const shapeRow = (r: RecordRow): SeatGiveRecord => ({
  id: r.id, studentId: r.student_id, date: r.session_date, slotStart: r.slot_start, seatLabel: r.seat_label, recordedVia: r.recorded_via,
  taughtBy: r.taught_by, status: r.status, units: r.session_units === null || r.session_units === undefined ? null : Number(r.session_units),
  recordedAt: r.recorded_at,
});

/** 그 반 그 기간의 출결 기록 — 한 반 한 달(학생 × 날짜 × 교시 + 정정 이력)이라 페이지로 다 읽는다(B2). */
async function readRecords(admin: Admin, tenantId: string, classId: string, from: string, to: string): Promise<SeatGiveRecord[]> {
  const rows = await fetchAllPaged<RecordRow>((f, t) => admin.from("attendance_records")
    .select("id, student_id, session_date, slot_start, seat_label, recorded_via, taught_by, status, session_units, recorded_at")
    .eq("tenant_id", tenantId).eq("class_id", classId).gte("session_date", from).lte("session_date", to)
    .order("id", { ascending: true }).range(f, t));
  return rows.map(shapeRow);
}

/** 반 판정 재료(담임 · 그 달 교시) — 세션 클라이언트로 읽는다(남의 학원 반은 안 보인다 = 지점 확인). */
async function readFacts(classId: string, from: string, to: string): Promise<ScopeClassFacts | undefined> {
  const facts = await loadScopeFacts(await createClient(), [{ classId, date: from }, { classId, date: to }]);
  return facts.get(classId);
}

export type SeatGiveSheet = {
  classId: string;
  period: string;
  /** JJ실 기록이 있는 날짜(오름차순). */
  dates: string[];
  /** JJ실 기록이 있는 학생(이름순). */
  students: { id: string; name: string }[];
  /** 학생 id → 날짜 → 그 칸의 시수와 지금 몫(null = JJ실 그대로 · "mixed" = 교시마다 다르다). */
  cells: Record<string, Record<string, { units: number; holder: string | null | "mixed" }>>;
  /** 받을 수 있는 선생님(담임 먼저). */
  teachers: { id: string; name: string }[];
  /** 이미 받은 선생님 이름(지금은 후보가 아니어도 표시한다). */
  names: Record<string, string>;
};

export async function loadSeatGiveSheet(input: { classId: string; period: string }): Promise<{ ok: true; sheet: SeatGiveSheet } | { ok: false; error: string }> {
  const user = await attendanceSalaryAdminOrNull();
  if (!user) return { ok: false, error: NO_PERMISSION };
  if (!input || !UUID.test(String(input.classId)) || !PERIOD.test(String(input.period))) return { ok: false, error: "반을 다시 선택한 뒤 눌러 주세요" };
  const admin = createAdminClient();
  if (!(await taughtByColumnReady(admin, { fresh: true }))) return { ok: false, error: NOT_READY };
  const { from, to } = monthRange(input.period);
  try {
    const [own, records] = await Promise.all([readFacts(input.classId, from, to), readRecords(admin, user.tenantId, input.classId, from, to)]);
    if (!own) return { ok: false, error: "이 반을 찾을 수 없습니다" };
    const cells = seatGiveCells(records, own.slots);
    const studentIds = [...new Set([...cells.values()].map((c) => c.studentId))];
    const teacherIds = classTeacherIdsInRange({ homeroomTeacherId: own.homeroomTeacherId, slots: own.slots, from, to });
    const holderIds = [...new Set([...cells.values()].map((c) => c.holder).filter((h): h is string => !!h && h !== "mixed"))];
    const supabase = await createClient();
    const [students, users] = await Promise.all([
      fetchInChunks<{ id: string; name: string }>(studentIds, (chunk) => supabase.from("students").select("id, name").in("id", chunk)),
      fetchInChunks<{ id: string; display_name: string | null }>([...new Set([...teacherIds, ...holderIds])], (chunk) =>
        supabase.from("users").select("id, display_name").in("id", chunk)),
    ]);
    const names: Record<string, string> = {};
    for (const u of users) if (u.display_name) names[u.id] = u.display_name;
    const sheetCells: SeatGiveSheet["cells"] = {};
    for (const cell of cells.values()) (sheetCells[cell.studentId] ??= {})[cell.date] = { units: cell.units, holder: cell.holder };
    return {
      ok: true,
      sheet: {
        classId: input.classId,
        period: input.period,
        dates: [...new Set([...cells.values()].map((c) => c.date))].sort(),
        // 🔴 줄은 **칸에서** 세운다 — 이름 조회에서 빠진 학생(0행·일부만)이 표에서 말없이 사라지면 "그 날 전원"에서도 빠진다.
        students: studentIds.map((id) => ({ id, name: students.find((s) => s.id === id)?.name ?? "이름 없음" })).sort((a, b) => a.name.localeCompare(b.name, "ko")),
        cells: sheetCells,
        teachers: teacherIds.filter((id) => names[id]).map((id) => ({ id, name: names[id]! })),
        names,
      },
    };
  } catch (error) {
    return { ok: false, error: explainDbError(error, { scope: "attendance.seatGive.sheet", fallback: "JJ실 기록을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요" }).message };
  }
}

export async function saveSeatGives(input: { classId: string; period: string; changes: SeatGiveChange[] }): Promise<{ ok: boolean; error?: string; changed?: number; units?: number; missing?: number }> {
  const user = await attendanceSalaryAdminOrNull();
  if (!user) return { ok: false, error: NO_PERMISSION };
  if (!input || !UUID.test(String(input.classId)) || !PERIOD.test(String(input.period)) || !Array.isArray(input.changes)) {
    return { ok: false, error: "반을 다시 선택한 뒤 눌러 주세요" };
  }
  const { from, to } = monthRange(input.period);
  const changes = input.changes;
  if (changes.length === 0) return { ok: false, error: "바꾼 칸이 없습니다" };
  if (changes.length > MAX_CHANGES) return { ok: false, error: "한 번에 너무 많은 칸을 보냈습니다. 날짜를 나눠 저장해 주세요" };
  for (const c of changes) {
    if (!c || !UUID.test(String(c.studentId)) || !YMD.test(String(c.date)) || c.date < from || c.date > to || !(c.teacherId === null || UUID.test(String(c.teacherId)))) {
      return { ok: false, error: "칸을 다시 선택한 뒤 저장해 주세요" };
    }
  }
  const admin = createAdminClient();
  if (!(await taughtByColumnReady(admin, { fresh: true }))) return { ok: false, error: NOT_READY };

  let plan;
  try {
    const [own, records] = await Promise.all([readFacts(input.classId, from, to), readRecords(admin, user.tenantId, input.classId, from, to)]);
    if (!own) return { ok: false, error: "이 반을 찾을 수 없습니다" };
    // 받는 선생님은 그 날짜의 달에 이 반을 맡고 있어야 한다(화면의 선택지와 같은 판정 — 요청을 지어 보내도 여기서 걸린다).
    for (const c of changes) {
      if (c.teacherId && !scopeTeaches(own, c.teacherId, c.date)) return { ok: false, error: "이 반을 맡은 선생님에게만 줄 수 있습니다" };
    }
    plan = planSeatGive(seatGiveCells(records, own.slots), changes);
  } catch (error) {
    return { ok: false, error: explainDbError(error, { scope: "attendance.seatGive.read", fallback: "JJ실 기록을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요" }).message };
  }
  if (plan.changed === 0) {
    return { ok: false, error: plan.missing > 0 ? "그 칸의 JJ실 기록이 없어 바꾸지 못했습니다. 창을 닫았다 다시 열어 주세요" : "바뀐 칸이 없습니다", missing: plan.missing };
  }

  // 묶음(이전 몫 → 새 몫)마다 고치고 **바로** 감사로그를 남긴다 — 선생님에게 간 것은 '주기', JJ실로 돌아온 것은 '되돌리기'
  // (다른 선생님에게서 옮긴 것은 둘 다). 🔴 뒤 묶음이 실패해도 앞 묶음의 로그가 빠지지 않는다 — 실패한 묶음도 일부가 반영됐으면
  // `partial` 표식과 함께 남긴다(다시 저장하면 반영된 칸은 '이미 그 몫'이라 건너뛰어 로그를 남길 기회가 다시 없다).
  const logMove = async (move: (typeof plan.moves)[number], partial: boolean) => {
    const base = { classId: input.classId, dates: move.dates, date: move.dates[0], students: move.students, units: move.units, ...(partial ? { partial: true } : {}) };
    if (move.from) {
      await logAction({ action: "payroll_jj_units_return", targetType: "attendance", targetLabel: `${input.period} JJ실 시수 되돌리기`, metadata: { ...base, userId: move.from } });
    }
    if (move.to) {
      await logAction({ action: "payroll_jj_units_take", targetType: "attendance", targetLabel: `${input.period} JJ실 시수 주기`, metadata: { ...base, userId: move.to } });
    }
  };
  let applied = false;
  for (const move of plan.moves) {
    for (let i = 0; i < move.ids.length; i += 100) {
      const { error } = await admin.from("attendance_records")
        .update({ taught_by: move.to })
        .eq("tenant_id", user.tenantId).in("id", move.ids.slice(i, i + 100));
      if (error) {
        if (i > 0) await logMove(move, true);
        // 앞 묶음·앞 청크가 이미 반영됐으면 화면이 옛 값으로 남지 않게 새로 읽힌다.
        if (applied || i > 0) { revalidatePath("/billing"); revalidatePath("/attendance"); }
        return { ok: false, error: explainDbError(error, { scope: "attendance.seatGive.save", fallback: "시수를 주지 못했습니다. 일부만 반영됐을 수 있으니 창을 닫았다 다시 열어 확인해 주세요", context: { classId: input.classId } }).message };
      }
    }
    await logMove(move, false);
    applied = true;
  }
  revalidatePath("/billing");
  revalidatePath("/attendance");
  return { ok: true, changed: plan.changed, units: Math.round(plan.moves.reduce((sum, m) => sum + m.units, 0) * 10) / 10, missing: plan.missing };
}
