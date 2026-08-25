import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { dutyAllowsSeat } from "../duty";
import { PIN_SEAT_KEYS, USABLE_SEAT_KEYS, ambiguousClassIds, hhmm, type SeatKey } from "../seat";
import { getSeatDuties } from "./duty";
import { readSeatPinSession } from "./pin-session";
import { getPublicSeatDay, getSeatDay } from "./queries";

export type SeatGateOk = { ok: true; userId: string | null; tenantId: string; via: "menu" | "duty" | "pin" };

/**
 * 자리 출석부 쓰기 게이트.
 *   ① 메뉴 권한(`seat_attendance`) — 사무실.
 *   ② 직원 토글 — **그 자리만**(다른 자리·다른 메뉴는 안 연다).
 *   ③ 공개 PIN 쿠키 — 그 자리·오늘만. recorded_by는 null(키오스크와 같은 정직함).
 *   ④ 그날 그 자리 명단(화이트리스트) — 아래 각 액션이 다시 확인한다(#77).
 *
 * ⚠️ `"use server"` 파일이 아니다 — 클라에서 부르면 안 되는 내부 게이트라 액션 모듈에 두면
 *    export가 서버 액션으로 열린다.
 */
export async function gateSeatWrite(seat: SeatKey, date: string): Promise<SeatGateOk | { error: string }> {
  if (!(USABLE_SEAT_KEYS as readonly string[]).includes(seat)) {
    return { error: "이 자리 출석부는 아직 열리지 않았습니다" };
  }

  const user = await getCurrentUser();
  if (user) {
    const duties = await getSeatDuties(user.id);
    const assigned = dutyAllowsSeat(duties, seat);
    const menuWrite = await canWriteTenant(user.systemRole, "seat_attendance");
    // ⚠️ 권한이 없다고 **여기서 끝내지 않는다** — 자리 태블릿에 누군가의 계정이 로그인된 채로
    //    남아 있을 수 있고, 그 사람이 PIN을 넣었다면 그 자리 출결은 찍을 수 있어야 한다.
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

  const pin = await gateSeatPinOnly(seat, date);
  // 로그인한 사람에게는 "비밀번호를 다시" 대신 권한 문구를 보여준다(그 사람이 풀 문제가 아니다).
  // 날짜 문구(not-today)는 로그인 여부와 무관하게 그대로 — 그게 실제 사유다.
  if ("error" in pin) {
    return { error: user && pin.reason === "no-pin" ? "자리 출석부 입력 권한이 없습니다" : pin.error };
  }
  return { ok: true, userId: null, tenantId: pin.tenantId, via: "pin" };
}

/**
 * **공개 PIN 전용** 게이트 — 로그인 상태를 아예 보지 않는다(그 자리 PIN 쿠키 + 오늘만).
 *
 * `gateSeatWrite`의 PIN 갈래를 그대로 떼어낸 것이라 규칙은 한 벌이다. 로그인 계정으로 열리는 문
 * (메뉴 권한·직원 토글)이 **없어야 하는** 쓰기에 쓴다 — 지금은 공개 화면의 진도(수업계획) 입력
 * (`/seat/jj`)이 유일한 소비처다. 계획 쓰기의 로그인 쪽 문은 자리 권한이 아니라 ECS 게이트라,
 * 여기서 메뉴 권한을 통과시키면 "영어 시트에선 못 여는 반을 자리 권한으로 고치는" 뒷문이 생긴다.
 *
 * 🔴 공개 PIN 여부는 **문 목록**(PIN_SEAT_KEYS)이 정한다 — 급여 축(isPayrollSeat)으로 가르지 말 것.
 *    자리를 하나 여는 일과 그 자리 출결을 담임 시수에서 빼는 일은 서로 다른 결정이다(seat.ts).
 */
export async function gateSeatPinOnly(
  seat: SeatKey,
  date: string,
): Promise<{ ok: true; tenantId: string } | { error: string; reason: "no-pin" | "not-today" }> {
  if (!(PIN_SEAT_KEYS as readonly string[]).includes(seat)) {
    return { error: "비밀번호를 다시 입력해 주세요", reason: "no-pin" };
  }
  const pin = await readSeatPinSession();
  if (!pin || pin.seat !== seat) {
    return { error: "비밀번호를 다시 입력해 주세요", reason: "no-pin" };
  }
  if (date !== kstToday()) return { error: "오늘 날짜만 입력할 수 있습니다", reason: "not-today" };
  return { ok: true, tenantId: pin.tenantId };
}

/** 그 교시 명단에 실제로 있는 (반, 학생) 조합만 통과시킨다. 모호한 반(같은 반·같은 시작·다른 종료)은 제외. */
export async function rosterKeys(
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
    if (blocked.has(roster.classId)) continue;
    classes.set(
      roster.classId,
      roster.students.filter((s) => s.status === null).map((s) => s.id),
    );
    for (const s of roster.students) keys.add(`${roster.classId}|${s.id}`);
  }
  return { keys, classes };
}
