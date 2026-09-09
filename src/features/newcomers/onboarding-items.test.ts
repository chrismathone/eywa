import { describe, expect, it } from "vitest";

import {
  BUCKET_LABEL,
  ONBOARDING_ITEMS,
  ONBOARDING_ITEM_KEYS,
  bucketOf,
  daysBetween,
  dueDateOf,
  progressOf,
  shiftDate,
  statusOf,
} from "./onboarding-items";

const TODAY = "2026-09-09";
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
    expect(statusOf(item("pre_call"), unknown, null, TODAY)).toBe("pending");
    // 등록 기준 항목은 그대로 판정된다(9/1 등록 → OJT 기한 9/8 = 어제라 지연).
    expect(statusOf(item("ojt"), unknown, null, TODAY)).toBe("overdue");
  });
});

describe("상태", () => {
  const anchors = { enrolledOn: "2026-08-20", firstClassOn: "2026-09-07" };

  it("완료일이 있으면 기한과 무관하게 완료", () => {
    expect(statusOf(item("pre_call"), anchors, "2026-09-05", TODAY)).toBe("done");
    expect(statusOf(item("month3_call"), anchors, "2026-09-01", TODAY)).toBe("done");
  });

  it("기한이 지났으면 지연", () => {
    expect(statusOf(item("pre_call"), anchors, null, TODAY)).toBe("overdue");
  });

  it("오늘·사흘 안이면 임박, 그보다 멀면 예정", () => {
    // after_first_call 기한 = 9/14 → 9/11이면 3일 남음(임박), 9/9면 5일(예정)
    expect(statusOf(item("after_first_call"), anchors, null, "2026-09-11")).toBe("due");
    expect(statusOf(item("after_first_call"), anchors, null, TODAY)).toBe("upcoming");
    expect(statusOf(item("after_first_call"), anchors, null, "2026-09-14")).toBe("due");
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
    const p = progressOf(anchors, {}, TODAY);
    expect(p.dueTotal).toBe(0);
    expect(p.rate).toBe(100); // 할 일이 아직 없다 = 정상
    expect(p.overdue).toBe(0);
  });

  it("기한 지난 필수 미완료를 센다", () => {
    const anchors = { enrolledOn: "2026-08-01", firstClassOn: "2026-08-05" };
    const p = progressOf(anchors, { pre_call: "2026-08-04" }, TODAY);
    // 필수 기한 도래 5: pre_call(완료)·첫수업안내·OJT·첫수업후콜·1개월콜. 3개월콜(10/30)은 아직 분모 밖.
    expect(p.dueTotal).toBe(5);
    expect(p.doneCount).toBe(1);
    expect(p.overdue).toBe(4);
    expect(p.rate).toBe(20);
  });

  it("'필요시' 2개월 콜은 지연에도 분모에도 안 들어간다", () => {
    const anchors = { enrolledOn: "2026-06-01", firstClassOn: "2026-06-02" };
    const all = progressOf(anchors, {}, TODAY);
    const overdueKeys = ONBOARDING_ITEMS.filter((i) => !i.optional).length;
    // 등록 100일 경과 → 필수 6개 전부 기한 도래·미완료
    expect(all.dueTotal).toBe(overdueKeys);
    expect(all.overdue).toBe(overdueKeys);
    expect(all.rate).toBe(0);
  });

  it("기한 전에 미리 해도 비율이 100을 안 넘는다", () => {
    const anchors = { enrolledOn: TODAY, firstClassOn: shiftDate(TODAY, 5) };
    const p = progressOf(anchors, { month3_call: TODAY }, TODAY);
    expect(p.doneCount).toBe(1);
    expect(p.dueTotal).toBe(1);
    expect(p.rate).toBe(100);
  });

  it("임박(due)은 분모에 들어가되 지연과 따로 센다", () => {
    const anchors = { enrolledOn: shiftDate(TODAY, -30), firstClassOn: shiftDate(TODAY, -29) };
    const p = progressOf(anchors, { pre_call: "x", first_class_guide: "x", ojt: "x", after_first_call: "x" }, TODAY);
    expect(p.dueSoon).toBe(1); // month1_call 기한 = 오늘
    expect(p.overdue).toBe(0);
  });
});
