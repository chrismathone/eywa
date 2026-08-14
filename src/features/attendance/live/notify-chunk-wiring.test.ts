/**
 * 알림 이름 조회는 100건에서 자르지 않는다 — slice(0,100)은 뒤 학생이 벨에서 사라진다(B3).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("attendance notify name lookup", () => {
  it("교차 알림·결석 벨 모두 fetchInChunks — silent 100 절단 없음", () => {
    for (const file of [
      "src/features/attendance/live/server/cross-notify.ts",
      "src/features/attendance/live/server/absent-notify.ts",
    ]) {
      const src = read(file);
      expect(src, file).toMatch(/fetchInChunks/);
      expect(src, file).toMatch(/formatAttendanceNotifyNames/);
      expect(src, file).not.toMatch(/slice\(\s*0\s*,\s*100\s*\)/);
      expect(src, file).not.toMatch(/names\.length - 1/);
    }
  });
});
