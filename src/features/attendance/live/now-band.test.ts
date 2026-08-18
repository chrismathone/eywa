import { describe, expect, it } from "vitest";
import {
  foldNowBands,
  nowBandOf,
  splitByNowBand,
  NOW_BAND_LABEL,
  NOW_BAND_ORDER,
  NOW_LEAD_MIN,
  NOW_TAIL_MIN,
} from "./now-band";

const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

describe("nowBandOf", () => {
  it("실제 사고 재현 — 화요일 13:23에 열려 있는 반은 11:00~14:00 하나뿐", () => {
    const now = min("13:23");
    // 그 요일 슬롯 102개의 대표 시각(실측). 좌석표는 이걸 전부 한 화면에 펼치고 있었다.
    const spans: [string, string][] = [
      ["11:00", "14:00"],
      ["14:30", "15:25"],
      ["16:20", "17:15"],
      ["18:20", "19:15"],
      ["20:10", "21:05"],
    ];
    const bands = spans.map(([s, e]) => nowBandOf(now, min(s), min(e)));
    // 13:23 기준 앞창(2시간) 안은 14:30뿐 — 16:20 이후는 'later'로 빠져 화면에서 접힌다.
    expect(bands).toEqual(["now", "upcoming", "later", "later", "later"]);
    expect(bands.filter((b) => b === "now")).toHaveLength(1);
  });

  it("시작 10분 전부터 '지금' — 아이들은 미리 온다", () => {
    expect(nowBandOf(min("16:09"), min("16:20"), min("17:15"))).toBe("upcoming");
    expect(nowBandOf(min("16:10"), min("16:20"), min("17:15"))).toBe("now");
    expect(nowBandOf(min("16:20"), min("16:20"), min("17:15"))).toBe("now");
  });

  it("종료 10분 뒤까지 '지금', 그 뒤 '지난' — 사라지지는 않는다", () => {
    expect(nowBandOf(min("17:14"), min("16:20"), min("17:15"))).toBe("now");
    expect(nowBandOf(min("17:24"), min("16:20"), min("17:15"))).toBe("now");
    expect(nowBandOf(min("17:25"), min("16:20"), min("17:15"))).toBe("past");
    expect(nowBandOf(min("23:59"), min("16:20"), min("17:15"))).toBe("past");
  });

  it("종료시각을 모르면 끝난 척하지 않는다(slotPhase와 같은 규약)", () => {
    expect(nowBandOf(min("23:00"), min("16:20"), null)).toBe("now");
    expect(nowBandOf(min("10:00"), min("16:20"), null)).toBe("later"); // 6시간 뒤 = 앞창 밖
  });

  it("앞창(2시간) 안이면 '곧 시작', 넘으면 '이후' — 경계는 포함", () => {
    // 원장 2026-08-18: "2시간 이내에 시작하는 수업 모두 보여줘."
    expect(nowBandOf(min("13:00"), min("15:00"), min("16:00"))).toBe("upcoming"); // 정확히 2시간 = 포함
    expect(nowBandOf(min("13:00"), min("15:01"), min("16:00"))).toBe("later"); // 1분 넘음
    expect(nowBandOf(min("13:00"), min("14:00"), min("15:00"))).toBe("upcoming");
  });

  it("앞창도 인자로 덮을 수 있다", () => {
    expect(nowBandOf(min("13:00"), min("18:00"), min("19:00"), undefined, undefined, 600)).toBe("upcoming");
  });

  it("유예·꼬리 폭은 인자로 덮을 수 있다(상수는 기본값일 뿐)", () => {
    expect(nowBandOf(min("16:00"), min("16:20"), min("17:15"), 30, 0)).toBe("now");
    expect(nowBandOf(min("17:15"), min("16:20"), min("17:15"), 10, 0)).toBe("past");
  });

  it("경계 상수 — 유예와 같은 10분", () => {
    expect(NOW_LEAD_MIN).toBe(10);
    expect(NOW_TAIL_MIN).toBe(10);
  });
});

describe("foldNowBands", () => {
  it("연강 카드는 하나라도 열려 있으면 '지금' — 랩실로 옮긴 반이 '지난'으로 내려가지 않는다", () => {
    expect(foldNowBands(["past", "now"])).toBe("now");
    expect(foldNowBands(["now", "upcoming"])).toBe("now");
  });

  it("오전에 끝난 교시 + 저녁 교시 = '이후' — '지난'으로 내리면 저녁이 와도 접힌 채 남는다", () => {
    expect(foldNowBands(["past", "later"])).toBe("later");
    // 앞창 안의 교시가 하나라도 있으면 그게 이긴다(더 급한 쪽).
    expect(foldNowBands(["later", "upcoming"])).toBe("upcoming");
  });

  it("남은 교시가 있으면 '예정', 전부 끝났으면 '지난'", () => {
    expect(foldNowBands(["past", "upcoming"])).toBe("upcoming");
    expect(foldNowBands(["past", "past"])).toBe("past");
    expect(foldNowBands([])).toBe("past");
  });
});

describe("표기·순서", () => {
  it("라벨은 한글 — raw 코드 노출 금지", () => {
    expect(Object.values(NOW_BAND_LABEL).every((v) => /[가-힣]/.test(v))).toBe(true);
  });

  it("지금이 맨 앞", () => {
    expect(NOW_BAND_ORDER).toEqual(["now", "upcoming", "later", "past"]);
  });
});

describe("splitByNowBand", () => {
  const items = [
    { id: "a", band: "past" as const },
    { id: "b", band: "now" as const },
    { id: "c", band: "upcoming" as const },
    { id: "d", band: "past" as const },
  ];

  it("지금 → 예정 → 지난 순, 원소 순서는 보존", () => {
    expect(splitByNowBand(items).map((g) => g.band)).toEqual(["now", "upcoming", "past"]);
    expect(splitByNowBand(items)[2]?.items.map((i) => i.id)).toEqual(["a", "d"]);
  });

  it("한 건도 잃지 않는다 — 지난 수업도 화면에 남는다", () => {
    expect(splitByNowBand(items).reduce((n, g) => n + g.items.length, 0)).toBe(items.length);
  });

  it("빈 묶음은 빼고 준다", () => {
    expect(splitByNowBand([{ band: "now" as const }]).map((g) => g.band)).toEqual(["now"]);
    expect(splitByNowBand([])).toEqual([]);
  });
});
