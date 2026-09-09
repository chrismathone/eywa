import { describe, expect, it } from "vitest";

import {
  BUCKET_LABEL,
  ONBOARDING_ITEMS,
  ONBOARDING_ITEM_KEYS,
  bucketOf,
  daysBetween,
  daysLeftOf,
  dueDateOf,
  progressOf,
  shiftDate,
  statusOf,
} from "./onboarding-items";

const TODAY = "2026-09-09";
/**
 * 기능 시작일(`NEWCOMER_BASELINE_DATE`)과 **떨어뜨린** 기준일 — 아래 규칙 검사들은 "기한이 지나면 지연"이라는
 * 일반 규칙을 보는 것이라, 실제 시작일에 묶이면 그 날짜를 바꿀 때마다 무관한 테스트가 깨진다.
 * 시작일 규칙 자체는 맨 아래 별도 describe가 검사한다.
 */
const BASE = "2000-01-01";
const item = (key: string) => ONBOARDING_ITEMS.find((i) => i.key === key)!;

describe("항목 정의", () => {
  it("원장이 적은 7항목이 순서대로 있다", () => {
    expect(ONBOARDING_ITEM_KEYS).toEqual([
      "pre_call",
      "first_class_guide",
      "ojt",
      "after_first_call",
      "month1_call",
      "month2_call",
      "month3_call",
    ]);
  });

  it("'필요시'는 2개월 콜 하나뿐", () => {
    expect(ONBOARDING_ITEMS.filter((i) => i.optional).map((i) => i.key)).toEqual(["month2_call"]);
  });

  it("사전 콜·첫 수업 안내·첫 수업 후 콜은 첫 수업일에 매단다(등록일 아님)", () => {
    expect(item("pre_call").anchor).toBe("firstClass");
    expect(item("first_class_guide").anchor).toBe("firstClass");
    expect(item("after_first_call").anchor).toBe("firstClass");
    expect(item("ojt").anchor).toBe("enrolled");
    expect(item("month3_call").anchor).toBe("enrolled");
  });
});

describe("기한", () => {
  const anchors = { enrolledOn: "2026-08-20", firstClassOn: "2026-09-07" };

  it("첫 수업 기준 항목은 첫 수업일에서 센다", () => {
    expect(dueDateOf(item("pre_call"), anchors)).toBe("2026-09-06");
    expect(dueDateOf(item("first_class_guide"), anchors)).toBe("2026-09-07");
    expect(dueDateOf(item("after_first_call"), anchors)).toBe("2026-09-14");
  });

  it("등록 기준 항목은 등록일에서 센다", () => {
    expect(dueDateOf(item("ojt"), anchors)).toBe("2026-08-27");
    expect(dueDateOf(item("month1_call"), anchors)).toBe("2026-09-19");
    expect(dueDateOf(item("month3_call"), anchors)).toBe("2026-11-18");
  });

  it("첫 수업일을 모르면 기한이 없다(지연이 아니라 '기한 미정')", () => {
    const unknown = { enrolledOn: "2026-09-01", firstClassOn: null };
    expect(dueDateOf(item("pre_call"), unknown)).toBeNull();
    expect(statusOf(item("pre_call"), unknown, null, TODAY, BASE)).toBe("pending");
    // 등록 기준 항목은 그대로 판정된다(9/1 등록 → OJT 기한 9/8 = 어제라 지연).
    expect(statusOf(item("ojt"), unknown, null, TODAY, BASE)).toBe("overdue");
  });
});

describe("상태", () => {
  const anchors = { enrolledOn: "2026-08-20", firstClassOn: "2026-09-07" };

  it("완료일이 있으면 기한과 무관하게 완료", () => {
    expect(statusOf(item("pre_call"), anchors, "2026-09-05", TODAY, BASE)).toBe("done");
    expect(statusOf(item("month3_call"), anchors, "2026-09-01", TODAY, BASE)).toBe("done");
  });

  it("기한이 지났으면 지연", () => {
    expect(statusOf(item("pre_call"), anchors, null, TODAY, BASE)).toBe("overdue");
  });

  it("오늘·사흘 안이면 임박, 그보다 멀면 예정", () => {
    // after_first_call 기한 = 9/14 → 9/11이면 3일 남음(임박), 9/9면 5일(예정)
    expect(statusOf(item("after_first_call"), anchors, null, "2026-09-11", BASE)).toBe("due");
    expect(statusOf(item("after_first_call"), anchors, null, TODAY, BASE)).toBe("upcoming");
    expect(statusOf(item("after_first_call"), anchors, null, "2026-09-14", BASE)).toBe("due");
  });
});

