import { describe, expect, it } from "vitest";
import {
  badgeTitle,
  isEnrolledOn,
  joinedInMonth,
  leftInMonth,
  lifecycleBadges,
  monthBounds,
  transferFrom,
  transferTo,
  type OtherSpan,
} from "./enrollment-span";

const M = "2026-08";
const other = (o: Partial<OtherSpan>): OtherSpan => ({
  classId: "c2",
  className: "중등M 중2 B",
  subject: "math",
  start: "2026-08-11",
  end: null,
  ...o,
});

describe("monthBounds", () => {
  it("말일을 달마다 맞게 낸다 — 28·29·30·31을 따로 안 적는다", () => {
    expect(monthBounds("2026-08")).toEqual({ first: "2026-08-01", last: "2026-08-31" });
    expect(monthBounds("2026-02").last).toBe("2026-02-28");
    expect(monthBounds("2024-02").last).toBe("2024-02-29"); // 윤년
    expect(monthBounds("2026-04").last).toBe("2026-04-30");
  });
});

describe("isEnrolledOn", () => {
  it("구간 안이면 소속, 밖이면 아님 — 양끝 날짜는 포함", () => {
    const spans = [{ start: "2026-08-05", end: "2026-08-20" }];
    expect(isEnrolledOn("2026-08-05", spans)).toBe(true);
    expect(isEnrolledOn("2026-08-20", spans)).toBe(true);
    expect(isEnrolledOn("2026-08-04", spans)).toBe(false);
    expect(isEnrolledOn("2026-08-21", spans)).toBe(false);
  });

  it("end가 null이면 지금도 다니는 중", () => {
    expect(isEnrolledOn("2030-01-01", [{ start: "2026-08-05", end: null }])).toBe(true);
  });

  it("🔴 구간을 모르면 true — 자료 없음을 '재원 아님'으로 칠하면 표가 통째로 회색이 된다", () => {
    expect(isEnrolledOn("2026-08-05", [])).toBe(true);
  });

  it("재등록으로 구간이 둘이면 사이의 공백은 재원 외다", () => {
    const spans = [
      { start: "2026-03-02", end: "2026-05-31" },
      { start: "2026-08-01", end: null },
    ];
    expect(isEnrolledOn("2026-06-15", spans)).toBe(false);
    expect(isEnrolledOn("2026-08-15", spans)).toBe(true);
  });
});

describe("joinedInMonth / leftInMonth", () => {
  it("그 달에 시작·종료했으면 그 날짜를 낸다", () => {
    expect(joinedInMonth(M, [{ start: "2026-08-05", end: null }])).toBe("2026-08-05");
    expect(leftInMonth(M, [{ start: "2026-03-02", end: "2026-08-12" }])).toBe("2026-08-12");
  });

  it("전달부터 다니던 학생은 신입이 아니다", () => {
    expect(joinedInMonth(M, [{ start: "2026-07-01", end: null }])).toBeNull();
  });

  it("이번 달에 안 끝났으면 퇴원이 아니다", () => {
    expect(leftInMonth(M, [{ start: "2026-03-02", end: null }])).toBeNull();
    expect(leftInMonth(M, [{ start: "2026-03-02", end: "2026-09-30" }])).toBeNull();
  });

  it("🔴 같은 반 재등록으로 구간이 이어지면 퇴원이 아니다 — 달 마지막 날에 아직 소속이다", () => {
    const spans = [
      { start: "2026-03-02", end: "2026-08-10" },
      { start: "2026-08-11", end: null },
    ];
    expect(leftInMonth(M, spans)).toBeNull();
    // 그 8/11 시작도 신입이 아니다(달 시작 전부터 다니던 학생).
    expect(joinedInMonth(M, spans)).toBeNull();
  });

  it("들어왔다 나간 달이면 둘 다 잡힌다 — 드물지만 감추지 않는다", () => {
    const spans = [{ start: "2026-08-03", end: "2026-08-25" }];
    expect(joinedInMonth(M, spans)).toBe("2026-08-03");
    expect(leftInMonth(M, spans)).toBe("2026-08-25");
  });

  it("구간이 없으면 아무 표식도 없다", () => {
    expect(joinedInMonth(M, [])).toBeNull();
    expect(leftInMonth(M, [])).toBeNull();
  });
});

