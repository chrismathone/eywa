import { describe, expect, it } from "vitest";
import {
  formatDays,
  parseDays,
  splitCoursesByMonth,
  quoteTotal,
  autoSessions,
  feeKindOf,
  feeKindFromPricingMode,
  needsFeeKindCheck,
  groupByFeeKind,
  normalizeLoadedCourse,
  normalizeLoadedCourses,
  FEE_KIND_LABEL,
  type QuoteCourse,
} from "./quote-calc";

const course = (over: Partial<QuoteCourse>): QuoteCourse => ({
  uid: "u",
  category: "수학",
  name: "테스트반",
  days: "월",
  perSession: 10000,
  sessions: 0,
  price: 0,
  note: "",
  excludeHolidays: true,
  fixedMonthly: false,
  ...over,
});

describe("parseDays", () => {
  it("한글 요일 → 인덱스(0=일~6=토)", () => {
    expect(parseDays("월,수,금")).toEqual([1, 3, 5]);
    expect(parseDays("토, 일")).toEqual([6, 0]);
  });
  it("빈/오타 토큰 무시", () => {
    expect(parseDays("월,,X")).toEqual([1]);
  });

  // 🔴 쉼표 없이 붙여 쓰는 게 사람에겐 더 자연스럽다. 예전엔 split(",")만 해서 "월수목"이
  //    통째로 오타 취급 → 요일 0개 → **시수가 0**이 됐다(원장 제보 2026-08-07).
  it("쉼표 없이 붙여 써도 읽는다", () => {
    expect(parseDays("월수목")).toEqual([1, 3, 4]);
    expect(parseDays("월수금")).toEqual([1, 3, 5]);
    expect(parseDays("화목")).toEqual([2, 4]);
  });

  it("구분자가 무엇이든 상관없다", () => {
    expect(parseDays("월 수 금")).toEqual([1, 3, 5]);
    expect(parseDays("월/수/금")).toEqual([1, 3, 5]);
    expect(parseDays("월·수·금")).toEqual([1, 3, 5]);
    // ⚠️ "월요일"은 '요일'의 '일'이 일요일로 잡히면 안 된다 — 파서가 '요일'을 먼저 걷어낸다.
    expect(parseDays("월요일, 수요일")).toEqual([1, 3]);
  });

  it("같은 요일을 두 번 써도 한 번만 센다(시수 부풀림 방지)", () => {
    expect(parseDays("월,월,수")).toEqual([1, 3]);
    expect(parseDays("월월")).toEqual([1]);
  });
});

describe("formatDays — 입력 칸 자동 정리", () => {
  it("붙여 쓴 요일을 쉼표 표기로", () => {
    expect(formatDays("월수목")).toBe("월,수,목");
    expect(formatDays("화목")).toBe("화,목");
  });

  it("이미 정리된 값은 그대로", () => {
    expect(formatDays("월,수,금")).toBe("월,수,금");
  });

  it("사람이 친 순서를 유지한다(시수는 순서와 무관)", () => {
    expect(formatDays("금월")).toBe("금,월");
  });

  // 🔴 읽을 요일이 없으면 빈 문자열 — 호출부는 그때 원래 입력을 지우지 않는다.
  it("요일이 하나도 없으면 빈 문자열", () => {
    expect(formatDays("dnjftn")).toBe("");
    expect(formatDays("")).toBe("");
  });
});

describe("autoSessions", () => {
  it("2026년 6월 월요일 = 5회 (6/1 월요일)", () => {
    // 2026-06: Mondays 1,8,15,22,29
    expect(autoSessions("월", "2026-06-01", "2026-06-30", [])).toBe(5);
  });
  it("공휴일 제외 시 차감", () => {
    expect(autoSessions("월", "2026-06-01", "2026-06-30", ["2026-06-08"])).toBe(4);
  });
});

describe("splitCoursesByMonth", () => {
  it("한 달 내 과목 = 단일 행, 소계 없음", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "월", sessions: 5, price: 50000 })],
      "2026-06-01",
      "2026-06-30",
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].sessions).toBe(5);
    expect(lines[0].price).toBe(50000);
    expect(lines[0].isSubtotal).toBeUndefined();
  });

  it("두 달 걸치면 월별 행 + 소계, 금액 비례 분배", () => {
    // 6월 월 5회 + 7월 월 4회 = 9회, 총액 90000 → 6월 50000 / 7월 40000 / 소계 90000
    const lines = splitCoursesByMonth(
      [course({ days: "월", sessions: 9, price: 90000 })],
      "2026-06-01",
      "2026-07-31",
      [],
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ month: "6월", sessions: 5, price: 50000 });
    expect(lines[1]).toMatchObject({ month: "7월", sessions: 4, price: 40000 });
    expect(lines[2]).toMatchObject({ isSubtotal: true, sessions: 9, price: 90000 });
  });

  it("fixedMonthly = 단일 행(자동분할 우회)", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "토", sessions: 12, price: 360000, fixedMonthly: true })],
      "2026-06-01",
      "2026-08-31",
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sessions: 12, price: 360000 });
  });

  it("0차시(요일 불일치)면 입력값으로 폴백 단일 행", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "일", sessions: 3, price: 30000 })],
      "2026-06-01",
      "2026-06-02", // 일요일 없음
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].sessions).toBe(3);
  });
});

