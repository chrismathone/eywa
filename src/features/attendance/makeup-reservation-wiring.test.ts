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
  it("hasReservedMakeup을 학생 자격 판정(writeEligibility)에 잇는다 — 수강생이 아니면 기존 기록이 있어도 묻는다(결정 #5: 기록만이면 정정만)", () => {
    const body = fnBody(ACTIONS, "setAttendanceCell");
    expect(body).toContain("hasReservedMakeup(user.tenantId, { studentId, classId, date: sessionDate })");
    const gate = body.slice(body.indexOf("const isEnrolled"), body.indexOf("이 반 수강생이 아닙니다"));
    expect(gate).toContain("if (!isEnrolled && !instantMakeup)");
    expect(gate).not.toContain("(existing ?? 0) === 0");
    expect(gate).toContain("writeEligibility({ enrolled: isEnrolled, reserved, splitInto, native, hasRecord })");
  });
});

describe("③ 명단 표면이 예약 조회 한 벌을 읽는다", () => {
  it("월별 출석부 = 반·기간(칸 + 명단 합치기)", () => {
    const q = strip(read("features/attendance/server/queries.ts"));
    expect(q).toContain("getClassReservationsInRange(classId, startIso, endIso)");
    // ⚠️ 예약은 **날짜로 좁히지 않는다**(원장 2026-09-17 저녁 — 입력이 모든 날에 열려 있어 그 학생 줄이 있어야 찍는다).
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
    // 원장 2026-10-22: 이행분·발송 방식까지 읽는 원스크린 전용 조회(표가 없으면 빈 목록 · report_mode 칸이 없으면 칸 없이 다시).
    expect(q).toContain("getRosterReservationsOn(targetDate, allIds)");
    // 미리 세우기·"보강만 있는 날" 판정은 종전대로 아직 안 한 예약만(이행분은 출결·보고서가 줄을 되살린다).
    expect(q).toContain('const reservedToday = reservationsToday.filter((r) => r.status === "reserved")');
    expect(q).toContain("for (const r of reservationsToday)");
    expect(q).toContain('if (r.status !== "reserved" && !splitOff) continue;');
    expect(q).toContain("reservedToday.length === 0");
    // 정규 수업일 예약 = 합침('정규+보강')/분리('(보강)' 줄) — 표식·합침은 세션 복원 뒤(reserved-makeup.ts).
    expect(q).toContain("planReservedMakeup(reservationsToday, enrolledKey)");
    expect(q.indexOf("applyReservedMakeup(os, reservedPlan)")).toBeGreaterThan(q.indexOf("const sess = sessionById.get(os.id)"));
  });
  it("시간표 기본뷰 반 칸 = '보강' 줄(대기·퇴원 아래) — 기본뷰 격자에만 얹고 명단·엑셀·이동 판정엔 안 실린다", () => {
    const page = strip(read("app/(shell)/timetable/page.tsx"));
    // 수업 나누기(0351a)와 **함께**(Promise.all) 읽는다 — 서로 독립이라 직렬 await를 두지 않는다(B4).
    expect(page).toContain("attachReservedLines(slots, referenceDate)");
    expect(page).toContain("slots={basicSlots}");
    expect(count(page, "basicSlots")).toBe(2);
    const tables = strip(read("app/(shell)/timetable/_components/weekday-group-tables.tsx"));
    // 🔴 '보강' 줄은 **합친 뒤가 아니라 원래 슬롯에서** 모은다 — `mergeSlotsByClass`는 같은 반을 첫 슬롯으로
    //    접어서, 월+목 병합 칸이면 목요일에 걸린 그 반의 예약이 통째로 사라진다(2026-09-15).
    expect(tables).toContain("const reservedLines = uniqueReserved(slots);");
    expect(tables).toContain("reserved={reservedLines}");
    expect(tables).not.toContain("uniqueReserved(merged)");
    // 합반 칸도 격자가 모아 넘긴 값을 그대로 쓴다(스스로 다시 모으면 같은 함정에 빠진다).
    expect(strip(read("app/(shell)/timetable/_components/hapban-cell.tsx"))).not.toContain("s.reserved ?? []");
    // 반 칸의 '보강' 박스는 **하나** — 이 반 예약 + 담임 열에 선 남의 반 예약(stray)을 합쳐 그린다.
    // 🔴 칸이 덮는 요일을 함께 넘긴다 — 월+목 병합 칸은 쪼개지 않으므로 줄이 **어느 요일 보강인지**를 적는다(원장 2026-09-15).
    expect(strip(read("app/(shell)/timetable/_components/class-cell.tsx"))).toContain(
      "<ReservedSection lines={reservedAll} coveringDays={covers} />",
    );
    expect(strip(read("app/(shell)/timetable/_components/hapban-cell.tsx"))).toContain(
      "<ReservedSection lines={reserved} coveringDays={covers} />",
    );
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
    for (const fn of ["getClassReservationsInRange", "getReservationsOn", "getReservationsInRange", "getStudentUpcomingReservations"]) {
      const at = q.indexOf(`function ${fn}(`);
      expect(at, fn).toBeGreaterThan(-1);
      const body = q.slice(at, q.indexOf("\nexport", at + 1));
      expect(body, fn).toMatch(/soft\(|catch/);
    }
    // 주 조회는 기간 조회(fail-soft)에 넘기기만 한다 — 자기 조회를 따로 두면 이 검사를 빠져나간다.
    const week = q.slice(q.indexOf("function getReservationsInWeek("), q.indexOf("\nexport", q.indexOf("function getReservationsInWeek(") + 1));
    expect(week).toContain("return getReservationsInRange(start, end, classIds);");
    expect(week).not.toContain(".from(");
    // 게이트 판정은 문을 넓히는 쪽으로 실패하지 않는다.
    expect(q.slice(q.indexOf("export async function hasReservedMakeup"))).toContain("return false;");
  });
});

describe("⑦ 기본뷰 '보강' 박스 — 원반 칸이 없는 날은 **원반 담임 열**에(원장 2026-09-14)", () => {
  const server = strip(read("features/timetable/server/reserved-lines.ts"));
  const tables = strip(read("app/(shell)/timetable/_components/weekday-group-tables.tsx"));
  const cellSrc = strip(read("app/(shell)/timetable/_components/class-cell.tsx"));
  const box = strip(read("app/(shell)/timetable/_components/reserved-section.tsx"));

  it("① 원반 칸이 있으면 그 반 칸 줄, 없으면 담임 열 박스 — 한 예약이 **둘 다는 아니다**", () => {
    expect(server).toContain("if (cellDates.has(cellKey)) {");
    expect(server).toMatch(/cellDates\.has\(cellKey\)\)[\s\S]{0,400}continue;/);
    // 담임을 모르면 세우지 않는다(그 열이 화면에 없다) — '보강' 탭 몫.
    expect(server).toContain("if (!teacherName) continue;");
    // 남의 반 칸에 서므로 원반 이름은 **툴팁**에 실린다(줄엔 이름/학교학년만).
    expect(server).toContain("{ className: nameOf.get(r.classId) ?? null }");
  });

  it("② 다른 반이 있는 칸에서도 **명단과 섞이지 않는다** — 퇴원·대기와 같은 부품의 별도 박스", () => {
    expect(box).toContain("SectionLabelRow");
    expect(box).toContain("NameMeta");
    expect(box).toContain('label="보강"');
    // 🔴 머리 tone은 **보강만 쨍한 노랑**이다(원장 2026-09-15 *"보강은 다른것과 다르게 배경색을 쨍한
    //    노란계열로"*). ⚠️ 09-14의 *"머리는 대기·퇴원과 공통"*을 원장이 화면을 보고 **뒤집은 것**이라
    //    되돌리지 말 것. 색은 전용 토큰 `--makeup-band` — 형광펜(`--marker`)은 "한 화면에 하나" 가드가
    //    붙어 있어 빌려 쓸 수 없다.
    expect(box).toContain('tone="bg-makeup-band text-foreground"');
    // 리터럴 유틸뿐 아니라 형광펜을 들여오는 정석 경로(`MARKER_TRIGGER`·`bg-(--marker)`)까지.
    expect(box).not.toMatch(/bg-marker\b|MARKER_TRIGGER|--marker\)/);
    // 줄 색만 예약 단일 소스 — 화면 파일에 보라를 손으로 적으면 칸·범례와 갈린다.
    expect(box).toContain("${RESERVED_BADGE_CLASS}");
    expect(box).not.toMatch(/bg-purple-soft|text-purple\b/);
    // 줄에 교시·결석일·원반을 적지 않는다(원장 지시 — 길어지면 퇴원 블록과 모양이 어긋난다).
    expect(box).not.toContain("periodLabel");
    expect(box).not.toContain("absenceDate");
    // 줄의 내용은 이름/학교학년 한 조각(퇴원 줄과 같은 모양) + **남의 반이면 원반 꼬리표**.
    expect(box).toContain("<NameMeta name={r.name} meta={metaLabel(r.school, r.grade)} />");
    // 🔴 툴팁은 **카드**다(원장 2026-09-15 *"툴팁이 이렇게 생겼으면 좋겠어 메모같이 생기지 않고"*) — 줄엔
    //    `data-tip`만 달고 문서마다 한 장인 HoverTipLayer가 그린다. `title`로 되돌리면 회색 메모 상자가 겹친다.
    expect(box).toContain("tipProps({ title: r.name, meta: metaLabel(r.school, r.grade), rows: reservationTipRows(r) })");
    expect(box).not.toMatch(/title=\{r\.title\}/);
    // 🔴 한 박스에 두 반 예약이 서므로 **귀속을 글자로** 단다 — title 툴팁은 모바일에서 없는 것과 같다.
    expect(box).toContain("r.fromClassName");
    // 🔴 그 값은 **함수 본문**이 opts를 실제로 써야 생긴다 — 호출부만 검사하면 종전처럼 툴팁에서도 빠진다.
    const pure = strip(read("features/attendance/makeup-reservation.ts"));
    expect(pure).toContain("title: reservationTitle(r, opts),");
    expect(pure).toContain("fromClassName: opts.className.trim()");
    // 명단(StudentSection)에 섞어 넣지 않는다 — 인원·드래그가 그 배열을 센다.
    expect(cellSrc).toContain("const reservedAll = strayReserved.length === 0 ? reserved : [...reserved, ...strayReserved];");
    expect(cellSrc).not.toMatch(/students=\{[^}]*stray/i);
  });

  it("③ 병합된 요일(월목)을 **쪼개지 않는다** — 어느 요일 보강인지는 줄 표식이 말한다(원장 2026-09-15)", () => {
    // 🔴 원장 2026-09-15 *"이렇게 붙어있는 수업은 그냥 붙어있게 표시해줘 다른 퇴원이나 대기처럼"* —
    //    병합 키에 예약을 섞던 표식(`strayMarkKey`·`cellKeyWithStrayMark`·`strayOwnerClassKey`)을 걷어냈다.
    expect(tables).toContain("(ri, ci) => cellClassKey(cellAt(ri, ci).map((s) => s.classId)),");
    expect(tables).not.toMatch(/strayMark|cellKeyWithStrayMark|strayOwnerClassKey/);
    expect(strip(read("features/timetable/lib/stray-reserved.ts"))).not.toMatch(
      /strayMarkKey|cellKeyWithStrayMark|strayOwnerClassKey/,
    );
    // 요일 표식은 **칸이 여러 요일을 덮을 때만** 붙는다(한 요일 칸엔 군더더기).
    expect(box).toContain("const showDay = (coveringDays?.length ?? 0) >= 2;");
    expect(box).toContain("dowKoOf(r.makeupDate)");
    // 앵커 행 판정은 순수 규칙 한 벌(stray-reserved.ts) — 격자가 자기 규칙을 새로 적지 않는다.
    expect(tables).toContain("strayAnchorRowIndex(rows, b.startTime, b.endTime)");
  });

  // 🔴 제목을 **소스 범위로** 좁혀 둔다: 이 모듈들은 stray를 *직접* 모른다는 뜻이지, 격자 결과가 예약에
  //    영향을 안 받는다는 뜻이 아니다(병합은 호출부가 주입하는 `keyAt`을 통해 실제로 달라진다 = [중]1 수리의 의도).
  it("④ 표시 전용 — 인원·드래그·충돌·빈 교시 판정·엑셀/시트 **모듈이 이 값을 직접 import·참조하지 않는다**", () => {
    for (const rel of [
      "features/timetable/lib/class-move.ts",
      "features/timetable/lib/class-grid.ts",
      "features/timetable/lib/used-rows.ts",
      "features/timetable/lib/hapban.ts",
      "features/exports/timetable-excel.ts",
      // 🔴 **기본뷰의 축**(적대 리뷰 [하]): 병합 엔진과 빈 교시 접기 높이 — 이번 변경이 실제로 건드린 곳이다.
      //    (위 class-grid·used-rows는 통합뷰 것이라 이 축을 안 잠갔다.)
      // ⚠️ 이 두 모듈은 stray를 **직접 알지 않는다**는 뜻이다 — 병합 결과가 예약 때문에 달라지는 것은 호출부가
      //    주입하는 `keyAt` 클로저를 통해서이고(그게 [중]1 수리가 의도한 동작이다), 그 축은
      //    `stray-reserved.test.ts`가 잠근다. 같은 것을 두 곳에서 검사하지 않는다(한쪽만 고쳐진다).
      "features/timetable/lib/grid.ts",
      "features/timetable/lib/empty-period-rows.ts",
    ]) {
      expect(strip(read(rel)), rel).not.toMatch(/stray/i);
    }
    // 빈 교시 접기 판정은 **슬롯만** 본다 — 예약이 접기를 흔들지 않는다.
    expect(tables).toContain("const occupiedKeys = new Set(slots.map(rowKeyOf));");
    // 🔴 '학생 명단 접기'는 반 칸 박스와 빈 칸 박스에 **같이** 걸린다(한쪽만 남으면 토글이 거짓말이 된다).
    expect(tables).toContain("cellStrays.length > 0 && !hideStudents ?");
    // 빈 칸에 선 박스도 아래 갈래와 **같은 높이 규약**(접힌 행 변수 · hideStudents 최소 높이 안 씀).
    expect(tables).toContain("minHeight: isCollapsed(row.key)");
    expect(count(tables, "`calc(${EMPTY_PERIOD_H} - 12px)`")).toBe(2);
    // 값은 셀 박스 두 자리로만 간다(반 칸 안 · 빈 칸 단독).
    expect(tables).toContain("strayLines={cellStrays}");
    expect(tables).toContain("<ReservedSection lines={cellStrays} />");
  });
});

