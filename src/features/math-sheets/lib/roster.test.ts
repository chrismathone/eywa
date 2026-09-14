import { describe, expect, it } from "vitest";
import {
  effectiveEndDate,
  isOnMathRoster,
  isOnMathRosterAnyDay,
  mathSpansOf,
  rosterAnchorOf,
  rosterPhaseOf,
  countRosterPhases,
  rosterExtraTitle,
} from "./roster";
import { lifecycleBadgesInRange } from "@/features/attendance/enrollment-span";

const E = (startDate: string, endDate: string | null = null, isTransferred = false) => ({
  startDate,
  endDate,
  isTransferred,
});

describe("rosterAnchorOf — 오늘을 보고 있는 달 안으로 접는다", () => {
  it("이번 달이면 오늘", () => {
    expect(rosterAnchorOf("2026-08", "2026-08-31")).toBe("2026-08-31");
    expect(rosterAnchorOf("2026-08", "2026-08-05")).toBe("2026-08-05");
  });

  it("🔴 지난 달이면 말일 — 오늘로 판정하면 그 달 내내 다닌 학생이 통째로 사라진다", () => {
    expect(rosterAnchorOf("2026-08", "2026-09-15")).toBe("2026-08-31");
    expect(rosterAnchorOf("2026-02", "2026-09-15")).toBe("2026-02-28");
  });

  it("다음 달이면 1일(그 달에 들어오는 학생이 보여야 한다)", () => {
    expect(rosterAnchorOf("2026-09", "2026-08-31")).toBe("2026-09-01");
  });
});

describe("effectiveEndDate — 수강 종료와 학원 퇴원 중 이른 것", () => {
  it("둘 다 있으면 이른 쪽", () => {
    expect(effectiveEndDate("2026-08-20", "2026-08-10")).toBe("2026-08-10");
    expect(effectiveEndDate("2026-08-05", "2026-08-10")).toBe("2026-08-05");
  });

  it("한쪽만 있으면 그것", () => {
    expect(effectiveEndDate(null, "2026-08-10")).toBe("2026-08-10");
    expect(effectiveEndDate("2026-08-20", null)).toBe("2026-08-20");
    expect(effectiveEndDate(null, null)).toBeNull();
  });
});

describe("isOnMathRoster — 재원생만", () => {
  it("끝난 적 없으면 재원", () => {
    expect(isOnMathRoster([E("2026-03-01")], null, "2026-08-31")).toBe(true);
  });

  it("🔴 수업이 종료됐으면 안 나온다", () => {
    expect(isOnMathRoster([E("2026-03-01", "2026-07-31")], null, "2026-08-31")).toBe(false);
  });

  it("🔴 반이동 전출은 종료일 당일부터 옛 반에서 빠진다", () => {
    // 실측 선례: 이연아 2026-05-04 ~ 2026-08-19 (is_transferred) — 8/19부터 옛 반에 없다.
    expect(isOnMathRoster([E("2026-05-04", "2026-08-19", true)], null, "2026-08-19")).toBe(false);
    expect(isOnMathRoster([E("2026-05-04", "2026-08-19", true)], null, "2026-08-18")).toBe(true);
    // 일반 종료는 당일까지 재원 — 전출과 규약이 다르다.
    expect(isOnMathRoster([E("2026-05-04", "2026-08-19", false)], null, "2026-08-19")).toBe(true);
  });

  it("🔴 학원 퇴원은 수강에 종료일이 없어도 잡는다", () => {
    expect(isOnMathRoster([E("2026-03-01")], "2026-08-10", "2026-08-31")).toBe(false);
    expect(isOnMathRoster([E("2026-03-01")], "2026-08-10", "2026-08-09")).toBe(true);
  });

  it("아직 시작 전이면 안 나온다", () => {
    // 실측 선례: 김동리·권민서A 2026-09-01 시작 — 8월 시트에 서면 안 된다.
    expect(isOnMathRoster([E("2026-09-01")], null, "2026-08-31")).toBe(false);
    expect(isOnMathRoster([E("2026-09-01")], null, "2026-09-01")).toBe(true);
  });

  it("나갔다 돌아왔으면 지금 구간으로 판정한다", () => {
    const two = [E("2026-03-01", "2026-06-30"), E("2026-08-24")];
    expect(isOnMathRoster(two, null, "2026-08-31")).toBe(true);
    expect(isOnMathRoster(two, null, "2026-07-15")).toBe(false);
  });

  it("start_date가 없는 행은 근거로 쓰지 않는다", () => {
    expect(isOnMathRoster([{ startDate: null, endDate: null, isTransferred: false }], null, "2026-08-31")).toBe(false);
  });

  it("수강이 하나도 없으면 재원이 아니다", () => {
    expect(isOnMathRoster([], null, "2026-08-31")).toBe(false);
  });
});