describe("quoteTotal", () => {
  it("과목 + 기타 − 할인", () => {
    const t = quoteTotal(
      [course({ price: 300000 }), course({ price: 200000 })],
      [{ uid: "e", name: "교재", price: 12000, note: "" }],
      [{ uid: "d", name: "형제할인", amount: 10000 }],
    );
    expect(t.courseTotal).toBe(500000);
    expect(t.extraTotal).toBe(12000);
    expect(t.discountTotal).toBe(10000);
    expect(t.total).toBe(502000);
  });
  it("과할인 음수 방어", () => {
    const t = quoteTotal([course({ price: 10000 })], [], [{ uid: "d", name: "x", amount: 99999 }]);
    expect(t.total).toBe(0);
  });
});

// 🔴🔴 학부모에게 나가는 안내문의 **불변식**: 과목 표의 행 합 === 그 과목 금액.
//     같은 A4 한 장에 소계와 최종 납부 금액이 나란히 인쇄되므로 1원도 어긋나면 안 된다.
//     (2026-08-07 적대 리뷰 실측: 612조합 중 214건이 어긋났다 — 달마다 독립 반올림 때문.)
describe("splitCoursesByMonth — 행 합 ≡ 과목 금액 (불변식)", () => {
  const sum = (lines: ReturnType<typeof splitCoursesByMonth>) =>
    lines.filter((l) => !l.isSubtotal).reduce((a, b) => a + b.price, 0);

  it("총액을 수기로 넣어 나누어떨어지지 않아도 합이 정확하다", () => {
    // 월요일반 2026-06-01~08-31 = 14회, 총액 100,000 → per가 7142.857…
    const lines = splitCoursesByMonth(
      [course({ days: "월", sessions: 14, price: 100_000 })],
      "2026-06-01",
      "2026-08-31",
      [],
    );
    expect(sum(lines)).toBe(100_000);
    expect(lines.find((l) => l.isSubtotal)?.price).toBe(100_000);
  });

  it("금액 스윕 — 어떤 금액·기간이든 합이 총액과 같다", () => {
    for (let price = 100_000; price <= 600_000; price += 10_000) {
      for (const [s, e] of [
        ["2026-06-01", "2026-07-31"],
        ["2026-06-01", "2026-08-31"],
        ["2026-03-01", "2026-06-30"],
      ] as const) {
        for (const days of ["월", "월,수", "월,수,금", "화,목"]) {
          const auto = autoSessions(days, s, e, []);
          if (auto === 0) continue;
          const lines = splitCoursesByMonth([course({ days, sessions: auto, price })], s, e, []);
          expect(sum(lines), `${price}원 ${s}~${e} ${days}`).toBe(price);
        }
      }
    }
  });

  // 🔴 상담자가 시수를 수기로 고치면 그게 합의된 회차다 — 표가 제멋대로 다시 세면 안 된다.
  it("시수를 수기로 고치면 월별로 쪼개지 않고 화면 값 그대로 한 줄", () => {
    // 자동 9회인데 8회로 합의한 경우(단가 50,000 → 400,000원)
    const lines = splitCoursesByMonth(
      [course({ days: "월,수", sessions: 8, price: 400_000, perSession: 50_000 })],
      "2026-09-01",
      "2026-09-30",
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sessions: 8, price: 400_000 });
  });

  // 🔴 시수 0 + 금액 있음: 예전엔 c.price를 버리고 perSession으로 딴 금액을 만들어 냈다.
  it("시수가 0이면 입력된 금액을 그대로 쓴다(단가로 만들어내지 않는다)", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "월,수", sessions: 0, price: 300_000, perSession: 50_000 })],
      "2026-06-01",
      "2026-07-31",
      [],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sessions: 0, price: 300_000 });
  });

  // 🔴 저장 뒤 휴원일이 추가돼 다시 센 시수가 달라져도, 학부모가 받은 금액은 안 바뀐다.
  it("휴원일이 늘어 재계산 시수가 달라져도 금액은 저장값 그대로", () => {
    const lines = splitCoursesByMonth(
      [course({ days: "월,수", sessions: 9, price: 450_000 })],
      "2026-09-01",
      "2026-09-30",
      ["2026-09-30"], // 나중에 추가된 휴원일
    );
    expect(sum(lines)).toBe(450_000);
    expect(lines).toHaveLength(1);
    expect(lines[0].sessions).toBe(9);
  });
});