describe("⑥ 학생 상세 '예정된 변경' 배너 — 앞으로의 보강 예약(원장 2026-09-14)", () => {
  const page = strip(read("app/(shell)/students/[id]/page.tsx"));
  const banner = strip(read("components/scheduled-change-banner.tsx"));

  it("페이지가 예약을 **같은 Promise.all에서** 조회해 배너에 넘긴다(직렬 워터폴 금지, B4)", () => {
    expect(page).toContain("getStudentUpcomingReservations(student.id, kstToday())");
    expect(page).toContain("makeups={upcomingMakeups}");
    const all = page.indexOf("await Promise.all([");
    const call = page.indexOf("getStudentUpcomingReservations(student.id");
    expect(all).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(all);
    expect(call).toBeLessThan(page.indexOf("]);", all));
  });

  it("문장·툴팁은 순수 함수 한 벌에서 온다 — 배너가 날짜·문구를 새로 짜지 않는다", () => {
    expect(banner).toContain("scheduledMakeupLabel(r.makeup, today, lang)");
    expect(banner).toContain("scheduledMakeupTitle(r.makeup)");
  });

  it("🔴 읽기 전용 — 예약 줄엔 수정·취소가 붙지 않는다(고치는 자리는 출석부 칸이다)", () => {
    expect(banner).toContain("actions(r.change)");
    expect(banner).not.toMatch(/actions\(r\.makeup/);
  });

  it("예약만 있어도 배너가 서고, 두 종류를 **날짜순 한 줄기**로 세운다", () => {
    expect(banner).toContain("if (changes.length === 0 && makeups.length === 0) return null;");
    expect(banner).toMatch(/rows[\s\S]*\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/);
  });

  it("조회는 예약 상태 · 오늘 이후만 — 지난 날짜·이행된 예약은 안 보인다", () => {
    const q = strip(read("features/attendance/server/makeup-reservation-queries.ts"));
    const body = q.slice(q.indexOf("export async function getStudentUpcomingReservations"));
    expect(body).toContain('.eq("student_id", studentId)');
    expect(body).toContain('.eq("status", "reserved")');
    expect(body).toContain('.gte("makeup_date", today)');
    // 원반 이름 임베드는 **컬럼 이름**으로(관계 이름이면 FK가 늘어난 날 PGRST201, [[#94]]).
    expect(body).toContain("class:class_id ( class_name )");
  });
});

describe("⑤ 감사로그 키가 등록돼 있다(뷰어에 영문 키 원문이 뜨지 않게)", () => {
  it("makeup_reserve · makeup_reserve_cancel · makeup_reserve_done · makeup_reserve_revert", () => {
    const log = read("features/audit/server/log.ts");
    const describe_ = read("features/audit/describe.ts");
    for (const key of ["makeup_reserve", "makeup_reserve_cancel", "makeup_reserve_done", "makeup_reserve_revert", "makeup_reserve_report_mode"]) {
      expect(log).toContain(`  ${key}:`);
      expect(describe_).toContain(`case "${key}":`);
    }
  });
});
