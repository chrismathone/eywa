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
  it("당일 출결 호출부는 source: \"live\"를 넘긴다", () => {
    expect(read("src/app/(shell)/attendance/live/_components/board-view.tsx")).toMatch(
      /source:\s*"live"/,
    );
    expect(read("src/app/(shell)/attendance/live/_components/desk-view.tsx")).toMatch(
      /source:\s*"live"/,
    );
    expect(read("src/features/attendance/live/components/seating-cell.tsx")).toMatch(
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

  it("반별 폼·범위 채우기는 via=desk여도 기존 칸을 건너뛰지 않는다", () => {
    const actions = read("src/features/attendance/server/actions.ts");
    expect(actions).not.toMatch(/via === "desk" \? \[\]/);
    expect(actions).not.toMatch(/if \(via === "desk"\) continue/);
  });
});
