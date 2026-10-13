import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 휴원일 판정이 **한 곳**(`server/holiday.ts`)이고 자료가 **학원설정 휴일 목록 하나**라는 것을 잠근다.
 * (2026-10-03 운영점검 합의 A01 — docs/decisions/attendance.md)
 *
 * 왜 소스 가드인가: 2026-08-14의 폴백은 "청구는 공휴일을 코드로 갖고 있으니 여기도"라는 자연스러운 한 줄로 들어왔다.
 * 그 한 줄이 돌아오면 수업하는 공휴일을 목록에서 빼도 오늘 출결이 계속 비고, 단위 테스트는 그대로 통과한다.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** 주석을 뺀 소스 — 금지 이름을 설명하는 주석에 걸리지 않게. */
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const HOLIDAY = "src/features/attendance/server/holiday.ts";
const LOAD = "src/features/attendance/live/server/load.ts";
const PROCESSING = "src/features/attendance/server/queries.ts";
const ACTIVITY = "src/features/attendance/server/holiday-activity.ts";
const LIVE_PAGE = "src/app/(shell)/attendance/live/page.tsx";
const HUB_PAGE = "src/app/(shell)/attendance/page.tsx";
const DAILY_PAGE = "src/app/(shell)/attendance/[date]/page.tsx";
const QUICK_PAGE = "src/app/(shell)/attendance/quick/page.tsx";
const OVERVIEW_SERVER = "src/features/dashboard/overview/server.ts";

describe("휴원일 판정 자료 = 학원설정 휴일 목록 하나", () => {
  it("🔴 출결 쪽 어디도 청구의 고정 공휴일 표·캘린더 내장 공휴일 표를 가져오지 않는다", () => {
    for (const file of [HOLIDAY, LOAD, PROCESSING, ACTIVITY]) {
      const src = code(file);
      expect(src, file).not.toMatch(/fixedHolidaysForYear/);
      expect(src, file).not.toMatch(/features\/billing\/tuition-calc/);
      expect(src, file).not.toMatch(/features\/calendar\/holidays/);
    }
  });

  it("판정은 학원설정 휴일 목록을 강사 시트와 같은 순수 함수로 읽는다", () => {
    const src = code(HOLIDAY);
    expect(src).toContain("holidayNameOn(buildHolidayMap(settings.operations.holidays), date)");
    // 휴일 이름을 코드가 지어내지 않는다(폴백이 붙였던 이름).
    expect(src).not.toMatch(/"공휴일"/);
  });

  it("오늘 출결 로더는 판정을 다시 짓지 않고 그 함수를 그대로 내보낸다", () => {
    const src = code(LOAD);
    expect(src).toContain('import { holidayNameOf } from "@/features/attendance/server/holiday";');
    expect(src).toContain("export { holidayNameOf };");
    expect(src).not.toMatch(/export async function holidayNameOf/);
  });
});

describe("설정 휴원일의 가드는 그대로다", () => {
  it("로더는 휴원일에 슬롯을 만들지 않는다(강사 출결 모드·데스크 확인 요청의 안전장치)", () => {
    expect(code(LOAD)).toMatch(/if \(await holidayNameOf\(date\)\) return \[\];/);
  });

  it("오늘 출결 페이지는 휴원일에 좌석표·확인 큐·이월 결석을 부르지 않는다", () => {
    const page = code(LIVE_PAGE);
    expect(page).toMatch(/holiday \? null : getLiveBoard\(date\)/);
    expect(page).toMatch(/holiday \|\| !isDesk \? null : getDeskQueue\(date\)/);
    expect(page).toMatch(/holiday \|\| !isDesk \|\| tab !== "desk" \? null : getCarryOverAbsences\(date\)/);
  });

  it("처리 현황은 휴원일에 조회 전에 빈 목록을 돌려준다 — 소비처마다 접지 않는다", () => {
    const src = code(PROCESSING);
    const body = src.slice(
      src.indexOf("export const getDailyProcessingStatus"),
      src.indexOf("export type AttendanceStatus"),
    );
    const guard = body.indexOf("if (await holidayNameOrNull(date)) return [];");
    expect(guard).toBeGreaterThan(-1);
    // 가드가 첫 조회보다 앞이다.
    expect(guard).toBeLessThan(body.indexOf("createClient()"));
  });
});

