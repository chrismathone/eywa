import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_SEAT_KEYS, USABLE_SEAT_KEYS } from "./seat";

const root = join(__dirname, "../../../..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("자리 월간 배선", () => {
  /**
   * 스위치가 **둘**이라는 게 이 화면의 핵심이다 — 화면(USABLE)과 돈(OPEN)은 다른 물건이고,
   * 월간이 돈 스위치로 화면을 가르면 허브의 'JJ실 월간' 버튼이 안내문으로 떨어진다(막다른 길).
   */
  it("화면 스위치는 하루와 같은 USABLE — 돈 스위치로 화면을 가르지 않는다", () => {
    for (const p of [
      "src/app/(shell)/attendance/seat/[seat]/month/page.tsx",
      "src/app/(print)/attendance/seat/[seat]/month/print/page.tsx",
    ]) {
      const src = read(p);
      expect(src, `${p}: 화면 게이트는 parseUsableSeatKey`).toMatch(/parseUsableSeatKey\(seatParam\)/);
      expect(src, `${p}: parseSeatKey(돈 스위치)로 화면을 가르지 말 것`).not.toMatch(/parseSeatKey\(/);
    }
  });

  it("돈 스위치는 랩실만 — 자리 시수가 없는 자리는 별지 문구가 다르다", () => {
    expect(OPEN_SEAT_KEYS).toEqual(["lab"]);
    expect(USABLE_SEAT_KEYS).toContain("jj");
    expect(read("src/app/(print)/attendance/seat/[seat]/month/print/page.tsx")).toMatch(
      /seatAppendixCaption\(isPayrollSeat\(seat\)\)/,
    );
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
