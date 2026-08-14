/**
 * 데스크 게이트는 **당일 출결 화면만** 켠다 — 월간 격자가 같은 액션을 쓰므로
 * `source: "live"` 배선이 틀리면 원장이 정정·삭제를 못 한다(#103).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("desk gate wiring", () => {
  it("좌석표는 source: \"live\", 확인 기록 정정은 아니다(이미 찍힌 결석을 되돌린다)", () => {
    expect(read("src/features/attendance/live/components/seating-cell.tsx")).toMatch(
      /source:\s*"live"/,
    );
    expect(read("src/app/(shell)/attendance/live/_components/desk-student-row.tsx")).not.toMatch(
      /source:\s*"live"/,
    );
  });

  it("월간 격자·팝오버는 플래그를 안 넘긴다 — 정정·삭제·시수가 종전 권한", () => {
    expect(read("src/app/(shell)/attendance/_components/grid-context.tsx")).not.toMatch(
      /source:\s*"live"/,
    );
    expect(read("src/app/(shell)/attendance/_components/cell-popover.tsx")).not.toMatch(
      /source:\s*"live"/,
    );
  });

  it("서버 게이트는 deskWriteDenied를 거친다 — 판정이 갈라지면 월간 정정이 다시 막힌다", () => {
    const policy = read("src/features/attendance/live/server/write-policy.ts");
    expect(policy).toMatch(/deskWriteDenied\(/);
    expect(policy).not.toMatch(/deskMarkDeniedReason\(/);
  });

  it("자리 버튼에 bg-card를 덧씌우지 않는다 — 출석 배경이 진다", () => {
    const cell = read("src/features/attendance/live/components/seating-cell.tsx");
    expect(cell).not.toMatch(/className=\{`bg-card /);
    expect(cell).toMatch(/SEAT_MARK_TONE\[mark\]/);
  });

  it("강의실은 4열 고정 — 수업 2~3개여도 폭이 늘어나지 않는다", () => {
    const chart = read("src/features/attendance/live/components/seating-chart.tsx");
    expect(chart).toMatch(/grid-cols-4/);
    expect(chart).not.toMatch(/xl:grid-cols-3/);
    expect(read("src/features/attendance/live/components/seating-room.tsx")).toMatch(
      /grid-cols-3/,
    );
  });

  it("랩실·JJ는 교시 가로줄 — 하루를 4열에 펼치지 않는다", () => {
    const chart = read("src/features/attendance/live/components/seating-chart.tsx");
    expect(chart).toMatch(/groupSeatPeriods/);
    expect(chart).toMatch(/auto-fill/);
  });

  it("반별 폼·범위 채우기는 via=desk여도 기존 칸을 건너뛰지 않는다", () => {
    const actions = read("src/features/attendance/server/actions.ts");
    expect(actions).not.toMatch(/via === "desk" \? \[\]/);
    expect(actions).not.toMatch(/if \(via === "desk"\) continue/);
  });
});