describe("mathSpansOf — 출석부와 같은 모양(끝 포함)으로 편다", () => {
  it("전출은 종료일 하루 전이 마지막 날 — 일반 종료는 종료일 당일까지", () => {
    expect(mathSpansOf([E("2026-05-04", "2026-08-19", true)], null)).toEqual([
      { start: "2026-05-04", end: "2026-08-18" },
    ]);
    expect(mathSpansOf([E("2026-05-04", "2026-08-19", false)], null)).toEqual([
      { start: "2026-05-04", end: "2026-08-19" },
    ]);
  });

  it("학원 퇴원이 더 이르면 그날이 끝", () => {
    expect(mathSpansOf([E("2026-03-01", "2026-08-20")], "2026-08-10")).toEqual([
      { start: "2026-03-01", end: "2026-08-10" },
    ]);
  });

  it("start_date 없는 행·시작 전에 끝난 구간은 담지 않는다", () => {
    expect(mathSpansOf([{ startDate: null, endDate: null, isTransferred: false }], null)).toEqual([]);
    // 같은 날 전출 = 하루도 안 다닌 구간
    expect(mathSpansOf([E("2026-08-19", "2026-08-19", true)], null)).toEqual([]);
  });

  it("🔴 반이동 판정이 이 하루 당김에 걸려 있다 — 안 당기면 진짜 반이동이 '퇴원'으로 표시된다", () => {
    // 반이동 RPC는 옛 반.end_date = 새 반.start_date로 저장한다.
    const spans = mathSpansOf([E("2026-05-04", "2026-08-19", true)], null);
    const others = [
      { classId: "c2", className: "중등M 중1 BS3E", subject: "math", start: "2026-08-19", end: null },
    ];
    const badges = lifecycleBadgesInRange(
      { first: "2026-08-01", last: "2026-08-31" },
      spans,
      "math",
      others,
    );
    expect(badges).toEqual([
      { kind: "transferOut", date: "2026-08-18", otherClassName: "중등M 중1 BS3E" },
    ]);
    // 당기지 않은 구간(출석부 규약)으로는 같은 이동이 반이동으로 안 읽힌다 — 같은 날 시작한 새 반을
    // '이미 다니던 반'으로 보아 종강이 된다(2026-09-14 종강 판정 이전엔 '퇴원'이었다).
    const raw = lifecycleBadgesInRange(
      { first: "2026-08-01", last: "2026-08-31" },
      [{ start: "2026-05-04", end: "2026-08-19" }],
      "math",
      others,
    );
    expect(raw[0]!.kind).not.toBe("transferOut");
  });

  it("🔴 그만둔 학생 — 다른 반도 퇴원일로 잘리므로(mathSpansOf) 특강 종료가 '종강'으로 읽히지 않는다", () => {
    // lifecycle.ts는 다른 반 구간도 같은 함수(+ withdrawn_at)로 편다. 퇴원일 뒤로 열린 정규반이 있어도 계속 수강이 아니다.
    const wd = "2026-09-10";
    const spans = mathSpansOf([E("2026-08-17", "2026-09-10")], wd);
    const [o] = mathSpansOf([E("2026-02-19", null)], wd);
    const others = [{ classId: "ms2a", className: "중등M 초6 MS2A", subject: "math", start: o!.start, end: o!.end }];
    const sep = { first: "2026-09-01", last: "2026-09-30" };
    expect(lifecycleBadgesInRange(sep, spans, "math", others).map((b) => b.kind)).toEqual(["left"]);
    // 그만두지 않았으면 같은 모양이 종강이다.
    const [open] = mathSpansOf([E("2026-02-19", null)], null);
    expect(
      lifecycleBadgesInRange(sep, mathSpansOf([E("2026-08-17", "2026-09-10")], null), "math", [
        { ...others[0]!, start: open!.start, end: open!.end },
      ]).map((b) => b.kind),
    ).toEqual(["classEnded"]);
  });
});

