import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_SEAT_KEYS } from "./seat";

const root = join(__dirname, "../../../..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("자리 월간 배선", () => {
  it("오픈 스위치는 랩실만 — JJ 월간은 조회 없이 안내만", () => {
    expect(OPEN_SEAT_KEYS).toEqual(["lab"]);
    expect(read("src/app/(shell)/attendance/seat/[seat]/month/page.tsx")).toMatch(/아직 열지 않/);
  });

  it("월간 화면은 읽기 전용 — 저장 액션을 부르지 않는다", () => {
    const src = read("src/app/(shell)/attendance/seat/[seat]/month/page.tsx");
    expect(src).not.toMatch(/setAttendanceCell|setSeatCell|fillSeatSlot/);
    expect(read("src/app/(shell)/attendance/seat/[seat]/month/_components/monthly-table.tsx")).not.toMatch(
      /setAttendanceCell|setSeatCell/,
    );
  });

  it("공개 PIN 화면에는 월간 링크가 없다", () => {
    expect(read("src/app/(seat)/seat/[seat]/page.tsx")).not.toMatch(/\/month/);
    expect(read("src/app/(seat)/seat/[seat]/pin-form.tsx")).not.toMatch(/\/month/);
  });

  it("하루 화면·허브에는 월간 칩이 있다", () => {
    expect(read("src/app/(shell)/attendance/seat/[seat]/page.tsx")).toMatch(/\/month\?month=/);
    expect(read("src/app/(shell)/attendance/page.tsx")).toMatch(/monthHref/);
  });

  it("뷰 세팅은 seatMonthly 키만 건드린다(attendance를 덮지 않는다)", () => {
    const src = read("src/features/attendance/seat/server/monthly-prefs.ts");
    expect(src).toMatch(/seatMonthly/);
    expect(src).not.toMatch(/attendance:/);
  });
});
