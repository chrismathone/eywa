import { describe, expect, it } from "vitest";
import { placeLifecycleBadges } from "./badge-placement";
import type { LifecycleBadge } from "./enrollment-span";

const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"];
const at = (b: LifecycleBadge, free: string[]) =>
  placeLifecycleBadges([b], DAYS, (d) => free.includes(d));

describe("생애주기 표식은 수강 기간 양옆의 회색 칸에 얹는다(원장 2026-09-18)", () => {
  it("시작 표식 = 첫 수업일 바로 왼쪽 회색 칸, 오른쪽 끝에 붙어 왼쪽으로 넘친다", () => {
    const m = at({ kind: "new", date: "2026-09-04" }, ["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect([...m.keys()]).toEqual(["2026-09-03"]);
    expect(m.get("2026-09-03")!.align).toBe("end");
  });

  it("🔴 값 칸에는 얹지 않는다 — 왼쪽 칸에 값이 있으면(회색이 아니면) 그리지 않는다", () => {
    const m = at({ kind: "transferIn", date: "2026-09-04" }, ["2026-09-01", "2026-09-02"]);
    expect(m.size).toBe(0);
  });

  it("🔴 넘칠 칸까지 회색이어야 한다 — 격자 첫 칸 옆(값 열)으로 넘치면 그리지 않는다", () => {
    // 9/2 시작 → 왼쪽 9/1 하나뿐, 그 왼쪽은 차이확인 열.
    expect(at({ kind: "new", date: "2026-09-02" }, ["2026-09-01"]).size).toBe(0);
  });

  it("퇴원·종강은 그날까지 다녀서 **다음 날** 회색 칸에 얹는다(왼쪽 끝에 붙어 오른쪽으로)", () => {
    const m = at({ kind: "classEnded", date: "2026-09-03" }, ["2026-09-04", "2026-09-05", "2026-09-06"]);
    expect([...m.keys()]).toEqual(["2026-09-04"]);
    expect(m.get("2026-09-04")!.align).toBe("start");
  });

  it("반이동 나감은 그날 이미 새 반이라 **그 날짜 칸**이 곧 회색이다", () => {
    const m = at({ kind: "transferOut", date: "2026-09-03" }, ["2026-09-03", "2026-09-04"]);
    expect([...m.keys()]).toEqual(["2026-09-03"]);
  });

  it("끝 쪽이 격자 마지막 칸이면 얹는다 — 넘치는 쪽은 고정 출석률 열이 덮는다", () => {
    const m = at({ kind: "left", date: "2026-09-05" }, ["2026-09-06"]);
    expect([...m.keys()]).toEqual(["2026-09-06"]);
  });

  it("🔴 양옆에 회색 칸이 없으면 **그리지 않는다**(이름 옆으로 돌려보내지 않는다)", () => {
    expect(at({ kind: "left", date: "2026-09-06" }, []).size).toBe(0);
    // 격자 밖(지난 달) 날짜도 없다.
    expect(at({ kind: "new", date: "2026-08-20" }, DAYS).size).toBe(0);
  });

  it("한 칸에 둘이 떨어지면 함께 선다(반이동 나감 + 종강)", () => {
    const m = placeLifecycleBadges(
      [
        { kind: "transferOut", date: "2026-09-04" },
        { kind: "classEnded", date: "2026-09-03" },
      ],
      DAYS,
      (d) => ["2026-09-04", "2026-09-05", "2026-09-06"].includes(d),
    );
    expect(m.get("2026-09-04")!.badges.map((b) => b.kind)).toEqual(["transferOut", "classEnded"]);
  });
});
