import { describe, expect, it } from "vitest";
import { OFFBOARD_BACKUP_BUCKET, offboardBackupPath } from "./backup-path";

const T = "becaa316-e636-42e9-9d09-08b133e0b094";

describe("명부 퇴원처리 백업 경로 — 워커가 준 값을 그대로 잇지 않는다", () => {
  it("지점/offboard/날짜/원아.json · 버킷은 기존 비공개 ClassNote 보관 버킷", () => {
    expect(OFFBOARD_BACKUP_BUCKET).toBe("classnote-backups");
    expect(offboardBackupPath(T, 5611926, "2026-11-03")).toBe(`${T}/offboard/2026-11-03/5611926.json`);
    expect(offboardBackupPath(T.toUpperCase(), "5611926", "2026-11-03")).toBe(`${T}/offboard/2026-11-03/5611926.json`);
  });
  it("🔴 꼴이 틀리면 null — 경로 밖으로 나가는 값·빈 값·음수·소수", () => {
    for (const [t, c, d] of [
      ["x", 1, "2026-11-03"], [T, 0, "2026-11-03"], [T, -1, "2026-11-03"], [T, 1.5, "2026-11-03"], [T, "../a", "2026-11-03"],
      [T, "1/2", "2026-11-03"], [T, 1, "2026-13-40"], [T, 1, "../2026"], [T, 1, ""], [null, 1, "2026-11-03"],
    ] as const)
      expect(offboardBackupPath(t, c, d)).toBeNull();
  });
});
