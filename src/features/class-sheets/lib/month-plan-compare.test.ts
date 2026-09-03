import { describe, expect, it } from "vitest";
import { mpCellMapOf, type MpCell } from "./month-plan";
import {
  MP_STATUS_HINT,
  MP_STATUS_LABEL,
  MP_STATUS_TONE,
  mpActualBooks,
  mpActualSummary,
  mpCompareDay,
  mpIsWarning,
  mpLinesOfDate,
  mpPlanBookNames,
  mpSummarize,
  type MpActualLine,
} from "./month-plan-compare";

const cell = (colKind: MpCell["colKind"], body: string): MpCell => ({
  planDate: "2026-09-01",
  colKind,
  body,
});
const line = (over: Partial<MpActualLine> = {}): MpActualLine => ({
  slotStart: "15:00",
  textbook: "Let's Express 1 SB",
  pageRange: "6-8",
  progress: null,
  seat: false,
  ...over,
});

describe("mpPlanBookNames — 숫자가 붙은 조각만 책 이름 후보", () => {
  it("시트 표기에서 이름만 뽑는다", () => {
    expect(mpPlanBookNames("SB 6-8")).toEqual(["SB"]);
    expect(mpPlanBookNames("SB 6-8 & SB 19-11")).toEqual(["SB"]);
    expect(mpPlanBookNames("WB 4-5\nPB 2-4 (문장 녹음)")).toEqual(["WB", "PB"]);
  });

  it("🔑 범위가 없는 지시문은 책이 아니다(오인하면 그 날이 통째로 '교재 다름'이 된다)", () => {
    expect(mpPlanBookNames("Monthly Test")).toEqual([]);
    expect(mpPlanBookNames("NO TEST")).toEqual([]);
    expect(mpPlanBookNames("단어 암기")).toEqual([]);
    expect(mpPlanBookNames("Book Report")).toEqual([]);
  });

  it("숫자만 있는 조각(단어시험 범위)도 후보가 아니다", () => {
    expect(mpPlanBookNames("1-20")).toEqual([]);
  });

  it("빈 입력은 빈 배열", () => {
    expect(mpPlanBookNames(null)).toEqual([]);
    expect(mpPlanBookNames("   ")).toEqual([]);
  });
});

