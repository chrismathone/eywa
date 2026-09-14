import { describe, expect, it } from "vitest";
import {
  badgeLabelOf,
  badgeTitle,
  clipToWithdrawal,
  isEnrolledOn,
  joinedInMonth,
  leftInMonth,
  lifecycleBadges,
  lifecycleBadgesInRange,
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

  it("🔴 반이동으로 닫힌 구간은 **같은 날** 시작도 이동이다(원장 2026-09-14 '반이동생이 퇴원생 처리되지 않게')", () => {
    // 반이동 RPC가 옛 반을 `end_date = 새 반 start_date`로 닫는다 — 같은 날을 빼면 진짜 이동이 퇴원이 된다.
    expect(transferTo("2026-09-12", "math", [other({ start: "2026-09-12" })], true)?.className).toBe("중등M 중2 B");
    // 표식이 없으면 종전 그대로 — 같은 날 시작은 '함께 다니기 시작한 날'이다.
    expect(transferTo("2026-09-12", "math", [other({ start: "2026-09-12" })])).toBeNull();
  });

  it("🔴 같은 날 이어받은 반이동은 퇴원 뱃지가 아니라 반이동 뱃지다(김지우 9/12 실측)", () => {
    const badges = lifecycleBadgesInRange(
      { first: "2026-09-01", last: "2026-09-30" },
      [{ start: "2026-09-01", end: "2026-09-12", isTransferred: true }],
      "math",
      [other({ className: "고등M 개별 토일", start: "2026-09-12" })],
    );
    expect(badges.map((b) => b.kind)).toContain("transferOut");
    expect(badges.map((b) => b.kind)).not.toContain("left");
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

// ── 종강(원장 2026-09-14) ─────────────────────────────────────────────────
// "과목 퇴원이 아니고 과목에서 여러개 수업을 듣다가 특강 종료 등으로 종료한것인데. 과목을 완전 수강 종료하면 퇴원이지."
describe("종강 — 이 반만 끝나고 같은 과목 다른 반은 계속 다닌다", () => {
  const SEP = { first: "2026-09-01", last: "2026-09-30" };
  // [특강]중3-2 개념 완성반 실측 모양: 8/17~9/10 특강 + 2/19부터 계속 다니는 정규반
  const special = [{ start: "2026-08-17", end: "2026-09-10" }];
  const regular = other({ classId: "ms2a", className: "중등M 초6 MS2A", start: "2026-02-19", end: null });
  const kinds = (b: { kind: string }[]) => b.map((x) => x.kind);

  it("🔴 특강 종료 + 같은 과목 정규반 계속 → 종강(계속 다니는 반 이름을 싣는다)", () => {
    expect(lifecycleBadgesInRange(SEP, special, "math", [regular])).toEqual([
      { kind: "classEnded", date: "2026-09-10", otherClassName: "중등M 초6 MS2A" },
    ]);
  });

  it("같은 과목 다른 반이 **같은 날** 끝나면 계속 다닌 게 아니다 → 퇴원", () => {
    expect(kinds(lifecycleBadgesInRange(SEP, special, "math", [other({ start: "2026-02-19", end: "2026-09-10" })]))).toEqual(["left"]);
  });

  it("계속 반이 다음날 **반이동으로** 닫혀도 계속 다닌 게 아니다 — 재원 판정은 isEnrolledOn 규약 그대로", () => {
    const moved = other({ start: "2026-02-19", end: "2026-09-11", isTransferred: true });
    expect(kinds(lifecycleBadgesInRange(SEP, special, "math", [moved]))).toEqual(["left"]);
  });

  it("다른 과목 반만 계속 → 퇴원(그 과목을 완전히 끝냈다)", () => {
    const english = other({ subject: "english", start: "2026-02-19", end: null });
    expect(kinds(lifecycleBadgesInRange(SEP, special, "math", [english]))).toEqual(["left"]);
  });

  it("나간 다음날~14일 안에 같은 과목 반이 시작 → 반이동 그대로(종강보다 먼저 본다)", () => {
    expect(lifecycleBadgesInRange(SEP, special, "math", [other({ className: "새반", start: "2026-09-11" })])).toEqual([
      { kind: "transferOut", date: "2026-09-10", otherClassName: "새반" },
    ]);
    // 계속 다니는 반이 함께 있어도 반이동이 이긴다(판정 순서: 반이동 → 종강 → 퇴원).
    expect(
      lifecycleBadgesInRange(SEP, special, "math", [regular, other({ className: "새반", start: "2026-09-24" })]),
    ).toEqual([{ kind: "transferOut", date: "2026-09-10", otherClassName: "새반" }]);
  });

  it("반이동으로 닫힌 구간은 기존 결과 그대로 — 같은 날 시작한 이동 반이 이긴다", () => {
    const spans = [{ start: "2026-08-17", end: "2026-09-10", isTransferred: true }];
    expect(
      lifecycleBadgesInRange(SEP, spans, "math", [regular, other({ className: "이동반", start: "2026-09-10" })]),
    ).toEqual([{ kind: "transferOut", date: "2026-09-10", otherClassName: "이동반" }]);
  });

  it("과목을 모르면(null) 판정하지 않는다 → 퇴원", () => {
    expect(kinds(lifecycleBadgesInRange(SEP, special, null, [other({ subject: null, start: "2026-02-19" })]))).toEqual([
      "left",
    ]);
  });

  it("같은 달에 들어와 종강 → 신입 + 종강", () => {
    expect(lifecycleBadgesInRange(SEP, [{ start: "2026-09-02", end: "2026-09-20" }], "math", [regular])).toEqual([
      { kind: "new", date: "2026-09-02" },
      { kind: "classEnded", date: "2026-09-20", otherClassName: "중등M 초6 MS2A" },
    ]);
  });

  it("계속 다니는 반이 여럿이면 가장 먼저 시작한 반", () => {
    const late = other({ classId: "c9", className: "늦게 시작", start: "2026-06-01" });
    expect(lifecycleBadgesInRange(SEP, special, "math", [late, regular])[0]!.otherClassName).toBe("중등M 초6 MS2A");
  });

  it("🔴 학원을 그만둔 날이 종료일 이전·당일이면 퇴원 — 다른 반을 퇴원일로 잘라 넘긴다", () => {
    // 퇴원일 뒤로 end_date가 남은 수강(실측 48건)이 "계속 수강"으로 읽히면 그만둔 학생이 종강으로 뜬다.
    const leftOpen = other({ start: "2026-02-19", end: "2026-09-30" });
    expect(kinds(lifecycleBadgesInRange(SEP, special, "math", [clipToWithdrawal(leftOpen, "2026-09-10")]))).toEqual([
      "left",
    ]);
    expect(kinds(lifecycleBadgesInRange(SEP, special, "math", [clipToWithdrawal(leftOpen, "2026-09-03")]))).toEqual([
      "left",
    ]);
  });

  it("그만둔 날이 종료일 **뒤**면 그 사이 계속 다닌 것이라 종강(실측 7건 모양: 계속 반이 퇴원일에 닫힘)", () => {
    const closedAtWithdrawal = other({ className: "고등M 개별 BS4F", start: "2026-07-04", end: "2026-09-07" });
    expect(
      lifecycleBadgesInRange(
        { first: "2026-08-01", last: "2026-08-31" },
        [{ start: "2026-03-02", end: "2026-08-03" }],
        "math",
        [clipToWithdrawal(closedAtWithdrawal, "2026-09-07")],
      ),
    ).toEqual([{ kind: "classEnded", date: "2026-08-03", otherClassName: "고등M 개별 BS4F" }]);
  });

  it("라벨·툴팁 — 퇴원과 다른 말, 계속 다니는 반까지 말한다", () => {
    expect(badgeLabelOf("classEnded")).toBe("종강");
    expect(badgeLabelOf("classEnded", "en")).toBe("Ended");
    expect(badgeLabelOf("classEnded")).not.toBe(badgeLabelOf("left"));
    expect(badgeTitle({ kind: "classEnded", date: "2026-09-10", otherClassName: "나반" }, "가반")).toBe(
      "2026-09-10 종강 · 나반 계속 수강",
    );
    expect(badgeTitle({ kind: "classEnded", date: "2026-09-10", otherClassName: "MS2A" }, "PL1", "en")).toBe(
      "Class ended 2026-09-10 · continues in MS2A",
    );
  });
});

describe("clipToWithdrawal", () => {
  it("퇴원일이 없거나 수강이 먼저(같은 날 포함) 끝났으면 그대로", () => {
    const s = { start: "2026-03-01", end: "2026-08-10" };
    expect(clipToWithdrawal(s, null)).toBe(s);
    expect(clipToWithdrawal(s, undefined)).toBe(s);
    expect(clipToWithdrawal(s, "2026-08-20")).toBe(s);
    expect(clipToWithdrawal(s, "2026-08-10")).toBe(s);
  });

  it("퇴원일이 더 이르면 그날까지 — 일반 종료로 본다(반이동 표식이 남아 하루를 또 당기지 않게)", () => {
    expect(clipToWithdrawal({ start: "2026-03-01", end: null }, "2026-08-10")).toEqual({
      start: "2026-03-01",
      end: "2026-08-10",
      isTransferred: false,
    });
    expect(clipToWithdrawal({ start: "2026-03-01", end: "2026-09-01", isTransferred: true }, "2026-08-10")).toEqual({
      start: "2026-03-01",
      end: "2026-08-10",
      isTransferred: false,
    });
  });
});

// ── 세션 기간(0189a) 판정 ─────────────────────────────────────────────────
// 🔴 표가 세션으로 그려지면 뱃지도 **같은 기간**으로 판정해야 한다. 날짜축만 세션으로 바꾸고
//    판정을 달력월로 두면 표는 그 칸을 그리는데 뱃지만 사라진다 — 눈에 안 띄는 종류의 실패다.
describe("lifecycleBadgesInRange — 세션은 달력월을 넘긴다", () => {
  // 2026년 2월 세션 = 2/2~3/5 (설 연휴로 밀려 3월 초까지)
  const FEB_SESSION = { first: "2026-02-02", last: "2026-03-05" };

  it("세션 끝이 다음 달이면 그 달 퇴원도 잡는다", () => {
    const spans = [{ start: "2025-09-01", end: "2026-03-03" }];
    const badges = lifecycleBadgesInRange(FEB_SESSION, spans, "math");
    expect(badges).toEqual([{ kind: "left", date: "2026-03-03" }]);
    // 같은 학생을 '2026-02' 달력월로 보면 3/3은 범위 밖이라 안 잡힌다(그래서 기간 판정이 필요하다).
    expect(lifecycleBadges("2026-02", spans, "math")).toEqual([]);
  });

  it("세션 시작이 전달이면 그 시작일의 신입도 잡는다", () => {
    const badges = lifecycleBadgesInRange(FEB_SESSION, [{ start: "2026-02-02", end: null }], "math");
    expect(badges).toEqual([{ kind: "new", date: "2026-02-02" }]);
  });

  it("세션 시작 전날에 이미 소속이면 신입이 아니다", () => {
    expect(
      lifecycleBadgesInRange(FEB_SESSION, [{ start: "2026-02-01", end: null }], "math"),
    ).toEqual([]);
  });

  it("세션 마지막 날에 아직 소속이면 퇴원이 아니다", () => {
    expect(
      lifecycleBadgesInRange(FEB_SESSION, [{ start: "2025-09-01", end: "2026-03-05" }], "math"),
    ).toEqual([]);
  });

  it("달력월 진입점은 기간판의 래퍼라 결과가 같다", () => {
    const spans = [{ start: "2026-08-05", end: null }];
    expect(lifecycleBadges("2026-08", spans, "math")).toEqual(
      lifecycleBadgesInRange({ first: "2026-08-01", last: "2026-08-31" }, spans, "math"),
    );
  });
});
