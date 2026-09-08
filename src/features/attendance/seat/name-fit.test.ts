import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fitSeatName,
  fluidNameFontSize,
  LAB_CHIP_NAME_FILL,
  NAME_FILL_MAX_PX,
  NAME_FILL_MIN_PX,
  nameDisplayWidth,
  SEAT_CELL_NAME_LADDER,
  SEAT_CHIP_NAME_LADDER,
  type SeatNameLadder,
} from "./name-fit";

/**
 * 헤드리스 크롬 실측(Pretendard Bold, 글씨 크기별 픽셀 폭). 모델이 실제와 갈리면 여기서 걸린다.
 * 좌석표 칸에서 이름이 쓸 수 있는 폭은 43px(카드 최소 176px 기준) — `김하늘A`는 13·12px에서 넘친다.
 */
const MEASURED: Record<string, { 13: number; 12: number; 11: number }> = {
  김하늘: { 13: 39, 12: 36, 11: 33 },
  김하늘A: { 13: 48.16, 12: 44.45, 11: 40.75 },
  김현준B: { 13: 47.3, 12: 43.66, 11: 40.02 },
  김민서G: { 13: 48.39, 12: 44.67, 11: 40.95 },
  Kristine: { 13: 46.75, 12: 43.16, 11: 39.56 },
};

/** 그 사다리에서 고른 단계의 예상 픽셀 폭. */
function pxAt(name: string, ladder: SeatNameLadder): number {
  const step = ladder.steps.find((s) => s.className === fitSeatName(name, ladder).className)!;
  return nameDisplayWidth(name) * step.px;
}

describe("이름 표시 폭 — 글자 수가 아니라 폭", () => {
  it("한글은 1, 영문·숫자는 그보다 좁다", () => {
    expect(nameDisplayWidth("김하늘")).toBe(3);
    expect(nameDisplayWidth("A")).toBe(0.7);
    expect(nameDisplayWidth("a")).toBe(0.54);
    expect(nameDisplayWidth("i")).toBe(0.28);
    expect(nameDisplayWidth("W")).toBe(1.01); // 대문자 M·W는 한글만큼 넓다
    expect(nameDisplayWidth("7")).toBe(0.58);
  });

  it("알파벳 접미사는 한 글자지만 글자마다 폭이 다르다 — 이게 칸을 넘기는 주범", () => {
    expect(nameDisplayWidth("김하늘A")).toBe(3.7);
    expect(nameDisplayWidth("김현준B")).toBe(3.64);
    expect(nameDisplayWidth("김민서G")).toBe(3.72);
  });

  it("글자 수 8개인 영문 이름이 한글 4글자보다 좁을 수 있다", () => {
    expect([..."Kristine"].length).toBeGreaterThan([..."김하늘A"].length);
    expect(nameDisplayWidth("Kristine")).toBeLessThan(nameDisplayWidth("김하늘A"));
  });

  it("앞뒤 공백·빈 이름에도 터지지 않는다", () => {
    expect(nameDisplayWidth("  김하늘  ")).toBe(3);
    expect(nameDisplayWidth("")).toBe(0);
    expect(nameDisplayWidth("김 하늘")).toBe(3.35);
  });
});