describe("mpCompareDay — 신호는 셋뿐", () => {
  const base = { date: "2026-09-01", isOff: false };

  it("휴강이면 아무것도 견주지 않는다", () => {
    const v = mpCompareDay({ ...base, isOff: true, cells: {}, lines: [line()] });
    expect(v.status).toBe("off");
  });

  it("계획도 기록도 없으면 empty(경고 아님)", () => {
    expect(mpCompareDay({ ...base, cells: {}, lines: [] }).status).toBe("empty");
  });

  it("🔴 계획은 있는데 실제 줄이 0 → 미작성", () => {
    const cells = mpCellMapOf([cell("in_class", "SB 6-8")]);
    const v = mpCompareDay({ ...base, cells, lines: [] });
    expect(v.status).toBe("unwritten");
    expect(mpIsWarning(v.status)).toBe(true);
  });

  it("🔴 실제는 있는데 계획 칸이 비면 '계획 없음' — **경고가 아니다**", () => {
    const v = mpCompareDay({ ...base, cells: {}, lines: [line()] });
    expect(v.status).toBe("no-plan");
    expect(mpIsWarning(v.status)).toBe(false);
  });

  it("표기가 흔들려도 같은 책으로 본다(SB ⊂ Let's Express 1 SB)", () => {
    const cells = mpCellMapOf([cell("in_class", "SB 6-8")]);
    expect(mpCompareDay({ ...base, cells, lines: [line()] }).status).toBe("ok");
  });

  it("계획에 적은 교재가 그 날 기록 어디에도 없으면 '교재 다름'", () => {
    const cells = mpCellMapOf([cell("in_class", "SB 6-8")]);
    const v = mpCompareDay({ ...base, cells, lines: [line({ textbook: "Grammar Inside 3" })] });
    expect(v.status).toBe("off-book");
    expect(v.planBooks).toEqual(["SB"]);
    expect(v.actualBooks).toEqual(["Grammar Inside 3"]);
  });

  it("여러 후보 중 하나만 맞아도 통과한다", () => {
    const cells = mpCellMapOf([cell("in_class", "SB 6-8 & WB 2-3")]);
    expect(mpCompareDay({ ...base, cells, lines: [line({ textbook: "LE1 WB" })] }).status).toBe("ok");
  });

  it("🔴 계획이 교재 이름을 안 댔으면 판정하지 않는다", () => {
    const cells = mpCellMapOf([cell("in_class", "Monthly Test")]);
    expect(mpCompareDay({ ...base, cells, lines: [line({ textbook: "Grammar Inside 3" })] }).status).toBe(
      "ok",
    );
  });

  it("🔴 실제 줄에 교재가 하나도 없으면 판정하지 않는다('안 적었다'를 '다른 책'으로 둔갑 금지)", () => {
    const cells = mpCellMapOf([cell("in_class", "SB 6-8")]);
    const v = mpCompareDay({ ...base, cells, lines: [line({ textbook: null })] });
    expect(v.status).toBe("ok");
  });

  it("⚠️ 자리(LAB·JJ) 줄은 교재 대조에서 빠지되 '기록 있음'으로는 센다", () => {
    const cells = mpCellMapOf([cell("in_class", "SB 6-8")]);
    // 자리 줄만 있는 날: 미작성이 아니고(기록은 있다), 교재 대조도 안 한다(반 진도가 아니다).
    const v = mpCompareDay({ ...base, cells, lines: [line({ seat: true, textbook: "인재원 SRS" })] });
    expect(v.status).toBe("ok");
    expect(v.actualBooks).toEqual([]);
  });

  it("Homework 칸만 적어도 계획이 있는 것으로 본다(In-class 없이 과제만 내는 날)", () => {
    const cells = mpCellMapOf([cell("homework", "WB 4-5")]);
    expect(mpCompareDay({ ...base, cells, lines: [] }).status).toBe("unwritten");
    // 다만 대조 축은 In-class라 교재 판정은 안 한다.
    expect(mpCompareDay({ ...base, cells, lines: [line({ textbook: "다른 책" })] }).status).toBe("ok");
  });
});

describe("mpLinesOfDate — 화면과 툴바가 같은 재료를 본다", () => {
  it("교시 순으로 모으고, 그 날에 없는 슬롯은 건너뛴다", () => {
    const source = {
      slotsByDate: {
        "2026-09-01": [{ slotStart: "15:00" }, { slotStart: "15:40" }, { slotStart: "16:20" }],
      },
      linesBySlot: {
        "2026-09-01|15:40": [line({ slotStart: "15:40", textbook: "B" })],
        "2026-09-01|15:00": [line({ slotStart: "15:00", textbook: "A" })],
      },
    };
    // 🔴 교시 순은 `slotsByDate`의 순서가 정한다(맵의 키 순서가 아니다).
    expect(mpLinesOfDate(source, "2026-09-01").map((l) => l.textbook)).toEqual(["A", "B"]);
    expect(mpLinesOfDate(source, "2026-09-02")).toEqual([]);
  });
});

describe("mpActualBooks / mpActualSummary", () => {
  it("교재는 중복 없이 등장 순", () => {
    expect(
      mpActualBooks([line(), line(), line({ textbook: "Grammar Inside 3" }), line({ textbook: "  " })]),
    ).toEqual(["Let's Express 1 SB", "Grammar Inside 3"]);
  });

  it("요약은 '교재 쪽 · 진도' 한 줄씩, 빈 줄은 뺀다", () => {
    expect(
      mpActualSummary([
        line({ progress: "Unit 1 마무리" }),
        line({ textbook: null, pageRange: null, progress: null }),
        line({ textbook: "WB", pageRange: null, progress: null }),
      ]),
    ).toEqual(["Let's Express 1 SB 6-8 · Unit 1 마무리", "WB"]);
  });
});