describe("mathSpansOf — 전출 하루 당김을 두 번 적용하지 않는다", () => {
  it("🔴 구간에 isTransferred를 싣지 않는다 — 실으면 판정이 하루를 두 번 당긴다", () => {
    // origin이 `EnrollSpan`에 `isTransferred`를 얹었다([[#125]]). 출석부는 원본 end_date + 플래그로
    // 가르고, MCS는 **펼 때 미리 당긴다** — 둘을 함께 쓰면 전출이 이틀 일찍 끝난다.
    const spans = mathSpansOf([E("2026-05-04", "2026-08-19", true)], null);
    expect(spans).toEqual([{ start: "2026-05-04", end: "2026-08-18" }]);
    expect(spans[0]).not.toHaveProperty("isTransferred");
  });
});

describe("isOnMathRosterAnyDay — 행을 세울까(달 중간 입·퇴반은 남긴다)", () => {
  const DAYS = ["2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25"];

  it("🔴 달 중간에 나가도 남는다 — 다닌 날의 기록이 사라지면 안 된다", () => {
    const left = [E("2026-03-01", "2026-08-12")];
    expect(isOnMathRosterAnyDay(left, null, DAYS)).toBe(true);
    expect(isOnMathRoster(left, null, "2026-08-31")).toBe(false); // 말일엔 이미 없다(회색 처리 근거)
  });

  it("🔴 달 중간에 들어와도 남는다", () => {
    const joined = [E("2026-08-20")];
    expect(isOnMathRosterAnyDay(joined, null, DAYS)).toBe(true);
    expect(isOnMathRoster(joined, null, "2026-08-04")).toBe(false); // 그 전 칸은 꺼진다
  });

  it("그 달 수업일에 한 번도 안 걸리면 세우지 않는다", () => {
    expect(isOnMathRosterAnyDay([E("2026-03-01", "2026-07-31")], null, DAYS)).toBe(false);
    expect(isOnMathRosterAnyDay([E("2026-09-01")], null, DAYS)).toBe(false);
  });

  it("🔴 수업일이 없는 틈에만 걸친 수강은 빈 회색 줄이 되므로 안 세운다", () => {
    // 8/5~8/9(화~토)는 이 반 수업일(월요일)이 하나도 없다.
    expect(isOnMathRosterAnyDay([E("2026-08-05", "2026-08-09")], null, DAYS)).toBe(false);
  });

  it("수강이 없으면 세우지 않는다", () => {
    expect(isOnMathRosterAnyDay([], null, DAYS)).toBe(false);
  });
});

