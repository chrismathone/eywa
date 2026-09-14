import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 보강 예약(0264a) **배선 가드** — 원장 2026-09-14 *"모든 곳에 배선이 철저하게 이루어져있어야해"*.
 *
 * 순수 규칙이 맞아도 표면이 그 함수를 안 지나가면 소용없다. 소스를 텍스트로 스캔해 잠근다:
 *  ① 출결 **쓰기 경로 전부**(단건·일별 폼·일괄·범위)가 저장 뒤 `completeMakeupReservations`를 부른다 — 한 경로가
 *     빠지면 그 화면에서 찍은 보강은 예약이 영영 `reserved`로 남는다.
 *  ② 단건 저장의 강사 게이트가 예약을 `allowMakeup`과 같은 문으로 본다(`hasReservedMakeup`) — 없으면 예약된
 *     학생이 수강생이 아닐 때 강사가 그 칸을 못 찍는다.
 *  ③ 명단 표면(월별 출석부·일별 출석부·오늘 출결·원스크린·ECS 오늘)이 예약 조회 한 벌을 읽는다.
 *  ④ 예약 조회는 **fail-soft** — 표가 없어도 던지지 않는다(원스크린은 강사 전원의 hot path, #95).
 *  ⑤ 감사로그 세 키가 등록돼 있다.
 */
const SRC = path.join(process.cwd(), "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const count = (text: string, needle: string) => text.split(needle).length - 1;

const ACTIONS = strip(read("features/attendance/server/actions.ts"));

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name}을 찾지 못함`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("① 출결 쓰기 경로 전부가 저장 뒤 예약을 이행한다", () => {
  it.each(["setAttendanceCell", "saveAttendance", "setAttendanceBulk", "setAttendanceRange"])("%s", (name) => {
    const body = fnBody(ACTIONS, name);
    expect(body).toContain("completeMakeupReservations(");
    // 감사로그 뒤·알림 앞 — 저장이 끝난 자리에서(실패해도 저장을 되돌리지 않는다).
    expect(body.indexOf("completeMakeupReservations(")).toBeGreaterThan(body.indexOf("logAction({"));
  });
});

describe("①-3 출결 행을 직접 INSERT하는 다른 문(보고서 저장·키오스크·자리)도 훅을 지난다", () => {
  it.each([
    "features/attendance/server/makeup-pool.ts",
    "features/attendance/kiosk/server/checkin.ts",
    "features/attendance/seat/server/actions.ts",
  ])("%s", (rel) => {
    expect(strip(read(rel))).toContain("completeMakeupReservations(");
  });
  it("보고서 저장의 반 없는 보강은 예약이 있으면 **예약의 반**에 앉힌다(풀 반이 아니라)", () => {
    const pool = strip(read("features/attendance/server/makeup-pool.ts"));
    expect(pool).toContain("findReservedForReport(admin, input)");
    expect(pool.indexOf("findReservedForReport(admin, input)")).toBeLessThan(pool.indexOf("ensureMakeupPoolClass({"));
  });
});

describe("①-2 지우기 갈래도 되돌림 훅을 지난다(이행된 예약이 보강일 칸 삭제에 갇히지 않게)", () => {
  it("단건 지우기(status=null) 갈래 — 감사로그 attendance_clear 뒤에 부른다", () => {
    const body = fnBody(ACTIONS, "setAttendanceCell");
    const clear = body.indexOf('action: "attendance_clear"');
    expect(clear).toBeGreaterThan(-1);
    // 🔴 경계는 코드 문자열이어야 한다 — 줄 주석은 strip()이 먼저 지워 indexOf가 -1이 되고 검사가 함수 끝까지 늘어난다(재리뷰 2026-09-14).
    const end = body.indexOf("const [{ data: rows }, scopeFacts] = await Promise.all([");
    expect(end).toBeGreaterThan(clear);
    const after = body.slice(clear, end);
    expect(after).toContain("completeMakeupReservations({ tenantId: user.tenantId }, [{ studentId, classId, date: sessionDate, status: null }])");
  });
  it("범위 지우기 갈래 — attendance_range_clear 뒤에 부른다", () => {
    const body = fnBody(ACTIONS, "setAttendanceRange");
    const clear = body.indexOf('action: "attendance_range_clear"');
    expect(clear).toBeGreaterThan(-1);
    const end = body.indexOf("const plans = new Map<string, DayUnitsPlan>();");
    expect(end).toBeGreaterThan(clear);
    const after = body.slice(clear, end);
    expect(after).toContain("status: null })),");
    expect(after).toContain("completeMakeupReservations(");
  });
});

describe("②-2 일괄·범위 저장의 강사 게이트도 예약을 본다(단건과 같은 문)", () => {
  it.each(["setAttendanceBulk", "setAttendanceRange"])("%s — reservedCellKeys로 비수강 칸을 연다", (name) => {
    const body = fnBody(ACTIONS, name);
    expect(body).toContain("reservedCellKeys(");
    expect(body).toContain("reservedKeys.has(reservedCellKey(");
  });
});

describe("② 단건 저장의 강사 게이트 — 예약된 학생은 수강행 없이도 그날 칸을 연다", () => {
  it("hasReservedMakeup을 canWriteAttendanceStudent의 allowMakeup에 잇는다(수강생·기록이 없을 때만 묻는다)", () => {
    const body = fnBody(ACTIONS, "setAttendanceCell");
    expect(body).toContain("hasReservedMakeup(user.tenantId, { studentId, classId, date: sessionDate })");
    const gate = body.slice(body.indexOf("canWriteAttendanceStudent({"), body.indexOf("이 반 수강생이 아닙니다"));
    expect(gate).toContain("(enrolled ?? 0) === 0");
    expect(gate).toContain("(existing ?? 0) === 0");
  });
});

describe("③ 명단 표면이 예약 조회 한 벌을 읽는다", () => {
  it("월별 출석부 = 반·기간(칸 + 명단 합치기)", () => {
    const q = strip(read("features/attendance/server/queries.ts"));
    expect(q).toContain("getClassReservationsInRange(classId, startIso, endIso)");
    expect(q).toContain("...reservedRows.map((r) => r.studentId)");
    expect(q).toContain("reservations[r.studentId]");
  });
  it("일별 출석부 = 그날(행에 reserved + 명단 합치기)", () => {
    const q = strip(read("features/attendance/server/queries.ts"));
    expect(q).toContain("getReservationsOn(date, [classId])");
    expect(q).toContain("makeupStudentIds([...recordMap.keys(), ...reservedOf.keys()], [...enrolledIds])");
  });
  it("오늘 출결 = 그 교시 칸에만(반 전체 명단엔 안 넣는다)", () => {
    const q = strip(read("features/attendance/live/server/load.ts"));
    expect(q).toContain("getReservationsOn(date, slotClassIds)");
    expect(q).toContain("reservedRaw.filter((r) => activeClasses.has(r.classId))");
    expect(q).toContain("reservedBySlot.get(`${slot.class_id}|${start}`)");
    expect(q).not.toContain("expectedByClass.set(r.classId");
  });
  it("원스크린 = 별도 조회(fail-soft) + 보강 행으로(반은 activeIds에 안 넣는다)", () => {
    const q = strip(read("features/onescreen/server/roster.ts"));
    expect(q).toContain("getReservationsOn(targetDate, allIds)");
    expect(q).toContain("for (const r of reservedToday)");
    expect(q).toContain("reservedToday.length === 0");
  });
  it("시간표 기본뷰 반 칸 = '보강' 줄(대기·퇴원 아래) — 기본뷰 격자에만 얹고 명단·엑셀·이동 판정엔 안 실린다", () => {
    const page = strip(read("app/(shell)/timetable/page.tsx"));
    expect(page).toContain("await attachReservedLines(slots, referenceDate)");
    expect(page).toContain("slots={basicSlots}");
    expect(count(page, "basicSlots")).toBe(2);
    const tables = strip(read("app/(shell)/timetable/_components/weekday-group-tables.tsx"));
    expect(tables).toContain("reserved={uniqueReserved(merged)}");
    expect(strip(read("app/(shell)/timetable/_components/class-cell.tsx"))).toContain("<ReservedSection lines={reserved} />");
    expect(strip(read("app/(shell)/timetable/_components/hapban-cell.tsx"))).toContain("<ReservedSection lines={reserved} />");
    for (const rel of ["features/timetable/lib/class-move.ts", "features/timetable/lib/hapban.ts", "features/exports/timetable-excel.ts"]) {
      if (!fs.existsSync(path.join(SRC, rel))) continue;
      expect(strip(read(rel)), rel).not.toMatch(/\breserved\b/);
    }
  });
  it("ECS 오늘 = 같은 규약(makeupStudentIds)으로 보강 행", () => {
    const q = strip(read("features/class-sheets/server/today.ts"));
    expect(q).toContain("getReservationsOn(date, todayIds)");
    expect(count(q, "reservedToday.filter((r) => r.classId === classId)")).toBe(2);
  });
});

describe("④ 예약 조회는 fail-soft — 표가 없어도 던지지 않는다", () => {
  it("모든 조회가 isMissingReservationTable / catch로 빈 목록으로 접는다", () => {
    const q = strip(read("features/attendance/server/makeup-reservation-queries.ts"));
    expect(q).toContain("export function isMissingReservationTable");
    for (const fn of ["getClassReservationsInRange", "getReservationsOn", "getReservationsInWeek", "getStudentUpcomingReservations"]) {
      const body = q.slice(q.indexOf(fn), q.indexOf("\nexport", q.indexOf(fn) + 1));
      expect(body, fn).toMatch(/soft\(|catch/);
    }
    // 게이트 판정은 문을 넓히는 쪽으로 실패하지 않는다.
    expect(q.slice(q.indexOf("export async function hasReservedMakeup"))).toContain("return false;");
  });
});

describe("⑤ 감사로그 키가 등록돼 있다(뷰어에 영문 키 원문이 뜨지 않게)", () => {
  it("makeup_reserve · makeup_reserve_cancel · makeup_reserve_done · makeup_reserve_revert", () => {
    const log = read("features/audit/server/log.ts");
    const describe_ = read("features/audit/describe.ts");
    for (const key of ["makeup_reserve", "makeup_reserve_cancel", "makeup_reserve_done", "makeup_reserve_revert"]) {
      expect(log).toContain(`  ${key}:`);
      expect(describe_).toContain(`case "${key}":`);
    }
  });
});