describe("좌석표 칸(3열) — 넘치는 이름만 줄어든다", () => {
  it("세 글자 이름은 기본 크기 그대로다", () => {
    expect(fitSeatName("김하늘", SEAT_CELL_NAME_LADDER)).toEqual({
      className: "text-[13px]",
      clipped: false,
    });
  });

  it("접미사가 붙으면 최소 단계까지 내려간다 — 대신 잘리지 않는다", () => {
    expect(fitSeatName("김하늘A", SEAT_CELL_NAME_LADDER)).toEqual({
      className: "text-[11px]",
      clipped: false,
    });
    expect(fitSeatName("김민서G", SEAT_CELL_NAME_LADDER).className).toBe("text-[11px]");
  });

  it("영문 이름도 최소 단계에서 들어간다(글자 수로 재면 잘린다고 오판)", () => {
    expect(fitSeatName("Kristine", SEAT_CELL_NAME_LADDER)).toEqual({
      className: "text-[11px]",
      clipped: false,
    });
  });

  it("고른 단계는 실측 폭으로도 칸에 들어간다", () => {
    for (const [name, px] of Object.entries(MEASURED)) {
      const fit = fitSeatName(name, SEAT_CELL_NAME_LADDER);
      const size = Number(fit.className.replace(/\D/g, "")) as 13 | 12 | 11;
      expect(px[size]).toBeLessThanOrEqual(SEAT_CELL_NAME_LADDER.widthPx);
      expect(pxAt(name, SEAT_CELL_NAME_LADDER)).toBeLessThanOrEqual(SEAT_CELL_NAME_LADDER.widthPx);
    }
  });

  it("모델 폭이 실측과 0.5px 안에서 맞는다 — 낙관하면 다시 잘린다", () => {
    for (const [name, px] of Object.entries(MEASURED)) {
      expect(Math.abs(nameDisplayWidth(name) * 13 - px[13])).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("랩실 칩(148px 격자) — 실제 이름은 기본 크기를 지킨다", () => {
  it("네 글자 접미사 이름까지는 줄일 이유가 없다", () => {
    for (const name of ["김하늘", "김하늘A", "김민서G", "Kristine", "장준호(테스트)"]) {
      expect(fitSeatName(name, SEAT_CHIP_NAME_LADDER)).toEqual({
        className: "text-sm",
        clipped: false,
      });
    }
  });

  it("정말 긴 이름은 단계적으로 줄어든다", () => {
    expect(fitSeatName("김하늘하늘하늘하", SEAT_CHIP_NAME_LADDER).className).toBe("text-[13px]");
    expect(fitSeatName("김하늘하늘하늘하늘", SEAT_CHIP_NAME_LADDER).className).toBe("text-[12px]");
  });
});

describe("하한 — 못 읽을 만큼 작아지지 않는다", () => {
  it("사다리 밖으로는 절대 안 내려가고, 그때만 말줄임을 알린다", () => {
    const absurd = "김".repeat(40);
    const cell = fitSeatName(absurd, SEAT_CELL_NAME_LADDER);
    const chip = fitSeatName(absurd, SEAT_CHIP_NAME_LADDER);
    expect(cell).toEqual({ className: "text-[11px]", clipped: true });
    expect(chip).toEqual({ className: "text-[12px]", clipped: true });
  });

  it("들어가는 이름에는 말줄임 표시가 붙지 않는다", () => {
    expect(fitSeatName("김하늘A", SEAT_CELL_NAME_LADDER).clipped).toBe(false);
    expect(fitSeatName("김하늘A", SEAT_CHIP_NAME_LADDER).clipped).toBe(false);
  });
});

describe("배선 — 이름 칸은 이 함수를 거친다(복붙 금지)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const CONSUMERS = [
    "src/features/attendance/live/components/seating-cell.tsx",
    "src/app/(shell)/attendance/seat/[seat]/_components/seat-lab-grid.tsx",
  ];

  it("소비처는 크기를 직접 적지 않고 칸 폭 비례 함수에서 받아 쓴다 — 칸엔 @container(2026-09-04 '이름 꽉 차게')", () => {
    for (const path of [...CONSUMERS, "src/features/attendance/quick/components/quick-class-card.tsx"]) {
      const src = read(path);
      expect(src).toMatch(/fluidNameFontSize\(/);
      expect(src).toMatch(/@container/);
      expect(src).not.toMatch(/text-\[1[0-9]px\]/);
      // 하한·채움 비율 숫자는 name-fit.ts에만 — 소비처가 `minPx: 13`·`fill: 0.75`를 직접 적으면 규약이 갈린다.
      expect(src).not.toMatch(/minPx:\s*\d/);
      expect(src).not.toMatch(/fill:\s*\d/);
    }
  });

  it("랩실 칩은 하한에서 넘치는 이름의 툴팁 판정(clipped)을 여전히 사다리에서 받는다", () => {
    expect(read(CONSUMERS[1])).toMatch(/fitSeatName\(/);
    expect(read(CONSUMERS[1])).toMatch(/fit\.clipped/);
  });

  it("랩실 칩은 배지·'결' 버튼 자리를 비워 둔다", () => {
    expect(read(CONSUMERS[1])).toMatch(/pr-5/);
  });
});

describe("사다리 = 캐논 잠금", () => {
  it("단계는 셋뿐이고 크기는 작아지는 순서다", () => {
    for (const ladder of [SEAT_CHIP_NAME_LADDER, SEAT_CELL_NAME_LADDER]) {
      expect(ladder.steps).toHaveLength(3);
      expect(ladder.steps[0].px).toBeGreaterThan(ladder.steps[1].px);
      expect(ladder.steps[1].px).toBeGreaterThan(ladder.steps[2].px);
      expect(ladder.steps[2].px).toBeGreaterThanOrEqual(11); // 하한 — 더 작게 잡지 말 것
    }
  });

  it("클래스는 임의 px 신설이 아니라 정해진 단계다", () => {
    expect(SEAT_CHIP_NAME_LADDER.steps.map((s) => s.className)).toEqual([
      "text-sm",
      "text-[13px]",
      "text-[12px]",
    ]);
    expect(SEAT_CELL_NAME_LADDER.steps.map((s) => s.className)).toEqual([
      "text-[13px]",
      "text-[12px]",
      "text-[11px]",
    ]);
  });
});

describe("fluidNameFontSize — 칸 폭에 비례하는 이름 글자(원장 2026-09-04 '출결에도 이름 꽉 차게')", () => {
  it("세 글자 이름은 칸 내용 폭의 33.3%(1 ÷ 3em)로, 하한·상한은 clamp에 실린다", () => {
    expect(fluidNameFontSize("김하늘", { minPx: 11, maxPx: 24 })).toBe("clamp(11px, 33.3cqw, 24px)");
  });
  it("접미사 이름(3.7em)은 그만큼 작은 비율 — 같은 칸에서 세 글자 이름보다 작다", () => {
    expect(fluidNameFontSize("김하늘A", { minPx: 11, maxPx: 24 })).toBe("clamp(11px, 27cqw, 24px)");
  });
  it("배지 자리를 남기는 칩은 fill을 낮춘다(랩실 0.75)", () => {
    expect(LAB_CHIP_NAME_FILL).toBe(0.75);
    expect(fluidNameFontSize("김하늘", { minPx: NAME_FILL_MIN_PX.labChip, maxPx: NAME_FILL_MAX_PX, fill: LAB_CHIP_NAME_FILL })).toBe("clamp(12px, 25cqw, 24px)");
  });
  it("가장 좁은 좌석표 칸(내용 폭 39px)에서 세 글자 이름은 옛 사다리와 같은 13px(회귀 아님)", () => {
    // cqw는 내용 상자 기준(실측 2026-09-04: 47px 칸 = 내용 39px). 구현이 낸 비율로 계산한다(산수만 검사하지 않는다).
    const css = fluidNameFontSize("김하늘", { minPx: NAME_FILL_MIN_PX.seatCell, maxPx: NAME_FILL_MAX_PX });
    const cqw = Number(css.match(/([\d.]+)cqw/)![1]);
    const px = Math.min(NAME_FILL_MAX_PX, Math.max(NAME_FILL_MIN_PX.seatCell, (cqw / 100) * 39));
    expect(px).toBeCloseTo(13, 0);
  });
  it("상한은 24px(text-xl) 하나", () => {
    expect(NAME_FILL_MAX_PX).toBe(24);
  });
});
