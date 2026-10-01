import { describe, expect, it } from "vitest";
import { orderTransferSourceClasses, transferRosterChoices } from "./transfer-roster";
import type { TransferCandidate } from "./bulk-transfer";

const SNAP = { startDate: "2026-09-01", endDate: null as string | null, onHold: false, isTransferred: false, attendanceDays: [] as string[] };
const row = (id: string, studentId: string, extra: Partial<typeof SNAP> = {}): TransferCandidate => ({
  id, name: id, grade: "고1", school: null, snapshot: { ...SNAP, studentId, ...extra },
});

describe("transferRosterChoices — 반이동 날짜 기준 그 반 명단에서 고를 수 있는 학생", () => {
  const all = new Set(["s-1", "s-2", "s-3", "s-4", "s-5", "s-6"]);

  it("그날 명단(isEnrollmentOnRosterOn)만 — 시작 전·이미 끝난 수강은 빠지고, 날짜를 바꾸면 다시 계산된다", () => {
    const items = [row("e-now", "s-1"), row("e-later", "s-2", { startDate: "2026-10-10" })];
    const before = transferRosterChoices(items, "2026-10-02", all);
    expect(before.choices.map((c) => c.id)).toEqual(["e-now"]);
    expect(before.upcoming).toBe(1); // 말없이 빼지 않고 센다
    const after = transferRosterChoices(items, "2026-10-10", all);
    expect(after.choices.map((c) => c.id)).toEqual(["e-now", "e-later"]);
    expect(after.upcoming).toBe(0);
  });

  it("🔑 종료 규약은 단일 소스 그대로 — 일반 종료는 그날까지 재원, 반이동 종료는 그날 이미 새 반([[#125]])", () => {
    const items = [
      row("e-ends", "s-1", { endDate: "2026-10-02" }),
      row("e-ended", "s-2", { endDate: "2026-10-01" }),
      row("e-moved-out", "s-3", { endDate: "2026-10-02", isTransferred: true }),
    ];
    const r = transferRosterChoices(items, "2026-10-02", all);
    expect(r.choices.map((c) => c.id)).toEqual(["e-ends"]);
    expect(r.reserved).toBe(0); // 그날 이미 떠난 수강은 '예약'이 아니라 명단 밖이다
  });

  it("이미 반이동이 걸린 수강(앞으로 떠날 예정)은 고를 수 없고 따로 센다", () => {
    const r = transferRosterChoices([row("e-res", "s-1", { endDate: "2026-11-01", isTransferred: true })], "2026-10-02", all);
    expect(r.choices).toEqual([]);
    expect(r.reserved).toBe(1);
  });

  it("배정 후보 밖(이미 이 반 수강 중 등)은 막는다 — 종전 규칙 그대로", () => {
    const r = transferRosterChoices([row("e-1", "s-1"), row("e-x", "s-in-target")], "2026-10-02", all);
    expect(r.choices.map((c) => c.id)).toEqual(["e-1"]);
    expect(r.unassignable).toBe(1);
  });

  it("휴원 수강도 명단엔 있으므로 고를 수 있다(이동해도 휴원은 유지된다)", () => {
    expect(transferRosterChoices([row("e-hold", "s-1", { onHold: true })], "2026-10-02", all).choices).toHaveLength(1);
  });

  it("날짜가 비었거나 잘못되면 아무도 고를 수 없다", () => {
    expect(transferRosterChoices([row("e-1", "s-1")], "", all).choices).toEqual([]);
    expect(transferRosterChoices([row("e-1", "s-1")], "2026-02-31", all).choices).toEqual([]);
  });
});

describe("orderTransferSourceClasses — 옮겨 올 반 목록", () => {
  const C = (id: string, className: string, subject: string) => ({ id, className, subject, teacherName: null });

  it("목적지 반은 빼고, 같은 과목 반을 먼저(이름순) 그다음 다른 과목 반", () => {
    const ordered = orderTransferSourceClasses(
      [C("e1", "PL4", "english"), C("m2", "중2 B", "math"), C("t", "PL3", "english"), C("m1", "중2 A", "math"), C("e2", "PL2", "english")],
      "t",
      "english",
    );
    expect(ordered.map((c) => c.id)).toEqual(["e2", "e1", "m1", "m2"]);
  });
});