// 🔴 글자 단위 파싱의 함정 — '일'이 든 단어가 일요일로 오인된다.
//    blur의 formatDays가 원문을 덮어쓰므로 잘못 읽으면 **사용자가 뭘 쳤는지 흔적도 안 남는다**.
describe("parseDays — 묶음·범위 표현", () => {
  it("'평일'은 월~금이지, 일요일이 아니다", () => {
    expect(parseDays("평일")).toEqual([1, 2, 3, 4, 5]);
  });

  it("'매일'은 이레 전부", () => {
    expect(parseDays("매일")).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("'주말'은 토·일", () => {
    expect(parseDays("주말")).toEqual([6, 0]);
  });

  it("'월~금' 범위는 다섯 요일로 펼친다(양 끝 2일이 아니라)", () => {
    expect(parseDays("월~금")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("화~목")).toEqual([2, 3, 4]);
    expect(parseDays("월-금")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("월 ~ 금")).toEqual([1, 2, 3, 4, 5]);
  });

  it("범위와 낱개를 섞어 써도 된다", () => {
    expect(parseDays("월~수,금")).toEqual([1, 2, 3, 5]);
  });

  it("거꾸로 된 범위는 펼치지 않는다(양 끝만 읽힌다)", () => {
    expect(parseDays("금~월")).toEqual([5, 1]);
  });

  it("정리 표기도 뜻이 보존된다", () => {
    expect(formatDays("평일")).toBe("월,화,수,목,금");
    expect(formatDays("월~금")).toBe("월,화,수,목,금");
  });
});

/**
 * 수강료 구분(월 고정 / 회당) — 원장 2026-08-07:
 * *"EiE 수업이 전부 27만원으로 잡혀있는데 까딱하다가 1회당 27만원으로 계산되기 때문"*.
 * 🔴 이 스위트가 지키는 것은 **모르는 것을 안다고 하지 않는 성질**이다: 단가표에 종류가 없으면
 *    회당으로 단정하지 않고(=곱하지 않고) 사람에게 묻는다.
 */
describe("수강료 구분", () => {
  it("저장은 fixedMonthly 하나로 한다(새 필드를 만들지 않는다 — 옛 견적이 이 키만 갖고 있다)", () => {
    expect(feeKindOf({ fixedMonthly: true })).toBe("monthly");
    expect(feeKindOf({ fixedMonthly: false })).toBe("per_session");
    expect(FEE_KIND_LABEL.monthly).toBe("월 고정");
    expect(FEE_KIND_LABEL.per_session).toBe("회당");
  });

  it("단가표 종류 → 구분. **미지정·할인은 null**(모르는 것을 안다고 하지 않는다)", () => {
    expect(feeKindFromPricingMode("per_session")).toBe("per_session");
    expect(feeKindFromPricingMode("monthly")).toBe("monthly");
    expect(feeKindFromPricingMode(null)).toBeNull();
    expect(feeKindFromPricingMode(undefined)).toBeNull();
    expect(feeKindFromPricingMode("discount")).toBeNull();
    expect(feeKindFromPricingMode("아무거나")).toBeNull();
  });

  // 🔴 EiE 27만원(단가표 미지정 12건, 실측)이 바로 이 경로다 — 조용히 넘어가면 회당 27만원이 된다.
  it("단가표 종류가 없는 행은 '구분 확인 필요'로 표시된다", () => {
    expect(needsFeeKindCheck({ pricingMode: null })).toBe(true);
    expect(needsFeeKindCheck({ pricingMode: "monthly" })).toBe(false);
    expect(needsFeeKindCheck({ pricingMode: "per_session" })).toBe(false);
    // ⚠️ undefined(=출처 기록 없음, 옛 견적)는 **경고하지 않는다** — 아래 전용 describe 참조.
    expect(needsFeeKindCheck({ pricingMode: undefined })).toBe(false);
  });

  it("구분별로 나누고 각각 합계를 낸다", () => {
    const cs = [
      course({ uid: "a", name: "EiE", fixedMonthly: true, price: 270000 }),
      course({ uid: "b", name: "수학", fixedMonthly: false, price: 350000 }),
      course({ uid: "c", name: "국어", fixedMonthly: true, price: 100000 }),
    ];
    const g = groupByFeeKind(cs);
    expect(g.monthly.map((c) => c.uid)).toEqual(["a", "c"]);
    expect(g.perSession.map((c) => c.uid)).toEqual(["b"]);
    expect(g.monthlyTotal).toBe(370000);
    expect(g.perSessionTotal).toBe(350000);
  });

  // ⚠️ 화면만 나눈다 — 안내문은 courses 배열 순서대로 인쇄되므로 여기서 정렬하면 두 화면이 어긋난다.
  it("원본 순서를 바꾸지 않는다", () => {
    const cs = [
      course({ uid: "a", fixedMonthly: false }),
      course({ uid: "b", fixedMonthly: true }),
      course({ uid: "c", fixedMonthly: false }),
    ];
    expect(groupByFeeKind(cs).perSession.map((c) => c.uid)).toEqual(["a", "c"]);
    expect(cs.map((c) => c.uid)).toEqual(["a", "b", "c"]); // 입력 배열은 그대로
  });

  it("합계는 음수를 0으로 막는다(총액과 같은 규약)", () => {
    expect(groupByFeeKind([course({ fixedMonthly: true, price: -5000 })]).monthlyTotal).toBe(0);
  });
});

/**
 * 🔴 옛 견적 회귀(원장 제보 2026-08-07: *"기존 청구서들이 왜 단가표에 없는 항목이라 나오지?"*).
 * 출처 기록이 없는 행(`pricingMode` 키 자체가 없다 = 이 필드를 만들기 전 저장분)에까지 경고를 띄웠다.
 * **모르는 것을 "없다"고 말한 것**이라 화면에 사실이 아닌 문장이 떴다.
 */
describe("needsFeeKindCheck — undefined(모름) ≠ null(없음)", () => {
  it("옛 견적(출처 기록 없음)에는 경고하지 않는다", () => {
    expect(needsFeeKindCheck({})).toBe(false);
    expect(needsFeeKindCheck({ pricingMode: undefined })).toBe(false);
  });

  it("단가표에서 왔는데 종류가 안 적혀 있던 행에만 경고한다", () => {
    expect(needsFeeKindCheck({ pricingMode: null })).toBe(true);
  });

  it("종류가 있으면 경고하지 않는다", () => {
    for (const m of ["per_session", "monthly", "extra", "discount"]) {
      expect(needsFeeKindCheck({ pricingMode: m })).toBe(false);
    }
  });
});

/**
 * 🔴 저장된 견적 속 지뢰(원장 제보 2026-08-07: *"EiE가 회당 단가 처리되어있는 청구서가 있는데?
 * 금액은 정상인데 회당 단가 27만원, 시수12, 총금액 27만원"*).
 * 그 화면에서 날짜·요일·시수를 하나만 건드리면 자동 계산이 돌아 **270,000 × 12 = 3,240,000원**이 된다.
 */
describe("normalizeLoadedCourse — 월 정액이 '회당'으로 저장된 행", () => {
  const eie = (over: Partial<QuoteCourse> = {}) =>
    course({ name: "Let's Speak", perSession: 270000, sessions: 12, price: 270000, fixedMonthly: false, ...over });

  it("총액 = 회당 단가인데 시수가 1이 아니면 산수가 성립하지 않는다 → 월 고정으로 바로잡는다", () => {
    const fixed = normalizeLoadedCourse(eie());
    expect(fixed.fixedMonthly).toBe(true);
    expect(fixed.perSession).toBe(0);
  });

  // ⚠️ 이미 학부모에게 안내된 숫자다 — 구분만 고치고 **금액·시수는 그대로** 둔다.
  it("금액·시수는 절대 바꾸지 않는다", () => {
    const fixed = normalizeLoadedCourse(eie());
    expect(fixed.price).toBe(270000);
    expect(fixed.sessions).toBe(12);
  });

  it("시수 0(요일 미입력)도 같은 지뢰라 바로잡는다", () => {
    expect(normalizeLoadedCourse(eie({ sessions: 0 })).fixedMonthly).toBe(true);
  });

  it("시수 1은 총액=단가가 정상이라 건드리지 않는다", () => {
    const one = eie({ sessions: 1 });
    expect(normalizeLoadedCourse(one)).toBe(one); // 같은 객체 그대로
  });

  it("정상적인 회당 행(단가×시수=총액)은 건드리지 않는다", () => {
    const ok = course({ perSession: 21250, sessions: 9, price: 191250, fixedMonthly: false });
    expect(normalizeLoadedCourse(ok)).toBe(ok);
  });

  it("이미 월 고정인 행은 건드리지 않는다", () => {
    const m = course({ perSession: 0, sessions: 12, price: 270000, fixedMonthly: true });
    expect(normalizeLoadedCourse(m)).toBe(m);
  });

  it("목록 전체에 적용된다", () => {
    const out = normalizeLoadedCourses([eie(), course({ perSession: 0, price: 100000, fixedMonthly: true })]);
    expect(out.map((c) => c.fixedMonthly)).toEqual([true, true]);
  });
});