describe("MP_STATUS_TONE — 뜻과 색이 한 곳에서 정해진다", () => {
  it("🔴 손대야 하는 것만 주의(caution)이고, `no-plan`은 경고가 아니다", () => {
    expect(MP_STATUS_TONE.unwritten).toBe("caution");
    expect(MP_STATUS_TONE["off-book"]).toBe("caution");
    expect(MP_STATUS_TONE["no-plan"]).toBe("inert");
    expect(MP_STATUS_TONE.off).toBe("inert");
  });

  it("정상·빈 날엔 아무 표식도 안 붙는다", () => {
    expect(MP_STATUS_TONE.ok).toBeNull();
    expect(MP_STATUS_TONE.empty).toBeNull();
  });

  it("모든 상태에 라벨·설명이 있다(빈 배지가 서지 않게)", () => {
    for (const status of Object.keys(MP_STATUS_TONE) as (keyof typeof MP_STATUS_TONE)[]) {
      expect(MP_STATUS_LABEL[status]).toBeTruthy();
      expect(MP_STATUS_HINT[status]).toBeTruthy();
    }
  });
});

describe("mpSummarize — 휴강은 분모에서 빠진다", () => {
  it("신호를 세고, 계획을 적은 날을 분자로 센다", () => {
    const s = mpSummarize([
      { status: "off", planBooks: [], actualBooks: [] },
      { status: "ok", planBooks: [], actualBooks: [] },
      { status: "unwritten", planBooks: [], actualBooks: [] },
      { status: "off-book", planBooks: [], actualBooks: [] },
      { status: "no-plan", planBooks: [], actualBooks: [] },
      { status: "empty", planBooks: [], actualBooks: [] },
    ]);
    expect(s).toEqual({ unwritten: 1, offBook: 1, noPlan: 1, planned: 3, scheduled: 5 });
  });

  it("🔴 '계획은 썼는데 미작성'인 날이 작성률 분자에서 사라지지 않는다", () => {
    const s = mpSummarize([{ status: "unwritten", planBooks: [], actualBooks: [] }]);
    expect(s.planned).toBe(1);
  });
});

describe("mpCompareDay — 아직 안 온 수업일은 판정하지 않는다(upcoming)", () => {
  const cells = mpCellMapOf([cell("in_class", "SB 6-8")]);

  it("🔴 계획만 있고 기록이 없어도, 그 날이 **오늘보다 뒤면** 미작성이 아니다", () => {
    const v = mpCompareDay({
      date: "2026-09-20",
      isOff: false,
      cells: mpCellMapOf([{ planDate: "2026-09-20", colKind: "in_class", body: "SB 6-8" }]),
      lines: [],
      today: "2026-09-03",
    });
    expect(v.status).toBe("upcoming");
    expect(mpIsWarning(v.status)).toBe(false);
  });

  it("🔴 오늘은 '지난 날'이다 — 경계는 오늘보다 뒤만(앱 전역 elapsedDays 규약)", () => {
    const v = mpCompareDay({ date: "2026-09-01", isOff: false, cells, lines: [], today: "2026-09-01" });
    expect(v.status).toBe("unwritten");
  });

  it("🔴 사실이 달력을 이긴다 — 미래여도 기록이 있으면 그대로 대조한다", () => {
    const v = mpCompareDay({
      date: "2026-09-20",
      isOff: false,
      cells: mpCellMapOf([{ planDate: "2026-09-20", colKind: "in_class", body: "SB 6-8" }]),
      lines: [line({ textbook: "SB", pageRange: "6-8" })],
      today: "2026-09-03",
    });
    expect(v.status).toBe("ok");
  });

  it("today를 안 넘기면 종전대로 판정한다(호출부 점진 적용 안전)", () => {
    expect(mpCompareDay({ date: "2026-09-01", isOff: false, cells, lines: [] }).status).toBe("unwritten");
  });

  it("upcoming은 미작성에서 빠지되 작성률 분자·분모에는 남는다(계획은 실제로 썼다)", () => {
    const s = mpSummarize([{ status: "upcoming", planBooks: [], actualBooks: [] }]);
    expect(s.unwritten).toBe(0);
    expect(s.planned).toBe(1);
    expect(s.scheduled).toBe(1);
  });
});