describe("구간(등록 경과일)", () => {
  it("7·30·60·90일과 초과로 나눈다", () => {
    expect(bucketOf(TODAY, TODAY)).toBe("d7");
    expect(bucketOf(shiftDate(TODAY, -7), TODAY)).toBe("d7");
    expect(bucketOf(shiftDate(TODAY, -8), TODAY)).toBe("d30");
    expect(bucketOf(shiftDate(TODAY, -30), TODAY)).toBe("d30");
    expect(bucketOf(shiftDate(TODAY, -31), TODAY)).toBe("d60");
    expect(bucketOf(shiftDate(TODAY, -61), TODAY)).toBe("d90");
    expect(bucketOf(shiftDate(TODAY, -91), TODAY)).toBe("over");
  });

  it("구간 라벨은 한국어(raw 키 노출 금지)", () => {
    expect(BUCKET_LABEL.d7).toBe("7일");
    expect(BUCKET_LABEL.over).toBe("90일 초과");
  });

  it("daysBetween은 달력일 차이", () => {
    expect(daysBetween("2026-09-01", "2026-09-09")).toBe(8);
    expect(daysBetween("2026-09-09", "2026-09-01")).toBe(-8);
  });
});

describe("진행도", () => {
  it("아직 기한이 안 온 항목은 분모에서 뺀다(등록 첫날이 14%로 보이지 않게)", () => {
    const anchors = { enrolledOn: TODAY, firstClassOn: null };
    const p = progressOf(anchors, {}, TODAY, ONBOARDING_ITEMS, BASE);
    expect(p.dueTotal).toBe(0);
    expect(p.rate).toBe(100); // 할 일이 아직 없다 = 정상
    expect(p.overdue).toBe(0);
  });

  it("기한 지난 필수 미완료를 센다", () => {
    const anchors = { enrolledOn: "2026-08-01", firstClassOn: "2026-08-05" };
    const p = progressOf(anchors, { pre_call: "2026-08-04" }, TODAY, ONBOARDING_ITEMS, BASE);
    // 필수 기한 도래 5: pre_call(완료)·첫수업안내·OJT·첫수업후콜·1개월콜. 3개월콜(10/30)은 아직 분모 밖.
    expect(p.dueTotal).toBe(5);
    expect(p.doneCount).toBe(1);
    expect(p.overdue).toBe(4);
    expect(p.rate).toBe(20);
  });

  it("'필요시' 2개월 콜은 지연에도 분모에도 안 들어간다", () => {
    const anchors = { enrolledOn: "2026-06-01", firstClassOn: "2026-06-02" };
    const all = progressOf(anchors, {}, TODAY, ONBOARDING_ITEMS, BASE);
    const overdueKeys = ONBOARDING_ITEMS.filter((i) => !i.optional).length;
    // 등록 100일 경과 → 필수 6개 전부 기한 도래·미완료
    expect(all.dueTotal).toBe(overdueKeys);
    expect(all.overdue).toBe(overdueKeys);
    expect(all.rate).toBe(0);
  });

  it("기한 전에 미리 해도 비율이 100을 안 넘는다", () => {
    const anchors = { enrolledOn: TODAY, firstClassOn: shiftDate(TODAY, 5) };
    const p = progressOf(anchors, { month3_call: TODAY }, TODAY, ONBOARDING_ITEMS, BASE);
    expect(p.doneCount).toBe(1);
    expect(p.dueTotal).toBe(1);
    expect(p.rate).toBe(100);
  });

  it("임박(due)은 분모에 들어가되 지연과 따로 센다", () => {
    const anchors = { enrolledOn: shiftDate(TODAY, -30), firstClassOn: shiftDate(TODAY, -29) };
    const p = progressOf(anchors, { pre_call: "x", first_class_guide: "x", ojt: "x", after_first_call: "x" }, TODAY, ONBOARDING_ITEMS, BASE);
    expect(p.dueSoon).toBe(1); // month1_call 기한 = 오늘
    expect(p.overdue).toBe(0);
  });
});