describe("휴원일 실제 입력 조회 — 범위와 읽기 전용", () => {
  const src = code(ACTIVITY);

  it("연락처·메모를 읽지 않는다", () => {
    expect(src).not.toMatch(/parent_phone|student_phone|\bphone\b|\bnote\b/);
    expect(src).toContain(
      'const RECORD_SELECT = "id, class_id, student_id, session_date, slot_start, status, recorded_at";',
    );
  });

  it("쓰기가 없다(insert·update·upsert·delete·rpc 0)", () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it("강사 범위는 좌석표와 같은 반 집합 함수로 좁힌다(요일로 거르지 않는다)", () => {
    expect(src).toContain("liveTeacherClassIds(supabase, scopedTeacherId, date)");
    expect(src).not.toMatch(/day_of_week/);
    expect(code("src/features/attendance/live/server/queries.ts")).toContain(
      "classIds = await liveTeacherClassIds(supabase, scopedTeacherId, date);",
    );
    expect(code("src/features/attendance/live/server/scope.ts")).not.toMatch(/day_of_week/);
  });

  it("출결 조회는 페이징, 강사 범위는 청크 × 페이징이다(1000행 절단·414 방지)", () => {
    expect(src).toMatch(/fetchAllPagedInChunks<HolidayRecordRow>\(classIds/);
    expect(src).toMatch(/fetchAllPaged<HolidayRecordRow>\(/);
    expect(src.match(/\.order\("id", \{ ascending: true \}\)/g)?.length).toBe(2);
  });

  it("🔴 일별 출석부 링크는 사무실 범위에만 선다 — 강사 범위는 월별 출석부로 간다", () => {
    const panel = code("src/features/attendance/live/components/holiday-activity-panel.tsx");
    const office = panel.indexOf("activity.officeScope ? (");
    expect(office).toBeGreaterThan(-1);
    const daily = panel.indexOf("href={`/attendance/${date}`}");
    const monthly = panel.indexOf("href={`/attendance?month=${month}`}");
    expect(daily).toBeGreaterThan(office);
    expect(monthly).toBeGreaterThan(daily);
    // 일별 링크는 그 한 곳뿐이다.
    expect(panel.match(/\/attendance\/\$\{date\}/g)?.length).toBe(1);
    // 목록에 입력·수정 조작이 없다.
    expect(panel).not.toMatch(/<button|onClick|<form|<input/);
  });

  it("강사 출결 모드는 내 수업만 범위로 묻는다", () => {
    expect(code(QUICK_PAGE)).toContain("getHolidayDayActivity(today, true)");
  });
});

describe("원스크린 — 휴원일은 알리고 일괄 출결만 묻는다(원장 2026-10-13, 10/9 한글날 19명)", () => {
  const ROSTER = "src/features/onescreen/server/roster.ts";
  const CLIENT = "src/features/onescreen/components/onescreen-client.tsx";

  it("명단은 출결 화면과 같은 fail-soft 판정을 싣고, 휴원일이라고 명단을 비우지 않는다", () => {
    const src = code(ROSTER);
    expect(src).toContain("holidayNameOrNull(targetDate)");
    // 휴원일에도 실제로 수업하는 날이 있다(10/3) — 명단을 비우면 그날 입력할 길이 사라진다.
    expect(src).not.toMatch(/if \(holidayName\)/);
  });

  it("'일괄 출석'은 휴원일에만 기록 전에 묻는다", () => {
    const src = code(CLIENT);
    const body = src.slice(src.indexOf("async function applyQuickPresent"), src.indexOf("setQuickAttBusy(true)"));
    expect(body).toMatch(/if \(holidayName && !window\.confirm\(tf\("os\.present\.holidayConfirm"/);
  });
});

describe("세 화면이 같은 조회를 읽는다", () => {
  it("오늘 출결 · 출석부 요약 · 운영실이 getHolidayDayActivity 한 함수다", () => {
    expect(code(LIVE_PAGE)).toContain("getHolidayDayActivity(date)");
    expect(code(HUB_PAGE)).toContain("getHolidayDayActivity(today, false, subject)");
    expect(code(OVERVIEW_SERVER)).toContain("getHolidayDayActivity(today)");
  });

  it("출석부 요약·일별 출석부·운영실의 휴일 판정은 처리 현황과 같은 fail-soft 함수다", () => {
    for (const file of [HUB_PAGE, DAILY_PAGE, OVERVIEW_SERVER]) {
      expect(code(file), file).toContain("holidayNameOrNull(");
    }
  });
});
