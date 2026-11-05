import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { dutyAllowsSeat } from "../duty";
import { PIN_SEAT_KEYS, USABLE_SEAT_KEYS, ambiguousClassIds, hhmm, type SeatKey } from "../seat";
import { getActiveSeatDuties } from "./duty";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
import { readSeatPinSession } from "./pin-session";
import { getPublicSeatDay, getSeatDay } from "./queries";
import { applySeatDayChoices, getSeatPeriodChoices } from "./period-choice";

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

  // 🔑 담당 토글·명의(recorded_by)는 **화면 주인** — 강사뷰(다른 강사 뷰)면 검증된 대상 강사다. 실제 계정으로 보면
  //    관리자가 자리 담당 강사 X의 화면에서 찍을 때 X의 토글이 안 보여 "입력 권한이 없습니다"가 됐다(2026-11-05 점검).
  // 🔴 직원 토글 갈래는 canWriteTenant를 지나지 않는다 — 읽기 강사뷰가 대상의 토글로 쓰지 못하게 여기서 먼저 막는다.
  //    (PIN 갈래는 로그인과 무관한 문이라 그대로 둔다 — 명의도 null이다.)
  const user = await getCurrentUser({ teacherView: true });
  const readonlyError = user ? await readonlyTeacherViewError() : null;
  if (user && !readonlyError) {
    const duties = await getActiveSeatDuties(user.id, user.tenantId);
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
    if (readonlyError && pin.reason === "no-pin") return { error: readonlyError };
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
  // PIN 쿠키가 남아 있어도 그 지점이 자리 모듈을 껐으면 쓰지 않는다(쿠키 발급 뒤에 끈 경우). 침산은 켜져 있다.
  if (!(await isModuleOnForTenant(pin.tenantId, "seat_attendance"))) {
    return { error: "비밀번호를 다시 입력해 주세요", reason: "no-pin" };
  }
  return { ok: true, tenantId: pin.tenantId };
}

/**
 * 그 교시 명단에 실제로 있는 (반, 학생) 조합만 통과시킨다. 모호한 반(같은 반·같은 시작·다른 종료)은 제외.
 *
 * 🔴 **교시 선택(0255a)을 얹은 뒤**의 명단이다 — 다른 교시로 정해진 학생은 여기 없고, **다른 시간에서
 *    옮겨 온 학생은 여기 있다**(원래 반 id로 — 출결은 언제나 수강 반으로 저장된다). 안 얹으면
 *    일괄 버튼(`남은 N명 출석`)이 **화면에 없는 학생까지** 찍고, 그 칸은 아무도 안 보는 자리에 남아
 *    자리 시수를 부풀린다(화면은 이미 거른 명단으로 N을 센다).
 * ⚠️ 이미 기록이 있는 칸은 안 감춰진다(사실이 규칙을 이긴다) — 그래서 잘못 찍은 칸을 **고칠 길은 늘 남는다**.
 */
export async function rosterKeys(
  seat: SeatKey,
  date: string,
  slotStart: string,
  /** 공개(PIN) 경로면 그 테넌트 — 명단 조회를 admin으로 돌린다. 로그인 경로는 null. */
  tenantId: string | null,
  /** 교시 선택을 읽을 테넌트(언제나 있다) — 그 표는 RLS 정책이 0개라 admin으로만 읽힌다([[#104]]). */
  choiceTenantId: string,
): Promise<{
  keys: Set<string>;
  classes: Map<string, string[]>;
  /**
   * 그 교시 **전체 명단**(찍힌 칸 포함) — 자리 배치(`applySeatPlacements`)를 얹을 때 쓴다.
   * 🔴 `classes`(미체크만)로는 배치를 못 얹는다 — 이미 찍힌 학생도 화면에선 옮겨 앉아 있어서,
   *    미체크 목록만 보면 "이 반 출석"이 화면과 다른 집합을 채운다.
   */
  rosters: { classId: string; students: { id: string }[] }[];
} | null> {
  const [day, choiceLoad] = await Promise.all([
    tenantId ? getPublicSeatDay(tenantId, seat, date) : getSeatDay(seat, date),
    getSeatPeriodChoices(choiceTenantId, seat, date),
  ]);
  const period = day.periods.find((p) => p.start === hhmm(slotStart));
  if (!period) return null;
  // 🔑 화면이 그린 것과 **같은 함수·같은 재료**로 거른다 — 갈리면 버튼의 N과 실제로 쓰는 수가 어긋난다.
  //    다른 시간에서 옮겨 온 학생도 여기서 목표 교시에 선다(원래 교시에선 빠진다) — 그래서 그 칸만 찍힌다.
  const rosterByPeriod = applySeatDayChoices(day, choiceLoad, date);
  const blocked = new Set(ambiguousClassIds(period));
  const keys = new Set<string>();
  const classes = new Map<string, string[]>();
  const rosters: { classId: string; students: { id: string }[] }[] = [];
  for (const roster of rosterByPeriod[period.start] ?? []) {
    if (blocked.has(roster.classId)) continue;
    classes.set(
      roster.classId,
      roster.students.filter((s) => s.status === null).map((s) => s.id),
    );
    rosters.push({ classId: roster.classId, students: roster.students.map((s) => ({ id: s.id })) });
    for (const s of roster.students) keys.add(`${roster.classId}|${s.id}`);
  }
  return { keys, classes, rosters };
}