describe("🔴 기능 시작일 이전 기한은 지연이 아니다", () => {
  // 원장 2026-09-09: *"오늘 생긴 기능이므로 지나간 미완료 건에 대해서는 됐고, 지금부터 보여지는
  // 31건에 대해서만 진행하도록."* 체크리스트가 오늘 생겼는데 등록은 90일 전부터 있어서, 그냥 계산하면
  // 134건이 전부 빨강이 된다 — 기록할 방법 자체가 없었던 기간이라 그건 "놓쳤다"가 아니다.
  const base = "2026-09-09";
  // 등록 100일 전 학생 — 필수 기한이 전부 시작일보다 앞선다.
  const old = { enrolledOn: "2026-06-01", firstClassOn: "2026-06-03" };

  it("시작일보다 앞선 기한은 waived — overdue가 아니다", () => {
    expect(statusOf(item("ojt"), old, null, "2026-09-20", base)).toBe("waived");
    expect(statusOf(item("pre_call"), old, null, "2026-09-20", base)).toBe("waived");
  });

  it("waived는 분모에도 지연에도 안 들어간다 — 완료율이 0%로 시작하지 않는다", () => {
    const p = progressOf(old, {}, "2026-09-20", ONBOARDING_ITEMS, base);
    expect(p.overdue).toBe(0);
    expect(p.dueTotal).toBe(0);
    // 🔴 셀 것이 없으면 100이다(분모 0 = 아직 할 일이 없다 = 정상) — 0%가 아니다.
    expect(p.rate).toBe(100);
  });

  it("시작일 이후의 기한은 그대로 지연이 된다 — 규칙이 통째로 꺼지는 게 아니다", () => {
    // 9/9 등록 → OJT 기한 9/16. 9/20에는 진짜 지연이다.
    const fresh = { enrolledOn: "2026-09-09", firstClassOn: "2026-09-10" };
    expect(statusOf(item("ojt"), fresh, null, "2026-09-20", base)).toBe("overdue");
    expect(progressOf(fresh, {}, "2026-09-20", ONBOARDING_ITEMS, base).overdue).toBeGreaterThan(0);
  });

  it("완료는 시작일과 무관하다 — 옛 항목도 실제로 했으면 완료로 남는다", () => {
    expect(statusOf(item("ojt"), old, "2026-06-08", "2026-09-20", base)).toBe("done");
  });

  it("기한을 모르는 것(첫 수업일 미정)은 여전히 pending — waived로 뭉치지 않는다", () => {
    // 둘 다 "지연 아님"이지만 이유가 다르다: 하나는 아직 모르는 것, 하나는 기록할 수 없었던 것.
    const unknown = { enrolledOn: "2026-06-01", firstClassOn: null };
    expect(statusOf(item("pre_call"), unknown, null, "2026-09-20", base)).toBe("pending");
  });
});

describe("D-n 남은 날", () => {
  it("기한까지 남은 날을 센다 — 화면이 '언제 오나'를 적을 수 있게", () => {
    const anchors = { enrolledOn: "2026-09-09", firstClassOn: "2026-09-10" };
    // OJT 기한 = 등록 +7 = 9/16
    expect(daysLeftOf(item("ojt"), anchors, "2026-09-09")).toBe(7);
    expect(daysLeftOf(item("ojt"), anchors, "2026-09-15")).toBe(1);
  });
  it("기한을 모르면 null — 지어내지 않는다", () => {
    expect(daysLeftOf(item("pre_call"), { enrolledOn: "2026-09-09", firstClassOn: null }, "2026-09-09")).toBe(null);
  });
});
