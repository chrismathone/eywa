"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { dutyAllowsSeat } from "../duty";
import {
  USABLE_SEAT_KEYS,
  SEAT_DB_LABEL,
  ambiguousClassIds,
  hhmm,
  isPayrollSeat,
  type SeatKey,
} from "../seat";
import { getSeatDuties } from "./duty";
import { readSeatPinSession } from "./pin-session";
import { getPublicSeatDay, getSeatDay } from "./queries";

export type SeatStatus = "present" | "absent" | "late";
export type SeatResult = { ok: true; changed: number } | { error: string };

type GateOk = { ok: true; userId: string | null; tenantId: string; via: "menu" | "duty" | "pin" };

/**
 * 자리 출석부 쓰기 게이트.
 *   ① 메뉴 권한(`seat_attendance`) — 사무실.
 *   ② 직원 토글 — **그 자리만**(다른 자리·다른 메뉴는 안 연다).
 *   ③ 공개 PIN 쿠키 — 그 자리·오늘만. recorded_by는 null(키오스크와 같은 정직함).
 *   ④ 그날 그 자리 명단(화이트리스트) — 아래 각 액션이 다시 확인한다(#77).
 */
async function gate(seat: SeatKey, date: string): Promise<GateOk | { error: string }> {
  if (!(USABLE_SEAT_KEYS as readonly string[]).includes(seat)) {
    return { error: "이 자리 출석부는 아직 열리지 않았습니다" };
  }

  const user = await getCurrentUser();
  if (user) {
    const duties = await getSeatDuties(user.id);
    const assigned = dutyAllowsSeat(duties, seat);
    const menuWrite = await canWriteTenant(user.systemRole, "seat_attendance");
    // ⚠️ 권한이 없다고 **여기서 끝내지 않는다** — 자리 태블릿에 누군가의 계정이 로그인된 채로
    //    남아 있을 수 있고, 그 사람이 PIN을 넣었다면 그 자리 출결은 찍을 수 있어야 한다
    //    (로그인했다는 이유로 오히려 막히면 "왜 나만 안 되지"가 된다). 아래 PIN 검사로 떨어진다.
    if (assigned || menuWrite) {
      if (date !== kstToday() && !(await canWriteTenant(user.systemRole, "attendance"))) {
        return { error: "지난 날짜는 수정할 수 없습니다 — 관리자에게 요청하세요" };
      }
      return {
        ok: true,
        userId: user.id,
        tenantId: user.tenantId,
        via: assigned && !menuWrite ? "duty" : "menu",
      };
    }
  }

  // 공개 PIN은 자리 시수를 켠 자리만(랩실). JJ실은 로그인 출석부만.
  if (!isPayrollSeat(seat)) {
    return { error: user ? "자리 출석부 입력 권한이 없습니다" : "비밀번호를 다시 입력해 주세요" };
  }
  const pin = await readSeatPinSession();
  if (!pin || pin.seat !== seat) {
    return { error: user ? "자리 출석부 입력 권한이 없습니다" : "비밀번호를 다시 입력해 주세요" };
  }
  if (date !== kstToday()) return { error: "오늘 날짜만 입력할 수 있습니다" };
  // 🔴 PIN 경로는 **기록자를 남기지 않는다**(로그인한 사람이 있어도 그 사람이 찍었다는 보장이 없다 —
  //    태블릿에 남의 계정이 켜져 있을 수 있다). 키오스크 셀프 체크인과 같은 정직함.
  return { ok: true, userId: null, tenantId: pin.tenantId, via: "pin" };
}

/** 그 교시 명단에 실제로 있는 (반, 학생) 조합만 통과시킨다. 모호한 반(같은 반·같은 시작·다른 종료)은 제외. */
async function rosterKeys(
  seat: SeatKey,
  date: string,
  slotStart: string,
  tenantId: string | null,
): Promise<{ keys: Set<string>; classes: Map<string, string[]> } | null> {
  const day = tenantId ? await getPublicSeatDay(tenantId, seat, date) : await getSeatDay(seat, date);
  const period = day.periods.find((p) => p.start === hhmm(slotStart));
  if (!period) return null;
  const blocked = new Set(ambiguousClassIds(period));
  const keys = new Set<string>();
  const classes = new Map<string, string[]>();
  for (const roster of day.rosterByPeriod[period.start] ?? []) {
    if (blocked.has(roster.classId)) continue; // 저장키로 두 교시를 구분할 수 없는 반 — 입력을 막는다
    classes.set(
      roster.classId,
      roster.students.filter((s) => s.status === null).map((s) => s.id),
    );
    for (const s of roster.students) keys.add(`${roster.classId}|${s.id}`);
  }
  return { keys, classes };
}