describe("반이동 판정", () => {
  it("나간 다음날 같은 과목 다른 반이 시작하면 반이동", () => {
    expect(transferTo("2026-08-10", "math", [other({ start: "2026-08-11" })])?.className).toBe("중등M 중2 B");
  });

  it("🔴 과목이 다르면 반이동이 아니다 — 수학을 그만두고 영어를 시작한 것", () => {
    expect(transferTo("2026-08-10", "math", [other({ start: "2026-08-11", subject: "english" })])).toBeNull();
  });

  it("🔴 겹치면 반이동이 아니다 — 두 반을 같이 다닌 것이지 옮긴 게 아니다", () => {
    expect(transferTo("2026-08-10", "math", [other({ start: "2026-08-01" })])).toBeNull();
  });

  it("🔴 공백이 14일을 넘으면 반이동이 아니다 — 쉬었다 재등록", () => {
    expect(transferTo("2026-08-10", "math", [other({ start: "2026-08-24" })])?.className).toBe("중등M 중2 B");
    expect(transferTo("2026-08-10", "math", [other({ start: "2026-08-25" })])).toBeNull();
  });

  it("여러 후보가 있으면 가장 먼저 시작한 반", () => {
    const hit = transferTo("2026-08-10", "math", [
      other({ classId: "c3", className: "늦은반", start: "2026-08-20" }),
      other({ classId: "c2", className: "바로반", start: "2026-08-12" }),
    ]);
    expect(hit?.className).toBe("바로반");
  });

  it("들어온 쪽(from)은 직전에 끝난 같은 과목 반을 찾는다", () => {
    const hit = transferFrom("2026-08-11", "math", [
      other({ className: "이전반", start: "2026-03-02", end: "2026-08-10" }),
    ]);
    expect(hit?.className).toBe("이전반");
    // 아직 안 끝난 반은 출처가 아니다(동시 수강).
    expect(transferFrom("2026-08-11", "math", [other({ start: "2026-03-02", end: null })])).toBeNull();
  });
});

describe("lifecycleBadges", () => {
  it("이어받은 반이 없으면 신입·퇴원 그대로", () => {
    expect(lifecycleBadges(M, [{ start: "2026-08-05", end: null }], "math")).toEqual([
      { kind: "new", date: "2026-08-05" },
    ]);
    expect(lifecycleBadges(M, [{ start: "2026-03-02", end: "2026-08-12" }], "math")).toEqual([
      { kind: "left", date: "2026-08-12" },
    ]);
  });

  it("🔴 이어받은 반이 있으면 '퇴원'이 아니라 '반이동'으로 승격한다", () => {
    const badges = lifecycleBadges(M, [{ start: "2026-03-02", end: "2026-08-12" }], "math", [
      other({ start: "2026-08-13" }),
    ]);
    expect(badges).toEqual([
      { kind: "transferOut", date: "2026-08-12", otherClassName: "중등M 중2 B" },
    ]);
    // 퇴원 뱃지는 남지 않는다 — 두 개가 같이 뜨면 나갔다는 건지 옮겼다는 건지 모른다.
    expect(badges.some((b) => b.kind === "left")).toBe(false);
  });

  it("평범한 재원생은 표식이 없다 — 대부분의 행은 빈 배열", () => {
    expect(lifecycleBadges(M, [{ start: "2026-01-05", end: null }], "math")).toEqual([]);
  });

  it("툴팁은 언제·어디로인지까지 말한다", () => {
    expect(badgeTitle({ kind: "new", date: "2026-08-05" }, "가반")).toBe("2026-08-05 첫 수업");
    expect(badgeTitle({ kind: "left", date: "2026-08-12" }, "가반")).toBe("2026-08-12 퇴원");
    expect(
      badgeTitle({ kind: "transferOut", date: "2026-08-12", otherClassName: "나반" }, "가반"),
    ).toBe("반이동: 가반 → 나반 (2026-08-12까지)");
    expect(
      badgeTitle({ kind: "transferIn", date: "2026-08-13", otherClassName: "나반" }, "가반"),
    ).toBe("반이동: 나반 → 가반 (2026-08-13부터)");
  });
});