describe("rosterPhaseOf — 회색으로 가라앉힐지", () => {
  const AUG = ["2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25"];
  const SEP = ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29"];

  it("명단이면 on", () => {
    expect(rosterPhaseOf([E("2026-03-01")], null, "2026-08-31", AUG)).toBe("on");
  });

  it("🔴 아직 시작 전이면 upcoming — 퇴원과 같은 회색으로 칠하면 안 된다", () => {
    expect(rosterPhaseOf([E("2026-09-20")], null, "2026-09-01", SEP)).toBe("upcoming");
  });

  it("나갔으면 ended", () => {
    expect(rosterPhaseOf([E("2026-03-01", "2026-08-12")], null, "2026-08-31", AUG)).toBe("ended");
    // 전출도 마찬가지(종료일 당일부터 옛 반에 없다)
    expect(rosterPhaseOf([E("2026-05-04", "2026-08-19", true)], null, "2026-08-31", AUG)).toBe(
      "ended",
    );
  });

  it("나갔다 **같은 달에** 다시 들어오면 upcoming — 그 달 칸이 다시 켜진다", () => {
    // 8/11에 나가고 8/18에 재등록. 오늘이 8/12면 아직 안 왔지만 이 시트 안에서 다시 온다.
    expect(
      rosterPhaseOf([E("2026-03-01", "2026-08-11"), E("2026-08-18")], null, "2026-08-12", AUG),
    ).toBe("upcoming");
  });

  it("🔴 나갔다 **다음 달에** 다시 들어오면 이 달은 ended — 회색 줄을 놓치면 안 된다", () => {
    // 적대적 재리뷰 2026-09-01: 다음 달 시작을 upcoming으로 세면 표식은 `퇴원 08-12`인데
    // 줄은 회색이 아니고 헤더가 "시작 예정 1명"이라 적는 모순이 난다.
    const back = [E("2026-03-01", "2026-08-12"), E("2026-09-05")];
    expect(rosterPhaseOf(back, null, "2026-08-31", AUG)).toBe("ended");
    // 같은 학생이 9월 시트에선 (9/1 기준) upcoming이다 — 달마다 답이 다른 게 맞다.
    expect(rosterPhaseOf(back, null, "2026-09-01", SEP)).toBe("upcoming");
  });

  it("수업일 밖에서 시작하면 upcoming이 아니다 — 켜지는 칸이 없다", () => {
    // 8/30 시작(그 달 마지막 수업일 8/25 뒤) — 이 시트엔 그릴 칸이 없다.
    expect(rosterPhaseOf([E("2026-08-30")], null, "2026-08-01", AUG)).toBe("ended");
  });

  it("수강이 없으면 ended(행 자체가 안 서지만 판정은 닫아 둔다)", () => {
    expect(rosterPhaseOf([], null, "2026-08-31", AUG)).toBe("ended");
  });
});

describe("countRosterPhases — \"학생 N명\"은 현재 재원이다", () => {
  it("🔴 줄 수를 그대로 적지 않는다 — on / upcoming / ended를 가른다", () => {
    expect(countRosterPhases(["on", "on", "ended", "upcoming"])).toEqual({
      on: 2,
      upcoming: 1,
      ended: 1,
      extra: 2,
    });
  });

  it("현재 재원 0명인 특강도 정직하게 0으로 센다(실측: 헤더가 '학생 7명'이라 적혔던 자리)", () => {
    const counts = countRosterPhases(["ended", "ended", "ended"]);
    expect(counts.on).toBe(0);
    expect(counts.extra).toBe(3);
  });

  it("on + extra = 시트 줄 수", () => {
    const phases = ["on", "ended", "upcoming", "on", "on"] as const;
    const c = countRosterPhases([...phases]);
    expect(c.on + c.extra).toBe(phases.length);
  });
});

describe("rosterExtraTitle — 꼬리표 툴팁", () => {
  it("남는 줄이 없으면 null(꼬리표 자체를 안 붙인다)", () => {
    expect(rosterExtraTitle({ on: 4, upcoming: 0, ended: 0 })).toBeNull();
  });

  it("종료·예정을 각각 말한다", () => {
    expect(rosterExtraTitle({ on: 4, upcoming: 0, ended: 1 })).toContain("이 달 중 종료 1명");
    expect(rosterExtraTitle({ on: 4, upcoming: 2, ended: 0 })).toContain("시작 예정 2명");
    const both = rosterExtraTitle({ on: 4, upcoming: 2, ended: 1 })!;
    expect(both).toContain("현재 재원 4명");
    expect(both).toContain("이 달 중 종료 1명");
    expect(both).toContain("시작 예정 2명");
  });
});