/** 자리 기록 한 칸 저장. `status: null` = 미체크로 되돌리기(그 교시 기록 삭제). */
export async function setSeatCell(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  classId: string;
  studentId: string;
  status: SeatStatus | null;
}): Promise<SeatResult> {
  const g = await gate(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null);
  if (!roster) return { error: "그 시각에는 이 자리 수업이 없습니다" };
  if (!roster.keys.has(`${input.classId}|${input.studentId}`)) {
    return { error: "이 교시 명단에 없는 학생입니다" };
  }

  const supabase = g.via === "pin" ? createAdminClient() : await createClient();
  const changed = await writeOne(supabase, {
    tenantId: g.tenantId,
    userId: g.userId,
    seat: input.seat,
    date: input.date,
    slot,
    classId: input.classId,
    studentId: input.studentId,
    status: input.status,
  });
  if (typeof changed === "string") return { error: changed };

  revalidatePath("/attendance/seat");
  revalidatePath("/attendance");
  revalidatePath("/seat");
  return { ok: true, changed };
}

/**
 * 일괄 — **미체크인 학생만** 채운다(비파괴). 이미 찍힌 값은 절대 덮지 않는다(ECS 일괄 출석과 같은 규약).
 * `classId`를 주면 그 반만("이 반 출석"), 없으면 그 교시 전체.
 */
export async function fillSeatSlot(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  status: Extract<SeatStatus, "present" | "absent">;
  classId?: string;
}): Promise<SeatResult> {
  const g = await gate(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null);
  if (!roster) return { error: "그 시각에는 이 자리 수업이 없습니다" };

  const targets = input.classId
    ? [[input.classId, roster.classes.get(input.classId) ?? []] as const]
    : [...roster.classes.entries()];
  if (input.classId && !roster.classes.has(input.classId)) return { error: "이 교시에 없는 반입니다" };

  const rows = targets.flatMap(([classId, studentIds]) =>
    studentIds.map((studentId) => ({
      tenant_id: g.tenantId,
      class_id: classId,
      student_id: studentId,
      session_date: input.date,
      slot_start: slot,
      status: input.status,
      seat_label: isPayrollSeat(input.seat) ? SEAT_DB_LABEL[input.seat] : null,
      recorded_by: g.userId,
    })),
  );
  if (rows.length === 0) return { ok: true, changed: 0 };

  const supabase = g.via === "pin" ? createAdminClient() : await createClient();
  const { error } = await supabase.from("attendance_records").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/attendance/seat");
  revalidatePath("/attendance");
  revalidatePath("/seat");
  return { ok: true, changed: rows.length };
}

/**
 * 한 칸 쓰기 — 그 교시의 유효행이 있으면 갱신, 없으면 삽입, `status: null`이면 삭제.
 * 반환: 바뀐 행 수, 실패 시 에러 문자열.
 *
 * ⚠️ 항상 **그 교시(slot_start)만** 다룬다 — 같은 날 다른 교시 기록은 건드리지 않는다.
 * ⚠️ `seat_label`은 **쓸 때 한 번 박고** 그대로 둔다(0208a) — 담임 시수 집계가 이 값으로 행을 거른다.
 *    반 출석부에서 같은 칸을 고쳐도 그 경로는 이 칼럼을 아예 언급하지 않으므로 자리 표시는 보존된다.
 * 📌 반 출결 완료 알림(notifyIfClassAttendanceComplete)은 부르지 않는다 — 자리 교시는 그 반 수업의
 *    일부일 뿐이라 "이 반 오늘 출결 끝"이 아니다.
 */
async function writeOne(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  p: {
    tenantId: string;
    userId: string | null;
    seat: SeatKey;
    date: string;
    slot: string;
    classId: string;
    studentId: string;
    status: SeatStatus | null;
  },
): Promise<number | string> {
  const base = supabase
    .from("attendance_records")
    .select("id, recorded_at")
    .eq("tenant_id", p.tenantId)
    .eq("class_id", p.classId)
    .eq("student_id", p.studentId)
    .eq("session_date", p.date)
    .eq("slot_start", p.slot);

  if (p.status === null) {
    const { error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("tenant_id", p.tenantId)
      .eq("class_id", p.classId)
      .eq("student_id", p.studentId)
      .eq("session_date", p.date)
      .eq("slot_start", p.slot);
    return error ? error.message : 1;
  }

  const { data: rows } = await base.order("recorded_at", { ascending: false }).limit(1);
  const existing = rows?.[0]?.id as string | undefined;
  if (existing) {
    const { error } = await supabase
      .from("attendance_records")
      .update({
        status: p.status,
        ...(isPayrollSeat(p.seat) ? { seat_label: SEAT_DB_LABEL[p.seat] } : {}),
        recorded_by: p.userId,
        recorded_at: new Date().toISOString(),
      })
      .eq("id", existing);
    return error ? error.message : 1;
  }

  const { error } = await supabase.from("attendance_records").insert({
    tenant_id: p.tenantId,
    class_id: p.classId,
    student_id: p.studentId,
    session_date: p.date,
    slot_start: p.slot,
    status: p.status,
    seat_label: isPayrollSeat(p.seat) ? SEAT_DB_LABEL[p.seat] : null,
    recorded_by: p.userId,
  });
  return error ? error.message : 1;
}
